/**
 * Request intake + assistant endpoints (M6): US-INT-01 .. US-INT-06.
 * Visibility: a user whose only role is REQUESTER sees their own requests; other staff roles see the tenant.
 * A request that exists but is not visible looks exactly like one that does not exist (404, never 403).
 */
import { SUPPORTED, isForeign } from '../b9/fx-rules.js';
import { toBaseAmount } from '../b9/fx-routes.js';
import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Clock } from '@if/shared';
import type { AiProvider } from '../../adapters/ai-provider.js';
import type { ErpBudgetService } from '../../adapters/erp.js';
import type { AuditService } from '../../audit/audit-service.js';
import { guard, type AuthContext, type GuardDeps } from '../../auth/guard.js';
import { withContext, type Tx } from '../../db/client.js';
import { chatMessage, contract, conversation, request, tenant } from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { dispatch, usersWithRole } from '../notify/dispatch.js';
import { FUNCTION_ROLES, requiredEngagements } from './classify.js';
import { loadSettings } from '../settings/settings.js';
import { IntakeService, loadRequest, toView, valuesOf, type RequestView } from './service.js';
import { FIELD_BY_KEY, missingMandatory, nextQuestions } from './fields.js';

export interface IntakeDeps extends GuardDeps {
  clock: Clock;
  audit: AuditService;
  ai: AiProvider;
  erp: ErpBudgetService;
}

const uuid = z.string().uuid();
const CREATORS = ['REQUESTER', 'PROCUREMENT'] as const;
// Roles that may read request data. ADMIN, EVALUATOR and CHAIR have no business reading procurement requests.
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

const patchBody = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    category: z.string().trim().min(1).max(200).optional(),
    /** The amount, in `currency` when one is given (otherwise in the request's own currency). */
    estimatedValue: z.number().min(0).max(1e12).optional(),
    currency: z.enum(SUPPORTED).optional(),
    termMonths: z.number().int().min(1).max(360).optional(),
    businessUnit: z.string().trim().min(1).max(100).optional(),
    fields: z.record(z.string().max(4000)).optional(),
    expectedVersion: z.number().int().optional(),
  })
  .strict();

const listQuery = z.object({
  phase: z.string().max(30).optional(),
  status: z.string().max(30).optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

const startBody = z
  .object({
    purpose: z.enum(['INTAKE', 'PLAN', 'TENDER', 'EVALUATION', 'CONTRACT', 'GENERAL']),
    contextId: uuid.optional(),
  })
  .strict();
const sendBody = z
  .object({ text: z.string().trim().min(1).max(4000), channel: z.enum(['TEXT', 'VOICE']).default('TEXT') })
  .strict();

type AuthCtx = NonNullable<FastifyRequest['auth']>;
const ownerOnly = (roles: readonly string[]) => roles.length === 1 && roles[0] === 'REQUESTER';

async function tenantConfig(tx: Tx, tenantId: string) {
  const [t] = await tx.select({ config: tenant.config }).from(tenant).where(eq(tenant.id, tenantId));
  return (t?.config ?? {}) as {
    selfServiceThresholdAud?: number;
    budgets?: Record<string, number>;
    budgetCap?: 'HARD' | 'SOFT';
    erpOutage?: boolean;
  };
}

export function registerIntakeRoutes(app: FastifyInstance, p: string, d: IntakeDeps): Set<string> {
  const done = new Set<string>();
  const svc = new IntakeService(d.clock, d.audit);
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);

  /** Loads a request the caller is allowed to see, else 404. */
  async function visible(tx: Tx, auth: AuthCtx, id: string) {
    const loaded = await loadRequest(tx, auth.user.tenantId, id);
    if (!loaded) throw new AppError(404, 'NOT_FOUND', 'Request not found');
    if (ownerOnly(auth.user.roles) && loaded.row.requesterId !== auth.user.id)
      throw new AppError(404, 'NOT_FOUND', 'Request not found');
    return loaded;
  }
  const canEdit = (auth: AuthCtx, requesterId: string) =>
    auth.user.roles.includes('PROCUREMENT') ||
    (auth.user.roles.includes('REQUESTER') && requesterId === auth.user.id);

  // ---------------------------------------------------------------- requests
  reg('GET', '/requests');
  app.get(`${p}/requests`, { preHandler: guard(d, [...READERS]) }, async (req) => {
    const a = req.auth!;
    const q = parse(listQuery, req.query);
    return withContext(d.database, a.ctx, async (tx) => {
      const conds = [eq(request.tenantId, a.user.tenantId)];
      if (ownerOnly(a.user.roles)) conds.push(eq(request.requesterId, a.user.id));
      if (q.phase) conds.push(eq(request.phase, q.phase as never));
      if (q.status) conds.push(eq(request.status, q.status as never));
      if (q.q)
        conds.push(
          or(
            ilike(request.title, `%${q.q.replace(/[%_]/g, '')}%`),
            ilike(request.number, `%${q.q.replace(/[%_]/g, '')}%`),
          )!,
        );
      const where = and(...conds);
      const [{ n }] = (await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(request)
        .where(where)) as [{ n: number }];
      const rows = await tx
        .select()
        .from(request)
        .where(where)
        .orderBy(desc(request.updatedAt), asc(request.number))
        .limit(q.limit)
        .offset(q.offset);
      // a procurement started from a contract (renew, vary, extend) names that contract (FR-0570)
      const linkedIds = [...new Set(rows.map((r) => r.linkedContractId).filter((v): v is string => !!v))];
      const linked = linkedIds.length
        ? await tx
            .select({ id: contract.id, number: contract.number })
            .from(contract)
            .where(inArray(contract.id, linkedIds))
        : [];
      return {
        items: rows.map((r) => ({
          linkKind: r.linkKind ?? undefined,
          linkedContract: r.linkedContractId
            ? {
                id: r.linkedContractId,
                number: linked.find((c) => c.id === r.linkedContractId)?.number ?? null,
              }
            : undefined,
          id: r.id,
          number: r.number,
          title: r.title,
          category: r.category ?? undefined,
          estimatedValue: Number(r.estimatedValue ?? 0),
          currency: r.currency,
          termMonths: r.termMonths ?? undefined,
          businessUnit: r.businessUnit ?? undefined,
          requesterId: r.requesterId,
          phase: r.phase,
          status: r.status,
          intakeMode: r.intakeMode,
          complexity: r.complexity ?? undefined,
          budgetCheck: r.budgetCheck,
          sourceSystem: r.sourceSystem ?? undefined,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        })),
        page: { total: n, limit: q.limit, offset: q.offset },
      };
    });
  });

  reg('POST', '/requests');
  app.post(`${p}/requests`, { preHandler: guard(d, [...CREATORS]) }, async (req, reply) => {
    const a = req.auth!;
    const body = parse(patchBody, req.body ?? {});
    const view = await withContext(d.database, a.ctx, async (tx) => {
      const row = await svc.createDraft(tx, a.ctx);
      const money = await moneyOf(tx, a.user.tenantId, body, 'AUD', d.clock.now());
      const changes = toChanges(money.body);
      if (changes.length === 0 && !money.touched) {
        const l = (await loadRequest(tx, a.user.tenantId, row.id))!;
        return toView(l.row, l.fields, await loadSettings(tx, a.user.tenantId));
      }
      if (changes.length)
        await svc.applyChanges(tx, a.ctx, row.id, changes, 'USER', await tenantConfig(tx, a.user.tenantId));
      return keepMoney(tx, a, row.id, money);
    });
    return reply.status(201).send(view);
  });

  /**
   * An amount typed in a foreign currency is converted once, here, and the request keeps the original and the rate. When the
   * amount is sent without a currency, it is in the currency the request already has (FR-0810).
   */
  async function moneyOf(
    tx: Parameters<Parameters<typeof withContext>[2]>[0],
    tenantId: string,
    body: z.infer<typeof patchBody>,
    current: string,
    now: Date,
  ) {
    const cur = body.currency ?? current;
    const out: {
      body: z.infer<typeof patchBody>;
      touched: boolean;
      currency: string;
      original: number | null;
      rate: number | null;
    } = {
      body: { ...body },
      touched: false,
      currency: cur,
      original: null,
      rate: null,
    };
    delete out.body.currency;
    if (body.estimatedValue === undefined) {
      if (body.currency && body.currency !== current) {
        if (isForeign(body.currency))
          throw new AppError(422, 'VALIDATION_FAILED', 'Enter the amount in that currency too', [
            { field: 'estimatedValue', message: `Give the value in ${body.currency}` },
          ]);
        out.touched = true; // back to the base currency: the value stays as it is
        out.currency = 'AUD';
      }
      return out;
    }
    out.touched = true;
    if (!isForeign(cur)) {
      out.currency = 'AUD';
      return out;
    }
    const c = await toBaseAmount(tx, tenantId, cur, body.estimatedValue, now.toISOString().slice(0, 10));
    out.body.estimatedValue = c.base;
    out.original = c.original;
    out.rate = c.rate;
    return out;
  }
  /** Writes the currency, the original amount and the rate beside the converted value, and returns the fresh view. */
  async function keepMoney(
    tx: Parameters<Parameters<typeof withContext>[2]>[0],
    a: AuthContext,
    id: string,
    m: Awaited<ReturnType<typeof moneyOf>>,
  ) {
    if (m.touched)
      await tx
        .update(request)
        .set({
          currency: m.currency,
          originalAmount: m.original === null ? null : String(m.original),
          fxRate: m.rate === null ? null : String(m.rate),
        })
        .where(eq(request.id, id));
    const l = (await loadRequest(tx, a.user.tenantId, id))!;
    return toView(l.row, l.fields, await loadSettings(tx, a.user.tenantId));
  }

  reg('GET', '/requests/{id}');
  app.get(`${p}/requests/:id`, { preHandler: guard(d, [...READERS]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    return withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a, id);
      return toView(l.row, l.fields, await loadSettings(tx, a.user.tenantId));
    });
  });

  reg('PATCH', '/requests/{id}');
  app.patch(`${p}/requests/:id`, { preHandler: guard(d, [...CREATORS]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    const body = parse(patchBody, req.body ?? {});
    return withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a, id);
      if (!canEdit(a, l.row.requesterId))
        throw new AppError(403, 'FORBIDDEN', 'You cannot edit this request');
      if (body.expectedVersion !== undefined && body.expectedVersion !== l.row.version)
        throw new AppError(
          409,
          'VERSION_CONFLICT',
          'The request was changed by someone else; reload and try again',
        );
      const money = await moneyOf(tx, a.user.tenantId, body, l.row.currency, d.clock.now());
      const changes = toChanges(money.body);
      if (changes.length === 0 && !money.touched)
        return toView(l.row, l.fields, await loadSettings(tx, a.user.tenantId));
      if (changes.length)
        await svc.applyChanges(tx, a.ctx, id, changes, 'USER', await tenantConfig(tx, a.user.tenantId));
      return keepMoney(tx, a, id, money);
    });
  });

  reg('POST', '/requests/{id}/submit');
  app.post(`${p}/requests/:id/submit`, { preHandler: guard(d, [...CREATORS]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    const outcome = await withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a, id);
      if (!canEdit(a, l.row.requesterId))
        throw new AppError(403, 'FORBIDDEN', 'You cannot submit this request');
      if (l.row.status !== 'DRAFT')
        throw new AppError(409, 'REQUEST_NOT_EDITABLE', 'This request has already been submitted');
      const values = valuesOf(l.row, l.fields);
      const settings = await loadSettings(tx, a.user.tenantId);
      const labelOf = (k: string) =>
        settings.customFields.find((c) => c.key === k)?.label ??
        settings.fieldLabels[k] ??
        FIELD_BY_KEY.get(k)?.label ??
        k;
      const missing = [
        ...missingMandatory(values),
        ...settings.customFields.filter((c) => c.mandatory && !values[c.key]?.trim()).map((c) => c.key),
      ];
      if (missing.length > 0) {
        throw new AppError(
          409,
          'REQUEST_INCOMPLETE',
          'Some required information is missing',
          missing.map((k) => ({ field: k, message: `${labelOf(k)} is required` })),
        );
      }
      const cfg = await tenantConfig(tx, a.user.tenantId);
      const amount = Number(values.estimatedValue ?? 0);
      const budget = await d.erp.check({
        tenantId: a.user.tenantId,
        businessUnit: values.businessUnit!,
        amount,
        settings: cfg,
      });
      const cap = settings.intake.budgetCap;
      if (budget.status === 'EXCEEDED' && cap === 'HARD') {
        // Persist the outcome and audit the refusal, then report it after commit.
        await tx.update(request).set({ budgetCheck: 'EXCEEDED' }).where(eq(request.id, id));
        await d.audit.record(tx, a.ctx, {
          action: 'request.submit_blocked',
          entityType: 'request',
          entityId: id,
          after: { reason: 'BUDGET_EXCEEDED', available: budget.available, requested: amount },
          result: 'DENIED',
        });
        // a budget amendment task goes to finance, and the breach rule decides who else hears about it (FR-0055, FR-0066)
        await dispatch(
          tx,
          {
            tenantId: a.user.tenantId,
            recipients: await usersWithRole(tx, a.user.tenantId, ['FINANCE', 'PROCUREMENT']),
            event: 'BUDGET_BREACH',
            title: `Budget amendment needed for ${l.row.number}`,
            body: `${l.row.title}: requested AUD ${amount.toLocaleString('en-AU')}, available AUD ${(budget.available ?? 0).toLocaleString('en-AU')}. Submission is blocked until the budget is amended.`,
            link: `/app/requests/${id}`,
          },
          settings,
        );
        await d.audit.record(tx, a.ctx, {
          action: 'request.budget_amendment_task',
          entityType: 'request',
          entityId: id,
          after: { requested: amount, available: budget.available ?? null, cap },
        });
        return { kind: 'blocked' as const, available: budget.available, requested: amount };
      }
      const now = d.clock.now();
      await tx
        .update(request)
        .set({
          status: 'SUBMITTED',
          phase: 'PLAN',
          budgetCheck: budget.status,
          updatedAt: now,
          version: l.row.version + 1,
        })
        .where(eq(request.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'request.submit',
        entityType: 'request',
        entityId: id,
        before: { status: 'DRAFT', phase: 'INTAKE' },
        after: { status: 'SUBMITTED', phase: 'PLAN', budgetCheck: budget.status },
      });
      await svc.notifyProcurement(tx, a.ctx, l.row.number, l.row.title);
      // soft cap: the request goes ahead but the variance is escalated to the executive (FR-0055, FR-X05)
      if (budget.status === 'EXCEEDED' && cap === 'SOFT') {
        await dispatch(
          tx,
          {
            tenantId: a.user.tenantId,
            recipients: await usersWithRole(tx, a.user.tenantId, ['EXEC']),
            event: 'BUDGET_BREACH',
            title: `Budget exceeded on ${l.row.number} (soft cap)`,
            body: `${l.row.title}: requested AUD ${amount.toLocaleString('en-AU')}, available AUD ${(budget.available ?? 0).toLocaleString('en-AU')}. Escalated for an executive decision.`,
            link: `/app/requests/${id}`,
          },
          settings,
        );
        await d.audit.record(tx, a.ctx, {
          action: 'request.budget_variance',
          entityType: 'request',
          entityId: id,
          after: { requested: amount, available: budget.available ?? null, cap },
        });
      }
      // required engagements are worked out again from the rules as they are now, stored, and the functions are told (FR-0030)
      const eng = requiredEngagements(settings.intake.engagementRules, {
        title: values.title,
        category: values.category,
        background: values.background,
        dataSensitivity: values.dataSensitivity,
        estimatedValue: amount,
        complexity: l.row.complexity ?? 'LOW',
      });
      await tx.update(request).set({ engagements: eng }).where(eq(request.id, id));
      for (const e of eng) {
        await dispatch(
          tx,
          {
            tenantId: a.user.tenantId,
            recipients: await usersWithRole(tx, a.user.tenantId, [...FUNCTION_ROLES[e.function]]),
            title: `${e.label}: ${l.row.number}`,
            body: `${l.row.title}. ${e.reason}`,
            link: `/app/requests/${id}`,
          },
          settings,
        );
      }
      if (eng.length > 0)
        await d.audit.record(tx, a.ctx, {
          action: 'request.engagements',
          entityType: 'request',
          entityId: id,
          after: { required: eng.map((e) => e.function) },
        });
      const r = (await loadRequest(tx, a.user.tenantId, id))!;
      return { kind: 'ok' as const, view: toView(r.row, r.fields, await loadSettings(tx, a.user.tenantId)) };
    });
    if (outcome.kind === 'blocked') {
      throw new AppError(
        422,
        'BUDGET_EXCEEDED',
        'The estimated value exceeds the available budget for this business unit; a budget amendment is required',
        [
          {
            field: 'estimatedValue',
            message: `Requested ${outcome.requested.toLocaleString('en-AU')}, available ${(outcome.available ?? 0).toLocaleString('en-AU')}`,
          },
        ],
      );
    }
    return outcome.view;
  });

  // ---------------------------------------------------------------- assistant
  reg('POST', '/assistant/conversations');
  app.post(`${p}/assistant/conversations`, { preHandler: guard(d, [...CREATORS]) }, async (req, reply) => {
    const a = req.auth!;
    const body = parse(startBody, req.body);
    if (body.purpose !== 'INTAKE')
      throw new AppError(501, 'NOT_IMPLEMENTED', 'This assistant is coming soon');
    const out = await withContext(d.database, a.ctx, async (tx) => {
      if (body.contextId) {
        const l = await visible(tx, a, body.contextId);
        if (!canEdit(a, l.row.requesterId)) throw new AppError(404, 'NOT_FOUND', 'Request not found');
      }
      const [conv] = await tx
        .insert(conversation)
        .values({
          tenantId: a.user.tenantId,
          userId: a.user.id,
          purpose: body.purpose,
          contextId: body.contextId ?? null,
          simulated: d.ai.simulated,
        })
        .returning();
      const greeting = body.contextId
        ? 'Tell me what to change on this request, for example "make the term 24 months" or "the value is about $80k".'
        : 'Hi, I am the procurement assistant. Describe what you need in your own words, for example "Run an RFx for facilities cleaning, three-year term, about $1.2M".';
      await tx
        .insert(chatMessage)
        .values({ tenantId: a.user.tenantId, conversationId: conv!.id, role: 'ASSISTANT', text: greeting });
      await d.audit.record(tx, a.ctx, {
        action: 'assistant.conversation_start',
        entityType: 'conversation',
        entityId: conv!.id,
        after: { purpose: body.purpose, provider: d.ai.name, simulated: d.ai.simulated },
      });
      return conv!.id;
    });
    return reply.status(201).send(await conversationView(a, out));
  });

  async function conversationView(a: AuthCtx, id: string) {
    return withContext(d.database, a.ctx, async (tx) => {
      const [c] = await tx
        .select()
        .from(conversation)
        .where(
          and(
            eq(conversation.id, id),
            eq(conversation.tenantId, a.user.tenantId),
            eq(conversation.userId, a.user.id),
          ),
        );
      if (!c) throw new AppError(404, 'NOT_FOUND', 'Conversation not found');
      const msgs = await tx
        .select()
        .from(chatMessage)
        .where(eq(chatMessage.conversationId, id))
        .orderBy(asc(chatMessage.createdAt), asc(chatMessage.id));
      return {
        id: c.id,
        purpose: c.purpose,
        ...(c.contextId ? { contextId: c.contextId } : {}),
        simulated: c.simulated,
        messages: msgs.map((m) => ({
          id: m.id,
          role: m.role,
          text: m.text,
          createdAt: m.createdAt.toISOString(),
          proposedChanges: (m.proposedChanges as unknown[]) ?? [],
        })),
      };
    });
  }

  reg('GET', '/assistant/conversations/{id}');
  app.get(`${p}/assistant/conversations/:id`, { preHandler: guard(d, [...CREATORS]) }, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    return conversationView(req.auth!, id);
  });

  reg('POST', '/assistant/conversations/{id}/messages');
  app.post(
    `${p}/assistant/conversations/:id/messages`,
    { preHandler: guard(d, [...CREATORS]) },
    async (req, reply) => {
      const a = req.auth!;
      const { id } = parse(z.object({ id: uuid }), req.params);
      const body = parse(sendBody, req.body);
      if (body.channel === 'VOICE')
        throw new AppError(
          422,
          'VOICE_NOT_AVAILABLE',
          'Voice input is coming soon; please type your message',
        );

      const result = await withContext(d.database, a.ctx, async (tx) => {
        const [c] = await tx
          .select()
          .from(conversation)
          .where(
            and(
              eq(conversation.id, id),
              eq(conversation.tenantId, a.user.tenantId),
              eq(conversation.userId, a.user.id),
            ),
          );
        if (!c) throw new AppError(404, 'NOT_FOUND', 'Conversation not found');
        const [{ n }] = (await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(chatMessage)
          .where(eq(chatMessage.conversationId, id))) as [{ n: number }];
        if (n >= 200)
          throw new AppError(409, 'CONVERSATION_FULL', 'This conversation is full; please start a new one');

        await tx
          .insert(chatMessage)
          .values({ tenantId: a.user.tenantId, conversationId: id, role: 'USER', text: body.text });
        const cfg = await tenantConfig(tx, a.user.tenantId);

        let requestId = c.contextId;
        let current = {} as Record<string, string | undefined>;
        if (requestId) {
          const l = await visible(tx, a, requestId);
          if (!canEdit(a, l.row.requesterId)) throw new AppError(404, 'NOT_FOUND', 'Request not found');
          current = valuesOf(l.row, l.fields);
        } else {
          requestId = (await svc.createDraft(tx, a.ctx)).id;
          await tx.update(conversation).set({ contextId: requestId }).where(eq(conversation.id, id));
        }
        const pending = nextQuestions(missingMandatory(current));
        const draft = await d.ai.draftRequest({ text: body.text, current, pending });

        let view: RequestView;
        if (draft.changes.length > 0) {
          view = await svc.applyChanges(tx, a.ctx, requestId, draft.changes, 'AI', cfg, 'ai.apply');
        } else {
          const l = (await loadRequest(tx, a.user.tenantId, requestId))!;
          view = toView(l.row, l.fields, await loadSettings(tx, a.user.tenantId));
        }
        await d.audit.record(tx, a.ctx, {
          action: 'ai.propose',
          entityType: 'conversation',
          entityId: id,
          after: {
            provider: d.ai.name,
            simulated: d.ai.simulated,
            requestId,
            changed: draft.changes.map((c) => c.key),
            stillMissing: draft.stillMissing,
          },
        });
        const proposed = [
          ...draft.changes.map((c) => ({
            key: c.key,
            label: FIELD_BY_KEY.get(c.key)?.label ?? c.key,
            value: c.value,
            source: 'AI',
            aiDrafted: true,
          })),
          ...draft.stillMissing.map((k) => ({
            key: k,
            label: FIELD_BY_KEY.get(k)?.label ?? k,
            source: 'AI',
            missing: true,
          })),
        ];
        const [assistant] = await tx
          .insert(chatMessage)
          .values({
            tenantId: a.user.tenantId,
            conversationId: id,
            role: 'ASSISTANT',
            text: draft.reply,
            proposedChanges: proposed,
          })
          .returning();
        return { assistant: assistant!, proposed, view, requestId };
      });
      return reply.status(201).send({
        id: result.assistant.id,
        role: 'ASSISTANT',
        text: result.assistant.text,
        createdAt: result.assistant.createdAt.toISOString(),
        proposedChanges: result.proposed,
        requestId: result.requestId,
        request: result.view,
      });
    },
  );

  return done;
}

/** Splits the PATCH body into the list of field changes the service understands. */
function toChanges(b: z.infer<typeof patchBody>): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = [];
  for (const k of ['title', 'category', 'businessUnit'] as const)
    if (b[k] !== undefined) out.push({ key: k, value: b[k]! });
  if (b.estimatedValue !== undefined) out.push({ key: 'estimatedValue', value: String(b.estimatedValue) });
  if (b.termMonths !== undefined) out.push({ key: 'termMonths', value: String(b.termMonths) });
  for (const [k, v] of Object.entries(b.fields ?? {})) out.push({ key: k, value: v });
  return out;
}
