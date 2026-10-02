import re
base = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC'

def rd(p):
    return open(base + '\\' + p, encoding='utf8', newline='').read()

def wr(p, t):
    open(base + '\\' + p, 'w', encoding='utf8', newline='').write(t)

# dashboard: compare the stable chrome (header + sidebar), not live figures
p = r'e2e\shell.spec.ts'
t = rd(p)
a = t.index("  test('dashboard light desktop'")
t = t[:a] + """  test('signed-in shell chrome (header and sidebar), light desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signIn(page, 'EXEC');
    await page.goto('/app/dashboard');
    await page.evaluate(() => document.fonts.ready);
    // Live figures change as other tests create requests, so only the stable page chrome is compared.
    const shell = page.getByTestId('shell');
    await expect(shell.locator('header').first()).toHaveScreenshot('shell-header-light.png', { maxDiffPixelRatio: 0.02 });
    await expect(shell.locator('aside')).toHaveScreenshot('shell-sidebar-exec-light.png', { maxDiffPixelRatio: 0.02 });
  });
});
"""
wr(p, t)

# requests list: compare the page heading + search form (the rows vary run to run)
p = r'e2e\intake.spec.ts'
t = rd(p)
a = t.index("  test('requests list light desktop'")
b = t.index("  test('intake chat with a drafted request")
t = t[:a] + """  test('requests list header and search form, light desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signIn(page, 'procurement');
    await page.goto('/app/requests');
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator('main header').first()).toHaveScreenshot('requests-header-light.png', { maxDiffPixelRatio: 0.02 });
    await expect(page.getByRole('search', { name: 'Search requests' })).toHaveScreenshot('requests-search-light.png', { maxDiffPixelRatio: 0.02 });
  });
""" + t[b:]
wr(p, t)
print('ok')
