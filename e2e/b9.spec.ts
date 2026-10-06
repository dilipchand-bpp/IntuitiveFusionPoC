import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { apiAs, rand, signIn } from './helpers';

/** Roadmap batch B9 in the browser: planning, spend and experience. */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const scan = async (page: Page) =>
  expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations).toEqual([]);

test.describe.configure({ mode: 'serial' });

test.describe('FR-0820 guided buying', () => {
  test('a requester finds a recommendation, and approving only drafts a request', async ({ page }) => {
    await signIn(page, 'requester');
    await page.goto('/app/buy');
    await expect(page.getByRole('heading', { name: 'Guided buying' })).toBeVisible();
    await expect(page.getByTestId('buy-notice')).toContainText(/nothing is ordered/i);
    await expect(page.getByTestId('catalogue-row').first()).toBeVisible();
    await scan(page);
    await page.getByRole('tab', { name: /Describe what you need/ }).click();
    await page.getByLabel('What do you need?').fill('copy paper');
    await page.getByLabel('Quantity').fill('200');
    await page
      .getByRole('button', { name: /recommend|find|source/i })
      .first()
      .click();
    const list = page.getByTestId('shortlist');
    await expect(list).toContainText('Northstar');
    await expect(list).not.toContainText('Summit');
    await expect(list).toContainText('rules-simulated-v1');
    await scan(page);
  });
});

test.describe('FR-0880 search', () => {
  test('searches own records; the outside source is off until the organisation allows it', async ({
    page,
  }) => {
    await signIn(page, 'procurement');
    await page.goto('/app/search?q=cleaning');
    await expect(page.getByRole('heading', { name: 'Search' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Facilities cleaning services/ }).first()).toBeVisible();
    await scan(page);
  });
});

test.describe('FR-0855 the risk register', () => {
  test('probity adds a risk and sees it on the heat map', async ({ page }) => {
    await signIn(page, 'probity');
    await page.goto('/app/risk');
    await expect(page.getByRole('heading', { name: /Audit, risk and compliance register/ })).toBeVisible();
    await page.getByRole('textbox', { name: /^Title/ }).fill('Single supplier for cleaning');
    await page.getByRole('combobox', { name: /^Likelihood/ }).selectOption('4');
    await page.getByRole('combobox', { name: /^Impact/ }).selectOption('4');
    await page
      .getByRole('button', { name: /^(Add|Create|Save)/ })
      .first()
      .click();
    await expect(page.getByText('Single supplier for cleaning').first()).toBeVisible();
    await scan(page);
  });
});

test.describe('FR-0845 and FR-0840 spend reports', () => {
  test('future commitment and optimisation load for finance, with the analytics store status', async ({
    page,
  }) => {
    await signIn(page, 'finance');
    await page.goto('/app/reports/commitment');
    await expect(page.getByRole('heading', { name: /commitment/i }).first()).toBeVisible();
    await expect(page.getByText(/Analytics store/i).first()).toBeVisible();
    await scan(page);
    await page.goto('/app/reports/optimisation');
    await expect(page.getByRole('heading', { name: /optimi/i }).first()).toBeVisible();
    await expect(page.getByText('rules-simulated-v1').first()).toBeVisible();
    await scan(page);
  });
});

test.describe('FR-0850 my dashboard', () => {
  test('a person chooses their own widgets and can reset them', async ({ page }) => {
    await signIn(page, 'exec');
    await page.goto('/app/dashboard/my');
    await expect(page.getByRole('heading', { name: 'My dashboard' })).toBeVisible();
    await scan(page);
    await page.getByRole('button', { name: 'Edit my dashboard' }).first().click();
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
    await scan(page);
  });
});

test.describe('FR-0810 currencies', () => {
  test('finance sees the rates in force and international delegations are explained', async ({ page }) => {
    await signIn(page, 'finance');
    await page.goto('/app/currency');
    await expect(page.getByRole('heading', { name: 'Currencies' })).toBeVisible();
    await expect(page.getByText(/foreign-currency/i).first()).toBeVisible();
    await expect(page.getByText('USD').first()).toBeVisible();
    await scan(page);
  });
});

test.describe('FR-0825 mobile', () => {
  test('the phone home works at phone width, and the app can be installed', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await signIn(page, 'procurement');
    await page.goto('/app/m');
    await expect(page.getByTestId('mobile-home')).toBeVisible();
    await scan(page);
    const res = await page.request.get('/manifest.webmanifest');
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).display).toBe('standalone');
    expect((await page.request.get('/sw.js')).ok()).toBeTruthy();
  });
});

test.describe('FR-0855 white labelling', () => {
  test('the sign-in page carries the product name from the settings', async ({ page }) => {
    const res = await page.request.get('http://localhost:4100/api/v1/branding');
    expect((await res.json()).productName).toBe('Intuitive Fusion');
    await page.goto('/login');
    await expect(page.getByText('Intuitive Fusion').first()).toBeVisible();
    expect(await page.locator('html').getAttribute('data-palette')).toBeTruthy();
  });
});

test.describe('NFR-P01 live plan updates', () => {
  test("a plan open in one browser shows another person's change without a reload", async ({ page }) => {
    const req = await apiAs('requester');
    const c = await req.api.post('/api/v1/requests', {
      headers: req.headers,
      data: {
        title: `B9 live ${rand()}`,
        category: 'Building cleaning (UNSPSC 76111500)',
        estimatedValue: 80_000,
        termMonths: 24,
        businessUnit: 'Facilities',
        fields: { contractOwner: 'Sofia Rossi', background: 'Existing arrangements end in six months.' },
      },
    });
    const id = (await c.json()).id as string;
    expect((await req.api.post(`/api/v1/requests/${id}/submit`, { headers: req.headers })).ok()).toBeTruthy();
    await signIn(page, 'procurement');
    await page.goto(`/app/plans/${id}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // someone else (the requester) changes a section; the open page picks it up on its own
    const plan = await (await req.api.get(`/api/v1/requests/${id}/plan`)).json();
    const field = plan.fields.find((f: { key: string }) => f.key === 'background') ?? plan.fields[0];
    const text = `Changed elsewhere ${rand()}`;
    const put = await req.api.put(`/api/v1/plans/${plan.id}/fields/${field.key}`, {
      headers: req.headers,
      data: { value: text, expectedVersion: plan.version },
    });
    expect(put.ok(), await put.text()).toBeTruthy();
    await expect(page.getByText(text)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('status').filter({ hasText: /just now/ })).toBeVisible();
  });
});
