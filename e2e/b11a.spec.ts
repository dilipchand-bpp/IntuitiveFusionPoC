import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { apiAs, closedTender, rand, signIn } from './helpers';

/** Roadmap batch B11a in the browser: keys, sealed bids, upload scanning, restricted projects, security evidence. */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const scan = async (page: Page) =>
  expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations).toEqual([]);
const EICAR = 'X5O!P%@AP EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

test.describe.configure({ mode: 'serial' });

test.describe('SEC-D02 SEC-D04 encryption keys', () => {
  test('an administrator rotates the bid key; probity can read but not change', async ({ page }) => {
    await signIn(page, 'admin');
    await page.goto('/admin/keys');
    await expect(page.getByRole('heading', { name: 'Encryption keys' })).toBeVisible();
    await expect(page.getByText('SIMULATED key service')).toBeVisible();
    await expect(page.getByTestId('key-BIDS-1')).toContainText('ACTIVE');
    await scan(page);
    await page.getByRole('button', { name: 'Rotate BIDS' }).click();
    await expect(page.getByTestId('key-BIDS-2')).toContainText('ACTIVE');
    await expect(page.getByTestId('key-BIDS-1')).toContainText('RETIRED');
    await page.getByRole('button', { name: 'Re-wrap BIDS' }).click();
    await expect(page.getByTestId('rewrap-note')).toContainText('version 2');
    await scan(page);
    await signIn(page, 'probity');
    await page.goto('/admin/keys');
    await expect(page.getByTestId('key-BIDS-2')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Rotate BIDS' })).toHaveCount(0);
  });
});

test.describe('SEC-D03 sealed bids', () => {
  test('procurement sees the bids of a closed tender in the bid box, encrypted at rest', async ({ page }) => {
    const t = await closedTender(`B11a sealed ${rand()}`, 1);
    await signIn(page, 'procurement');
    await page.goto('/app/bid-box');
    await expect(page.getByRole('heading', { name: 'Sealed bids' })).toBeVisible();
    await page.getByLabel('Tender').selectOption(t.tenderId);
    await expect(page.getByTestId('bid-seal')).toHaveText('Open');
    await expect(page.getByTestId('bid-row')).toHaveCount(1);
    await expect(page.getByTestId('bid-row')).toContainText('encrypted (key v');
    await scan(page);
  });
});

test.describe('SEC-AP04 upload scanning', () => {
  test('an infected upload is refused and appears in the quarantine list without its content', async ({
    page,
  }) => {
    const { api, headers } = await apiAs('admin');
    const bad = await api.post('/api/v1/migration/uploads', {
      headers,
      data: {
        filename: 'legacy.csv',
        sourceSystem: 'Legacy ERP',
        csv: `number,title,note\nC-1,Cleaning,${EICAR}\n`,
      },
    });
    expect(bad.status()).toBe(422);
    expect((await bad.json()).code).toBe('VIRUS_DETECTED');
    await api.dispose();
    await signIn(page, 'admin');
    await page.goto('/admin/quarantine');
    await expect(page.getByRole('heading', { name: 'Upload quarantine' })).toBeVisible();
    await expect(page.getByText(/SIMULATED/).first()).toBeVisible();
    await expect(page.getByTestId('quarantine-row').first()).toContainText('QUARANTINED');
    await expect(page.locator('body')).not.toContainText('EICAR-STANDARD');
    await scan(page);
  });

  test('with the scanner down uploads are held, and a rescan clears them', async ({ page }) => {
    await signIn(page, 'admin');
    await page.goto('/admin/quarantine');
    await page.getByRole('button', { name: 'Simulate scanner down' }).click();
    await expect(page.getByTestId('scanner-mode')).toHaveText('DOWN');
    const { api, headers } = await apiAs('admin');
    const held = await api.post('/api/v1/migration/uploads', {
      headers,
      data: {
        filename: `held-${rand()}.csv`,
        sourceSystem: 'Legacy ERP',
        csv: 'number,title\nC-9,Held contract\n',
      },
    });
    expect(held.status()).toBe(503);
    expect((await held.json()).code).toBe('PENDING_SCAN');
    await api.dispose();
    await page.reload();
    await expect(page.getByText('PENDING SCAN').first()).toBeVisible();
    await page.getByRole('button', { name: 'Bring scanner back up' }).click();
    await expect(page.getByTestId('scanner-mode')).toHaveText('UP');
    await page
      .getByRole('button', { name: /^Rescan / })
      .first()
      .click();
    await expect(page.getByText('CLEARED').first()).toBeVisible();
    await scan(page);
  });
});

test.describe('FR-0865 restricted projects', () => {
  test('procurement restricts a request; an executive outside the group gets not found', async ({ page }) => {
    const title = `Restricted e2e ${rand()}`;
    const r = await apiAs('requester');
    const c = await r.api.post('/api/v1/requests', {
      headers: r.headers,
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
    await r.api.dispose();
    await signIn(page, 'procurement');
    await page.goto('/app/restricted-projects');
    await expect(page.getByRole('heading', { name: 'Restricted projects' })).toBeVisible();
    await page.getByLabel('Procurement').selectOption(id);
    await page.getByLabel(/Reason/).fill('Commercially sensitive reorganisation of the facilities function');
    await page.getByRole('button', { name: 'Restrict this project' }).click();
    await expect(page.getByTestId('restricted-row').filter({ hasText: title })).toBeVisible();
    await scan(page);
    const e = await apiAs('exec');
    const hidden = await e.api.get(`/api/v1/requests/${id}`, { headers: e.headers });
    expect(hidden.status()).toBe(404);
    await e.api.dispose();
  });
});

test.describe('SEC-D01 SEC-D10 security evidence', () => {
  test('the evidence page shows measured counts, the honest not-evidenced list and a clean isolation check', async ({
    page,
  }) => {
    await signIn(page, 'admin');
    await page.goto('/admin/security-evidence');
    await expect(page.getByRole('heading', { name: 'Security evidence' })).toBeVisible();
    await expect(page.getByTestId('ev-fields')).not.toHaveText('0');
    await expect(page.getByTestId('ev-hsts')).toContainText('days');
    await expect(page.getByTestId('not-evidenced')).toContainText('TLS termination');
    await expect(page.getByTestId('field-row').first()).toBeVisible();
    await page.getByRole('button', { name: 'Run isolation check' }).click();
    await expect(page.getByTestId('iso-ok')).toHaveText('Isolated');
    await expect(page.getByTestId('iso-visible')).toHaveText('0');
    await scan(page);
    await signIn(page, 'exec');
    await page.goto('/admin/security-evidence');
    await expect(page.getByTestId('ev-fields')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run isolation check' })).toHaveCount(0);
  });
});
