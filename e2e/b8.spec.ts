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

/** Roadmap batch B8 in the browser: tender, contract and supplier intelligence. */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const scan = async (page: Page) =>
  expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations).toEqual([]);

/** A submitted request whose plan is awaiting approval, by API (fast set-up). */
async function planAwaitingApproval(title: string) {
  const req = await apiAs('requester');
  const c = await req.api.post('/api/v1/requests', {
    headers: req.headers,
    data: {
      title,
      category: 'Building cleaning (UNSPSC 76111500)',
      estimatedValue: 80_000,
      termMonths: 24,
      businessUnit: 'Facilities',
      fields: { contractOwner: 'Sofia Rossi', background: 'Existing arrangements end in six months.' },
    },
  });
  expect(c.status(), await c.text()).toBe(201);
  const id = (await c.json()).id as string;
  expect((await req.api.post(`/api/v1/requests/${id}/submit`, { headers: req.headers })).ok()).toBeTruthy();
  const proc = await apiAs('procurement');
  const plan = await (await proc.api.get(`/api/v1/requests/${id}/plan`)).json();
  expect(
    (await proc.api.post(`/api/v1/plans/${plan.id}/submit-for-approval`, { headers: proc.headers })).ok(),
  ).toBeTruthy();
  return { id, planId: plan.id as string };
}

/** An award turned into a contract draft by Legal, by API. */
async function draftContract(title: string) {
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
  return { id: (await made.json()).id as string };
}

test.describe.configure({ mode: 'serial' });

test.describe('FR-0610 the supplier risk map has places on it', () => {
  test('suppliers are pinned on a real map that zooms in and out, with no "no locations" message', async ({
    page,
  }) => {
    await signIn(page, 'procurement');
    await page.goto('/app/reports/supplier-risk');
    const map = page.getByRole('region', { name: /Map of \d+ supplier location/ });
    await expect(map).toBeVisible();
    await expect(map).toHaveAccessibleName(/Map of 4 supplier location/);
    // one pin for each of the four suppliers, each one reachable and named
    await expect(map.locator('.leaflet-marker-icon')).toHaveCount(4);
    await expect(map.locator('.leaflet-marker-icon[title*="Brightwave"]')).toHaveCount(1);
    // zoom in and out with the map's own buttons; the zoom level is the first number in a tile's address
    const zoom = async () => {
      const src = (await map.locator('img.leaflet-tile').first().getAttribute('src')) ?? '';
      return Number(/\/(\d+)\/\d+\/\d+\.png/.exec(src)?.[1] ?? -1);
    };
    await expect.poll(zoom).toBeGreaterThan(0);
    const start = await zoom();
    await map.getByRole('button', { name: 'Zoom in' }).click();
    await expect.poll(zoom).toBe(start + 1);
    await map.getByRole('button', { name: 'Zoom out' }).click();
    await expect.poll(zoom).toBe(start);
    await page.getByRole('button', { name: 'Show all suppliers' }).click();
    await map.locator('.leaflet-marker-icon[title*="Brightwave"]').click();
    await expect(map.locator('.leaflet-popup-content')).toContainText('Sydney');
    await expect(page.getByText('No supplier locations recorded yet')).toHaveCount(0);
    await expect(page.getByTestId('risk-table')).toContainText('Sydney');
    await expect(page.getByTestId('risk-table')).toContainText('Perth');
    await expect(page.getByTestId('supplier-scores')).toBeVisible();
    await scan(page);
  });
});

test.describe('NFR-U05 approving from a link', () => {
  test('a delegate decides from a one-time link without signing in; the link is then spent', async ({
    browser,
  }) => {
    const { id: requestId } = await planAwaitingApproval(`B8 link ${rand()}`);
    const del = await apiAs('delegate');
    const notes = (await (await del.api.get('/api/v1/notifications')).json()) as
      | { items?: Array<{ title: string; link: string | null }> }
      | Array<{ title: string; link: string | null }>;
    const list = Array.isArray(notes) ? notes : (notes.items ?? []);
    const link = list.find((n) => n.title === 'Approve without signing in')?.link;
    expect(link, 'the delegate should have been sent a link').toBeTruthy();

    const ctx = await browser.newContext(); // no cookies: nobody is signed in
    const page = await ctx.newPage();
    await page.goto(link!);
    await expect(page.getByRole('heading', { name: 'Your decision is needed' })).toBeVisible();
    await expect(page.getByTestId('checklist')).toContainText('within your approval authority');
    await expect(page.getByText('Withheld on this page')).toBeVisible();
    await scan(page);
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByTestId('link-done')).toContainText('Approved');
    await scan(page);
    await page.goto(link!);
    await expect(page.getByTestId('link-error')).toContainText(/expired or was already used/);
    await ctx.close();
    const proc = await apiAs('procurement');
    const mine = await (await proc.api.get(`/api/v1/requests/${requestId}/plan`)).json();
    expect(mine.status).toBe('APPROVED_LOCKED');
  });
});

test.describe('NFR-U08 a change the assistant cannot make still has a way through', () => {
  test('when an instruction is not understood the person can copy the section out, paste the amended text back, and save it', async ({
    page,
  }) => {
    await signIn(page, 'procurement');
    const req = await apiAs('requester');
    const c = await req.api.post('/api/v1/requests', {
      headers: req.headers,
      data: {
        title: `B8 fallback draft ${rand()}`,
        category: 'IT managed services (UNSPSC 81111800)',
        estimatedValue: 80_000,
        termMonths: 24,
        businessUnit: 'IT',
        fields: { contractOwner: 'Sofia Rossi', background: 'The service desk contract ends in six months.' },
      },
    });
    const rid = (await c.json()).id as string;
    await req.api.post(`/api/v1/requests/${rid}/submit`, { headers: req.headers });
    await page.goto(`/app/plans/${rid}`);
    await page.getByRole('textbox', { name: 'Instruction' }).fill('make the background sound friendlier');
    await page.getByRole('button', { name: 'Apply' }).click();
    const fb = page.getByTestId('amend-fallback');
    await expect(fb).toBeVisible();
    await expect(fb.getByLabel('Text to copy')).toHaveValue(/make the background sound friendlier/);
    await fb.getByLabel('Section to change').selectOption({ label: 'Background' });
    await fb
      .getByLabel('2. Paste the amended text here')
      .fill('Our service desk contract ends in six months, so we are planning the replacement now.');
    await scan(page);
    await fb.getByRole('button', { name: 'Use this text' }).click();
    await expect(page.getByText('Your amended text was saved.')).toBeVisible();
    await expect(page.locator('[data-field="background"]')).toContainText('planning the replacement now');
  });
});

test.describe('FR-0805 lessons learned', () => {
  test('a lesson is recorded on a procurement and listed', async ({ page }) => {
    const { id } = await planAwaitingApproval(`B8 lesson ${rand()}`);
    await signIn(page, 'procurement');
    await page.goto(`/app/requests/${id}`);
    const panel = page.getByTestId('lessons');
    await expect(panel).toBeVisible();
    await panel
      .getByLabel('What did you learn?')
      .fill('Brief the service desk team early about the change of supplier.');
    await panel.getByRole('button', { name: 'Add lesson' }).click();
    await expect(panel.getByRole('list', { name: 'Lessons on this procurement' })).toContainText(
      'Brief the service desk team early',
    );
    await scan(page);
  });
});

test.describe('FR-0130 FR-0175 FR-0185 the response form and its requirements', () => {
  test('procurement builds the response form and sets the cover and witness requirements before publishing', async ({
    page,
  }) => {
    const { id } = await planAwaitingApproval(`B8 tender ${rand()}`);
    const del = await apiAs('delegate');
    const plan = await (await (await apiAs('procurement')).api.get(`/api/v1/requests/${id}/plan`)).json();
    expect(
      (
        await del.api.post(`/api/v1/plans/${plan.id}/decision`, {
          headers: del.headers,
          data: { decision: 'APPROVE' },
        })
      ).ok(),
    ).toBeTruthy();
    const proc = await apiAs('procurement');
    const t = await proc.api.post('/api/v1/tenders', {
      headers: proc.headers,
      data: { requestId: id, type: 'RFT', access: 'CLOSED' },
    });
    expect(t.status(), await t.text()).toBe(201);
    const tid = (await t.json()).id as string;
    await signIn(page, 'procurement');
    await page.goto(`/app/tenders/${tid}`);
    await page.getByRole('tab', { name: 'Response form' }).click();
    const form = page.getByTestId('response-form');
    await form.getByRole('button', { name: 'Add a question' }).click();
    await form
      .getByTestId('schedule-item')
      .first()
      .getByRole('textbox')
      .first()
      .fill('Total price for the term');
    await form.getByLabel('Answer type').selectOption('NUMBER');
    await form.getByLabel('Part of the bid').selectOption('COMMERCIAL');
    await form.getByLabel('Least insurance cover (AUD)').fill('5000000');
    await form.getByLabel('Two independent witnesses must open the bids after close').check();
    await scan(page);
    await form.getByRole('button', { name: 'Save the form and requirements' }).click();
    await expect(form.getByText('Saved.')).toBeVisible();
    await page.reload();
    await page.getByRole('tab', { name: 'Response form' }).click();
    await expect(
      page.getByTestId('response-form').getByTestId('schedule-item').first().getByRole('textbox').first(),
    ).toHaveValue('Total price for the term');
    await expect(page.getByTestId('response-form').getByLabel('Least insurance cover (AUD)')).toHaveValue(
      '5000000',
    );
  });
});

test.describe('FR-0830 FR-0390 legal edits, outside counsel and the legal platform', () => {
  let contractId: string;
  test.beforeAll(async () => {
    test.setTimeout(300_000);
    contractId = (await draftContract(`B8 legal ${rand()}`)).id;
  });

  test('Legal redacts and inserts clauses in plain language, issues a counsel link, and accepts what the counsel proposes', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    await signIn(page, 'legal');
    await page.goto(`/app/contracts/${contractId}`);
    const tools = page.getByTestId('legal-tools');
    await tools.getByLabel('Tell me what to change').fill('redact clause 2');
    await tools.getByRole('button', { name: 'Do it' }).click();
    await expect(page.getByTestId('legal-edit-result')).toContainText('Redact');
    await expect(page.getByTestId('clauses').getByText('Redacted').first()).toBeVisible();
    await tools
      .getByLabel('Tell me what to change')
      .fill(
        'insert a clause titled Data breach notice after clause 1: The supplier must tell the customer of any data breach within 24 hours.',
      );
    await tools.getByRole('button', { name: 'Do it' }).click();
    await expect(page.getByTestId('clauses')).toContainText('Data breach notice');
    await expect(page.getByTestId('clauses').getByText('Added by Legal')).toBeVisible();
    await tools.getByLabel('Tell me what to change').fill('make everything nicer');
    await tools.getByRole('button', { name: 'Do it' }).click();
    await expect(page.getByTestId('legal-edit-result')).toContainText('Try:');
    await scan(page);

    // a link for outside counsel
    await tools.getByLabel('Name').fill('Ada Counsel');
    await tools.getByLabel('Email').fill('ada@firm.example');
    await tools.getByRole('button', { name: 'Create link' }).click();
    const shown = await page.getByTestId('fresh-link').textContent();
    const url = /https?:\/\/\S+\/counsel\/\S+/.exec(shown ?? '')![0];

    const ctx = await browser.newContext();
    const outside = await ctx.newPage();
    await outside.goto(url);
    await expect(outside.getByRole('heading', { name: 'Contract review' })).toBeVisible();
    await expect(outside.getByTestId('clauses')).toContainText('[Redacted]');
    await outside
      .getByRole('button', { name: /Propose wording for Term/ })
      .first()
      .click();
    await outside
      .getByLabel('New wording')
      .fill('The agreement runs for two years with an option to extend by one year.');
    await outside.getByRole('button', { name: 'Send proposal' }).click();
    await expect(outside.getByText('Your proposed wording was sent to the legal team.')).toBeVisible();
    await scan(outside);
    await ctx.close();

    await page.reload();
    const red = page.getByTestId('redlines');
    await expect(red).toContainText('Outside counsel');
    await red
      .getByRole('button', { name: /Accept the change to/ })
      .first()
      .click();
    await expect(page.getByTestId('clauses')).toContainText('runs for two years with an option to extend');
  });

  test('deleted contracts are listed for Legal, and the page is closed to people who may not see them', async ({
    page,
  }) => {
    await signIn(page, 'legal');
    await page.goto('/app/contracts/deleted');
    await expect(page.getByRole('heading', { name: 'Deleted contracts' })).toBeVisible();
    await scan(page);
    await signIn(page, 'requester');
    await page.goto('/app/contracts/deleted');
    await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
  });
});

test.describe('the logo goes to the landing page', () => {
  test('clicking Intuitive Fusion in the portal opens the landing page, which offers the way back', async ({
    page,
  }) => {
    await signIn(page, 'procurement');
    await page.getByRole('link', { name: 'Intuitive Fusion home page' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.getByRole('link', { name: 'Back to my portal' }).click();
    await expect(page.getByTestId('shell')).toBeVisible();
    await page.context().clearCookies();
    await page.goto('/');
    await expect(page.getByRole('banner').getByRole('link', { name: 'Log in' })).toBeVisible();
  });
});
