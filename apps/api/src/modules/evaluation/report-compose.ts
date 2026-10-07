/**
 * Compiles the sourcing recommendation report from a locked evaluation (FR-0350): compliance log, scoring spread,
 * panel justifications, total cost of ownership and the value-for-money recommendation. Reads as the system (the
 * evaluators' comments are readable by the chair and probity only), so callers must already have checked who may ask.
 */
import { sealField } from '../b11enc/projects.js';
import { and, eq, inArray } from 'drizzle-orm';
import type { Tx } from '../../db/client.js';
import {
  appUser,
  bafoOffer,
  bafoRound,
  clarification,
  coiDeclaration,
  consensusItem,
  evalReport,
  evaluation,
  fieldValue,
  panelSubstitution,
  score,
  tender,
} from '../../db/schema.js';
import { gateRows, loadExtras, previousStages } from './b3-service.js';
import { REPORT_SECTIONS, buildReport } from './report.js';
import type { EvaluationService, Loaded } from './service.js';

export async function composeReport(
  tx: Tx,
  svc: EvaluationService,
  l: Loaded,
  now: Date,
): Promise<Record<string, string>> {
  const items = await tx.select().from(consensusItem).where(eq(consensusItem.evaluationId, l.ev.id));
  const scores = await tx.select().from(score).where(eq(score.evaluationId, l.ev.id));
  const decl = await tx
    .select()
    .from(coiDeclaration)
    .where(
      and(
        eq(coiDeclaration.scope, 'EVALUATION'),
        eq(coiDeclaration.scopeId, l.ev.id),
        eq(coiDeclaration.none, false),
      ),
    );
  const conflictUsers = new Set(decl.map((x) => x.userId));
  const locked = { ...l, ev: { ...l.ev, status: 'LOCKED' as const } };
  const extras = await loadExtras(tx, locked);
  const ranking = await svc.ranking(locked, items, extras);
  const gate = await gateRows(tx, l.ev.id);
  const stages = await previousStages(tx, locked, svc);
  const departed = new Set(l.panel.filter((m) => m.coiState === 'REMOVED').map((m) => m.userId));

  const subs = await tx.select().from(panelSubstitution).where(eq(panelSubstitution.evaluationId, l.ev.id));
  const names = new Map(l.panel.map((m) => [m.userId, m.name] as const));
  const missingNames = [...new Set(subs.flatMap((x) => [x.departingUserId, x.incomingUserId]))].filter(
    (u) => !names.has(u),
  );
  if (missingNames.length)
    for (const u of await tx
      .select({ id: appUser.id, name: appUser.name })
      .from(appUser)
      .where(inArray(appUser.id, missingNames)))
      names.set(u.id, u.name);

  const clar = await tx.select().from(clarification).where(eq(clarification.evaluationId, l.ev.id));
  const rounds = await tx.select().from(bafoRound).where(eq(bafoRound.evaluationId, l.ev.id));
  const offers = rounds.length
    ? await tx
        .select()
        .from(bafoOffer)
        .where(
          inArray(
            bafoOffer.roundId,
            rounds.map((r) => r.id),
          ),
        )
    : [];
  const companyOf = (id: string) => l.bidders.find((b) => b.supplierId === id)?.company ?? 'Supplier';

  const active = l.panel.filter((m) => m.coiState !== 'REMOVED');
  return buildReport({
    title: l.req.title,
    number: l.req.number,
    type: l.tender.type,
    generatedAt: now,
    varianceLimitPct: l.ev.varianceLimitPct,
    mode: l.ev.mode,
    priceWeightPct: l.ev.priceWeightPct,
    stage: l.tender.stage,
    panel: l.panel.map((m) => ({
      name: m.name,
      stream: m.stream,
      outcome:
        m.coiState === 'REMOVED'
          ? ('CONFLICT_REMOVED' as const)
          : conflictUsers.has(m.userId)
            ? ('CONFLICT_REVIEWED' as const)
            : ('NO_CONFLICT' as const),
    })),
    criteria: l.criteria.map((c) => ({
      id: c.id,
      name: c.name,
      weight: Number(c.weight),
      stream: c.stream,
      passFail: c.passFail,
    })),
    suppliers: l.bidders.map((b) => {
      const r = ranking.find((x) => x.supplierId === b.supplierId)!;
      const mine = scores.filter((x) => x.supplierId === b.supplierId && !departed.has(x.evaluatorId));
      return {
        name: b.company,
        score: r.weightedScore,
        rank: r.rank,
        compliant: r.compliance === 'PASS',
        tco: r.tco,
        priceScore: r.priceScore,
        valueForMoney: r.valueForMoney,
        items: items
          .filter((i) => i.supplierId === b.supplierId)
          .map((i) => ({
            criterionId: i.criterionId,
            consensus: Number(i.consensusScore ?? 0),
            flagged: i.flagged,
            variance: i.variancePct === null ? null : Number(i.variancePct),
            rationale: i.rationale ?? null,
          })),
        comments: scores.filter((c) => c.supplierId === b.supplierId && c.comment).map((c) => c.comment!),
        spread: l.criteria.flatMap((c) => {
          const v = mine.filter((x) => x.criterionId === c.id).map((x) => Number(x.score));
          return v.length
            ? [
                {
                  criterionId: c.id,
                  min: Math.min(...v),
                  max: Math.max(...v),
                  mean: v.reduce((a, x) => a + x, 0) / v.length,
                  n: v.length,
                },
              ]
            : [];
        }),
      };
    }),
    gate: gate.map((g) => ({
      supplier: companyOf(g.supplierId),
      label: g.label,
      result: g.result,
      detail: g.detail,
      note: g.note,
    })),
    stages: stages.map((st) => ({ stage: st.stage, suppliers: st.suppliers })),
    redeclaration: {
      done: active.filter((m) => m.redeclaredAt).map((m) => m.name),
      outstanding: active
        .filter((m) => m.coiState === 'DECLARED_NONE' && !m.redeclaredAt && m.stream !== undefined)
        .map((m) => m.name),
    },
    substitutions: subs.map((x) => ({
      departing: names.get(x.departingUserId) ?? 'An evaluator',
      incoming: names.get(x.incomingUserId) ?? 'A replacement',
      reason: x.reason,
    })),
    clarifications: {
      open: clar.filter((c) => c.status === 'OPEN').length,
      answered: clar.filter((c) => c.status === 'ANSWERED').length,
    },
    bafo: rounds.map((r) => ({
      round: r.round,
      status: r.status,
      offers: offers.filter((o) => o.roundId === r.id).length,
      accepted: offers.filter((o) => o.roundId === r.id && o.accepted).map((o) => companyOf(o.supplierId)),
    })),
  });
}

/** Writes the compiled text as the evaluation's report (creating it as a draft or putting it forward for approval). */
export async function storeReport(
  tx: Tx,
  tenantId: string,
  evaluationId: string,
  text: Record<string, string>,
  status: 'DRAFT' | 'AWAITING_APPROVAL',
  now: Date,
  routing?: { routedTo: string | null; requiredAuthority: number | null },
) {
  let [rep] = await tx.select().from(evalReport).where(eq(evalReport.evaluationId, evaluationId));
  const extra = routing
    ? { routedTo: routing.routedTo, requiredAuthority: routing.requiredAuthority?.toFixed(2) ?? null }
    : {};
  if (rep) {
    await tx
      .update(evalReport)
      .set({ status, generatedAt: now, ...extra })
      .where(eq(evalReport.id, rep.id));
  } else {
    [rep] = await tx
      .insert(evalReport)
      .values({ tenantId, evaluationId, status, generatedAt: now, ...extra })
      .returning();
  }
  const [evT] = await tx
    .select({ r: tender.requestId })
    .from(evaluation)
    .innerJoin(tender, eq(tender.id, evaluation.tenderId))
    .where(eq(evaluation.id, evaluationId));
  const reqId = evT!.r;
  for (const sec of REPORT_SECTIONS) {
    const [row] = await tx
      .select()
      .from(fieldValue)
      .where(
        and(
          eq(fieldValue.ownerType, 'EVAL_REPORT'),
          eq(fieldValue.ownerId, rep!.id),
          eq(fieldValue.key, sec.key),
        ),
      );
    // a restricted project's report narrative is stored encrypted with its project key (FR-0865)
    const sealed = await sealField(
      tx,
      tenantId,
      reqId,
      { type: 'EVAL_REPORT', id: rep!.id, key: sec.key },
      text[sec.key] ?? '',
    );
    if (row)
      await tx
        .update(fieldValue)
        .set({ value: sealed, source: 'SYSTEM', updatedAt: now })
        .where(eq(fieldValue.id, row.id));
    else
      await tx.insert(fieldValue).values({
        tenantId,
        ownerType: 'EVAL_REPORT',
        ownerId: rep!.id,
        key: sec.key,
        label: sec.label,
        value: sealed,
        source: 'SYSTEM',
        updatedAt: now,
      });
  }
  return rep!;
}
