/**
 * Batch B11b: privacy, residency, egress, classification, prompt-injection flags and breach response
 * (NFR-R02, SEC-D09, SEC-D05, SEC-D06, SEC-D07, SEC-D08, SEC-AP08, SEC-IR05). Re-exported from schema.ts.
 * The small column helpers are repeated on purpose (see schema-b10a.ts): importing them from schema.ts would be circular.
 */
import { sql } from 'drizzle-orm';
import {
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

export const outboundRefusal = pgTable(
  'outbound_refusal',
  {
    id: id(),
    tenantId: tenantId(),
    kind: text('kind', { enum: ['RESIDENCY', 'EGRESS'] }).notNull(),
    purpose: text('purpose').notNull(),
    target: text('target').notNull(),
    region: text('region'),
    electedCountry: text('elected_country'),
    reason: text('reason').notNull(),
    actorId: uuid('actor_id'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('outbound_refusal_idx').on(t.tenantId, t.createdAt)],
);

export const conversationMeta = pgTable(
  'conversation_meta',
  {
    conversationId: uuid('conversation_id').primaryKey(),
    tenantId: tenantId(),
    retentionClass: text('retention_class').notNull().default('AI_CONVERSATION'),
    region: text('region').notNull(),
    stampedAt: ts('stamped_at').notNull(),
    anonymisedAt: ts('anonymised_at'),
  },
  (t) => [index('conversation_meta_idx').on(t.tenantId, t.stampedAt)],
);

export const legalHold = pgTable(
  'legal_hold',
  {
    id: id(),
    tenantId: tenantId(),
    entityType: text('entity_type', { enum: ['REQUEST', 'CONVERSATION'] }).notNull(),
    entityId: uuid('entity_id').notNull(),
    reason: text('reason').notNull(),
    placedBy: uuid('placed_by').notNull(),
    placedAt: ts('placed_at').notNull(),
    releasedBy: uuid('released_by'),
    releasedAt: ts('released_at'),
    releaseReason: text('release_reason'),
  },
  (t) => [
    uniqueIndex('legal_hold_open_uq')
      .on(t.tenantId, t.entityType, t.entityId)
      .where(sql`released_at IS NULL`),
  ],
);

export const retentionRun = pgTable(
  'retention_run',
  {
    id: id(),
    tenantId: tenantId(),
    ranAt: ts('ran_at').notNull(),
    ranBy: uuid('ran_by'),
    trigger: text('trigger', { enum: ['MANUAL', 'SCHEDULED'] }).notNull(),
    retentionDays: integer('retention_days').notNull(),
    expired: integer('expired').notNull().default(0),
    anonymised: integer('anonymised').notNull().default(0),
    messagesCleared: integer('messages_cleared').notNull().default(0),
    skippedHeld: integer('skipped_held').notNull().default(0),
    held: jsonb('held').notNull().default([]),
  },
  (t) => [index('retention_run_idx').on(t.tenantId, t.ranAt)],
);

export const DATA_CLASSES = [
  'PUBLIC',
  'INTERNAL',
  'CONFIDENTIAL',
  'SENSITIVE_PERSONAL',
  'FINANCIAL',
] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

export const dataClassification = pgTable(
  'data_classification',
  {
    id: id(),
    tenantId: tenantId(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    field: text('field').notNull(),
    class: text('class', { enum: DATA_CLASSES }).notNull(),
    detectors: jsonb('detectors').notNull().default([]),
    maskedSample: text('masked_sample'),
    contentHash: text('content_hash').notNull(),
    warning: text('warning'),
    status: text('status', { enum: ['OPEN', 'CONFIRMED', 'DISMISSED'] })
      .notNull()
      .default('OPEN'),
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: ts('reviewed_at'),
    reviewReason: text('review_reason'),
    model: text('model').notNull(),
    firstSeenAt: ts('first_seen_at').notNull(),
    scannedAt: ts('scanned_at').notNull(),
  },
  (t) => [
    uniqueIndex('data_classification_uq').on(t.tenantId, t.entityType, t.entityId, t.field),
    index('data_classification_class_idx').on(t.tenantId, t.class, t.status),
  ],
);

export const NOTICE_CONTEXTS = [
  'SUPPLIER_REGISTRATION',
  'USER_ACTIVATION',
  'REQUEST_INTAKE',
  'PRIVACY_PAGE',
] as const;
export type NoticeContext = (typeof NOTICE_CONTEXTS)[number];

export const privacyNoticeAck = pgTable(
  'privacy_notice_ack',
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid('user_id').notNull(),
    context: text('context', { enum: NOTICE_CONTEXTS }).notNull(),
    version: text('version').notNull(),
    acknowledgedAt: ts('acknowledged_at').notNull(),
  },
  (t) => [uniqueIndex('privacy_notice_ack_uq').on(t.userId, t.context, t.version)],
);

export const privacyRequest = pgTable(
  'privacy_request',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    kind: text('kind', { enum: ['ACCESS', 'CORRECTION'] }).notNull(),
    requesterUserId: uuid('requester_user_id'),
    requesterName: text('requester_name').notNull(),
    requesterEmail: text('requester_email').notNull(),
    channel: text('channel', { enum: ['SELF', 'STAFF_LOGGED'] }).notNull(),
    lodgedBy: uuid('lodged_by'),
    details: text('details').notNull(),
    correctionField: text('correction_field', { enum: ['name', 'email'] }),
    correctionValue: text('correction_value'),
    correctionApplied: boolean('correction_applied').notNull().default(false),
    status: text('status', { enum: ['RECEIVED', 'IN_PROGRESS', 'COMPLETED', 'REFUSED'] })
      .notNull()
      .default('RECEIVED'),
    dueDate: date('due_date').notNull(),
    assignedTo: uuid('assigned_to'),
    identityVerified: boolean('identity_verified').notNull().default(false),
    verificationMethod: text('verification_method'),
    verifiedBy: uuid('verified_by'),
    verifiedAt: ts('verified_at'),
    responseSummary: text('response_summary'),
    refusalReason: text('refusal_reason'),
    exportGeneratedAt: ts('export_generated_at'),
    escalatedAt: ts('escalated_at'),
    completedAt: ts('completed_at'),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('privacy_request_number_uq').on(t.tenantId, t.number),
    index('privacy_request_status_idx').on(t.tenantId, t.status, t.dueDate),
  ],
);

export const contentFlag = pgTable(
  'content_flag',
  {
    id: id(),
    tenantId: tenantId(),
    source: text('source').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    signals: jsonb('signals').notNull().default([]),
    excerpt: text('excerpt').notNull(),
    actorId: uuid('actor_id'),
    status: text('status', { enum: ['OPEN', 'REVIEWED'] })
      .notNull()
      .default('OPEN'),
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: ts('reviewed_at'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('content_flag_idx').on(t.tenantId, t.createdAt)],
);

export const BREACH_STATUSES = ['OPEN', 'ASSESSING', 'NOTIFIED', 'CLOSED'] as const;

export const breachIncident = pgTable(
  'breach_incident',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    reportedBy: uuid('reported_by').notNull(),
    reportedAt: ts('reported_at').notNull(),
    discoveredAt: ts('discovered_at').notNull(),
    dataKinds: jsonb('data_kinds').notNull().default([]),
    individualsCount: integer('individuals_count').notNull().default(0),
    status: text('status', { enum: BREACH_STATUSES }).notNull().default('OPEN'),
    assessment: jsonb('assessment'),
    containment: jsonb('containment').notNull().default([]),
    assessmentDue: date('assessment_due').notNull(),
    notifications: jsonb('notifications').notNull().default([]),
    reminders: jsonb('reminders').notNull().default([]),
    escalatedAt: ts('escalated_at'),
    lessons: text('lessons'),
    closedAt: ts('closed_at'),
    closedBy: uuid('closed_by'),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('breach_incident_number_uq').on(t.tenantId, t.number),
    index('breach_incident_status_idx').on(t.tenantId, t.status, t.assessmentDue),
  ],
);
