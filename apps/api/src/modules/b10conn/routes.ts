/**
 * Batch B10a routes: the connector catalogue and health (NFR-C07), the secret store (SEC-N03), resilient provider calls and
 * their test (NFR-C05), delivery, reconciliation and dead letters (NFR-AV03), signed webhooks (SEC-TP04) and the manual
 * fallback tasks (NFR-AV04).
 */
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { guard, type GuardDeps } from '../../auth/guard.js';
import { withContext, withSystem, type RequestContext } from '../../db/client.js';
import { connector, integrationEvent, manualTask, supplier, syncRun, tenant } from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { assertOutbound, refusable } from '../b11priv/outbound.js';
import { purposeForKind } from '../b11priv/region.js';
import { deliver, eventView, type IntegrationDeps } from '../b8/integration.js';
import { CONNECTOR_MODEL, kindEntry, providerEntry } from './catalogue.js';
import { catalogueView, configSchema, connectorViews, getConnector, kindParam } from './connectors.js';
import { enqueueOutbound } from './delivery.js';
import { completeManualTask, reconcile, requeue, runDueDeliveries } from './dispatch.js';
import { SimulatedSanctionsProvider, UNVERIFIED_LABEL } from './providers.js';
import { callProvider } from './resilience.js';
import { insuranceVia, sanctionsVia } from './screening.js';
import {
  configureSecretStore,
  connectorSecretName,
  listSecrets,
  readSecret,
  SECRET_NAME,
  setSecret,
} from './secrets.js';
import { ALGORITHM, REPLAY_WINDOW_SECONDS, verifyMessage } from './signing.js';

export interface ConnectorDeps extends GuardDeps {
  /** Key material for the secret store: SECRET_STORE_KEY, or SESSION_SECRET in development and test. */
  secretKeyMaterial: string;
  defaultTenantSlug: string;
  schedulerMinutes?: number | undefined;
  legal?: IntegrationDeps['legal'];
  sleep?: IntegrationDeps['sleep'];
}

export const READERS = ['ADMIN', 'PROCUREMENT', 'FINANCE', 'LEGAL', 'EXEC'] as const;
const OPERATORS = ['ADMIN', 'PROCUREMENT'] as const;
const WORKERS = ['ADMIN', 'PROCUREMENT', 'FINANCE', 'LEGAL'] as const;

const putConnector = z
  .object({
    provider: z.string().trim().min(2).max(60).optional(),
    enabled: z.boolean().optional(),
    mode: z.enum(['UP', 'DOWN']).optional(),
    config: configSchema.optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to change' });
const putSecret = z.object({ value: z.string().min(8).max(4000) }).strict();
const syncBody = z
  .object({
    items: z
      .array(
        z
          .object({ ref: z.string().trim().min(1).max(60), summary: z.string().trim().max(200).optional() })
          .strict(),
      )
      .min(1)
      .max(25)
      .optional(),
  })
  .strict();
const completeBody = z.object({ reference: z.string().trim().min(1).max(100) }).strict();
const webhookBody = z
  .object({
    eventId: z.string().min(6).max(100),
    type: z.string().trim().min(1).max(60),
    data: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
const uuid = z.string().uuid();

export function registerConnectors(app: FastifyInstance, p: string, d: ConnectorDeps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);
  configureSecretStore(d.secretKeyMaterial);
  const now = () => d.clock.now();
  const sys = (tenantId: string): RequestContext => ({ tenantId, userId: null, role: 'SYSTEM' });
  const integ: IntegrationDeps = {
    clock: d.clock,
    audit: d.audit,
    ...(d.legal ? { legal: d.legal } : {}),
    ...(d.sleep ? { sleep: d.sleep } : {}),
  };
  const publicLimit = { config: { rateLimit: { max: 300, timeWindow: '15 minutes' } } };

  if (d.schedulerMinutes) {
    const h = setInterval(
      () => void runDueDeliveries(d.database, integ).catch(() => undefined),
      d.schedulerMinutes * 60_000,
    );
    h.unref();
    app.addHook('onClose', async () => clearInterval(h));
  }

  // ---------------------------------------------------------------- catalogue and health (NFR-C07)
  reg('GET', '/connectors');
  app.get(`${p}/connectors`, { preHandler: guard(d, [...READERS]) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => ({
      model: CONNECTOR_MODEL,
      simulated: true,
      catalogue: catalogueView(),
      connectors: await connectorViews(tx, a.user.tenantId),
    }));
  });

  reg('PUT', '/connectors/{kind}');
  app.put(`${p}/connectors/:kind`, { preHandler: guard(d, ['ADMIN']) }, async (req) => {
    const a = req.auth!;
    const { kind } = parse(kindParam, req.params);
    const body = parse(putConnector, req.body);
    if (body.provider && !providerEntry(kind, body.provider))
      throw new AppError(422, 'UNKNOWN_PROVIDER', `${body.provider} is not in the catalogue for ${kind}`, [
        {
          field: 'provider',
          message: `Choose one of: ${kindEntry(kind)!
            .providers.map((x) => x.id)
            .join(', ')}`,
        },
      ]);
    return refusable(d.database, a.ctx, async (tx) => {
      const before = await getConnector(tx, a.user.tenantId, kind);
      const provider = body.provider ?? before?.provider ?? kindEntry(kind)!.providers[0]!.id;
      const mode = body.mode ?? before?.mode ?? 'UP';
      // SEC-D09, SEC-D05: a connector that would send data outside the elected country, or to a host that is not on the
      // egress allow-list, cannot be switched on or chosen. Checked before anything is written.
      if ((body.enabled ?? before?.enabled ?? true) && (body.provider || body.enabled === true || !before)) {
        const entry = providerEntry(kind, provider)!;
        await assertOutbound(tx, a.user.tenantId, {
          purpose: purposeForKind(kind),
          target: { label: entry.label, host: entry.host, region: entry.region },
          actorId: a.user.id,
        });
      }
      // putting a connector back UP is a person saying it works again: the breaker is closed
      const reset = before && before.mode === 'DOWN' && mode === 'UP';
      const values = {
        provider,
        enabled: body.enabled ?? before?.enabled ?? true,
        mode,
        config: body.config ?? (before?.config as object) ?? {},
        updatedBy: a.user.id,
        updatedAt: now(),
        ...(reset || body.provider
          ? { breakerState: 'CLOSED' as const, consecutiveFailures: 0, breakerOpenedAt: null }
          : {}),
      };
      let rowId = before?.id;
      if (before) await tx.update(connector).set(values).where(eq(connector.id, before.id));
      else
        rowId = (
          await tx
            .insert(connector)
            .values({ tenantId: a.user.tenantId, kind, createdAt: now(), ...values })
            .returning({ id: connector.id })
        )[0]!.id;
      await d.audit.record(tx, a.ctx, {
        action: 'connector.update',
        entityType: 'connector',
        entityId: rowId,
        before: before
          ? { provider: before.provider, enabled: before.enabled, mode: before.mode, config: before.config }
          : undefined,
        after: { provider, enabled: values.enabled, mode, config: values.config },
      });
      return (await connectorViews(tx, a.user.tenantId)).find((c) => c.kind === kind)!;
    });
  });

  // ---------------------------------------------------------------- health check, with the breaker state (NFR-C05)
  reg('POST', '/connectors/{kind}/test');
  app.post(`${p}/connectors/:kind/test`, { preHandler: guard(d, [...OPERATORS]) }, async (req) => {
    const a = req.auth!;
    const { kind } = parse(kindParam, req.params);
    return withContext(d.database, a.ctx, async (tx) => {
      const c = await getConnector(tx, a.user.tenantId, kind);
      if (!c) throw new AppError(404, 'NOT_FOUND', `No ${kind} connector is configured`);
      const out = await callProvider(
        tx,
        { clock: d.clock, ...(d.sleep ? { sleep: d.sleep } : {}) },
        a.user.tenantId,
        kind,
        async () => ({ pong: true, provider: c.provider }),
        { fallback: () => null, retries: 0 },
      );
      await d.audit.record(tx, a.ctx, {
        action: 'connector.test',
        entityType: 'connector',
        entityId: c.id,
        result: out.ok ? 'SUCCESS' : 'FAILED',
        after: { kind, ok: out.ok, breaker: out.breaker, ...(out.ok ? {} : { reason: out.reason }) },
      });
      const view = (await connectorViews(tx, a.user.tenantId)).find((v) => v.kind === kind)!;
      return {
        kind,
        ok: out.ok,
        simulated: true,
        reason: out.ok ? null : out.reason,
        error: out.ok ? null : out.error,
        attempts: out.attempts,
        breaker: out.breaker,
        health: view.health,
      };
    });
  });

  // ---------------------------------------------------------------- sending, and reconciliation (NFR-AV03)
  reg('POST', '/connectors/{kind}/sync');
  app.post(
    `${p}/connectors/:kind/sync`,
    { preHandler: guard(d, ['ADMIN', 'PROCUREMENT', 'FINANCE']) },
    async (req, reply) => {
      const a = req.auth!;
      const { kind } = parse(kindParam, req.params);
      const body = parse(syncBody, req.body ?? {});
      const items =
        body.items ??
        [1, 2, 3].map((n) => ({ ref: `SYNC-${String(n).padStart(3, '0')}`, summary: 'Synthetic record' }));
      const out = await withContext(d.database, a.ctx, async (tx) => {
        const c = await getConnector(tx, a.user.tenantId, kind);
        if (!c) throw new AppError(404, 'NOT_FOUND', `No ${kind} connector is configured`);
        const events = [];
        let created = 0;
        for (const it of items) {
          const r = await enqueueOutbound(tx, integ, a.ctx, {
            kind,
            eventKind: `${kind}_SYNC`,
            key: `sync:${kind}:${it.ref}`,
            payload: { ref: it.ref, summary: it.summary ?? '' },
          });
          if (r.created) created += 1;
          events.push(r.created ? await deliver(tx, integ, a.ctx, r.event) : r.event);
        }
        await d.audit.record(tx, a.ctx, {
          action: 'connector.sync',
          entityType: 'connector',
          entityId: c.id,
          after: { kind, items: items.length, created },
        });
        return {
          created,
          duplicates: items.length - created,
          delivered: events.filter((e) => e.status === 'DELIVERED').length,
          events: events.map(eventView),
        };
      });
      return reply.status(201).send(out);
    },
  );

  reg('POST', '/connectors/{kind}/reconcile');
  app.post(`${p}/connectors/:kind/reconcile`, { preHandler: guard(d, [...OPERATORS]) }, async (req) => {
    const a = req.auth!;
    const { kind } = parse(kindParam, req.params);
    return withContext(d.database, a.ctx, async (tx) => runView(await reconcile(tx, integ, a.ctx, kind)));
  });

  reg('GET', '/connectors/sync-runs');
  app.get(`${p}/connectors/sync-runs`, { preHandler: guard(d, [...READERS]) }, async (req) => {
    const a = req.auth!;
    const q = parse(z.object({ kind: z.string().optional() }), req.query);
    return withContext(d.database, a.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(syncRun)
        .where(eq(syncRun.tenantId, a.user.tenantId))
        .orderBy(desc(syncRun.startedAt))
        .limit(50);
      return rows.filter((r) => !q.kind || r.connectorKind === q.kind.toUpperCase()).map(runView);
    });
  });

  reg('POST', '/integration-events/{id}/requeue');
  app.post(
    `${p}/integration-events/:id/requeue`,
    { preHandler: guard(d, ['ADMIN', 'PROCUREMENT', 'LEGAL']) },
    async (req) => {
      const a = req.auth!;
      const { id } = parse(z.object({ id: uuid }), req.params);
      return withContext(d.database, a.ctx, async (tx) => eventView(await requeue(tx, integ, a.ctx, id)));
    },
  );

  // ---------------------------------------------------------------- manual fallback (NFR-AV04)
  reg('GET', '/manual-tasks');
  app.get(`${p}/manual-tasks`, { preHandler: guard(d, [...READERS]) }, async (req) => {
    const a = req.auth!;
    const q = parse(z.object({ status: z.enum(['OPEN', 'DONE', 'SUPERSEDED']).optional() }), req.query);
    return withContext(d.database, a.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(manualTask)
        .where(
          and(
            eq(manualTask.tenantId, a.user.tenantId),
            ...(q.status ? [eq(manualTask.status, q.status)] : []),
          ),
        )
        .orderBy(desc(manualTask.createdAt))
        .limit(100);
      return rows.map(taskView);
    });
  });

  reg('POST', '/manual-tasks/{id}/complete');
  app.post(`${p}/manual-tasks/:id/complete`, { preHandler: guard(d, [...WORKERS]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    const body = parse(completeBody, req.body);
    return withContext(d.database, a.ctx, async (tx) =>
      taskView(await completeManualTask(tx, integ, a.ctx, id, body.reference)),
    );
  });

  // ---------------------------------------------------------------- the secret store (SEC-N03): values never come back
  reg('GET', '/secrets');
  app.get(`${p}/secrets`, { preHandler: guard(d, ['ADMIN']) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => ({
      store: 'local-aes-256-gcm',
      simulated: true,
      secrets: await listSecrets(tx, a.user.tenantId),
    }));
  });

  reg('PUT', '/secrets/{name}');
  app.put(`${p}/secrets/:name`, { preHandler: guard(d, ['ADMIN']) }, async (req) => {
    const a = req.auth!;
    const { name } = parse(
      z.object({ name: z.string().regex(SECRET_NAME, 'Use letters, digits, dots, dashes (2 to 80)') }),
      req.params,
    );
    const body = parse(putSecret, req.body);
    return withContext(d.database, a.ctx, async (tx) =>
      setSecret(tx, { audit: d.audit, now: now() }, a.ctx, name, body.value),
    );
  });

  // ---------------------------------------------------------------- middleware leg security evidence (SEC-TP04)
  reg('GET', '/connectors/{kind}/security');
  app.get(
    `${p}/connectors/:kind/security`,
    { preHandler: guard(d, ['ADMIN', 'PROCUREMENT', 'PROBITY', 'EXEC']) },
    async (req) => {
      const a = req.auth!;
      const { kind } = parse(kindParam, req.params);
      return withContext(d.database, a.ctx, async (tx) => {
        const c = await getConnector(tx, a.user.tenantId, kind);
        if (!c) throw new AppError(404, 'NOT_FOUND', `No ${kind} connector is configured`);
        const name = connectorSecretName(kind);
        const meta = (await listSecrets(tx, a.user.tenantId)).find((s) => s.name === name);
        const recent = await tx
          .select()
          .from(integrationEvent)
          .where(
            and(
              eq(integrationEvent.tenantId, a.user.tenantId),
              eq(integrationEvent.connectorKind, kind),
              eq(integrationEvent.direction, 'IN'),
            ),
          )
          .orderBy(desc(integrationEvent.createdAt))
          .limit(5);
        return {
          kind,
          simulated: true,
          algorithm: ALGORITHM,
          signedContent: 'timestamp + "." + canonical JSON body (keys sorted)',
          headers: ['X-IF-Signature', 'X-IF-Timestamp'],
          replayWindowSeconds: REPLAY_WINDOW_SECONDS,
          replayProtection:
            'An event id is accepted once; a second message with the same id is refused (409 REPLAYED)',
          outbound: 'Every delivery is signed with the connector secret',
          inboundEndpoint: `/api/v1/integrations/${kind}/webhook`,
          secret: {
            name,
            set: Boolean(meta),
            version: meta?.version ?? null,
            fingerprint: meta?.fingerprint ?? null,
            lastRotatedAt: meta?.lastRotatedAt ?? null,
          },
          rejected: {
            count: c.rejectedCount,
            lastAt: c.lastRejectedAt?.toISOString() ?? null,
            lastReason: c.lastRejectedReason,
          },
          recentInbound: recent.map((e) => ({
            eventId: e.idempotencyKey.replace(`in:${kind}:`, ''),
            type: e.kind,
            at: e.createdAt.toISOString(),
          })),
        };
      });
    },
  );

  // ---------------------------------------------------------------- generic inbound webhook (SEC-TP04, public)
  reg('POST', '/integrations/{kind}/webhook');
  app.post(
    `${p}/integrations/:kind/webhook`,
    { preHandler: guard(d, 'public'), ...publicLimit },
    async (req, reply) => {
      const { kind } = parse(kindParam, req.params);
      const body = parse(webhookBody, req.body);
      const h = (n: string) => {
        const v = req.headers[n];
        return Array.isArray(v) ? v[0] : v;
      };
      const slug = h('x-if-tenant') ?? d.defaultTenantSlug;
      const deny = () => new AppError(401, 'UNAUTHORIZED', 'The message could not be verified');
      if (kind === 'LEGAL') throw new AppError(404, 'NOT_FOUND', 'The legal platform has its own endpoint');
      const out = await withSystem(d.database, async (tx) => {
        const [t] = await tx.select({ id: tenant.id }).from(tenant).where(eq(tenant.slug, slug));
        const c = t ? await getConnector(tx, t.id, kind) : undefined;
        // the same answer for an unknown organisation, a switched-off connector and a bad signature
        if (!t || !c || !c.enabled) return { denied: true as const };
        const reject = async (reason: string, status: 401 | 409) => {
          await tx
            .update(connector)
            .set({ rejectedCount: c.rejectedCount + 1, lastRejectedAt: now(), lastRejectedReason: reason })
            .where(eq(connector.id, c.id));
          await d.audit.record(tx, sys(t.id), {
            action: 'integration.webhook_rejected',
            entityType: 'connector',
            entityId: c.id,
            result: 'FAILED',
            after: { kind, reason, eventId: body.eventId },
          });
          return { rejected: reason, status };
        };
        const secret = await readSecret(tx, t.id, connectorSecretName(kind));
        const v = verifyMessage({
          secret,
          signature: h('x-if-signature'),
          timestamp: h('x-if-timestamp'),
          body: req.body, // what the sender signed, before any defaults are filled in
          clock: d.clock,
        });
        if (!v.ok) return reject(v.reason, 401);
        const [seen] = await tx
          .insert(integrationEvent)
          .values({
            tenantId: t.id,
            kind: body.type,
            connectorKind: kind,
            direction: 'IN',
            target: c.provider,
            idempotencyKey: `in:${kind}:${body.eventId}`,
            payload: { type: body.type, data: body.data },
            status: 'DELIVERED',
            attempts: 1,
            createdAt: now(),
            deliveredAt: now(),
          })
          .onConflictDoNothing()
          .returning();
        if (!seen) return reject('REPLAYED', 409);
        await d.audit.record(tx, sys(t.id), {
          action: 'integration.webhook_received',
          entityType: 'connector',
          entityId: c.id,
          after: { kind, eventId: body.eventId, type: body.type },
        });
        return { accepted: true as const, eventId: body.eventId };
      });
      if ('denied' in out) throw deny();
      if ('rejected' in out)
        throw out.status === 409
          ? new AppError(409, 'REPLAYED', 'This event was already received and is refused')
          : deny();
      return reply.status(200).send(out);
    },
  );

  // ---------------------------------------------------------------- supplier verification through the resilient layer (NFR-C05)
  reg('POST', '/suppliers/{id}/verification');
  app.post(`${p}/suppliers/:id/verification`, { preHandler: guard(d, [...OPERATORS]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    return withContext(d.database, a.ctx, async (tx) => {
      const [s] = await tx
        .select()
        .from(supplier)
        .where(and(eq(supplier.id, id), eq(supplier.tenantId, a.user.tenantId)));
      if (!s) throw new AppError(404, 'NOT_FOUND', 'Supplier not found');
      const input = { company: s.company, abn: s.abn };
      const san = await sanctionsVia(tx, d.clock, a.user.tenantId, input, new SimulatedSanctionsProvider());
      const ins = await insuranceVia(tx, d.clock, a.user.tenantId, input);
      const at = now();
      if (san.result.status === 'UNVERIFIED') {
        // the stored status is left alone, and an unscreened supplier is marked as such but never as clear
        if (s.sanctionsStatus === 'PENDING')
          await tx.update(supplier).set({ sanctionsNote: UNVERIFIED_LABEL }).where(eq(supplier.id, s.id));
      } else
        await tx
          .update(supplier)
          .set({
            sanctionsStatus: san.result.status,
            sanctionsNote: san.result.reason ?? null,
            lastCheckedAt: at,
          })
          .where(eq(supplier.id, s.id));
      await d.audit.record(tx, a.ctx, {
        action: 'supplier.verification',
        entityType: 'supplier',
        entityId: s.id,
        result:
          san.result.status === 'UNVERIFIED' || ins.result.state === 'UNVERIFIED' ? 'FAILED' : 'SUCCESS',
        after: { sanctions: san.result.status, insurance: ins.result.state },
      });
      return {
        supplierId: s.id,
        simulated: true,
        sanctions: {
          state: san.result.status,
          label: san.result.status === 'UNVERIFIED' ? UNVERIFIED_LABEL : san.result.status,
          list: san.result.list ?? null,
          note: san.result.reason ?? null,
          breaker: san.outcome.breaker,
        },
        insurance: {
          state: ins.result.state,
          label: ins.result.state === 'UNVERIFIED' ? UNVERIFIED_LABEL : ins.result.state,
          coverAud: ins.result.coverAud,
          note: ins.result.note,
          breaker: ins.outcome.breaker,
        },
      };
    });
  });

  return done;
}

const runView = (r: typeof syncRun.$inferSelect) => ({
  id: r.id,
  connector: r.connectorKind,
  direction: r.direction,
  status: r.status,
  startedAt: r.startedAt.toISOString(),
  finishedAt: r.finishedAt?.toISOString() ?? null,
  expected: r.expectedCount,
  received: r.receivedCount,
  missing: r.missing as string[],
  repaired: r.repaired,
});

const taskView = (t: typeof manualTask.$inferSelect) => ({
  id: t.id,
  connector: t.connectorKind,
  title: t.title,
  instructions: t.instructions,
  summary: t.payloadSummary as Record<string, unknown>,
  eventId: t.eventId,
  status: t.status,
  reference: t.reference,
  createdAt: t.createdAt.toISOString(),
  completedAt: t.completedAt?.toISOString() ?? null,
});
