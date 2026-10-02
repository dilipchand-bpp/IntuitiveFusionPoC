p='e2e/intake.spec.ts'
t=open(p,encoding='utf8',newline='').read()
k="test.describe('accessibility and layout'"
new="""test.describe('phone and tablet layout', () => {
  test('phone: each request is a labelled card, so status and value need no sideways scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await signIn(page, 'requester');
    await page.goto('/app/requests');
    const region = page.getByRole('region', { name: 'My requests' });
    const row = region.locator('tbody tr').first();
    for (const label of ['Status', 'Complexity', 'Value']) {
      const cell = row.locator(`td[data-label="${label}"]`);
      await expect(cell).toBeVisible();
      const box = (await cell.boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(375);
    }
    expect(await region.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(0);
  });

  test('tablet: full table fits without sideways scrolling and the header does not overlap the logo', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await signIn(page, 'requester');
    await page.goto('/app/requests');
    const region = page.getByRole('region', { name: 'My requests' });
    await expect(region.getByRole('columnheader', { name: 'Value' })).toBeVisible();
    expect(await region.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(0);
    await expect(page.getByText('Proof of concept · synthetic data')).toBeHidden();
  });

  test('phone: every button and link in the signed-in header is at least 44px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await signIn(page, 'requester');
    const small = await page.locator('header button, header a').evaluateAll((els) =>
      els
        .map((e) => ({ n: e.getAttribute('aria-label') ?? e.textContent, r: e.getBoundingClientRect() }))
        .filter((x) => x.r.width > 0 && (x.r.height < 44 || x.r.width < 44))
        .map((x) => x.n),
    );
    expect(small).toEqual([]);
  });
});

"""
t=t.replace(k,new+k,1)
open(p,'w',encoding='utf8',newline='').write(t)
