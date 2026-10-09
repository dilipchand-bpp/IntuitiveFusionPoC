/**
 * BCP module cpocr: contract OCR and extraction (CP-07, OCR and extraction part). Re-exported from schema.ts; migration
 * 0030_bcp_contract_ocr.sql is the DDL. The small column helpers are repeated on purpose (see schema-b10a.ts).
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
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

export const OCR_KINDS = ['PDF', 'PNG', 'JPG', 'TIFF'] as const;
export type OcrKind = (typeof OCR_KINDS)[number];
export const OCR_DOC_STATUSES = ['NEEDS_REVIEW', 'READY', 'COMMITTED', 'REJECTED', 'FAILED'] as const;
export type OcrDocStatus = (typeof OCR_DOC_STATUSES)[number];
export const OCR_BATCH_ORIGINS = ['UPLOAD', 'SAMPLE'] as const;
export const CLAUSE_RISKS = ['LOW', 'MEDIUM', 'HIGH'] as const;

/** The tenant's review threshold: fields read with less confidence than this must be reviewed before commit. */
export const cpOcrConfig = pgTable('cp_ocr_config', {
  tenantId: uuid('tenant_id').primaryKey(),
  reviewThreshold: numeric('review_threshold', { precision: 4, scale: 3 }).notNull().default('0.800'),
  updatedBy: uuid('updated_by'),
  updatedAt: ts('updated_at').notNull(),
});

/** The tenant's clause library for detection (when empty the built-in defaults apply). */
export const cpOcrClauseType = pgTable(
  'cp_ocr_clause_type',
  {
    id: id(),
    tenantId: tenantId(),
    key: text('key').notNull(),
    title: text('title').notNull(),
    mandatory: boolean('mandatory').notNull().default(false),
    risk: text('risk', { enum: CLAUSE_RISKS }).notNull().default('MEDIUM'),
    keywords: jsonb('keywords').notNull().default([]),
    standardText: text('standard_text').notNull(),
    active: boolean('active').notNull().default(true),
    position: integer('position').notNull().default(0),
    updatedBy: uuid('updated_by'),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [uniqueIndex('cp_ocr_clause_type_uq').on(t.tenantId, t.key)],
);

/** One upload: files, or a zip of them. */
export const cpOcrBatch = pgTable(
  'cp_ocr_batch',
  {
    id: id(),
    tenantId: tenantId(),
    createdBy: uuid('created_by').notNull(),
    origin: text('origin', { enum: OCR_BATCH_ORIGINS }).notNull().default('UPLOAD'),
    fileCount: integer('file_count').notNull().default(0),
    skipped: jsonb('skipped').notNull().default([]),
    note: text('note'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('cp_ocr_batch_idx').on(t.tenantId, t.createdAt)],
);

/** One recognised document: page text, extracted fields (with confidence and source span), clauses and findings. */
export const cpOcrDocument = pgTable(
  'cp_ocr_document',
  {
    id: id(),
    tenantId: tenantId(),
    batchId: uuid('batch_id').notNull(),
    fileName: text('file_name').notNull(),
    entryPath: text('entry_path'),
    kind: text('kind', { enum: OCR_KINDS }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    engine: text('engine').notNull(),
    simulated: boolean('simulated').notNull().default(false),
    pageCount: integer('page_count').notNull().default(0),
    pages: jsonb('pages').notNull().default([]),
    ocrConfidence: numeric('ocr_confidence', { precision: 4, scale: 3 }),
    status: text('status', { enum: OCR_DOC_STATUSES }).notNull(),
    failure: text('failure'),
    fields: jsonb('fields').notNull().default([]),
    clauses: jsonb('clauses').notNull().default([]),
    findings: jsonb('findings').notNull().default([]),
    reviewThreshold: numeric('review_threshold', { precision: 4, scale: 3 }).notNull().default('0.800'),
    duplicateOf: uuid('duplicate_of'),
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: ts('reviewed_at'),
    contractId: uuid('contract_id'),
    supplierId: uuid('supplier_id'),
    committedBy: uuid('committed_by'),
    committedAt: ts('committed_at'),
    commitSummary: jsonb('commit_summary'),
    rejectReason: text('reject_reason'),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    index('cp_ocr_document_batch_idx').on(t.tenantId, t.batchId),
    index('cp_ocr_document_hash_idx').on(t.tenantId, t.sha256),
    index('cp_ocr_document_status_idx').on(t.tenantId, t.status),
  ],
);

/** A reviewer's correction of one field, kept with the value before and after. */
export const cpOcrCorrection = pgTable(
  'cp_ocr_correction',
  {
    id: id(),
    tenantId: tenantId(),
    documentId: uuid('document_id').notNull(),
    fieldKey: text('field_key').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    reason: text('reason'),
    correctedBy: uuid('corrected_by').notNull(),
    correctedAt: ts('corrected_at').notNull(),
  },
  (t) => [index('cp_ocr_correction_idx').on(t.tenantId, t.documentId)],
);
