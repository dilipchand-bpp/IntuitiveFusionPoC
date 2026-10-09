/**
 * Contract OCR ingestion service (CP-07): reads uploads (files or a zip), recognises each document, extracts fields and clauses,
 * keeps the result for review. Database access goes through the caller's transaction so row level security applies.
 * Every upload passes the malware gate (modules/b11enc/upload-gate.ts): the route's body hook scans each file, and each entry of
 * a zip is scanned here as well, one by one, because a compressed entry hides its content from the scan of the archive.
 */
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import type { Clock } from '@if/shared';
import type { AuditService } from '../../audit/audit-service.js';
import type { AuthContext } from '../../auth/guard.js';
import { withContext, type Database, type Tx } from '../../db/client.js';
import {
  cpOcrBatch,
  cpOcrClauseType,
  cpOcrConfig,
  cpOcrCorrection,
  cpOcrDocument,
  type OcrKind,
} from '../../db/schema.js';
import { AppError } from '../../http/errors.js';
import { gateUpload } from '../b11enc/upload-gate.js';
import { iso } from '../contract/dates.js';
import { DEFAULT_LIBRARY, countsBySeverity } from './clauselib.js';
import { OcrUnavailable, recogniseDocument, sniff } from './engine.js';
import { analyse, applyCorrection, coerceCorrection, reassess } from './pipeline.js';
import type { DetectedClause, ExtractedField, FieldKey, Finding, LibraryClause, OcrPage } from './types.js';
import { ArchiveError, readZip } from './zip.js';

export interface OcrDeps {
  database: Database;
  clock: Clock;
  audit: AuditService;
}

export const SOURCE_SYSTEM = 'Contract OCR (CP-07)';
export const MAX_FILES_PER_UPLOAD = 20;
export const MAX_DOCUMENTS_PER_UPLOAD = 100;
export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const DEFAULT_THRESHOLD = 0.8;

type DocRow = typeof cpOcrDocument.$inferSelect;

// ------------------------------------------------------------------ configuration and library

export async function loadThreshold(tx: Tx, tenantId: string): Promise<number> {
  const [c] = await tx.select().from(cpOcrConfig).where(eq(cpOcrConfig.tenantId, tenantId));
  return c ? Number(c.reviewThreshold) : DEFAULT_THRESHOLD;
}

export async function loadLibrary(
  tx: Tx,
  tenantId: string,
): Promise<{ clauses: LibraryClause[]; source: 'DEFAULT' | 'TENANT' }> {
  const rows = await tx
    .select()
    .from(cpOcrClauseType)
    .where(eq(cpOcrClauseType.tenantId, tenantId))
    .orderBy(asc(cpOcrClauseType.position), asc(cpOcrClauseType.key));
  if (rows.length === 0) return { clauses: DEFAULT_LIBRARY, source: 'DEFAULT' };
  return {
    source: 'TENANT',
    clauses: rows.map((r) => ({
      key: r.key,
      title: r.title,
      mandatory: r.mandatory,
      risk: r.risk,
      keywords: r.keywords as string[],
      standardText: r.standardText,
      active: r.active,
    })),
  };
}

// ------------------------------------------------------------------ reading the upload

export interface Prepared {
  name: string;
  entryPath: string | null;
  bytes: Buffer;
  kind: OcrKind;
  sidecar?: Buffer | undefined;
}
export interface Skipped {
  name: string;
  reason: string;
}

const baseName = (n: string) => n.replace(/\\/g, '/').split('/').pop()!.slice(0, 200) || 'upload';
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** Expands zips and screens each entry; returns the documents to recognise and what was skipped (and why). */
export async function prepareInputs(
  d: OcrDeps,
  a: AuthContext,
  files: Array<{ name: string; bytes: Buffer }>,
): Promise<{ docs: Prepared[]; skipped: Skipped[] }> {
  const docs: Prepared[] = [];
  const skipped: Skipped[] = [];
  const sidecars = new Map<string, Buffer>();
  const gate = (name: string, bytes: Buffer) =>
    gateUpload({ database: d.database, audit: d.audit, clock: d.clock }, a.ctx, {
      source: 'POST /contract-ingest/uploads',
      name,
      bytes,
    });
  const take = (path: string, name: string, bytes: Buffer, entry: boolean) => {
    if (/\.ocr\.json$/i.test(path)) {
      sidecars.set(path.slice(0, -9).toLowerCase(), bytes);
      return;
    }
    if (bytes.length > MAX_FILE_BYTES) {
      skipped.push({ name: path, reason: `larger than ${MAX_FILE_BYTES / 1048576} MB` });
      return;
    }
    const kind = sniff(bytes);
    if (kind === 'ZIP') skipped.push({ name: path, reason: 'nested archives are not opened' });
    else if (!kind) skipped.push({ name: path, reason: 'not a PDF, PNG, JPG or TIFF' });
    else docs.push({ name, entryPath: entry ? path : null, bytes, kind });
  };
  for (const f of files) {
    const name = baseName(f.name);
    if (sniff(f.bytes) === 'ZIP') {
      let z: ReturnType<typeof readZip>;
      try {
        z = readZip(f.bytes);
      } catch (e) {
        if (e instanceof ArchiveError) {
          await d.audit.recordOutsideTx(d.database, a.ctx, {
            action: 'cpocr.archive_refused',
            entityType: 'upload',
            after: { name: name.slice(0, 80), code: e.code, sha256: sha(f.bytes) },
            result: 'DENIED',
          });
          throw new AppError(422, e.code, `The zip was refused: ${e.message}`);
        }
        throw e;
      }
      skipped.push(...z.skipped.map((s) => ({ name: s.path, reason: s.reason })));
      for (const e of z.entries) {
        await gate(e.path, e.data);
        take(e.path, baseName(e.path), e.data, true);
      }
    } else take(name, name, f.bytes, false);
  }
  for (const doc of docs) doc.sidecar = sidecars.get((doc.entryPath ?? doc.name).toLowerCase());
  if (docs.length > MAX_DOCUMENTS_PER_UPLOAD)
    throw new AppError(
      422,
      'TOO_MANY_DOCUMENTS',
      `At most ${MAX_DOCUMENTS_PER_UPLOAD} documents per upload.`,
    );
  return { docs, skipped };
}

// ------------------------------------------------------------------ ingest

interface Recognised {
  input: Prepared;
  sha: string;
  result:
    | { ok: true; engine: string; simulated: boolean; scanned: boolean; pages: OcrPage[]; warnings: string[] }
    | { ok: false; message: string };
}

async function recogniseAll(docs: Prepared[]): Promise<Recognised[]> {
  const out: Recognised[] = [];
  for (const input of docs) {
    try {
      const r = await recogniseDocument({
        name: input.name,
        bytes: input.bytes,
        kind: input.kind,
        sidecar: input.sidecar,
      });
      const chars = r.pages.reduce((n, p) => n + p.text.trim().length, 0);
      if (chars === 0) throw new OcrUnavailable('No text could be read from the document.');
      out.push({ input, sha: sha(input.bytes), result: { ok: true, ...r } });
    } catch (e) {
      out.push({
        input,
        sha: sha(input.bytes),
        result: {
          ok: false,
          message: e instanceof OcrUnavailable ? e.message : 'The document could not be read.',
        },
      });
    }
  }
  return out;
}

export async function ingest(
  d: OcrDeps,
  a: AuthContext,
  prepared: { docs: Prepared[]; skipped: Skipped[] },
  origin: 'UPLOAD' | 'SAMPLE',
  note?: string,
) {
  if (prepared.docs.length === 0)
    throw new AppError(
      422,
      'NO_DOCUMENTS',
      `Nothing to read: no PDF, PNG, JPG or TIFF was found.${prepared.skipped.length ? ` Skipped: ${prepared.skipped.map((s) => `${s.name} (${s.reason})`).join('; ')}` : ''}`,
    );
  const recognised = await recogniseAll(prepared.docs);
  const now = d.clock.now();
  return withContext(d.database, a.ctx, async (tx) => {
    const tenantId = a.user.tenantId;
    const threshold = await loadThreshold(tx, tenantId);
    const library = (await loadLibrary(tx, tenantId)).clauses;
    const today = iso(now);
    const [batch] = await tx
      .insert(cpOcrBatch)
      .values({
        tenantId,
        createdBy: a.user.id,
        origin,
        fileCount: prepared.docs.length,
        skipped: prepared.skipped,
        ...(note ? { note } : {}),
        createdAt: now,
      })
      .returning();
    const ids: string[] = [];
    for (const r of recognised) {
      const base = {
        tenantId,
        batchId: batch!.id,
        fileName: r.input.name,
        entryPath: r.input.entryPath,
        kind: r.input.kind,
        sizeBytes: r.input.bytes.length,
        sha256: r.sha,
        reviewThreshold: String(threshold),
        createdAt: now,
        updatedAt: now,
      };
      // the same file ingested before (not rejected, not failed): flagged, and a commit must say it is meant
      const [dup] = await tx
        .select({ id: cpOcrDocument.id })
        .from(cpOcrDocument)
        .where(
          and(
            eq(cpOcrDocument.tenantId, tenantId),
            eq(cpOcrDocument.sha256, r.sha),
            inArray(cpOcrDocument.status, ['NEEDS_REVIEW', 'READY', 'COMMITTED']),
          ),
        )
        .orderBy(asc(cpOcrDocument.createdAt))
        .limit(1);
      let row: DocRow;
      if (!r.result.ok) {
        row = await tx
          .insert(cpOcrDocument)
          .values({ ...base, engine: 'none', status: 'FAILED', failure: r.result.message })
          .returning()
          .then((x) => x[0]!);
      } else {
        const an = analyse(r.result.pages, library, threshold, today);
        const conf = r.result.pages.reduce((s, p) => s + p.confidence, 0) / r.result.pages.length;
        row = await tx
          .insert(cpOcrDocument)
          .values({
            ...base,
            engine: r.result.engine,
            simulated: r.result.simulated,
            pageCount: r.result.pages.length,
            pages: r.result.pages,
            ocrConfidence: conf.toFixed(3),
            status: an.status,
            fields: an.fields,
            clauses: an.clauses,
            findings: an.findings,
            duplicateOf: dup?.id ?? null,
          })
          .returning()
          .then((x) => x[0]!);
      }
      ids.push(row!.id);
      await d.audit.record(tx, a.ctx, {
        action: 'cpocr.document_ingested',
        entityType: 'cp_ocr_document',
        entityId: row!.id,
        after: {
          batchId: batch!.id,
          file: r.input.name.slice(0, 80),
          kind: r.input.kind,
          engine: row!.engine,
          simulated: row!.simulated,
          status: row!.status,
          sha256: r.sha,
          duplicateOf: row!.duplicateOf,
        },
        result: row!.status === 'FAILED' ? 'FAILED' : 'SUCCESS',
      });
    }
    await d.audit.record(tx, a.ctx, {
      action: 'cpocr.batch_upload',
      entityType: 'cp_ocr_batch',
      entityId: batch!.id,
      after: { origin, documents: ids.length, skipped: prepared.skipped.length },
    });
    return batchView(tx, tenantId, batch!.id);
  });
}

// ------------------------------------------------------------------ views

const num = (v: string | number | null) => (v === null ? null : Number(v));
const valueOf = <T = unknown>(fields: ExtractedField[], key: FieldKey): T | null => {
  const f = fields.find((x) => x.key === key);
  return f && f.status !== 'NOT_FOUND' ? (f.value as T | null) : null;
};

export function summaryOf(r: DocRow) {
  const fields = r.fields as ExtractedField[];
  const findings = r.findings as Finding[];
  const clauses = r.clauses as DetectedClause[];
  const val = valueOf<{ amount: number; currency: string }>(fields, 'value');
  return {
    id: r.id,
    batchId: r.batchId,
    fileName: r.fileName,
    entryPath: r.entryPath,
    kind: r.kind,
    engine: r.engine,
    simulated: r.simulated,
    pageCount: r.pageCount,
    ocrConfidence: num(r.ocrConfidence),
    status: r.status,
    failure: r.failure,
    title: valueOf<string>(fields, 'title'),
    contractNumber: valueOf<string>(fields, 'contractNumber'),
    supplier: valueOf<string>(fields, 'supplier'),
    endDate: valueOf<string>(fields, 'endDate'),
    value: val,
    fieldsFound: fields.filter((f) => f.status !== 'NOT_FOUND').length,
    fieldsTotal: fields.length,
    needsReview: fields.filter((f) => f.needsReview).length,
    missingMandatory: clauses.filter((c) => c.mandatory && !c.found).length,
    findings: countsBySeverity(findings),
    duplicateOf: r.duplicateOf,
    contractId: r.contractId,
    supplierId: r.supplierId,
    committedAt: r.committedAt?.toISOString() ?? null,
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    label: r.simulated ? 'SIMULATED recognition' : 'Text layer read for real',
  };
}

export async function batchView(tx: Tx, tenantId: string, id: string) {
  const [b] = await tx
    .select()
    .from(cpOcrBatch)
    .where(and(eq(cpOcrBatch.id, id), eq(cpOcrBatch.tenantId, tenantId)));
  if (!b) throw new AppError(404, 'NOT_FOUND', 'Batch not found');
  const docs = await tx
    .select()
    .from(cpOcrDocument)
    .where(and(eq(cpOcrDocument.batchId, id), eq(cpOcrDocument.tenantId, tenantId)))
    .orderBy(asc(cpOcrDocument.createdAt), asc(cpOcrDocument.fileName));
  const n = (s: DocRow['status']) => docs.filter((x) => x.status === s).length;
  return {
    id: b.id,
    origin: b.origin,
    createdBy: b.createdBy,
    createdAt: b.createdAt.toISOString(),
    note: b.note,
    fileCount: b.fileCount,
    skipped: b.skipped as Skipped[],
    counts: {
      documents: docs.length,
      needsReview: n('NEEDS_REVIEW'),
      ready: n('READY'),
      committed: n('COMMITTED'),
      rejected: n('REJECTED'),
      failed: n('FAILED'),
    },
    documents: docs.map(summaryOf),
  };
}

export async function listBatches(tx: Tx, tenantId: string, limit = 50) {
  const rows = await tx
    .select()
    .from(cpOcrBatch)
    .where(eq(cpOcrBatch.tenantId, tenantId))
    .orderBy(desc(cpOcrBatch.createdAt))
    .limit(limit);
  const docs = rows.length
    ? await tx
        .select({ batchId: cpOcrDocument.batchId, status: cpOcrDocument.status })
        .from(cpOcrDocument)
        .where(
          and(
            eq(cpOcrDocument.tenantId, tenantId),
            inArray(
              cpOcrDocument.batchId,
              rows.map((r) => r.id),
            ),
          ),
        )
    : [];
  return rows.map((b) => {
    const mine = docs.filter((x) => x.batchId === b.id);
    const n = (s: string) => mine.filter((x) => x.status === s).length;
    return {
      id: b.id,
      origin: b.origin,
      createdAt: b.createdAt.toISOString(),
      createdBy: b.createdBy,
      note: b.note,
      documents: mine.length,
      needsReview: n('NEEDS_REVIEW'),
      ready: n('READY'),
      committed: n('COMMITTED'),
      rejected: n('REJECTED'),
      failed: n('FAILED'),
      skipped: (b.skipped as Skipped[]).length,
    };
  });
}

export async function loadDoc(tx: Tx, tenantId: string, id: string): Promise<DocRow> {
  const [r] = await tx
    .select()
    .from(cpOcrDocument)
    .where(and(eq(cpOcrDocument.id, id), eq(cpOcrDocument.tenantId, tenantId)));
  if (!r) throw new AppError(404, 'NOT_FOUND', 'Document not found');
  return r;
}

export async function documentView(tx: Tx, tenantId: string, r: DocRow, matches: unknown) {
  const corrections = await tx
    .select()
    .from(cpOcrCorrection)
    .where(and(eq(cpOcrCorrection.documentId, r.id), eq(cpOcrCorrection.tenantId, tenantId)))
    .orderBy(asc(cpOcrCorrection.correctedAt));
  return {
    ...summaryOf(r),
    reviewThreshold: Number(r.reviewThreshold),
    sha256: r.sha256,
    pages: r.pages as OcrPage[],
    fields: r.fields as ExtractedField[],
    clauses: r.clauses as DetectedClause[],
    findings: r.findings as Finding[],
    corrections: corrections.map((c) => ({
      id: c.id,
      fieldKey: c.fieldKey,
      before: c.before,
      after: c.after,
      reason: c.reason,
      correctedBy: c.correctedBy,
      correctedAt: c.correctedAt.toISOString(),
    })),
    commitSummary: r.commitSummary,
    rejectReason: r.rejectReason,
    version: r.version,
    matches,
    engineLabel: r.simulated
      ? 'SIMULATED recognition: text read from a synthetic fixture, not from the pixels'
      : 'Text layer of the PDF read for real (rules-simulated-v1 extraction)',
  };
}

// ------------------------------------------------------------------ review

export interface Correction {
  key: FieldKey;
  value?: unknown;
  reason?: string | undefined;
}

export async function reviewDocument(
  d: OcrDeps,
  a: AuthContext,
  tx: Tx,
  id: string,
  body: { corrections: Correction[]; accept?: boolean | FieldKey[] | undefined },
) {
  const r = await loadDoc(tx, a.user.tenantId, id);
  if (r.status !== 'NEEDS_REVIEW' && r.status !== 'READY')
    throw new AppError(
      409,
      'INVALID_STATE',
      `A ${r.status.toLowerCase().replace('_', ' ')} document can no longer be reviewed`,
    );
  const now = d.clock.now();
  const threshold = Number(r.reviewThreshold);
  let fields = (r.fields as ExtractedField[]).map((f) => ({ ...f }));
  const seen = new Set<string>();
  for (const c of body.corrections) {
    if (seen.has(c.key))
      throw new AppError(400, 'VALIDATION_FAILED', 'A field can be corrected once per review', [
        { field: c.key, message: 'Duplicate' },
      ]);
    seen.add(c.key);
    const i = fields.findIndex((f) => f.key === c.key);
    if (i < 0)
      throw new AppError(422, 'CORRECTION_INVALID', 'Unknown field', [
        { field: c.key, message: 'Unknown field' },
      ]);
    const old = fields[i]!;
    const value = coerceCorrection(c.key, c.value, old);
    const next = applyCorrection(old, value, c.reason);
    fields[i] = next;
    await tx.insert(cpOcrCorrection).values({
      tenantId: a.user.tenantId,
      documentId: id,
      fieldKey: c.key,
      before: { value: old.value, display: old.display, confidence: old.confidence, status: old.status },
      after: { value, display: next.display },
      reason: c.reason ?? null,
      correctedBy: a.user.id,
      correctedAt: now,
    });
    await d.audit.record(tx, a.ctx, {
      action: 'cpocr.field_correct',
      entityType: 'cp_ocr_document',
      entityId: id,
      before: { value: old.value, display: old.display, confidence: old.confidence },
      after: { field: c.key, value, display: next.display, reason: c.reason ?? null },
    });
  }
  // accepting says "I looked at this and it is right as read": it clears the review need but keeps the confidence figure
  const acceptKeys = new Set<FieldKey>(
    body.accept === true
      ? fields.filter((f) => f.needsReview).map((f) => f.key)
      : Array.isArray(body.accept)
        ? body.accept
        : [],
  );
  const accepted: FieldKey[] = [];
  fields = fields.map((f) => {
    if (acceptKeys.has(f.key) && !f.reviewed) {
      if (f.status === 'NOT_FOUND' && f.required)
        throw new AppError(
          422,
          'CANNOT_ACCEPT_MISSING',
          'A required field that was not found cannot be accepted: enter its value',
          [{ field: f.key, message: 'Enter a value' }],
        );
      accepted.push(f.key);
      return { ...f, reviewed: true };
    }
    return f;
  });
  const re = reassess(fields, r.clauses as DetectedClause[], threshold, iso(now));
  const [u] = await tx
    .update(cpOcrDocument)
    .set({
      fields: re.fields,
      findings: re.findings,
      status: re.status,
      reviewedBy: a.user.id,
      reviewedAt: now,
      updatedAt: now,
      version: r.version + 1,
    })
    .where(and(eq(cpOcrDocument.id, id), eq(cpOcrDocument.version, r.version)))
    .returning();
  if (!u)
    throw new AppError(
      409,
      'STALE',
      'The document changed while you were reviewing it; reload and try again',
    );
  await d.audit.record(tx, a.ctx, {
    action: 'cpocr.review',
    entityType: 'cp_ocr_document',
    entityId: id,
    before: { status: r.status },
    after: {
      status: u.status,
      corrected: [...seen],
      accepted,
      stillNeedsReview: re.fields.filter((f) => f.needsReview).map((f) => f.key),
    },
  });
  return u;
}

export async function rejectDocument(d: OcrDeps, a: AuthContext, tx: Tx, id: string, reason: string) {
  const r = await loadDoc(tx, a.user.tenantId, id);
  if (r.status === 'COMMITTED' || r.status === 'REJECTED')
    throw new AppError(409, 'INVALID_STATE', `A ${r.status.toLowerCase()} document cannot be rejected`);
  const now = d.clock.now();
  const [u] = await tx
    .update(cpOcrDocument)
    .set({
      status: 'REJECTED',
      rejectReason: reason,
      reviewedBy: a.user.id,
      reviewedAt: now,
      updatedAt: now,
      version: r.version + 1,
    })
    .where(and(eq(cpOcrDocument.id, id), eq(cpOcrDocument.version, r.version)))
    .returning();
  if (!u) throw new AppError(409, 'STALE', 'The document changed; reload and try again');
  await d.audit.record(tx, a.ctx, {
    action: 'cpocr.reject',
    entityType: 'cp_ocr_document',
    entityId: id,
    before: { status: r.status },
    after: { status: 'REJECTED', reason },
  });
  return u;
}

export async function otherDocumentsWithSameFile(tx: Tx, tenantId: string, r: DocRow) {
  return tx
    .select({ id: cpOcrDocument.id, status: cpOcrDocument.status, fileName: cpOcrDocument.fileName })
    .from(cpOcrDocument)
    .where(
      and(
        eq(cpOcrDocument.tenantId, tenantId),
        eq(cpOcrDocument.sha256, r.sha256),
        ne(cpOcrDocument.id, r.id),
      ),
    );
}
