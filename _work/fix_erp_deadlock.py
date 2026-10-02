root = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src'

def edit(rel, pairs):
    p = root + '\\' + rel
    t = open(p, encoding='utf8', newline='').read()
    for old, new in pairs:
        assert old in t, (rel, old[:70])
        t = t.replace(old, new, 1)
    open(p, 'w', encoding='utf8', newline='').write(t)

edit(r'adapters\erp.ts', [
    ("check(input: { tenantId: string; businessUnit: string; amount: number }): Promise<BudgetCheckResult>;",
     "check(input: {\n    tenantId: string;\n    businessUnit: string;\n    amount: number;\n    /** Mock-only hint: budgets and outage switch, read by the caller inside its own transaction. A real adapter ignores it. */\n    settings?: TenantBudgetConfig;\n  }): Promise<BudgetCheckResult>;"),
])
t = open(root + r'\adapters\erp.ts', encoding='utf8', newline='').read()
a = t.index('export class MockErpBudgetService')
t = t[:a] + '''/**
 * Deterministic stand-in. It deliberately does NOT query the database itself: it runs inside the caller's
 * transaction, and a second query on the same connection would wait forever for that transaction (single-connection
 * PGlite) - so the caller passes the tenant settings in.
 */
export class MockErpBudgetService implements ErpBudgetService {
  async check({ businessUnit, amount, settings }: { tenantId: string; businessUnit: string; amount: number; settings?: TenantBudgetConfig }): Promise<BudgetCheckResult> {
    const cfg = settings ?? {};
    if (cfg.erpOutage) return { status: 'UNAVAILABLE', available: null };
    const available = cfg.budgets?.[businessUnit];
    if (available === undefined) return { status: 'UNAVAILABLE', available: null }; // unknown unit: cannot clear automatically
    return { status: amount <= available ? 'CLEARED' : 'EXCEEDED', available };
  }
}
'''
open(root + r'\adapters\erp.ts', 'w', encoding='utf8', newline='').write(t)

edit('app.ts', [
    ("""  const erp =
    deps.erp ??
    new MockErpBudgetService(async (tenantId) => {
      const [t] = await deps.database.db.select({ config: tenant.config }).from(tenant).where(eq(tenant.id, tenantId));
      return (t?.config ?? {}) as { budgets?: Record<string, number>; erpOutage?: boolean };
    });""", "  const erp = deps.erp ?? new MockErpBudgetService();"),
    ("import { eq } from 'drizzle-orm';\nimport { tenant } from './db/schema.js';\n", ""),
])
edit(r'modules\intake\routes.ts', [
    ("await d.erp.check({ tenantId: a.user.tenantId, businessUnit: values.businessUnit!, amount })",
     "await d.erp.check({ tenantId: a.user.tenantId, businessUnit: values.businessUnit!, amount, settings: cfg })"),
])
print('ok')
