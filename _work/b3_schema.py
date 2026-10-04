p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src\db\schema.ts'
s = open(p, encoding='utf8').read()


def rep(a, b):
    global s
    assert s.count(a) == 1, a
    s = s.replace(a, b)


rep("""    supplierId: uuid('supplier_id'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [uniqueIndex('app_user_email_uq')""", """    supplierId: uuid('supplier_id'),
    /** An external person (for example a probity advisor) who sees only what they are allocated (FR-0310). */
    external: boolean('external').notNull().default(false),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [uniqueIndex('app_user_email_uq')""")

rep("""  scope: text('scope', { enum: ['PLAN', 'EVALUATION'] }).notNull(),""",
    """  scope: text('scope', { enum: ['PLAN', 'EVALUATION', 'REPORT'] }).notNull(),""")
rep("""  routedTo: uuid('routed_to'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  createdAt: created(),
});

export const tender = """, """  routedTo: uuid('routed_to'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  /** A minor conflict lets the person stay but not assess this supplier (FR-0330). */
  excludedSupplierId: uuid('excluded_supplier_id'),
  decidedBy: uuid('decided_by'),
  decidedByRole: text('decided_by_role'),
  decisionNote: text('decision_note'),
  createdAt: created(),
});

export const tender = """)

rep("""  varianceLimitPct: integer('variance_limit_pct').notNull().default(30),
  createdAt: created(),
  updatedAt: updated(),
  version: version(),
});

export const criterion""", """  varianceLimitPct: integer('variance_limit_pct').notNull().default(30),
  /** SCORING: numeric scores per criterion. RANKING: evaluators order the suppliers (FR-0280). */
  mode: text('mode', { enum: ['SCORING', 'RANKING'] })
    .notNull()
    .default('SCORING'),
  /** In ranking mode, the share of the final ranking that comes from normalised total cost of ownership. */
  priceWeightPct: integer('price_weight_pct').notNull().default(30),
  /** A probity advisor's system hold freezes the evaluation workspace (FR-0310). */
  held: boolean('held').notNull().default(false),
  holdReason: text('hold_reason'),
  heldBy: uuid('held_by'),
  heldAt: timestamp('held_at', { withTimezone: true }),
  createdAt: created(),
  updatedAt: updated(),
  version: version(),
});

export const criterion""")

rep("""    scoredAt: timestamp('scored_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('panel_member_uq')""", """    scoredAt: timestamp('scored_at', { withTimezone: true }),
    /** The second declaration, once supplier identities are known (FR-0325). */
    redeclaredAt: timestamp('redeclared_at', { withTimezone: true }),
    redeclaration: text('redeclaration', { enum: ['NONE', 'CONFLICT'] }),
    remindedAt: timestamp('reminded_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('panel_member_uq')""")

rep("""    .default('DRAFT'),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
});""", """    .default('DRAFT'),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  /** The delegate whose authority covers the value, to whom approval is routed (FR-0375). */
  routedTo: uuid('routed_to'),
  requiredAuthority: numeric('required_authority', { precision: 14, scale: 2 }),
});""")

s += """
// ---------------------------------------------------------------- B3: evaluation and report
export const complianceCheck = pgTable(
  'compliance_check',
  {
    id: id(),
    tenantId: tenantId(),
    evaluationId: uuid('evaluation_id').notNull(),
    supplierId: uuid('supplier_id').notNull(),
    checkKey: text('check_key').notNull(),
    result: text('result', { enum: ['PASS', 'FAIL', 'WAIVED'] }).notNull(),
    detail: text('detail').notNull(),
    decidedBy: uuid('decided_by'),
    decidedNote: text('decided_note'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: created(),
  },
  (t) => [uniqueIndex('compliance_check_uq').on(t.evaluationId, t.supplierId, t.checkKey)],
);

export const clarification = pgTable('clarification', {
  id: id(),
  tenantId: tenantId(),
  evaluationId: uuid('evaluation_id').notNull(),
  supplierId: uuid('supplier_id').notNull(),
  kind: text('kind', { enum: ['COMPLIANCE', 'CLARIFICATION', 'NEGOTIATION'] }).notNull(),
  subject: text('subject').notNull(),
  question: text('question').notNull(),
  checkKey: text('check_key'),
  dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
  status: text('status', { enum: ['OPEN', 'ANSWERED', 'CLOSED'] })
    .notNull()
    .default('OPEN'),
  response: text('response'),
  respondedBy: uuid('responded_by'),
  respondedAt: timestamp('responded_at', { withTimezone: true }),
  createdBy: uuid('created_by'),
  createdAt: created(),
});

export const bidPricing = pgTable(
  'bid_pricing',
  {
    id: id(),
    tenantId: tenantId(),
    submissionId: uuid('submission_id').notNull(),
    basePrice: numeric('base_price', { precision: 14, scale: 2 }).notNull(),
    implementation: numeric('implementation', { precision: 14, scale: 2 }).notNull().default('0'),
    annualRunning: numeric('annual_running', { precision: 14, scale: 2 }).notNull().default('0'),
    years: integer('years').notNull().default(1),
    tco: numeric('tco', { precision: 14, scale: 2 }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('bid_pricing_uq').on(t.submissionId)],
);

export const bafoRound = pgTable(
  'bafo_round',
  {
    id: id(),
    tenantId: tenantId(),
    evaluationId: uuid('evaluation_id').notNull(),
    round: integer('round').notNull(),
    status: text('status', { enum: ['OPEN', 'CLOSED'] })
      .notNull()
      .default('OPEN'),
    note: text('note').notNull(),
    closesAt: timestamp('closes_at', { withTimezone: true }).notNull(),
    invited: jsonb('invited').notNull().default([]),
    createdBy: uuid('created_by'),
    createdAt: created(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('bafo_round_uq').on(t.evaluationId, t.round)],
);

export const bafoOffer = pgTable(
  'bafo_offer',
  {
    id: id(),
    tenantId: tenantId(),
    roundId: uuid('round_id').notNull(),
    supplierId: uuid('supplier_id').notNull(),
    revision: integer('revision').notNull(),
    basePrice: numeric('base_price', { precision: 14, scale: 2 }).notNull(),
    implementation: numeric('implementation', { precision: 14, scale: 2 }).notNull().default('0'),
    annualRunning: numeric('annual_running', { precision: 14, scale: 2 }).notNull().default('0'),
    years: integer('years').notNull().default(1),
    tco: numeric('tco', { precision: 14, scale: 2 }).notNull(),
    note: text('note'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull(),
    accepted: boolean('accepted').notNull().default(false),
    acceptedBy: uuid('accepted_by'),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('bafo_offer_uq').on(t.roundId, t.supplierId, t.revision)],
);

export const panelSubstitution = pgTable('panel_substitution', {
  id: id(),
  tenantId: tenantId(),
  evaluationId: uuid('evaluation_id').notNull(),
  departingUserId: uuid('departing_user_id').notNull(),
  incomingUserId: uuid('incoming_user_id').notNull(),
  stream: text('stream').notNull(),
  reason: text('reason', { enum: ['CONFLICT', 'OTHER'] }).notNull(),
  note: text('note'),
  byUserId: uuid('by_user_id').notNull(),
  createdAt: created(),
});

export const probityAllocation = pgTable(
  'probity_allocation',
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid('user_id').notNull(),
    tenderId: uuid('tender_id').notNull(),
    createdBy: uuid('created_by'),
    createdAt: created(),
  },
  (t) => [uniqueIndex('probity_allocation_uq').on(t.userId, t.tenderId)],
);

export const probityDocument = pgTable(
  'probity_document',
  {
    id: id(),
    tenantId: tenantId(),
    evaluationId: uuid('evaluation_id').notNull(),
    kind: text('kind', { enum: ['PLAN', 'OUTCOMES'] }).notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    fileName: text('file_name'),
    fileKey: text('file_key'),
    fileSha256: text('file_sha256'),
    contentType: text('content_type'),
    status: text('status', { enum: ['DRAFT', 'SIGNED'] })
      .notNull()
      .default('DRAFT'),
    version: integer('version').notNull().default(1),
    signedBy: uuid('signed_by'),
    signedAt: timestamp('signed_at', { withTimezone: true }),
    stamp: text('stamp'),
    createdBy: uuid('created_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('probity_document_uq').on(t.evaluationId, t.kind)],
);
"""
open(p, 'w', encoding='utf8').write(s)
print('ok')
