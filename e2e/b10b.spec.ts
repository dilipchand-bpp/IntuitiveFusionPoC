import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  apiAs,
  apiConsensusAndLock,
  apiDeclareNone,
  apiScoreAndSubmit,
  closedTender,
  openEvaluationApi,
  rand,
  signIn,
} from './helpers';

/** Roadmap batch B10b in the browser: ERP sync, legal system status, HR feed and payment execution. */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const scan = async (page: Page) =>
  expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations).toEqual([]);

/** An executed contract, all by API (fast set-up); everything under test then happens in the browser. */
async function executedContract(title: string) {
  const { tenderId } = await closedTender(title, 2);
  const evalId = await openEvaluationApi(tenderId);
  for (const u of ['evaluator-tech', 'evaluator-comm', 'chair']) await apiDeclareNone(u, evalId);
  for (const u of ['evaluator-tech', 'evaluator-comm', 'chair']) await apiScoreAndSubmit(u, evalId);
  await apiConsensusAndLock(evalId);
  const proc = await apiAs('procurement');
  const rep = await proc.api.post(`/api/v1/evaluations/${evalId}/report`, { headers: proc.headers });
  const reportId = (await rep.json()).report.id as string;
  const del = await apiAs('delegate');
  expect(
    (
      await del.api.post(`/api/v1/evaluation-reports/${reportId}/decision`, {
        headers: del.headers,
        data: { decision: 'APPROVE' },
      })
    ).ok(),
  ).toBeTruthy();
  const legal = await apiAs('legal');
  const awards = (await (await legal.api.get('/api/v1/contracts/awards')).json()) as Array<{
    evaluationId: string;
    title: string;
    recommended: Array<{ supplierId: string }>;
  }>;
  const award = awards.find((a) => a.title === title)!;
  const made = await legal.api.post('/api/v1/contracts', {
    headers: legal.headers,
    data: { evaluationId: award.evaluationId, supplierId: award.recommended[0]!.supplierId },
  });
  expect(made.status(), await made.text()).toBe(201);
  const id = (await made.json()).id as string;
  expect(
    (await legal.api.post(`/api/v1/contracts/${id}/release-for-signing`, { headers: legal.headers })).ok(),
  ).toBeTruthy();
  const sign = await del.api.post(`/api/v1/contracts/${id}/sign`, {
    headers: del.headers,
    data: { decision: 'APPROVE' },
  });
  expect(sign.ok(), await sign.text()).toBeTruthy();
  return { id, number: (await sign.json()).number as string };
}
const today = () => new Date().toISOString().slice(0, 10);
const putConnector = async (kind: string, data: Record<string, unknown>) => {
  const a = await apiAs('admin');
  const r = await a.api.put(`/api/v1/connectors/${kind}`, { headers: a.headers, data });
  expect(r.ok(), await r.text()).toBeTruthy();
};

test.describe.configure({ mode: 'serial' });

test.describe('NFR-C02 ERP sync of budget, ledger, cost centre and organisation', () => {
  test('finance imports from the simulated ERP, a repeat changes nothing, and a source change is reported', async ({
    page,
  }) => {
    await signIn(page, 'finance');
    await page.goto('/app/erp');
    await expect(page.getByRole('heading', { name: 'ERP data', level: 1 })).toBeVisible();
    await expect(page.getByTestId('erp-last-run')).toContainText('Nothing has been imported yet');
    await page.getByRole('button', { name: 'Run sync' }).click();
    const result = page.getByTestId('erp-result');
    await expect(result).toContainText('Imported from');
    await expect(result).toContainText('0 changed, 0 removed');
    await expect(page.getByTestId('erp-centre-row')).toHaveCount(11);
    await expect(page.getByTestId('erp-ledger-row').first()).toBeVisible();
    // again: nothing changes
    await page.getByRole('button', { name: 'Run sync' }).click();
    await expect(result).toContainText('0 added, 0 changed, 0 removed, 87 unchanged');
    // the source changes (version 2): one added, one removed, some changed
    await page.getByLabel('Source version').selectOption('2');
    await page.getByRole('button', { name: 'Run sync' }).click();
    await expect(result).toContainText(/[1-9]\d* added, [1-9]\d* changed, [1-9]\d* removed/);
    await expect(page.getByTestId('erp-centre-row').filter({ hasText: 'FAC-300' })).toHaveCount(1);
    await expect(page.getByTestId('erp-centre-row').filter({ hasText: 'OPS-200' })).toHaveCount(0);
    await page.getByLabel('Source version').selectOption('1');
    await page.getByRole('button', { name: 'Run sync' }).click();
    await expect(page.getByTestId('erp-centre-row')).toHaveCount(11);
    await expect(page.getByRole('button', { name: 'Preview only' })).toBeEnabled();
    await scan(page);
  });

  test('the budget check names where its figure came from, and executives read without a sync button', async ({
    page,
  }) => {
    await signIn(page, 'finance');
    await page.goto('/app/erp');
    await page.getByLabel('Cost centre or business unit').fill('Facilities');
    await page.getByLabel('Amount (AUD)').fill('1000000');
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(page.getByTestId('erp-check-result')).toContainText('CLEARED');
    await expect(page.getByTestId('erp-check-result')).toContainText(
      /Source: .*budget for FY\d{4}, cost centres FAC-100, FAC-200/,
    );
    await signIn(page, 'exec');
    await page.goto('/app/erp');
    await expect(page.getByTestId('erp-centre-row').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run sync' })).toHaveCount(0);
    await signIn(page, 'requester');
    expect((await page.goto('/app/erp'))?.status()).toBe(403);
  });

  test('when the ERP is down the sync fails cleanly, the last data stays, and a manual task is shown (NFR-AV04)', async ({
    page,
  }) => {
    await putConnector('ERP', { mode: 'DOWN' });
    try {
      await signIn(page, 'admin');
      await page.goto('/app/erp');
      await page.getByRole('button', { name: 'Run sync' }).click();
      await expect(page.getByRole('alert').filter({ hasText: 'could not be reached' })).toBeVisible();
      await expect(page.getByTestId('erp-manual-task')).toContainText('ERP sync');
      await expect(page.getByTestId('erp-centre-row')).toHaveCount(11);
    } finally {
      await putConnector('ERP', { mode: 'UP' });
    }
    await page.reload();
    await page.getByRole('button', { name: 'Run sync' }).click();
    await expect(page.getByTestId('erp-result')).toContainText('Imported from');
    await expect(page.getByTestId('erp-manual-task')).toHaveCount(0);
  });
});

test.describe('FR-0815 HR feed: starters, leavers and delegate changes', () => {
  test('an administrator previews a batch, applies it, sees what needs a person, and a repeat changes nothing', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await putConnector('HR', { enabled: true });
    try {
      await signIn(page, 'admin');
      await page.goto('/admin/hr-feed');
      await expect(page.getByRole('heading', { name: 'HR feed', level: 1 })).toBeVisible();
      await page.getByRole('button', { name: 'Preview' }).click();
      await expect(page.getByTestId('hr-run')).toContainText('Preview of HR-BATCH-0001');
      await expect(page.getByTestId('hr-run')).toContainText('Nothing was changed');
      await page.getByRole('button', { name: 'Apply batch' }).click();
      await expect(page.getByTestId('hr-run')).toContainText('Applied HR-BATCH-0001');
      await expect(page.getByTestId('hr-exceptions')).toContainText('never grants it');
      await page.getByRole('button', { name: 'Apply batch' }).click(); // batch 2: leaver, role change, delegate (capped)
      await expect(page.getByTestId('hr-run')).toContainText('Applied HR-BATCH-0002');
      await expect(page.getByTestId('hr-delegation-row').first()).toContainText('asked 400,000');
      await expect(page.getByTestId('hr-run')).toContainText('switched off, sessions ended');
      await page.getByLabel('Batch', { exact: true }).selectOption('1');
      await page.getByRole('button', { name: 'Apply batch' }).click();
      await expect(page.getByTestId('hr-run')).toContainText('4 already handled');
      await scan(page);
      await signIn(page, 'finance');
      expect((await page.goto('/admin/hr-feed'))?.status()).toBe(403);
    } finally {
      await putConnector('HR', { enabled: false });
    }
  });
});

test.describe('FR-0875 payments and NFR-C03 legal status, on one executed contract', () => {
  let c: { id: string; number: string };
  let invoiceNumber = '';
  test.beforeAll(async () => {
    test.setTimeout(300_000);
    c = await executedContract(`B10b contract ${rand()}`);
    const cm = await apiAs('contract-mgr');
    expect(
      (
        await cm.api.put(`/api/v1/contracts/${c.id}/rates`, {
          headers: cm.headers,
          data: { rates: [{ item: 'Cleaning hour', unit: 'hour', unitPrice: 50 }] },
        })
      ).ok(),
    ).toBeTruthy();
    const fin = await apiAs('finance');
    const po = await fin.api.post(`/api/v1/contracts/${c.id}/purchase-orders`, {
      headers: fin.headers,
      data: {
        description: 'Supply of services',
        lines: [{ item: 'Cleaning hour', qty: 100, unitPrice: 50 }],
      },
    });
    expect(po.status(), await po.text()).toBe(201);
    const inv = await fin.api.post(`/api/v1/contracts/${c.id}/invoices`, {
      headers: fin.headers,
      data: {
        invoiceDate: today(),
        poId: (await po.json()).id,
        lines: [{ item: 'Cleaning hour', qty: 40, unitPrice: 50 }],
      },
    });
    expect(inv.status(), await inv.text()).toBe(201);
    invoiceNumber = (await inv.json()).invoice.number as string;
    await putConnector('PAYMENTS', { enabled: true });
  });

  test('finance proposes a payment, cannot approve it, an executive approves it, and the invoice is paid with a status trail', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signIn(page, 'finance');
    await page.goto('/app/contracts/invoices');
    const row = page.getByTestId('invoice-queue').locator('li').filter({ hasText: invoiceNumber });
    await row.getByRole('button', { name: `Pay ${invoiceNumber}` }).click();
    await expect(row.getByTestId('payment-list')).toContainText('proposed');
    await row.getByRole('button', { name: /^Approve PAY-/ }).click();
    await expect(row.getByRole('alert')).toContainText(/different person/);
    await scan(page);
    await signIn(page, 'exec');
    await page.goto('/app/contracts/invoices');
    const row2 = page.getByTestId('invoice-queue').locator('li').filter({ hasText: invoiceNumber });
    await row2.getByRole('button', { name: /^Approve PAY-/ }).click();
    await expect(row2.getByTestId('payment-list')).toContainText('confirmed');
    await expect(row2.getByLabel(/Status trail for PAY-/)).toContainText('sent');
    await expect(row2).toHaveAttribute('data-invoice-status', 'PAID');
  });

  test('while the finance system is down a payment waits with a manual task and goes when it recovers', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const fin = await apiAs('finance');
    const po = await fin.api.get(`/api/v1/contracts/${c.id}/purchase-orders`);
    const poId = ((await po.json()) as Array<{ id: string }>)[0]!.id;
    const inv = await fin.api.post(`/api/v1/contracts/${c.id}/invoices`, {
      headers: fin.headers,
      data: { invoiceDate: today(), poId, lines: [{ item: 'Cleaning hour', qty: 10, unitPrice: 50 }] },
    });
    expect(inv.status(), await inv.text()).toBe(201);
    const number = (await inv.json()).invoice.number as string;
    await putConnector('PAYMENTS', { mode: 'DOWN' });
    try {
      await signIn(page, 'finance');
      await page.goto('/app/contracts/invoices');
      const row = page.getByTestId('invoice-queue').locator('li').filter({ hasText: number });
      await row.getByLabel(/Amount for/).fill('250');
      await row.getByRole('button', { name: `Pay ${number}` }).click();
      await expect(row.getByTestId('payment-list')).toContainText('proposed');
      await signIn(page, 'exec');
      await page.goto('/app/contracts/invoices');
      const r2 = page.getByTestId('invoice-queue').locator('li').filter({ hasText: number });
      await r2.getByRole('button', { name: /^Approve PAY-/ }).click();
      await expect(r2.getByTestId('payment-list')).toContainText('Waiting for the finance system');
    } finally {
      await putConnector('PAYMENTS', { mode: 'UP' });
    }
    await page.reload();
    const r3 = page.getByTestId('invoice-queue').locator('li').filter({ hasText: number });
    await r3.getByRole('button', { name: /^Retry PAY-/ }).click();
    await expect(r3.getByTestId('payment-list')).toContainText('confirmed');
    await expect(r3).toContainText('left to pay'); // a part payment: the rest is tracked
  });

  test('the legal system reports a stage, a document and closure; they show on the contract, and a bad signature is refused', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const admin = await apiAs('admin');
    const set = await admin.api.put('/api/v1/admin/settings', {
      headers: admin.headers,
      data: {
        legalPlatform: {
          enabled: true,
          name: 'HighQ',
          webhookSecret: 'e2e-legal-shared-secret-1',
          simulateOutage: false,
        },
      },
    });
    expect(set.ok(), await set.text()).toBeTruthy();
    const legal = await apiAs('legal');
    const m = await legal.api.post('/api/v1/legal/matters', {
      headers: legal.headers,
      data: { title: 'Review the B10b agreement', contractId: c.id, priority: 'HIGH' },
    });
    expect(m.status(), await m.text()).toBe(201);
    await admin.api.put('/api/v1/admin/settings', {
      headers: admin.headers,
      data: {
        legalPlatform: {
          enabled: false,
          name: 'HighQ',
          webhookSecret: 'e2e-legal-shared-secret-1',
          simulateOutage: false,
        },
      },
    });
    await signIn(page, 'legal');
    await page.goto(`/app/contracts/${c.id}`);
    const card = page.getByTestId('legal-sync');
    await expect(card).toBeVisible();
    await expect(card.getByTestId('legal-sync-stage')).toContainText('No stage reported');
    const form = card.getByRole('form', { name: 'Simulate a legal system event' });
    await form.getByLabel('Stage', { exact: true }).fill('Counsel review');
    await form.getByRole('button', { name: 'Send signed event' }).click();
    await expect(card.getByTestId('legal-sync-stage')).toContainText('Counsel review');
    await expect(page.getByTestId('legal-sim-result')).toContainText('answered 200');
    await form.getByLabel('Simulate a legal system event').selectOption('DOCUMENT_ATTACHED');
    await form.getByRole('button', { name: 'Send signed event' }).click();
    await expect(card.getByTestId('legal-sync-docs')).toContainText('Counterparty markup v2.docx');
    await form.getByLabel('Simulate a legal system event').selectOption('MATTER_CLOSED');
    await form.getByRole('button', { name: 'Send signed event' }).click();
    await expect(card.getByTestId('legal-sync-stage')).toContainText('Closed');
    await expect(card.getByTestId('legal-sync-events')).toContainText('Stage changed');
    await expect(card.getByTestId('legal-sync-events')).toContainText('Matter closed');
    // an unsigned message from outside is refused
    const raw = await legal.api.post('/api/v1/integrations/legal/events', {
      data: { eventId: 'e2e-unsigned-1', type: 'MATTER_CLOSED', data: { matterRef: 'X-1' } },
    });
    expect(raw.status()).toBe(401);
    await scan(page);
  });
});
