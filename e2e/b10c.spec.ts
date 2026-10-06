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

/** Roadmap batch B10c in the browser: e-signature envelopes, the document repository and continuity alerts. */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const scan = async (page: Page) =>
  expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations).toEqual([]);

test.describe.configure({ mode: 'serial' });

async function releasedContract(title: string) {
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
  const rel = await legal.api.post(`/api/v1/contracts/${id}/release-for-signing`, { headers: legal.headers });
  expect(rel.ok(), await rel.text()).toBeTruthy();
  return id;
}

test.describe('NFR-C04 e-signature envelope and signing ceremony', () => {
  test('the envelope shows the pre-filled signatory, the provider calls back, and the signatory signs from their link', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const admin = await apiAs('admin');
    const set = await admin.api.put('/api/v1/connectors/ESIGN', {
      headers: admin.headers,
      data: { provider: 'DOCUSIGN', enabled: true, mode: 'UP' },
    });
    expect(set.ok(), await set.text()).toBeTruthy();
    const id = await releasedContract(`B10c esign ${rand()}`);

    await signIn(page, 'legal');
    await page.goto(`/app/contracts/${id}`);
    const card = page.getByTestId('envelope-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText('DocuSign');
    await expect(card).toContainText('Simulated');
    await expect(page.getByTestId('envelope-signatory')).toHaveCount(1);
    await expect(page.getByTestId('envelope-signatory')).toContainText('Authorised delegate');
    // the simulated provider calls back through the signed webhook
    await page.getByLabel('Provider event').selectOption('delivered');
    await page.getByRole('button', { name: 'Send callback' }).click();
    await expect(card.getByText('The provider called back.')).toBeVisible();
    await card.getByText(/Event history/).click();
    await expect(page.getByTestId('envelope-events')).toContainText('delivered');

    // the delegate opens the ceremony from the contract and signs with their own confirmation
    await signIn(page, 'delegate');
    await page.goto(`/app/contracts/${id}`);
    await page.getByRole('button', { name: 'Open my signing page' }).click();
    await expect(page.getByTestId('esign-summary')).toBeVisible();
    await expect(page.getByTestId('esign-summary')).toContainText('Authorised delegate');
    await scan(page);
    await page.getByTestId('esign-sign').click();
    await expect(page.getByTestId('esign-result')).toContainText('You have signed');

    await signIn(page, 'legal');
    await page.goto(`/app/contracts/${id}`);
    await expect(page.getByTestId('envelope-card')).toContainText('COMPLETED');
    await expect(page.getByTestId('envelope-signatory')).toContainText('SIGNED');
  });

  test('a signing link is for the signed-in signatory only', async ({ page }) => {
    await signIn(page, 'requester');
    await page.goto('/esign/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    await expect(page.getByText(/not allowed|forbidden|403/i).first()).toBeVisible();
  });
});

test.describe('NFR-C06 document repository', () => {
  test('a requester files a small document, adds a second version, and reads the history', async ({
    page,
  }) => {
    const admin = await apiAs('admin');
    expect(
      (
        await admin.api.put('/api/v1/connectors/DOCREPO', {
          headers: admin.headers,
          data: { provider: 'SHAREPOINT', enabled: true, mode: 'UP' },
        })
      ).ok(),
    ).toBeTruthy();
    const title = `B10c repo ${rand()}`;
    const req = await apiAs('requester');
    const made = await req.api.post('/api/v1/requests', {
      headers: req.headers,
      data: {
        title,
        category: 'Building cleaning (UNSPSC 76111500)',
        estimatedValue: 90_000,
        termMonths: 24,
        businessUnit: 'Facilities',
        fields: { contractOwner: 'Sofia Rossi', background: 'Existing arrangements end in six months.' },
      },
    });
    expect(made.status()).toBe(201);
    await signIn(page, 'requester');
    await page.goto('/app/repository');
    await expect(page.getByRole('heading', { name: 'Document repository' })).toBeVisible();
    const value = await page
      .getByTestId('repo-project')
      .locator('option', { hasText: title })
      .getAttribute('value');
    await page.getByTestId('repo-project').selectOption(value!);
    await page.getByTestId('repo-upload-file').setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('first version'),
    });
    await page.getByTestId('repo-upload').click();
    await expect(page.getByTestId('repo-file')).toContainText('notes.txt');
    await expect(page.getByTestId('repo-file')).toContainText('v1');
    await page.getByTestId('repo-upload-file').setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('second version'),
    });
    await page.getByTestId('repo-upload').click();
    await expect(page.getByTestId('repo-file')).toContainText('v2');
    await page.getByRole('button', { name: 'Versions' }).click();
    await expect(page.getByTestId('repo-history')).toContainText('v1');
    await expect(page.getByTestId('repo-history')).toContainText('v2');
    await expect(page.getByTestId('repo-download')).toHaveAttribute('href', /download$/);
    await scan(page);
  });

  test('roles without a repository page are refused', async ({ page }) => {
    await signIn(page, 'evaluator-tech');
    await page.goto('/app/repository');
    await expect(page.getByText(/not allowed|forbidden|403/i).first()).toBeVisible();
  });
});

test.describe('FR-0860 continuity alerts', () => {
  test('procurement raises an event, a recipient answers from the one-time link, and the tracker shows it', async ({
    page,
    browser,
  }) => {
    await signIn(page, 'procurement');
    await page.goto('/app/continuity');
    await expect(page.getByRole('heading', { name: 'Continuity alerts' })).toBeVisible();
    await page.getByTestId('cb-title').fill('Head office closed');
    await page.getByLabel('Kind').selectOption('SITE_CLOSURE');
    await page.getByTestId('cb-message').fill('The head office is closed today because of flooding.');
    await page.getByRole('checkbox', { name: 'Contacts at the affected suppliers' }).uncheck();
    await page.getByRole('checkbox', { name: 'Owners of the affected contracts' }).uncheck();
    await page.getByTestId('cb-raise').click();
    const tracker = page.getByTestId('cb-tracker');
    await expect(tracker).toContainText('Head office closed');
    await expect(tracker).toContainText('Elena Petrova');
    await expect(page.getByTestId('cb-counts')).toContainText('not answered');
    await scan(page);
    const href = await page
      .getByTestId('cb-links')
      .getByRole('link', { name: /\/respond\// })
      .first()
      .getAttribute('href');
    expect(href).toMatch(/^\/respond\/[\w-]{22}$/);

    // the recipient has no sign-in at all
    const anon = await browser.newContext();
    const p2 = await anon.newPage();
    await p2.goto(`${new URL(page.url()).origin}${href}`);
    await expect(p2.getByTestId('respond-card')).toContainText('Head office closed');
    await p2.getByTestId('respond-NEED_HELP').click();
    await expect(p2.getByTestId('respond-current')).toContainText('I need help');
    await p2.getByTestId('respond-SAFE').click();
    await expect(p2.getByTestId('respond-current')).toContainText('I am safe');
    await expect(
      new AxeBuilder({ page: p2 })
        .withTags(WCAG)
        .analyze()
        .then((r) => r.violations),
    ).resolves.toEqual([]);
    await anon.close();

    await page.reload();
    await page.getByTestId('cb-event').first().getByRole('button', { name: 'Tracker' }).click();
    await expect(page.getByTestId('cb-recipient').first()).toContainText('Safe');
    await page.getByTestId('cb-close').click();
    await expect(page.getByTestId('cb-summary')).toContainText(/closed after/);
  });

  test('the public link of an unknown person says so, and nobody outside the continuity roles sees the page', async ({
    page,
  }) => {
    await page.goto('/respond/not-a-real-token-at-all-12345');
    await expect(page.getByTestId('respond-error')).toBeVisible();
    await signIn(page, 'finance');
    await page.goto('/app/continuity');
    await expect(page.getByText(/not allowed|forbidden|403/i).first()).toBeVisible();
  });
});
