import re
base = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\e2e'

p = base + r'\plan.spec.ts'
t = open(p, encoding='utf8', newline='').read()
t = t.replace(".getByLabel('Instruction')", ".getByRole('textbox', { name: 'Instruction' })")
open(p, 'w', encoding='utf8', newline='').write(t)

p = base + r'\shell.spec.ts'
t = open(p, encoding='utf8', newline='').read()
a = t.index("  test('notification bell shows the unread count")
b = t.index("  test('profile menu shows who is signed in")
new = """  test('notification bell shows the unread count, lists items and marks one read (count goes down by one and stays down)', async ({ page }) => {
    await signIn(page, 'DELEGATE');
    // Other tests also notify the delegate, so compare against the starting count rather than assuming it.
    const bell = page.getByRole('button', { name: /^Notifications, \\d+ unread$/ });
    const start = Number(/(\\d+) unread/.exec((await bell.getAttribute('aria-label')) ?? '')![1]);
    expect(start).toBeGreaterThanOrEqual(1);
    await bell.click();
    await expect(page.getByText('Plan awaiting your approval').first()).toBeVisible();
    await page.getByRole('button', { name: 'Mark read' }).first().click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: `Notifications, ${start - 1} unread` })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: `Notifications, ${start - 1} unread` })).toBeVisible(); // persisted server-side
  });

"""
t = t[:a] + new + t[b:]
open(p, 'w', encoding='utf8', newline='').write(t)
print('ok')
