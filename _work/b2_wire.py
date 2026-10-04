root = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src'


def edit(rel, pairs):
    p = f'{root}\\{rel}'
    s = open(p, encoding='utf8').read()
    for a, b in pairs:
        assert a in s, (rel, a[:80])
        s = s.replace(a, b, 1)
    open(p, 'w', encoding='utf8').write(s)


edit('app.ts', [
    ("import { registerSupplierRoutes } from './modules/tender/supplier-routes.js';",
     "import { registerSupplierRoutes } from './modules/tender/supplier-routes.js';\nimport { registerTenderB2 } from './modules/tender/b2-routes.js';"),
    ("  for (const k of registerSupplierDirectory(app, API_PREFIX, {",
     "  for (const k of registerTenderB2(app, API_PREFIX, {\n    ...guardDeps,\n    store,\n    config,\n    publicRateLimitMax: deps.loginRateLimitMax ?? 20,\n  }))\n    implemented.add(k);\n  for (const k of registerSupplierDirectory(app, API_PREFIX, {"),
])

edit('modules/tender/serialisers.ts', [
    ("  ...(f.sha256 ? { sha256: f.sha256 } : {}),\n  uploadedAt: f.createdAt.toISOString(),",
     "  ...(f.sha256 ? { sha256: f.sha256 } : {}),\n  /** True when this file came from the supplier's earlier stage and was not replaced (FR-0230). */\n  ...(f.carriedFrom ? { carriedForward: true } : {}),\n  uploadedAt: f.createdAt.toISOString(),"),
])

edit('modules/tender/supplier-routes.ts', [
    ("import { checkUpload, MAX_FILES_PER_BID, scanBytes, sha256, type SealedStore } from './files.js';",
     "import { carryForward } from './carry-forward.js';\nimport { checkUpload, MAX_FILES_PER_BID, scanBytes, sha256, type SealedStore } from './files.js';"),
    ("        const sub = await ensureSubmission(tx, a.user.tenantId, id, a.user.supplierId!);\n        if (sub.status === 'SUBMITTED')\n          throw new AppError(\n            409,\n            'ALREADY_SUBMITTED',",
     "        const sub = await ensureSubmission(tx, a.user.tenantId, id, a.user.supplierId!);\n        // a later stage keeps what the supplier does not replace from their earlier stage (FR-0230)\n        if (sub.status !== 'SUBMITTED') await carryForward(tx, d.store, l.tender, a.user.supplierId!, sub.id);\n        if (sub.status === 'SUBMITTED')\n          throw new AppError(\n            409,\n            'ALREADY_SUBMITTED',"),
])
print('ok')
