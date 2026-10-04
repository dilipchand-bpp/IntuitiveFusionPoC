/**
 * Data migration (FR-0655, FR-0660, FR-0665, FR-0670, FR-0675): legacy contract records are uploaded as a CSV extract,
 * profiled for missing fields, unparseable dates and values and duplicates, reviewed one exception at a time, and only
 * then loaded. Loaded records are linked to their originating procurement, carry a source-system flag, and are given a
 * contract management record with alerts derived from the contract text.
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Clock } from '@if/shared';
import type { AuditService } from '../../audit/audit-service.js';
import { guard, type GuardDeps } from '../../auth/guard.js';
import { withContext, type Tx } from '../../db/client.js';
import {
  appUser,
  clause,
  contract,
  fieldValue,
  migrationBatch,
  migrationRecord,
  request,
  supplier,
  tender,
} from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { iso } from '../contract/dates.js';
import { createContractRecord } from '../contract/record.js';
import { toCsv } from '../reporting/csv.js';
import {
  COLUMNS,
  REQUIRED,
  extractLegacy,
  parseAmount,
  parseCsv,
  parseDate,
  profileRow,
  type Issue,
  type Raw,
} from './rules.js';

export interface MigrationDeps extends GuardDeps {
  clock: Clock;
  audit: AuditService;
}

const uuid = z.string().uuid();
const MANAGERS = ['ADMIN', 'CONTRACT_MGR'] as const;
const MAX_ROWS = 2000;
const uploadBody = z
  .object({
    filename: z.string().trim().min(1).max(200),
    sourceSystem: z.string().trim().min(2).max(60),
    csv: z.string().min(10).max(2_000_000),
  })
  .strict();
const fixBody = z.object({ fields: z.record(z.string().max(5000)) }).strict();
const skipBody = z.object({ note: z.string().trim().min(3).max(500) }).strict();

type Rec = typeof migrationRecord.$inferSelect;

function recordView(r: Rec) {
  const raw = r.raw as Raw;
  const x = r.status === 'VALID' || r.status === 'LOADED' ? extractLegacy(raw.text) : null;
  return {
    id: r.id,
    rowNo: r.rowNo,
    status: r.status,
    contractNumber: raw.contract_number ?? '',
    title: raw.title ?? '',
    supplier: raw.supplier ?? '',
    raw,
    issues: r.issues as Issue[],
    warnings: r.warnings as string[],
    ...(x
      ? {
          extraction: {
            noticeDays: x.noticeDays,
            obligations: x.obligations.length,
            kpis: x.kpis.length,
            slas: x.slas.length,
            extensions: x.extensions,
          },
        }
      : {}),
    ...(r.reviewNote ? { reviewNote: r.reviewNote } : {}),
    ...(r.requestId ? { requestId: r.requestId } : {}),
    ...(r.contractId ? { contractId: r.contractId } : {}),
  };
}

async function batchView(tx: Tx, tenantId: string, id: string, withRecords: boolean) {
  const [b] = await tx
    .select()
    .from(migrationBatch)
    .where(and(eq(migrationBatch.id, id), eq(migrationBatch.tenantId, tenantId)));
  if (!b) throw new AppError(404, 'NOT_FOUND', 'Batch not found');
  const recs = await tx
    .select()
    .from(migrationRecord)
    .where(eq(migrationRecord.batchId, id))
    .orderBy(asc(migrationRecord.rowNo));
  const count = (s: Rec['status']) => recs.filter((r) => r.status === s).length;
  return {
    id: b.id,
    filename: b.filename,
    sourceSystem: b.sourceSystem,
    status: b.status,
    total: b.total,
    valid: count('VALID'),
    exceptions: count('EXCEPTION'),
    skipped: count('SKIPPED'),
    loaded: count('LOADED'),
    // cutover is blocked while any exception is neither corrected nor set aside with a reason (FR-0665)
    canCutover: b.status === 'VALIDATED' && count('EXCEPTION') === 0 && count('VALID') > 0,
    createdAt: b.createdAt.toISOString(),
    ...(b.cutoverAt ? { cutoverAt: b.cutoverAt.toISOString() } : {}),
    ...(withRecords ? { records: recs.map(recordView) } : {}),
  };
}

export function registerMigrationRoutes(app: FastifyInstance, p: string, d: MigrationDeps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);

  // ---------------------------------------------------------------- upload and profile
  reg('POST', '/migration/uploads');
  app.post(`${p}/migration/uploads`, { preHandler: guard(d, [...MANAGERS]) }, async (req, reply) => {
    const a = req.auth!;
    const body = parse(uploadBody, req.body);
    const table = parseCsv(body.csv);
    if (table.length < 2)
      throw new AppError(422, 'VALIDATION_FAILED', 'The file has no data rows', [
        { field: 'csv', message: 'Add a header row and at least one record' },
      ]);
    const header = table[0]!.map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
    const missing = REQUIRED.filter((c) => !header.includes(c));
    if (missing.length > 0)
      throw new AppError(
        422,
        'VALIDATION_FAILED',
        'The file is missing required columns',
        missing.map((c) => ({ field: c, message: `Column "${c}" is required` })),
      );
    if (table.length - 1 > MAX_ROWS)
      throw new AppError(422, 'VALIDATION_FAILED', `At most ${MAX_ROWS} records per batch`);
    const id = await withContext(d.database, a.ctx, async (tx) => {
      const existing = await tx
        .select({ number: contract.number })
        .from(contract)
        .where(eq(contract.tenantId, a.user.tenantId));
      const seen = new Set(existing.map((c) => c.number.toLowerCase()));
      const [batch] = await tx
        .insert(migrationBatch)
        .values({
          tenantId: a.user.tenantId,
          filename: body.filename,
          sourceSystem: body.sourceSystem,
          total: table.length - 1,
          uploadedBy: a.user.id,
          createdAt: d.clock.now(),
        })
        .returning();
      let n = 0;
      for (const cells of table.slice(1)) {
        n += 1;
        const raw: Raw = {};
        header.forEach((h, i) => {
          if ((COLUMNS as readonly string[]).includes(h)) raw[h as keyof Raw] = (cells[i] ?? '').trim();
        });
        const { issues, warnings } = profileRow(raw, seen);
        if (raw.contract_number?.trim()) seen.add(raw.contract_number.trim().toLowerCase());
        await tx.insert(migrationRecord).values({
          tenantId: a.user.tenantId,
          batchId: batch!.id,
          rowNo: n,
          raw,
          status: issues.length > 0 ? 'EXCEPTION' : 'VALID',
          issues,
          warnings,
        });
      }
      const view = await batchView(tx, a.user.tenantId, batch!.id, false);
      await d.audit.record(tx, a.ctx, {
        action: 'migration.upload',
        entityType: 'migration_batch',
        entityId: batch!.id,
        after: {
          filename: body.filename,
          sourceSystem: body.sourceSystem,
          total: view.total,
          valid: view.valid,
          exceptions: view.exceptions,
        },
      });
      return batch!.id;
    });
    return reply
      .status(201)
      .send(await withContext(d.database, a.ctx, (tx) => batchView(tx, a.user.tenantId, id, true)));
  });

  reg('GET', '/migration/batches');
  app.get(`${p}/migration/batches`, { preHandler: guard(d, [...MANAGERS]) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const rows = await tx
        .select({ id: migrationBatch.id })
        .from(migrationBatch)
        .where(eq(migrationBatch.tenantId, a.user.tenantId))
        .orderBy(sql`${migrationBatch.createdAt} desc`);
      const out = [];
      for (const r of rows) out.push(await batchView(tx, a.user.tenantId, r.id, false));
      return out;
    });
  });

  reg('GET', '/migration/batches/{id}');
  app.get(`${p}/migration/batches/:id`, { preHandler: guard(d, [...MANAGERS]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    return withContext(d.database, a.ctx, (tx) => batchView(tx, a.user.tenantId, id, true));
  });

  // ---------------------------------------------------------------- the exceptions report
  reg('GET', '/migration/batches/{id}/exceptions.csv');
  app.get(
    `${p}/migration/batches/:id/exceptions.csv`,
    { preHandler: guard(d, [...MANAGERS]) },
    async (req, reply) => {
      const a = req.auth!;
      const { id } = parse(z.object({ id: uuid }), req.params);
      const csv = await withContext(d.database, a.ctx, async (tx) => {
        const v = await batchView(tx, a.user.tenantId, id, true);
        const lines: unknown[][] = [];
        for (const r of v.records!) {
          for (const i of r.issues)
            lines.push([
              r.rowNo,
              r.contractNumber,
              'Exception',
              i.category,
              i.field ?? '',
              i.message,
              r.status,
              r.reviewNote ?? '',
            ]);
          for (const w of r.warnings)
            lines.push([r.rowNo, r.contractNumber, 'Warning', 'Profile', '', w, r.status, '']);
        }
        await d.audit.record(tx, a.ctx, {
          action: 'migration.exceptions_export',
          entityType: 'migration_batch',
          entityId: id,
          after: { rows: lines.length },
        });
        return toCsv(
          ['Row', 'Contract number', 'Kind', 'Category', 'Field', 'Detail', 'Row status now', 'Review note'],
          lines,
        );
      });
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="migration-exceptions-${id.slice(0, 8)}.csv"`)
        .send(csv);
    },
  );

  // ---------------------------------------------------------------- review: correct a record or set it aside
  async function loadRecord(tx: Tx, tenantId: string, id: string) {
    const [r] = await tx
      .select()
      .from(migrationRecord)
      .where(and(eq(migrationRecord.id, id), eq(migrationRecord.tenantId, tenantId)));
    if (!r) throw new AppError(404, 'NOT_FOUND', 'Record not found');
    const [b] = await tx.select().from(migrationBatch).where(eq(migrationBatch.id, r.batchId));
    if (b!.status !== 'VALIDATED')
      throw new AppError(409, 'BATCH_CLOSED', 'This batch has already been cut over');
    return r;
  }

  reg('PUT', '/migration/records/{id}');
  app.put(`${p}/migration/records/:id`, { preHandler: guard(d, [...MANAGERS]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    const body = parse(fixBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const r = await loadRecord(tx, a.user.tenantId, id);
      if (r.status === 'LOADED') throw new AppError(409, 'ALREADY_LOADED', 'This record is already loaded');
      const raw: Raw = { ...(r.raw as Raw) };
      for (const [k, v] of Object.entries(body.fields)) {
        if (!(COLUMNS as readonly string[]).includes(k))
          throw new AppError(422, 'VALIDATION_FAILED', 'Unknown column', [
            { field: k, message: 'Not a column of the extract' },
          ]);
        raw[k as keyof Raw] = v.trim();
      }
      // duplicates are judged against the system and every other live record of the batch
      const others = await tx.select().from(migrationRecord).where(eq(migrationRecord.batchId, r.batchId));
      const existing = await tx
        .select({ number: contract.number })
        .from(contract)
        .where(eq(contract.tenantId, a.user.tenantId));
      const seen = new Set([
        ...existing.map((c) => c.number.toLowerCase()),
        ...others
          .filter((o) => o.id !== r.id && o.status !== 'SKIPPED' && o.rowNo < r.rowNo)
          .map((o) => ((o.raw as Raw).contract_number ?? '').toLowerCase()),
      ]);
      const { issues, warnings } = profileRow(raw, seen);
      await tx
        .update(migrationRecord)
        .set({
          raw,
          issues,
          warnings,
          status: issues.length > 0 ? 'EXCEPTION' : 'VALID',
          reviewedBy: a.user.id,
          reviewedAt: d.clock.now(),
          reviewNote: 'Corrected',
        })
        .where(eq(migrationRecord.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'migration.record_fix',
        entityType: 'migration_record',
        entityId: id,
        before: { raw: r.raw, issues: r.issues },
        after: { raw, issues },
      });
      return recordView((await tx.select().from(migrationRecord).where(eq(migrationRecord.id, id)))[0]!);
    });
  });

  reg('POST', '/migration/records/{id}/skip');
  app.post(`${p}/migration/records/:id/skip`, { preHandler: guard(d, [...MANAGERS]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    const body = parse(skipBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const r = await loadRecord(tx, a.user.tenantId, id);
      if (r.status === 'LOADED') throw new AppError(409, 'ALREADY_LOADED', 'This record is already loaded');
      await tx
        .update(migrationRecord)
        .set({ status: 'SKIPPED', reviewedBy: a.user.id, reviewedAt: d.clock.now(), reviewNote: body.note })
        .where(eq(migrationRecord.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'migration.record_skip',
        entityType: 'migration_record',
        entityId: id,
        before: { status: r.status, issues: r.issues },
        after: { status: 'SKIPPED', note: body.note },
      });
      return recordView((await tx.select().from(migrationRecord).where(eq(migrationRecord.id, id)))[0]!);
    });
  });

  // ---------------------------------------------------------------- cutover
  reg('POST', '/migration/batches/{id}/cutover');
  app.post(`${p}/migration/batches/:id/cutover`, { preHandler: guard(d, ['ADMIN']) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    return withContext(d.database, a.ctx, async (tx) => {
      const [b] = await tx
        .select()
        .from(migrationBatch)
        .where(and(eq(migrationBatch.id, id), eq(migrationBatch.tenantId, a.user.tenantId)));
      if (!b) throw new AppError(404, 'NOT_FOUND', 'Batch not found');
      if (b.status !== 'VALIDATED')
        throw new AppError(409, 'BATCH_CLOSED', 'This batch has already been cut over');
      const recs = await tx
        .select()
        .from(migrationRecord)
        .where(eq(migrationRecord.batchId, id))
        .orderBy(asc(migrationRecord.rowNo));
      const open = recs.filter((r) => r.status === 'EXCEPTION');
      if (open.length > 0)
        throw new AppError(
          409,
          'EXCEPTIONS_UNREVIEWED',
          `${open.length} exception(s) must be corrected or set aside before cutover`,
          open.slice(0, 20).map((r) => ({
            field: `row ${r.rowNo}`,
            message: (r.issues as Issue[])[0]?.message ?? 'Exception',
          })),
        );
      const valid = recs.filter((r) => r.status === 'VALID');
      if (valid.length === 0)
        throw new AppError(409, 'NOTHING_TO_LOAD', 'There are no valid records to load');
      const people = await tx.select().from(appUser).where(eq(appUser.tenantId, a.user.tenantId));
      const today = iso(d.clock.now());
      let alerts = 0;
      for (const r of valid) {
        const raw = r.raw as Raw;
        const company = raw.supplier!.trim();
        const [found] = (
          await tx.select().from(supplier).where(eq(supplier.tenantId, a.user.tenantId))
        ).filter((s) => s.company.toLowerCase() === company.toLowerCase());
        const sup =
          found ??
          (
            await tx
              .insert(supplier)
              .values({
                tenantId: a.user.tenantId,
                company,
                // the database needs 11 digits; all zeros means "not supplied", and sanctions stay pending until someone checks
                abn: raw.supplier_abn?.trim() || '00000000000',
                sanctionsStatus: 'PENDING',
                insuranceStatus: 'UNKNOWN',
              })
              .returning()
          )[0]!;
        const owner = raw.owner?.trim()
          ? people.find((u) => u.name.toLowerCase() === raw.owner!.trim().toLowerCase())
          : undefined;
        const x = extractLegacy(raw.text);
        const noticeDays = x.noticeDays ?? (raw.notice_months?.trim() ? Number(raw.notice_months) * 30 : 90);
        const start = parseDate(raw.start_date)!;
        const end = parseDate(raw.end_date)!;
        const value = parseAmount(raw.value)!;

        // the originating procurement, where the source names one: linked, not left standing alone (FR-0660)
        let requestId: string | null = null;
        let tenderId: string | null = null;
        if (raw.procurement_ref?.trim()) {
          const ref = raw.procurement_ref.trim();
          let [rq] = await tx
            .select()
            .from(request)
            .where(and(eq(request.tenantId, a.user.tenantId), eq(request.number, ref)));
          if (!rq) {
            [rq] = await tx
              .insert(request)
              .values({
                tenantId: a.user.tenantId,
                number: ref,
                title: raw.procurement_title?.trim() || raw.title!.trim(),
                estimatedValue: String(value),
                requesterId: a.user.id,
                phase: 'CONTRACT_MGMT',
                status: 'COMPLETE',
                intakeMode: 'TEAM_LED',
                sourceSystem: b.sourceSystem,
                createdAt: d.clock.now(),
                updatedAt: d.clock.now(),
              })
              .returning();
            if (owner || raw.owner?.trim())
              await tx.insert(fieldValue).values({
                tenantId: a.user.tenantId,
                ownerType: 'REQUEST',
                ownerId: rq!.id,
                key: 'contractOwner',
                label: 'Contract owner',
                value: owner?.name ?? raw.owner!.trim(),
                source: 'MIGRATED',
                aiDrafted: false,
                missing: false,
                updatedAt: d.clock.now(),
              });
          }
          requestId = rq!.id;
          let [tn] = await tx.select().from(tender).where(eq(tender.requestId, rq!.id));
          if (!tn)
            [tn] = await tx
              .insert(tender)
              .values({
                tenantId: a.user.tenantId,
                requestId: rq!.id,
                type: 'RFT',
                status: 'AWARDED',
                createdAt: d.clock.now(),
                updatedAt: d.clock.now(),
              })
              .returning();
          tenderId = tn!.id;
        }

        const [c] = await tx
          .insert(contract)
          .values({
            tenantId: a.user.tenantId,
            number: raw.contract_number!.trim(),
            tenderId,
            supplierId: sup.id,
            status: 'EXECUTED',
            value: String(value),
            startDate: start,
            endDate: end,
            noticeDays,
            sourceSystem: b.sourceSystem,
            createdAt: d.clock.now(),
            updatedAt: d.clock.now(),
          })
          .returning();
        // obligations, KPIs and service levels pulled from the contract text become clauses of the record
        const lines: Array<[string, string, string]> = [
          ...x.obligations.map((t, i) => [`OBL-${i + 1}`, 'Obligation', t] as [string, string, string]),
          ...x.kpis.map(
            (t, i) => [`KPI-${i + 1}`, 'Key performance indicator', t] as [string, string, string],
          ),
          ...x.slas.map((t, i) => [`SLA-${i + 1}`, 'Service level', t] as [string, string, string]),
        ];
        for (const [clauseId, title, text] of lines)
          await tx.insert(clause).values({
            tenantId: a.user.tenantId,
            contractId: c!.id,
            clauseId,
            title,
            text,
            mandatory: false,
          });
        await tx.update(contract).set({ locked: true }).where(eq(contract.id, c!.id));
        const rec = await createContractRecord(
          tx,
          { ...c!, locked: true },
          { extensions: x.extensions, today, ...(owner ? { ownerId: owner.id } : {}) },
        );
        alerts += rec.alerts.length;
        await tx
          .update(migrationRecord)
          .set({ status: 'LOADED', requestId, contractId: c!.id })
          .where(eq(migrationRecord.id, r.id));
      }
      await tx
        .update(migrationBatch)
        .set({ status: 'CUTOVER', cutoverAt: d.clock.now(), cutoverBy: a.user.id })
        .where(eq(migrationBatch.id, id));
      const skipped = recs.filter((r) => r.status === 'SKIPPED').length;
      await d.audit.record(tx, a.ctx, {
        action: 'migration.cutover',
        entityType: 'migration_batch',
        entityId: id,
        before: { status: 'VALIDATED' },
        after: {
          status: 'CUTOVER',
          loaded: valid.length,
          skipped,
          total: recs.length,
          alertsScheduled: alerts,
          sourceSystem: b.sourceSystem,
        },
      });
      return {
        ...(await batchView(tx, a.user.tenantId, id, true)),
        reconciliation: {
          total: recs.length,
          loaded: valid.length,
          skipped,
          reconciles: valid.length + skipped === recs.length,
        },
      };
    });
  });

  return done;
}
