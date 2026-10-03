
// ---------------------------------------------------------------- M13: administration
test.describe('administration: users and roles, workflows, templates, and no path to bids', () => {
  test('the administrator adds a person, who activates and signs in; roles are exclusive for the administrator; switching someone off ends their access', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await signIn(page, 'admin');
    await page.goto('/admin');
    await expect(page.getByRole('list', { name: 'Administration areas' })).toContainText('Users and roles');
    await page.goto('/admin/users');
    const email = `starter.${rand()}@meridian-demo.example`;
    await page.getByRole('button', { name: 'Add a person' }).click();
    await page.getByRole('textbox', { name: /^Name/ }).fill('Quinn Starter');
    await page.getByRole('textbox', { name: /Work email/ }).fill(email);
    // administrator is exclusive: choosing it clears the others, choosing another clears it
    await page.getByLabel('Administrator (new person)').check();
    await expect(page.getByLabel('Requester (new person)')).not.toBeChecked();
    await page.getByLabel('Finance (new person)').check();
    await expect(page.getByLabel('Administrator (new person)')).not.toBeChecked();
    await page.getByRole('button', { name: 'Add person' }).click();
    const link = await page.getByLabel('Activation link').inputValue();
    expect(link).toMatch(/\/activate\?token=/);
    await page.getByRole('button', { name: 'Done' }).click();
    const row = page.getByTestId('user-row').filter({ hasText: email });
    await expect(row).toContainText('Finance');
    await expect(row).toContainText('Waiting to activate');
    const scan = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(scan.violations).toEqual([]);

    // the new person activates and signs in with exactly that role
    await page.context().clearCookies();
    await page.goto(link);
    await expect(page.getByText(/has created an account for you/)).toBeVisible();
    await page.getByLabel(/Choose a password/).fill('Starter-Passw0rd-123');
    await page.getByRole('button', { name: 'Activate account' }).click();
    await expect(page.getByTestId('activated')).toBeVisible();
    await page.goto('/login');
    await page.getByLabel(/Email/).fill(email);
    await page.getByLabel(/Password/).fill('Starter-Passw0rd-123');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByTestId('shell')).toBeVisible();
    expect((await page.goto('/admin'))?.status()).toBe(403);
    expect((await page.goto('/app/reports'))?.status()).toBe(200);

    // the administrator changes the role and switches the person off
    await signIn(page, 'admin');
    await page.goto('/admin/users');
    await page.getByRole('button', { name: 'Edit Quinn Starter' }).click();
    await page.getByLabel('Finance (Quinn Starter)').uncheck();
    await page.getByLabel('Legal (Quinn Starter)').check();
    await page.getByLabel('Can sign in').uncheck();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByTestId('users-note')).toContainText('Quinn Starter was updated');
    const updated = page.getByTestId('user-row').filter({ hasText: email });
    await expect(updated).toContainText('Legal');
    await expect(updated).toContainText('Switched off');
    await page.context().clearCookies();
    await page.goto('/login');
    await page.getByLabel(/Email/).fill(email);
    await page.getByLabel(/Password/).fill('Starter-Passw0rd-123');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/login/);

    // an administrator cannot change their own roles
    await signIn(page, 'admin');
    await page.goto('/admin/users');
    await page.getByRole('button', { name: 'Edit Noah Kim' }).click();
    await expect(page.getByText('You cannot change your own roles')).toBeVisible();
    await expect(page.getByLabel('Executive (Noah Kim)')).toHaveCount(0);
  });

  test('the simple workflow can be edited but keeps its approval checkpoint; the others say coming soon', async ({
    page,
  }) => {
    await signIn(page, 'admin');
    await page.goto('/admin/workflows');
    await expect(page.getByTestId('workflow-wf-intermediate')).toContainText('Editing coming soon');
    await expect(page.getByTestId('workflow-wf-complex')).toContainText('Editing coming soon');
    await page.getByRole('button', { name: 'Edit Simple purchase' }).click();
    // dropping the mandatory approval is refused with the reason
    await page.getByRole('button', { name: 'Remove step 2' }).click();
    await page.getByRole('button', { name: 'Save workflow' }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('cannot be removed or made optional');
    // adding a step is accepted
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Edit Simple purchase' }).click();
    await page.getByRole('button', { name: 'Add a step' }).click();
    await page.getByRole('textbox', { name: 'Step 4' }).fill('Receipt');
    await page.getByRole('checkbox', { name: 'Step 4 is mandatory' }).uncheck();
    await page.getByRole('button', { name: 'Save workflow' }).click();
    await expect(page.getByTestId('workflow-note')).toContainText('was saved');
    const card = page.getByTestId('workflow-wf-simple');
    await expect(card).toContainText('4. Receipt');
    await expect(card).toContainText('Optional');
    const scan = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(scan.violations).toEqual([]);
    // the admin pages are for administrators only
    await signIn(page, 'procurement');
    expect((await page.goto('/admin/workflows'))?.status()).toBe(403);
  });

  test('the template library lists templates by type with their clauses, and creating one is coming soon', async ({
    page,
  }) => {
    await signIn(page, 'admin');
    await page.goto('/admin/templates');
    await expect(page.getByRole('heading', { name: 'Contract templates' })).toBeVisible();
    const t = page.getByTestId('template-tpl-services-std');
    await expect(t).toContainText('Version 1.0');
    await t.getByText(/clauses \(\d+ mandatory\)/).click();
    await expect(t).toContainText('Liability and insurance');
    await expect(page.getByRole('button', { name: /Create a template/ })).toBeDisabled();
    await expect(page.getByText('Coming soon').first()).toBeVisible();
    const scan = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(scan.violations).toEqual([]);
    await page.setViewportSize({ width: 375, height: 812 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('an administrator is refused every bid screen and the refusal is in the audit trail', async ({ page }) => {
    await signIn(page, 'chair');
    await page.goto('/app/evaluations');
    await page
      .getByRole('table', { name: 'Evaluations' })
      .getByRole('link', { name: 'Facilities cleaning services' })
      .click();
    const evalUrl = page.url();
    await signIn(page, 'admin');
    expect((await page.goto(evalUrl))?.status()).toBe(403);
    expect((await page.goto('/app/evaluations'))?.status()).toBe(403);
    expect((await page.goto('/supplier'))?.status()).toBe(403);
    const evalId = evalUrl.split('/').pop()!;
    const { api, headers } = await apiAs('admin');
    const file = await api.get(`/api/v1/evaluations/${evalId}/suppliers/${evalId}/files/${evalId}`, { headers });
    expect(file.status()).toBe(403);
    await api.dispose();
    await signIn(page, 'probity');
    await page.goto('/app/audit?action=access.denied');
    await expect(page.getByTestId('audit-row').first()).toContainText('access.denied');
    await expect(page.getByTestId('audit-row').first()).toContainText('ADMIN');
  });
});
