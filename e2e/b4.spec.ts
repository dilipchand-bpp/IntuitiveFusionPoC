import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import {
  apiAs,
  apiConsensusAndLock,
  apiDeclareNone,
  apiScoreAndSubmit,
  closedTender,
  email,
  openEvaluationApi,
  PASSWORD,
  rand,
  signIn,
} from './helpers';

/** Roadmap batch B4 in the browser: contract award and legal. */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** An approved award with a contract drafted by legal, all by API; returns the contract and the winning supplier's login. */
async function draftedContract(title: string) {
  const { tenderId, companies, emails } = await closedTender(title, 2);
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
    recommended: Array<{ supplierId: string; company: string }>;
  }>;
  const award = awards.find((a) => a.title === title)!;
  const winner = award.recommended[0]!;
  const made = await legal.api.post('/api/v1/contracts', {
    headers: legal.headers,
    data: { evaluationId: award.evaluationId, supplierId: winner.supplierId },
  });
  expect(made.status(), await made.text()).toBe(201);
  return {
    contractId: (await made.json()).id as string,
    tenderId,
    supplierEmail: emails[companies.indexOf(winner.company)]!,
    company: winner.company,
  };
}

test.describe('the contract page: checks, signing mode, invitations and questions', () => {
  test('legal runs the checks, releases for blind signing; the supplier reads it and asks a question; the delegate signs unseen by others', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const title = `B4 contract ${rand()}`;
    const c = await draftedContract(title);
    await signIn(page, 'legal');
    await page.goto(`/app/contracts/${c.contractId}`);
    const checks = page.getByTestId('checks-card');
    await checks.getByRole('button', { name: 'Run the checks' }).click();
    await expect(checks.locator('[data-check="LEGAL_NAME"]')).toContainText('Registered as');
    await expect(checks.locator('[data-check="PRICE"]')).toContainText('No total cost was recorded');
    const scan = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(scan.violations).toEqual([]);

    await page.getByLabel('How signatures are collected').selectOption('BLIND');
    await page.getByRole('button', { name: 'Release for signing' }).click();
    await expect(page.getByText('Blind signing').first()).toBeVisible();
    const progress = page.getByTestId('signing-progress');
    await expect(progress).toContainText('Dana Okafor');
    await expect(progress).toContainText('Supplier (reads and asks questions)');

    // the supplier reads the whole contract and asks a question
    await signIn(page, c.supplierEmail);
    await page.goto('/supplier/contracts');
    await expect(page.getByTestId('supplier-contract-row')).toHaveCount(1);
    await page
      .getByRole('link', { name: /Contract|B4 contract/ })
      .first()
      .click();
    const sc = page.getByTestId('supplier-contract');
    await expect(sc).toContainText('Parties and purpose');
    await sc
      .getByLabel('Ask a question before the contract is signed')
      .fill('Can invoices be paid in 14 days?');
    await sc.getByRole('button', { name: 'Send question' }).click();
    await expect(sc).toContainText('Waiting for an answer');
    const sscan = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(sscan.violations).toEqual([]);

    // legal answers on the contract page
    await signIn(page, 'legal');
    await page.goto(`/app/contracts/${c.contractId}`);
    const q = page.getByTestId('questions-card');
    await expect(q).toContainText('Can invoices be paid in 14 days?');
    await q.getByLabel(/Answer to:/).fill('Terms are 30 days; we can discuss early payment.');
    await q.getByRole('button', { name: /Send answer/ }).click();
    await expect(q).toContainText('Answer from Henry Albright');

    // the delegate is told it is blind, signs, and the contract is executed
    await signIn(page, 'delegate');
    await page.goto(`/app/contracts/${c.contractId}`);
    await expect(page.getByTestId('blind-banner')).toBeVisible();
    await page.getByRole('button', { name: 'Sign contract' }).click();
    await expect(page.getByTestId('locked-banner')).toBeVisible();
  });

  test('a deviation is explained in plain language, rated in words, and its risk formally accepted', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const c = await draftedContract(`B4 deviation ${rand()}`);
    await signIn(page, 'legal');
    await page.goto(`/app/contracts/${c.contractId}`);
    const lib = page.getByTestId('clause-LIABILITY');
    await lib.getByRole('button', { name: /^Edit / }).click();
    await lib
      .getByRole('textbox')
      .fill('The Supplier is not liable for any loss and its indemnity is unlimited in the Customer favour.');
    await page.getByRole('button', { name: 'Save clause' }).click();
    const dev = page.getByTestId('deviation-LIABILITY');
    await dev.getByRole('button', { name: /What does the change to .* mean/ }).click();
    await expect(dev.getByTestId('explanation')).toContainText('mandatory clause');
    await dev.getByLabel(/Rate .* in words/).fill('This is serious because it removes the cap');
    await dev.getByRole('button', { name: /Read back the rating/ }).click();
    await dev.getByRole('button', { name: /Set to high risk/ }).click();
    await expect(dev).toContainText('high risk');
    const scan = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(scan.violations).toEqual([]);

    await signIn(page, 'delegate');
    await page.goto(`/app/contracts/${c.contractId}`);
    const d2 = page.getByTestId('deviation-LIABILITY');
    await d2
      .getByLabel(/Statement accepting the risk/)
      .fill('The business accepts the residual risk for this term');
    await d2.getByRole('button', { name: /Formally accept the risk/ }).click();
    await expect(d2).toContainText('RISK ACCEPTED · Dana Okafor');
  });

  test('the draft downloads, a comment is added, and the negotiation strategy shows four positions', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const c = await draftedContract(`B4 collab ${rand()}`);
    await signIn(page, 'procurement');
    await page.goto(`/app/contracts/${c.contractId}`);
    const collab = page.getByTestId('collab-card');
    await collab.getByLabel('Add a comment').fill('Can we shorten the notice period?');
    await collab.getByRole('button', { name: 'Comment' }).click();
    await expect(collab).toContainText('Can we shorten the notice period?');
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      collab.getByRole('link', { name: 'Download Word' }).click(),
    ]);
    expect(dl.suggestedFilename()).toMatch(/\.docx$/);
    const strat = page.getByTestId('strategy-card');
    await strat.getByRole('button', { name: 'Suggest a strategy' }).click();
    const positions = strat.getByRole('list', { name: 'Positions' }).getByRole('listitem');
    await expect(positions).toHaveCount(4);
    await expect(positions.first()).toContainText('Minimum expected result');
    const scan = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(scan.violations).toEqual([]);
  });
});

test.describe('other agreements and the legal desk', () => {
  test('legal creates an NDA from the contracts screen; it is released and signed like a contract', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await signIn(page, 'legal');
    await page.goto('/app/contracts');
    await page.getByRole('button', { name: /New agreement/ }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('Counterparty').selectOption({ label: 'Brightwave Cleaning Pty Ltd' });
    await dlg.getByLabel('Title').fill(`Mutual NDA ${rand()}`);
    await dlg
      .getByLabel('Wording')
      .fill(
        'Each party keeps the other party confidential information secret and uses it only for the project.',
      );
    await dlg.getByRole('button', { name: 'Create the draft' }).click();
    await expect(page.getByText('Non-disclosure agreement').first()).toBeVisible();
    await page.getByRole('button', { name: 'Release for signing' }).click();
    await expect(page.getByText('Awaiting signature').first()).toBeVisible();
    await signIn(page, 'delegate');
    await page.goto('/app/contracts');
    await page
      .getByRole('link', { name: /Mutual NDA/ })
      .first()
      .click();
    await page.getByRole('button', { name: 'Sign contract' }).click();
    await expect(page.getByTestId('locked-banner')).toBeVisible();
  });

  test('the legal desk: open a matter, move it, log hours, and keep a fallback position', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await signIn(page, 'legal');
    await page.goto('/app/legal');
    const name = `Review ${rand()}`;
    const desk = page.getByTestId('legal-desk');
    await desk.getByLabel('New matter').fill(name);
    await desk.getByRole('button', { name: 'Open matter' }).click();
    const matter = desk.getByTestId('matter').filter({ hasText: name });
    await expect(matter).toBeVisible();
    await matter.getByLabel(`Move ${name}`).selectOption('IN_REVIEW');
    await expect(
      desk.locator('[data-lane="IN_REVIEW"]').getByTestId('matter').filter({ hasText: name }),
    ).toBeVisible();
    await desk.locator('[data-lane="IN_REVIEW"]').getByLabel(`Hours on ${name}`, { exact: true }).fill('2.5');
    await desk
      .locator('[data-lane="IN_REVIEW"]')
      .getByRole('button', { name: `Log hours on ${name}` })
      .click();
    await expect(desk.locator('[data-lane="IN_REVIEW"]')).toContainText('2.50 h');
    const kb = `Cap fallback ${rand()}`;
    await desk.getByLabel('Title', { exact: true }).fill(kb);
    await desk
      .getByLabel('Text', { exact: true })
      .fill('Cap liability at twice the annual fees and never below the insurance cover.');
    await desk.getByRole('button', { name: 'Add entry' }).click();
    await expect(desk.getByTestId('knowledge').filter({ hasText: kb })).toBeVisible();
    await desk.getByRole('button', { name: `Remove ${kb}` }).click();
    await expect(desk.getByTestId('knowledge').filter({ hasText: kb })).toHaveCount(0);
    const scan = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(scan.violations).toEqual([]);
    await signIn(page, 'procurement');
    await page.goto('/app/legal');
    await expect(page.getByTestId('legal-desk').getByLabel('New matter')).toHaveCount(0); // procurement reads, legal edits
  });
});

test.describe('time-bound access and the supplier bank details', () => {
  test('procurement gives a requester access to a project; they open its contract; procurement ends the access', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const title = `B4 shared ${rand()}`;
    await draftedContract(title);
    await signIn(page, 'procurement');
    await page.goto('/app/shared');
    const admin = page.getByTestId('grants-admin');
    await admin.getByLabel('Person').selectOption({ label: 'Riley Chen' });
    const option = await admin
      .getByLabel('Project')
      .locator('option')
      .filter({ hasText: title })
      .first()
      .textContent();
    await admin.getByLabel('Project').selectOption({ label: option!.trim() });
    await admin.getByLabel('Capacity').selectOption('AUDITOR');
    await admin.getByLabel('Days after the event').fill('30');
    await admin.getByRole('button', { name: 'Give access' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Access granted' })).toBeVisible();

    await signIn(page, 'requester');
    await page.goto('/app/shared');
    const mine = page.getByTestId('shared-project').filter({ hasText: title });
    await expect(mine).toContainText('Access open');
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      mine.getByRole('link', { name: /Contract CT-/ }).click(),
    ]);
    expect(dl.suggestedFilename()).toMatch(/^contract-.*\.pdf$/);
    const scan = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(scan.violations).toEqual([]);

    await signIn(page, 'procurement');
    await page.goto('/app/shared');
    const grant = page.getByTestId('grant').filter({ hasText: 'Riley Chen' }).first();
    await grant.getByLabel(/Reason to end/).fill('The audit finished early');
    await grant.getByRole('button', { name: /End access for Riley Chen/ }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Access ended' })).toBeVisible();
    await signIn(page, 'requester');
    await page.goto('/app/shared');
    await expect(page.getByTestId('shared-project').filter({ hasText: title })).toContainText('Access ended');
  });

  test('a supplier gives banking details and only the last three digits are shown back', async ({ page }) => {
    test.setTimeout(120_000);
    await page.context().clearCookies();
    await page.goto('/login');
    await page.getByLabel(/Email/).fill(email('supplier'));
    await page.getByLabel(/Password/).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByTestId('supplier-shell')).toBeVisible();
    await page.goto('/supplier/profile');
    const card = page.getByTestId('bank-card');
    await card.getByLabel('BSB').fill('062-000');
    await card.getByLabel('Account number').fill('12345678');
    await card.getByLabel('Account name').fill('Brightwave Cleaning Pty Ltd');
    await card.getByRole('button', { name: 'Save banking details' }).click();
    await expect(card.getByRole('status')).toContainText('*****678');
    await expect(card).not.toContainText('12345678');
    const scan = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(scan.violations).toEqual([]);
  });
});
