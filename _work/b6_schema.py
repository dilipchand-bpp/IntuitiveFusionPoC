p = 'apps/api/src/db/schema.ts'
s = open(p, encoding='utf8', newline='').read()


def rep(old, new):
    global s
    assert old in s, old[:60]
    s = s.replace(old, new, 1)


rep("""    linkKind: text('link_kind', { enum: ['RENEW', 'VARY', 'EXTEND'] }),
""", """    linkKind: text('link_kind', { enum: ['RENEW', 'VARY', 'EXTEND'] }),
    /** The procurement manager the work is assigned to, for workload and capacity (FR-0620). */
    managerId: uuid('manager_id'),
""")
rep("""  bank: jsonb('bank'),
  createdAt: created(),
});""", """  bank: jsonb('bank'),
  /** Where the supplier operates from, for the supplier risk map (FR-0610). */
  location: jsonb('location'),
  createdAt: created(),
});""")
rep("""    missing: boolean('missing').notNull().default(false),
    previousValue: text('previous_value'),""", """    missing: boolean('missing').notNull().default(false),
    /** Counts changes to the value, so a concurrent edit of the same field is noticed (FR-0735). */
    rev: integer('rev').notNull().default(1),
    previousValue: text('previous_value'),""")
s += """
// ---------------------------------------------------------------- B6: reporting and collaboration
export const layoutTemplate = pgTable(
  'layout_template',
  {
    id: id(),
    tenantId: tenantId(),
    kind: text('kind', { enum: ['PLAN', 'RFX', 'REPORT'] }).notNull(),
    name: text('name').notNull(),
    sections: jsonb('sections').notNull(),
    updatedBy: uuid('updated_by').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex('layout_template_uq').on(t.tenantId, t.kind)],
);

export const scheduleItem = pgTable(
  'schedule_item',
  {
    id: id(),
    tenantId: tenantId(),
    requestId: uuid('request_id').notNull(),
    phase: text('phase', { enum: ['INTAKE', 'PLAN', 'TENDER', 'EVALUATION', 'CONTRACT_AWARD'] }).notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
  },
  (t) => [uniqueIndex('schedule_item_uq').on(t.requestId, t.phase)],
);

export const savedView = pgTable('saved_view', {
  id: id(),
  tenantId: tenantId(),
  userId: uuid('user_id').notNull(),
  name: text('name').notNull(),
  report: text('report').notNull(),
  filters: jsonb('filters').notNull().default({}),
  shared: boolean('shared').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const riskAssessment = pgTable(
  'risk_assessment',
  {
    id: id(),
    tenantId: tenantId(),
    requestId: uuid('request_id').notNull(),
    basis: text('basis').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull(),
    generatedBy: uuid('generated_by').notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('risk_assessment_uq').on(t.requestId)],
);

export const riskItem = pgTable(
  'risk_item',
  {
    id: id(),
    tenantId: tenantId(),
    assessmentId: uuid('assessment_id').notNull(),
    key: text('key').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    applicable: boolean('applicable'),
    likelihood: integer('likelihood'),
    impact: integer('impact'),
    options: jsonb('options').notNull().default([]),
    mitigation: text('mitigation'),
  },
  (t) => [uniqueIndex('risk_item_uq').on(t.assessmentId, t.key)],
);

export const fieldHistory = pgTable(
  'field_history',
  {
    id: id(),
    tenantId: tenantId(),
    ownerType: text('owner_type').notNull(),
    ownerId: uuid('owner_id').notNull(),
    key: text('key').notNull(),
    value: text('value'),
    changedBy: uuid('changed_by'),
    source: text('source'),
    rev: integer('rev').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull(),
  },
  (t) => [index('field_history_doc_idx').on(t.ownerType, t.ownerId, t.at)],
);

export const documentVersion = pgTable(
  'document_version',
  {
    id: id(),
    tenantId: tenantId(),
    ownerType: text('owner_type').notNull(),
    ownerId: uuid('owner_id').notNull(),
    number: integer('number').notNull(),
    label: text('label').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex('document_version_uq').on(t.ownerType, t.ownerId, t.number)],
);

export const documentView = pgTable(
  'document_view',
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid('user_id').notNull(),
    ownerType: text('owner_type').notNull(),
    ownerId: uuid('owner_id').notNull(),
    viewedAt: timestamp('viewed_at', { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex('document_view_uq').on(t.userId, t.ownerType, t.ownerId)],
);

export const editPresence = pgTable(
  'edit_presence',
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid('user_id').notNull(),
    ownerType: text('owner_type').notNull(),
    ownerId: uuid('owner_id').notNull(),
    fieldKey: text('field_key'),
    at: timestamp('at', { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex('edit_presence_uq').on(t.userId, t.ownerType, t.ownerId)],
);

export const referenceContent = pgTable('reference_content', {
  id: id(),
  tenantId: tenantId(),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  category: text('category').notNull(),
  sector: text('sector').notNull(),
  level: text('level').notNull(),
  body: text('body').notNull(),
  generation: integer('generation').notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull(),
});
"""
open(p, 'w', encoding='utf8', newline='').write(s)

# settings
p = 'apps/api/src/modules/settings/settings.ts'
s = open(p, encoding='utf8', newline='').read()
rep("""  security: z
    .object({
      requireMfa: z.boolean(),""", """  dashboards: z
    .object({
      /** HIERARCHY scopes a dashboard to the person's own unit and the units beneath; BROAD shows the whole organisation. */
      visibility: z.enum(['HIERARCHY', 'BROAD']),
      /** Active procurements one manager can carry before the workload view flags them (FR-0620). */
      capacityPerManager: z.number().int().min(1).max(200),
      /** Days between refreshes of the reference content corpus (FR-0765). */
      referenceRefreshDays: z.number().int().min(1).max(365),
    })
    .strict(),
  security: z
    .object({
      requireMfa: z.boolean(),""")
rep("""  security: { requireMfa: false, enforceSso: false, stepUpApprovals: false },
  erpFieldMap: [],""", """  dashboards: { visibility: 'BROAD', capacityPerManager: 6, referenceRefreshDays: 90 },
  security: { requireMfa: false, enforceSso: false, stepUpApprovals: false },
  erpFieldMap: [],""")
open(p, 'w', encoding='utf8', newline='').write(s)
print('ok')
