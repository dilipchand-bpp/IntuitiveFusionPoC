/**
 * The simulated enterprise document repository (NFR-C06, "SharePoint"). Each procurement is a site; its files sit in a few
 * fixed folders. A file is never overwritten: every write adds the next version and all versions are kept. A write must say
 * which version it was based on (If-Match), so two people cannot silently replace each other's work. A person sees only the
 * sites of procurements they can see (the same scope as the reports). Every call goes through the resilient layer.
 *
 * SWAP POINT (docs/swap-points.md): `RepositoryStore`'s role is played by the repo_document table here. A real adapter maps the
 * same operations (list, read, write with a version check) onto the SharePoint / Microsoft Graph drive API.
 */
import { createHash } from 'node:crypto';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { Clock } from '@if/shared';
import type { AuditService } from '../../audit/audit-service.js';
import type { AuthContext } from '../../auth/guard.js';
import type { RequestContext, Tx } from '../../db/client.js';
import { manualTask, repoDocument } from '../../db/schema.js';
import type { request } from '../../db/schema.js';
import { AppError } from '../../http/errors.js';
import { getConnector } from '../b10conn/connectors.js';
import { callProvider } from '../b10conn/resilience.js';
import { visibleRequests } from '../reporting/scope.js';
import { checkUpload, scanBytes } from '../tender/files.js';

export const FOLDERS = ['Tender', 'Evaluation', 'Contract', 'General'] as const;
export type Folder = (typeof FOLDERS)[number];
/** The files here are small synthetic documents; the real store would hold much more. */
export const MAX_REPO_BYTES = 2 * 1024 * 1024;

export interface RepoDeps {
  clock: Clock;
  audit: AuditService;
  sleep?: (ms: number) => Promise<void>;
}
type RequestRow = typeof request.$inferSelect;
type DocRow = typeof repoDocument.$inferSelect;

export const sha256Hex = (b: Buffer) => createHash('sha256').update(b).digest('hex');
export const sitePath = (r: Pick<RequestRow, 'number'>, folder: string, name: string) =>
  `/sites/${r.number}/${folder}/${name}`;

export const fileMeta = (r: DocRow, req: Pick<RequestRow, 'number'>) => ({
  id: r.id,
  folder: r.folder,
  name: r.name,
  path: sitePath(req, r.folder, r.name),
  version: r.version,
  checksum: r.checksum,
  sizeBytes: r.sizeBytes,
  contentType: r.contentType,
  comment: r.comment,
  source: r.source,
  sourceRef: r.sourceRef,
  createdAt: r.createdAt.toISOString(),
  createdBy: r.createdBy,
});

/** The procurements this person may open as repository sites. */
export async function visibleProjects(tx: Tx, a: AuthContext) {
  const { rows } = await visibleRequests(tx, a);
  return rows;
}

export async function projectFor(tx: Tx, a: AuthContext, requestId: string): Promise<RequestRow> {
  const rows = await visibleProjects(tx, a);
  const r = rows.find((x) => x.id === requestId);
  if (!r) throw new AppError(404, 'NOT_FOUND', 'Project not found');
  return r;
}

/**
 * The call to the repository, through the resilient layer. A repository that is switched off is a configuration matter (409);
 * one that is down is reported to the caller so it can fall back (`ok: false`).
 */
export async function gate(tx: Tx, d: RepoDeps, tenantId: string, op: string) {
  const conn = await getConnector(tx, tenantId, 'DOCREPO');
  if (!conn || !conn.enabled)
    throw new AppError(
      409,
      'REPOSITORY_OFF',
      'The document repository is not switched on. An administrator can switch it on on the Connectors page.',
    );
  const out = await callProvider(
    tx,
    { clock: d.clock, ...(d.sleep ? { sleep: d.sleep } : {}) },
    tenantId,
    'DOCREPO',
    async () => ({ op, provider: conn.provider }),
    { fallback: () => null, retries: 1 },
  );
  return {
    provider: conn.provider,
    ok: out.ok,
    error: out.ok ? null : out.error,
    reason: out.ok ? null : out.reason,
  };
}

const unavailable = (error: string | null) =>
  new AppError(
    503,
    'REPOSITORY_UNAVAILABLE',
    `The document repository is not responding. ${error ?? ''}`.trim(),
  );

/** A person's note that the repository could not be written, so the filing is not forgotten (NFR-AV04). */
export async function queueFilingTask(
  tx: Tx,
  d: RepoDeps,
  ctx: RequestContext,
  req: RequestRow,
  what: { folder: string; name: string; error: string | null },
) {
  const [t] = await tx
    .insert(manualTask)
    .values({
      tenantId: ctx.tenantId,
      connectorKind: 'DOCREPO',
      title: `File ${what.name} in the repository by hand`,
      instructions: `The document repository did not respond, so ${what.name} was not filed. Save the document from the platform and place it in ${sitePath(req, what.folder, '')} by hand, then put the repository link here.`,
      payloadSummary: { requestId: req.id, requestNumber: req.number, folder: what.folder, name: what.name },
      createdAt: d.clock.now(),
    })
    .returning({ id: manualTask.id });
  await d.audit.record(tx, ctx, {
    action: 'docrepo.filing_queued',
    entityType: 'request',
    entityId: req.id,
    result: 'FAILED',
    after: { folder: what.folder, name: what.name, reason: what.error },
  });
  return t!.id;
}

export async function listProjects(tx: Tx, a: AuthContext) {
  const rows = await visibleProjects(tx, a);
  const docs = rows.length
    ? await tx.select().from(repoDocument).where(eq(repoDocument.tenantId, a.user.tenantId))
    : [];
  return rows
    .sort((x, y) => x.number.localeCompare(y.number))
    .map((r) => {
      const mine = docs.filter((x) => x.requestId === r.id);
      return {
        id: r.id,
        number: r.number,
        title: r.title,
        phase: r.phase,
        site: `/sites/${r.number}`,
        files: new Set(mine.map((x) => `${x.folder}/${x.name}`)).size,
        versions: mine.length,
      };
    });
}

/** The newest version of each file in a project (optionally one folder). */
export async function latestFiles(tx: Tx, tenantId: string, requestId: string, folder?: string) {
  const rows = await tx
    .select()
    .from(repoDocument)
    .where(
      and(
        eq(repoDocument.tenantId, tenantId),
        eq(repoDocument.requestId, requestId),
        ...(folder ? [eq(repoDocument.folder, folder)] : []),
      ),
    )
    .orderBy(asc(repoDocument.folder), asc(repoDocument.name), desc(repoDocument.version));
  const seen = new Map<string, { latest: DocRow; versions: number }>();
  for (const r of rows) {
    const k = `${r.folder}/${r.name}`;
    const cur = seen.get(k);
    if (!cur) seen.set(k, { latest: r, versions: 1 });
    else cur.versions += 1;
  }
  return [...seen.values()];
}

export async function versionsOf(tx: Tx, tenantId: string, requestId: string, folder: string, name: string) {
  return tx
    .select()
    .from(repoDocument)
    .where(
      and(
        eq(repoDocument.tenantId, tenantId),
        eq(repoDocument.requestId, requestId),
        eq(repoDocument.folder, folder),
        eq(repoDocument.name, name),
      ),
    )
    .orderBy(desc(repoDocument.version));
}

export async function readFile(
  tx: Tx,
  tenantId: string,
  requestId: string,
  folder: string,
  name: string,
  version?: number,
) {
  const all = await versionsOf(tx, tenantId, requestId, folder, name);
  const row = version ? all.find((x) => x.version === version) : all[0];
  if (!row) throw new AppError(404, 'NOT_FOUND', 'File not found');
  return { row, latest: all[0]!.version };
}

export type WriteResult =
  | { state: 'WRITTEN'; row: DocRow; unchanged: false }
  | { state: 'UNCHANGED'; row: DocRow; unchanged: true }
  | { state: 'MANUAL_TASK'; taskId: string; unchanged: false };

/**
 * Writes the next version of a file. `ifMatch` is the version the caller last saw: null for a file that does not exist yet.
 * A stale or missing If-Match is refused (412 / 428), never silently merged.
 */
export async function writeFile(
  tx: Tx,
  d: RepoDeps,
  ctx: RequestContext,
  req: RequestRow,
  input: {
    folder: string;
    name: string;
    bytes: Buffer;
    ifMatch: number | null;
    comment?: string | undefined;
    source?: 'UPLOAD' | 'PLATFORM';
    sourceRef?: string | undefined;
    /** When the content is the same as the newest version, do not add a version. */
    skipIfSame?: boolean;
  },
): Promise<WriteResult> {
  if (!(FOLDERS as readonly string[]).includes(input.folder))
    throw new AppError(422, 'UNKNOWN_FOLDER', `Choose one of: ${FOLDERS.join(', ')}`);
  if (input.bytes.length > MAX_REPO_BYTES)
    throw new AppError(
      413,
      'FILE_TOO_LARGE',
      `Files in this repository are limited to ${MAX_REPO_BYTES / 1024 / 1024} MB`,
    );
  const check = checkUpload(input.name, input.bytes);
  if (!check.ok) throw new AppError(400, check.code, check.message);
  if (scanBytes(input.bytes) === 'INFECTED')
    throw new AppError(422, 'FILE_INFECTED', 'The file was refused by the virus scan');
  const name = check.safeName;
  const g = await gate(tx, d, ctx.tenantId, 'write');
  if (!g.ok) {
    const taskId = await queueFilingTask(tx, d, ctx, req, { folder: input.folder, name, error: g.error });
    return { state: 'MANUAL_TASK', taskId, unchanged: false };
  }
  const all = await versionsOf(tx, ctx.tenantId, req.id, input.folder, name);
  const latest = all[0];
  if (latest) {
    if (input.ifMatch === null)
      throw new AppError(
        428,
        'PRECONDITION_REQUIRED',
        `${name} already exists (version ${latest.version}). Say which version you started from with If-Match.`,
      );
    if (input.ifMatch !== latest.version)
      throw new AppError(
        412,
        'PRECONDITION_FAILED',
        `${name} is now at version ${latest.version}, not ${input.ifMatch}. Read the newest version and apply your change to it.`,
      );
  } else if (input.ifMatch !== null && input.ifMatch !== 0)
    throw new AppError(
      412,
      'PRECONDITION_FAILED',
      `${name} does not exist yet, so there is no version ${input.ifMatch}`,
    );
  const checksum = sha256Hex(input.bytes);
  if (latest && input.skipIfSame && latest.checksum === checksum)
    return { state: 'UNCHANGED', row: latest, unchanged: true };
  const [row] = await tx
    .insert(repoDocument)
    .values({
      tenantId: ctx.tenantId,
      requestId: req.id,
      folder: input.folder,
      name,
      version: (latest?.version ?? 0) + 1,
      checksum,
      sizeBytes: input.bytes.length,
      contentType: check.contentType,
      contentBase64: input.bytes.toString('base64'),
      comment: input.comment?.slice(0, 500) ?? null,
      source: input.source ?? 'UPLOAD',
      sourceRef: input.sourceRef ?? null,
      createdBy: ctx.userId,
      createdAt: d.clock.now(),
    })
    .returning();
  await d.audit.record(tx, ctx, {
    action: 'docrepo.write',
    entityType: 'request',
    entityId: req.id,
    after: {
      path: sitePath(req, input.folder, name),
      version: row!.version,
      checksum,
      sizeBytes: row!.sizeBytes,
      source: row!.source,
    },
  });
  return { state: 'WRITTEN', row: row!, unchanged: false };
}

export { unavailable };
