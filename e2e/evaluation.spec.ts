import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, request as pwRequest, test, type APIRequestContext, type Page } from '@playwright/test';
import { API_URL } from '../playwright.config';

// Synthetic demo password given to the e2e API server in playwright.config.ts.
const PASSWORD = 'E2e-Only-Passw0rd!2026';
const SUPPLIER_PASSWORD = 'Supplier-E2e-Passw0rd-1';
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const email = (u: string) => `${u}@meridian-demo.example`;
const rand = () => Math.random().toString(36).slice(2, 8);
const PDF = Buffer.from('%PDF-1.7\nTECHNICAL-CONTENT-MARKER');
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('COMMERCIAL-PRICING-MARKER')]);

async function signIn(page: Page, user: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel(/Email/).fill(email(user));
  await page.getByLabel(/Password/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('shell')).toBeVisible();
}

/** A checksum-valid ABN that is different on every call (the registration check is the real ABN algorithm). */
let abnSeq = 1000 + Math.floor(Math.random() * 8_000_000); // random start: parallel workers must never reuse an ABN
function newAbn(): string {
  const w = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  for (;;) {
    abnSeq += 1;
    const body = String(abnSeq).padStart(9, '0');
    for (let c = 10; c < 100; c++) {
      const abn = `${c}${body}`;
      const sum = [...abn].reduce((acc, ch, i) => acc + (i === 0 ? Number(ch) - 1 : Number(ch)) * w[i]!, 0);
      if (sum % 89 === 0) return abn;
    }
  }
}

async function login(api: APIRequestContext, mail: string, password = PASSWORD) {
  const r = await api.post('/api/v1/auth/login', { data: { email: mail, password } });
  expect(r.ok(), await r.text()).toBeTruthy();
  return { 'x-csrf-token': (await r.json()).csrfToken as string };
}

/**
 * Builds, through the API (fast set-up), a tender that has closed with two submitted bids; everything under test then
 * happens in the browser. The closing time is backdated by the test-only API entry point (apps/api/src/e2e-main.ts).
 */
async function closedTender(title: string, bidders = 2): Promise<{ tenderId: string; companies: string[] }> {
  const api = await pwRequest.newContext({ baseURL: API_URL });
  const requester = await login(api, email('requester'));
  const c = await api.post('/api/v1/requests', {
    headers: requester,
    data: {
      title,
      category: 'Building cleaning (UNSPSC 76111500)',
      estimatedValue: 90_000,
      termMonths: 24,
      businessUnit: 'Facilities',
      fields: { contractOwner: 'Sofia Rossi', background: 'Existing arrangements end in six months.' },
    },
  });
  const requestId = (await c.json()).id as string;
  expect((await api.post(`/api/v1/requests/${requestId}/submit`, { headers: requester })).ok()).toBeTruthy();
  const proc = await login(api, email('procurement'));
  const plan = await (await api.get(`/api/v1/requests/${requestId}/plan`)).json();
  expect(
    (await api.post(`/api/v1/plans/${plan.id}/submit-for-approval`, { headers: proc })).ok(),
  ).toBeTruthy();
  const del = await login(api, email('delegate'));
  expect(
    (
      await api.post(`/api/v1/plans/${plan.id}/decision`, { headers: del, data: { decision: 'APPROVE' } })
    ).ok(),
  ).toBeTruthy();
  const procAgain = await login(api, email('procurement'));
  const t = await (
    await api.post('/api/v1/tenders', { headers: procAgain, data: { requestId, type: 'RFT' } })
  ).json();
  const delAgain = await login(api, email('delegate'));
  expect(
    (await api.post(`/api/v1/tenders/${t.id}/publish-permission`, { headers: delAgain, data: {} })).ok(),
  ).toBeTruthy();
  const closesAt = new Date(Date.now() + 26 * 86_400_000).toISOString();
  const procPublish = await login(api, email('procurement')); // one cookie jar, one session at a time: log in again right before use
  const pub = await api.post(`/api/v1/tenders/${t.id}/publish`, { headers: procPublish, data: { closesAt } });
  expect(pub.ok(), await pub.text()).toBeTruthy();

  const companies: string[] = [];
  for (let i = 0; i < bidders; i++) {
    const company = `Eval Bidder ${['Alpha', 'Bravo', 'Charlie'][i]} ${rand()} Pty Ltd`;
    companies.push(company);
    const mail = `bids-${rand()}@eval-bidder.example`;
    const inv = await (
      await api.post(`/api/v1/tenders/${t.id}/invitations`, {
        headers: procPublish,
        data: { invitees: [{ email: mail, company }] },
      })
    ).json();
    const token = new URL(inv.invitations[0].registerPath, 'http://x').searchParams.get('token')!;
    const anon = await pwRequest.newContext({ baseURL: API_URL });
    const reg = await anon.post('/api/v1/supplier/register', {
      data: { token, name: 'Bea Bidder', email: mail, company, abn: newAbn(), password: SUPPLIER_PASSWORD },
    });
    expect(reg.ok(), await reg.text()).toBeTruthy();
    const sup = await pwRequest.newContext({ baseURL: API_URL });
    const sh = await login(sup, mail, SUPPLIER_PASSWORD);
    for (const [name, section, bytes] of [
      ['technical.pdf', 'TECHNICAL', PDF],
      ['pricing.xlsx', 'COMMERCIAL', ZIP],
    ] as const) {
      const up = await sup.post(`/api/v1/supplier/tenders/${t.id}/submission/files`, {
        headers: sh,
        data: { name, section, dataBase64: bytes.toString('base64') },
      });
      expect(up.ok(), await up.text()).toBeTruthy();
    }
    expect(
      (await sup.post(`/api/v1/supplier/tenders/${t.id}/submission`, { headers: sh })).ok(),
    ).toBeTruthy();
    await sup.dispose();
    await anon.dispose();
  }
  expect((await api.post(`${API_URL}/__e2e/expire-tender/${t.id}`)).status()).toBe(204);
  // any read closes it (automatic close at the closing time)
  const after = await (await api.get(`/api/v1/tenders/${t.id}`, { headers: {} })).json();
  expect(after.status).toBe('CLOSED');
  await api.dispose();
  return { tenderId: t.id as string, companies };
}

const workspace = (page: Page) => page.getByTestId('evaluation-workspace');
const fillScores = async (page: Page, value: (supplierIndex: number, criterionIndex: number) => string) => {
  const suppliers = page.getByTestId('score-supplier');
  const n = await suppliers.count();
  for (let s = 0; s < n; s++) {
    const inputs = suppliers.nth(s).locator('input[type="number"]');
    const k = await inputs.count();
    for (let c = 0; c < k; c++) await inputs.nth(c).fill(value(s, c));
    await suppliers
      .nth(s)
      .getByRole('button', { name: /Save scores/ })
      .click();
    await expect(page.getByText(new RegExp(`${(s + 1) * k} of ${n * k} saved`))).toBeVisible();
  }
};

test.describe
  .serial('evaluation journey: panel, conflicts, hidden scoring, consensus, lock, report, approval', () => {
  const title = `Evaluation journey ${rand()}`;
  let companies: string[] = [];
  let evalUrl = '';

  test('US-EVL-02: procurement sets up the panel for a closed tender', async ({ page }) => {
    ({ companies } = await closedTender(title));
    await signIn(page, 'procurement');
    await page.goto('/app/evaluations');
    const row = page.getByTestId('ready-tender').filter({ hasText: title });
    await expect(row).toContainText('2 bid(s) received');
    await row.getByRole('button', { name: /Set up the evaluation/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('checkbox', { name: 'Tomas Silva' }).check();
    await dialog.getByRole('checkbox', { name: 'Mei Tanaka' }).check();
    await dialog.getByLabel('Stream for Mei Tanaka').selectOption('COMMERCIAL');
    await expect(dialog).toContainText('chairs the panel and is added automatically');
    await dialog.getByRole('button', { name: 'Open evaluation' }).click();
    await expect(workspace(page)).toHaveAttribute('data-status', 'COI_PENDING');
    evalUrl = page.url();
    const panel = page.getByTestId('panel-card');
    await expect(panel).toContainText('Tomas Silva');
    await expect(panel).toContainText('Mei Tanaka');
    await expect(panel.locator('[data-coi="NOT_DECLARED"]')).toHaveCount(3); // two evaluators and the chair
  });

  test('US-EVL-01: before declaring, suppliers are anonymous and documents are withheld; afterwards each stream sees its own files', async ({
    page,
  }) => {
    await signIn(page, 'evaluator-tech');
    await page.goto(evalUrl);
    await expect(page.getByTestId('anonymised-note')).toBeVisible();
    await expect(page.getByTestId('supplier-row').first()).toContainText('Supplier A');
    for (const c of companies) await expect(page.locator('main')).not.toContainText(c);
    await expect(page.getByTestId('scoring-sheet')).toHaveCount(0);
    await expect(page.getByTestId('supplier-row').getByRole('link')).toHaveCount(0);
    await page.getByRole('radio', { name: /no conflict of interest/ }).check();
    await page.getByRole('button', { name: 'Submit declaration' }).click();
    await expect(page.getByTestId('coi-gate')).toHaveCount(0);
    for (const c of companies) await expect(page.getByTestId('suppliers-card')).toContainText(c);
    await expect(page.getByRole('link', { name: /technical\.pdf/ }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /pricing\.xlsx/ })).toHaveCount(0); // a technical evaluator never sees pricing

    await signIn(page, 'evaluator-comm');
    await page.goto(evalUrl);
    await page.getByRole('radio', { name: /no conflict of interest/ }).check();
    await page.getByRole('button', { name: 'Submit declaration' }).click();
    await expect(page.getByRole('link', { name: /pricing\.xlsx/ }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /technical\.pdf/ })).toHaveCount(0);

    await signIn(page, 'chair');
    await page.goto(evalUrl);
    await page.getByRole('radio', { name: /no conflict of interest/ }).check();
    await page.getByRole('button', { name: 'Submit declaration' }).click();
    await expect(workspace(page)).toHaveAttribute('data-status', 'SCORING'); // everyone has declared
  });

  test('US-EVL-03: each evaluator scores only what their stream may see, and cannot finish with cells missing', async ({
    page,
  }) => {
    // technical: three criteria, never price. Technical capability 9 (the chair will say 5).
    await signIn(page, 'evaluator-tech');
    await page.goto(evalUrl);
    await expect(page.getByTestId('scoring-sheet')).toBeVisible();
    await expect(page.getByTestId('scoring-sheet')).not.toContainText('Price');
    await expect(page.getByTestId('score-supplier').first().locator('input[type="number"]')).toHaveCount(3);
    const submit = page.getByRole('button', { name: 'Mark my scoring complete' });
    await expect(submit).toBeDisabled();
    await fillScores(page, (_s, c) => (c === 0 ? '9' : '7'));
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByRole('heading', { name: 'Your scores are in' })).toBeVisible();

    // commercial: price and the shared criterion only
    await signIn(page, 'evaluator-comm');
    await page.goto(evalUrl);
    await expect(page.getByTestId('scoring-sheet')).not.toContainText('Technical capability');
    await expect(page.getByTestId('scoring-sheet')).toContainText('Price');
    await expect(page.getByTestId('score-supplier').first().locator('input[type="number"]')).toHaveCount(2);
    await fillScores(page, () => '7');
    await page.getByRole('button', { name: 'Mark my scoring complete' }).click();
    await expect(page.getByRole('heading', { name: 'Your scores are in' })).toBeVisible();

    // nobody can see anyone else's scores while scoring is open: not the chair, not procurement, not probity
    for (const who of ['procurement', 'probity']) {
      await signIn(page, who);
      await page.goto(evalUrl);
      await expect(workspace(page)).toBeVisible();
      await expect(page.getByTestId('consensus-panel')).toHaveCount(0);
      await expect(page.getByTestId('scoring-sheet')).toHaveCount(0);
    }
    await signIn(page, 'chair');
    await page.goto(evalUrl);
    await expect(
      page.getByTestId('chair-panel').getByRole('button', { name: 'Open consensus' }),
    ).toBeDisabled(); // the chair has not scored yet
    await expect(page.getByTestId('scoring-sheet')).toBeVisible();
    await fillScores(page, (_s, c) => (c === 0 ? '5' : '7')); // technical capability first (highest weight)
    await page.getByRole('button', { name: 'Mark my scoring complete' }).click();
    await expect(
      page.getByTestId('chair-panel').getByRole('button', { name: 'Open consensus' }),
    ).toBeEnabled();
  });

  test('US-EVL-04: the chair opens consensus; differences above 30% are flagged and block the lock until a reason is recorded', async ({
    page,
  }) => {
    await signIn(page, 'chair');
    await page.goto(evalUrl);
    await page.getByTestId('chair-panel').getByRole('button', { name: 'Open consensus' }).click();
    await expect(workspace(page)).toHaveAttribute('data-status', 'CONSENSUS');
    const flagged = page.locator('[data-testid="consensus-item"][data-flagged="true"]');
    await expect(flagged).toHaveCount(2); // technical capability for both suppliers: 9 against 5
    await expect(flagged.first()).toContainText('44.44% apart');
    await expect(flagged.first().getByLabel('Individual scores')).toContainText('Tomas Silva');

    const lock = page.getByRole('button', { name: 'Lock consensus' });
    await lock.click();
    await expect(page.locator('main [role="alert"]')).toContainText(/still need a consensus value/);

    // the average is offered only where scorers agree; the two flagged scores stay empty for a human to decide
    await page.getByRole('button', { name: 'Use the average where scorers agree' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: '2 flagged score(s) still need a reason.' }),
    ).toBeVisible();
    const agreeing = page.locator('[data-testid="consensus-item"][data-flagged="false"]');
    for (let i = 0; i < (await agreeing.count()); i++)
      await expect(agreeing.nth(i).locator('input[type="number"]')).toHaveValue('7');
    for (let i = 0; i < (await flagged.count()); i++) {
      await expect(flagged.nth(i).locator('input[type="number"]')).toHaveValue('');
      await flagged.nth(i).locator('input[type="number"]').fill('7'); // agreed value, reason still to come
    }
    const suppliers = page.getByTestId('consensus-supplier');
    for (let s = 0; s < (await suppliers.count()); s++) {
      await suppliers
        .nth(s)
        .getByRole('button', { name: /Save consensus/ })
        .click();
      await expect(page.getByRole('status').filter({ hasText: 'Consensus saved' })).toBeVisible();
    }
    await lock.click();
    await expect(page.locator('main [role="alert"]')).toContainText(
      /flagged score\(s\) need a recorded rationale/,
    );
    await expect(workspace(page)).toHaveAttribute('data-status', 'CONSENSUS');

    for (let i = 0; i < (await flagged.count()); i++)
      await flagged
        .nth(i)
        .getByRole('textbox', { name: /Why the panel settled/ })
        .fill('The panel agreed a midpoint after discussing the site plan.');
    for (let s = 0; s < (await suppliers.count()); s++) {
      await suppliers
        .nth(s)
        .getByRole('button', { name: /Save consensus/ })
        .click();
      await expect(page.getByRole('status').filter({ hasText: 'Consensus saved' })).toBeVisible();
    }
    await lock.click();
    await expect(workspace(page)).toHaveAttribute('data-status', 'LOCKED');
    await expect(page.getByTestId('ranking')).toContainText('/ 100');
  });

  test('US-EVL-05: procurement generates the report; a delegate approves it and it is stamped', async ({
    page,
  }) => {
    await signIn(page, 'procurement');
    await page.goto(evalUrl);
    await page.getByRole('button', { name: 'Generate report' }).click();
    const report = page.getByTestId('report-panel');
    await expect(report).toContainText('Awaiting approval');
    for (const s of ['summary', 'process', 'ranking', 'commentary', 'recommendation'])
      await expect(report.locator(`[data-report-section="${s}"]`)).toBeVisible();
    await expect(report.locator('[data-report-section="process"]')).toContainText(
      'did not have access to pricing',
    );
    await expect(report.locator('[data-report-section="process"]')).toContainText(
      'The panel agreed a midpoint',
    );
    await expect(report.locator('[data-report-section="ranking"]')).toContainText('out of 100');
    await expect(report).toContainText('Generated');

    await signIn(page, 'delegate');
    await page.goto(evalUrl);
    await page.getByTestId('report-panel').getByRole('button', { name: 'Approve report' }).click();
    await expect(page.getByTestId('report-stamp')).toContainText('REPORT APPROVED');
    await expect(workspace(page)).toHaveAttribute('data-status', 'APPROVED');
  });

  test('accessibility and layout: list and workspace on a phone and a desktop', async ({ page }) => {
    test.setTimeout(120_000);
    for (const vp of [
      { name: 'phone', width: 375, height: 812 },
      { name: 'desktop', width: 1280, height: 900 },
    ]) {
      await page.setViewportSize(vp);
      await signIn(page, 'chair');
      for (const path of ['/app/evaluations', evalUrl]) {
        await page.goto(path);
        await page.evaluate(() => document.fonts.ready);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
          `${path} ${vp.name}`,
        ).toBeLessThanOrEqual(0);
        const r = await new AxeBuilder({ page }).withTags(WCAG).analyze();
        expect(
          r.violations.map(
            (v) => `${path} ${vp.name}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join('|')}`,
          ),
        ).toEqual([]);
      }
    }
  });
});

test.describe('the seeded evaluation, oversight and access', () => {
  const seededUrl = async (page: Page) => {
    await page.goto('/app/evaluations');
    await page
      .getByRole('table', { name: 'Evaluations' })
      .getByRole('link', { name: 'Facilities cleaning services' })
      .click();
    await expect(workspace(page)).toBeVisible();
  };

  test("the chair sees the one flagged score with each evaluator's number and cannot lock until it has a reason", async ({
    page,
  }) => {
    await signIn(page, 'chair');
    await seededUrl(page);
    await expect(workspace(page)).toHaveAttribute('data-status', 'CONSENSUS');
    const flagged = page.locator('[data-testid="consensus-item"][data-flagged="true"]');
    await expect(flagged).toHaveCount(1);
    await expect(flagged).toContainText('37.5% apart');
    await page.getByRole('button', { name: 'Lock consensus' }).click();
    await expect(page.locator('main [role="alert"]')).toContainText(
      /still need a consensus value|need a recorded rationale/,
    );
    await expect(workspace(page)).toHaveAttribute('data-status', 'CONSENSUS');
  });

  test('probity and the executive can read but cannot change anything; an evaluator sees no consensus and no price', async ({
    page,
  }) => {
    for (const who of ['probity', 'exec']) {
      await signIn(page, who);
      await seededUrl(page);
      await expect(page.getByRole('button', { name: 'Lock consensus' })).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: /Save consensus|Open consensus|Mark my scoring/ }),
      ).toHaveCount(0);
    }
    await signIn(page, 'probity');
    await seededUrl(page);
    await expect(page.getByTestId('consensus-panel')).toContainText('37.5% apart'); // oversight sees the discussion, read-only
    await signIn(page, 'evaluator-tech');
    await seededUrl(page);
    await expect(page.getByTestId('consensus-panel')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('Price');
  });

  test('people who are not on a panel or have no role here cannot open an evaluation', async ({ page }) => {
    await signIn(page, 'chair');
    await seededUrl(page);
    const url = page.url();
    for (const who of ['requester', 'finance', 'admin']) {
      await signIn(page, who);
      expect((await page.goto(url))?.status(), who).toBe(403);
    }
    await page.context().clearCookies();
    await page.goto(url);
    await expect(page).toHaveURL(/\/login/);
  });
});

// ---------------------------------------------------------------- follow-up features, through the real screens
/** Logs in once per person through the API, with its own cookie jar, so several people can act in one test. */
async function apiAs(user: string) {
  const api = await pwRequest.newContext({ baseURL: API_URL });
  const headers = await login(api, email(user));
  return { api, headers };
}
/** Opens an evaluation by API (Tomas = technical, Mei = commercial, chair added automatically) and returns its id. */
async function openEvaluationApi(tenderId: string): Promise<string> {
  const { api, headers } = await apiAs('procurement');
  const people = await (await api.get('/api/v1/evaluators')).json();
  const id = (n: string) => people.evaluators.find((p: { name: string }) => p.name === n).id as string;
  const r = await api.post(`/api/v1/tenders/${tenderId}/evaluation`, {
    headers,
    data: {
      panel: [
        { userId: id('Tomas Silva'), stream: 'TECHNICAL' },
        { userId: id('Mei Tanaka'), stream: 'COMMERCIAL' },
      ],
    },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  const body = await r.json();
  await api.dispose();
  return body.id as string;
}
async function apiDeclareNone(user: string, evalId: string) {
  const { api, headers } = await apiAs(user);
  expect(
    (await api.post(`/api/v1/evaluations/${evalId}/coi`, { headers, data: { none: true } })).ok(),
  ).toBeTruthy();
  await api.dispose();
}
async function apiScoreAndSubmit(user: string, evalId: string) {
  const { api, headers } = await apiAs(user);
  const mine = await (await api.get(`/api/v1/evaluations/${evalId}/scores/mine`)).json();
  for (const s of mine.suppliers)
    expect(
      (
        await api.put(`/api/v1/evaluations/${evalId}/scores`, {
          headers,
          data: {
            supplierId: s.supplierId,
            scores: mine.criteria.map((c: { id: string; passFail: boolean }) => ({
              criterionId: c.id,
              score: c.passFail ? 10 : 7,
            })),
          },
        })
      ).ok(),
    ).toBeTruthy();
  expect((await api.post(`/api/v1/evaluations/${evalId}/scores/submit`, { headers })).ok()).toBeTruthy();
  await api.dispose();
}
async function apiConsensusAndLock(evalId: string) {
  const { api, headers } = await apiAs('chair');
  const open = await (await api.post(`/api/v1/evaluations/${evalId}/consensus/open`, { headers })).json();
  for (const s of open.suppliers)
    expect(
      (
        await api.put(`/api/v1/evaluations/${evalId}/consensus/${s.supplierId}`, {
          headers,
          data: {
            items: open.criteria.map((c: { id: string }) => ({ criterionId: c.id, consensusScore: 7 })),
          },
        })
      ).ok(),
    ).toBeTruthy();
  expect((await api.post(`/api/v1/evaluations/${evalId}/consensus/lock`, { headers })).ok()).toBeTruthy();
  await api.dispose();
}
async function download(page: Page, click: () => Promise<unknown>) {
  const [dl] = await Promise.all([page.waitForEvent('download'), click()]);
  const path = await dl.path();
  return { name: dl.suggestedFilename(), bytes: readFileSync(path) };
}

test.describe('downloads, conflict review, reopening consensus and the PDF report', () => {
  test('bid documents download and are real files: a PDF and an Excel workbook', async ({ page }) => {
    await signIn(page, 'chair');
    await page.goto('/app/evaluations');
    await page
      .getByRole('table', { name: 'Evaluations' })
      .getByRole('link', { name: 'Facilities cleaning services' })
      .click();
    await expect(workspace(page)).toBeVisible();
    const pdf = await download(page, () =>
      page
        .getByRole('link', { name: /technical-response\.pdf/ })
        .first()
        .click(),
    );
    expect(pdf.name).toBe('technical-response.pdf');
    expect(pdf.bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.bytes.toString('latin1')).toContain('Technical response');
    const xlsx = await download(page, () =>
      page
        .getByRole('link', { name: /pricing-schedule\.xlsx/ })
        .first()
        .click(),
    );
    expect(xlsx.name).toBe('pricing-schedule.xlsx');
    expect(xlsx.bytes.subarray(0, 2).toString()).toBe('PK'); // an Excel workbook is a zip archive
  });

  test('a declared conflict suspends the evaluator; a delegate reinstates them; the chair can reopen a locked consensus; the report downloads as a PDF', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const { tenderId } = await closedTender(`Conflict and reopen ${rand()}`);
    const evalId = await openEvaluationApi(tenderId);
    const url = `/app/evaluations/${evalId}`;

    // 1. Mei declares a conflict through the screen: she is told, and loses access at once
    await signIn(page, 'evaluator-comm');
    await page.goto(url);
    await page.getByRole('radio', { name: /conflict to declare/ }).check();
    await page
      .getByLabel(/Describe the conflict/)
      .fill('My brother-in-law is a director of one of the bidders.');
    await page.getByRole('button', { name: 'Submit declaration' }).click();
    await expect(page).toHaveURL(/\/app\/evaluations\?conflict=1/);
    await expect(page.getByTestId('conflict-notice')).toContainText('A delegate will decide');
    expect((await page.goto(url))?.status()).toBe(404);

    // 2. the delegate sees it and reinstates her
    await signIn(page, 'delegate');
    await page.goto(url);
    const review = page.getByTestId('conflict-review');
    await expect(review).toContainText('Mei Tanaka');
    await expect(review).toContainText('Awaiting decision');
    await expect(review).toContainText('brother-in-law');
    await review
      .getByLabel('Reason for your decision (optional)')
      .fill('Remote and declared; independent scoring protects the process.');
    await page.getByRole('button', { name: 'Manageable: reinstate Mei Tanaka' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Decision recorded.' })).toBeVisible();
    await expect(review).toContainText('Manageable: reinstated');
    await expect(page.getByTestId('panel-card').locator('[data-coi="DECLARED_NONE"]')).toContainText(
      'Mei Tanaka',
    );
    await expect(review.getByRole('button', { name: /reinstate|remove/i })).toHaveCount(0); // decided once

    // 3. she is back: names and her own files are visible and, once the others declare, she can score
    await apiDeclareNone('evaluator-tech', evalId);
    await apiDeclareNone('chair', evalId);
    await signIn(page, 'evaluator-comm');
    await page.goto(url);
    await expect(page.getByTestId('stage-guide')).toContainText('scoring independently');
    await expect(page.getByTestId('scoring-sheet')).toBeVisible();
    await expect(page.getByRole('link', { name: /pricing\.xlsx/ }).first()).toBeVisible();

    // 4. scoring, consensus and lock (by API, already covered through the screens above)
    for (const u of ['evaluator-tech', 'evaluator-comm', 'chair']) await apiScoreAndSubmit(u, evalId);
    await apiConsensusAndLock(evalId);

    // 5. procurement generates the report and downloads it as a PDF
    await signIn(page, 'procurement');
    await page.goto(url);
    await page.getByRole('button', { name: 'Generate report' }).click();
    await expect(page.getByTestId('report-panel')).toContainText('Awaiting approval');
    const pdf = await download(page, () => page.getByRole('link', { name: 'Download PDF' }).click());
    expect(pdf.name).toMatch(/^evaluation-report-PR-\d{4}-\d{4}-v\d+\.pdf$/);
    expect(pdf.bytes.subarray(0, 5).toString()).toBe('%PDF-');
    const text = pdf.bytes.toString('latin1');
    expect(text).toContain('(Evaluation report) Tj');
    expect(text).toContain('Eval Bidder Alpha');
    expect(text).toMatch(/version \d+/);
    expect(text).toContain('Awaiting approval');

    // 6. the chair reopens the locked consensus with a reason; the old report no longer stands
    await signIn(page, 'chair');
    await page.goto(url);
    await expect(page.getByTestId('reopen-card')).toBeVisible();
    await page.getByTestId('reopen-card').getByRole('button', { name: 'Reopen consensus' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Reopen' })).toBeDisabled(); // a reason is required
    await dialog.getByLabel(/Reason/).fill('A bidder supplied a clarification after the lock.');
    await dialog.getByRole('button', { name: 'Reopen' }).click();
    await expect(workspace(page)).toHaveAttribute('data-status', 'CONSENSUS');
    await expect(page.getByTestId('report-panel')).toContainText('Needs regenerating');
    await expect(page.getByRole('button', { name: 'Lock consensus' })).toBeVisible();
    await page.getByRole('button', { name: 'Lock consensus' }).click(); // the agreed values were kept
    await expect(workspace(page)).toHaveAttribute('data-status', 'LOCKED');

    // 7. procurement regenerates, the delegate approves; after approval nobody can reopen
    await signIn(page, 'procurement');
    await page.goto(url);
    await page.getByRole('button', { name: 'Regenerate report' }).click();
    await expect(page.getByTestId('report-panel')).toContainText('Awaiting approval');
    await signIn(page, 'delegate');
    await page.goto(url);
    await page.getByRole('button', { name: 'Approve report' }).click();
    await expect(workspace(page)).toHaveAttribute('data-status', 'APPROVED');
    const approved = await download(page, () => page.getByRole('link', { name: 'Download PDF' }).click());
    expect(approved.bytes.toString('latin1')).toContain('REPORT APPROVED');
    await signIn(page, 'chair');
    await page.goto(url);
    await expect(page.getByTestId('reopen-card')).toHaveCount(0);
  });

  test('a material conflict removes the evaluator for good', async ({ page }) => {
    const { tenderId } = await closedTender(`Material conflict ${rand()}`);
    const evalId = await openEvaluationApi(tenderId);
    const url = `/app/evaluations/${evalId}`;
    await signIn(page, 'evaluator-tech');
    await page.goto(url);
    await page.getByRole('radio', { name: /conflict to declare/ }).check();
    await page.getByLabel(/Describe the conflict/).fill('I was employed by a bidder last year.');
    await page.getByRole('button', { name: 'Submit declaration' }).click();
    await expect(page).toHaveURL(/conflict=1/);
    await signIn(page, 'delegate');
    await page.goto(url);
    await page.getByRole('button', { name: 'Material: remove Tomas Silva' }).click();
    await expect(page.getByTestId('conflict-review')).toContainText('Material: removed');
    await expect(page.getByTestId('panel-card').locator('[data-coi="REMOVED"]')).toContainText('Tomas Silva');
    await signIn(page, 'evaluator-tech');
    expect((await page.goto(url))?.status()).toBe(404);
  });
});
