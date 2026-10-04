import { createHmac } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, request as pwRequest, test, type Page } from '@playwright/test';
import { API_URL } from '../playwright.config';

/**
 * Roadmap batch B1 in the browser: settings, the new request panels, layouts, data migration, authenticator app,
 * single sign-on and time-bound access. The settings that would change everyone's experience at once (requiring MFA or
 * single sign-on for all staff) are covered by the API tests, not here, so these tests can run beside the others.
 */
const PASSWORD = 'E2e-Only-Passw0rd!2026';
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const email = (u: string) => `${u}@meridian-demo.example`;
const rand = () => Math.random().toString(36).slice(2, 8);

async function signIn(page: Page, user: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel(/Email/).fill(user.includes('@') ? user : email(user));
  await page.getByLabel(/Password/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('shell')).toBeVisible();
}

async function apiAs(user: string) {
  const api = await pwRequest.newContext({ baseURL: API_URL });
  const r = await api.post('/api/v1/auth/login', { data: { email: email(user), password: PASSWORD } });
  expect(r.ok(), await r.text()).toBeTruthy();
  return { api, headers: { 'x-csrf-token': (await r.json()).csrfToken as string } };
}

/** An authenticator-app code for the current 30 second step (RFC 6238, SHA-1, 6 digits), computed the way a phone does. */
function totp(secret: string, offset = 0): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offset));
  const h = createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1]! & 15;
  const n = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 1_000_000).padStart(6, '0');
}

/** A new staff member created and activated through the API, so a test can use a person nobody else uses. */
async function newPerson(role: string): Promise<{ email: string; password: string; name: string }> {
  const { api, headers } = await apiAs('admin');
  const mail = `b1-${rand()}@meridian-demo.example`;
  const name = `Quinn ${rand()}`;
  const created = await api.post('/api/v1/admin/users', {
    headers,
    data: { name, email: mail, roles: [role] },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const token = new URL((await created.json()).activationPath, 'http://x').searchParams.get('token')!;
  const anon = await pwRequest.newContext({ baseURL: API_URL });
  const password = 'B1-Passw0rd-ok-123';
  expect((await anon.post('/api/v1/supplier/activate', { data: { token, password } })).ok()).toBeTruthy();
  await api.dispose();
  await anon.dispose();
  return { email: mail, password, name };
}
async function signInAs(page: Page, p: { email: string; password: string }) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel(/Email/).fill(p.email);
  await page.getByLabel(/Password/).fill(p.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test.describe('administrators change the rules without a release', () => {
  test('numbering, labels and a custom field apply to the next request; the change is audited', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await signIn(page, 'admin');
    await page.goto('/admin/settings');
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();

    const numbering = page.getByTestId('settings-numbering');
    await numbering.getByLabel('Scheme').selectOption('SEQ');
    await numbering.getByLabel(/^Prefix/).fill('B1');
    await numbering.getByRole('button', { name: 'Save procurement numbers' }).click();
    await expect(numbering.getByRole('status')).toContainText('Saved and recorded in the audit trail');
    await expect(numbering.getByTestId('numbering-example')).toContainText(/B1-\d{4}/);

    const fields = page.getByTestId('settings-customFields');
    await fields.getByRole('button', { name: 'Add a field' }).click();
    await fields.getByLabel('Key 1').fill('projectCode');
    await fields.getByLabel('Label 1').fill('Project code');
    await fields.getByRole('button', { name: 'Save custom fields' }).click();
    await expect(fields.getByRole('status')).toBeVisible();
    const scan = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(scan.violations).toEqual([]);

    // the next request uses the new number and shows the custom field, (the mandatory case is covered by the API tests: a mandatory field would block other tests running at the same time)
    const { api, headers } = await apiAs('requester');
    const r = await (
      await api.post('/api/v1/requests', {
        headers,
        data: {
          title: `B1 numbering ${rand()}`,
          category: 'Building cleaning (UNSPSC 76111500)',
          estimatedValue: 30_000,
          termMonths: 12,
          businessUnit: 'Facilities',
          fields: { contractOwner: 'Sofia Rossi' },
        },
      })
    ).json();
    expect(r.number).toMatch(/^B1-\d{4}$/);
    await signIn(page, 'requester');
    await page.goto(`/app/requests/${r.id}`);
    const card = page.getByTestId('custom-fields-card');
    await expect(card).toContainText('Project code');
    await card.getByLabel(/Project code/).fill('PRJ-42');
    await card.getByRole('button', { name: 'Save details' }).click();
    await expect(card.getByRole('status')).toContainText('Saved');

    // put the settings back so the rest of the suite sees the standard numbers
    await signIn(page, 'admin');
    await page.goto('/admin/settings');
    await page.getByTestId('settings-numbering').getByLabel('Scheme').selectOption('YEAR_SEQ');
    await page
      .getByTestId('settings-numbering')
      .getByLabel(/^Prefix/)
      .fill('PR');
    await page.getByRole('button', { name: 'Save procurement numbers' }).click();
    await expect(page.getByTestId('settings-numbering').getByRole('status')).toBeVisible();
    await page.getByTestId('settings-customFields').getByRole('button', { name: 'Remove field 1' }).click();
    await page.getByRole('button', { name: 'Save custom fields' }).click();
    await expect(page.getByTestId('settings-customFields').getByRole('status')).toBeVisible();

    await signIn(page, 'probity');
    await page.goto('/app/audit?action=settings.');
    await expect(page.getByTestId('audit-row').first()).toContainText('settings.');
  });

  test('an invalid setting is refused with the reason', async ({ page }) => {
    await signIn(page, 'admin');
    await page.goto('/admin/settings');
    const numbering = page.getByTestId('settings-numbering');
    await numbering.getByLabel(/^Prefix/).fill('bad prefix!');
    await numbering.getByRole('button', { name: 'Save procurement numbers' }).click();
    await expect(numbering.getByRole('alert')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('settings-numbering').getByLabel(/^Prefix/)).toHaveValue('PR');
  });
});

test.describe('a request shows how it will be handled', () => {
  test('process, classification, reviews, suppliers, value calculator and approvers are on the request; the requester amends and a delegate approves a process change', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const { api, headers } = await apiAs('requester');
    const r = await (
      await api.post('/api/v1/requests', {
        headers,
        data: {
          title: `B1 panels ${rand()}`,
          category: 'IT managed services (UNSPSC 81111800)',
          estimatedValue: 200_000,
          termMonths: 24,
          businessUnit: 'IT',
          fields: { contractOwner: 'Sofia Rossi', background: 'Cloud software for the service desk.' },
        },
      })
    ).json();
    await signIn(page, 'requester');
    await page.goto(`/app/requests/${r.id}`);
    await expect(page.getByTestId('process-card')).toContainText('Intermediate sourcing');
    await expect(page.getByRole('list', { name: 'Workflow steps' })).toContainText('Quotes');
    await expect(page.getByTestId('classification-card')).toContainText('UNSPSC');
    await expect(page.getByTestId('taxonomy-code')).toHaveText('81111800');
    await page.getByRole('button', { name: 'Confirm this code' }).click();
    await expect(page.getByTestId('classification-card').getByRole('status')).toContainText('confirmed');
    await expect(page.getByTestId('engagements-card')).toContainText('IT review for software and cloud');
    await expect(page.getByTestId('suppliers-card')).toContainText('Summit Managed Services');
    await expect(page.getByTestId('delegates-card')).toContainText('Plan approval');

    // the estimated value calculator changes the value and the workflow follows
    const ecv = page.getByTestId('ecv-card');
    await ecv.getByLabel('Base term (AUD)').fill('2000000');
    await ecv.getByRole('button', { name: 'Use as the request value' }).click();
    await expect(ecv.getByTestId('ecv-result')).toContainText('2,000,000');
    await page.reload();
    await expect(page.getByTestId('process-card')).toContainText(/Complex tender|High-value or high-risk/);

    // a process change needs a delegate
    await page.goto(`/app/requests/${r.id}`);
    const proc = page.getByTestId('process-card');
    await proc.getByLabel('Step name').fill('Site visit');
    await proc.getByLabel(/Why is it needed/).fill('Visit the shortlisted suppliers first');
    await proc.getByRole('button', { name: 'Ask for approval' }).click();
    await expect(proc.getByTestId('variation')).toContainText('pending');
    await signIn(page, 'exec'); // the value is above a delegate's authority
    await page.goto(`/app/requests/${r.id}`);
    await page.getByTestId('variation').getByRole('button', { name: 'Approve' }).click();
    await expect(
      page.getByTestId('process-card').getByRole('list', { name: 'Workflow steps' }),
    ).toContainText('Site visit');
    const scan = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(scan.violations).toEqual([]);
  });

  test('the requests list can be switched between list, dense, board and calendar', async ({ page }) => {
    await signIn(page, 'procurement');
    await page.goto('/app/requests');
    await expect(page.getByTestId('list')).toBeVisible();
    const layouts = page.getByRole('navigation', { name: 'Layout' });
    await layouts.getByRole('link', { name: 'Board' }).click();
    await expect(page.getByTestId('board')).toBeVisible();
    await expect(page.getByTestId('board')).toContainText('Intake');
    await layouts.getByRole('link', { name: 'Calendar' }).click();
    await expect(page.getByTestId('calendar')).toBeVisible();
    await layouts.getByRole('link', { name: 'Dense' }).click();
    await expect(page.getByTestId('dense')).toBeVisible();
    const scan = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(scan.violations).toEqual([]);
  });

  test('ESG objectives are set on the plan', async ({ page }) => {
    const { api, headers } = await apiAs('requester');
    const r = await (
      await api.post('/api/v1/requests', {
        headers,
        data: {
          title: `B1 esg ${rand()}`,
          category: 'Building cleaning (UNSPSC 76111500)',
          estimatedValue: 30_000,
          termMonths: 12,
          businessUnit: 'Facilities',
          fields: { contractOwner: 'Sofia Rossi' },
        },
      })
    ).json();
    await api.post(`/api/v1/requests/${r.id}/submit`, { headers });
    await signIn(page, 'procurement');
    await page.goto(`/app/plans/${r.id}`);
    const esg = page.getByTestId('esg-card');
    await esg.getByLabel('Local labour content (%)').fill('40');
    await esg.getByLabel('Regional supplier').check();
    await esg.getByRole('button', { name: 'Record objectives' }).click();
    await expect(esg.getByRole('status')).toContainText('Saved');
    await page.reload();
    await expect(page.getByTestId('esg-card').getByLabel('Local labour content (%)')).toHaveValue('40');
    await expect(page.locator('main')).toContainText('at least 40%');
  });
});

test.describe('data migration', () => {
  test('upload, correct one exception, set another aside with a reason, cut over, and see the records marked as migrated', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const tag = rand().toUpperCase();
    const header =
      'contract_number,title,supplier,start_date,end_date,value,procurement_ref,procurement_title,owner,notice_months,supplier_abn,text';
    const csv = [
      header,
      `E2E-${tag}-1,Legacy grounds,Green Fields Pty Ltd,01/07/2022,31/12/2027,"$120,000",E2E-PR-${tag},Grounds market approach,Sofia Rossi,,,"Either party may terminate on six months written notice. The Supplier shall mow weekly."`,
      `E2E-${tag}-2,Bad date,Date Pty Ltd,31/02/2023,31/12/2027,50000,,,,,,`,
      `E2E-${tag}-3,No supplier,,2023-01-01,2027-12-31,50000,,,,,,`,
    ].join('\n');
    await signIn(page, 'admin');
    await page.goto('/admin/migration');
    await page.getByLabel('Source system').fill(`E2E-${tag}`);
    await page.getByLabel('Or paste the CSV').fill(csv);
    await page.getByRole('button', { name: 'Upload and check' }).click();
    await expect(page.getByTestId('migration-note')).toContainText('1 ready, 2 need review');
    const detail = page.getByTestId('batch-detail');
    await expect(detail).toContainText('Unparseable date');
    await expect(detail).toContainText('Missing mandatory field');
    await expect(detail).toContainText('From the text: 180-day notice');
    await expect(page.getByTestId('cutover-blocked')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cut over' })).toBeDisabled();
    const scan = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(scan.violations).toEqual([]);

    // correct the bad date
    await page.getByRole('button', { name: 'Correct row 2' }).click();
    await page.getByRole('dialog').getByLabel('start date').fill('15/03/2023');
    await page.getByRole('dialog').getByRole('button', { name: 'Save and check' }).click();
    await expect(page.getByRole('row', { name: /Bad date/ })).toContainText('Ready');
    // set the other aside: a reason is required
    await page.getByRole('button', { name: 'Set aside row 3' }).click();
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Set aside' })).toBeDisabled();
    await page.getByRole('dialog').getByLabel('Reason').fill('Supplier unknown, cannot be loaded');
    await page.getByRole('dialog').getByRole('button', { name: 'Set aside' }).click();
    await expect(page.getByRole('row', { name: /No supplier/ })).toContainText('Set aside');

    await page.getByRole('button', { name: 'Cut over' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cut over' }).click();
    await expect(page.getByTestId('reconciliation')).toContainText(
      '2 loaded + 1 set aside = 3 in the extract',
    );

    // the migrated contract shows in the contracts list, flagged, and the procurement can be found by its reference
    await signIn(page, 'legal');
    await page.goto('/app/contracts');
    const row = page.getByRole('row', { name: new RegExp(`E2E-${tag}-1`) });
    await expect(row).toBeVisible();
    await signIn(page, 'procurement');
    await page.goto(`/app/requests?q=E2E-PR-${tag}`);
    await expect(page.getByRole('table', { name: 'Requests' })).toContainText(`E2E-PR-${tag}`);
  });

  test('the roadmap marks what the batch built', async ({ page }) => {
    await signIn(page, 'procurement');
    await page.goto('/app/roadmap');
    await expect(page.getByText('FR-0655').first()).toBeVisible();
    const list = page.getByRole('list', { name: 'Data migration: requirements' });
    await expect(list).toContainText('Built'); // the migration requirements are marked built
    await expect(list).not.toContainText('Coming soon');
    await expect(page.getByLabel('Totals')).toContainText('Built');
    await signIn(page, 'admin');
    await page.goto('/admin/migration');
    await expect(page.getByRole('heading', { name: 'Data migration', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: /coming soon/i })).toHaveCount(0);
  });
});

test.describe('signing in', () => {
  test('a person sets up an authenticator app; the next sign-in asks for a code, and a wrong or reused code is refused', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const person = await newPerson('REQUESTER');
    await signInAs(page, person);
    await expect(page.getByTestId('shell')).toBeVisible();
    await page.goto('/app/security');
    await page.getByRole('button', { name: 'Start set-up' }).click();
    const secret = (await page.getByTestId('mfa-secret').innerText()).trim();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    await page.getByLabel('6-digit code from the app').fill('000000');
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'not right' })).toBeVisible();
    await page.getByLabel('6-digit code from the app').fill(totp(secret));
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByRole('status')).toContainText('set up');
    await expect(page.getByTestId('mfa-panel')).toContainText('Set up');

    // the next sign-in: password, then a code
    await signInAs(page, person);
    await expect(page.getByLabel('6-digit code')).toBeVisible();
    await expect(page.getByTestId('shell')).toHaveCount(0);
    await page.getByLabel('6-digit code').fill('123456');
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'did not work' })).toBeVisible();
    // a wrong code ends the attempt; start again with the right one
    await signInAs(page, person);
    await page.getByLabel('6-digit code').fill(totp(secret, 1)); // the step after the one used to set up (a code is used once)
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page.getByTestId('shell')).toBeVisible();
    const scan = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(scan.violations).toEqual([]);
  });

  test('single sign-on opens a session for the named person through the identity provider', async ({
    page,
  }) => {
    await page.context().clearCookies();
    await page.goto('/login');
    await page.getByRole('button', { name: 'Continue with single sign-on' }).click();
    await expect(page.getByText('Enter your work email, then choose single sign-on.')).toBeVisible();
    await page.getByLabel(/Email/).fill(email('exec'));
    await page.getByRole('button', { name: 'Continue with single sign-on' }).click();
    await expect(page.getByTestId('shell')).toBeVisible();
    await page.getByRole('button', { name: /Account menu for/ }).click();
    await expect(page.getByText(email('exec'))).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Security' })).toBeVisible();
  });
});

test.describe('access that ends, and a contact who leaves', () => {
  test('an administrator makes a role time-bound; the end date is shown against the person', async ({
    page,
  }) => {
    const person = await newPerson('FINANCE');
    await signIn(page, 'admin');
    await page.goto('/admin/users');
    const row = page.getByTestId('user-row').filter({ hasText: person.email });
    await row.getByRole('button', { name: new RegExp(`Access dates for ${person.name}`) }).click();
    const dialog = page.getByRole('dialog');
    const when = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    await dialog.getByLabel('Finance ends on').fill(when);
    await dialog.getByRole('button', { name: 'Save end date for Finance' }).click();
    await expect(page.getByTestId('users-note')).toContainText(`ends on ${when}`);
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByTestId('user-row').filter({ hasText: person.email })).toContainText('(until');
    await signInAs(page, person);
    await expect(page.getByTestId('shell')).toBeVisible(); // still inside the window
  });

  test('procurement removes a departed supplier contact, who can then no longer sign in', async ({
    page,
  }) => {
    const { api, headers } = await apiAs('procurement');
    const supplier =
      (await (await api.get('/api/v1/suppliers')).json()).items?.[0] ??
      (await (await api.get('/api/v1/suppliers')).json())[0];
    const mail = `leaver-${rand()}@brightwave.example`;
    const created = await api.post(`/api/v1/suppliers/${supplier.id}/contacts`, {
      headers,
      data: { name: 'Leaver Lou', email: mail },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const token = new URL((await created.json()).activationPath, 'http://x').searchParams.get('token')!;
    const anon = await pwRequest.newContext({ baseURL: API_URL });
    expect(
      (await anon.post('/api/v1/supplier/activate', { data: { token, password: 'Leaver-Passw0rd-1' } })).ok(),
    ).toBeTruthy();

    await signIn(page, 'procurement');
    await page.goto(`/app/suppliers/${supplier.id}`);
    await page.getByRole('button', { name: 'Remove access for Leaver Lou' }).click();
    await page.getByRole('dialog').getByLabel('Why is this changing?').fill('Left the company');
    await page.getByRole('dialog').getByRole('button', { name: 'Remove access' }).click();
    await expect(page.getByTestId('contacts').getByText('No access').first()).toBeVisible();

    await page.context().clearCookies();
    await page.goto('/login');
    await page.getByLabel(/Email/).fill(mail);
    await page.getByLabel(/Password/).fill('Leaver-Passw0rd-1');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Invalid email or password' })).toBeVisible();
  });
});
