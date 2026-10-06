/**
 * Notes taken during a supplier review (FR-0825) and an audit, risk and compliance register (FR-0855), with the white-label
 * name and colours the portal shows (FR-0855).
 */
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AuditService } from '../../audit/audit-service.js';
import { guard, type AuthContext, type GuardDeps } from '../../auth/guard.js';
import { withContext, withSystem, type Tx } from '../../db/client.js';
import {
  appUser,
  contract,
  contractHold,
  disclosureTask,
  evaluation,
  grcItem,
  invoice,
  notification,
  panelMember,
  reviewNote,
  submission,
  supplier,
  tender,
  tenant,
} from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { loadSettings } from '../settings/settings.js';

export interface NotesGrcDeps extends GuardDeps {
  audit: AuditService;
  defaultTenantSlug: string;
}
const uuid = z.string().uuid();

// ------------------------------------------------------------------ notes during a supplier review (FR-0825)
const NOTE_ROLES = [
  'PROCUREMENT',
  'LEGAL',
  'FINANCE',
  'EXEC',
  'CONTRACT_MGR',
  'PROBITY',
  'DELEGATE',
  'EVALUATOR',
  'CHAIR',
] as const;
/** Who can read a note its author shared with the team. */
const TEAM_READERS = ['PROCUREMENT', 'LEGAL', 'CHAIR', 'PROBITY', 'EXEC'];
const noteBody = z
  .object({
    supplierId: uuid,
    tenderId: uuid.optional(),
    text: z.string().trim().min(3).max(4000),
    visibility: z.enum(['PRIVATE', 'TEAM']).default('PRIVATE'),
  })
  .strict();

/** The suppliers a person may write about: panel members only the bidders on the evaluations they sit on. */
export async function noteTargets(tx: Tx, a: AuthContext) {
  const roles = a.user.roles;
  const wide = roles.some((r) =>
    ['PROCUREMENT', 'LEGAL', 'FINANCE', 'EXEC', 'CONTRACT_MGR', 'PROBITY', 'DELEGATE'].includes(r),
  );
  if (wide) {
    const list = await tx
      .select({ id: supplier.id, company: supplier.company })
      .from(supplier)
      .where(eq(supplier.tenantId, a.user.tenantId))
      .orderBy(asc(supplier.company));
    return list.map((s) => ({
      supplierId: s.id,
      company: s.company,
      tenders: [] as Array<{ id: string; title: string }>,
    }));
  }
  const seats = await tx
    .select({ tenderId: evaluation.tenderId })
    .from(panelMember)
    .innerJoin(evaluation, eq(evaluation.id, panelMember.evaluationId))
    .where(
      and(
        eq(panelMember.userId, a.user.id),
        ne(panelMember.coiState, 'REMOVED'),
        ne(panelMember.coiState, 'DECLARED_CONFLICT'),
      ),
    );
  if (!seats.length) return [];
  const subs = await tx
    .select({ supplierId: submission.supplierId, tenderId: submission.tenderId, company: supplier.company })
    .from(submission)
    .innerJoin(supplier, eq(supplier.id, submission.supplierId))
    .where(
      and(
        inArray(
          submission.tenderId,
          seats.map((s) => s.tenderId),
        ),
        eq(submission.status, 'SUBMITTED'),
      ),
    );
  const by = new Map<
    string,
    { supplierId: string; company: string; tenders: Array<{ id: string; title: string }> }
  >();
  for (const s of subs) {
    const e = by.get(s.supplierId) ?? { supplierId: s.supplierId, company: s.company, tenders: [] };
    e.tenders.push({ id: s.tenderId, title: '' });
    by.set(s.supplierId, e);
  }
  return [...by.values()];
}

// ------------------------------------------------------------------ the register (FR-0855)
const KINDS = ['RISK', 'AUDIT_FINDING', 'OBLIGATION'] as const;
const STATUSES = ['OPEN', 'IN_PROGRESS', 'MITIGATED', 'ACCEPTED', 'CLOSED'] as const;
const READ = ['PROBITY', 'EXEC', 'LEGAL', 'FINANCE', 'PROCUREMENT', 'CONTRACT_MGR', 'DELEGATE'] as const;
const WRITE = ['PROBITY', 'EXEC', 'LEGAL', 'PROCUREMENT', 'FINANCE'] as const;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-31');
const itemBody = z
  .object({
    kind: z.enum(KINDS),
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().max(4000).optional(),
    ownerId: uuid.optional(),
    likelihood: z.number().int().min(1).max(5).optional(),
    impact: z.number().int().min(1).max(5).optional(),
    dueOn: isoDate.optional(),
    reviewOn: isoDate.optional(),
    treatment: z.string().trim().max(2000).optional(),
    linkedType: z.enum(['request', 'contract', 'supplier']).optional(),
    linkedId: uuid.optional(),
  })
  .strict();
const patchBody = z
  .object({
    title: z.string().trim().min(3).max(200).optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    ownerId: uuid.nullable().optional(),
    likelihood: z.number().int().min(1).max(5).nullable().optional(),
    impact: z.number().int().min(1).max(5).nullable().optional(),
    status: z.enum(STATUSES).optional(),
    dueOn: isoDate.nullable().optional(),
    reviewOn: isoDate.nullable().optional(),
    treatment: z.string().trim().max(2000).nullable().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to change' });
const actionBody = z
  .object({ text: z.string().trim().min(3).max(500), ownerId: uuid.optional(), dueOn: isoDate.optional() })
  .strict();

export const ratingOf = (l: number | null, i: number | null) => (l && i ? l * i : null);
export const bandOf = (r: number | null) =>
  r === null ? null : r >= 15 ? 'HIGH' : r >= 8 ? 'MEDIUM' : 'LOW';
interface Action {
  id: string;
  text: string;
  ownerId: string | null;
  dueOn: string | null;
  doneAt: string | null;
}

export function registerNotesGrc(app: FastifyInstance, p: string, d: NotesGrcDeps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);
  const now = () => d.clock.now();
  const today = () => now().toISOString().slice(0, 10);

  // ---------------------------------------------------------------- notes
  reg('GET', '/notes/targets');
  app.get(`${p}/notes/targets`, { preHandler: guard(d, [...NOTE_ROLES]) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const t = await noteTargets(tx, a);
      const titles = t.some((x) => x.tenders.length)
        ? new Map(
            (
              await tx
                .select({
                  id: tender.id,
                  title: sql<string>`(select title from request where request.id = ${tender.requestId})`,
                })
                .from(tender)
                .where(eq(tender.tenantId, a.user.tenantId))
            ).map((x) => [x.id, x.title]),
          )
        : new Map<string, string>();
      return t.map((x) => ({
        ...x,
        tenders: x.tenders.map((y) => ({ id: y.id, title: titles.get(y.id) ?? '' })),
      }));
    });
  });

  reg('POST', '/notes');
  app.post(`${p}/notes`, { preHandler: guard(d, [...NOTE_ROLES]) }, async (req, reply) => {
    const a = req.auth!;
    const body = parse(noteBody, req.body);
    const out = await withContext(d.database, a.ctx, async (tx) => {
      const targets = await noteTargets(tx, a);
      const t = targets.find((x) => x.supplierId === body.supplierId);
      if (!t) throw new AppError(404, 'NOT_FOUND', 'You cannot write about that supplier');
      if (body.tenderId && t.tenders.length && !t.tenders.some((x) => x.id === body.tenderId))
        throw new AppError(404, 'NOT_FOUND', 'That supplier did not bid on a tender you assess');
      const [row] = await tx
        .insert(reviewNote)
        .values({
          tenantId: a.user.tenantId,
          authorId: a.user.id,
          supplierId: body.supplierId,
          tenderId: body.tenderId ?? null,
          text: body.text,
          visibility: body.visibility,
          createdAt: now(),
        })
        .returning();
      // the text of a note is never put in the audit trail: it is the author's working paper
      await d.audit.record(tx, a.ctx, {
        action: 'note.create',
        entityType: 'supplier',
        entityId: body.supplierId,
        after: { visibility: body.visibility, tenderId: body.tenderId ?? null, length: body.text.length },
      });
      return {
        id: row!.id,
        supplierId: row!.supplierId,
        text: row!.text,
        visibility: row!.visibility,
        at: row!.createdAt.toISOString(),
        mine: true,
      };
    });
    return reply.status(201).send(out);
  });

  reg('GET', '/notes');
  app.get(`${p}/notes`, { preHandler: guard(d, [...NOTE_ROLES]) }, async (req) => {
    const a = req.auth!;
    const q = parse(z.object({ supplierId: uuid.optional(), tenderId: uuid.optional() }), req.query);
    return withContext(d.database, a.ctx, async (tx) => {
      const canTeam = a.user.roles.some((r) => TEAM_READERS.includes(r));
      const rows = await tx
        .select({ n: reviewNote, by: appUser.name })
        .from(reviewNote)
        .innerJoin(appUser, eq(appUser.id, reviewNote.authorId))
        .where(
          and(
            eq(reviewNote.tenantId, a.user.tenantId),
            q.supplierId ? eq(reviewNote.supplierId, q.supplierId) : undefined,
            q.tenderId ? eq(reviewNote.tenderId, q.tenderId) : undefined,
            canTeam
              ? or(eq(reviewNote.authorId, a.user.id), eq(reviewNote.visibility, 'TEAM'))
              : eq(reviewNote.authorId, a.user.id),
          ),
        )
        .orderBy(desc(reviewNote.createdAt))
        .limit(200);
      const names = new Map(
        (
          await tx
            .select({ id: supplier.id, c: supplier.company })
            .from(supplier)
            .where(eq(supplier.tenantId, a.user.tenantId))
        ).map((x) => [x.id, x.c]),
      );
      return rows.map((r) => ({
        id: r.n.id,
        supplierId: r.n.supplierId,
        supplier: names.get(r.n.supplierId) ?? '',
        tenderId: r.n.tenderId,
        text: r.n.text,
        visibility: r.n.visibility,
        by: r.by,
        mine: r.n.authorId === a.user.id,
        at: r.n.createdAt.toISOString(),
      }));
    });
  });

  reg('DELETE', '/notes/{id}');
  app.delete(`${p}/notes/:id`, { preHandler: guard(d, [...NOTE_ROLES]) }, async (req, reply) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    await withContext(d.database, a.ctx, async (tx) => {
      const [n] = await tx
        .select()
        .from(reviewNote)
        .where(and(eq(reviewNote.id, id), eq(reviewNote.authorId, a.user.id)));
      if (!n) throw new AppError(404, 'NOT_FOUND', 'Note not found');
      await tx.delete(reviewNote).where(eq(reviewNote.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'note.delete',
        entityType: 'supplier',
        entityId: n.supplierId,
      });
    });
    return reply.status(204).send();
  });

  // ---------------------------------------------------------------- the register
  const view = (r: typeof grcItem.$inferSelect, names: Map<string, string>, t: string) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    description: r.description,
    owner: r.ownerId ? { id: r.ownerId, name: names.get(r.ownerId) ?? '' } : null,
    likelihood: r.likelihood,
    impact: r.impact,
    rating: r.rating,
    band: bandOf(r.rating),
    status: r.status,
    dueOn: r.dueOn,
    reviewOn: r.reviewOn,
    overdue: r.status !== 'CLOSED' && r.status !== 'ACCEPTED' && r.dueOn !== null && r.dueOn < t,
    reviewDue: r.status !== 'CLOSED' && r.reviewOn !== null && r.reviewOn <= t,
    source: r.source,
    linkedType: r.linkedType,
    linkedId: r.linkedId,
    treatment: r.treatment,
    actions: r.actions as Action[],
    updatedAt: r.updatedAt.toISOString(),
  });
  const namesOf = async (tx: Tx, tenantId: string) =>
    new Map(
      (
        await tx
          .select({ id: appUser.id, n: appUser.name })
          .from(appUser)
          .where(eq(appUser.tenantId, tenantId))
      ).map((u) => [u.id, u.n]),
    );

  reg('GET', '/grc/items');
  app.get(`${p}/grc/items`, { preHandler: guard(d, [...READ]) }, async (req) => {
    const a = req.auth!;
    const q = parse(
      z.object({
        kind: z.enum(KINDS).optional(),
        status: z.enum(STATUSES).optional(),
        q: z.string().trim().max(100).optional(),
      }),
      req.query,
    );
    return withContext(d.database, a.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(grcItem)
        .where(
          and(
            eq(grcItem.tenantId, a.user.tenantId),
            q.kind ? eq(grcItem.kind, q.kind) : undefined,
            q.status ? eq(grcItem.status, q.status) : undefined,
            q.q ? sql`${grcItem.title} ilike ${'%' + q.q + '%'}` : undefined,
          ),
        )
        .orderBy(desc(grcItem.rating), asc(grcItem.dueOn));
      const names = await namesOf(tx, a.user.tenantId);
      return rows.map((r) => view(r, names, today()));
    });
  });

  reg('POST', '/grc/items');
  app.post(`${p}/grc/items`, { preHandler: guard(d, [...WRITE]) }, async (req, reply) => {
    const a = req.auth!;
    const b = parse(itemBody, req.body);
    if (b.kind === 'RISK' && (!b.likelihood || !b.impact))
      throw new AppError(422, 'VALIDATION_FAILED', 'A risk needs a likelihood and an impact', [
        { field: 'likelihood', message: 'Rate the likelihood and the impact from 1 to 5' },
      ]);
    const out = await withContext(d.database, a.ctx, async (tx) => {
      const [r] = await tx
        .insert(grcItem)
        .values({
          tenantId: a.user.tenantId,
          kind: b.kind,
          title: b.title,
          description: b.description ?? null,
          ownerId: b.ownerId ?? a.user.id,
          likelihood: b.likelihood ?? null,
          impact: b.impact ?? null,
          rating: ratingOf(b.likelihood ?? null, b.impact ?? null),
          dueOn: b.dueOn ?? null,
          reviewOn: b.reviewOn ?? null,
          treatment: b.treatment ?? null,
          linkedType: b.linkedType ?? null,
          linkedId: b.linkedId ?? null,
          createdBy: a.user.id,
          createdAt: now(),
          updatedAt: now(),
        })
        .returning();
      await d.audit.record(tx, a.ctx, {
        action: 'grc.create',
        entityType: 'grc_item',
        entityId: r!.id,
        after: { kind: b.kind, title: b.title, rating: r!.rating },
      });
      return view(r!, await namesOf(tx, a.user.tenantId), today());
    });
    return reply.status(201).send(out);
  });

  const load = async (tx: Tx, a: AuthContext, id: string) => {
    const [r] = await tx
      .select()
      .from(grcItem)
      .where(and(eq(grcItem.id, id), eq(grcItem.tenantId, a.user.tenantId)));
    if (!r) throw new AppError(404, 'NOT_FOUND', 'Item not found');
    return r;
  };

  reg('PATCH', '/grc/items/{id}');
  app.patch(`${p}/grc/items/:id`, { preHandler: guard(d, [...WRITE]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(patchBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const r = await load(tx, a, id);
      const l = b.likelihood === undefined ? r.likelihood : b.likelihood;
      const i = b.impact === undefined ? r.impact : b.impact;
      const status = b.status ?? r.status;
      const treatment = b.treatment === undefined ? r.treatment : b.treatment;
      if (status === 'ACCEPTED' && (treatment ?? '').trim().length < 10)
        throw new AppError(422, 'VALIDATION_FAILED', 'Accepting an item needs the reason written down', [
          { field: 'treatment', message: 'Say why it is accepted, in at least 10 characters' },
        ]);
      if (r.kind === 'RISK' && (l === null || i === null))
        throw new AppError(422, 'VALIDATION_FAILED', 'A risk needs a likelihood and an impact', [
          { field: 'likelihood', message: 'Rate it from 1 to 5' },
        ]);
      const set: Partial<typeof grcItem.$inferInsert> = { updatedAt: now(), rating: ratingOf(l, i) };
      for (const k of [
        'title',
        'description',
        'ownerId',
        'likelihood',
        'impact',
        'status',
        'dueOn',
        'reviewOn',
        'treatment',
      ] as const)
        if (b[k] !== undefined) (set as Record<string, unknown>)[k] = b[k];
      if (status === 'CLOSED' && r.status !== 'CLOSED') set.closedAt = now();
      if (status !== 'CLOSED') set.closedAt = null;
      await tx.update(grcItem).set(set).where(eq(grcItem.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'grc.update',
        entityType: 'grc_item',
        entityId: id,
        before: { status: r.status, rating: r.rating },
        after: { status, rating: ratingOf(l, i) },
      });
      return view(await load(tx, a, id), await namesOf(tx, a.user.tenantId), today());
    });
  });

  reg('POST', '/grc/items/{id}/actions');
  app.post(`${p}/grc/items/:id/actions`, { preHandler: guard(d, [...WRITE]) }, async (req, reply) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(actionBody, req.body);
    const out = await withContext(d.database, a.ctx, async (tx) => {
      const r = await load(tx, a, id);
      const actions = [
        ...(r.actions as Action[]),
        {
          id: crypto.randomUUID(),
          text: b.text,
          ownerId: b.ownerId ?? null,
          dueOn: b.dueOn ?? null,
          doneAt: null,
        },
      ];
      await tx
        .update(grcItem)
        .set({ actions, updatedAt: now(), status: r.status === 'OPEN' ? 'IN_PROGRESS' : r.status })
        .where(eq(grcItem.id, id));
      if (b.ownerId && b.ownerId !== a.user.id)
        await tx.insert(notification).values({
          tenantId: a.user.tenantId,
          userId: b.ownerId,
          title: 'An action was assigned to you',
          body: `${r.title}: ${b.text}`,
          link: '/app/risk',
        });
      await d.audit.record(tx, a.ctx, {
        action: 'grc.action_add',
        entityType: 'grc_item',
        entityId: id,
        after: { text: b.text, ownerId: b.ownerId ?? null },
      });
      return view(await load(tx, a, id), await namesOf(tx, a.user.tenantId), today());
    });
    return reply.status(201).send(out);
  });

  reg('POST', '/grc/items/{id}/actions/{actionId}/complete');
  app.post(
    `${p}/grc/items/:id/actions/:actionId/complete`,
    { preHandler: guard(d, [...WRITE]) },
    async (req) => {
      const a = req.auth!;
      const { id, actionId } = parse(z.object({ id: uuid, actionId: uuid }), req.params);
      return withContext(d.database, a.ctx, async (tx) => {
        const r = await load(tx, a, id);
        const actions = r.actions as Action[];
        if (!actions.some((x) => x.id === actionId)) throw new AppError(404, 'NOT_FOUND', 'Action not found');
        const next = actions.map((x) =>
          x.id === actionId && !x.doneAt ? { ...x, doneAt: now().toISOString() } : x,
        );
        await tx.update(grcItem).set({ actions: next, updatedAt: now() }).where(eq(grcItem.id, id));
        await d.audit.record(tx, a.ctx, {
          action: 'grc.action_done',
          entityType: 'grc_item',
          entityId: id,
          after: { actionId },
        });
        return view(await load(tx, a, id), await namesOf(tx, a.user.tenantId), today());
      });
    },
  );

  reg('GET', '/grc/summary');
  app.get(`${p}/grc/summary`, { preHandler: guard(d, [...READ]) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const rows = await tx.select().from(grcItem).where(eq(grcItem.tenantId, a.user.tenantId));
      const t = today();
      const open = rows.filter((r) => r.status !== 'CLOSED');
      const heat = Array.from({ length: 5 }, (_, li) =>
        Array.from(
          { length: 5 },
          (_, ii) =>
            open.filter((r) => r.kind === 'RISK' && r.likelihood === 5 - li && r.impact === ii + 1).length,
        ),
      );
      return {
        open: open.length,
        byKind: KINDS.map((k) => ({ kind: k, open: open.filter((r) => r.kind === k).length })),
        high: open.filter((r) => bandOf(r.rating) === 'HIGH').length,
        overdue: open.filter((r) => r.status !== 'ACCEPTED' && r.dueOn !== null && r.dueOn < t).length,
        reviewsDue: open.filter((r) => r.reviewOn !== null && r.reviewOn <= t).length,
        // rows are likelihood 5 down to 1, columns impact 1 up to 5
        heatmap: { rows: [5, 4, 3, 2, 1], columns: [1, 2, 3, 4, 5], cells: heat },
      };
    });
  });

  /** Pulls in what the platform already knows is a risk or an obligation, once each, and closes what is no longer true. */
  reg('POST', '/grc/sync');
  app.post(`${p}/grc/sync`, { preHandler: guard(d, ['PROBITY', 'EXEC']) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const t = today();
      const signals = new Map<
        string,
        Omit<typeof grcItem.$inferInsert, 'tenantId' | 'createdAt' | 'updatedAt'>
      >();
      const sups = await tx.select().from(supplier).where(eq(supplier.tenantId, a.user.tenantId));
      for (const s of sups) {
        if (s.insuranceStatus === 'EXPIRED' || (s.insuranceExpiresOn && s.insuranceExpiresOn < t))
          signals.set(`insurance:${s.id}`, {
            kind: 'OBLIGATION',
            title: `Insurance cover has lapsed: ${s.company}`,
            description:
              'The supplier holds no current certificate. New purchase orders on its contracts are held until it provides one.',
            dueOn: t,
            linkedType: 'supplier',
            linkedId: s.id,
            source: 'PLATFORM',
            sourceKey: `insurance:${s.id}`,
          });
        if (s.sanctionsStatus === 'MATCH')
          signals.set(`sanctions:${s.id}`, {
            kind: 'RISK',
            title: `Sanctions screening match: ${s.company}`,
            description: 'The supplier matched a watchlist and is held until a review decides.',
            likelihood: 4,
            impact: 5,
            rating: 20,
            linkedType: 'supplier',
            linkedId: s.id,
            source: 'PLATFORM',
            sourceKey: `sanctions:${s.id}`,
          });
      }
      const tasks = await tx
        .select({ t: disclosureTask, n: contract.number })
        .from(disclosureTask)
        .innerJoin(contract, eq(contract.id, disclosureTask.contractId))
        .where(
          and(eq(disclosureTask.status, 'OPEN'), lt(disclosureTask.dueOn, t), isNull(contract.deletedAt)),
        );
      for (const x of tasks)
        signals.set(`disclosure:${x.t.id}`, {
          kind: 'OBLIGATION',
          title: `Statutory disclosure overdue: ${x.n}`,
          description: `Due on ${x.t.dueOn} on ${x.t.register}.`,
          dueOn: x.t.dueOn,
          linkedType: 'contract',
          linkedId: x.t.contractId,
          source: 'PLATFORM',
          sourceKey: `disclosure:${x.t.id}`,
        });
      const holds = await tx
        .select({ h: contractHold, n: contract.number })
        .from(contractHold)
        .innerJoin(contract, eq(contract.id, contractHold.contractId))
        .where(isNull(contractHold.releasedAt));
      for (const x of holds)
        signals.set(`hold:${x.h.id}`, {
          kind: 'OBLIGATION',
          title: `Contract on hold: ${x.n}`,
          description: 'A hold blocks new purchase orders until it is cleared.',
          linkedType: 'contract',
          linkedId: x.h.contractId,
          source: 'PLATFORM',
          sourceKey: `hold:${x.h.id}`,
        });
      const old = new Date(now().getTime() - 14 * 86_400_000).toISOString().slice(0, 10);
      const blocked = await tx
        .select()
        .from(invoice)
        .where(
          and(
            eq(invoice.tenantId, a.user.tenantId),
            eq(invoice.status, 'BLOCKED'),
            lt(invoice.invoiceDate, old),
          ),
        );
      for (const i of blocked)
        signals.set(`invoice:${i.id}`, {
          kind: 'AUDIT_FINDING',
          title: `Invoice blocked for over two weeks: ${i.number}`,
          description:
            'A blocked invoice that stays blocked is either an error to fix or a supplier to speak to.',
          linkedType: 'contract',
          linkedId: i.contractId,
          source: 'PLATFORM',
          sourceKey: `invoice:${i.id}`,
        });

      const existing = await tx
        .select()
        .from(grcItem)
        .where(and(eq(grcItem.tenantId, a.user.tenantId), isNotNull(grcItem.sourceKey)));
      const have = new Map(existing.map((e) => [e.sourceKey!, e]));
      let created = 0;
      let reopened = 0;
      let closed = 0;
      for (const [key, sig] of signals) {
        const cur = have.get(key);
        if (!cur) {
          await tx.insert(grcItem).values({
            ...sig,
            tenantId: a.user.tenantId,
            ownerId: a.user.id,
            createdBy: a.user.id,
            createdAt: now(),
            updatedAt: now(),
          });
          created += 1;
        } else if (cur.status === 'CLOSED') {
          await tx
            .update(grcItem)
            .set({ status: 'OPEN', closedAt: null, updatedAt: now() })
            .where(eq(grcItem.id, cur.id));
          reopened += 1;
        }
      }
      for (const [key, cur] of have)
        if (!signals.has(key) && cur.status !== 'CLOSED') {
          await tx
            .update(grcItem)
            .set({
              status: 'CLOSED',
              closedAt: now(),
              updatedAt: now(),
              treatment: cur.treatment ?? 'No longer raised by the platform.',
            })
            .where(eq(grcItem.id, cur.id));
          closed += 1;
        }
      await d.audit.record(tx, a.ctx, {
        action: 'grc.sync',
        entityType: 'tenant',
        entityId: a.user.tenantId,
        after: { created, reopened, closed, signals: signals.size },
      });
      return { created, reopened, closed, signals: signals.size };
    });
  });

  // ---------------------------------------------------------------- the name and colours the portal shows (FR-0855)
  reg('GET', '/branding');
  app.get(`${p}/branding`, { preHandler: guard(d, 'public') }, async () => {
    return withSystem(d.database, async (tx) => {
      const [t] = await tx.select().from(tenant).where(eq(tenant.slug, d.defaultTenantSlug));
      if (!t) return { productName: 'Intuitive Fusion', tagline: '', palette: 'INDIGO', supportEmail: '' };
      const s = await loadSettings(tx, t.id);
      return {
        productName: s.branding.productName,
        tagline: s.branding.tagline,
        palette: s.branding.palette,
        supportEmail: s.branding.supportEmail,
      };
    });
  });
  return done;
}
