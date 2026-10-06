API = 'apps/api/src/'


def edit(p, pairs, imp=None):
    s = open(API + p, encoding='utf8', newline='').read().replace('\r\n', '\n')
    for a, b in pairs:
        assert a in s, (p, a[:80])
        s = s.replace(a, b, 1)
    if imp:
        i = s.index('import ')
        s = s[:i] + imp + '\n' + s[i:]
    open(API + p, 'w', encoding='utf8', newline='').write(s)


edit('modules/b9/artefacts.ts', [
    ("export interface ArtefactDeps {\n  audit: AuditService;\n  registry?: VendorRegistry;\n}", "export interface ArtefactDeps {\n  audit: AuditService;\n  clock: Clock;\n  registry?: VendorRegistry;\n}"),
    ("const svc = new EvaluationService({ now: () => now } as never, deps.audit);", "const svc = new EvaluationService(deps.clock, deps.audit);"),
    ("const deps: ArtefactDeps = { audit: d.audit };", "const deps: ArtefactDeps = { audit: d.audit, clock: d.clock };"),
    ("import { MockVendorRegistry", "import type { Clock } from '@if/shared';\nimport { MockVendorRegistry"),
])

# the evaluation report: what used to be rewritten at once now follows the organisation's setting
edit('modules/evaluation/b3-routes.ts', [(
    """      const now = d.clock.now();
      await storeReport(tx, a.user.tenantId, id, await composeReport(tx, svc, l, now), 'DRAFT', now);
    });""",
    """      const now = d.clock.now();
      await noteChange(tx, { audit: d.audit, clock: d.clock }, a.user.tenantId, 'EVAL_REPORT', id, reason, now);
    });""")], "import { noteChange } from '../b9/artefacts.js';")
edit('modules/evaluation/b3-routes.ts', [
    ("  async function recompile(a: AuthContext, id: string) {", "  async function recompile(a: AuthContext, id: string, reason = 'An offer or a waiver was accepted after the lock') {"),
])

# a variation signed on a contract changes what its management plans should say
edit('modules/contract/routes.ts', [(
    "          if (parent) await rescheduleAlerts(tx, parent, now.toISOString().slice(0, 10));\n        }",
    "          if (parent) await rescheduleAlerts(tx, parent, now.toISOString().slice(0, 10));\n          if (parent) await noteChange(tx, { audit: d.audit, clock: d.clock }, a.user.tenantId, 'CONTRACT_PLANS', parent.id, `Variation ${c.number} was signed`, now);\n        }")],
     "import { noteChange } from '../b9/artefacts.js';")

# a hold placed or lifted on a contract does too
edit('modules/contract/compliance.ts', [(
    "    released = 1;\n  }\n",
    "    released = 1;\n  }\n  if (placed || released)\n    await noteChange(tx, { audit, clock: { now: () => now } }, c.tenantId, 'CONTRACT_PLANS', c.id, placed ? 'A purchase order hold was placed' : 'A purchase order hold was lifted', now);\n")],
     "import { noteChange } from '../b9/artefacts.js';")

edit('app.ts', [
    ("import { registerBuying }", "import { registerArtefacts, runDue as runArtefactsDue } from './modules/b9/artefacts.js';\nimport { registerBuying }"),
    ("  for (const k of registerBuying(app, API_PREFIX, guardDeps)) implemented.add(k);", "  for (const k of registerBuying(app, API_PREFIX, guardDeps)) implemented.add(k);\n  for (const k of registerArtefacts(app, API_PREFIX, guardDeps)) implemented.add(k);\n  if (deps.alertSchedulerMinutes) {\n    // batched artefacts are brought up to date on the same schedule as the alerts\n    const h = setInterval(() => void runArtefactsDue(deps.database, { audit, clock: deps.clock }, deps.clock.now()).catch(() => undefined), deps.alertSchedulerMinutes * 60_000);\n    h.unref();\n    app.addHook('onClose', async () => clearInterval(h));\n  }"),
])
print('ok')
