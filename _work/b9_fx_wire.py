import re

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


# the rule: a foreign-currency request is approved against the approver's international grants
edit('modules/b9/fx-rules.ts', [(
    "/** Where a request is local or international spend, which decides whose delegation applies. */",
    "/** True when an amount was entered in a currency other than the base (AUD), which decides whose delegation applies. */\nexport const isForeign = (currency: string | null | undefined) => (currency ?? 'AUD') !== 'AUD';\n\n/** Where a request is local or international spend, which decides whose delegation applies. */")])

edit('authz/delegation.ts', [
    ("  division?: string | null,\n): Promise<DelegationCheck> {", "  division?: string | null,\n  /** Spend in a foreign currency is covered only by grants made for international spend, and the reverse (FR-0810). */\n  international = false,\n): Promise<DelegationCheck> {"),
    ("      (!d.division || d.division === division),\n  );", "      (!d.division || d.division === division) &&\n      d.international === international,\n  );"),
])

SIMPLE = "        'SOURCING_APPROVAL',\n        value,\n      );"
edit('modules/b8/approval-links.ts', [(SIMPLE, "        'SOURCING_APPROVAL',\n        value,\n        null,\n        isForeign(reqRow?.currency),\n      );")],
     "import { isForeign } from '../b9/fx-rules.js';")
edit('modules/evaluation/routes.ts', [("            'SOURCING_APPROVAL',\n            value,\n          );", "            'SOURCING_APPROVAL',\n            value,\n            null,\n            isForeign(l.req.currency),\n          );")],
     "import { isForeign } from '../b9/fx-rules.js';")
edit('modules/intake/extras-routes.ts', [
    ("        STAGE_SCOPE[stage],\n        value,\n      );", "        STAGE_SCOPE[stage],\n        value,\n        null,\n        isForeign(l.row.currency),\n      );"),
    ("          'SOURCING_APPROVAL',\n          Number(l.row.estimatedValue ?? 0),\n        );", "          'SOURCING_APPROVAL',\n          Number(l.row.estimatedValue ?? 0),\n          null,\n          isForeign(l.row.currency),\n        );"),
], "import { isForeign } from '../b9/fx-rules.js';")
edit('modules/plan/routes.ts', [("            'SOURCING_APPROVAL',\n            value,\n          );", "            'SOURCING_APPROVAL',\n            value,\n            null,\n            isForeign(l.req.currency),\n          );")],
     "import { isForeign } from '../b9/fx-rules.js';")
edit('modules/plan/service.ts', [("        'SOURCING_APPROVAL',\n        value,\n      );", "        'SOURCING_APPROVAL',\n        value,\n        null,\n        isForeign(l.req.currency),\n      );")],
     "import { isForeign } from '../b9/fx-rules.js';")
edit('modules/tender/routes.ts', [("        'PUBLISH_PERMISSION',\n        value,\n      );", "        'PUBLISH_PERMISSION',\n        value,\n        null,\n        isForeign(l.req.currency),\n      );")],
     "import { isForeign } from '../b9/fx-rules.js';")
print('ok')
