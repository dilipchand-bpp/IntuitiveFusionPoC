p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\e2e\intake.spec.ts'
t = open(p, encoding='utf8', newline='').read()
t += '''
test.describe('visual regression @visual', () => {
  test('requests list light desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signIn(page, 'procurement');
    await page.goto('/app/requests?q=PR-2026-000');
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot('requests-list-light-desktop.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
      mask: [page.getByRole('table')],
    });
  });
  test('intake chat with a drafted request, light desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page, 'requester');
    await page.goto('/app/requests/new');
    await say(page, HEADLINE);
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot('intake-chat-light-desktop.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
      mask: [page.locator('[data-field="title"]'), page.locator('h2:has(span.font-mono)')],
    });
  });
  test('intake chat on a phone, dark', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.addInitScript(() => localStorage.setItem('if-theme', 'dark'));
    await signIn(page, 'requester');
    await page.goto('/app/requests/new');
    await say(page, HEADLINE);
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot('intake-chat-dark-mobile.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
      mask: [page.locator('h2:has(span.font-mono)')],
    });
  });
});
'''
open(p, 'w', encoding='utf8', newline='').write(t)
print('ok')
