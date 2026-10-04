p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src\modules\settings\settings.ts'
s = open(p, encoding='utf8').read()


def sub(a, b):
    global s
    assert a in s, a[:70]
    s = s.replace(a, b, 1)


sub("  security: z\n    .object({",
    """  onboardingQuestions: z
    .array(
      z
        .object({
          id: keyName,
          label: z.string().trim().min(3).max(200),
          type: z.enum(['YESNO', 'TEXT']),
          mandatory: z.boolean(),
          /** For a yes/no question: the answer that flags the supplier for review (for example No to a modern slavery policy). */
          flagIf: z.enum(['YES', 'NO']).optional(),
        })
        .strict(),
    )
    .max(15)
    .refine((a) => new Set(a.map((q) => q.id)).size === a.length, 'Question keys must be unique'),
  publicRegisters: z
    .array(
      z
        .object({
          register: z.enum(['AusTender', 'SAM.gov', 'TED']),
          jurisdiction: z.string().trim().min(2).max(60),
          minValueAud: z.number().min(0).max(1e10),
          enabled: z.boolean(),
        })
        .strict(),
    )
    .max(6),
  security: z
    .object({""")
sub("  security: { requireMfa: false, enforceSso: false, stepUpApprovals: false },",
    """  // none by default, so registration asks nothing extra until an organisation adds its own questions (FR-0215)
  onboardingQuestions: [],
  // public-sector tenders at or above the value go to the register for their jurisdiction (FR-0140)
  publicRegisters: [
    { register: 'AusTender', jurisdiction: 'Australia (Commonwealth)', minValueAud: 80_000, enabled: true },
    { register: 'SAM.gov', jurisdiction: 'United States (federal)', minValueAud: 250_000, enabled: false },
    { register: 'TED', jurisdiction: 'European Union', minValueAud: 215_000, enabled: false },
  ],
  security: { requireMfa: false, enforceSso: false, stepUpApprovals: false },""")
open(p, 'w', encoding='utf8').write(s)
print('ok')
