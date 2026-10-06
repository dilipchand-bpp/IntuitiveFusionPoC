/**
 * Batch B10b: ERP sync (NFR-C02), legal system status sync (NFR-C03), HR feed (FR-0815), payment execution (FR-0875).
 * Re-exported from schema.ts; migration 0022_b10_erp_hr_payments.sql is the DDL. The two small column helpers are repeated
 * on purpose, as in schema-b10a.ts: importing them back from schema.ts would be a circular import.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
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

// ---------------------------------------------------------------- NFR-C02 imported ERP data
export const costCentre = pgTable(
  'cost_centre',
  {
    id: id(),
    tenantId: tenantId(),
    externalId: text('external_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    orgUnitExternalId: text('org_unit_external_id'),
    ownerName: text('owner_name'),
    active: boolean('active').notNull().default(true),
    provider: text('provider').notNull(),
    hash: text('hash').notNull(),
    firstSeenAt: ts('first_seen_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
    removedAt: ts('removed_at'),
  },
  (t) => [uniqueIndex('cost_centre_uq').on(t.tenantId, t.externalId)],
);

export const erpOrgUnit = pgTable(
  'erp_org_unit',
  {
    id: id(),
    tenantId: tenantId(),
    externalId: text('external_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    parentExternalId: text('parent_external_id'),
    active: boolean('active').notNull().default(true),
    provider: text('provider').notNull(),
    hash: text('hash').notNull(),
    firstSeenAt: ts('first_seen_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
    removedAt: ts('removed_at'),
  },
  (t) => [uniqueIndex('erp_org_unit_uq').on(t.tenantId, t.externalId)],
);

export const erpBudgetLine = pgTable(
  'erp_budget_line',
  {
    id: id(),
    tenantId: tenantId(),
    externalId: text('external_id').notNull(),
    costCentreExternalId: text('cost_centre_external_id').notNull(),
    financialYear: text('financial_year').notNull(),
    category: text('category'),
    amount: numeric('amount', { precision: 16, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('AUD'),
    provider: text('provider').notNull(),
    hash: text('hash').notNull(),
    firstSeenAt: ts('first_seen_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
    removedAt: ts('removed_at'),
  },
  (t) => [
    uniqueIndex('erp_budget_line_uq').on(t.tenantId, t.externalId),
    index('erp_budget_line_cc_idx').on(t.tenantId, t.costCentreExternalId, t.financialYear),
  ],
);

export const ledgerEntry = pgTable(
  'ledger_entry',
  {
    id: id(),
    tenantId: tenantId(),
    externalId: text('external_id').notNull(),
    costCentreExternalId: text('cost_centre_external_id').notNull(),
    postingDate: date('posting_date').notNull(),
    financialYear: text('financial_year').notNull(),
    account: text('account').notNull(),
    description: text('description').notNull().default(''),
    amount: numeric('amount', { precision: 16, scale: 2 }).notNull(),
    kind: text('kind', { enum: ['ACTUAL', 'COMMITMENT'] })
      .notNull()
      .default('ACTUAL'),
    currency: text('currency').notNull().default('AUD'),
    provider: text('provider').notNull(),
    hash: text('hash').notNull(),
    firstSeenAt: ts('first_seen_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
    removedAt: ts('removed_at'),
  },
  (t) => [
    uniqueIndex('ledger_entry_uq').on(t.tenantId, t.externalId),
    index('ledger_entry_cc_idx').on(t.tenantId, t.costCentreExternalId, t.financialYear),
  ],
);

export const erpSync = pgTable(
  'erp_sync',
  {
    id: id(),
    tenantId: tenantId(),
    syncRunId: uuid('sync_run_id'),
    provider: text('provider').notNull(),
    sourceRevision: integer('source_revision').notNull().default(1),
    financialYear: text('financial_year').notNull(),
    counts: jsonb('counts').notNull().default({}),
    status: text('status', { enum: ['OK', 'FAILED'] }).notNull(),
    error: text('error'),
    triggeredBy: uuid('triggered_by'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('erp_sync_idx').on(t.tenantId, t.createdAt)],
);

// ---------------------------------------------------------------- NFR-C03 legal system status
export const legalMatterSync = pgTable('legal_matter_sync', {
  matterId: uuid('matter_id').primaryKey(),
  tenantId: tenantId(),
  stage: text('stage'),
  closedAt: ts('closed_at'),
  outcome: text('outcome'),
  lastEventId: text('last_event_id'),
  updatedAt: ts('updated_at').notNull(),
});

export const legalMatterDocument = pgTable(
  'legal_matter_document',
  {
    id: id(),
    tenantId: tenantId(),
    matterId: uuid('matter_id').notNull(),
    externalId: text('external_id').notNull(),
    name: text('name').notNull(),
    docKind: text('doc_kind'),
    eventId: text('event_id').notNull(),
    attachedAt: ts('attached_at').notNull(),
  },
  (t) => [uniqueIndex('legal_matter_document_uq').on(t.tenantId, t.externalId)],
);

// ---------------------------------------------------------------- FR-0815 HR feed
export const HR_EVENT_TYPES = ['STARTER', 'LEAVER', 'ROLE_CHANGE', 'DELEGATE_CHANGE'] as const;
export type HrEventType = (typeof HR_EVENT_TYPES)[number];
export const HR_OUTCOMES = ['APPLIED', 'NO_CHANGE', 'CAPPED', 'REFUSED', 'NEEDS_HUMAN'] as const;
export type HrOutcome = (typeof HR_OUTCOMES)[number];

export const hrFeedBatch = pgTable(
  'hr_feed_batch',
  {
    id: id(),
    tenantId: tenantId(),
    batchRef: text('batch_ref').notNull(),
    provider: text('provider').notNull(),
    counts: jsonb('counts').notNull().default({}),
    triggeredBy: uuid('triggered_by'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [uniqueIndex('hr_feed_batch_uq').on(t.tenantId, t.batchRef)],
);

export const hrFeedEvent = pgTable(
  'hr_feed_event',
  {
    id: id(),
    tenantId: tenantId(),
    batchId: uuid('batch_id').notNull(),
    eventId: text('event_id').notNull(),
    type: text('type', { enum: HR_EVENT_TYPES }).notNull(),
    subjectEmail: text('subject_email').notNull(),
    payload: jsonb('payload').notNull().default({}),
    outcome: text('outcome', { enum: HR_OUTCOMES }).notNull(),
    detail: text('detail').notNull().default(''),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [uniqueIndex('hr_feed_event_uq').on(t.tenantId, t.eventId)],
);

export const hrDelegateChange = pgTable(
  'hr_delegate_change',
  {
    id: id(),
    tenantId: tenantId(),
    eventId: text('event_id').notNull(),
    delegatorId: uuid('delegator_id').notNull(),
    delegateId: uuid('delegate_id').notNull(),
    scope: text('scope').notNull(),
    requestedLimit: numeric('requested_limit', { precision: 14, scale: 2 }).notNull(),
    appliedLimit: numeric('applied_limit', { precision: 14, scale: 2 }).notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    status: text('status', { enum: ['SCHEDULED', 'ACTIVE', 'EXPIRED'] }).notNull(),
    delegationId: uuid('delegation_id'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [uniqueIndex('hr_delegate_change_uq').on(t.tenantId, t.eventId)],
);

export const hrReassignment = pgTable(
  'hr_reassignment',
  {
    id: id(),
    tenantId: tenantId(),
    leaverId: uuid('leaver_id').notNull(),
    backupId: uuid('backup_id'),
    kind: text('kind', { enum: ['DELEGATION', 'REQUEST', 'CONTRACT'] }).notNull(),
    refId: uuid('ref_id').notNull(),
    label: text('label').notNull(),
    eventId: text('event_id').notNull(),
    status: text('status', { enum: ['OPEN', 'DONE'] })
      .notNull()
      .default('OPEN'),
    createdAt: ts('created_at').notNull(),
    doneBy: uuid('done_by'),
    doneAt: ts('done_at'),
  },
  (t) => [uniqueIndex('hr_reassignment_uq').on(t.tenantId, t.kind, t.refId, t.leaverId)],
);

// ---------------------------------------------------------------- FR-0875 payments
export const PAYMENT_STATUSES = ['PROPOSED', 'APPROVED', 'SENT', 'CONFIRMED', 'FAILED', 'CANCELLED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const payment = pgTable(
  'payment',
  {
    id: id(),
    tenantId: tenantId(),
    invoiceId: uuid('invoice_id').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('AUD'),
    status: text('status', { enum: PAYMENT_STATUSES }).notNull().default('PROPOSED'),
    financeRef: text('finance_ref'),
    idempotencyKey: text('idempotency_key').notNull(),
    createdBy: uuid('created_by').notNull(),
    approvedBy: uuid('approved_by'),
    approvedAt: ts('approved_at'),
    sentAt: ts('sent_at'),
    confirmedAt: ts('confirmed_at'),
    failureReason: text('failure_reason'),
    simulateFailure: boolean('simulate_failure').notNull().default(false),
    attempts: integer('attempts').notNull().default(0),
    eventId: uuid('event_id'),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('payment_idem_uq').on(t.tenantId, t.idempotencyKey),
    index('payment_invoice_idx').on(t.invoiceId),
  ],
);

export const paymentTrail = pgTable(
  'payment_trail',
  {
    id: id(),
    tenantId: tenantId(),
    paymentId: uuid('payment_id').notNull(),
    at: ts('at').notNull(),
    status: text('status').notNull(),
    actorId: uuid('actor_id'),
    note: text('note').notNull().default(''),
  },
  (t) => [index('payment_trail_idx').on(t.paymentId, t.at)],
);
