/**
 * B10 (AI layer, configuration, client baseline, performance): NFR-C01, NFR-M06, SEC-TP07, NFR-M05, NFR-C08, NFR-P04.
 * Kept in its own file; migration 0021_b10_ai_layer.sql is the DDL.
 */
import { sql } from 'drizzle-orm';
import {
  bigserial,
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

export const AI_APPROVAL_STATUSES = ['REQUESTED', 'APPROVED', 'REJECTED', 'REVOKED'] as const;
export type AiApprovalStatus = (typeof AI_APPROVAL_STATUSES)[number];

/** A third-party AI model approved (or not) for one tenant. The latest row for a model is its current state (SEC-TP07). */
export const aiProviderApproval = pgTable(
  'ai_provider_approval',
  {
    id: id(),
    tenantId: tenantId(),
    modelId: text('model_id').notNull(),
    provider: text('provider').notNull(),
    status: text('status', { enum: AI_APPROVAL_STATUSES }).notNull().default('REQUESTED'),
    requestedBy: uuid('requested_by').notNull(),
    requestReason: text('request_reason'),
    decidedBy: uuid('decided_by'),
    reason: text('reason'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    revokedBy: uuid('revoked_by'),
    revokeReason: text('revoke_reason'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /** The data-handling profile as it stood when the request was made, so the decision is on record against what was shown. */
    dataHandling: jsonb('data_handling').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('ai_provider_approval_model_idx').on(t.tenantId, t.modelId, t.createdAt),
    uniqueIndex('ai_provider_approval_open_uq')
      .on(t.tenantId, t.modelId)
      .where(sql`status = 'REQUESTED'`),
  ],
);

/** Browser family, major version and whether it met the baseline, counted. Nothing about the person (NFR-C08). */
export const clientCheck = pgTable(
  'client_check',
  {
    id: id(),
    tenantId: tenantId(),
    browser: text('browser').notNull(),
    major: integer('major').notNull(),
    supported: boolean('supported').notNull(),
    count: integer('count').notNull().default(1),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex('client_check_uq').on(t.tenantId, t.browser, t.major, t.supported)],
);

/** How long the budget check and an intake message took, measured with a monotonic timer (NFR-P04). Capped per tenant and kind. */
export const perfSample = pgTable(
  'perf_sample',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: tenantId(),
    kind: text('kind', { enum: ['BUDGET_CHECK', 'INTAKE_MESSAGE'] }).notNull(),
    ms: numeric('ms', { precision: 10, scale: 3 }).notNull(),
    at: timestamp('at', { withTimezone: true }).notNull(),
  },
  (t) => [index('perf_sample_idx').on(t.tenantId, t.kind, t.id)],
);

export type AiProviderApprovalRow = typeof aiProviderApproval.$inferSelect;
