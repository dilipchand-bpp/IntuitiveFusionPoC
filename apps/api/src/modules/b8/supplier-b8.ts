/**
 * Roadmap batch B8, supplier intelligence: ratings both ways (FR-0790), duplicate detection (FR-0795), risk, resilience and
 * ESG scoring with alternatives, carbon and diversity reporting and modern slavery checks (FR-0800), and lessons learned
 * with recall on comparable procurements (FR-0805).
 */
import { and, asc, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Clock } from '@if/shared';
import { MockVendorRegistry } from '../../adapters/vendor-registry.js';
import type { AuditService } from '../../audit/audit-service.js';
import { guard, type AuthContext, type GuardDeps } from '../../auth/guard.js';
import { withContext, type Tx } from '../../db/client.js';
import {
  appUser,
  contract,
  duplicateDismissal,
  lesson,
  notification,
  request,
  supplier,
  supplierRating,
} from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { supplierSignals, type Location } from '../reporting/b6-rules.js';
import { visibleRequests } from '../reporting/scope.js';
import { loadSettings } from '../settings/settings.js';
import { usersWithRole } from '../notify/dispatch.js';
import {
  B8_MODEL,
  RATING_DIMENSIONS,
  findDuplicates,
  modernSlaverySignal,
  overallRating,
  ratingBand,
  recallLessons,
  scoreSupplier,
  type EsgData,
  type RatingDirection,
  type SupplierLite,
} from './rules.js';

export interface SupplierB8Deps extends GuardDeps {
  clock: Clock;
  audit: AuditService;
}
const uuid = z.string().uuid();
const SUPPLIER_READERS = ['PROCUREMENT', 'LEGAL', 'FINANCE', 'EXEC', 'ADMIN'] as const;

const ratingBody = z
  .object({
    contractId: uuid,
    scores: z.record(z.string(), z.number().int().min(1).max(5)),
    comment: z.string().trim().max(1000).optional(),
  })
  .strict();
const dismissBody = z
  .object({ supplierA: uuid, supplierB: uuid, reason: z.string().trim().min(5).max(500) })
  .strict();
const esgBody = z
  .object({
    carbonTonnesCo2e: z.number().min(0).max(1e9).nullable().optional(),
    renewablePct: z.number().min(0).max(100).nullable().optional(),
    diversityOwned: z
      .enum(['NONE', 'INDIGENOUS', 'WOMEN', 'DISABILITY', 'SOCIAL_ENTERPRISE'])
      .nullable()
      .optional(),
    modernSlaveryStatement: z.boolean().nullable().optional(),
  })
  .strict();
const lessonBody = z
  .object({
    kind: z.enum(['WENT_WELL', 'TO_IMPROVE', 'RISK', 'TIP']),
    text: z.string().trim().min(10).max(2000),
  })
  .strict();
const closeBody = z
  .object({
    outcome: z.enum(['COMPLETED', 'CANCELLED']),
    reason: z.string().trim().min(5).max(500).optional(),
    skipLessonsReason: z.string().trim().min(5).max(500).optional(),
  })
  .strict();

const esgOf = (s: { onboarding: unknown }): EsgData =>
  ((s.onboarding as { esg?: EsgData } | null)?.esg ?? {}) as EsgData;
const supplierLite = (s: typeof supplier.$inferSelect): SupplierLite => ({
  id: s.id,
  company: s.company,
  abn: s.abn,
  bank: (s.bank as SupplierLite['bank']) ?? null,
  location: (s.location as SupplierLite['location']) ?? null,
});
const pairKey = (a: string, b: string) => [a, b].sort().join('|');

/** At registration: tell procurement when the new supplier looks like one already on the master. */
export async function flagDuplicates(tx: Tx, tenantId: string, newSupplierId: string) {
  const all = await tx.select().from(supplier).where(eq(supplier.tenantId, tenantId));
  const dismissed = new Set(
    (await tx.select().from(duplicateDismissal).where(eq(duplicateDismissal.tenantId, tenantId))).map((x) =>
      pairKey(x.supplierA, x.supplierB),
    ),
  );
  const hits = findDuplicates(all.map(supplierLite), dismissed).filter(
    (x) => x.a.id === newSupplierId || x.b.id === newSupplierId,
  );
  if (!hits.length) return 0;
  const team = await usersWithRole(tx, tenantId, ['PROCUREMENT']);
  const top = hits[0]!;
  const other = top.a.id === newSupplierId ? top.b : top.a;
  const me = top.a.id === newSupplierId ? top.a : top.b;
  for (const u of team)
    await tx.insert(notification).values({
      tenantId,
      userId: u,
      title: 'A new supplier looks like one already on file',
      body: `${me.company} may be the same business as ${other.company} (${top.reasons.join('; ')}).`,
      link: '/app/suppliers',
    });
  return hits.length;
}

export function registerSupplierB8Routes(app: FastifyInstance, p: string, d: SupplierB8Deps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);
  const registry = new MockVendorRegistry();
  const now = () => d.clock.now();
  const today = () => now().toISOString().slice(0, 10);
  const idOf = (req: { params: unknown }) => parse(z.object({ id: uuid }), req.params).id;

  // ---------------------------------------------------------------- ratings (FR-0790)
  const checkScores = (direction: RatingDirection, scores: Record<string, number>) => {
    const want = RATING_DIMENSIONS[direction] as readonly string[];
    const keys = Object.keys(scores);
    if (keys.length !== want.length || !want.every((k) => k in scores))
      throw new AppError(422, 'VALIDATION_FAILED', `Score each of: ${want.join(', ')}`, [
        { field: 'scores', message: `Score each of: ${want.join(', ')} from 1 to 5` },
      ]);
  };
  async function rate(
    tx: Tx,
    a: AuthContext,
    supplierId: string,
    body: z.infer<typeof ratingBody>,
    direction: RatingDirection,
  ) {
    checkScores(direction, body.scores);
    const [c] = await tx
      .select()
      .from(contract)
      .where(
        and(
          eq(contract.id, body.contractId),
          eq(contract.tenantId, a.user.tenantId),
          isNull(contract.deletedAt),
        ),
      );
    if (!c || c.supplierId !== supplierId)
      throw new AppError(404, 'NOT_FOUND', 'That contract is not with this supplier');
    if (c.status !== 'EXECUTED')
      throw new AppError(409, 'INVALID_STATE', 'Only a signed contract can be rated');
    const [dup] = await tx
      .select({ id: supplierRating.id })
      .from(supplierRating)
      .where(
        and(
          eq(supplierRating.contractId, c.id),
          eq(supplierRating.direction, direction),
          eq(supplierRating.raterId, a.user.id),
        ),
      );
    if (dup) throw new AppError(409, 'ALREADY_RATED', 'You have already rated this contract');
    const overall = overallRating(body.scores);
    const [row] = await tx
      .insert(supplierRating)
      .values({
        tenantId: a.user.tenantId,
        supplierId,
        contractId: c.id,
        direction,
        raterId: a.user.id,
        scores: body.scores,
        overall: String(overall),
        comment: body.comment ?? null,
        createdAt: now(),
      })
      .returning();
    await d.audit.record(tx, a.ctx, {
      action: 'supplier.rate',
      entityType: 'supplier',
      entityId: supplierId,
      after: { contractId: c.id, direction, overall },
    });
    return { id: row!.id, overall, band: ratingBand(overall) };
  }

  reg('POST', '/suppliers/{id}/ratings');
  app.post(
    `${p}/suppliers/:id/ratings`,
    { preHandler: guard(d, ['CONTRACT_MGR', 'PROCUREMENT', 'EXEC']) },
    async (req, reply) => {
      const a = req.auth!;
      const id = idOf(req);
      const body = parse(ratingBody, req.body);
      const out = await withContext(d.database, a.ctx, (tx) =>
        rate(tx, a, id, body, 'ENTERPRISE_RATES_SUPPLIER'),
      );
      return reply.status(201).send(out);
    },
  );

  const summarise = (rows: Array<typeof supplierRating.$inferSelect>, dir: RatingDirection) => {
    const dims = RATING_DIMENSIONS[dir];
    const mine = rows.filter((r) => r.direction === dir);
    const avg = mine.length
      ? Math.round((mine.reduce((n, r) => n + Number(r.overall), 0) / mine.length) * 100) / 100
      : null;
    return {
      count: mine.length,
      average: avg,
      band: avg === null ? null : ratingBand(avg),
      dimensions: dims.map((k) => ({
        key: k,
        average: mine.length
          ? Math.round(
              (mine.reduce((n, r) => n + ((r.scores as Record<string, number>)[k] ?? 0), 0) / mine.length) *
                100,
            ) / 100
          : null,
      })),
    };
  };

  reg('GET', '/suppliers/{id}/ratings');
  app.get(
    `${p}/suppliers/:id/ratings`,
    { preHandler: guard(d, [...SUPPLIER_READERS, 'CONTRACT_MGR']) },
    async (req) => {
      const a = req.auth!;
      const id = idOf(req);
      return withContext(d.database, a.ctx, async (tx) => {
        const s = await loadSettings(tx, a.user.tenantId);
        const rows = await tx
          .select()
          .from(supplierRating)
          .where(and(eq(supplierRating.supplierId, id), eq(supplierRating.tenantId, a.user.tenantId)))
          .orderBy(desc(supplierRating.createdAt));
        const names = new Map(
          (
            await tx
              .select({ id: appUser.id, name: appUser.name })
              .from(appUser)
              .where(eq(appUser.tenantId, a.user.tenantId))
          ).map((u) => [u.id, u.name]),
        );
        const showTheirs = s.ratings.staffSeeSupplierRatings;
        return {
          supplierId: id,
          ofSupplier: summarise(rows, 'ENTERPRISE_RATES_SUPPLIER'),
          ofEnterprise: showTheirs ? summarise(rows, 'SUPPLIER_RATES_ENTERPRISE') : null,
          theirRatingsVisible: showTheirs,
          entries: rows
            .filter((r) => r.direction === 'ENTERPRISE_RATES_SUPPLIER' || showTheirs)
            .map((r) => ({
              id: r.id,
              direction: r.direction,
              contractId: r.contractId,
              overall: Number(r.overall),
              scores: r.scores,
              comment: r.comment,
              by: r.direction === 'ENTERPRISE_RATES_SUPPLIER' ? (names.get(r.raterId) ?? '') : 'The supplier',
              at: r.createdAt.toISOString(),
            })),
          dimensions: RATING_DIMENSIONS,
        };
      });
    },
  );

  reg('GET', '/supplier/ratings');
  app.get(`${p}/supplier/ratings`, { preHandler: guard(d, ['SUPPLIER']) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const s = await loadSettings(tx, a.user.tenantId);
      const sid = a.user.supplierId!;
      const rows = await tx.select().from(supplierRating).where(eq(supplierRating.supplierId, sid));
      const cs = await tx
        .select()
        .from(contract)
        .where(
          and(
            eq(contract.supplierId, sid),
            eq(contract.status, 'EXECUTED'),
            isNull(contract.deletedAt),
            isNull(contract.parentId),
          ),
        );
      const mineGiven = new Set(
        rows
          .filter((r) => r.direction === 'SUPPLIER_RATES_ENTERPRISE' && r.raterId === a.user.id)
          .map((r) => r.contractId),
      );
      return {
        dimensions: RATING_DIMENSIONS.SUPPLIER_RATES_ENTERPRISE,
        visible: s.ratings.supplierSeesRatings,
        received: s.ratings.supplierSeesRatings ? summarise(rows, 'ENTERPRISE_RATES_SUPPLIER') : null,
        contracts: cs.map((c) => ({
          id: c.id,
          number: c.number,
          title: c.title,
          rated: mineGiven.has(c.id),
        })),
      };
    });
  });

  reg('POST', '/supplier/ratings');
  app.post(`${p}/supplier/ratings`, { preHandler: guard(d, ['SUPPLIER']) }, async (req, reply) => {
    const a = req.auth!;
    const body = parse(ratingBody, req.body);
    const out = await withContext(d.database, a.ctx, (tx) =>
      rate(tx, a, a.user.supplierId!, body, 'SUPPLIER_RATES_ENTERPRISE'),
    );
    return reply.status(201).send(out);
  });

  // ---------------------------------------------------------------- duplicates (FR-0795)
  reg('GET', '/suppliers/duplicates');
  app.get(`${p}/suppliers/duplicates`, { preHandler: guard(d, [...SUPPLIER_READERS]) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const all = await tx.select().from(supplier).where(eq(supplier.tenantId, a.user.tenantId));
      const dismissed = new Set(
        (
          await tx.select().from(duplicateDismissal).where(eq(duplicateDismissal.tenantId, a.user.tenantId))
        ).map((x) => pairKey(x.supplierA, x.supplierB)),
      );
      return {
        model: B8_MODEL,
        checked: all.length,
        pairs: findDuplicates(all.map(supplierLite), dismissed).map((x) => ({
          a: { id: x.a.id, company: x.a.company, abn: x.a.abn },
          b: { id: x.b.id, company: x.b.company, abn: x.b.abn },
          score: x.score,
          reasons: x.reasons,
        })),
      };
    });
  });

  reg('POST', '/suppliers/duplicates/dismiss');
  app.post(
    `${p}/suppliers/duplicates/dismiss`,
    { preHandler: guard(d, ['PROCUREMENT', 'LEGAL']) },
    async (req, reply) => {
      const a = req.auth!;
      const body = parse(dismissBody, req.body);
      if (body.supplierA === body.supplierB)
        throw new AppError(422, 'VALIDATION_FAILED', 'Choose two different suppliers');
      const [x, y] = [body.supplierA, body.supplierB].sort() as [string, string];
      await withContext(d.database, a.ctx, async (tx) => {
        const found = await tx
          .select({ id: supplier.id })
          .from(supplier)
          .where(and(eq(supplier.tenantId, a.user.tenantId), inArray(supplier.id, [x, y])));
        if (found.length !== 2) throw new AppError(404, 'NOT_FOUND', 'Supplier not found');
        await tx
          .insert(duplicateDismissal)
          .values({
            tenantId: a.user.tenantId,
            supplierA: x,
            supplierB: y,
            userId: a.user.id,
            reason: body.reason,
            createdAt: now(),
          })
          .onConflictDoNothing();
        await d.audit.record(tx, a.ctx, {
          action: 'supplier.duplicate_dismissed',
          entityType: 'supplier',
          entityId: x,
          after: { other: y, reason: body.reason },
        });
      });
      return reply.status(204).send();
    },
  );

  // ---------------------------------------------------------------- risk, resilience and ESG (FR-0800)
  async function scoreAll(tx: Tx, a: AuthContext) {
    const sups = await tx.select().from(supplier).where(eq(supplier.tenantId, a.user.tenantId));
    const contracts = await tx
      .select()
      .from(contract)
      .where(
        and(
          eq(contract.tenantId, a.user.tenantId),
          eq(contract.status, 'EXECUTED'),
          isNull(contract.deletedAt),
          isNull(contract.parentId),
        ),
      );
    const ratings = await tx
      .select()
      .from(supplierRating)
      .where(
        and(
          eq(supplierRating.tenantId, a.user.tenantId),
          eq(supplierRating.direction, 'ENTERPRISE_RATES_SUPPLIER'),
        ),
      );
    const total = contracts.reduce((n, c) => n + Number(c.value), 0);
    const month = now().getUTCMonth() + 1;
    const out = [];
    for (const s of sups) {
      const mine = ratings.filter((r) => r.supplierId === s.id);
      const loc = s.location as Location | null;
      const fin = await registry.financialRisk(s.abn, s.company);
      const sig = loc
        ? supplierSignals(loc, month, fin)
        : [{ feed: 'FINANCIAL' as const, level: fin.level, detail: fin.reason }];
      const answers = ((s.onboarding as { answers?: Record<string, string> } | null)?.answers ??
        {}) as Record<string, string>;
      const cyberKey = Object.keys(answers).find((k) => /cyber|security/i.test(k));
      const esg = esgOf(s);
      const cats = (s.categories as string[]) ?? [];
      const committed = contracts
        .filter((c) => c.supplierId === s.id)
        .reduce((n, c) => n + Number(c.value), 0);
      const r = scoreSupplier({
        ratingAvg: mine.length ? mine.reduce((n, x) => n + Number(x.overall), 0) / mine.length : null,
        ratingCount: mine.length,
        sanctions: s.sanctionsStatus,
        insurance: s.insuranceStatus,
        signals: sig.map((x) => ({ kind: x.feed, level: x.level, note: x.detail })),
        flaggedOnboarding: ((s.onboarding as { flagged?: string[] } | null)?.flagged ?? []).length,
        esg,
        spendShare: total > 0 ? committed / total : 0,
        hasCyberAnswer: cyberKey ? /^y/i.test(answers[cyberKey]!) : null,
        today: today(),
      });
      out.push({ s, cats, committed, esg, ...r });
    }
    return out;
  }
  const RISK_READERS = ['PROCUREMENT', 'LEGAL', 'FINANCE', 'EXEC', 'PROBITY'] as const;

  reg('GET', '/suppliers/{id}/risk');
  app.get(`${p}/suppliers/:id/risk`, { preHandler: guard(d, [...RISK_READERS]) }, async (req) => {
    const a = req.auth!;
    const id = idOf(req);
    return withContext(d.database, a.ctx, async (tx) => {
      const all = await scoreAll(tx, a);
      const me = all.find((x) => x.s.id === id);
      if (!me) throw new AppError(404, 'NOT_FOUND', 'Supplier not found');
      const alternatives = all
        .filter(
          (x) => x.s.id !== id && x.s.sanctionsStatus !== 'MATCH' && x.cats.some((c) => me.cats.includes(c)),
        )
        .sort((p1, p2) => p2.score - p1.score)
        .slice(0, 3)
        .map((x) => ({
          supplierId: x.s.id,
          company: x.s.company,
          score: x.score,
          level: x.level,
          sharedCategories: x.cats.filter((c) => me.cats.includes(c)),
        }));
      return {
        model: B8_MODEL,
        supplierId: id,
        company: me.s.company,
        score: me.score,
        level: me.level,
        factors: me.factors,
        recommendations: me.recommendations,
        alternatives,
        esg: me.esg,
        note: 'The score combines ratings, the platform financial reading, a simulated weather and watchlist feed, compliance records and what the supplier declared. It is a prompt to look, not a verdict.',
      };
    });
  });

  reg('GET', '/reports/supplier-scores');
  app.get(
    `${p}/reports/supplier-scores`,
    { preHandler: guard(d, ['PROCUREMENT', 'EXEC', 'FINANCE', 'PROBITY']) },
    async (req) => {
      const a = req.auth!;
      return withContext(d.database, a.ctx, async (tx) => {
        const all = await scoreAll(tx, a);
        return {
          model: B8_MODEL,
          items: all
            .map((x) => ({
              supplierId: x.s.id,
              company: x.s.company,
              score: x.score,
              level: x.level,
              committed: x.committed,
              topRecommendation: x.recommendations[0] ?? null,
            }))
            .sort((p1, p2) => p1.score - p2.score),
        };
      });
    },
  );

  reg('GET', '/reports/diversity');
  app.get(
    `${p}/reports/diversity`,
    { preHandler: guard(d, ['PROCUREMENT', 'EXEC', 'FINANCE']) },
    async (req) => {
      const a = req.auth!;
      return withContext(d.database, a.ctx, async (tx) => {
        const all = await scoreAll(tx, a);
        const groups = new Map<string, { suppliers: number; committed: number }>();
        for (const x of all) {
          const k =
            x.esg.diversityOwned && x.esg.diversityOwned !== 'NONE'
              ? x.esg.diversityOwned
              : 'NOT_REPORTED_OR_NONE';
          const g = groups.get(k) ?? { suppliers: 0, committed: 0 };
          g.suppliers += 1;
          g.committed += x.committed;
          groups.set(k, g);
        }
        const total = all.reduce((n, x) => n + x.committed, 0);
        const carbon = all.reduce((n, x) => n + (x.esg.carbonTonnesCo2e ?? 0), 0);
        return {
          totalCommitted: total,
          groups: [...groups.entries()].map(([group, g]) => ({
            group,
            ...g,
            sharePct: total ? Math.round((g.committed / total) * 1000) / 10 : 0,
          })),
          carbon: {
            reportedBy: all.filter((x) => typeof x.esg.carbonTonnesCo2e === 'number').length,
            of: all.length,
            tonnesCo2e: carbon,
          },
        };
      });
    },
  );

  reg('PUT', '/supplier/profile/esg');
  app.put(`${p}/supplier/profile/esg`, { preHandler: guard(d, ['SUPPLIER']) }, async (req) => {
    const a = req.auth!;
    const body = parse(esgBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const [s] = await tx.select().from(supplier).where(eq(supplier.id, a.user.supplierId!));
      if (!s) throw new AppError(404, 'NOT_FOUND', 'Supplier not found');
      const onboarding = (s.onboarding ?? {}) as Record<string, unknown>;
      const esg = { ...esgOf(s), ...body } as EsgData;
      const next = { ...onboarding, esg };
      await tx.update(supplier).set({ onboarding: next }).where(eq(supplier.id, s.id));
      await d.audit.record(tx, a.ctx, {
        action: 'supplier.esg_update',
        entityType: 'supplier',
        entityId: s.id,
        after: body,
      });
      return { esg };
    });
  });

  reg('GET', '/supplier/profile/esg');
  app.get(`${p}/supplier/profile/esg`, { preHandler: guard(d, ['SUPPLIER']) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const [s] = await tx.select().from(supplier).where(eq(supplier.id, a.user.supplierId!));
      return { esg: s ? esgOf(s) : {} };
    });
  });

  reg('POST', '/suppliers/{id}/modern-slavery-check');
  app.post(
    `${p}/suppliers/:id/modern-slavery-check`,
    { preHandler: guard(d, ['PROCUREMENT', 'LEGAL']) },
    async (req) => {
      const a = req.auth!;
      const id = idOf(req);
      return withContext(d.database, a.ctx, async (tx) => {
        const [s] = await tx
          .select()
          .from(supplier)
          .where(and(eq(supplier.id, id), eq(supplier.tenantId, a.user.tenantId)));
        if (!s) throw new AppError(404, 'NOT_FOUND', 'Supplier not found');
        const esg = esgOf(s);
        const result = modernSlaverySignal((s.categories as string[]) ?? [], esg);
        const next = {
          ...((s.onboarding ?? {}) as Record<string, unknown>),
          esg: { ...esg, lastModernSlaveryCheck: today(), modernSlaveryResult: result },
        };
        await tx.update(supplier).set({ onboarding: next }).where(eq(supplier.id, id));
        await d.audit.record(tx, a.ctx, {
          action: 'supplier.modern_slavery_check',
          entityType: 'supplier',
          entityId: id,
          after: { result },
        });
        return { supplierId: id, result, checkedOn: today(), model: B8_MODEL };
      });
    },
  );

  // ---------------------------------------------------------------- lessons learned (FR-0805)
  const LESSON_ROLES = [
    'PROCUREMENT',
    'REQUESTER',
    'LEGAL',
    'CONTRACT_MGR',
    'DELEGATE',
    'EXEC',
    'FINANCE',
    'PROBITY',
    'EVALUATOR',
    'CHAIR',
  ] as const;
  async function mayAccess(tx: Tx, a: AuthContext, id: string) {
    const r = (await visibleRequests(tx, a)).rows.find((x) => x.id === id);
    if (!r) throw new AppError(404, 'NOT_FOUND', 'Procurement not found');
    return r;
  }

  reg('GET', '/requests/{id}/lessons');
  app.get(`${p}/requests/:id/lessons`, { preHandler: guard(d, [...LESSON_ROLES]) }, async (req) => {
    const a = req.auth!;
    const id = idOf(req);
    return withContext(d.database, a.ctx, async (tx) => {
      await mayAccess(tx, a, id);
      const rows = await tx
        .select({ l: lesson, by: appUser.name })
        .from(lesson)
        .innerJoin(appUser, eq(appUser.id, lesson.authorId))
        .where(eq(lesson.requestId, id))
        .orderBy(asc(lesson.createdAt));
      return rows.map((x) => ({
        id: x.l.id,
        kind: x.l.kind,
        phase: x.l.phase,
        text: x.l.text,
        by: x.by,
        at: x.l.createdAt.toISOString(),
      }));
    });
  });

  reg('POST', '/requests/{id}/lessons');
  app.post(`${p}/requests/:id/lessons`, { preHandler: guard(d, [...LESSON_ROLES]) }, async (req, reply) => {
    const a = req.auth!;
    const id = idOf(req);
    const body = parse(lessonBody, req.body);
    const out = await withContext(d.database, a.ctx, async (tx) => {
      const r = await mayAccess(tx, a, id);
      const [row] = await tx
        .insert(lesson)
        .values({
          tenantId: a.user.tenantId,
          requestId: id,
          authorId: a.user.id,
          phase: r.phase,
          kind: body.kind,
          text: body.text,
          category: r.category,
          value: r.estimatedValue,
          createdAt: now(),
        })
        .returning();
      await d.audit.record(tx, a.ctx, {
        action: 'lesson.capture',
        entityType: 'request',
        entityId: id,
        after: { kind: body.kind, phase: r.phase },
      });
      return {
        id: row!.id,
        kind: row!.kind,
        phase: row!.phase,
        text: row!.text,
        at: row!.createdAt.toISOString(),
      };
    });
    return reply.status(201).send(out);
  });

  reg('GET', '/requests/{id}/lessons/recall');
  app.get(`${p}/requests/:id/lessons/recall`, { preHandler: guard(d, [...LESSON_ROLES]) }, async (req) => {
    const a = req.auth!;
    const id = idOf(req);
    return withContext(d.database, a.ctx, async (tx) => {
      const r = await mayAccess(tx, a, id);
      const others = await tx
        .select()
        .from(lesson)
        .where(and(eq(lesson.tenantId, a.user.tenantId), ne(lesson.requestId, id)));
      const hits = recallLessons(
        {
          category: r.category,
          value: r.estimatedValue === null ? null : Number(r.estimatedValue),
          title: r.title,
          phase: r.phase,
        },
        others.map((l) => ({
          id: l.id,
          requestId: l.requestId,
          category: l.category,
          value: l.value === null ? null : Number(l.value),
          text: l.text,
          kind: l.kind,
          phase: l.phase,
        })),
      );
      const visible = new Set((await visibleRequests(tx, a)).rows.map((x) => x.id));
      const reqs = hits.length
        ? await tx
            .select({ id: request.id, number: request.number, title: request.title })
            .from(request)
            .where(
              inArray(
                request.id,
                hits.map((h) => h.requestId),
              ),
            )
        : [];
      return {
        model: B8_MODEL,
        lessons: hits.map((h) => {
          const src = reqs.find((x) => x.id === h.requestId);
          return {
            id: h.id,
            kind: h.kind,
            phase: h.phase,
            text: h.text,
            why: h.why,
            from:
              visible.has(h.requestId) && src ? { id: src.id, number: src.number, title: src.title } : null,
          };
        }),
      };
    });
  });

  reg('POST', '/requests/{id}/close');
  app.post(`${p}/requests/:id/close`, { preHandler: guard(d, ['PROCUREMENT', 'EXEC']) }, async (req) => {
    const a = req.auth!;
    const id = idOf(req);
    const body = parse(closeBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const r = await mayAccess(tx, a, id);
      if (r.phase === 'CLOSED')
        throw new AppError(409, 'INVALID_STATE', 'This procurement is already closed');
      if (body.outcome === 'CANCELLED' && !body.reason)
        throw new AppError(422, 'VALIDATION_FAILED', 'Say why it was cancelled', [
          { field: 'reason', message: 'A reason is required to cancel' },
        ]);
      if (body.outcome === 'COMPLETED' && r.phase !== 'CONTRACT_MGMT')
        throw new AppError(
          409,
          'INVALID_STATE',
          'A procurement is completed once its contract is in management. To stop it earlier, cancel it.',
        );
      const n = (await tx.select({ id: lesson.id }).from(lesson).where(eq(lesson.requestId, id)).limit(1))
        .length;
      if (n === 0 && !body.skipLessonsReason)
        throw new AppError(
          409,
          'LESSONS_REQUIRED',
          'Capture at least one lesson learned, or say why there is nothing to record',
          [{ field: 'skipLessonsReason', message: 'Add a lesson, or give a reason for skipping' }],
        );
      await tx
        .update(request)
        .set({ phase: 'CLOSED', status: 'COMPLETE', updatedAt: now() })
        .where(eq(request.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'request.close',
        entityType: 'request',
        entityId: id,
        before: { phase: r.phase, status: r.status },
        after: {
          outcome: body.outcome,
          reason: body.reason ?? null,
          lessonsSkipped: n === 0 ? body.skipLessonsReason : null,
        },
      });
      await tx.insert(notification).values({
        tenantId: a.user.tenantId,
        userId: r.requesterId,
        title: body.outcome === 'COMPLETED' ? 'Your procurement is closed' : 'Your procurement was cancelled',
        body: `${r.number} ${r.title}${body.reason ? `: ${body.reason}` : ''}`,
        link: `/app/requests/${id}`,
      });
      return { id, phase: 'CLOSED', status: 'COMPLETE', outcome: body.outcome };
    });
  });
  return done;
}
