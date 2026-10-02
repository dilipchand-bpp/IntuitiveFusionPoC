p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src\db\seed.ts'
t = open(p, encoding='utf8', newline='').read()

# 1. imports
t = t.replace("import { AuditService } from '../audit/audit-service.js';",
              "import { AuditService } from '../audit/audit-service.js';\nimport { TENDER_FIELDS } from '../modules/tender/fields.js';\nimport { buildTenderPack } from '../modules/tender/pack.js';", 1)

# 2. tender packs + permission-to-publish approvals, inserted before the invitation loop
marker = "    for (const sp of SUPPLIERS) {\n      await tx.insert(s.invitation).values({"
assert marker in t
block = '''    for (const [tenderId, requestKey, type] of [
      [t1, 'cleaning', 'RFT'],
      [t2, 'itmsp', 'RFP'],
    ] as const) {
      const [rq] = await tx.select().from(s.request).where(eq(s.request.id, uid(`request:${requestKey}`)));
      const pack = buildTenderPack({
        type,
        title: rq!.title,
        organisation: 'Meridian Group (demo)',
        plan: {},
        request: {},
        contactEmail: 'procurement@meridian-demo.example',
        statutoryMinDays: 25,
      });
      for (const def of TENDER_FIELDS)
        await tx.insert(s.fieldValue).values({
          tenantId: TENANT_ID,
          ownerType: 'TENDER',
          ownerId: tenderId,
          key: def.key,
          label: def.label,
          value: pack[def.key] ?? '',
          source: 'SYSTEM',
        });
      const apId = uid(`approval:publish:${requestKey}`);
      await tx.insert(s.approval).values({
        id: apId,
        tenantId: TENANT_ID,
        subjectType: 'TENDER_PUBLISH',
        subjectId: tenderId,
        userId: userId('delegate'),
        role: 'DELEGATE',
        decision: 'APPROVED',
        stamp: 'PERMISSION TO PUBLISH · Dana Okafor · DELEGATE · 2026-09-01 09:00 UTC',
        decidedAt: day(-40),
      });
      await tx.update(s.tender).set({ publishPermissionId: apId }).where(eq(s.tender.id, tenderId));
    }
'''
t = t.replace(marker, block + marker, 1)

# 3. invitations: link to the supplier, and invite the same suppliers to the closed tender
old = '''      await tx.insert(s.invitation).values({
        tenantId: TENANT_ID,
        tenderId: t2,
        email: `bids@${sp.key}.example`,
        company: sp.company,
        tokenHash: createHash('sha256').update(`seed-invite:${sp.key}`).digest('hex'),
        expiresAt: day(30),
      });'''
assert old in t
new = '''      for (const tenderId of [t1, t2]) {
        await tx.insert(s.invitation).values({
          tenantId: TENANT_ID,
          tenderId,
          email: `bids@${sp.key}.example`,
          company: sp.company,
          tokenHash: createHash('sha256').update(`seed-invite:${tenderId}:${sp.key}`).digest('hex'),
          expiresAt: day(30),
          usedAt: day(-6),
          supplierId: uid(`supplier:${sp.key}`),
        });
      }'''
t = t.replace(old, new, 1)
open(p, 'w', encoding='utf8', newline='').write(t)
print('seed patched')
