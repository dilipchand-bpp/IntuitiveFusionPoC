/**
 * E-signature envelopes (NFR-C04). When a contract is released for signing and the ESIGN connector is switched on with a
 * simulated DocuSign or Adobe provider, an envelope is created with the signatories already filled in from the contract's
 * signature chain. The provider reports progress by signed callbacks (the b10a inbound webhook, SEC-TP04); each callback is
 * applied once. The platform stays the source of truth:
 *  - a signature reported by the provider reaches the signature chain only through the normal sign decision (the same route,
 *    so signing authority, signing order and the supplier checks all still apply), and is refused when that refuses;
 *  - a decline returns the contract to legal through the same reject decision, with the reason;
 *  - a voided or expired envelope never changes the contract: in-platform signing carries on;
 *  - if the provider is down (or its breaker is open) the contract is still signed in the platform and a manual task records
 *    that no envelope was created.
 *
 * SWAP POINT (docs/swap-points.md): `EsignAdapter` in esign-adapters.ts, selected by the ESIGN connector's provider.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Clock } from '@if/shared';
import type { AuditService } from '../../audit/audit-service.js';
import type { SessionService } from '../../auth/session-service.js';
import { COOKIE_NAMES } from '../../auth/session-service.js';
import { checkDelegation } from '../../authz/delegation.js';
import { withSystem, type Database, type RequestContext, type Tx } from '../../db/client.js';
import {
  appUser,
  approval,
  clause,
  contract,
  esignEnvelope,
  esignEvent,
  esignSignatory,
  integrationEvent,
  manualTask,
  notification,
  request,
  signingInvitation,
  supplier,
  tender,
  tenant,
} from '../../db/schema.js';
import { AppError } from '../../http/errors.js';
import { sendEmail } from '../notify/email.js';
import { getConnector } from '../b10conn/connectors.js';
import { callProvider } from '../b10conn/resilience.js';
import { connectorSecretName, readSecret, setSecret } from '../b10conn/secrets.js';
import { signedHeaders } from '../b10conn/signing.js';
import { PROOF_HEADER, PROVIDER_HEADER, proofFor } from '../b11prod/eidas.js';
import { requiredSigners } from '../contract/clauses.js';
import {
  ADAPTERS,
  externalIdOfAny,
  isEsignProvider,
  type CanonicalKind,
  type EnvelopeSpec,
} from './esign-adapters.js';

export interface EsignDeps {
  database: Database;
  clock: Clock;
  audit: AuditService;
  sessions: SessionService;
  app: FastifyInstance;
  /** The API prefix, for example /api/v1. */
  prefix: string;
  sleep?: (ms: number) => Promise<void>;
}

type EnvelopeRow = typeof esignEnvelope.$inferSelect;
type SignatoryRow = typeof esignSignatory.$inferSelect;
type ContractRow = typeof contract.$inferSelect;
type SignatoryStatus = SignatoryRow['status'];

export const INTERNAL_HEADER = 'x-if-esign-internal';
export const ENVELOPE_VALID_DAYS = 14;
const RANK: Record<SignatoryStatus, number> = {
  CREATED: 0,
  SENT: 1,
  DELIVERED: 2,
  VIEWED: 3,
  SIGNED: 4,
  DECLINED: 4,
  VOIDED: 4,
  EXPIRED: 4,
};
const TERMINAL: SignatoryStatus[] = ['SIGNED', 'DECLINED', 'VOIDED', 'EXPIRED'];
const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
const sys = (tenantId: string, userId: string | null = null): RequestContext => ({
  tenantId,
  userId,
  role: 'SYSTEM',
});
const STATUS_OF_KIND: Partial<Record<CanonicalKind, SignatoryStatus>> = {
  sent: 'SENT',
  delivered: 'DELIVERED',
  viewed: 'VIEWED',
};

export const ACTIVE_ENVELOPE = 'SENT' as const;

export async function activeEnvelope(tx: Tx, tenantId: string, contractId: string) {
  const [e] = await tx
    .select()
    .from(esignEnvelope)
    .where(
      and(
        eq(esignEnvelope.tenantId, tenantId),
        eq(esignEnvelope.contractId, contractId),
        eq(esignEnvelope.status, ACTIVE_ENVELOPE),
      ),
    )
    .orderBy(desc(esignEnvelope.createdAt))
    .limit(1);
  return e;
}

export async function latestEnvelope(tx: Tx, tenantId: string, contractId: string) {
  const rows = await tx
    .select()
    .from(esignEnvelope)
    .where(and(eq(esignEnvelope.tenantId, tenantId), eq(esignEnvelope.contractId, contractId)))
    .orderBy(desc(esignEnvelope.createdAt));
  // an open envelope wins over a closed one made at the same instant
  return rows.find((e) => e.status === ACTIVE_ENVELOPE) ?? rows[0];
}

/** Records one event against an envelope. Returns false when the event id was already recorded (nothing is changed twice). */
async function recordEvent(
  tx: Tx,
  d: EsignDeps,
  e: {
    tenantId: string;
    envelopeId: string;
    signatoryId?: string | null;
    eventId: string;
    type: string;
    providerType?: string | null;
    source: 'PLATFORM' | 'PROVIDER';
    outcome: 'APPLIED' | 'DUPLICATE' | 'IGNORED' | 'REFUSED';
    detail?: string | null;
  },
): Promise<boolean> {
  const rows = await tx
    .insert(esignEvent)
    .values({
      tenantId: e.tenantId,
      envelopeId: e.envelopeId,
      signatoryId: e.signatoryId ?? null,
      eventId: e.eventId,
      type: e.type,
      providerType: e.providerType ?? null,
      source: e.source,
      outcome: e.outcome,
      detail: e.detail?.slice(0, 400) ?? null,
      createdAt: d.clock.now(),
    })
    .onConflictDoNothing()
    .returning({ id: esignEvent.id });
  return rows.length > 0;
}

/** The signing secret for the ESIGN connector. The demonstration creates one if an administrator has not set it yet. */
export async function ensureWebhookSecret(tx: Tx, d: EsignDeps, tenantId: string): Promise<string> {
  const name = connectorSecretName('ESIGN');
  const have = await readSecret(tx, tenantId, name);
  if (have) return have;
  const value = `esign-${randomBytes(24).toString('hex')}`;
  await setSecret(tx, { audit: d.audit, now: d.clock.now() }, sys(tenantId), name, value);
  return value;
}

// ---------------------------------------------------------------------------------------------- creating an envelope
export type CreateOutcome =
  | { state: 'CREATED'; envelopeId: string; provider: string; externalId: string }
  | { state: 'SKIPPED'; reason: string }
  | { state: 'MANUAL_TASK'; taskId: string | null; reason: string };

/** Voids what is still open for a contract, for example when it is released again after a return to legal. */
export async function voidOpenEnvelopes(
  tx: Tx,
  d: EsignDeps,
  tenantId: string,
  contractId: string,
  reason: string,
) {
  const open = await tx
    .select()
    .from(esignEnvelope)
    .where(
      and(
        eq(esignEnvelope.tenantId, tenantId),
        eq(esignEnvelope.contractId, contractId),
        eq(esignEnvelope.status, ACTIVE_ENVELOPE),
      ),
    );
  for (const e of open) {
    const at = d.clock.now();
    await tx
      .update(esignEnvelope)
      .set({ status: 'VOIDED', closedReason: reason, updatedAt: at })
      .where(eq(esignEnvelope.id, e.id));
    await tx
      .update(esignSignatory)
      .set({ status: 'VOIDED', updatedAt: at })
      .where(
        and(
          eq(esignSignatory.envelopeId, e.id),
          inArray(esignSignatory.status, ['CREATED', 'SENT', 'DELIVERED', 'VIEWED']),
        ),
      );
    await recordEvent(tx, d, {
      tenantId,
      envelopeId: e.id,
      eventId: `plat-${e.id}-voided`,
      type: 'voided',
      source: 'PLATFORM',
      outcome: 'APPLIED',
      detail: reason,
    });
  }
  return open.length;
}

/**
 * Creates the envelope for a contract that is out for signature, when the ESIGN connector is on with a simulated provider.
 * Never throws for a provider problem: the contract is signed in the platform either way.
 */
export async function createEnvelopeFor(
  d: EsignDeps,
  ctx: RequestContext,
  contractId: string,
): Promise<CreateOutcome> {
  return withSystem(d.database, async (tx) => {
    const [c] = await tx
      .select()
      .from(contract)
      .where(and(eq(contract.id, contractId), eq(contract.tenantId, ctx.tenantId)));
    if (!c) throw new AppError(404, 'NOT_FOUND', 'Contract not found');
    const conn = await getConnector(tx, ctx.tenantId, 'ESIGN');
    if (!conn || !conn.enabled || !isEsignProvider(conn.provider))
      return { state: 'SKIPPED', reason: 'The e-signature connector is not set to DocuSign or Adobe' };
    if (!['AWAITING_SIGNATURE', 'PARTIALLY_SIGNED'].includes(c.status) || c.locked)
      return { state: 'SKIPPED', reason: 'The contract is not out for signature' };
    const adapter = ADAPTERS[conn.provider];
    const now = d.clock.now();

    // the signatories: one person for each seat in the signature chain, in signing order
    const invites = await tx
      .select({ inv: signingInvitation, u: appUser })
      .from(signingInvitation)
      .innerJoin(appUser, eq(appUser.id, signingInvitation.userId))
      .where(
        and(
          eq(signingInvitation.contractId, c.id),
          isNotNull(signingInvitation.userId),
          eq(appUser.active, true),
        ),
      );
    const chain = requiredSigners(1e12).filter((s) => invites.some((i) => i.inv.roleLabel === s.role));
    const live = await tx
      .select()
      .from(approval)
      .where(
        and(
          eq(approval.tenantId, ctx.tenantId),
          eq(approval.subjectType, 'CONTRACT'),
          eq(approval.subjectId, c.id),
          eq(approval.decision, 'APPROVED'),
        ),
      );
    const people: Array<{
      id: string;
      role: string;
      roleLabel: string;
      name: string;
      email: string;
      userId: string;
      token: string;
      signed: boolean;
    }> = [];
    for (const seat of chain) {
      const cands = invites
        .filter((i) => i.inv.roleLabel === seat.role)
        .sort((a, b) => a.u.email.localeCompare(b.u.email));
      let pick = cands[0]!;
      for (const cand of cands) {
        const ok = await checkDelegation(
          tx,
          { tenantId: ctx.tenantId, userId: cand.u.id, roles: [seat.role] },
          'CONTRACT_SIGNING',
          Number(c.value),
        );
        if (ok.allowed) {
          pick = cand;
          break;
        }
      }
      people.push({
        id: randomUUID(),
        role: seat.role,
        roleLabel: seat.label,
        name: pick.u.name,
        email: pick.u.email,
        userId: pick.u.id,
        token: randomBytes(24).toString('base64url'),
        signed: live.some((a) => a.role === seat.role),
      });
    }
    if (people.length === 0)
      return { state: 'SKIPPED', reason: 'The contract has no signatories to fill in' };

    const prior = await tx
      .select({ id: esignEnvelope.id })
      .from(esignEnvelope)
      .where(and(eq(esignEnvelope.tenantId, ctx.tenantId), eq(esignEnvelope.contractId, c.id)));
    const spec: EnvelopeSpec = {
      contractId: c.id,
      contractNumber: c.number,
      title: c.title ?? c.number,
      mode: c.signingMode,
      expiresAt: new Date(now.getTime() + ENVELOPE_VALID_DAYS * 86_400_000),
      sequence: prior.length + 1,
      tenantId: ctx.tenantId,
      signatories: people.map((p, i) => ({
        signatoryId: p.id,
        name: p.name,
        email: p.email,
        role: p.role,
        roleLabel: p.roleLabel,
        order: c.signingMode === 'STAGED' ? i + 1 : 1,
        signUrl: `/esign/${p.token}`,
      })),
    };
    const out = await callProvider(
      tx,
      { clock: d.clock, ...(d.sleep ? { sleep: d.sleep } : {}) },
      ctx.tenantId,
      'ESIGN',
      async () => adapter.createEnvelope(spec),
      { fallback: () => null, retries: 1 },
    );
    if (!out.ok || !out.value) {
      // the fallback (NFR-AV04): the contract is signed in the platform, and a person is told no envelope exists
      const open = (
        await tx
          .select()
          .from(manualTask)
          .where(
            and(
              eq(manualTask.tenantId, ctx.tenantId),
              eq(manualTask.connectorKind, 'ESIGN'),
              eq(manualTask.status, 'OPEN'),
            ),
          )
      ).find((t) => (t.payloadSummary as { contractId?: string }).contractId === c.id);
      let taskId = open?.id ?? null;
      if (!open) {
        const [t] = await tx
          .insert(manualTask)
          .values({
            tenantId: ctx.tenantId,
            connectorKind: 'ESIGN',
            title: `No e-signature envelope for ${c.number}`,
            instructions: `${adapter.label} could not be reached, so no envelope was created. The contract can still be signed in the platform: each signatory signs on the contract page. If the signatures must also be held at ${adapter.label}, send the envelope from the provider by hand and put its reference here.`,
            payloadSummary: {
              contractId: c.id,
              contractNumber: c.number,
              provider: conn.provider,
              reason: out.ok ? 'No answer' : out.reason,
            },
            createdAt: now,
          })
          .returning({ id: manualTask.id });
        taskId = t!.id;
      }
      await d.audit.record(tx, ctx, {
        action: 'esign.envelope_not_created',
        entityType: 'contract',
        entityId: c.id,
        result: 'FAILED',
        after: {
          provider: conn.provider,
          reason: out.ok ? 'NO_ANSWER' : out.reason,
          signingContinuesInPlatform: true,
        },
      });
      return { state: 'MANUAL_TASK', taskId, reason: out.ok ? 'No answer' : out.error };
    }

    await voidOpenEnvelopes(tx, d, ctx.tenantId, c.id, 'The contract was released again');
    const created = out.value;
    const [env] = await tx
      .insert(esignEnvelope)
      .values({
        tenantId: ctx.tenantId,
        contractId: c.id,
        provider: conn.provider,
        externalId: created.externalId,
        status: 'SENT',
        signingMode: c.signingMode,
        providerPayload: adapter.buildCreate(spec),
        createdBy: ctx.userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const expiresAt = spec.expiresAt;
    for (const [i, p] of people.entries()) {
      await tx.insert(esignSignatory).values({
        id: p.id,
        tenantId: ctx.tenantId,
        envelopeId: env!.id,
        userId: p.userId,
        role: p.role,
        roleLabel: p.roleLabel,
        name: p.name,
        email: p.email,
        routingOrder: spec.signatories[i]!.order,
        recipientRef: created.recipients.find((r) => r.signatoryId === p.id)?.ref ?? String(i + 1),
        status: p.signed ? 'SIGNED' : 'SENT',
        tokenHash: hashToken(p.token),
        tokenExpiresAt: expiresAt,
        signedAt: p.signed ? now : null,
        updatedAt: now,
      });
      if (!p.signed) {
        await tx.insert(notification).values({
          tenantId: ctx.tenantId,
          userId: p.userId,
          title: `${adapter.label}: ${c.number} is ready for your signature`,
          body: 'Open the signing link. It works for you only, and signing still follows your signing authority.',
          link: `/esign/${p.token}`,
        });
        await sendEmail(tx, {
          tenantId: ctx.tenantId,
          to: p.email,
          subject: `${adapter.label}: please sign ${c.number}`,
          body: `Hello ${p.name}, ${c.number} is waiting for your signature. A signing link was issued to you; it is in your notifications in the portal.`,
          kind: 'SIGNING_INVITATION',
          refType: 'esign_envelope',
          refId: env!.id,
        });
      }
    }
    await recordEvent(tx, d, {
      tenantId: ctx.tenantId,
      envelopeId: env!.id,
      eventId: `plat-${env!.id}-created`,
      type: 'sent',
      providerType: conn.provider === 'ADOBE' ? 'AGREEMENT_CREATED' : 'envelope-sent',
      source: 'PLATFORM',
      outcome: 'APPLIED',
      detail: `Envelope ${created.externalId} created with ${people.length} signatory(ies) pre-filled`,
    });
    // an earlier "no envelope" task is no longer needed
    await tx
      .update(manualTask)
      .set({ status: 'SUPERSEDED', completedAt: now })
      .where(
        and(
          eq(manualTask.tenantId, ctx.tenantId),
          eq(manualTask.connectorKind, 'ESIGN'),
          eq(manualTask.status, 'OPEN'),
          sql`${manualTask.payloadSummary}->>'contractId' = ${c.id}`,
        ),
      );
    await d.audit.record(tx, ctx, {
      action: 'esign.envelope_created',
      entityType: 'contract',
      entityId: c.id,
      after: {
        provider: conn.provider,
        externalId: created.externalId,
        signingMode: c.signingMode,
        signatories: people.map((p) => ({
          role: p.role,
          order: spec.signatories.find((s) => s.signatoryId === p.id)!.order,
        })),
      },
    });
    return { state: 'CREATED', envelopeId: env!.id, provider: conn.provider, externalId: created.externalId };
  });
}

// ---------------------------------------------------------------------------------------------- callbacks out of the provider
/** Hands a correctly signed callback to the platform's own inbound webhook, the way the provider's servers would. */
export async function postProviderCallback(
  d: EsignDeps,
  tenantId: string,
  input: {
    envelope: Pick<EnvelopeRow, 'provider' | 'externalId'>;
    signatory?: Pick<SignatoryRow, 'recipientRef' | 'email'> | null;
    kind: CanonicalKind;
    reason?: string | undefined;
    eventId: string;
  },
): Promise<{ status: number; replayed: boolean }> {
  const adapter = ADAPTERS[input.envelope.provider];
  const { slug, secret } = await withSystem(d.database, async (tx) => {
    const [t] = await tx.select({ slug: tenant.slug }).from(tenant).where(eq(tenant.id, tenantId));
    return { slug: t!.slug, secret: await ensureWebhookSecret(tx, d, tenantId) };
  });
  const cb = adapter.toCallback({
    externalId: input.envelope.externalId,
    kind: input.kind,
    recipientRef: input.signatory?.recipientRef,
    email: input.signatory?.email,
    reason: input.reason,
  });
  const body = { eventId: input.eventId, type: cb.type, data: cb.data };
  const res = await d.app.inject({
    method: 'POST',
    url: `${d.prefix}/integrations/ESIGN/webhook`,
    headers: {
      ...signedHeaders(secret, d.clock, body),
      'x-if-tenant': slug,
      'content-type': 'application/json',
    },
    payload: body,
  });
  return { status: res.statusCode, replayed: res.statusCode === 409 };
}

// ---------------------------------------------------------------------------------------------- applying callbacks
const markHandled = async (tx: Tx, id: string, payload: unknown, handled: string) =>
  tx
    .update(integrationEvent)
    .set({ payload: { ...(payload as object), handled } })
    .where(eq(integrationEvent.id, id));

interface Plan {
  eventRowId: string;
  tenantId: string;
  eventId: string;
  env: EnvelopeRow;
  sig: SignatoryRow | null;
  kind: CanonicalKind;
  type: string;
  reason: string | null;
  payload: unknown;
}

/**
 * Applies every callback the inbound webhook has accepted but not yet applied. Safe to run any number of times: each event is
 * applied once (keyed by its event id), and an event that names no known envelope is left marked as such.
 */
export async function processInbound(d: EsignDeps, limit = 50): Promise<number> {
  const pending = await withSystem(d.database, (tx) =>
    tx
      .select()
      .from(integrationEvent)
      .where(
        and(
          eq(integrationEvent.direction, 'IN'),
          eq(integrationEvent.connectorKind, 'ESIGN'),
          sql`${integrationEvent.payload}->>'handled' is null`,
        ),
      )
      .orderBy(asc(integrationEvent.createdAt))
      .limit(limit),
  );
  let n = 0;
  for (const ev of pending) {
    try {
      await applyOne(d, ev);
      n += 1;
    } catch {
      // left unmarked, so the next run tries again
    }
  }
  return n;
}

async function applyOne(d: EsignDeps, ev: typeof integrationEvent.$inferSelect) {
  const payload = ev.payload as { type?: string; data?: Record<string, unknown> };
  const type = payload.type ?? ev.kind;
  const data = payload.data ?? {};
  const eventId = ev.idempotencyKey.replace('in:ESIGN:', '');
  const plan = await withSystem(d.database, async (tx): Promise<Plan | null> => {
    const extId = externalIdOfAny(data);
    const [env] = extId
      ? await tx
          .select()
          .from(esignEnvelope)
          .where(and(eq(esignEnvelope.tenantId, ev.tenantId), eq(esignEnvelope.externalId, extId)))
      : [];
    if (!env) {
      await markHandled(tx, ev.id, ev.payload, 'UNKNOWN_ENVELOPE');
      return null;
    }
    const parsed = ADAPTERS[env.provider].parseCallback(type, data);
    if (!parsed) {
      await markHandled(tx, ev.id, ev.payload, 'UNSUPPORTED_EVENT');
      return null;
    }
    const sigs = await tx.select().from(esignSignatory).where(eq(esignSignatory.envelopeId, env.id));
    const sig =
      sigs.find((s) => parsed.recipientRef && s.recipientRef === parsed.recipientRef) ??
      sigs.find((s) => parsed.email && s.email.toLowerCase() === parsed.email.toLowerCase()) ??
      null;
    return {
      eventRowId: ev.id,
      tenantId: ev.tenantId,
      eventId,
      env,
      sig,
      kind: parsed.kind,
      type,
      reason: parsed.reason,
      payload: ev.payload,
    };
  });
  if (!plan) return;
  const needsSignatory = ['delivered', 'viewed', 'signed', 'declined'].includes(plan.kind);

  // the decisions that touch the platform's signature chain go through the normal decision path, outside any transaction
  let decision: { ok: boolean; message: string; contractStatus?: string } | null = null;
  if (plan.sig && plan.env.status === ACTIVE_ENVELOPE && (plan.kind === 'signed' || plan.kind === 'declined'))
    decision = await decide(d, plan);

  await withSystem(d.database, async (tx) => {
    const at = d.clock.now();
    const done = async (
      outcome: 'APPLIED' | 'DUPLICATE' | 'IGNORED' | 'REFUSED',
      detail: string,
      handled = outcome,
    ) => {
      await recordEvent(tx, d, {
        tenantId: plan.tenantId,
        envelopeId: plan.env.id,
        signatoryId: plan.sig?.id ?? null,
        eventId: plan.eventId,
        type: plan.kind,
        providerType: plan.type,
        source: 'PROVIDER',
        outcome,
        detail,
      });
      await markHandled(tx, plan.eventRowId, plan.payload, handled);
      await d.audit.record(tx, sys(plan.tenantId), {
        action: 'esign.callback',
        entityType: 'esign_envelope',
        entityId: plan.env.id,
        result: outcome === 'REFUSED' ? 'DENIED' : 'SUCCESS',
        after: { kind: plan.kind, outcome, signatory: plan.sig?.role ?? null },
      });
    };
    const [env] = await tx.select().from(esignEnvelope).where(eq(esignEnvelope.id, plan.env.id));
    const sig = plan.sig
      ? (await tx.select().from(esignSignatory).where(eq(esignSignatory.id, plan.sig.id)))[0]!
      : null;
    if (!env) return;
    if (needsSignatory && !sig) return done('IGNORED', 'The callback names no signatory on this envelope');

    // envelope-level
    if (plan.kind === 'voided' || plan.kind === 'expired') {
      if (env.status !== ACTIVE_ENVELOPE)
        return done('DUPLICATE', `The envelope is already ${env.status.toLowerCase()}`);
      const to = plan.kind === 'voided' ? 'VOIDED' : 'EXPIRED';
      await tx
        .update(esignEnvelope)
        .set({
          status: to,
          closedReason: plan.reason ?? `Reported ${to.toLowerCase()} by the provider`,
          updatedAt: at,
        })
        .where(eq(esignEnvelope.id, env.id));
      await tx
        .update(esignSignatory)
        .set({ status: to, updatedAt: at })
        .where(
          and(
            eq(esignSignatory.envelopeId, env.id),
            inArray(esignSignatory.status, ['CREATED', 'SENT', 'DELIVERED', 'VIEWED']),
          ),
        );
      return done(
        'APPLIED',
        `The envelope is ${to.toLowerCase()}; the contract is unchanged and can still be signed in the platform`,
      );
    }
    if (
      env.status !== ACTIVE_ENVELOPE &&
      !(plan.kind === 'sent' || plan.kind === 'delivered' || plan.kind === 'viewed')
    )
      return done(
        'REFUSED',
        `The envelope is ${env.status.toLowerCase()}, so this ${plan.kind} was not applied`,
      );
    if (env.status !== ACTIVE_ENVELOPE) return done('IGNORED', `The envelope is ${env.status.toLowerCase()}`);

    const target = STATUS_OF_KIND[plan.kind];
    if (target) {
      const rows = sig
        ? [sig]
        : await tx.select().from(esignSignatory).where(eq(esignSignatory.envelopeId, env.id));
      let moved = 0;
      for (const r of rows)
        if (!TERMINAL.includes(r.status) && RANK[target] > RANK[r.status]) {
          await tx
            .update(esignSignatory)
            .set({ status: target, updatedAt: at })
            .where(eq(esignSignatory.id, r.id));
          moved += 1;
        }
      return moved
        ? done('APPLIED', `Recipient ${target.toLowerCase()}`)
        : done('IGNORED', 'Already at or past this step');
    }

    if (plan.kind === 'signed') {
      if (sig!.status === 'SIGNED') return done('DUPLICATE', 'This signatory has already signed');
      if (!decision) return done('REFUSED', `The envelope is ${env.status.toLowerCase()}`);
      if (!decision.ok)
        return done('REFUSED', `The platform did not record the signature: ${decision.message}`);
      await tx
        .update(esignSignatory)
        .set({ status: 'SIGNED', signedAt: at, updatedAt: at })
        .where(eq(esignSignatory.id, sig!.id));
      if (decision.contractStatus === 'EXECUTED') {
        await tx
          .update(esignEnvelope)
          .set({ status: 'COMPLETED', closedReason: 'Every signatory has signed', updatedAt: at })
          .where(eq(esignEnvelope.id, env.id));
        await recordEvent(tx, d, {
          tenantId: plan.tenantId,
          envelopeId: env.id,
          eventId: `plat-${env.id}-completed`,
          type: 'completed',
          source: 'PLATFORM',
          outcome: 'APPLIED',
          detail: 'The contract is executed and locked',
        });
      }
      return done('APPLIED', decision.message);
    }

    // declined
    if (sig!.status === 'DECLINED') return done('DUPLICATE', 'This signatory has already declined');
    if (!decision) return done('REFUSED', `The envelope is ${env.status.toLowerCase()}`);
    if (!decision.ok) return done('REFUSED', `The platform did not record the decline: ${decision.message}`);
    await tx
      .update(esignSignatory)
      .set({ status: 'DECLINED', declineReason: plan.reason ?? 'Declined at the provider', updatedAt: at })
      .where(eq(esignSignatory.id, sig!.id));
    await tx
      .update(esignSignatory)
      .set({ status: 'VOIDED', updatedAt: at })
      .where(
        and(
          eq(esignSignatory.envelopeId, env.id),
          inArray(esignSignatory.status, ['CREATED', 'SENT', 'DELIVERED', 'VIEWED']),
        ),
      );
    await tx
      .update(esignEnvelope)
      .set({ status: 'DECLINED', closedReason: plan.reason ?? 'Declined at the provider', updatedAt: at })
      .where(eq(esignEnvelope.id, env.id));
    return done('APPLIED', decision.message);
  });
}

/** Records the provider's signature or decline through the platform's own decision route, as the signatory. */
async function decide(d: EsignDeps, plan: Plan) {
  const [c] = await withSystem(d.database, (tx) =>
    tx.select().from(contract).where(eq(contract.id, plan.env.contractId)),
  );
  if (!c) return { ok: false, message: 'The contract no longer exists' };
  const sig = plan.sig!;
  const holds = await withSystem(d.database, (tx) =>
    tx
      .select()
      .from(approval)
      .where(
        and(
          eq(approval.subjectType, 'CONTRACT'),
          eq(approval.subjectId, c.id),
          eq(approval.role, sig.role),
          eq(approval.decision, 'APPROVED'),
        ),
      ),
  );
  if (plan.kind === 'signed') {
    if (holds.length > 0 && ['AWAITING_SIGNATURE', 'PARTIALLY_SIGNED', 'EXECUTED'].includes(c.status))
      return { ok: true, message: 'The platform already holds this signature', contractStatus: c.status };
    return injectDecision(
      d,
      c,
      sig,
      'APPROVE',
      `Signed through ${ADAPTERS[plan.env.provider].label} envelope ${plan.env.externalId}`,
      plan.env.provider,
    );
  }
  // declined: the contract may already have gone back to legal
  if (!['AWAITING_SIGNATURE', 'PARTIALLY_SIGNED'].includes(c.status))
    return { ok: true, message: 'The contract is already back with legal', contractStatus: c.status };
  const reason = (plan.reason ?? '').trim();
  return injectDecision(
    d,
    c,
    sig,
    'REJECT',
    reason.length >= 5 ? reason : `Declined at ${ADAPTERS[plan.env.provider].label}`,
    plan.env.provider,
  );
}

async function injectDecision(
  d: EsignDeps,
  c: ContractRow,
  sig: SignatoryRow,
  decision: 'APPROVE' | 'REJECT',
  comment: string,
  provider: string,
): Promise<{ ok: boolean; message: string; contractStatus?: string }> {
  const sess = await d.sessions.createFor(sig.userId, { userAgent: 'esign-provider-callback' });
  if (!sess) return { ok: false, message: 'The signatory has no active account' };
  try {
    const res = await d.app.inject({
      method: 'POST',
      url: `${d.prefix}/contracts/${c.id}/sign`,
      headers: {
        cookie: `${COOKIE_NAMES.STAFF}=${sess.cookieValue}`,
        'x-csrf-token': sess.csrf,
        'content-type': 'application/json',
        [INTERNAL_HEADER]: '1',
        // proof that a provider ceremony stands behind this signature, so the sign route can rate its level (NFR-L03)
        [PROVIDER_HEADER]: provider,
        [PROOF_HEADER]: proofFor(c.id, sig.userId, provider),
      },
      payload: { decision, comment },
    });
    if (res.statusCode >= 400) {
      const p = res.json() as { title?: string; code?: string };
      return { ok: false, message: `${p.title ?? 'Refused'}${p.code ? ` (${p.code})` : ''}` };
    }
    const v = res.json() as { status?: string };
    return {
      ok: true,
      message:
        decision === 'APPROVE'
          ? 'Recorded through the normal signing decision'
          : 'The contract was returned to legal with the reason',
      ...(v.status ? { contractStatus: v.status } : {}),
    };
  } finally {
    await d.sessions.revoke(sess.id);
  }
}

// ---------------------------------------------------------------------------------------------- the platform tells the provider
/** After a signature or a return to legal in the platform, the (simulated) provider is told and calls back. */
export async function mirrorDecision(
  d: EsignDeps,
  a: { tenantId: string; userId: string; roles: readonly string[] },
  contractId: string,
  body: { decision?: string; comment?: string },
) {
  const found = await withSystem(d.database, async (tx) => {
    const env = await activeEnvelope(tx, a.tenantId, contractId);
    if (!env) return null;
    const sigs = await tx.select().from(esignSignatory).where(eq(esignSignatory.envelopeId, env.id));
    const live = await tx
      .select({ role: approval.role })
      .from(approval)
      .where(
        and(
          eq(approval.tenantId, a.tenantId),
          eq(approval.subjectType, 'CONTRACT'),
          eq(approval.subjectId, contractId),
          eq(approval.decision, 'APPROVED'),
        ),
      );
    return { env, sigs, live: live.map((r) => r.role) };
  });
  if (!found) return;
  if (body.decision === 'REJECT') {
    const s = found.sigs.find((x) => a.roles.includes(x.role) && !TERMINAL.includes(x.status));
    if (!s) return;
    await postProviderCallback(d, a.tenantId, {
      envelope: found.env,
      signatory: s,
      kind: 'declined',
      reason: (body.comment ?? '').trim() || 'Returned to legal in the platform',
      eventId: `plat-${s.id}-declined`,
    });
  } else {
    for (const s of found.sigs)
      if (s.status !== 'SIGNED' && !TERMINAL.includes(s.status) && found.live.includes(s.role))
        await postProviderCallback(d, a.tenantId, {
          envelope: found.env,
          signatory: s,
          kind: 'signed',
          eventId: `plat-${s.id}-signed`,
        });
  }
  await processInbound(d);
}

// ---------------------------------------------------------------------------------------------- views
const STAFF_SEES_ALL = ['LEGAL', 'PROCUREMENT', 'PROBITY', 'ADMIN'];

export async function envelopeView(
  tx: Tx,
  tenantId: string,
  contractId: string,
  viewer: { userId: string; roles: readonly string[] },
) {
  const [c] = await tx
    .select()
    .from(contract)
    .where(and(eq(contract.id, contractId), eq(contract.tenantId, tenantId)));
  if (!c) throw new AppError(404, 'NOT_FOUND', 'Contract not found');
  const conn = await getConnector(tx, tenantId, 'ESIGN');
  const env = await latestEnvelope(tx, tenantId, contractId);
  const blind =
    c.signingMode === 'BLIND' &&
    c.status !== 'EXECUTED' &&
    !viewer.roles.some((r) => STAFF_SEES_ALL.includes(r));
  const tasks = (
    await tx
      .select()
      .from(manualTask)
      .where(
        and(
          eq(manualTask.tenantId, tenantId),
          eq(manualTask.connectorKind, 'ESIGN'),
          eq(manualTask.status, 'OPEN'),
        ),
      )
  )
    .filter((t) => (t.payloadSummary as { contractId?: string }).contractId === contractId)
    .map((t) => ({
      id: t.id,
      title: t.title,
      instructions: t.instructions,
      createdAt: t.createdAt.toISOString(),
    }));
  const connector = {
    enabled: conn?.enabled ?? false,
    provider: conn?.provider ?? null,
    providerLabel: isEsignProvider(conn?.provider ?? '')
      ? ADAPTERS[conn!.provider as 'DOCUSIGN'].label
      : null,
    mode: conn?.mode ?? 'UP',
    inUse: Boolean(conn?.enabled && isEsignProvider(conn.provider)),
    simulated: true as const,
  };
  const canManage = viewer.roles.some((r) => ['ADMIN', 'LEGAL', 'PROCUREMENT'].includes(r));
  if (!env)
    return {
      simulated: true as const,
      envelope: null,
      connector,
      manualTasks: tasks,
      permissions: {
        canSimulate: false,
        canCreate:
          canManage && connector.inUse && ['AWAITING_SIGNATURE', 'PARTIALLY_SIGNED'].includes(c.status),
        canOpenSigning: false,
      },
    };
  const sigsAll = await tx
    .select()
    .from(esignSignatory)
    .where(eq(esignSignatory.envelopeId, env.id))
    .orderBy(asc(esignSignatory.routingOrder), asc(esignSignatory.role));
  const sigs = blind ? sigsAll.filter((s) => s.userId === viewer.userId) : sigsAll;
  const visible = new Set(sigs.map((s) => s.id));
  const events = (
    await tx
      .select()
      .from(esignEvent)
      .where(eq(esignEvent.envelopeId, env.id))
      .orderBy(asc(esignEvent.createdAt), asc(esignEvent.eventId))
  ).filter((e) => !blind || !e.signatoryId || visible.has(e.signatoryId));
  const nameOf = new Map(sigsAll.map((s) => [s.id, s.name]));
  const mine = sigsAll.find((s) => s.userId === viewer.userId && !TERMINAL.includes(s.status));
  return {
    simulated: true as const,
    envelope: {
      id: env.id,
      provider: env.provider,
      providerLabel: ADAPTERS[env.provider].label,
      externalId: env.externalId,
      status: env.status,
      signingMode: env.signingMode,
      blind,
      closedReason: env.closedReason,
      createdAt: env.createdAt.toISOString(),
      updatedAt: env.updatedAt.toISOString(),
      signatories: sigs.map((s) => ({
        id: s.id,
        name: s.name,
        email: s.email,
        role: s.role,
        roleLabel: s.roleLabel,
        order: s.routingOrder,
        recipientRef: s.recipientRef,
        status: s.status,
        signedAt: s.signedAt?.toISOString() ?? null,
        declineReason: s.declineReason,
        isMe: s.userId === viewer.userId,
      })),
      events: events.map((e) => ({
        id: e.id,
        type: e.type,
        providerType: e.providerType,
        source: e.source,
        outcome: e.outcome,
        detail: e.detail,
        signatory: e.signatoryId ? (nameOf.get(e.signatoryId) ?? null) : null,
        at: e.createdAt.toISOString(),
      })),
      providerPayload: canManage ? env.providerPayload : null,
    },
    connector,
    manualTasks: tasks,
    permissions: {
      canSimulate: canManage && env.status === ACTIVE_ENVELOPE,
      canCreate: false,
      canOpenSigning: Boolean(mine) && env.status === ACTIVE_ENVELOPE,
    },
  };
}

/** A new link for the signed-in signatory (the old link stops working), because only a hash of a link is ever kept. */
export async function issueSigningLink(
  tx: Tx,
  d: EsignDeps,
  tenantId: string,
  contractId: string,
  userId: string,
): Promise<string> {
  const env = await activeEnvelope(tx, tenantId, contractId);
  if (!env) throw new AppError(404, 'NOT_FOUND', 'There is no open envelope for this contract');
  const [sig] = await tx
    .select()
    .from(esignSignatory)
    .where(
      and(
        eq(esignSignatory.envelopeId, env.id),
        eq(esignSignatory.userId, userId),
        inArray(esignSignatory.status, ['CREATED', 'SENT', 'DELIVERED', 'VIEWED']),
      ),
    );
  if (!sig)
    throw new AppError(
      403,
      'NOT_A_SIGNATORY',
      'You are not a signatory on this envelope, or you have already signed',
    );
  const token = randomBytes(24).toString('base64url');
  await tx
    .update(esignSignatory)
    .set({ tokenHash: hashToken(token), updatedAt: d.clock.now() })
    .where(eq(esignSignatory.id, sig.id));
  return `/esign/${token}`;
}

/** The signatory behind a link, if the link is still good and belongs to the signed-in person. */
export async function signatoryForToken(
  tx: Tx,
  d: EsignDeps,
  tenantId: string,
  userId: string,
  token: string,
) {
  const [sig] = await tx
    .select()
    .from(esignSignatory)
    .where(and(eq(esignSignatory.tokenHash, hashToken(token)), eq(esignSignatory.tenantId, tenantId)));
  const gone = () =>
    new AppError(
      404,
      'NOT_FOUND',
      'This signing link is not valid. Open the contract in the portal to get a new one.',
    );
  if (!sig || sig.userId !== userId || sig.tokenExpiresAt <= d.clock.now()) throw gone();
  const [env] = await tx.select().from(esignEnvelope).where(eq(esignEnvelope.id, sig.envelopeId));
  if (!env) throw gone();
  return { sig, env };
}

/** What the signing ceremony shows: a summary of the document, never more than the signatory may know. */
export async function ceremonySummary(tx: Tx, tenantId: string, sig: SignatoryRow, env: EnvelopeRow) {
  const [c] = await tx.select().from(contract).where(eq(contract.id, env.contractId));
  const [s] = c
    ? await tx.select({ company: supplier.company }).from(supplier).where(eq(supplier.id, c.supplierId))
    : [];
  let requestTitle: string | null = null;
  if (c?.tenderId) {
    const [td] = await tx.select().from(tender).where(eq(tender.id, c.tenderId));
    if (td)
      requestTitle =
        (await tx.select({ t: request.title }).from(request).where(eq(request.id, td.requestId)))[0]?.t ??
        null;
  }
  const clauses = c ? await tx.select({ id: clause.id }).from(clause).where(eq(clause.contractId, c.id)) : [];
  const all = await tx
    .select()
    .from(esignSignatory)
    .where(eq(esignSignatory.envelopeId, env.id))
    .orderBy(asc(esignSignatory.routingOrder));
  const blind = env.signingMode === 'BLIND';
  const earlier = all.filter((x) => x.routingOrder < sig.routingOrder && x.status !== 'SIGNED');
  return {
    simulated: true as const,
    provider: env.provider,
    providerLabel: ADAPTERS[env.provider].label,
    envelopeStatus: env.status,
    externalId: env.externalId,
    contract: c
      ? {
          id: c.id,
          number: c.number,
          title: c.title ?? requestTitle ?? c.number,
          supplier: s?.company ?? '',
          value: Number(c.value),
          startDate: c.startDate,
          endDate: c.endDate,
          status: c.status,
          clauseCount: clauses.length,
        }
      : null,
    signingMode: env.signingMode,
    me: { name: sig.name, role: sig.roleLabel, status: sig.status, order: sig.routingOrder },
    // in blind signing nobody sees another signatory; in staged signing a person sees whose turn comes first
    others: blind
      ? []
      : all
          .filter((x) => x.id !== sig.id)
          .map((x) => ({ name: x.name, role: x.roleLabel, status: x.status, order: x.routingOrder })),
    waitingFor:
      env.signingMode === 'STAGED' && earlier.length
        ? blind
          ? 'an earlier signatory'
          : earlier[0]!.name
        : null,
    expiresAt: sig.tokenExpiresAt.toISOString(),
    canSign: env.status === ACTIVE_ENVELOPE && !TERMINAL.includes(sig.status),
    tenantId,
  };
}
