import re

p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src\modules\tender\supplier-routes.ts'
t = open(p, encoding='utf8', newline='').read()
a = t.index('        let [sup] = await tx')
b = t.index('      const [u] = await tx', a) if '      const [u] = await tx' in t[a:] else t.index('const [u] = await tx', a)
# find the start of the line containing `const [u]`
b = t.rfind('\n', 0, b) + 1
new = '''        // A company already in the directory cannot be joined by self-registration: anyone who knows an ABN (a public
        // number) could otherwise attach themselves to that company and see its tenders and bids. The buyer adds new
        // contacts for an existing supplier after checking them. The answer is the same generic one as for a taken email.
        const [existing] = await tx
          .select({ id: supplier.id })
          .from(supplier)
          .where(and(eq(supplier.tenantId, tenantId), eq(supplier.abn, abn)));
        if (existing)
          throw new AppError(
            409,
            'REGISTRATION_FAILED',
            'We could not register with these details. If you already have an account, sign in instead.',
          );
        const [sup] = await tx
          .insert(supplier)
          .values({
            tenantId,
            company: b.company,
            abn,
            sanctionsStatus: 'PENDING',
            insuranceStatus: 'UNKNOWN',
            createdAt: now,
          })
          .returning();
        await d.audit.record(tx, sys, {
          action: 'supplier.register',
          entityType: 'supplier',
          entityId: sup!.id,
          after: { company: b.company, sanctionsStatus: 'PENDING' },
        });
'''
t = t[:a] + new + t[b:]
open(p, 'w', encoding='utf8', newline='').write(t)

# ---- API regression test
p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src\modules\tender\tender.test.ts'
t = open(p, encoding='utf8', newline='').read()
marker = "  it('open-access tenders: a supplier can register without an invitation"
assert marker in t
test = """  it('an ABN that is already in the directory cannot be joined by self-registration (it would expose that company\\'s tenders)', async () => {
    const t = await stagedTender();
    const inv = await call('procurement', 'POST', `/tenders/${t.id}/invitations`, {
      invitees: [{ email: 'imposter@elsewhere.example', company: 'Imposter Pty Ltd' }],
    });
    const token = new URL(inv.json().invitations[0].registerPath, 'http://x').searchParams.get('token')!;
    const seeded = (await withSystem(database, (tx) => tx.select().from(s.supplier).where(eq(s.supplier.id, uid('supplier:brightwave')))))[0]!;
    const r = await anon('POST', '/supplier/register', {
      token,
      name: 'Imposter',
      email: 'imposter@elsewhere.example',
      company: 'Imposter Pty Ltd',
      abn: seeded.abn,
      password: SUPPLIER_PW,
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('REGISTRATION_FAILED');
    // nothing was created, and the invitation is still unused
    const users = await withSystem(database, (tx) => tx.select().from(s.appUser).where(eq(s.appUser.email, 'imposter@elsewhere.example')));
    expect(users).toEqual([]);
    expect((await anon('GET', `/supplier/invitations/${token}`)).statusCode).toBe(200);
  });

"""
t = t.replace(marker, test + marker, 1)
open(p, 'w', encoding='utf8', newline='').write(t)

# ---- e2e ABN: checksum-valid and not in the seed
p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\e2e\tender.spec.ts'
t = open(p, encoding='utf8', newline='').read()
t = t.replace("const ABN = '51 824 753 556'; // the official ATO example ABN: passes the real checksum",
              "const ABN = '65 000 000 101'; // passes the real ABN checksum; not used by any seeded supplier")
open(p, 'w', encoding='utf8', newline='').write(t)
print('ok')
