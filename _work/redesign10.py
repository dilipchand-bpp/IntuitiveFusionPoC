p='e2e/shell.spec.ts'
t=open(p,encoding='utf8',newline='').read()
k="  test('notification bell shows the unread count"
assert k in t
new="""  test('Ctrl+K opens the jump-to palette; typing filters the pages and Enter opens the match', async ({ page }) => {
    await signIn(page, 'DELEGATE');
    await page.keyboard.press('Control+k');
    const box = page.getByRole('combobox', { name: 'Search pages' });
    await expect(box).toBeFocused();
    await box.fill('approv');
    await expect(page.getByRole('option')).toHaveCount(1);
    await box.press('Enter');
    await expect(page).toHaveURL(/\/app\/approvals/);
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: 'Search pages' }).fill('zzz');
    await expect(page.getByText('No pages match.')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('combobox', { name: 'Search pages' })).toHaveCount(0);
  });

"""
t=t.replace(k,new+k,1)
open(p,'w',encoding='utf8',newline='').write(t)
