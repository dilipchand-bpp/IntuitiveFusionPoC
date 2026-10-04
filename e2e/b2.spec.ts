import AxeBuilder from '@axe-core/playwright';
import { expect, request as pwRequest, test, type APIRequestContext } from '@playwright/test';
import { API_URL } from '../playwright.config';
import {
  PDF,
  SUPPLIER_PASSWORD,
  apiAs,
  apiConsensusAndLock,
  apiDeclareNone,
  apiScoreAndSubmit,
  closedTender,
  email,
  login,
  newAbn,
  openEvaluationApi,
  rand,
  signIn,
} from './helpers';

/** Roadmap batch B2 in the browser: the tender and supplier portal. */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** A published tender with a registered, signed-in-able supplier for each name, built through the API. */
async function openTender(
  title: string,
  names: string[],
): Promise<{
  tenderId: string;
  suppliers: Array<{ email: string; company: string; supplierId: string }>;
  api: APIRequestContext;
  headers: Record<string, string>;
}> {
  const api = await pwRequest.newContext({ baseURL: API_URL });
  const requester = await login(api, email('requester'));
  const c = await (
    await api.post('/api/v1/requests', {
      headers: requester,
      data: {
        title,
        category: 'Building cleaning (UNSPSC 76111500)',
        estimatedValue: 90_000,
        termMonths: 24,
        businessUnit: 'Facilities',
        fields: { contractOwner: 'Sofia Rossi', background: 'Existing arrangements end in six months.' },
      },
    })
  ).json();
  expect((await api.post(`/api/v1/requests/${c.id}/submit`, { headers: requester })).ok()).toBeTruthy();
  const proc = await login(api, email('procurement'));
  const plan = await (await api.get(`/api/v1/requests/${c.id}/plan`)).json();
  expect(
    (await api.post(`/api/v1/plans/${plan.id}/submit-for-approval`, { headers: proc })).ok(),
  ).toBeTruthy();
  const del = await login(api, email('delegate'));
  expect(
    (
      await api.post(`/api/v1/plans/${plan.id}/decision`, { headers: del, data: { decision: 'APPROVE' } })
    ).ok(),
  ).toBeTruthy();
  const p2 = await login(api, email('procurement'));
  const t = await (
    await api.post('/api/v1/tenders', { headers: p2, data: { requestId: c.id, type: 'RFT' } })
  ).json();
  const d2 = await login(api, email('delegate'));
  expect(
    (await api.post(`/api/v1/tenders/${t.id}/publish-permission`, { headers: d2, data: {} })).ok(),
  ).toBeTruthy();
  const p3 = await login(api, email('procurement'));
  const pub = await api.post(`/api/v1/tenders/${t.id}/publish`, {
    headers: p3,
    data: { closesAt: new Date(Date.now() + 26 * 86_400_000).toISOString() },
  });
  expect(pub.ok(), await pub.text()).toBeTruthy();
  const suppliers = [];
  for (const name of names) {
    const mail = `${name.toLowerCase()}-${rand()}@b2-e2e.example`;
    const company = `${name} ${rand()} Pty Ltd`;
    const inv = await (
      await api.post(`/api/v1/tenders/${t.id}/invitations`, {
        headers: p3,
        data: { invitees: [{ email: mail, company }] },
      })
    ).json();
    const token = new URL(inv.invitations[0].registerPath, 'http://x').searchParams.get('token')!;
    const anon = await pwRequest.newContext({ baseURL: API_URL });
    const reg = await anon.post('/api/v1/supplier/register', {
      data: {
        token,
        name: `${name} Contact`,
        email: mail,
        company,
        abn: newAbn(),
        password: SUPPLIER_PASSWORD,
      },
    });
    expect(reg.ok(), await reg.text()).toBeTruthy();
    suppliers.push({ email: mail, company, supplierId: (await reg.json()).supplierId as string });
    await anon.dispose();
  }
  return { tenderId: t.id as string, suppliers, api, headers: p3 };
}
async function supplierApi(mail: string) {
  const api = await pwRequest.newContext({ baseURL: API_URL });
  return { api, headers: await login(api, mail, SUPPLIER_PASSWORD) };
}
async function expire(api: APIRequestContext, tenderId: string) {
  expect((await api.post(`${API_URL}/__e2e/expire-tender/${tenderId}`)).status()).toBe(204);
  expect((await (await api.get(`/api/v1/tenders/${tenderId}`)).json()).status).toBe('CLOSED');
}

test.describe('questions and late submissions', () => {
  test('an answer can go to the asker only; nobody else sees it', async ({ page }) => {
    test.setTimeout(180_000);
    const t = await openTender(`B2 answer ${rand()}`, ['Asker', 'Bystander']);
    const [a, b] = t.suppliers as [(typeof t.suppliers)[0], (typeof t.suppliers)[0]];
    const sa = await supplierApi(a.email);
    expect(
      (
        await sa.api.post(`/api/v1/supplier/tenders/${t.tenderId}/questions`, {
          headers: sa.headers,
          data: { text: 'Is parking provided on site?' },
        })
      ).ok(),
    ).toBeTruthy();
    await signIn(page, 'procurement');
    await page.goto(`/app/tenders/${t.tenderId}`);
    await page.getByRole('tab', { name: /Questions and addenda/ }).click();
    const q = page.getByTestId('question').filter({ hasText: 'Is parking provided on site?' });
    await q.getByLabel('Answer', { exact: true }).fill('Yes, two bays are reserved.');
    await q.getByLabel('Who should get this answer?').selectOption('SINGLE');
    await q.getByRole('button', { name: 'Save answer' }).click();
    await expect(q).toContainText('sent to the asker only');
    await signIn(page, a.email);
    await page.goto(`/supplier/tenders/${t.tenderId}`);
    await expect(page.getByTestId('published-question')).toContainText('answered to you only');
    await signIn(page, b.email);
    await page.goto(`/supplier/tenders/${t.tenderId}`);
    await expect(page.getByTestId('published-question')).toHaveCount(0);
  });

  test('after close a supplier is given extra time; their page says so, and it still accepts a bid', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const t = await openTender(`B2 late ${rand()}`, ['Punctual', 'Latecomer']);
    const [, late] = t.suppliers as [(typeof t.suppliers)[0], (typeof t.suppliers)[0]];
    await expire(t.api, t.tenderId);
    // closed, so nothing can be added
    await signIn(page, late.email);
    await page.goto(`/supplier/tenders/${t.tenderId}`);
    await expect(page.getByTestId('supplier-tender-page')).toHaveAttribute('data-open', 'false');
    // procurement allows it, with a reason
    await signIn(page, 'procurement');
    await page.goto(`/app/tenders/${t.tenderId}`);
    await page.getByRole('tab', { name: /Stages, register and notices/ }).click();
    const card = page.getByTestId('late-card');
    await card.getByLabel('Supplier').selectOption({ label: late.company });
    await card.getByLabel('Reason').fill('A portal outage on the closing day');
    await card.getByRole('button', { name: 'Allow a late submission' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Permission recorded' })).toBeVisible();
    await expect(card.getByRole('list', { name: 'Late-submission permissions' })).toContainText(late.company);
    // the supplier can now bid
    await signIn(page, late.email);
    await page.goto(`/supplier/tenders/${t.tenderId}`);
    await expect(page.getByTestId('supplier-tender-page')).toHaveAttribute('data-open', 'true');
    await expect(page.getByTestId('closing-banner')).toContainText('extra time');
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: 'late-technical.pdf', mimeType: 'application/pdf', buffer: PDF });
    await expect(page.getByTestId('bid-file')).toContainText('late-technical.pdf');
    const scan = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(scan.violations).toEqual([]);
  });
});

test.describe('supplier onboarding, screening and the profile', () => {
  test("registration asks the organisation's questions and shows the privacy choices", async ({ page }) => {
    test.setTimeout(180_000);
    const admin = await apiAs('admin');
    const set = (v: unknown) =>
      admin.api.put('/api/v1/admin/settings', { headers: admin.headers, data: { onboardingQuestions: v } });
    // not mandatory here: a required question would block every other test that registers a supplier at the same moment
    expect(
      (
        await set([
          {
            id: 'modernSlavery',
            label: 'Do you have a modern slavery policy?',
            type: 'YESNO',
            mandatory: false,
            flagIf: 'NO',
          },
        ])
      ).ok(),
    ).toBeTruthy();
    try {
      const t = await openTender(`B2 register ${rand()}`, []);
      const inv = await (
        await t.api.post(`/api/v1/tenders/${t.tenderId}/invitations`, {
          headers: t.headers,
          data: {
            invitees: [{ email: `onboard-${rand()}@b2-e2e.example`, company: `Onboard ${rand()} Pty Ltd` }],
          },
        })
      ).json();
      await page.context().clearCookies();
      await page.goto(inv.invitations[0].registerPath);
      await page.getByLabel('Your name').fill('Olive Onboard');
      await page.getByLabel('ABN').fill(newAbn());
      await page.getByLabel(/^Password/).fill(SUPPLIER_PASSWORD);
      await expect(page.getByLabel('Do you have a modern slavery policy?')).toBeVisible();
      await page.getByLabel('Do you have a modern slavery policy?').selectOption('NO');
      await page.getByLabel('Send me product updates by email').click();
      await page.getByRole('button', { name: 'Create account' }).click();
      await expect(page.getByTestId('registered')).toBeVisible();
      await expect(page.getByTestId('held-notice')).toHaveCount(0);
      const scan = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(scan.violations).toEqual([]);
    } finally {
      await set([]);
    }
  });

  test('a screening match holds the supplier; procurement releases it and the supplier sees their tenders', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const t = await openTender(`B2 hold ${rand()}`, []);
    const mail = `held-${rand()}@b2-e2e.example`;
    const inv = await (
      await t.api.post(`/api/v1/tenders/${t.tenderId}/invitations`, {
        headers: t.headers,
        data: { invitees: [{ email: mail, company: 'Blocked Holdings Pty Ltd' }] },
      })
    ).json();
    const token = new URL(inv.invitations[0].registerPath, 'http://x').searchParams.get('token')!;
    const anon = await pwRequest.newContext({ baseURL: API_URL });
    const reg = await (
      await anon.post('/api/v1/supplier/register', {
        data: {
          token,
          name: 'Hold Contact',
          email: mail,
          company: 'Blocked Holdings Pty Ltd',
          abn: newAbn(),
          password: SUPPLIER_PASSWORD,
        },
      })
    ).json();
    expect(reg.sanctionsStatus).toBe('MATCH');
    await signIn(page, mail);
    await expect(page.getByText('Your account is on hold')).toBeVisible();
    await page.goto('/supplier/profile');
    await expect(page.getByTestId('hold-banner')).toBeVisible();

    await signIn(page, 'procurement');
    await page.goto(`/app/suppliers/${reg.supplierId}`);
    const review = page.getByTestId('sanctions-review');
    await review.getByLabel('What you found').fill('A different company that shares the name');
    await review.getByRole('button', { name: 'Release the hold' }).click();
    await expect(page.getByTestId('sanctions-review')).toHaveCount(0);
    await signIn(page, mail);
    await expect(page.getByText('Your account is on hold')).toHaveCount(0);
    await expect(page.getByTestId('supplier-tender')).toBeVisible();
  });

  test('the company profile records insurance and lets the supplier add and remove its own colleagues', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const t = await openTender(`B2 profile ${rand()}`, ['Profiled']);
    const me = t.suppliers[0]!;
    await signIn(page, me.email);
    await page.goto('/supplier/profile');
    const insurance = page.getByTestId('insurance-card');
    await insurance.getByLabel('Insurer').fill('Safe Insurance Ltd');
    await insurance.getByLabel('Policy number').fill('POL-12345');
    await insurance.getByLabel('Cover (AUD)').fill('10000000');
    await insurance
      .getByLabel('Valid until')
      .fill(new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10));
    await insurance.getByRole('button', { name: 'Record the certificate' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Insurance recorded' })).toBeVisible();
    await expect(
      page.getByTestId('supplier-profile').getByRole('region', { name: me.company, exact: true }),
    ).toContainText('Current');

    const contacts = page.getByTestId('supplier-contacts');
    await contacts.getByLabel('Add a colleague: name').fill('Casey Colleague');
    await contacts.getByLabel('Add a colleague: email').fill(`casey-${rand()}@b2-e2e.example`);
    await contacts.getByRole('button', { name: 'Add colleague' }).click();
    await expect(page.getByLabel('Activation link')).toHaveValue(/activate[?]token=/);
    await expect(page.getByTestId('contact-row')).toHaveCount(2);
    await contacts.getByLabel('Reason to remove Casey Colleague').fill('Moved to another team');
    await contacts.getByRole('button', { name: 'Remove Casey Colleague' }).click();
    await expect(page.getByTestId('contact-row').filter({ hasText: 'Casey Colleague' })).toContainText(
      'No access',
    );
    await page.getByLabel('Send me product updates by email').click();
    await expect(page.getByRole('status').filter({ hasText: 'Privacy choice saved' })).toBeVisible();
    const scan = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(scan.violations).toEqual([]);
    await page.setViewportSize({ width: 375, height: 812 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

test.describe('the deviation register', () => {
  test('a supplier proposes a contract change; legal sees it after close, rates it and downloads the register', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const t = await openTender(`B2 deviations ${rand()}`, ['Deviator']);
    const me = t.suppliers[0]!;
    await signIn(page, me.email);
    await page.goto(`/supplier/tenders/${t.tenderId}`);
    const mine = page.getByTestId('supplier-deviations');
    await mine.getByLabel('Clause').fill('12.1 Liability');
    await mine.getByLabel('What you propose instead').fill('Cap liability at twice the annual fee.');
    await mine.getByRole('button', { name: 'Add the proposed change' }).click();
    await expect(page.getByTestId('my-deviation')).toContainText('12.1 Liability');
    // sealed while the tender is open
    await signIn(page, 'legal');
    await page.goto(`/app/tenders/${t.tenderId}`);
    await page.getByRole('tab', { name: /Stages, register and notices/ }).click();
    await expect(page.getByTestId('deviations-sealed')).toBeVisible();

    await expire(t.api, t.tenderId);
    await page.reload();
    await page.getByRole('tab', { name: /Stages, register and notices/ }).click();
    const row = page.getByTestId('deviation-row');
    await expect(row).toContainText('Cap liability at twice the annual fee.');
    await row.getByLabel('Risk for 12.1 Liability').selectOption('HIGH');
    await row.getByLabel('Status for 12.1 Liability').selectOption('NEGOTIATE');
    await row
      .getByLabel('Commentary for 12.1 Liability')
      .fill('Unlimited liability is a condition of the template.');
    await row.getByRole('button', { name: 'Save assessment for 12.1 Liability' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Assessment saved' })).toBeVisible();
    await expect(page.getByTestId('deviation-row')).toContainText('To negotiate');
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: 'Excel' }).click(),
    ]);
    expect(dl.suggestedFilename()).toMatch(/^deviations-.*\.xlsx$/);
    const scan = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(scan.violations).toEqual([]);
  });
});

test.describe('multi-stage tendering', () => {
  test('procurement shortlists one supplier after evaluation: stage 2 is created, the others are told, and the shortlisted one sees only stage 2', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const { tenderId, companies, emails } = await closedTender(`B2 stages ${rand()}`, 3);
    const evalId = await openEvaluationApi(tenderId);
    for (const u of ['evaluator-tech', 'evaluator-comm', 'chair']) await apiDeclareNone(u, evalId);
    for (const u of ['evaluator-tech', 'evaluator-comm', 'chair']) await apiScoreAndSubmit(u, evalId);
    await apiConsensusAndLock(evalId);

    await signIn(page, 'procurement');
    await page.goto(`/app/tenders/${tenderId}`);
    await page.getByRole('tab', { name: /Stages, register and notices/ }).click();
    const stages = page.getByTestId('stages-card');
    await expect(stages.getByTestId('stage-row')).toHaveCount(1);
    await stages.getByLabel(`Shortlist ${companies[0]}`).check();
    await stages.getByLabel(/A note for the suppliers/).fill('Thank you for a strong response.');
    await stages.getByRole('button', { name: 'Confirm the shortlist' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Stage 2 created for 1 supplier(s); 2 told' }),
    ).toBeVisible();
    await expect(stages.getByTestId('stage-row')).toHaveCount(2);
    await expect(stages.getByTestId('stage-row').nth(1)).toContainText('Stage 2');
    const scan = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(scan.violations).toEqual([]);

    // the others were told, the shortlisted one was told something different
    const proc = await apiAs('procurement');
    const log = (await (await proc.api.get('/api/v1/admin/email-log')).json()) as Array<{
      to: string;
      kind: string;
    }>;
    expect(
      log
        .filter((m) => m.kind === 'UNSUCCESSFUL')
        .map((m) => m.to)
        .sort(),
    ).toEqual([emails[1], emails[2]].sort());
    expect(log.some((m) => m.kind === 'SHORTLISTED' && m.to === emails[0])).toBe(true);

    // stage 2 goes through permission and publication; only the shortlisted supplier is invited
    const next = (await (await proc.api.get(`/api/v1/tenders/${tenderId}/stages`)).json()).find(
      (s: { stage: number }) => s.stage === 2,
    );
    const del = await apiAs('delegate');
    expect(
      (
        await del.api.post(`/api/v1/tenders/${next.tenderId}/publish-permission`, {
          headers: del.headers,
          data: {},
        })
      ).ok(),
    ).toBeTruthy();
    const p2 = await apiAs('procurement');
    expect(
      (
        await p2.api.post(`/api/v1/tenders/${next.tenderId}/publish`, {
          headers: p2.headers,
          data: { closesAt: new Date(Date.now() + 30 * 86_400_000).toISOString() },
        })
      ).ok(),
    ).toBeTruthy();
    await signIn(page, emails[0]!);
    await expect(page.getByTestId('supplier-tender')).toHaveCount(2); // stage 1 (closed) and stage 2
    await page
      .getByRole('link', { name: /B2 stages/ })
      .first()
      .click();
    await signIn(page, emails[1]!);
    await expect(page.getByTestId('supplier-tender')).toHaveCount(1); // stage 1 only
  });
});
