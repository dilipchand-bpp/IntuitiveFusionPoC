import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { apiAs, rand, signIn } from './helpers';

/** Roadmap batch B10a in the browser: connectors, secrets, resilience, deliveries and the manual fallback. */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const scan = async (page: Page) =>
  expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations).toEqual([]);
const card = (page: Page, kind: string) =>
  page.locator(`[data-testid="connector-card"][data-kind="${kind}"]`);

test.describe.configure({ mode: 'serial' });

test.describe('NFR-C07 connector catalogue and health', () => {
  test('an administrator sees every connector as simulated, with its health, and axe finds nothing', async ({
    page,
  }) => {
    await signIn(page, 'admin');
    await page.goto('/app/connectors');
    await expect(page.getByRole('heading', { name: 'Connectors', level: 1 })).toBeVisible();
    await expect(page.getByTestId('connector-notice')).toContainText(/simulated|stand-in/i);
    await expect(page.getByTestId('connector-card')).toHaveCount(11);
    await expect(card(page, 'LEGAL')).toContainText('Healthy');
    await expect(card(page, 'HR')).toContainText('Switched off');
    await expect(card(page, 'SANCTIONS').getByTestId('breaker-state')).toContainText('CLOSED');
    await scan(page);
  });

  test('the executive can read the page but has no controls, and a requester is turned away', async ({
    page,
  }) => {
    await signIn(page, 'exec');
    await page.goto('/app/connectors');
    await expect(page.getByTestId('connector-card').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Simulate an outage/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Save secret/ })).toHaveCount(0);
    await scan(page);
    await signIn(page, 'requester');
    expect((await page.goto('/app/connectors'))?.status()).toBe(403);
    await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
  });
});

test.describe('SEC-N03 secret store', () => {
  test('a secret is set and rotated, only its name, version and fingerprint are shown, and the value never is', async ({
    page,
  }) => {
    await signIn(page, 'admin');
    await page.goto('/app/connectors');
    const form = page.getByRole('form', { name: 'Set or rotate a secret' });
    await form.getByLabel('Secret name').selectOption('connector.middleware.webhook');
    await form.getByLabel('New value').fill('first-e2e-secret-value-001');
    await form.getByRole('button', { name: 'Save secret' }).click();
    const row = page.getByTestId('secret-row').filter({ hasText: 'connector.middleware.webhook' });
    await expect(row).toContainText('1');
    await form.getByLabel('New value').fill('second-e2e-secret-value-02');
    await form.getByRole('button', { name: 'Save secret' }).click();
    await expect(row.getByRole('cell', { name: '2', exact: true })).toBeVisible();
    await expect(page.locator('body')).not.toContainText('first-e2e-secret-value-001');
    await expect(page.locator('body')).not.toContainText('second-e2e-secret-value-02');
    await expect(card(page, 'MIDDLEWARE')).toContainText(/fingerprint [0-9a-f]{8}/);
    await scan(page);
  });
});

test.describe('NFR-C05 resilient layer', () => {
  test('an outage of the sanctions list opens the breaker after repeated failures and ending it closes it again', async ({
    page,
  }) => {
    await signIn(page, 'admin');
    await page.goto('/app/connectors');
    const c = card(page, 'SANCTIONS');
    await c.getByRole('button', { name: /Simulate an outage of Sanctions screening/ }).click();
    await expect(c).toContainText('Down (simulated outage)');
    for (let i = 0; i < 3; i += 1) {
      await c.getByRole('button', { name: /^Test Sanctions screening/ }).click();
      await expect(c.getByTestId('connector-result')).toContainText(/Health check failed/);
    }
    await expect(c.getByTestId('breaker-state')).toContainText('OPEN');
    await scan(page);
    await c.getByRole('button', { name: /End the simulated outage of Sanctions screening/ }).click();
    await expect(c).toContainText('Healthy');
    await c.getByRole('button', { name: /^Test Sanctions screening/ }).click();
    await expect(c.getByTestId('connector-result')).toContainText('Health check passed');
    await expect(c.getByTestId('breaker-state')).toContainText('CLOSED');
  });
});

test.describe('NFR-AV04 manual fallback', () => {
  test('a legal matter raised while the legal platform is down waits as a task, and a person completes it with a reference', async ({
    page,
  }) => {
    const admin = await apiAs('admin');
    expect(
      (
        await admin.api.put('/api/v1/admin/settings', {
          headers: admin.headers,
          data: {
            legalPlatform: { enabled: true, name: 'HighQ', webhookSecret: '', simulateOutage: false },
          },
        })
      ).ok(),
    ).toBeTruthy();
    expect(
      (
        await admin.api.put('/api/v1/connectors/LEGAL', { headers: admin.headers, data: { mode: 'DOWN' } })
      ).ok(),
    ).toBeTruthy();
    const legal = await apiAs('legal');
    const title = `Indemnity review ${rand()}`;
    const m = await legal.api.post('/api/v1/legal/matters', { headers: legal.headers, data: { title } });
    expect(m.status()).toBe(201); // the user's work is not blocked
    expect((await m.json()).integration).toBe('FAILED');

    await signIn(page, 'legal');
    await page.goto('/app/connectors');
    const task = page.getByTestId('manual-task').filter({ hasText: title });
    await expect(task).toContainText(/by hand|yourself/i);
    await scan(page);
    await task.getByLabel('Reference it shows').fill('HQ-E2E-1');
    await task.getByRole('button', { name: 'Mark done' }).click();
    await expect(page.getByTestId('manual-task').filter({ hasText: title })).toHaveCount(0);
    await expect(page.getByRole('row', { name: new RegExp(`${title}.*HQ-E2E-1`) })).toBeVisible();
    expect(
      (
        await admin.api.put('/api/v1/connectors/LEGAL', { headers: admin.headers, data: { mode: 'UP' } })
      ).ok(),
    ).toBeTruthy();
  });
});

test.describe('NFR-AV03 deliveries and reconciliation, SEC-TP04 evidence', () => {
  test('records are sent signed, a second send changes nothing, reconciliation finds nothing missing, and the evidence shows the algorithm', async ({
    page,
  }) => {
    await signIn(page, 'procurement');
    await page.goto('/app/connectors');
    const c = card(page, 'MIDDLEWARE');
    await c.getByRole('button', { name: 'Send sample records' }).click();
    await expect(page.getByTestId('event-row').filter({ hasText: 'MIDDLEWARE_SYNC' })).toHaveCount(3);
    await expect(page.getByTestId('event-row').first()).toHaveAttribute('data-status', 'DELIVERED');
    await c.getByRole('button', { name: 'Send sample records' }).click();
    await expect(page.getByTestId('event-row').filter({ hasText: 'MIDDLEWARE_SYNC' })).toHaveCount(3);
    await c.getByRole('button', { name: /^Reconcile/ }).click();
    await expect(c.getByTestId('connector-result')).toContainText('nothing was missing');
    await expect(page.getByTestId('sync-run-row').first()).toContainText('OK');
    const ev = page.getByTestId('security-evidence');
    await expect(ev).toContainText('HMAC-SHA256');
    await expect(ev).toContainText('5 minutes');
    await expect(page.getByTestId('rejected-count')).toContainText('0');
    await scan(page);
  });
});
