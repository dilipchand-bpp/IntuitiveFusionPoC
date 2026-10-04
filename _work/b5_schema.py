p = 'apps/api/src/db/schema.ts'
s = open(p, encoding='utf8').read()


def rep(old, new):
    global s
    assert old in s, old[:60]
    s = s.replace(old, new, 1)


rep("""    sourceSystem: text('source_system'),
    createdAt: created(),
    updatedAt: updated(),
    version: version(),
  },
  (t) => [
    uniqueIndex('request_number_uq')""", """    sourceSystem: text('source_system'),
    /** A procurement linked to an existing contract to renew it, vary it or take up an extension (FR-0570). */
    linkedContractId: uuid('linked_contract_id'),
    linkKind: text('link_kind', { enum: ['RENEW', 'VARY', 'EXTEND'] }),
    createdAt: created(),
    updatedAt: updated(),
    version: version(),
  },
  (t) => [
    uniqueIndex('request_number_uq')""")
rep("""  releasedAt: timestamp('released_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }), // logical delete only (NFR-CA02)""", """  releasedAt: timestamp('released_at', { withTimezone: true }),
  /** A variation's logged business case, its variance and the model it was measured by (FR-0535, FR-0540). */
  businessCase: text('business_case'),
  variancePct: numeric('variance_pct', { precision: 9, scale: 2 }),
  varianceModel: text('variance_model', { enum: ['CUMULATIVE', 'INCREMENTAL'] }),
  linkedRequestId: uuid('linked_request_id'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }), // logical delete only (NFR-CA02)""")
rep("""  kind: text('kind', { enum: ['EXPIRY', 'NOTICE', 'MILESTONE', 'EXTENSION', 'CUSTOM'] }).notNull(),""", """  kind: text('kind', {
    enum: ['EXPIRY', 'NOTICE', 'MILESTONE', 'EXTENSION', 'CUSTOM', 'COUNTDOWN', 'INSURANCE', 'CLAUSE'],
  }).notNull(),""")
rep("""  origin: text('origin', { enum: ['SYSTEM', 'USER'] })
    .notNull()
    .default('SYSTEM'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  note: text('note'),
  createdBy: uuid('created_by'),
});""", """  origin: text('origin', { enum: ['SYSTEM', 'USER', 'AI'] })
    .notNull()
    .default('SYSTEM'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  note: text('note'),
  createdBy: uuid('created_by'),
  /** Where a custom alert is delivered, and who it is assigned to besides its author (FR-0515). */
  channels: jsonb('channels').notNull().default(['IN_APP', 'EMAIL']),
  ownerId: uuid('owner_id'),
});""")
rep("""  months: integer('months').notNull(),
  position: integer('position').notNull().default(1),
});""", """  months: integer('months').notNull(),
  position: integer('position').notNull().default(1),
  exercisedAt: timestamp('exercised_at', { withTimezone: true }),
  exercisedRequestId: uuid('exercised_request_id'),
});""")
rep("""  channel: text('channel', { enum: ['IN_APP', 'EMAIL'] }).notNull(),
  status: text('status', { enum: ['DELIVERED', 'SIMULATED'] }).notNull(),""", """  channel: text('channel', { enum: ['IN_APP', 'EMAIL', 'SMS', 'SLACK'] }).notNull(),
  status: text('status', { enum: ['DELIVERED', 'SIMULATED'] }).notNull(),""")

s += open('_work/b5_schema_tables.ts.txt', encoding='utf8').read()
open(p, 'w', encoding='utf8').write(s)
print('ok')
