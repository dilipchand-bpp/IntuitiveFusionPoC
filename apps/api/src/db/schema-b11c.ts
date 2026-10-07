/**
 * Batch B11c: audit integrity and auditor evidence (SEC-L02, SEC-L07, NFR-R06), access monitoring (SEC-L06), configuration
 * compliance (SEC-L08), access policies (SEC-AC09) and bank details (SEC-AC10). Re-exported from schema.ts. The small column
 * helpers are repeated here on purpose (see schema-b10a.ts): importing them back from schema.ts would be circular.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
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

export const adminChainVerification = pgTable(
  'admin_chain_verification',
  {
    id: id(),
    tenantId: tenantId(),
    verifiedBy: uuid('verified_by'),
    verifiedByRole: text('verified_by_role'),
    verifiedAt: ts('verified_at').notNull(),
    ok: boolean('ok').notNull(),
    checked: integer('checked').notNull(),
    adminEvents: integer('admin_events').notNull(),
    headSeq: bigint('head_seq', { mode: 'number' }),
    headHash: text('head_hash'),
    brokenAtSeq: bigint('broken_at_seq', { mode: 'number' }),
    reason: text('reason'),
  },
  (t) => [index('admin_chain_verification_idx').on(t.tenantId, t.verifiedAt)],
);

export const exportPackLog = pgTable(
  'export_pack_log',
  {
    id: id(),
    tenantId: tenantId(),
    generatedBy: uuid('generated_by'),
    generatedAt: ts('generated_at').notNull(),
    fromDate: date('from_date').notNull(),
    toDate: date('to_date').notNull(),
    requestId: uuid('request_id'),
    eventCount: integer('event_count').notNull(),
    chainHeadHash: text('chain_head_hash'),
    manifestSha256: text('manifest_sha256').notNull(),
    signatureFingerprint: text('signature_fingerprint').notNull(),
    format: text('format', { enum: ['JSON', 'ZIP'] }).notNull(),
  },
  (t) => [index('export_pack_log_idx').on(t.tenantId, t.generatedAt)],
);

export const ACCESS_KINDS = ['VIEW', 'DENIED', 'EXPORT'] as const;
export const accessEvent = pgTable(
  'access_event',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: tenantId(),
    userId: uuid('user_id').notNull(),
    kind: text('kind', { enum: ACCESS_KINDS }).notNull(),
    route: text('route').notNull(),
    entityId: text('entity_id'),
    status: integer('status').notNull(),
    at: ts('at').notNull(),
  },
  (t) => [
    index('access_event_user_idx').on(t.tenantId, t.userId, t.at),
    index('access_event_at_idx').on(t.tenantId, t.at),
  ],
);

export const ALERT_STATUSES = ['NEW', 'ACKNOWLEDGED', 'ESCALATED', 'CLOSED'] as const;
export const securityAlert = pgTable(
  'security_alert',
  {
    id: id(),
    tenantId: tenantId(),
    rule: text('rule').notNull(),
    severity: text('severity', { enum: ['LOW', 'MEDIUM', 'HIGH'] }).notNull(),
    subjectUserId: uuid('subject_user_id'),
    summary: text('summary').notNull(),
    evidence: jsonb('evidence').notNull().default({}),
    status: text('status', { enum: ALERT_STATUSES }).notNull().default('NEW'),
    ownerUserId: uuid('owner_user_id'),
    dedupeKey: text('dedupe_key'),
    model: text('model').notNull().default('rules-simulated-v1'),
    createdAt: ts('created_at').notNull(),
    acknowledgedBy: uuid('acknowledged_by'),
    acknowledgedAt: ts('acknowledged_at'),
    escalatedAt: ts('escalated_at'),
    escalatedTo: jsonb('escalated_to').notNull().default([]),
    closedBy: uuid('closed_by'),
    closedAt: ts('closed_at'),
    closeNote: text('close_note'),
    sessionsEndedBy: uuid('sessions_ended_by'),
    sessionsEndedAt: ts('sessions_ended_at'),
  },
  (t) => [
    index('security_alert_status_idx').on(t.tenantId, t.status, t.createdAt),
    uniqueIndex('security_alert_dedupe_uq')
      .on(t.tenantId, t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null`),
  ],
);

export const complianceCheckResult = pgTable(
  'compliance_check_result',
  {
    id: id(),
    tenantId: tenantId(),
    checkKey: text('check_key').notNull(),
    status: text('status', { enum: ['PASS', 'FAIL', 'WARN'] }).notNull(),
    detail: text('detail').notNull(),
    lastCheckedAt: ts('last_checked_at').notNull(),
    firstFailedAt: ts('first_failed_at'),
    lastPassedAt: ts('last_passed_at'),
    previousStatus: text('previous_status', { enum: ['PASS', 'FAIL', 'WARN'] }),
  },
  (t) => [uniqueIndex('compliance_check_result_uq').on(t.tenantId, t.checkKey)],
);

export const POLICY_ACTIONS = ['view', 'edit', 'approve', 'export'] as const;
export const accessPolicy = pgTable(
  'access_policy',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    effect: text('effect', { enum: ['DENY', 'ALLOW'] }).notNull(),
    subjectType: text('subject_type', { enum: ['ROLE', 'USER'] }).notNull(),
    subject: text('subject').notNull(),
    action: text('action', { enum: POLICY_ACTIONS }).notNull(),
    selector: jsonb('selector').notNull().default({}),
    conditions: jsonb('conditions').notNull().default({}),
    reason: text('reason').notNull(),
    active: boolean('active').notNull().default(true),
    priority: integer('priority').notNull().default(100),
    expiresAt: ts('expires_at'),
    createdBy: uuid('created_by').notNull(),
    createdAt: ts('created_at').notNull(),
    disabledBy: uuid('disabled_by'),
    disabledAt: ts('disabled_at'),
    disabledReason: text('disabled_reason'),
    deletedBy: uuid('deleted_by'),
    deletedAt: ts('deleted_at'),
    deletedReason: text('deleted_reason'),
  },
  (t) => [index('access_policy_idx').on(t.tenantId, t.active)],
);

export const accessTag = pgTable(
  'access_tag',
  {
    id: id(),
    tenantId: tenantId(),
    requestId: uuid('request_id').notNull(),
    tag: text('tag').notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [uniqueIndex('access_tag_uq').on(t.requestId, t.tag)],
);

export const bankDetailChange = pgTable(
  'bank_detail_change',
  {
    id: id(),
    tenantId: tenantId(),
    supplierId: uuid('supplier_id').notNull(),
    requestedBy: uuid('requested_by').notNull(),
    requestedByRole: text('requested_by_role').notNull(),
    requestedAt: ts('requested_at').notNull(),
    newBank: jsonb('new_bank').notNull(),
    previousBank: jsonb('previous_bank'),
    status: text('status', {
      enum: ['PENDING', 'UNCONFIRMED', 'CONFIRMED', 'REJECTED', 'WITHDRAWN', 'SUPERSEDED'],
    })
      .notNull()
      .default('PENDING'),
    decidedBy: uuid('decided_by'),
    decidedAt: ts('decided_at'),
    decisionNote: text('decision_note'),
  },
  (t) => [
    index('bank_detail_change_idx').on(t.tenantId, t.supplierId, t.status),
    uniqueIndex('bank_detail_change_open_uq')
      .on(t.supplierId)
      .where(sql`${t.status} in ('PENDING', 'UNCONFIRMED')`),
  ],
);
