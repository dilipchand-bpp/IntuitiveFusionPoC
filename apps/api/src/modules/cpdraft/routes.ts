/**
 * Procurement Copilot drafting routes (CP-04, CP-05): draft a request, plan, job specification, tender document, contract draft
 * or evaluation criteria from typed or dictated text; adjust it in plain language with a field-level before and after and undo;
 * apply it to the real record through the normal routes as the acting user; and suggest values for the fields of a record.
 * Deterministic and rules-based (rules-simulated-v1); every response says so.
 */
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { guard, type AuthContext, type GuardDeps } from '../../auth/guard.js';
import { withContext } from '../../db/client.js';
import { cpDraft, cpDraftRevision, DRAFT_KINDS, APPLY_TARGETS, type DraftKind } from '../../db/schema-cpb.js';
import { AppError, parse } from '../../http/errors.js';
import { flagContent } from '../b11priv/content-safety.js';
import { PLAN_FIELDS } from '../plan/fields.js';
import { TENDER_FIELD_BY_KEY, TENDER_FIELDS } from '../tender/fields.js';
import { ADJUST_EXAMPLES, adjustDoc } from './adjust.js';
import { generateDraft } from './generate.js';
import { ENGINE, diffDocs, type DraftDoc, type SourceRef } from './model.js';
import { requestSuggestions, sectionSuggestions } from './prepopulate.js';
import {
  DEFAULT_TARGET,
  RouteRefusal,
  callAs,
  catalogueFor,
  docxFor,
  gatherContext,
  historyFor,
  loadDraft,
  loadRevision,
  ok,
  recordApply,
  recordFromView,
  requestPayload,
  revisionView,
  sectionText,
  toAppError,
  viewOf,
  type Caller,
} from './service.js';

/** Who may draft. Applying is decided by the real routes, so this list only has to cover who can reach a record at all. */
const DRAFTERS = ['REQUESTER', 'PROCUREMENT', 'DELEGATE', 'LEGAL', 'CONTRACT_MGR', 'EXEC'] as const;
const uuid = z.string().uuid();
const idParam = z.object({ id: uuid });
const createBody = z
  .object({
    kind: z.enum(DRAFT_KINDS),
    text: z.string().trim().min(3).max(6000),
    procurementId: uuid.optional(),
    source: z.enum(['TEXT', 'VOICE']).default('TEXT'),
  })
  .strict();
const adjustBody = z
  .object({
    instruction: z.string().trim().min(1).max(1000),
    source: z.enum(['TEXT', 'VOICE']).default('TEXT'),
  })
  .strict();
const applyBody = z
  .object({
    target: z.enum(APPLY_TARGETS).optional(),
    procurementId: uuid.optional(),
    sections: z.array(z.string().max(40)).max(40).optional(),
    folder: z.enum(['Tender', 'Evaluation', 'Contract', 'General']).optional(),
    fileName: z.string().trim().min(3).max(100).optional(),
  })
  .strict();
const prepopBody = z
  .object({
    procurementId: uuid,
    stage: z.enum(['REQUEST', 'PLAN', 'TENDER']),
    text: z.string().trim().max(6000).optional(),
  })
  .strict();

const FOLDER_OF: Record<DraftKind, 'Tender' | 'Evaluation' | 'Contract' | 'General'> = {
  REQUEST: 'General',
  PLAN: 'General',
  JOB_SPEC: 'Tender',
  TENDER_DOC: 'Tender',
  CONTRACT_DRAFT: 'Contract',
  EVAL_CRITERIA: 'Evaluation',
};
const FILE_OF: Record<DraftKind, string> = {
  REQUEST: 'request-draft.docx',
  PLAN: 'plan-draft.docx',
  JOB_SPEC: 'job-specification.docx',
  TENDER_DOC: 'tender-document-draft.docx',
  CONTRACT_DRAFT: 'contract-draft.docx',
  EVAL_CRITERIA: 'evaluation-criteria.docx',
};

export function registerCpDraft(app: FastifyInstance, p: string, d: GuardDeps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);
  const caller = (req: FastifyRequest): Caller => ({ app, prefix: p, req });

  async function refusal(
    a: AuthContext,
    draftId: string,
    action: string,
    e: RouteRefusal,
    extra: Record<string, unknown> = {},
  ) {
    await d.audit.recordOutsideTx(d.database, a.ctx, {
      action,
      entityType: 'copilot_draft',
      entityId: draftId,
      result: 'DENIED',
      after: { status: e.status, code: e.code, via: 'Procurement Copilot', ...extra },
    });
  }

  // ------------------------------------------------------------------ create
  reg('POST', '/copilot/draft');
  app.post(
    `${p}/copilot/draft`,
    { preHandler: guard(d, [...DRAFTERS]), config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const a = req.auth!;
      const body = parse(createBody, req.body);
      const c = caller(req);
      let record;
      try {
        record = body.procurementId ? await recordFromView(c, body.procurementId) : undefined;
      } catch (e) {
        if (e instanceof RouteRefusal) throw toAppError(e);
        throw e;
      }
      const out = await withContext(d.database, a.ctx, async (tx) => {
        // SEC-AP08: instruction-like wording in the text is flagged for review; the draft is still worked out by fixed rules
        await flagContent(tx, a.user.tenantId, {
          source: 'COPILOT_DRAFT',
          entityType: 'copilot_draft',
          text: body.text,
          actorId: a.user.id,
        });
        const ctx = await gatherContext(tx, a.user.tenantId, body.text, record);
        const quick = generateDraft({
          kind: body.kind,
          text: body.text,
          today: d.clock.now(),
          organisation: ctx.organisation,
          record,
          knownSuppliers: ctx.knownSuppliers,
          templates: ctx.templates,
        });
        const cat = quick.doc.fields.category;
        const [history, catalogue] = await Promise.all([
          historyFor(tx, a.user.tenantId, cat, record?.id),
          catalogueFor(tx, a.user.tenantId, cat, body.text),
        ]);
        const g = generateDraft({
          kind: body.kind,
          text: body.text,
          today: d.clock.now(),
          organisation: ctx.organisation,
          record,
          history,
          catalogue,
          knownSuppliers: ctx.knownSuppliers,
          templates: ctx.templates,
        });
        const now = d.clock.now();
        const [row] = await tx
          .insert(cpDraft)
          .values({
            tenantId: a.user.tenantId,
            userId: a.user.id,
            kind: body.kind,
            source: body.source,
            procurementId: body.procurementId ?? null,
            inputText: body.text,
            engine: ENGINE,
            currentRevision: 1,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        const [rev] = await tx
          .insert(cpDraftRevision)
          .values({
            tenantId: a.user.tenantId,
            draftId: row!.id,
            revision: 1,
            parentRevision: null,
            action: 'GENERATE',
            instruction: null,
            summary: `Drafted from ${body.source === 'VOICE' ? 'dictated' : 'typed'} text`,
            doc: g.doc,
            sources: g.sources,
            diff: [],
            createdBy: a.user.id,
            createdAt: now,
          })
          .returning();
        await d.audit.record(tx, a.ctx, {
          action: 'copilot.draft_create',
          entityType: 'copilot_draft',
          entityId: row!.id,
          after: {
            kind: body.kind,
            source: body.source,
            procurementId: body.procurementId ?? null,
            engine: ENGINE,
            textLength: body.text.length,
            via: 'Procurement Copilot',
          },
        });
        return viewOf(row!, rev!);
      });
      return reply.status(201).send(out);
    },
  );

  // ------------------------------------------------------------------ list, read, revisions
  reg('GET', '/copilot/draft');
  app.get(`${p}/copilot/draft`, { preHandler: guard(d, [...DRAFTERS]) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(cpDraft)
        .where(and(eq(cpDraft.tenantId, a.user.tenantId), eq(cpDraft.userId, a.user.id)))
        .orderBy(desc(cpDraft.updatedAt))
        .limit(20);
      return rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        source: r.source,
        procurementId: r.procurementId,
        revision: r.currentRevision,
        preview: r.inputText.slice(0, 120),
        updatedAt: r.updatedAt.toISOString(),
      }));
    });
  });

  reg('GET', '/copilot/draft/{id}');
  app.get(`${p}/copilot/draft/:id`, { preHandler: guard(d, [...DRAFTERS]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(idParam, req.params);
    const q = parse(z.object({ revision: z.coerce.number().int().min(1).optional() }), req.query);
    return withContext(d.database, a.ctx, async (tx) => {
      const row = await loadDraft(tx, a, id);
      return viewOf(row, await loadRevision(tx, row, q.revision), { currentRevision: row.currentRevision });
    });
  });

  reg('GET', '/copilot/draft/{id}/revisions');
  app.get(`${p}/copilot/draft/:id/revisions`, { preHandler: guard(d, [...DRAFTERS]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(idParam, req.params);
    return withContext(d.database, a.ctx, async (tx) => {
      const row = await loadDraft(tx, a, id);
      const revs = await tx
        .select()
        .from(cpDraftRevision)
        .where(eq(cpDraftRevision.draftId, id))
        .orderBy(desc(cpDraftRevision.revision));
      return { id, currentRevision: row.currentRevision, revisions: revs.map(revisionView) };
    });
  });

  // ------------------------------------------------------------------ adjust and undo
  reg('POST', '/copilot/draft/{id}/adjust');
  app.post(`${p}/copilot/draft/:id/adjust`, { preHandler: guard(d, [...DRAFTERS]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(idParam, req.params);
    const body = parse(adjustBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const row = await loadDraft(tx, a, id);
      const cur = await loadRevision(tx, row);
      await flagContent(tx, a.user.tenantId, {
        source: 'COPILOT_DRAFT',
        entityType: 'copilot_draft',
        entityId: id,
        text: body.instruction,
        actorId: a.user.id,
      });
      const r = adjustDoc(cur.doc as DraftDoc, cur.sources as SourceRef[], body.instruction, d.clock.now());
      if (!r.ok) {
        await d.audit.record(tx, a.ctx, {
          action: 'copilot.draft_adjust_refused',
          entityType: 'copilot_draft',
          entityId: id,
          after: {
            instruction: body.instruction.slice(0, 300),
            reason: r.reason,
            source: body.source,
            understood: r.reason !== 'NOT_UNDERSTOOD',
            via: 'Procurement Copilot',
            engine: ENGINE,
          },
        });
        return viewOf(row, cur, {
          applied: false,
          reason: r.reason,
          message: r.message,
          examples: ADJUST_EXAMPLES,
          diff: [],
        });
      }
      const diff = diffDocs(cur.doc as DraftDoc, r.doc);
      const now = d.clock.now();
      const n = cur.revision + 1;
      const [maxRow] = await tx
        .select({ n: cpDraftRevision.revision })
        .from(cpDraftRevision)
        .where(eq(cpDraftRevision.draftId, id))
        .orderBy(desc(cpDraftRevision.revision))
        .limit(1);
      const next = Math.max(n, (maxRow?.n ?? 0) + 1);
      const [rev] = await tx
        .insert(cpDraftRevision)
        .values({
          tenantId: a.user.tenantId,
          draftId: id,
          revision: next,
          parentRevision: cur.revision,
          action: 'ADJUST',
          instruction: body.instruction,
          summary: r.summary,
          doc: r.doc,
          sources: r.sources,
          diff,
          createdBy: a.user.id,
          createdAt: now,
        })
        .returning();
      await tx.update(cpDraft).set({ currentRevision: next, updatedAt: now }).where(eq(cpDraft.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'copilot.draft_adjust',
        entityType: 'copilot_draft',
        entityId: id,
        before: { revision: cur.revision },
        after: {
          revision: next,
          instruction: body.instruction.slice(0, 300),
          source: body.source,
          changed: diff.map((x) => x.path).slice(0, 40),
          via: 'Procurement Copilot',
          engine: ENGINE,
        },
      });
      return viewOf({ ...row, currentRevision: next, updatedAt: now }, rev!, {
        applied: true,
        summary: r.summary,
        diff,
      });
    });
  });

  reg('POST', '/copilot/draft/{id}/undo');
  app.post(`${p}/copilot/draft/:id/undo`, { preHandler: guard(d, [...DRAFTERS]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(idParam, req.params);
    return withContext(d.database, a.ctx, async (tx) => {
      const row = await loadDraft(tx, a, id);
      const cur = await loadRevision(tx, row);
      if (cur.action === 'GENERATE' || cur.parentRevision === null)
        throw new AppError(
          409,
          'NOTHING_TO_UNDO',
          'There is nothing to undo: this is the first version of the draft.',
        );
      const target = await loadRevision(tx, row, cur.parentRevision);
      const diff = diffDocs(cur.doc as DraftDoc, target.doc as DraftDoc);
      const [maxRow] = await tx
        .select({ n: cpDraftRevision.revision })
        .from(cpDraftRevision)
        .where(eq(cpDraftRevision.draftId, id))
        .orderBy(desc(cpDraftRevision.revision))
        .limit(1);
      const next = (maxRow?.n ?? cur.revision) + 1;
      const now = d.clock.now();
      const summary = `Undid revision ${cur.revision}${cur.instruction ? ` (“${cur.instruction.slice(0, 60)}”)` : ''}; back to the content of revision ${target.revision}.`;
      const [rev] = await tx
        .insert(cpDraftRevision)
        .values({
          tenantId: a.user.tenantId,
          draftId: id,
          revision: next,
          parentRevision: target.parentRevision,
          action: 'UNDO',
          instruction: null,
          summary,
          doc: target.doc,
          sources: target.sources,
          diff,
          createdBy: a.user.id,
          createdAt: now,
        })
        .returning();
      await tx.update(cpDraft).set({ currentRevision: next, updatedAt: now }).where(eq(cpDraft.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'copilot.draft_undo',
        entityType: 'copilot_draft',
        entityId: id,
        before: { revision: cur.revision },
        after: { revision: next, restoredFrom: target.revision, via: 'Procurement Copilot' },
      });
      return viewOf({ ...row, currentRevision: next, updatedAt: now }, rev!, {
        applied: true,
        summary,
        diff,
      });
    });
  });

  // ------------------------------------------------------------------ apply
  reg('POST', '/copilot/draft/{id}/apply');
  app.post(`${p}/copilot/draft/:id/apply`, { preHandler: guard(d, [...DRAFTERS]) }, async (req, reply) => {
    const a = req.auth!;
    const { id } = parse(idParam, req.params);
    const body = parse(applyBody, req.body ?? {});
    const loaded = await withContext(d.database, a.ctx, async (tx) => {
      const row = await loadDraft(tx, a, id);
      return { row, rev: await loadRevision(tx, row) };
    });
    const { row, rev } = loaded;
    const doc = rev.doc as DraftDoc;
    const target = body.target ?? DEFAULT_TARGET[row.kind];
    const procurementId = body.procurementId ?? row.procurementId ?? undefined;
    const c = caller(req);
    const want = (k: string) => !body.sections || body.sections.includes(k);
    try {
      if (target === 'REQUEST') {
        if (row.kind !== 'REQUEST')
          throw new AppError(
            422,
            'TARGET_MISMATCH',
            'Only a request draft can be applied to a request. Use the plan, tender or repository target for this kind.',
          );
        const payload = requestPayload(doc, body.sections);
        let before: Record<string, unknown> = {};
        let res;
        if (procurementId) {
          const cur = ok(await callAs(c, 'GET', `/requests/${procurementId}`));
          before = Object.fromEntries([
            ...(cur.json.fields as Array<{ key: string; value?: string }>).map((f) => [f.key, f.value]),
            ['title', cur.json.title],
            ['category', cur.json.category],
            ['estimatedValue', cur.json.estimatedValue],
            ['termMonths', cur.json.termMonths],
            ['businessUnit', cur.json.businessUnit],
          ]);
          res = ok(await callAs(c, 'PATCH', `/requests/${procurementId}`, payload));
        } else res = ok(await callAs(c, 'POST', '/requests', payload));
        const after = Object.fromEntries([
          ...(res.json.fields as Array<{ key: string; value?: string }>).map((f) => [f.key, f.value]),
          ['title', res.json.title],
          ['category', res.json.category],
          ['estimatedValue', res.json.estimatedValue],
          ['termMonths', res.json.termMonths],
          ['businessUnit', res.json.businessUnit],
        ]);
        const changes = Object.keys(after)
          .filter((k) => String(before[k] ?? '') !== String(after[k] ?? ''))
          .map((k) => ({ field: k, before: before[k] ?? null, after: after[k] ?? null }));
        await recordApply(d, a, row, rev.revision, 'REQUEST', String(res.json.id), changes, {
          created: !procurementId,
        });
        return reply.status(200).send({
          applied: true,
          target,
          targetId: res.json.id,
          targetUrl: `/app/requests/${res.json.id}`,
          number: res.json.number,
          created: !procurementId,
          changes,
          revision: rev.revision,
          engine: ENGINE,
          simulated: true,
        });
      }
      if (!procurementId)
        throw new AppError(422, 'VALIDATION_FAILED', 'Name the procurement to apply this draft to', [
          { field: 'procurementId', message: 'Required for this target' },
        ]);

      if (target === 'PLAN') {
        if (row.kind !== 'PLAN')
          throw new AppError(422, 'TARGET_MISMATCH', 'Only a plan draft can be applied to a plan.');
        const plan = ok(await callAs(c, 'GET', `/requests/${procurementId}/plan`)).json;
        const valid = new Set(PLAN_FIELDS.map((f) => f.key));
        const changes: Array<{ field: string; before: string | null; after: string }> = [];
        try {
          for (const s of doc.sections) {
            if (!valid.has(s.key) || !want(s.key)) continue;
            const value = sectionText(doc, s.key);
            const cur = (plan.fields as Array<{ key: string; rev: number; value: string }>).find(
              (f) => f.key === s.key,
            );
            if (!value || (cur?.value ?? '') === value) continue;
            ok(
              await callAs(c, 'PUT', `/plans/${plan.id}/fields/${s.key}`, {
                value,
                expectedRev: cur?.rev ?? 0,
              }),
            );
            changes.push({ field: s.key, before: cur?.value || null, after: value });
          }
        } catch (e) {
          if (changes.length)
            await recordApply(d, a, row, rev.revision, 'PLAN', String(plan.id), changes, { partial: true });
          throw e;
        }
        await recordApply(d, a, row, rev.revision, 'PLAN', String(plan.id), changes);
        return reply.status(200).send({
          applied: true,
          target,
          targetId: plan.id,
          targetUrl: `/app/plans/${procurementId}`,
          changes,
          revision: rev.revision,
          engine: ENGINE,
          simulated: true,
        });
      }

      if (target === 'TENDER') {
        if (row.kind !== 'TENDER_DOC' && row.kind !== 'EVAL_CRITERIA')
          throw new AppError(
            422,
            'TARGET_MISMATCH',
            'Only a tender document or evaluation criteria draft can be applied to a tender pack.',
          );
        const list = ok(await callAs(c, 'GET', '/tenders')).json as unknown as Array<{
          id: string;
          requestId: string;
        }>;
        const t = list.find((x) => x.requestId === procurementId);
        if (!t)
          throw new AppError(
            409,
            'NO_TENDER',
            'This procurement has no tender pack yet. Create the tender first, or file the draft in the repository instead.',
          );
        let view = ok(await callAs(c, 'GET', `/tenders/${t.id}`)).json;
        const keys =
          row.kind === 'EVAL_CRITERIA'
            ? [['criteria', 'evaluationCriteria']]
            : doc.sections.map((s) => [s.key, s.key]);
        const changes: Array<{ field: string; before: string | null; after: string }> = [];
        try {
          for (const [from, to] of keys as Array<[string, string]>) {
            if (!TENDER_FIELD_BY_KEY.has(to) || !want(from)) continue;
            const value = sectionText(doc, from);
            const cur = (view.fields as Array<{ key: string; rev: number; value: string }>).find(
              (f) => f.key === to,
            );
            if (!value || (cur?.value ?? '') === value) continue;
            view = ok(
              await callAs(c, 'PUT', `/tenders/${t.id}/fields/${to}`, { value, expectedRev: cur?.rev ?? 0 }),
            ).json;
            changes.push({ field: to, before: cur?.value || null, after: value });
          }
        } catch (e) {
          if (changes.length)
            await recordApply(d, a, row, rev.revision, 'TENDER', t.id, changes, { partial: true });
          throw e;
        }
        await recordApply(d, a, row, rev.revision, 'TENDER', t.id, changes);
        return reply.status(200).send({
          applied: true,
          target,
          targetId: t.id,
          targetUrl: `/app/tenders/${t.id}`,
          changes,
          revision: rev.revision,
          engine: ENGINE,
          simulated: true,
          sectionsAvailable: TENDER_FIELDS.map((f) => f.key),
        });
      }

      // REPOSITORY: a Word document in the procurement's project site
      const folder = body.folder ?? FOLDER_OF[row.kind];
      const name = (body.fileName ?? FILE_OF[row.kind]).replace(/[^\w. -]/g, '_');
      const listing = ok(
        await callAs(c, 'GET', `/repository/projects/${procurementId}/files?folder=${folder}`),
      ).json;
      const existing = (listing.files as Array<{ name: string; folder: string; version: number }>).find(
        (f) => f.name === name && f.folder === folder,
      );
      const bytes = docxFor(row, doc, rev.revision, d.clock.now());
      const put = ok(
        await callAs(
          c,
          'PUT',
          `/repository/projects/${procurementId}/files/${folder}/${encodeURIComponent(name)}`,
          {
            contentBase64: bytes.toString('base64'),
            comment: `Drafted by the Procurement Copilot (SIMULATED), revision ${rev.revision}`,
          },
          existing ? { 'if-match': `"${existing.version}"` } : {},
        ),
        [200, 201, 202],
      );
      if (put.status === 202) {
        await recordApply(d, a, row, rev.revision, 'REPOSITORY', procurementId, [], { queued: true });
        return reply.status(200).send({
          applied: false,
          queued: true,
          target,
          manualTaskId: put.json.manualTaskId,
          message: put.json.message,
          revision: rev.revision,
          engine: ENGINE,
          simulated: true,
        });
      }
      const file = put.json.file as { path: string; version: number };
      const changes = [
        {
          field: 'file',
          before: existing ? `version ${existing.version}` : null,
          after: `${file.path} version ${file.version}`,
        },
      ];
      await recordApply(d, a, row, rev.revision, 'REPOSITORY', procurementId, changes, { path: file.path });
      return reply.status(200).send({
        applied: true,
        target,
        targetId: procurementId,
        targetUrl: '/app/repository',
        file,
        changes,
        revision: rev.revision,
        engine: ENGINE,
        simulated: true,
      });
    } catch (e) {
      if (e instanceof RouteRefusal) {
        await refusal(a, id, 'copilot.draft_apply_refused', e, { target, kind: row.kind });
        throw toAppError(e);
      }
      throw e;
    }
  });

  // ------------------------------------------------------------------ pre-population
  reg('POST', '/copilot/prepopulate');
  app.post(`${p}/copilot/prepopulate`, { preHandler: guard(d, [...DRAFTERS]) }, async (req) => {
    const a = req.auth!;
    const body = parse(prepopBody, req.body);
    const c = caller(req);
    try {
      const record = await recordFromView(c, body.procurementId);
      const text = body.text ?? [record.fields.background, record.title].filter(Boolean).join('. ');
      let current: Record<string, string> = {};
      let kind: DraftKind = 'REQUEST';
      let labels = new Map<string, string>();
      if (body.stage === 'PLAN') {
        kind = 'PLAN';
        const plan = ok(await callAs(c, 'GET', `/requests/${body.procurementId}/plan`)).json;
        current = Object.fromEntries(
          (plan.fields as Array<{ key: string; value: string }>).map((f) => [f.key, f.value]),
        );
        labels = new Map((plan.fields as Array<{ key: string; label: string }>).map((f) => [f.key, f.label]));
      } else if (body.stage === 'TENDER') {
        kind = 'TENDER_DOC';
        const list = ok(await callAs(c, 'GET', '/tenders')).json as unknown as Array<{
          id: string;
          requestId: string;
        }>;
        const t = list.find((x) => x.requestId === body.procurementId);
        if (t) {
          const v = ok(await callAs(c, 'GET', `/tenders/${t.id}`)).json;
          current = Object.fromEntries(
            (v.fields as Array<{ key: string; value: string }>).map((f) => [f.key, f.value]),
          );
        }
        labels = new Map(TENDER_FIELDS.map((f) => [f.key, f.label]));
      }
      const out = await withContext(d.database, a.ctx, async (tx) => {
        const ctx = await gatherContext(tx, a.user.tenantId, text, record);
        const first = generateDraft({
          kind,
          text,
          today: d.clock.now(),
          organisation: ctx.organisation,
          record,
          knownSuppliers: ctx.knownSuppliers,
          templates: ctx.templates,
        });
        const cat = first.doc.fields.category ?? record.category;
        const [history, catalogue] = await Promise.all([
          historyFor(tx, a.user.tenantId, cat, record.id),
          catalogueFor(tx, a.user.tenantId, cat, text),
        ]);
        const g = generateDraft({
          kind,
          text,
          today: d.clock.now(),
          organisation: ctx.organisation,
          record,
          history,
          catalogue,
          knownSuppliers: ctx.knownSuppliers,
          templates: ctx.templates,
        });
        const suggestions =
          body.stage === 'REQUEST'
            ? requestSuggestions(g.doc, g.sources, {
                title: record.title,
                category: record.category,
                estimatedValue: record.estimatedValue,
                termMonths: record.termMonths,
                businessUnit: record.businessUnit,
                ...record.fields,
              })
            : sectionSuggestions(g.doc, g.sources, current, labels);
        await d.audit.record(tx, a.ctx, {
          action: 'copilot.prepopulate',
          entityType: 'request',
          entityId: body.procurementId,
          after: {
            stage: body.stage,
            suggestions: suggestions.length,
            engine: ENGINE,
            via: 'Procurement Copilot',
          },
        });
        return { history: history ?? null, catalogue, suggestions, missing: g.missing };
      });
      return {
        procurementId: body.procurementId,
        stage: body.stage,
        engine: ENGINE,
        simulated: true,
        ...out,
      };
    } catch (e) {
      if (e instanceof RouteRefusal) throw toAppError(e);
      throw e;
    }
  });

  return done;
}
