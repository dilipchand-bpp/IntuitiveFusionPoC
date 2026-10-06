import re


def edit(p, pairs):
    s = open(p, encoding='utf8', newline='').read().replace('\r\n', '\n')
    for a, b in pairs:
        assert a in s, (p, a[:70])
        s = s.replace(a, b, 1)
    open(p, 'w', encoding='utf8', newline='').write(s)


B = 'apps/api/src/modules/'
# rules: clause ordering that understands inserted clauses
edit(B + 'b8/rules.ts', [(
    "/** Where inserted clauses go:",
    """/** Template clauses in the library's order, then each inserted clause directly after the clause it was placed after. */
export function orderClauses<T extends { clauseId: string; afterClauseId: string | null }>(rows: T[], libOrder: string[]): T[] {
  const at = (k: string) => {
    const i = libOrder.indexOf(k);
    return i < 0 ? 99 : i;
  };
  const base = rows.filter((r) => !r.afterClauseId).sort((x, y) => at(x.clauseId) - at(y.clauseId));
  return placeInserted(
    base,
    rows.filter((r) => r.afterClauseId),
  );
}

/** Where inserted clauses go:""")])
# contract-b8 tidy
edit(B + 'b8/contract-b8.ts', [
    ("  const sys = (tenantId: string) => ({ tenantId, userId: null, role: 'SYSTEM', correlationId: 'counsel-portal' }) as never;", ""),
] if False else [
    ("const sys = (tenantId: string) => ({ tenantId, userId: null, role: null, correlationId: 'counsel-portal' }) as never;",
     "const sys = (tenantId: string): RequestContext => ({ tenantId, userId: null, role: 'SYSTEM' });"),
    ("import { withContext, withSystem, type Tx } from '../../db/client.js';", "import { withContext, withSystem, type RequestContext, type Tx } from '../../db/client.js';"),
    ("  void gt;\n  void tenant;\n}", "}"),
    ("import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, ne } from 'drizzle-orm';", "import { and, asc, desc, eq, inArray, isNotNull, isNull, ne } from 'drizzle-orm';"),
    ("  supplier,\n  tenant,\n} from '../../db/schema.js';", "  supplier,\n} from '../../db/schema.js';"),
])
# routes.ts: ordering, redaction, register
edit(B + 'contract/routes.ts', [
    ("""    const ordered = [...clauses].sort(
      (x, y) => (libBy.get(x.clauseId)?.i ?? 99) - (libBy.get(y.clauseId)?.i ?? 99),
    );""", """    const ordered = orderClauses(
      clauses,
      lib.map((l) => l.clauseId),
    );"""),
    ("""      clauses: ordered.map((k) => ({
        id: k.clauseId,
        title: k.title,
        text: k.text,
        mandatory: k.mandatory,
        changedFromTemplate: k.changedFromTemplate,
      })),""", """      clauses: ordered.map((k) => ({
        id: k.clauseId,
        title: k.title,
        // redacted wording is shown to Legal alone (FR-0830)
        text: k.redacted && !roles.includes('LEGAL') ? '[Redacted]' : k.text,
        mandatory: k.mandatory,
        changedFromTemplate: k.changedFromTemplate,
        redacted: k.redacted,
        inserted: k.afterClauseId !== null,
      })),"""),
    ("import { registerContractB5 } from './b5-routes.js';", "import { registerContractB5 } from './b5-routes.js';\nimport { registerContractB8 } from '../b8/contract-b8.js';\nimport { orderClauses } from '../b8/rules.js';"),
    ("""  return done;
}""", """  registerContractB8(app, p, d, reg, { load, templateClauses });

  return done;
}"""),
])
# export: redacted wording never leaves in a document
edit(B + 'contract/b4-routes.ts', [
    ("""          clauses: Array<{ title: string; text: string }>;
          title: string | null;
          signatures""", """          clauses: Array<{ title: string; text: string; redacted?: boolean }>;
          title: string | null;
          signatures"""),
    ("            v.clauses,\n            v.signatures.filter((s) => s.decision === 'APPROVED').map((s) => s.stamp ?? ''),",
     "            v.clauses.map((k) => (k.redacted ? { ...k, text: '[Redacted]' } : k)), // redaction holds in every document (FR-0830)\n            v.signatures.filter((s) => s.decision === 'APPROVED').map((s) => s.stamp ?? ''),"),
])
# legal matters: raise on the legal platform, show its reference and stage
edit(B + 'contract/b4-routes2.ts', [
    ("    contractNumber: extra.contract,\n    hours: extra.hours,", "    contractNumber: extra.contract,\n    externalRef: m.externalRef,\n    externalStage: m.externalStage,\n    hours: extra.hours,"),
    ("""        after: { title: body.title, contractId: body.contractId ?? null },
      });
      return { id: m!.id };""", """        after: { title: body.title, contractId: body.contractId ?? null },
      });
      // the customer's own legal platform is told, when there is one (FR-0390)
      const sent = await raiseMatterEvent(tx, { clock: d.clock, audit: d.audit }, a.ctx, m!);
      return { id: m!.id, externalRef: sent?.status === 'DELIVERED' ? ((sent.payload as { externalRef?: string }).externalRef ?? null) : null, integration: sent ? sent.status : null };"""),
    ("import { guard, type AuthContext } from '../../auth/guard.js';", "import { guard, type AuthContext } from '../../auth/guard.js';\nimport { raiseMatterEvent } from '../b8/integration.js';"),
])
# variations: stop while a disclosure is overdue
edit(B + 'contract/extras.ts', [
    ("""    const settings = await loadSettings(tx, a.user.tenantId);
    const parentEnd = (await effectiveEnd(tx, parent)) ?? parent.endDate!;""", """    const settings = await loadSettings(tx, a.user.tenantId);
    // a statutory disclosure that is past due stops further change to the same contract until it is recorded (NFR-L02)
    const late = await overdueDisclosure(tx, parent.id, start);
    if (late)
      throw new AppError(409, 'DISCLOSURE_OVERDUE', `A public register disclosure was due on ${late.dueOn} and has not been recorded. Record it before changing this contract again.`);
    const parentEnd = (await effectiveEnd(tx, parent)) ?? parent.endDate!;"""),
])
print('ok')
