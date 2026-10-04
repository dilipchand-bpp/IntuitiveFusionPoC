p = 'apps/api/src/modules/contract/routes.ts'
s = open(p, encoding='utf8', newline='').read()
assert '\r' not in s


def rep(old, new):
    global s
    assert old in s, old[:80]
    s = s.replace(old, new, 1)


rep("""import { releaseExtra, registerContractB4 } from './b4-routes.js';""", """import { releaseExtra, registerContractB4 } from './b4-routes.js';
import { registerContractB5 } from './b5-routes.js';
import { canSee, generatePlans, isNarrow, teamUserIds } from './b5-service.js';
import { syncContractCompliance } from './compliance.js';""")
rep("""import { registerContractExtras } from './extras.js';""", """import { makeVariationCreator, registerContractExtras } from './extras.js';""")
rep("""  consensusItem,
  contract,
  contractExtension,""", """  consensusItem,
  contract,
  contractExtension,
  disclosureTask,""")

# load scoped to a person's own contracts (FR-0560)
rep("""    if (!c) throw new AppError(404, 'NOT_FOUND', 'Contract not found');
    return c;
  }
  const locked = ()""", """    if (!c || !(await canSee(tx, a, c))) throw new AppError(404, 'NOT_FOUND', 'Contract not found');
    return c;
  }
  const locked = ()""")

# authority value follows the organisation's variation model (FR-0540)
rep("""    if (!c.parentId) return Number(c.value);
    const [parent] = await tx.select().from(contract).where(eq(contract.id, c.parentId));
    if (!parent) return Number(c.value);""", """    if (!c.parentId) return Number(c.value);
    // incremental: a variation is judged on its own additional spend, not on the whole contract
    if ((await loadSettings(tx, c.tenantId)).contractManagement.variationModel === 'INCREMENTAL')
      return Number(c.value);
    const [parent] = await tx.select().from(contract).where(eq(contract.id, c.parentId));
    if (!parent) return Number(c.value);""")

# alert view carries channels and the assigned owner (FR-0515)
rep("""      sentAt: x.sentAt?.toISOString() ?? null,
      note: x.note,
      deliveries: dl.map((y) => ({""", """      sentAt: x.sentAt?.toISOString() ?? null,
      note: x.note,
      channels: x.channels as string[],
      ownerId: x.ownerId,
      deliveries: dl.map((y) => ({""")

# variation information in the view (FR-0535, FR-0540)
rep("""    const execKids = kids.filter((v) => v.status === 'EXECUTED');
    return {
      ...base,
      record,""", """    const execKids = kids.filter((v) => v.status === 'EXECUTED');
    let variation: unknown = null;
    if (c.parentId && parent) {
      const others = (await variationsOf(tx, parent)).filter((v) => v.status === 'EXECUTED' && v.id !== c.id);
      const standing = Number(parent.value) + others.reduce((s2, v) => s2 + Number(v.value), 0);
      const after = standing + Number(c.value);
      const needs = requiredSigners(await authorityValue(tx, c)).map((s2) => s2.label);
      const [task] = await tx.select().from(disclosureTask).where(eq(disclosureTask.contractId, c.id));
      variation = {
        businessCase: c.businessCase,
        variancePct: c.variancePct === null ? null : Number(c.variancePct),
        model: c.varianceModel ?? settings.contractManagement.variationModel,
        standingValue: standing,
        cumulativeValue: after,
        requiredSigners: needs,
        tierBefore: requiredSigners(standing).length,
        tierAfter: requiredSigners(after).length,
        tierChanged: requiredSigners(standing).length !== requiredSigners(after).length,
        disclosure: task
          ? { id: task.id, register: task.register, dueOn: task.dueOn, status: task.status }
          : null,
        linkedRequestId: c.linkedRequestId,
      };
    }
    return {
      ...base,
      variation,
      record,""")

# list is scoped
rep("""      for (const c of rows) {
        if (q.status && c.status !== q.status) continue;
        const s = await summary(tx, a.user.tenantId, c);
        if (q.q) {""", """      const narrow = isNarrow(a.user.roles);
      const team = narrow ? await teamUserIds(tx, a) : null;
      for (const c of rows) {
        if (q.status && c.status !== q.status) continue;
        if (team) {
          const owner = c.parentId
            ? (rows.find((r) => r.id === c.parentId)?.ownerId ?? null)
            : c.ownerId;
          if (!owner || !team.has(owner)) continue;
        }
        const s = await summary(tx, a.user.tenantId, c);
        if (q.q) {""")

# execution: compliance and plans for a new contract (FR-0550, FR-0555)
rep("""        if (c.parentId) {
          // an executed variation can move the end date: the parent's scheduled alerts follow it""", """        if (!c.parentId) {
          const [sup] = await tx.select().from(supplier).where(eq(supplier.id, c.supplierId));
          const [fresh] = await tx.select().from(contract).where(eq(contract.id, id));
          if (sup && fresh) await syncContractCompliance(tx, d.audit, fresh, sup, now);
          if (fresh && ['CONTRACT', 'MASTER'].includes(fresh.docType))
            await generatePlans(
              tx,
              { registry, audit: d.audit, now },
              a.ctx,
              fresh,
              await loadSettings(tx, a.user.tenantId),
              { manual: false },
            );
        }
        if (c.parentId) {
          // an executed variation can move the end date: the parent's scheduled alerts follow it""")

# wiring
rep("""  const registry = d.registry ?? new MockVendorRegistry();
  registerContractB4(app, p, d, reg, {""", """  registerContractB4(app, p, d, reg, {""")
rep("""  registerContractExtras(app, p, d, reg, {
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
""", """  registerContractExtras(app, p, d, reg, {
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
  registerContractB5(app, p, d, reg, {
    load,
    summary,
    view,
    variationsOf,
    notifyRoles,
    createVariation: makeVariationCreator(d, { variationsOf, notifyRoles }),
    registry,
  });
""")
# registry must be defined before the sign route uses it: define it with the helpers
rep("""  const cid = (req: FastifyRequest) => parse(z.object({ id: uuid }), req.params).id;
""", """  const cid = (req: FastifyRequest) => parse(z.object({ id: uuid }), req.params).id;
  const registry = d.registry ?? new MockVendorRegistry();
""")
open(p, 'w', encoding='utf8', newline='').write(s)
print('ok')
