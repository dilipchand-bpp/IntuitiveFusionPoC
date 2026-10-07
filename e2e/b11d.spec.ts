import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers';

/** Roadmap batch B11d in the browser: signature levels, outside content, ESG plan limits, usage plan. */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const scan = async (page: Page) =>
  expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations).toEqual([]);

test.describe.configure({ mode: 'serial' });

async function call(page: Page, method: string, path: string, body?: unknown) {
  return page.evaluate(
    async ({ method, path, body }) => {
      const me = (await (await fetch('/api/v1/auth/me')).json()) as { csrfToken: string };
      const r = await fetch(`/api/v1${path}`, {
        method,
        headers: { 'content-type': 'application/json', 'x-csrf-token': me.csrfToken },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: r.status, json: (await r.json().catch(() => null)) as Record<string, any> | null }; // eslint-disable-line @typescript-eslint/no-explicit-any
    },
    { method, path, body },
  );
}

let requestId = '';

test.describe('NFR-R03 outside content', () => {
  test('procurement refreshes the packs and the plan shows each suggestion with its source', async ({
    page,
  }) => {
    await signIn(page, 'procurement');
    await page.goto('/app/content');
    await expect(page.getByRole('heading', { name: 'Outside content', exact: true })).toBeVisible();
    await expect(page.getByTestId('pack-state-UNSPSC_TAXONOMY')).toHaveText('Not loaded');
    await page.getByTestId('refresh-all').click();
    await expect(page.getByTestId('refresh-result')).toContainText('version none to 1');
    await expect(page.getByTestId('pack-state-UNSPSC_TAXONOMY')).toHaveText('Current');
    await scan(page);
    await page.getByTestId('refresh-all').click();
    await expect(page.getByTestId('refresh-result')).toContainText('version 1 to 2');

    await signIn(page, 'requester');
    const c = await call(page, 'POST', '/requests', {
      title: 'E2E B11d plan',
      category: 'Building cleaning (UNSPSC 76111500)',
      estimatedValue: 90_000,
      termMonths: 24,
      businessUnit: 'Facilities',
      fields: { contractOwner: 'Sofia Rossi', background: 'Existing arrangements end in six months.' },
    });
    expect(c.status).toBe(201);
    requestId = c.json!.id as string;
    expect((await call(page, 'POST', `/requests/${requestId}/submit`, {})).status).toBe(200);
    await page.goto(`/app/plans/${requestId}`);
    const hints = page.getByTestId('content-hints-card');
    await expect(hints).toBeVisible();
    await expect(hints.getByTestId('hint-code')).toContainText('UNSPSC');
    await expect(hints.getByTestId('source-chip').first()).toContainText(/In-house|Outside content/);
    await scan(page);
  });

  test('legal and executives can read the page but not refresh', async ({ page }) => {
    await signIn(page, 'legal');
    await page.goto('/app/content');
    await expect(page.getByTestId('pack-UNSPSC_TAXONOMY')).toBeVisible();
    await expect(page.getByTestId('refresh-all')).toHaveCount(0);
    await page.context().clearCookies();
    await signIn(page, 'requester');
    const refused = await page.goto('/app/content');
    expect(refused?.status()).toBe(403);
    await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
  });
});

test.describe('NFR-R05 ESG limits on the plan', () => {
  test('a breach holds the plan; an exception and the delegate acknowledgement release it', async ({
    page,
  }) => {
    await signIn(page, 'procurement');
    await page.goto(`/app/plans/${requestId}`);
    const card = page.getByTestId('esg-targets-card');
    await expect(card).toBeVisible();
    await expect(page.getByTestId('esg-status-INDIGENOUS_SPEND_PCT')).toHaveText('No figure');
    await scan(page);
    const put = await call(page, 'PUT', `/plans/${await planId(page)}/esg-targets/INDIGENOUS_SPEND_PCT`, {
      forecast: 1,
    });
    expect(put.status).toBe(200);
    await page.reload();
    await expect(page.getByTestId('esg-status-INDIGENOUS_SPEND_PCT')).toHaveText('Breach');
    await expect(page.getByTestId('esg-summary-INDIGENOUS_SPEND_PCT')).toHaveText(
      'Indigenous-owned spend 1% of contract value vs target 3%',
    );
    await expect(page.getByTestId('esg-gate')).toContainText('Holds the plan');
    await card
      .getByLabel(/Why indigenous-owned spend may go ahead/i)
      .fill('No Indigenous supplier operates in this region');
    await card.getByRole('button', { name: 'Record exception' }).click();
    await expect(page.getByTestId('esg-exception-INDIGENOUS_SPEND_PCT')).toContainText(
      'waiting for a delegate',
    );
    await signIn(page, 'delegate');
    await page.goto(`/app/plans/${requestId}`);
    await page.getByRole('button', { name: 'Acknowledge this exception' }).click();
    await expect(page.getByTestId('esg-gate')).toContainText('accepted by exception');
    await scan(page);
  });
});

async function planId(page: Page) {
  const r = await call(page, 'GET', `/requests/${requestId}/plan`);
  return r.json!.id as string;
}

test.describe('NFR-SC01 usage plan', () => {
  test('an administrator sees the plan, limits and use; others are turned away', async ({ page }) => {
    await signIn(page, 'admin');
    await page.goto('/admin/usage');
    await expect(page.getByTestId('plan-name')).toHaveText('Enterprise');
    await expect(page.getByTestId('throttled-count')).toContainText('0');
    await scan(page);
    await page.context().clearCookies();
    await signIn(page, 'procurement');
    const refused = await page.goto('/admin/usage');
    expect(refused?.status()).toBe(403);
    await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
  });

  test('the settings page has the three B11d sections', async ({ page }) => {
    await signIn(page, 'admin');
    await page.goto('/admin/settings');
    for (const id of ['signatures', 'content', 'esgPlan'])
      await expect(page.getByTestId(`settings-${id}`)).toBeVisible();
  });
});

test.describe('NFR-L03 signature level on the contract page', () => {
  test('legal sees the level a contract needs, the explainer and the override form', async ({ page }) => {
    await signIn(page, 'legal');
    const list = await call(page, 'GET', '/contracts');
    const items = (list.json!.items ?? list.json) as Array<{ id: string; status: string }>;
    const open = items.find((x) => x.status === 'EXECUTED') ?? items[0]!;
    await page.goto(`/app/contracts/${open.id}`);
    const card = page.getByTestId('signature-level-card');
    await expect(card).toBeVisible();
    await expect(card.getByTestId('required-level')).toContainText(/SES|AES|QES/);
    await card.getByText('What the signature levels mean').click();
    await expect(card.getByTestId('level-explainer')).toContainText('qualified');
    await scan(page);
  });
});
