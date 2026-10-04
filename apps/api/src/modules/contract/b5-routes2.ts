/**
 * Contract management, roadmap batch B5 (second half): alert preferences and the fixed alert rules, alert triggers read
 * from clause wording, management and risk plans with their templates, work orders under master agreements, new
 * procurements linked to a contract, the management view of a contract (variations, extensions, versions, next steps),
 * search within a person's own contracts, public register disclosure tasks, and funding envelopes.
 */
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RoleName } from '@if/shared';
import type { VendorRegistry } from '../../adapters/vendor-registry.js';
import { guard, type AuthContext } from '../../auth/guard.js';
import { checkDelegation } from '../../authz/delegation.js';
import { withContext, type Tx } from '../../db/client.js';
import {
  alert,
  alertPreference,
  appUser,
  clause,
  contract,
  contractActivity,
  contractExtension,
  contractHold,
  disclosureTask,
  envelopeCommitment,
  fundingEnvelope,
  notification,
  request,
  roleAssignment,
  workOrder,
} from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { loadSettings, saveSettings } from '../settings/settings.js';
import {
  COUNTDOWN_DAYS,
  INSURANCE_LEAD_DAYS,
  MANDATORY_KINDS,
  MANDATORY_SPEND_PCTS,
  B5_MODEL,
  STANDARD_CMP,
  STANDARD_RMP,
  envelopeState,
  extractTriggers,
  money,
  type PlanSection,
} from './b5-rules.js';
import {
  READERS,
  RECORD_EDITORS,
  canSee,
  createLinkedRequest,
  cumulativeValue,
  generatePlans,
  isNarrow,
  nextStepsFor,
  ownerOf,
  plansView,
  spendSummary,
  workOrderRollup,
} from './b5-service.js';
import { addMonths, daysBetween, iso } from './dates.js';
import { effectiveEnd } from './record.js';
import type { ContractDeps } from './routes.js';

type ContractRow = typeof contract.$inferSelect;
const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-31');
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface B5Summary {
  id: string;
  number: string;
  status: string;
  value: number;
  supplierName: string;
  title: string | null;
  requestNumber: string | null;
  startDate: string | null;
  endDate: string | null;
  docType: string;
  parentId: string | null;
}
export interface B5Ctx {
  load: (tx: Tx, a: AuthContext, id: string) => Promise<ContractRow>;
  summary: (tx: Tx, tenantId: string, c: ContractRow) => Promise<B5Summary>;
  view: (tx: Tx, a: AuthContext, c: ContractRow) => Promise<unknown>;
  variationsOf: (tx: Tx, c: ContractRow) => Promise<ContractRow[]>;
  notifyRoles: (
    tx: Tx,
    tenantId: string,
    roles: RoleName[],
    title: string,
    body: string,
    link: string,
  ) => Promise<void>;
  /** Creates a draft variation of an executed contract, with its business case and measures (FR-0535). */
  createVariation: (
    tx: Tx,
    a: AuthContext,
    parent: ContractRow,
    v: { reason: string; value: number; endDate?: string | undefined; requestId?: string | undefined },
  ) => Promise<ContractRow>;
  registry: VendorRegistry;
}

const MUTABLE = ['NOTICE', 'EXPIRY', 'MILESTONE', 'EXTENSION', 'CUSTOM', 'CLAUSE'] as const;
const ALERT_USERS: RoleName[] = ['CONTRACT_MGR', 'PROCUREMENT', 'LEGAL', 'EXEC', 'DELEGATE', 'FINANCE'];
const ALERT_MAKERS: RoleName[] = ['CONTRACT_MGR', 'PROCUREMENT', 'LEGAL', 'EXEC'];
const ENVELOPE_USERS: RoleName[] = [
  'DELEGATE',
  'EXEC',
  'FINANCE',
  'PROCUREMENT',
  'CONTRACT_MGR',
  'REQUESTER',
  'LEGAL',
];

const prefBody = z
  .object({
    muted: z.array(z.enum([...MUTABLE, ...MANDATORY_KINDS])).max(10),
  })
  .strict();
const applyBody = z.object({ keys: z.array(z.string().min(3).max(120)).min(1).max(20) }).strict();
const sectionBody = z
  .object({ title: z.string().trim().min(1).max(120), text: z.string().trim().min(1).max(4000) })
  .strict();
const templateBody = z
  .object({
    name: z.string().trim().min(2).max(120),
    sections: z.array(sectionBody).min(1).max(30).optional(),
    text: z.string().trim().min(10).max(40_000).optional(),
  })
  .strict()
  .refine((b) => !!b.sections !== !!b.text, { message: 'Give either sections or text, not both' });
const completeBody = z.object({ note: z.string().trim().max(1000).optional() }).strict();
const workOrderBody = z
  .object({
    title: z.string().trim().min(3).max(200),
    value: z.number().min(0).max(1e10),
    startDate: isoDate,
    endDate: isoDate,
  })
  .strict()
  .refine((b) => b.endDate >= b.startDate, { message: 'The work order must end after it starts' });
const workOrderPatch = z.object({ status: z.enum(['OPEN', 'COMPLETE', 'CANCELLED']) }).strict();
const procurementBody = z
  .object({
    kind: z.enum(['RENEW', 'VARY', 'EXTEND']),
    note: z.string().trim().min(5).max(1000),
    extensionPosition: z.number().int().min(1).max(10).optional(),
    value: z.number().min(0).max(1e10).optional(),
  })
  .strict();
const disclosureBody = z.object({ reference: z.string().trim().min(3).max(120) }).strict();
const envelopeBody = z
  .object({
    name: z.string().trim().min(3).max(160),
    amount: z.number().gt(0).max(1e10),
    nominees: z.array(uuid).max(20).default([]),
    warnPct: z.number().int().min(1).max(99).default(80),
  })
  .strict();
const commitBody = z
  .object({
    description: z.string().trim().min(3).max(300),
    amount: z.number().gt(0).max(1e10),
    contractId: uuid.optional(),
  })
  .strict();
const topUpBody = z.object({ amount: z.number().gt(0).max(1e10) }).strict();

/** Splits a plan template written as text: a line starting with # begins a section. */
export function sectionsFromText(text: string): PlanSection[] {
  const out: PlanSection[] = [];
  let cur: { title: string; lines: string[] } | null = null;
  for (const line of text.split(/\r?\n/)) {
    const h = /^#{1,3}\s+(.+)$/.exec(line);
    if (h) {
      if (cur) out.push({ title: cur.title, text: cur.lines.join(' ').replace(/\s+/g, ' ').trim() });
      cur = { title: h[1]!.trim(), lines: [] };
    } else if (cur) cur.lines.push(line);
  }
  if (cur) out.push({ title: cur.title, text: cur.lines.join(' ').replace(/\s+/g, ' ').trim() });
  return out.filter((s) => s.text.length > 0);
}

export function registerContractB5Part2(
  app: FastifyInstance,
  p: string,
  d: ContractDeps,
  reg: (m: string, path: string) => void,
  x: B5Ctx,
) {
  const cid = (req: { params: unknown }) => parse(z.object({ id: uuid }), req.params).id;
  const today = () => iso(d.clock.now());

  async function target(tx: Tx, a: AuthContext, id: string) {
    const c = await x.load(tx, a, id);
    if (c.status !== 'EXECUTED' || c.parentId)
      throw new AppError(409, 'INVALID_STATE', 'Only an executed contract has a management record');
    return c;
  }

  // ---------------------------------------------------------------- alert preferences and fixed rules (FR-0510)
  reg('GET', '/alerts/rules');
  app.get(`${p}/alerts/rules`, { preHandler: guard(d, ALERT_USERS) }, async () => ({
    fixed: [
      {
        kind: 'COUNTDOWN',
        title: 'Expiry and extension countdown',
        rule: `${COUNTDOWN_DAYS.join(', ')} days before expiry or before the extension decision closes`,
      },
      {
        kind: 'INSURANCE',
        title: 'Insurance lapse warning',
        rule: `${INSURANCE_LEAD_DAYS} days before a compliance certificate expires`,
      },
      {
        kind: 'SPEND',
        title: 'Spend ceiling notices',
        rule: `${MANDATORY_SPEND_PCTS.join(', ')} per cent of the authorised limit`,
      },
    ],
    note: 'These alerts are set by the platform. They cannot be muted, switched off or changed by a user or an administrator.',
    mutable: MUTABLE,
  }));

  reg('GET', '/me/alert-preferences');
  app.get(`${p}/me/alert-preferences`, { preHandler: guard(d, ALERT_USERS) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const [row] = await tx.select().from(alertPreference).where(eq(alertPreference.userId, a.user.id));
      return { muted: (row?.muted as string[] | undefined) ?? [], mutable: MUTABLE, fixed: MANDATORY_KINDS };
    });
  });

  reg('PUT', '/me/alert-preferences');
  app.put(`${p}/me/alert-preferences`, { preHandler: guard(d, ALERT_USERS) }, async (req) => {
    const a = req.auth!;
    const body = parse(prefBody, req.body);
    const fixed = body.muted.filter((k) => (MANDATORY_KINDS as readonly string[]).includes(k));
    if (fixed.length)
      throw new AppError(
        422,
        'ALERT_NOT_MUTABLE',
        'The expiry countdown and the insurance lapse warning are set by the platform and cannot be muted',
        fixed.map((k) => ({ field: 'muted', message: `${k} cannot be muted` })),
      );
    const muted = [...new Set(body.muted)];
    return withContext(d.database, a.ctx, async (tx) => {
      await tx
        .insert(alertPreference)
        .values({ userId: a.user.id, tenantId: a.user.tenantId, muted, updatedAt: d.clock.now() })
        .onConflictDoUpdate({
          target: alertPreference.userId,
          set: { muted, updatedAt: d.clock.now() },
        });
      await d.audit.record(tx, a.ctx, {
        action: 'alert.preferences_update',
        entityType: 'user',
        entityId: a.user.id,
        after: { muted },
      });
      return { muted, mutable: MUTABLE, fixed: MANDATORY_KINDS };
    });
  });

  // ---------------------------------------------------------------- triggers from clause wording (FR-0530)
  async function proposals(tx: Tx, c: ContractRow) {
    const end = (await effectiveEnd(tx, c)) ?? c.endDate!;
    const clauses = await tx.select().from(clause).where(eq(clause.contractId, c.id));
    const found = extractTriggers(
      clauses.map((k) => ({ clauseId: k.clauseId, title: k.title, text: k.text })),
      { startDate: c.startDate!, endDate: end },
      today(),
    );
    const have = await tx
      .select({ d: alert.triggerDate, n: alert.note })
      .from(alert)
      .where(and(eq(alert.contractId, c.id), eq(alert.kind, 'CLAUSE')));
    return found.map((f) => ({
      ...f,
      applied: have.some((h) => h.d === f.triggerDate && (h.n ?? '').startsWith(f.summary)),
    }));
  }

  reg('POST', '/contracts/{id}/alerts/extract');
  app.post(`${p}/contracts/:id/alerts/extract`, { preHandler: guard(d, ALERT_MAKERS) }, async (req) => {
    const a = req.auth!;
    const id = cid(req);
    return withContext(d.database, a.ctx, async (tx) => {
      const c = await target(tx, a, id);
      const list = await proposals(tx, c);
      await d.audit.record(tx, a.ctx, {
        action: 'contract.alert_extract',
        entityType: 'contract',
        entityId: id,
        after: { model: B5_MODEL, proposals: list.length },
      });
      return {
        model: B5_MODEL,
        note: 'Proposed from the wording of the clauses by fixed rules (a stand-in for AI extraction). Nothing is scheduled until you confirm.',
        proposals: list,
      };
    });
  });

  reg('POST', '/contracts/{id}/alerts/extract/apply');
  app.post(
    `${p}/contracts/:id/alerts/extract/apply`,
    { preHandler: guard(d, ALERT_MAKERS) },
    async (req, reply) => {
      const a = req.auth!;
      const id = cid(req);
      const body = parse(applyBody, req.body);
      const out = await withContext(d.database, a.ctx, async (tx) => {
        const c = await target(tx, a, id);
        const list = await proposals(tx, c);
        const chosen = list.filter((l) => body.keys.includes(l.key));
        if (chosen.length !== body.keys.length)
          throw new AppError(422, 'PROPOSAL_NOT_FOUND', 'One of those proposals is no longer on offer');
        const created = [];
        for (const pr of chosen) {
          if (pr.applied) continue;
          const [row] = await tx
            .insert(alert)
            .values({
              tenantId: a.user.tenantId,
              contractId: id,
              kind: 'CLAUSE',
              triggerDate: pr.triggerDate,
              recipientRule: 'AUTHOR+OWNER',
              origin: 'AI',
              note: `${pr.summary} (clause "${pr.clauseTitle}": "${pr.quote}")`,
              createdBy: a.user.id,
            })
            .returning();
          created.push({ id: row!.id, triggerDate: row!.triggerDate, note: row!.note });
        }
        await d.audit.record(tx, a.ctx, {
          action: 'contract.alert_extract_apply',
          entityType: 'contract',
          entityId: id,
          after: { model: B5_MODEL, created: created.length, keys: body.keys },
        });
        return { created };
      });
      return reply.status(201).send(out);
    },
  );

  // ---------------------------------------------------------------- management and risk plans (FR-0555)
  reg('GET', '/contracts/{id}/plans');
  app.get(`${p}/contracts/:id/plans`, { preHandler: guard(d, READERS) }, async (req) => {
    const a = req.auth!;
    const id = cid(req);
    return withContext(d.database, a.ctx, async (tx) => {
      const c = await x.load(tx, a, id);
      const v = await plansView(tx, id, today());
      return {
        ...v,
        canGenerate:
          c.status === 'EXECUTED' && !c.parentId && a.user.roles.some((r) => RECORD_EDITORS.includes(r)),
        canComplete: a.user.roles.some((r) => RECORD_EDITORS.includes(r)),
      };
    });
  });

  reg('POST', '/contracts/{id}/plans/generate');
  app.post(
    `${p}/contracts/:id/plans/generate`,
    { preHandler: guard(d, RECORD_EDITORS) },
    async (req, reply) => {
      const a = req.auth!;
      const id = cid(req);
      const out = await withContext(d.database, a.ctx, async (tx) => {
        const c = await target(tx, a, id);
        const settings = await loadSettings(tx, a.user.tenantId);
        const r = await generatePlans(
          tx,
          { registry: x.registry, audit: d.audit, now: d.clock.now() },
          a.ctx,
          c,
          settings,
          { manual: true },
        );
        return { generated: r, ...(await plansView(tx, id, today())) };
      });
      return reply.status(201).send(out);
    },
  );

  reg('POST', '/contracts/{id}/activities/{activityId}/complete');
  app.post(
    `${p}/contracts/:id/activities/:activityId/complete`,
    { preHandler: guard(d, RECORD_EDITORS) },
    async (req) => {
      const a = req.auth!;
      const { id, activityId } = parse(z.object({ id: uuid, activityId: uuid }), req.params);
      const body = parse(completeBody, req.body ?? {});
      return withContext(d.database, a.ctx, async (tx) => {
        await x.load(tx, a, id);
        const [act] = await tx
          .select()
          .from(contractActivity)
          .where(and(eq(contractActivity.id, activityId), eq(contractActivity.contractId, id)));
        if (!act) throw new AppError(404, 'NOT_FOUND', 'Activity not found');
        if (act.status === 'DONE') throw new AppError(409, 'INVALID_STATE', 'That activity is already done');
        await tx
          .update(contractActivity)
          .set({ status: 'DONE', doneAt: d.clock.now(), doneBy: a.user.id, note: body.note ?? null })
          .where(eq(contractActivity.id, activityId));
        await d.audit.record(tx, a.ctx, {
          action: 'contract.activity_complete',
          entityType: 'contract',
          entityId: id,
          after: { activityId, title: act.title },
        });
        return plansView(tx, id, today());
      });
    },
  );

  const templateRoles: RoleName[] = ['CONTRACT_MGR', 'LEGAL', 'ADMIN'];
  reg('GET', '/contract-plan-templates');
  app.get(`${p}/contract-plan-templates`, { preHandler: guard(d, templateRoles) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const s = await loadSettings(tx, a.user.tenantId);
      return {
        standard: { CMP: STANDARD_CMP, RMP: STANDARD_RMP },
        custom: s.contractManagement.planTemplates,
        placeholders: ['CONTRACT', 'SUPPLIER', 'VALUE', 'TERM_MONTHS', 'START', 'END', 'OWNER', 'TIER'],
      };
    });
  });

  reg('PUT', '/contract-plan-templates/{kind}');
  app.put(`${p}/contract-plan-templates/:kind`, { preHandler: guard(d, templateRoles) }, async (req) => {
    const a = req.auth!;
    const { kind } = parse(z.object({ kind: z.enum(['CMP', 'RMP']) }), req.params);
    const body = parse(templateBody, req.body);
    const sections = body.sections ?? sectionsFromText(body.text!);
    if (sections.length === 0)
      throw new AppError(400, 'VALIDATION_FAILED', 'No sections found', [
        { field: 'text', message: 'Start each section with a heading line such as "## Purpose"' },
      ]);
    return withContext(d.database, a.ctx, async (tx) => {
      const s = await loadSettings(tx, a.user.tenantId);
      const planTemplates = [
        ...s.contractManagement.planTemplates.filter((t) => t.kind !== kind),
        { kind, name: body.name, sections },
      ];
      const { before, after } = await saveSettings(tx, a.user.tenantId, {
        contractManagement: { ...s.contractManagement, planTemplates },
      });
      await d.audit.record(tx, a.ctx, {
        action: 'contract.plan_template_upload',
        entityType: 'tenant',
        entityId: a.user.tenantId,
        before: { templates: before.contractManagement.planTemplates.map((t) => t.kind) },
        after: { kind, name: body.name, sections: sections.length },
      });
      return { custom: after.contractManagement.planTemplates };
    });
  });

  reg('DELETE', '/contract-plan-templates/{kind}');
  app.delete(`${p}/contract-plan-templates/:kind`, { preHandler: guard(d, templateRoles) }, async (req) => {
    const a = req.auth!;
    const { kind } = parse(z.object({ kind: z.enum(['CMP', 'RMP']) }), req.params);
    return withContext(d.database, a.ctx, async (tx) => {
      const s = await loadSettings(tx, a.user.tenantId);
      const planTemplates = s.contractManagement.planTemplates.filter((t) => t.kind !== kind);
      await saveSettings(tx, a.user.tenantId, {
        contractManagement: { ...s.contractManagement, planTemplates },
      });
      await d.audit.record(tx, a.ctx, {
        action: 'contract.plan_template_remove',
        entityType: 'tenant',
        entityId: a.user.tenantId,
        after: { kind },
      });
      return { custom: planTemplates };
    });
  });

  // ---------------------------------------------------------------- master agreements and work orders (FR-0575)
  reg('POST', '/contracts/{id}/work-orders');
  app.post(`${p}/contracts/:id/work-orders`, { preHandler: guard(d, RECORD_EDITORS) }, async (req, reply) => {
    const a = req.auth!;
    const id = cid(req);
    const body = parse(workOrderBody, req.body);
    const out = await withContext(d.database, a.ctx, async (tx) => {
      const c = await target(tx, a, id);
      if (c.docType !== 'MASTER')
        throw new AppError(409, 'NOT_A_MASTER', 'Work orders are raised under a master agreement');
      const end = (await effectiveEnd(tx, c)) ?? c.endDate!;
      if (body.startDate < c.startDate! || body.endDate > end)
        throw new AppError(
          422,
          'WORK_ORDER_OUTSIDE_TERM',
          `A work order must fall within the master agreement term (${c.startDate} to ${end})`,
        );
      const existing = await tx.select().from(workOrder).where(eq(workOrder.masterId, id));
      const allocated = existing
        .filter((w) => w.status !== 'CANCELLED')
        .reduce((s, w) => s + Number(w.value), 0);
      const ceiling = await cumulativeValue(tx, c);
      if (allocated + body.value > ceiling + 0.005)
        throw new AppError(
          422,
          'WORK_ORDER_OVER_MASTER',
          `This takes work orders to ${money(allocated + body.value)}, above the master agreement value of ${money(ceiling)}`,
        );
      const number = `WO-${c.number}-${String(existing.length + 1).padStart(3, '0')}`;
      const [row] = await tx
        .insert(workOrder)
        .values({
          tenantId: a.user.tenantId,
          masterId: id,
          number,
          title: body.title,
          value: body.value.toFixed(2),
          startDate: body.startDate,
          endDate: body.endDate,
          createdBy: a.user.id,
        })
        .returning();
      await d.audit.record(tx, a.ctx, {
        action: 'contract.work_order_create',
        entityType: 'contract',
        entityId: id,
        after: { number, value: body.value, title: body.title },
      });
      return (await workOrderRollup(tx, id)).find((w) => w.id === row!.id);
    });
    return reply.status(201).send(out);
  });

  reg('GET', '/contracts/{id}/work-orders');
  app.get(`${p}/contracts/:id/work-orders`, { preHandler: guard(d, READERS) }, async (req) => {
    const a = req.auth!;
    const id = cid(req);
    return withContext(d.database, a.ctx, async (tx) => {
      const c = await x.load(tx, a, id);
      const orders = await workOrderRollup(tx, id);
      const settings = await loadSettings(tx, a.user.tenantId);
      const spend = await spendSummary(tx, c, settings, today());
      const live = orders.filter((o) => o.status !== 'CANCELLED');
      return {
        master: { id: c.id, number: c.number, docType: c.docType, value: spend.value },
        orders,
        totals: {
          allocated: r2(live.reduce((s, o) => s + o.value, 0)),
          committed: spend.committed,
          invoiced: spend.invoiced,
          unallocated: r2(spend.value - live.reduce((s, o) => s + o.value, 0)),
        },
        canEdit:
          c.status === 'EXECUTED' &&
          c.docType === 'MASTER' &&
          a.user.roles.some((r) => RECORD_EDITORS.includes(r)),
      };
    });
  });

  reg('PATCH', '/work-orders/{id}');
  app.patch(`${p}/work-orders/:id`, { preHandler: guard(d, RECORD_EDITORS) }, async (req) => {
    const a = req.auth!;
    const id = cid(req);
    const body = parse(workOrderPatch, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const [w] = await tx
        .select()
        .from(workOrder)
        .where(and(eq(workOrder.id, id), eq(workOrder.tenantId, a.user.tenantId)));
      if (!w) throw new AppError(404, 'NOT_FOUND', 'Work order not found');
      await x.load(tx, a, w.masterId);
      await tx.update(workOrder).set({ status: body.status }).where(eq(workOrder.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'contract.work_order_status',
        entityType: 'contract',
        entityId: w.masterId,
        before: { number: w.number, status: w.status },
        after: { number: w.number, status: body.status },
      });
      return (await workOrderRollup(tx, w.masterId)).find((o) => o.id === id);
    });
  });

  reg('GET', '/reports/master-agreements');
  app.get(`${p}/reports/master-agreements`, { preHandler: guard(d, READERS) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const masters = await tx
        .select()
        .from(contract)
        .where(
          and(
            eq(contract.tenantId, a.user.tenantId),
            eq(contract.docType, 'MASTER'),
            eq(contract.status, 'EXECUTED'),
            isNull(contract.deletedAt),
          ),
        )
        .orderBy(asc(contract.number));
      const settings = await loadSettings(tx, a.user.tenantId);
      const out = [];
      const flat = [];
      for (const m of masters) {
        if (!(await canSee(tx, a, m))) continue;
        const s = await x.summary(tx, a.user.tenantId, m);
        const spend = await spendSummary(tx, m, settings, today());
        const orders = await workOrderRollup(tx, m.id);
        out.push({
          id: m.id,
          number: m.number,
          title: s.title,
          supplier: s.supplierName,
          value: spend.value,
          committed: spend.committed,
          invoiced: spend.invoiced,
          workOrders: orders.length,
          allocated: r2(orders.filter((o) => o.status !== 'CANCELLED').reduce((t, o) => t + o.value, 0)),
        });
        for (const o of orders) flat.push({ ...o, masterId: m.id, masterNumber: m.number });
      }
      return { masters: out, workOrders: flat };
    });
  });

  // ---------------------------------------------------------------- linked procurements (FR-0570, FR-0565)
  reg('POST', '/contracts/{id}/procurements');
  app.post(
    `${p}/contracts/:id/procurements`,
    { preHandler: guard(d, RECORD_EDITORS) },
    async (req, reply) => {
      const a = req.auth!;
      const id = cid(req);
      const body = parse(procurementBody, req.body);
      const out = await withContext(d.database, a.ctx, async (tx) => {
        const c = await target(tx, a, id);
        const s = await x.summary(tx, a.user.tenantId, c);
        const value = await cumulativeValue(tx, c);
        const end = (await effectiveEnd(tx, c)) ?? c.endDate!;
        const exts = await tx
          .select()
          .from(contractExtension)
          .where(eq(contractExtension.contractId, id))
          .orderBy(asc(contractExtension.position));
        let ext: (typeof exts)[number] | undefined;
        if (body.kind === 'EXTEND') {
          ext = body.extensionPosition
            ? exts.find((e) => e.position === body.extensionPosition)
            : exts.find((e) => !e.exercisedAt);
          if (!ext) throw new AppError(422, 'NO_EXTENSION', 'The contract has no extension to take up');
          if (ext.exercisedAt)
            throw new AppError(409, 'EXTENSION_EXERCISED', 'That extension has already been taken up');
          const earlier = exts.find((e) => e.position < ext!.position && !e.exercisedAt);
          if (earlier) throw new AppError(409, 'EXTENSION_ORDER', 'Take up the earlier extension first');
        }
        const prefix = { RENEW: 'Renewal', VARY: 'Variation', EXTEND: 'Extension' }[body.kind];
        const row = await createLinkedRequest(tx, d, a.ctx, c, body.kind, {
          title: `${prefix}: ${s.title ?? c.number}`,
          value: body.kind === 'RENEW' ? value : (body.value ?? 0),
          termMonths: body.kind === 'EXTEND' ? ext!.months : undefined,
        });
        let variation: ContractRow | null = null;
        if (body.kind === 'EXTEND') {
          await tx
            .update(contractExtension)
            .set({ exercisedAt: d.clock.now(), exercisedRequestId: row.id })
            .where(eq(contractExtension.id, ext!.id));
          variation = await x.createVariation(tx, a, c, {
            reason: `Extension ${ext!.position} taken up (${ext!.months} months). ${body.note}`,
            value: body.value ?? 0,
            endDate: addMonths(end, ext!.months),
            requestId: row.id,
          });
        }
        await d.audit.record(tx, a.ctx, {
          action: 'contract.procurement_link',
          entityType: 'contract',
          entityId: id,
          after: {
            kind: body.kind,
            requestId: row.id,
            number: row.number,
            note: body.note,
            variation: variation?.number ?? null,
          },
        });
        await x.notifyRoles(
          tx,
          a.user.tenantId,
          ['PROCUREMENT'],
          `${prefix} procurement started`,
          `${row.number} is linked to ${c.number}: ${body.note}`,
          `/app/requests/${row.id}`,
        );
        return {
          request: { id: row.id, number: row.number, title: row.title, kind: body.kind },
          variation: variation ? { id: variation.id, number: variation.number } : null,
        };
      });
      return reply.status(201).send(out);
    },
  );

  // ---------------------------------------------------------------- the management view of a contract (FR-0565, FR-0560)
  reg('GET', '/contracts/{id}/management');
  app.get(`${p}/contracts/:id/management`, { preHandler: guard(d, READERS) }, async (req) => {
    const a = req.auth!;
    const id = cid(req);
    return withContext(d.database, a.ctx, async (tx) => {
      const c0 = await x.load(tx, a, id);
      const c = c0.parentId ? await x.load(tx, a, c0.parentId) : c0;
      const settings = await loadSettings(tx, a.user.tenantId);
      const kids = await x.variationsOf(tx, c);
      const exts = await tx
        .select()
        .from(contractExtension)
        .where(eq(contractExtension.contractId, c.id))
        .orderBy(asc(contractExtension.position));
      const links = await tx
        .select()
        .from(request)
        .where(eq(request.linkedContractId, c.id))
        .orderBy(desc(request.createdAt));
      const done = kids.filter((k) => k.status === 'EXECUTED');
      let running = Number(c.value);
      const versions = [
        {
          label: 'Original',
          id: c.id,
          number: c.number,
          value: Number(c.value),
          cumulativeValue: running,
          endDate: c.endDate,
          businessCase: null as string | null,
          variancePct: 0,
          model: null as string | null,
        },
        ...done.map((k, i) => {
          running += Number(k.value);
          return {
            label: `V${i + 1}`,
            id: k.id,
            number: k.number,
            value: Number(k.value),
            cumulativeValue: running,
            endDate: k.endDate,
            businessCase: k.businessCase,
            variancePct: Number(k.variancePct ?? 0),
            model: k.varianceModel,
          };
        }),
      ];
      const end = (await effectiveEnd(tx, c)) ?? c.endDate;
      let from = c.endDate!;
      const extList = exts.map((e) => {
        const to = addMonths(from, e.months);
        const row = {
          position: e.position,
          months: e.months,
          startsOn: from,
          endsOn: to,
          exercised: !!e.exercisedAt,
          exercisedAt: e.exercisedAt?.toISOString() ?? null,
          requestNumber: links.find((l) => l.id === e.exercisedRequestId)?.number ?? null,
        };
        from = to;
        return row;
      });
      const [hold] = await tx
        .select()
        .from(contractHold)
        .where(and(eq(contractHold.contractId, c.id), isNull(contractHold.releasedAt)));
      const tasks = await tx
        .select()
        .from(disclosureTask)
        .where(inArray(disclosureTask.contractId, kids.map((k) => k.id).concat(c.id)));
      return {
        contractId: c.id,
        number: c.number,
        variationCount: kids.length,
        variationsExecuted: done.length,
        variations: kids.map((k) => ({
          id: k.id,
          number: k.number,
          status: k.status,
          value: Number(k.value),
          endDate: k.endDate,
          businessCase: k.businessCase,
          variancePct: k.variancePct === null ? null : Number(k.variancePct),
          model: k.varianceModel,
          disclosure: tasks.find((t) => t.contractId === k.id)?.status ?? null,
        })),
        extensions: {
          total: exts.length,
          exercised: exts.filter((e) => e.exercisedAt).length,
          remaining: exts.filter((e) => !e.exercisedAt).length,
          list: extList,
        },
        cumulative: { original: Number(c.value), value: running, endDate: end },
        versions,
        procurements: links.map((l) => ({
          id: l.id,
          number: l.number,
          title: l.title,
          kind: l.linkKind,
          status: l.status,
          createdAt: l.createdAt.toISOString(),
        })),
        hold: hold ? { reason: hold.reason, placedAt: hold.placedAt.toISOString() } : null,
        nextSteps: { model: B5_MODEL, steps: await nextStepsFor(tx, c, settings, today()) },
        canLink: c.status === 'EXECUTED' && a.user.roles.some((r) => RECORD_EDITORS.includes(r)),
        model: settings.contractManagement.variationModel,
      };
    });
  });

  // ---------------------------------------------------------------- search my contracts (FR-0560)
  reg('GET', '/contracts/search');
  app.get(`${p}/contracts/search`, { preHandler: guard(d, READERS) }, async (req) => {
    const a = req.auth!;
    const q = parse(
      z.object({
        q: z.string().max(100).optional(),
        status: z.string().max(40).optional(),
        endingWithinDays: z.coerce.number().int().min(1).max(3650).optional(),
      }),
      req.query,
    );
    return withContext(d.database, a.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(contract)
        .where(
          and(eq(contract.tenantId, a.user.tenantId), isNull(contract.deletedAt), isNull(contract.parentId)),
        )
        .orderBy(asc(contract.endDate), asc(contract.number));
      const settings = await loadSettings(tx, a.user.tenantId);
      const out = [];
      for (const c of rows) {
        if (q.status && c.status !== q.status) continue;
        if (!(await canSee(tx, a, c))) continue;
        const s = await x.summary(tx, a.user.tenantId, c);
        if (q.q) {
          const hay = `${s.number} ${s.supplierName} ${s.title ?? ''} ${s.requestNumber ?? ''}`.toLowerCase();
          if (!hay.includes(q.q.toLowerCase())) continue;
        }
        const end = c.status === 'EXECUTED' ? ((await effectiveEnd(tx, c)) ?? c.endDate) : c.endDate;
        const days = end ? daysBetween(today(), end) : null;
        if (q.endingWithinDays !== undefined && (days === null || days < 0 || days > q.endingWithinDays))
          continue;
        const steps = await nextStepsFor(tx, c, settings, today());
        const owner = await ownerOf(tx, c);
        const [o] = owner
          ? await tx.select({ name: appUser.name }).from(appUser).where(eq(appUser.id, owner))
          : [];
        out.push({
          id: c.id,
          number: c.number,
          title: s.title,
          supplier: s.supplierName,
          status: c.status,
          docType: c.docType,
          value: s.value,
          endDate: end,
          daysToEnd: days,
          owner: o?.name ?? null,
          spentPct: c.status === 'EXECUTED' ? (await spendSummary(tx, c, settings, today())).spentPct : null,
          nextStep: steps[0] ?? null,
        });
      }
      return {
        scope: isNarrow(a.user.roles) ? 'TEAM' : 'ALL',
        note: isNarrow(a.user.roles)
          ? 'You see the contracts owned by you and your team, and the teams beneath yours.'
          : 'You see every contract.',
        model: B5_MODEL,
        items: out,
      };
    });
  });

  // ---------------------------------------------------------------- public register disclosure (FR-0545)
  const taskView = (t: typeof disclosureTask.$inferSelect, number: string, parent: string | null) => ({
    id: t.id,
    contractId: t.contractId,
    contractNumber: number,
    parentNumber: parent,
    register: t.register,
    variancePct: Number(t.variancePct),
    dueOn: t.dueOn,
    status: t.status,
    reference: t.reference,
    overdue: t.status === 'OPEN' && t.dueOn < today(),
    doneAt: t.doneAt?.toISOString() ?? null,
  });

  reg('GET', '/disclosure-tasks');
  app.get(
    `${p}/disclosure-tasks`,
    { preHandler: guard(d, ['PROCUREMENT', 'LEGAL', 'CONTRACT_MGR', 'EXEC']) },
    async (req) => {
      const a = req.auth!;
      return withContext(d.database, a.ctx, async (tx) => {
        const rows = await tx
          .select({ t: disclosureTask, c: contract })
          .from(disclosureTask)
          .innerJoin(contract, eq(contract.id, disclosureTask.contractId))
          .where(eq(disclosureTask.tenantId, a.user.tenantId))
          .orderBy(asc(disclosureTask.dueOn));
        const out = [];
        for (const r of rows) {
          if (!(await canSee(tx, a, r.c))) continue;
          const [par] = r.c.parentId
            ? await tx.select({ n: contract.number }).from(contract).where(eq(contract.id, r.c.parentId))
            : [];
          out.push(taskView(r.t, r.c.number, par?.n ?? null));
        }
        return out;
      });
    },
  );

  reg('POST', '/disclosure-tasks/{id}/complete');
  app.post(
    `${p}/disclosure-tasks/:id/complete`,
    { preHandler: guard(d, ['PROCUREMENT', 'LEGAL']) },
    async (req) => {
      const a = req.auth!;
      const id = cid(req);
      const body = parse(disclosureBody, req.body);
      return withContext(d.database, a.ctx, async (tx) => {
        const [t] = await tx
          .select()
          .from(disclosureTask)
          .where(and(eq(disclosureTask.id, id), eq(disclosureTask.tenantId, a.user.tenantId)));
        if (!t) throw new AppError(404, 'NOT_FOUND', 'Task not found');
        if (t.status === 'DONE')
          throw new AppError(409, 'INVALID_STATE', 'This disclosure is already recorded');
        const [c] = await tx.select().from(contract).where(eq(contract.id, t.contractId));
        const [row] = await tx
          .update(disclosureTask)
          .set({ status: 'DONE', reference: body.reference, doneBy: a.user.id, doneAt: d.clock.now() })
          .where(eq(disclosureTask.id, id))
          .returning();
        await d.audit.record(tx, a.ctx, {
          action: 'contract.disclosure_complete',
          entityType: 'contract',
          entityId: t.contractId,
          after: { register: t.register, reference: body.reference },
        });
        return taskView(row!, c!.number, null);
      });
    },
  );

  // ---------------------------------------------------------------- funding envelopes (FR-0585)
  async function envelopeView(tx: Tx, a: AuthContext, e: typeof fundingEnvelope.$inferSelect) {
    const commits = await tx
      .select({ c: envelopeCommitment, by: appUser.name, num: contract.number })
      .from(envelopeCommitment)
      .innerJoin(appUser, eq(appUser.id, envelopeCommitment.approvedBy))
      .leftJoin(contract, eq(contract.id, envelopeCommitment.contractId))
      .where(eq(envelopeCommitment.envelopeId, e.id))
      .orderBy(desc(envelopeCommitment.createdAt));
    const committed = commits.reduce((s, r) => s + Number(r.c.amount), 0);
    const st = envelopeState(Number(e.amount), committed, e.warnPct);
    const ids = [e.holderId, ...(e.nominees as string[])];
    const people = await tx
      .select({ id: appUser.id, name: appUser.name })
      .from(appUser)
      .where(inArray(appUser.id, ids));
    const name = (i: string) => people.find((u) => u.id === i)?.name ?? 'Unknown';
    const nominee = (e.nominees as string[]).includes(a.user.id);
    return {
      id: e.id,
      name: e.name,
      amount: Number(e.amount),
      committed: r2(committed),
      ...st,
      warnPct: e.warnPct,
      status: e.status,
      holder: { id: e.holderId, name: name(e.holderId) },
      nominees: (e.nominees as string[]).map((i) => ({ id: i, name: name(i) })),
      commitments: commits.map((r) => ({
        id: r.c.id,
        description: r.c.description,
        amount: Number(r.c.amount),
        contractNumber: r.num ?? null,
        approvedBy: r.by,
        createdAt: r.c.createdAt.toISOString(),
      })),
      canCommit: e.status === 'ACTIVE' && !st.exhausted && (e.holderId === a.user.id || nominee),
      canTopUp: e.holderId === a.user.id || a.user.roles.includes('EXEC'),
      mine: e.holderId === a.user.id ? 'HOLDER' : nominee ? 'NOMINEE' : null,
    };
  }

  const visible = (e: typeof fundingEnvelope.$inferSelect, a: AuthContext) =>
    e.holderId === a.user.id ||
    (e.nominees as string[]).includes(a.user.id) ||
    a.user.roles.includes('EXEC') ||
    a.user.roles.includes('FINANCE');

  reg('GET', '/envelopes/candidates');
  app.get(`${p}/envelopes/candidates`, { preHandler: guard(d, ['DELEGATE', 'EXEC']) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const rows = await tx
        .select({ id: appUser.id, name: appUser.name, role: roleAssignment.role })
        .from(appUser)
        .innerJoin(roleAssignment, eq(roleAssignment.userId, appUser.id))
        .where(
          and(
            eq(appUser.tenantId, a.user.tenantId),
            eq(appUser.active, true),
            inArray(roleAssignment.role, ['PROCUREMENT', 'CONTRACT_MGR', 'DELEGATE', 'REQUESTER', 'FINANCE']),
          ),
        )
        .orderBy(asc(appUser.name));
      const by = new Map<string, { id: string; name: string; roles: string[] }>();
      for (const r of rows) {
        if (r.id === a.user.id) continue;
        const e = by.get(r.id) ?? { id: r.id, name: r.name, roles: [] };
        e.roles.push(r.role);
        by.set(r.id, e);
      }
      return [...by.values()];
    });
  });

  reg('GET', '/envelopes');
  app.get(`${p}/envelopes`, { preHandler: guard(d, ENVELOPE_USERS) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(fundingEnvelope)
        .where(eq(fundingEnvelope.tenantId, a.user.tenantId))
        .orderBy(desc(fundingEnvelope.createdAt));
      const out = [];
      for (const e of rows) if (visible(e, a)) out.push(await envelopeView(tx, a, e));
      return out;
    });
  });

  async function loadEnvelope(tx: Tx, a: AuthContext, id: string) {
    const [e] = await tx
      .select()
      .from(fundingEnvelope)
      .where(and(eq(fundingEnvelope.id, id), eq(fundingEnvelope.tenantId, a.user.tenantId)));
    if (!e || !visible(e, a)) throw new AppError(404, 'NOT_FOUND', 'Funding envelope not found');
    return e;
  }

  reg('GET', '/envelopes/{id}');
  app.get(`${p}/envelopes/:id`, { preHandler: guard(d, ENVELOPE_USERS) }, async (req) => {
    const a = req.auth!;
    const id = cid(req);
    return withContext(d.database, a.ctx, async (tx) => envelopeView(tx, a, await loadEnvelope(tx, a, id)));
  });

  reg('POST', '/envelopes');
  app.post(`${p}/envelopes`, { preHandler: guard(d, ['DELEGATE', 'EXEC']) }, async (req, reply) => {
    const a = req.auth!;
    const body = parse(envelopeBody, req.body);
    const out = await withContext(d.database, a.ctx, async (tx) => {
      const del = await checkDelegation(
        tx,
        { tenantId: a.user.tenantId, userId: a.user.id, roles: a.user.roles },
        'SOURCING_APPROVAL',
        body.amount,
      );
      if (!del.allowed)
        return {
          denied:
            del.limit === null
              ? 'You do not hold the delegated authority to approve a funding envelope'
              : `An envelope of ${money(body.amount)} is above your delegated authority of ${money(del.limit)}`,
        };
      const nominees = [...new Set(body.nominees)].filter((n) => n !== a.user.id);
      if (nominees.length) {
        const ok = await tx
          .select({ id: appUser.id })
          .from(appUser)
          .innerJoin(roleAssignment, eq(roleAssignment.userId, appUser.id))
          .where(
            and(
              eq(appUser.tenantId, a.user.tenantId),
              inArray(appUser.id, nominees),
              inArray(roleAssignment.role, [
                'PROCUREMENT',
                'CONTRACT_MGR',
                'DELEGATE',
                'REQUESTER',
                'FINANCE',
              ]),
            ),
          );
        if (new Set(ok.map((o) => o.id)).size !== nominees.length)
          throw new AppError(422, 'INVALID_NOMINEE', 'Nominate people who work in the organisation');
      }
      const [row] = await tx
        .insert(fundingEnvelope)
        .values({
          tenantId: a.user.tenantId,
          name: body.name,
          amount: body.amount.toFixed(2),
          holderId: a.user.id,
          nominees,
          warnPct: body.warnPct,
          approvedBy: a.user.id,
          createdAt: d.clock.now(),
        })
        .returning();
      await d.audit.record(tx, a.ctx, {
        action: 'envelope.create',
        entityType: 'funding_envelope',
        entityId: row!.id,
        after: { name: body.name, amount: body.amount, nominees: nominees.length, limit: del.limit },
      });
      for (const n of nominees)
        await tx.insert(notification).values({
          tenantId: a.user.tenantId,
          userId: n,
          title: 'You can approve commitments from a funding envelope',
          body: `${body.name}: ${money(body.amount)} allocated by ${a.user.name}.`,
          link: '/app/envelopes',
        });
      return { view: await envelopeView(tx, a, row!) };
    });
    if ('denied' in out && out.denied) {
      await d.audit.recordOutsideTx(d.database, a.ctx, {
        action: 'envelope.create',
        entityType: 'funding_envelope',
        entityId: a.user.tenantId,
        after: { amount: body.amount, reason: 'DELEGATION_EXCEEDED' },
        result: 'DENIED',
      });
      throw new AppError(403, 'DELEGATION_EXCEEDED', out.denied);
    }
    return reply.status(201).send(out.view);
  });

  reg('POST', '/envelopes/{id}/commitments');
  app.post(`${p}/envelopes/:id/commitments`, { preHandler: guard(d, ENVELOPE_USERS) }, async (req, reply) => {
    const a = req.auth!;
    const id = cid(req);
    const body = parse(commitBody, req.body);
    const out = await withContext(d.database, a.ctx, async (tx) => {
      await tx.execute(sql`select 1 from ${fundingEnvelope} where ${fundingEnvelope.id} = ${id} for update`);
      const e = await loadEnvelope(tx, a, id);
      const mine = e.holderId === a.user.id || (e.nominees as string[]).includes(a.user.id);
      if (!mine)
        throw new AppError(
          403,
          'NOT_NOMINATED',
          'You are not nominated to approve commitments from this envelope',
        );
      if (e.status !== 'ACTIVE') throw new AppError(409, 'INVALID_STATE', 'This envelope is closed');
      const before = await envelopeView(tx, a, e);
      if (body.amount > before.remaining + 0.005)
        return {
          denied: `${money(body.amount)} is more than the ${money(Math.max(0, before.remaining))} left in the envelope: ask ${before.holder.name} for further approval`,
          holder: e.holderId,
        };
      if (body.contractId) {
        const [c] = await tx
          .select({ id: contract.id })
          .from(contract)
          .where(and(eq(contract.id, body.contractId), eq(contract.tenantId, a.user.tenantId)));
        if (!c) throw new AppError(422, 'CONTRACT_NOT_FOUND', 'That contract was not found');
      }
      await tx.insert(envelopeCommitment).values({
        tenantId: a.user.tenantId,
        envelopeId: id,
        contractId: body.contractId ?? null,
        description: body.description,
        amount: body.amount.toFixed(2),
        approvedBy: a.user.id,
        createdAt: d.clock.now(),
      });
      let after = await envelopeView(tx, a, e);
      let warning: string | null = null;
      if ((after.nearing || after.exhausted) && !e.warnedAt) {
        await tx.update(fundingEnvelope).set({ warnedAt: d.clock.now() }).where(eq(fundingEnvelope.id, id));
        warning = after.exhausted
          ? `The envelope "${e.name}" is fully committed. Seek further delegate approval before committing more.`
          : `The envelope "${e.name}" is ${after.usedPct}% committed (${money(after.remaining)} left). Seek further delegate approval.`;
        await tx.insert(notification).values({
          tenantId: a.user.tenantId,
          userId: e.holderId,
          title: after.exhausted ? 'Funding envelope exhausted' : 'Funding envelope nearly used',
          body: warning,
          link: '/app/envelopes',
        });
        after = await envelopeView(tx, a, e);
      }
      await d.audit.record(tx, a.ctx, {
        action: 'envelope.commit',
        entityType: 'funding_envelope',
        entityId: id,
        after: {
          description: body.description,
          amount: body.amount,
          usedPct: after.usedPct,
          warned: !!warning,
        },
      });
      return { view: after, warning };
    });
    if ('denied' in out && out.denied) {
      await d.audit.recordOutsideTx(d.database, a.ctx, {
        action: 'envelope.commit',
        entityType: 'funding_envelope',
        entityId: id,
        after: { amount: body.amount, reason: 'ENVELOPE_EXHAUSTED' },
        result: 'DENIED',
      });
      throw new AppError(422, 'ENVELOPE_EXHAUSTED', out.denied);
    }
    return reply.status(201).send({ ...out.view, warning: out.warning });
  });

  reg('POST', '/envelopes/{id}/top-up');
  app.post(`${p}/envelopes/:id/top-up`, { preHandler: guard(d, ['DELEGATE', 'EXEC']) }, async (req) => {
    const a = req.auth!;
    const id = cid(req);
    const body = parse(topUpBody, req.body);
    const out = await withContext(d.database, a.ctx, async (tx) => {
      const e = await loadEnvelope(tx, a, id);
      if (e.holderId !== a.user.id && !a.user.roles.includes('EXEC'))
        throw new AppError(403, 'FORBIDDEN', 'Only the holder or an executive can add to this envelope');
      const total = Number(e.amount) + body.amount;
      const del = await checkDelegation(
        tx,
        { tenantId: a.user.tenantId, userId: a.user.id, roles: a.user.roles },
        'SOURCING_APPROVAL',
        total,
      );
      if (!del.allowed)
        return {
          denied:
            del.limit === null
              ? 'You do not hold the delegated authority to approve a funding envelope'
              : `An envelope of ${money(total)} is above your delegated authority of ${money(del.limit)}`,
        };
      await tx
        .update(fundingEnvelope)
        .set({ amount: total.toFixed(2), warnedAt: null })
        .where(eq(fundingEnvelope.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'envelope.top_up',
        entityType: 'funding_envelope',
        entityId: id,
        before: { amount: Number(e.amount) },
        after: { amount: total, added: body.amount },
      });
      return { view: await envelopeView(tx, a, await loadEnvelope(tx, a, id)) };
    });
    if ('denied' in out && out.denied) {
      await d.audit.recordOutsideTx(d.database, a.ctx, {
        action: 'envelope.top_up',
        entityType: 'funding_envelope',
        entityId: id,
        after: { amount: body.amount, reason: 'DELEGATION_EXCEEDED' },
        result: 'DENIED',
      });
      throw new AppError(403, 'DELEGATION_EXCEEDED', out.denied);
    }
    return out.view;
  });
}
