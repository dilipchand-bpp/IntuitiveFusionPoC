import AxeBuilder from '@axe-core/playwright';
import { expect, request as pwRequest, test, type Page } from '@playwright/test';
import { API_URL } from '../playwright.config';
import { email, login, signIn } from './helpers';

/** Signed-in API access for a seeded user (the API address can be overridden when the suite runs on other ports). */
async function apiAs(user: string) {
  const api = await pwRequest.newContext({ baseURL: process.env.E2E_API_URL ?? API_URL });
  return { api, headers: await login(api, email(user)) };
}

/** Batch BCP, agent runtime in the browser: CP-01 (run to a gate), CP-02 (repairs shown), CP-03 (live run page), CP-06 (agents). */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const scan = async (page: Page) =>
  expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations).toEqual([]);

test.describe.configure({ mode: 'serial' });

test.describe('CP-01 CP-02 CP-03 CP-06 Procurement Copilot', () => {
  test('a procurement officer starts a run from text, sees it work, stop at the plan approval, and move on when the delegate acts', async ({
    page,
  }) => {
    await signIn(page, 'procurement');
    await page.goto('/app/copilot');
    await expect(page.getByRole('heading', { name: 'Procurement Copilot', level: 1 })).toBeVisible();
    await expect(page.getByText('SIMULATED · rules-simulated-v1')).toBeVisible();
    await scan(page);
    await page
      .getByTestId('copilot-text')
      .fill(
        'We need cleaning services for the e2e office, about $30,000 over 24 months, business unit Facilities.',
      );
    await page.getByTestId('copilot-start').click();

    await expect(page).toHaveURL(/\/app\/copilot\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId('timeline')).toBeVisible();
    await expect(page.getByTestId('run-status').first()).toHaveAttribute('data-status', 'WAITING_GATE');
    await expect(page.getByTestId('waiting-cards')).toContainText('Approve the plan');
    await expect(page.getByTestId('waiting-cards')).toContainText('Dana Okafor');
    await expect(page.getByTestId('feed')).toContainText('Created the request from the text');
    await expect(page.getByTestId('problems')).toContainText('contract owner');
    await expect(page.getByTestId('steps')).toContainText('Rule:');
    await scan(page);

    // the delegate acts through the normal route; the next advance moves the run on
    const planUrl = await page
      .getByTestId('waiting-cards')
      .getByRole('link', { name: /Open where/ })
      .getAttribute('href');
    const requestId = planUrl!.split('/').pop()!;
    const proc = await apiAs('procurement');
    const plan = await (await proc.api.get(`/api/v1/requests/${requestId}/plan`)).json();
    const del = await apiAs('delegate');
    const ok = await del.api.post(`/api/v1/plans/${plan.id}/decision`, {
      headers: del.headers,
      data: { decision: 'APPROVE' },
    });
    expect(ok.ok(), await ok.text()).toBeTruthy();
    await page.getByTestId('advance').click();
    await expect(page.getByTestId('waiting-cards')).toContainText('permission to publish');
    await expect(page.getByTestId('timeline').locator('[data-state="CURRENT"]')).toContainText('Tender');
    await expect(page.getByTestId('simulate')).toContainText('SIMULATED');

    // the delegate sees the waiting item in their action list and on the dashboard card
    await signIn(page, 'delegate');
    await page.goto('/app/actions');
    await expect(page.getByTestId('action-list')).toContainText('permission to publish');
    await signIn(page, 'procurement');
    await page.goto('/app/dashboard');
    await expect(page.getByTestId('copilot-card')).toContainText('Procurement Copilot');
    await page.goto('/app/copilot');
    await expect(page.getByTestId('run-list').getByRole('link').first()).toBeVisible();
  });

  test('a requester run stops where the requester role ends; the phone layout has no sideways scroll', async ({
    page,
  }) => {
    await signIn(page, 'requester');
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/app/copilot');
    await page
      .getByTestId('copilot-text')
      .fill('We need security services for the depot, about $60,000 over 12 months.');
    await page.getByTestId('copilot-start').click();
    await expect(page.getByTestId('waiting-cards')).toContainText('Submit the plan');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await scan(page);
  });

  test('Ask AI offers to run the request for me', async ({ page }) => {
    await signIn(page, 'procurement');
    await page.goto('/app/dashboard');
    await page.getByTestId('ask-ai-button').click();
    await page.getByLabel('Your question').fill('Cleaning services for the annex, about $30,000');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByTestId('run-for-me')).toBeVisible();
    await page.getByTestId('run-for-me').click();
    await expect(page).toHaveURL(/\/app\/copilot\?text=/);
    await expect(page.getByTestId('copilot-text')).toHaveValue(/Cleaning services for the annex/);
  });
});
