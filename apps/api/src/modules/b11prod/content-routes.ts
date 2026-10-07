/**
 * Outside content endpoints (NFR-R03): the packs and their state, a refresh on demand, the items of a pack, and the hints a
 * request or plan receives from in-house data and outside content, each with its source.
 */
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { guard, type GuardDeps } from '../../auth/guard.js';
import { withContext } from '../../db/client.js';
import { CONTENT_KINDS, contentItem, contentPack, request } from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { loadSettings } from '../settings/settings.js';
import { LATEST_VERSION } from './content-source.js';
import {
  KIND_LABEL,
  benchmarkFor,
  libraryRisks,
  listPacks,
  refreshPack,
  runContentSchedule,
  suggestTaxonomy,
} from './content.js';

export interface ContentRouteDeps extends GuardDeps {
  schedulerMinutes?: number | undefined;
}

const READERS = ['PROCUREMENT', 'ADMIN', 'LEGAL', 'EXEC'] as const;
const REFRESHERS = ['ADMIN', 'PROCUREMENT'] as const;
const HINT_ROLES = [
  'REQUESTER',
  'PROCUREMENT',
  'LEGAL',
  'DELEGATE',
  'EXEC',
  'PROBITY',
  'CONTRACT_MGR',
] as const;
const refreshBody = z
  .object({
    kind: z.enum(CONTENT_KINDS).optional(),
    /** A demonstration control: move to that release of the simulated source (never backwards). */
    toVersion: z.number().int().min(1).max(LATEST_VERSION).optional(),
  })
  .strict();
const kindParam = z.object({ key: z.enum(CONTENT_KINDS) });
const idParam = z.object({ id: z.string().uuid() });

export function registerContentRoutes(app: FastifyInstance, p: string, d: ContentRouteDeps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);

  if (d.schedulerMinutes) {
    const h = setInterval(
      () => void runContentSchedule(d.database, { clock: d.clock, audit: d.audit }).catch(() => undefined),
      d.schedulerMinutes * 60_000,
    );
    h.unref();
    app.addHook('onClose', async () => clearInterval(h));
  }

  reg('GET', '/content');
  app.get(`${p}/content`, { preHandler: guard(d, READERS) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const settings = await loadSettings(tx, a.user.tenantId);
      return {
        packs: await listPacks(tx, a.user.tenantId, d.clock.now(), settings),
        settings: settings.content,
        latestAvailable: LATEST_VERSION,
        canRefresh: a.user.roles.some((r) => (REFRESHERS as readonly string[]).includes(r)),
        simulated: true as const,
        note: 'The outside source is simulated: its content is synthetic and changes by version number so a refresh visibly adds, changes and removes items.',
      };
    });
  });

  reg('GET', '/content/{key}/items');
  app.get(`${p}/content/:key/items`, { preHandler: guard(d, READERS) }, async (req) => {
    const a = req.auth!;
    const { key: kind } = parse(kindParam, req.params);
    return withContext(d.database, a.ctx, async (tx) => {
      const [pack] = await tx
        .select()
        .from(contentPack)
        .where(and(eq(contentPack.tenantId, a.user.tenantId), eq(contentPack.kind, kind)));
      const items = pack
        ? await tx
            .select()
            .from(contentItem)
            .where(eq(contentItem.packId, pack.id))
            .orderBy(asc(contentItem.itemKey))
        : [];
      return {
        kind,
        label: KIND_LABEL[kind],
        version: pack?.version ?? null,
        items: items.map((i) => ({ key: i.itemKey, label: i.label, data: i.data })),
      };
    });
  });

  reg('POST', '/content/refresh');
  app.post(`${p}/content/refresh`, { preHandler: guard(d, REFRESHERS) }, async (req) => {
    const a = req.auth!;
    const body = parse(refreshBody, req.body ?? {});
    return withContext(d.database, a.ctx, async (tx) => {
      const settings = await loadSettings(tx, a.user.tenantId);
      const kinds = body.kind ? [body.kind] : [...CONTENT_KINDS];
      const results = [];
      for (const kind of kinds)
        results.push(
          await refreshPack(tx, { clock: d.clock, audit: d.audit }, a.ctx, kind, {
            toVersion: body.toVersion,
            validDays: settings.content.validDays,
          }),
        );
      return {
        results,
        packs: await listPacks(tx, a.user.tenantId, d.clock.now(), settings),
      };
    });
  });

  reg('GET', '/requests/{id}/content-hints');
  app.get(`${p}/requests/:id/content-hints`, { preHandler: guard(d, HINT_ROLES) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(idParam, req.params);
    return withContext(d.database, a.ctx, async (tx) => {
      const [r] = await tx
        .select()
        .from(request)
        .where(and(eq(request.id, id), eq(request.tenantId, a.user.tenantId)));
      const onlyRequester = a.user.roles.length === 1 && a.user.roles[0] === 'REQUESTER';
      if (!r || (onlyRequester && r.requesterId !== a.user.id))
        throw new AppError(404, 'NOT_FOUND', 'Request not found');
      const settings = await loadSettings(tx, a.user.tenantId);
      const now = d.clock.now();
      const taxonomy = await suggestTaxonomy(
        tx,
        a.user.tenantId,
        r.category,
        settings.intake.taxonomy,
        now,
        settings,
      );
      const benchmark = await benchmarkFor(
        tx,
        a.user.tenantId,
        {
          requestId: r.id,
          category: r.category,
          estimatedValue: r.estimatedValue === null ? null : Number(r.estimatedValue),
          termMonths: r.termMonths,
        },
        now,
        settings,
      );
      const lib = await libraryRisks(
        tx,
        a.user.tenantId,
        { category: r.category ?? '', text: r.title },
        now,
        settings,
      );
      const packs = await listPacks(tx, a.user.tenantId, now, settings);
      return {
        requestId: r.id,
        category: r.category,
        taxonomy,
        benchmark,
        risks: lib.risks,
        riskNote: lib.note,
        notes: packs.flatMap((x) =>
          x.fallbackNote && ['UNSPSC_TAXONOMY', 'MARKET_BENCHMARKS', 'RISK_LIBRARY'].includes(x.kind)
            ? [{ kind: x.kind, note: x.fallbackNote }]
            : [],
        ),
        simulated: true as const,
      };
    });
  });

  return done;
}
