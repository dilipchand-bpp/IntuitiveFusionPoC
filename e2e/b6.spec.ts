import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { apiAs, rand, signIn } from './helpers';

/** Roadmap batch B6 in the browser: reporting and collaboration. */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const scan = async (page: Page) =>
  expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations).toEqual([]);

/** A submitted request with its plan opened, by API (fast set-up). */
async function submittedRequest(title: string) {
  const req = await apiAs('requester');
  const c = await req.api.post('/api/v1/requests', {
    headers: req.headers,
    data: {
      title,
      category: 'IT managed services (UNSPSC 81111800)',
      estimatedValue: 250_000,
      termMonths: 24,
      businessUnit: 'IT',
      fields: { contractOwner: 'Sofia Rossi', background: 'The service desk contract ends in six months.' },
    },
  });
  expect(c.status(), await c.text()).toBe(201);
  const id = (await c.json()).id as string;
  expect((await req.api.post(`/api/v1/requests/${id}/submit`, { headers: req.headers })).ok()).toBeTruthy();
  const proc = await apiAs('procurement');
  const plan = await proc.api.get(`/api/v1/requests/${id}/plan`);
  return { id, planId: (await plan.json()).id as string, proc };
}

test.describe('layouts, dashboards and reports', () => {
  test('an administrator designs a layout by moving sections, and goes back to the system default', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signIn(page, 'admin');
    await page.goto('/app/collaboration');
    const d = page.getByTestId('layout-PLAN');
    await expect(d).toContainText('System default');
    const first = d.locator('li[data-section]').first();
    await expect(first).toHaveAttribute('data-section', 'background');
    await d.getByRole('button', { name: 'Move Background down' }).click();
    await expect(d.locator('li[data-section]').first()).not.toHaveAttribute('data-section', 'background');
    await d.getByLabel('Layout name').fill(`Our plan ${rand()}`);
    await d.getByRole('button', { name: 'Save layout' }).click();
    await expect(d.getByRole('status')).toContainText('Layout saved');
    await page.reload();
    await expect(page.getByTestId('layout-PLAN')).not.toContainText('System default');
    await expect(page.getByTestId('layout-PLAN').locator('li[data-section]').first()).not.toHaveAttribute(
      'data-section',
      'background',
    );
    await scan(page);
    await page.getByTestId('layout-PLAN').getByRole('button', { name: 'Use the system default' }).click();
    await expect(page.getByTestId('layout-PLAN').getByRole('status')).toContainText('system default');
    await expect(page.getByTestId('layout-PLAN').locator('li[data-section]').first()).toHaveAttribute(
      'data-section',
      'background',
    );
  });

  test('procurement moves a phase on the schedule; the later phases and the delegate calendar are recalculated', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signIn(page, 'procurement');
    await page.goto('/app/reports/schedule');
    const sched = page.getByTestId('schedule');
    await expect(sched.getByTestId('schedule-row').first()).toBeVisible();
    await page.getByText('Move a phase without dragging').click();
    await page
      .getByRole('button', { name: /^Move Evaluation of .* 7 days later$/ })
      .first()
      .click();
    await expect(page.getByRole('status').first()).toContainText('recalculated');
    await expect(page.getByTestId('delegate-calendar')).toContainText('Sign the contract');
    await scan(page);
    await signIn(page, 'delegate');
    await page.goto('/app/reports/schedule');
    await expect(page.getByTestId('schedule')).toBeVisible();
    await expect(page.getByText('Move a phase without dragging')).toHaveCount(0);
  });

  test('each role has its own dashboard, scoped and labelled', async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, 'delegate');
    await page.goto('/app/dashboards');
    await expect(page.getByRole('button', { name: 'Delegate', exact: true })).toBeVisible();
    await expect(page.getByTestId('dashboard')).toContainText('Plans awaiting your approval');
    await expect(page.getByTestId('dashboard-scope')).toBeVisible();
    await scan(page);
    await signIn(page, 'finance');
    await page.goto('/app/dashboards');
    await expect(page.getByTestId('dashboard')).toContainText('Invoices blocked');
    expect((await page.goto('/app/reports/schedule'))?.status()).toBe(403);
  });

  test('spend, savings and velocity; spend by dimension; a question in plain language, saved as a view', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await signIn(page, 'exec');
    await page.goto('/app/reports/performance');
    await expect(page.getByRole('heading', { name: /^Category spend/ })).toBeVisible();
    await expect(page.getByTestId('velocity')).toBeVisible();
    await page.getByLabel('Report spend by').selectOption('DIVISION');
    await expect(page.getByRole('table', { name: 'Spend by division' })).toBeVisible();
    await page
      .getByRole('button', { name: /^Show procurements in/ })
      .first()
      .click();
    await expect(page.getByTestId('drill')).toBeVisible();
    await scan(page);

    await page.goto('/app/reports/ask');
    await page.getByLabel('Ask for a report in plain language').fill('procurements over 100k');
    await page.getByRole('button', { name: 'Show me' }).click();
    await expect(page.getByTestId('interpretation')).toContainText('procurements');
    await expect(page.getByTestId('answer').getByRole('table')).toBeVisible();
    await page.getByLabel('Name this view').fill(`Big ones ${rand()}`);
    await page.getByRole('button', { name: 'Save view' }).click();
    await expect(page.getByTestId('saved-views').locator('li').first()).toContainText('Big ones');
    await page.getByLabel('Ask for a report in plain language').fill('what is the weather');
    await page.getByRole('button', { name: 'Show me' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'could not tell what to report on' }),
    ).toBeVisible();
    await scan(page);
  });

  test('the supplier risk map and the workload view', async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, 'procurement');
    await page.goto('/app/reports/supplier-risk');
    await expect(page.getByRole('img', { name: /Map of/ })).toBeVisible();
    await expect(page.getByTestId('single-points')).toBeVisible();
    await scan(page);
    await page.goto('/app/reports/capacity');
    await expect(page.getByTestId('capacity')).toBeVisible();
    await scan(page);
  });
});

test.describe('working on a document together', () => {
  test('the plan shows tracked changes and what changed since you looked, and keeps named versions', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const { id, planId, proc } = await submittedRequest(`B6 plan ${rand()}`);
    await signIn(page, 'requester');
    await page.goto(`/app/plans/${id}`);
    const tools = page.getByTestId('document-tools');
    await expect(tools.getByTestId('presence')).toContainText('No one else is in this document');
    await tools.getByLabel('Name this version').fill('First draft');
    await tools.getByRole('button', { name: 'Keep this version' }).click();
    await expect(tools.getByTestId('versions')).toContainText('First draft');
    await tools.getByRole('button', { name: 'Mark as seen' }).click();

    const plan = await (await proc.api.get(`/api/v1/requests/${id}/plan`)).json();
    const rev = (plan.fields as Array<{ key: string; rev: number }>).find((f) => f.key === 'objectives')!.rev;
    const put = await proc.api.put(`/api/v1/plans/${planId}/fields/objectives`, {
      headers: proc.headers,
      data: { value: 'A completely rewritten objective for this procurement.', expectedRev: rev },
    });
    expect(put.ok(), await put.text()).toBeTruthy();
    await page.reload();
    await expect(page.getByTestId('document-tools').getByTestId('digest')).toContainText('Objectives');
    await expect(page.getByTestId('document-tools').getByTestId('tracked-changes')).toContainText(
      'rewritten',
    );
    await page.getByTestId('document-tools').getByLabel('Name this version').fill('After review');
    await page.getByTestId('document-tools').getByRole('button', { name: 'Keep this version' }).click();
    await expect(page.getByTestId('versions')).toContainText('After review');
    await page
      .getByTestId('document-tools')
      .getByLabel('Compare', { exact: true })
      .selectOption({ index: 2 });
    await page.getByTestId('document-tools').getByLabel('With').selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Compare', exact: true }).click();
    await expect(page.getByTestId('comparison')).toContainText('section(s) differ');
    await scan(page);
  });

  test('a risk assessment is drafted, decided and completed; a procurement is moved on in plain language', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const { id } = await submittedRequest(`B6 risk ${rand()}`);
    await signIn(page, 'requester');
    await page.goto(`/app/requests/${id}`);
    const adv = page.getByTestId('advance-box');
    await adv.getByLabel('Say where it should go').fill('go to the next phase');
    await adv.getByRole('button', { name: 'Move on' }).click();
    await expect(adv.getByRole('alert')).toContainText('not finished');
    await adv.getByLabel('Say where it should go').fill('hmm');
    await adv.getByRole('button', { name: 'Move on' }).click();
    await expect(adv.getByRole('alert')).toContainText('Say which phase');

    const risk = page.getByTestId('risk-assessment');
    await risk.getByRole('button', { name: 'Draft a risk assessment' }).click();
    await expect(risk.getByTestId('risk-prompts')).toContainText('Decide whether');
    await expect(risk.locator('[data-risk="delivery"]')).toBeVisible();
    await risk.getByLabel('Does "Late or incomplete delivery" apply?').selectOption('no');
    await expect(risk.locator('[data-risk="delivery"]')).toContainText('Does not apply');
    await risk.getByRole('button', { name: 'Complete the assessment' }).click();
    await expect(risk.getByRole('alert')).toContainText('still need a decision');
    await scan(page);
  });

  test('a staged tender changes template from a plain-language instruction', async ({ page }) => {
    test.setTimeout(180_000);
    const { id, proc } = await submittedRequest(`B6 tender ${rand()}`);
    const t = await proc.api.post('/api/v1/tenders', {
      headers: proc.headers,
      data: { requestId: id, type: 'RFP', access: 'OPEN' },
    });
    expect(t.status(), await t.text()).toBe(201);
    const tid = (await t.json()).id as string;
    await signIn(page, 'procurement');
    await page.goto(`/app/tenders/${tid}`);
    const box = page.getByTestId('template-change');
    await box
      .getByLabel('Tell the platform which template to use')
      .fill('use the request for quotation template');
    await box.getByRole('button', { name: 'Change template' }).click();
    await expect(box.getByRole('status')).toContainText('Changed to the RFQ template');
    await box.getByLabel('Tell the platform which template to use').fill('make it something odd');
    await box.getByRole('button', { name: 'Change template' }).click();
    await expect(box.getByRole('alert')).toContainText('Name the template');
    await scan(page);
  });

  test('the reference content is regenerated into a new generation', async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, 'procurement');
    await page.goto('/app/collaboration');
    const ref = page.getByTestId('reference-content');
    await ref.getByRole('button', { name: 'Refresh now' }).click();
    await expect(ref.getByRole('status')).toContainText('Regenerated');
    await expect(ref.getByTestId('reference-generation')).toContainText('Generation');
    await expect(ref.getByRole('table', { name: 'Reference content' })).toBeVisible();
    await scan(page);
  });
});
