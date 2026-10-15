import AxeBuilder from '@axe-core/playwright';
import { expect, request as pwRequest, test, type Page } from '@playwright/test';
import { API_URL } from '../playwright.config';
import { email, login, rand, signIn } from './helpers';

/**
 * Ask (the renamed assistant): page-aware answers on a request page, exact guidance for a Procurement Copilot run that is waiting
 * at the plan approval, role refusal wording, the phone layout and an accessibility scan with the panel open.
 */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const scan = async (page: Page) =>
  expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations).toEqual([]);

async function ask(page: Page, question: string) {
  const panel = page.getByTestId('ask-ai-panel');
  await panel.getByLabel('Your question').fill(question);
  await panel.getByRole('button', { name: 'Send' }).click();
  return panel.getByTestId('ai-answer').last();
}

test.describe.configure({ mode: 'serial' });

test.describe('Ask: page-aware help', () => {
  let requestId = '';
  let runUrl = '';

  test('the button and panel are called Ask, and it knows the request page it is on', async ({ page }) => {
    const api = await pwRequest.newContext({ baseURL: API_URL });
    const headers = await login(api, email('procurement'));
    const c = await api.post('/api/v1/requests', {
      headers,
      data: { title: `Ask page ${rand()}`, category: 'Office supplies' },
    });
    expect(c.ok(), await c.text()).toBeTruthy();
    requestId = (await c.json()).id as string;

    await signIn(page, 'procurement');
    await page.goto(`/app/requests/${requestId}`);
    const button = page.getByTestId('ask-ai-button');
    await expect(button).toHaveText('Ask');
    await expect(page.getByText('Ask AI')).toHaveCount(0);
    await button.click();
    const panel = page.getByTestId('ask-ai-panel');
    await expect(panel).toHaveAttribute('aria-label', 'Ask');
    await expect(panel.getByTestId('ask-page')).toContainText('Request');
    await expect(panel.getByText('SIMULATED').first()).toBeVisible();

    const status = await ask(page, 'What is the status of this request?');
    await expect(status).toContainText('is draft');
    await expect(status.getByTestId('ai-from')).toContainText('From: this request');
    await expect(status).toContainText('Waiting for:');

    const what = await ask(page, 'What can I do here?');
    await expect(what).toContainText('Edit the fields and submit a draft');
    await expect(what.getByTestId('ai-from')).toContainText('From: page guide');

    const how = await ask(page, 'How do I create a request?');
    await expect(how.getByTestId('ai-steps')).toContainText('Press "Submit request"');
    await expect(how.getByRole('link', { name: 'Open New request' })).toHaveAttribute(
      'href',
      '/app/requests/new',
    );
    await scan(page);
  });

  test('a role that cannot do something is told who can, with the steps', async ({ page }) => {
    await signIn(page, 'requester');
    await page.goto('/app/requests');
    await page.getByTestId('ask-ai-button').click();
    const a = await ask(page, 'How do I approve a plan?');
    await expect(a).toContainText('cannot do it yourself');
    await expect(a).toContainText('Delegate');
    await expect(a.getByTestId('ai-steps')).toContainText('Approve and lock');
  });

  test('a Copilot run waiting at the plan approval: What do I do? opens Ask with where to go, the steps and the link', async ({
    page,
  }) => {
    await signIn(page, 'procurement');
    await page.goto('/app/copilot');
    await page
      .getByTestId('copilot-text')
      .fill(`Ask e2e: cleaning for depot ${rand()}, about $30,000 over 24 months, business unit Facilities.`);
    await page.getByTestId('copilot-start').click();
    await expect(page).toHaveURL(/\/app\/copilot\/[0-9a-f-]{36}$/);
    runUrl = new URL(page.url()).pathname;
    await expect(page.getByTestId('waiting-cards')).toContainText('Approve the plan');
    await expect(page.getByTestId('what-to-do-line').first()).toContainText('What to do:');

    await page.getByTestId('what-do-i-do').first().click();
    const panel = page.getByTestId('ask-ai-panel');
    await expect(panel).toBeVisible();
    const answer = panel.getByTestId('ai-answer').last();
    await expect(answer.getByTestId('ai-steps')).toContainText('Approve and lock');
    await expect(answer.getByTestId('ai-steps')).toContainText('Advance now');
    await expect(answer).toContainText('Dana Okafor');
    await expect(answer).toContainText('not you');
    const link = answer.getByRole('link', { name: /Open the procurement plan/ });
    await expect(link).toHaveAttribute('href', /^\/app\/plans\/[0-9a-f-]{36}$/);
    await expect(answer.getByRole('link', { name: 'Back to the Copilot run' })).toHaveAttribute(
      'href',
      runUrl,
    );
    await expect(answer.getByTestId('ai-from')).toContainText('From: Copilot guidance');
    await scan(page);
  });

  test('the same answer works on a phone, with no sideways scroll, and passes the accessibility scan', async ({
    page,
  }) => {
    await signIn(page, 'procurement');
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(runUrl);
    await page.getByTestId('what-do-i-do').first().click();
    const panel = page.getByTestId('ask-ai-panel');
    await expect(panel.getByTestId('ai-steps')).toContainText('Approve and lock');
    const box = await panel.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await scan(page);
  });

  test('Waiting for you lists the Copilot item with its What to do line and the same button', async ({
    page,
  }) => {
    await signIn(page, 'delegate');
    await page.goto('/app/actions');
    const line = page.getByTestId('action-what-to-do').first();
    await expect(line).toContainText('What to do:');
    await page.getByRole('button', { name: 'What do I do?' }).first().click();
    const answer = page.getByTestId('ask-ai-panel').getByTestId('ai-answer').last();
    await expect(answer.getByTestId('ai-steps')).toContainText('Open the plan');
  });
});
