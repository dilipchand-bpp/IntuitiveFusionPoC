/**
 * Contract endpoints (M10): US-CON-01 draft from the approved evaluation, US-CON-03 signing under a separate signing
 * authority, US-CON-04 lock on execution. The deviation register (US-CON-02) is derived read-only from the clauses
 * changed from the template; variations (US-CON-05) stay a stub.
 */
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Clock, RoleName } from '@if/shared';
import type { AuditService } from '../../audit/audit-service.js';
import { guard, type AuthContext, type GuardDeps } from '../../auth/guard.js';
import { checkDelegation } from '../../authz/delegation.js';
import { checkSod } from '../../authz/sod.js';
import { withContext, type Tx } from '../../db/client.js';
import {
  alert,
  alertDelivery,
  appUser,
  approval,
  clause,
  consensusItem,
  contract,
  contractExtension,
  contractMilestone,
  evaluation,
  fieldValue,
  notification,
  request,
  roleAssignment,
  supplier,
  template,
  tender,
  tenant,
} from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { addDays, addMonths, daysBetween, iso, termBars } from './dates.js';
import { AlertService, createContractRecord } from './record.js';
import { EvaluationService } from '../evaluation/service.js';
import {
  assembleClauses,
  nextNumber,
  pickTemplate,
  releaseBlockers,
  requiredSigners,
  type ContractFacts,
  type TemplateBody,
} from './clauses.js';

export interface ContractDeps extends GuardDeps {
  clock: Clock;
  audit: AuditService;
  schedulerMinutes?: number | undefined;
}

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-31');
const aud = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const READERS: RoleName[] = [
  'PROCUREMENT',
  'LEGAL',
  'CONTRACT_MGR',
  'DELEGATE',
  'EXEC',
  'FINANCE',
  'PROBITY',
];

const createBody = z
  .object({
    evaluationId: uuid,
    supplierId: uuid,
    value: z.number().positive().max(1e10).optional(),
    startDate: isoDate.optional(),
    endDate: isoDate.optional(),
  })
  .strict();
const termsBody = z
  .object({
    value: z.number().positive().max(1e10).optional(),
    startDate: isoDate.optional(),
    endDate: isoDate.optional(),
    noticeDays: z.number().int().min(0).max(365).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to change' });
const clauseBody = z
  .object({
    text: z.string().trim().min(1).max(8000),
    title: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
const signBody = z
  .object({ decision: z.enum(['APPROVE', 'REJECT']), comment: z.string().trim().max(2000).optional() })
  .strict();
const deleteBody = z.object({ reason: z.string().trim().min(10).max(1000) }).strict();

export function registerContractRoutes(app: FastifyInstance, p: string, d: ContractDeps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);
  const evals = new EvaluationService(d.clock, d.audit);
  const alerts = new AlertService(d.clock, d.audit);
  if (d.schedulerMinutes) {
    const h = setInterval(
      () => void alerts.runDue(d.database).catch(() => undefined),
      d.schedulerMinutes * 60_000,
    );
    h.unref();
    app.addHook('onClose', async () => clearInterval(h));
  }
  const cid = (req: FastifyRequest) => parse(z.object({ id: uuid }), req.params).id;

  async function notifyRoles(
    tx: Tx,
    tenantId: string,
    roles: RoleName[],
    title: string,
    body: string,
    link: string,
  ) {
    const rows = await tx
      .select({ userId: roleAssignment.userId })
      .from(roleAssignment)
      .where(and(eq(roleAssignment.tenantId, tenantId), inArray(roleAssignment.role, roles)));
    for (const userId of new Set(rows.map((r) => r.userId)))
      await tx.insert(notification).values({ tenantId, userId, title, body, link });
  }

  async function templateFor(tx: Tx, tenantId: string, tenderType: string) {
    const rows = await tx
      .select()
      .from(template)
      .where(
        and(eq(template.tenantId, tenantId), eq(template.type, 'CONTRACT'), eq(template.status, 'ACTIVE')),
      );
    return pickTemplate(rows, tenderType);
  }

  async function factsFor(
    tx: Tx,
    tenantId: string,
    c: typeof contract.$inferSelect,
  ): Promise<{ facts: ContractFacts; tenderType: string | null; requestId: string | null }> {
    const [t] = await tx.select({ name: tenant.name }).from(tenant).where(eq(tenant.id, tenantId));
    const [s] = await tx.select().from(supplier).where(eq(supplier.id, c.supplierId));
    let req: typeof request.$inferSelect | undefined;
    let tenderType: string | null = null;
    if (c.tenderId) {
      const [td] = await tx.select().from(tender).where(eq(tender.id, c.tenderId));
      tenderType = td?.type ?? null;
      if (td) [req] = await tx.select().from(request).where(eq(request.id, td.requestId));
    }
    let sla = 'as set out in the tender requirements and the Supplier response.';
    if (req) {
      const [f] = await tx
        .select()
        .from(fieldValue)
        .where(
          and(
            eq(fieldValue.ownerType, 'REQUEST'),
            eq(fieldValue.ownerId, req.id),
            eq(fieldValue.key, 'deliverables'),
          ),
        );
      const v = (f?.value ?? '').replace(/\s+/g, ' ').trim();
      if (v) sla = v.length > 400 ? `${v.slice(0, 397)}...` : v;
    }
    return {
      tenderType,
      requestId: req?.id ?? null,
      facts: {
        customer: t?.name ?? 'The Customer',
        supplier: s?.company ?? 'The Supplier',
        abn: s?.abn ?? '',
        title: req?.title ?? 'the services',
        requestNumber: req?.number ?? '',
        value: Number(c.value),
        startDate: c.startDate ?? '',
        endDate: c.endDate ?? '',
        noticeDays: c.noticeDays,
        serviceLevels: sla,
      },
    };
  }

  async function templateClauses(tx: Tx, tenantId: string, c: typeof contract.$inferSelect) {
    const { facts, tenderType } = await factsFor(tx, tenantId, c);
    const tpl = c.templateId
      ? (await tx.select().from(template).where(eq(template.id, c.templateId)))[0]
      : tenderType
        ? await templateFor(tx, tenantId, tenderType)
        : null;
    const body = tpl?.body as Partial<TemplateBody> | undefined;
    const lib = body?.clauses ? assembleClauses(body as TemplateBody, facts) : [];
    return { facts, lib, tpl };
  }

  /** Signatures still in force, with names. Superseded ones (after a return to legal) are not counted. */
  async function signaturesOf(tx: Tx, tenantId: string, contractId: string) {
    const rows = await tx
      .select({ a: approval, name: appUser.name })
      .from(approval)
      .innerJoin(appUser, eq(appUser.id, approval.userId))
      .where(
        and(
          eq(approval.tenantId, tenantId),
          eq(approval.subjectType, 'CONTRACT'),
          eq(approval.subjectId, contractId),
        ),
      )
      .orderBy(asc(approval.decidedAt));
    return rows.map((r) => ({
      id: r.a.id,
      userId: r.a.userId,
      userName: r.name,
      role: r.a.role,
      decision: r.a.decision,
      comment: r.a.comment,
      decidedAt: r.a.decidedAt.toISOString(),
      stamp: r.a.stamp,
    }));
  }

  async function summary(tx: Tx, tenantId: string, c: typeof contract.$inferSelect) {
    const [s] = await tx
      .select({ company: supplier.company })
      .from(supplier)
      .where(eq(supplier.id, c.supplierId));
    let req: { number: string; title: string } | undefined;
    if (c.tenderId) {
      const [td] = await tx.select().from(tender).where(eq(tender.id, c.tenderId));
      if (td)
        [req] = await tx
          .select({ number: request.number, title: request.title })
          .from(request)
          .where(eq(request.id, td.requestId));
    }
    const sigs = (await signaturesOf(tx, tenantId, c.id)).filter((x) => x.decision === 'APPROVED');
    return {
      id: c.id,
      number: c.number,
      status: c.status,
      value: Number(c.value),
      supplierId: c.supplierId,
      supplierName: s?.company ?? '',
      title: req?.title ?? null,
      requestNumber: req?.number ?? null,
      templateId: c.templateId,
      startDate: c.startDate,
      endDate: c.endDate,
      noticeDays: c.noticeDays,
      locked: c.locked,
      tenderId: c.tenderId,
      version: c.version,
      signed: sigs.length,
      signaturesRequired: requiredSigners(Number(c.value)).length,
    };
  }

  /** The management record: owner, milestones, extensions with their end dates, and the alerts with their delivery log. */
  async function recordOf(tx: Tx, c: typeof contract.$inferSelect) {
    const [owner] = c.ownerId
      ? await tx.select({ id: appUser.id, name: appUser.name }).from(appUser).where(eq(appUser.id, c.ownerId))
      : [];
    const milestones = await tx
      .select()
      .from(contractMilestone)
      .where(eq(contractMilestone.contractId, c.id))
      .orderBy(asc(contractMilestone.dueDate));
    const ext = await tx
      .select()
      .from(contractExtension)
      .where(eq(contractExtension.contractId, c.id))
      .orderBy(asc(contractExtension.position));
    const months = ext.map((e) => e.months);
    const list = await tx
      .select()
      .from(alert)
      .where(eq(alert.contractId, c.id))
      .orderBy(asc(alert.triggerDate));
    const deliveries = list.length
      ? await tx
          .select()
          .from(alertDelivery)
          .where(
            inArray(
              alertDelivery.alertId,
              list.map((x) => x.id),
            ),
          )
      : [];
    const bars = c.startDate && c.endDate ? termBars(c.startDate, c.endDate, months) : [];
    return {
      owner: owner ?? null,
      milestones: milestones.map((m) => ({ id: m.id, title: m.title, dueDate: m.dueDate })),
      extensions: bars.filter((b) => b.optional),
      bars,
      alerts: list.map((x) =>
        alertView(
          x,
          deliveries.filter((y) => y.alertId === x.id),
        ),
      ),
    };
  }
  function alertView(x: typeof alert.$inferSelect, dl: Array<typeof alertDelivery.$inferSelect>) {
    return {
      id: x.id,
      contractId: x.contractId,
      kind: x.kind,
      triggerDate: x.triggerDate,
      recipientRule: x.recipientRule,
      status: x.status,
      origin: x.origin,
      sentAt: x.sentAt?.toISOString() ?? null,
      deliveries: dl.map((y) => ({
        channel: y.channel,
        status: y.status,
        deliveredAt: y.deliveredAt.toISOString(),
      })),
    };
  }

  async function view(tx: Tx, a: AuthContext, c: typeof contract.$inferSelect) {
    const base = await summary(tx, a.user.tenantId, c);
    const clauses = await tx.select().from(clause).where(eq(clause.contractId, c.id)).orderBy(asc(clause.id));
    const { lib } = await templateClauses(tx, a.user.tenantId, c);
    const libBy = new Map(lib.map((x, i) => [x.clauseId, { x, i }]));
    const ordered = [...clauses].sort(
      (x, y) => (libBy.get(x.clauseId)?.i ?? 99) - (libBy.get(y.clauseId)?.i ?? 99),
    );
    const signatures = await signaturesOf(tx, a.user.tenantId, c.id);
    const live = signatures.filter((s) => s.decision === 'APPROVED');
    const chain = requiredSigners(Number(c.value)).map((s) => {
      const sig = live.find((x) => x.role === s.role);
      return { role: s.role, label: s.label, signedBy: sig?.userName ?? null, stamp: sig?.stamp ?? null };
    });
    const roles = a.user.roles;
    const editable = !c.locked && ['DRAFT', 'LEGAL_REVIEW'].includes(c.status);
    const nextSigner = chain.find((s) => !s.signedBy && roles.includes(s.role as RoleName));
    const open = ['AWAITING_SIGNATURE', 'PARTIALLY_SIGNED'].includes(c.status) && !c.locked;
    let canSign = false;
    let signBlocked: string | null = null;
    if (open) {
      if (!nextSigner) {
        signBlocked = chain.some((s) => roles.includes(s.role as RoleName))
          ? 'You have already signed this contract'
          : null;
      } else {
        const del = await checkDelegation(
          tx,
          { tenantId: a.user.tenantId, userId: a.user.id, roles },
          'CONTRACT_SIGNING',
          Number(c.value),
        );
        canSign = del.allowed;
        if (!del.allowed)
          signBlocked =
            del.limit === null
              ? 'You do not hold contract signing authority. Sourcing approval does not confer it.'
              : `This contract (${aud.format(Number(c.value))}) is above your signing authority of ${aud.format(del.limit)}`;
      }
    }
    const record = await recordOf(tx, c);
    return {
      ...base,
      record,
      clauses: ordered.map((k) => ({
        id: k.clauseId,
        title: k.title,
        text: k.text,
        mandatory: k.mandatory,
        changedFromTemplate: k.changedFromTemplate,
      })),
      deviations: ordered
        .filter((k) => k.changedFromTemplate)
        .map((k) => ({
          clauseId: k.clauseId,
          title: k.title,
          mandatory: k.mandatory,
          templateText: libBy.get(k.clauseId)?.x.text ?? '',
          currentText: k.text,
        })),
      signatures,
      chain,
      permissions: {
        canEdit: editable && roles.includes('LEGAL'),
        canEditTerms: editable && (roles.includes('LEGAL') || roles.includes('PROCUREMENT')),
        canRelease:
          editable &&
          (roles.includes('LEGAL') || (roles.includes('PROCUREMENT') && c.status === 'LEGAL_REVIEW')),
        canSign,
        signBlocked,
        canDelete: roles.includes('LEGAL') || roles.includes('EXEC'),
      },
    };
  }

  async function load(tx: Tx, a: AuthContext, id: string) {
    const [c] = await tx
      .select()
      .from(contract)
      .where(and(eq(contract.id, id), eq(contract.tenantId, a.user.tenantId), isNull(contract.deletedAt)));
    if (!c) throw new AppError(404, 'NOT_FOUND', 'Contract not found');
    return c;
  }
  const locked = () => new AppError(423, 'CONTRACT_LOCKED', 'This contract is executed and locked');

  // ------------------------------------------------------------ alerts and expiry (M11)
  const MANAGERS: RoleName[] = ['CONTRACT_MGR', 'PROCUREMENT', 'LEGAL', 'EXEC'];

  reg('GET', '/contracts/{id}/alerts');
  app.get(`${p}/contracts/:id/alerts`, { preHandler: guard(d, MANAGERS) }, async (req) => {
    const a = req.auth!;
    const id = cid(req);
    await alerts.runDue(d.database);
    return withContext(d.database, a.ctx, async (tx) => {
      const c = await load(tx, a, id);
      return (await recordOf(tx, c)).alerts;
    });
  });

  reg('GET', '/alerts');
  app.get(`${p}/alerts`, { preHandler: guard(d, MANAGERS) }, async (req) => {
    const a = req.auth!;
    const q = parse(z.object({ status: z.enum(['SCHEDULED', 'SENT', 'CANCELLED']).optional() }), req.query);
    await alerts.runDue(d.database);
    return withContext(d.database, a.ctx, async (tx) => {
      const rows = await tx
        .select({ a: alert, number: contract.number, endDate: contract.endDate })
        .from(alert)
        .innerJoin(contract, eq(contract.id, alert.contractId))
        .where(and(eq(alert.tenantId, a.user.tenantId), isNull(contract.deletedAt)))
        .orderBy(asc(alert.triggerDate));
      const dl = rows.length
        ? await tx
            .select()
            .from(alertDelivery)
            .where(
              inArray(
                alertDelivery.alertId,
                rows.map((r) => r.a.id),
              ),
            )
        : [];
      return rows
        .filter((r) => !q.status || r.a.status === q.status)
        .map((r) => ({
          ...alertView(
            r.a,
            dl.filter((y) => y.alertId === r.a.id),
          ),
          contractNumber: r.number,
          endDate: r.endDate,
        }));
    });
  });

  reg('GET', '/reports/expiring-contracts');
  app.get(`${p}/reports/expiring-contracts`, { preHandler: guard(d, MANAGERS) }, async (req) => {
    const a = req.auth!;
    const q = parse(z.object({ days: z.coerce.number().int().min(1).max(3650).default(90) }), req.query);
    const today = iso(d.clock.now());
    const horizon = addDays(today, q.days);
    return withContext(d.database, a.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(contract)
        .where(
          and(
            eq(contract.tenantId, a.user.tenantId),
            eq(contract.status, 'EXECUTED'),
            isNull(contract.deletedAt),
          ),
        );
      const out = [];
      for (const c of rows) {
        if (!c.endDate || c.endDate < today || c.endDate > horizon) continue;
        const s = await summary(tx, a.user.tenantId, c);
        const rec = await recordOf(tx, c);
        out.push({
          contractId: c.id,
          number: c.number,
          title: s.title,
          supplier: s.supplierName,
          value: s.value,
          owner: rec.owner?.name ?? null,
          startDate: c.startDate,
          endDate: c.endDate,
          noticeDeadline: addDays(c.endDate, -c.noticeDays),
          daysRemaining: daysBetween(today, c.endDate),
          optionalExtensions: rec.extensions.map((e) => ({
            months: Number(/\((\d+) months\)/.exec(e.label)?.[1] ?? 0),
            endDate: e.end,
          })),
          bars: rec.bars,
        });
      }
      return out.sort((x, y) => x.daysRemaining - y.daysRemaining);
    });
  });

  // ------------------------------------------------------------ awards waiting for a contract
  reg('GET', '/contracts/awards');
  app.get(`${p}/contracts/awards`, { preHandler: guard(d, ['LEGAL', 'PROCUREMENT']) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const evs = await tx
        .select()
        .from(evaluation)
        .where(and(eq(evaluation.tenantId, a.user.tenantId), eq(evaluation.status, 'APPROVED')));
      const out = [];
      for (const ev of evs) {
        const l = await evals.load(tx, a.user.tenantId, ev.id);
        if (!l) continue;
        const items = await tx.select().from(consensusItem).where(eq(consensusItem.evaluationId, ev.id));
        const ranking = await evals.ranking(l, items);
        const top = ranking.filter((r) => r.rank === 1 && r.compliance === 'PASS');
        const [existing] = await tx
          .select({ id: contract.id, number: contract.number })
          .from(contract)
          .where(and(eq(contract.tenderId, l.tender.id), isNull(contract.deletedAt)));
        out.push({
          evaluationId: ev.id,
          tenderId: l.tender.id,
          requestNumber: l.req.number,
          title: l.req.title,
          estimatedValue: Number(l.req.estimatedValue ?? 0),
          recommended: top.map((r) => ({
            supplierId: r.supplierId,
            company: r.displayName,
            score: Number(r.weightedScore.toFixed(1)),
          })),
          contractId: existing?.id ?? null,
          contractNumber: existing?.number ?? null,
        });
      }
      return out.sort((x, y) => x.requestNumber.localeCompare(y.requestNumber));
    });
  });

  // ------------------------------------------------------------ list / get
  reg('GET', '/contracts');
  app.get(`${p}/contracts`, { preHandler: guard(d, READERS) }, async (req) => {
    const a = req.auth!;
    const q = parse(
      z.object({ status: z.string().max(40).optional(), q: z.string().max(100).optional() }),
      req.query,
    );
    return withContext(d.database, a.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(contract)
        .where(and(eq(contract.tenantId, a.user.tenantId), isNull(contract.deletedAt)))
        .orderBy(desc(contract.number));
      const out = [];
      for (const c of rows) {
        if (q.status && c.status !== q.status) continue;
        const s = await summary(tx, a.user.tenantId, c);
        if (q.q) {
          const hay = `${s.number} ${s.supplierName} ${s.title ?? ''} ${s.requestNumber ?? ''}`.toLowerCase();
          if (!hay.includes(q.q.toLowerCase())) continue;
        }
        out.push(s);
      }
      return out;
    });
  });

  reg('GET', '/contracts/{id}');
  app.get(`${p}/contracts/:id`, { preHandler: guard(d, READERS) }, async (req) => {
    const a = req.auth!;
    const id = cid(req);
    return withContext(d.database, a.ctx, async (tx) => view(tx, a, await load(tx, a, id)));
  });

  // ------------------------------------------------------------ draft (US-CON-01)
  reg('POST', '/contracts');
  app.post(`${p}/contracts`, { preHandler: guard(d, ['LEGAL', 'PROCUREMENT']) }, async (req, reply) => {
    const a = req.auth!;
    const body = parse(createBody, req.body);
    const out = await withContext(d.database, a.ctx, async (tx) => {
      const l = await evals.load(tx, a.user.tenantId, body.evaluationId);
      if (!l) throw new AppError(404, 'NOT_FOUND', 'Evaluation not found');
      if (l.ev.status !== 'APPROVED')
        throw new AppError(
          409,
          'INVALID_STATE',
          'The evaluation report must be approved before a contract is drafted',
        );
      const items = await tx.select().from(consensusItem).where(eq(consensusItem.evaluationId, l.ev.id));
      const ranking = await evals.ranking(l, items);
      const winner = ranking.find((r) => r.supplierId === body.supplierId);
      if (!winner || winner.rank !== 1 || winner.compliance !== 'PASS')
        throw new AppError(
          422,
          'SUPPLIER_NOT_RECOMMENDED',
          'A contract can only be drafted for the supplier the approved report ranks first',
        );
      const [dup] = await tx
        .select({ number: contract.number })
        .from(contract)
        .where(and(eq(contract.tenderId, l.tender.id), isNull(contract.deletedAt)));
      if (dup)
        throw new AppError(409, 'CONTRACT_EXISTS', `Contract ${dup.number} already exists for this tender`);
      const tpl = await templateFor(tx, a.user.tenantId, l.tender.type);
      if (!tpl)
        throw new AppError(
          422,
          'NO_TEMPLATE',
          `No contract template is set up for a ${l.tender.type} tender`,
        );

      const today = d.clock.now().toISOString().slice(0, 10);
      const start = body.startDate ?? addDays(today, 14);
      const end = body.endDate ?? addMonths(start, l.req.termMonths ?? 12);
      if (end <= start)
        throw new AppError(400, 'VALIDATION_FAILED', 'The end date must be after the start date', [
          { field: 'endDate', message: 'Must be after the start date' },
        ]);
      const value = body.value ?? Number(l.req.estimatedValue ?? 0);
      if (!(value > 0))
        throw new AppError(
          422,
          'VALUE_REQUIRED',
          'The request has no estimated value; enter the contract value',
          [{ field: 'value', message: 'Enter the contract value' }],
        );
      const existing = await tx
        .select({ number: contract.number })
        .from(contract)
        .where(eq(contract.tenantId, a.user.tenantId));
      const number = nextNumber(
        d.clock.now().getUTCFullYear(),
        existing.map((x) => x.number),
      );
      const [row] = await tx
        .insert(contract)
        .values({
          tenantId: a.user.tenantId,
          number,
          tenderId: l.tender.id,
          supplierId: body.supplierId,
          templateId: tpl.id,
          status: 'DRAFT',
          value: value.toFixed(2),
          startDate: start,
          endDate: end,
          noticeDays: 90,
        })
        .returning();
      const { facts } = await factsFor(tx, a.user.tenantId, row!);
      for (const k of assembleClauses(tpl.body as TemplateBody, facts))
        await tx.insert(clause).values({ tenantId: a.user.tenantId, contractId: row!.id, ...k });
      await tx
        .update(tender)
        .set({ status: 'AWARDED', updatedAt: d.clock.now() })
        .where(eq(tender.id, l.tender.id));
      await d.audit.record(tx, a.ctx, {
        action: 'contract.draft',
        entityType: 'contract',
        entityId: row!.id,
        after: { number, evaluationId: l.ev.id, supplierId: body.supplierId, templateId: tpl.id, value },
      });
      await notifyRoles(
        tx,
        a.user.tenantId,
        ['LEGAL'],
        'Draft contract ready for review',
        `${number} ${l.req.title}`,
        `/app/contracts/${row!.id}`,
      );
      return view(tx, a, await load(tx, a, row!.id));
    });
    return reply.status(201).send(out);
  });

  // ------------------------------------------------------------ commercial terms of a draft
  reg('PATCH', '/contracts/{id}');
  app.patch(`${p}/contracts/:id`, { preHandler: guard(d, ['LEGAL', 'PROCUREMENT']) }, async (req) => {
    const a = req.auth!;
    const id = cid(req);
    const body = parse(termsBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const c = await load(tx, a, id);
      if (c.locked) throw locked();
      if (!['DRAFT', 'LEGAL_REVIEW'].includes(c.status))
        throw new AppError(
          409,
          'INVALID_STATE',
          'Return the contract from signing before changing its terms',
        );
      const next = {
        value: body.value ?? Number(c.value),
        startDate: body.startDate ?? c.startDate!,
        endDate: body.endDate ?? c.endDate!,
        noticeDays: body.noticeDays ?? c.noticeDays,
      };
      if (next.endDate <= next.startDate)
        throw new AppError(400, 'VALIDATION_FAILED', 'The end date must be after the start date', [
          { field: 'endDate', message: 'Must be after the start date' },
        ]);
      const { lib: before } = await templateClauses(tx, a.user.tenantId, c);
      await tx
        .update(contract)
        .set({
          value: next.value.toFixed(2),
          startDate: next.startDate,
          endDate: next.endDate,
          noticeDays: next.noticeDays,
          updatedAt: d.clock.now(),
          version: c.version + 1,
        })
        .where(eq(contract.id, id));
      const fresh = await load(tx, a, id);
      const { lib } = await templateClauses(tx, a.user.tenantId, fresh);
      // Clauses nobody edited follow the new facts; edited ones keep Legal's wording.
      const rows = await tx.select().from(clause).where(eq(clause.contractId, id));
      for (const k of rows) {
        const t = lib.find((x) => x.clauseId === k.clauseId);
        const was = before.find((x) => x.clauseId === k.clauseId);
        if (t && !k.changedFromTemplate && was && k.text === was.text)
          await tx.update(clause).set({ text: t.text }).where(eq(clause.id, k.id));
      }
      await d.audit.record(tx, a.ctx, {
        action: 'contract.terms_update',
        entityType: 'contract',
        entityId: id,
        before: {
          value: Number(c.value),
          startDate: c.startDate,
          endDate: c.endDate,
          noticeDays: c.noticeDays,
        },
        after: next,
      });
      return view(tx, a, await load(tx, a, id));
    });
  });

  // ------------------------------------------------------------ legal edit (change-tracked)
  reg('PUT', '/contracts/{id}/clauses/{clauseId}');
  app.put(`${p}/contracts/:id/clauses/:clauseId`, { preHandler: guard(d, ['LEGAL']) }, async (req) => {
    const a = req.auth!;
    const { id, clauseId } = parse(z.object({ id: uuid, clauseId: z.string().min(1).max(60) }), req.params);
    const body = parse(clauseBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const c = await load(tx, a, id);
      if (c.locked) throw locked();
      if (!['DRAFT', 'LEGAL_REVIEW'].includes(c.status))
        throw new AppError(
          409,
          'INVALID_STATE',
          'The contract is out for signature; return it to legal first',
        );
      const [k] = await tx
        .select()
        .from(clause)
        .where(and(eq(clause.contractId, id), eq(clause.clauseId, clauseId)));
      if (!k) throw new AppError(404, 'NOT_FOUND', 'Clause not found');
      if (k.mandatory && body.text.trim().length < 10)
        throw new AppError(422, 'MANDATORY_CLAUSE', 'A mandatory clause cannot be emptied', [
          { field: 'text', message: 'Mandatory clauses need real wording' },
        ]);
      const { lib } = await templateClauses(tx, a.user.tenantId, c);
      const tpl = lib.find((x) => x.clauseId === clauseId);
      const title = body.title ?? k.title;
      const changed = !tpl || tpl.text !== body.text.trim() || tpl.title !== title;
      await tx
        .update(clause)
        .set({ text: body.text.trim(), title, changedFromTemplate: changed })
        .where(eq(clause.id, k.id));
      if (c.status === 'DRAFT')
        await tx
          .update(contract)
          .set({ status: 'LEGAL_REVIEW', updatedAt: d.clock.now(), version: c.version + 1 })
          .where(eq(contract.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'contract.clause_edit',
        entityType: 'contract',
        entityId: id,
        after: { clauseId, changedFromTemplate: changed, mandatory: k.mandatory },
      });
      const v = await view(tx, a, await load(tx, a, id));
      return v.clauses.find((x) => x.id === clauseId);
    });
  });

  // ------------------------------------------------------------ release for signing
  reg('POST', '/contracts/{id}/release-for-signing');
  app.post(
    `${p}/contracts/:id/release-for-signing`,
    { preHandler: guard(d, ['LEGAL', 'PROCUREMENT']) },
    async (req) => {
      const a = req.auth!;
      const id = cid(req);
      return withContext(d.database, a.ctx, async (tx) => {
        const c = await load(tx, a, id);
        if (c.locked) throw locked();
        const isLegal = a.user.roles.includes('LEGAL');
        if (!['DRAFT', 'LEGAL_REVIEW'].includes(c.status) || (!isLegal && c.status !== 'LEGAL_REVIEW'))
          throw new AppError(
            409,
            'INVALID_STATE',
            c.status === 'DRAFT'
              ? 'Legal must review the draft before it is released'
              : 'The contract is already out for signature',
          );
        const clauses = await tx.select().from(clause).where(eq(clause.contractId, id));
        const blockers = releaseBlockers(
          { value: Number(c.value), startDate: c.startDate, endDate: c.endDate },
          clauses,
        );
        if (blockers.length)
          throw new AppError(
            422,
            'RELEASE_BLOCKED',
            'The contract cannot be released yet',
            blockers.map((m) => ({ field: 'contract', message: m })),
          );
        const now = d.clock.now();
        await tx
          .update(contract)
          .set({ status: 'AWAITING_SIGNATURE', updatedAt: now, version: c.version + 1 })
          .where(eq(contract.id, id));
        await d.audit.record(tx, a.ctx, {
          action: 'contract.release',
          entityType: 'contract',
          entityId: id,
          after: { number: c.number, signers: requiredSigners(Number(c.value)).map((s) => s.role) },
        });
        await notifyRoles(
          tx,
          a.user.tenantId,
          requiredSigners(Number(c.value)).map((s) => s.role as RoleName),
          'Contract awaiting your signature',
          `${c.number} (${aud.format(Number(c.value))})`,
          `/app/contracts/${id}`,
        );
        return view(tx, a, await load(tx, a, id));
      });
    },
  );

  // ------------------------------------------------------------ sign (US-CON-03) and lock (US-CON-04)
  reg('POST', '/contracts/{id}/sign');
  app.post(`${p}/contracts/:id/sign`, { preHandler: guard(d, ['DELEGATE', 'EXEC']) }, async (req) => {
    const a = req.auth!;
    const id = cid(req);
    const body = parse(signBody, req.body);
    const out = await withContext(d.database, a.ctx, async (tx) => {
      const c = await load(tx, a, id);
      if (c.locked) throw locked();
      if (!['AWAITING_SIGNATURE', 'PARTIALLY_SIGNED'].includes(c.status))
        throw new AppError(409, 'INVALID_STATE', 'The contract is not out for signature');
      const value = Number(c.value);
      const chain = requiredSigners(value);
      const sigs = (await signaturesOf(tx, a.user.tenantId, id)).filter((s) => s.decision === 'APPROVED');
      const mine = chain.filter((s) => a.user.roles.includes(s.role as RoleName));
      const slot = mine.find((s) => !sigs.some((x) => x.role === s.role));
      if (!slot) {
        if (mine.length) throw new AppError(409, 'ALREADY_SIGNED', 'You have already signed this contract');
        throw new AppError(403, 'NOT_A_SIGNATORY', 'You are not a signatory for this contract');
      }
      const now = d.clock.now();
      const stamp = (verb: string) =>
        `${verb} · ${a.user.name} · ${a.user.role.replace('_', ' ')} · ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

      if (body.decision === 'REJECT') {
        if ((body.comment ?? '').length < 5)
          throw new AppError(400, 'VALIDATION_FAILED', 'A reason is required', [
            { field: 'comment', message: 'Say why in at least 5 characters' },
          ]);
        for (const s of sigs)
          await tx.update(approval).set({ decision: 'SUPERSEDED' }).where(eq(approval.id, s.id));
        await tx.insert(approval).values({
          tenantId: a.user.tenantId,
          subjectType: 'CONTRACT',
          subjectId: id,
          userId: a.user.id,
          role: slot.role,
          decision: 'REJECTED',
          comment: body.comment ?? null,
          stamp: stamp('RETURNED TO LEGAL'),
          decidedAt: now,
        });
        await tx
          .update(contract)
          .set({ status: 'LEGAL_REVIEW', updatedAt: now, version: c.version + 1 })
          .where(eq(contract.id, id));
        await d.audit.record(tx, a.ctx, {
          action: 'contract.return',
          entityType: 'contract',
          entityId: id,
          after: { comment: body.comment, signaturesWithdrawn: sigs.length },
        });
        await notifyRoles(
          tx,
          a.user.tenantId,
          ['LEGAL', 'PROCUREMENT'],
          'Contract returned to legal',
          `${c.number}: ${body.comment}`,
          `/app/contracts/${id}`,
        );
        return view(tx, a, await load(tx, a, id));
      }

      // Signing authority is its own grant, looked up by scope; sourcing approval never counts.
      const del = await checkDelegation(
        tx,
        { tenantId: a.user.tenantId, userId: a.user.id, roles: a.user.roles },
        'CONTRACT_SIGNING',
        value,
      );
      if (!del.allowed) {
        const src = await checkDelegation(
          tx,
          { tenantId: a.user.tenantId, userId: a.user.id, roles: a.user.roles },
          'SOURCING_APPROVAL',
          value,
        );
        const sod = checkSod('SIGN_CONTRACT', {
          roles: a.user.roles as RoleName[],
          hasSigningDelegation: false,
          approvedSourcing: src.allowed,
        });
        // A thrown error rolls the transaction back (and the audit row with it), so the refusal is returned and recorded after.
        return {
          denied: {
            limit: del.limit,
            title:
              del.limit === null
                ? sod.ok
                  ? 'You do not hold contract signing authority'
                  : sod.message
                : `This contract (${aud.format(value)}) is above your signing authority of ${aud.format(del.limit)}`,
          },
        };
      }

      await tx.insert(approval).values({
        tenantId: a.user.tenantId,
        subjectType: 'CONTRACT',
        subjectId: id,
        userId: a.user.id,
        role: slot.role,
        decision: 'APPROVED',
        comment: body.comment ?? null,
        stamp: stamp('SIGNED'),
        decidedAt: now,
      });
      const complete = chain.every((s) => s.role === slot.role || sigs.some((x) => x.role === s.role));
      if (!complete) {
        await tx
          .update(contract)
          .set({ status: 'PARTIALLY_SIGNED', updatedAt: now, version: c.version + 1 })
          .where(eq(contract.id, id));
        await d.audit.record(tx, a.ctx, {
          action: 'contract.sign',
          entityType: 'contract',
          entityId: id,
          after: { role: slot.role, value, limit: del.limit, status: 'PARTIALLY_SIGNED' },
        });
        await notifyRoles(
          tx,
          a.user.tenantId,
          chain.filter((s) => s.role !== slot.role).map((s) => s.role as RoleName),
          'Contract awaiting your signature',
          `${c.number}: signed by ${a.user.name}`,
          `/app/contracts/${id}`,
        );
      } else {
        // Execution: lock the contract (the database now refuses any change to terms and clauses).
        await tx
          .update(contract)
          .set({ status: 'EXECUTED', locked: true, updatedAt: now, version: c.version + 1 })
          .where(eq(contract.id, id));
        // US-CMG-01/02: the management record (owner, milestones, optional extensions) and the system alerts
        const { tpl } = await templateClauses(tx, a.user.tenantId, c);
        const record = await createContractRecord(tx, c, {
          extensions: (tpl?.body as Partial<TemplateBody> | undefined)?.extensions ?? [],
          today: now.toISOString().slice(0, 10),
        });
        await d.audit.record(tx, a.ctx, {
          action: 'contract.sign',
          entityType: 'contract',
          entityId: id,
          after: { role: slot.role, value, limit: del.limit, status: 'EXECUTED' },
        });
        await d.audit.record(tx, a.ctx, {
          action: 'contract.execute',
          entityType: 'contract',
          entityId: id,
          after: {
            number: c.number,
            locked: true,
            ownerId: record.ownerId,
            milestones: record.milestones.length,
            alerts: record.alerts.length,
          },
        });
        await notifyRoles(
          tx,
          a.user.tenantId,
          ['PROCUREMENT', 'LEGAL', 'CONTRACT_MGR'],
          'Contract executed',
          `${c.number} is signed and locked`,
          `/app/contracts/${id}`,
        );
      }
      return view(tx, a, await load(tx, a, id));
    });
    if ('denied' in out) {
      await d.audit.recordOutsideTx(d.database, a.ctx, {
        action: 'contract.sign',
        entityType: 'contract',
        entityId: id,
        after: { reason: 'SIGNING_AUTHORITY_INSUFFICIENT', limit: out.denied.limit },
        result: 'DENIED',
      });
      throw new AppError(403, 'SIGNING_AUTHORITY_INSUFFICIENT', out.denied.title);
    }
    return out;
  });

  // ------------------------------------------------------------ logical delete (NFR-CA02)
  reg('DELETE', '/contracts/{id}');
  app.delete(`${p}/contracts/:id`, { preHandler: guard(d, ['LEGAL', 'EXEC']) }, async (req, reply) => {
    const a = req.auth!;
    const id = cid(req);
    const body = parse(deleteBody, req.body);
    await withContext(d.database, a.ctx, async (tx) => {
      const c = await load(tx, a, id);
      const now = d.clock.now();
      await tx
        .update(contract)
        .set({ deletedAt: now, updatedAt: now, version: c.version + 1 })
        .where(eq(contract.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'contract.delete',
        entityType: 'contract',
        entityId: id,
        after: { number: c.number, status: c.status, locked: c.locked, reason: body.reason, logical: true },
      });
    });
    return reply.status(204).send();
  });

  return done;
}
