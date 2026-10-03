import os
os.chdir(r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src\modules\reporting')
t = open('routes.ts', encoding='utf8').read()
a = t.index("  // ------------------------------------------------------------ spend by category")
b = t.index("  // ------------------------------------------------------------ audit trail (US-RPT-02)")
new = r'''  // ------------------------------------------------------------ spend (US-RPT-03)
  const cleanCategory = (c: string | null) => c?.replace(/\s*\(UNSPSC[^)]*\)/, '') || NO_CATEGORY;

  reg('GET', '/reports/spend');
  app.get(`${p}/reports/spend`, { preHandler: guard(d, ['EXEC', 'FINANCE', 'PROCUREMENT']) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const { rows } = await visibleRequests(tx, a);
      const tenders = rows.length
        ? await tx
            .select()
            .from(tender)
            .where(
              inArray(
                tender.requestId,
                rows.map((r) => r.id),
              ),
            )
        : [];
      const all = await tx
        .select()
        .from(contract)
        .where(and(eq(contract.tenantId, a.user.tenantId), sql`${contract.deletedAt} is null`));
      const executed = all.filter((c) => c.status === 'EXECUTED');
      const suppliers = await tx.select().from(supplier).where(eq(supplier.tenantId, a.user.tenantId));
      const company = (id: string) => suppliers.find((s) => s.id === id)?.company ?? 'Unknown supplier';
      // a variation counts against the request of the contract it varies
      const requestOf = (c: (typeof all)[number]) => {
        const root = c.parentId ? all.find((x) => x.id === c.parentId) : c;
        const t = root?.tenderId ? tenders.find((x) => x.id === root.tenderId) : undefined;
        return t ? rows.find((x) => x.id === t.requestId) : undefined;
      };

      type Item = { kind: 'REQUEST' | 'CONTRACT'; number: string; title: string; supplier: string | null; value: number };
      const cat = new Map<string, { pipeline: number; committed: number; items: Item[] }>();
      const slot = (k: string) => {
        if (!cat.has(k)) cat.set(k, { pipeline: 0, committed: 0, items: [] });
        return cat.get(k)!;
      };
      for (const r of rows.filter((x) => x.status !== 'COMPLETE')) {
        const s = slot(cleanCategory(r.category));
        s.pipeline += Number(r.estimatedValue ?? 0);
        s.items.push({ kind: 'REQUEST', number: r.number, title: r.title, supplier: null, value: Number(r.estimatedValue ?? 0) });
      }
      const sup = new Map<string, { company: string; committed: number; contracts: number }>();
      for (const c of executed) {
        const r = requestOf(c);
        const s = slot(r ? cleanCategory(r.category) : UNLINKED);
        s.committed += Number(c.value);
        s.items.push({ kind: 'CONTRACT', number: c.number, title: r?.title ?? '', supplier: company(c.supplierId), value: Number(c.value) });
        const x = sup.get(c.supplierId) ?? { company: company(c.supplierId), committed: 0, contracts: 0 };
        x.committed += Number(c.value);
        x.contracts += 1;
        sup.set(c.supplierId, x);
      }
      const byCategory = [...cat.entries()]
        .map(([category, v]) => ({ category, pipeline: v.pipeline, committed: v.committed, items: v.items }))
        .sort((x, y) => y.pipeline + y.committed - (x.pipeline + x.committed) || x.category.localeCompare(y.category));
      const total = [...sup.values()].reduce((n, x) => n + x.committed, 0);
      const bySupplier = [...sup.entries()]
        .map(([supplierId, v]) => ({ supplierId, ...v, share: total ? Math.round((v.committed / total) * 1000) / 10 : 0 }))
        .sort((x, y) => y.committed - x.committed || x.company.localeCompare(y.company));
      // Off-contract ("maverick") spend: a purchase that reached delivery or was closed with no executed contract behind it
      const withContract = new Set(executed.map((c) => requestOf(c)?.id).filter(Boolean));
      const offContract = rows
        .filter((r) => ['CONTRACT_MGMT', 'CLOSED'].includes(r.phase) && !withContract.has(r.id))
        .map((r) => ({
          requestId: r.id,
          number: r.number,
          title: r.title,
          category: cleanCategory(r.category),
          value: Number(r.estimatedValue ?? 0),
          phase: r.phase,
        }))
        .sort((x, y) => y.value - x.value);
      return {
        byCategory,
        bySupplier,
        offContract,
        totalPipeline: byCategory.reduce((s, x) => s + x.pipeline, 0),
        totalCommitted: byCategory.reduce((s, x) => s + x.committed, 0),
        totalOffContract: offContract.reduce((s, x) => s + x.value, 0),
        note: 'Pipeline is the estimated value of active requests; committed is the value of executed contracts, including variations; off-contract is a purchase that reached delivery or was closed with no executed contract.',
      };
    });
  });

  // ------------------------------------------------------------ workload and timeline (US-RPT-04)
  reg('GET', '/reports/workload');
  app.get(`${p}/reports/workload`, { preHandler: guard(d, ['PROCUREMENT', 'EXEC']) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const { rows } = await visibleRequests(tx, a);
      const active = rows.filter((r) => r.status !== 'COMPLETE');
      const people = await tx.select().from(appUser).where(eq(appUser.tenantId, a.user.tenantId));
      const name = (id: string) => people.find((u) => u.id === id)?.name ?? 'Unknown';
      const owners = new Map<string, { ownerId: string; ownerName: string; procurements: number; value: number; byPhase: Record<string, number> }>();
      for (const r of active) {
        const o = owners.get(r.requesterId) ?? { ownerId: r.requesterId, ownerName: name(r.requesterId), procurements: 0, value: 0, byPhase: {} };
        o.procurements += 1;
        o.value += Number(r.estimatedValue ?? 0);
        o.byPhase[r.phase] = (o.byPhase[r.phase] ?? 0) + 1;
        owners.set(r.requesterId, o);
      }
      const ids = active.map((r) => r.id);
      const tenders = ids.length
        ? await tx.select().from(tender).where(inArray(tender.requestId, ids))
        : [];
      const contracts = tenders.length
        ? await tx
            .select()
            .from(contract)
            .where(
              inArray(
                contract.tenderId,
                tenders.map((t) => t.id),
              ),
            )
        : [];
      const day = (d0: Date | string | null | undefined) => (d0 ? new Date(d0).toISOString().slice(0, 10) : null);
      const today = day(d.clock.now())!;
      const timeline = active
        .map((r) => {
          const bars: Array<{ label: string; start: string; end: string; optional: boolean }> = [
            { label: 'Request and plan', start: day(r.createdAt)!, end: day(r.updatedAt)! < day(r.createdAt)! ? day(r.createdAt)! : day(r.updatedAt)!, optional: false },
          ];
          const t = tenders.find((x) => x.requestId === r.id);
          if (t?.opensAt && t.closesAt) bars.push({ label: 'Tender open', start: day(t.opensAt)!, end: day(t.closesAt)!, optional: false });
          const c = t ? contracts.find((x) => x.tenderId === t.id && !x.deletedAt) : undefined;
          if (c?.startDate && c.endDate) bars.push({ label: `Contract ${c.number}`, start: c.startDate, end: c.endDate, optional: false });
          return { requestId: r.id, number: r.number, title: r.title, owner: name(r.requesterId), phase: r.phase, bars };
        })
        .sort((x, y) => x.number.localeCompare(y.number));
      return {
        today,
        owners: [...owners.values()].sort((x, y) => y.procurements - x.procurements || y.value - x.value || x.ownerName.localeCompare(y.ownerName)),
        timeline,
        note: 'The owner of a procurement is the person who raised the request; the proof of concept has no separate procurement lead assignment.',
      };
    });
  });

'''
t = t[:a] + new + t[b:]
t = t.replace("  submission,\n  tender,\n} from '../../db/schema.js';", "  submission,\n  supplier,\n  tender,\n} from '../../db/schema.js';", 1)
open('routes.ts', 'w', encoding='utf8').write(t)
print('ok')
