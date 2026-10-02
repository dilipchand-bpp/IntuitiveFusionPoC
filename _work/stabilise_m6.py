import re
base = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC'

def rd(p):
    return open(base + '\\' + p, encoding='utf8', newline='').read()

def wr(p, t):
    open(base + '\\' + p, 'w', encoding='utf8', newline='').write(t)

# ---- shell.spec.ts: dashboard tests must not depend on what other tests created
p = r'e2e\shell.spec.ts'
t = rd(p)
a = t.index("  test('dashboard shows live KPIs")
b = t.index("  test('skip link")
new = """  test('dashboard shows live KPIs and a procurement table (at least the seeded data, whatever other tests added)', async ({ page }) => {
    await signIn(page, 'EXEC');
    await page.goto('/app/dashboard');
    const kpis = page.getByRole('region', { name: 'Key figures' });
    for (const label of ['Active procurements', 'Value in flight', 'Avg. cycle time', 'Alerts due', 'Waiting for you']) {
      await expect(kpis).toContainText(label);
    }
    // The seed alone puts $6,648,000 in flight across 4 active procurements; other tests only add to it.
    const hint = await kpis.getByText(/^\\$[\\d,]{7,}$/).first().innerText();
    expect(Number(hint.replace(/[^\\d]/g, ''))).toBeGreaterThanOrEqual(6_648_000);
    const table = page.getByRole('table', { name: 'Recent procurements' });
    await expect(table.getByRole('columnheader')).toHaveCount(5);
    expect(await table.getByRole('row').count()).toBeGreaterThan(1);
  });

"""
t = t[:a] + new + t[b:]
# dashboard visual: viewport-sized, data regions masked
a = t.index("  test('dashboard light desktop'")
new2 = """  test('dashboard light desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signIn(page, 'EXEC');
    await page.goto('/app/dashboard');
    await page.evaluate(() => document.fonts.ready);
    // Figures change as other tests create requests, so only the page chrome and layout are compared.
    await expect(page).toHaveScreenshot('dashboard-light-desktop.png', {
      maxDiffPixelRatio: 0.02,
      mask: [page.getByRole('region', { name: 'Key figures' }), page.locator('#by-phase').locator('..'), page.getByRole('table')],
    });
  });
});
"""
t = t[:a] + new2
wr(p, t)

# ---- intake.spec.ts: requests list visual is viewport-sized (row count varies)
p = r'e2e\intake.spec.ts'
t = rd(p)
m = re.search(r"await expect\(page\)\.toHaveScreenshot\('requests-list-light-desktop\.png', \{\s*fullPage: true,", t)
assert m
t = t[:m.start()] + "await expect(page).toHaveScreenshot('requests-list-light-desktop.png', {" + t[m.end():]
wr(p, t)
print('ok')
