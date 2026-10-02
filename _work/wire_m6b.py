root = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src'

def edit(rel, pairs):
    p = root + '\\' + rel
    t = open(p, encoding='utf8', newline='').read()
    for old, new in pairs:
        assert old in t, (rel, old[:70])
        t = t.replace(old, new, 1)
    open(p, 'w', encoding='utf8', newline='').write(t)

edit(r'http\errors.ts', [
    ("import type { ZodType } from 'zod';", "import type { ZodTypeAny, z } from 'zod';"),
    ("export function parse<T>(schema: ZodType<T>, input: unknown): T {", "export function parse<S extends ZodTypeAny>(schema: S, input: unknown): z.output<S> {"),
])
edit(r'db\seed.ts', [
    ("        highValueAud: 1_000_000,\n",
     "        highValueAud: 1_000_000,\n        // Mock ERP: available budget per business unit; an over-budget request is blocked (HARD) or escalated (SOFT).\n        budgetCap: 'HARD',\n        budgets: {\n          Facilities: 2_000_000,\n          IT: 6_000_000,\n          Procurement: 500_000,\n          Finance: 300_000,\n          Legal: 400_000,\n          Risk: 250_000,\n          Executive: 1_000_000,\n          Operations: 3_000_000,\n        },\n"),
])
edit(r'modules\intake\routes.ts', [
    ("return { blocked: { available: budget.available, requested: amount } } as const;", "return { kind: 'blocked' as const, available: budget.available, requested: amount };"),
    ("return { view: toView(r.row, r.fields) } as const;", "return { kind: 'ok' as const, view: toView(r.row, r.fields) };"),
    ("if ('blocked' in outcome) {", "if (outcome.kind === 'blocked') {"),
    ("Requested ${outcome.blocked.requested.toLocaleString('en-AU')}, available ${(outcome.blocked.available ?? 0).toLocaleString('en-AU')}", "Requested ${outcome.requested.toLocaleString('en-AU')}, available ${(outcome.available ?? 0).toLocaleString('en-AU')}"),
])
print('ok')
