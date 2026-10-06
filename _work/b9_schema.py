p = 'apps/api/src/db/schema.ts'
s = open(p, encoding='utf8', newline='').read().replace('\r\n', '\n')


def sub(a, b):
    global s
    assert a in s, a[:80]
    s = s.replace(a, b, 1)


sub("""    managerId: uuid('manager_id'),
    createdAt: created(),
    updatedAt: updated(),
    version: version(),
  },
  (t) => [
    uniqueIndex('request_number_uq')""", """    managerId: uuid('manager_id'),
    /** When the amount was entered in a foreign currency: what was typed and the rate used. `estimated_value` is always in the base currency (FR-0810). */
    originalAmount: numeric('original_amount', { precision: 14, scale: 2 }),
    fxRate: numeric('fx_rate', { precision: 18, scale: 8 }),
    createdAt: created(),
    updatedAt: updated(),
    version: version(),
  },
  (t) => [
    uniqueIndex('request_number_uq')""")
sub("""  division: text('division'),
  active: boolean('active').notNull().default(true),""", """  division: text('division'),
  /** A grant for spend in a foreign currency; the other grants apply to spend in the base currency only (FR-0810). */
  international: boolean('international').notNull().default(false),
  active: boolean('active').notNull().default(true),""")
sub("kind: text('kind', { enum: ['PLAN', 'RFX', 'REPORT'] }).notNull(),", "kind: text('kind', { enum: ['PLAN', 'RFX', 'REPORT', 'INTAKE', 'CONTRACT'] }).notNull(),")
s += """
// ------------------------------------------------------------------ B9: planning, spend and experience

export const fxRate = pgTable(
  'fx_rate',
  {
    id: id(),
    tenantId: tenantId(),
    currency: text('currency').notNull(),
    rate: numeric('rate', { precision: 18, scale: 8 }).notNull(),
    asOf: date('as_of').notNull(),
    source: text('source', { enum: ['ANNUAL', 'LIVE', 'MANUAL'] }).notNull(),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex('fx_rate_uq').on(t.tenantId, t.currency, t.asOf)],
);

export const catalogueItem = pgTable(
  'catalogue_item',
  {
    id: id(),
    tenantId: tenantId(),
    supplierId: uuid('supplier_id').notNull(),
    contractId: uuid('contract_id'),
    sku: text('sku').notNull(),
    name: text('name').notNull(),
    category: text('category').notNull(),
    unit: text('unit').notNull().default('each'),
    unitPrice: numeric('unit_price', { precision: 14, scale: 4 }).notNull(),
    leadDays: integer('lead_days').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex('catalogue_item_uq').on(t.tenantId, t.supplierId, t.sku)],
);

export const sourcingProposal = pgTable('sourcing_proposal', {
  id: id(),
  tenantId: tenantId(),
  requesterId: uuid('requester_id').notNull(),
  need: text('need').notNull(),
  category: text('category'),
  quantity: numeric('quantity', { precision: 14, scale: 2 }).notNull(),
  status: text('status', { enum: ['PROPOSED', 'APPROVED', 'REJECTED', 'ORDERED', 'NO_MATCH'] })
    .notNull()
    .default('PROPOSED'),
  shortlist: jsonb('shortlist').notNull().default([]),
  recommendedItemId: uuid('recommended_item_id'),
  total: numeric('total', { precision: 14, scale: 2 }),
  requestId: uuid('request_id'),
  decidedBy: uuid('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const reviewNote = pgTable('review_note', {
  id: id(),
  tenantId: tenantId(),
  authorId: uuid('author_id').notNull(),
  supplierId: uuid('supplier_id').notNull(),
  tenderId: uuid('tender_id'),
  text: text('text').notNull(),
  visibility: text('visibility', { enum: ['PRIVATE', 'TEAM'] })
    .notNull()
    .default('PRIVATE'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const userDashboard = pgTable('user_dashboard', {
  userId: uuid('user_id').primaryKey(),
  tenantId: tenantId(),
  widgets: jsonb('widgets').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const grcItem = pgTable(
  'grc_item',
  {
    id: id(),
    tenantId: tenantId(),
    kind: text('kind', { enum: ['RISK', 'AUDIT_FINDING', 'OBLIGATION'] }).notNull(),
    title: text('title').notNull(),
    description: text('description'),
    ownerId: uuid('owner_id'),
    likelihood: integer('likelihood'),
    impact: integer('impact'),
    rating: integer('rating'),
    status: text('status', { enum: ['OPEN', 'IN_PROGRESS', 'MITIGATED', 'ACCEPTED', 'CLOSED'] })
      .notNull()
      .default('OPEN'),
    dueOn: date('due_on'),
    reviewOn: date('review_on'),
    source: text('source', { enum: ['MANUAL', 'PLATFORM'] })
      .notNull()
      .default('MANUAL'),
    sourceKey: text('source_key'),
    linkedType: text('linked_type'),
    linkedId: uuid('linked_id'),
    treatment: text('treatment'),
    actions: jsonb('actions').notNull().default([]),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('grc_item_source_uq').on(t.tenantId, t.sourceKey).where(sql`source_key IS NOT NULL`)],
);

export const artefactState = pgTable(
  'artefact_state',
  {
    id: id(),
    tenantId: tenantId(),
    kind: text('kind', { enum: ['EVAL_REPORT', 'CONTRACT_PLANS'] }).notNull(),
    subjectId: uuid('subject_id').notNull(),
    stale: boolean('stale').notNull().default(true),
    reason: text('reason'),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull(),
    refreshedAt: timestamp('refreshed_at', { withTimezone: true }),
    refreshCount: integer('refresh_count').notNull().default(0),
  },
  (t) => [uniqueIndex('artefact_state_uq').on(t.kind, t.subjectId)],
);

export const externalSearchLog = pgTable('external_search_log', {
  id: id(),
  tenantId: tenantId(),
  userId: uuid('user_id').notNull(),
  querySent: text('query_sent').notNull(),
  provider: text('provider').notNull(),
  withheld: jsonb('withheld').notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});
"""
open(p, 'w', encoding='utf8', newline='').write(s)
print('ok')
