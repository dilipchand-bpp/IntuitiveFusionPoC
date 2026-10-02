import { API_URL } from '../playwright.config';
import { expect, test } from '@playwright/test';

test('web app starts and renders the placeholder home page', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Intuitive Fusion/);
  await expect(page.getByRole('heading', { name: 'Intuitive Fusion' })).toBeVisible();
});

test('API health endpoint answers with a correlation id', async ({ request }) => {
  const res = await request.get(`${API_URL}/api/v1/health`);
  expect(res.ok()).toBeTruthy();
  expect(res.headers()['x-correlation-id']).toBeTruthy();
  expect((await res.json()).simulatedAi).toBe(true);
});
