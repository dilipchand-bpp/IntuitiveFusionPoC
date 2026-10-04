p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src\db\schema.ts'
s = open(p, encoding='utf8').read()


def sub(a, b):
    global s
    assert a in s, a[:60]
    s = s.replace(a, b, 1)


sub("  askedBySupplierId: uuid('asked_by_supplier_id'),\n  askedAt:",
    "  askedBySupplierId: uuid('asked_by_supplier_id'),\n"
    "  /** ALL: the answer is published to every supplier. SINGLE: only to the supplier who asked (FR-0195). */\n"
    "  audience: text('audience', { enum: ['ALL', 'SINGLE'] }).notNull().default('ALL'),\n"
    "  targetSupplierId: uuid('target_supplier_id'),\n  askedAt:")
sub("  publishPermissionId: uuid('publish_permission_id'),\n  createdAt: created(),\n  updatedAt: updated(),\n  version: version(),\n});\n\nexport const invitation",
    "  publishPermissionId: uuid('publish_permission_id'),\n"
    "  /** Stage 1 is the first round; a later stage is a separate pack and round for shortlisted suppliers (FR-0220). */\n"
    "  stage: integer('stage').notNull().default(1),\n"
    "  parentTenderId: uuid('parent_tender_id'),\n"
    "  shortlist: jsonb('shortlist'),\n"
    "  shortlistedAt: timestamp('shortlisted_at', { withTimezone: true }),\n"
    "  createdAt: created(),\n  updatedAt: updated(),\n  version: version(),\n});\n\nexport const invitation")
sub("  categories: jsonb('categories').notNull().default([]),\n  createdAt: created(),\n});",
    "  categories: jsonb('categories').notNull().default([]),\n"
    "  onboarding: jsonb('onboarding').notNull().default({}),\n"
    "  privacy: jsonb('privacy').notNull().default({ shareProfile: true, productUpdates: false }),\n"
    "  insurance: jsonb('insurance'),\n"
    "  insuranceExpiresOn: date('insurance_expires_on'),\n"
    "  sanctionsNote: text('sanctions_note'),\n"
    "  createdAt: created(),\n});")
sub("  section: text('section', { enum: ['TECHNICAL', 'COMMERCIAL', 'OTHER'] })\n    .notNull()\n    .default('OTHER'),\n  createdAt: created(),\n});",
    "  section: text('section', { enum: ['TECHNICAL', 'COMMERCIAL', 'OTHER'] })\n    .notNull()\n    .default('OTHER'),\n"
    "  /** Set when this file was carried forward from an earlier stage (FR-0230). */\n"
    "  carriedFrom: uuid('carried_from'),\n  createdAt: created(),\n});")
s += """
export const outboundEmail = pgTable('outbound_email', {
  id: id(),
  tenantId: tenantId(),
  toEmail: text('to_email').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  kind: text('kind').notNull(),
  refType: text('ref_type'),
  refId: uuid('ref_id'),
  status: text('status').notNull().default('SIMULATED'),
  createdAt: created(),
});

export const latePermission = pgTable('late_permission', {
  id: id(),
  tenantId: tenantId(),
  tenderId: uuid('tender_id').notNull(),
  supplierId: uuid('supplier_id').notNull(),
  reason: text('reason').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  grantedBy: uuid('granted_by').notNull(),
  createdAt: created(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export const publicNotice = pgTable(
  'public_notice',
  {
    id: id(),
    tenantId: tenantId(),
    tenderId: uuid('tender_id').notNull(),
    register: text('register').notNull(),
    reference: text('reference').notNull(),
    status: text('status').notNull().default('SIMULATED'),
    createdAt: created(),
  },
  (t) => [uniqueIndex('public_notice_once').on(t.tenderId, t.register)],
);

export const tenderDeviation = pgTable('tender_deviation', {
  id: id(),
  tenantId: tenantId(),
  tenderId: uuid('tender_id').notNull(),
  supplierId: uuid('supplier_id').notNull(),
  clauseRef: text('clause_ref').notNull(),
  proposal: text('proposal').notNull(),
  reason: text('reason'),
  risk: text('risk', { enum: ['LOW', 'MEDIUM', 'HIGH'] }),
  legalComment: text('legal_comment'),
  status: text('status', { enum: ['PROPOSED', 'ACCEPTABLE', 'NEGOTIATE', 'REJECTED'] })
    .notNull()
    .default('PROPOSED'),
  decidedBy: uuid('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  createdAt: created(),
});
"""
open(p, 'w', encoding='utf8').write(s)
print('ok')
