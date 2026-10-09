/**
 * Historical import (CP-07): spreadsheet and CSV imports of contracts, suppliers, historical spend and catalogue prices, with
 * saved column mappings, a dry run, a commit and a per-batch rollback. It extends the CSV migration of FR-0655 to FR-0675
 * (which keeps working unchanged under /migration). A zip of historical contract FILES is handed to the contract OCR module
 * (POST /contract-ingest/uploads) with the caller's own session, and its results are shown in the same batch report.
 *
 * Files arrive as JSON with the file base64-encoded (`contentBase64`), like every other upload in this API, so they pass the one
 * upload gate (SEC-AP04, modules/b11enc/upload-gate.ts) before this code sees them. The AI parts (mapping suggestion,
 * validation) are rules-based and labelled `rules-simulated-v1`.
 */
import { createHash } from 'node:crypto';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Clock } from '@if/shared';
import type { AnalyticsStore } from '../../analytics/store.js';
import type { AuditService } from '../../audit/audit-service.js';
import { guard, type AuthContext, type GuardDeps } from '../../auth/guard.js';
import { withContext, type Tx } from '../../db/client.js';
import {
  DUPLICATE_RULES,
  HIST_ENTITIES,
  histBatch,
  histMapping,
  histRow,
  type DuplicateRule,
  type HistEntity,
} from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { toCsv } from '../reporting/csv.js';
import { loadSettings } from '../settings/settings.js';
import { ENTITY_LABEL, FIELDS, requiredFields } from './fields.js';
import { commit, dryRun, rollback, rollbackBlockers, type Blocker } from './load.js';
import { MAPPING_ENGINE, applySavedMapping, checkMapping, suggestMapping, type Mapping } from './mapping.js';
import { MAX_FILE_BYTES, SheetError, parseTable, sniffKind, buildWorkbook } from './sheet.js';
import { SAMPLE_BUILDERS, sampleCsv, sampleXlsx, templateRows } from './samples.js';
import { aggregateSpend } from './spend.js';
import { DEFAULT_ZIP_LIMITS, ZipError, listZip } from './zip.js';

export interface HistDeps extends GuardDeps {
  clock: Clock;
  audit: AuditService;
  analytics: AnalyticsStore;
}

const uuid = z.string().uuid();
/** Who prepares an import (upload, mapping, dry run) and who loads or reverses it. */
export const PREPARERS = ['ADMIN', 'CONTRACT_MGR'] as const;
export const COMMITTERS = ['ADMIN'] as const;
export const SPEND_READERS = ['ADMIN', 'CONTRACT_MGR', 'EXEC', 'FINANCE', 'PROCUREMENT'] as const;

const entityEnum = z.enum(HIST_ENTITIES);
const ruleEnum = z.enum(DUPLICATE_RULES);
const uploadBody = z
  .object({
    entity: z.enum([...HIST_ENTITIES, 'CONTRACT_FILES'] as const),
    filename: z.string().trim().min(1).max(200),
    sourceSystem: z.string().trim().min(2).max(60),
    contentBase64: z
      .string()
      .min(8)
      .max(Math.ceil((MAX_FILE_BYTES * 4) / 3) + 16),
    sheet: z.string().trim().min(1).max(60).optional(),
  })
  .strict();
const mappingBody = z
  .object({
    mapping: z.record(z.string().max(60), z.string().max(200).nullable()),
    duplicateRule: ruleEnum.optional(),
    saveForSource: z.boolean().optional(),
  })
  .strict();
const dryRunBody = z.object({ duplicateRule: ruleEnum.optional() }).strict();
const commitBody = z.object({ confirm: z.literal(true), duplicateRule: ruleEnum.optional() }).strict();
const rollbackBody = z.object({ reason: z.string().trim().min(5).max(500) }).strict();
const rowsQuery = z.object({
  rows: z.enum(['none', 'problems', 'all']).default('problems'),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
  offset: z.coerce.number().int().min(0).default(0),
});

type Batch = typeof histBatch.$inferSelect;
type HRow = typeof histRow.$inferSelect;

const OCR_UNAVAILABLE =
  'OCR capability not available: the contract ingestion module (POST /contract-ingest/uploads) is not installed in this deployment, so the contract files were not read.';

function fileOf(b64: string): Buffer {
  const clean = b64.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean) || clean.length % 4 !== 0)
    throw new AppError(422, 'VALIDATION_FAILED', 'The file is not valid base64', [
      { field: 'contentBase64', message: 'Send the file content base64-encoded' },
    ]);
  return Buffer.from(clean, 'base64');
}

const rowView = (r: HRow) => ({
  rowNo: r.rowNo,
  status: r.status,
  raw: r.raw as Record<string, string>,
  values: r.normalised as Record<string, string | number | null> | null,
  issues: r.issues as Array<{ rule: string; field?: string; message: string; value?: string }>,
  warnings: r.warnings as Array<{ rule: string; field?: string; message: string }>,
  duplicate: r.duplicate as { kind: string; label: string; reason: string; ofRow?: number } | null,
  ...(r.createdRef ? { ref: r.createdRef } : {}),
});

async function batchOf(tx: Tx, tenantId: string, id: string): Promise<Batch> {
  const [b] = await tx
    .select()
    .from(histBatch)
    .where(and(eq(histBatch.id, id), eq(histBatch.tenantId, tenantId)));
  if (!b) throw new AppError(404, 'NOT_FOUND', 'Import batch not found');
  return b;
}

async function batchView(
  tx: Tx,
  b: Batch,
  q: { rows: 'none' | 'problems' | 'all'; limit: number; offset: number } = {
    rows: 'none',
    limit: 200,
    offset: 0,
  },
  opts: { live?: { ocr?: unknown } } = {},
) {
  const all = await tx.select().from(histRow).where(eq(histRow.batchId, b.id)).orderBy(asc(histRow.rowNo));
  const problems = all.filter(
    (r) => (r.issues as unknown[]).length > 0 || (r.warnings as unknown[]).length > 0,
  );
  const slice = (q.rows === 'all' ? all : q.rows === 'problems' ? problems : []).slice(
    q.offset,
    q.offset + q.limit,
  );
  let rollbackInfo: { possible: boolean; blockers: Blocker[] } | undefined;
  if (b.status === 'COMMITTED') {
    const blockers = await rollbackBlockers(tx, b);
    rollbackInfo = { possible: blockers.length === 0, blockers: blockers.slice(0, 20) };
  }
  return {
    id: b.id,
    entity: b.entity,
    entityLabel: b.entity === 'CONTRACT_FILES' ? 'Contract files' : ENTITY_LABEL[b.entity as HistEntity],
    filename: b.filename,
    sourceSystem: b.sourceSystem,
    fileKind: b.fileKind,
    sheetName: b.sheetName,
    status: b.status,
    rowCount: b.rowCount,
    headers: b.headers as string[],
    mapping: b.mapping as Mapping,
    duplicateRule: b.duplicateRule,
    parseWarnings: b.parseWarnings as string[],
    summary: b.summary,
    commitSummary: b.commitSummary,
    ...(b.entity === 'CONTRACT_FILES'
      ? { ocr: opts.live?.ocr ?? b.ocrResult, ocrBatchId: b.ocrBatchId }
      : {}),
    createdAt: b.createdAt.toISOString(),
    ...(b.dryRunAt ? { dryRunAt: b.dryRunAt.toISOString() } : {}),
    ...(b.committedAt ? { committedAt: b.committedAt.toISOString() } : {}),
    ...(b.rolledBackAt ? { rolledBackAt: b.rolledBackAt.toISOString(), rollbackNote: b.rollbackNote } : {}),
    ...(rollbackInfo ? { rollback: rollbackInfo } : {}),
    preview: all.slice(0, 5).map((r) => r.raw as Record<string, string>),
    rows: slice.map(rowView),
    rowsTotal: q.rows === 'all' ? all.length : q.rows === 'problems' ? problems.length : 0,
  };
}

export function registerHistoryImportRoutes(app: FastifyInstance, p: string, d: HistDeps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);
  const refreshAnalytics = async (tenantId: string) => {
    try {
      await d.analytics.refresh(d.database, tenantId, d.clock.now());
    } catch (e) {
      app.log.warn({ err: e }, 'analytics refresh after a historical import failed');
    }
  };

  // ---------------------------------------------------------------- what can be imported
  reg('GET', '/history-import/entities');
  app.get(`${p}/history-import/entities`, { preHandler: guard(d, [...PREPARERS]) }, async () =>
    HIST_ENTITIES.map((e) => ({
      entity: e,
      label: ENTITY_LABEL[e],
      engine: MAPPING_ENGINE,
      fields: FIELDS[e].map((f) => ({
        key: f.key,
        label: f.label,
        required: f.required,
        type: f.type,
        ...(f.allowed ? { allowed: f.allowed } : {}),
        ...(f.hint ? { hint: f.hint } : {}),
      })),
    })),
  );

  reg('GET', '/history-import/templates/{entity}');
  app.get(
    `${p}/history-import/templates/:entity`,
    { preHandler: guard(d, [...PREPARERS]) },
    async (req, reply) => {
      const { entity } = parse(z.object({ entity: entityEnum }), req.params);
      const { format } = parse(z.object({ format: z.enum(['csv', 'xlsx']).default('csv') }), req.query);
      const t = templateRows(entity);
      const name = `import-template-${entity.toLowerCase()}.${format}`;
      reply.header('content-disposition', `attachment; filename="${name}"`);
      if (format === 'xlsx')
        return reply
          .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          .send(buildWorkbook(ENTITY_LABEL[entity].slice(0, 31), [t.headers, ...t.rows]));
      return reply.header('content-type', 'text/csv; charset=utf-8').send(sampleCsv(t));
    },
  );

  reg('GET', '/history-import/samples');
  app.get(`${p}/history-import/samples`, { preHandler: guard(d, [...PREPARERS]) }, async () =>
    Object.values(SAMPLE_BUILDERS).map((build) => {
      const s = build();
      return {
        key: s.key,
        entity: s.entity,
        label: ENTITY_LABEL[s.entity],
        sourceSystem: s.sourceSystem,
        rows: s.rows.length,
        files: [`${s.key}.xlsx`, `${s.key}.csv`],
        loadAfter: s.entity === 'CATALOGUE' ? ['supplier-extract'] : [],
      };
    }),
  );

  reg('GET', '/history-import/samples/{file}');
  app.get(
    `${p}/history-import/samples/:file`,
    { preHandler: guard(d, [...PREPARERS]) },
    async (req, reply) => {
      const { file } = parse(z.object({ file: z.string().regex(/^[a-z-]{3,40}\.(xlsx|csv)$/) }), req.params);
      const [key, ext] = file.split('.') as [string, 'xlsx' | 'csv'];
      const build = SAMPLE_BUILDERS[key];
      if (!build) throw new AppError(404, 'NOT_FOUND', 'No such sample file');
      const s = build();
      reply.header('content-disposition', `attachment; filename="${file}"`);
      if (ext === 'xlsx')
        return reply
          .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          .send(sampleXlsx(s));
      return reply.header('content-type', 'text/csv; charset=utf-8').send(sampleCsv(s));
    },
  );

  // ---------------------------------------------------------------- upload
  reg('POST', '/history-import/uploads');
  app.post(
    `${p}/history-import/uploads`,
    { preHandler: guard(d, [...PREPARERS]), bodyLimit: 16 * 1024 * 1024 },
    async (req, reply) => {
      const a = req.auth!;
      const body = parse(uploadBody, req.body);
      const bytes = fileOf(body.contentBase64);
      if (bytes.length > MAX_FILE_BYTES)
        throw new AppError(
          422,
          'FILE_TOO_LARGE',
          `The file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB`,
        );
      const sha = createHash('sha256').update(bytes).digest('hex');

      // a zip of historical contract files goes to the OCR module
      if (body.entity === 'CONTRACT_FILES') {
        try {
          listZip(bytes, DEFAULT_ZIP_LIMITS);
        } catch (e) {
          if (e instanceof ZipError) throw new AppError(422, e.code, e.message);
          throw e;
        }
        const handoff = await handToOcr(app, p, req.headers.cookie ?? '', a, bytes, body.filename);
        const id = await withContext(d.database, a.ctx, async (tx) => {
          const [b] = await tx
            .insert(histBatch)
            .values({
              tenantId: a.user.tenantId,
              entity: 'CONTRACT_FILES',
              filename: body.filename,
              sourceSystem: body.sourceSystem,
              fileKind: 'ZIP',
              sha256: sha,
              sizeBytes: bytes.length,
              ocrBatchId: handoff.batchId ?? null,
              ocrResult: handoff.result,
              uploadedBy: a.user.id,
              createdAt: d.clock.now(),
            })
            .returning();
          await d.audit.record(tx, a.ctx, {
            action: 'history_import.ocr_handoff',
            entityType: 'hist_batch',
            entityId: b!.id,
            after: {
              filename: body.filename,
              available: handoff.available,
              ocrBatchId: handoff.batchId ?? null,
            },
          });
          return b!.id;
        });
        return reply
          .status(201)
          .send(
            await withContext(d.database, a.ctx, async (tx) =>
              batchView(tx, await batchOf(tx, a.user.tenantId, id)),
            ),
          );
      }

      const kind = sniffKind(bytes, body.filename);
      if (kind === 'ZIP')
        throw new AppError(
          422,
          'FILE_TYPE_UNSUPPORTED',
          'A zip of contract files is imported as "Contract files"; upload a spreadsheet here.',
        );
      let table;
      try {
        table = parseTable(bytes, body.filename, body.sheet);
      } catch (e) {
        if (e instanceof SheetError) throw new AppError(422, e.code, e.message);
        throw e;
      }
      const entity = body.entity as HistEntity;
      const id = await withContext(d.database, a.ctx, async (tx) => {
        const suggestion = suggestMapping(entity, table.headers, table.rows);
        let mapping: Mapping = suggestion.mapping;
        let usedSaved: string | null = null;
        const [saved] = await tx
          .select()
          .from(histMapping)
          .where(
            and(
              eq(histMapping.tenantId, a.user.tenantId),
              eq(histMapping.entity, entity),
              eq(histMapping.sourceSystem, body.sourceSystem),
            ),
          );
        let duplicateRule: DuplicateRule = 'SKIP';
        if (saved) {
          const applied = applySavedMapping(saved.mapping as Mapping, table.headers);
          const missing = requiredFields(entity).filter((k) => !applied.mapping[k]);
          if (missing.length === 0) {
            mapping = applied.mapping;
            usedSaved = saved.id;
            duplicateRule = saved.duplicateRule;
          }
        }
        const [b] = await tx
          .insert(histBatch)
          .values({
            tenantId: a.user.tenantId,
            entity,
            filename: body.filename,
            sourceSystem: body.sourceSystem,
            fileKind: table.kind,
            sheetName: table.sheetName,
            sha256: sha,
            sizeBytes: bytes.length,
            headers: table.headers,
            rowCount: table.rows.length,
            mapping,
            suggestion: { ...suggestion, usedSavedMapping: usedSaved },
            duplicateRule,
            parseWarnings: table.warnings,
            status: usedSaved ? 'MAPPED' : 'UPLOADED',
            uploadedBy: a.user.id,
            createdAt: d.clock.now(),
          })
          .returning();
        for (let i = 0; i < table.rows.length; i += 200)
          await tx.insert(histRow).values(
            table.rows.slice(i, i + 200).map((cells, k) => ({
              tenantId: a.user.tenantId,
              batchId: b!.id,
              rowNo: i + k + 1,
              raw: Object.fromEntries(table.headers.map((h, c) => [h, cells[c] ?? ''])),
            })),
          );
        await d.audit.record(tx, a.ctx, {
          action: 'history_import.upload',
          entityType: 'hist_batch',
          entityId: b!.id,
          after: {
            entity,
            filename: body.filename,
            fileKind: table.kind,
            sourceSystem: body.sourceSystem,
            rows: table.rows.length,
            sha256: sha,
            savedMappingUsed: usedSaved !== null,
            warnings: table.warnings.length,
          },
        });
        return b!.id;
      });
      return reply.status(201).send(
        await withContext(d.database, a.ctx, async (tx) => {
          const b = await batchOf(tx, a.user.tenantId, id);
          return {
            ...(await batchView(tx, b)),
            suggestion: b.suggestion,
            fields: FIELDS[entity].map((f) => ({
              key: f.key,
              label: f.label,
              required: f.required,
              type: f.type,
            })),
          };
        }),
      );
    },
  );

  // ---------------------------------------------------------------- batches
  reg('GET', '/history-import/batches');
  app.get(`${p}/history-import/batches`, { preHandler: guard(d, [...PREPARERS]) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const list = await tx
        .select()
        .from(histBatch)
        .where(eq(histBatch.tenantId, a.user.tenantId))
        .orderBy(desc(histBatch.createdAt));
      return list.map((b) => ({
        id: b.id,
        entity: b.entity,
        entityLabel: b.entity === 'CONTRACT_FILES' ? 'Contract files' : ENTITY_LABEL[b.entity as HistEntity],
        filename: b.filename,
        sourceSystem: b.sourceSystem,
        fileKind: b.fileKind,
        status: b.status,
        rowCount: b.rowCount,
        createdAt: b.createdAt.toISOString(),
        ...(b.committedAt ? { committedAt: b.committedAt.toISOString() } : {}),
        ...(b.rolledBackAt ? { rolledBackAt: b.rolledBackAt.toISOString() } : {}),
        loaded: (b.commitSummary as { loaded?: number } | null)?.loaded ?? null,
      }));
    });
  });

  reg('GET', '/history-import/batches/{id}');
  app.get(`${p}/history-import/batches/:id`, { preHandler: guard(d, [...PREPARERS]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    const q = parse(rowsQuery, req.query);
    const first = await withContext(d.database, a.ctx, (tx) => batchOf(tx, a.user.tenantId, id));
    // a batch of contract files shows the OCR module's current results
    let liveOcr: unknown;
    if (first.entity === 'CONTRACT_FILES' && first.ocrBatchId) {
      const r = await app.inject({
        method: 'GET',
        url: `${p}/contract-ingest/batches/${first.ocrBatchId}`,
        headers: { cookie: req.headers.cookie ?? '' },
      });
      if (r.statusCode === 200) liveOcr = trimOcr(r.json());
    }
    return withContext(d.database, a.ctx, async (tx) => {
      const b = await batchOf(tx, a.user.tenantId, id);
      return { ...(await batchView(tx, b, q, { live: { ocr: liveOcr } })), suggestion: b.suggestion };
    });
  });

  reg('GET', '/history-import/batches/{id}/errors.csv');
  app.get(
    `${p}/history-import/batches/:id/errors.csv`,
    { preHandler: guard(d, [...PREPARERS]) },
    async (req, reply) => {
      const a = req.auth!;
      const { id } = parse(z.object({ id: uuid }), req.params);
      const csv = await withContext(d.database, a.ctx, async (tx) => {
        const b = await batchOf(tx, a.user.tenantId, id);
        if (b.entity === 'CONTRACT_FILES')
          throw new AppError(409, 'INVALID_STATE', 'Contract files have no row report');
        const rows = await tx
          .select()
          .from(histRow)
          .where(eq(histRow.batchId, id))
          .orderBy(asc(histRow.rowNo));
        const mapping = b.mapping as Mapping;
        const keyField = FIELDS[b.entity as HistEntity][0]!.key;
        const lines: unknown[][] = [];
        for (const r of rows) {
          const raw = r.raw as Record<string, string>;
          const key = mapping[keyField] ? (raw[mapping[keyField]!] ?? '') : '';
          const source = Object.entries(raw)
            .map(([k, v]) => `${k}=${v}`)
            .join('; ')
            .slice(0, 400);
          for (const i of r.issues as Array<{
            rule: string;
            field?: string;
            message: string;
            value?: string;
          }>)
            lines.push([
              r.rowNo,
              key,
              i.rule.startsWith('DUPLICATE') ? 'Duplicate' : 'Error',
              i.rule,
              i.field ?? '',
              i.value ?? '',
              i.message,
              r.status,
              source,
            ]);
          for (const w of r.warnings as Array<{ rule: string; field?: string; message: string }>)
            lines.push([r.rowNo, key, 'Warning', w.rule, w.field ?? '', '', w.message, r.status, source]);
        }
        await d.audit.record(tx, a.ctx, {
          action: 'history_import.errors_export',
          entityType: 'hist_batch',
          entityId: id,
          after: { lines: lines.length },
        });
        return toCsv(
          ['Row', 'Key', 'Kind', 'Rule', 'Field', 'Value', 'Detail', 'Row status', 'Source values'],
          lines,
        );
      });
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="history-import-errors-${id.slice(0, 8)}.csv"`)
        .send(csv);
    },
  );

  // ---------------------------------------------------------------- mapping
  reg('PUT', '/history-import/batches/{id}/mapping');
  app.put(
    `${p}/history-import/batches/:id/mapping`,
    { preHandler: guard(d, [...PREPARERS]) },
    async (req) => {
      const a = req.auth!;
      const { id } = parse(z.object({ id: uuid }), req.params);
      const body = parse(mappingBody, req.body);
      return withContext(d.database, a.ctx, async (tx) => {
        const b = await batchOf(tx, a.user.tenantId, id);
        if (b.entity === 'CONTRACT_FILES')
          throw new AppError(409, 'INVALID_STATE', 'Contract files have no column mapping');
        if (b.status === 'COMMITTED' || b.status === 'ROLLED_BACK')
          throw new AppError(409, 'BATCH_CLOSED', 'This import has already been loaded');
        const entity = b.entity as HistEntity;
        const mapping: Mapping = Object.fromEntries(
          FIELDS[entity].map((f) => [f.key, body.mapping[f.key] ?? null]),
        );
        const problems = checkMapping(entity, { ...body.mapping }, b.headers as string[]);
        if (problems.length > 0)
          throw new AppError(422, 'VALIDATION_FAILED', 'The mapping cannot be used', problems);
        const rule = body.duplicateRule ?? b.duplicateRule;
        await tx
          .update(histBatch)
          .set({ mapping, duplicateRule: rule, status: 'MAPPED', summary: null, dryRunAt: null })
          .where(eq(histBatch.id, id));
        // a changed mapping means the rows have to be checked again
        await tx
          .update(histRow)
          .set({
            status: 'PENDING',
            normalised: null,
            issues: [],
            warnings: [],
            duplicate: null,
            createdRef: null,
          })
          .where(eq(histRow.batchId, id));
        let saved = false;
        if (body.saveForSource) {
          const now = d.clock.now();
          await tx
            .insert(histMapping)
            .values({
              tenantId: a.user.tenantId,
              entity,
              sourceSystem: b.sourceSystem,
              mapping,
              duplicateRule: rule,
              createdBy: a.user.id,
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: [histMapping.tenantId, histMapping.entity, histMapping.sourceSystem],
              set: { mapping, duplicateRule: rule, updatedAt: now },
            });
          saved = true;
        }
        await d.audit.record(tx, a.ctx, {
          action: 'history_import.mapping',
          entityType: 'hist_batch',
          entityId: id,
          before: { mapping: b.mapping as Record<string, unknown> },
          after: { mapping, duplicateRule: rule, savedForSource: saved ? b.sourceSystem : null },
        });
        return { ...(await batchView(tx, await batchOf(tx, a.user.tenantId, id))), savedForSource: saved };
      });
    },
  );

  reg('GET', '/history-import/mappings');
  app.get(`${p}/history-import/mappings`, { preHandler: guard(d, [...PREPARERS]) }, async (req) => {
    const a = req.auth!;
    const q = parse(z.object({ entity: entityEnum.optional() }), req.query);
    return withContext(d.database, a.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(histMapping)
        .where(
          q.entity
            ? and(eq(histMapping.tenantId, a.user.tenantId), eq(histMapping.entity, q.entity))
            : eq(histMapping.tenantId, a.user.tenantId),
        )
        .orderBy(asc(histMapping.sourceSystem));
      return rows.map((m) => ({
        id: m.id,
        entity: m.entity,
        sourceSystem: m.sourceSystem,
        mapping: m.mapping as Mapping,
        duplicateRule: m.duplicateRule,
        updatedAt: m.updatedAt.toISOString(),
      }));
    });
  });

  reg('DELETE', '/history-import/mappings/{id}');
  app.delete(
    `${p}/history-import/mappings/:id`,
    { preHandler: guard(d, [...PREPARERS]) },
    async (req, reply) => {
      const a = req.auth!;
      const { id } = parse(z.object({ id: uuid }), req.params);
      await withContext(d.database, a.ctx, async (tx) => {
        const gone = await tx
          .delete(histMapping)
          .where(and(eq(histMapping.id, id), eq(histMapping.tenantId, a.user.tenantId)))
          .returning();
        if (gone.length === 0) throw new AppError(404, 'NOT_FOUND', 'Saved mapping not found');
        await d.audit.record(tx, a.ctx, {
          action: 'history_import.mapping_deleted',
          entityType: 'hist_mapping',
          entityId: id,
          before: { entity: gone[0]!.entity, sourceSystem: gone[0]!.sourceSystem },
        });
      });
      return reply.status(204).send();
    },
  );

  // ---------------------------------------------------------------- dry run: checks everything, loads nothing
  reg('POST', '/history-import/batches/{id}/dry-run');
  app.post(
    `${p}/history-import/batches/:id/dry-run`,
    { preHandler: guard(d, [...PREPARERS]) },
    async (req) => {
      const a = req.auth!;
      const { id } = parse(z.object({ id: uuid }), req.params);
      const body = parse(dryRunBody, req.body ?? {});
      const q = parse(rowsQuery, req.query);
      return withContext(d.database, a.ctx, async (tx) => {
        const b = await openBatch(tx, a, id);
        const rule = body.duplicateRule ?? b.duplicateRule;
        const { summary } = await dryRun(tx, d, a.user.tenantId, b, rule);
        await d.audit.record(tx, a.ctx, {
          action: 'history_import.dry_run',
          entityType: 'hist_batch',
          entityId: id,
          after: {
            entity: b.entity,
            total: summary.total,
            valid: summary.valid,
            errors: summary.errors,
            duplicates: summary.duplicates,
          },
        });
        return batchView(tx, await batchOf(tx, a.user.tenantId, id), q);
      });
    },
  );

  // ---------------------------------------------------------------- commit
  reg('POST', '/history-import/batches/{id}/commit');
  app.post(
    `${p}/history-import/batches/:id/commit`,
    { preHandler: guard(d, [...COMMITTERS]) },
    async (req) => {
      const a = req.auth!;
      const { id } = parse(z.object({ id: uuid }), req.params);
      const body = parse(commitBody, req.body);
      const out = await withContext(d.database, a.ctx, async (tx) => {
        const b = await openBatch(tx, a, id);
        if (b.status !== 'DRY_RUN')
          throw new AppError(
            409,
            'DRY_RUN_REQUIRED',
            'Run the dry run on the current mapping before loading',
          );
        const rule = body.duplicateRule ?? b.duplicateRule;
        const sum = await commit(tx, d, a.user.tenantId, a.user.id, b, rule);
        if (sum.loaded + sum.merged === 0)
          throw new AppError(
            409,
            'NOTHING_TO_LOAD',
            'There is nothing valid to load. Correct the file and upload it again.',
          );
        await d.audit.record(tx, a.ctx, {
          action: 'history_import.commit',
          entityType: 'hist_batch',
          entityId: id,
          before: { status: 'DRY_RUN' },
          after: { status: 'COMMITTED', ...sum },
        });
        return batchView(tx, await batchOf(tx, a.user.tenantId, id));
      });
      await refreshAnalytics(a.user.tenantId);
      return out;
    },
  );

  // ---------------------------------------------------------------- rollback
  reg('POST', '/history-import/batches/{id}/rollback');
  app.post(
    `${p}/history-import/batches/:id/rollback`,
    { preHandler: guard(d, [...COMMITTERS]) },
    async (req) => {
      const a = req.auth!;
      const { id } = parse(z.object({ id: uuid }), req.params);
      const body = parse(rollbackBody, req.body);
      const out = await withContext(d.database, a.ctx, async (tx) => {
        const b = await batchOf(tx, a.user.tenantId, id);
        if (b.status !== 'COMMITTED')
          throw new AppError(409, 'INVALID_STATE', 'Only a batch that has been loaded can be rolled back');
        const sum = await rollback(tx, d, a.ctx, b, body.reason);
        await tx
          .update(histBatch)
          .set({ commitSummary: { ...(b.commitSummary as object), rollback: sum } })
          .where(eq(histBatch.id, id));
        await d.audit.record(tx, a.ctx, {
          action: 'history_import.rollback',
          entityType: 'hist_batch',
          entityId: id,
          before: { status: 'COMMITTED' },
          after: { status: 'ROLLED_BACK', reason: body.reason, ...sum },
        });
        return batchView(tx, await batchOf(tx, a.user.tenantId, id));
      });
      await refreshAnalytics(a.user.tenantId);
      return out;
    },
  );

  // ---------------------------------------------------------------- historical spend, read from the analytics store
  reg('GET', '/history-import/spend');
  app.get(`${p}/history-import/spend`, { preHandler: guard(d, [...SPEND_READERS]) }, async (req) => {
    const a = req.auth!;
    const s = await withContext(d.database, a.ctx, (tx) => loadSettings(tx, a.user.tenantId));
    const info = await d.analytics.ensureFresh(
      d.database,
      a.user.tenantId,
      d.clock.now(),
      s.analytics.refreshMinutes,
    );
    const rows = await d.analytics.query<{
      supplier: string;
      category: string;
      business_unit: string;
      amount: number;
      d: string;
    }>(
      `select supplier, category, business_unit, amount::float8 as amount, spend_date::text as d
         from fact_history_spend where tenant_id = $1`,
      [a.user.tenantId],
    );
    return {
      store: 'analytics',
      asOf: info.asOf,
      ...aggregateSpend(
        rows.map((r) => ({
          supplier: r.supplier,
          category: r.category,
          businessUnit: r.business_unit,
          amount: r.amount,
          date: r.d,
        })),
      ),
    };
  });

  return done;

  // ---------------------------------------------------------------- helpers that need the app
  async function openBatch(tx: Tx, a: AuthContext, id: string): Promise<Batch> {
    const b = await batchOf(tx, a.user.tenantId, id);
    if (b.entity === 'CONTRACT_FILES')
      throw new AppError(
        409,
        'INVALID_STATE',
        'A batch of contract files is checked and loaded in the contract ingestion module',
      );
    if (b.status === 'COMMITTED' || b.status === 'ROLLED_BACK')
      throw new AppError(409, 'BATCH_CLOSED', 'This import has already been loaded');
    const problems = checkMapping(b.entity as HistEntity, b.mapping as Mapping, b.headers as string[]);
    if (problems.length > 0)
      throw new AppError(422, 'VALIDATION_FAILED', 'The mapping is incomplete', problems);
    return b;
  }
}

// ------------------------------------------------------------------ the OCR hand-off (the module is built separately)
interface Handoff {
  available: boolean;
  batchId?: string;
  result: Record<string, unknown>;
}

const trimOcr = (j: unknown): Record<string, unknown> => {
  const o = (j ?? {}) as Record<string, unknown>;
  const docs = Array.isArray(o.documents) ? (o.documents as Array<Record<string, unknown>>) : [];
  return {
    available: true,
    id: o.id ?? null,
    status: o.status ?? null,
    documents: docs.length || (typeof o.documents === 'number' ? o.documents : (o.total ?? null)),
    items: docs.slice(0, 50).map((x) => ({
      id: x.id ?? null,
      filename: x.filename ?? x.name ?? null,
      status: x.status ?? null,
      contractId: x.contractId ?? null,
      confidence: x.confidence ?? null,
    })),
  };
};

async function handToOcr(
  app: FastifyInstance,
  p: string,
  cookie: string,
  a: AuthContext,
  bytes: Buffer,
  filename: string,
): Promise<Handoff> {
  const boundary = `----hist${createHash('sha1').update(bytes.subarray(0, 64)).digest('hex').slice(0, 16)}`;
  const safeName = filename.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120) || 'contracts.zip';
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${safeName}"\r\nContent-Type: application/zip\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await app.inject({
    method: 'POST',
    url: `${p}/contract-ingest/uploads`,
    headers: {
      cookie,
      'x-csrf-token': a.csrfToken,
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload,
  });
  if (res.statusCode === 404)
    return { available: false, result: { available: false, message: OCR_UNAVAILABLE } };
  let json: unknown;
  try {
    json = res.json();
  } catch {
    json = null;
  }
  if (res.statusCode >= 200 && res.statusCode < 300) {
    const t = trimOcr(json);
    return { available: true, ...(typeof t.id === 'string' ? { batchId: t.id } : {}), result: t };
  }
  const title = (json as { title?: string } | null)?.title ?? `HTTP ${res.statusCode}`;
  return {
    available: true,
    result: {
      available: true,
      error: true,
      status: res.statusCode,
      message: `The contract ingestion module did not accept the files: ${title}`,
    },
  };
}
