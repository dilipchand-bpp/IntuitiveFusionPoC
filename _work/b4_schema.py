p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src\db\schema.ts'
s = open(p, encoding='utf8').read()


def rep(a, b):
    global s
    assert s.count(a) == 1, a[:70]
    s = s.replace(a, b)


rep("""  sourceSystem: text('source_system'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }), // logical delete only (NFR-CA02)""", """  sourceSystem: text('source_system'),
  /** The contract itself, or another document that is signed the same way (FR-0430). */
  docType: text('doc_type', { enum: ['CONTRACT', 'NDA', 'CONFIDENTIALITY', 'MASTER'] })
    .notNull()
    .default('CONTRACT'),
  /** STANDARD, BLIND (signatories see no one else's signature) or STAGED (signed in sequence) (FR-0425). */
  signingMode: text('signing_mode', { enum: ['STANDARD', 'BLIND', 'STAGED'] })
    .notNull()
    .default('STANDARD'),
  title: text('title'),
  releasedAt: timestamp('released_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }), // logical delete only (NFR-CA02)""")
rep("""  changedFromTemplate: boolean('changed_from_template').notNull().default(false),
  risk: text('risk', { enum: ['LOW', 'MEDIUM', 'HIGH'] }),
});""", """  changedFromTemplate: boolean('changed_from_template').notNull().default(false),
  risk: text('risk', { enum: ['LOW', 'MEDIUM', 'HIGH'] }),
  editedBy: uuid('edited_by'),
  editedAt: timestamp('edited_at', { withTimezone: true }),
});""")
rep("""  sanctionsNote: text('sanctions_note'),
  createdAt: created(),
});""", """  sanctionsNote: text('sanctions_note'),
  /** Bank details the supplier gave, checked before signature options unlock (FR-0415). */
  bank: jsonb('bank'),
  createdAt: created(),
});""")

s += """
// ---------------------------------------------------------------- B4: contract award and legal
export const contractCheck = pgTable(
  'contract_check',
  {
    id: id(),
    tenantId: tenantId(),
    contractId: uuid('contract_id').notNull(),
    kind: text('kind', { enum: ['TENDER_CONSISTENCY', 'VENDOR_PREFLIGHT', 'RECHECK'] }).notNull(),
    checkKey: text('check_key').notNull(),
    result: text('result', { enum: ['PASS', 'WARN', 'FAIL', 'REVIEWED'] }).notNull(),
    detail: text('detail').notNull(),
    reviewedBy: uuid('reviewed_by'),
    reviewNote: text('review_note'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: created(),
  },
  (t) => [uniqueIndex('contract_check_uq').on(t.contractId, t.kind, t.checkKey)],
);

export const contractEndorsement = pgTable(
  'contract_endorsement',
  {
    id: id(),
    tenantId: tenantId(),
    contractId: uuid('contract_id').notNull(),
    role: text('role').notNull(),
    userId: uuid('user_id').notNull(),
    comment: text('comment'),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex('contract_endorsement_uq').on(t.contractId, t.role)],
);

export const signingInvitation = pgTable('signing_invitation', {
  id: id(),
  tenantId: tenantId(),
  contractId: uuid('contract_id').notNull(),
  userId: uuid('user_id'),
  supplierId: uuid('supplier_id'),
  email: text('email').notNull(),
  name: text('name').notNull(),
  roleLabel: text('role_label').notNull(),
  invitedAt: timestamp('invited_at', { withTimezone: true }).notNull(),
  remindedAt: timestamp('reminded_at', { withTimezone: true }),
  reminderCount: integer('reminder_count').notNull().default(0),
  viewedAt: timestamp('viewed_at', { withTimezone: true }),
});

export const contractQuestion = pgTable('contract_question', {
  id: id(),
  tenantId: tenantId(),
  contractId: uuid('contract_id').notNull(),
  askedBy: uuid('asked_by').notNull(),
  side: text('side', { enum: ['INTERNAL', 'SUPPLIER'] }).notNull(),
  clauseId: text('clause_id'),
  question: text('question').notNull(),
  answer: text('answer'),
  answeredBy: uuid('answered_by'),
  answeredAt: timestamp('answered_at', { withTimezone: true }),
  createdAt: created(),
});

export const contractComment = pgTable('contract_comment', {
  id: id(),
  tenantId: tenantId(),
  contractId: uuid('contract_id').notNull(),
  clauseId: text('clause_id'),
  userId: uuid('user_id').notNull(),
  body: text('body').notNull(),
  createdAt: created(),
});

export const contractFile = pgTable('contract_file', {
  id: id(),
  tenantId: tenantId(),
  contractId: uuid('contract_id').notNull(),
  kind: text('kind', { enum: ['AMENDED_DRAFT'] }).notNull(),
  name: text('name').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  contentType: text('content_type').notNull(),
  storageKey: text('storage_key').notNull(),
  sha256: text('sha256').notNull(),
  version: integer('version').notNull(),
  note: text('note'),
  uploadedBy: uuid('uploaded_by').notNull(),
  createdAt: created(),
});

export const legalKnowledge = pgTable('legal_knowledge', {
  id: id(),
  tenantId: tenantId(),
  kind: text('kind', { enum: ['POLICY', 'ADVICE', 'FALLBACK', 'BOILERPLATE'] }).notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  clauseId: text('clause_id'),
  tags: text('tags').notNull().default(''),
  createdBy: uuid('created_by').notNull(),
  createdAt: created(),
});

export const legalMatter = pgTable('legal_matter', {
  id: id(),
  tenantId: tenantId(),
  title: text('title').notNull(),
  contractId: uuid('contract_id'),
  lane: text('lane', { enum: ['NEW', 'IN_REVIEW', 'WAITING', 'DONE'] })
    .notNull()
    .default('NEW'),
  priority: text('priority', { enum: ['LOW', 'NORMAL', 'HIGH'] })
    .notNull()
    .default('NORMAL'),
  assigneeId: uuid('assignee_id'),
  dueOn: date('due_on'),
  createdBy: uuid('created_by').notNull(),
  createdAt: created(),
  updatedAt: updated(),
});

export const legalTimeEntry = pgTable('legal_time_entry', {
  id: id(),
  tenantId: tenantId(),
  matterId: uuid('matter_id').notNull(),
  userId: uuid('user_id').notNull(),
  hours: numeric('hours', { precision: 5, scale: 2 }).notNull(),
  workDate: date('work_date').notNull(),
  note: text('note'),
  createdAt: created(),
});

export const contractRiskSummary = pgTable(
  'contract_risk_summary',
  {
    id: id(),
    tenantId: tenantId(),
    contractId: uuid('contract_id').notNull(),
    generated: jsonb('generated').notNull(),
    edited: text('edited'),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull(),
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('contract_risk_summary_uq').on(t.contractId)],
);

export const accessGrant = pgTable('access_grant', {
  id: id(),
  tenantId: tenantId(),
  userId: uuid('user_id').notNull(),
  tenderId: uuid('tender_id').notNull(),
  label: text('label', { enum: ['COMMITTEE', 'AUDITOR', 'ADVISOR'] }).notNull(),
  expiresOn: date('expires_on'),
  event: text('event', { enum: ['CONTRACT_SIGNED', 'REPORT_APPROVED'] }),
  eventDays: integer('event_days').notNull().default(0),
  createdBy: uuid('created_by').notNull(),
  createdAt: created(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedReason: text('revoked_reason'),
});
"""
open(p, 'w', encoding='utf8').write(s)

# settings
p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src\modules\settings\settings.ts'
s = open(p, encoding='utf8').read()
rep("""  security: z
    .object({
      requireMfa: z.boolean(),""", """  contractRules: z
    .object({
      /** Bank details must be on record and match the company name before signature options unlock. */
      requireBankDetails: z.boolean(),
      /** Legal must review the risk summary before a contract is released for signing. */
      requireRiskSummaryReview: z.boolean(),
      /** Endorsements needed before release: legal and any other business unit. */
      endorsements: z.array(z.enum(['LEGAL', 'FINANCE'])).max(2),
      /** Clauses that are non-negotiable: a change needs General Counsel or the risk delegate. */
      protectedClauses: z.array(z.string().trim().min(1).max(60)).max(20),
      /** After this many days of negotiation, signature blocks lock until the checks are run again. */
      negotiationLockDays: z.number().int().min(1).max(365),
      /** Hours before an unsigned signing invitation is reminded again. */
      signingReminderHours: z.number().int().min(1).max(720),
    })
    .strict(),
  security: z
    .object({
      requireMfa: z.boolean(),""")
rep("""  security: { requireMfa: false, enforceSso: false, stepUpApprovals: false },""", """  contractRules: {
    requireBankDetails: false,
    requireRiskSummaryReview: false,
    endorsements: [],
    protectedClauses: ['LIABILITY', 'IP'],
    negotiationLockDays: 30,
    signingReminderHours: 48,
  },
  security: { requireMfa: false, enforceSso: false, stepUpApprovals: false },""")
open(p, 'w', encoding='utf8').write(s)
print('ok')
