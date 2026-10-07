/**
 * Batch B11d: eIDAS signature levels (NFR-L03), refreshed outside content (NFR-R03), ESG and socio-economic plan targets
 * (NFR-R05), and tenants with usage plans, throttling and metering (NFR-SC01).
 * Re-exported from schema.ts. The small column helpers are repeated here on purpose (schema.ts re-exports this file, so
 * importing them back would be a circular import evaluated in the wrong order).
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
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

export const SIGNATURE_LEVELS = ['SES', 'AES', 'QES'] as const;
export type SignatureLevel = (typeof SIGNATURE_LEVELS)[number];
export const SIGNATURE_METHODS = ['SESSION', 'PASSWORD', 'PASSWORD_MFA', 'PROVIDER', 'QTSP'] as const;
export type SignatureMethod = (typeof SIGNATURE_METHODS)[number];

export const signatureEvidence = pgTable(
  'signature_evidence',
  {
    id: id(),
    tenantId: tenantId(),
    contractId: uuid('contract_id').notNull(),
    approvalId: uuid('approval_id'),
    signerId: uuid('signer_id').notNull(),
    signerRole: text('signer_role').notNull(),
    method: text('method', { enum: SIGNATURE_METHODS }).notNull(),
    level: text('level', { enum: SIGNATURE_LEVELS }).notNull(),
    requiredLevel: text('required_level', { enum: SIGNATURE_LEVELS }).notNull(),
    provider: text('provider'),
    docHash: text('doc_hash').notNull(),
    ip: text('ip'),
    userAgentClass: text('user_agent_class'),
    signedAt: ts('signed_at').notNull(),
    superseded: boolean('superseded').notNull().default(false),
  },
  (t) => [index('signature_evidence_contract_idx').on(t.tenantId, t.contractId, t.signedAt)],
);

export const contractSignaturePolicy = pgTable(
  'contract_signature_policy',
  {
    id: id(),
    tenantId: tenantId(),
    contractId: uuid('contract_id').notNull(),
    level: text('level', { enum: SIGNATURE_LEVELS }).notNull(),
    reason: text('reason').notNull(),
    setBy: uuid('set_by').notNull(),
    setAt: ts('set_at').notNull(),
  },
  (t) => [uniqueIndex('contract_signature_policy_uq').on(t.contractId)],
);

export const CONTENT_KINDS = [
  'UNSPSC_TAXONOMY',
  'MARKET_BENCHMARKS',
  'RISK_LIBRARY',
  'CLAUSE_REFERENCE',
  'ESG_REFERENCE',
] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];

export const contentPack = pgTable(
  'content_pack',
  {
    id: id(),
    tenantId: tenantId(),
    kind: text('kind', { enum: CONTENT_KINDS }).notNull(),
    version: integer('version').notNull(),
    sourceName: text('source_name').notNull(),
    sourceUrl: text('source_url').notNull(),
    refreshedAt: ts('refreshed_at'),
    validUntil: ts('valid_until'),
    status: text('status', { enum: ['CURRENT', 'STALE', 'FAILED'] }).notNull(),
    itemCount: integer('item_count').notNull().default(0),
    checksum: text('checksum'),
    lastDiff: jsonb('last_diff').notNull().default({}),
    lastError: text('last_error'),
    lastAttemptAt: ts('last_attempt_at'),
    refreshedBy: uuid('refreshed_by'),
  },
  (t) => [uniqueIndex('content_pack_uq').on(t.tenantId, t.kind)],
);

export const contentItem = pgTable(
  'content_item',
  {
    id: id(),
    tenantId: tenantId(),
    packId: uuid('pack_id').notNull(),
    kind: text('kind').notNull(),
    itemKey: text('item_key').notNull(),
    label: text('label').notNull(),
    data: jsonb('data').notNull().default({}),
  },
  (t) => [
    uniqueIndex('content_item_uq').on(t.packId, t.itemKey),
    index('content_item_kind_idx').on(t.tenantId, t.kind),
  ],
);

export const planEsgTarget = pgTable(
  'plan_esg_target',
  {
    id: id(),
    tenantId: tenantId(),
    planId: uuid('plan_id').notNull(),
    metricKey: text('metric_key').notNull(),
    target: numeric('target', { precision: 14, scale: 4 }).notNull(),
    isOverride: boolean('is_override').notNull().default(false),
    overrideReason: text('override_reason'),
    approverNote: text('approver_note'),
    forecast: numeric('forecast', { precision: 14, scale: 4 }),
    actual: numeric('actual', { precision: 14, scale: 4 }),
    source: text('source', { enum: ['DEFAULT', 'PLAN', 'OVERRIDE'] })
      .notNull()
      .default('DEFAULT'),
    exceptionReason: text('exception_reason'),
    exceptionBy: uuid('exception_by'),
    exceptionAt: ts('exception_at'),
    acknowledgedBy: uuid('acknowledged_by'),
    acknowledgedAt: ts('acknowledged_at'),
    updatedBy: uuid('updated_by'),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [uniqueIndex('plan_esg_target_uq').on(t.planId, t.metricKey)],
);

export const usagePlan = pgTable('usage_plan', {
  key: text('key').primaryKey(),
  /** Null for a platform plan; a tenant id for a plan only that tenant can use. */
  tenantId: uuid('tenant_id'),
  name: text('name').notNull(),
  requestsPerMinute: integer('requests_per_minute').notNull(),
  burst: integer('burst').notNull(),
  dailyRequests: integer('daily_requests').notNull(),
  monthlyAiCalls: integer('monthly_ai_calls').notNull(),
  storageMb: integer('storage_mb').notNull(),
  maxUsers: integer('max_users').notNull(),
});

export const tenantUsagePlan = pgTable('tenant_usage_plan', {
  tenantId: uuid('tenant_id').primaryKey(),
  planKey: text('plan_key').notNull(),
  assignedAt: ts('assigned_at').notNull(),
  assignedBy: text('assigned_by').notNull().default('operator'),
});

export const usageCounter = pgTable(
  'usage_counter',
  {
    tenantId: tenantId(),
    day: date('day').notNull(),
    requests: integer('requests').notNull().default(0),
    throttled: integer('throttled').notNull().default(0),
    aiCalls: integer('ai_calls').notNull().default(0),
    storageBytes: bigint('storage_bytes', { mode: 'number' }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.day] })],
);
