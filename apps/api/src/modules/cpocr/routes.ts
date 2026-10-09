/**
 * Contract OCR and extraction routes (CP-07, module cpocr). Upload (files or a zip), batches and documents, human review of
 * low-confidence fields, commit to the contract record, the clause library, configuration and the report across ingested
 * contracts. The OCR is real for PDF text layers and SIMULATED for images and scanned PDFs (engine.ts, docs/swap-points.md).
 * Uploads arrive as JSON with base64 content like every other upload in the platform, so the one malware scan hook covers them.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { guard, type GuardDeps } from '../../auth/guard.js';
import { withContext } from '../../db/client.js';
import { cpOcrClauseType, cpOcrConfig, cpOcrDocument, contract, supplier } from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { toBaseAmount } from '../b9/fx-routes.js';
import { iso } from '../contract/dates.js';
import { commitDocument, matchesFor } from './commit.js';
import { MINOR_AT, STANDARD_AT } from './clauselib.js';
import { FIELD_DEFS } from './extract.js';
import { REPORT_DEFAULT_DAYS, buildReport, itemFromFields, type ReportItem } from './report.js';
import { SAMPLE_DEFS, buildSample } from './samples.js';
import {
  DEFAULT_THRESHOLD,
  MAX_FILES_PER_UPLOAD,
  MAX_FILE_BYTES,
  batchView,
  documentView,
  ingest,
  listBatches,
  loadDoc,
  loadLibrary,
  loadThreshold,
  prepareInputs,
  rejectDocument,
  reviewDocument,
  type OcrDeps,
} from './service.js';
import type { DetectedClause, ExtractedField, FieldKey } from './types.js';

const INGESTERS = ['LEGAL', 'CONTRACT_MGR', 'PROCUREMENT'] as const;
const READERS = [...INGESTERS, 'EXEC', 'FINANCE', 'PROBITY'] as const;
const LIBRARY_MANAGERS = ['LEGAL', 'CONTRACT_MGR'] as const;

const uuid = z.string().uuid();
const idParam = z.object({ id: uuid });
const FIELD_KEYS = FIELD_DEFS.map((f) => f.key) as [FieldKey, ...FieldKey[]];

const uploadBody = z
  .object({
    files: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(200),
            contentBase64: z
              .string()
              .min(8)
              .max(Math.ceil((MAX_FILE_BYTES * 4) / 3) + 16),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_FILES_PER_UPLOAD),
    note: z.string().trim().max(200).optional(),
  })
  .strict();
const sampleBody = z.object({ keys: z.array(z.string().max(60)).min(1).max(10) }).strict();
const reviewBody = z
  .object({
    corrections: z
      .array(
        z
          .object({
            key: z.enum(FIELD_KEYS),
            value: z.unknown(),
            reason: z.string().trim().max(300).optional(),
          })
          .strict(),
      )
      .max(30)
      .default([]),
    accept: z.union([z.boolean(), z.array(z.enum(FIELD_KEYS)).max(30)]).optional(),
  })
  .strict();
const commitBody = z
  .object({
    mode: z.enum(['AUTO', 'CREATE', 'LINK']).default('AUTO'),
    contractId: uuid.optional(),
    supplierId: uuid.optional(),
    createSupplier: z.boolean().optional(),
    allowDuplicate: z.boolean().optional(),
    ownerId: uuid.optional(),
  })
  .strict();
const rejectBody = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
const libraryBody = z
  .object({
    clauses: z
      .array(
        z
          .object({
            key: z
              .string()
              .regex(/^[A-Z][A-Z0-9_]{1,39}$/, 'Use capitals, digits and underscores, such as DATA_LOCATION'),
            title: z.string().trim().min(2).max(80),
            mandatory: z.boolean(),
            risk: z.enum(['LOW', 'MEDIUM', 'HIGH']),
            keywords: z.array(z.string().trim().min(2).max(60)).min(1).max(30),
            standardText: z.string().trim().min(10).max(2000),
            active: z.boolean().default(true),
          })
          .strict(),
      )
      .min(1)
      .max(40),
  })
  .strict();
const configBody = z.object({ reviewThreshold: z.number().min(0.5).max(0.99) }).strict();
const reportQuery = z
  .object({
    days: z.coerce.number().int().min(1).max(1825).default(REPORT_DEFAULT_DAYS),
    scope: z.enum(['all', 'committed']).default('all'),
  })
  .strict();
const batchQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });

export function registerCpOcr(app: FastifyInstance, p: string, d: GuardDeps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);
  const od: OcrDeps = { database: d.database, clock: d.clock, audit: d.audit };

  // ------------------------------------------------------------ upload
  reg('POST', '/contract-ingest/uploads');
  app.post(
    `${p}/contract-ingest/uploads`,
    { preHandler: guard(d, [...INGESTERS]), bodyLimit: 64 * 1024 * 1024 },
    async (req, reply) => {
      const a = req.auth!;
      const body = parse(uploadBody, req.body);
      const files = body.files.map((f) => ({ name: f.name, bytes: Buffer.from(f.contentBase64, 'base64') }));
      if (files.some((f) => f.bytes.length === 0))
        throw new AppError(400, 'VALIDATION_FAILED', 'A file is empty or not valid base64', [
          { field: 'files', message: 'Empty file' },
        ]);
      if (files.reduce((n, f) => n + f.bytes.length, 0) > 60 * 1024 * 1024)
        throw new AppError(413, 'UPLOAD_TOO_LARGE', 'The files together are larger than 60 MB');
      const prepared = await prepareInputs(od, a, files);
      const batch = await ingest(od, a, prepared, 'UPLOAD', body.note);
      return reply.status(201).send(batch);
    },
  );

  reg('GET', '/contract-ingest/samples');
  app.get(`${p}/contract-ingest/samples`, { preHandler: guard(d, [...READERS]) }, async () => ({
    synthetic: true,
    samples: SAMPLE_DEFS.map((s) => {
      const b = buildSample(s.key)!;
      return {
        key: b.key,
        fileName: b.fileName,
        title: b.title,
        description: b.description,
        kind: b.kind,
        simulated: b.simulated,
        sizeBytes: b.bytes.length,
      };
    }),
  }));

  reg('POST', '/contract-ingest/samples');
  app.post(`${p}/contract-ingest/samples`, { preHandler: guard(d, [...INGESTERS]) }, async (req, reply) => {
    const a = req.auth!;
    const body = parse(sampleBody, req.body);
    const built = body.keys.map((k) => buildSample(k));
    const unknown = body.keys.filter((_, i) => !built[i]);
    if (unknown.length) throw new AppError(404, 'NOT_FOUND', `Unknown sample: ${unknown.join(', ')}`);
    const prepared = await prepareInputs(
      od,
      a,
      built.map((b) => ({ name: b!.fileName, bytes: b!.bytes })),
    );
    return reply.status(201).send(await ingest(od, a, prepared, 'SAMPLE', 'Synthetic sample contracts'));
  });

  // ------------------------------------------------------------ batches and documents
  reg('GET', '/contract-ingest/batches');
  app.get(`${p}/contract-ingest/batches`, { preHandler: guard(d, [...READERS]) }, async (req) => {
    const a = req.auth!;
    const q = parse(batchQuery, req.query);
    return withContext(d.database, a.ctx, async (tx) => ({
      items: await listBatches(tx, a.user.tenantId, q.limit),
    }));
  });

  reg('GET', '/contract-ingest/batches/{id}');
  app.get(`${p}/contract-ingest/batches/:id`, { preHandler: guard(d, [...READERS]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(idParam, req.params);
    return withContext(d.database, a.ctx, (tx) => batchView(tx, a.user.tenantId, id));
  });

  reg('GET', '/contract-ingest/documents/{id}');
  app.get(`${p}/contract-ingest/documents/:id`, { preHandler: guard(d, [...READERS]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(idParam, req.params);
    return withContext(d.database, a.ctx, async (tx) => {
      const r = await loadDoc(tx, a.user.tenantId, id);
      const matches = r.status === 'FAILED' ? null : await matchesFor(tx, a.user.tenantId, r);
      return documentView(tx, a.user.tenantId, r, matches);
    });
  });

  reg('POST', '/contract-ingest/documents/{id}/review');
  app.post(
    `${p}/contract-ingest/documents/:id/review`,
    { preHandler: guard(d, [...INGESTERS]) },
    async (req) => {
      const a = req.auth!;
      const { id } = parse(idParam, req.params);
      const body = parse(reviewBody, req.body);
      return withContext(d.database, a.ctx, async (tx) => {
        const u = await reviewDocument(od, a, tx, id, body);
        return documentView(tx, a.user.tenantId, u, await matchesFor(tx, a.user.tenantId, u));
      });
    },
  );

  reg('POST', '/contract-ingest/documents/{id}/commit');
  app.post(
    `${p}/contract-ingest/documents/:id/commit`,
    { preHandler: guard(d, [...INGESTERS]) },
    async (req) => {
      const a = req.auth!;
      const { id } = parse(idParam, req.params);
      const body = parse(commitBody, req.body ?? {});
      return withContext(d.database, a.ctx, (tx) => commitDocument(od, a, tx, id, body));
    },
  );

  reg('POST', '/contract-ingest/documents/{id}/reject');
  app.post(
    `${p}/contract-ingest/documents/:id/reject`,
    { preHandler: guard(d, [...INGESTERS]) },
    async (req) => {
      const a = req.auth!;
      const { id } = parse(idParam, req.params);
      const body = parse(rejectBody, req.body);
      return withContext(d.database, a.ctx, async (tx) => {
        const u = await rejectDocument(od, a, tx, id, body.reason);
        return documentView(tx, a.user.tenantId, u, null);
      });
    },
  );

  // ------------------------------------------------------------ clause library and configuration
  reg('GET', '/contract-ingest/clause-library');
  app.get(`${p}/contract-ingest/clause-library`, { preHandler: guard(d, [...READERS]) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const lib = await loadLibrary(tx, a.user.tenantId);
      return {
        source: lib.source,
        clauses: lib.clauses,
        similarity: {
          standardAt: STANDARD_AT,
          minorDeviationAt: MINOR_AT,
          method: 'cosine similarity over stemmed words',
        },
        engine: 'rules-simulated-v1',
      };
    });
  });

  reg('PUT', '/contract-ingest/clause-library');
  app.put(
    `${p}/contract-ingest/clause-library`,
    { preHandler: guard(d, [...LIBRARY_MANAGERS]) },
    async (req) => {
      const a = req.auth!;
      const body = parse(libraryBody, req.body);
      const keys = body.clauses.map((c) => c.key);
      if (new Set(keys).size !== keys.length)
        throw new AppError(400, 'VALIDATION_FAILED', 'Each clause key must be unique', [
          { field: 'clauses', message: 'Duplicate key' },
        ]);
      return withContext(d.database, a.ctx, async (tx) => {
        const before = await loadLibrary(tx, a.user.tenantId);
        await tx.delete(cpOcrClauseType).where(eq(cpOcrClauseType.tenantId, a.user.tenantId));
        const now = d.clock.now();
        let position = 0;
        for (const c of body.clauses)
          await tx.insert(cpOcrClauseType).values({
            tenantId: a.user.tenantId,
            key: c.key,
            title: c.title,
            mandatory: c.mandatory,
            risk: c.risk,
            keywords: c.keywords,
            standardText: c.standardText,
            active: c.active,
            position: (position += 1),
            updatedBy: a.user.id,
            updatedAt: now,
          });
        await d.audit.record(tx, a.ctx, {
          action: 'cpocr.clause_library_update',
          entityType: 'cp_ocr_clause_library',
          before: { source: before.source, keys: before.clauses.map((c) => c.key) },
          after: { source: 'TENANT', keys },
        });
        const lib = await loadLibrary(tx, a.user.tenantId);
        return { source: lib.source, clauses: lib.clauses, engine: 'rules-simulated-v1' };
      });
    },
  );

  reg('GET', '/contract-ingest/config');
  app.get(`${p}/contract-ingest/config`, { preHandler: guard(d, [...READERS]) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => ({
      reviewThreshold: await loadThreshold(tx, a.user.tenantId),
      defaultThreshold: DEFAULT_THRESHOLD,
      engine: 'rules-simulated-v1',
      ocr: {
        pdf: 'Text layer read for real (unpdf)',
        images: 'SIMULATED recognition from synthetic fixtures',
      },
    }));
  });

  reg('PUT', '/contract-ingest/config');
  app.put(`${p}/contract-ingest/config`, { preHandler: guard(d, [...LIBRARY_MANAGERS]) }, async (req) => {
    const a = req.auth!;
    const body = parse(configBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const before = await loadThreshold(tx, a.user.tenantId);
      const now = d.clock.now();
      await tx
        .insert(cpOcrConfig)
        .values({
          tenantId: a.user.tenantId,
          reviewThreshold: body.reviewThreshold.toFixed(3),
          updatedBy: a.user.id,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: cpOcrConfig.tenantId,
          set: { reviewThreshold: body.reviewThreshold.toFixed(3), updatedBy: a.user.id, updatedAt: now },
        });
      await d.audit.record(tx, a.ctx, {
        action: 'cpocr.config_update',
        entityType: 'cp_ocr_config',
        before: { reviewThreshold: before },
        after: { reviewThreshold: body.reviewThreshold },
      });
      return { reviewThreshold: body.reviewThreshold, appliesTo: 'documents uploaded from now on' };
    });
  });

  // ------------------------------------------------------------ report
  reg('GET', '/contract-ingest/report');
  app.get(`${p}/contract-ingest/report`, { preHandler: guard(d, [...READERS]) }, async (req) => {
    const a = req.auth!;
    const q = parse(reportQuery, req.query);
    return withContext(d.database, a.ctx, async (tx) => {
      const tenantId = a.user.tenantId;
      const today = iso(d.clock.now());
      const rows = await tx
        .select()
        .from(cpOcrDocument)
        .where(
          and(
            eq(cpOcrDocument.tenantId, tenantId),
            inArray(
              cpOcrDocument.status,
              q.scope === 'committed' ? ['COMMITTED'] : ['NEEDS_REVIEW', 'READY', 'COMMITTED'],
            ),
          ),
        );
      // a file that was ingested twice counts once: an uncommitted copy is left out when another copy is committed or already counted
      const committedHashes = new Set(rows.filter((r) => r.status === 'COMMITTED').map((r) => r.sha256));
      const seenHash = new Set<string>();
      const docs = rows
        .slice()
        .sort(
          (x, y) =>
            Number(y.status === 'COMMITTED') - Number(x.status === 'COMMITTED') ||
            x.createdAt.getTime() - y.createdAt.getTime(),
        )
        .filter((r) => {
          if (r.status !== 'COMMITTED') {
            if (committedHashes.has(r.sha256) || seenHash.has(r.sha256)) return false;
            seenHash.add(r.sha256);
          }
          return true;
        });
      const contractIds = docs.map((r) => r.contractId).filter((x): x is string => !!x);
      const contracts = contractIds.length
        ? await tx.select().from(contract).where(inArray(contract.id, contractIds))
        : [];
      const supplierIds = docs.map((r) => r.supplierId).filter((x): x is string => !!x);
      const sups = supplierIds.length
        ? await tx.select().from(supplier).where(inArray(supplier.id, supplierIds))
        : [];
      const items: ReportItem[] = [];
      for (const r of docs) {
        const fields = r.fields as ExtractedField[];
        const f = itemFromFields(fields);
        const c = contracts.find((x) => x.id === r.contractId);
        const s = sups.find((x) => x.id === r.supplierId);
        let valueBase: number | null = null;
        if (c) valueBase = Number(c.value);
        else if (f.value)
          valueBase =
            f.value.currency === 'AUD'
              ? f.value.amount
              : await toBaseAmount(tx, tenantId, f.value.currency, f.value.amount, today).then(
                  (x) => x.base,
                  () => null,
                );
        const clauses = r.clauses as DetectedClause[];
        items.push({
          documentId: r.id,
          status: r.status as ReportItem['status'],
          contractId: r.contractId,
          contractNumber: c?.number ?? f.contractNumber,
          title: f.title ?? r.fileName,
          supplier: s?.company ?? f.supplier ?? 'Unknown supplier',
          startDate: c?.startDate ?? f.startDate,
          endDate: c?.endDate ?? f.endDate,
          noticeDays: c ? c.noticeDays : f.noticeDays,
          renewal: f.renewal,
          valueAmount: f.value?.amount ?? null,
          valueCurrency: f.value?.currency ?? null,
          valueBase,
          liabilityCap: f.cap,
          clauses: clauses.map((x) => ({
            key: x.key,
            title: x.title,
            mandatory: x.mandatory,
            found: x.found,
          })),
          liabilityClauseFound: clauses.some((x) => x.key === 'LIABILITY' && x.found),
          linked: (r.commitSummary as { mode?: string } | null)?.mode === 'LINK',
        });
      }
      return { engine: 'rules-simulated-v1', scope: q.scope, ...buildReport(items, today, q.days) };
    });
  });

  return done;
}
