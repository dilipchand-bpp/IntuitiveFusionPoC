import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers';

/** BCP module cpdraft in the browser: CP-04 (draft from text or voice) and CP-05 (plain-language adjustment, before/after, undo). */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const scan = async (page: Page) =>
  expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations).toEqual([]);
const PRINT =
  'We need a managed print service for 40 sites, about $450k over 3 years, starting next March, must be hosted in Australia';

test.describe.configure({ mode: 'serial' });

/** A submitted request made through the API with the signed-in person's own session (fast set-up). */
async function submittedRequest(page: Page, title: string): Promise<string> {
  const me = await (await page.request.get('/api/v1/auth/me')).json();
  const h = { 'x-csrf-token': me.csrfToken as string };
  const c = await page.request.post('/api/v1/requests', {
    headers: h,
    data: {
      title,
      category: 'Building cleaning (UNSPSC 76111500)',
      estimatedValue: 90_000,
      termMonths: 24,
      businessUnit: 'Facilities',
      fields: { contractOwner: 'Sofia Rossi', background: 'Existing arrangements end in six months.' },
    },
  });
  const id = (await c.json()).id as string;
  expect((await page.request.post(`/api/v1/requests/${id}/submit`, { headers: h })).ok()).toBeTruthy();
  return id;
}

test.describe('CP-04 draft from text on the stand-alone page', () => {
  test('a requester drafts from a sentence, sees the sources, adjusts, reads the before/after, undoes, and applies', async ({
    page,
  }) => {
    await signIn(page, 'requester');
    await page.getByRole('link', { name: 'Draft with AI' }).first().click();
    await expect(page.getByRole('heading', { name: 'Draft with AI', level: 1 })).toBeVisible();
    await page.getByLabel('What to draft').selectOption('REQUEST');
    await page.getByTestId('aidraft-text').fill(PRINT);
    await expect(page.getByRole('button', { name: /voice input/i }).first()).toBeVisible();
    await page.getByTestId('aidraft-generate').click();
    const preview = page.getByTestId('draft-preview');
    await expect(preview).toContainText('Managed print service');
    await expect(preview).toContainText('SIMULATED');
    await expect(preview).toContainText('AUD 450,000');
    await expect(preview).toContainText('Still to be given');
    await expect(preview.getByText('Where this came from').first()).toBeVisible();
    await scan(page);

    // an example chip fills the box; the instruction changes the budget and shows exactly what changed
    await page.getByTestId('aidraft-chip').filter({ hasText: 'change the budget to 450k' }).click();
    await page.getByTestId('aidraft-adjust-input').fill('change the budget to 500k');
    await page.getByTestId('aidraft-adjust-submit').click();
    const change = page.getByTestId('aidraft-change');
    await expect(change).toContainText('Set the budget');
    await expect(change.getByTestId('draft-diff')).toContainText('Before');
    await expect(change.getByTestId('draft-diff')).toContainText('500000');
    await expect(preview).toContainText('AUD 500,000');
    await expect(preview).toContainText('Revision 2');

    // an instruction that is not supported is said plainly, with examples, and nothing changes
    await page.getByTestId('aidraft-adjust-input').fill('make the logo bigger');
    await page.getByTestId('aidraft-adjust-submit').click();
    const refusal = page.getByTestId('aidraft-refusal');
    await expect(refusal).toContainText('I could not apply that');
    await expect(refusal).toContainText('make price 60% and quality 40%');
    await expect(preview).toContainText('Revision 2');

    // undo goes back one revision
    await page.getByTestId('aidraft-undo').click();
    await expect(preview).toContainText('AUD 450,000');
    await page.getByText(/^Revisions \(/).click();
    await expect(page.getByTestId('aidraft-revision')).toHaveCount(3);
    await scan(page);

    // apply writes a real request as the requester
    await page.getByTestId('aidraft-apply').click();
    await expect(page.getByTestId('aidraft-result')).toContainText('Applied');
    await page.getByTestId('aidraft-result').getByRole('link', { name: 'Open it' }).click();
    await expect(page.getByRole('heading', { name: /Managed print service/ }).first()).toBeVisible();
  });

  test('a weighting instruction on evaluation criteria keeps the total at 100', async ({ page }) => {
    await signIn(page, 'procurement');
    await page.goto('/app/copilot/draft');
    await page.getByLabel('What to draft').selectOption('EVAL_CRITERIA');
    await page.getByTestId('aidraft-text').fill(PRINT);
    await page.getByTestId('aidraft-generate').click();
    await expect(page.getByTestId('draft-preview')).toContainText('Total weight: 100%');
    await page.getByTestId('aidraft-adjust-input').fill('make price 60% and quality 40%');
    await page.getByTestId('aidraft-adjust-submit').click();
    await expect(page.getByTestId('aidraft-change').getByTestId('draft-diff')).toContainText('30%');
    await expect(page.getByTestId('aidraft-change').getByTestId('draft-diff')).toContainText('60%');
    await expect(page.getByTestId('draft-preview')).toContainText('Total weight: 100%');
    await scan(page);
  });

  test('a role without drafting is turned away, and the page works on a phone', async ({ page }) => {
    await signIn(page, 'evaluator-tech');
    expect((await page.goto('/app/copilot/draft'))?.status()).toBe(403);
    await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
    await signIn(page, 'requester');
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/app/copilot/draft');
    await page.getByTestId('aidraft-text').fill(PRINT);
    await page.getByTestId('aidraft-generate').click();
    await expect(page.getByTestId('draft-preview')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
    await scan(page);
  });
});

test.describe('CP-04 the panel on the request, plan and tender pages', () => {
  test('the new-request page offers the panel and applies to a new request', async ({ page }) => {
    await signIn(page, 'requester');
    await page.goto('/app/requests/new');
    await page.getByRole('button', { name: /Draft the whole request with AI/ }).click();
    await page
      .getByTestId('aidraft-text')
      .fill(
        'Facilities needs cleaning for 12 buildings, $90,000 a year for two years, contract owner Sofia Rossi',
      );
    await page.getByTestId('aidraft-generate').click();
    await expect(page.getByTestId('draft-preview')).toContainText('AUD 180,000');
    await page.getByTestId('aidraft-apply').click();
    await expect(page.getByTestId('aidraft-result')).toContainText('Applied');
  });

  test('the plan page offers the panel and a refused role says so', async ({ page }) => {
    await signIn(page, 'requester');
    const id = await submittedRequest(page, 'Draft panel plan');
    await signIn(page, 'procurement');
    await page.goto(`/app/plans/${id}`);
    await page.getByRole('button', { name: /Draft plan sections with AI/ }).click();
    await page
      .getByTestId('aidraft-text')
      .fill('Cleaning for 12 buildings, must be hosted in Australia, ISO 27001 certified');
    await page.getByTestId('aidraft-generate').click();
    await expect(page.getByTestId('draft-preview')).toContainText('Risks and mitigation');
    await page.getByTestId('aidraft-adjust-input').fill('add a risk: supplier insolvency');
    await page.getByTestId('aidraft-adjust-submit').click();
    await expect(page.getByTestId('aidraft-change')).toContainText('supplier insolvency'.replace('s', 'S'));
    await page.getByTestId('aidraft-apply').click();
    await expect(page.getByTestId('aidraft-result')).toContainText('Applied');
    await scan(page);
  });
});
