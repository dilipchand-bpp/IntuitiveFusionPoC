/**
 * The one hook that scans every upload (SEC-AP04). It is installed with Fastify's onRoute hook BEFORE any route is
 * registered, so every POST, PUT and PATCH route, present and future, gets it as its last pre-handler (after the route's own
 * access check) without the route having to remember. It looks in the request body for fields that carry file content
 * (dataBase64, contentBase64, csv, data, file, content ...), decodes them and calls `scanUpload`.
 *   - infected: refused 422 VIRUS_DETECTED, nothing echoed, a quarantine record (no content), an audit event and a
 *     notification to every administrator (the security owner until group C's SEC-L06 names one);
 *   - a forbidden name (program or hidden double extension): refused 400 FILE_NAME_INVALID, audited;
 *   - scanner DOWN: the upload is held as PENDING_SCAN, sealed, unavailable until an administrator rescans it (fail closed).
 */
import { createHash } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Clock } from '@if/shared';
import type { AuditService } from '../../audit/audit-service.js';
import { withContext, type Database, type RequestContext, type Tx } from '../../db/client.js';
import { appUser, notification, quarantineItem, roleAssignment } from '../../db/schema.js';
import { AppError } from '../../http/errors.js';
import { loadSettings } from '../settings/settings.js';
import { openText, sealText } from './keys.js';
import { scanUpload, type ScanVerdict } from './malware.js';

/** Body field names that carry file content. A test enumerates the upload fields in the source and fails on any not matched here. */
export const UPLOAD_FIELD = /^(data|file|content|bytes|csv|[a-z]*base64)$/i;
const NAME_FIELD = /^(name|filename|file_name)$/i;
const MAX_SCAN_BYTES = 40 * 1024 * 1024;

export interface FoundUpload {
  field: string;
  name: string;
  bytes: Buffer;
}

const looksBase64 = (s: string) => s.length >= 8 && s.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(s);

/** Everything in a request body that looks like file content, with the file name that goes with it. */
export function findUploads(body: unknown, depth = 0, fallbackName = 'upload'): FoundUpload[] {
  if (!body || typeof body !== 'object' || depth > 3) return [];
  const out: FoundUpload[] = [];
  const rec = body as Record<string, unknown>;
  const name =
    Object.entries(rec).find(([k, v]) => NAME_FIELD.test(k) && typeof v === 'string')?.[1] ??
    Object.entries(rec).find(([k, v]) => /^file_?name$/i.test(k) && typeof v === 'string')?.[1];
  for (const [k, v] of Object.entries(rec)) {
    if (typeof v === 'string' && UPLOAD_FIELD.test(k) && v.length >= 8 && v.length < MAX_SCAN_BYTES * 1.4) {
      // base64 files are decoded; text is scanned as it is (the test string works in either form)
      out.push({
        field: k,
        name: typeof name === 'string' ? name : fallbackName,
        bytes: looksBase64(v)
          ? Buffer.concat([Buffer.from(v, 'base64'), Buffer.from('\n'), Buffer.from(v, 'utf8')])
          : Buffer.from(v, 'utf8'),
      });
    } else if (v && typeof v === 'object') {
      const kids = Array.isArray(v) ? v : [v];
      for (const kid of kids.slice(0, 50)) out.push(...findUploads(kid, depth + 1, fallbackName));
    }
  }
  return out;
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

export interface GateDeps {
  database: Database;
  audit: AuditService;
  clock: Clock;
}

const INFECTION = new Set(['SIGNATURE', 'EXECUTABLE_CONTENT', 'ARCHIVE_CONTENT']);
const infected = (v: ScanVerdict) => !v.clean && v.reason !== null && INFECTION.has(v.reason);

/** Tell every administrator, without naming the file's content. */
async function notifyAdmins(tx: Tx, d: GateDeps, tenantId: string, title: string, body: string) {
  const admins = await tx
    .select({ id: appUser.id })
    .from(roleAssignment)
    .innerJoin(appUser, eq(appUser.id, roleAssignment.userId))
    .where(
      and(
        eq(roleAssignment.tenantId, tenantId),
        eq(roleAssignment.role, 'ADMIN'),
        isNull(roleAssignment.expiresAt),
      ),
    );
  for (const a of admins)
    await tx.insert(notification).values({
      tenantId,
      userId: a.id,
      title,
      body,
      link: '/admin/quarantine',
      event: 'MALWARE_DETECTED',
    });
}

/**
 * Screens one upload. Throws when it must not go on; returns when it is clean. `source` says where it came from
 * ("POST /supplier/tenders/{id}/submission/files"), `entityId` the record it was for, when there is one.
 */
export async function gateUpload(
  d: GateDeps,
  ctx: RequestContext,
  up: { source: string; name: string; bytes: Buffer; entityId?: string | null },
): Promise<void> {
  const verdict = scanUpload(up.bytes, up.name);
  const hash = sha(up.bytes);
  const entityId = up.entityId && /^[0-9a-f-]{36}$/i.test(up.entityId) ? up.entityId : null;
  if (infected(verdict)) {
    await withContext(d.database, ctx, async (tx) => {
      await tx.insert(quarantineItem).values({
        tenantId: ctx.tenantId,
        source: up.source,
        name: up.name.slice(0, 200),
        sizeBytes: up.bytes.length,
        sha256: hash,
        signature: verdict.signature,
        status: 'QUARANTINED',
        userId: ctx.userId,
        createdAt: d.clock.now(),
      });
      await d.audit.record(tx, ctx, {
        action: 'upload.virus_detected',
        entityType: 'upload',
        entityId,
        after: { source: up.source, name: up.name.slice(0, 80), sha256: hash, signature: verdict.signature },
        result: 'DENIED',
      });
      await notifyAdmins(
        tx,
        d,
        ctx.tenantId,
        'Malware detected in an upload',
        `An upload was refused and quarantined (${verdict.signature}). Open the quarantine list for the details.`,
      );
    });
    throw new AppError(
      422,
      'VIRUS_DETECTED',
      'The upload was refused: the malware scan found a problem. Nothing was stored.',
    );
  }
  if (!verdict.clean) {
    await withContext(d.database, ctx, (tx) =>
      d.audit.record(tx, ctx, {
        action: 'upload.refused',
        entityType: 'upload',
        entityId,
        after: { source: up.source, name: up.name.slice(0, 80), rule: verdict.signature },
        result: 'DENIED',
      }),
    );
    throw new AppError(
      400,
      'FILE_NAME_INVALID',
      'Files with a hidden or double extension that looks like a program are not accepted.',
    );
  }
  const mode = await withContext(
    d.database,
    ctx,
    async (tx) => (await loadSettings(tx, ctx.tenantId)).uploadScanning.scannerMode,
  );
  if (mode === 'UP') return;
  // The scanner is not available: fail closed. A file an administrator has already had scanned (same content) goes through.
  const cleared = await withContext(d.database, ctx, async (tx) => {
    const same = await tx
      .select()
      .from(quarantineItem)
      .where(and(eq(quarantineItem.tenantId, ctx.tenantId), eq(quarantineItem.sha256, hash)));
    if (same.some((r) => r.status === 'CLEARED')) return true;
    if (!same.some((r) => r.status === 'PENDING_SCAN' && r.userId === ctx.userId)) {
      await tx.insert(quarantineItem).values({
        tenantId: ctx.tenantId,
        source: up.source,
        name: up.name.slice(0, 200),
        sizeBytes: up.bytes.length,
        sha256: hash,
        status: 'PENDING_SCAN',
        userId: ctx.userId,
        heldContent: await sealText(tx, ctx.tenantId, 'DATA', up.bytes.toString('base64'), {
          context: 'upload-hold',
          now: d.clock.now(),
        }),
        createdAt: d.clock.now(),
      });
      await d.audit.record(tx, ctx, {
        action: 'upload.held_pending_scan',
        entityType: 'upload',
        entityId,
        after: { source: up.source, name: up.name.slice(0, 80), sha256: hash },
        result: 'DENIED',
      });
    }
    return false;
  });
  if (cleared) return;
  // thrown after the transaction has committed, so the held record is kept
  throw new AppError(
    503,
    'PENDING_SCAN',
    'The malware scanner is not available, so the upload is held as PENDING_SCAN and is not available yet. It is used only once it has been scanned; try again after an administrator has rescanned it.',
  );
}

/** Rescans a held upload: clean items are CLEARED (a retry of the same content then passes), infected ones are quarantined. */
export async function rescanHeld(
  tx: Tx,
  d: GateDeps,
  ctx: RequestContext,
  id: string,
): Promise<typeof quarantineItem.$inferSelect> {
  const [row] = await tx
    .select()
    .from(quarantineItem)
    .where(and(eq(quarantineItem.id, id), eq(quarantineItem.tenantId, ctx.tenantId)));
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Item not found');
  if (row.status !== 'PENDING_SCAN' || !row.heldContent)
    throw new AppError(409, 'INVALID_STATE', 'Only an upload held as PENDING_SCAN can be rescanned');
  const mode = (await loadSettings(tx, ctx.tenantId)).uploadScanning.scannerMode;
  if (mode === 'DOWN')
    throw new AppError(
      409,
      'SCANNER_DOWN',
      'The scanner is still down. Bring it back (UP) before rescanning.',
    );
  const bytes = Buffer.from(await openText(tx, ctx.tenantId, row.heldContent, 'upload-hold'), 'base64');
  const v = scanUpload(bytes, row.name);
  const bad = !v.clean;
  const [u] = await tx
    .update(quarantineItem)
    .set({
      status: bad ? 'QUARANTINED' : 'CLEARED',
      signature: v.signature,
      heldContent: null,
      scannedAt: d.clock.now(),
      scannedBy: ctx.userId,
    })
    .where(eq(quarantineItem.id, id))
    .returning();
  await d.audit.record(tx, ctx, {
    action: bad ? 'upload.rescan_infected' : 'upload.rescan_clean',
    entityType: 'quarantine_item',
    entityId: id,
    after: { signature: v.signature, status: u!.status },
  });
  if (bad)
    await notifyAdmins(
      tx,
      d,
      ctx.tenantId,
      'Malware detected in a held upload',
      `A held upload was scanned and quarantined (${v.signature}).`,
    );
  return u!;
}

const SKIP = new Set(['GET', 'HEAD', 'OPTIONS', 'DELETE']);

/** Installs the hook. Call before any route is registered. */
export function installUploadGate(app: FastifyInstance, d: GateDeps): void {
  const pre = async (req: FastifyRequest, _reply: FastifyReply) => {
    const named = (req.params as { name?: unknown } | undefined)?.name;
    const found = findUploads(req.body, 0, typeof named === 'string' ? named : 'upload');
    if (found.length === 0) return;
    const source = `${req.method} ${req.routeOptions.url ?? req.url}`;
    const entityId = (req.params as { id?: string } | undefined)?.id ?? null;
    for (const f of found) {
      if (!req.auth) {
        // no one is signed in to attribute it to: refuse, keep nothing
        const v = scanUpload(f.bytes, f.name);
        if (!v.clean)
          throw new AppError(
            422,
            'VIRUS_DETECTED',
            'The upload was refused: the malware scan found a problem.',
          );
        continue;
      }
      await gateUpload(d, req.auth.ctx, { source, name: f.name, bytes: f.bytes, entityId });
    }
  };
  app.addHook('onRoute', (opts) => {
    const methods = ([] as string[]).concat(opts.method as string | string[]);
    if (methods.every((m) => SKIP.has(m))) return;
    const existing = opts.preHandler ? ([] as unknown[]).concat(opts.preHandler) : [];
    opts.preHandler = [...existing, pre] as typeof opts.preHandler;
  });
}
