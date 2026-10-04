/**
 * Evaluation, roadmap batch B3: shared database helpers for the compliance gate, bid pricing and best-and-final offers,
 * earlier stages, conflict re-declaration and the probity advisor's allocation.
 */
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import type { Tx } from '../../db/client.js';
import {
  appUser,
  bafoOffer,
  bafoRound,
  bidPricing,
  clarification,
  complianceCheck,
  consensusItem,
  delegation,
  evaluation,
  fileObject,
  notification,
  probityAllocation,
  roleAssignment,
  supplier,
  tender,
} from '../../db/schema.js';
import { sendEmail } from '../notify/email.js';
import { loadSettings } from '../settings/settings.js';
import { GATE_LABELS, normaliseTco, runGate, type GateResult } from './commercial.js';
import { atLeast, type EvaluationService, type Loaded } from './service.js';

export interface RankExtras {
  /** Suppliers with a compliance check that failed and was not waived. */
  gateFailed: ReadonlySet<string>;
  gateRun: boolean;
  tco: ReadonlyMap<string, number | null>;
  priceScore: ReadonlyMap<string, number | null>;
}

const num = (v: string | number | null | undefined) => (v === null || v === undefined ? null : Number(v));

/** Total cost of ownership per bidder: their bid pricing, replaced by an accepted best-and-final offer where there is one. */
export async function tcoFor(tx: Tx, l: Loaded): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>(l.bidders.map((b) => [b.supplierId, null]));
  if (l.bidders.length === 0) return out;
  const priced = await tx
    .select({ sub: bidPricing.submissionId, tco: bidPricing.tco })
    .from(bidPricing)
    .where(
      inArray(
        bidPricing.submissionId,
        l.bidders.map((b) => b.submissionId),
      ),
    );
  for (const b of l.bidders) {
    const p = priced.find((x) => x.sub === b.submissionId);
    if (p) out.set(b.supplierId, num(p.tco));
  }
  const rounds = await tx.select().from(bafoRound).where(eq(bafoRound.evaluationId, l.ev.id));
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
          eq(bafoOffer.accepted, true),
        ),
      )
      .orderBy(asc(bafoOffer.submittedAt));
    for (const o of offers) out.set(o.supplierId, num(o.tco)); // the latest accepted offer stands
  }
  return out;
}

export async function loadExtras(tx: Tx, l: Loaded): Promise<RankExtras> {
  const checks = await tx.select().from(complianceCheck).where(eq(complianceCheck.evaluationId, l.ev.id));
  const tco = await tcoFor(tx, l);
  return {
    gateFailed: new Set(checks.filter((c) => c.result === 'FAIL').map((c) => c.supplierId)),
    gateRun: checks.length > 0,
    tco,
    priceScore: normaliseTco(tco),
  };
}

/**
 * Runs the mandatory compliance gate for every bidder and records one row per check (FR-0265). A check a person has
 * waived stays waived when the gate is run again; a failed one that now passes becomes a pass. Each newly failing check
 * gets one automated clarification request to the supplier, with the standard response period.
 */
export async function runComplianceGate(
  tx: Tx,
  l: Loaded,
  now: Date,
  actorId: string | null,
): Promise<{ failed: number; requests: Array<{ supplierId: string; subject: string; question: string }> }> {
  const settings = await loadSettings(tx, l.ev.tenantId);
  const existing = await tx.select().from(complianceCheck).where(eq(complianceCheck.evaluationId, l.ev.id));
  const requests: Array<{ supplierId: string; subject: string; question: string }> = [];
  let failed = 0;
  for (const b of l.bidders) {
    const [s] = await tx.select().from(supplier).where(eq(supplier.id, b.supplierId));
    if (!s) continue;
    const [files] = await tx
      .select({ n: count() })
      .from(fileObject)
      .where(eq(fileObject.submissionId, b.submissionId));
    const onboarding = (s.onboarding ?? {}) as { flagged?: string[] };
    const results = runGate({
      abn: s.abn,
      sanctionsStatus: s.sanctionsStatus,
      insuranceStatus: s.insuranceStatus,
      flaggedAnswers: onboarding.flagged ?? [],
      fileCount: Number(files?.n ?? 0),
      requireInsurance: settings.evaluationRules.requireInsurance,
    });
    for (const r of results) {
      const prior = existing.find((e) => e.supplierId === b.supplierId && e.checkKey === r.key);
      if (prior?.result === 'WAIVED') continue;
      if (r.result === 'FAIL') failed++;
      if (prior) {
        await tx
          .update(complianceCheck)
          .set({ result: r.result, detail: r.detail })
          .where(eq(complianceCheck.id, prior.id));
      } else {
        await tx.insert(complianceCheck).values({
          tenantId: l.ev.tenantId,
          evaluationId: l.ev.id,
          supplierId: b.supplierId,
          checkKey: r.key,
          result: r.result,
          detail: r.detail,
          createdAt: now,
        });
      }
      if (r.result === 'FAIL' && prior?.result !== 'FAIL') {
        const days = settings.evaluationRules.clarificationDays;
        const question = `${r.label}: ${r.detail}. Please provide what is needed, or explain, within ${days} days.`;
        await tx.insert(clarification).values({
          tenantId: l.ev.tenantId,
          evaluationId: l.ev.id,
          supplierId: b.supplierId,
          kind: 'COMPLIANCE',
          subject: `Compliance: ${r.label}`,
          question,
          checkKey: r.key,
          dueAt: new Date(now.getTime() + days * 86_400_000),
          createdBy: actorId,
          createdAt: now,
        });
        requests.push({ supplierId: b.supplierId, subject: `Compliance: ${r.label}`, question });
      }
    }
  }
  return { failed, requests };
}

export type GateRow = {
  supplierId: string;
  key: GateResult['key'];
  label: string;
  result: 'PASS' | 'FAIL' | 'WAIVED';
  detail: string;
  note: string | null;
};
export async function gateRows(tx: Tx, evaluationId: string): Promise<GateRow[]> {
  const rows = await tx.select().from(complianceCheck).where(eq(complianceCheck.evaluationId, evaluationId));
  return rows.map((r) => ({
    supplierId: r.supplierId,
    key: r.checkKey as GateResult['key'],
    label: GATE_LABELS[r.checkKey as GateResult['key']] ?? r.checkKey,
    result: r.result,
    detail: r.detail,
    note: r.decidedNote ?? null,
  }));
}

/** Earlier stages of a multi-stage tender, oldest first, with each stage's ranking and who went through (FR-0285, FR-0360). */
export async function previousStages(tx: Tx, l: Loaded, svc: EvaluationService) {
  const out: Array<{
    stage: number;
    tenderId: string;
    evaluationId: string | null;
    status: string | null;
    suppliers: Array<{
      displayName: string;
      rank: number | null;
      weightedScore: number;
      shortlisted: boolean;
    }>;
  }> = [];
  let parentId = l.tender.parentTenderId;
  const chain: Array<typeof tender.$inferSelect> = [];
  while (parentId) {
    const [t] = await tx.select().from(tender).where(eq(tender.id, parentId));
    if (!t) break;
    chain.unshift(t);
    parentId = t.parentTenderId;
  }
  for (const t of chain) {
    const [ev] = await tx.select().from(evaluation).where(eq(evaluation.tenderId, t.id));
    let suppliers: (typeof out)[number]['suppliers'] = [];
    if (ev && atLeast(ev.status, 'LOCKED')) {
      const lo = await svc.load(tx, ev.tenantId, ev.id);
      if (lo) {
        const items = await tx.select().from(consensusItem).where(eq(consensusItem.evaluationId, ev.id));
        const extras = await loadExtras(tx, lo);
        const ranking = await svc.ranking(lo, items, extras);
        const through = new Set(((t.shortlist ?? []) as string[]).map(String));
        suppliers = ranking.map((r) => ({
          displayName: r.displayName,
          rank: r.rank,
          weightedScore: r.weightedScore,
          shortlisted: through.has(r.supplierId),
        }));
      }
    }
    out.push({
      stage: t.stage,
      tenderId: t.id,
      evaluationId: ev?.id ?? null,
      status: ev?.status ?? null,
      suppliers,
    });
  }
  return out;
}

/** Tenders an external probity advisor is allocated to; `null` means the person is not scoped (an internal officer). */
export async function allocatedTenders(
  tx: Tx,
  tenantId: string,
  user: { id: string; external: boolean },
): Promise<Set<string> | null> {
  if (!user.external) return null;
  const rows = await tx
    .select({ t: probityAllocation.tenderId })
    .from(probityAllocation)
    .where(and(eq(probityAllocation.tenantId, tenantId), eq(probityAllocation.userId, user.id)));
  return new Set(rows.map((r) => r.t));
}

/**
 * Who a report is routed to for approval (FR-0375): the holders of the lowest sourcing authority that covers the value,
 * so a small award is not sent to the most senior person. Empty when nobody holds enough authority.
 */
export async function routeApproval(
  tx: Tx,
  tenantId: string,
  value: number,
): Promise<{ userIds: string[]; tierLimit: number | null }> {
  const rows = await tx
    .select()
    .from(delegation)
    .where(
      and(
        eq(delegation.tenantId, tenantId),
        eq(delegation.scope, 'SOURCING_APPROVAL'),
        eq(delegation.active, true),
      ),
    );
  const roles = await tx
    .select({ userId: roleAssignment.userId, role: roleAssignment.role })
    .from(roleAssignment)
    .where(eq(roleAssignment.tenantId, tenantId));
  const best = new Map<string, number>();
  for (const r of rows) {
    const users = r.userId ? [r.userId] : roles.filter((x) => x.role === r.role).map((x) => x.userId);
    for (const u of users) best.set(u, Math.max(best.get(u) ?? 0, Number(r.maxValue)));
  }
  const ok = [...best].filter(([, limit]) => limit >= value);
  if (ok.length === 0) return { userIds: [], tierLimit: null };
  const tier = Math.min(...ok.map(([, limit]) => limit));
  return { userIds: ok.filter(([, limit]) => limit === tier).map(([u]) => u), tierLimit: tier };
}

/** Tells a supplier's signed-in contacts in the app and by (simulated) email. The message never carries a link with a token. */
export async function noticeToSupplier(
  tx: Tx,
  tenantId: string,
  supplierId: string,
  m: { title: string; body: string; link: string; kind: 'CLARIFICATION' | 'BAFO'; refId?: string },
): Promise<number> {
  const contacts = await tx
    .select()
    .from(appUser)
    .where(and(eq(appUser.supplierId, supplierId), eq(appUser.active, true)));
  for (const u of contacts) {
    await tx
      .insert(notification)
      .values({ tenantId, userId: u.id, title: m.title, body: m.body, link: m.link });
    await sendEmail(tx, {
      tenantId,
      to: u.email,
      subject: m.title,
      body: `Hello ${u.name}, ${m.body} Sign in to the supplier portal to respond.`,
      kind: m.kind,
      ...(m.refId ? { refType: 'evaluation', refId: m.refId } : {}),
    });
  }
  return contacts.length;
}
