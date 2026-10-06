/**
 * Batch B10a: the connector foundation (NFR-C07, SEC-N03, NFR-C05, NFR-AV03, SEC-TP04, NFR-AV04).
 * Re-exported from schema.ts. The two small column helpers are repeated here on purpose: schema.ts re-exports this file,
 * so importing them back would be a circular import evaluated in the wrong order.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
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

export const CONNECTOR_KINDS = [
  'HR',
  'ERP',
  'LEGAL',
  'ESIGN',
  'SANCTIONS',
  'INSURANCE',
  'DOCREPO',
  'MESSAGING',
  'PAYMENTS',
  'MIDDLEWARE',
  'AI',
] as const;
export type ConnectorKind = (typeof CONNECTOR_KINDS)[number];

/** One configured connection per kind per tenant. The config holds names of secrets, never the secrets (SEC-N03). */
export const connector = pgTable(
  'connector',
  {
    id: id(),
    tenantId: tenantId(),
    kind: text('kind', { enum: CONNECTOR_KINDS }).notNull(),
    provider: text('provider').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    mode: text('mode', { enum: ['UP', 'DOWN'] })
      .notNull()
      .default('UP'),
    config: jsonb('config').notNull().default({}),
    breakerState: text('breaker_state', { enum: ['CLOSED', 'OPEN', 'HALF_OPEN'] })
      .notNull()
      .default('CLOSED'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    breakerOpenedAt: ts('breaker_opened_at'),
    lastOkAt: ts('last_ok_at'),
    lastError: text('last_error'),
    rejectedCount: integer('rejected_count').notNull().default(0),
    lastRejectedAt: ts('last_rejected_at'),
    lastRejectedReason: text('last_rejected_reason'),
    updatedBy: uuid('updated_by'),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [uniqueIndex('connector_uq').on(t.tenantId, t.kind)],
);

/** A secret kept encrypted (AES-256-GCM); every rotation is a new version and the old one is retired (SEC-N03). */
export const secretEntry = pgTable(
  'secret_entry',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    version: integer('version').notNull(),
    ciphertext: text('ciphertext').notNull(),
    iv: text('iv').notNull(),
    fingerprint: text('fingerprint').notNull(),
    createdAt: ts('created_at').notNull(),
    retiredAt: ts('retired_at'),
    rotatedBy: uuid('rotated_by'),
  },
  (t) => [uniqueIndex('secret_entry_uq').on(t.tenantId, t.name, t.version)],
);

/** One reconciliation of what the platform sent against what the other side acknowledged (NFR-AV03). */
export const syncRun = pgTable(
  'sync_run',
  {
    id: id(),
    tenantId: tenantId(),
    connectorKind: text('connector_kind').notNull(),
    direction: text('direction', { enum: ['OUT', 'IN'] }).notNull(),
    startedAt: ts('started_at').notNull(),
    finishedAt: ts('finished_at'),
    status: text('status', { enum: ['RUNNING', 'OK', 'REPAIRED', 'PARTIAL', 'FAILED'] }).notNull(),
    expectedCount: integer('expected_count').notNull().default(0),
    receivedCount: integer('received_count').notNull().default(0),
    missing: jsonb('missing').notNull().default([]),
    repaired: integer('repaired').notNull().default(0),
    triggeredBy: uuid('triggered_by'),
  },
  (t) => [index('sync_run_idx').on(t.tenantId, t.startedAt)],
);

/** Work a person does by hand while a system is down, so the user's own work is never blocked (NFR-AV04). */
export const manualTask = pgTable(
  'manual_task',
  {
    id: id(),
    tenantId: tenantId(),
    connectorKind: text('connector_kind').notNull(),
    title: text('title').notNull(),
    instructions: text('instructions').notNull(),
    payloadSummary: jsonb('payload_summary').notNull().default({}),
    eventId: uuid('event_id'),
    status: text('status', { enum: ['OPEN', 'DONE', 'SUPERSEDED'] })
      .notNull()
      .default('OPEN'),
    reference: text('reference'),
    createdAt: ts('created_at').notNull(),
    completedBy: uuid('completed_by'),
    completedAt: ts('completed_at'),
  },
  (t) => [uniqueIndex('manual_task_event_uq').on(t.tenantId, t.eventId)],
);
