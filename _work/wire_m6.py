root = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src'

def edit(rel, pairs):
    p = root + '\\' + rel
    t = open(p, encoding='utf8', newline='').read()
    for old, new in pairs:
        assert old in t, (rel, old[:70])
        t = t.replace(old, new, 1)
    open(p, 'w', encoding='utf8', newline='').write(t)

# ERP port takes the tenant id
edit(r'adapters\erp.ts', [
    ("check(input: { businessUnit: string; amount: number }): Promise<BudgetCheckResult>;", "check(input: { tenantId: string; businessUnit: string; amount: number }): Promise<BudgetCheckResult>;"),
    ("constructor(private readonly config: () => Promise<TenantBudgetConfig>) {}", "constructor(private readonly config: (tenantId: string) => Promise<TenantBudgetConfig>) {}"),
    ("async check({ businessUnit, amount }: { businessUnit: string; amount: number }): Promise<BudgetCheckResult> {\n    const cfg = await this.config();",
     "async check({ tenantId, businessUnit, amount }: { tenantId: string; businessUnit: string; amount: number }): Promise<BudgetCheckResult> {\n    const cfg = await this.config(tenantId);"),
])
edit(r'modules\intake\routes.ts', [
    ("await d.erp.check({ businessUnit: values.businessUnit!, amount })", "await d.erp.check({ tenantId: a.user.tenantId, businessUnit: values.businessUnit!, amount })"),
    ("const STAFF = ['REQUESTER', 'PROCUREMENT', 'DELEGATE', 'EVALUATOR', 'CHAIR', 'LEGAL', 'CONTRACT_MGR', 'PROBITY', 'FINANCE', 'ADMIN', 'EXEC'] as const;\n", ""),
    ("export const _staff = STAFF;\n", ""),
])

# app wiring
edit('app.ts', [
    ("import type { Database } from './db/client.js';", "import { MockAiProvider, type AiProvider } from './adapters/ai-provider.js';\nimport { MockErpBudgetService, type ErpBudgetService } from './adapters/erp.js';\nimport type { Database } from './db/client.js';\nimport { eq } from 'drizzle-orm';\nimport { tenant } from './db/schema.js';\nimport { registerIdempotency } from './http/idempotency.js';\nimport { registerIntakeRoutes } from './modules/intake/routes.js';"),
    ("  idp?: IdentityProvider;\n}", "  idp?: IdentityProvider;\n  ai?: AiProvider;\n  erp?: ErpBudgetService;\n}"),
    ("  installAuth(app, guardDeps);\n", "  installAuth(app, guardDeps);\n  // Retry-safe mutations: only for signed-in callers presenting a valid CSRF token (NFR-AV03).\n  registerIdempotency(app, {\n    database: deps.database,\n    identify: (req) =>\n      req.auth && sessions.verifyCsrf(req.auth.sessionId, req.headers['x-csrf-token'] as string | undefined)\n        ? { tenantId: req.auth.user.tenantId, userId: req.auth.user.id }\n        : null,\n  });\n"),
    ("  for (const k of registerShellRoutes(app, API_PREFIX, guardDeps)) implemented.add(k);",
     "  for (const k of registerShellRoutes(app, API_PREFIX, guardDeps)) implemented.add(k);\n  const ai = deps.ai ?? new MockAiProvider();\n  const erp =\n    deps.erp ??\n    new MockErpBudgetService(async (tenantId) => {\n      const [t] = await deps.database.db.select({ config: tenant.config }).from(tenant).where(eq(tenant.id, tenantId));\n      return (t?.config ?? {}) as { budgets?: Record<string, number>; erpOutage?: boolean };\n    });\n  for (const k of registerIntakeRoutes(app, API_PREFIX, { ...guardDeps, ai, erp })) implemented.add(k);"),
])

# seed: budgets + cap
edit(r'db\seed.ts', [
    ("config: { varianceLimitPct: 30, selfServiceThresholdAud: 50000, statutoryMinDays: 25, highValueAud: 1_000_000 },",
     "config: {\n        varianceLimitPct: 30,\n        selfServiceThresholdAud: 50000,\n        statutoryMinDays: 25,\n        highValueAud: 1_000_000,\n        // Mock ERP: available budget per business unit, and whether an over-budget request is blocked or escalated.\n        budgetCap: 'HARD',\n        budgets: { Facilities: 2_000_000, IT: 6_000_000, Procurement: 500_000, Finance: 300_000, Legal: 400_000, Risk: 250_000, Executive: 1_000_000, Operations: 3_000_000 },\n      },"),
])
print('wired')
