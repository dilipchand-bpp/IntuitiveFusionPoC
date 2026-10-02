import re
root = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src'

def rd(rel):
    return open(root + '\\' + rel, encoding='utf8', newline='').read()

def wr(rel, t):
    open(root + '\\' + rel, 'w', encoding='utf8', newline='').write(t)

# ---- routes: static imports instead of dynamic
t = rd(r'modules\plan\routes.ts')
t = t.replace("import { appUser, approval, coiDeclaration, plan, request, roleAssignment } from '../../db/schema.js';",
              "import { appUser, approval, coiDeclaration, fieldValue, notification, plan, request, roleAssignment } from '../../db/schema.js';")
t = t.replace("(await import('../../db/schema.js')).notification", 'notification').replace("(await import('../../db/schema.js')).fieldValue", 'fieldValue')
wr(r'modules\plan\routes.ts', t)

# ---- service: tidy
t = rd(r'modules\plan\service.ts')
t = t.replace("import { PLAN_FIELDS, PLAN_FIELD_BY_KEY, joinParagraphs, splitParagraphs } from './fields.js';", "import { PLAN_FIELDS, PLAN_FIELD_BY_KEY, splitParagraphs } from './fields.js';")
t = t.replace("      topRisk: firstRisk, approverNote: perms.reason ? undefined : undefined,\n", "      topRisk: firstRisk,\n")
wr(r'modules\plan\service.ts', t)

# ---- app wiring
t = rd('app.ts')
t = t.replace("import { registerIntakeRoutes } from './modules/intake/routes.js';", "import { registerIntakeRoutes } from './modules/intake/routes.js';\nimport { registerPlanRoutes } from './modules/plan/routes.js';")
anchor = "  for (const k of registerIntakeRoutes(app, API_PREFIX, { ...guardDeps, ai, erp })) implemented.add(k);"
assert anchor in t
t = t.replace(anchor, anchor + "\n  for (const k of registerPlanRoutes(app, API_PREFIX, { ...guardDeps, ai })) implemented.add(k);")
wr('app.ts', t)

# ---- generator: a list row can exist before a plan row does
p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\_work\gen_openapi.py'
g = open(p, encoding='utf8', newline='').read()
g = g.replace('["planId", "requestId", "requestNumber", "title", "status"]', '["requestId", "requestNumber", "title", "status"]')
open(p, 'w', encoding='utf8', newline='').write(g)
print('ok')
