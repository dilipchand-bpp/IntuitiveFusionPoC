p = 'apps/api/src/modules/settings/settings.ts'
s = open(p, encoding='utf8').read()


def rep(old, new):
    global s
    assert old in s, old[:60]
    s = s.replace(old, new, 1)


rep("""  security: z
    .object({
      requireMfa: z.boolean(),""", """  contractManagement: z
    .object({
      /** Where the customer's ERP is integrated, a requisition above the contract limit is blocked (FR-0495). */
      erpIntegrated: z.boolean(),
      /** How a variation is measured: against the whole contract so far, or on its own (FR-0540). */
      variationModel: z.enum(['CUMULATIVE', 'INCREMENTAL']),
      /** A variation keeps the contract number with a suffix, or also gets a new procurement number (FR-0565). */
      variationNumbering: z.enum(['SUFFIX', 'NEW_PROCUREMENT']),
      /** Public-sector customers disclose a contract change over the threshold on a register (FR-0545). */
      publicSectorDisclosure: z.boolean(),
      disclosureThresholdPct: z.number().min(0).max(1000),
      disclosureDays: z.number().int().min(1).max(365),
      /** Contracts at or above this value, or judged high risk, get management and risk plans (FR-0555). */
      highValueAud: z.number().min(0).max(1e10),
      /** Alert when this share of the contract value has been spent, besides the fixed 80, 90 and 100 (FR-0580). */
      spendAlertPct: z.number().int().min(1).max(100),
      /** Plan templates the customer uploaded; the standard ones are used where there is none (FR-0555). */
      planTemplates: z
        .array(
          z
            .object({
              kind: z.enum(['CMP', 'RMP']),
              name: z.string().trim().min(2).max(120),
              sections: z
                .array(
                  z
                    .object({
                      title: z.string().trim().min(1).max(120),
                      text: z.string().trim().min(1).max(4000),
                    })
                    .strict(),
                )
                .min(1)
                .max(30),
            })
            .strict(),
        )
        .max(2)
        .refine((a) => new Set(a.map((t) => t.kind)).size === a.length, 'One template of each kind'),
    })
    .strict(),
  security: z
    .object({
      requireMfa: z.boolean(),""")
rep("""  security: { requireMfa: false, enforceSso: false, stepUpApprovals: false },
  erpFieldMap: [],""", """  contractManagement: {
    erpIntegrated: true,
    variationModel: 'CUMULATIVE',
    variationNumbering: 'SUFFIX',
    publicSectorDisclosure: false,
    disclosureThresholdPct: 10,
    disclosureDays: 42,
    highValueAud: 1_000_000,
    spendAlertPct: 70,
    planTemplates: [],
  },
  security: { requireMfa: false, enforceSso: false, stepUpApprovals: false },
  erpFieldMap: [],""")
open(p, 'w', encoding='utf8').write(s)
print('ok')
