import AxeBuilder from '@axe-core/playwright';
import { expect, request as pwRequest, test, type Page } from '@playwright/test';
import { API_URL } from '../playwright.config';

// Synthetic demo password given to the e2e API server in playwright.config.ts.
const PASSWORD = 'E2e-Only-Passw0rd!2026';
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const email = (u: string) => `${u}@meridian-demo.example`;

async function signIn(page: Page, user: string) {
  await page.goto('/login');
  await page.getByLabel(/Email/).fill(email(user));
  await page.getByLabel(/Password/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('shell')).toBeVisible();
}

/** Creates and submits a request through the API (fast set-up); everything under test then happens in the browser. */
async function submittedRequest(value: number, title: string): Promise<string> {
  const api = await pwRequest.newContext({ baseURL: API_URL });
  const login = await api.post('/api/v1/auth/login', {
    data: { email: email('requester'), password: PASSWORD },
  });
  const csrf = (await login.json()).csrfToken as string;
  const headers = { 'x-csrf-token': csrf };
  const c = await api.post('/api/v1/requests', {
    headers,
    data: {
      title,
      category: 'Building cleaning (UNSPSC 76111500)',
      estimatedValue: value,
      termMonths: 24,
      businessUnit: 'Facilities',
      fields: { contractOwner: 'Sofia Rossi', background: 'Existing arrangements end in six months.' },
    },
  });
  const id = (await c.json()).id as string;
  const s = await api.post(`/api/v1/requests/${id}/submit`, { headers });
  expect(s.ok(), await s.text()).toBeTruthy();
  await api.dispose();
  return id;
}
const unique = (p: string) => `${p} ${Math.random().toString(36).slice(2, 7)}`;
const status = (page: Page) => page.getByTestId('plan-workspace');
async function openPlan(page: Page, id: string) {
  await page.goto(`/app/plans/${id}`);
  await expect(status(page)).toBeVisible();
}
const card = (page: Page, key: string) => page.locator(`[data-field="${key}"]`);
const para = (page: Page, key: string, n: number) => card(page, key).locator(`[data-paragraph="${n}"]`);

test.describe('US-PLN-01 auto-populated plan', () => {
  test('procurement finds the submitted request in the plan list and opens a fully drafted plan', async ({
    page,
  }) => {
    const title = unique('Plan list test');
    const id = await submittedRequest(120_000, title);
    await signIn(page, 'procurement');
    await page.goto('/app/plans');
    const row = page
      .getByRole('table', { name: 'Procurement plans' })
      .getByRole('row', { name: new RegExp(title) });
    await expect(row).toContainText('Not started');
    await row.getByRole('link', { name: title }).click();
    await expect(page).toHaveURL(new RegExp(`/app/plans/${id}$`));
    await expect(status(page)).toHaveAttribute('data-plan-status', 'DRAFT');
    for (const label of [
      'Background',
      'Objectives',
      'Detailed requirements',
      'Deliverables',
      'Milestones',
      'Risks and mitigation',
      'Evaluation committee',
      'Approval delegate',
      'Supplier due diligence',
    ]) {
      await expect(page.getByRole('heading', { name: label, level: 3 })).toBeVisible();
    }
    await expect(card(page, 'background').getByText('AI-drafted')).toBeVisible();
    await expect(para(page, 'background', 1)).toHaveText('Existing arrangements end in six months.'); // the requester's words are kept
    await expect(page.getByTestId('key-points')).toContainText('$120,000');
    await expect(page.getByRole('button', { name: 'Submit for approval' })).toBeVisible();
  });

  test('the request page links to its plan; a requester sees their plan read-write while it is a draft', async ({
    page,
  }) => {
    const id = await submittedRequest(45_000, unique('Link test'));
    await signIn(page, 'requester');
    await page.goto(`/app/requests/${id}`);
    await page.getByRole('link', { name: 'Open the procurement plan' }).click();
    await expect(page).toHaveURL(new RegExp(`/app/plans/${id}$`));
    await expect(page.getByRole('button', { name: 'Edit Background' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Submit for approval' })).toHaveCount(0); // only procurement submits
  });
});

test.describe('US-PLN-02 editing in plain language, with undo', () => {
  test('"change paragraph 3 of the background" changes only that paragraph; undo restores it exactly', async ({
    page,
  }) => {
    const id = await submittedRequest(110_000, unique('Instruction test'));
    await signIn(page, 'procurement');
    await openPlan(page, id);
    const p1 = await para(page, 'background', 1).innerText();
    const p2 = await para(page, 'background', 2).innerText();
    const p3 = await para(page, 'background', 3).innerText();

    await page
      .getByRole('textbox', { name: 'Instruction' })
      .fill('change paragraph 3 of the background to The incumbent contract ends in March');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Changed paragraph 3 of Background' }),
    ).toBeVisible();
    await expect(para(page, 'background', 3)).toHaveText('The incumbent contract ends in March');
    await expect(para(page, 'background', 1)).toHaveText(p1);
    await expect(para(page, 'background', 2)).toHaveText(p2);

    await page.getByRole('button', { name: 'Undo last change' }).click();
    await expect(para(page, 'background', 3)).toHaveText(p3);
    await expect(page.getByRole('button', { name: 'Undo last change' })).toHaveCount(0);
    await expect(card(page, 'background').getByText('AI-drafted')).toBeVisible(); // authorship marker restored with the text
  });

  test('an instruction it cannot understand changes nothing and says how to rephrase', async ({ page }) => {
    const id = await submittedRequest(105_000, unique('Hint test'));
    await signIn(page, 'procurement');
    await openPlan(page, id);
    const before = await page.locator('[data-field]').allInnerTexts();
    await page.getByRole('textbox', { name: 'Instruction' }).fill('make it better');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByTestId('instruction-hint')).toContainText('Try for example');
    expect(await page.locator('[data-field]').allInnerTexts()).toEqual(before);
    await page
      .getByRole('textbox', { name: 'Instruction' })
      .fill('change paragraph 42 of the background to X');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByTestId('instruction-hint')).toContainText('this section has 3');
  });

  test('a section can also be edited directly, and the edit is saved', async ({ page }) => {
    const id = await submittedRequest(115_000, unique('Direct edit'));
    await signIn(page, 'requester');
    await openPlan(page, id);
    await page.getByRole('button', { name: 'Edit Objectives' }).click();
    await page.getByLabel(/Objectives/).fill('One objective only.\n\nA second objective.');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(para(page, 'objectives', 1)).toHaveText('One objective only.');
    await expect(para(page, 'objectives', 2)).toHaveText('A second objective.');
    await expect(card(page, 'objectives').getByText('AI-drafted')).toHaveCount(0);
  });
});

test.describe('US-PLN-03 approval on any device', () => {
  test('on a phone: the delegate opens the approval, sees the key points and decision first, approves, and the plan locks with a stamp', async ({
    page,
  }) => {
    const title = unique('Mobile approval');
    const id = await submittedRequest(90_000, title);
    // procurement submits the plan
    await signIn(page, 'procurement');
    await openPlan(page, id);
    await page.getByRole('button', { name: 'Submit for approval' }).click();
    await expect(status(page)).toHaveAttribute('data-plan-status', 'AWAITING_APPROVAL');
    await page.context().clearCookies();

    await page.setViewportSize({ width: 375, height: 812 });
    await signIn(page, 'delegate');
    await page.goto('/app/approvals');
    await expect(page.getByTestId('approval-item').filter({ hasText: title })).toBeVisible();
    await page
      .getByTestId('approval-item')
      .filter({ hasText: title })
      .getByRole('link', { name: 'Review and decide' })
      .click();

    const kp = page.getByTestId('key-points');
    const dec = page.getByTestId('decision-panel');
    await expect(kp).toBeVisible();
    await expect(dec).toBeVisible();
    // key points and the decision are above the long plan detail, and the page does not scroll sideways
    const kpBox = await kp.boundingBox();
    const decBox = await dec.boundingBox();
    const detailBox = await page.getByRole('heading', { name: 'Plan', level: 2 }).boundingBox();
    expect(kpBox!.y).toBeLessThan(decBox!.y);
    expect(decBox!.y).toBeLessThan(detailBox!.y);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(0);
    const r = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(r.violations.map((v) => v.id)).toEqual([]);

    await page.getByRole('button', { name: 'Approve and lock' }).click();
    await expect(status(page)).toHaveAttribute('data-plan-status', 'APPROVED_LOCKED');
    const stamp = page.getByLabel('Approval record').getByRole('figure');
    await expect(stamp).toContainText('Approved');
    await expect(stamp).toContainText('Dana Okafor');
    await expect(page.getByRole('button', { name: /^Edit / })).toHaveCount(0); // locked: no edit controls
    await expect(page.getByRole('button', { name: 'Approve and lock' })).toHaveCount(0);
  });

  test("above a delegate's authority the screen explains why and offers no Approve; the executive can approve", async ({
    page,
  }) => {
    const id = await submittedRequest(400_000, unique('Over limit'));
    await signIn(page, 'procurement');
    await openPlan(page, id);
    await page.getByRole('button', { name: 'Submit for approval' }).click();
    await expect(status(page)).toHaveAttribute('data-plan-status', 'AWAITING_APPROVAL');
    await page.context().clearCookies();

    await signIn(page, 'delegate');
    await openPlan(page, id);
    await expect(page.getByTestId('decision-panel')).toContainText('Your sourcing authority is $250,000');
    await expect(page.getByRole('button', { name: 'Approve and lock' })).toBeDisabled();
    await page.context().clearCookies();

    await signIn(page, 'exec');
    await openPlan(page, id);
    await page.getByRole('button', { name: 'Approve and lock' }).click();
    await expect(status(page)).toHaveAttribute('data-plan-status', 'APPROVED_LOCKED');
  });

  test('returning a plan needs a reason, then procurement can fix and resubmit it', async ({ page }) => {
    const id = await submittedRequest(60_000, unique('Return test'));
    await signIn(page, 'procurement');
    await openPlan(page, id);
    await page.getByRole('button', { name: 'Submit for approval' }).click();
    await expect(status(page)).toHaveAttribute('data-plan-status', 'AWAITING_APPROVAL');
    await page.context().clearCookies();
    await signIn(page, 'delegate');
    await openPlan(page, id);
    const ret = page.getByRole('button', { name: 'Return to procurement' });
    await expect(ret).toBeDisabled(); // no reason yet
    await page.getByLabel(/Comment/).fill('Scope is unclear');
    await ret.click();
    await expect(status(page)).toHaveAttribute('data-plan-status', 'REJECTED');
    await expect(page.getByLabel('Approval record')).toContainText('Returned');
    await page.context().clearCookies();
    await signIn(page, 'procurement');
    await openPlan(page, id);
    await expect(page.getByRole('button', { name: 'Submit for approval' })).toBeVisible();
  });

  test('roles without a part in the plan see no controls (requester on a submitted plan, probity)', async ({
    page,
  }) => {
    const id = await submittedRequest(70_000, unique('No controls'));
    await signIn(page, 'procurement');
    await openPlan(page, id);
    await page.getByRole('button', { name: 'Submit for approval' }).click();
    await expect(status(page)).toHaveAttribute('data-plan-status', 'AWAITING_APPROVAL');
    await page.context().clearCookies();
    await signIn(page, 'requester');
    await openPlan(page, id);
    await expect(page.getByTestId('decision-panel')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Edit / })).toHaveCount(0); // submitted plans are not editable
  });
});

test.describe('US-PLN-05 conflicts of interest and independent risk sign-off', () => {
  test('high-value flow: declare, risk sign-off, executive approval, in the right order', async ({
    page,
  }) => {
    const id = await submittedRequest(1_250_000, unique('High value'));
    await signIn(page, 'procurement');
    await openPlan(page, id);
    await expect(page.locator('[data-gate="RISK_SIGNOFF"]')).toHaveAttribute('data-status', 'REQUIRED');
    await page.getByRole('button', { name: 'Submit for approval' }).click();
    await expect(status(page)).toHaveAttribute('data-plan-status', 'AWAITING_SIGNOFF');

    await page.getByLabel('I have no conflict of interest').check();
    await page.getByRole('button', { name: 'Submit declaration' }).click();
    await expect(page.getByTestId('coi-panel')).toContainText('Priya Nair');
    await expect(page.locator('[data-gate="UPFRONT_COI"]')).toHaveAttribute('data-status', 'SATISFIED');
    await expect(status(page)).toHaveAttribute('data-plan-status', 'AWAITING_SIGNOFF'); // risk sign-off still open
    await page.context().clearCookies();

    await signIn(page, 'probity');
    await openPlan(page, id);
    await expect(page.getByTestId('risk-panel')).toBeVisible();
    await page.getByRole('button', { name: 'Sign off risk' }).click();
    await expect(status(page)).toHaveAttribute('data-plan-status', 'AWAITING_APPROVAL');
    await expect(page.getByLabel('Approval record')).toContainText('Risk signed off');
    await page.context().clearCookies();

    await signIn(page, 'exec');
    await openPlan(page, id);
    await page.getByRole('button', { name: 'Approve and lock' }).click();
    await expect(status(page)).toHaveAttribute('data-plan-status', 'APPROVED_LOCKED');
    await expect(page.locator('[data-gate="RISK_SIGNOFF"]')).toHaveAttribute('data-status', 'SATISFIED');
  });

  test('a disclosed conflict is decided by the delegate; the declarant cannot decide their own', async ({
    page,
  }) => {
    const id = await submittedRequest(1_100_000, unique('Conflict'));
    await signIn(page, 'procurement');
    await openPlan(page, id);
    await page.getByRole('button', { name: 'Submit for approval' }).click();
    await page.getByLabel('I have a conflict to declare').check();
    await expect(page.getByRole('button', { name: 'Submit declaration' })).toBeDisabled(); // must describe it
    await page.getByLabel('Describe the conflict').fill('Previously worked for a bidder');
    await page.getByRole('button', { name: 'Submit declaration' }).click();
    const coi = page.getByTestId('coi-panel');
    await expect(coi).toContainText('Awaiting decision');
    await expect(coi.getByRole('button', { name: /^Mark / })).toHaveCount(0); // not their own to decide
    await page.context().clearCookies();

    await signIn(page, 'delegate');
    await openPlan(page, id);
    await page.getByTestId('coi-panel').getByRole('button', { name: 'Mark manageable' }).click();
    await expect(page.getByTestId('coi-panel')).toContainText('Manageable');
    await expect(page.locator('[data-gate="UPFRONT_COI"]')).toHaveAttribute('data-status', 'SATISFIED');
  });
});

test.describe('US-PLN-04 reopening', () => {
  test('procurement reopens an approved plan with a reason; it becomes editable and the old approval stays as history', async ({
    page,
  }) => {
    const id = await submittedRequest(80_000, unique('Reopen'));
    await signIn(page, 'procurement');
    await openPlan(page, id);
    await page.getByRole('button', { name: 'Submit for approval' }).click();
    await page.context().clearCookies();
    await signIn(page, 'delegate');
    await openPlan(page, id);
    await page.getByRole('button', { name: 'Approve and lock' }).click();
    await expect(status(page)).toHaveAttribute('data-plan-status', 'APPROVED_LOCKED');
    await page.context().clearCookies();

    await signIn(page, 'requester');
    await openPlan(page, id);
    await expect(page.getByRole('button', { name: 'Reopen plan' })).toHaveCount(0); // requesters cannot reopen
    await page.context().clearCookies();

    await signIn(page, 'procurement');
    await openPlan(page, id);
    await page.getByRole('button', { name: 'Reopen plan' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Reopen' })).toBeDisabled();
    await dialog.getByLabel(/Reason/).fill('Evaluation criteria need to change');
    await dialog.getByRole('button', { name: 'Reopen' }).click();
    await expect(status(page)).toHaveAttribute('data-plan-status', 'REOPENED');
    await expect(page.getByLabel('Approval record')).toContainText('Superseded');
    await expect(page.getByRole('button', { name: 'Edit Background' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Submit for approval' })).toBeVisible();
  });
});

test.describe('access and accessibility', () => {
  test('evaluators and suppliers cannot open plans; an unknown plan is a 404', async ({ page }) => {
    await signIn(page, 'evaluator-tech');
    expect((await page.goto('/app/plans'))?.status()).toBe(403);
    await page.context().clearCookies();
    await signIn(page, 'procurement');
    expect((await page.goto('/app/plans/00000000-0000-4000-8000-000000000000'))?.status()).toBe(404);
  });

  for (const vp of [
    { name: 'mobile', width: 375, height: 812 },
    { name: 'desktop', width: 1280, height: 800 },
  ]) {
    test(`${vp.name}: plan list, draft plan and locked plan have no axe violations and no horizontal scroll`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const id = await submittedRequest(75_000, unique('A11y'));
      await signIn(page, 'procurement');
      const check = async (label: string) => {
        await page.evaluate(() => document.fonts.ready);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
          `${label} overflow`,
        ).toBeLessThanOrEqual(0);
        const r = await new AxeBuilder({ page }).withTags(WCAG).analyze();
        expect(
          r.violations.map((v) => `${label}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join('|')}`),
        ).toEqual([]);
      };
      await page.goto('/app/plans');
      await check('list');
      await openPlan(page, id);
      await check('draft');
      await page.getByRole('button', { name: 'Edit Objectives' }).click();
      await check('editing');
      await page.getByRole('button', { name: 'Cancel' }).click();
      await page.getByRole('button', { name: 'Submit for approval' }).click();
      await expect(status(page)).toHaveAttribute('data-plan-status', 'AWAITING_APPROVAL');
      await page.context().clearCookies();
      await signIn(page, 'delegate');
      await openPlan(page, id);
      await check('approver');
      await page.getByRole('button', { name: 'Approve and lock' }).click();
      await expect(status(page)).toHaveAttribute('data-plan-status', 'APPROVED_LOCKED');
      await check('locked');
    });
  }

  test('dark theme plan page has no axe violations', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('if-theme', 'dark'));
    const id = await submittedRequest(76_000, unique('Dark'));
    await signIn(page, 'procurement');
    await openPlan(page, id);
    const r = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });
});

test.describe('visual regression @visual', () => {
  // Request numbers, dates, names and figures vary between runs, so those regions are masked; layout is what is compared.
  const volatile = (page: Page) => [
    page.locator('h1'),
    page.getByTestId('key-points').locator('li'),
    page.locator('[data-paragraph]'),
    page.getByLabel('Approval record'),
    page.getByTestId('coi-panel').locator('li'),
  ];

  test('plan workspace for procurement, desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    const id = await submittedRequest(1_250_000, unique('Visual plan'));
    await signIn(page, 'procurement');
    await openPlan(page, id);
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot('plan-procurement-desktop.png', {
      maxDiffPixelRatio: 0.03,
      mask: volatile(page),
    });
  });

  test('approval on a phone: key points and decision first', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const id = await submittedRequest(90_000, unique('Visual approval'));
    await signIn(page, 'procurement');
    await openPlan(page, id);
    await page.getByRole('button', { name: 'Submit for approval' }).click();
    await expect(status(page)).toHaveAttribute('data-plan-status', 'AWAITING_APPROVAL');
    await page.context().clearCookies();
    await signIn(page, 'delegate');
    await openPlan(page, id);
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot('plan-approval-mobile.png', {
      maxDiffPixelRatio: 0.03,
      mask: volatile(page),
    });
  });
});
