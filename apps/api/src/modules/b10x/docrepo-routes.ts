/**
 * Document repository endpoints (NFR-C06): projects the caller may open, folders and files, versions, download, a write that
 * must say which version it started from, and the two ways a platform document and the repository meet: publish a platform
 * document (the contract, the evaluation report, the tender pack) to its project folder, and import a repository file into a
 * contract's negotiation drafts. Platform documents are fetched through the platform's own export routes with the caller's own
 * session, so what a person may export is exactly what they may publish.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { guard, type AuthContext, type GuardDeps } from '../../auth/guard.js';
import { withContext, type Tx } from '../../db/client.js';
import { contract, evaluation, tender } from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import {
  FOLDERS,
  MAX_REPO_BYTES,
  fileMeta,
  gate,
  latestFiles,
  listProjects,
  projectFor,
  queueFilingTask,
  readFile,
  sitePath,
  unavailable,
  versionsOf,
  writeFile,
  type RepoDeps,
} from './docrepo.js';

const READERS = [
  'REQUESTER',
  'PROCUREMENT',
  'DELEGATE',
  'LEGAL',
  'CONTRACT_MGR',
  'PROBITY',
  'FINANCE',
  'EXEC',
] as const;
const WRITERS = ['REQUESTER', 'PROCUREMENT', 'LEGAL', 'CONTRACT_MGR'] as const;
const PUBLISHERS = ['PROCUREMENT', 'LEGAL', 'CONTRACT_MGR'] as const;
const IMPORTERS = ['LEGAL'] as const;

const uuid = z.string().uuid();
const projectParam = z.object({ requestId: uuid });
const fileParam = projectParam.extend({
  folder: z.enum(FOLDERS),
  name: z.string().min(3).max(120),
});
const versionQuery = z.object({ version: z.coerce.number().int().min(1).optional() });
const writeBody = z
  .object({
    contentBase64: z
      .string()
      .min(4)
      .max(Math.ceil((MAX_REPO_BYTES * 4) / 3) + 16),
    comment: z.string().trim().max(500).optional(),
  })
  .strict();
const publishBody = z
  .object({
    source: z.enum(['CONTRACT', 'EVALUATION_REPORT', 'TENDER_PACK']),
    sourceId: uuid,
    folder: z.enum(FOLDERS).optional(),
  })
  .strict();
const importBody = z
  .object({
    folder: z.enum(FOLDERS),
    name: z.string().min(3).max(120),
    version: z.number().int().min(1).optional(),
    contractId: uuid,
  })
  .strict();

/** If-Match carries the version number the caller last read, like `"3"` or `3`. Missing means "a file that is not there yet". */
function ifMatchOf(h: string | string[] | undefined): number | null {
  const v = (Array.isArray(h) ? h[0] : h)?.trim().replace(/^W\//, '').replace(/"/g, '');
  if (v === undefined || v === '') return null;
  if (!/^\d{1,9}$/.test(v)) throw new AppError(400, 'VALIDATION_FAILED', 'If-Match must be a version number');
  return Number(v);
}

const DEFAULT_FOLDER = {
  CONTRACT: 'Contract',
  EVALUATION_REPORT: 'Evaluation',
  TENDER_PACK: 'Tender',
} as const;

export function registerDocRepo(app: FastifyInstance, p: string, d: GuardDeps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);
  const rd: RepoDeps = { clock: d.clock, audit: d.audit };
  /**
   * Runs a read through the repository gate. A repository that does not answer is reported after the transaction ends, so
   * the failure the resilient layer counted (and the breaker it may have opened) is kept.
   */
  async function viaRepo<T>(a: AuthContext, op: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const out = await withContext(d.database, a.ctx, async (tx) => {
      const g = await gate(tx, rd, a.user.tenantId, op);
      if (!g.ok) return { down: g.error } as const;
      return { value: await fn(tx), provider: g.provider } as const;
    });
    if ('down' in out) throw unavailable(out.down ?? null);
    return out.value;
  }

  reg('GET', '/repository/projects');
  app.get(`${p}/repository/projects`, { preHandler: guard(d, [...READERS]) }, async (req) => {
    const a = req.auth!;
    return viaRepo(a, 'list', async (tx) => ({
      simulated: true,
      folders: FOLDERS,
      projects: await listProjects(tx, a),
    }));
  });

  reg('GET', '/repository/projects/{requestId}/files');
  app.get(
    `${p}/repository/projects/:requestId/files`,
    { preHandler: guard(d, [...READERS]) },
    async (req) => {
      const a = req.auth!;
      const { requestId } = parse(projectParam, req.params);
      const q = parse(z.object({ folder: z.enum(FOLDERS).optional() }), req.query);
      return viaRepo(a, 'list', async (tx) => {
        const r = await projectFor(tx, a, requestId);
        const files = await latestFiles(tx, a.user.tenantId, requestId, q.folder);
        return {
          simulated: true,
          project: { id: r.id, number: r.number, title: r.title, site: `/sites/${r.number}` },
          folders: FOLDERS.map((f) => ({
            name: f,
            path: `/sites/${r.number}/${f}`,
            files: files.filter((x) => x.latest.folder === f).length,
          })),
          files: files.map((x) => ({ ...fileMeta(x.latest, r), versions: x.versions })),
        };
      });
    },
  );

  reg('GET', '/repository/projects/{requestId}/files/{folder}/{name}');
  app.get(
    `${p}/repository/projects/:requestId/files/:folder/:name`,
    { preHandler: guard(d, [...READERS]) },
    async (req, reply) => {
      const a = req.auth!;
      const { requestId, folder, name } = parse(fileParam, req.params);
      const q = parse(versionQuery, req.query);
      const out = await viaRepo(a, 'read', async (tx) => {
        const r = await projectFor(tx, a, requestId);
        const f = await readFile(tx, a.user.tenantId, requestId, folder, name, q.version);
        await d.audit.record(tx, a.ctx, {
          action: 'docrepo.read',
          entityType: 'request',
          entityId: requestId,
          after: { path: sitePath(r, folder, name), version: f.row.version },
        });
        return {
          meta: { ...fileMeta(f.row, r), isLatest: f.row.version === f.latest },
          content: f.row.contentBase64,
          version: f.row.version,
        };
      });
      return reply.header('etag', `"${out.version}"`).send({ ...out.meta, contentBase64: out.content });
    },
  );

  reg('GET', '/repository/projects/{requestId}/files/{folder}/{name}/download');
  app.get(
    `${p}/repository/projects/:requestId/files/:folder/:name/download`,
    { preHandler: guard(d, [...READERS]) },
    async (req, reply) => {
      const a = req.auth!;
      const { requestId, folder, name } = parse(fileParam, req.params);
      const q = parse(versionQuery, req.query);
      const f = await viaRepo(a, 'read', async (tx) => {
        const r = await projectFor(tx, a, requestId);
        const x = await readFile(tx, a.user.tenantId, requestId, folder, name, q.version);
        await d.audit.record(tx, a.ctx, {
          action: 'docrepo.download',
          entityType: 'request',
          entityId: requestId,
          after: { path: sitePath(r, folder, name), version: x.row.version },
        });
        return x.row;
      });
      return reply
        .header('content-type', f.contentType)
        .header('etag', `"${f.version}"`)
        .header('content-disposition', `attachment; filename="${f.name.replace(/[^\w. -]/g, '_')}"`)
        .send(Buffer.from(f.contentBase64, 'base64'));
    },
  );

  reg('GET', '/repository/projects/{requestId}/files/{folder}/{name}/versions');
  app.get(
    `${p}/repository/projects/:requestId/files/:folder/:name/versions`,
    { preHandler: guard(d, [...READERS]) },
    async (req) => {
      const a = req.auth!;
      const { requestId, folder, name } = parse(fileParam, req.params);
      return viaRepo(a, 'list', async (tx) => {
        const r = await projectFor(tx, a, requestId);
        const rows = await versionsOf(tx, a.user.tenantId, requestId, folder, name);
        if (rows.length === 0) throw new AppError(404, 'NOT_FOUND', 'File not found');
        return { path: sitePath(r, folder, name), versions: rows.map((x) => fileMeta(x, r)) };
      });
    },
  );

  reg('PUT', '/repository/projects/{requestId}/files/{folder}/{name}');
  app.put(
    `${p}/repository/projects/:requestId/files/:folder/:name`,
    { preHandler: guard(d, [...WRITERS]), bodyLimit: 4 * 1024 * 1024 },
    async (req, reply) => {
      const a = req.auth!;
      const { requestId, folder, name } = parse(fileParam, req.params);
      const body = parse(writeBody, req.body);
      const match = ifMatchOf(req.headers['if-match']);
      const out = await withContext(d.database, a.ctx, async (tx) => {
        const r = await projectFor(tx, a, requestId);
        const w = await writeFile(tx, rd, a.ctx, r, {
          folder,
          name,
          bytes: Buffer.from(body.contentBase64, 'base64'),
          ifMatch: match,
          comment: body.comment,
        });
        return { r, w };
      });
      if (out.w.state === 'MANUAL_TASK')
        return reply.status(202).send({
          result: 'MANUAL_TASK',
          simulated: true,
          manualTaskId: out.w.taskId,
          message: 'The repository is not responding. A task was queued to file this document by hand.',
        });
      return reply
        .status(201)
        .header('etag', `"${out.w.row.version}"`)
        .send({ result: 'WRITTEN', simulated: true, file: fileMeta(out.w.row, out.r) });
    },
  );

  // ------------------------------------------------------------ platform documents available to file
  reg('GET', '/repository/projects/{requestId}/sources');
  app.get(
    `${p}/repository/projects/:requestId/sources`,
    { preHandler: guard(d, [...READERS]) },
    async (req) => {
      const a = req.auth!;
      const { requestId } = parse(projectParam, req.params);
      return withContext(d.database, a.ctx, async (tx) => {
        const r = await projectFor(tx, a, requestId);
        const tenders = await tx
          .select()
          .from(tender)
          .where(and(eq(tender.tenantId, a.user.tenantId), eq(tender.requestId, requestId)));
        const ids = tenders.map((t) => t.id);
        const evals = ids.length
          ? await tx.select().from(evaluation).where(inArray(evaluation.tenderId, ids))
          : [];
        const contracts = ids.length
          ? (await tx.select().from(contract).where(inArray(contract.tenderId, ids))).filter(
              (c) => !c.deletedAt,
            )
          : [];
        return {
          project: { id: r.id, number: r.number },
          sources: [
            ...tenders.map((t) => ({
              source: 'TENDER_PACK',
              id: t.id,
              label: `Tender pack (${t.type}, ${t.status.toLowerCase()})`,
              folder: 'Tender',
            })),
            ...evals.map((e) => ({
              source: 'EVALUATION_REPORT',
              id: e.id,
              label: `Evaluation report (${e.status.toLowerCase()})`,
              folder: 'Evaluation',
            })),
            ...contracts.map((c) => ({
              source: 'CONTRACT',
              id: c.id,
              label: `Contract ${c.number} (${c.status.toLowerCase().replace('_', ' ')})`,
              folder: 'Contract',
            })),
          ],
        };
      });
    },
  );

  reg('POST', '/repository/projects/{requestId}/publish');
  app.post(
    `${p}/repository/projects/:requestId/publish`,
    { preHandler: guard(d, [...PUBLISHERS]) },
    async (req, reply) => {
      const a = req.auth!;
      const { requestId } = parse(projectParam, req.params);
      const body = parse(publishBody, req.body);
      const folder = body.folder ?? DEFAULT_FOLDER[body.source];
      const url =
        body.source === 'CONTRACT'
          ? `${p}/contracts/${body.sourceId}/export.pdf`
          : body.source === 'EVALUATION_REPORT'
            ? `${p}/evaluations/${body.sourceId}/report/pdf`
            : `${p}/tenders/${body.sourceId}/pack/pdf`;
      // 1. the project, the source's place in it, and whether the repository answers
      const pre = await withContext(d.database, a.ctx, async (tx) => {
        const r = await projectFor(tx, a, requestId);
        const tenders = await tx
          .select()
          .from(tender)
          .where(and(eq(tender.tenantId, a.user.tenantId), eq(tender.requestId, requestId)));
        const ids = new Set(tenders.map((t) => t.id));
        let belongs: boolean;
        if (body.source === 'TENDER_PACK') belongs = ids.has(body.sourceId);
        else if (body.source === 'EVALUATION_REPORT') {
          const [e] = await tx.select().from(evaluation).where(eq(evaluation.id, body.sourceId));
          belongs = Boolean(e && ids.has(e.tenderId));
        } else {
          const [c] = await tx.select().from(contract).where(eq(contract.id, body.sourceId));
          belongs = Boolean(c && c.tenderId && ids.has(c.tenderId) && !c.deletedAt);
        }
        if (!belongs) throw new AppError(404, 'NOT_FOUND', 'That document does not belong to this project');
        const g = await gate(tx, rd, a.user.tenantId, 'write');
        let taskId: string | null = null;
        if (!g.ok)
          taskId = await queueFilingTask(tx, rd, a.ctx, r, {
            folder,
            name: `${body.source.toLowerCase().replace('_', '-')}.pdf`,
            error: g.error,
          });
        return { r, ok: g.ok, taskId };
      });
      if (!pre.ok)
        return reply.status(202).send({
          result: 'MANUAL_TASK',
          simulated: true,
          manualTaskId: pre.taskId,
          message: 'The repository is not responding. A task was queued to file this document by hand.',
        });
      // 2. the platform document, fetched with the caller's own session so their own rights apply
      const res = await app.inject({
        method: 'GET',
        url,
        headers: { cookie: String(req.headers.cookie ?? '') },
      });
      if (res.statusCode >= 400)
        return reply.status(res.statusCode).type('application/problem+json').send(res.body);
      const disp = String(res.headers['content-disposition'] ?? '');
      const name = /filename="([^"]+)"/.exec(disp)?.[1] ?? `${body.source.toLowerCase()}.pdf`;
      const bytes = res.rawPayload;
      // 3. file it as the next version
      const out = await withContext(d.database, a.ctx, async (tx) => {
        const all = await versionsOf(tx, a.user.tenantId, requestId, folder, name);
        const w = await writeFile(tx, rd, a.ctx, pre.r, {
          folder,
          name,
          bytes,
          ifMatch: all[0]?.version ?? null,
          comment: `Published from the platform (${body.source.toLowerCase().replace('_', ' ')})`,
          source: 'PLATFORM',
          sourceRef: `${body.source}:${body.sourceId}`,
          skipIfSame: true,
        });
        if (w.state !== 'MANUAL_TASK')
          await d.audit.record(tx, a.ctx, {
            action: 'docrepo.publish',
            entityType: 'request',
            entityId: requestId,
            after: {
              source: body.source,
              sourceId: body.sourceId,
              path: sitePath(pre.r, folder, name),
              version: w.row.version,
              unchanged: w.unchanged,
            },
          });
        return w;
      });
      if (out.state === 'MANUAL_TASK')
        return reply.status(202).send({ result: 'MANUAL_TASK', simulated: true, manualTaskId: out.taskId });
      return reply.status(out.unchanged ? 200 : 201).send({
        result: out.unchanged ? 'UNCHANGED' : 'WRITTEN',
        simulated: true,
        file: fileMeta(out.row, pre.r),
      });
    },
  );

  reg('POST', '/repository/projects/{requestId}/import');
  app.post(
    `${p}/repository/projects/:requestId/import`,
    { preHandler: guard(d, [...IMPORTERS]) },
    async (req, reply) => {
      const a = req.auth!;
      const { requestId } = parse(projectParam, req.params);
      const body = parse(importBody, req.body);
      const pre = await viaRepo(a, 'read', async (tx) => {
        const r = await projectFor(tx, a, requestId);
        const f = await readFile(tx, a.user.tenantId, requestId, body.folder, body.name, body.version);
        const tenders = await tx
          .select({ id: tender.id })
          .from(tender)
          .where(and(eq(tender.tenantId, a.user.tenantId), eq(tender.requestId, requestId)));
        const [c] = await tx.select().from(contract).where(eq(contract.id, body.contractId));
        if (!c || !c.tenderId || !tenders.some((t) => t.id === c.tenderId) || c.deletedAt)
          throw new AppError(404, 'NOT_FOUND', 'That contract does not belong to this project');
        await d.audit.record(tx, a.ctx, {
          action: 'docrepo.import',
          entityType: 'contract',
          entityId: c.id,
          after: {
            path: sitePath(r, body.folder, body.name),
            version: f.row.version,
            checksum: f.row.checksum,
          },
        });
        return f.row;
      });
      const res = await app.inject({
        method: 'POST',
        url: `${p}/contracts/${body.contractId}/drafts`,
        headers: {
          cookie: String(req.headers.cookie ?? ''),
          'x-csrf-token': String(req.headers['x-csrf-token'] ?? ''),
          'content-type': 'application/json',
        },
        payload: {
          fileName: pre.name,
          contentBase64: pre.contentBase64,
          note: `Imported from the document repository (version ${pre.version})`,
        },
      });
      if (res.statusCode >= 400)
        return reply.status(res.statusCode).type('application/problem+json').send(res.body);
      return reply.status(201).send({ imported: true, simulated: true, draft: res.json() });
    },
  );

  return done;
}
