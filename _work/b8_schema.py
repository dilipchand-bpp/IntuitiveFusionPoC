p = 'apps/api/src/db/schema.ts'
s = open(p, encoding='utf8', newline='').read().replace('\r\n', '\n')


def sub(a, b):
    global s
    assert a in s, a
    s = s.replace(a, b, 1)


sub("""  shortlistedAt: timestamp('shortlisted_at', { withTimezone: true }),
  createdAt: created(),
  updatedAt: updated(),
  version: version(),
});

export const invitation""", """  shortlistedAt: timestamp('shortlisted_at', { withTimezone: true }),
  /** High-value or high-risk: the sealed bids stay shut after close until two independent witnesses release them (FR-0175). */
  dualWitness: boolean('dual_witness').notNull().default(false),
  openedAt: timestamp('opened_at', { withTimezone: true }),
  /** Least insurance cover a supplier must hold to submit (FR-0185). */
  requiredCover: numeric('required_cover', { precision: 14, scale: 2 }),
  createdAt: created(),
  updatedAt: updated(),
  version: version(),
});

export const invitation""")
sub("""  location: jsonb('location'),
  createdAt: created(),
});

export const request =""", """  location: jsonb('location'),
  /** The insurance certificate a supplier uploaded and what was read from it (FR-0185). */
  insuranceCertificate: jsonb('insurance_certificate'),
  createdAt: created(),
});

export const request =""")
sub("""  dueOn: date('due_on'),
  createdBy: uuid('created_by').notNull(),
  createdAt: created(),
  updatedAt: updated(),
});

export const legalTimeEntry""", """  dueOn: date('due_on'),
  /** The matter's reference in the customer's own legal platform, and the stage that platform last reported (FR-0390). */
  externalRef: text('external_ref'),
  externalStage: text('external_stage'),
  createdBy: uuid('created_by').notNull(),
  createdAt: created(),
  updatedAt: updated(),
});

export const legalTimeEntry""")
sub("""  editedBy: uuid('edited_by'),
  editedAt: timestamp('edited_at', { withTimezone: true }),
});

export const alert""", """  editedBy: uuid('edited_by'),
  editedAt: timestamp('edited_at', { withTimezone: true }),
  /** Redacted wording is withheld from exports and from anyone who is not Legal (FR-0830). */
  redacted: boolean('redacted').notNull().default(false),
  /** A clause Legal inserted sits after this one; null for template clauses (FR-0830). */
  afterClauseId: text('after_clause_id'),
});

export const alert""")
s += """
// ------------------------------------------------------------------ B8: tender, contract and supplier intelligence

export const responseItem = pgTable(
  'response_item',
  {
    id: id(),
    tenantId: tenantId(),
    tenderId: uuid('tender_id').notNull(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    section: text('section', { enum: ['TECHNICAL', 'COMMERCIAL'] }).notNull(),
    kind: text('kind', { enum: ['TEXT', 'NUMBER', 'CHOICE', 'YESNO', 'DATE'] }).notNull(),
    required: boolean('required').notNull().default(true),
    options: jsonb('options').notNull().default([]),
    unit: text('unit'),
    maxLength: integer('max_length'),
    position: integer('position').notNull().default(0),
    createdAt: created(),
  },
  (t) => [uniqueIndex('response_item_uq').on(t.tenderId, t.key)],
);

export const responseAnswer = pgTable(
  'response_answer',
  {
    id: id(),
    tenantId: tenantId(),
    submissionId: uuid('submission_id').notNull(),
    itemKey: text('item_key').notNull(),
    value: text('value').notNull(),
    updatedAt: updated(),
  },
  (t) => [uniqueIndex('response_answer_uq').on(t.submissionId, t.itemKey)],
);

export const bidWitness = pgTable(
  'bid_witness',
  {
    id: id(),
    tenantId: tenantId(),
    tenderId: uuid('tender_id').notNull(),
    userId: uuid('user_id').notNull(),
    witnessedAt: timestamp('witnessed_at', { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex('bid_witness_uq').on(t.tenderId, t.userId)],
);

/** Everything that leaves the platform for another system, kept so a failed delivery can be retried (FR-0390, NFR-AV03). */
export const integrationEvent = pgTable(
  'integration_event',
  {
    id: id(),
    tenantId: tenantId(),
    kind: text('kind').notNull(),
    target: text('target').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    payload: jsonb('payload').notNull().default({}),
    status: text('status', { enum: ['PENDING', 'DELIVERED', 'FAILED'] })
      .notNull()
      .default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('integration_event_uq').on(t.tenantId, t.idempotencyKey)],
);

export const legalRedline = pgTable('legal_redline', {
  id: id(),
  tenantId: tenantId(),
  contractId: uuid('contract_id').notNull(),
  clauseId: text('clause_id').notNull(),
  proposedText: text('proposed_text').notNull(),
  source: text('source', { enum: ['INTERNAL', 'LEGAL_PLATFORM', 'EXTERNAL_COUNSEL', 'SUPPLIER'] }).notNull(),
  author: text('author').notNull(),
  status: text('status', { enum: ['PROPOSED', 'ACCEPTED', 'REJECTED'] })
    .notNull()
    .default('PROPOSED'),
  decidedBy: uuid('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const supplierRating = pgTable(
  'supplier_rating',
  {
    id: id(),
    tenantId: tenantId(),
    supplierId: uuid('supplier_id').notNull(),
    contractId: uuid('contract_id').notNull(),
    direction: text('direction', { enum: ['ENTERPRISE_RATES_SUPPLIER', 'SUPPLIER_RATES_ENTERPRISE'] }).notNull(),
    raterId: uuid('rater_id').notNull(),
    scores: jsonb('scores').notNull(),
    overall: numeric('overall', { precision: 3, scale: 2 }).notNull(),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex('supplier_rating_uq').on(t.contractId, t.direction, t.raterId)],
);

export const duplicateDismissal = pgTable(
  'duplicate_dismissal',
  {
    id: id(),
    tenantId: tenantId(),
    supplierA: uuid('supplier_a').notNull(),
    supplierB: uuid('supplier_b').notNull(),
    userId: uuid('user_id').notNull(),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex('duplicate_dismissal_uq').on(t.supplierA, t.supplierB)],
);

export const lesson = pgTable('lesson', {
  id: id(),
  tenantId: tenantId(),
  requestId: uuid('request_id').notNull(),
  authorId: uuid('author_id').notNull(),
  phase: text('phase').notNull(),
  kind: text('kind', { enum: ['WENT_WELL', 'TO_IMPROVE', 'RISK', 'TIP'] }).notNull(),
  text: text('text').notNull(),
  category: text('category'),
  value: numeric('value', { precision: 14, scale: 2 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

/** A one-time link that lets an approver decide one thing without a full sign-in (NFR-U05). Only the hash is kept. */
export const approvalLink = pgTable('approval_link', {
  id: id(),
  tenantId: tenantId(),
  tokenHash: text('token_hash').notNull().unique(),
  userId: uuid('user_id').notNull(),
  subjectType: text('subject_type', { enum: ['PLAN', 'EVAL_REPORT'] }).notNull(),
  subjectId: uuid('subject_id').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});
"""
open(p, 'w', encoding='utf8', newline='').write(s)
print('ok')
