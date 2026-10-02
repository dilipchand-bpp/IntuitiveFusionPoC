p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\e2e\plan.spec.ts'
t = open(p, encoding='utf8', newline='').read()
t += '''
test.describe('visual regression @visual', () => {
  // Request numbers, dates, names and figures vary between runs, so those regions are masked; layout is what is compared.
  const volatile = (page: Page) => [
    page.locator('h1'),
    page.getByTestId('key-points').locator('li'),
    page.locator('[data-paragraph]'),
    page.getByLabel('Approval record'),
    page.getByTestId('coi-panel').locator('li'),
  ];

  test('plan workspace for procurement, desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    const id = await submittedRequest(1_250_000, unique('Visual plan'));
    await signIn(page, 'procurement');
    await openPlan(page, id);
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot('plan-procurement-desktop.png', { maxDiffPixelRatio: 0.03, mask: volatile(page) });
  });

  test('approval on a phone: key points and decision first', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const id = await submittedRequest(90_000, unique('Visual approval'));
    await signIn(page, 'procurement');
    await openPlan(page, id);
    await page.getByRole('button', { name: 'Submit for approval' }).click();
    await expect(status(page)).toHaveAttribute('data-plan-status', 'AWAITING_APPROVAL');
    await page.context().clearCookies();
    await signIn(page, 'delegate');
    await openPlan(page, id);
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot('plan-approval-mobile.png', { maxDiffPixelRatio: 0.03, mask: volatile(page) });
  });
});
'''
open(p, 'w', encoding='utf8', newline='').write(t)
print('ok')
