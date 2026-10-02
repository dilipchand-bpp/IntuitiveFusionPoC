p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\e2e\tender.spec.ts'
t = open(p, encoding='utf8', newline='').read()
a = t.index("  test('accessibility and phone layout: staff workspace")
b = t.index("test.describe('after the closing time, and who can open what'")
new = """  for (const vp of [
    { name: 'phone', width: 375, height: 812 },
    { name: 'desktop', width: 1280, height: 900 },
  ]) {
    test(`accessibility and layout on a ${vp.name}: staff workspace, supplier list, tender page and registration`, async ({
      page,
    }) => {
      test.setTimeout(120_000); // five pages, three sign-ins and an axe scan on each
      const check = async (label: string) => {
        await page.evaluate(() => document.fonts.ready);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
          `${label}: horizontal scroll`,
        ).toBeLessThanOrEqual(0);
        const r = await new AxeBuilder({ page }).withTags(WCAG).analyze();
        expect(
          r.violations.map((v) => `${label}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join('|')}`),
        ).toEqual([]);
      };
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await staffSignIn(page, 'procurement');
      await page.goto('/app/tenders');
      await check(`tenders list ${vp.name}`);
      await page.goto(`/app/tenders/${tenderId}`);
      await expect(workspace(page)).toBeVisible();
      await check(`tender workspace ${vp.name}`);
      await supplierSignIn(page, supplierMail, SUPPLIER_PASSWORD);
      await check(`supplier home ${vp.name}`);
      await page.goto(`/supplier/tenders/${tenderId}`);
      await expect(page.getByTestId('supplier-tender-page')).toBeVisible();
      await check(`supplier tender ${vp.name}`);
      await page.context().clearCookies();
      await page.goto('/supplier/register');
      await expect(page.getByRole('heading', { name: 'Register as a supplier' })).toBeVisible();
      await check(`register ${vp.name}`);
    });
  }
});

"""
t = t[:a] + new + t[b:]
open(p, 'w', encoding='utf8', newline='').write(t)
print('ok')
