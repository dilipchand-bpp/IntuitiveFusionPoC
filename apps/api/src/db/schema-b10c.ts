/**
 * Batch B10c: e-signature envelopes (NFR-C04), the simulated enterprise document repository (NFR-C06) and business-continuity
 * alerts with response trackers (FR-0860). Re-exported from schema.ts. The two small column helpers are repeated here on
 * purpose, as in schema-b10a.ts: schema.ts re-exports this file, so importing them back would be a circular import.
 */
import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`);
const tenantId = () => uuid('tenant_id').notNull();
const ts = (name: string) => timestamp(name, { withTimezone: true });

export const ESIGN_PROVIDERS = ['DOCUSIGN', 'ADOBE', 'SIMULATED_QTSP'] as const;
export const ENVELOPE_STATUSES = ['SENT', 'COMPLETED', 'DECLINED', 'VOIDED', 'EXPIRED'] as const;
export const SIGNATORY_STATUSES = [
  'CREATED',
  'SENT',
  'DELIVERED',
  'VIEWED',
  'SIGNED',
  'DECLINED',
  'VOIDED',
  'EXPIRED',
] as const;

/** One envelope per release for signing, held with the simulated provider. The platform stays the source of truth. */
export const esignEnvelope = pgTable(
  'esign_envelope',
  {
    id: id(),
    tenantId: tenantId(),
    contractId: uuid('contract_id').notNull(),
    provider: text('provider', { enum: ESIGN_PROVIDERS }).notNull(),
    externalId: text('external_id').notNull(),
    status: text('status', { enum: ENVELOPE_STATUSES }).notNull().default('SENT'),
    signingMode: text('signing_mode', { enum: ['STANDARD', 'BLIND', 'STAGED'] }).notNull(),
    /** What was sent to the provider, in that provider's own shape. */
    providerPayload: jsonb('provider_payload').notNull().default({}),
    closedReason: text('closed_reason'),
    createdBy: uuid('created_by'),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [
    index('esign_envelope_contract_idx').on(t.tenantId, t.contractId),
    uniqueIndex('esign_envelope_external_uq').on(t.tenantId, t.externalId),
  ],
);

/** A signatory pre-filled from the contract's signature chain. The token is stored hashed, like approval links. */
export const esignSignatory = pgTable(
  'esign_signatory',
  {
    id: id(),
    tenantId: tenantId(),
    envelopeId: uuid('envelope_id').notNull(),
    userId: uuid('user_id').notNull(),
    role: text('role').notNull(),
    roleLabel: text('role_label').notNull(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    routingOrder: integer('routing_order').notNull().default(1),
    /** The provider's own reference for this recipient (DocuSign recipientId, Adobe participant id). */
    recipientRef: text('recipient_ref').notNull(),
    status: text('status', { enum: SIGNATORY_STATUSES }).notNull().default('SENT'),
    tokenHash: text('token_hash').notNull(),
    tokenExpiresAt: ts('token_expires_at').notNull(),
    declineReason: text('decline_reason'),
    signedAt: ts('signed_at'),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('esign_signatory_token_uq').on(t.tokenHash),
    index('esign_signatory_env_idx').on(t.envelopeId),
  ],
);

/** Every provider event, applied once. `eventId` is unique per tenant, so a repeated callback changes nothing. */
export const esignEvent = pgTable(
  'esign_event',
  {
    id: id(),
    tenantId: tenantId(),
    envelopeId: uuid('envelope_id').notNull(),
    signatoryId: uuid('signatory_id'),
    eventId: text('event_id').notNull(),
    type: text('type').notNull(),
    providerType: text('provider_type'),
    source: text('source', { enum: ['PLATFORM', 'PROVIDER'] }).notNull(),
    outcome: text('outcome', { enum: ['APPLIED', 'DUPLICATE', 'IGNORED', 'REFUSED'] }).notNull(),
    detail: text('detail'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('esign_event_uq').on(t.tenantId, t.eventId),
    index('esign_event_env_idx').on(t.envelopeId, t.createdAt),
  ],
);

/**
 * The simulated enterprise document repository (NFR-C06): one row per version of a file in a project's site. A file is never
 * overwritten: a write adds the next version. Content is a small base64 text, enough for the synthetic documents of this
 * proof of concept.
 */
export const repoDocument = pgTable(
  'repo_document',
  {
    id: id(),
    tenantId: tenantId(),
    requestId: uuid('request_id').notNull(),
    folder: text('folder').notNull(),
    name: text('name').notNull(),
    version: integer('version').notNull(),
    checksum: text('checksum').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    contentType: text('content_type').notNull(),
    contentBase64: text('content_base64').notNull(),
    comment: text('comment'),
    source: text('source', { enum: ['UPLOAD', 'PLATFORM'] })
      .notNull()
      .default('UPLOAD'),
    sourceRef: text('source_ref'),
    createdBy: uuid('created_by'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('repo_document_version_uq').on(t.tenantId, t.requestId, t.folder, t.name, t.version),
    index('repo_document_project_idx').on(t.tenantId, t.requestId),
  ],
);

/** A business-continuity event (FR-0860): what happened, how serious, who is affected and when to escalate. */
export const continuityEvent = pgTable(
  'continuity_event',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    title: text('title').notNull(),
    kind: text('kind', { enum: ['SUPPLIER_OUTAGE', 'SITE_CLOSURE', 'CYBER_INCIDENT', 'OTHER'] }).notNull(),
    severity: text('severity', { enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] }).notNull(),
    status: text('status', { enum: ['OPEN', 'CLOSED'] })
      .notNull()
      .default('OPEN'),
    message: text('message').notNull(),
    smsText: text('sms_text').notNull(),
    emailSubject: text('email_subject').notNull(),
    affectedSupplierIds: jsonb('affected_supplier_ids').notNull().default([]),
    affectedContractIds: jsonb('affected_contract_ids').notNull().default([]),
    groups: jsonb('groups').notNull().default([]),
    escalateAfterMinutes: integer('escalate_after_minutes').notNull().default(30),
    escalateToUserId: uuid('escalate_to_user_id'),
    escalatedAt: ts('escalated_at'),
    responseValidHours: integer('response_valid_hours').notNull().default(48),
    raisedBy: uuid('raised_by').notNull(),
    raisedAt: ts('raised_at').notNull(),
    closedBy: uuid('closed_by'),
    closedAt: ts('closed_at'),
    summary: text('summary'),
  },
  (t) => [uniqueIndex('continuity_event_number_uq').on(t.tenantId, t.number)],
);

/** One row per person asked to respond: who they are, the one-time link (hashed) and their latest answer. */
export const continuityResponse = pgTable(
  'continuity_response',
  {
    id: id(),
    tenantId: tenantId(),
    eventId: uuid('event_id').notNull(),
    userId: uuid('user_id'),
    name: text('name').notNull(),
    email: text('email').notNull(),
    phone: text('phone').notNull(),
    groupKey: text('group_key', {
      enum: ['CONTRACT_OWNER', 'SUPPLIER_CONTACT', 'EXECUTIVE', 'NAMED'],
    }).notNull(),
    organisation: text('organisation'),
    tokenHash: text('token_hash').notNull(),
    tokenExpiresAt: ts('token_expires_at').notNull(),
    response: text('response', { enum: ['NONE', 'SAFE', 'AFFECTED', 'NEED_HELP'] })
      .notNull()
      .default('NONE'),
    note: text('note'),
    via: text('via', { enum: ['WEB_LINK', 'STAFF_PHONE'] }),
    respondedAt: ts('responded_at'),
    recordedBy: uuid('recorded_by'),
    changeCount: integer('change_count').notNull().default(0),
    history: jsonb('history').notNull().default([]),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('continuity_response_token_uq').on(t.tokenHash),
    index('continuity_response_event_idx').on(t.tenantId, t.eventId),
  ],
);

/** An SMS or an email handed to the simulated gateway (MESSAGING connector). Nothing is ever sent. */
export const continuityMessage = pgTable(
  'continuity_message',
  {
    id: id(),
    tenantId: tenantId(),
    eventId: uuid('event_id').notNull(),
    /** Empty for a message to the escalation contact, who is not asked to respond. */
    responseId: uuid('response_id'),
    toName: text('to_name').notNull(),
    channel: text('channel', { enum: ['SMS', 'EMAIL'] }).notNull(),
    toAddress: text('to_address').notNull(),
    subject: text('subject'),
    body: text('body').notNull(),
    status: text('status', { enum: ['QUEUED', 'SENT', 'DELIVERED', 'FAILED'] })
      .notNull()
      .default('QUEUED'),
    gatewayId: text('gateway_id'),
    failure: text('failure'),
    kind: text('kind', { enum: ['ALERT', 'REMINDER', 'ESCALATION'] })
      .notNull()
      .default('ALERT'),
    attempt: integer('attempt').notNull().default(1),
    queuedAt: ts('queued_at').notNull(),
    sentAt: ts('sent_at'),
    deliveredAt: ts('delivered_at'),
  },
  (t) => [index('continuity_message_event_idx').on(t.tenantId, t.eventId)],
);
