import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  apiAs,
  apiConsensusAndLock,
  apiDeclareNone,
  apiScoreAndSubmit,
  closedTender,
  openEvaluationApi,
  rand,
  signIn,
} from './helpers';

/** Roadmap batch B5 in the browser: contract management. */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const scan = async (page: Page) =>
  expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations).toEqual([]);

/** An executed contract, all by API (fast set-up); everything under test then happens in the browser. */
async function executedContract(title: string) {
  const { tenderId } = await closedTender(title, 2);
  const evalId = await openEvaluationApi(tenderId);
  for (const u of ['evaluator-tech', 'evaluator-comm', 'chair']) await apiDeclareNone(u, evalId);
  for (const u of ['evaluator-tech', 'evaluator-comm', 'chair']) await apiScoreAndSubmit(u, evalId);
  await apiConsensusAndLock(evalId);
  const proc = await apiAs('procurement');
  const rep = await proc.api.post(`/api/v1/evaluations/${evalId}/report`, { headers: proc.headers });
  const reportId = (await rep.json()).report.id as string;
  const del = await apiAs('delegate');
  expect(
    (
      await del.api.post(`/api/v1/evaluation-reports/${reportId}/decision`, {
        headers: del.headers,
        data: { decision: 'APPROVE' },
      })
    ).ok(),
  ).toBeTruthy();
  const legal = await apiAs('legal');
  const awards = (await (await legal.api.get('/api/v1/contracts/awards')).json()) as Array<{
    evaluationId: string;
    title: string;
    recommended: Array<{ supplierId: string }>;
  }>;
  const award = awards.find((a) => a.title === title)!;
  const made = await legal.api.post('/api/v1/contracts', {
    headers: legal.headers,
    data: { evaluationId: award.evaluationId, supplierId: award.recommended[0]!.supplierId },
  });
  expect(made.status(), await made.text()).toBe(201);
  const id = (await made.json()).id as string;
  expect(
    (await legal.api.post(`/api/v1/contracts/${id}/release-for-signing`, { headers: legal.headers })).ok(),
  ).toBeTruthy();
  const sign = await del.api.post(`/api/v1/contracts/${id}/sign`, {
    headers: del.headers,
    data: { decision: 'APPROVE' },
  });
  expect(sign.ok(), await sign.text()).toBeTruthy();
  const view = await sign.json();
  return { id, number: view.number as string, endDate: view.endDate as string };
}
const today = () => new Date().toISOString().slice(0, 10);

test.describe.configure({ mode: 'serial' });

test.describe('managing an executed contract', () => {
  let c: { id: string; number: string; endDate: string };
  test.beforeAll(async () => {
    test.setTimeout(300_000);
    c = await executedContract(`B5 contract ${rand()}`);
  });

  test('the contract manager sets the rate card; finance raises an order and an invoice that raises the price is blocked, then released and paid', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await signIn(page, 'contract-mgr');
    await page.goto(`/app/contracts/${c.id}`);
    const mgmt = page.getByTestId('contract-management');
    await expect(mgmt).toBeVisible();
    await mgmt.getByRole('tab', { name: 'Rates, escalation and rebates' }).click();
    const terms = page.getByTestId('mgmt-terms');
    await terms.getByRole('button', { name: 'Add a rate' }).click();
    await terms.getByLabel('Rate item 1').fill('Cleaning hour');
    await terms.getByLabel('Unit 1').fill('hour');
    await terms.getByLabel('Contracted price 1').fill('50');
    await terms.getByRole('button', { name: 'Save rate card' }).click();
    await expect(terms.getByRole('status')).toContainText('Rate card saved');
    await terms.getByRole('button', { name: 'Add an escalation' }).click();
    await terms.getByLabel('Takes effect 1').fill(`${Number(today().slice(0, 4)) + 1}-07-01`);
    await terms.getByLabel('Increase % 1').fill('4');
    await terms.getByRole('button', { name: 'Save escalation' }).click();
    await expect(terms.getByRole('status')).toContainText('Escalation clauses saved');
    await scan(page);

    await signIn(page, 'finance');
    await page.goto(`/app/contracts/${c.id}`);
    await page.getByRole('tab', { name: 'Spend and invoices' }).click();
    const spend = page.getByTestId('mgmt-spend');
    const po = spend.getByRole('form', { name: 'Raise a purchase order' });
    await po.getByLabel('What the order is for').fill('Cleaning for the quarter');
    await po.getByLabel('Item 1').fill('Cleaning hour');
    await po.getByLabel('Quantity 1').fill('100');
    await po.getByLabel('Unit price 1').fill('50');
    await po.getByRole('button', { name: 'Raise purchase order' }).click();
    await expect(spend.getByRole('status').first()).toContainText('Purchase order raised');
    await expect(spend.getByRole('table', { name: 'Purchase orders' })).toContainText('Approved');

    const inv = spend.getByRole('form', { name: 'Record an invoice' });
    await inv.getByLabel('Invoice date').fill(today());
    await inv.getByLabel('Purchase order').selectOption({ index: 1 });
    await inv.getByLabel('Item 1').fill('Cleaning hour');
    await inv.getByLabel('Quantity 1').fill('20');
    await inv.getByLabel('Unit price 1').fill('50');
    await inv.getByRole('button', { name: 'Record invoice' }).click();
    await expect(spend.getByTestId('invoices').locator('[data-invoice-status="MATCHED"]')).toHaveCount(1);
    await inv.getByLabel('Invoice date').fill(today());
    await inv.getByLabel('Item 1').fill('Cleaning hour');
    await inv.getByLabel('Quantity 1').fill('20');
    await inv.getByLabel('Unit price 1').fill('55');
    await inv.getByRole('button', { name: 'Record invoice' }).click();
    const blocked = spend.getByTestId('invoices').locator('[data-invoice-status="BLOCKED"]');
    await expect(blocked).toHaveCount(1);
    await expect(blocked).toContainText('escalation clause allows');
    await expect(spend.getByRole('progressbar', { name: /^Spend:/ })).toBeVisible();
    await expect(spend.getByRole('progressbar', { name: /^Term:/ })).toBeVisible();
    await scan(page);

    await page.goto('/app/contracts/invoices');
    await page.getByRole('button', { name: 'Blocked', exact: true }).click();
    const row = page.getByTestId('invoice-queue').locator('[data-invoice-status="BLOCKED"]').first();
    await expect(row).toContainText('escalation clause allows');
    await row.getByLabel(/^Reason for releasing/).fill('The supplier agreed this rise in writing last week');
    await row.getByRole('button', { name: /^Release / }).click();
    await expect(page.getByRole('status').first()).toContainText('recorded exception');
    await page.getByRole('button', { name: 'All', exact: true }).click();
    const released = page.getByTestId('invoice-queue').locator('[data-invoice-status="EXCEPTION"]').first();
    await released.getByRole('button', { name: /^Pay / }).click();
    await expect(page.getByTestId('invoice-queue').locator('[data-invoice-status="PAID"]')).toHaveCount(1);
    await scan(page);
  });

  test('a renewal gets its own procurement number, linked to the contract and shown in the pipeline', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await signIn(page, 'contract-mgr');
    await page.goto(`/app/contracts/${c.id}`);
    const o = page.getByTestId('mgmt-overview');
    await expect(o.getByTestId('variation-count')).toHaveText('0');
    await expect(o.getByTestId('extensions-used')).toContainText('0 of 1');
    await expect(o.getByTestId('cumulative-value')).toContainText('$');
    await o.getByLabel('What for').selectOption('RENEW');
    await o.getByLabel('Why').fill('Renew for a further three years');
    await o.getByRole('button', { name: 'Start linked procurement' }).click();
    await expect(o.getByRole('status')).toContainText('new procurement number');
    await expect(o.getByTestId('linked-procurements')).toContainText('Renewal');
    await scan(page);

    await signIn(page, 'procurement');
    await page.goto('/app/requests?layout=KANBAN');
    const board = page.getByTestId('board');
    await expect(board).toContainText('Contract management');
    await expect(board).toContainText(`Renewal of ${c.number}`);
  });

  test("plans and activities are generated from the contract, completed, and built from the customer's own template", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await signIn(page, 'contract-mgr');
    await page.goto(`/app/contracts/${c.id}`);
    await page.getByRole('tab', { name: 'Plans and activities' }).click();
    const plans = page.getByTestId('mgmt-plans');
    await plans.getByRole('button', { name: 'Generate plans' }).click();
    await expect(plans.getByText('Management tier:')).toBeVisible();
    await expect(plans.getByRole('table', { name: 'Contract management activities' })).toBeVisible();
    await plans.getByText('Contract management plan').first().click();
    await expect(plans).toContainText('Purpose and scope');
    await plans
      .getByRole('button', { name: /^Mark done:/ })
      .first()
      .click();
    await expect(plans.getByText(/^Done /).first()).toBeVisible();

    await plans.getByLabel('Template name').fill('Meridian plan');
    await plans
      .getByLabel('Template text')
      .fill('## Our approach\nWe manage {{CONTRACT}} with {{SUPPLIER}}.\n\n## Rhythm\nMonthly check-ins.');
    await plans.getByRole('button', { name: 'Save template' }).click();
    await expect(plans.getByRole('status')).toContainText('Template saved');
    await plans.getByRole('button', { name: 'Generate again' }).click();
    await expect(plans).toContainText('your template');
    await plans.getByText('Contract management plan').first().click();
    await expect(plans).toContainText(`We manage ${c.number}`);
    await scan(page);
    // go back to the standard template so nothing else is affected
    const { api, headers } = await apiAs('contract-mgr');
    await api.delete('/api/v1/contract-plan-templates/CMP', { headers });
  });

  test('alerts can be found in the clause wording, and the fixed alerts cannot be muted', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await signIn(page, 'contract-mgr');
    await page.goto(`/app/contracts/${c.id}`);
    await page.getByRole('tab', { name: 'Alerts from the wording' }).click();
    const t = page.getByTestId('mgmt-triggers');
    await t.getByRole('button', { name: 'Find alerts in the clauses' }).click();
    await expect(t.getByRole('form', { name: 'Alerts found in the clauses' })).toContainText('days of');
    await t.getByRole('button', { name: 'Schedule the chosen alerts' }).click();
    await expect(t.getByRole('status')).toContainText('scheduled');
    await expect(t).toContainText('Scheduled');

    // a custom alert by SMS and Slack, assigned to someone else
    const card = page.getByTestId('management-card');
    await card.getByRole('textbox', { name: 'Add your own alert' }).fill('alert me 3 months before expiry');
    await card.getByLabel('in-app').uncheck();
    await card.getByLabel('SMS (simulated)').check();
    await card.getByLabel('Slack (simulated)').check();
    await card.getByRole('button', { name: 'Add alert' }).click();
    await expect(card.getByRole('status')).toContainText('Alert created');
    await scan(page);

    await page.goto('/app/contracts/alerts');
    const prefs = page.getByTestId('alert-preferences');
    await expect(prefs.getByTestId('fixed-alerts')).toContainText('180, 90, 60 days before expiry');
    await expect(prefs.getByTestId('fixed-alerts')).toContainText(
      '30 days before a compliance certificate expires',
    );
    await expect(prefs).toContainText('cannot be muted');
    await prefs.getByLabel('Contract expiry').uncheck();
    await expect(prefs.getByRole('status')).toContainText('saved');
    await page.reload();
    await expect(page.getByTestId('alert-preferences').getByLabel('Contract expiry')).not.toBeChecked();
    await page.getByTestId('alert-preferences').getByLabel('Contract expiry').check(); // restore
    await expect(page.getByTestId('alert-preferences').getByRole('status')).toContainText('saved');
    await scan(page);
  });

  test('my contracts shows what belongs to the contract manager, with the rule-based suggestions labelled as such', async ({
    page,
  }) => {
    await signIn(page, 'contract-mgr');
    await page.goto('/app/contracts/mine');
    await expect(page.getByRole('heading', { name: 'My contracts' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Your contracts' })).toContainText(c.number);
    await expect(page.getByText('stand-in for an AI model')).toBeVisible();
    await page.getByLabel('Search by number, title or supplier').fill(c.number);
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByRole('table', { name: 'Your contracts' })).toContainText(c.number);
    await scan(page);
  });

  test('a variation shows its business case and variance, and a public-sector change over the threshold becomes a disclosure task', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const admin = await apiAs('admin');
    const cur = (await (await admin.api.get('/api/v1/admin/settings')).json()) as {
      contractManagement: Record<string, unknown>;
    };
    const put = (over: Record<string, unknown>) =>
      admin.api.put('/api/v1/admin/settings', {
        headers: admin.headers,
        data: { contractManagement: { ...cur.contractManagement, ...over } },
      });
    expect((await put({ publicSectorDisclosure: true, disclosureThresholdPct: 1 })).ok()).toBeTruthy();
    const legal = await apiAs('legal');
    const v = await legal.api.post(`/api/v1/contracts/${c.id}/variations`, {
      headers: legal.headers,
      data: { reason: 'Additional scope agreed for the new wing of the building', value: 5000 },
    });
    expect(v.status(), await v.text()).toBe(201);
    const vid = (await v.json()).id as string;
    const vnum = (await v.json()).number as string;
    await put({ publicSectorDisclosure: false, disclosureThresholdPct: 10 });

    await signIn(page, 'legal');
    await page.goto(`/app/contracts/${vid}`);
    const info = page.getByTestId('variation-info');
    await expect(info).toContainText('Additional scope agreed');
    await expect(info.getByTestId('variance-pct')).toContainText('%');
    await expect(info.getByTestId('disclosure-note')).toContainText('AusTender');
    await scan(page);

    await signIn(page, 'procurement');
    await page.goto('/app/contracts/disclosures');
    const task = page.getByTestId('disclosure-tasks').locator('li', { hasText: vnum });
    await task.getByLabel(/^Register reference for/).fill('AusTender CN-2026-0099');
    await task.getByRole('button', { name: /^Record disclosure for/ }).click();
    await expect(page.getByRole('status').first()).toContainText('Disclosure recorded');
    await expect(task).toContainText('Disclosed');
    await scan(page);
  });
});

test.describe('funding envelopes and the settings', () => {
  test('a delegate approves an envelope, a nominated person commits against it and sees the warning as it runs out', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const name = `Facilities programme ${rand()}`;
    await signIn(page, 'delegate');
    await page.goto('/app/envelopes');
    const form = page.getByRole('form', { name: 'Approve a funding envelope' });
    await form.getByLabel('Envelope name').fill(name);
    await form.getByLabel('Amount (AUD)').fill('100000');
    await form.getByLabel('Priya Nair').check();
    await form.getByRole('button', { name: 'Approve envelope' }).click();
    const card = page.getByTestId(`envelope-${name}`);
    await expect(card).toContainText('$100,000');
    await expect(card).toContainText('Nominated: Priya Nair');
    await scan(page);

    await signIn(page, 'procurement');
    await page.goto('/app/envelopes');
    const mine = page.getByTestId(`envelope-${name}`);
    const commit = mine.getByRole('form', { name: `Approve a commitment from ${name}` });
    await commit.getByLabel(`Commitment for ${name}`).fill('Security guard services');
    await commit.getByLabel(`Amount for ${name}`).fill('85000');
    await commit.getByRole('button', { name: 'Approve commitment' }).click();
    await expect(page.getByTestId('envelope-warning')).toContainText('Seek further delegate approval');
    await expect(mine).toContainText('Seek further approval');
    await commit.getByLabel(`Commitment for ${name}`).fill('Too much');
    await commit.getByLabel(`Amount for ${name}`).fill('20000');
    await commit.getByRole('button', { name: 'Approve commitment' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'ask Dana Okafor for further approval' }),
    ).toBeVisible();
    await scan(page);

    // the delegate was told, and adds to the envelope
    await signIn(page, 'delegate');
    await page.goto('/app/envelopes');
    await page.getByTestId(`envelope-${name}`).getByLabel(`Add to ${name} (AUD)`).fill('100000');
    await page.getByTestId(`envelope-${name}`).getByRole('button', { name: 'Add funds' }).click();
    await expect(page.getByTestId(`envelope-${name}`)).toContainText('$200,000');
  });

  test('the administrator sets contract management rules', async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, 'admin');
    await page.goto('/admin/settings');
    const s = page.getByTestId('settings-contractManagement');
    await expect(s).toBeVisible();
    await s.getByLabel('Spend alert at (% of contract value)').fill('75');
    await s.getByRole('button', { name: 'Save contract management' }).click();
    await expect(s.getByRole('status')).toBeVisible();
    await page.reload();
    await expect(
      page.getByTestId('settings-contractManagement').getByLabel('Spend alert at (% of contract value)'),
    ).toHaveValue('75');
    await page
      .getByTestId('settings-contractManagement')
      .getByLabel('Spend alert at (% of contract value)')
      .fill('70');
    await page.getByRole('button', { name: 'Save contract management' }).click();
    await expect(page.getByTestId('settings-contractManagement').getByRole('status')).toBeVisible();
    await scan(page);
  });
});
