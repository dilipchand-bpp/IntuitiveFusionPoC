/**
 * Batch B11a: encryption and key management, upload scanning, restricted projects (SEC-D01, SEC-D02, SEC-D03, SEC-D04,
 * SEC-AP04, FR-0865, SEC-D10). Re-exported from schema.ts; migration 0024_b11_encryption_keys.sql is the DDL.
 * The small column helpers are repeated on purpose (see schema-b10a.ts): importing them back would be circular.
 */
import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`);
const tenantId = () => uuid('tenant_id').notNull();
const ts = (name: string) => timestamp(name, { withTimezone: true });

export const KEY_PURPOSES = ['DATA', 'BIDS', 'PROJECT'] as const;
export type KeyPurpose = (typeof KEY_PURPOSES)[number];
export const KEY_STATES = ['ACTIVE', 'RETIRED', 'DISABLED'] as const;
export type KeyState = (typeof KEY_STATES)[number];

/** A key-encryption key version. The key material is wrapped under the platform root key; it is never stored in clear. */
export const kmsKey = pgTable(
  'kms_key',
  {
    id: id(),
    tenantId: tenantId(),
    purpose: text('purpose', { enum: KEY_PURPOSES }).notNull(),
    version: integer('version').notNull(),
    wrappedKey: text('wrapped_key').notNull(),
    iv: text('iv').notNull(),
    fingerprint: text('fingerprint').notNull(),
    state: text('state', { enum: KEY_STATES }).notNull().default('ACTIVE'),
    createdAt: ts('created_at').notNull(),
    createdBy: uuid('created_by'),
    retiredAt: ts('retired_at'),
    disabledAt: ts('disabled_at'),
    disabledBy: uuid('disabled_by'),
    rewrappedAt: ts('rewrapped_at'),
  },
  (t) => [uniqueIndex('kms_key_uq').on(t.tenantId, t.purpose, t.version)],
);

export const QUARANTINE_STATUSES = ['QUARANTINED', 'PENDING_SCAN', 'CLEARED'] as const;
export type QuarantineStatus = (typeof QUARANTINE_STATUSES)[number];

/** An upload that was refused as infected (content never kept) or is held until the scanner is back (content sealed). */
export const quarantineItem = pgTable(
  'quarantine_item',
  {
    id: id(),
    tenantId: tenantId(),
    source: text('source').notNull(),
    name: text('name').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    signature: text('signature'),
    status: text('status', { enum: QUARANTINE_STATUSES }).notNull(),
    userId: uuid('user_id'),
    heldContent: text('held_content'),
    createdAt: ts('created_at').notNull(),
    scannedAt: ts('scanned_at'),
    scannedBy: uuid('scanned_by'),
  },
  (t) => [
    index('quarantine_item_idx').on(t.tenantId, t.createdAt),
    index('quarantine_item_hash_idx').on(t.tenantId, t.sha256),
  ],
);

/** A procurement marked restricted: its per-project data key is wrapped by the tenant PROJECT key (FR-0865). */
export const restrictedProject = pgTable(
  'restricted_project',
  {
    requestId: uuid('request_id').primaryKey(),
    tenantId: tenantId(),
    reason: text('reason').notNull(),
    setBy: uuid('set_by').notNull(),
    setAt: ts('set_at').notNull(),
    keyVersion: integer('key_version').notNull(),
    wrappedDek: text('wrapped_dek').notNull(),
    iv: text('iv').notNull(),
    rewrappedAt: ts('rewrapped_at'),
  },
  (t) => [index('restricted_project_tenant_idx').on(t.tenantId)],
);

/** People named by the sourcing group as delegates for one restricted project. */
export const restrictedDelegate = pgTable(
  'restricted_delegate',
  {
    id: id(),
    tenantId: tenantId(),
    requestId: uuid('request_id').notNull(),
    userId: uuid('user_id').notNull(),
    addedBy: uuid('added_by').notNull(),
    addedAt: ts('added_at').notNull(),
  },
  (t) => [uniqueIndex('restricted_delegate_uq').on(t.requestId, t.userId)],
);
