/**
 * Collaboration and AI authoring, roadmap batch B6: layout designers for the plan, the tender pack and the evaluation
 * report; concurrent editing with presence; tracked changes, saved versions, comparison and a digest of what changed;
 * the draft risk assessment; summaries of supplier responses; the reference content corpus; moving a procurement on in
 * plain language, and detecting that a phase is complete.
 */
import { and, asc, desc, eq, gte, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Clock, RoleName } from '@if/shared';
import type { AuditService } from '../../audit/audit-service.js';
import { guard, type AuthContext, type GuardDeps } from '../../auth/guard.js';
import { withContext, type Tx } from '../../db/client.js';
import {
  appUser,
  bidPricing,
  documentVersion,
  documentView,
  editPresence,
  evaluation,
  fieldHistory,
  fieldValue,
  layoutTemplate,
  panelMember,
  plan,
  referenceContent,
  request,
  riskAssessment,
  riskItem,
  submission,
  supplier,
  tender,
  tenderDeviation,
  complianceCheck,
} from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { stepsFor } from '../reporting/scope.js';
import { loadSettings } from '../settings/settings.js';
import {
  B6_MODEL,
  PHASE_ORDER,
  applyLayout,
  candidateRisks,
  catalog,
  defaultLayout,
  generateReference,
  parseAdvance,
  riskRating,
  summariseChanges,
  validateLayout,
  wordDiff,
  type FieldChange,
  type LayoutEntry,
  type LayoutKind,
} from '../reporting/b6-rules.js';

export interface CollabDeps extends GuardDeps {
  clock: Clock;
  audit: AuditService;
}

const uuid = z.string().uuid();
const KINDS = ['PLAN', 'RFX', 'REPORT'] as const;
const DOC_TYPES = {
  request: 'REQUEST',
  plan: 'PLAN',
  tender: 'TENDER',
  report: 'EVAL_REPORT',
  contract: 'CONTRACT',
} as const;
type DocType = keyof typeof DOC_TYPES;
type Owner = (typeof DOC_TYPES)[DocType];
const DOC_ROLES: RoleName[] = [
  'REQUESTER',
  'PROCUREMENT',
  'DELEGATE',
  'LEGAL',
  'EXEC',
  'PROBITY',
  'FINANCE',
  'CONTRACT_MGR',
];
const PRESENCE_SECONDS = 60;

const layoutBody = z
  .object({
    name: z.string().trim().min(2).max(120),
    sections: z
      .array(z.object({ key: z.string().max(40), enabled: z.boolean() }).strict())
      .min(1)
      .max(40),
  })
  .strict();
const presenceBody = z.object({ fieldKey: z.string().max(40).optional() }).strict();
const versionBody = z.object({ label: z.string().trim().min(2).max(120) }).strict();
const riskPatch = z
  .object({
    applicable: z.boolean().optional(),
    likelihood: z.number().int().min(1).max(5).optional(),
    impact: z.number().int().min(1).max(5).optional(),
    mitigation: z.string().trim().min(5).max(500).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to change' });
const advanceBody = z.object({ instruction: z.string().trim().min(3).max(300) }).strict();

/** The layout a tenant has designed for a kind of document, or null where the system default applies. */
export async function loadLayout(tx: Tx, tenantId: string, kind: LayoutKind): Promise<LayoutEntry[] | null> {
  const [row] = await tx
    .select()
    .from(layoutTemplate)
    .where(and(eq(layoutTemplate.tenantId, tenantId), eq(layoutTemplate.kind, kind)));
  return row ? (row.sections as LayoutEntry[]) : null;
}
export { applyLayout };

/** A field edited by someone else since this person loaded it: say who, when and what it says now. */
export async function fieldConflict(tx: Tx, key: string, row: typeof fieldValue.$inferSelect | undefined) {
  const [who] = row?.updatedBy
    ? await tx.select({ name: appUser.name }).from(appUser).where(eq(appUser.id, row.updatedBy))
    : [];
  return new AppError(
    409,
    'FIELD_CHANGED',
    `Someone else changed this section${who ? ` (${who.name})` : ''} while you were editing it`,
    [
      {
        field: key,
        message: `It now reads: "${(row?.value ?? '').slice(0, 160)}". Review it and apply your change again (revision ${row?.rev ?? 0}).`,
      },
    ],
  );
}

export function registerCollabRoutes(app: FastifyInstance, p: string, d: CollabDeps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);
  const now = () => d.clock.now();

  // ---------------------------------------------------------------- layout designers (FR-0085, FR-0115, FR-0365)
  const layoutView = async (tx: Tx, tenantId: string, kind: LayoutKind) => {
    const [row] = await tx
      .select()
      .from(layoutTemplate)
      .where(and(eq(layoutTemplate.tenantId, tenantId), eq(layoutTemplate.kind, kind)));
    const entries = (row?.sections as LayoutEntry[] | undefined) ?? defaultLayout(kind);
    const cat = catalog(kind);
    const listed = entries
      .map((e) => ({ ...cat.find((c) => c.key === e.key)!, enabled: e.enabled }))
      .filter((e) => e.key);
    const missing = cat
      .filter((c) => !entries.some((e) => e.key === c.key))
      .map((c) => ({ ...c, enabled: false }));
    return {
      kind,
      name: row?.name ?? 'System default',
      isDefault: !row,
      sections: [...listed, ...missing],
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  };

  reg('GET', '/layouts');
  app.get(
    `${p}/layouts`,
    { preHandler: guard(d, ['ADMIN', 'PROCUREMENT', 'LEGAL', 'DELEGATE', 'EXEC']) },
    async (req) => {
      const a = req.auth!;
      return withContext(d.database, a.ctx, async (tx) => {
        const out = [];
        for (const k of KINDS) out.push(await layoutView(tx, a.user.tenantId, k));
        return out;
      });
    },
  );

  reg('PUT', '/layouts/{kind}');
  app.put(`${p}/layouts/:kind`, { preHandler: guard(d, ['ADMIN', 'PROCUREMENT']) }, async (req) => {
    const a = req.auth!;
    const { kind } = parse(z.object({ kind: z.enum(KINDS) }), req.params);
    const body = parse(layoutBody, req.body);
    const problems = validateLayout(kind, body.sections);
    if (problems.length)
      throw new AppError(
        422,
        'LAYOUT_INVALID',
        'That layout cannot be saved',
        problems.map((m) => ({ field: 'sections', message: m })),
      );
    return withContext(d.database, a.ctx, async (tx) => {
      const before = await layoutView(tx, a.user.tenantId, kind);
      await tx
        .insert(layoutTemplate)
        .values({
          tenantId: a.user.tenantId,
          kind,
          name: body.name,
          sections: body.sections,
          updatedBy: a.user.id,
          updatedAt: now(),
        })
        .onConflictDoUpdate({
          target: [layoutTemplate.tenantId, layoutTemplate.kind],
          set: { name: body.name, sections: body.sections, updatedBy: a.user.id, updatedAt: now() },
        });
      await d.audit.record(tx, a.ctx, {
        action: 'layout.save',
        entityType: 'tenant',
        entityId: a.user.tenantId,
        before: { kind, order: before.sections.map((s) => `${s.key}${s.enabled ? '' : ':off'}`) },
        after: {
          kind,
          name: body.name,
          order: body.sections.map((s) => `${s.key}${s.enabled ? '' : ':off'}`),
        },
      });
      return layoutView(tx, a.user.tenantId, kind);
    });
  });

  reg('DELETE', '/layouts/{kind}');
  app.delete(`${p}/layouts/:kind`, { preHandler: guard(d, ['ADMIN', 'PROCUREMENT']) }, async (req) => {
    const a = req.auth!;
    const { kind } = parse(z.object({ kind: z.enum(KINDS) }), req.params);
    return withContext(d.database, a.ctx, async (tx) => {
      await tx
        .delete(layoutTemplate)
        .where(and(eq(layoutTemplate.tenantId, a.user.tenantId), eq(layoutTemplate.kind, kind)));
      await d.audit.record(tx, a.ctx, {
        action: 'layout.reset',
        entityType: 'tenant',
        entityId: a.user.tenantId,
        after: { kind },
      });
      return layoutView(tx, a.user.tenantId, kind);
    });
  });

  // ---------------------------------------------------------------- documents: presence, changes, versions (FR-0735, FR-0740)
  const dparams = z.object({ type: z.enum(Object.keys(DOC_TYPES) as [DocType, ...DocType[]]), id: uuid });
  async function docAccess(tx: Tx, a: AuthContext, type: DocType, id: string) {
    const ownerType = DOC_TYPES[type];
    const [any] = await tx
      .select({ id: fieldValue.id })
      .from(fieldValue)
      .where(
        and(
          eq(fieldValue.tenantId, a.user.tenantId),
          eq(fieldValue.ownerType, ownerType),
          eq(fieldValue.ownerId, id),
        ),
      )
      .limit(1);
    if (!any) throw new AppError(404, 'NOT_FOUND', 'Document not found');
    if (a.user.roles.length === 1 && a.user.roles[0] === 'REQUESTER') {
      let requestId: string | null = null;
      if (type === 'request') requestId = id;
      else if (type === 'plan')
        requestId = (await tx.select({ r: plan.requestId }).from(plan).where(eq(plan.id, id)))[0]?.r ?? null;
      else if (type === 'tender')
        requestId =
          (await tx.select({ r: tender.requestId }).from(tender).where(eq(tender.id, id)))[0]?.r ?? null;
      const [r] = requestId ? await tx.select().from(request).where(eq(request.id, requestId)) : [];
      if (!r || r.requesterId !== a.user.id) throw new AppError(404, 'NOT_FOUND', 'Document not found');
    }
    return ownerType;
  }
  const people = async (tx: Tx, tenantId: string) =>
    new Map(
      (
        await tx
          .select({ id: appUser.id, name: appUser.name })
          .from(appUser)
          .where(eq(appUser.tenantId, tenantId))
      ).map((u) => [u.id, u.name]),
    );

  reg('POST', '/documents/{type}/{id}/presence');
  app.post(`${p}/documents/:type/:id/presence`, { preHandler: guard(d, DOC_ROLES) }, async (req) => {
    const a = req.auth!;
    const { type, id } = parse(dparams, req.params);
    const body = parse(presenceBody, req.body ?? {});
    return withContext(d.database, a.ctx, async (tx) => {
      const ownerType = await docAccess(tx, a, type, id);
      await tx
        .insert(editPresence)
        .values({
          tenantId: a.user.tenantId,
          userId: a.user.id,
          ownerType,
          ownerId: id,
          fieldKey: body.fieldKey ?? null,
          at: now(),
        })
        .onConflictDoUpdate({
          target: [editPresence.userId, editPresence.ownerType, editPresence.ownerId],
          set: { fieldKey: body.fieldKey ?? null, at: now() },
        });
      return presenceOf(tx, a, ownerType, id);
    });
  });

  async function presenceOf(tx: Tx, a: AuthContext, ownerType: Owner, id: string) {
    const since = new Date(now().getTime() - PRESENCE_SECONDS * 1000);
    const rows = await tx
      .select({ e: editPresence, name: appUser.name })
      .from(editPresence)
      .innerJoin(appUser, eq(appUser.id, editPresence.userId))
      .where(
        and(eq(editPresence.ownerType, ownerType), eq(editPresence.ownerId, id), gte(editPresence.at, since)),
      );
    return {
      others: rows
        .filter((r) => r.e.userId !== a.user.id)
        .map((r) => ({ userId: r.e.userId, name: r.name, fieldKey: r.e.fieldKey, at: r.e.at.toISOString() })),
      windowSeconds: PRESENCE_SECONDS,
    };
  }

  reg('GET', '/documents/{type}/{id}/presence');
  app.get(`${p}/documents/:type/:id/presence`, { preHandler: guard(d, DOC_ROLES) }, async (req) => {
    const a = req.auth!;
    const { type, id } = parse(dparams, req.params);
    return withContext(d.database, a.ctx, async (tx) =>
      presenceOf(tx, a, await docAccess(tx, a, type, id), id),
    );
  });

  async function changesOf(
    tx: Tx,
    a: AuthContext,
    ownerType: Owner,
    id: string,
    since: Date | null,
  ): Promise<FieldChange[]> {
    const hist = await tx
      .select()
      .from(fieldHistory)
      .where(
        and(
          eq(fieldHistory.tenantId, a.user.tenantId),
          eq(fieldHistory.ownerType, ownerType),
          eq(fieldHistory.ownerId, id),
        ),
      )
      .orderBy(asc(fieldHistory.at), asc(fieldHistory.rev));
    const labels = new Map(
      (
        await tx
          .select({ k: fieldValue.key, l: fieldValue.label })
          .from(fieldValue)
          .where(and(eq(fieldValue.ownerType, ownerType), eq(fieldValue.ownerId, id)))
      ).map((r) => [r.k, r.l]),
    );
    const who = await people(tx, a.user.tenantId);
    const last = new Map<string, string>();
    const out: FieldChange[] = [];
    for (const h of hist) {
      if (h.key.includes('.')) continue;
      const before = last.get(h.key) ?? '';
      last.set(h.key, h.value ?? '');
      if (since && h.at <= since) continue;
      if (before === (h.value ?? '')) continue;
      out.push({
        key: h.key,
        label: labels.get(h.key) ?? h.key,
        before,
        after: h.value ?? '',
        by: h.changedBy ? (who.get(h.changedBy) ?? null) : null,
        at: h.at.toISOString(),
      });
    }
    return out;
  }

  reg('GET', '/documents/{type}/{id}/changes');
  app.get(`${p}/documents/:type/:id/changes`, { preHandler: guard(d, DOC_ROLES) }, async (req) => {
    const a = req.auth!;
    const { type, id } = parse(dparams, req.params);
    const q = parse(z.object({ since: z.string().datetime().optional() }), req.query);
    return withContext(d.database, a.ctx, async (tx) => {
      const ownerType = await docAccess(tx, a, type, id);
      const changes = await changesOf(tx, a, ownerType, id, q.since ? new Date(q.since) : null);
      return {
        changes: changes.map((c) => ({ ...c, diff: wordDiff(c.before, c.after) })),
        total: changes.length,
      };
    });
  });

  reg('GET', '/documents/{type}/{id}/summary');
  app.get(`${p}/documents/:type/:id/summary`, { preHandler: guard(d, DOC_ROLES) }, async (req) => {
    const a = req.auth!;
    const { type, id } = parse(dparams, req.params);
    const q = parse(z.object({ markSeen: z.enum(['true', 'false']).default('false') }), req.query);
    return withContext(d.database, a.ctx, async (tx) => {
      const ownerType = await docAccess(tx, a, type, id);
      const [seen] = await tx
        .select()
        .from(documentView)
        .where(
          and(
            eq(documentView.userId, a.user.id),
            eq(documentView.ownerType, ownerType),
            eq(documentView.ownerId, id),
          ),
        );
      const changes = await changesOf(tx, a, ownerType, id, seen?.viewedAt ?? null);
      if (q.markSeen === 'true')
        await tx
          .insert(documentView)
          .values({ tenantId: a.user.tenantId, userId: a.user.id, ownerType, ownerId: id, viewedAt: now() })
          .onConflictDoUpdate({
            target: [documentView.userId, documentView.ownerType, documentView.ownerId],
            set: { viewedAt: now() },
          });
      return {
        model: B6_MODEL,
        since: seen?.viewedAt.toISOString() ?? null,
        firstLook: !seen,
        summary: seen
          ? summariseChanges(changes)
          : `You have not opened this document before. ${summariseChanges(changes)}`,
        changes: changes.length,
      };
    });
  });

  const snapshotOf = async (tx: Tx, ownerType: Owner, id: string) => {
    const rows = await tx
      .select()
      .from(fieldValue)
      .where(and(eq(fieldValue.ownerType, ownerType), eq(fieldValue.ownerId, id)));
    return Object.fromEntries(
      rows.filter((r) => !r.key.includes('.')).map((r) => [r.key, { label: r.label, value: r.value ?? '' }]),
    );
  };

  reg('POST', '/documents/{type}/{id}/versions');
  app.post(`${p}/documents/:type/:id/versions`, { preHandler: guard(d, DOC_ROLES) }, async (req, reply) => {
    const a = req.auth!;
    const { type, id } = parse(dparams, req.params);
    const body = parse(versionBody, req.body);
    const out = await withContext(d.database, a.ctx, async (tx) => {
      const ownerType = await docAccess(tx, a, type, id);
      const existing = await tx
        .select({ n: documentVersion.number })
        .from(documentVersion)
        .where(and(eq(documentVersion.ownerType, ownerType), eq(documentVersion.ownerId, id)));
      const number = Math.max(0, ...existing.map((e) => e.n)) + 1;
      await tx.insert(documentVersion).values({
        tenantId: a.user.tenantId,
        ownerType,
        ownerId: id,
        number,
        label: body.label,
        snapshot: await snapshotOf(tx, ownerType, id),
        createdBy: a.user.id,
        createdAt: now(),
      });
      await d.audit.record(tx, a.ctx, {
        action: 'document.version_save',
        entityType: type,
        entityId: id,
        after: { number, label: body.label },
      });
      return { number, label: body.label };
    });
    return reply.status(201).send(out);
  });

  reg('GET', '/documents/{type}/{id}/versions');
  app.get(`${p}/documents/:type/:id/versions`, { preHandler: guard(d, DOC_ROLES) }, async (req) => {
    const a = req.auth!;
    const { type, id } = parse(dparams, req.params);
    return withContext(d.database, a.ctx, async (tx) => {
      const ownerType = await docAccess(tx, a, type, id);
      const rows = await tx
        .select({ v: documentVersion, by: appUser.name })
        .from(documentVersion)
        .innerJoin(appUser, eq(appUser.id, documentVersion.createdBy))
        .where(and(eq(documentVersion.ownerType, ownerType), eq(documentVersion.ownerId, id)))
        .orderBy(desc(documentVersion.number));
      return rows.map((r) => ({
        number: r.v.number,
        label: r.v.label,
        by: r.by,
        at: r.v.createdAt.toISOString(),
        fields: Object.keys(r.v.snapshot as object).length,
      }));
    });
  });

  reg('GET', '/documents/{type}/{id}/versions/{number}');
  app.get(`${p}/documents/:type/:id/versions/:number`, { preHandler: guard(d, DOC_ROLES) }, async (req) => {
    const a = req.auth!;
    const { type, id, number } = parse(
      dparams.extend({ number: z.coerce.number().int().min(1) }),
      req.params,
    );
    return withContext(d.database, a.ctx, async (tx) => {
      const ownerType = await docAccess(tx, a, type, id);
      const [v] = await tx
        .select()
        .from(documentVersion)
        .where(
          and(
            eq(documentVersion.ownerType, ownerType),
            eq(documentVersion.ownerId, id),
            eq(documentVersion.number, number),
          ),
        );
      if (!v) throw new AppError(404, 'NOT_FOUND', 'Version not found');
      return { number: v.number, label: v.label, at: v.createdAt.toISOString(), fields: v.snapshot };
    });
  });

  reg('GET', '/documents/{type}/{id}/compare');
  app.get(`${p}/documents/:type/:id/compare`, { preHandler: guard(d, DOC_ROLES) }, async (req) => {
    const a = req.auth!;
    const { type, id } = parse(dparams, req.params);
    const q = parse(
      z.object({
        from: z.coerce.number().int().min(1),
        to: z
          .string()
          .regex(/^(current|\d+)$/)
          .default('current'),
      }),
      req.query,
    );
    return withContext(d.database, a.ctx, async (tx) => {
      const ownerType = await docAccess(tx, a, type, id);
      const load = async (n: number | 'current') => {
        if (n === 'current')
          return (await snapshotOf(tx, ownerType, id)) as Record<string, { label: string; value: string }>;
        const [v] = await tx
          .select()
          .from(documentVersion)
          .where(
            and(
              eq(documentVersion.ownerType, ownerType),
              eq(documentVersion.ownerId, id),
              eq(documentVersion.number, n),
            ),
          );
        if (!v) throw new AppError(404, 'NOT_FOUND', `Version ${n} not found`);
        return v.snapshot as Record<string, { label: string; value: string }>;
      };
      const from = await load(q.from);
      const to = await load(q.to === 'current' ? 'current' : Number(q.to));
      const keys = [...new Set([...Object.keys(from), ...Object.keys(to)])];
      const fields = keys.map((k) => {
        const b = from[k]?.value ?? '';
        const c = to[k]?.value ?? '';
        const status = b === c ? 'SAME' : !from[k] ? 'ADDED' : !to[k] ? 'REMOVED' : 'CHANGED';
        return {
          key: k,
          label: to[k]?.label ?? from[k]?.label ?? k,
          status,
          ...(status === 'SAME' ? {} : { diff: wordDiff(b, c) }),
        };
      });
      return { from: q.from, to: q.to, changed: fields.filter((f) => f.status !== 'SAME').length, fields };
    });
  });

  // ---------------------------------------------------------------- draft risk assessment (FR-0755)
  async function reqAccess(tx: Tx, a: AuthContext, id: string) {
    const [r] = await tx
      .select()
      .from(request)
      .where(and(eq(request.id, id), eq(request.tenantId, a.user.tenantId)));
    if (!r || (a.user.roles.length === 1 && a.user.roles[0] === 'REQUESTER' && r.requesterId !== a.user.id))
      throw new AppError(404, 'NOT_FOUND', 'Request not found');
    return r;
  }
  const RISK_READERS: RoleName[] = ['REQUESTER', 'PROCUREMENT', 'DELEGATE', 'EXEC', 'PROBITY', 'LEGAL'];
  const RISK_EDITORS: RoleName[] = ['REQUESTER', 'PROCUREMENT'];
  async function riskView(tx: Tx, requestId: string) {
    const [as] = await tx.select().from(riskAssessment).where(eq(riskAssessment.requestId, requestId));
    if (!as) return null;
    const items = await tx
      .select()
      .from(riskItem)
      .where(eq(riskItem.assessmentId, as.id))
      .orderBy(asc(riskItem.key));
    const rows = items.map((i) => {
      const rate = i.applicable ? riskRating(i.likelihood, i.impact) : null;
      return {
        key: i.key,
        title: i.title,
        description: i.description,
        applicable: i.applicable,
        likelihood: i.likelihood,
        impact: i.impact,
        score: rate?.score ?? null,
        level: rate?.level ?? null,
        options: i.options as string[],
        mitigation: i.mitigation,
      };
    });
    const prompts = rows.flatMap((r) =>
      r.applicable === null
        ? [`Decide whether "${r.title}" applies`]
        : r.applicable && (!r.likelihood || !r.impact)
          ? [`Rate the likelihood and impact of "${r.title}"`]
          : r.applicable && r.level && r.level !== 'LOW' && !r.mitigation
            ? [`Choose a treatment for "${r.title}" (${r.level.toLowerCase()})`]
            : [],
    );
    return {
      id: as.id,
      model: B6_MODEL,
      basis: as.basis,
      generatedAt: as.generatedAt.toISOString(),
      completedAt: as.completedAt?.toISOString() ?? null,
      items: rows,
      prompts,
      complete: !!as.completedAt,
    };
  }

  reg('POST', '/requests/{id}/risk-assessment/generate');
  app.post(
    `${p}/requests/:id/risk-assessment/generate`,
    { preHandler: guard(d, RISK_EDITORS) },
    async (req, reply) => {
      const a = req.auth!;
      const { id } = parse(z.object({ id: uuid }), req.params);
      const out = await withContext(d.database, a.ctx, async (tx) => {
        const r = await reqAccess(tx, a, id);
        const [exists] = await tx
          .select({ id: riskAssessment.id })
          .from(riskAssessment)
          .where(eq(riskAssessment.requestId, id));
        if (exists)
          throw new AppError(409, 'ASSESSMENT_EXISTS', 'This procurement already has a risk assessment');
        const fields = await tx
          .select()
          .from(fieldValue)
          .where(and(eq(fieldValue.ownerType, 'REQUEST'), eq(fieldValue.ownerId, id)));
        const text = fields.map((f) => f.value ?? '').join(' ');
        const cands = candidateRisks({
          category: r.category ?? '',
          value: Number(r.estimatedValue ?? 0),
          termMonths: r.termMonths ?? 12,
          complexity: r.complexity,
          workflow: r.workflowId,
          text: `${r.title} ${text}`,
        });
        const basis = `${r.workflowId ?? 'standard'} workflow, ${r.category ?? 'no category'}, estimated ${Number(r.estimatedValue ?? 0)} AUD over ${r.termMonths ?? 12} months`;
        const [as] = await tx
          .insert(riskAssessment)
          .values({
            tenantId: a.user.tenantId,
            requestId: id,
            basis,
            generatedAt: now(),
            generatedBy: a.user.id,
          })
          .returning();
        for (const c of cands)
          await tx.insert(riskItem).values({
            tenantId: a.user.tenantId,
            assessmentId: as!.id,
            key: c.key,
            title: c.title,
            description: c.description,
            options: c.options,
          });
        await d.audit.record(tx, a.ctx, {
          action: 'risk.generate',
          entityType: 'request',
          entityId: id,
          after: { model: B6_MODEL, candidates: cands.length },
        });
        return riskView(tx, id);
      });
      return reply.status(201).send(out);
    },
  );

  reg('GET', '/requests/{id}/risk-assessment');
  app.get(`${p}/requests/:id/risk-assessment`, { preHandler: guard(d, RISK_READERS) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    return withContext(d.database, a.ctx, async (tx) => {
      await reqAccess(tx, a, id);
      const v = await riskView(tx, id);
      if (!v) throw new AppError(404, 'NOT_FOUND', 'No risk assessment has been drafted yet');
      return { ...v, canEdit: a.user.roles.some((r) => RISK_EDITORS.includes(r)) };
    });
  });

  reg('PATCH', '/requests/{id}/risk-assessment/items/{key}');
  app.patch(
    `${p}/requests/:id/risk-assessment/items/:key`,
    { preHandler: guard(d, RISK_EDITORS) },
    async (req) => {
      const a = req.auth!;
      const { id, key } = parse(z.object({ id: uuid, key: z.string().max(40) }), req.params);
      const body = parse(riskPatch, req.body);
      return withContext(d.database, a.ctx, async (tx) => {
        await reqAccess(tx, a, id);
        const [as] = await tx.select().from(riskAssessment).where(eq(riskAssessment.requestId, id));
        if (!as) throw new AppError(404, 'NOT_FOUND', 'No risk assessment has been drafted yet');
        if (as.completedAt) throw new AppError(409, 'ASSESSMENT_COMPLETE', 'The assessment is complete');
        const [it] = await tx
          .select()
          .from(riskItem)
          .where(and(eq(riskItem.assessmentId, as.id), eq(riskItem.key, key)));
        if (!it) throw new AppError(404, 'NOT_FOUND', 'Risk not found');
        if (body.applicable === false && (it.likelihood || it.impact)) body.mitigation = undefined;
        await tx
          .update(riskItem)
          .set({
            ...(body.applicable !== undefined ? { applicable: body.applicable } : {}),
            ...(body.likelihood ? { likelihood: body.likelihood } : {}),
            ...(body.impact ? { impact: body.impact } : {}),
            ...(body.mitigation ? { mitigation: body.mitigation } : {}),
          })
          .where(eq(riskItem.id, it.id));
        await d.audit.record(tx, a.ctx, {
          action: 'risk.update',
          entityType: 'request',
          entityId: id,
          before: { key, applicable: it.applicable, likelihood: it.likelihood, impact: it.impact },
          after: { key, ...body },
        });
        return riskView(tx, id);
      });
    },
  );

  reg('POST', '/requests/{id}/risk-assessment/complete');
  app.post(
    `${p}/requests/:id/risk-assessment/complete`,
    { preHandler: guard(d, RISK_EDITORS) },
    async (req) => {
      const a = req.auth!;
      const { id } = parse(z.object({ id: uuid }), req.params);
      return withContext(d.database, a.ctx, async (tx) => {
        await reqAccess(tx, a, id);
        const v = await riskView(tx, id);
        if (!v) throw new AppError(404, 'NOT_FOUND', 'No risk assessment has been drafted yet');
        if (v.prompts.length)
          throw new AppError(
            422,
            'ASSESSMENT_INCOMPLETE',
            'Some risks still need a decision',
            v.prompts.map((m) => ({ field: 'items', message: m })),
          );
        await tx.update(riskAssessment).set({ completedAt: now() }).where(eq(riskAssessment.id, v.id));
        await d.audit.record(tx, a.ctx, {
          action: 'risk.complete',
          entityType: 'request',
          entityId: id,
          after: { applicable: v.items.filter((i) => i.applicable).length },
        });
        return riskView(tx, id);
      });
    },
  );

  // ---------------------------------------------------------------- summaries of supplier responses (FR-0760)
  reg('GET', '/tenders/{id}/response-summaries');
  app.get(
    `${p}/tenders/:id/response-summaries`,
    { preHandler: guard(d, ['PROCUREMENT', 'LEGAL', 'CHAIR', 'EVALUATOR']) },
    async (req) => {
      const a = req.auth!;
      const { id } = parse(z.object({ id: uuid }), req.params);
      return withContext(d.database, a.ctx, async (tx) => {
        const [t] = await tx
          .select()
          .from(tender)
          .where(and(eq(tender.id, id), eq(tender.tenantId, a.user.tenantId)));
        if (!t) throw new AppError(404, 'NOT_FOUND', 'Tender not found');
        if (!['CLOSED', 'EVALUATING', 'AWARDED'].includes(t.status))
          throw new AppError(409, 'TENDER_SEALED', 'Responses stay sealed until the tender closes');
        const named = a.user.roles.some((r) => r === 'PROCUREMENT' || r === 'LEGAL');
        if (!named) {
          const seat = await tx
            .select({ id: panelMember.id })
            .from(panelMember)
            .innerJoin(evaluation, eq(evaluation.id, panelMember.evaluationId))
            .where(and(eq(evaluation.tenderId, id), eq(panelMember.userId, a.user.id)));
          if (!seat.length) throw new AppError(404, 'NOT_FOUND', 'Tender not found');
        }
        const [req0] = await tx.select().from(request).where(eq(request.id, t.requestId));
        const subs = await tx
          .select()
          .from(submission)
          .where(and(eq(submission.tenderId, id), eq(submission.status, 'SUBMITTED')))
          .orderBy(asc(submission.supplierId));
        const sups = new Map(
          (await tx.select().from(supplier).where(eq(supplier.tenantId, a.user.tenantId))).map((s) => [
            s.id,
            s,
          ]),
        );
        const prices = subs.length
          ? await tx
              .select()
              .from(bidPricing)
              .where(
                inArray(
                  bidPricing.submissionId,
                  subs.map((s) => s.id),
                ),
              )
          : [];
        const devs = await tx.select().from(tenderDeviation).where(eq(tenderDeviation.tenderId, id));
        const comp = subs.length
          ? await tx
              .select()
              .from(complianceCheck)
              .where(
                inArray(
                  complianceCheck.supplierId,
                  subs.map((s) => s.supplierId),
                ),
              )
          : [];
        const est = Number(req0?.estimatedValue ?? 0);
        const tcos = prices.map((x) => Number(x.tco));
        const lo = tcos.length ? Math.min(...tcos) : null;
        const hi = tcos.length ? Math.max(...tcos) : null;
        const aud = new Intl.NumberFormat('en-AU', {
          style: 'currency',
          currency: 'AUD',
          maximumFractionDigits: 0,
        });
        const out = subs.map((s, i) => {
          const pr = prices.find((x) => x.submissionId === s.id);
          const sd = devs.filter((x) => x.supplierId === s.supplierId);
          const sup = sups.get(s.supplierId);
          const fails = comp.filter((c) => c.supplierId === s.supplierId && c.result === 'FAIL');
          const pros: string[] = [];
          const cons: string[] = [];
          if (pr && lo !== null && Number(pr.tco) === lo && tcos.length > 1)
            pros.push('Lowest total cost of ownership');
          if (pr && est > 0 && Number(pr.tco) <= est) pros.push('Within the approved estimate');
          if (sd.length === 0) pros.push('Accepts the tender terms without changes');
          if (sup && ['CURRENT', 'EXPIRING'].includes(sup.insuranceStatus)) pros.push('Insurance is current');
          if (pr && hi !== null && Number(pr.tco) === hi && tcos.length > 1)
            cons.push('Highest total cost of ownership');
          if (pr && est > 0 && Number(pr.tco) > est)
            cons.push(`Above the approved estimate by ${aud.format(Number(pr.tco) - est)}`);
          if (sd.length) cons.push(`Proposes ${sd.length} change(s) to the tender terms`);
          if (fails.length) cons.push(`${fails.length} compliance check(s) failed`);
          if (sup && sup.insuranceStatus === 'EXPIRED') cons.push('Insurance has expired');
          const early =
            t.closesAt && s.submittedAt
              ? Math.round((t.closesAt.getTime() - s.submittedAt.getTime()) / 86_400_000)
              : null;
          return {
            supplier: named ? (sup?.company ?? 'Unknown') : `Supplier ${String.fromCharCode(65 + i)}`,
            pricing: pr
              ? `Base price ${aud.format(Number(pr.basePrice))}, implementation ${aud.format(Number(pr.implementation))}, running ${aud.format(Number(pr.annualRunning))} a year for ${pr.years} year(s): total cost ${aud.format(Number(pr.tco))}.`
              : 'No pricing schedule was entered.',
            dates: s.submittedAt
              ? `Submitted ${s.submittedAt.toISOString().slice(0, 10)}${early !== null ? ` (${early} day(s) before closing)` : ''}.`
              : 'Not submitted.',
            variations: sd.length ? sd.map((x) => `${x.clauseRef}: ${x.proposal}`) : [],
            pros,
            cons,
          };
        });
        return {
          tenderId: id,
          model: B6_MODEL,
          named,
          summaries: out,
          note: 'Summaries are built from the pricing, dates and proposed changes the suppliers gave, by fixed rules that stand in for an AI model.',
        };
      });
    },
  );

  // ---------------------------------------------------------------- reference content corpus (FR-0765)
  async function refreshReference(
    tx: Tx,
    tenantId: string,
    at: Date,
    actor: { ctx: AuthContext['ctx'] } | null,
  ) {
    const last = await tx
      .select({ g: referenceContent.generation })
      .from(referenceContent)
      .where(eq(referenceContent.tenantId, tenantId));
    const generation = Math.max(0, ...last.map((x) => x.g)) + 1;
    const cats = [
      ...new Set(
        (await tx.select({ c: request.category }).from(request).where(eq(request.tenantId, tenantId)))
          .map((r) => (r.c ?? '').replace(/\s*\(.*\)\s*$/, '').trim())
          .filter(Boolean),
      ),
    ].slice(0, 6);
    const items = generateReference(cats.length ? cats : ['General'], generation);
    await tx.delete(referenceContent).where(eq(referenceContent.tenantId, tenantId));
    for (const i of items)
      await tx.insert(referenceContent).values({ tenantId, ...i, generation, generatedAt: at });
    await d.audit.record(tx, actor?.ctx ?? { tenantId, userId: null, role: 'SYSTEM' }, {
      action: 'reference.refresh',
      entityType: 'tenant',
      entityId: tenantId,
      after: {
        generation,
        variants: items.length,
        categories: cats.length,
        boundary: 'in-house, no external call',
      },
    });
    return { generation, variants: items.length };
  }

  reg('GET', '/reference-content');
  app.get(
    `${p}/reference-content`,
    { preHandler: guard(d, ['ADMIN', 'PROCUREMENT', 'LEGAL', 'REQUESTER']) },
    async (req) => {
      const a = req.auth!;
      const q = parse(
        z.object({
          kind: z.string().max(60).optional(),
          category: z.string().max(80).optional(),
          level: z.string().max(20).optional(),
        }),
        req.query,
      );
      return withContext(d.database, a.ctx, async (tx) => {
        const s = await loadSettings(tx, a.user.tenantId);
        let rows = await tx
          .select()
          .from(referenceContent)
          .where(eq(referenceContent.tenantId, a.user.tenantId));
        const age = rows[0] ? (now().getTime() - rows[0].generatedAt.getTime()) / 86_400_000 : Infinity;
        let refreshed = false;
        if (age >= s.dashboards.referenceRefreshDays) {
          await refreshReference(tx, a.user.tenantId, now(), null);
          rows = await tx
            .select()
            .from(referenceContent)
            .where(eq(referenceContent.tenantId, a.user.tenantId));
          refreshed = true;
        }
        const hit = rows.filter(
          (r) =>
            (!q.kind || r.kind === q.kind) &&
            (!q.category || r.category === q.category) &&
            (!q.level || r.level === q.level),
        );
        return {
          generation: rows[0]?.generation ?? 0,
          generatedAt: rows[0]?.generatedAt.toISOString() ?? null,
          refreshedNow: refreshed,
          refreshEveryDays: s.dashboards.referenceRefreshDays,
          total: hit.length,
          items: hit.slice(0, 100).map((r) => ({
            id: r.id,
            kind: r.kind,
            title: r.title,
            category: r.category,
            sector: r.sector,
            level: r.level,
            body: r.body,
          })),
          kinds: [...new Set(rows.map((r) => r.kind))],
          categories: [...new Set(rows.map((r) => r.category))],
        };
      });
    },
  );

  reg('POST', '/reference-content/refresh');
  app.post(
    `${p}/reference-content/refresh`,
    { preHandler: guard(d, ['ADMIN', 'PROCUREMENT']) },
    async (req, reply) => {
      const a = req.auth!;
      const out = await withContext(d.database, a.ctx, async (tx) =>
        refreshReference(tx, a.user.tenantId, now(), a),
      );
      return reply.status(201).send(out);
    },
  );

  // ---------------------------------------------------------------- moving a procurement on in plain language (FR-0770)
  const STEP_OF: Record<string, 'intake' | 'plan' | 'tender' | 'evaluation' | 'contract'> = {
    INTAKE: 'intake',
    PLAN: 'plan',
    TENDER: 'tender',
    EVALUATION: 'evaluation',
    CONTRACT_AWARD: 'contract',
  };
  const STEP_LABEL: Record<string, string> = {
    intake: 'the request is submitted',
    plan: 'the plan is approved and locked',
    tender: 'the tender has closed',
    evaluation: 'the evaluation report is approved',
    contract: 'the contract is executed',
  };

  /** The furthest phase the records support: a phase is complete only when its real record reached the end state. */
  async function detectPhase(tx: Tx, r: typeof request.$inferSelect) {
    const steps = (await stepsFor(tx, r.tenantId, [r])).get(r.id)!;
    let i = 0;
    while (i < 5 && steps[STEP_OF[PHASE_ORDER[i]!]!]) i++;
    return { steps, phase: PHASE_ORDER[i]! as string };
  }

  reg('POST', '/requests/{id}/advance');
  app.post(
    `${p}/requests/:id/advance`,
    { preHandler: guard(d, ['PROCUREMENT', 'EXEC', 'REQUESTER']) },
    async (req) => {
      const a = req.auth!;
      const { id } = parse(z.object({ id: uuid }), req.params);
      const body = parse(advanceBody, req.body);
      return withContext(d.database, a.ctx, async (tx) => {
        const r = await reqAccess(tx, a, id);
        const parsed = parseAdvance(body.instruction, r.phase);
        if ('error' in parsed)
          throw new AppError(422, 'INSTRUCTION_NOT_UNDERSTOOD', parsed.error, [
            { field: 'instruction', message: parsed.error },
          ]);
        const from = PHASE_ORDER.indexOf(r.phase as (typeof PHASE_ORDER)[number]);
        const to = PHASE_ORDER.indexOf(parsed.target as (typeof PHASE_ORDER)[number]);
        if (to <= from)
          throw new AppError(
            409,
            'NOT_FORWARD',
            `This procurement is already at ${r.phase.toLowerCase().replace('_', ' ')}; it can only move forward`,
          );
        const steps = (await stepsFor(tx, r.tenantId, [r])).get(r.id)!;
        const missing = PHASE_ORDER.slice(from, to)
          .filter((ph) => STEP_OF[ph] && !steps[STEP_OF[ph]!])
          .map(
            (ph) =>
              `${ph.toLowerCase().replace('_', ' ')} is not finished: ${STEP_LABEL[STEP_OF[ph]!]} first`,
          );
        if (missing.length)
          throw new AppError(
            409,
            'PHASE_NOT_COMPLETE',
            'The phase is not finished yet',
            missing.map((m) => ({ field: 'instruction', message: m })),
          );
        await tx
          .update(request)
          .set({ phase: parsed.target as never, updatedAt: now(), version: r.version + 1 })
          .where(eq(request.id, id));
        await d.audit.record(tx, a.ctx, {
          action: 'request.advance',
          entityType: 'request',
          entityId: id,
          before: { phase: r.phase },
          after: { phase: parsed.target, instruction: body.instruction, model: B6_MODEL },
        });
        return {
          id,
          from: r.phase,
          to: parsed.target,
          understood: `Move to ${parsed.target.toLowerCase().replace('_', ' ')}`,
        };
      });
    },
  );

  reg('POST', '/requests/{id}/phase/sync');
  app.post(
    `${p}/requests/:id/phase/sync`,
    { preHandler: guard(d, ['PROCUREMENT', 'EXEC', 'REQUESTER']) },
    async (req) => {
      const a = req.auth!;
      const { id } = parse(z.object({ id: uuid }), req.params);
      return withContext(d.database, a.ctx, async (tx) => {
        const r = await reqAccess(tx, a, id);
        const found = await syncOne(tx, r, a.ctx);
        return found;
      });
    },
  );

  async function syncOne(tx: Tx, r: typeof request.$inferSelect, ctx: AuthContext['ctx']) {
    if (r.status === 'DRAFT')
      return {
        id: r.id,
        from: r.phase,
        to: r.phase,
        advanced: false,
        reason: 'The request has not been submitted',
      };
    const found = await detectPhase(tx, r);
    const cur = PHASE_ORDER.indexOf(r.phase as (typeof PHASE_ORDER)[number]);
    const next = PHASE_ORDER.indexOf(found.phase as (typeof PHASE_ORDER)[number]);
    // work finished in a phase moves the tracker to the next one; a phase the records have not reached is never skipped to
    if (next <= cur || next > 5)
      return {
        id: r.id,
        from: r.phase,
        to: r.phase,
        advanced: false,
        reason: 'No later phase has been completed',
      };
    await tx
      .update(request)
      .set({ phase: found.phase as never, updatedAt: now(), version: r.version + 1 })
      .where(eq(request.id, r.id));
    await d.audit.record(tx, ctx, {
      action: 'request.phase_sync',
      entityType: 'request',
      entityId: r.id,
      before: { phase: r.phase },
      after: { phase: found.phase, steps: found.steps, model: B6_MODEL },
    });
    return {
      id: r.id,
      from: r.phase,
      to: found.phase,
      advanced: true,
      reason: 'The records show the earlier phase is complete',
    };
  }

  reg('POST', '/requests/phase-sync');
  app.post(`${p}/requests/phase-sync`, { preHandler: guard(d, ['PROCUREMENT', 'EXEC']) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(request)
        .where(and(eq(request.tenantId, a.user.tenantId)));
      const moved = [];
      for (const r of rows) {
        if (r.phase === 'CLOSED' || r.status === 'COMPLETE') continue;
        const x = await syncOne(tx, r, a.ctx);
        if (x.advanced) moved.push(x);
      }
      return { checked: rows.length, advanced: moved.length, moved };
    });
  });

  return done;
}
