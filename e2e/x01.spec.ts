import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

/** FR-X01: the Ask AI button on every page, and the conversation behind it. */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test.describe('FR-X01 Ask AI', () => {
  test('is on every page, answers about approvals, and takes a person to a page', async ({ page }) => {
    await signIn(page, 'requester');
    for (const path of ['/app/requests', '/app/requests/new', '/app/roadmap']) {
      await page.goto(path);
      await expect(page.getByTestId('ask-ai-button')).toBeVisible();
    }
    await page.goto('/app/requests');
    await page.getByTestId('ask-ai-button').click();
    const panel = page.getByTestId('ask-ai-panel');
    await expect(panel).toBeVisible();
    await panel.getByLabel('Your question').fill('Who can approve a plan?');
    await panel.getByRole('button', { name: 'Send' }).click();
    await expect(panel.getByTestId('ai-answer').last()).toContainText('sourcing approval limit');
    expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations).toEqual([]);
    await panel.getByLabel('Your question').fill('take me to the roadmap');
    await panel.getByRole('button', { name: 'Send' }).click();
    await panel.getByRole('link', { name: 'Open Roadmap' }).click();
    await expect(page).toHaveURL(/\/app\/roadmap/);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('ask-ai-panel')).toBeHidden();
  });

  test('tells a delegate what needs attention and a report question opens the report', async ({ page }) => {
    await signIn(page, 'exec');
    await page.goto('/app/dashboard');
    await page.getByTestId('ask-ai-button').click();
    const panel = page.getByTestId('ask-ai-panel');
    await panel.getByLabel('Your question').fill('what needs my attention?');
    await panel.getByRole('button', { name: 'Send' }).click();
    await expect(panel.getByTestId('ai-answer').last()).toBeVisible();
    await panel.getByLabel('Your question').fill('contracts expiring in 90 days');
    await panel.getByRole('button', { name: 'Send' }).click();
    await panel.getByRole('link', { name: 'Show this as a report' }).click();
    await expect(page.getByTestId('answer')).toBeVisible();
  });
});
