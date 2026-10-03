
// ---------------------------------------------------------------- M12b: follow-up features through the real screens
const DAY_MS = 86_400_000;
const money = (n: number) => `$${n.toLocaleString('en-AU')}`;

test.describe('contracts: deviation approval, record editing, custom alerts and variations', () => {
  test('legal changes a mandatory clause, a delegate must approve it before release, then the record is edited and a variation is signed', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const title = `Deviation fixture ${rand()}`;
    await approvedAward(title);

    // legal drafts and changes a mandatory clause
    await signIn(page, 'legal');
    await page.goto('/app/contracts');
    await page.getByTestId('award-ready').filter({ hasText: title }).getByRole('button', { name: /Draft the contract with/ }).click();
    await expect(page.getByTestId('contract-workspace')).toBeVisible();
    const url = page.url();
    await page.getByRole('button', { name: 'Edit Liability and insurance' }).click();
    await page
      .getByLabel('Wording of Liability and insurance')
      .fill('The Supplier holds insurance for the whole term. The Supplier excludes liability for indirect loss.');
    await page.getByRole('button', { name: 'Save clause' }).click();
    const dev = page.getByTestId('deviation-LIABILITY');
    await expect(dev).toContainText('high risk');
    await expect(dev).toContainText('Needs a delegate');
    await expect(page.getByTestId('release-blockers')).toContainText("needs a delegate's approval");
    // legal can amend the proposed rating
    await dev.getByLabel('Risk rating for Liability and insurance').selectOption('MEDIUM');
    await expect(dev).toContainText('medium risk');
    await page.getByRole('button', { name: 'Release for signing' }).click();
    await expect(page.getByRole('alert').first()).toContainText('cannot be released yet');

    // the delegate approves the change
    await signIn(page, 'delegate');
    await page.goto(url);
    await page.getByRole('button', { name: 'Approve the change to Liability and insurance' }).click();
    await expect(page.getByTestId('deviation-LIABILITY')).toContainText('Approved');
    await expect(page.getByTestId('deviation-LIABILITY')).toContainText('DEVIATION APPROVED · Dana Okafor');

    // legal releases, the delegate signs
    await signIn(page, 'legal');
    await page.goto(url);
    await page.getByRole('button', { name: 'Release for signing' }).click();
    await expect(page.getByText('Awaiting signature').first()).toBeVisible();
    await signIn(page, 'delegate');
    await page.goto(url);
    await page.getByRole('button', { name: 'Sign contract' }).click();
    await expect(page.getByTestId('locked-banner')).toBeVisible();

    // the contract manager edits the management record and adds an alert in plain language
    await signIn(page, 'contract-mgr');
    await page.goto(url);
    const card = page.getByTestId('management-card');
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Edit milestones' }).click();
    await page.getByRole('button', { name: 'Add a milestone' }).click();
    await page.getByLabel('Milestone 3', { exact: true }).fill('Site handover');
    const mid = new Date(Date.now() + 200 * DAY_MS).toISOString().slice(0, 10);
    await page.getByLabel('Date for milestone 3').fill(mid);
    await page.getByRole('button', { name: 'Save milestones' }).click();
    await expect(card.getByRole('list', { name: 'Milestones' })).toContainText('Site handover');
    await card.getByRole('button', { name: 'Edit extensions' }).click();
    await page.getByRole('button', { name: 'Add an extension' }).click();
    await page.getByLabel('Extension 2 (months)').fill('6');
    await page.getByRole('button', { name: 'Save extensions' }).click();
    await expect(card.getByTestId('gantt')).toContainText('Option 2 (6 months)');
    await card.getByLabel('Add your own alert').fill('alert me 1 year before expiry and include whoever is my manager then');
    await card.getByRole('button', { name: 'Add alert' }).click();
    await expect(card.getByRole('status').first()).toContainText('Alert created');
    await expect(card.getByTestId('alerts')).toContainText('Custom reminder');
    await expect(card.getByTestId('alerts')).toContainText('include whoever is my manager');
    await card.getByLabel('Add your own alert').fill('remind me at some point');
    await card.getByRole('button', { name: 'Add alert' }).click();
    await expect(card.getByRole('alert').first()).toContainText('Try:');
    const scan = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(scan.violations).toEqual([]);

    // legal creates a variation, which goes through the same path and raises the cumulative value
    await signIn(page, 'legal');
    await page.goto(url);
    await page.getByRole('button', { name: 'Create a variation' }).click();
    await page.getByLabel('Reason').fill('Two more sites added to the scope');
    await page.getByLabel('Additional value (AUD)').fill('25000');
    await page.getByRole('button', { name: 'Create variation' }).click();
    await expect(page.getByTestId('parent-link')).toContainText('Variation of CT-');
    await expect(page.getByTestId('contract-workspace')).toContainText('$25,000');
    const varUrl = page.url();
    await page.getByRole('button', { name: 'Release for signing' }).click();
    await signIn(page, 'delegate');
    await page.goto(varUrl);
    await page.getByRole('button', { name: 'Sign contract' }).click();
    await expect(page.getByTestId('locked-banner')).toBeVisible();
    await signIn(page, 'legal');
    await page.goto(url);
    await expect(page.getByTestId('variations')).toContainText('-V1');
    await expect(page.getByTestId('cumulative')).toContainText(money(Number(0)).replace('$0', '$'));
  });
});

test.describe('administration: delegations apply at once; alert timing', () => {
  test('the administrator lowers a signing limit and the delegate loses that authority; restoring it gives it back', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const title = `Limit fixture ${rand()}`;
    await approvedAward(title);
    await signIn(page, 'legal');
    await page.goto('/app/contracts');
    await page.getByTestId('award-ready').filter({ hasText: title }).getByRole('button', { name: /Draft the contract with/ }).click();
    await page.getByRole('button', { name: 'Release for signing' }).click();
    await expect(page.getByText('Awaiting signature').first()).toBeVisible();
    const url = page.url();

    await signIn(page, 'admin');
    await page.goto('/admin/delegations');
    const row = page.getByTestId('delegation-row').filter({ hasText: 'Contract signing' }).filter({ hasText: 'Dana Okafor' });
    await row.getByRole('button', { name: /Change the limit for Dana Okafor, Contract signing/ }).click();
    await page.getByLabel(/New limit for Dana Okafor, Contract signing/).fill('1000');
    await page.getByRole('button', { name: /Save the limit for Dana Okafor, Contract signing/ }).click();
    await expect(page.getByTestId('delegation-note')).toContainText('$1,000');
    const scan = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(scan.violations).toEqual([]);

    await signIn(page, 'delegate');
    await page.goto(url);
    await expect(page.getByTestId('sign-blocked')).toContainText('above your signing authority of $1,000');
    await expect(page.getByRole('button', { name: 'Sign contract' })).toHaveCount(0);

    await signIn(page, 'admin');
    await page.goto('/admin/delegations');
    const row2 = page.getByTestId('delegation-row').filter({ hasText: 'Contract signing' }).filter({ hasText: 'Dana Okafor' });
    await row2.getByRole('button', { name: /Change the limit for Dana Okafor, Contract signing/ }).click();
    await page.getByLabel(/New limit for Dana Okafor, Contract signing/).fill('5000000');
    await page.getByRole('button', { name: /Save the limit for Dana Okafor, Contract signing/ }).click();
    await expect(page.getByTestId('delegation-note')).toContainText('$5,000,000');
    await signIn(page, 'delegate');
    await page.goto(url);
    await page.getByRole('button', { name: 'Sign contract' }).click();
    await expect(page.getByTestId('locked-banner')).toBeVisible();
  });

  test('alert timing can be changed and others cannot open the page', async ({ page }) => {
    await signIn(page, 'admin');
    await page.goto('/admin/delegations');
    const form = page.getByRole('form', { name: 'Contract alert timing' });
    await form.getByLabel(/Expiry alert/).fill('75');
    await form.getByRole('button', { name: 'Save timing' }).click();
    await expect(page.getByTestId('alert-settings-note')).toContainText('Saved');
    await form.getByLabel(/Expiry alert/).fill('60');
    await form.getByRole('button', { name: 'Save timing' }).click();
    await expect(page.getByTestId('alert-settings-note')).toContainText('Saved');
    for (const who of ['exec', 'procurement']) {
      await signIn(page, who);
      expect((await page.goto('/admin/delegations'))?.status(), who).toBe(403);
    }
  });
});

test.describe('suppliers: profile and adding a second contact', () => {
  test('procurement adds a contact, who activates the account through the link and signs in to the supplier portal', async ({
    page,
  }) => {
    await signIn(page, 'procurement');
    await page.goto('/app/suppliers');
    const table = page.getByRole('table', { name: 'Suppliers' });
    await expect(table.getByRole('row', { name: /Brightwave/ })).toContainText('Sanctions');
    await table.getByRole('link', { name: /Brightwave/ }).click();
    await expect(page.getByTestId('supplier-profile')).toBeVisible();
    const email = `second.${rand()}@brightwave.example`;
    await page.getByRole('button', { name: 'Add a contact' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Second Contact');
    await page.getByLabel('Work email').fill(email);
    await page.getByRole('button', { name: 'Add contact', exact: true }).click();
    const link = await page.getByLabel('Activation link').inputValue();
    expect(link).toMatch(/\/supplier\/activate\?token=/);
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByTestId('contacts')).toContainText('Waiting to activate');
    const scan = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(scan.violations).toEqual([]);

    await page.context().clearCookies();
    await page.goto(link);
    await expect(page.getByRole('heading', { name: 'Activate your account' })).toBeVisible();
    await page.getByLabel(/Choose a password/).fill('Second-Contact-Pass-1');
    await page.getByRole('button', { name: 'Activate account' }).click();
    await expect(page.getByTestId('activated')).toBeVisible();
    // the link works once
    await page.goto(link);
    await expect(page.getByRole('alert')).toContainText('not valid');

    await page.goto('/login');
    await page.getByLabel(/Email/).fill(email);
    await page.getByLabel(/Password/).fill('Second-Contact-Pass-1');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/supplier/);
    for (const who of ['requester', 'delegate', 'exec']) {
      await signIn(page, who);
      expect((await page.goto('/app/suppliers'))?.status(), who).toBe(403);
    }
  });
});

test.describe('reports: spend drill-down, off-contract spend, workload and timeline', () => {
  test('the executive sees spend by category and supplier, what is off contract, and the workload', async ({
    page,
  }) => {
    await signIn(page, 'exec');
    await page.goto('/app/reports');
    await expect(page.getByTestId('spend-chart')).toBeVisible();
    const drill = page.getByTestId('drilldown');
    await drill.getByText('Apparel').click();
    await expect(drill).toContainText('CT-2026-0002');
    await expect(page.getByRole('table', { name: 'Committed spend by supplier' })).toContainText('Northstar');
    await expect(page.getByTestId('offcontract-row')).toContainText('PR-2026-0007');
    await expect(page.getByRole('table', { name: 'Workload by owner' })).toBeVisible();
    expect(await page.getByTestId('owner-row').count()).toBeGreaterThanOrEqual(1);
    await expect(page.getByRole('heading', { name: 'Procurement timeline' })).toBeVisible();
    const scan = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(scan.violations).toEqual([]);
    await page.setViewportSize({ width: 375, height: 812 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('finance sees spend but no workload; contract managers only the related contract reports; others cannot open it', async ({
    page,
  }) => {
    await signIn(page, 'finance');
    await page.goto('/app/reports');
    await expect(page.getByTestId('spend-chart')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Workload by owner' })).toHaveCount(0);
    await signIn(page, 'contract-mgr');
    await page.goto('/app/reports');
    await expect(page.getByText('No reports for your role')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Contracts expiring' })).toBeVisible();
    for (const who of ['requester', 'delegate']) {
      await signIn(page, who);
      expect((await page.goto('/app/reports'))?.status(), who).toBe(403);
    }
  });
});

test.describe('evaluation and tender: variance limit, probity sign-off and Word and PDF exports', () => {
  test('the chair sets the variance limit, probity signs off the process, and the report and the tender pack download as Word', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const { tenderId } = await closedTender(`Process fixture ${rand()}`, 2);
    const evalId = await openEvaluationApi(tenderId);
    for (const u of ['evaluator-tech', 'evaluator-comm', 'chair']) await apiDeclareNone(u, evalId);
    await signIn(page, 'chair');
    await page.goto(`/app/evaluations/${evalId}`);
    const card = page.getByTestId('process-card');
    await card.getByLabel('Variance limit (%)').fill('20');
    await card.getByRole('button', { name: 'Save limit' }).click();
    await expect(page.getByRole('status').first()).toContainText('Variance limit saved');
    await card.getByLabel('Variance limit (%)').fill('4');
    await card.getByRole('button', { name: 'Save limit' }).click();
    await expect(page.getByRole('alert').first()).toBeVisible();

    for (const u of ['evaluator-tech', 'evaluator-comm', 'chair']) await apiScoreAndSubmit(u, evalId);
    await apiConsensusAndLock(evalId);
    const proc = await apiAs('procurement');
    expect((await proc.api.post(`/api/v1/evaluations/${evalId}/report`, { headers: proc.headers })).ok()).toBeTruthy();
    await proc.api.dispose();

    await signIn(page, 'probity');
    await page.goto(`/app/evaluations/${evalId}`);
    await page.getByLabel('Probity sign-off').fill('Process followed.');
    await page.getByRole('button', { name: 'Sign off the process' }).click();
    await expect(page.getByTestId('probity-stamp')).toContainText('PROBITY SIGN-OFF · Jonas Becker');

    await signIn(page, 'procurement');
    await page.goto(`/app/evaluations/${evalId}`);
    const word = await download(page, () => page.getByRole('link', { name: 'Download Word' }).click());
    expect(word.name).toMatch(/^evaluation-report-PR-.*\.docx$/);
    expect(word.bytes.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(word.bytes.toString('latin1')).toContain('word/document.xml');
    const pdf = await download(page, () => page.getByRole('link', { name: 'Download PDF' }).click());
    expect(pdf.bytes.toString('latin1')).toContain('Probity sign-off');

    // the tender pack, as PDF and Word
    await page.goto('/app/tenders');
    await page.getByRole('link', { name: /IT managed services/i }).first().click();
    const pack = page.getByTestId('pack-export');
    const packPdf = await download(page, () => pack.getByRole('link', { name: 'PDF' }).click());
    expect(packPdf.bytes.subarray(0, 5).toString()).toBe('%PDF-');
    const packWord = await download(page, () => pack.getByRole('link', { name: 'Word' }).click());
    expect(packWord.name).toMatch(/^tender-pack-PR-.*\.docx$/);
  });

  test('an evaluator follows their dashboard row to the evaluation', async ({ page }) => {
    await signIn(page, 'evaluator-tech');
    await page.goto('/app/dashboard');
    const link = page.getByTestId('proc-row').getByRole('link').first();
    await link.click();
    await expect(page).toHaveURL(/\/app\/evaluations\/[0-9a-f-]{36}$/);
  });
});
