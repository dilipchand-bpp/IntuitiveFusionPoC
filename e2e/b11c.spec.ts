import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, email, signIn } from './helpers';

/** Roadmap batch B11c in the browser: audit chain, evidence pack, security alerts, compliance, access policies, bank details. */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const scan = async (page: Page) =>
  expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations).toEqual([]);

test.describe.configure({ mode: 'serial' });

/** A call through the web origin as whoever is signed in on this page (same cookies and CSRF header the pages use). */
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
const requests = async (page: Page) =>
  (await call(page, 'GET', '/reports/procurements')).json!.items as Array<{
    id: string;
    number: string;
    title: string;
  }>;

test.describe('SEC-L02 the audit chain', () => {
  test('probity, an executive and an administrator can check the chain; others are turned away', async ({
    page,
  }) => {
    await signIn(page, 'probity');
    await page.goto('/app/audit-chain');
    await expect(page.getByRole('heading', { name: 'Audit chain', exact: true })).toBeVisible();
    await expect(page.getByTestId('chain-status')).toHaveAttribute('data-status', 'INTACT');
    await expect(page.getByTestId('chain-guards')).toContainText('audit_event_no_update');
    await expect(page.getByTestId('chain-row').first()).toBeVisible();
    await scan(page);
    await page.getByRole('button', { name: 'Verify and record' }).click();
    await expect(page.getByRole('status')).toContainText('Verified and recorded');
    await expect(page.getByText(/Last recorded verification: .* by PROBITY/)).toBeVisible();
    for (const who of ['exec', 'admin']) {
      await signIn(page, who);
      await page.goto('/app/audit-chain');
      await expect(page.getByTestId('chain-status')).toHaveAttribute('data-status', 'INTACT');
    }
    await signIn(page, 'procurement');
    expect((await page.goto('/app/audit-chain'))?.status()).toBe(403);
  });
});

test.describe('SEC-L07 and NFR-R06 the auditor evidence pack', () => {
  test('a procurement shows what an auditor would look for; the pack downloads, verifies, and a changed byte is named', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signIn(page, 'probity');
    await page.goto('/app/audit-pack');
    await expect(page.getByRole('heading', { name: 'Auditor evidence pack', exact: true })).toBeVisible();
    const first = (await requests(page))[0]!;
    await page.getByLabel('Procurement').selectOption(first.id);
    await expect(page.getByTestId('coverage-summary')).toBeVisible();
    await expect(page.getByTestId('coverage-row').first()).toBeVisible();
    await expect(
      page.locator('[data-testid="coverage-row"][data-key="history_tamper_evident"]'),
    ).toHaveAttribute('data-status', /PASS|FAIL/);
    await scan(page);

    const zip = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download pack (zip)' }).click();
    const zipFile = await (await zip).path();
    // Playwright stores a download under a generated name with no extension; the page decides by the extension, as a real download has one
    await page.locator('input[type="file"]').setInputFiles({
      name: 'evidence-pack.zip',
      mimeType: 'application/zip',
      buffer: await readFile(zipFile!),
    });
    await expect(page.getByTestId('verify-result')).toHaveAttribute('data-verified', 'true');
    await expect(page.getByTestId('verify-result')).toContainText('Verified: every check passed');
    await expect(page.getByTestId('verify-result')).toContainText('simulated');
    await scan(page);

    // the single JSON file: flip one byte of a file inside it and the part that fails is named
    const json = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download as one JSON file' }).click();
    const bundle = JSON.parse(await readFile((await (await json).path())!, 'utf8')) as {
      files: Record<string, string>;
    };
    const t = bundle.files['probity.json']!;
    bundle.files['probity.json'] = t.slice(0, 30) + String.fromCharCode(t.charCodeAt(30) ^ 1) + t.slice(31);
    await page.locator('input[type="file"]').setInputFiles({
      name: 'tampered.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(bundle)),
    });
    await expect(page.getByTestId('verify-result')).toHaveAttribute('data-verified', 'false');
    await expect(page.getByTestId('verify-failed')).toContainText('probity.json');
    await scan(page);
  });
});

test.describe('SEC-L06 security alerts', () => {
  test('a burst of record views raises an alert for the security owner, who acknowledges and closes it', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signIn(page, 'admin');
    await page.goto('/app/security-alerts');
    await expect(page.getByRole('heading', { name: 'Security alerts', exact: true })).toBeVisible();
    await expect(page.getByTestId('monitor-owner')).toContainText('Jonas Becker');
    await scan(page);
    // a low limit, set on the page, only for this test
    const form = page.getByRole('region', { name: 'Monitor settings' });
    await form.getByLabel('Record views that raise an alert').fill('3');
    await form.getByRole('button', { name: 'Save settings' }).click();
    await expect(form.getByRole('status')).toContainText('Saved');

    await signIn(page, 'procurement');
    const [r] = await requests(page);
    for (let i = 0; i < 4; i++) expect((await call(page, 'GET', `/requests/${r!.id}`)).status).toBe(200);

    await signIn(page, 'probity');
    await page.goto('/app/security-alerts');
    await page.getByRole('button', { name: 'Run the monitor now' }).click();
    const card = page
      .locator('[data-testid="alert-card"][data-rule="ACCESS_VOLUME"]')
      .filter({ hasText: 'Priya Nair' })
      .first();
    await expect(card).toContainText('Priya Nair');
    await expect(card).toContainText('Routed to Jonas Becker');
    await scan(page);
    await card.getByRole('button', { name: 'Acknowledge' }).click();
    await expect(card).toHaveAttribute('data-status', 'ACKNOWLEDGED');
    await card.getByLabel('Note').fill('A planned review of the cleaning tender.');
    const closed = page.waitForResponse((r) => r.url().includes('/close') && r.ok());
    await card.getByRole('button', { name: 'Close with note' }).click();
    await closed;
    await page.getByLabel('Show').selectOption('CLOSED');
    await expect(page.locator('[data-testid="alert-card"][data-status="CLOSED"]').first()).toContainText(
      'A planned review',
    );

    await signIn(page, 'admin');
    await page.goto('/app/security-alerts');
    const reset = page.getByRole('region', { name: 'Monitor settings' });
    await reset.getByLabel('Record views that raise an alert').fill('300');
    await reset.getByRole('button', { name: 'Save settings' }).click();
    await expect(reset.getByRole('status')).toContainText('Saved');
  });
});

test.describe('SEC-L08 configuration compliance', () => {
  test('the checks show guidance; a failing check is fixed in one click with a reason', async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, 'admin');
    expect(
      (
        await call(page, 'PUT', '/admin/settings', {
          approvalLinks: { enabled: true, validHours: 48, showCommercial: false },
        })
      ).status,
    ).toBe(200);
    await page.goto('/app/compliance');
    await expect(page.getByRole('heading', { name: 'Configuration compliance', exact: true })).toBeVisible();
    await expect(page.getByTestId('compliance-summary')).toBeVisible();
    await page.getByRole('button', { name: 'Run the checks now' }).click();
    const row = (key: string) => page.locator(`[data-testid="check-row"][data-key="${key}"]`);
    await expect(row('MFA_PRIVILEGED')).toHaveAttribute('data-status', 'FAIL');
    await expect(row('MFA_PRIVILEGED')).toContainText('Require multi-factor');
    await expect(row('APPROVAL_LINK_VALIDITY')).toHaveAttribute('data-status', 'PASS');
    expect(
      (
        await call(page, 'PUT', '/admin/settings', {
          approvalLinks: { enabled: true, validHours: 300, showCommercial: false },
        })
      ).status,
    ).toBe(200);
    await page.getByRole('button', { name: 'Run the checks now' }).click();
    await expect(row('APPROVAL_LINK_VALIDITY')).toHaveAttribute('data-status', 'FAIL');
    await scan(page);
    await row('APPROVAL_LINK_VALIDITY')
      .getByLabel('Reason for the change')
      .fill('Back to the recommended validity');
    await row('APPROVAL_LINK_VALIDITY')
      .getByRole('button', { name: /recommended hours/ })
      .click();
    await expect(row('APPROVAL_LINK_VALIDITY')).toHaveAttribute('data-status', 'PASS');

    // probity and executives read it; they cannot fix
    await signIn(page, 'probity');
    await page.goto('/app/compliance');
    await expect(row('MFA_PRIVILEGED')).toBeVisible();
    await expect(page.getByRole('button', { name: /recommended hours/ })).toHaveCount(0);
  });
});

test.describe('SEC-AC09 access policies', () => {
  test('a tag and a denial hide a procurement from executives, the simulator says why, and disabling restores it', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signIn(page, 'admin');
    await page.goto('/admin/access-policies');
    await expect(page.getByRole('heading', { name: 'Access policies', exact: true })).toBeVisible();
    await scan(page);
    const first = (await requests(page))[0]!;

    const tags = page.getByRole('region', { name: 'Tags' });
    await tags.getByRole('combobox', { name: 'Procurement' }).selectOption(first.id);
    await tags.getByLabel('Tag', { exact: true }).fill('hr-sensitive');
    await tags.getByRole('button', { name: 'Add tag' }).click();
    await expect(page.getByRole('list', { name: 'Tagged procurements' })).toContainText('hr-sensitive');

    const form = page.getByRole('region', { name: 'New policy' });
    await form.getByLabel('Name').fill('No executive access to HR-sensitive procurements');
    await form.getByLabel('Role').selectOption('EXEC');
    await form.getByLabel('Tag', { exact: true }).fill('hr-sensitive');
    await form.getByLabel('Reason').fill('HR matters are limited to the people running them');
    await form.getByRole('button', { name: 'Create policy' }).click();
    await expect(page.getByRole('status').first()).toContainText('Policy created');
    await expect(page.getByTestId('policy-row').first()).toContainText('No executive access');

    const sim = page.getByRole('region', { name: 'What can this person see?' });
    await sim.getByLabel('Person').selectOption({ label: 'Elena Petrova' });
    await sim.getByRole('combobox', { name: 'Procurement' }).selectOption(first.id);
    await sim.getByRole('button', { name: 'Simulate' }).click();
    await expect(page.getByTestId('sim-result')).toHaveAttribute('data-decision', 'DENY');
    await expect(page.getByTestId('sim-result')).toContainText('denies it');
    await scan(page);

    // the executive no longer sees it, on the list or on its own page
    await signIn(page, 'exec');
    expect((await requests(page)).map((r) => r.id)).not.toContain(first.id);
    const direct = await call(page, 'GET', `/requests/${first.id}`);
    expect(direct.status).toBe(403);
    expect(direct.json!.code).toBe('POLICY_DENIED');

    await signIn(page, 'admin');
    await page.goto('/admin/access-policies');
    const row = page.getByTestId('policy-row').first();
    await row.getByLabel('Reason').fill('Review finished, policy no longer needed');
    await row.getByRole('button', { name: 'Disable' }).click();
    await expect(page.getByTestId('policy-row')).toHaveCount(0);
    await signIn(page, 'exec');
    expect((await requests(page)).map((r) => r.id)).toContain(first.id);
  });
});

test.describe('SEC-AC10 bank details', () => {
  test('the supplier gives details; finance sees them in full, procurement sees the last three digits; finance confirms', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.context().clearCookies();
    await page.goto('/login');
    await page.getByLabel(/Email/).fill(email('supplier'));
    await page.getByLabel(/Password/).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByTestId('supplier-shell')).toBeVisible();
    await page.goto('/supplier/profile');
    const card = page.getByTestId('bank-card');
    await card.getByLabel('BSB').fill('083-004');
    await card.getByLabel('Account number').fill('48271936');
    await card.getByLabel('Account name').fill('Brightwave Cleaning Pty Ltd');
    await card.getByRole('button', { name: 'Save banking details' }).click();
    await expect(card.getByRole('status')).toContainText('*****936');
    await expect(card).not.toContainText('48271936');

    await signIn(page, 'procurement');
    await page.goto('/app/bank-changes');
    await expect(page.getByRole('heading', { name: 'Bank detail changes', exact: true })).toBeVisible();
    await expect(page.getByTestId('bank-rule')).toContainText('Only finance sees');
    await expect(page.getByTestId('bank-change-row').first()).toContainText('Brightwave');
    await expect(page.getByTestId('bank-change-row').first()).not.toContainText('48271936');
    await page.getByLabel('Supplier', { exact: true }).selectOption({ label: 'Brightwave Cleaning Pty Ltd' });
    await expect(page.getByTestId('bank-view')).toHaveAttribute('data-masked', 'true');
    await expect(page.getByTestId('bank-view')).toContainText('XXX-XXX');
    await expect(page.getByTestId('bank-view')).not.toContainText('48271936');
    await scan(page);

    await signIn(page, 'admin');
    await page.goto('/app/bank-changes');
    await page.getByLabel('Supplier', { exact: true }).selectOption({ label: 'Brightwave Cleaning Pty Ltd' });
    await expect(page.getByTestId('bank-view')).toHaveAttribute('data-masked', 'true');

    await signIn(page, 'finance');
    await page.goto('/app/bank-changes');
    const row = page.getByTestId('bank-change-row').first();
    await expect(row).toContainText('48271936');
    await page.getByLabel('Supplier', { exact: true }).selectOption({ label: 'Brightwave Cleaning Pty Ltd' });
    await expect(page.getByTestId('bank-view')).toHaveAttribute('data-masked', 'false');
    await scan(page);
    await row.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByRole('status').first()).toContainText('Confirmed');
    await expect(page.getByTestId('bank-change-row')).toHaveCount(0);
  });
});
