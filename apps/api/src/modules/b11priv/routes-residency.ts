/**
 * B11b routes, part 1: hosting country and cross-border controls (NFR-R02, SEC-D09), the egress allow-list (SEC-D05),
 * AI conversation retention and legal holds (SEC-D06), and the hosting topology design content (SEC-D11).
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ROLE_NAMES, type Clock } from '@if/shared';
import type { AuditService } from '../../audit/audit-service.js';
import { guard, type GuardDeps } from '../../auth/guard.js';
import { withContext, type RequestContext, type Tx } from '../../db/client.js';
import {
  appUser,
  connector,
  conversation,
  conversationMeta,
  legalHold,
  outboundRefusal,
  request,
  retentionRun,
} from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { fallBackFrom } from '../b10ai/service.js';
import { MODELS } from '../b10ai/models.js';
import { providerEntry } from '../b10conn/catalogue.js';
import { COUNTRIES, loadSettings, saveSettings, type Settings } from '../settings/settings.js';
import { EGRESS_EVIDENCE, EGRESS_MODEL, egressDecision, patternProblem } from './egress.js';
import { assertOutbound, refusable } from './outbound.js';
import { outboundPaths } from './paths.js';
import { allowedRegions, regionAllowed } from './region.js';
import { runRetention } from './retention.js';
import { TOPOLOGY, TOPOLOGY_LABEL, TOPOLOGY_NOTE } from './topology.js';

export interface B11Deps extends GuardDeps {
  clock: Clock;
  audit: AuditService;
}

export const STAFF = ROLE_NAMES.filter((r) => r !== 'SUPPLIER');
export const READERS = ['ADMIN', 'PROBITY', 'EXEC'] as const;
const HOLDERS = ['ADMIN', 'LEGAL', 'PROBITY'] as const;
const uuid = z.string().uuid();
const reason = z.string().trim().min(10, 'Give a reason of at least 10 characters').max(500);

const residencyBody = z
  .object({
    country: z.enum(COUNTRIES),
    allowedRegions: z.array(z.enum(COUNTRIES)).max(10),
    aiRegion: z.enum(COUNTRIES),
    logRegion: z.enum(COUNTRIES),
    reason,
  })
  .strict();
const egressBody = z
  .object({ allowedHosts: z.array(z.string().trim().toLowerCase().min(4).max(120)).max(50), reason })
  .strict();
const probeBody = z.object({ host: z.string().trim().min(1).max(200) }).strict();
const retentionBody = z
  .object({ aiConversationDays: z.number().int().min(30).max(3650), reason: reason.optional() })
  .strict();
const holdBody = z
  .object({ entityType: z.enum(['REQUEST', 'CONVERSATION']), entityId: uuid, reason })
  .strict();
const releaseBody = z.object({ reason }).strict();

async function nameMap(tx: Tx, ids: Array<string | null>) {
  const u = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!u.length) return new Map<string, string>();
  const rows = await tx
    .select({ id: appUser.id, name: appUser.name })
    .from(appUser)
    .where(inArray(appUser.id, u));
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function residencyView(tx: Tx, tenantId: string) {
  const s = await loadSettings(tx, tenantId);
  const paths = await outboundPaths(tx, tenantId, s);
  const recent = await tx
    .select()
    .from(outboundRefusal)
    .where(eq(outboundRefusal.tenantId, tenantId))
    .orderBy(desc(outboundRefusal.createdAt))
    .limit(50);
  const counts = await tx
    .select({ kind: outboundRefusal.kind, n: sql<number>`count(*)::int` })
    .from(outboundRefusal)
    .where(eq(outboundRefusal.tenantId, tenantId))
    .groupBy(outboundRefusal.kind);
  const n = (k: string) => Number(counts.find((c) => c.kind === k)?.n ?? 0);
  const names = await nameMap(
    tx,
    recent.map((r) => r.actorId),
  );
  const refusal = (r: (typeof recent)[number]) => ({
    id: r.id,
    kind: r.kind,
    purpose: r.purpose,
    target: r.target,
    region: r.region,
    electedCountry: r.electedCountry,
    reason: r.reason,
    actor: r.actorId ? (names.get(r.actorId) ?? null) : null,
    at: r.createdAt.toISOString(),
  });
  return {
    model: EGRESS_MODEL,
    simulated: true,
    country: s.residency.country,
    allowedRegions: s.residency.allowedRegions,
    permittedRegions: allowedRegions(s.residency),
    aiRegion: s.residency.aiRegion,
    logRegion: s.residency.logRegion,
    aiRegionAllowed: regionAllowed(s.residency, s.residency.aiRegion),
    logRegionAllowed: regionAllowed(s.residency, s.residency.logRegion),
    countries: COUNTRIES,
    paths,
    refusals: { residency: n('RESIDENCY'), egress: n('EGRESS'), total: n('RESIDENCY') + n('EGRESS') },
    recentRefusals: recent.map(refusal),
    egress: {
      allowedHosts: s.egress.allowedHosts,
      evidence: EGRESS_EVIDENCE,
      blocked: n('EGRESS'),
      recent: recent.filter((r) => r.kind === 'EGRESS').map(refusal),
    },
  };
}

/** The effect of a new hosting country on what is already switched on. Never switches anything on. */
async function applyResidencyEffects(
  tx: Tx,
  d: B11Deps,
  ctx: RequestContext,
  tenantId: string,
  next: Settings['residency'],
) {
  const disabled: Array<{ kind: string; provider: string; region: string }> = [];
  const rows = await tx.select().from(connector).where(eq(connector.tenantId, tenantId));
  for (const c of rows) {
    if (!c.enabled || c.kind === 'AI') continue;
    const e = providerEntry(c.kind, c.provider);
    if (!e || regionAllowed(next, e.region)) continue;
    await tx
      .update(connector)
      .set({ enabled: false, updatedAt: d.clock.now() })
      .where(eq(connector.id, c.id));
    await d.audit.record(tx, ctx, {
      action: 'connector.disabled_by_residency',
      entityType: 'connector',
      entityId: c.id,
      before: { enabled: true },
      after: {
        enabled: false,
        kind: c.kind,
        provider: c.provider,
        region: e.region,
        electedCountry: next.country,
      },
    });
    disabled.push({ kind: c.kind, provider: c.provider, region: e.region });
  }
  // an AI model that now processes outside the allowed regions is withdrawn: back to the built-in model
  const fellBack: string[] = [];
  for (const m of MODELS) {
    if (m.builtIn || regionAllowed(next, m.dataHandling.region)) continue;
    const r = await fallBackFrom(tx, tenantId, m.id);
    if (r.changed) {
      fellBack.push(m.id);
      await d.audit.record(tx, ctx, {
        action: 'ai.withdrawn_by_residency',
        entityType: 'tenant',
        entityId: tenantId,
        before: { ai: r.before },
        after: { ai: r.after, model: m.id, region: m.dataHandling.region, electedCountry: next.country },
      });
    }
  }
  return { disabledConnectors: disabled, aiModelsWithdrawn: fellBack };
}

export function registerResidencyRoutes(app: FastifyInstance, p: string, d: B11Deps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);

  // ---------------------------------------------------------------- residency (NFR-R02, SEC-D09)
  reg('GET', '/admin/residency');
  app.get(`${p}/admin/residency`, { preHandler: guard(d, [...READERS]) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, (tx) => residencyView(tx, a.user.tenantId));
  });

  reg('PUT', '/admin/residency');
  app.put(`${p}/admin/residency`, { preHandler: guard(d, ['ADMIN']) }, async (req) => {
    const a = req.auth!;
    const b = parse(residencyBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const before = (await loadSettings(tx, a.user.tenantId)).residency;
      const next: Settings['residency'] = {
        country: b.country,
        allowedRegions: [...new Set(b.allowedRegions)].filter((r) => r !== b.country),
        aiRegion: b.aiRegion,
        logRegion: b.logRegion,
      };
      const changed = JSON.stringify(before) !== JSON.stringify(next);
      if (!changed)
        throw new AppError(409, 'NO_CHANGE', 'Nothing would change', [
          { field: 'country', message: 'These are the settings already in force' },
        ]);
      await saveSettings(tx, a.user.tenantId, { residency: next });
      await d.audit.record(tx, a.ctx, {
        action: 'settings.residency',
        entityType: 'tenant',
        entityId: a.user.tenantId,
        before: { residency: before },
        after: { residency: next, reason: b.reason },
      });
      const effects = await applyResidencyEffects(tx, d, a.ctx, a.user.tenantId, next);
      if (before.country !== next.country)
        await d.audit.record(tx, a.ctx, {
          action: 'residency.country_changed',
          entityType: 'tenant',
          entityId: a.user.tenantId,
          before: { country: before.country },
          after: { country: next.country, reason: b.reason, ...effects },
        });
      return {
        ...(await residencyView(tx, a.user.tenantId)),
        ...effects,
        changedCountry: before.country !== next.country,
      };
    });
  });

  // ---------------------------------------------------------------- egress (SEC-D05)
  reg('GET', '/admin/egress');
  app.get(`${p}/admin/egress`, { preHandler: guard(d, [...READERS]) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => (await residencyView(tx, a.user.tenantId)).egress);
  });

  reg('PUT', '/admin/egress');
  app.put(`${p}/admin/egress`, { preHandler: guard(d, ['ADMIN']) }, async (req) => {
    const a = req.auth!;
    const b = parse(egressBody, req.body);
    const problems = b.allowedHosts.flatMap((h) => {
      const m = patternProblem(h);
      return m ? [{ field: 'allowedHosts', message: m }] : [];
    });
    if (problems.length)
      throw new AppError(422, 'VALIDATION_FAILED', 'Some hosts cannot be allowed', problems);
    return withContext(d.database, a.ctx, async (tx) => {
      const before = (await loadSettings(tx, a.user.tenantId)).egress;
      const next = { allowedHosts: [...new Set(b.allowedHosts.map((h) => h.trim().toLowerCase()))] };
      await saveSettings(tx, a.user.tenantId, { egress: next });
      await d.audit.record(tx, a.ctx, {
        action: 'settings.egress',
        entityType: 'tenant',
        entityId: a.user.tenantId,
        before: { egress: before },
        after: { egress: next, reason: b.reason },
      });
      return (await residencyView(tx, a.user.tenantId)).egress;
    });
  });

  reg('POST', '/admin/egress/probe');
  app.post(`${p}/admin/egress/probe`, { preHandler: guard(d, ['ADMIN']) }, async (req) => {
    const a = req.auth!;
    const b = parse(probeBody, req.body);
    // a real attempt through the gate: a refused host is audited and counted like any other
    return refusable(d.database, a.ctx, async (tx) => {
      const s = await loadSettings(tx, a.user.tenantId);
      await assertOutbound(tx, a.user.tenantId, {
        purpose: 'CONNECTOR',
        target: { label: `probe ${b.host}`, host: b.host },
        actorId: a.user.id,
        settings: s,
      });
      const dec = egressDecision(s.egress.allowedHosts, b.host);
      return { allowed: true, host: dec.host, matchedBy: dec.matchedBy, simulated: true };
    });
  });

  // ---------------------------------------------------------------- retention and legal holds (SEC-D06)
  async function retentionView(tx: Tx, tenantId: string) {
    const s = await loadSettings(tx, tenantId);
    const metas = await tx.select().from(conversationMeta).where(eq(conversationMeta.tenantId, tenantId));
    const convCount = (
      await tx.select({ id: conversation.id }).from(conversation).where(eq(conversation.tenantId, tenantId))
    ).length;
    const holds = await tx
      .select()
      .from(legalHold)
      .where(eq(legalHold.tenantId, tenantId))
      .orderBy(desc(legalHold.placedAt))
      .limit(100);
    const runs = await tx
      .select()
      .from(retentionRun)
      .where(eq(retentionRun.tenantId, tenantId))
      .orderBy(desc(retentionRun.ranAt))
      .limit(20);
    const names = await nameMap(tx, [
      ...holds.flatMap((h) => [h.placedBy, h.releasedBy]),
      ...runs.map((r) => r.ranBy),
    ]);
    return {
      aiConversationDays: s.retention.aiConversationDays,
      minimumDays: 30,
      aiRegion: s.residency.aiRegion,
      aiRegionAllowed: regionAllowed(s.residency, s.residency.aiRegion),
      conversations: {
        total: convCount,
        stamped: metas.length,
        anonymised: metas.filter((m) => m.anonymisedAt).length,
      },
      scope:
        'Intake chat transcripts. The Ask AI box answers and stores nothing, so it has no transcript to retain.',
      holds: holds.map((h) => ({
        id: h.id,
        entityType: h.entityType,
        entityId: h.entityId,
        reason: h.reason,
        placedBy: names.get(h.placedBy) ?? null,
        placedAt: h.placedAt.toISOString(),
        open: h.releasedAt === null,
        releasedBy: h.releasedBy ? (names.get(h.releasedBy) ?? null) : null,
        releasedAt: h.releasedAt?.toISOString() ?? null,
        releaseReason: h.releaseReason,
      })),
      runs: runs.map((r) => ({
        id: r.id,
        at: r.ranAt.toISOString(),
        by: r.ranBy ? (names.get(r.ranBy) ?? null) : 'Scheduled job',
        trigger: r.trigger,
        retentionDays: r.retentionDays,
        expired: r.expired,
        anonymised: r.anonymised,
        messagesCleared: r.messagesCleared,
        skippedHeld: r.skippedHeld,
        held: r.held as Array<{ conversationId: string; reason: string; via: string }>,
      })),
    };
  }

  reg('GET', '/privacy/retention');
  app.get(`${p}/privacy/retention`, { preHandler: guard(d, [...HOLDERS]) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, (tx) => retentionView(tx, a.user.tenantId));
  });

  reg('PUT', '/privacy/retention');
  app.put(`${p}/privacy/retention`, { preHandler: guard(d, ['ADMIN']) }, async (req) => {
    const a = req.auth!;
    const b = parse(retentionBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const { before, after } = await saveSettings(tx, a.user.tenantId, {
        retention: { aiConversationDays: b.aiConversationDays },
      });
      if (before.retention.aiConversationDays !== after.retention.aiConversationDays)
        await d.audit.record(tx, a.ctx, {
          action: 'settings.retention',
          entityType: 'tenant',
          entityId: a.user.tenantId,
          before: { retention: before.retention },
          after: { retention: after.retention, ...(b.reason ? { reason: b.reason } : {}) },
        });
      return retentionView(tx, a.user.tenantId);
    });
  });

  reg('POST', '/privacy/retention/run');
  app.post(`${p}/privacy/retention/run`, { preHandler: guard(d, ['ADMIN']) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => ({
      result: await runRetention(tx, a.user.tenantId, a.user.id, 'MANUAL'),
      retention: await retentionView(tx, a.user.tenantId),
    }));
  });

  reg('POST', '/privacy/legal-holds');
  app.post(`${p}/privacy/legal-holds`, { preHandler: guard(d, [...HOLDERS]) }, async (req, reply) => {
    const a = req.auth!;
    const b = parse(holdBody, req.body);
    const out = await withContext(d.database, a.ctx, async (tx) => {
      const exists =
        b.entityType === 'REQUEST'
          ? await tx
              .select({ id: request.id })
              .from(request)
              .where(and(eq(request.id, b.entityId), eq(request.tenantId, a.user.tenantId)))
          : await tx
              .select({ id: conversation.id })
              .from(conversation)
              .where(and(eq(conversation.id, b.entityId), eq(conversation.tenantId, a.user.tenantId)));
      if (!exists.length)
        throw new AppError(
          404,
          'NOT_FOUND',
          `${b.entityType === 'REQUEST' ? 'Request' : 'Conversation'} not found`,
        );
      const open = await tx
        .select({ id: legalHold.id })
        .from(legalHold)
        .where(
          and(
            eq(legalHold.tenantId, a.user.tenantId),
            eq(legalHold.entityType, b.entityType),
            eq(legalHold.entityId, b.entityId),
            sql`${legalHold.releasedAt} is null`,
          ),
        );
      if (open.length) throw new AppError(409, 'ALREADY_HELD', 'This record is already on legal hold');
      const [row] = await tx
        .insert(legalHold)
        .values({
          tenantId: a.user.tenantId,
          entityType: b.entityType,
          entityId: b.entityId,
          reason: b.reason,
          placedBy: a.user.id,
          placedAt: d.clock.now(),
        })
        .returning();
      await d.audit.record(tx, a.ctx, {
        action: 'legal_hold.placed',
        entityType: b.entityType === 'REQUEST' ? 'request' : 'conversation',
        entityId: b.entityId,
        after: { holdId: row!.id, reason: b.reason },
      });
      return row!.id;
    });
    return reply.status(201).send({ id: out });
  });

  reg('POST', '/privacy/legal-holds/{id}/release');
  app.post(`${p}/privacy/legal-holds/:id/release`, { preHandler: guard(d, [...HOLDERS]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(releaseBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const [h] = await tx
        .select()
        .from(legalHold)
        .where(and(eq(legalHold.id, id), eq(legalHold.tenantId, a.user.tenantId)));
      if (!h) throw new AppError(404, 'NOT_FOUND', 'Legal hold not found');
      if (h.releasedAt) throw new AppError(409, 'ALREADY_RELEASED', 'This hold was already released');
      await tx
        .update(legalHold)
        .set({ releasedAt: d.clock.now(), releasedBy: a.user.id, releaseReason: b.reason })
        .where(eq(legalHold.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'legal_hold.released',
        entityType: h.entityType === 'REQUEST' ? 'request' : 'conversation',
        entityId: h.entityId,
        after: { holdId: id, reason: b.reason },
      });
      return { id, released: true };
    });
  });

  // ---------------------------------------------------------------- hosting topology (SEC-D11, design only)
  reg('GET', '/design/hosting-topology');
  app.get(`${p}/design/hosting-topology`, { preHandler: guard(d, [...STAFF]) }, async () => ({
    label: TOPOLOGY_LABEL,
    designOnly: true,
    note: TOPOLOGY_NOTE,
    options: TOPOLOGY,
  }));

  return done;
}
