p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src\modules\settings\settings.ts'
s = open(p, encoding='utf8').read()


def rep(a, b):
    global s
    assert s.count(a) == 1, a
    s = s.replace(a, b)


rep("""  security: z
    .object({
      requireMfa: z.boolean(),""", """  criteriaLibrary: z
    .array(
      z
        .object({
          name: z.string().trim().min(3).max(120),
          stream: z.enum(['TECHNICAL', 'COMMERCIAL', 'OTHER']),
          weight: z.number().min(0).max(100),
          passFail: z.boolean(),
        })
        .strict(),
    )
    .max(60)
    .refine(
      (a) => new Set(a.map((c) => c.name.toLowerCase())).size === a.length,
      'Each criterion can appear once',
    ),
  evaluationRules: z
    .object({
      /** An unrecorded insurance certificate fails the compliance gate (an expired one always does). */
      requireInsurance: z.boolean(),
      /** Ranking instead of numeric scoring is allowed only up to this estimated value. */
      rankingMaxValueAud: z.number().min(0).max(1e10),
      /** Hours before an outstanding conflict re-declaration is reminded again. */
      redeclarationReminderHours: z.number().int().min(1).max(720),
      /** Days a supplier has to answer a clarification unless the buyer sets another. */
      clarificationDays: z.number().int().min(1).max(60),
    })
    .strict(),
  security: z
    .object({
      requireMfa: z.boolean(),""")

rep("""  security: { requireMfa: false, enforceSso: false, stepUpApprovals: false },""", """  // a starting library of criteria to pick from when setting up an evaluation (FR-0320)
  criteriaLibrary: [
    { name: 'Technical capability and approach', stream: 'TECHNICAL', weight: 40, passFail: false },
    { name: 'Delivery, transition and risk management', stream: 'TECHNICAL', weight: 20, passFail: false },
    { name: 'Quality of proposed solution', stream: 'TECHNICAL', weight: 40, passFail: false },
    { name: 'Delivery approach and team', stream: 'TECHNICAL', weight: 20, passFail: false },
    { name: 'Security and data protection', stream: 'TECHNICAL', weight: 15, passFail: false },
    { name: 'Sustainability and social value', stream: 'OTHER', weight: 10, passFail: false },
    { name: 'Price and commercial terms', stream: 'COMMERCIAL', weight: 30, passFail: false },
    { name: 'Price and value for money', stream: 'COMMERCIAL', weight: 30, passFail: false },
    { name: 'Experience and references', stream: 'OTHER', weight: 10, passFail: false },
    { name: 'Compliance with the specification (pass or fail)', stream: 'TECHNICAL', weight: 0, passFail: true },
    { name: 'Meets mandatory insurance and licensing (pass or fail)', stream: 'OTHER', weight: 0, passFail: true },
  ],
  evaluationRules: {
    requireInsurance: false,
    rankingMaxValueAud: 100_000,
    redeclarationReminderHours: 24,
    clarificationDays: 5,
  },
  security: { requireMfa: false, enforceSso: false, stepUpApprovals: false },""")
open(p, 'w', encoding='utf8').write(s)
print('ok')
