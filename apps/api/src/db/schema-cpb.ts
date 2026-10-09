/**
 * BCP module cpdraft: drafting from voice or text and plain-language adjustment (CP-04, CP-05). Re-exported from schema.ts;
 * migration 0029_bcp_drafting.sql is the DDL. The small column helpers are repeated on purpose (see schema-b10a.ts).
 */
import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`);
const tenantId = () => uuid('tenant_id').notNull();
const ts = (name: string) => timestamp(name, { withTimezone: true });

export const DRAFT_KINDS = [
  'REQUEST',
  'PLAN',
  'JOB_SPEC',
  'TENDER_DOC',
  'CONTRACT_DRAFT',
  'EVAL_CRITERIA',
] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];
export const DRAFT_SOURCES = ['TEXT', 'VOICE'] as const;
export type DraftSource = (typeof DRAFT_SOURCES)[number];
export const DRAFT_ACTIONS = ['GENERATE', 'ADJUST', 'UNDO'] as const;
export type DraftAction = (typeof DRAFT_ACTIONS)[number];
export const APPLY_TARGETS = ['REQUEST', 'PLAN', 'TENDER', 'REPOSITORY'] as const;
export type ApplyTarget = (typeof APPLY_TARGETS)[number];

/** A draft made by one person from text or dictation. The content lives in its revisions. */
export const cpDraft = pgTable(
  'cp_draft',
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid('user_id').notNull(),
    kind: text('kind', { enum: DRAFT_KINDS }).notNull(),
    source: text('source', { enum: DRAFT_SOURCES }).notNull(),
    procurementId: uuid('procurement_id'),
    inputText: text('input_text').notNull(),
    engine: text('engine').notNull().default('rules-simulated-v1'),
    currentRevision: integer('current_revision').notNull().default(1),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [index('cp_draft_user_idx').on(t.tenantId, t.userId, t.updatedAt)],
);

/** Every revision, whole, so a before/after view and undo never re-run anything. */
export const cpDraftRevision = pgTable(
  'cp_draft_revision',
  {
    id: id(),
    tenantId: tenantId(),
    draftId: uuid('draft_id').notNull(),
    revision: integer('revision').notNull(),
    parentRevision: integer('parent_revision'),
    action: text('action', { enum: DRAFT_ACTIONS }).notNull(),
    instruction: text('instruction'),
    summary: text('summary').notNull().default(''),
    doc: jsonb('doc').notNull(),
    sources: jsonb('sources').notNull().default([]),
    diff: jsonb('diff').notNull().default([]),
    createdBy: uuid('created_by').notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [uniqueIndex('cp_draft_revision_uq').on(t.draftId, t.revision)],
);

/** What a draft wrote into a real record, and who did it. */
export const cpDraftApply = pgTable(
  'cp_draft_apply',
  {
    id: id(),
    tenantId: tenantId(),
    draftId: uuid('draft_id').notNull(),
    revision: integer('revision').notNull(),
    target: text('target', { enum: APPLY_TARGETS }).notNull(),
    targetId: uuid('target_id'),
    changes: jsonb('changes').notNull().default([]),
    appliedBy: uuid('applied_by').notNull(),
    appliedAt: ts('applied_at').notNull(),
  },
  (t) => [index('cp_draft_apply_idx').on(t.tenantId, t.draftId)],
);
