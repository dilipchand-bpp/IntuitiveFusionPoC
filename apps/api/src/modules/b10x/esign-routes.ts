/**
 * E-signature endpoints (NFR-C04): the envelope on a contract, the simulated signing ceremony a signatory opens from the link,
 * and the demonstration action that makes the simulated provider call back.
 * The release, sign and webhook routes are left as they are; this module listens to them (onSend) and acts afterwards, so a
 * provider problem can never fail a contract action.
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { guard, type GuardDeps } from '../../auth/guard.js';
import { withContext, withSystem, type RequestContext } from '../../db/client.js';
import { contract, esignEnvelope, esignEvent, esignSignatory } from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { CANONICAL_KINDS } from './esign-adapters.js';
import {
  ACTIVE_ENVELOPE,
  INTERNAL_HEADER,
  activeEnvelope,
  ceremonySummary,
  createEnvelopeFor,
  envelopeView,
  issueSigningLink,
  latestEnvelope,
  mirrorDecision,
  postProviderCallback,
  processInbound,
  signatoryForToken,
  type EsignDeps,
} from './esign.js';

export interface EsignRouteDeps extends GuardDeps {
  schedulerMinutes?: number | undefined;
}

const uuid = z.string().uuid();
const READERS = [
  'ADMIN',
  'PROCUREMENT',
  'LEGAL',
  'CONTRACT_MGR',
  'DELEGATE',
  'EXEC',
  'FINANCE',
  'PROBITY',
] as const;
const MANAGERS = ['ADMIN', 'LEGAL', 'PROCUREMENT'] as const;
const SIGNERS = ['DELEGATE', 'EXEC'] as const;
const simulateBody = z
  .object({
    type: z.enum(CANONICAL_KINDS as unknown as [string, ...string[]]),
    signatoryId: uuid.optional(),
    reason: z.string().trim().max(500).optional(),
    /** Repeat an earlier event id to see the platform refuse the replay. */
    eventId: z.string().min(6).max(100).optional(),
  })
  .strict();
const confirmBody = z
  .object({ decision: z.enum(['SIGN', 'DECLINE']), reason: z.string().trim().max(1000).optional() })
  .strict();
const tokenParam = z.object({ token: z.string().min(20).max(80) });

export function registerEsign(app: FastifyInstance, p: string, d: EsignRouteDeps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);
  const es: EsignDeps = {
    database: d.database,
    clock: d.clock,
    audit: d.audit,
    sessions: d.sessions,
    app,
    prefix: p,
  };

  // ------------------------------------------------------------ listening to the existing routes
  app.addHook('onSend', async (req, reply, payload) => {
    if (
      reply.statusCode !== 200 ||
      req.method !== 'POST' ||
      (!req.auth && !req.routeOptions.url?.endsWith('/webhook'))
    )
      return payload;
    const url = req.routeOptions.url ?? '';
    try {
      if (url === `${p}/contracts/:id/release-for-signing`) {
        const { id } = req.params as { id: string };
        await createEnvelopeFor(es, req.auth!.ctx, id);
      } else if (url === `${p}/contracts/:id/sign` && !req.headers[INTERNAL_HEADER]) {
        const { id } = req.params as { id: string };
        await mirrorDecision(
          es,
          { tenantId: req.auth!.user.tenantId, userId: req.auth!.user.id, roles: req.auth!.user.roles },
          id,
          (req.body ?? {}) as { decision?: string; comment?: string },
        );
      } else if (
        url === `${p}/integrations/:kind/webhook` &&
        String((req.params as { kind?: string }).kind).toUpperCase() === 'ESIGN'
      )
        await processInbound(es);
    } catch (e) {
      req.log.error({ err: e }, 'e-signature follow-up failed');
    }
    return payload;
  });
  if (d.schedulerMinutes) {
    // catches up on callbacks that were accepted but not applied (for example after a restart)
    const h = setInterval(() => void processInbound(es).catch(() => undefined), d.schedulerMinutes * 60_000);
    h.unref();
    app.addHook('onClose', async () => clearInterval(h));
  }

  // ------------------------------------------------------------ the envelope card
  reg('GET', '/contracts/{id}/envelope');
  app.get(`${p}/contracts/:id/envelope`, { preHandler: guard(d, [...READERS]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    await processInbound(es);
    return withContext(d.database, a.ctx, (tx) =>
      envelopeView(tx, a.user.tenantId, id, { userId: a.user.id, roles: a.user.roles }),
    );
  });

  reg('POST', '/contracts/{id}/envelope');
  app.post(`${p}/contracts/:id/envelope`, { preHandler: guard(d, [...MANAGERS]) }, async (req, reply) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    const out = await createEnvelopeFor(es, a.ctx, id);
    if (out.state === 'SKIPPED') throw new AppError(409, 'NO_ENVELOPE', out.reason);
    const view = await withContext(d.database, a.ctx, (tx) =>
      envelopeView(tx, a.user.tenantId, id, { userId: a.user.id, roles: a.user.roles }),
    );
    return reply.status(out.state === 'CREATED' ? 201 : 200).send({ result: out.state, ...view });
  });

  reg('POST', '/contracts/{id}/envelope/signing-link');
  app.post(
    `${p}/contracts/:id/envelope/signing-link`,
    { preHandler: guard(d, [...SIGNERS]) },
    async (req) => {
      const a = req.auth!;
      const { id } = parse(z.object({ id: uuid }), req.params);
      return withContext(d.database, a.ctx, async (tx) => {
        const path = await issueSigningLink(tx, es, a.user.tenantId, id, a.user.id);
        await d.audit.record(tx, a.ctx, {
          action: 'esign.link_issued',
          entityType: 'contract',
          entityId: id,
          after: { forSelf: true },
        });
        return { path, simulated: true };
      });
    },
  );

  reg('POST', '/contracts/{id}/envelope/simulate-event');
  app.post(
    `${p}/contracts/:id/envelope/simulate-event`,
    { preHandler: guard(d, [...MANAGERS]) },
    async (req) => {
      const a = req.auth!;
      const { id } = parse(z.object({ id: uuid }), req.params);
      const body = parse(simulateBody, req.body);
      const kind = body.type as (typeof CANONICAL_KINDS)[number];
      const found = await withSystem(d.database, async (tx) => {
        const [c] = await tx
          .select({ id: contract.id })
          .from(contract)
          .where(and(eq(contract.id, id), eq(contract.tenantId, a.user.tenantId)));
        if (!c) throw new AppError(404, 'NOT_FOUND', 'Contract not found');
        const env =
          (await activeEnvelope(tx, a.user.tenantId, id)) ?? (await latestEnvelope(tx, a.user.tenantId, id));
        if (!env) throw new AppError(409, 'NO_ENVELOPE', 'This contract has no envelope to send events for');
        const sigs = await tx
          .select()
          .from(esignSignatory)
          .where(eq(esignSignatory.envelopeId, env.id))
          .orderBy(esignSignatory.routingOrder, esignSignatory.role);
        return { env, sigs };
      });
      let sig = body.signatoryId ? found.sigs.find((s) => s.id === body.signatoryId) : undefined;
      if (body.signatoryId && !sig)
        throw new AppError(404, 'NOT_FOUND', 'That signatory is not on this envelope');
      if (!sig && ['delivered', 'viewed', 'signed', 'declined'].includes(kind))
        sig =
          found.sigs.find((s) => !['SIGNED', 'DECLINED', 'VOIDED', 'EXPIRED'].includes(s.status)) ??
          found.sigs[0];
      const eventId = body.eventId ?? `sim-${randomUUID()}`;
      const res = await postProviderCallback(es, a.user.tenantId, {
        envelope: found.env,
        signatory: sig ?? null,
        kind,
        reason: body.reason,
        eventId,
      });
      await processInbound(es);
      const row = await withSystem(d.database, async (tx) => {
        const [r] = await tx
          .select()
          .from(esignEvent)
          .where(and(eq(esignEvent.tenantId, a.user.tenantId), eq(esignEvent.eventId, eventId)));
        return r;
      });
      await withContext(d.database, a.ctx, (tx) =>
        d.audit.record(tx, a.ctx, {
          action: 'esign.simulate_event',
          entityType: 'contract',
          entityId: id,
          after: { type: kind, eventId, accepted: res.status === 200, outcome: row?.outcome ?? null },
        }),
      );
      const view = await withContext(d.database, a.ctx, (tx) =>
        envelopeView(tx, a.user.tenantId, id, { userId: a.user.id, roles: a.user.roles }),
      );
      return {
        simulated: true,
        eventId,
        accepted: res.status === 200,
        replayed: res.replayed,
        outcome: res.replayed ? 'DUPLICATE' : (row?.outcome ?? null),
        detail: res.replayed ? 'This event id was already received and is refused' : (row?.detail ?? null),
        view,
      };
    },
  );

  // ------------------------------------------------------------ the simulated signing ceremony (a platform page)
  async function ceremony(tenantId: string, userId: string, token: string, ctx: RequestContext) {
    return withContext(d.database, ctx, async (tx) => {
      const { sig, env } = await signatoryForToken(tx, es, tenantId, userId, token);
      return { sig, env, summary: await ceremonySummary(tx, tenantId, sig, env) };
    });
  }

  reg('GET', '/esign/{token}');
  app.get(`${p}/esign/:token`, { preHandler: guard(d, [...SIGNERS]) }, async (req) => {
    const a = req.auth!;
    const { token } = parse(tokenParam, req.params);
    const first = await ceremony(a.user.tenantId, a.user.id, token, a.ctx);
    // opening the page is what the provider reports as delivered and viewed
    if (first.env.status === ACTIVE_ENVELOPE && ['CREATED', 'SENT', 'DELIVERED'].includes(first.sig.status)) {
      for (const kind of ['delivered', 'viewed'] as const)
        await postProviderCallback(es, a.user.tenantId, {
          envelope: first.env,
          signatory: first.sig,
          kind,
          eventId: `plat-${first.sig.id}-${kind}`,
        });
      await processInbound(es);
    }
    return (await ceremony(a.user.tenantId, a.user.id, token, a.ctx)).summary;
  });

  reg('POST', '/esign/{token}/confirm');
  app.post(`${p}/esign/:token/confirm`, { preHandler: guard(d, [...SIGNERS]) }, async (req, reply) => {
    const a = req.auth!;
    const { token } = parse(tokenParam, req.params);
    const body = parse(confirmBody, req.body);
    const { sig, env } = await ceremony(a.user.tenantId, a.user.id, token, a.ctx);
    if (env.status !== ACTIVE_ENVELOPE)
      throw new AppError(
        409,
        'ENVELOPE_CLOSED',
        `This envelope is ${env.status.toLowerCase()}; sign in the portal instead`,
      );
    if (['SIGNED', 'DECLINED', 'VOIDED', 'EXPIRED'].includes(sig.status))
      throw new AppError(409, 'ALREADY_DONE', `You have already ${sig.status.toLowerCase()} this envelope`);
    if (body.decision === 'DECLINE' && (body.reason ?? '').length < 5)
      throw new AppError(400, 'VALIDATION_FAILED', 'A reason is required', [
        { field: 'reason', message: 'Say why in at least 5 characters' },
      ]);
    // the signatory's own confirmation: the contract's normal sign decision, with their own session
    const res = await app.inject({
      method: 'POST',
      url: `${p}/contracts/${env.contractId}/sign`,
      headers: {
        cookie: String(req.headers.cookie ?? ''),
        'x-csrf-token': String(req.headers['x-csrf-token'] ?? ''),
        'content-type': 'application/json',
        ...(req.headers['x-step-up-code'] ? { 'x-step-up-code': String(req.headers['x-step-up-code']) } : {}),
      },
      payload: {
        decision: body.decision === 'SIGN' ? 'APPROVE' : 'REJECT',
        ...(body.decision === 'DECLINE'
          ? { comment: body.reason }
          : {
              comment: `Signed through the ${env.provider === 'DOCUSIGN' ? 'DocuSign' : 'Adobe Sign'} ceremony`,
            }),
      },
    });
    if (res.statusCode >= 400)
      return reply.status(res.statusCode).type('application/problem+json').send(res.body);
    const after = await withSystem(d.database, async (tx) => {
      const [s] = await tx.select().from(esignSignatory).where(eq(esignSignatory.id, sig.id));
      const [e] = await tx.select().from(esignEnvelope).where(eq(esignEnvelope.id, env.id));
      const [c] = await tx
        .select({ status: contract.status })
        .from(contract)
        .where(eq(contract.id, env.contractId));
      return { signatory: s?.status ?? null, envelope: e?.status ?? null, contract: c?.status ?? null };
    });
    return { simulated: true, decision: body.decision, ...after };
  });

  return done;
}
