def sub(p, a, b):
    t = open(p, encoding='utf8', newline='').read()
    assert a in t, (p, a[:70])
    open(p, 'w', encoding='utf8', newline='').write(t.replace(a, b, 1))


auth = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\e2e\auth.spec.ts'
sub(auth,
    "      await expect(page.getByTestId('shell')).toHaveAttribute('data-role', role);",
    """      // Suppliers get their own header-only portal; everyone else gets the staff shell.
      if (role === 'SUPPLIER') await expect(page.getByTestId('supplier-shell')).toBeVisible();
      else await expect(page.getByTestId('shell')).toHaveAttribute('data-role', role);""")

shell = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\e2e\shell.spec.ts'
sub(shell,
    """      await signIn(page, role);
      const expected = navFor([role]);
      const nav = page.getByRole('navigation', { name: 'Main' });
      const links = await nav.getByRole('link').allInnerTexts();
      expect(links.map((l) => l.trim()).sort()).toEqual(expected.map((n) => n.label).sort());
      for (const item of expected) {
        const res = await page.goto(item.href);
        expect(res?.status(), item.href).toBe(200);
        await expect(page.getByTestId('shell'), item.href).toBeVisible();""",
    """      await signIn(page, role);
      const expected = navFor([role]);
      // The supplier portal has no side menu (a supplier sees one tender, not the buying team's modules), so only
      // staff roles have a menu to compare; every supplier page must still open for real.
      const frame = role === 'SUPPLIER' ? 'supplier-shell' : 'shell';
      if (role !== 'SUPPLIER') {
        const nav = page.getByRole('navigation', { name: 'Main' });
        const links = await nav.getByRole('link').allInnerTexts();
        expect(links.map((l) => l.trim()).sort()).toEqual(expected.map((n) => n.label).sort());
      }
      for (const item of expected) {
        const res = await page.goto(item.href);
        expect(res?.status(), item.href).toBe(200);
        await expect(page.getByTestId(frame), item.href).toBeVisible();""")
print('ok')
