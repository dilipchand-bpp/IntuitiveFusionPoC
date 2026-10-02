import re

# ---------------------------------------------------------------- service: no second transaction while one is open
p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src\modules\tender\service.ts'
t = open(p, encoding='utf8', newline='').read()
a = t.index('  /** A supplier\'s access to one tender')
new_tail = '''  /** A supplier's access to one tender: the row, or null when they may not see it (no audit here: see denyAccess). */
  async supplierAccess(tx: Tx, a: AuthContext, id: string): Promise<LoadedTender | null> {
    const l = await this.load(tx, a.user.tenantId, id);
    if (!l) return null;
    const visible = (await this.visibleTo(tx, a.user.tenantId, a.user.supplierId)).some((t) => t.id === id);
    return visible ? l : null;
  }

  /**
   * Logs the refused attempt and answers exactly like "no such tender". Must be called AFTER the request's
   * transaction has ended: the audit write opens its own, and a second concurrent transaction would deadlock a
   * single-connection database (and would be rolled back with the failed request otherwise).
   */
  async denyAccess(database: Database, a: AuthContext, id: string): Promise<never> {
    await this.audit.recordOutsideTx(database, a.ctx, {
      action: 'access.denied',
      entityType: 'tender',
      entityId: id,
      after: { reason: 'NOT_INVITED' },
      result: 'DENIED',
    });
    throw new AppError(404, 'NOT_FOUND', 'Tender not found');
  }
}
'''
t = t[:a] + new_tail
open(p, 'w', encoding='utf8', newline='').write(t)

# ---------------------------------------------------------------- supplier routes
p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src\modules\tender\supplier-routes.ts'
t = open(p, encoding='utf8', newline='').read()

helper = '''  /** Runs `fn` as the signed-in supplier on a tender they may see; otherwise an audited 404 once the transaction is over. */
  async function asSupplier<T>(
    a: NonNullable<import('fastify').FastifyRequest['auth']>,
    id: string,
    fn: (tx: Tx, l: LoadedTender) => Promise<T>,
  ): Promise<T> {
    const r = await withContext(d.database, a.ctx, async (tx) => {
      const l = await svc.supplierAccess(tx, a, id);
      return l ? { ok: true as const, value: await fn(tx, l) } : { ok: false as const };
    });
    if (!r.ok) return svc.denyAccess(d.database, a, id);
    return r.value;
  }

'''
marker = '  // ---------------------------------------------------------------- invitation lookup (public, US-SUP-01)'
t = t.replace(marker, helper + marker, 1)
t = t.replace("import { withContext, withSystem, type RequestContext } from '../../db/client.js';",
              "import { withContext, withSystem, type RequestContext, type Tx } from '../../db/client.js';")
t = t.replace("import { TenderService } from './service.js';", "import { TenderService, type LoadedTender } from './service.js';")

# routes that did: withContext(d.database, a.ctx, async (tx) => { const l = await svc.supplierAccess(tx, d.database, a, id);
pat = re.compile(r'withContext\(d\.database, a\.ctx, async \(tx\) => \{\s*const l = await svc\.supplierAccess\(tx, d\.database, a, id\);')
t, n = pat.subn('asSupplier(a, id, async (tx, l) => {', t)
print('block replacements', n)
# the GET one-liner
pat2 = re.compile(r'withContext\(d\.database, a\.ctx, async \(tx\) =>\s*svc\.supplierView\(tx, a, await svc\.supplierAccess\(tx, d\.database, a, id\)\),\s*\);')
t, n2 = pat2.subn('asSupplier(a, id, (tx, l) => svc.supplierView(tx, a, l));', t)
print('get replacements', n2)
assert 'supplierAccess(tx, d.database' not in t
open(p, 'w', encoding='utf8', newline='').write(t)

# ---------------------------------------------------------------- staff route (GET questions as supplier)
p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src\modules\tender\routes.ts'
t = open(p, encoding='utf8', newline='').read()
old_pat = re.compile(r"      return withContext\(d\.database, a\.ctx, async \(tx\) => \{\s*if \(a\.user\.roles\.includes\('SUPPLIER'\)\) \{\s*const l = await svc\.supplierAccess\(tx, d\.database, a, id\);\s*return svc\.questionRows\(tx, l\.tender\.id, true\);\s*\}\s*await visible\(tx, a\.user\.tenantId, id\);\s*return svc\.questionRows\(tx, id, false\);\s*\}\);")
new = """      if (a.user.roles.includes('SUPPLIER')) {
        const r = await withContext(d.database, a.ctx, async (tx) => {
          const l = await svc.supplierAccess(tx, a, id);
          return l ? { ok: true as const, rows: await svc.questionRows(tx, l.tender.id, true) } : { ok: false as const };
        });
        return r.ok ? r.rows : svc.denyAccess(d.database, a, id);
      }
      return withContext(d.database, a.ctx, async (tx) => {
        await visible(tx, a.user.tenantId, id);
        return svc.questionRows(tx, id, false);
      });"""
t, n3 = old_pat.subn(new, t)
print('staff replacements', n3)
assert n3 == 1
open(p, 'w', encoding='utf8', newline='').write(t)
