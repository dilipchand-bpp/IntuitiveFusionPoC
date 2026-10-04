import { expect, request as pwRequest, test, type APIRequestContext, type Page } from '@playwright/test';
import { API_URL } from '../playwright.config';

/**
 * M15 skeleton end-to-end smoke: ONE stitched journey, in the order the business runs it:
 * request -> plan approved -> tender published -> bids submitted -> evaluation -> report approved -> contract signed
 * -> alerts -> dashboard and audit trail.
 *
 * Every stage is carried out by the person who does it, in the browser. Only the supplier uploads and the evaluators'
 * individual scoring (long, repetitive forms covered stage by stage in the module specs) are driven through the API.
 * Each stage then checks what the next person sees, so a broken hand-over fails here, not in front of a user.
 */
const PASSWORD = 'E2e-Only-Passw0rd!2026';
const SUPPLIER_PASSWORD = 'Supplier-E2e-Passw0rd-1';
const email = (u: string) => `${u}@meridian-demo.example`;
const rand = () => Math.random().toString(36).slice(2, 8);
const PDF = Buffer.from('%PDF-1.7\nSKELETON-TECHNICAL');
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('SKELETON-PRICING')]);

async function signIn(page: Page, user: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel(/Email/).fill(email(user));
  await page.getByLabel(/Password/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('shell')).toBeVisible();
}

async function login(api: APIRequestContext, mail: string, password = PASSWORD) {
  const r = await api.post('/api/v1/auth/login', { data: { email: mail, password } });
  expect(r.ok(), await r.text()).toBeTruthy();
  return { 'x-csrf-token': (await r.json()).csrfToken as string };
}
async function apiAs(user: string) {
  const api = await pwRequest.newContext({ baseURL: API_URL });
  return { api, headers: await login(api, email(user)) };
}

/** A checksum-valid ABN, different on every call (supplier registration runs the real ABN check). */
let abnSeq = 2_000_000 + Math.floor(Math.random() * 6_000_000);
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

/** Two suppliers register from their invitations and submit a technical and a commercial file each. */
async function bidAndClose(tenderId: string, bidders = 2) {
  const { api, headers } = await apiAs('procurement');
  for (let i = 0; i < bidders; i++) {
    const company = `Skeleton Bidder ${['Alpha', 'Bravo'][i]} ${rand()} Pty Ltd`;
    const mail = `bids-${rand()}@skeleton-bidder.example`;
    const inv = await (
      await api.post(`/api/v1/tenders/${tenderId}/invitations`, {
        headers,
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
      const up = await sup.post(`/api/v1/supplier/tenders/${tenderId}/submission/files`, {
        headers: sh,
        data: { name, section, dataBase64: bytes.toString('base64') },
      });
      expect(up.ok(), await up.text()).toBeTruthy();
    }
    expect(
      (await sup.post(`/api/v1/supplier/tenders/${tenderId}/submission`, { headers: sh })).ok(),
    ).toBeTruthy();
    await sup.dispose();
    await anon.dispose();
  }
  // the closing time is backdated by the test-only API entry point; the next read closes the tender
  expect((await api.post(`${API_URL}/__e2e/expire-tender/${tenderId}`)).status()).toBe(204);
  const after = await (await api.get(`/api/v1/tenders/${tenderId}`)).json();
  expect(after.status).toBe('CLOSED');
  await api.dispose();
}

async function declareNone(user: string, evalId: string) {
  const { api, headers } = await apiAs(user);
  expect(
    (await api.post(`/api/v1/evaluations/${evalId}/coi`, { headers, data: { none: true } })).ok(),
  ).toBeTruthy();
  await api.dispose();
}

async function score(user: string, evalId: string) {
  const { api, headers } = await apiAs(user);
  const mine = await (await api.get(`/api/v1/evaluations/${evalId}/scores/mine`)).json();
  for (const s of mine.suppliers) {
    const put = await api.put(`/api/v1/evaluations/${evalId}/scores`, {
      headers,
      data: {
        supplierId: s.supplierId,
        scores: mine.criteria.map((c: { id: string; passFail: boolean }) => ({
          criterionId: c.id,
          score: c.passFail ? 10 : 7,
        })),
      },
    });
    expect(put.ok(), `${user}: ${await put.text()}`).toBeTruthy();
  }
  expect((await api.post(`/api/v1/evaluations/${evalId}/scores/submit`, { headers })).ok()).toBeTruthy();
  await api.dispose();
}

test('skeleton: request to plan to tender to bids to evaluation to report to signed contract to alerts, dashboard and audit trail', async ({
  page,
}) => {
  test.setTimeout(420_000);
  let requestId = '';
  let number = ''; // PR-2026-nnnn: titles can repeat (the seed has similar requests), the number cannot
  let tenderId = '';
  let evalUrl = '';
  let contractUrl = '';

  await test.step('1. the requester describes the need to the assistant and submits the request', async () => {
    await signIn(page, 'requester');
    await page.goto('/app/requests/new');
    await expect(page.getByRole('log', { name: 'Conversation' })).toContainText('Describe what you need');
    const say = async (text: string) => {
      const before = await page.locator('[data-role="ASSISTANT"]').count();
      await page.getByLabel('Describe what you need or answer the question').fill(text);
      await page.getByRole('button', { name: 'Send message' }).click();
      await expect(page.locator('[data-role="ASSISTANT"]')).toHaveCount(before + 1, { timeout: 15_000 });
    };
    await say('Security guard services for 2 years, about $90,000');
    await say('Facilities');
    await say('Sofia Rossi');
    await expect(page.getByTestId('draft-panel')).not.toContainText('Needed');
    await page.getByRole('link', { name: 'Review and submit' }).click();
    await expect(page).toHaveURL(/\/app\/requests\/[0-9a-f-]{36}$/);
    requestId = page.url().split('/').pop()!;
    number = /PR-\d{4}-\d{4}/.exec(await page.locator('main').innerText())![0];
    await page.getByRole('button', { name: 'Submit request' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Submit' }).click();
    await expect(
      page.getByText('This request has been submitted and can no longer be edited here.'),
    ).toBeVisible();
  });

  await test.step('2. procurement submits the drafted plan; the delegate approves and locks it', async () => {
    await signIn(page, 'procurement');
    await page.goto(`/app/plans/${requestId}`);
    await expect(page.getByTestId('plan-workspace')).toBeVisible();
    await page.getByRole('button', { name: 'Submit for approval' }).click();
    await expect(page.getByTestId('plan-workspace')).toHaveAttribute('data-plan-status', 'AWAITING_APPROVAL');

    await signIn(page, 'delegate');
    await page.goto('/app/approvals');
    await page
      .locator(`[data-testid="approval-item"]:has(a[href="/app/plans/${requestId}"])`)
      .getByRole('link', { name: 'Review and decide' })
      .click();
    await page.getByRole('button', { name: 'Approve and lock' }).click();
    await expect(page.getByTestId('plan-workspace')).toHaveAttribute('data-plan-status', 'APPROVED_LOCKED');
  });

  await test.step('3. procurement builds the tender pack; the delegate gives permission; procurement publishes', async () => {
    await signIn(page, 'procurement');
    await page.goto('/app/tenders');
    const row = page.getByTestId('ready-plan').filter({ hasText: number });
    await expect(row).toBeVisible();
    await row.getByLabel('Type').selectOption('RFT');
    await row.getByRole('button', { name: 'Create tender pack' }).click();
    await expect(page.getByTestId('tender-workspace')).toHaveAttribute('data-status', 'STAGED');
    tenderId = page.url().split('/').pop()!;

    await signIn(page, 'delegate');
    await page.goto('/app/approvals');
    await page
      .getByTestId('permit-item')
      .filter({ hasText: number })
      .getByRole('link', { name: 'Review and give permission' })
      .click();
    await page.getByRole('button', { name: 'Give permission to publish' }).click();
    await expect(page.getByTestId('permission-stamp')).toContainText('PERMISSION TO PUBLISH');

    await signIn(page, 'procurement');
    await page.goto(`/app/tenders/${tenderId}`);
    await page.getByRole('button', { name: 'Publish tender' }).click();
    await expect(page.getByTestId('tender-workspace')).toHaveAttribute('data-status', 'PUBLISHED');
  });

  await test.step('4. two suppliers register, submit sealed bids, and the tender closes', async () => {
    await bidAndClose(tenderId);
    await signIn(page, 'procurement');
    await page.goto('/app/evaluations');
    await expect(page.getByTestId('ready-tender').filter({ hasText: number })).toContainText(
      '2 bid(s) received',
    );
  });

  await test.step('5. procurement opens the evaluation; evaluators declare and score; the chair locks consensus', async () => {
    const row = page.getByTestId('ready-tender').filter({ hasText: number });
    await row.getByRole('button', { name: /Set up the evaluation/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('checkbox', { name: 'Tomas Silva' }).check();
    await dialog.getByRole('checkbox', { name: 'Mei Tanaka' }).check();
    await dialog.getByLabel('Stream for Mei Tanaka').selectOption('COMMERCIAL');
    await dialog.getByRole('button', { name: 'Open evaluation' }).click();
    await expect(page.getByTestId('evaluation-workspace')).toHaveAttribute('data-status', 'COI_PENDING');
    evalUrl = page.url();
    const evalId = evalUrl.split('/').pop()!;

    const panel = ['evaluator-tech', 'evaluator-comm', 'chair'];
    for (const u of panel) await declareNone(u, evalId); // scoring opens once everyone has declared
    for (const u of panel) await score(u, evalId);

    await signIn(page, 'chair');
    await page.goto(evalUrl);
    await page.getByTestId('chair-panel').getByRole('button', { name: 'Open consensus' }).click();
    await expect(page.getByTestId('evaluation-workspace')).toHaveAttribute('data-status', 'CONSENSUS');
    await page.getByRole('button', { name: 'Use the average where scorers agree' }).click();
    const suppliers = page.getByTestId('consensus-supplier');
    for (let s = 0; s < (await suppliers.count()); s++) {
      await suppliers
        .nth(s)
        .getByRole('button', { name: /Save consensus/ })
        .click();
      await expect(page.getByRole('status').filter({ hasText: 'Consensus saved' }).first()).toBeVisible();
    }
    await page.getByRole('button', { name: 'Lock consensus' }).click();
    await expect(page.getByTestId('evaluation-workspace')).toHaveAttribute('data-status', 'LOCKED');
    await expect(page.getByTestId('ranking')).toContainText('/ 100');
  });

  await test.step('6. procurement generates the report; the delegate approves it', async () => {
    await signIn(page, 'procurement');
    await page.goto(evalUrl);
    await page.getByRole('button', { name: 'Generate report' }).click();
    await expect(page.getByTestId('report-panel')).toContainText('Awaiting approval');

    await signIn(page, 'delegate');
    await page.goto(evalUrl);
    await page.getByTestId('report-panel').getByRole('button', { name: 'Approve report' }).click();
    await expect(page.getByTestId('report-stamp')).toContainText('REPORT APPROVED');
    await expect(page.getByTestId('evaluation-workspace')).toHaveAttribute('data-status', 'APPROVED');
  });

  await test.step('7. legal drafts the contract from the approved report and releases it; the delegate signs and it locks', async () => {
    await signIn(page, 'legal');
    await page.goto('/app/contracts');
    const card = page.getByTestId('award-ready').filter({ hasText: number });
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: /Draft the contract with/ }).click();
    await expect(page.getByTestId('contract-workspace')).toBeVisible();
    await page.getByRole('button', { name: 'Release for signing' }).click();
    await expect(page.getByText('Awaiting signature').first()).toBeVisible();
    contractUrl = page.url();

    await signIn(page, 'delegate');
    await page.goto(contractUrl);
    await page.getByRole('button', { name: 'Sign contract' }).click();
    await expect(page.getByTestId('locked-banner')).toBeVisible();
    await expect(page.getByTestId('stamp')).toContainText(/SIGNED · Dana Okafor · DELEGATE/);
  });

  await test.step('8. the contract manager sees the signed contract with its record and scheduled alerts', async () => {
    await signIn(page, 'contract-mgr');
    await page.goto(contractUrl);
    const mgmt = page.getByTestId('management-card');
    await expect(mgmt).toBeVisible();
    await expect(mgmt.getByTestId('alerts')).toContainText('Scheduled');
    await expect(mgmt.getByTestId('alerts')).toContainText('Contract expiry');
  });

  await test.step('9. the executive sees the procurement on the dashboard with its completion ticks', async () => {
    await signIn(page, 'exec');
    await page.goto('/app/dashboard');
    const row = page.getByTestId('proc-row').filter({ hasText: number });
    await expect(row).toBeVisible();
    for (const stage of ['Plan complete', 'Tender complete', 'Evaluation complete'])
      await expect(row.getByText(stage)).toBeAttached();
  });

  await test.step('10. probity finds every stage of the journey in the audit trail', async () => {
    await signIn(page, 'probity');
    // the trail is newest first and paged, so look stage by stage with the action filter
    for (const action of ['request.', 'plan.', 'tender.', 'evaluation.', 'report.', 'contract.']) {
      await page.goto(`/app/audit?requestId=${requestId}&action=${action}`);
      await expect(page.getByTestId('audit-row').first(), `audit trail has ${action}`).toContainText(action);
    }
  });
});
