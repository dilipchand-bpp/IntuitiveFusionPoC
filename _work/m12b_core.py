import os
os.chdir(r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src\modules\contract')
t = open('routes.ts', encoding='utf8').read()


def sub(a, b, count=1):
    global t
    assert a in t, a[:80]
    t = t.replace(a, b, count)


# imports
sub("import { addDays, addMonths, daysBetween, iso, termBars } from './dates.js';",
    "import { addDays, addMonths, daysBetween, iso, termBars } from './dates.js';\nimport { deviationBlockers, proposeRisk, type Risk } from './deviation.js';\nimport { registerContractExtras } from './extras.js';")
sub("import { AlertService, createContractRecord } from './record.js';",
    "import { AlertService, createContractRecord, effectiveEnd, rescheduleAlerts } from './record.js';")

# authority value + cumulative helpers, before summary()
sub("  async function summary(tx: Tx, tenantId: string, c: typeof contract.$inferSelect) {", """  type ContractRow = typeof contract.$inferSelect;

  /** Executed variations of a contract, oldest first. */
  async function variationsOf(tx: Tx, c: ContractRow) {
    return tx
      .select()
      .from(contract)
      .where(and(eq(contract.parentId, c.id), isNull(contract.deletedAt)))
      .orderBy(asc(contract.number));
  }
  /** Value that counts for signing authority: a variation is judged on the cumulative value of the contract it varies. */
  async function authorityValue(tx: Tx, c: ContractRow): Promise<number> {
    if (!c.parentId) return Number(c.value);
    const [parent] = await tx.select().from(contract).where(eq(contract.id, c.parentId));
    if (!parent) return Number(c.value);
    const done = (await variationsOf(tx, parent)).filter((v) => v.status === 'EXECUTED' && v.id !== c.id);
    return Number(parent.value) + done.reduce((s, v) => s + Number(v.value), 0) + Number(c.value);
  }

  async function summary(tx: Tx, tenantId: string, c: ContractRow) {""")
sub("""    let req: { number: string; title: string } | undefined;
    if (c.tenderId) {
      const [td] = await tx.select().from(tender).where(eq(tender.id, c.tenderId));""", """    let req: { number: string; title: string } | undefined;
    const tenderId =
      c.tenderId ??
      (c.parentId
        ? (await tx.select({ t: contract.tenderId }).from(contract).where(eq(contract.id, c.parentId)))[0]?.t
        : null);
    if (tenderId) {
      const [td] = await tx.select().from(tender).where(eq(tender.id, tenderId));""")
sub("      signaturesRequired: requiredSigners(Number(c.value)).length,\n    };",
    "      parentId: c.parentId,\n      signaturesRequired: requiredSigners(await authorityValue(tx, c)).length,\n    };")

# view(): authority + clause risk/decisions
sub("""    const chain = requiredSigners(Number(c.value)).map((s) => {""", """    const authority = await authorityValue(tx, c);
    const chain = requiredSigners(authority).map((s) => {""")
sub("""          'CONTRACT_SIGNING',
          Number(c.value),
        );
        canSign = del.allowed;""", """          'CONTRACT_SIGNING',
          authority,
        );
        canSign = del.allowed;""")
sub("`This contract (${aud.format(Number(c.value))}) is above your signing authority of ${aud.format(del.limit)}`;",
    "`This contract (${aud.format(authority)}) is above your signing authority of ${aud.format(del.limit)}`;")
sub("""    const record = await recordOf(tx, c);
    return {
      ...base,
      record,""", """    const record = await recordOf(tx, c);
    const decisions = await deviationDecisions(
      tx,
      a.user.tenantId,
      ordered.map((k) => k.id),
    );
    const devRows = ordered
      .filter((k) => k.changedFromTemplate)
      .map((k) => ({
        id: k.id,
        clauseId: k.clauseId,
        title: k.title,
        mandatory: k.mandatory,
        risk: (k.risk ?? 'MEDIUM') as Risk,
        decision: decisions.get(k.id) ?? null,
        templateText: libBy.get(k.clauseId)?.x.text ?? '',
        currentText: k.text,
      }));
    const blockers = deviationBlockers(devRows.map((x) => ({ ...x, decision: x.decision?.decision ?? null })));
    const kids = c.parentId ? [] : await variationsOf(tx, c);
    const [parent] = c.parentId
      ? await tx.select().from(contract).where(eq(contract.id, c.parentId))
      : [];
    const execKids = kids.filter((v) => v.status === 'EXECUTED');
    return {
      ...base,
      record,
      parent: parent ? { id: parent.id, number: parent.number } : null,
      variations: kids.map((v) => ({
        id: v.id,
        number: v.number,
        status: v.status,
        value: Number(v.value),
        endDate: v.endDate,
      })),
      cumulative: {
        value: Number(c.value) + execKids.reduce((s, v) => s + Number(v.value), 0),
        endDate: [c.endDate, ...execKids.map((v) => v.endDate)].filter((x): x is string => !!x).sort().at(-1) ?? null,
      },
      deviationBlockers: blockers,""")
sub("""        changedFromTemplate: k.changedFromTemplate,
      })),
      deviations: ordered
        .filter((k) => k.changedFromTemplate)
        .map((k) => ({
          clauseId: k.clauseId,
          title: k.title,
          mandatory: k.mandatory,
          templateText: libBy.get(k.clauseId)?.x.text ?? '',
          currentText: k.text,
        })),""", """        changedFromTemplate: k.changedFromTemplate,
      })),
      deviations: devRows.map(({ id: _id, ...x }) => ({
        ...x,
        decision: x.decision?.decision ?? null,
        decidedBy: x.decision?.by ?? null,
        stamp: x.decision?.stamp ?? null,
      })),""")
sub("        canDelete: roles.includes('LEGAL') || roles.includes('EXEC'),\n      },",
    "        canDelete: roles.includes('LEGAL') || roles.includes('EXEC'),\n        canDecideDeviations:\n          editable && (roles.includes('DELEGATE') || roles.includes('EXEC')) && devRows.length > 0,\n        canAmendRisk: editable && roles.includes('LEGAL'),\n        canVary: c.status === 'EXECUTED' && !c.parentId && (roles.includes('LEGAL') || roles.includes('PROCUREMENT')),\n        canEditRecord:\n          c.status === 'EXECUTED' &&\n          !c.parentId &&\n          ['CONTRACT_MGR', 'LEGAL', 'PROCUREMENT'].some((r) => roles.includes(r as RoleName)),\n      },")

# decisions helper before load()
sub("  async function load(tx: Tx, a: AuthContext, id: string) {", """  /** The current (not superseded) delegate decision on each changed clause. */
  async function deviationDecisions(tx: Tx, tenantId: string, clauseIds: string[]) {
    const out = new Map<string, { decision: 'APPROVED' | 'REJECTED'; by: string; stamp: string | null }>();
    if (clauseIds.length === 0) return out;
    const rows = await tx
      .select({ a: approval, name: appUser.name })
      .from(approval)
      .innerJoin(appUser, eq(appUser.id, approval.userId))
      .where(
        and(
          eq(approval.tenantId, tenantId),
          eq(approval.subjectType, 'CONTRACT_DEVIATION'),
          inArray(approval.subjectId, clauseIds),
        ),
      )
      .orderBy(asc(approval.decidedAt));
    for (const r of rows)
      if (r.a.decision !== 'SUPERSEDED')
        out.set(r.a.subjectId, { decision: r.a.decision as 'APPROVED' | 'REJECTED', by: r.name, stamp: r.a.stamp });
    return out;
  }

  async function load(tx: Tx, a: AuthContext, id: string) {""")

# clause edit: risk + supersede approvals; no template -> not a deviation
sub("      const changed = !tpl || tpl.text !== body.text.trim() || tpl.title !== title;\n      await tx\n        .update(clause)\n        .set({ text: body.text.trim(), title, changedFromTemplate: changed })\n        .where(eq(clause.id, k.id));",
    """      // A clause of a contract with no template (a variation) has nothing to deviate from.
      const changed = !!tpl && (tpl.text !== body.text.trim() || tpl.title !== title);
      const risk = changed
        ? proposeRisk({ mandatory: k.mandatory, templateText: tpl!.text, currentText: body.text.trim() })
        : null;
      await tx
        .update(clause)
        .set({ text: body.text.trim(), title, changedFromTemplate: changed, risk })
        .where(eq(clause.id, k.id));
      // New wording needs a new decision: earlier approvals of this clause no longer apply.
      await tx
        .update(approval)
        .set({ decision: 'SUPERSEDED' })
        .where(
          and(
            eq(approval.subjectType, 'CONTRACT_DEVIATION'),
            eq(approval.subjectId, k.id),
            ne(approval.decision, 'SUPERSEDED'),
          ),
        );""")
sub("after: { clauseId, changedFromTemplate: changed, mandatory: k.mandatory },", "after: { clauseId, changedFromTemplate: changed, mandatory: k.mandatory, risk },")

# release: deviation blockers
sub("""        const blockers = releaseBlockers(
          { value: Number(c.value), startDate: c.startDate, endDate: c.endDate },
          clauses,
        );""", """        const changedClauses = clauses.filter((k) => k.changedFromTemplate);
        const decided = await deviationDecisions(
          tx,
          a.user.tenantId,
          changedClauses.map((k) => k.id),
        );
        const blockers = [
          ...releaseBlockers({ value: Number(c.value), startDate: c.startDate, endDate: c.endDate }, clauses),
          ...deviationBlockers(
            changedClauses.map((k) => ({
              title: k.title,
              mandatory: k.mandatory,
              risk: (k.risk ?? 'MEDIUM') as Risk,
              decision: decided.get(k.id)?.decision ?? null,
            })),
          ),
        ];""")
sub("after: { number: c.number, signers: requiredSigners(Number(c.value)).map((s) => s.role) },",
    "after: { number: c.number, signers: requiredSigners(await authorityValue(tx, c)).map((s) => s.role) },")
sub("""          requiredSigners(Number(c.value)).map((s) => s.role as RoleName),
          'Contract awaiting your signature',
          `${c.number} (${aud.format(Number(c.value))})`,""", """          requiredSigners(await authorityValue(tx, c)).map((s) => s.role as RoleName),
          'Contract awaiting your signature',
          `${c.number} (${aud.format(Number(c.value))})`,""")

# sign: authority value
sub("      const value = Number(c.value);\n      const chain = requiredSigners(value);", "      const value = await authorityValue(tx, c);\n      const chain = requiredSigners(value);")

# execution: variations do not get their own record; they move the parent's alerts
sub("""        const { tpl } = await templateClauses(tx, a.user.tenantId, c);
        const record = await createContractRecord(tx, c, {
          extensions: (tpl?.body as Partial<TemplateBody> | undefined)?.extensions ?? [],
          today: now.toISOString().slice(0, 10),
        });""", """        const { tpl } = await templateClauses(tx, a.user.tenantId, c);
        const record = c.parentId
          ? { ownerId: null, milestones: [], alerts: [] as unknown[] }
          : await createContractRecord(tx, c, {
              extensions: (tpl?.body as Partial<TemplateBody> | undefined)?.extensions ?? [],
              today: now.toISOString().slice(0, 10),
            });
        if (c.parentId) {
          // an executed variation can move the end date: the parent's scheduled alerts follow it
          const [parent] = await tx.select().from(contract).where(eq(contract.id, c.parentId));
          if (parent) await rescheduleAlerts(tx, parent, now.toISOString().slice(0, 10));
        }""")

# expiring report: effective end date
sub("        if (!c.endDate || c.endDate < today || c.endDate > horizon) continue;",
    "        if (c.parentId) continue; // a variation is part of its parent\n        const end = (await effectiveEnd(tx, c)) ?? c.endDate;\n        if (!end || end < today || end > horizon) continue;")
sub("          endDate: c.endDate,\n          noticeDeadline: addDays(c.endDate, -c.noticeDays),\n          daysRemaining: daysBetween(today, c.endDate),",
    "          endDate: end,\n          noticeDeadline: addDays(end, -c.noticeDays),\n          daysRemaining: daysBetween(today, end),")

# register extras before return
sub("\n  return done;\n}", """
  registerContractExtras(app, p, d, reg, {
    load,
    view,
    recordOf,
    alertView,
    notifyRoles,
    variationsOf,
    authorityValue,
    deviationDecisions,
    alerts,
  });

  return done;
}""")
sub("import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';", "import { and, asc, desc, eq, inArray, isNull, ne } from 'drizzle-orm';")
open('routes.ts', 'w', encoding='utf8').write(t)
print('ok')
