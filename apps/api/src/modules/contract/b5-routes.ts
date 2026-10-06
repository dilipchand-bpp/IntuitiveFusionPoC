/**
 * Contract management, roadmap batch B5 (first half): the rate card, price escalation and rebates on an executed
 * contract, purchase orders with the spend-ceiling guard and the insurance hold, invoices with the three-way match,
 * and live spend. The purchase-order and invoice endpoints are the simulated ERP feed (docs/swap-points.md): a real
 * integration posts the same records. Every change is audited.
 */
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { guard, type AuthContext } from '../../auth/guard.js';
import { withContext, type Tx } from '../../db/client.js';
import {
  appUser,
  contract,
  contractEscalation,
  contractRate,
  contractRebate,
  invoice,
  payment,
  purchaseOrder,
  supplier,
  workOrder,
} from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { loadSettings } from '../settings/settings.js';
import {
  allowedPct,
  escalationFactor,
  evaluateRebate,
  lineTotal,
  matchInvoice,
  type EscalationRow,
  type Finding,
  type Line,
} from './b5-rules.js';
import {
  COUNTED,
  MONEY_ROLES,
  READERS,
  RECORD_EDITORS,
  canSee,
  cumulativeValue,
  raiseSpendAlerts,
  spendSummary,
} from './b5-service.js';
import { activeHold, syncContractCompliance } from './compliance.js';
import { iso } from './dates.js';
import { effectiveEnd } from './record.js';
import { registerContractB5Part2, type B5Ctx } from './b5-routes2.js';
import type { ContractDeps } from './routes.js';

type ContractRow = typeof contract.$inferSelect;
const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-31');

const lineBody = z
  .object({
    item: z.string().trim().min(1).max(120),
    qty: z.number().positive().max(1e7),
    unitPrice: z.number().min(0).max(1e9),
  })
  .strict();
const linesBody = z
  .array(lineBody)
  .min(1)
  .max(50)
  .refine((a) => new Set(a.map((l) => l.item.toLowerCase())).size === a.length, 'Each item can appear once');
const rateBody = z
  .object({
    rates: z
      .array(
        z
          .object({
            item: z.string().trim().min(1).max(120),
            unit: z.string().trim().min(1).max(30).default('each'),
            unitPrice: z.number().min(0).max(1e9),
          })
          .strict(),
      )
      .max(200)
      .refine(
        (a) => new Set(a.map((l) => l.item.toLowerCase())).size === a.length,
        'Each item can appear once',
      ),
  })
  .strict();
const escalationBody = z
  .object({
    escalations: z
      .array(
        z
          .object({
            kind: z.enum(['CPI', 'SCHEDULED']),
            effectiveOn: isoDate,
            pct: z.number().min(0).max(100),
            capPct: z.number().min(0).max(100).optional(),
            note: z.string().trim().max(300).optional(),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
const rebateBody = z
  .object({
    title: z.string().trim().min(3).max(160),
    threshold: z.number().min(0).max(1e10),
    ratePct: z.number().gt(0).max(100),
    periodStart: isoDate,
    periodEnd: isoDate,
  })
  .strict()
  .refine((b) => b.periodEnd >= b.periodStart, { message: 'The period must end after it starts' });
const claimBody = z.object({ amount: z.number().gt(0).max(1e10), claimedOn: isoDate.optional() }).strict();
const poBody = z
  .object({
    description: z.string().trim().min(3).max(300),
    workOrderId: uuid.optional(),
    lines: linesBody,
  })
  .strict();
const invoiceBody = z
  .object({
    number: z.string().trim().min(2).max(60).optional(),
    invoiceDate: isoDate,
    poId: uuid.optional(),
    workOrderId: uuid.optional(),
    lines: linesBody,
  })
  .strict();
const overrideBody = z.object({ reason: z.string().trim().min(10).max(1000) }).strict();

const toLines = (j: unknown): Line[] =>
  ((j as Array<{ item: string; qty: number; unitPrice: number }> | null) ?? []).map((l) => ({
    item: l.item,
    qty: Number(l.qty),
    unitPrice: Number(l.unitPrice),
  }));

export function invoiceView(
  i: typeof invoice.$inferSelect,
  extra: { contractNumber?: string; poNumber?: string | null; workOrderNumber?: string | null } = {},
) {
  return {
    id: i.id,
    contractId: i.contractId,
    contractNumber: extra.contractNumber ?? null,
    number: i.number,
    invoiceDate: i.invoiceDate,
    amount: Number(i.amount),
    lines: toLines(i.lines),
    status: i.status,
    findings: i.findings as Finding[],
    poId: i.poId,
    poNumber: extra.poNumber ?? null,
    workOrderId: i.workOrderId,
    workOrderNumber: extra.workOrderNumber ?? null,
    paidAmount: Number(i.paidAmount),
    paidOn: i.paidOn,
    overrideReason: i.overrideReason,
    createdAt: i.createdAt.toISOString(),
  };
}

export function registerContractB5(
  app: FastifyInstance,
  p: string,
  d: ContractDeps,
  reg: (m: string, path: string) => void,
  x: B5Ctx,
) {
  const cid = (req: { params: unknown }) => parse(z.object({ id: uuid }), req.params).id;
  const today = () => iso(d.clock.now());

  /** Commercial terms and money belong to an executed contract itself (a variation is part of its parent). */
  async function target(tx: Tx, a: AuthContext, id: string) {
    const c = await x.load(tx, a, id);
    if (c.status !== 'EXECUTED' || c.parentId)
      throw new AppError(409, 'INVALID_STATE', 'Only an executed contract has commercial terms to manage');
    return c;
  }

  async function rebateRows(tx: Tx, c: ContractRow) {
    const rows = await tx
      .select()
      .from(contractRebate)
      .where(eq(contractRebate.contractId, c.id))
      .orderBy(asc(contractRebate.periodStart));
    const inv = (await tx.select().from(invoice).where(eq(invoice.contractId, c.id))).filter((i) =>
      (COUNTED as readonly string[]).includes(i.status),
    );
    return rows.map((r) => {
      const spend = inv
        .filter((i) => i.invoiceDate >= r.periodStart && i.invoiceDate <= r.periodEnd)
        .reduce((s, i) => s + Number(i.amount), 0);
      const e = evaluateRebate(
        {
          threshold: Number(r.threshold),
          ratePct: Number(r.ratePct),
          periodStart: r.periodStart,
          periodEnd: r.periodEnd,
          claimed: Number(r.claimed),
        },
        spend,
        today(),
      );
      return {
        id: r.id,
        title: r.title,
        threshold: Number(r.threshold),
        ratePct: Number(r.ratePct),
        periodStart: r.periodStart,
        periodEnd: r.periodEnd,
        claimedOn: r.claimedOn,
        followedUpAt: r.followedUpAt?.toISOString() ?? null,
        ...e,
      };
    });
  }

  async function escalationRows(tx: Tx, contractId: string): Promise<EscalationRow[]> {
    const rows = await tx
      .select()
      .from(contractEscalation)
      .where(eq(contractEscalation.contractId, contractId))
      .orderBy(asc(contractEscalation.effectiveOn));
    return rows.map((e) => ({
      kind: e.kind,
      effectiveOn: e.effectiveOn,
      pct: Number(e.pct),
      capPct: e.capPct === null ? null : Number(e.capPct),
    }));
  }

  // ---------------------------------------------------------------- commercial terms (FR-0500, FR-0520, FR-0525)
  reg('GET', '/contracts/{id}/commercial');
  app.get(`${p}/contracts/:id/commercial`, { preHandler: guard(d, READERS) }, async (req) => {
    const a = req.auth!;
    const id = cid(req);
    return withContext(d.database, a.ctx, async (tx) => {
      const c = await x.load(tx, a, id);
      const settings = await loadSettings(tx, a.user.tenantId);
      const [s] = await tx.select().from(supplier).where(eq(supplier.id, c.supplierId));
      if (c.status === 'EXECUTED' && !c.parentId && s)
        await syncContractCompliance(tx, d.audit, c, s, d.clock.now());
      const rates = await tx
        .select()
        .from(contractRate)
        .where(eq(contractRate.contractId, id))
        .orderBy(asc(contractRate.item));
      const esc = await tx
        .select()
        .from(contractEscalation)
        .where(eq(contractEscalation.contractId, id))
        .orderBy(asc(contractEscalation.effectiveOn));
      const rows = await escalationRows(tx, id);
      const hold = await activeHold(tx, id);
      return {
        rates: rates.map((r) => ({ item: r.item, unit: r.unit, unitPrice: Number(r.unitPrice) })),
        escalations: esc.map((e) => ({
          id: e.id,
          kind: e.kind,
          effectiveOn: e.effectiveOn,
          pct: Number(e.pct),
          capPct: e.capPct === null ? null : Number(e.capPct),
          allowedPct: allowedPct({
            kind: e.kind,
            effectiveOn: e.effectiveOn,
            pct: Number(e.pct),
            capPct: e.capPct === null ? null : Number(e.capPct),
          }),
          note: e.note,
        })),
        factorToday: escalationFactor(rows, today()),
        rebates: await rebateRows(tx, c),
        hold: hold
          ? { id: hold.id, kind: hold.kind, reason: hold.reason, placedAt: hold.placedAt.toISOString() }
          : null,
        erpIntegrated: settings.contractManagement.erpIntegrated,
        canEdit:
          c.status === 'EXECUTED' && !c.parentId && a.user.roles.some((r) => RECORD_EDITORS.includes(r)),
        canMoney: c.status === 'EXECUTED' && !c.parentId && a.user.roles.some((r) => MONEY_ROLES.includes(r)),
      };
    });
  });

  reg('PUT', '/contracts/{id}/rates');
  app.put(`${p}/contracts/:id/rates`, { preHandler: guard(d, RECORD_EDITORS) }, async (req) => {
    const a = req.auth!;
    const id = cid(req);
    const body = parse(rateBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      await target(tx, a, id);
      await tx.delete(contractRate).where(eq(contractRate.contractId, id));
      for (const r of body.rates)
        await tx.insert(contractRate).values({
          tenantId: a.user.tenantId,
          contractId: id,
          item: r.item,
          unit: r.unit,
          unitPrice: String(r.unitPrice),
        });
      await d.audit.record(tx, a.ctx, {
        action: 'contract.rates_edit',
        entityType: 'contract',
        entityId: id,
        after: { items: body.rates.length },
      });
      return { rates: body.rates };
    });
  });

  reg('PUT', '/contracts/{id}/escalations');
  app.put(`${p}/contracts/:id/escalations`, { preHandler: guard(d, RECORD_EDITORS) }, async (req) => {
    const a = req.auth!;
    const id = cid(req);
    const body = parse(escalationBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const c = await target(tx, a, id);
      const early = body.escalations.filter((e) => c.startDate && e.effectiveOn < c.startDate);
      if (early.length)
        throw new AppError(
          422,
          'ESCALATION_BEFORE_START',
          `An escalation cannot take effect before the contract starts (${c.startDate})`,
          early.map((e) => ({ field: 'escalations', message: `${e.kind} on ${e.effectiveOn}` })),
        );
      await tx.delete(contractEscalation).where(eq(contractEscalation.contractId, id));
      for (const e of body.escalations)
        await tx.insert(contractEscalation).values({
          tenantId: a.user.tenantId,
          contractId: id,
          kind: e.kind,
          effectiveOn: e.effectiveOn,
          pct: String(e.pct),
          capPct: e.capPct === undefined ? null : String(e.capPct),
          note: e.note ?? null,
          createdBy: a.user.id,
        });
      await d.audit.record(tx, a.ctx, {
        action: 'contract.escalations_edit',
        entityType: 'contract',
        entityId: id,
        after: { escalations: body.escalations },
      });
      return { escalations: body.escalations };
    });
  });

  reg('POST', '/contracts/{id}/rebates');
  app.post(`${p}/contracts/:id/rebates`, { preHandler: guard(d, RECORD_EDITORS) }, async (req, reply) => {
    const a = req.auth!;
    const id = cid(req);
    const body = parse(rebateBody, req.body);
    const out = await withContext(d.database, a.ctx, async (tx) => {
      await target(tx, a, id);
      const [row] = await tx
        .insert(contractRebate)
        .values({
          tenantId: a.user.tenantId,
          contractId: id,
          title: body.title,
          threshold: String(body.threshold),
          ratePct: String(body.ratePct),
          periodStart: body.periodStart,
          periodEnd: body.periodEnd,
          createdBy: a.user.id,
        })
        .returning();
      await d.audit.record(tx, a.ctx, {
        action: 'contract.rebate_add',
        entityType: 'contract',
        entityId: id,
        after: { rebateId: row!.id, ...body },
      });
      return (await rebateRows(tx, await x.load(tx, a, id))).find((r) => r.id === row!.id);
    });
    return reply.status(201).send(out);
  });

  reg('POST', '/contracts/{id}/rebates/{rebateId}/claim');
  app.post(
    `${p}/contracts/:id/rebates/:rebateId/claim`,
    { preHandler: guard(d, ['FINANCE', 'CONTRACT_MGR']) },
    async (req) => {
      const a = req.auth!;
      const { id, rebateId } = parse(z.object({ id: uuid, rebateId: uuid }), req.params);
      const body = parse(claimBody, req.body);
      return withContext(d.database, a.ctx, async (tx) => {
        const c = await target(tx, a, id);
        const [r] = await tx
          .select()
          .from(contractRebate)
          .where(and(eq(contractRebate.id, rebateId), eq(contractRebate.contractId, id)));
        if (!r) throw new AppError(404, 'NOT_FOUND', 'Rebate not found');
        const total = Number(r.claimed) + body.amount;
        await tx
          .update(contractRebate)
          .set({ claimed: total.toFixed(2), claimedOn: body.claimedOn ?? today() })
          .where(eq(contractRebate.id, rebateId));
        await d.audit.record(tx, a.ctx, {
          action: 'contract.rebate_claim',
          entityType: 'contract',
          entityId: id,
          after: { rebateId, amount: body.amount, totalClaimed: total },
        });
        return (await rebateRows(tx, c)).find((x2) => x2.id === rebateId);
      });
    },
  );

  reg('POST', '/contracts/{id}/rebates/{rebateId}/follow-up');
  app.post(
    `${p}/contracts/:id/rebates/:rebateId/follow-up`,
    { preHandler: guard(d, ['FINANCE', 'CONTRACT_MGR']) },
    async (req) => {
      const a = req.auth!;
      const { id, rebateId } = parse(z.object({ id: uuid, rebateId: uuid }), req.params);
      return withContext(d.database, a.ctx, async (tx) => {
        const c = await target(tx, a, id);
        const row = (await rebateRows(tx, c)).find((r) => r.id === rebateId);
        if (!row) throw new AppError(404, 'NOT_FOUND', 'Rebate not found');
        if (!row.flagged)
          throw new AppError(409, 'NOT_FLAGGED', 'Only a missed or under-claimed rebate needs a follow-up');
        await tx
          .update(contractRebate)
          .set({ followedUpAt: d.clock.now() })
          .where(eq(contractRebate.id, rebateId));
        await d.audit.record(tx, a.ctx, {
          action: 'contract.rebate_follow_up',
          entityType: 'contract',
          entityId: id,
          after: { rebateId, status: row.status, shortfall: row.shortfall },
        });
        return (await rebateRows(tx, c)).find((r) => r.id === rebateId);
      });
    },
  );

  // ---------------------------------------------------------------- purchase orders (FR-0495, FR-0550)
  reg('POST', '/contracts/{id}/purchase-orders');
  app.post(
    `${p}/contracts/:id/purchase-orders`,
    { preHandler: guard(d, MONEY_ROLES) },
    async (req, reply) => {
      const a = req.auth!;
      const id = cid(req);
      const body = parse(poBody, req.body);
      const out = await withContext(d.database, a.ctx, async (tx) => {
        const c = await target(tx, a, id);
        if (!['CONTRACT', 'MASTER'].includes(c.docType))
          throw new AppError(409, 'INVALID_STATE', 'Purchase orders are raised against a contract');
        const settings = await loadSettings(tx, a.user.tenantId);
        const now = d.clock.now();
        const [s] = await tx.select().from(supplier).where(eq(supplier.id, c.supplierId));
        if (s) await syncContractCompliance(tx, d.audit, c, s, now);
        const hold = await activeHold(tx, id);
        if (hold) return { held: hold.reason, contractNumber: c.number };
        const total = lineTotal(body.lines);
        const value = await cumulativeValue(tx, c);
        const existing = await tx.select().from(purchaseOrder).where(eq(purchaseOrder.contractId, id));
        const committed = existing
          .filter((x2) => x2.status === 'APPROVED')
          .reduce((sum, x2) => sum + Number(x2.amount), 0);
        let wo: typeof workOrder.$inferSelect | undefined;
        if (body.workOrderId) {
          [wo] = await tx
            .select()
            .from(workOrder)
            .where(and(eq(workOrder.id, body.workOrderId), eq(workOrder.masterId, id)));
          if (!wo || wo.status !== 'OPEN')
            throw new AppError(422, 'WORK_ORDER_NOT_OPEN', 'Choose an open work order of this agreement');
        }
        let blockedReason: string | null = null;
        if (settings.contractManagement.erpIntegrated) {
          if (committed + total > value + 0.005)
            blockedReason = `The requisition of ${total.toFixed(2)} takes commitments to ${(committed + total).toFixed(2)}, above the contract limit of ${value.toFixed(2)}`;
          else if (wo) {
            const woCommitted = existing
              .filter((x2) => x2.status === 'APPROVED' && x2.workOrderId === wo!.id)
              .reduce((sum, x2) => sum + Number(x2.amount), 0);
            if (woCommitted + total > Number(wo.value) + 0.005)
              blockedReason = `The requisition takes work order ${wo.number} to ${(woCommitted + total).toFixed(2)}, above its value of ${Number(wo.value).toFixed(2)}`;
          }
        }
        const number = `PO-${c.number}-${String(existing.length + 1).padStart(3, '0')}`;
        const [row] = await tx
          .insert(purchaseOrder)
          .values({
            tenantId: a.user.tenantId,
            contractId: id,
            workOrderId: body.workOrderId ?? null,
            number,
            description: body.description,
            amount: total.toFixed(2),
            lines: body.lines,
            status: blockedReason ? 'BLOCKED' : 'APPROVED',
            blockedReason,
            createdBy: a.user.id,
            createdAt: now,
          })
          .returning();
        await d.audit.record(tx, a.ctx, {
          action: blockedReason ? 'contract.po_blocked' : 'contract.po_create',
          entityType: 'contract',
          entityId: id,
          after: { number, amount: total, reason: blockedReason },
          result: blockedReason ? 'DENIED' : 'SUCCESS',
        });
        return { po: row!, blockedReason };
      });
      if ('held' in out)
        throw new AppError(
          409,
          'PURCHASE_ORDER_HELD',
          `New purchase orders against ${out.contractNumber} are on hold: ${out.held}`,
        );
      if (out.blockedReason)
        throw new AppError(422, 'SPEND_CEILING', out.blockedReason, [
          { field: 'lines', message: `${out.po.number} was recorded as blocked` },
        ]);
      return reply.status(201).send(poView(out.po));
    },
  );

  const poView = (r: typeof purchaseOrder.$inferSelect) => ({
    id: r.id,
    number: r.number,
    description: r.description,
    amount: Number(r.amount),
    lines: toLines(r.lines),
    status: r.status,
    blockedReason: r.blockedReason,
    workOrderId: r.workOrderId,
    createdAt: r.createdAt.toISOString(),
  });

  reg('GET', '/contracts/{id}/purchase-orders');
  app.get(`${p}/contracts/:id/purchase-orders`, { preHandler: guard(d, READERS) }, async (req) => {
    const a = req.auth!;
    const id = cid(req);
    return withContext(d.database, a.ctx, async (tx) => {
      await x.load(tx, a, id);
      const rows = await tx
        .select()
        .from(purchaseOrder)
        .where(eq(purchaseOrder.contractId, id))
        .orderBy(asc(purchaseOrder.number));
      return rows.map(poView);
    });
  });

  // ---------------------------------------------------------------- invoices and the three-way match (FR-0500, FR-0525)
  reg('POST', '/contracts/{id}/invoices');
  app.post(
    `${p}/contracts/:id/invoices`,
    { preHandler: guard(d, ['FINANCE', 'CONTRACT_MGR']) },
    async (req, reply) => {
      const a = req.auth!;
      const id = cid(req);
      const body = parse(invoiceBody, req.body);
      const out = await withContext(d.database, a.ctx, async (tx) => {
        const c = await target(tx, a, id);
        const settings = await loadSettings(tx, a.user.tenantId);
        const now = d.clock.now();
        let po: typeof purchaseOrder.$inferSelect | undefined;
        if (body.poId) {
          [po] = await tx
            .select()
            .from(purchaseOrder)
            .where(and(eq(purchaseOrder.id, body.poId), eq(purchaseOrder.contractId, id)));
          if (!po || po.status !== 'APPROVED')
            throw new AppError(422, 'PO_NOT_FOUND', 'Choose an approved purchase order of this contract');
        }
        const rates = new Map(
          (await tx.select().from(contractRate).where(eq(contractRate.contractId, id))).map((r) => [
            r.item,
            Number(r.unitPrice),
          ]),
        );
        const prior = po
          ? (await tx.select().from(invoice).where(eq(invoice.poId, po.id))).filter((i) =>
              (COUNTED as readonly string[]).includes(i.status),
            )
          : [];
        const invoicedQty = new Map<string, number>();
        for (const i of prior)
          for (const l of toLines(i.lines))
            invoicedQty.set(l.item.toLowerCase(), (invoicedQty.get(l.item.toLowerCase()) ?? 0) + l.qty);
        const findings = matchInvoice({
          invoiceDate: body.invoiceDate,
          lines: body.lines,
          rates,
          escalations: await escalationRows(tx, id),
          po: po
            ? {
                number: po.number,
                amount: Number(po.amount),
                lines: toLines(po.lines),
                invoicedQty,
                invoicedAmount: prior.reduce((s, i) => s + Number(i.amount), 0),
              }
            : null,
          requirePo: settings.contractManagement.erpIntegrated,
        });
        const blocked = findings.some((f) => f.severity === 'BLOCK');
        const n = (await tx.select({ id: invoice.id }).from(invoice).where(eq(invoice.contractId, id)))
          .length;
        const number = body.number ?? `INV-${c.number}-${String(n + 1).padStart(3, '0')}`;
        const dup = await tx
          .select({ id: invoice.id })
          .from(invoice)
          .where(and(eq(invoice.tenantId, a.user.tenantId), eq(invoice.number, number)));
        if (dup.length)
          throw new AppError(409, 'DUPLICATE_INVOICE', `Invoice ${number} has already been recorded`);
        const total = lineTotal(body.lines);
        const [row] = await tx
          .insert(invoice)
          .values({
            tenantId: a.user.tenantId,
            contractId: id,
            workOrderId: body.workOrderId ?? po?.workOrderId ?? null,
            poId: po?.id ?? null,
            number,
            invoiceDate: body.invoiceDate,
            amount: total.toFixed(2),
            lines: body.lines,
            status: blocked ? 'BLOCKED' : 'MATCHED',
            findings,
            createdBy: a.user.id,
            createdAt: now,
          })
          .returning();
        await d.audit.record(tx, a.ctx, {
          action: blocked ? 'contract.invoice_blocked' : 'contract.invoice_matched',
          entityType: 'contract',
          entityId: id,
          after: {
            number,
            amount: total,
            findings: findings.map((f) => f.code),
          },
          result: blocked ? 'DENIED' : 'SUCCESS',
        });
        const raised = blocked ? [] : await raiseSpendAlerts(tx, d.audit, a.ctx, c, settings, now);
        return {
          invoice: invoiceView(row!, { contractNumber: c.number, poNumber: po?.number ?? null }),
          spendAlerts: raised,
        };
      });
      return reply.status(201).send(out);
    },
  );

  reg('GET', '/contracts/{id}/invoices');
  app.get(`${p}/contracts/:id/invoices`, { preHandler: guard(d, READERS) }, async (req) => {
    const a = req.auth!;
    const id = cid(req);
    return withContext(d.database, a.ctx, async (tx) => {
      const c = await x.load(tx, a, id);
      const rows = await tx
        .select({ i: invoice, po: purchaseOrder.number, wo: workOrder.number })
        .from(invoice)
        .leftJoin(purchaseOrder, eq(purchaseOrder.id, invoice.poId))
        .leftJoin(workOrder, eq(workOrder.id, invoice.workOrderId))
        .where(eq(invoice.contractId, id))
        .orderBy(desc(invoice.invoiceDate), desc(invoice.number));
      return rows.map((r) =>
        invoiceView(r.i, { contractNumber: c.number, poNumber: r.po, workOrderNumber: r.wo }),
      );
    });
  });

  reg('GET', '/invoices');
  app.get(
    `${p}/invoices`,
    { preHandler: guard(d, ['FINANCE', 'CONTRACT_MGR', 'PROCUREMENT', 'EXEC']) },
    async (req) => {
      const a = req.auth!;
      const q = parse(
        z.object({ status: z.enum(['MATCHED', 'BLOCKED', 'EXCEPTION', 'PAID']).optional() }),
        req.query,
      );
      return withContext(d.database, a.ctx, async (tx) => {
        const rows = await tx
          .select({ i: invoice, c: contract, po: purchaseOrder.number, wo: workOrder.number })
          .from(invoice)
          .innerJoin(contract, eq(contract.id, invoice.contractId))
          .leftJoin(purchaseOrder, eq(purchaseOrder.id, invoice.poId))
          .leftJoin(workOrder, eq(workOrder.id, invoice.workOrderId))
          .where(and(eq(invoice.tenantId, a.user.tenantId), isNull(contract.deletedAt)))
          .orderBy(desc(invoice.createdAt));
        const out = [];
        for (const r of rows) {
          if (q.status && r.i.status !== q.status) continue;
          if (!(await canSee(tx, a, r.c))) continue;
          out.push(invoiceView(r.i, { contractNumber: r.c.number, poNumber: r.po, workOrderNumber: r.wo }));
        }
        return out;
      });
    },
  );

  async function loadInvoice(tx: Tx, a: AuthContext, id: string) {
    const [i] = await tx
      .select()
      .from(invoice)
      .where(and(eq(invoice.id, id), eq(invoice.tenantId, a.user.tenantId)));
    if (!i) throw new AppError(404, 'NOT_FOUND', 'Invoice not found');
    const [c] = await tx.select().from(contract).where(eq(contract.id, i.contractId));
    if (!c || !(await canSee(tx, a, c))) throw new AppError(404, 'NOT_FOUND', 'Invoice not found');
    return { i, c };
  }

  reg('POST', '/invoices/{id}/override');
  app.post(`${p}/invoices/:id/override`, { preHandler: guard(d, ['FINANCE', 'EXEC']) }, async (req) => {
    const a = req.auth!;
    const id = cid(req);
    const body = parse(overrideBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const { i, c } = await loadInvoice(tx, a, id);
      if (i.status !== 'BLOCKED')
        throw new AppError(409, 'INVALID_STATE', 'Only a blocked invoice can be released as an exception');
      const [row] = await tx
        .update(invoice)
        .set({ status: 'EXCEPTION', overrideBy: a.user.id, overrideReason: body.reason })
        .where(eq(invoice.id, id))
        .returning();
      await d.audit.record(tx, a.ctx, {
        action: 'contract.invoice_override',
        entityType: 'contract',
        entityId: c.id,
        before: {
          number: i.number,
          status: 'BLOCKED',
          findings: (i.findings as Finding[]).map((f) => f.code),
        },
        after: { number: i.number, status: 'EXCEPTION', reason: body.reason },
      });
      await raiseSpendAlerts(tx, d.audit, a.ctx, c, await loadSettings(tx, a.user.tenantId), d.clock.now());
      return invoiceView(row!, { contractNumber: c.number });
    });
  });

  reg('POST', '/invoices/{id}/pay');
  app.post(`${p}/invoices/:id/pay`, { preHandler: guard(d, ['FINANCE']) }, async (req) => {
    const a = req.auth!;
    const id = cid(req);
    return withContext(d.database, a.ctx, async (tx) => {
      const { i, c } = await loadInvoice(tx, a, id);
      if (!['MATCHED', 'EXCEPTION'].includes(i.status))
        throw new AppError(
          409,
          'INVALID_STATE',
          i.status === 'BLOCKED' ? 'A blocked invoice cannot be paid until it is released' : 'Already paid',
        );
      // a payment already proposed, in flight or confirmed through the payment run (FR-0875) means this invoice cannot also be marked paid by hand
      const [runPay] = await tx
        .select({ id: payment.id })
        .from(payment)
        .where(
          and(
            eq(payment.invoiceId, id),
            inArray(payment.status, ['PROPOSED', 'APPROVED', 'SENT', 'CONFIRMED']),
          ),
        )
        .limit(1);
      if (runPay)
        throw new AppError(
          409,
          'PAYMENT_IN_PROGRESS',
          'A payment for this invoice is already in the payment run; it cannot also be recorded as paid by hand',
        );
      const [row] = await tx
        .update(invoice)
        .set({ status: 'PAID', paidAmount: i.amount, paidOn: iso(d.clock.now()) })
        .where(eq(invoice.id, id))
        .returning();
      await d.audit.record(tx, a.ctx, {
        action: 'contract.invoice_pay',
        entityType: 'contract',
        entityId: c.id,
        after: { number: i.number, amount: Number(i.amount) },
      });
      return invoiceView(row!, { contractNumber: c.number });
    });
  });

  // ---------------------------------------------------------------- live spend (FR-0580)
  reg('GET', '/contracts/{id}/spend');
  app.get(`${p}/contracts/:id/spend`, { preHandler: guard(d, READERS) }, async (req) => {
    const a = req.auth!;
    const id = cid(req);
    return withContext(d.database, a.ctx, async (tx) => {
      const c = await x.load(tx, a, id);
      const settings = await loadSettings(tx, a.user.tenantId);
      const s = await spendSummary(tx, c, settings, today());
      const names = new Map(
        (
          await tx
            .select({ id: appUser.id, name: appUser.name })
            .from(appUser)
            .where(
              inArray(
                appUser.id,
                [c.ownerId].filter((v): v is string => !!v),
              ),
            )
        ).map((u) => [u.id, u.name]),
      );
      return {
        ...s,
        owner: c.ownerId ? (names.get(c.ownerId) ?? null) : null,
        endDate: (await effectiveEnd(tx, c)) ?? c.endDate,
      };
    });
  });

  registerContractB5Part2(app, p, d, reg, x);
}
