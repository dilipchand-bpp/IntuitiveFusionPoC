/**
 * Contract management services (B5): spend against a contract, the spend alerts, management and risk plans, who may see
 * which contracts, and the facts the next-step suggestions are drawn from. Database work; the rules are in b5-rules.ts.
 */
import { and, asc, eq, inArray, isNull, lt } from 'drizzle-orm';
import type { Clock, RoleName } from '@if/shared';
import type { AuditService } from '../../audit/audit-service.js';
import type { VendorRegistry } from '../../adapters/vendor-registry.js';
import type { AuthContext } from '../../auth/guard.js';
import type { RequestContext, Tx } from '../../db/client.js';
import {
  appUser,
  clause,
  contract,
  contractActivity,
  contractExtension,
  contractHold,
  contractPlan,
  disclosureTask,
  invoice,
  notification,
  orgUnit,
  purchaseOrder,
  request,
  roleAssignment,
  spendAlert,
  supplier,
  tender,
  workOrder,
} from '../../db/schema.js';
import type { Settings } from '../settings/settings.js';
import {
  buildPlanSections,
  money,
  nextSteps,
  planActivities,
  planTier,
  spendCrossings,
  type NextStep,
  type PlanSection,
  type PlanTier,
} from './b5-rules.js';
import { IntakeService } from '../intake/service.js';
import { addDays, daysBetween, iso } from './dates.js';
import { effectiveEnd } from './record.js';

type ContractRow = typeof contract.$inferSelect;
const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: string | number | null | undefined) => Number(v ?? 0);
export const COUNTED = ['MATCHED', 'EXCEPTION', 'PAID'] as const;
export const READERS: RoleName[] = [
  'PROCUREMENT',
  'LEGAL',
  'CONTRACT_MGR',
  'DELEGATE',
  'EXEC',
  'FINANCE',
  'PROBITY',
];
export const RECORD_EDITORS: RoleName[] = ['CONTRACT_MGR', 'LEGAL', 'PROCUREMENT'];
export const MONEY_ROLES: RoleName[] = ['FINANCE', 'CONTRACT_MGR', 'PROCUREMENT'];

/** The value spend is measured against: the contract and every executed variation. */
export async function cumulativeValue(tx: Tx, c: ContractRow): Promise<number> {
  const root = c.parentId ?? c.id;
  const [base] = c.parentId ? await tx.select().from(contract).where(eq(contract.id, root)) : [c];
  const kids = await tx
    .select({ value: contract.value })
    .from(contract)
    .where(and(eq(contract.parentId, root), eq(contract.status, 'EXECUTED'), isNull(contract.deletedAt)));
  return num(base?.value) + kids.reduce((s, k) => s + num(k.value), 0);
}

const monthsBetween = (a: string, b: string) => Math.max(1, Math.round(daysBetween(a, b) / 30.4375));

export async function spendSummary(tx: Tx, c: ContractRow, settings: Settings, today: string) {
  const value = await cumulativeValue(tx, c);
  const inv = await tx.select().from(invoice).where(eq(invoice.contractId, c.id));
  const counted = inv.filter((i) => (COUNTED as readonly string[]).includes(i.status));
  const blocked = inv.filter((i) => i.status === 'BLOCKED');
  const invoiced = r2(counted.reduce((s, i) => s + num(i.amount), 0));
  const paid = r2(inv.reduce((s, i) => s + num(i.paidAmount), 0));
  const pos = await tx
    .select()
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.contractId, c.id), eq(purchaseOrder.status, 'APPROVED')));
  const committed = r2(pos.reduce((s, p) => s + num(p.amount), 0));
  const end = (await effectiveEnd(tx, c)) ?? c.endDate ?? today;
  const start = c.startDate ?? today;
  const total = Math.max(1, daysBetween(start, end));
  const elapsed = Math.min(total, Math.max(0, daysBetween(start, today)));
  const raised = await tx.select().from(spendAlert).where(eq(spendAlert.contractId, c.id));
  return {
    value,
    invoiced,
    paid,
    committed,
    remaining: r2(value - invoiced),
    spentPct: value > 0 ? r2((invoiced / value) * 100) : 0,
    paidPct: value > 0 ? r2((paid / value) * 100) : 0,
    committedPct: value > 0 ? r2((committed / value) * 100) : 0,
    blockedCount: blocked.length,
    blockedAmount: r2(blocked.reduce((s, i) => s + num(i.amount), 0)),
    term: { start, end, totalDays: total, elapsedDays: elapsed, pct: r2((elapsed / total) * 100) },
    configuredPct: settings.contractManagement.spendAlertPct,
    mandatoryPcts: [80, 90, 100],
    raised: raised
      .map((a) => ({
        kind: a.kind,
        threshold: a.threshold,
        spentPct: num(a.spentPct),
        raisedAt: a.raisedAt.toISOString(),
      }))
      .sort((x, y) => x.threshold - y.threshold),
  };
}

async function peopleWith(tx: Tx, tenantId: string, roles: RoleName[]): Promise<string[]> {
  if (!roles.length) return [];
  const rows = await tx
    .select({ userId: roleAssignment.userId })
    .from(roleAssignment)
    .where(and(eq(roleAssignment.tenantId, tenantId), inArray(roleAssignment.role, roles)));
  return rows.map((r) => r.userId);
}

/**
 * Raises the spend notices that spending has just crossed: 80, 90 and 100 per cent of the contract value are fixed and
 * cannot be muted (FR-0510); the configured percentage is the organisation's own (FR-0580). Each is raised once.
 */
export async function raiseSpendAlerts(
  tx: Tx,
  audit: AuditService,
  ctx: RequestContext,
  c: ContractRow,
  settings: Settings,
  now: Date,
) {
  const s = await spendSummary(tx, c, settings, iso(now));
  const have = new Set(s.raised.map((r) => `${r.kind}:${r.threshold}`));
  const fresh = spendCrossings(s.spentPct, settings.contractManagement.spendAlertPct, have);
  for (const f of fresh) {
    await tx.insert(spendAlert).values({
      tenantId: c.tenantId,
      contractId: c.id,
      kind: f.kind,
      threshold: f.threshold,
      spentPct: String(s.spentPct),
      raisedAt: now,
    });
    const roles: RoleName[] =
      f.kind === 'MANDATORY'
        ? f.threshold >= 100
          ? ['FINANCE', 'CONTRACT_MGR', 'DELEGATE', 'EXEC']
          : ['FINANCE', 'CONTRACT_MGR']
        : ['CONTRACT_MGR'];
    const ids = new Set(await peopleWith(tx, c.tenantId, roles));
    if (c.ownerId) ids.add(c.ownerId);
    const title =
      f.kind === 'MANDATORY'
        ? `Spend ceiling: ${f.threshold}% of ${c.number} reached`
        : `Spend alert: ${f.threshold}% of ${c.number} spent`;
    const body = `${money(s.invoiced)} of ${money(s.value)} (${s.spentPct}%) has been invoiced.${
      f.threshold >= 100 ? ' The authorised limit is reached: ask the delegate before more is committed.' : ''
    }`;
    for (const userId of ids)
      await tx
        .insert(notification)
        .values({ tenantId: c.tenantId, userId, title, body, link: `/app/contracts/${c.id}` });
    await audit.record(tx, ctx, {
      action: 'contract.spend_alert',
      entityType: 'contract',
      entityId: c.id,
      after: { kind: f.kind, threshold: f.threshold, spentPct: s.spentPct },
    });
  }
  return fresh;
}

// ---------------------------------------------------------------- management and risk plans (FR-0555)
export interface PlanDeps {
  registry: VendorRegistry;
  audit: AuditService;
  now: Date;
}

export async function generatePlans(
  tx: Tx,
  deps: PlanDeps,
  ctx: RequestContext,
  c: ContractRow,
  settings: Settings,
  opts: { manual: boolean },
) {
  const today = iso(deps.now);
  const [s] = await tx.select().from(supplier).where(eq(supplier.id, c.supplierId));
  const value = await cumulativeValue(tx, c);
  const end = (await effectiveEnd(tx, c)) ?? c.endDate!;
  const start = c.startDate!;
  const termMonths = monthsBetween(start, end);
  const risk = s ? await deps.registry.financialRisk(s.abn, s.company) : { level: 'LOW' as const };
  const clauses = await tx.select().from(clause).where(eq(clause.contractId, c.id));
  const tier = planTier({
    value,
    termMonths,
    highValueAud: settings.contractManagement.highValueAud,
    supplierRisk: risk.level,
    insuranceCurrent: s ? s.insuranceStatus === 'CURRENT' || s.insuranceStatus === 'EXPIRING' : false,
    highDeviations: clauses.filter((k) => k.changedFromTemplate && k.risk === 'HIGH').length,
  });
  const qualifies = tier.tier !== 'STANDARD' || value >= settings.contractManagement.highValueAud;
  if (!qualifies && !opts.manual) return null;
  const [owner] = c.ownerId
    ? await tx.select({ name: appUser.name }).from(appUser).where(eq(appUser.id, c.ownerId))
    : [];
  const vars = {
    CONTRACT: c.number,
    SUPPLIER: s?.company ?? 'the supplier',
    VALUE: money(value),
    TERM_MONTHS: String(termMonths),
    START: start,
    END: end,
    OWNER: owner?.name ?? 'the contract manager',
    TIER: tier.tier.toLowerCase(),
  };
  const made: Array<{ kind: 'CMP' | 'RMP'; template: string; sections: PlanSection[] }> = [];
  for (const kind of ['CMP', 'RMP'] as const) {
    const custom = settings.contractManagement.planTemplates.find((t) => t.kind === kind)?.sections ?? null;
    const b = buildPlanSections(kind, custom, vars);
    await tx.delete(contractPlan).where(and(eq(contractPlan.contractId, c.id), eq(contractPlan.kind, kind)));
    await tx.insert(contractPlan).values({
      tenantId: c.tenantId,
      contractId: c.id,
      kind,
      tier: tier.tier,
      template: b.template,
      sections: b.sections,
      reasons: tier.reasons,
      generatedAt: deps.now,
      generatedBy: ctx.userId,
    });
    made.push({ kind, template: b.template, sections: b.sections });
  }
  // open activities are rebuilt; completed ones stay as history
  await tx
    .delete(contractActivity)
    .where(and(eq(contractActivity.contractId, c.id), eq(contractActivity.status, 'OPEN')));
  const done = await tx.select().from(contractActivity).where(eq(contractActivity.contractId, c.id));
  const acts = planActivities(tier.tier, { startDate: start, endDate: end, termMonths }, today).filter(
    (a) => !done.some((d) => d.title === a.title && d.planKind === a.plan),
  );
  for (const a of acts)
    await tx.insert(contractActivity).values({
      tenantId: c.tenantId,
      contractId: c.id,
      planKind: a.plan,
      title: a.title,
      dueDate: a.dueDate,
      ownerId: c.ownerId,
    });
  await deps.audit.record(tx, ctx, {
    action: 'contract.plans_generate',
    entityType: 'contract',
    entityId: c.id,
    after: { tier: tier.tier, score: tier.score, activities: acts.length, auto: !opts.manual },
  });
  if (c.ownerId)
    await tx.insert(notification).values({
      tenantId: c.tenantId,
      userId: c.ownerId,
      title: 'Contract management plans ready',
      body: `${c.number}: ${tier.tier.toLowerCase()} management tier, ${acts.length} activities scheduled.`,
      link: `/app/contracts/${c.id}`,
    });
  return { tier: tier.tier, score: tier.score, reasons: tier.reasons, activities: acts.length, plans: made };
}

export async function plansView(tx: Tx, contractId: string, today: string) {
  const plans = await tx.select().from(contractPlan).where(eq(contractPlan.contractId, contractId));
  const acts = await tx
    .select({ a: contractActivity, owner: appUser.name })
    .from(contractActivity)
    .leftJoin(appUser, eq(appUser.id, contractActivity.ownerId))
    .where(eq(contractActivity.contractId, contractId))
    .orderBy(asc(contractActivity.dueDate), asc(contractActivity.title));
  return {
    tier: (plans[0]?.tier ?? null) as PlanTier | null,
    reasons: (plans[0]?.reasons ?? []) as string[],
    generatedAt: plans[0]?.generatedAt.toISOString() ?? null,
    plans: plans.map((p) => ({
      kind: p.kind,
      template: p.template,
      sections: p.sections as PlanSection[],
    })),
    activities: acts.map((r) => ({
      id: r.a.id,
      plan: r.a.planKind,
      title: r.a.title,
      dueDate: r.a.dueDate,
      status: r.a.status,
      overdue: r.a.status === 'OPEN' && r.a.dueDate < today,
      owner: r.owner ?? null,
      doneAt: r.a.doneAt?.toISOString() ?? null,
      note: r.a.note,
    })),
  };
}

// ---------------------------------------------------------------- who sees which contracts (FR-0560)
/** People who see every contract: those who sign, advise on, pay for or oversee them. */
const WIDE: RoleName[] = ['LEGAL', 'PROCUREMENT', 'EXEC', 'DELEGATE', 'FINANCE', 'PROBITY', 'ADMIN'];

/** A contract manager sees the contracts of their own team and the teams beneath it, per the organisation hierarchy. */
export const isNarrow = (roles: readonly string[]) =>
  roles.includes('CONTRACT_MGR') && !roles.some((r) => WIDE.includes(r as RoleName));

export async function teamUserIds(tx: Tx, a: AuthContext): Promise<Set<string>> {
  const units = await tx.select().from(orgUnit).where(eq(orgUnit.tenantId, a.user.tenantId));
  const [me] = await tx.select().from(appUser).where(eq(appUser.id, a.user.id));
  const mine = new Set<string>(me?.orgUnitId ? [me.orgUnitId] : []);
  let grew = true;
  while (grew) {
    grew = false;
    for (const u of units)
      if (u.parentId && mine.has(u.parentId) && !mine.has(u.id)) {
        mine.add(u.id);
        grew = true;
      }
  }
  const people = await tx.select().from(appUser).where(eq(appUser.tenantId, a.user.tenantId));
  const out = new Set<string>([a.user.id]);
  for (const p of people) if (p.orgUnitId && mine.has(p.orgUnitId)) out.add(p.id);
  return out;
}

/** The contract owner that counts: a variation belongs to its parent's owner. */
export async function ownerOf(tx: Tx, c: ContractRow): Promise<string | null> {
  if (!c.parentId) return c.ownerId;
  const [p] = await tx.select({ o: contract.ownerId }).from(contract).where(eq(contract.id, c.parentId));
  return p?.o ?? null;
}

export async function canSee(
  tx: Tx,
  a: AuthContext,
  c: ContractRow,
  team?: Set<string> | null,
): Promise<boolean> {
  if (!isNarrow(a.user.roles)) return true;
  // a contract still being drafted has no owner yet; it belongs to the people preparing it
  if (!c.parentId && c.status !== 'EXECUTED') return true;
  const o = await ownerOf(tx, c);
  return !!o && (team ?? (await teamUserIds(tx, a))).has(o);
}

// ---------------------------------------------------------------- next steps (FR-0560)
export async function nextStepsFor(
  tx: Tx,
  c: ContractRow,
  settings: Settings,
  today: string,
): Promise<NextStep[]> {
  if (c.status !== 'EXECUTED' || c.parentId) return [];
  const end = (await effectiveEnd(tx, c)) ?? c.endDate!;
  const ext = await tx
    .select()
    .from(contractExtension)
    .where(eq(contractExtension.contractId, c.id))
    .orderBy(asc(contractExtension.position));
  const exercised = ext.filter((e) => e.exercisedAt);
  const next = ext.find((e) => !e.exercisedAt);
  const linked = await tx
    .select({ kind: request.linkKind, status: request.status })
    .from(request)
    .where(eq(request.linkedContractId, c.id));
  const open = linked.filter((l) => l.status !== 'COMPLETE');
  const spend = await spendSummary(tx, c, settings, today);
  const overdue = await tx
    .select({ id: contractActivity.id })
    .from(contractActivity)
    .where(
      and(
        eq(contractActivity.contractId, c.id),
        eq(contractActivity.status, 'OPEN'),
        lt(contractActivity.dueDate, today),
      ),
    );
  const [hold] = await tx
    .select({ id: contractHold.id })
    .from(contractHold)
    .where(and(eq(contractHold.contractId, c.id), isNull(contractHold.releasedAt)));
  return nextSteps({
    today,
    endDate: end,
    noticeDays: c.noticeDays,
    extensionsTotal: ext.length,
    extensionsExercised: exercised.length,
    nextExtensionMonths: next?.months ?? null,
    extensionProcurementOpen: open.some((l) => l.kind === 'EXTEND'),
    renewalProcurementOpen: open.some((l) => l.kind === 'RENEW'),
    spendPct: spend.spentPct,
    overdueActivities: overdue.length,
    hold: !!hold,
  });
}

/** Where a work order's invoices land: its value, what is committed and invoiced. */
export async function workOrderRollup(tx: Tx, masterId: string) {
  const wos = await tx
    .select()
    .from(workOrder)
    .where(eq(workOrder.masterId, masterId))
    .orderBy(asc(workOrder.number));
  const inv = await tx.select().from(invoice).where(eq(invoice.contractId, masterId));
  const pos = await tx
    .select()
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.contractId, masterId), eq(purchaseOrder.status, 'APPROVED')));
  const counted = inv.filter((i) => (COUNTED as readonly string[]).includes(i.status));
  return wos.map((w) => ({
    id: w.id,
    number: w.number,
    title: w.title,
    value: num(w.value),
    startDate: w.startDate,
    endDate: w.endDate,
    status: w.status,
    committed: r2(pos.filter((p) => p.workOrderId === w.id).reduce((s, p) => s + num(p.amount), 0)),
    invoiced: r2(counted.filter((i) => i.workOrderId === w.id).reduce((s, i) => s + num(i.amount), 0)),
  }));
}

// ---------------------------------------------------------------- linked procurements (FR-0570)
/**
 * A new procurement number tied to an existing contract, to renew it, vary it or take up an extension. It sits in the
 * contract management phase of the pipeline and is not a new tender.
 */
export async function createLinkedRequest(
  tx: Tx,
  deps: { clock: Clock; audit: AuditService },
  ctx: RequestContext,
  c: ContractRow,
  kind: 'RENEW' | 'VARY' | 'EXTEND',
  opts: { title: string; value: number; termMonths?: number | undefined },
) {
  const root = c.parentId ?? c.id;
  const [rootRow] = await tx.select().from(contract).where(eq(contract.id, root));
  const tenderId = rootRow?.tenderId ?? c.tenderId;
  const [src] = tenderId
    ? await tx
        .select({ r: request })
        .from(tender)
        .innerJoin(request, eq(request.id, tender.requestId))
        .where(eq(tender.id, tenderId))
    : [];
  const draft = await new IntakeService(deps.clock, deps.audit).createDraft(tx, ctx);
  const months =
    opts.termMonths ??
    Math.max(
      1,
      Math.round(
        daysBetween(c.startDate ?? iso(deps.clock.now()), c.endDate ?? iso(deps.clock.now())) / 30.4375,
      ),
    );
  const [row] = await tx
    .update(request)
    .set({
      title: opts.title,
      category: src?.r.category ?? null,
      unspsc: src?.r.unspsc ?? null,
      businessUnit: src?.r.businessUnit ?? null,
      estimatedValue: String(opts.value),
      termMonths: months,
      phase: 'CONTRACT_MGMT',
      status: 'IN_PROGRESS',
      linkedContractId: root,
      linkKind: kind,
      updatedAt: deps.clock.now(),
    })
    .where(eq(request.id, draft.id))
    .returning();
  return row!;
}

// ---------------------------------------------------------------- public register disclosure (FR-0545)
/** A change over the statutory threshold, for a public-sector customer, creates a mandatory disclosure task. */
export async function raiseDisclosureIfDue(
  tx: Tx,
  audit: AuditService,
  ctx: RequestContext,
  variation: ContractRow,
  variancePct: number,
  settings: Settings,
  now: Date,
) {
  const m = settings.contractManagement;
  if (!m.publicSectorDisclosure || variancePct <= m.disclosureThresholdPct) return null;
  const register = settings.publicRegisters.find((r) => r.enabled)?.register ?? 'Public contract register';
  const [row] = await tx
    .insert(disclosureTask)
    .values({
      tenantId: variation.tenantId,
      contractId: variation.id,
      register,
      variancePct: String(variancePct),
      dueOn: addDays(iso(now), m.disclosureDays),
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) return null;
  await audit.record(tx, ctx, {
    action: 'contract.disclosure_task',
    entityType: 'contract',
    entityId: variation.id,
    after: { register, variancePct, thresholdPct: m.disclosureThresholdPct, dueOn: row.dueOn },
  });
  for (const userId of await peopleWith(tx, variation.tenantId, ['PROCUREMENT', 'LEGAL']))
    await tx.insert(notification).values({
      tenantId: variation.tenantId,
      userId,
      title: 'Public register disclosure required',
      body: `${variation.number} changes the contract by ${variancePct}%, over the ${m.disclosureThresholdPct}% threshold. Record it on ${register} by ${row.dueOn}.`,
      link: '/app/contracts/disclosures',
    });
  return row;
}
