/**
 * Guided buying and autonomous sourcing for commodity, low-value goods (FR-0820). A person buys from an approved catalogue,
 * or describes a need and the platform shortlists, scores and recommends; either way the result is a draft request that the
 * person reviews and submits through the normal checks (budget, approvals). Nothing is ordered by the platform alone: a
 * recommendation above the configured limit is refused, and below it still waits for a person's decision.
 */
import { and, asc, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AuditService } from '../../audit/audit-service.js';
import { guard, type AuthContext, type GuardDeps } from '../../auth/guard.js';
import { withContext, type Tx } from '../../db/client.js';
import {
  catalogueItem,
  contract,
  sourcingProposal,
  supplier,
  supplierRating,
  tenant,
} from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { IntakeService } from '../intake/service.js';
import { loadSettings } from '../settings/settings.js';

export const BUY_MODEL = 'rules-simulated-v1';
const uuid = z.string().uuid();
const r2 = (n: number) => Math.round(n * 100) / 100;

// ------------------------------------------------------------------ the rules
export interface Candidate {
  itemId: string;
  sku: string;
  name: string;
  category: string;
  supplierId: string;
  supplier: string;
  unit: string;
  unitPrice: number;
  leadDays: number;
  standing: number; // 0..100
}
export interface Scored extends Candidate {
  total: number;
  score: number;
  breakdown: { price: number; standing: number; delivery: number };
  why: string[];
}

const STOP = new Set([
  'the',
  'and',
  'for',
  'with',
  'need',
  'want',
  'buy',
  'get',
  'some',
  'please',
  'new',
  'any',
  'our',
  'units',
  'each',
]);
export const tokensOf = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w));

/** Items whose name, category or code share a word with the need. */
export function matching(need: string, items: Candidate[]): Candidate[] {
  const t = tokensOf(need);
  if (!t.length) return [];
  return items.filter((i) => {
    const hay = `${i.name} ${i.category} ${i.sku}`.toLowerCase();
    return t.some((w) => hay.includes(w) || (w.endsWith('s') && hay.includes(w.slice(0, -1))));
  });
}

/** Price 50%, the supplier's standing 30%, delivery 20%: the lowest total scores full marks on price, and a wait of two weeks or more scores none on delivery. */
export function scoreCandidates(cs: Candidate[], quantity: number): Scored[] {
  if (!cs.length) return [];
  const totals = cs.map((c) => c.unitPrice * quantity);
  const low = Math.min(...totals);
  return cs
    .map((c, i) => {
      const price = low > 0 ? (low / totals[i]!) * 100 : 100;
      const delivery = Math.max(0, 100 - (c.leadDays / 14) * 100);
      const score = r2(price * 0.5 + c.standing * 0.3 + delivery * 0.2);
      const why = [
        totals[i] === low
          ? 'lowest total price'
          : `${r2(((totals[i]! - low) / low) * 100)}% dearer than the cheapest`,
        c.standing >= 80
          ? 'a supplier in good standing'
          : c.standing >= 55
            ? 'a supplier in fair standing'
            : 'a supplier with a weaker record',
        c.leadDays === 0 ? 'ships at once' : `${c.leadDays} day${c.leadDays === 1 ? '' : 's'} to deliver`,
      ];
      return {
        ...c,
        total: r2(totals[i]!),
        score,
        breakdown: { price: r2(price), standing: r2(c.standing), delivery: r2(delivery) },
        why,
      };
    })
    .sort((a, b) => b.score - a.score);
}

/** What counts as standing: how the enterprise has rated them (3 out of 5 when unrated) and whether their insurance is current. */
export const standingOf = (ratingAvg: number | null, insurance: string) =>
  r2(
    ((ratingAvg ?? 3) / 5) * 100 * 0.6 +
      (insurance === 'CURRENT' ? 100 : insurance === 'EXPIRING' ? 60 : 0) * 0.4,
  );

// ------------------------------------------------------------------ routes
const itemBody = z
  .object({
    supplierId: uuid,
    contractId: uuid.optional(),
    sku: z.string().trim().min(1).max(40),
    name: z.string().trim().min(3).max(160),
    category: z.string().trim().min(2).max(120),
    unit: z.string().trim().min(1).max(20).default('each'),
    unitPrice: z.number().min(0).max(1e7),
    leadDays: z.number().int().min(0).max(365).default(0),
  })
  .strict();
const itemPatch = z
  .object({
    unitPrice: z.number().min(0).max(1e7).optional(),
    leadDays: z.number().int().min(0).max(365).optional(),
    active: z.boolean().optional(),
  })
  .strict();
const orderBody = z
  .object({
    lines: z
      .array(z.object({ itemId: uuid, qty: z.number().positive().max(1e6) }).strict())
      .min(1)
      .max(30),
    businessUnit: z.string().trim().min(1).max(100),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();
const sourceBody = z
  .object({
    need: z.string().trim().min(3).max(300),
    quantity: z.number().positive().max(1e6),
    businessUnit: z.string().trim().min(1).max(100).optional(),
  })
  .strict();
const decisionBody = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT']),
    itemId: uuid.optional(),
    businessUnit: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export interface BuyingDeps extends GuardDeps {
  audit: AuditService;
}
const STAFF = [
  'REQUESTER',
  'PROCUREMENT',
  'DELEGATE',
  'EVALUATOR',
  'CHAIR',
  'LEGAL',
  'CONTRACT_MGR',
  'PROBITY',
  'FINANCE',
  'EXEC',
] as const;

export function registerBuying(app: FastifyInstance, p: string, d: BuyingDeps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);
  const svc = new IntakeService(d.clock, d.audit);
  const now = () => d.clock.now();

  /** Items from suppliers who are approved to supply now: sanctions clear and insurance not lapsed. */
  async function approved(tx: Tx, tenantId: string) {
    const rows = await tx
      .select({ i: catalogueItem, s: supplier })
      .from(catalogueItem)
      .innerJoin(supplier, eq(supplier.id, catalogueItem.supplierId))
      .where(and(eq(catalogueItem.tenantId, tenantId), eq(catalogueItem.active, true)))
      .orderBy(asc(catalogueItem.name));
    const ratings = await tx
      .select()
      .from(supplierRating)
      .where(
        and(eq(supplierRating.tenantId, tenantId), eq(supplierRating.direction, 'ENTERPRISE_RATES_SUPPLIER')),
      );
    return rows.map(({ i, s }) => {
      const mine = ratings.filter((r) => r.supplierId === s.id);
      const avg = mine.length ? mine.reduce((n, r) => n + Number(r.overall), 0) / mine.length : null;
      const ok = s.sanctionsStatus === 'CLEAR' && s.insuranceStatus !== 'EXPIRED';
      const c: Candidate = {
        itemId: i.id,
        sku: i.sku,
        name: i.name,
        category: i.category,
        supplierId: s.id,
        supplier: s.company,
        unit: i.unit,
        unitPrice: Number(i.unitPrice),
        leadDays: i.leadDays,
        standing: standingOf(avg, s.insuranceStatus),
      };
      return {
        c,
        ok,
        why: ok
          ? null
          : s.sanctionsStatus !== 'CLEAR'
            ? 'The supplier is on hold after screening'
            : 'The supplier has no current insurance',
        contractId: i.contractId,
      };
    });
  }

  reg('GET', '/catalogue');
  app.get(`${p}/catalogue`, { preHandler: guard(d, [...STAFF]) }, async (req) => {
    const a = req.auth!;
    const q = parse(
      z.object({ q: z.string().trim().max(100).optional(), category: z.string().trim().max(120).optional() }),
      req.query,
    );
    return withContext(d.database, a.ctx, async (tx) => {
      let list = await approved(tx, a.user.tenantId);
      if (q.category) list = list.filter((x) => x.c.category === q.category);
      if (q.q) {
        const hits = new Set(
          matching(
            q.q,
            list.map((x) => x.c),
          ).map((x) => x.itemId),
        );
        list = list.filter((x) => hits.has(x.c.itemId));
      }
      const all = await approved(tx, a.user.tenantId);
      return {
        categories: [...new Set(all.map((x) => x.c.category))].sort(),
        items: list.map((x) => ({
          ...x.c,
          orderable: x.ok,
          notOrderableBecause: x.why,
          fromContract: x.contractId !== null,
        })),
      };
    });
  });

  reg('POST', '/catalogue');
  app.post(`${p}/catalogue`, { preHandler: guard(d, ['PROCUREMENT']) }, async (req, reply) => {
    const a = req.auth!;
    const b = parse(itemBody, req.body);
    const out = await withContext(d.database, a.ctx, async (tx) => {
      const [s] = await tx
        .select()
        .from(supplier)
        .where(and(eq(supplier.id, b.supplierId), eq(supplier.tenantId, a.user.tenantId)));
      if (!s) throw new AppError(404, 'NOT_FOUND', 'Supplier not found');
      if (b.contractId) {
        const [c] = await tx
          .select()
          .from(contract)
          .where(
            and(
              eq(contract.id, b.contractId),
              eq(contract.supplierId, b.supplierId),
              eq(contract.status, 'EXECUTED'),
            ),
          );
        if (!c)
          throw new AppError(422, 'VALIDATION_FAILED', 'That is not a signed contract with this supplier', [
            { field: 'contractId', message: 'Choose a signed contract with this supplier' },
          ]);
      }
      const [dup] = await tx
        .select({ id: catalogueItem.id })
        .from(catalogueItem)
        .where(and(eq(catalogueItem.supplierId, b.supplierId), eq(catalogueItem.sku, b.sku)));
      if (dup) throw new AppError(409, 'CONFLICT', 'This supplier already has an item with that code');
      const [row] = await tx
        .insert(catalogueItem)
        .values({
          tenantId: a.user.tenantId,
          supplierId: b.supplierId,
          contractId: b.contractId ?? null,
          sku: b.sku,
          name: b.name,
          category: b.category,
          unit: b.unit,
          unitPrice: String(b.unitPrice),
          leadDays: b.leadDays,
          createdAt: now(),
        })
        .returning();
      await d.audit.record(tx, a.ctx, {
        action: 'catalogue.add',
        entityType: 'catalogue_item',
        entityId: row!.id,
        after: { sku: b.sku, supplier: s.company, unitPrice: b.unitPrice },
      });
      return { id: row!.id };
    });
    return reply.status(201).send(out);
  });

  reg('PATCH', '/catalogue/{id}');
  app.patch(`${p}/catalogue/:id`, { preHandler: guard(d, ['PROCUREMENT']) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(itemPatch, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const [it] = await tx
        .select()
        .from(catalogueItem)
        .where(and(eq(catalogueItem.id, id), eq(catalogueItem.tenantId, a.user.tenantId)));
      if (!it) throw new AppError(404, 'NOT_FOUND', 'Item not found');
      await tx
        .update(catalogueItem)
        .set({
          ...(b.unitPrice !== undefined ? { unitPrice: String(b.unitPrice) } : {}),
          ...(b.leadDays !== undefined ? { leadDays: b.leadDays } : {}),
          ...(b.active !== undefined ? { active: b.active } : {}),
        })
        .where(eq(catalogueItem.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'catalogue.update',
        entityType: 'catalogue_item',
        entityId: id,
        before: { unitPrice: Number(it.unitPrice), active: it.active },
        after: b,
      });
      return { id, ...b };
    });
  });

  /** A draft request filled in from what was chosen, for the person to look over and submit (the usual budget check and approvals follow). */
  async function draftFrom(
    tx: Tx,
    a: AuthContext,
    lines: Array<{ c: Candidate; qty: number }>,
    businessUnit: string,
    reason: string,
  ) {
    const total = r2(lines.reduce((n, l) => n + l.c.unitPrice * l.qty, 0));
    const first = lines[0]!;
    const row = await svc.createDraft(tx, a.ctx);
    const [t] = await tx.select({ config: tenant.config }).from(tenant).where(eq(tenant.id, a.user.tenantId));
    const list = lines
      .map((l) => `${l.qty} ${l.c.unit} of ${l.c.name} from ${l.c.supplier} at ${l.c.unitPrice} each`)
      .join('; ');
    await svc.applyChanges(
      tx,
      a.ctx,
      row.id,
      [
        {
          key: 'title',
          value:
            `Catalogue purchase: ${first.c.name}${lines.length > 1 ? ` and ${lines.length - 1} more` : ''}`.slice(
              0,
              200,
            ),
        },
        { key: 'category', value: first.c.category },
        { key: 'estimatedValue', value: String(total) },
        { key: 'termMonths', value: '1' },
        { key: 'businessUnit', value: businessUnit },
        { key: 'contractOwner', value: a.user.name },
        { key: 'background', value: `${reason} Bought from the approved catalogue: ${list}.` },
      ],
      'USER',
      (t?.config ?? {}) as never,
    );
    return { requestId: row.id, total };
  }

  reg('POST', '/buying/orders');
  app.post(
    `${p}/buying/orders`,
    { preHandler: guard(d, ['REQUESTER', 'PROCUREMENT']) },
    async (req, reply) => {
      const a = req.auth!;
      const b = parse(orderBody, req.body);
      const out = await withContext(d.database, a.ctx, async (tx) => {
        const s = await loadSettings(tx, a.user.tenantId);
        if (!s.buying.enabled)
          throw new AppError(409, 'INVALID_STATE', 'Guided buying is switched off for this organisation');
        const all = new Map((await approved(tx, a.user.tenantId)).map((x) => [x.c.itemId, x]));
        const lines = b.lines.map((l) => {
          const x = all.get(l.itemId);
          if (!x) throw new AppError(404, 'NOT_FOUND', 'One of those items is no longer in the catalogue');
          if (!x.ok) throw new AppError(409, 'SUPPLIER_NOT_APPROVED', `${x.c.name}: ${x.why}`);
          return { c: x.c, qty: l.qty };
        });
        const r = await draftFrom(tx, a, lines, b.businessUnit, b.reason ?? 'A purchase of everyday goods.');
        await d.audit.record(tx, a.ctx, {
          action: 'buying.order_draft',
          entityType: 'request',
          entityId: r.requestId,
          after: { lines: lines.length, total: r.total },
        });
        return {
          requestId: r.requestId,
          total: r.total,
          next: 'Open the draft, check it and submit it. The budget check and any approvals follow as usual.',
        };
      });
      return reply.status(201).send(out);
    },
  );

  const propView = (r: typeof sourcingProposal.$inferSelect, limit: number) => {
    const shortlist = r.shortlist as Scored[];
    return {
      id: r.id,
      need: r.need,
      quantity: Number(r.quantity),
      status: r.status,
      shortlist,
      recommendedItemId: r.recommendedItemId,
      total: r.total === null ? null : Number(r.total),
      requestId: r.requestId,
      withinLimit: r.total === null ? null : Number(r.total) <= limit,
      limit,
      model: BUY_MODEL,
      createdAt: r.createdAt.toISOString(),
    };
  };

  reg('POST', '/buying/auto-source');
  app.post(
    `${p}/buying/auto-source`,
    { preHandler: guard(d, ['REQUESTER', 'PROCUREMENT']) },
    async (req, reply) => {
      const a = req.auth!;
      const b = parse(sourceBody, req.body);
      const out = await withContext(d.database, a.ctx, async (tx) => {
        const s = await loadSettings(tx, a.user.tenantId);
        if (!s.buying.enabled)
          throw new AppError(409, 'INVALID_STATE', 'Guided buying is switched off for this organisation');
        const pool = (await approved(tx, a.user.tenantId)).filter((x) => x.ok).map((x) => x.c);
        const shortlist = scoreCandidates(matching(b.need, pool), b.quantity).slice(0, 3);
        const best = shortlist[0];
        const [row] = await tx
          .insert(sourcingProposal)
          .values({
            tenantId: a.user.tenantId,
            requesterId: a.user.id,
            need: b.need,
            category: best?.category ?? null,
            quantity: String(b.quantity),
            status: best ? 'PROPOSED' : 'NO_MATCH',
            shortlist,
            recommendedItemId: best?.itemId ?? null,
            total: best ? String(best.total) : null,
            createdAt: now(),
          })
          .returning();
        await d.audit.record(tx, a.ctx, {
          action: 'buying.propose',
          entityType: 'sourcing_proposal',
          entityId: row!.id,
          after: {
            need: b.need,
            candidates: shortlist.length,
            recommended: best?.sku ?? null,
            total: best?.total ?? null,
          },
        });
        return propView(row!, s.buying.autoSourceLimitAud);
      });
      return reply.status(201).send(out);
    },
  );

  reg('GET', '/buying/proposals');
  app.get(`${p}/buying/proposals`, { preHandler: guard(d, ['REQUESTER', 'PROCUREMENT']) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const s = await loadSettings(tx, a.user.tenantId);
      const rows = await tx
        .select()
        .from(sourcingProposal)
        .where(and(eq(sourcingProposal.tenantId, a.user.tenantId)))
        .orderBy(desc(sourcingProposal.createdAt))
        .limit(50);
      const mine = a.user.roles.includes('PROCUREMENT')
        ? rows
        : rows.filter((r) => r.requesterId === a.user.id);
      return mine.map((r) => propView(r, s.buying.autoSourceLimitAud));
    });
  });

  reg('POST', '/buying/proposals/{id}/decision');
  app.post(
    `${p}/buying/proposals/:id/decision`,
    { preHandler: guard(d, ['REQUESTER', 'PROCUREMENT']) },
    async (req) => {
      const a = req.auth!;
      const { id } = parse(z.object({ id: uuid }), req.params);
      const b = parse(decisionBody, req.body);
      return withContext(d.database, a.ctx, async (tx) => {
        const s = await loadSettings(tx, a.user.tenantId);
        const [r] = await tx
          .select()
          .from(sourcingProposal)
          .where(and(eq(sourcingProposal.id, id), eq(sourcingProposal.tenantId, a.user.tenantId)));
        if (!r || (r.requesterId !== a.user.id && !a.user.roles.includes('PROCUREMENT')))
          throw new AppError(404, 'NOT_FOUND', 'Proposal not found');
        if (r.status !== 'PROPOSED')
          throw new AppError(409, 'INVALID_STATE', 'That proposal has already been decided');
        if (b.decision === 'REJECT') {
          await tx
            .update(sourcingProposal)
            .set({ status: 'REJECTED', decidedBy: a.user.id, decidedAt: now() })
            .where(eq(sourcingProposal.id, id));
          await d.audit.record(tx, a.ctx, {
            action: 'buying.reject',
            entityType: 'sourcing_proposal',
            entityId: id,
          });
          return propView(
            (await tx.select().from(sourcingProposal).where(eq(sourcingProposal.id, id)))[0]!,
            s.buying.autoSourceLimitAud,
          );
        }
        const shortlist = r.shortlist as Scored[];
        const pick = shortlist.find((x) => x.itemId === (b.itemId ?? r.recommendedItemId));
        if (!pick)
          throw new AppError(422, 'VALIDATION_FAILED', 'Choose one of the shortlisted items', [
            { field: 'itemId', message: 'Pick an item from the shortlist' },
          ]);
        if (pick.total > s.buying.autoSourceLimitAud)
          throw new AppError(
            409,
            'OVER_LIMIT',
            `This purchase is ${pick.total.toLocaleString('en-AU')}, over the ${s.buying.autoSourceLimitAud.toLocaleString('en-AU')} the platform may draft on its own. Raise a full request so procurement can run it.`,
          );
        // the supplier must still be approved on the day the person decides
        const live = (await approved(tx, a.user.tenantId)).find((x) => x.c.itemId === pick.itemId);
        if (!live || !live.ok)
          throw new AppError(409, 'SUPPLIER_NOT_APPROVED', 'That supplier is no longer approved to supply');
        const bu = b.businessUnit ?? 'Facilities';
        const r2d = await draftFrom(
          tx,
          a,
          [{ c: live.c, qty: Number(r.quantity) }],
          bu,
          `Recommended by the platform for: ${r.need}.`,
        );
        await tx
          .update(sourcingProposal)
          .set({
            status: 'ORDERED',
            recommendedItemId: pick.itemId,
            requestId: r2d.requestId,
            decidedBy: a.user.id,
            decidedAt: now(),
          })
          .where(eq(sourcingProposal.id, id));
        await d.audit.record(tx, a.ctx, {
          action: 'buying.approve',
          entityType: 'sourcing_proposal',
          entityId: id,
          after: { sku: pick.sku, total: pick.total, requestId: r2d.requestId },
        });
        return propView(
          (await tx.select().from(sourcingProposal).where(eq(sourcingProposal.id, id)))[0]!,
          s.buying.autoSourceLimitAud,
        );
      });
    },
  );
  return done;
}
