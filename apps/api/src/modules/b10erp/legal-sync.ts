/**
 * Legal system status sync by signed webhook (NFR-C03), built on the connector layer (b10conn).
 *
 *   INBOUND  POST /integrations/legal/events            public, signed (X-IF-Signature, X-IF-Timestamp, HMAC-SHA256)
 *            events MATTER_STAGE_CHANGED, DOCUMENT_ATTACHED, MATTER_CLOSED; applied to the matter and shown on the contract page;
 *            idempotent by event id; a failure is kept (FAILED, then DEAD_LETTER after MAX_ATTEMPTS) and can be reprocessed
 *   OUTBOUND POST /legal-matters/{id}/sync-status       our matter status sent as a signed MATTER_STATUS_UPDATE through the connector
 *   DEMO     POST /integrations/legal/simulate          builds a correctly signed inbound event, so no external caller is needed
 *   VIEW     GET  /contracts/{id}/legal-sync            matter stage, documents and event history for the contract page
 *
 * The older redline webhook (POST /integrations/legal/webhook, modules/b8) is unchanged and still works alongside this one.
 *
 * SWAP POINT (docs/swap-points.md): the customer's legal platform (for example HighQ, Icertis or ServiceNow Legal) is configured
 * to call `/api/v1/integrations/legal/events` with the connector secret from the secret store and to send the three event types
 * in the shape documented here; its own message format is mapped on the middleware or in a small adapter in front of this
 * endpoint. The simulation endpoint is removed (or left ADMIN-only) in production.
 */
import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { guard } from '../../auth/guard.js';
import { withContext, withSystem, type Tx } from '../../db/client.js';
import {
  connector,
  contract,
  integrationEvent,
  legalMatter,
  legalMatterDocument,
  legalMatterSync,
  tenant,
} from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { eventView, deliver } from '../b8/integration.js';
import { getConnector, healthOf } from '../b10conn/connectors.js';
import { MAX_ATTEMPTS, enqueueOutbound, nextAttemptFor } from '../b10conn/delivery.js';
import { connectorSecret } from '../b10conn/secrets.js';
import { signedHeaders, verifyMessage } from '../b10conn/signing.js';
import { loadSettings } from '../settings/settings.js';
import type { B10bDeps } from './index.js';
import { ensureSimulatedSecret, sysCtx } from './shared.js';

export const LEGAL_EVENT_TYPES = ['MATTER_STAGE_CHANGED', 'DOCUMENT_ATTACHED', 'MATTER_CLOSED'] as const;
export type LegalEventType = (typeof LEGAL_EVENT_TYPES)[number];

const inboundBody = z
  .object({
    eventId: z.string().min(6).max(100),
    type: z.enum(LEGAL_EVENT_TYPES),
    data: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
const dataSchemas = {
  MATTER_STAGE_CHANGED: z
    .object({ matterRef: z.string().min(3).max(60), stage: z.string().trim().min(2).max(60) })
    .passthrough(),
  DOCUMENT_ATTACHED: z
    .object({
      matterRef: z.string().min(3).max(60),
      documentId: z.string().min(1).max(100),
      name: z.string().trim().min(1).max(200),
      kind: z.string().max(60).optional(),
    })
    .passthrough(),
  MATTER_CLOSED: z
    .object({ matterRef: z.string().min(3).max(60), outcome: z.string().trim().max(120).optional() })
    .passthrough(),
} as const;

/** The board lane a stage name belongs to; the same reading as the redline webhook uses. */
export function laneFor(stage: string, current: 'NEW' | 'IN_REVIEW' | 'WAITING' | 'DONE') {
  if (/complete|signed|closed|done|executed/i.test(stage)) return 'DONE' as const;
  if (/wait|counterparty|external|hold|pending/i.test(stage)) return 'WAITING' as const;
  if (/review|negotiat|markup|redline|progress/i.test(stage)) return 'IN_REVIEW' as const;
  return current;
}

type Applied = { ok: true; detail: Record<string, unknown> } | { ok: false; error: string };

/** Applies one validated event to the matter. Returns a result instead of throwing, so a failure never aborts the transaction. */
async function applyEvent(
  tx: Tx,
  tenantId: string,
  eventId: string,
  type: LegalEventType,
  data: Record<string, unknown>,
  at: Date,
): Promise<Applied> {
  const schema = dataSchemas[type].safeParse(data);
  if (!schema.success)
    return {
      ok: false,
      error: `The message is not a valid ${type}: ${schema.error.issues[0]?.message ?? ''}`,
    };
  const ref = schema.data.matterRef;
  const [m] = await tx
    .select()
    .from(legalMatter)
    .where(and(eq(legalMatter.tenantId, tenantId), eq(legalMatter.externalRef, ref)));
  if (!m) return { ok: false, error: `No matter on this platform carries the reference ${ref}` };
  const [cur] = await tx.select().from(legalMatterSync).where(eq(legalMatterSync.matterId, m.id));
  const upsert = async (set: Partial<typeof legalMatterSync.$inferInsert>) => {
    if (cur)
      await tx
        .update(legalMatterSync)
        .set({ ...set, updatedAt: at })
        .where(eq(legalMatterSync.matterId, m.id));
    else await tx.insert(legalMatterSync).values({ matterId: m.id, tenantId, updatedAt: at, ...set });
  };
  if (type === 'MATTER_STAGE_CHANGED') {
    const stage = (schema.data as { stage: string }).stage;
    if (cur?.closedAt)
      return { ok: true, detail: { matterId: m.id, ignored: 'The matter is already closed', stage } };
    const lane = laneFor(stage, m.lane);
    await tx
      .update(legalMatter)
      .set({ externalStage: stage, lane, updatedAt: at })
      .where(eq(legalMatter.id, m.id));
    await upsert({ stage, lastEventId: eventId });
    return { ok: true, detail: { matterId: m.id, stage, lane } };
  }
  if (type === 'DOCUMENT_ATTACHED') {
    const doc = schema.data as { documentId: string; name: string; kind?: string };
    const [row] = await tx
      .insert(legalMatterDocument)
      .values({
        tenantId,
        matterId: m.id,
        externalId: doc.documentId,
        name: doc.name,
        docKind: doc.kind ?? null,
        eventId,
        attachedAt: at,
      })
      .onConflictDoNothing()
      .returning({ id: legalMatterDocument.id });
    await upsert({ lastEventId: eventId });
    return { ok: true, detail: { matterId: m.id, document: doc.name, alreadyAttached: !row } };
  }
  const outcome = (schema.data as { outcome?: string }).outcome ?? null;
  if (cur?.closedAt) return { ok: true, detail: { matterId: m.id, ignored: 'The matter is already closed' } };
  await tx
    .update(legalMatter)
    .set({ externalStage: 'Closed', lane: 'DONE', updatedAt: at })
    .where(eq(legalMatter.id, m.id));
  await upsert({ stage: 'Closed', closedAt: at, outcome, lastEventId: eventId });
  return { ok: true, detail: { matterId: m.id, closed: true, outcome } };
}

export interface ReceiveResult {
  httpStatus: 200 | 202 | 401 | 409;
  body: Record<string, unknown>;
}

/** Marks an inbound event failed, schedules the next attempt, and parks it as DEAD_LETTER after too many attempts. */
async function failInbound(tx: Tx, d: B10bDeps, ev: typeof integrationEvent.$inferSelect, error: string) {
  const attempts = ev.attempts + 1;
  const dead = attempts >= MAX_ATTEMPTS;
  const [row] = await tx
    .update(integrationEvent)
    .set({
      status: dead ? 'DEAD_LETTER' : 'FAILED',
      attempts,
      lastError: error.slice(0, 500),
      nextAttemptAt: nextAttemptFor(attempts, d.clock.now()),
    })
    .where(eq(integrationEvent.id, ev.id))
    .returning();
  await d.audit.record(tx, sysCtx(ev.tenantId), {
    action: dead ? 'integration.dead_letter' : 'integration.failed',
    entityType: 'integration_event',
    entityId: ev.id,
    result: 'FAILED',
    after: { kind: ev.kind, direction: 'IN', error: error.slice(0, 200), attempts },
  });
  return row!;
}

async function processInbound(
  tx: Tx,
  d: B10bDeps,
  ev: typeof integrationEvent.$inferSelect,
): Promise<ReceiveResult> {
  const payload = ev.payload as { type: LegalEventType; data: Record<string, unknown>; eventId?: string };
  const eventId = ev.idempotencyKey.replace('in:legal:', '');
  const res = await applyEvent(tx, ev.tenantId, eventId, payload.type, payload.data, d.clock.now());
  if (!res.ok) {
    const row = await failInbound(tx, d, ev, res.error);
    return {
      httpStatus: 202,
      body: {
        accepted: false,
        eventId,
        status: row.status,
        attempts: row.attempts,
        error: res.error,
        retry:
          row.status === 'FAILED'
            ? 'Send the same event id again, or reprocess it from the connector page'
            : 'Reprocess it by hand',
      },
    };
  }
  const at = d.clock.now();
  await tx
    .update(integrationEvent)
    .set({
      status: 'DELIVERED',
      attempts: ev.attempts + 1,
      lastError: null,
      deliveredAt: at,
      nextAttemptAt: null,
      payload: { ...payload, applied: res.detail },
    })
    .where(eq(integrationEvent.id, ev.id));
  await d.audit.record(tx, sysCtx(ev.tenantId), {
    action: 'integration.legal_sync',
    entityType: 'legal_matter',
    entityId: (res.detail.matterId as string | undefined) ?? null,
    after: { type: payload.type, eventId, ...res.detail },
  });
  return {
    httpStatus: 200,
    body: { accepted: true, duplicate: false, eventId, status: 'DELIVERED', applied: res.detail },
  };
}

/**
 * The one place an inbound legal event is verified, deduplicated and applied. The public endpoint and the demonstration
 * endpoint both end here, so what is shown is exactly what an outside caller gets.
 */
export async function receiveLegalEvent(
  tx: Tx,
  d: B10bDeps,
  input: {
    tenantSlug: string;
    body: unknown;
    signature: string | undefined;
    timestamp: string | undefined;
  },
): Promise<ReceiveResult> {
  const denied: ReceiveResult = {
    httpStatus: 401,
    body: { code: 'UNAUTHORIZED', message: 'The message could not be verified' },
  };
  const parsed = inboundBody.safeParse(input.body);
  const [t] = await tx.select({ id: tenant.id }).from(tenant).where(eq(tenant.slug, input.tenantSlug));
  const c = t ? await getConnector(tx, t.id, 'LEGAL') : undefined;
  if (!t || !c || !c.enabled) return denied;
  const settings = await loadSettings(tx, t.id);
  const secret = await connectorSecret(tx, t.id, 'LEGAL', settings.legalPlatform.webhookSecret);
  const reject = async (reason: string) => {
    await tx
      .update(connector)
      .set({ rejectedCount: c.rejectedCount + 1, lastRejectedAt: d.clock.now(), lastRejectedReason: reason })
      .where(eq(connector.id, c.id));
    await d.audit.record(tx, sysCtx(t.id), {
      action: 'integration.webhook_rejected',
      entityType: 'connector',
      entityId: c.id,
      result: 'FAILED',
      after: { kind: 'LEGAL', reason },
    });
    return denied;
  };
  const v = verifyMessage({
    secret,
    signature: input.signature,
    timestamp: input.timestamp,
    body: input.body,
    clock: d.clock,
  });
  if (!v.ok) return reject(v.reason);
  if (!parsed.success)
    return {
      httpStatus: 202,
      body: { accepted: false, error: `The message is not valid: ${parsed.error.issues[0]?.message ?? ''}` },
    };
  const key = `in:legal:${parsed.data.eventId}`;
  const [seen] = await tx
    .select()
    .from(integrationEvent)
    .where(and(eq(integrationEvent.tenantId, t.id), eq(integrationEvent.idempotencyKey, key)));
  if (seen && seen.status === 'DELIVERED')
    return {
      httpStatus: 200,
      body: { accepted: true, duplicate: true, eventId: parsed.data.eventId, status: 'DELIVERED' },
    };
  if (seen && seen.status === 'DEAD_LETTER')
    return {
      httpStatus: 202,
      body: {
        accepted: false,
        duplicate: true,
        eventId: parsed.data.eventId,
        status: 'DEAD_LETTER',
        error: seen.lastError,
      },
    };
  let ev = seen;
  if (!ev) {
    [ev] = await tx
      .insert(integrationEvent)
      .values({
        tenantId: t.id,
        kind: parsed.data.type,
        connectorKind: 'LEGAL',
        direction: 'IN',
        target: c.provider,
        idempotencyKey: key,
        payload: { type: parsed.data.type, data: parsed.data.data },
        status: 'PENDING',
        attempts: 0,
        createdAt: d.clock.now(),
      })
      .returning();
    await d.audit.record(tx, sysCtx(t.id), {
      action: 'integration.webhook_received',
      entityType: 'connector',
      entityId: c.id,
      after: { kind: 'LEGAL', eventId: parsed.data.eventId, type: parsed.data.type },
    });
  }
  return processInbound(tx, d, ev!);
}

const simulateBody = z
  .object({
    matterId: z.string().uuid(),
    type: z.enum(LEGAL_EVENT_TYPES),
    stage: z.string().trim().min(2).max(60).optional(),
    documentName: z.string().trim().min(1).max(200).optional(),
    outcome: z.string().trim().max(120).optional(),
    /** Send an event id that was already used, to show that a repeat changes nothing. */
    eventId: z.string().min(6).max(100).optional(),
    /** Corrupt the signature, to show that an unsigned or altered message is refused. */
    badSignature: z.boolean().optional(),
    /** Send a reference that matches no matter, to show a failure that is kept and can be retried. */
    unknownMatter: z.boolean().optional(),
  })
  .strict();

const LEGAL_READ = ['ADMIN', 'LEGAL', 'PROCUREMENT', 'DELEGATE', 'EXEC', 'CONTRACT_MGR'] as const;
const LEGAL_WORK = ['ADMIN', 'LEGAL'] as const;
const uuid = z.string().uuid();

export function registerLegalSync(app: FastifyInstance, p: string, d: B10bDeps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);
  const header = (req: { headers: Record<string, unknown> }, n: string) => {
    const v = req.headers[n];
    return Array.isArray(v) ? (v[0] as string) : (v as string | undefined);
  };

  reg('POST', '/integrations/legal/events');
  app.post(
    `${p}/integrations/legal/events`,
    { preHandler: guard(d, 'public'), config: { rateLimit: { max: 300, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const r = await withSystem(d.database, (tx) =>
        receiveLegalEvent(tx, d, {
          tenantSlug: header(req, 'x-if-tenant') ?? d.defaultTenantSlug,
          body: req.body,
          signature: header(req, 'x-if-signature'),
          timestamp: header(req, 'x-if-timestamp'),
        }),
      );
      if (r.httpStatus === 401) throw new AppError(401, 'UNAUTHORIZED', 'The message could not be verified');
      return reply.status(r.httpStatus).send(r.body);
    },
  );

  reg('POST', '/integrations/legal/simulate');
  app.post(`${p}/integrations/legal/simulate`, { preHandler: guard(d, [...LEGAL_WORK]) }, async (req) => {
    const a = req.auth!;
    const b = parse(simulateBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const [m] = await tx
        .select()
        .from(legalMatter)
        .where(and(eq(legalMatter.id, b.matterId), eq(legalMatter.tenantId, a.user.tenantId)));
      if (!m) throw new AppError(404, 'NOT_FOUND', 'Matter not found');
      if (!m.externalRef && !b.unknownMatter)
        throw new AppError(
          409,
          'MATTER_NOT_LINKED',
          'This matter has no reference in the legal system yet. It is sent when the legal system is reachable; then simulate an event.',
        );
      const c = await getConnector(tx, a.user.tenantId, 'LEGAL');
      if (!c || !c.enabled) throw new AppError(409, 'CONNECTOR_OFF', 'The legal connector is switched off');
      const matterRef = b.unknownMatter ? 'NO-SUCH-MATTER' : m.externalRef!;
      const data: Record<string, unknown> =
        b.type === 'MATTER_STAGE_CHANGED'
          ? { matterRef, stage: b.stage ?? 'In review' }
          : b.type === 'DOCUMENT_ATTACHED'
            ? {
                matterRef,
                documentId: `DOC-${randomUUID().slice(0, 8)}`,
                name: b.documentName ?? 'Counterparty markup v2.docx',
                kind: 'MARKUP',
              }
            : { matterRef, outcome: b.outcome ?? 'Executed' };
      const body = { eventId: b.eventId ?? `SIM-${randomUUID().slice(0, 12)}`, type: b.type, data };
      const secret = await ensureSimulatedSecret(
        tx,
        d,
        a.ctx,
        'LEGAL',
        (await loadSettings(tx, a.user.tenantId)).legalPlatform.webhookSecret,
      );
      const headers = signedHeaders(secret, d.clock, body);
      const sig = b.badSignature
        ? headers['X-IF-Signature'].replace(/.$/, (ch) => (ch === '0' ? '1' : '0'))
        : headers['X-IF-Signature'];
      const [tn] = await tx.select({ slug: tenant.slug }).from(tenant).where(eq(tenant.id, a.user.tenantId));
      const out = await receiveLegalEvent(tx, d, {
        tenantSlug: tn!.slug,
        body,
        signature: sig,
        timestamp: headers['X-IF-Timestamp'],
      });
      await d.audit.record(tx, a.ctx, {
        action: 'integration.legal_simulated',
        entityType: 'legal_matter',
        entityId: m.id,
        after: { type: b.type, eventId: body.eventId, httpStatus: out.httpStatus },
      });
      return {
        simulated: true,
        sent: body,
        signed: {
          algorithm: 'HMAC-SHA256',
          timestamp: headers['X-IF-Timestamp'],
          signaturePrefix: sig.slice(0, 12),
        },
        httpStatus: out.httpStatus,
        result: out.body,
      };
    });
  });

  reg('POST', '/integrations/legal/events/{id}/reprocess');
  app.post(
    `${p}/integrations/legal/events/:id/reprocess`,
    { preHandler: guard(d, [...LEGAL_WORK]) },
    async (req) => {
      const a = req.auth!;
      const { id } = parse(z.object({ id: uuid }), req.params);
      return withContext(d.database, a.ctx, async (tx) => {
        const [ev] = await tx
          .select()
          .from(integrationEvent)
          .where(and(eq(integrationEvent.id, id), eq(integrationEvent.tenantId, a.user.tenantId)));
        if (!ev || ev.direction !== 'IN' || ev.connectorKind !== 'LEGAL')
          throw new AppError(404, 'NOT_FOUND', 'Inbound legal event not found');
        if (ev.status === 'DELIVERED')
          throw new AppError(409, 'ALREADY_APPLIED', 'This event was already applied');
        const fresh = ev.status === 'DEAD_LETTER' ? { ...ev, attempts: 0 } : ev;
        if (ev.status === 'DEAD_LETTER')
          await tx
            .update(integrationEvent)
            .set({ attempts: 0, status: 'FAILED' })
            .where(eq(integrationEvent.id, ev.id));
        const out = await processInbound(tx, d, fresh);
        await d.audit.record(tx, a.ctx, {
          action: 'integration.reprocess',
          entityType: 'integration_event',
          entityId: id,
          after: { status: out.body.status as string },
        });
        const [row] = await tx.select().from(integrationEvent).where(eq(integrationEvent.id, id));
        return { ...eventView(row!), result: out.body };
      });
    },
  );

  reg('POST', '/legal-matters/{id}/sync-status');
  app.post(
    `${p}/legal-matters/:id/sync-status`,
    { preHandler: guard(d, ['ADMIN', 'LEGAL', 'PROCUREMENT']) },
    async (req) => {
      const a = req.auth!;
      const { id } = parse(z.object({ id: uuid }), req.params);
      return withContext(d.database, a.ctx, async (tx) => {
        const [m] = await tx
          .select()
          .from(legalMatter)
          .where(and(eq(legalMatter.id, id), eq(legalMatter.tenantId, a.user.tenantId)));
        if (!m) throw new AppError(404, 'NOT_FOUND', 'Matter not found');
        const [k] = m.contractId
          ? await tx.select({ n: contract.number }).from(contract).where(eq(contract.id, m.contractId))
          : [];
        const c = await getConnector(tx, a.user.tenantId, 'LEGAL');
        if (c?.enabled)
          await ensureSimulatedSecret(
            tx,
            d,
            a.ctx,
            'LEGAL',
            (await loadSettings(tx, a.user.tenantId)).legalPlatform.webhookSecret,
          );
        const r = await enqueueOutbound(tx, d, a.ctx, {
          kind: 'LEGAL',
          eventKind: 'MATTER_STATUS_UPDATE',
          key: `matter-status:${m.id}:${m.lane}:${m.updatedAt.getTime()}`,
          payload: {
            ref: m.externalRef ?? m.id,
            matterId: m.id,
            matterRef: m.externalRef,
            lane: m.lane,
            priority: m.priority,
            contractNumber: k?.n ?? null,
          },
        });
        const ev = r.created ? await deliver(tx, d, a.ctx, r.event) : r.event;
        await d.audit.record(tx, a.ctx, {
          action: 'integration.legal_status_sent',
          entityType: 'legal_matter',
          entityId: m.id,
          after: { lane: m.lane, status: ev.status, duplicate: !r.created },
        });
        return { ...eventView(ev), duplicate: !r.created };
      });
    },
  );

  reg('GET', '/contracts/{id}/legal-sync');
  app.get(`${p}/contracts/:id/legal-sync`, { preHandler: guard(d, [...LEGAL_READ]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    return withContext(d.database, a.ctx, async (tx) => {
      const [c] = await tx
        .select({ id: contract.id })
        .from(contract)
        .where(and(eq(contract.id, id), eq(contract.tenantId, a.user.tenantId)));
      if (!c) throw new AppError(404, 'NOT_FOUND', 'Contract not found');
      const matters = await tx
        .select()
        .from(legalMatter)
        .where(and(eq(legalMatter.tenantId, a.user.tenantId), eq(legalMatter.contractId, id)))
        .orderBy(desc(legalMatter.createdAt));
      const conn = await getConnector(tx, a.user.tenantId, 'LEGAL');
      const out = [];
      for (const m of matters) {
        const [sync] = await tx.select().from(legalMatterSync).where(eq(legalMatterSync.matterId, m.id));
        const docs = await tx
          .select()
          .from(legalMatterDocument)
          .where(eq(legalMatterDocument.matterId, m.id))
          .orderBy(desc(legalMatterDocument.attachedAt));
        const events = await tx
          .select()
          .from(integrationEvent)
          .where(
            and(
              eq(integrationEvent.tenantId, a.user.tenantId),
              eq(integrationEvent.connectorKind, 'LEGAL'),
              or(
                sql`${integrationEvent.payload}->>'matterId' = ${m.id}`,
                m.externalRef
                  ? sql`${integrationEvent.payload}->'data'->>'matterRef' = ${m.externalRef}`
                  : sql`false`,
              )!,
              inArray(integrationEvent.status, ['PENDING', 'DELIVERED', 'FAILED', 'DEAD_LETTER']),
            ),
          )
          .orderBy(desc(integrationEvent.createdAt))
          .limit(30);
        out.push({
          id: m.id,
          title: m.title,
          externalRef: m.externalRef,
          lane: m.lane,
          stage: sync?.stage ?? m.externalStage,
          closedAt: sync?.closedAt?.toISOString() ?? null,
          outcome: sync?.outcome ?? null,
          documents: docs.map((x) => ({
            id: x.id,
            name: x.name,
            kind: x.docKind,
            attachedAt: x.attachedAt.toISOString(),
          })),
          events: events.map((e) => ({
            id: e.id,
            eventId: e.idempotencyKey.replace(/^in:legal:/, ''),
            type: e.kind,
            direction: e.direction,
            status: e.status,
            attempts: e.attempts,
            lastError: e.lastError,
            nextAttemptAt: e.nextAttemptAt?.toISOString() ?? null,
            at: e.createdAt.toISOString(),
          })),
        });
      }
      return {
        simulated: true,
        connector: conn ? { provider: conn.provider, enabled: conn.enabled, health: healthOf(conn) } : null,
        matters: out,
      };
    });
  });

  return done;
}
