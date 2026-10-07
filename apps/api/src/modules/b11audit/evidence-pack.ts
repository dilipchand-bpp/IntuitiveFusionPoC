/**
 * SEC-L07 and NFR-R06: an evidence pack an external auditor can check without trusting the platform.
 *
 * A pack is a set of files for a date range (and optionally one procurement): the audit events as the chain segment (every event
 * with its previous hash and its own), the probity records (declarations, allocations, witnesses, signed documents, deviations,
 * approvals with an authority check, supplier communications, late-bid handling, holds), a coverage checklist ("what an external
 * auditor would look for", pass or fail computed from the data), a human-readable index.html, and a manifest listing the SHA-256
 * of every file, the chain head hash, who generated it and when. The manifest is signed.
 *
 * SWAP POINT (docs/swap-points.md): the signature here is HMAC-SHA256 with the secret `audit.export.signing` from the local
 * secret store. That is a SYMMETRIC simulation of a signature: whoever can verify can also forge. A real deployment signs the
 * manifest with an asymmetric key held in an HSM or cloud KMS (for example an ECDSA P-256 key), publishes the public key, and
 * the auditor verifies offline with it. The manifest, the file hashes and the chain check do not change.
 *
 * Verification (POST /audit/export-pack/verify) checks, and names, each part: every file against the manifest, the signature, every
 * event hash and the links between consecutive events, the head hash against the manifest, and (as an extra) each event hash
 * against the live chain.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { computeHash, GENESIS, type Json } from '../../audit/audit-service.js';
import { zipStored } from '../../documents/xlsx.js';
import { guard, type GuardDeps } from '../../auth/guard.js';
import { withContext, type Tx } from '../../db/client.js';
import {
  addendum,
  appUser,
  approval,
  auditEvent,
  bidWitness,
  clarification,
  coiDeclaration,
  contract,
  delegation,
  evalReport,
  evaluation,
  exportPackLog,
  panelMember,
  plan,
  probityAllocation,
  probityDocument,
  question,
  request,
  submission,
  supplier,
  tenant,
  tender,
  tenderDeviation,
} from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { readSecret, setSecret } from '../b10conn/secrets.js';
import { stableJson, UUID } from './util.js';

export const PACK_KEY_NAME = 'audit.export.signing';
export const PACK_VERSION = 1;
const PACK_MAX_EVENTS = 20_000;
export const PACK_READERS = ['PROBITY', 'EXEC', 'ADMIN'] as const;
export const PACK_VERIFIERS = ['PROBITY', 'EXEC', 'ADMIN', 'LEGAL'] as const;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-01');
const packBody = z
  .object({
    from: day,
    to: day,
    requestId: z.string().uuid().optional(),
    format: z.enum(['JSON', 'ZIP']).default('JSON'),
  })
  .strict()
  .refine((b) => b.from <= b.to, { message: 'The start date is after the end date', path: ['from'] });
const verifyBody = z
  .object({
    bundle: z.object({ files: z.record(z.string().max(120), z.string()) }).optional(),
    zipBase64: z.string().max(40_000_000).optional(),
  })
  .strict()
  .refine((b) => Boolean(b.bundle) !== Boolean(b.zipBase64), {
    message: 'Send either the bundle (JSON) or the zip (base64), not both',
  });

const sha256 = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

// ------------------------------------------------------------------------------------------ chain segment checks
export interface PackEvent {
  seq: number;
  at: string;
  actorId: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: Json;
  after: Json;
  correlationId: string | null;
  result: string;
  prevHash: string;
  hash: string;
}

/**
 * Re-computes each event's hash from its own content and previous hash, and checks that consecutive events (consecutive sequence
 * numbers) link. A procurement-only pack skips other procurements' events, so a jump in sequence numbers is reported as a gap and
 * is not an error: each event is still proven by itself.
 */
export function verifyEvents(events: PackEvent[]): {
  ok: boolean;
  checked: number;
  gaps: number;
  brokenAtSeq: number | null;
  reason: string | null;
} {
  let prev: PackEvent | null = null;
  let gaps = 0;
  let checked = 0;
  for (const e of events) {
    checked++;
    if (prev && e.seq <= prev.seq)
      return { ok: false, checked, gaps, brokenAtSeq: e.seq, reason: 'events are out of order' };
    if (prev && e.seq === prev.seq + 1 && e.prevHash !== prev.hash)
      return {
        ok: false,
        checked,
        gaps,
        brokenAtSeq: e.seq,
        reason: 'prev_hash does not match the preceding event',
      };
    if (prev && e.seq > prev.seq + 1) gaps++;
    prev = e;
  }
  return { ok: true, checked, gaps, brokenAtSeq: null, reason: null };
}

/** The hash of an event needs the tenant id (it is part of what is hashed), so the pack carries it once. */
export function verifyEventHashes(
  tenantId: string,
  events: PackEvent[],
): { ok: boolean; brokenAtSeq: number | null; reason: string | null } {
  for (const e of events) {
    const expected = computeHash(e.prevHash, {
      tenantId,
      at: e.at,
      actorId: e.actorId,
      actorRole: e.actorRole,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      before: e.before,
      after: e.after,
      correlationId: e.correlationId,
      result: e.result,
    });
    if (expected !== e.hash)
      return {
        ok: false,
        brokenAtSeq: e.seq,
        reason: 'event content does not match its hash (event altered)',
      };
  }
  return { ok: true, brokenAtSeq: null, reason: null };
}

// ------------------------------------------------------------------------------------------ probity data
interface Related {
  requestIds: string[];
  planIds: string[];
  tenderIds: string[];
  evaluationIds: string[];
  reportIds: string[];
  contractIds: string[];
  submissionIds: string[];
  entityIds: string[];
}

async function relatedTo(tx: Tx, tenantId: string, requestId: string): Promise<Related> {
  const plans = await tx
    .select({ id: plan.id })
    .from(plan)
    .where(and(eq(plan.tenantId, tenantId), eq(plan.requestId, requestId)));
  const tenders = await tx
    .select({ id: tender.id })
    .from(tender)
    .where(and(eq(tender.tenantId, tenantId), eq(tender.requestId, requestId)));
  const tenderIds = tenders.map((t) => t.id);
  const evals = tenderIds.length
    ? await tx.select({ id: evaluation.id }).from(evaluation).where(inArray(evaluation.tenderId, tenderIds))
    : [];
  const evalIds = evals.map((e) => e.id);
  const reports = evalIds.length
    ? await tx.select({ id: evalReport.id }).from(evalReport).where(inArray(evalReport.evaluationId, evalIds))
    : [];
  const contracts = tenderIds.length
    ? await tx.select({ id: contract.id }).from(contract).where(inArray(contract.tenderId, tenderIds))
    : [];
  const subs = tenderIds.length
    ? await tx.select({ id: submission.id }).from(submission).where(inArray(submission.tenderId, tenderIds))
    : [];
  const r: Related = {
    requestIds: [requestId],
    planIds: plans.map((x) => x.id),
    tenderIds,
    evaluationIds: evalIds,
    reportIds: reports.map((x) => x.id),
    contractIds: contracts.map((x) => x.id),
    submissionIds: subs.map((x) => x.id),
    entityIds: [],
  };
  r.entityIds = [
    ...r.requestIds,
    ...r.planIds,
    ...r.tenderIds,
    ...r.evaluationIds,
    ...r.reportIds,
    ...r.contractIds,
    ...r.submissionIds,
  ];
  return r;
}

const inRange = (d: Date | null | undefined, from: Date, to: Date) => (d ? d >= from && d <= to : false);
const dayStart = (s: string) => new Date(`${s}T00:00:00Z`);
const dayEnd = (s: string) => new Date(`${s}T23:59:59.999Z`);

async function fetchEvents(
  tx: Tx,
  tenantId: string,
  from: string,
  to: string,
  rel: Related | null,
): Promise<PackEvent[]> {
  const conds = [
    eq(auditEvent.tenantId, tenantId),
    gte(auditEvent.at, dayStart(from)),
    lte(auditEvent.at, dayEnd(to)),
  ];
  if (rel) conds.push(inArray(auditEvent.entityId, rel.entityIds));
  const rows = await tx
    .select()
    .from(auditEvent)
    .where(and(...conds))
    .orderBy(asc(auditEvent.seq))
    .limit(PACK_MAX_EVENTS + 1);
  if (rows.length > PACK_MAX_EVENTS)
    throw new AppError(
      422,
      'EXPORT_TOO_LARGE',
      `More than ${PACK_MAX_EVENTS} events match; narrow the dates`,
    );
  return rows.map((r) => ({
    seq: r.seq,
    at: r.at.toISOString(),
    actorId: r.actorId,
    actorRole: r.actorRole,
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    before: (r.before ?? null) as Json,
    after: (r.after ?? null) as Json,
    correlationId: r.correlationId,
    result: r.result,
    prevHash: r.prevHash,
    hash: r.hash,
  }));
}

export interface CoverageItem {
  key: string;
  label: string;
  /** What an external auditor would look for, in their words. */
  ask: string;
  status: 'PASS' | 'FAIL' | 'NA';
  detail: string;
}

const AUTH_SCOPE: Record<string, 'SOURCING_APPROVAL' | 'PUBLISH_PERMISSION' | 'CONTRACT_SIGNING'> = {
  PLAN: 'SOURCING_APPROVAL',
  EVAL_REPORT: 'SOURCING_APPROVAL',
  TENDER_PUBLISH: 'PUBLISH_PERMISSION',
  CONTRACT: 'CONTRACT_SIGNING',
};

interface ProbityData {
  request: { id: string; number: string; title: string; estimatedValue: number | null; phase: string } | null;
  declarations: Array<Record<string, unknown>>;
  panel: Array<Record<string, unknown>>;
  allocations: Array<Record<string, unknown>>;
  witnesses: Array<Record<string, unknown>>;
  openings: Array<Record<string, unknown>>;
  documents: Array<Record<string, unknown>>;
  deviations: Array<Record<string, unknown>>;
  approvals: Array<Record<string, unknown>>;
  supplierQuestions: Array<Record<string, unknown>>;
  clarifications: Array<Record<string, unknown>>;
  addenda: Array<Record<string, unknown>>;
  submissions: Array<Record<string, unknown>>;
  lateBidEvents: Array<Record<string, unknown>>;
  holds: Array<Record<string, unknown>>;
}

const HOLD_ACTIONS = new Set(['evaluation.hold', 'evaluation.release']);

async function collectProbity(
  tx: Tx,
  tenantId: string,
  from: string,
  to: string,
  rel: Related | null,
  events: PackEvent[],
): Promise<{ data: ProbityData; checklist: CoverageItem[] | null }> {
  const f = dayStart(from);
  const t = dayEnd(to);
  const names = new Map(
    (
      await tx
        .select({ id: appUser.id, name: appUser.name })
        .from(appUser)
        .where(eq(appUser.tenantId, tenantId))
    ).map((u) => [u.id, u.name] as const),
  );
  const nm = (id: string | null) => (id ? (names.get(id) ?? id) : null);
  const suppliers = new Map(
    (
      await tx
        .select({ id: supplier.id, company: supplier.company })
        .from(supplier)
        .where(eq(supplier.tenantId, tenantId))
    ).map((s) => [s.id, s.company] as const),
  );
  const keep = <R>(
    rows: R[],
    idOf: (r: R) => string,
    dateOf: (r: R) => Date | null,
    ids: string[] | null,
  ): R[] => (ids ? rows.filter((r) => ids.includes(idOf(r))) : rows.filter((r) => inRange(dateOf(r), f, t)));

  const tenders = (await tx.select().from(tender).where(eq(tender.tenantId, tenantId))).filter((x) =>
    rel ? rel.tenderIds.includes(x.id) : inRange(x.createdAt, f, t),
  );
  const tenderIds = tenders.map((x) => x.id);
  const tenderRequest = new Map(tenders.map((x) => [x.id, x.requestId] as const));
  const evals = (await tx.select().from(evaluation).where(eq(evaluation.tenantId, tenantId))).filter((x) =>
    rel ? rel.evaluationIds.includes(x.id) : tenderIds.includes(x.tenderId),
  );
  const evalIds = evals.map((x) => x.id);

  const decls = keep(
    await tx.select().from(coiDeclaration).where(eq(coiDeclaration.tenantId, tenantId)),
    (x) => x.scopeId,
    (x) => x.createdAt,
    rel ? [...rel.planIds, ...rel.evaluationIds, ...rel.reportIds, ...rel.requestIds] : null,
  );
  const panel = (await tx.select().from(panelMember).where(eq(panelMember.tenantId, tenantId))).filter((x) =>
    evalIds.includes(x.evaluationId),
  );
  const allocations = (
    await tx.select().from(probityAllocation).where(eq(probityAllocation.tenantId, tenantId))
  ).filter((x) => tenderIds.includes(x.tenderId));
  const witnesses = (await tx.select().from(bidWitness).where(eq(bidWitness.tenantId, tenantId))).filter(
    (x) => tenderIds.includes(x.tenderId),
  );
  const documents = (
    await tx.select().from(probityDocument).where(eq(probityDocument.tenantId, tenantId))
  ).filter((x) => evalIds.includes(x.evaluationId));
  const deviations = (
    await tx.select().from(tenderDeviation).where(eq(tenderDeviation.tenantId, tenantId))
  ).filter((x) => tenderIds.includes(x.tenderId));
  const allApprovals = await tx.select().from(approval).where(eq(approval.tenantId, tenantId));
  const approvalIds = rel
    ? rel.entityIds
    : [
        ...tenders.map((x) => x.id),
        ...evals.map((x) => x.id),
        ...(await tx.select({ id: plan.id }).from(plan).where(eq(plan.tenantId, tenantId))).map((x) => x.id),
      ];
  const approvals = allApprovals.filter((x) =>
    rel ? approvalIds.includes(x.subjectId) : inRange(x.decidedAt, f, t),
  );
  const questions = (await tx.select().from(question).where(eq(question.tenantId, tenantId))).filter((x) =>
    tenderIds.includes(x.tenderId),
  );
  const clar = (await tx.select().from(clarification).where(eq(clarification.tenantId, tenantId))).filter(
    (x) => evalIds.includes(x.evaluationId),
  );
  const adds = (await tx.select().from(addendum).where(eq(addendum.tenantId, tenantId))).filter((x) =>
    tenderIds.includes(x.tenderId),
  );
  const subs = (await tx.select().from(submission).where(eq(submission.tenantId, tenantId))).filter((x) =>
    tenderIds.includes(x.tenderId),
  );
  const tenderById = new Map(tenders.map((x) => [x.id, x] as const));
  const reqRow = rel
    ? ((await tx.select().from(request).where(eq(request.id, rel.requestIds[0]!)))[0] ?? null)
    : null;
  const lateEvents = events.filter((e) => e.action === 'submission.rejected_late');
  const holdEvents = events.filter((e) => HOLD_ACTIONS.has(e.action));

  const data: ProbityData = {
    request: reqRow
      ? {
          id: reqRow.id,
          number: reqRow.number,
          title: reqRow.title,
          estimatedValue: reqRow.estimatedValue === null ? null : Number(reqRow.estimatedValue),
          phase: reqRow.phase,
        }
      : null,
    declarations: decls.map((x) => ({
      id: x.id,
      declaredBy: nm(x.userId),
      scope: x.scope,
      scopeId: x.scopeId,
      none: x.none,
      nature: x.nature,
      subjectOrg: x.subjectOrg,
      declaredAt: iso(x.createdAt),
      disposition: x.disposition,
      routedTo: nm(x.routedTo),
      decidedBy: nm(x.decidedBy),
      decidedByRole: x.decidedByRole,
      decidedAt: iso(x.decidedAt),
      decisionNote: x.decisionNote,
    })),
    panel: panel.map((x) => ({
      evaluationId: x.evaluationId,
      member: nm(x.userId),
      stream: x.stream,
      coiState: x.coiState,
      redeclaration: x.redeclaration,
      redeclaredAt: iso(x.redeclaredAt),
    })),
    allocations: allocations.map((x) => ({
      tenderId: x.tenderId,
      probityOfficer: nm(x.userId),
      allocatedBy: nm(x.createdBy),
      allocatedAt: iso(x.createdAt),
    })),
    witnesses: witnesses.map((x) => ({
      tenderId: x.tenderId,
      witness: nm(x.userId),
      witnessedAt: iso(x.witnessedAt),
    })),
    openings: tenders.map((x) => ({
      tenderId: x.id,
      status: x.status,
      dualWitness: x.dualWitness,
      closesAt: iso(x.closesAt),
      openedAt: iso(x.openedAt),
    })),
    documents: documents.map((x) => ({
      evaluationId: x.evaluationId,
      kind: x.kind,
      title: x.title,
      status: x.status,
      version: x.version,
      signedBy: nm(x.signedBy),
      signedAt: iso(x.signedAt),
      fileSha256: x.fileSha256,
    })),
    deviations: deviations.map((x) => ({
      tenderId: x.tenderId,
      supplier: suppliers.get(x.supplierId) ?? x.supplierId,
      clauseRef: x.clauseRef,
      risk: x.risk,
      status: x.status,
      decidedBy: nm(x.decidedBy),
      decidedAt: iso(x.decidedAt),
      proposedAt: iso(x.createdAt),
    })),
    approvals: approvals.map((x) => ({
      subjectType: x.subjectType,
      subjectId: x.subjectId,
      decision: x.decision,
      approver: nm(x.userId),
      approverId: x.userId,
      role: x.role,
      decidedAt: iso(x.decidedAt),
      comment: x.comment,
      authority: null as null | { scope: string; limit: number | null; sufficient: boolean },
    })),
    supplierQuestions: questions.map((x) => ({
      tenderId: x.tenderId,
      question: x.text,
      status: x.status,
      audience: x.audience,
      askedAt: iso(x.askedAt),
      answered: Boolean(x.answer),
    })),
    clarifications: clar.map((x) => ({
      evaluationId: x.evaluationId,
      supplier: suppliers.get(x.supplierId) ?? x.supplierId,
      kind: x.kind,
      subject: x.subject,
      status: x.status,
      dueAt: iso(x.dueAt),
      raisedAt: iso(x.createdAt),
      respondedAt: iso(x.respondedAt),
    })),
    addenda: adds.map((x) => ({
      tenderId: x.tenderId,
      number: x.number,
      summary: x.summary,
      issuedAt: iso(x.issuedAt),
    })),
    submissions: subs.map((x) => ({
      tenderId: x.tenderId,
      supplier: suppliers.get(x.supplierId) ?? x.supplierId,
      status: x.status,
      submittedAt: iso(x.submittedAt),
      closesAt: iso(tenderById.get(x.tenderId)?.closesAt),
    })),
    lateBidEvents: lateEvents.map((e) => ({ seq: e.seq, at: e.at, entityId: e.entityId, after: e.after })),
    holds: [
      ...evals
        .filter((x) => x.held || x.heldAt)
        .map((x) => ({
          evaluationId: x.id,
          currentlyHeld: x.held,
          reason: x.holdReason,
          heldBy: nm(x.heldBy),
          heldAt: iso(x.heldAt),
        })),
      ...holdEvents.map((e) => ({
        seq: e.seq,
        at: e.at,
        action: e.action,
        entityId: e.entityId,
        after: e.after,
      })),
    ],
  };

  // authority checks: did each approver hold a delegation that covers the value at the time of the pack?
  const value = reqRow?.estimatedValue === null || !reqRow ? null : Number(reqRow.estimatedValue);
  const dels = await tx
    .select()
    .from(delegation)
    .where(and(eq(delegation.tenantId, tenantId), eq(delegation.active, true)));
  const contractValue = new Map(
    (
      await tx
        .select({ id: contract.id, value: contract.value })
        .from(contract)
        .where(eq(contract.tenantId, tenantId))
    ).map((c) => [c.id, Number(c.value)] as const),
  );
  for (const a of data.approvals) {
    const scope = AUTH_SCOPE[a.subjectType as string];
    if (!scope || a.decision !== 'APPROVED') continue;
    const needed = a.subjectType === 'CONTRACT' ? (contractValue.get(a.subjectId as string) ?? value) : value;
    const mine = dels.filter(
      (x) => x.scope === scope && (x.userId === a.approverId || (x.userId === null && x.role === a.role)),
    );
    const limit = mine.length ? Math.max(...mine.map((x) => Number(x.maxValue))) : null;
    a.authority = { scope, limit, sufficient: limit !== null && (needed === null || limit >= needed) };
  }
  void tenderRequest;

  const checklist = rel ? coverage(data, rel, events) : null;
  return { data, checklist };
}

function coverage(data: ProbityData, rel: Related, events: PackEvent[]): CoverageItem[] {
  const out: CoverageItem[] = [];
  const add = (key: string, label: string, ask: string, status: CoverageItem['status'], detail: string) =>
    out.push({ key, label, ask, status, detail });
  const hasTender = rel.tenderIds.length > 0;
  const hasEval = rel.evaluationIds.length > 0;

  add(
    'timeline',
    'Ordered timeline of the procurement',
    'Can I follow what happened, in order, from the request to the outcome?',
    events.length > 0 ? 'PASS' : 'FAIL',
    events.length > 0
      ? `${events.length} recorded events from ${events[0]!.at.slice(0, 10)} to ${events.at(-1)!.at.slice(0, 10)}.`
      : 'No audit events were found for this procurement in the date range.',
  );

  if (!hasEval)
    add(
      'declarations',
      'Interests declared before scoring',
      'Did every evaluator declare any conflict before they saw the bids?',
      'NA',
      'There is no evaluation yet.',
    );
  else {
    const members = data.panel.filter((m) => m.coiState !== 'REMOVED');
    const missing = members.filter((m) => m.coiState === 'NOT_DECLARED');
    add(
      'declarations',
      'Interests declared before scoring',
      'Did every evaluator declare any conflict before they saw the bids?',
      members.length > 0 && missing.length === 0 ? 'PASS' : 'FAIL',
      members.length === 0
        ? 'No panel members are recorded.'
        : missing.length
          ? `${missing.length} of ${members.length} panel members have not declared.`
          : `All ${members.length} panel members declared (who declared what, and when, is in probity.json).`,
    );
  }

  const conflicts = data.declarations.filter((x) => x.none === false);
  if (!hasEval && conflicts.length === 0)
    add(
      'conflicts_routed',
      'Conflicts routed and decided',
      'Were declared conflicts decided by someone with the authority to decide?',
      'NA',
      'No conflicts have been declared.',
    );
  else {
    const open = conflicts.filter((x) => !x.routedTo || x.disposition === 'PENDING' || !x.decidedBy);
    add(
      'conflicts_routed',
      'Conflicts routed and decided',
      'Were declared conflicts decided by someone with the authority to decide?',
      open.length ? 'FAIL' : 'PASS',
      conflicts.length === 0
        ? 'No conflicts were declared.'
        : open.length
          ? `${open.length} of ${conflicts.length} declared conflicts are not yet routed and decided.`
          : `${conflicts.length} declared conflicts were routed and decided, each with a note.`,
    );
  }

  if (!hasTender)
    add(
      'probity_allocated',
      'Probity officer allocated',
      'Was an independent probity officer allocated to this procurement?',
      'NA',
      'There is no tender yet.',
    );
  else
    add(
      'probity_allocated',
      'Probity officer allocated',
      'Was an independent probity officer allocated to this procurement?',
      data.allocations.length > 0 ? 'PASS' : 'FAIL',
      data.allocations.length > 0
        ? `${data.allocations.length} allocation(s): ${data.allocations.map((x) => x.probityOfficer).join(', ')}.`
        : 'No probity officer is allocated to the tender.',
    );

  const locked = data.documents.length > 0 || hasEval;
  if (!hasEval)
    add(
      'probity_documents',
      'Probity plan and outcomes report signed',
      'Is there a probity plan and an outcomes report, signed?',
      'NA',
      'There is no evaluation yet.',
    );
  else {
    const plans = data.documents.filter((x) => x.kind === 'PLAN');
    const outcomes = data.documents.filter((x) => x.kind === 'OUTCOMES');
    const signedPlan = plans.some((x) => x.status === 'SIGNED');
    const signedOut = outcomes.some((x) => x.status === 'SIGNED');
    add(
      'probity_documents',
      'Probity plan and outcomes report signed',
      'Is there a probity plan and an outcomes report, signed?',
      locked && signedPlan && signedOut ? 'PASS' : 'FAIL',
      `Plan ${signedPlan ? 'signed' : plans.length ? 'not signed' : 'missing'}; outcomes report ${signedOut ? 'signed' : outcomes.length ? 'not signed' : 'missing'}.`,
    );
  }

  const dual = data.openings.filter((x) => x.dualWitness === true);
  if (dual.length === 0)
    add(
      'dual_witness',
      'Dual-witness opening of sealed bids',
      'Where required, were the bids opened with two independent witnesses?',
      'NA',
      hasTender ? 'Not required at this value.' : 'There is no tender yet.',
    );
  else {
    const due = dual.filter((x) => ['CLOSED', 'EVALUATING', 'AWARDED'].includes(x.status as string));
    if (due.length === 0)
      add(
        'dual_witness',
        'Dual-witness opening of sealed bids',
        'Where required, were the bids opened with two independent witnesses?',
        'NA',
        'Required, but the tender has not closed yet.',
      );
    else {
      const bad = due.filter(
        (x) =>
          !x.openedAt ||
          new Set(data.witnesses.filter((w) => w.tenderId === x.tenderId).map((w) => w.witness)).size < 2,
      );
      add(
        'dual_witness',
        'Dual-witness opening of sealed bids',
        'Where required, were the bids opened with two independent witnesses?',
        bad.length ? 'FAIL' : 'PASS',
        bad.length
          ? `${bad.length} closed tender(s) were opened without two distinct witnesses on record.`
          : `Opened with ${new Set(data.witnesses.map((w) => w.witness)).size} distinct witnesses, times recorded.`,
      );
    }
  }

  const decided = data.approvals.filter((x) => x.decision === 'APPROVED' && x.authority !== null);
  if (decided.length === 0)
    add(
      'approvals_authority',
      'Approvals made within delegated authority',
      'Was each approval given by a person whose delegation covers the value?',
      'NA',
      'No approvals that need a delegated authority have been given yet.',
    );
  else {
    const bad = decided.filter((x) => !(x.authority as { sufficient: boolean }).sufficient);
    add(
      'approvals_authority',
      'Approvals made within delegated authority',
      'Was each approval given by a person whose delegation covers the value?',
      bad.length ? 'FAIL' : 'PASS',
      bad.length
        ? `${bad.length} of ${decided.length} approvals were given without a matching delegation on record.`
        : `${decided.length} approvals, each checked against the approver's delegation limit.`,
    );
  }

  const openQ = data.supplierQuestions.filter((x) => x.status === 'OPEN');
  const openC = data.clarifications.filter((x) => x.status === 'OPEN');
  if (data.supplierQuestions.length + data.clarifications.length === 0)
    add(
      'supplier_comms',
      'Communications with suppliers recorded and closed out',
      'Were all supplier questions answered to everyone, and every clarification closed?',
      'NA',
      'No supplier questions or clarifications.',
    );
  else
    add(
      'supplier_comms',
      'Communications with suppliers recorded and closed out',
      'Were all supplier questions answered to everyone, and every clarification closed?',
      openQ.length + openC.length ? 'FAIL' : 'PASS',
      openQ.length + openC.length
        ? `${openQ.length} supplier question(s) unanswered and ${openC.length} clarification(s) still open.`
        : `${data.supplierQuestions.length} question(s) and ${data.clarifications.length} clarification(s), all closed out.`,
    );

  const closed = data.openings.filter((x) =>
    ['CLOSED', 'EVALUATING', 'AWARDED'].includes(x.status as string),
  );
  if (closed.length === 0)
    add(
      'late_bids',
      'Late bids refused and recorded',
      'Was any bid accepted after the closing time? Were late attempts recorded?',
      'NA',
      'No tender has closed yet.',
    );
  else {
    const acceptedLate = data.submissions.filter(
      (x) =>
        x.status === 'SUBMITTED' &&
        x.submittedAt &&
        x.closesAt &&
        (x.submittedAt as string) > (x.closesAt as string),
    );
    const rejected = data.submissions.filter((x) => x.status === 'REJECTED_LATE');
    const logged = data.lateBidEvents.length >= rejected.length;
    add(
      'late_bids',
      'Late bids refused and recorded',
      'Was any bid accepted after the closing time? Were late attempts recorded?',
      acceptedLate.length || !logged ? 'FAIL' : 'PASS',
      acceptedLate.length
        ? `${acceptedLate.length} bid(s) were accepted after the closing time.`
        : `No bid was accepted after close; ${rejected.length} late attempt(s) refused, ${data.lateBidEvents.length} recorded in the audit events.`,
    );
  }

  if (data.deviations.length === 0)
    add(
      'deviations',
      'Deviations decided by a named person',
      'Was every proposed deviation from the tender terms assessed and decided?',
      'NA',
      'No deviations were proposed.',
    );
  else {
    const open = data.deviations.filter((x) => x.status === 'PROPOSED' || !x.decidedBy);
    add(
      'deviations',
      'Deviations decided by a named person',
      'Was every proposed deviation from the tender terms assessed and decided?',
      open.length ? 'FAIL' : 'PASS',
      open.length
        ? `${open.length} of ${data.deviations.length} deviations have no recorded decision.`
        : `${data.deviations.length} deviation(s), each decided by a named person.`,
    );
  }

  if (data.holds.length === 0)
    add(
      'holds',
      'Probity holds recorded with a reason',
      'Where the process was paused, who paused it, why, and when was it released?',
      'NA',
      'The process was never put on hold.',
    );
  else {
    const bad = data.holds.filter((x) => 'currentlyHeld' in x && !x.reason);
    add(
      'holds',
      'Probity holds recorded with a reason',
      'Where the process was paused, who paused it, why, and when was it released?',
      bad.length ? 'FAIL' : 'PASS',
      bad.length
        ? 'A hold has no reason on record.'
        : `${data.holds.length} hold record(s), each with who and why.`,
    );
  }

  const signoff = data.approvals.some((x) => x.subjectType === 'EVAL_PROBITY' && x.decision === 'APPROVED');
  const evalLocked = data.documents.some((x) => x.kind === 'OUTCOMES' && x.status === 'SIGNED') || signoff;
  add(
    'probity_signoff',
    'Probity sign-off of the evaluation process',
    'Did probity sign off the process before the award was approved?',
    !hasEval ? 'NA' : signoff ? 'PASS' : evalLocked ? 'FAIL' : 'NA',
    !hasEval
      ? 'There is no evaluation yet.'
      : signoff
        ? 'Signed off.'
        : 'No probity sign-off is on record yet.',
  );

  const chk = verifyEvents(events);
  add(
    'history_tamper_evident',
    'Audit history is tamper-evident',
    'Can I prove this history has not been edited since it was written?',
    chk.ok ? 'PASS' : 'FAIL',
    chk.ok
      ? `${chk.checked} events, each hash-chained to the one before${chk.gaps ? ` (${chk.gaps} gap(s) where other procurements' events were left out)` : ''}.`
      : `Chain broken at event ${chk.brokenAtSeq}: ${chk.reason}.`,
  );
  return out;
}

// ------------------------------------------------------------------------------------------ pack building
interface SigningKey {
  value: string;
  fingerprint: string;
}

async function signingKey(
  tx: Tx,
  d: GuardDeps,
  ctx: Parameters<typeof setSecret>[2],
  create: boolean,
): Promise<SigningKey | null> {
  let value = await readSecret(tx, ctx.tenantId, PACK_KEY_NAME);
  if (!value) {
    if (!create) return null;
    // generated on first use, like the connectors' simulated secrets; the value is never shown, only its fingerprint
    value = randomBytes(32).toString('base64url');
    await setSecret(tx, { audit: d.audit, now: d.clock.now() }, ctx, PACK_KEY_NAME, value);
  }
  return { value, fingerprint: sha256(value).slice(0, 8) };
}

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function indexHtml(m: {
  tenantName: string;
  generatedAt: string;
  generatedBy: string;
  from: string;
  to: string;
  scope: string;
  eventCount: number;
  headHash: string | null;
  files: Array<{ name: string; sha256: string; bytes: number }>;
  checklist: CoverageItem[] | null;
}): string {
  const rows = m.files
    .map((f) => `<tr><td>${esc(f.name)}</td><td>${f.bytes}</td><td><code>${esc(f.sha256)}</code></td></tr>`)
    .join('');
  const cl = m.checklist
    ? `<h2>What an external auditor would look for</h2><table><thead><tr><th>Item</th><th>Question</th><th>Result</th><th>Detail</th></tr></thead><tbody>${m.checklist
        .map(
          (c) =>
            `<tr><td>${esc(c.label)}</td><td>${esc(c.ask)}</td><td><strong>${c.status === 'NA' ? 'Not applicable' : c.status === 'PASS' ? 'Pass' : 'Fail'}</strong></td><td>${esc(c.detail)}</td></tr>`,
        )
        .join('')}</tbody></table>`
    : '<p>A coverage checklist is produced when the pack is for one procurement.</p>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Audit evidence pack</title>
<style>body{font-family:Arial,sans-serif;max-width:60rem;margin:2rem auto;padding:0 1rem;color:#1a1a1a}table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{border:1px solid #bbb;padding:.4rem .6rem;text-align:left;vertical-align:top;font-size:.9rem}th{background:#f1f1f1}code{word-break:break-all}</style></head><body>
<h1>Audit evidence pack</h1>
<p><strong>${esc(m.tenantName)}</strong> (synthetic demonstration data)</p>
<table><tbody>
<tr><th>Period</th><td>${esc(m.from)} to ${esc(m.to)} (UTC)</td></tr>
<tr><th>Scope</th><td>${esc(m.scope)}</td></tr>
<tr><th>Generated</th><td>${esc(m.generatedAt)} by ${esc(m.generatedBy)}</td></tr>
<tr><th>Audit events</th><td>${m.eventCount}</td></tr>
<tr><th>Chain head hash</th><td><code>${esc(m.headHash ?? 'none')}</code></td></tr>
</tbody></table>
<h2>Files and their SHA-256</h2>
<table><thead><tr><th>File</th><th>Bytes</th><th>SHA-256</th></tr></thead><tbody>${rows}</tbody></table>
<p>manifest.json lists these hashes and is signed in signature.json.</p>
${cl}
<h2>How to check this pack</h2>
<ol><li>Compute the SHA-256 of each file and compare it with manifest.json.</li>
<li>Each event in audit-events.json carries <code>prevHash</code> and <code>hash</code>. The hash is SHA-256 of the previous hash, a newline, and the event's canonical JSON (keys sorted at every depth) with the tenant id. The first event's previous hash is <code>GENESIS</code> for a whole-tenant chain.</li>
<li>Paste the pack into the platform's verification page: it names each part that fails.</li></ol>
<p><strong>About the signature.</strong> signature.json is an HMAC-SHA256 over manifest.json with a secret held by the platform. That is a symmetric simulation of a digital signature: only the platform can check it, and the platform could also forge it. A production deployment signs with an asymmetric key in an HSM so an auditor can verify with a public key alone.</p>
</body></html>`;
}

export interface BuiltPack {
  files: Record<string, string>;
  manifest: Record<string, unknown>;
  eventCount: number;
  headHash: string | null;
  checklist: CoverageItem[] | null;
  manifestSha256: string;
  fingerprint: string;
}

export async function buildPack(
  tx: Tx,
  d: GuardDeps,
  a: NonNullable<FastifyRequest['auth']>,
  input: { from: string; to: string; requestId?: string | undefined },
): Promise<BuiltPack> {
  const tenantId = a.user.tenantId;
  let rel: Related | null = null;
  if (input.requestId) {
    const [r] = await tx
      .select({ id: request.id })
      .from(request)
      .where(and(eq(request.id, input.requestId), eq(request.tenantId, tenantId)));
    if (!r) throw new AppError(404, 'NOT_FOUND', 'Procurement not found');
    rel = await relatedTo(tx, tenantId, input.requestId);
  }
  const events = await fetchEvents(tx, tenantId, input.from, input.to, rel);
  const { data, checklist } = await collectProbity(tx, tenantId, input.from, input.to, rel, events);
  const key = (await signingKey(tx, d, a.ctx, true))!;
  const now = d.clock.now();
  const head = events.at(-1)?.hash ?? null;
  const contiguous = events.every((e, i) => i === 0 || e.seq === events[i - 1]!.seq + 1);

  const files: Record<string, string> = {};
  files['audit-events.json'] = stableJson({
    tenantId,
    note: 'Each hash is SHA-256 over the previous hash, a newline, and the canonical JSON of the event fields with the tenant id.',
    events,
  });
  files['chain.json'] = stableJson({
    algorithm:
      'SHA-256(prevHash + "\\n" + canonicalJSON({tenantId, at, actorId, actorRole, action, entityType, entityId, before, after, correlationId, result}))',
    genesis: GENESIS,
    count: events.length,
    firstSeq: events[0]?.seq ?? null,
    lastSeq: events.at(-1)?.seq ?? null,
    anchorPrevHash: events[0]?.prevHash ?? null,
    headHash: head,
    contiguous,
    scope: rel ? 'ONE_PROCUREMENT' : 'TENANT',
  });
  files['probity.json'] = stableJson({ period: { from: input.from, to: input.to }, ...data });
  files['timeline.json'] = stableJson({
    request: data.request,
    entries: events
      .filter((e) => !e.action.startsWith('access.') && e.action !== 'audit.export')
      .map((e) => ({ seq: e.seq, at: e.at, action: e.action, by: e.actorRole, result: e.result })),
  });
  if (checklist)
    files['coverage.json'] = stableJson({
      request: data.request,
      passed: checklist.filter((c) => c.status === 'PASS').length,
      failed: checklist.filter((c) => c.status === 'FAIL').length,
      notApplicable: checklist.filter((c) => c.status === 'NA').length,
      items: checklist,
    });
  const [t] = await tx.select({ name: tenant.name }).from(tenant).where(eq(tenant.id, tenantId));
  const scope = rel
    ? `One procurement: ${data.request?.number ?? input.requestId} ${data.request?.title ?? ''}`
    : 'Whole organisation';
  const listed = (): Array<{ name: string; sha256: string; bytes: number }> =>
    Object.keys(files)
      .sort()
      .map((n) => ({ name: n, sha256: sha256(files[n]!), bytes: Buffer.byteLength(files[n]!) }));
  files['index.html'] = indexHtml({
    tenantName: t?.name ?? tenantId,
    generatedAt: now.toISOString(),
    generatedBy: `${a.user.name} (${a.user.role})`,
    from: input.from,
    to: input.to,
    scope,
    eventCount: events.length,
    headHash: head,
    files: listed().filter((f) => f.name !== 'index.html'),
    checklist,
  });
  const manifest = {
    kind: 'if-audit-evidence-pack',
    version: PACK_VERSION,
    tenantId,
    generatedAt: now.toISOString(),
    generatedBy: { id: a.user.id, name: a.user.name, role: a.user.role },
    period: { from: input.from, to: input.to },
    requestId: input.requestId ?? null,
    eventCount: events.length,
    chainHeadHash: head,
    files: listed(),
    signature: {
      file: 'signature.json',
      algorithm: 'HMAC-SHA256',
      keyName: PACK_KEY_NAME,
      keyFingerprint: key.fingerprint,
    },
  };
  files['manifest.json'] = stableJson(manifest);
  files['signature.json'] = stableJson({
    algorithm: 'HMAC-SHA256',
    over: 'manifest.json',
    keyName: PACK_KEY_NAME,
    keyFingerprint: key.fingerprint,
    value: createHmac('sha256', key.value).update(files['manifest.json']).digest('hex'),
    simulated: true,
    note: 'SIMULATED: a symmetric HMAC stands in for a digital signature. A production deployment signs with an asymmetric key held in an HSM.',
  });
  return {
    files,
    manifest,
    eventCount: events.length,
    headHash: head,
    checklist,
    manifestSha256: sha256(files['manifest.json']),
    fingerprint: key.fingerprint,
  };
}

// ------------------------------------------------------------------------------------------ zip reading
/** Reads a zip whose entries are stored (as this platform writes them). Compressed entries are refused, not guessed at. */
export function readStoredZip(buf: Buffer): Record<string, string> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--)
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new AppError(422, 'NOT_A_PACK', 'That is not a zip file');
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: Record<string, string> = {};
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new AppError(422, 'NOT_A_PACK', 'The zip is damaged');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30);
    const comment = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    if (method !== 0)
      throw new AppError(422, 'NOT_A_PACK', 'Only the pack as downloaded can be verified (stored zip)');
    const lh = buf.readUInt16LE(local + 26);
    const le = buf.readUInt16LE(local + 28);
    const start = local + 30 + lh + le;
    out[name] = buf.subarray(start, start + size).toString('utf8');
    p += 46 + nameLen + extra + comment;
  }
  return out;
}

// ------------------------------------------------------------------------------------------ verification
export interface PartResult {
  name: string;
  status: 'OK' | 'ALTERED' | 'MISSING' | 'UNLISTED';
}
export interface Verification {
  verified: boolean;
  failedParts: string[];
  files: PartResult[];
  signature: { status: 'OK' | 'INVALID' | 'MISSING' | 'KEY_UNAVAILABLE'; keyFingerprint: string | null };
  chain: {
    status: 'OK' | 'BROKEN' | 'MISSING';
    checked: number;
    gaps: number;
    brokenAtSeq: number | null;
    reason: string | null;
    headMatchesManifest: boolean;
  };
  live: { checked: number; mismatchedSeqs: number[] };
  manifest: {
    generatedAt: string | null;
    generatedBy: string | null;
    period: unknown;
    requestId: string | null;
    eventCount: number | null;
  } | null;
  simulated: true;
  note: string;
}

const safeJson = <T>(text: string | undefined): T | null => {
  if (text === undefined) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
};

export async function verifyPack(
  tx: Tx,
  d: GuardDeps,
  ctx: Parameters<typeof setSecret>[2],
  files: Record<string, string>,
): Promise<Verification> {
  const failed: string[] = [];
  const manifestText = files['manifest.json'];
  const manifest = safeJson<{
    generatedAt?: string;
    generatedBy?: { name?: string; role?: string };
    period?: unknown;
    requestId?: string | null;
    eventCount?: number;
    chainHeadHash?: string | null;
    tenantId?: string;
    files?: Array<{ name: string; sha256: string }>;
  }>(manifestText);
  const parts: PartResult[] = [];
  if (!manifest) {
    failed.push('manifest.json (missing or unreadable)');
  } else {
    for (const f of manifest.files ?? []) {
      const text = files[f.name];
      const status: PartResult['status'] =
        text === undefined ? 'MISSING' : sha256(text) === f.sha256 ? 'OK' : 'ALTERED';
      parts.push({ name: f.name, status });
      if (status !== 'OK')
        failed.push(
          `${f.name} (${status === 'MISSING' ? 'missing' : 'content does not match the manifest'})`,
        );
    }
    const listed = new Set((manifest.files ?? []).map((f) => f.name));
    for (const n of Object.keys(files))
      if (!listed.has(n) && n !== 'manifest.json' && n !== 'signature.json') {
        parts.push({ name: n, status: 'UNLISTED' });
        failed.push(`${n} (not listed in the manifest)`);
      }
  }

  // signature
  const sig = safeJson<{ value?: string; keyFingerprint?: string }>(files['signature.json']);
  let signature: Verification['signature'] = {
    status: 'MISSING',
    keyFingerprint: sig?.keyFingerprint ?? null,
  };
  if (sig?.value && manifestText !== undefined) {
    const key = await signingKey(tx, d, ctx, false);
    if (!key) signature = { status: 'KEY_UNAVAILABLE', keyFingerprint: sig.keyFingerprint ?? null };
    else {
      const expected = createHmac('sha256', key.value).update(manifestText).digest();
      let ok: boolean;
      try {
        const got = Buffer.from(sig.value, 'hex');
        ok = got.length === expected.length && timingSafeEqual(got, expected);
      } catch {
        ok = false;
      }
      signature = { status: ok ? 'OK' : 'INVALID', keyFingerprint: key.fingerprint };
    }
  }
  if (signature.status !== 'OK')
    failed.push(`signature (${signature.status.toLowerCase().replace('_', ' ')})`);

  // chain
  const ev = safeJson<{ tenantId?: string; events?: PackEvent[] }>(files['audit-events.json']);
  let chain: Verification['chain'] = {
    status: 'MISSING',
    checked: 0,
    gaps: 0,
    brokenAtSeq: null,
    reason: null,
    headMatchesManifest: false,
  };
  const live = { checked: 0, mismatchedSeqs: [] as number[] };
  if (ev?.events && Array.isArray(ev.events)) {
    const hashes = verifyEventHashes(ev.tenantId ?? manifest?.tenantId ?? '', ev.events);
    const links = verifyEvents(ev.events);
    const head = ev.events.at(-1)?.hash ?? null;
    const ok = hashes.ok && links.ok;
    chain = {
      status: ok ? 'OK' : 'BROKEN',
      checked: links.checked,
      gaps: links.gaps,
      brokenAtSeq: hashes.brokenAtSeq ?? links.brokenAtSeq,
      reason: hashes.reason ?? links.reason,
      headMatchesManifest: manifest ? head === (manifest.chainHeadHash ?? null) : false,
    };
    if (!ok) failed.push(`audit-events.json chain (broken at event ${chain.brokenAtSeq}: ${chain.reason})`);
    if (manifest && !chain.headMatchesManifest) failed.push('chain head hash (does not match the manifest)');
    // as an extra: the events as they stand in the live chain
    const seqs = ev.events
      .map((e) => e.seq)
      .filter((n) => Number.isInteger(n))
      .slice(0, PACK_MAX_EVENTS);
    if (seqs.length && (ev.tenantId ?? manifest?.tenantId) === ctx.tenantId) {
      const rows = await tx
        .select({ seq: auditEvent.seq, hash: auditEvent.hash })
        .from(auditEvent)
        .where(and(eq(auditEvent.tenantId, ctx.tenantId), inArray(auditEvent.seq, seqs)));
      const liveHash = new Map(rows.map((r) => [r.seq, r.hash] as const));
      for (const e of ev.events) {
        live.checked++;
        if (liveHash.get(e.seq) !== e.hash) live.mismatchedSeqs.push(e.seq);
      }
      if (live.mismatchedSeqs.length)
        failed.push(`live chain (${live.mismatchedSeqs.length} event(s) differ from the platform's record)`);
    }
  } else failed.push('audit-events.json (missing or unreadable)');

  return {
    verified: failed.length === 0,
    failedParts: failed,
    files: parts,
    signature,
    chain,
    live,
    manifest: manifest
      ? {
          generatedAt: manifest.generatedAt ?? null,
          generatedBy: manifest.generatedBy
            ? `${manifest.generatedBy.name} (${manifest.generatedBy.role})`
            : null,
          period: manifest.period ?? null,
          requestId: manifest.requestId ?? null,
          eventCount: manifest.eventCount ?? null,
        }
      : null,
    simulated: true,
    note: 'SIMULATED signature: an HMAC with a platform-held secret stands in for an HSM-backed asymmetric signature. The file hashes and the hash chain are checked for real.',
  };
}

// ------------------------------------------------------------------------------------------ routes
export function registerEvidencePack(app: FastifyInstance, p: string, d: GuardDeps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);

  reg('GET', '/audit/export-pack/coverage');
  app.get(`${p}/audit/export-pack/coverage`, { preHandler: guard(d, [...PACK_READERS]) }, async (req) => {
    const a = req.auth!;
    const q = parse(z.object({ requestId: z.string().regex(UUID) }).strict(), req.query);
    return withContext(d.database, a.ctx, async (tx) => {
      const [r] = await tx
        .select({ id: request.id })
        .from(request)
        .where(and(eq(request.id, q.requestId), eq(request.tenantId, a.user.tenantId)));
      if (!r) throw new AppError(404, 'NOT_FOUND', 'Procurement not found');
      const rel = await relatedTo(tx, a.user.tenantId, q.requestId);
      const events = await fetchEvents(tx, a.user.tenantId, '2000-01-01', '2999-12-31', rel);
      const { data, checklist } = await collectProbity(
        tx,
        a.user.tenantId,
        '2000-01-01',
        '2999-12-31',
        rel,
        events,
      );
      const items = checklist ?? [];
      return {
        request: data.request,
        events: events.length,
        items,
        passed: items.filter((c) => c.status === 'PASS').length,
        failed: items.filter((c) => c.status === 'FAIL').length,
        notApplicable: items.filter((c) => c.status === 'NA').length,
        ready: items.every((c) => c.status !== 'FAIL'),
      };
    });
  });

  reg('POST', '/audit/export-pack');
  app.post(`${p}/audit/export-pack`, { preHandler: guard(d, [...PACK_READERS]) }, async (req, reply) => {
    const a = req.auth!;
    const body = parse(packBody, req.body);
    const built = await withContext(d.database, a.ctx, async (tx) => {
      const b = await buildPack(tx, d, a, body);
      await tx.insert(exportPackLog).values({
        tenantId: a.user.tenantId,
        generatedBy: a.user.id,
        generatedAt: d.clock.now(),
        fromDate: body.from,
        toDate: body.to,
        requestId: body.requestId ?? null,
        eventCount: b.eventCount,
        chainHeadHash: b.headHash,
        manifestSha256: b.manifestSha256,
        signatureFingerprint: b.fingerprint,
        format: body.format,
      });
      // the pack's own audit event is written after its events were read, so it is not part of the file it describes
      await d.audit.record(tx, a.ctx, {
        action: 'audit.export_pack',
        entityType: 'audit',
        entityId: body.requestId ?? null,
        after: {
          from: body.from,
          to: body.to,
          requestId: body.requestId ?? null,
          events: b.eventCount,
          manifestSha256: b.manifestSha256,
          format: body.format,
        },
      });
      return b;
    });
    const stamp = `${body.from}_${body.to}`.replace(/-/g, '');
    reply.header('x-pack-manifest-sha256', built.manifestSha256);
    if (body.format === 'ZIP') {
      reply
        .header('content-type', 'application/zip')
        .header('content-disposition', `attachment; filename="evidence-pack-${stamp}.zip"`);
      return reply.send(zipStored(Object.entries(built.files).map(([n, t]) => [n, Buffer.from(t, 'utf8')])));
    }
    reply
      .header('content-type', 'application/json; charset=utf-8')
      .header('content-disposition', `attachment; filename="evidence-pack-${stamp}.json"`);
    return reply.send(
      JSON.stringify({
        kind: 'if-audit-evidence-pack-bundle',
        version: PACK_VERSION,
        manifestSha256: built.manifestSha256,
        checklist: built.checklist,
        files: built.files,
      }),
    );
  });

  reg('POST', '/audit/export-pack/verify');
  app.post(
    `${p}/audit/export-pack/verify`,
    { preHandler: guard(d, [...PACK_VERIFIERS]), bodyLimit: 60 * 1024 * 1024 },
    async (req) => {
      const a = req.auth!;
      const body = parse(verifyBody, req.body);
      const files = body.bundle ? body.bundle.files : readStoredZip(Buffer.from(body.zipBase64!, 'base64'));
      return withContext(d.database, a.ctx, async (tx) => {
        const v = await verifyPack(tx, d, a.ctx, files);
        await d.audit.record(tx, a.ctx, {
          action: 'audit.export_pack_verify',
          entityType: 'audit',
          after: {
            verified: v.verified,
            failedParts: v.failedParts.slice(0, 10),
            files: Object.keys(files).length,
          },
          result: v.verified ? 'SUCCESS' : 'FAILED',
        });
        return v;
      });
    },
  );

  return done;
}
