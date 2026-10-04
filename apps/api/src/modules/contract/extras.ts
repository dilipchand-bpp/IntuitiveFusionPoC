/**
 * Contract endpoints added after M11 (M12b): editing the management record, variations (US-CON-05), the deviation
 * register's risk ratings and delegate decisions (US-CON-02), and plain-language custom alerts (US-CMG-03).
 */
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RoleName } from '@if/shared';
import { guard, type AuthContext } from '../../auth/guard.js';
import { withContext, type Tx } from '../../db/client.js';
import {
  alert,
  approval,
  clause,
  contract,
  contractExtension,
  contractMilestone,
  roleAssignment,
} from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { loadSettings } from '../settings/settings.js';
import { isProtected } from './b4-rules.js';
import { parseAlert } from './alert-text.js';
import { iso } from './dates.js';
import { effectiveEnd, rescheduleAlerts, type AlertService } from './record.js';
import type { ContractDeps } from './routes.js';

type ContractRow = typeof contract.$inferSelect;
type AlertRow = typeof alert.$inferSelect;

export interface ContractCtx {
  load: (tx: Tx, a: AuthContext, id: string) => Promise<ContractRow>;
  view: (tx: Tx, a: AuthContext, c: ContractRow) => Promise<unknown>;
  recordOf: (tx: Tx, c: ContractRow) => Promise<unknown>;
  alertView: (x: AlertRow, dl: []) => unknown;
  notifyRoles: (
    tx: Tx,
    tenantId: string,
    roles: RoleName[],
    title: string,
    body: string,
    link: string,
  ) => Promise<void>;
  variationsOf: (tx: Tx, c: ContractRow) => Promise<ContractRow[]>;
  authorityValue: (tx: Tx, c: ContractRow) => Promise<number>;
  deviationDecisions: (tx: Tx, tenantId: string, ids: string[]) => Promise<Map<string, unknown>>;
  alerts: AlertService;
}

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-31');
const aud = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const RECORD_EDITORS: RoleName[] = ['CONTRACT_MGR', 'LEGAL', 'PROCUREMENT'];

const milestonesBody = z
  .object({
    milestones: z
      .array(z.object({ title: z.string().trim().min(1).max(120), dueDate: isoDate }).strict())
      .max(20),
  })
  .strict();
const extensionsBody = z.object({ extensions: z.array(z.number().int().min(1).max(60)).max(5) }).strict();
const ownerBody = z.object({ ownerId: uuid }).strict();
const variationBody = z
  .object({
    reason: z.string().trim().min(10).max(1000),
    value: z.number().min(0).max(1e10),
    endDate: isoDate.optional(),
  })
  .strict();
const riskBody = z.object({ risk: z.enum(['LOW', 'MEDIUM', 'HIGH']) }).strict();
const decisionBody = z
  .object({ decision: z.enum(['APPROVE', 'REJECT']), comment: z.string().trim().max(2000).optional() })
  .strict();
const alertBody = z.object({ instruction: z.string().trim().min(5).max(500) }).strict();

export function registerContractExtras(
  app: FastifyInstance,
  p: string,
  d: ContractDeps,
  reg: (m: string, path: string) => void,
  x: ContractCtx,
) {
  const cid = (req: { params: unknown }) => parse(z.object({ id: uuid }), req.params).id;
  const today = () => iso(d.clock.now());

  /** The record of an executed contract can be changed; variations belong to their parent. */
  async function recordTarget(tx: Tx, a: AuthContext, id: string) {
    const c = await x.load(tx, a, id);
    if (c.status !== 'EXECUTED' || c.parentId)
      throw new AppError(409, 'INVALID_STATE', 'Only an executed contract has a management record to edit');
    return c;
  }

  // ------------------------------------------------------------ edit the management record (M11 follow-up)
  reg('PUT', '/contracts/{id}/milestones');
  app.put(`${p}/contracts/:id/milestones`, { preHandler: guard(d, RECORD_EDITORS) }, async (req) => {
    const a = req.auth!;
    const id = cid(req);
    const body = parse(milestonesBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const c = await recordTarget(tx, a, id);
      const end = (await effectiveEnd(tx, c)) ?? c.endDate!;
      const bad = body.milestones.filter((m) => m.dueDate < c.startDate! || m.dueDate > end);
      if (bad.length)
        throw new AppError(
          422,
          'MILESTONE_OUTSIDE_TERM',
          `Milestones must fall between ${c.startDate} and ${end}`,
          bad.map((m) => ({ field: 'milestones', message: `"${m.title}" is on ${m.dueDate}` })),
        );
      await tx.delete(contractMilestone).where(eq(contractMilestone.contractId, id));
      for (const m of body.milestones)
        await tx.insert(contractMilestone).values({ tenantId: a.user.tenantId, contractId: id, ...m });
      const n = await rescheduleAlerts(tx, c, today());
      await d.audit.record(tx, a.ctx, {
        action: 'contract.milestones_edit',
        entityType: 'contract',
        entityId: id,
        after: { milestones: body.milestones.length, alertsScheduled: n },
      });
      return x.view(tx, a, await x.load(tx, a, id));
    });
  });

  reg('PUT', '/contracts/{id}/extensions');
  app.put(`${p}/contracts/:id/extensions`, { preHandler: guard(d, RECORD_EDITORS) }, async (req) => {
    const a = req.auth!;
    const id = cid(req);
    const body = parse(extensionsBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const c = await recordTarget(tx, a, id);
      await tx.delete(contractExtension).where(eq(contractExtension.contractId, id));
      for (const [i, months] of body.extensions.entries())
        await tx
          .insert(contractExtension)
          .values({ tenantId: a.user.tenantId, contractId: id, months, position: i + 1 });
      const n = await rescheduleAlerts(tx, c, today());
      await d.audit.record(tx, a.ctx, {
        action: 'contract.extensions_edit',
        entityType: 'contract',
        entityId: id,
        after: { extensions: body.extensions, alertsScheduled: n },
      });
      return x.view(tx, a, await x.load(tx, a, id));
    });
  });

  reg('PUT', '/contracts/{id}/owner');
  app.put(`${p}/contracts/:id/owner`, { preHandler: guard(d, RECORD_EDITORS) }, async (req) => {
    const a = req.auth!;
    const id = cid(req);
    const body = parse(ownerBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const c = await recordTarget(tx, a, id);
      const [seat] = await tx
        .select({ userId: roleAssignment.userId })
        .from(roleAssignment)
        .where(
          and(
            eq(roleAssignment.tenantId, a.user.tenantId),
            eq(roleAssignment.userId, body.ownerId),
            eq(roleAssignment.role, 'CONTRACT_MGR'),
          ),
        );
      if (!seat)
        throw new AppError(422, 'NOT_A_CONTRACT_MANAGER', 'The owner must be a contract manager', [
          { field: 'ownerId', message: 'Choose a contract manager' },
        ]);
      await tx.update(contract).set({ ownerId: body.ownerId }).where(eq(contract.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'contract.owner_change',
        entityType: 'contract',
        entityId: id,
        before: { ownerId: c.ownerId },
        after: { ownerId: body.ownerId },
      });
      return x.view(tx, a, await x.load(tx, a, id));
    });
  });

  // ------------------------------------------------------------ variations (US-CON-05)
  reg('POST', '/contracts/{id}/variations');
  app.post(
    `${p}/contracts/:id/variations`,
    { preHandler: guard(d, ['LEGAL', 'PROCUREMENT']) },
    async (req, reply) => {
      const a = req.auth!;
      const id = cid(req);
      const body = parse(variationBody, req.body);
      const out = await withContext(d.database, a.ctx, async (tx) => {
        const parent = await recordTarget(tx, a, id);
        const open = (await x.variationsOf(tx, parent)).find((v) => v.status !== 'EXECUTED');
        if (open)
          throw new AppError(409, 'VARIATION_OPEN', `Variation ${open.number} is still being prepared`);
        const [{ n } = { n: 0 }] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(contract)
          .where(eq(contract.parentId, id));
        const start = today();
        const parentEnd = (await effectiveEnd(tx, parent)) ?? parent.endDate!;
        const end = body.endDate ?? parentEnd;
        if (end < start)
          throw new AppError(400, 'VALIDATION_FAILED', 'The end date cannot be in the past', [
            { field: 'endDate', message: 'Choose a date from today' },
          ]);
        if (body.value === 0 && end <= parentEnd)
          throw new AppError(
            422,
            'EMPTY_VARIATION',
            'A variation must change the value or extend the end date',
            [{ field: 'value', message: 'Enter an amount or a later end date' }],
          );
        const [row] = await tx
          .insert(contract)
          .values({
            tenantId: a.user.tenantId,
            number: `${parent.number}-V${n + 1}`,
            parentId: id,
            supplierId: parent.supplierId,
            status: 'DRAFT',
            value: body.value.toFixed(2),
            startDate: start,
            endDate: end,
            noticeDays: parent.noticeDays,
            createdAt: d.clock.now(),
            updatedAt: d.clock.now(),
          })
          .returning();
        const cumulative = Number(parent.value) + body.value;
        const text = [
          `This variation amends ${parent.number}.`,
          body.value > 0
            ? `The contract value increases by ${aud.format(body.value)} to a total of ${aud.format(cumulative)} (excluding earlier variations).`
            : 'The contract value does not change.',
          end > parentEnd ? `The end date is extended to ${end}.` : '',
          `Reason: ${body.reason}`,
        ]
          .filter(Boolean)
          .join(' ');
        await tx.insert(clause).values({
          tenantId: a.user.tenantId,
          contractId: row!.id,
          clauseId: 'VARIATION',
          title: 'Variation',
          text,
          mandatory: true,
          changedFromTemplate: false,
        });
        await d.audit.record(tx, a.ctx, {
          action: 'contract.variation_create',
          entityType: 'contract',
          entityId: row!.id,
          after: { parentId: id, number: row!.number, value: body.value, endDate: end },
        });
        await x.notifyRoles(
          tx,
          a.user.tenantId,
          ['LEGAL'],
          'Variation ready for review',
          `${row!.number} varies ${parent.number}`,
          `/app/contracts/${row!.id}`,
        );
        return x.view(tx, a, await x.load(tx, a, row!.id));
      });
      return reply.status(201).send(out);
    },
  );

  // ------------------------------------------------------------ deviation register (US-CON-02)
  async function deviationTarget(tx: Tx, a: AuthContext, id: string, clauseId: string) {
    const c = await x.load(tx, a, id);
    if (c.locked || !['DRAFT', 'LEGAL_REVIEW'].includes(c.status))
      throw new AppError(
        409,
        'INVALID_STATE',
        'Deviations can only be reviewed before the contract is released',
      );
    const [k] = await tx
      .select()
      .from(clause)
      .where(and(eq(clause.contractId, id), eq(clause.clauseId, clauseId)));
    if (!k || !k.changedFromTemplate) throw new AppError(404, 'NOT_FOUND', 'No deviation on that clause');
    return { c, k };
  }

  reg('PUT', '/contracts/{id}/deviations/{clauseId}/risk');
  app.put(
    `${p}/contracts/:id/deviations/:clauseId/risk`,
    { preHandler: guard(d, ['LEGAL']) },
    async (req) => {
      const a = req.auth!;
      const { id, clauseId } = parse(z.object({ id: uuid, clauseId: z.string().min(1).max(60) }), req.params);
      const body = parse(riskBody, req.body);
      return withContext(d.database, a.ctx, async (tx) => {
        const { k } = await deviationTarget(tx, a, id, clauseId);
        await tx.update(clause).set({ risk: body.risk }).where(eq(clause.id, k.id));
        await d.audit.record(tx, a.ctx, {
          action: 'contract.deviation_risk',
          entityType: 'contract',
          entityId: id,
          before: { clauseId, risk: k.risk },
          after: { clauseId, risk: body.risk },
        });
        return x.view(tx, a, await x.load(tx, a, id));
      });
    },
  );

  reg('POST', '/contracts/{id}/deviations/{clauseId}/decision');
  app.post(
    `${p}/contracts/:id/deviations/:clauseId/decision`,
    { preHandler: guard(d, ['DELEGATE', 'EXEC', 'PROBITY']) },
    async (req) => {
      const a = req.auth!;
      const { id, clauseId } = parse(z.object({ id: uuid, clauseId: z.string().min(1).max(60) }), req.params);
      const body = parse(decisionBody, req.body);
      if (body.decision === 'REJECT' && (body.comment ?? '').length < 5)
        throw new AppError(400, 'VALIDATION_FAILED', 'A reason is required', [
          { field: 'comment', message: 'Say why in at least 5 characters' },
        ]);
      return withContext(d.database, a.ctx, async (tx) => {
        const { c, k } = await deviationTarget(tx, a, id, clauseId);
        // a non-negotiable clause needs General Counsel (the executive) or the risk delegate; others, an ordinary delegate (FR-0400)
        const protectedClause = isProtected(
          clauseId,
          (await loadSettings(tx, a.user.tenantId)).contractRules.protectedClauses,
        );
        const senior = a.user.roles.includes('EXEC') || a.user.roles.includes('PROBITY');
        if (protectedClause && !senior)
          throw new AppError(
            403,
            'PROTECTED_CLAUSE',
            'This is a non-negotiable clause: only General Counsel or the risk delegate can approve a change',
          );
        if (!protectedClause && !a.user.roles.some((r) => r === 'DELEGATE' || r === 'EXEC'))
          throw new AppError(403, 'FORBIDDEN', 'Only a delegate can decide this change');
        const now = d.clock.now();
        await tx
          .update(approval)
          .set({ decision: 'SUPERSEDED' })
          .where(
            and(
              eq(approval.subjectType, 'CONTRACT_DEVIATION'),
              eq(approval.subjectId, k.id),
              sql`${approval.decision} <> 'SUPERSEDED'`,
            ),
          );
        const verb = body.decision === 'APPROVE' ? 'DEVIATION APPROVED' : 'DEVIATION REJECTED';
        await tx.insert(approval).values({
          tenantId: a.user.tenantId,
          subjectType: 'CONTRACT_DEVIATION',
          subjectId: k.id,
          userId: a.user.id,
          role: a.user.role,
          decision: body.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
          comment: body.comment ?? null,
          stamp: `${verb} · ${a.user.name} · ${a.user.role.replace('_', ' ')} · ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
          decidedAt: now,
        });
        await d.audit.record(tx, a.ctx, {
          action: 'contract.deviation_decision',
          entityType: 'contract',
          entityId: id,
          after: { clauseId, decision: body.decision, risk: k.risk, comment: body.comment },
        });
        await x.notifyRoles(
          tx,
          a.user.tenantId,
          ['LEGAL'],
          body.decision === 'APPROVE' ? 'Deviation approved' : 'Deviation rejected',
          `${c.number}: ${k.title}${body.comment ? ` - ${body.comment}` : ''}`,
          `/app/contracts/${id}`,
        );
        return x.view(tx, a, await x.load(tx, a, id));
      });
    },
  );

  // ------------------------------------------------------------ custom alerts in plain language (US-CMG-03)
  reg('POST', '/contracts/{id}/alerts');
  app.post(
    `${p}/contracts/:id/alerts`,
    { preHandler: guard(d, ['CONTRACT_MGR', 'PROCUREMENT', 'LEGAL', 'EXEC']) },
    async (req, reply) => {
      const a = req.auth!;
      const id = cid(req);
      const body = parse(alertBody, req.body);
      const out = await withContext(d.database, a.ctx, async (tx) => {
        const c = await recordTarget(tx, a, id);
        const end = (await effectiveEnd(tx, c)) ?? c.endDate!;
        const parsed = parseAlert(
          body.instruction,
          { startDate: c.startDate!, endDate: end, noticeDays: c.noticeDays },
          today(),
        );
        if (!parsed.ok)
          throw new AppError(422, 'ALERT_NOT_UNDERSTOOD', parsed.message, [
            { field: 'instruction', message: parsed.message },
          ]);
        const [row] = await tx
          .insert(alert)
          .values({
            tenantId: a.user.tenantId,
            contractId: id,
            kind: 'CUSTOM',
            triggerDate: parsed.value.triggerDate,
            recipientRule: parsed.value.recipientRule,
            origin: 'USER',
            note: body.instruction,
            createdBy: a.user.id,
          })
          .returning();
        await d.audit.record(tx, a.ctx, {
          action: 'contract.alert_create',
          entityType: 'contract',
          entityId: id,
          after: {
            alertId: row!.id,
            instruction: body.instruction,
            triggerDate: parsed.value.triggerDate,
            recipientRule: parsed.value.recipientRule,
          },
        });
        return { ...(x.alertView(row!, []) as object), note: row!.note, summary: parsed.value.summary };
      });
      return reply.status(201).send(out);
    },
  );
}
