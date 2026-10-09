/**
 * Procurement Copilot batch, CP-07 (historical import): saved column mappings, import batches and their rows, the ledger of
 * what a committed batch created (for an exact rollback) and the historical spend lines. Re-exported from schema.ts;
 * migration 0031_bcp_history_import.sql is the DDL. The small column helpers are repeated on purpose (see schema-b11a.ts).
 */
import { sql } from 'drizzle-orm';
import {
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`);
const tenantId = () => uuid('tenant_id').notNull();
const ts = (name: string) => timestamp(name, { withTimezone: true });

export const HIST_ENTITIES = ['CONTRACTS', 'SUPPLIERS', 'SPEND', 'CATALOGUE'] as const;
export type HistEntity = (typeof HIST_ENTITIES)[number];
export const HIST_BATCH_STATUSES = ['UPLOADED', 'MAPPED', 'DRY_RUN', 'COMMITTED', 'ROLLED_BACK'] as const;
export const HIST_ROW_STATUSES = [
  'PENDING',
  'VALID',
  'ERROR',
  'DUPLICATE',
  'LOADED',
  'MERGED',
  'SKIPPED',
] as const;
export const DUPLICATE_RULES = ['SKIP', 'MERGE'] as const;
export type DuplicateRule = (typeof DUPLICATE_RULES)[number];

/** A column mapping saved for one source system and entity, reused on the next extract from the same system. */
export const histMapping = pgTable(
  'hist_mapping',
  {
    id: id(),
    tenantId: tenantId(),
    entity: text('entity', { enum: HIST_ENTITIES }).notNull(),
    sourceSystem: text('source_system').notNull(),
    mapping: jsonb('mapping').notNull().default({}),
    duplicateRule: text('duplicate_rule', { enum: DUPLICATE_RULES }).notNull().default('SKIP'),
    createdBy: uuid('created_by').notNull(),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [uniqueIndex('hist_mapping_uq').on(t.tenantId, t.entity, t.sourceSystem)],
);

export const histBatch = pgTable(
  'hist_batch',
  {
    id: id(),
    tenantId: tenantId(),
    entity: text('entity', { enum: [...HIST_ENTITIES, 'CONTRACT_FILES'] as const }).notNull(),
    filename: text('filename').notNull(),
    sourceSystem: text('source_system').notNull(),
    fileKind: text('file_kind', { enum: ['XLSX', 'CSV', 'ZIP'] as const }).notNull(),
    sheetName: text('sheet_name'),
    sha256: text('sha256').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    status: text('status', { enum: HIST_BATCH_STATUSES }).notNull().default('UPLOADED'),
    headers: jsonb('headers').notNull().default([]),
    rowCount: integer('row_count').notNull().default(0),
    mapping: jsonb('mapping').notNull().default({}),
    suggestion: jsonb('suggestion').notNull().default({}),
    duplicateRule: text('duplicate_rule', { enum: DUPLICATE_RULES }).notNull().default('SKIP'),
    parseWarnings: jsonb('parse_warnings').notNull().default([]),
    summary: jsonb('summary'),
    commitSummary: jsonb('commit_summary'),
    ocrBatchId: uuid('ocr_batch_id'),
    ocrResult: jsonb('ocr_result'),
    uploadedBy: uuid('uploaded_by').notNull(),
    createdAt: ts('created_at').notNull(),
    dryRunAt: ts('dry_run_at'),
    committedAt: ts('committed_at'),
    committedBy: uuid('committed_by'),
    rolledBackAt: ts('rolled_back_at'),
    rolledBackBy: uuid('rolled_back_by'),
    rollbackNote: text('rollback_note'),
  },
  (t) => [index('hist_batch_tenant_idx').on(t.tenantId, t.createdAt)],
);

export const histRow = pgTable(
  'hist_row',
  {
    id: id(),
    tenantId: tenantId(),
    batchId: uuid('batch_id').notNull(),
    rowNo: integer('row_no').notNull(),
    raw: jsonb('raw').notNull(),
    status: text('status', { enum: HIST_ROW_STATUSES }).notNull().default('PENDING'),
    normalised: jsonb('normalised'),
    issues: jsonb('issues').notNull().default([]),
    warnings: jsonb('warnings').notNull().default([]),
    duplicate: jsonb('duplicate'),
    createdRef: uuid('created_ref'),
  },
  (t) => [uniqueIndex('hist_row_uq').on(t.batchId, t.rowNo)],
);

export const HIST_CREATED_TYPES = ['CONTRACT', 'SUPPLIER', 'CATALOGUE_ITEM', 'SPEND_LINE'] as const;

/** Everything a committed batch made (action CREATED) or changed (MERGED, with the values before). */
export const histCreated = pgTable(
  'hist_created',
  {
    id: id(),
    tenantId: tenantId(),
    batchId: uuid('batch_id').notNull(),
    entityType: text('entity_type', { enum: HIST_CREATED_TYPES }).notNull(),
    entityId: uuid('entity_id').notNull(),
    action: text('action', { enum: ['CREATED', 'MERGED'] as const }).notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
  },
  (t) => [index('hist_created_batch_idx').on(t.batchId, t.entityType)],
);

export const histSpendLine = pgTable(
  'hist_spend_line',
  {
    id: id(),
    tenantId: tenantId(),
    batchId: uuid('batch_id').notNull(),
    supplierId: uuid('supplier_id'),
    supplierName: text('supplier_name').notNull(),
    category: text('category').notNull().default('Uncategorised'),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('AUD'),
    spendDate: date('spend_date').notNull(),
    businessUnit: text('business_unit').notNull().default('Not recorded'),
    costCentre: text('cost_centre').notNull().default('Not recorded'),
    reference: text('reference'),
    description: text('description'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    index('hist_spend_line_idx').on(t.tenantId, t.spendDate),
    index('hist_spend_line_batch_idx').on(t.batchId),
  ],
);
