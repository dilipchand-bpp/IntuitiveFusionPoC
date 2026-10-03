def sub(p, a, b):
    t = open(p, encoding='utf8', newline='').read()
    assert a in t, (p, a[:80])
    open(p, 'w', encoding='utf8', newline='').write(t.replace(a, b, 1))


S = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src\db\seed.ts'
sub(S, "import { TENDER_FIELDS } from '../modules/tender/fields.js';",
    "import { demoPricingSchedule, demoTechnicalResponse } from './demo-documents.js';\nimport { TENDER_FIELDS } from '../modules/tender/fields.js';\nimport { sha256, type SealedStore } from '../modules/tender/files.js';")
sub(S, "  opts: { clock: Clock; password?: string },\n): Promise<SeedResult> {",
    "  /** With a store the seeded bid files are really written (sealed) so they can be downloaded; without one only rows exist. */\n  opts: { clock: Clock; password?: string; store?: SealedStore },\n): Promise<SeedResult> {")
old = S
t = open(S, encoding='utf8', newline='').read()
a = t.index("      for (const [section, name] of [\n        ['TECHNICAL', 'technical-response.pdf'],")
b = t.index("      await log(\n        'submission.submit',", a)
new = '''      for (const [section, name] of [
        ['TECHNICAL', 'technical-response.pdf'],
        ['COMMERCIAL', 'pricing-schedule.xlsx'],
      ] as const) {
        const index = SUPPLIERS.findIndex((x) => x.key === sp.key);
        const bytes =
          section === 'TECHNICAL'
            ? demoTechnicalResponse(sp.company, index, 'Facilities cleaning services')
            : demoPricingSchedule(sp.company, index);
        const storageKey = `${TENANT_ID}/${subId}/${uid(`file:${sp.key}:${section}`)}`;
        if (opts.store) await opts.store.put(storageKey, bytes);
        await tx.insert(s.fileObject).values({
          tenantId: TENANT_ID,
          submissionId: subId,
          name,
          sizeBytes: bytes.length,
          contentType:
            section === 'TECHNICAL'
              ? 'application/pdf'
              : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          storageKey,
          sha256: sha256(bytes),
          scan: 'CLEAN',
          section,
        });
      }
'''
t = t[:a] + new + t[b:]
open(S, 'w', encoding='utf8', newline='').write(t)

C = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src\db\cli.ts'
sub(C, "import { systemClock } from '@if/shared';", "import { loadConfig, systemClock } from '@if/shared';")
sub(C, "import { TENANT_ID, seedDatabase } from './seed.js';", "import { SealedStore } from '../modules/tender/files.js';\nimport { TENANT_ID, seedDatabase } from './seed.js';")
sub(C, "      console.log(await seedDatabase(database, { clock: systemClock }));",
    "      {\n        // demo bid files are written sealed to the same storage the API reads from\n        const config = loadConfig(process.env);\n        const store = new SealedStore(config.STORAGE_DIR, config.SESSION_SECRET);\n        console.log(await seedDatabase(database, { clock: systemClock, store }));\n      }")
print('ok')
