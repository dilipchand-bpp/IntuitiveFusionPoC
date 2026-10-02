import re


def edit(p, pairs):
    t = open(p, encoding='utf8', newline='').read()
    for a, b in pairs:
        assert a in t, (p, a[:80])
        t = t.replace(a, b, 1)
    open(p, 'w', encoding='utf8', newline='').write(t)


E = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\e2e'
edit(E + r'\tender.spec.ts', [
    ("    await page.getByLabel('Contact email').fill(supplierMail);",
     "    await page.getByRole('tab', { name: /Invitations/ }).click();\n    await page.getByLabel('Contact email').fill(supplierMail);"),
    ("    const q = page.getByTestId('question').filter({ hasText: 'site visit mandatory' });",
     "    await page.getByRole('tab', { name: /Questions and addenda/ }).click();\n    const q = page.getByTestId('question').filter({ hasText: 'site visit mandatory' });"),
    ("    await expect(page.getByTestId('bids-sealed')).toContainText('1 bid(s) received');",
     "    await page.getByRole('tab', { name: /Bids/ }).click();\n    await expect(page.getByTestId('bids-sealed')).toContainText('1 bid(s) received');"),
])

t = open(E + r'\intake.spec.ts', encoding='utf8', newline='').read()
# the status badge now lives in the page header on the detail page, outside the panel
t = t.replace("await expect(page.getByTestId('draft-panel')).toContainText('Submitted');", "await expect(page.locator('main')).toContainText('Submitted');", 1)
t = t.replace("    await expect(page.getByTestId('draft-panel')).toContainText('Draft');\n    await expect(page.getByTestId('draft-panel')).toContainText('Over budget');",
              "    await expect(page.locator('main')).toContainText('Draft');\n    await expect(page.getByTestId('draft-panel')).toContainText('Over budget');", 1)
open(E + r'\intake.spec.ts', 'w', encoding='utf8', newline='').write(t)
print('ok')
