/**
 * Intake extras (B1): classification confirmation (FR-0015), supplier suggestions (FR-0020), estimated contract value
 * (FR-0090), the downstream artefacts one conversation fills in (FR-0010), delegates by stage (FR-0725, FR-X06) and
 * per-procurement process variations (FR-0730). Everything is audited; nothing here reaches bid content.
 */
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Clock } from '@if/shared';
import type { AuditService } from '../../audit/audit-service.js';
import { guard, type GuardDeps } from '../../auth/guard.js';
import { checkDelegation, type DelegationScope } from '../../authz/delegation.js';
import { withContext, type Tx } from '../../db/client.js';
import {
  appUser,
  approval,
  contract,
  delegation,
  evalReport,
  evaluation,
  criterion,
  fieldValue,
  plan,
  request,
  roleAssignment,
  supplier,
  tender,
} from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { dispatch } from '../notify/dispatch.js';
import { loadSettings } from '../settings/settings.js';
import { calculateEcv, classifyCategory, type ProcessStep } from './classify.js';
import { IntakeService, loadRequest } from './service.js';

export interface IntakeExtrasDeps extends GuardDeps {
  clock: Clock;
  audit: AuditService;
}

const uuid = z.string().uuid();
const READERS = [
  'REQUESTER',
  'PROCUREMENT',
  'DELEGATE',
  'LEGAL',
  'CONTRACT_MGR',
  'PROBITY',
  'FINANCE',
  'EXEC',
] as const;
const EDITORS = ['REQUESTER', 'PROCUREMENT'] as const;
type AuthCtx = NonNullable<FastifyRequest['auth']>;

const STAGES = ['PLAN_APPROVAL', 'PUBLISH_PERMISSION', 'REPORT_APPROVAL', 'CONTRACT_SIGNING'] as const;
type Stage = (typeof STAGES)[number];
const STAGE_SCOPE: Record<Stage, DelegationScope> = {
  PLAN_APPROVAL: 'SOURCING_APPROVAL',
  PUBLISH_PERMISSION: 'PUBLISH_PERMISSION',
  REPORT_APPROVAL: 'SOURCING_APPROVAL',
  CONTRACT_SIGNING: 'CONTRACT_SIGNING',
};
const STAGE_LABEL: Record<Stage, string> = {
  PLAN_APPROVAL: 'Plan approval',
  PUBLISH_PERMISSION: 'Permission to publish',
  REPORT_APPROVAL: 'Evaluation report approval',
  CONTRACT_SIGNING: 'Contract signing',
};

const taxonomyBody = z
  .object({ code: z.string().trim().min(1).max(20).optional(), confirm: z.literal(true) })
  .strict();
const suppliersBody = z.object({ supplierIds: z.array(uuid).max(20) }).strict();
const money = z.number().min(0).max(1e12);
const ecvBody = z
  .object({
    baseTermValue: money,
    extensionsValue: money.default(0),
    freight: money.default(0),
    implementation: money.default(0),
    exchangeRate: z.number().gt(0).max(1000).default(1),
    taxPct: z.number().min(0).max(100).default(0),
    apply: z.boolean().default(false),
  })
  .strict();
const nominateBody = z.object({ userId: uuid }).strict();
const variationBody = z
  .object({
    action: z.enum(['ADD', 'REMOVE']),
    label: z.string().trim().min(2).max(60).optional(),
    key: z.string().trim().max(60).optional(),
    reason: z.string().trim().min(10).max(1000),
  })
  .strict()
  .refine((b) => (b.action === 'ADD' ? !!b.label : !!b.key), {
    message: 'Name the step to add, or the step to remove',
  });
const decisionBody = z
  .object({ decision: z.enum(['APPROVE', 'REJECT']), comment: z.string().trim().max(1000).optional() })
  .strict();

interface Variation {
  id: string;
  action: 'ADD' | 'REMOVE';
  label?: string;
  key?: string;
  reason: string;
  requestedBy: string;
  requestedAt: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  decidedBy?: string;
  decidedByName?: string;
  decidedAt?: string;
  comment?: string;
}

export function registerIntakeExtras(app: FastifyInstance, p: string, d: IntakeExtrasDeps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);
  const svc = new IntakeService(d.clock, d.audit);
  const ownerOnly = (roles: readonly string[]) => roles.length === 1 && roles[0] === 'REQUESTER';

  async function visible(tx: Tx, a: AuthCtx, id: string) {
    const l = await loadRequest(tx, a.user.tenantId, id);
    if (!l || (ownerOnly(a.user.roles) && l.row.requesterId !== a.user.id))
      throw new AppError(404, 'NOT_FOUND', 'Request not found');
    return l;
  }
  const canEdit = (a: AuthCtx, requesterId: string) =>
    a.user.roles.includes('PROCUREMENT') || (a.user.roles.includes('REQUESTER') && requesterId === a.user.id);

  // ---------------------------------------------------------------- classification (FR-0015)
  reg('POST', '/requests/{id}/taxonomy');
  app.post(`${p}/requests/:id/taxonomy`, { preHandler: guard(d, [...EDITORS]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    const body = parse(taxonomyBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a, id);
      if (!canEdit(a, l.row.requesterId))
        throw new AppError(403, 'FORBIDDEN', 'You cannot change this request');
      const settings = await loadSettings(tx, a.user.tenantId);
      const suggested = classifyCategory(l.row.category, settings.intake.taxonomy);
      const code = body.code ?? l.row.taxonomyCode ?? suggested?.code;
      if (!code)
        throw new AppError(422, 'VALIDATION_FAILED', 'There is no code to confirm yet', [
          { field: 'code', message: 'Enter a code, or describe what you are buying so one can be suggested' },
        ]);
      await tx
        .update(request)
        .set({ taxonomyScheme: settings.intake.taxonomy, taxonomyCode: code, taxonomyConfirmed: true })
        .where(eq(request.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'request.taxonomy_confirm',
        entityType: 'request',
        entityId: id,
        before: {
          scheme: l.row.taxonomyScheme,
          code: l.row.taxonomyCode,
          confirmed: l.row.taxonomyConfirmed,
        },
        after: {
          scheme: settings.intake.taxonomy,
          code,
          confirmed: true,
          overridden: code !== suggested?.code,
        },
      });
      return {
        scheme: settings.intake.taxonomy,
        code,
        confirmed: true,
        label: suggested?.code === code ? suggested.label : 'Entered by a person',
      };
    });
  });

  // ---------------------------------------------------------------- supplier suggestions (FR-0020)
  async function suggestions(tx: Tx, a: AuthCtx, l: NonNullable<Awaited<ReturnType<typeof loadRequest>>>) {
    const selectedRow = l.fields.find((f) => f.key === 'suppliers.selected');
    const selected = new Set<string>(selectedRow?.value ? (JSON.parse(selectedRow.value) as string[]) : []);
    const category = l.row.category?.toLowerCase() ?? '';
    const all = await tx
      .select()
      .from(supplier)
      .where(eq(supplier.tenantId, a.user.tenantId))
      .orderBy(asc(supplier.company));
    const fits = all.filter((s) =>
      (s.categories as string[]).some(
        (c) =>
          category.length > 0 &&
          (category.startsWith(c.toLowerCase()) || c.toLowerCase().startsWith(category.split(' (')[0]!)),
      ),
    );
    const contacts = fits.length
      ? await tx
          .select({ supplierId: appUser.supplierId, name: appUser.name, email: appUser.email })
          .from(appUser)
          .where(
            and(
              eq(appUser.tenantId, a.user.tenantId),
              eq(appUser.active, true),
              inArray(
                appUser.supplierId,
                fits.map((f) => f.id),
              ),
            ),
          )
      : [];
    return fits.map((s) => ({
      id: s.id,
      company: s.company,
      sanctionsStatus: s.sanctionsStatus,
      insuranceStatus: s.insuranceStatus,
      categories: s.categories as string[],
      contacts: contacts.filter((c) => c.supplierId === s.id).map((c) => ({ name: c.name, email: c.email })),
      // the suggestion is the starting point: until someone changes it, every match is selected
      selected: selectedRow ? selected.has(s.id) : true,
    }));
  }

  reg('GET', '/requests/{id}/suggested-suppliers');
  app.get(`${p}/requests/:id/suggested-suppliers`, { preHandler: guard(d, [...READERS]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    return withContext(d.database, a.ctx, async (tx) => suggestions(tx, a, await visible(tx, a, id)));
  });

  reg('PUT', '/requests/{id}/suggested-suppliers');
  app.put(`${p}/requests/:id/suggested-suppliers`, { preHandler: guard(d, [...EDITORS]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    const body = parse(suppliersBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a, id);
      if (!canEdit(a, l.row.requesterId))
        throw new AppError(403, 'FORBIDDEN', 'You cannot change this request');
      const known = await tx
        .select({ id: supplier.id })
        .from(supplier)
        .where(
          and(
            eq(supplier.tenantId, a.user.tenantId),
            inArray(
              supplier.id,
              body.supplierIds.length ? body.supplierIds : ['00000000-0000-0000-0000-000000000000'],
            ),
          ),
        );
      if (known.length !== body.supplierIds.length)
        throw new AppError(422, 'VALIDATION_FAILED', 'Unknown supplier', [
          { field: 'supplierIds', message: 'One of the suppliers is not in the directory' },
        ]);
      const before = l.fields.find((f) => f.key === 'suppliers.selected')?.value ?? null;
      const set = {
        value: JSON.stringify(body.supplierIds),
        source: 'USER' as const,
        aiDrafted: false,
        missing: false,
        updatedBy: a.user.id,
        updatedAt: d.clock.now(),
      };
      await tx
        .insert(fieldValue)
        .values({
          tenantId: a.user.tenantId,
          ownerType: 'REQUEST',
          ownerId: id,
          key: 'suppliers.selected',
          label: 'Suggested suppliers',
          ...set,
        })
        .onConflictDoUpdate({ target: [fieldValue.ownerType, fieldValue.ownerId, fieldValue.key], set });
      await d.audit.record(tx, a.ctx, {
        action: 'request.suppliers_amend',
        entityType: 'request',
        entityId: id,
        before: { selected: before },
        after: { selected: body.supplierIds },
      });
      return suggestions(tx, a, (await loadRequest(tx, a.user.tenantId, id))!);
    });
  });

  // ---------------------------------------------------------------- estimated contract value (FR-0090)
  const ecvFor = (l: NonNullable<Awaited<ReturnType<typeof loadRequest>>>) => {
    const stored = l.row.ecv as ReturnType<typeof calculateEcv> | null;
    return (
      stored ??
      calculateEcv({
        baseTermValue: Number(l.row.estimatedValue ?? 0),
        extensionsValue: 0,
        freight: 0,
        implementation: 0,
        exchangeRate: 1,
        taxPct: 0,
      })
    );
  };
  reg('GET', '/requests/{id}/ecv');
  app.get(`${p}/requests/:id/ecv`, { preHandler: guard(d, [...READERS]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    return withContext(d.database, a.ctx, async (tx) => ({
      ...ecvFor(await visible(tx, a, id)),
      applied: !!(await visible(tx, a, id)).row.ecv,
    }));
  });

  reg('PUT', '/requests/{id}/ecv');
  app.put(`${p}/requests/:id/ecv`, { preHandler: guard(d, [...EDITORS]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    const { apply, ...inputs } = parse(ecvBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a, id);
      if (!canEdit(a, l.row.requesterId))
        throw new AppError(403, 'FORBIDDEN', 'You cannot change this request');
      const result = calculateEcv(inputs);
      if (!apply) return { ...result, applied: false };
      // saving the calculation sets the request value, which in turn re-routes the workflow and the delegate
      await svc.applyChanges(
        tx,
        a.ctx,
        id,
        [{ key: 'estimatedValue', value: String(result.ecv) }],
        'USER',
        {},
        'request.ecv_apply',
      );
      await tx.update(request).set({ ecv: result }).where(eq(request.id, id));
      return { ...result, applied: true };
    });
  });

  // ---------------------------------------------------------------- downstream artefacts (FR-0010)
  reg('GET', '/requests/{id}/artefacts');
  app.get(`${p}/requests/:id/artefacts`, { preHandler: guard(d, [...READERS]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    return withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a, id);
      const owner = l.fields.find((f) => f.key === 'contractOwner')?.value;
      const carried = [
        'title',
        'category',
        'estimatedValue',
        'termMonths',
        'businessUnit',
        ...(owner ? ['contractOwner'] : []),
      ];
      const out: Array<{
        kind: string;
        label: string;
        status: string;
        link: string;
        carriedFromIntake: string[];
        detail?: string;
      }> = [
        {
          kind: 'REQUEST',
          label: `Request ${l.row.number}`,
          status: l.row.status,
          link: `/app/requests/${id}`,
          carriedFromIntake: [],
        },
      ];
      const [pl] = await tx.select().from(plan).where(eq(plan.requestId, id));
      if (pl)
        out.push({
          kind: 'PLAN',
          label: 'Procurement plan',
          status: pl.status,
          link: `/app/plans/${id}`,
          carriedFromIntake: carried,
          detail: 'Background, requirements, risks and committee drafted from the request',
        });
      const [tn] = await tx
        .select()
        .from(tender)
        .where(eq(tender.requestId, id))
        .orderBy(desc(tender.createdAt));
      if (tn) {
        out.push({
          kind: 'TENDER',
          label: `Tender pack (${tn.type})`,
          status: tn.status,
          link: `/app/tenders/${tn.id}`,
          carriedFromIntake: carried,
          detail: 'Built from the approved plan; the budget is not shown to suppliers',
        });
        const [ev] = await tx.select().from(evaluation).where(eq(evaluation.tenderId, tn.id));
        if (ev) {
          const crit = await tx
            .select({ id: criterion.id })
            .from(criterion)
            .where(eq(criterion.evaluationId, ev.id));
          out.push({
            kind: 'SCORING_SHEET',
            label: 'Evaluation scoring sheet',
            status: ev.status,
            link: `/app/evaluations/${ev.id}`,
            carriedFromIntake: [],
            detail: `${crit.length} criteria carried from the tender`,
          });
          const [rep] = await tx.select().from(evalReport).where(eq(evalReport.evaluationId, ev.id));
          if (rep)
            out.push({
              kind: 'REPORT',
              label: 'Evaluation report',
              status: rep.status,
              link: `/app/evaluations/${ev.id}`,
              carriedFromIntake: ['title', 'category', 'estimatedValue'],
              detail: 'Compiled from the locked scores and the process record',
            });
        }
        const [ct] = await tx.select().from(contract).where(eq(contract.tenderId, tn.id));
        if (ct)
          out.push({
            kind: 'CONTRACT',
            label: `Contract ${ct.number}`,
            status: ct.status,
            link: `/app/contracts/${ct.id}`,
            carriedFromIntake: ['title', 'estimatedValue', 'termMonths', ...(owner ? ['contractOwner'] : [])],
            detail: owner
              ? `Contract owner ${owner} carried from the request`
              : 'Value and term carried from the request',
          });
      }
      return out;
    });
  });

  // ---------------------------------------------------------------- delegates by stage (FR-0725, FR-X06)
  async function delegateFor(
    tx: Tx,
    a: AuthCtx,
    l: NonNullable<Awaited<ReturnType<typeof loadRequest>>>,
    stage: Stage,
  ) {
    const value = Number(l.row.estimatedValue ?? 0);
    const scope = STAGE_SCOPE[stage];
    const rows = await tx
      .select()
      .from(delegation)
      .where(
        and(
          eq(delegation.tenantId, a.user.tenantId),
          eq(delegation.scope, scope),
          eq(delegation.active, true),
        ),
      );
    const candidates: Array<{ userId: string; limit: number }> = [];
    for (const r of rows) {
      if (Number(r.maxValue) < value) continue;
      if (r.userId) candidates.push({ userId: r.userId, limit: Number(r.maxValue) });
      else {
        const members = await tx
          .select({ userId: roleAssignment.userId })
          .from(roleAssignment)
          .where(and(eq(roleAssignment.tenantId, a.user.tenantId), eq(roleAssignment.role, r.role as never)));
        for (const m of members) candidates.push({ userId: m.userId, limit: Number(r.maxValue) });
      }
    }
    // the lowest authority that is still enough: routine work stays with the delegate, bigger work moves up on its own
    candidates.sort((x, y) => x.limit - y.limit);
    const nominated = (l.row.nominatedDelegates as Record<string, string>)[stage];
    const autoId = candidates[0]?.userId;
    const chosen = nominated && candidates.some((c) => c.userId === nominated) ? nominated : autoId;
    const names = new Map<string, string>();
    for (const u of await tx
      .select({ id: appUser.id, name: appUser.name })
      .from(appUser)
      .where(eq(appUser.tenantId, a.user.tenantId)))
      names.set(u.id, u.name);
    // history is never rewritten: whoever actually decided stays the signatory for that stage
    let signedBy: { id: string; name: string; at: string } | undefined;
    const subject =
      stage === 'PLAN_APPROVAL'
        ? (await tx.select({ id: plan.id }).from(plan).where(eq(plan.requestId, l.row.id)))[0]?.id
        : undefined;
    if (subject) {
      const [ap] = await tx
        .select()
        .from(approval)
        .where(and(eq(approval.subjectId, subject), eq(approval.decision, 'APPROVED')))
        .orderBy(desc(approval.decidedAt))
        .limit(1);
      if (ap)
        signedBy = { id: ap.userId, name: names.get(ap.userId) ?? 'Unknown', at: ap.decidedAt.toISOString() };
    }
    return {
      stage,
      label: STAGE_LABEL[stage],
      scope,
      value,
      delegate: chosen ? { id: chosen, name: names.get(chosen) ?? 'Unknown' } : null,
      limit: chosen ? (candidates.find((c) => c.userId === chosen)?.limit ?? null) : null,
      basis: chosen && chosen === nominated ? ('REDIRECTED' as const) : ('AUTO' as const),
      // everyone who holds enough authority for this stage: the choices when procurement redirects
      candidates: [...new Set(candidates.map((c) => c.userId))].map((id) => ({
        id,
        name: names.get(id) ?? 'Unknown',
      })),
      ...(signedBy ? { signedBy } : {}),
    };
  }

  reg('GET', '/requests/{id}/delegates');
  app.get(`${p}/requests/:id/delegates`, { preHandler: guard(d, [...READERS]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    return withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a, id);
      const out = [];
      for (const s of STAGES) out.push(await delegateFor(tx, a, l, s));
      return out;
    });
  });

  reg('PUT', '/requests/{id}/delegates/{stage}');
  app.put(`${p}/requests/:id/delegates/:stage`, { preHandler: guard(d, ['PROCUREMENT']) }, async (req) => {
    const a = req.auth!;
    const { id, stage } = parse(z.object({ id: uuid, stage: z.enum(STAGES) }), req.params);
    const body = parse(nominateBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a, id);
      const value = Number(l.row.estimatedValue ?? 0);
      const [target] = await tx
        .select()
        .from(appUser)
        .where(
          and(eq(appUser.id, body.userId), eq(appUser.tenantId, a.user.tenantId), eq(appUser.active, true)),
        );
      if (!target)
        throw new AppError(422, 'VALIDATION_FAILED', 'Unknown person', [
          { field: 'userId', message: 'Choose an active staff member' },
        ]);
      const roles = (
        await tx
          .select({ role: roleAssignment.role })
          .from(roleAssignment)
          .where(eq(roleAssignment.userId, target.id))
      ).map((r) => r.role);
      const check = await checkDelegation(
        tx,
        { tenantId: a.user.tenantId, userId: target.id, roles },
        STAGE_SCOPE[stage],
        value,
      );
      if (!check.allowed)
        throw new AppError(
          422,
          'DELEGATION_EXCEEDED',
          `${target.name} does not hold enough authority for AUD ${value.toLocaleString('en-AU')} at this stage`,
          [
            {
              field: 'userId',
              message:
                check.limit === null
                  ? 'No delegation of this kind'
                  : `Their limit is AUD ${check.limit.toLocaleString('en-AU')}`,
            },
          ],
        );
      const before = l.row.nominatedDelegates as Record<string, string>;
      await tx
        .update(request)
        .set({ nominatedDelegates: { ...before, [stage]: target.id } })
        .where(eq(request.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'request.delegate_redirect',
        entityType: 'request',
        entityId: id,
        before: { [stage]: before[stage] ?? null },
        after: { [stage]: target.id },
      });
      const settings = await loadSettings(tx, a.user.tenantId);
      await dispatch(
        tx,
        {
          tenantId: a.user.tenantId,
          recipients: [target.id],
          title: `You are the approver for ${STAGE_LABEL[stage].toLowerCase()}`,
          body: `${l.row.number} ${l.row.title}`,
          link: `/app/requests/${id}`,
          event: 'DELEGATE_ACTION',
        },
        settings,
      );
      return delegateFor(tx, a, (await loadRequest(tx, a.user.tenantId, id))!, stage);
    });
  });

  // ---------------------------------------------------------------- process variations (FR-0730)
  reg('GET', '/requests/{id}/process-variations');
  app.get(`${p}/requests/:id/process-variations`, { preHandler: guard(d, [...READERS]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    return withContext(
      d.database,
      a.ctx,
      async (tx) => (await visible(tx, a, id)).row.processVariations as Variation[],
    );
  });

  reg('POST', '/requests/{id}/process-variations');
  app.post(
    `${p}/requests/:id/process-variations`,
    { preHandler: guard(d, [...EDITORS]) },
    async (req, reply) => {
      const a = req.auth!;
      const { id } = parse(z.object({ id: uuid }), req.params);
      const body = parse(variationBody, req.body);
      const out = await withContext(d.database, a.ctx, async (tx) => {
        const l = await visible(tx, a, id);
        if (!canEdit(a, l.row.requesterId))
          throw new AppError(403, 'FORBIDDEN', 'You cannot change this request');
        const steps = l.row.processSteps as ProcessStep[];
        if (steps.length === 0) throw new AppError(409, 'NO_WORKFLOW', 'This request has no workflow yet');
        if (body.action === 'REMOVE') {
          const step = steps.find((s) => s.key === body.key);
          if (!step)
            throw new AppError(422, 'VALIDATION_FAILED', 'Unknown step', [
              { field: 'key', message: 'That step is not in this workflow' },
            ]);
          if (step.mandatory)
            throw new AppError(
              422,
              'CHECKPOINT_REQUIRED',
              `${step.label} is a mandatory step and cannot be removed`,
              [{ field: 'key', message: 'Mandatory steps stay in every procurement' }],
            );
        }
        const list = l.row.processVariations as Variation[];
        if (list.some((v) => v.status === 'PENDING'))
          throw new AppError(
            409,
            'VARIATION_PENDING',
            'A change to the process is already waiting for a delegate',
          );
        const v: Variation = {
          id: crypto.randomUUID(),
          action: body.action,
          ...(body.label ? { label: body.label } : {}),
          ...(body.key ? { key: body.key } : {}),
          reason: body.reason,
          requestedBy: a.user.id,
          requestedAt: d.clock.now().toISOString(),
          status: 'PENDING',
        };
        await tx
          .update(request)
          .set({ processVariations: [...list, v] })
          .where(eq(request.id, id));
        await d.audit.record(tx, a.ctx, {
          action: 'request.process_variation_request',
          entityType: 'request',
          entityId: id,
          after: { ...v },
        });
        const settings = await loadSettings(tx, a.user.tenantId);
        const delegates = await tx
          .select({ userId: roleAssignment.userId })
          .from(roleAssignment)
          .where(
            and(
              eq(roleAssignment.tenantId, a.user.tenantId),
              inArray(roleAssignment.role, ['DELEGATE', 'EXEC']),
            ),
          );
        await dispatch(
          tx,
          {
            tenantId: a.user.tenantId,
            recipients: delegates.map((x) => x.userId),
            title: 'A change to the process needs your approval',
            body: `${l.row.number} ${l.row.title}: ${body.action === 'ADD' ? `add "${body.label}"` : `remove "${body.key}"`}`,
            link: `/app/requests/${id}`,
            event: 'DELEGATE_ACTION',
          },
          settings,
        );
        return v;
      });
      return reply.status(201).send(out);
    },
  );

  reg('POST', '/requests/{id}/process-variations/{variationId}/decision');
  app.post(
    `${p}/requests/:id/process-variations/:variationId/decision`,
    { preHandler: guard(d, ['DELEGATE', 'EXEC']) },
    async (req) => {
      const a = req.auth!;
      const { id, variationId } = parse(z.object({ id: uuid, variationId: uuid }), req.params);
      const body = parse(decisionBody, req.body);
      return withContext(d.database, a.ctx, async (tx) => {
        const l = await visible(tx, a, id);
        const list = l.row.processVariations as Variation[];
        const v = list.find((x) => x.id === variationId);
        if (!v) throw new AppError(404, 'NOT_FOUND', 'Change not found');
        if (v.status !== 'PENDING')
          throw new AppError(409, 'ALREADY_DECIDED', 'This change has already been decided');
        const check = await checkDelegation(
          tx,
          { tenantId: a.user.tenantId, userId: a.user.id, roles: a.user.roles },
          'SOURCING_APPROVAL',
          Number(l.row.estimatedValue ?? 0),
        );
        if (!check.allowed)
          throw new AppError(
            403,
            check.code ?? 'DELEGATION_EXCEEDED',
            'This value is above your delegated authority',
          );
        let steps = l.row.processSteps as Array<ProcessStep & { variation?: 'ADDED' }>;
        if (body.decision === 'APPROVE') {
          if (v.action === 'ADD')
            steps = [
              ...steps,
              { key: `custom-${steps.length + 1}`, label: v.label!, mandatory: false, variation: 'ADDED' },
            ];
          else steps = steps.filter((s) => s.key !== v.key);
        }
        const decided: Variation = {
          ...v,
          status: body.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
          decidedBy: a.user.id,
          decidedByName: a.user.name,
          decidedAt: d.clock.now().toISOString(),
          ...(body.comment ? { comment: body.comment } : {}),
        };
        await tx
          .update(request)
          .set({ processSteps: steps, processVariations: list.map((x) => (x.id === v.id ? decided : x)) })
          .where(eq(request.id, id));
        await d.audit.record(tx, a.ctx, {
          action: `request.process_variation_${body.decision === 'APPROVE' ? 'approve' : 'reject'}`,
          entityType: 'request',
          entityId: id,
          before: { status: 'PENDING' },
          after: {
            status: decided.status,
            action: v.action,
            step: v.label ?? v.key,
            approvedBy: a.user.name,
          },
        });
        return decided;
      });
    },
  );

  return done;
}
