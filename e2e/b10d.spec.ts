import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, email, signIn } from './helpers';

/** Roadmap batch B10 (AI layer, configuration, browser baseline, measured budget check) in the browser. */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const scan = async (page: Page) =>
  expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations).toEqual([]);

test.describe.configure({ mode: 'serial' });

const MODEL = 'sim-llm-careful-v1';
const card = (page: Page, id: string) => page.locator(`[data-testid="ai-model-card"][data-model="${id}"]`);

async function askAi(page: Page, q: string) {
  const answers = page.getByTestId('ai-answer');
  const before = await answers.count();
  if (!(await page.getByTestId('ask-ai-panel').isVisible())) await page.getByTestId('ask-ai-button').click();
  await page.getByLabel('Your question').fill(q);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(answers).toHaveCount(before + 1);
  return answers.last();
}

test.describe('NFR-C01, NFR-M06 and SEC-TP07 AI models', () => {
  test('a third-party model needs two people before it can be switched on, and revoking falls back at once', async ({
    page,
  }) => {
    // the administrator sees the models; nothing third-party can be made active yet
    await signIn(page, 'admin');
    await page.goto('/admin/ai-models');
    await expect(page.getByRole('heading', { name: 'AI models', exact: true })).toBeVisible();
    await expect(page.getByTestId('active-model')).toContainText('rules-simulated-v1');
    await expect(card(page, MODEL)).toContainText('Zero retention');
    await expect(card(page, MODEL).getByTestId('approval-state')).toHaveAttribute(
      'data-state',
      'NOT_REQUESTED',
    );
    await expect(
      card(page, MODEL).getByRole('button', { name: /Approve before switching on/ }),
    ).toBeDisabled();
    await scan(page);

    // the administrator asks; the person who asked has no way to decide
    await card(page, MODEL).getByLabel('Reason').fill('Pilot for recommendation summaries');
    await card(page, MODEL).getByRole('button', { name: 'Request approval' }).click();
    await expect(page.getByRole('status')).toContainText('Approval requested');
    await expect(card(page, MODEL).getByTestId('approval-state')).toHaveAttribute('data-state', 'REQUESTED');
    await expect(card(page, MODEL).getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);

    // probity decides in the approvals page
    await signIn(page, 'probity');
    await page.goto('/app/ai-models');
    await expect(page.getByRole('heading', { name: 'AI model approvals' })).toBeVisible();
    await expect(card(page, MODEL)).toContainText('Requested by Noah Kim');
    await scan(page);
    await card(page, MODEL).getByLabel('Reason').fill('Onshore, zero retention, reviewed');
    await card(page, MODEL).getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(card(page, MODEL).getByTestId('approval-state')).toHaveAttribute('data-state', 'APPROVED');

    // the administrator switches by configuration; Ask AI shows which model answered
    await signIn(page, 'admin');
    await page.goto('/admin/ai-models');
    await card(page, MODEL).getByRole('button', { name: 'Make active' }).click();
    await expect(page.getByTestId('active-model')).toContainText(MODEL);
    try {
      const a = await askAi(page, 'How does the workflow work?');
      await expect(a.getByTestId('ai-model')).toHaveText(MODEL);
      await expect(a.getByTestId('ai-footer')).toContainText('simulated third-party model');
      await scan(page);

      // probity withdraws the approval: the very next answer is the built-in model's
      await signIn(page, 'probity');
      await page.goto('/app/ai-models');
      await card(page, MODEL).getByLabel('Reason').fill('Vendor changed its terms');
      await card(page, MODEL).getByRole('button', { name: 'Revoke approval' }).click();
      await expect(card(page, MODEL).getByTestId('approval-state')).toHaveAttribute('data-state', 'REVOKED');
      await page.evaluate(() => sessionStorage.clear());
      const b = await askAi(page, 'How does the workflow work?');
      await expect(b.getByTestId('ai-model')).toHaveText('rules-simulated-v1');
    } finally {
      // leave the shared e2e database on the built-in model whatever happened above
      await signIn(page, 'admin');
      const csrf = (await (await page.request.get('/api/v1/auth/me')).json()).csrfToken as string;
      await page.request.put('/api/v1/ai/active-model', {
        headers: { 'x-csrf-token': csrf },
        data: { activeModel: 'rules-simulated-v1' },
      });
    }
  });

  test('only the roles that need it can open the pages', async ({ page }) => {
    await signIn(page, 'requester');
    await page.goto('/app/ai-models');
    await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
    await page.goto('/admin/ai-models');
    await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
  });
});

test.describe('NFR-M05 configuration inventory, export and import', () => {
  test('every setting is listed with where to change it; an import is previewed and then applied', async ({
    page,
  }) => {
    await signIn(page, 'admin');
    await page.goto('/admin/config');
    await expect(page.getByRole('heading', { name: 'Configuration', exact: true })).toBeVisible();
    const rows = page.getByTestId('config-row');
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThanOrEqual(28);
    await expect(page.locator('[data-testid="config-row"][data-section="approvalLinks"]')).toContainText(
      'Approve from a link',
    );
    await expect(page.getByTestId('config-export')).toHaveAttribute('href', '/api/v1/admin/config/export');
    await scan(page);

    const exp = await (await page.request.get('/api/v1/admin/config/export')).json();
    expect(JSON.stringify(exp)).not.toContain('"password');
    const original = JSON.stringify({ ...exp, sections: { approvalLinks: exp.sections.approvalLinks } });
    const changed = JSON.stringify({
      ...exp,
      sections: { approvalLinks: { ...exp.sections.approvalLinks, validHours: 12 } },
    });

    // invalid JSON is said plainly
    await page.getByLabel('Or paste it here').fill('{ not json');
    await page.getByRole('button', { name: 'Preview changes' }).click();
    await expect(page.getByTestId('import-preview')).toContainText('not valid JSON');

    await page.getByLabel('Or paste it here').fill(changed);
    await expect(page.getByRole('button', { name: 'Apply changes' })).toBeDisabled();
    await page.getByRole('button', { name: 'Preview changes' }).click();
    const preview = page.getByTestId('import-preview');
    await expect(preview).toContainText('Preview, nothing applied yet');
    await expect(preview).toContainText('validHours');
    await expect(preview).toContainText('12');
    await scan(page);
    // nothing has changed yet
    const cur = await (await page.request.get('/api/v1/admin/settings')).json();
    expect(cur.approvalLinks.validHours).toBe(exp.sections.approvalLinks.validHours);

    await page.getByRole('button', { name: 'Apply changes' }).click();
    await expect(preview).toContainText('Applied');
    const after = await (await page.request.get('/api/v1/admin/settings')).json();
    expect(after.approvalLinks.validHours).toBe(12);
    await expect(page.locator('[data-testid="config-row"][data-section="approvalLinks"]')).toContainText(
      'Noah Kim',
    );

    // put it back through the same screen
    await page.getByLabel('Or paste it here').fill(original);
    await page.getByRole('button', { name: 'Preview changes' }).click();
    await expect(preview).toContainText('validHours');
    await page.getByRole('button', { name: 'Apply changes' }).click();
    await expect(preview).toContainText('Applied');
    expect((await (await page.request.get('/api/v1/admin/settings')).json()).approvalLinks.validHours).toBe(
      exp.sections.approvalLinks.validHours,
    );
  });
});

test.describe('NFR-C08 browser and operating-system baseline', () => {
  test('the baseline is public and accessible without signing in', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/browser-support');
    await expect(page.getByRole('heading', { name: 'Supported browsers and devices' })).toBeVisible();
    await expect(page.getByRole('table', { name: /Supported browsers/ })).toContainText('Chrome');
    await expect(page.getByRole('table', { name: /Supported browsers/ })).toContainText('120 or later');
    await expect(page.getByRole('table', { name: /Supported browsers/ })).toContainText('17 or later');
    await expect(page.getByRole('table', { name: /Supported operating systems/ })).toContainText('Windows');
    await scan(page);
  });

  test('an old browser gets a polite, dismissible notice after sign-in and is counted; a current one gets none', async ({
    browser,
  }) => {
    const OLD =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36';
    const ctx = await browser.newContext({
      userAgent: OLD,
      baseURL: test.info().project.use.baseURL as string,
    });
    const page = await ctx.newPage();
    await page.goto('/login');
    await expect(page.getByTestId('browser-notice')).toContainText('older than the supported minimum');
    await page.getByLabel(/Email/).fill(email('requester'));
    await page.getByLabel(/Password/).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByTestId('shell')).toBeVisible();
    const notice = page.getByTestId('browser-notice');
    await expect(notice).toContainText('Chrome 120');
    await expect(notice.getByRole('link', { name: 'See the supported browsers' })).toHaveAttribute(
      'href',
      '/browser-support',
    );
    // never blocking: the page is usable with the notice showing
    await expect(page.getByRole('link', { name: 'Requests' }).first()).toBeVisible();
    await scan(page);
    await notice.getByRole('button', { name: 'Dismiss browser notice' }).click();
    await expect(notice).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('shell')).toBeVisible();
    await expect(page.getByTestId('browser-notice')).toHaveCount(0);
    await ctx.close();

    // the administrator sees the count
    const admin = await browser.newContext({ baseURL: test.info().project.use.baseURL as string });
    const p2 = await admin.newPage();
    await signIn(p2, 'admin');
    await p2.goto('/admin/config');
    await expect(p2.getByTestId('client-baseline')).toContainText(/did not/);
    await expect(p2.getByTestId('client-baseline').getByRole('table')).toContainText('Chrome');
    await expect(p2.getByTestId('browser-notice')).toHaveCount(0); // the test browser itself is current
    await admin.close();
  });
});

test.describe('NFR-P04 the budget check inside the intake conversation, measured', () => {
  test('a stated value brings the budget outcome back in the same reply, and the measurement is shown', async ({
    page,
  }) => {
    await signIn(page, 'requester');
    await page.goto('/app/requests/new');
    await expect(page.getByRole('log', { name: 'Conversation' })).toContainText('Describe what you need');
    const say = async (text: string) => {
      const before = await page.locator('[data-role="ASSISTANT"]').count();
      await page.getByLabel('Describe what you need or answer the question').fill(text);
      await page.getByRole('button', { name: 'Send message' }).click();
      await expect(page.locator('[data-role="ASSISTANT"]')).toHaveCount(before + 1, { timeout: 15_000 });
    };
    await say('Cleaning services for Facilities, 36 months, about $80k');
    await expect(page.locator('[data-role="ASSISTANT"]').last()).toContainText('Budget check: within budget');
    await say('Actually the value is $3M');
    await expect(page.locator('[data-role="ASSISTANT"]').last()).toContainText('hard cap exceeded');

    await signIn(page, 'admin');
    await page.goto('/admin/performance');
    await expect(page.getByRole('heading', { name: 'Performance', exact: true })).toBeVisible();
    await expect(page.getByTestId('perf-verdict')).toContainText('Pass');
    const count = Number(await page.getByTestId('perf-count').innerText());
    expect(count).toBeGreaterThanOrEqual(2);
    await expect(page.getByTestId('perf-target')).toContainText('2,000 ms');
    await expect(page.getByTestId('perf-p95')).toContainText(/ms/);
    await scan(page);
  });
});
