import AxeBuilder from '@axe-core/playwright';
import { expect, request as pwRequest, test, type Page } from '@playwright/test';
import { API_URL } from '../playwright.config';

// Synthetic demo password given to the e2e API server in playwright.config.ts.
const PASSWORD = 'E2e-Only-Passw0rd!2026';
const SUPPLIER_PASSWORD = 'Supplier-E2e-Passw0rd-1';
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const email = (u: string) => `${u}@meridian-demo.example`;
const unique = (p: string) => `${p} ${Math.random().toString(36).slice(2, 7)}`;
const rand = () => Math.random().toString(36).slice(2, 8);
const ABN = '65 000 000 101'; // passes the real ABN checksum; not used by any seeded supplier

async function staffSignIn(page: Page, user: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel(/Email/).fill(email(user));
  await page.getByLabel(/Password/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('shell')).toBeVisible();
}
async function supplierSignIn(page: Page, mail: string, password: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel(/Email/).fill(mail);
  await page.getByLabel(/Password/).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('supplier-shell')).toBeVisible();
}

/** A request with an approved, locked plan, built through the API (fast set-up); the tender work is then done in the browser. */
async function approvedPlan(title: string): Promise<string> {
  const api = await pwRequest.newContext({ baseURL: API_URL });
  const as = async (user: string) => {
    const r = await api.post('/api/v1/auth/login', { data: { email: email(user), password: PASSWORD } });
    return { 'x-csrf-token': (await r.json()).csrfToken as string };
  };
  const req = await as('requester');
  const c = await api.post('/api/v1/requests', {
    headers: req,
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
  expect((await api.post(`/api/v1/requests/${id}/submit`, { headers: req })).ok()).toBeTruthy();
  const proc = await as('procurement');
  const plan = await (await api.get(`/api/v1/requests/${id}/plan`)).json();
  expect(
    (await api.post(`/api/v1/plans/${plan.id}/submit-for-approval`, { headers: proc })).ok(),
  ).toBeTruthy();
  const del = await as('delegate');
  const ok = await api.post(`/api/v1/plans/${plan.id}/decision`, {
    headers: del,
    data: { decision: 'APPROVE' },
  });
  expect(ok.ok(), await ok.text()).toBeTruthy();
  await api.dispose();
  return id;
}
const workspace = (page: Page) => page.getByTestId('tender-workspace');
const localInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const PDF = Buffer.from('%PDF-1.7\nsample technical response');
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 9, 9, 9, 9]);

test.describe
  .serial('tender journey: pack, permission, publish, supplier registration, Q&A, bid and receipt', () => {
  const title = unique('Tender journey');
  const supplierMail = `bids-${rand()}@e2e-bidder.example`;
  const company = unique('E2E Bidder Pty Ltd');
  let tenderId = '';
  let registerUrl = '';

  test('US-TND-01: procurement creates the tender pack from the approved plan', async ({ page }) => {
    await approvedPlan(title);
    await staffSignIn(page, 'procurement');
    await page.goto('/app/tenders');
    const row = page.getByTestId('ready-plan').filter({ hasText: title });
    await expect(row).toBeVisible();
    await row.getByLabel('Type').selectOption('RFP');
    await row.getByRole('button', { name: 'Create tender pack' }).click();
    await expect(workspace(page)).toBeVisible();
    await expect(workspace(page)).toHaveAttribute('data-status', 'STAGED');
    tenderId = page.url().split('/').pop()!;
    for (const h of [
      'Overview',
      'Scope of work',
      'Requirements',
      'Deliverables',
      'Timetable',
      'Evaluation criteria',
      'Conditions of tendering',
      'How to submit',
      'Questions and contact',
    ])
      await expect(page.getByRole('heading', { name: h, level: 3 })).toBeVisible();
    await expect(page.getByTestId('publish-blocked')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publish tender' })).toHaveCount(0);
    // the budget is internal: it must not appear in what suppliers will read
    await expect(page.getByTestId('pack-overview')).not.toContainText('90,000');
  });

  test('US-TND-02: a delegate gives permission; Publish stays refused inside the statutory window', async ({
    page,
  }) => {
    await staffSignIn(page, 'delegate');
    await page.goto('/app/approvals');
    const item = page.getByTestId('permit-item').filter({ hasText: title });
    await expect(item).toBeVisible();
    await item.getByRole('link', { name: 'Review and give permission' }).click();
    await page.getByRole('button', { name: 'Give permission to publish' }).click();
    await expect(page.getByTestId('permission-stamp')).toContainText('PERMISSION TO PUBLISH');

    await staffSignIn(page, 'procurement');
    await page.goto(`/app/tenders/${tenderId}`);
    await page.getByLabel(/Closing date and time/).fill(localInput(new Date(Date.now() + 10 * 86_400_000)));
    await page.getByRole('button', { name: 'Publish tender' }).click();
    await expect(page.locator('main [role="alert"]')).toContainText(/at least 25/);
    await expect(workspace(page)).toHaveAttribute('data-status', 'STAGED');
  });

  test('procurement publishes at 26 days and invites a supplier; the one-time link is shown', async ({
    page,
  }) => {
    await staffSignIn(page, 'procurement');
    await page.goto(`/app/tenders/${tenderId}`);
    await page.getByRole('button', { name: 'Publish tender' }).click(); // default is 26 days out
    await expect(workspace(page)).toHaveAttribute('data-status', 'PUBLISHED');
    await page.getByLabel('Contact email').fill(supplierMail);
    await page.getByLabel('Company').fill(company);
    await page.getByRole('button', { name: 'Invite' }).click();
    const link = page.getByTestId('invite-link').first();
    await expect(link).toContainText('/supplier/register?token=');
    registerUrl = (await link.textContent())!;
    await expect(page.getByRole('list', { name: 'Invited suppliers' })).toContainText(company);
  });

  test('US-SUP-01: the supplier registers from the link; the link then stops working', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto(registerUrl);
    await expect(page.getByLabel(/Work email/)).toHaveValue(supplierMail);
    await expect(page.getByLabel(/Company name/)).toHaveValue(company);
    await page.getByLabel(/Your name/).fill('Bea Bidder');
    await page.getByLabel(/ABN/).fill('12345678901');
    await page.getByLabel(/^Password/).fill(SUPPLIER_PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.locator('main [role="alert"]').first()).toContainText(/ABN/); // bad checksum is refused with a clear message
    await page.getByLabel(/ABN/).fill(ABN);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByTestId('registered')).toBeVisible();
    await page.goto(registerUrl);
    await expect(page.locator('main [role="alert"]')).toContainText(/not valid/);
  });

  test('US-SUP-02: the supplier sees exactly their tender and nothing about the budget; another tender is a 404', async ({
    page,
  }) => {
    await supplierSignIn(page, supplierMail, SUPPLIER_PASSWORD);
    await expect(page).toHaveURL(/\/supplier$/);
    const items = page.getByTestId('supplier-tender');
    await expect(items).toHaveCount(1);
    await items.getByRole('link', { name: title }).click();
    await expect(page.getByTestId('supplier-tender-page')).toHaveAttribute('data-open', 'true');
    await expect(page.getByTestId('countdown')).toContainText(/left/);
    await expect(page.getByRole('heading', { name: 'Tender documents' })).toBeVisible();
    await expect(page.locator('main')).not.toContainText('90,000');
    // a tender this supplier was never invited to behaves exactly like one that does not exist
    const other = await page.goto(`/supplier/tenders/${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}`);
    expect(other?.status()).toBe(404);
  });

  test('US-TND-03: an anonymous question is answered by procurement and reaches the supplier as an addendum', async ({
    page,
  }) => {
    await supplierSignIn(page, supplierMail, SUPPLIER_PASSWORD);
    await page.goto(`/supplier/tenders/${tenderId}`);
    await page.getByLabel(/Ask the buyer a question/).fill('Is a site visit mandatory before we bid?');
    await page.getByRole('button', { name: 'Send question' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Your question was sent' })).toBeVisible();

    await staffSignIn(page, 'procurement');
    await page.goto(`/app/tenders/${tenderId}`);
    const q = page.getByTestId('question').filter({ hasText: 'site visit mandatory' });
    await expect(q).toContainText('Needs an answer');
    await expect(q).not.toContainText(company); // who asked is never shown
    await q.getByRole('textbox', { name: 'Answer' }).fill('A site visit is recommended but not mandatory.');
    await q.getByRole('button', { name: 'Save answer' }).click();
    await expect(page.getByTestId('question').filter({ hasText: 'site visit mandatory' })).toContainText(
      'Answered, not yet published',
    );
    await page.getByRole('checkbox', { name: /site visit mandatory/ }).check();
    await page.getByLabel('Summary for suppliers').fill('Answer to a supplier question about site visits.');
    await page.getByRole('button', { name: 'Issue addendum' }).click();
    await expect(page.getByTestId('addendum')).toContainText('Addendum 1');

    await supplierSignIn(page, supplierMail, SUPPLIER_PASSWORD);
    await page.goto(`/supplier/tenders/${tenderId}`);
    await expect(page.getByTestId('addendum')).toContainText('Addendum 1');
    await expect(page.getByTestId('published-question')).toContainText(
      'A site visit is recommended but not mandatory.',
    );
    await expect(page.getByTestId('published-question')).not.toContainText(company);
  });

  test('US-SUP-03: bad files are refused with clear messages; a good bid is submitted and receipted; staff see it sealed', async ({
    page,
  }) => {
    await supplierSignIn(page, supplierMail, SUPPLIER_PASSWORD);
    await page.goto(`/supplier/tenders/${tenderId}`);
    const file = page.getByLabel('Choose a file to upload');
    await file.setInputFiles({
      name: 'setup.exe',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('MZ'),
    });
    await expect(page.locator('main [role="alert"]')).toContainText(
      /hidden or double extension|not accepted|not allowed/i,
    );
    await file.setInputFiles({
      name: 'fake.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('this is not a pdf'),
    });
    await expect(page.locator('main [role="alert"]')).toContainText(/do not look like a real \.pdf/);
    await expect(page.getByTestId('bid-file')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Submit bid' })).toBeDisabled();

    await file.setInputFiles({ name: 'technical.pdf', mimeType: 'application/pdf', buffer: PDF });
    await expect(page.getByTestId('bid-file')).toHaveCount(1);
    await page.getByLabel('This file is').selectOption('COMMERCIAL');
    await file.setInputFiles({
      name: 'pricing.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: ZIP,
    });
    await expect(page.getByTestId('bid-file')).toHaveCount(2);
    await page.getByRole('button', { name: 'Submit bid' }).click();
    await expect(page.getByTestId('receipt-number')).toHaveText(/^RC-\d{4}-\d{8}-[0-9A-F]{8}$/);
    await expect(page.getByTestId('receipt')).toContainText('Bid received');
    await expect(page.getByRole('button', { name: /Remove/ })).toHaveCount(0); // a submitted bid is stable until withdrawn

    await staffSignIn(page, 'procurement');
    await page.goto(`/app/tenders/${tenderId}`);
    await expect(page.getByTestId('bids-sealed')).toContainText('1 bid(s) received');
    await expect(page.getByTestId('bids-sealed')).not.toContainText(company);
  });

  test('withdrawing reopens the bid for changes before close', async ({ page }) => {
    await supplierSignIn(page, supplierMail, SUPPLIER_PASSWORD);
    await page.goto(`/supplier/tenders/${tenderId}`);
    await page.getByRole('button', { name: 'Withdraw to change files' }).click();
    await expect(page.getByRole('button', { name: 'Submit bid' })).toBeEnabled();
    await page.getByRole('button', { name: 'Submit bid' }).click();
    await expect(page.getByTestId('receipt-number')).toBeVisible();
  });

  for (const vp of [
    { name: 'phone', width: 375, height: 812 },
    { name: 'desktop', width: 1280, height: 900 },
  ]) {
    test(`accessibility and layout on a ${vp.name}: staff workspace, supplier list, tender page and registration`, async ({
      page,
    }) => {
      test.setTimeout(120_000); // five pages, three sign-ins and an axe scan on each
      const check = async (label: string) => {
        await page.evaluate(() => document.fonts.ready);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
          `${label}: horizontal scroll`,
        ).toBeLessThanOrEqual(0);
        const r = await new AxeBuilder({ page }).withTags(WCAG).analyze();
        expect(
          r.violations.map((v) => `${label}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join('|')}`),
        ).toEqual([]);
      };
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await staffSignIn(page, 'procurement');
      await page.goto('/app/tenders');
      await check(`tenders list ${vp.name}`);
      await page.goto(`/app/tenders/${tenderId}`);
      await expect(workspace(page)).toBeVisible();
      await check(`tender workspace ${vp.name}`);
      await supplierSignIn(page, supplierMail, SUPPLIER_PASSWORD);
      await check(`supplier home ${vp.name}`);
      await page.goto(`/supplier/tenders/${tenderId}`);
      await expect(page.getByTestId('supplier-tender-page')).toBeVisible();
      await check(`supplier tender ${vp.name}`);
      await page.context().clearCookies();
      await page.goto('/supplier/register');
      await expect(page.getByRole('heading', { name: 'Register as a supplier' })).toBeVisible();
      await check(`register ${vp.name}`);
    });
  }
});

test.describe('after the closing time, and who can open what', () => {
  test('a closed tender shows the locked banner, the receipt and no upload controls', async ({ page }) => {
    await supplierSignIn(page, email('supplier'), PASSWORD);
    const closed = page.getByTestId('supplier-tender').filter({ hasText: 'Evaluating' });
    await expect(closed).toHaveCount(1);
    await closed.getByRole('link').first().click();
    await expect(page.getByTestId('supplier-tender-page')).toHaveAttribute('data-open', 'false');
    await expect(page.getByTestId('closing-banner')).toContainText('closed');
    await expect(page.getByTestId('receipt')).toContainText('Bid received');
    await expect(page.getByLabel('Choose a file to upload')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Submit bid|Withdraw/ })).toHaveCount(0);
    await expect(page.getByRole('form', { name: 'Ask a question' })).toHaveCount(0);
  });

  test('the seeded supplier sees the open IT tender with its published Q&A but cannot open staff pages', async ({
    page,
  }) => {
    await supplierSignIn(page, email('supplier'), PASSWORD);
    await page
      .getByTestId('supplier-tender')
      .filter({ hasText: 'Open for bids' })
      .getByRole('link')
      .first()
      .click();
    await expect(page.getByTestId('published-question')).toContainText('site visit');
    expect((await page.goto('/app/tenders'))?.status()).toBe(403);
    expect((await page.goto('/app/dashboard'))?.status()).toBe(403);
  });

  test('staff cannot open the supplier portal; a requester has no Tenders page', async ({ page }) => {
    await staffSignIn(page, 'procurement');
    expect((await page.goto('/supplier'))?.status()).toBe(403);
    await staffSignIn(page, 'requester');
    expect((await page.goto('/app/tenders'))?.status()).toBe(403);
  });
});
