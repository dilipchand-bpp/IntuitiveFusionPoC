/**
 * Contract award and legal, roadmap batch B4: database helpers shared by the contract routes. The checks recorded
 * against a contract, the endorsements and signing invitations, who may sign now, and time-bound access grants.
 */
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { RoleName } from '@if/shared';
import type { VendorRegistry } from '../../adapters/vendor-registry.js';
import { insuranceVia } from '../b10conn/screening.js';
import type { SanctionsScreening } from '../../adapters/sanctions.js';
import type { AuthContext } from '../../auth/guard.js';
import type { Database, Tx } from '../../db/client.js';
import { withSystem } from '../../db/client.js';
import {
  accessGrant,
  appUser,
  approval,
  bafoOffer,
  bafoRound,
  bidPricing,
  clause,
  contract,
  contractCheck,
  contractEndorsement,
  contractQuestion,
  contractRiskSummary,
  evalReport,
  evaluation,
  notification,
  request,
  roleAssignment,
  signingInvitation,
  submission,
  supplier,
  tender,
  tenderDeviation,
} from '../../db/schema.js';
import { sendEmail } from '../notify/email.js';
import { loadSettings } from '../settings/settings.js';
import {
  grantStatus,
  isProtected,
  negotiationLock,
  stagedBlocker,
  tenderConsistency,
  vendorPreflight,
  type CheckResult,
} from './b4-rules.js';
import { daysBetween } from './dates.js';

type ContractRow = typeof contract.$inferSelect;
export type CheckKind = 'TENDER_CONSISTENCY' | 'VENDOR_PREFLIGHT' | 'RECHECK';

// ------------------------------------------------------------------ checks recorded against a contract
async function store(tx: Tx, c: ContractRow, kind: CheckKind, results: CheckResult[], now: Date) {
  const prior = await tx
    .select()
    .from(contractCheck)
    .where(and(eq(contractCheck.contractId, c.id), eq(contractCheck.kind, kind)));
  for (const r of results) {
    const was = prior.find((p) => p.checkKey === r.key);
    // a failure someone already reviewed stays reviewed while the finding is the same
    const result: 'PASS' | 'WARN' | 'FAIL' | 'REVIEWED' =
      was?.result === 'REVIEWED' && r.result !== 'PASS' && was.detail === r.detail ? 'REVIEWED' : r.result;
    const values = { result, detail: r.detail, createdAt: now };
    if (was) {
      await tx
        .update(contractCheck)
        .set(
          result === 'REVIEWED'
            ? { createdAt: now }
            : { ...values, reviewedBy: null, reviewNote: null, reviewedAt: null },
        )
        .where(eq(contractCheck.id, was.id));
    } else
      await tx.insert(contractCheck).values({
        tenantId: c.tenantId,
        contractId: c.id,
        kind,
        checkKey: r.key,
        ...values,
      });
  }
}

export async function runTenderChecks(tx: Tx, c: ContractRow, now: Date): Promise<CheckResult[]> {
  if (!c.tenderId || c.docType !== 'CONTRACT') return [];
  const [t] = await tx.select().from(tender).where(eq(tender.id, c.tenderId));
  const [req] = t ? await tx.select().from(request).where(eq(request.id, t.requestId)) : [];
  const [sub] = await tx
    .select()
    .from(submission)
    .where(and(eq(submission.tenderId, c.tenderId), eq(submission.supplierId, c.supplierId)));
  let tco: number | null = null;
  if (sub) {
    const [p] = await tx.select().from(bidPricing).where(eq(bidPricing.submissionId, sub.id));
    if (p) tco = Number(p.tco);
  }
  const [ev] = await tx.select().from(evaluation).where(eq(evaluation.tenderId, c.tenderId));
  if (ev) {
    const rounds = await tx.select().from(bafoRound).where(eq(bafoRound.evaluationId, ev.id));
    if (rounds.length) {
      const offers = await tx
        .select()
        .from(bafoOffer)
        .where(
          and(
            inArray(
              bafoOffer.roundId,
              rounds.map((r) => r.id),
            ),
            eq(bafoOffer.supplierId, c.supplierId),
            eq(bafoOffer.accepted, true),
          ),
        )
        .orderBy(asc(bafoOffer.submittedAt));
      const last = offers.at(-1);
      if (last) tco = Number(last.tco);
    }
  }
  const devs = await tx
    .select()
    .from(tenderDeviation)
    .where(and(eq(tenderDeviation.tenderId, c.tenderId), eq(tenderDeviation.supplierId, c.supplierId)));
  const months = c.startDate && c.endDate ? Math.round(daysBetween(c.startDate, c.endDate) / 30.44) : null;
  const results = tenderConsistency({
    contractValue: Number(c.value),
    contractMonths: months,
    tenderedTco: tco,
    estimatedValue:
      req?.estimatedValue === null || req?.estimatedValue === undefined ? null : Number(req.estimatedValue),
    requestMonths: req?.termMonths ?? null,
    openNegotiations: devs.filter((x) => x.status === 'NEGOTIATE').map((x) => x.clauseRef),
  });
  await store(tx, c, 'TENDER_CONSISTENCY', results, now);
  return results;
}

export async function runPreflight(
  tx: Tx,
  c: ContractRow,
  registry: VendorRegistry,
  now: Date,
): Promise<CheckResult[]> {
  const [s] = await tx.select().from(supplier).where(eq(supplier.id, c.supplierId));
  if (!s) return [];
  const settings = await loadSettings(tx, c.tenantId);
  const reg = await registry.lookup(s.abn, s.company);
  const results = vendorPreflight({
    company: s.company,
    abn: s.abn,
    registry: reg,
    bank: (s.bank ?? null) as { bsb?: string; account?: string; accountName?: string } | null,
    requireBank: settings.contractRules.requireBankDetails,
  }).map((r) => ({ key: r.key, label: r.label, result: r.result, detail: r.detail }));
  await store(tx, c, 'VENDOR_PREFLIGHT', results, now);
  return results;
}

/** The counterparty checks that must be run again once a negotiation has gone on too long (FR-0440). */
export async function runRecheck(
  tx: Tx,
  c: ContractRow,
  sanctions: SanctionsScreening,
  registry: VendorRegistry,
  now: Date,
): Promise<CheckResult[]> {
  const [s] = await tx.select().from(supplier).where(eq(supplier.id, c.supplierId));
  if (!s) return [];
  const sc = await sanctions.screen({ company: s.company, abn: s.abn, tenantId: c.tenantId, tx });
  const insured = await insuranceVia(tx, { now: () => now }, c.tenantId, { company: s.company, abn: s.abn });
  const fr = await registry.financialRisk(s.abn, s.company);
  const results: CheckResult[] = [
    {
      key: 'SANCTIONS',
      label: 'Sanctions screening',
      // a screening that could not be made is a warning, never a pass (NFR-C05)
      result: sc.status === 'MATCH' ? 'FAIL' : sc.status === 'UNVERIFIED' ? 'WARN' : 'PASS',
      detail:
        sc.status === 'MATCH'
          ? `${sc.reason ?? 'The company matches a watchlist entry'}`
          : sc.status === 'UNVERIFIED'
            ? (sc.reason ?? 'UNVERIFIED (provider unavailable)')
            : 'No watchlist match',
    },
    {
      key: 'FINANCIAL_RISK',
      label: 'Financial risk',
      result: fr.level === 'HIGH' ? 'FAIL' : fr.level === 'MEDIUM' ? 'WARN' : 'PASS',
      detail: fr.reason,
    },
    {
      key: 'INSURANCE',
      label: 'Insurance',
      result:
        s.insuranceStatus === 'EXPIRED' ||
        insured.result.state === 'EXPIRED' ||
        insured.result.state === 'NOT_FOUND'
          ? 'FAIL'
          : insured.result.state === 'UNVERIFIED'
            ? 'WARN'
            : 'PASS',
      detail:
        s.insuranceStatus === 'EXPIRED'
          ? 'The insurance certificate has expired'
          : insured.result.state === 'UNVERIFIED'
            ? `Insurance is ${s.insuranceStatus.toLowerCase()} on record; ${insured.result.note}`
            : insured.result.state === 'VERIFIED'
              ? `Insurance is ${s.insuranceStatus.toLowerCase()}; the insurer confirms it`
              : insured.result.note,
    },
  ];
  await store(tx, c, 'RECHECK', results, now);
  await tx
    .update(supplier)
    .set({
      // an unverified screening leaves the supplier's status as it was; it is never turned into CLEAR
      ...(sc.status === 'UNVERIFIED' ? {} : { sanctionsStatus: sc.status === 'MATCH' ? 'MATCH' : 'CLEAR' }),
      lastCheckedAt: now,
    })
    .where(eq(supplier.id, s.id));
  return results;
}

export async function checkRows(tx: Tx, contractId: string) {
  const rows = await tx
    .select()
    .from(contractCheck)
    .where(eq(contractCheck.contractId, contractId))
    .orderBy(asc(contractCheck.checkKey));
  const label: Record<string, string> = {
    PRICE: 'Price against the tender',
    ESTIMATE: 'Value against the approved estimate',
    TERM: 'Term against the tender',
    TERMS: 'Terms the supplier proposed',
    LEGAL_NAME: 'Legal name and registration',
    TAX: 'Tax registration',
    BANK: 'Banking details',
    SANCTIONS: 'Sanctions screening',
    FINANCIAL_RISK: 'Financial risk',
    INSURANCE: 'Insurance',
  };
  return rows.map((r) => ({
    kind: r.kind,
    key: r.checkKey,
    label: label[r.checkKey] ?? r.checkKey,
    result: r.result,
    detail: r.detail,
    reviewNote: r.reviewNote ?? null,
    at: r.createdAt.toISOString(),
  }));
}

// ------------------------------------------------------------------ gates
/** The date of the last counterparty re-check that passed (none failed), if any. */
export async function lastRecheck(tx: Tx, contractId: string): Promise<Date | null> {
  const rows = await tx
    .select()
    .from(contractCheck)
    .where(and(eq(contractCheck.contractId, contractId), eq(contractCheck.kind, 'RECHECK')));
  if (rows.length === 0 || rows.some((r) => r.result === 'FAIL')) return null;
  return rows.reduce((m, r) => (r.createdAt > m ? r.createdAt : m), rows[0]!.createdAt);
}

export async function lockState(tx: Tx, c: ContractRow, now: Date) {
  const days = (await loadSettings(tx, c.tenantId)).contractRules.negotiationLockDays;
  const open = ['DRAFT', 'LEGAL_REVIEW', 'AWAITING_SIGNATURE', 'PARTIALLY_SIGNED'].includes(c.status);
  const s = negotiationLock({ startedAt: c.createdAt, recheckedAt: await lastRecheck(tx, c.id), now, days });
  return { ...s, limitDays: days, locked: open && s.locked };
}

/** Why nobody can sign this contract right now, or null: a long negotiation, a failed pre-flight, or the signing order. */
export async function signBlock(
  tx: Tx,
  c: ContractRow,
  chain: Array<{ role: string; signedBy: string | null }>,
  myRole: string | null,
  now: Date,
): Promise<{ code: string; message: string } | null> {
  const lock = await lockState(tx, c, now);
  if (lock.locked)
    return {
      code: 'NEGOTIATION_LOCKED',
      message: `Negotiation has run past ${lock.limitDays} days, so signing is locked until sanctions and financial risk are checked again`,
    };
  const fails = await tx
    .select()
    .from(contractCheck)
    .where(
      and(
        eq(contractCheck.contractId, c.id),
        eq(contractCheck.kind, 'VENDOR_PREFLIGHT'),
        eq(contractCheck.result, 'FAIL'),
      ),
    );
  if (fails.length)
    return {
      code: 'PREFLIGHT_FAILED',
      message: `The supplier checks failed (${fails.map((f) => f.detail).join('; ')}); legal must review them before signing`,
    };
  if (c.signingMode === 'STAGED' && myRole) {
    const b = stagedBlocker(chain, myRole);
    if (b) return { code: 'SIGNING_ORDER', message: b };
  }
  return null;
}

export async function endorsementState(tx: Tx, c: ContractRow) {
  const required = (await loadSettings(tx, c.tenantId)).contractRules.endorsements as string[];
  const done = await tx
    .select({ e: contractEndorsement, name: appUser.name })
    .from(contractEndorsement)
    .innerJoin(appUser, eq(appUser.id, contractEndorsement.userId))
    .where(eq(contractEndorsement.contractId, c.id));
  return {
    required,
    done: done.map((x) => ({
      role: x.e.role,
      by: x.name,
      at: x.e.decidedAt.toISOString(),
      comment: x.e.comment ?? null,
    })),
    missing: required.filter((r) => !done.some((x) => x.e.role === r)),
  };
}

/** Everything extra that stops a contract being released for signing (FR-0400, FR-0405, FR-0415, FR-0450, FR-0480). */
export async function releaseGate(
  tx: Tx,
  c: ContractRow,
  now: Date,
  registry: VendorRegistry,
): Promise<string[]> {
  const out: string[] = [];
  const settings = await loadSettings(tx, c.tenantId);
  if (c.docType === 'CONTRACT') {
    const tenderRes = await runTenderChecks(tx, c, now);
    void tenderRes;
    const fails = (await checkRows(tx, c.id)).filter(
      (x) => x.kind === 'TENDER_CONSISTENCY' && x.result === 'FAIL',
    );
    for (const f of fails)
      out.push(`Tender check "${f.label}" failed and has not been reviewed: ${f.detail}`);
  }
  const pre = await runPreflight(tx, c, registry, now);
  void pre;
  const preFails = (await checkRows(tx, c.id)).filter(
    (x) => x.kind === 'VENDOR_PREFLIGHT' && x.result === 'FAIL',
  );
  for (const f of preFails)
    out.push(`Supplier pre-flight "${f.label}" failed and has not been reviewed: ${f.detail}`);
  const e = await endorsementState(tx, c);
  for (const r of e.missing) out.push(`The ${r.toLowerCase()} endorsement is required before release`);
  if (settings.contractRules.requireRiskSummaryReview) {
    const [rs] = await tx.select().from(contractRiskSummary).where(eq(contractRiskSummary.contractId, c.id));
    if (!rs || !rs.reviewedAt) out.push('Legal must review the contract risk summary before release');
  }
  // a change to a non-negotiable clause needs General Counsel or the risk delegate, not an ordinary delegate (FR-0400)
  const changed = await tx
    .select()
    .from(clause)
    .where(and(eq(clause.contractId, c.id), eq(clause.changedFromTemplate, true)));
  for (const k of changed.filter((x) => isProtected(x.clauseId, settings.contractRules.protectedClauses))) {
    const rows = await tx
      .select()
      .from(approval)
      .where(and(eq(approval.subjectType, 'CONTRACT_DEVIATION'), eq(approval.subjectId, k.id)))
      .orderBy(desc(approval.decidedAt));
    const cur = rows.find((r) => r.decision !== 'SUPERSEDED');
    if (!cur || cur.decision !== 'APPROVED' || !['EXEC', 'PROBITY'].includes(cur.role))
      out.push(
        `"${k.title}" is a non-negotiable clause: the change needs approval from General Counsel or the risk delegate`,
      );
  }
  return out;
}

// ------------------------------------------------------------------ signing invitations (FR-0445)
export async function inviteSigners(tx: Tx, c: ContractRow, signerRoles: string[], title: string, now: Date) {
  const users = await tx
    .select({ u: appUser, role: roleAssignment.role })
    .from(roleAssignment)
    .innerJoin(appUser, eq(appUser.id, roleAssignment.userId))
    .where(
      and(
        eq(roleAssignment.tenantId, c.tenantId),
        inArray(roleAssignment.role, signerRoles as RoleName[]),
        eq(appUser.active, true),
      ),
    );
  await tx.delete(signingInvitation).where(eq(signingInvitation.contractId, c.id));
  for (const { u, role } of users) {
    await tx.insert(signingInvitation).values({
      tenantId: c.tenantId,
      contractId: c.id,
      userId: u.id,
      email: u.email,
      name: u.name,
      roleLabel: role,
      invitedAt: now,
    });
    await sendEmail(tx, {
      tenantId: c.tenantId,
      to: u.email,
      subject: `Contract ${c.number} is ready for your signature`,
      body: `Hello ${u.name}, ${title} is ready for you to review and sign. You can read the full contract and raise a question before you sign.`,
      kind: 'SIGNING_INVITATION',
      refType: 'contract',
      refId: c.id,
    });
  }
  // the supplier's contacts are invited to read the contract and raise questions (they do not sign for the customer)
  const contacts = await tx
    .select()
    .from(appUser)
    .where(and(eq(appUser.supplierId, c.supplierId), eq(appUser.active, true)));
  for (const u of contacts) {
    await tx.insert(signingInvitation).values({
      tenantId: c.tenantId,
      contractId: c.id,
      supplierId: c.supplierId,
      email: u.email,
      name: u.name,
      roleLabel: 'SUPPLIER',
      invitedAt: now,
    });
    await tx.insert(notification).values({
      tenantId: c.tenantId,
      userId: u.id,
      title: 'A contract is ready for your review',
      body: `${c.number}: you can read the full contract and ask questions before it is signed`,
      link: `/supplier/contracts/${c.id}`,
    });
    await sendEmail(tx, {
      tenantId: c.tenantId,
      to: u.email,
      subject: `Contract ${c.number} is ready for your review`,
      body: `Hello ${u.name}, ${title} is ready for you to read in the supplier portal. You can raise questions before it is signed.`,
      kind: 'SIGNING_INVITATION',
      refType: 'contract',
      refId: c.id,
    });
  }
}

/** Reminds each signatory who has not signed (the first reminder comes one period after the invitation). */
export async function remindUnsigned(
  tx: Tx,
  c: ContractRow,
  now: Date,
  onlyIfDue: boolean,
): Promise<string[]> {
  if (!['AWAITING_SIGNATURE', 'PARTIALLY_SIGNED'].includes(c.status)) return [];
  const hours = (await loadSettings(tx, c.tenantId)).contractRules.signingReminderHours;
  const signed = new Set(
    (
      await tx
        .select({ role: approval.role })
        .from(approval)
        .where(
          and(
            eq(approval.subjectType, 'CONTRACT'),
            eq(approval.subjectId, c.id),
            eq(approval.decision, 'APPROVED'),
          ),
        )
    ).map((x) => x.role),
  );
  const inv = await tx
    .select()
    .from(signingInvitation)
    .where(and(eq(signingInvitation.contractId, c.id), isNull(signingInvitation.supplierId)));
  const due = inv.filter(
    (i) =>
      !signed.has(i.roleLabel) &&
      (!onlyIfDue || now.getTime() - (i.remindedAt ?? i.invitedAt).getTime() >= hours * 3_600_000),
  );
  for (const i of due) {
    await tx
      .update(signingInvitation)
      .set({ remindedAt: now, reminderCount: i.reminderCount + 1 })
      .where(eq(signingInvitation.id, i.id));
    if (i.userId)
      await tx.insert(notification).values({
        tenantId: c.tenantId,
        userId: i.userId,
        title: 'Reminder: a contract is waiting for your signature',
        body: `${c.number}`,
        link: `/app/contracts/${c.id}`,
      });
    await sendEmail(tx, {
      tenantId: c.tenantId,
      to: i.email,
      subject: `Reminder: contract ${c.number} is waiting for your signature`,
      body: `Hello ${i.name}, the contract is still waiting for your signature.`,
      kind: 'SIGNING_REMINDER',
      refType: 'contract',
      refId: c.id,
    });
  }
  return due.map((i) => i.name);
}

export async function sweepSigningReminders(database: Database, now: Date) {
  await withSystem(database, async (tx) => {
    const open = await tx
      .select()
      .from(contract)
      .where(
        and(inArray(contract.status, ['AWAITING_SIGNATURE', 'PARTIALLY_SIGNED']), isNull(contract.deletedAt)),
      );
    for (const c of open) await remindUnsigned(tx, c, now, true);
  });
}

export async function openQuestionCount(tx: Tx, contractId: string): Promise<number> {
  const rows = await tx.select().from(contractQuestion).where(eq(contractQuestion.contractId, contractId));
  return rows.filter((q) => !q.answer).length;
}

// ------------------------------------------------------------------ time-bound access (FR-0435)
/** When the event a grant waits on happened for this tender, if it has. */
export async function eventAt(
  tx: Tx,
  tenderId: string,
  event: 'CONTRACT_SIGNED' | 'REPORT_APPROVED' | null,
): Promise<Date | null> {
  if (!event) return null;
  if (event === 'CONTRACT_SIGNED') {
    const [c] = await tx
      .select()
      .from(contract)
      .where(
        and(eq(contract.tenderId, tenderId), eq(contract.status, 'EXECUTED'), isNull(contract.deletedAt)),
      );
    if (!c) return null;
    const rows = await tx
      .select({ at: approval.decidedAt })
      .from(approval)
      .where(
        and(
          eq(approval.subjectType, 'CONTRACT'),
          eq(approval.subjectId, c.id),
          eq(approval.decision, 'APPROVED'),
        ),
      )
      .orderBy(desc(approval.decidedAt));
    return rows[0]?.at ?? c.updatedAt;
  }
  const [ev] = await tx.select().from(evaluation).where(eq(evaluation.tenderId, tenderId));
  if (!ev) return null;
  const [rep] = await tx.select().from(evalReport).where(eq(evalReport.evaluationId, ev.id));
  if (!rep || rep.status !== 'APPROVED') return null;
  const rows = await tx
    .select({ at: approval.decidedAt })
    .from(approval)
    .where(
      and(
        eq(approval.subjectType, 'EVAL_REPORT'),
        eq(approval.subjectId, rep.id),
        eq(approval.decision, 'APPROVED'),
      ),
    )
    .orderBy(desc(approval.decidedAt));
  return rows[0]?.at ?? null;
}

/**
 * Grants for one person with their status now. A grant whose end has passed is revoked on the spot and the revocation is
 * audited, so nobody has to run a job for access to stop.
 */
export async function grantsFor(
  tx: Tx,
  a: AuthContext,
  userId: string,
  now: Date,
  audit: { record: (tx: Tx, ctx: AuthContext['ctx'], e: Record<string, unknown>) => Promise<unknown> },
) {
  const rows = await tx
    .select()
    .from(accessGrant)
    .where(and(eq(accessGrant.tenantId, a.user.tenantId), eq(accessGrant.userId, userId)))
    .orderBy(desc(accessGrant.createdAt));
  const out = [];
  for (const g of rows) {
    const at = await eventAt(tx, g.tenderId, g.event);
    const st = grantStatus(
      { expiresOn: g.expiresOn, event: g.event, eventDays: g.eventDays, revokedAt: g.revokedAt },
      now,
      at,
    );
    if (!st.live && !g.revokedAt) {
      await tx
        .update(accessGrant)
        .set({
          revokedAt: st.endsAt ?? now,
          revokedReason: st.reason === 'EVENT' ? 'The event it waited on passed' : 'The expiry date passed',
        })
        .where(eq(accessGrant.id, g.id));
      await audit.record(tx, a.ctx, {
        action: 'access.grant_expired',
        entityType: 'access_grant',
        entityId: g.id,
        after: { userId: g.userId, tenderId: g.tenderId, reason: st.reason },
      });
    }
    out.push({ g, ...st });
  }
  return out;
}
