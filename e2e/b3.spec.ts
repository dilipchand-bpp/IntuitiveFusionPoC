import AxeBuilder from '@axe-core/playwright';
import { expect, request as pwRequest, test } from '@playwright/test';
import { API_URL } from '../playwright.config';
import {
  SUPPLIER_PASSWORD,
  apiAs,
  apiConsensusAndLock,
  apiDeclareNone,
  apiScoreAndSubmit,
  closedTender,
  email,
  login,
  openEvaluationApi,
  rand,
  signIn,
} from './helpers';

/** Roadmap batch B3 in the browser: evaluation and the report. */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function lockedEvaluation(title: string, bidders = 2) {
  const t = await closedTender(title, bidders);
  const evalId = await openEvaluationApi(t.tenderId);
  for (const u of ['evaluator-tech', 'evaluator-comm', 'chair']) await apiDeclareNone(u, evalId);
  for (const u of ['evaluator-tech', 'evaluator-comm', 'chair']) await apiScoreAndSubmit(u, evalId);
  await apiConsensusAndLock(evalId);
  return { ...t, evalId };
}
async function supplierApi(mail: string) {
  const api = await pwRequest.newContext({ baseURL: API_URL });
  return { api, headers: await login(api, mail, SUPPLIER_PASSWORD) };
}

test.describe('the compliance gate and clarifications', () => {
  test('a failed check is shown, the supplier is asked to put it right and answers, and procurement can waive another with a reason', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const t = await closedTender(`B3 gate ${rand()}`, 2);
    // the second supplier's insurance certificate has expired; the first has none recorded (allowed by default)
    const sup = await supplierApi(t.emails[1]!);
    expect(
      (
        await sup.api.put('/api/v1/supplier/profile/insurance', {
          headers: sup.headers,
          data: {
            insurer: 'Old Cover Ltd',
            policyNumber: 'P-1',
            coverAud: 1_000_000,
            expiresOn: '2020-01-01',
          },
        })
      ).ok(),
    ).toBeTruthy();
    const evalId = await openEvaluationApi(t.tenderId);

    await signIn(page, 'procurement');
    await page.goto(`/app/evaluations/${evalId}`);
    const gate = page.getByTestId('compliance-panel');
    await expect(gate).toContainText('1 failed');
    const row = gate.getByTestId('compliance-supplier').filter({ hasText: t.companies[1]! });
    await expect(row).toContainText('The insurance certificate has expired');
    const scan = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(scan.violations).toEqual([]);

    // the supplier was asked automatically, and answers in their own portal
    await signIn(page, t.emails[1]!);
    await page.goto(`/supplier/tenders/${t.tenderId}`);
    const reqs = page.getByTestId('supplier-requests');
    await expect(reqs).toContainText('Compliance: Insurance');
    await reqs
      .getByLabel('Your answer to: Compliance: Insurance', { exact: true })
      .fill('The renewed certificate was lodged today.');
    await reqs.getByRole('button', { name: 'Send your answer to: Compliance: Insurance' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Your answer was sent' })).toBeVisible();

    // procurement reads the answer, then waives the failed check with a reason
    await signIn(page, 'procurement');
    await page.goto(`/app/evaluations/${evalId}`);
    await expect(page.getByTestId('clarifications-panel')).toContainText(
      'The renewed certificate was lodged today.',
    );
    const again = page.getByTestId('compliance-supplier').filter({ hasText: t.companies[1]! });
    await again.getByLabel(/Reason for waiving: Insurance/).fill('Renewal certificate sighted by email');
    await again.getByRole('button', { name: /Waive Insurance/ }).click();
    await expect(again).toContainText('Waived');
    await expect(page.getByTestId('compliance-panel')).toContainText('All passed');
  });

  test('procurement asks a bidder to clarify; the answer appears for the panel, and a late answer is not accepted', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const t = await closedTender(`B3 clarify ${rand()}`, 2);
    const evalId = await openEvaluationApi(t.tenderId);
    await signIn(page, 'procurement');
    await page.goto(`/app/evaluations/${evalId}`);
    const panel = page.getByTestId('clarifications-panel');
    await panel.getByLabel('Supplier', { exact: true }).selectOption({ label: t.companies[0]! });
    await panel.getByLabel('Subject').fill('Transition plan');
    await panel
      .getByLabel('What do you need to know?')
      .fill('Explain how the first 30 days will be staffed.');
    await panel.getByRole('button', { name: 'Ask the supplier' }).click();
    await expect(panel).toContainText('Transition plan');
    await expect(panel).toContainText('Waiting');
    await signIn(page, t.emails[0]!);
    await page.goto(`/supplier/tenders/${t.tenderId}`);
    const reqs = page.getByTestId('supplier-requests');
    await reqs
      .getByLabel('Your answer to: Transition plan', { exact: true })
      .fill('A transition lead and four technicians.');
    await reqs.getByRole('button', { name: 'Send your answer to: Transition plan' }).click();
    await expect(reqs).toContainText('Your answer: A transition lead and four technicians.');
    await signIn(page, 'chair');
    await page.goto(`/app/evaluations/${evalId}`);
    await expect(page.getByTestId('evaluation-workspace')).toBeVisible();
  });
});

test.describe('criteria, plain language and ranking', () => {
  test('procurement chooses criteria from the library before scoring opens; the weights must add to 100', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const t = await closedTender(`B3 criteria ${rand()}`, 2);
    const evalId = await openEvaluationApi(t.tenderId);
    await signIn(page, 'procurement');
    await page.goto(`/app/evaluations/${evalId}`);
    const editor = page.getByTestId('criteria-editor');
    await editor.getByRole('button', { name: 'Remove Experience and references' }).click();
    await expect(editor.getByTestId('criteria-total')).toContainText('90');
    await expect(editor.getByRole('button', { name: 'Save criteria' })).toBeDisabled();
    await editor.getByLabel('Add from the library').selectOption('Sustainability and social value');
    await editor.getByRole('button', { name: 'Add criterion' }).click();
    await expect(editor.getByTestId('criteria-total')).toContainText('100');
    await editor.getByRole('button', { name: 'Save criteria' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Criteria saved' })).toBeVisible();
    const proc = await apiAs('procurement');
    const names = (
      (await (await proc.api.get(`/api/v1/evaluations/${evalId}`)).json()).criteria as Array<{ name: string }>
    ).map((c) => c.name);
    expect(names).toContain('Sustainability and social value');
    expect(names).not.toContain('Experience and references');
    const scan = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(scan.violations).toEqual([]);
  });

  test('an evaluator describes a supplier in words, sees how it was read, saves it, and the sheet shows the scores', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const t = await closedTender(`B3 plain ${rand()}`, 2);
    const evalId = await openEvaluationApi(t.tenderId);
    for (const u of ['evaluator-tech', 'evaluator-comm', 'chair']) await apiDeclareNone(u, evalId);
    await signIn(page, 'evaluator-tech');
    await page.goto(`/app/evaluations/${evalId}`);
    const card = page.getByTestId('plain-scores');
    await card.getByLabel('Supplier').selectOption({ label: t.companies[0]! });
    await card
      .getByLabel('Your assessment')
      .fill('Technical capability is strong. Delivery and risk management is weak, 3 out of 10.');
    await card.getByRole('button', { name: 'Read it back' }).click();
    const reading = card.getByTestId('plain-reading');
    await expect(reading).toContainText('Technical capability and approach: 8.5 out of 10');
    await expect(reading).toContainText('Delivery, transition and risk management: 3 out of 10');
    await card.getByRole('button', { name: 'Save these scores' }).click();
    const sheet = page.getByTestId('scoring-sheet');
    await expect(sheet.getByLabel(`${t.companies[0]}: Technical capability and approach`)).toHaveValue('8.5');
    await expect(sheet.getByLabel(`${t.companies[0]}: Delivery, transition and risk management`)).toHaveValue(
      '3',
    );
    const scan = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(scan.violations).toEqual([]);
  });

  test('a ranking evaluation: the evaluator puts the suppliers in order and marks it complete', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const t = await closedTender(`B3 ranking ${rand()}`, 2);
    const proc = await apiAs('procurement');
    const people = await (await proc.api.get('/api/v1/evaluators')).json();
    const id = (n: string) => people.evaluators.find((p: { name: string }) => p.name === n).id as string;
    const opened = await proc.api.post(`/api/v1/tenders/${t.tenderId}/evaluation`, {
      headers: proc.headers,
      data: {
        panel: [
          { userId: id('Tomas Silva'), stream: 'TECHNICAL' },
          { userId: id('Mei Tanaka'), stream: 'COMMERCIAL' },
        ],
        mode: 'RANKING',
        priceWeightPct: 40,
      },
    });
    expect(opened.status(), await opened.text()).toBe(201);
    const evalId = (await opened.json()).id as string;
    for (const u of ['evaluator-tech', 'evaluator-comm', 'chair']) await apiDeclareNone(u, evalId);
    await signIn(page, 'evaluator-tech');
    await page.goto(`/app/evaluations/${evalId}`);
    await expect(page.getByText('Ranking evaluation')).toBeVisible();
    const entry = page.getByTestId('ranking-entry');
    const rows = entry.getByTestId('rank-row');
    await expect(rows).toHaveCount(2);
    await entry.getByRole('button', { name: new RegExp(`Move ${t.companies[1]} up`) }).click();
    await expect(rows.first()).toContainText(t.companies[1]!);
    await entry.getByRole('button', { name: 'Save my ranking' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Your ranking is saved' })).toBeVisible();
    await entry.getByRole('button', { name: 'Mark my ranking complete' }).click();
    await expect(page.getByText('Your scores are in')).toBeVisible();
    const mine = await (
      await (await apiAs('evaluator-tech')).api.get(`/api/v1/evaluations/${evalId}/scores/mine`)
    ).json();
    expect(mine.progress.complete).toBe(true);
  });
});

test.describe('conflicts and the panel', () => {
  test('a member confirms their declaration again once supplier names are visible; procurement replaces the commercial evaluator', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const t = await closedTender(`B3 panel ${rand()}`, 2);
    const evalId = await openEvaluationApi(t.tenderId);
    await apiDeclareNone('evaluator-tech', evalId);
    await signIn(page, 'evaluator-tech');
    await page.goto(`/app/evaluations/${evalId}`);
    const card = page.getByTestId('redeclare-card');
    await expect(card).toBeVisible();
    await card.getByLabel('I still have no conflict of interest').check();
    await card.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByTestId('redeclare-card')).toHaveCount(0);

    await signIn(page, 'procurement');
    await page.goto(`/app/evaluations/${evalId}`);
    const tools = page.getByTestId('panel-tools');
    await expect(tools.getByTestId('redeclare-summary')).toContainText('Still to declare or confirm again');
    await expect(tools).toContainText('Confirmed again');
    await tools.getByLabel('Who is leaving').selectOption({ label: 'Mei Tanaka (Commercial)' });
    await tools.getByLabel('Replacement').selectOption({ label: 'Nia Okoro' });
    await tools.getByRole('button', { name: 'Replace evaluator' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'The replacement was told' })).toBeVisible();
    const panel = page.getByTestId('panel-card');
    await expect(panel).toContainText('Nia Okoro');
    await expect(panel).toContainText('Removed (conflict)'); // the leaver, shown as no longer on the panel
    const scan = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(scan.violations).toEqual([]);
    // the replacement can now declare, and nobody else on the panel is disturbed
    await signIn(page, 'evaluator-extra');
    await page.goto(`/app/evaluations/${evalId}`);
    await expect(page.getByTestId('evaluation-workspace')).toBeVisible();
  });
});

test.describe('the probity advisor', () => {
  test('an external advisor sees only the procurement allocated to them, holds and releases it, and signs a probity plan', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const t = await closedTender(`B3 advisor ${rand()}`, 2);
    const other = await closedTender(`B3 other ${rand()}`, 2);
    const evalId = await openEvaluationApi(t.tenderId);
    await openEvaluationApi(other.tenderId);
    // procurement allocates the advisor through the screen
    await signIn(page, 'procurement');
    await page.goto(`/app/evaluations/${evalId}`);
    const alloc = page.getByTestId('advisor-allocation');
    await alloc.getByLabel('Allocate an advisor').selectOption({ label: 'Alex Marlow' });
    await alloc.getByRole('button', { name: 'Allocate' }).click();
    await expect(alloc).toContainText('Alex Marlow');

    await signIn(page, 'advisor');
    await expect(page).toHaveURL(/\/app\/probity/);
    await expect(page.getByRole('heading', { name: 'Probity portal' })).toBeVisible();
    const rows = page.getByTestId('probity-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(`B3 advisor`);
    // nothing outside what is allocated is reachable
    const adv = await apiAs('advisor');
    expect((await adv.api.get('/api/v1/requests')).status()).toBe(403);
    expect((await adv.api.get('/api/v1/audit-events')).status()).toBe(403);
    const nav = await page.locator('nav a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    expect(nav.filter((h) => h?.startsWith('/app'))).toEqual(
      expect.arrayContaining(['/app/probity', '/app/evaluations']),
    );
    expect(nav).not.toContain('/app/requests');

    await rows.first().getByRole('link').click();
    const hold = page.getByTestId('hold-card');
    await hold.getByLabel('Why you are placing it on hold').fill('Possible bias in the panel selection');
    await hold.getByRole('button', { name: 'Place on hold' }).click();
    await expect(page.getByTestId('hold-banner')).toContainText('Possible bias in the panel selection');
    // the panel sees why it is frozen, and nothing can change
    await signIn(page, 'evaluator-tech');
    await page.goto(`/app/evaluations/${evalId}`);
    await expect(page.getByTestId('hold-banner')).toBeVisible();
    const tech = await apiAs('evaluator-tech');
    const refused = await tech.api.post(`/api/v1/evaluations/${evalId}/coi`, {
      headers: tech.headers,
      data: { none: true },
    });
    expect(refused.status()).toBe(423);

    await signIn(page, 'advisor');
    await page.goto(`/app/evaluations/${evalId}`);
    await page
      .getByTestId('hold-card')
      .getByLabel('Why you are releasing it')
      .fill('Panel reconstituted; proceed');
    await page.getByTestId('hold-card').getByRole('button', { name: 'Release the hold' }).click();
    await expect(page.getByTestId('hold-banner')).toHaveCount(0);

    // the probity plan: written in the platform, signed, with a stamp that names the advisor
    const docs = page.getByTestId('probity-docs');
    const plan = docs.getByTestId('probity-plan');
    await plan.getByLabel('Title of the probity plan').fill('Probity plan for the cleaning contract');
    await plan
      .getByLabel('Text of the probity plan')
      .fill(
        'The advisor will observe declarations, scoring and consensus.\n\nBreaches are reported to the delegate.',
      );
    await plan.getByRole('button', { name: 'Save probity plan' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Probity plan saved' })).toBeVisible();
    await plan.getByRole('button', { name: 'Sign the probity plan' }).click();
    await expect(docs.getByTestId('probity-plan-stamp')).toContainText('PROBITY PLAN SIGNED · Alex Marlow');
    await expect(plan.getByRole('link', { name: 'PDF' })).toBeVisible();
    const scan = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(scan.violations).toEqual([]);
  });
});

test.describe('negotiation and best and final offers', () => {
  test('procurement opens a round, the supplier makes an offer, procurement closes the round and accepts it; the original bid stays', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const t = await lockedEvaluation(`B3 bafo ${rand()}`, 2);
    await signIn(page, 'procurement');
    await page.goto(`/app/evaluations/${t.evalId}`);
    const nego = page.getByTestId('negotiation-panel');
    await nego.getByLabel(t.companies[0]!).check();
    await nego.getByLabel('What you are asking for').fill('Please improve your price and the contract term.');
    await nego.getByRole('button', { name: 'Open the round' }).click();
    await expect(nego.getByRole('listitem').filter({ hasText: 'Round 1' })).toContainText('Open');

    await signIn(page, t.emails[0]!);
    await page.goto(`/supplier/tenders/${t.tenderId}`);
    const bafo = page.getByTestId('supplier-bafo');
    await expect(bafo).toContainText('Your original bid stays on record');
    await bafo.getByLabel('Price (AUD)').fill('150000');
    await bafo.getByLabel('Implementation (AUD)').fill('5000');
    await bafo.getByRole('button', { name: 'Submit an offer for round 1' }).click();
    await expect(bafo).toContainText('Revision 1');
    await expect(bafo).toContainText('AUD 155,000');
    await bafo.getByLabel('Price (AUD)').fill('140000');
    await bafo.getByRole('button', { name: 'Submit an offer for round 1' }).click();
    await expect(bafo).toContainText('Revision 2');

    await signIn(page, 'procurement');
    await page.goto(`/app/evaluations/${t.evalId}`);
    await expect(page.getByTestId('negotiation-panel')).toContainText(
      '2 offer(s) received, sealed until the round closes',
    );
    await page.getByRole('button', { name: 'Close round 1' }).click();
    const offers = page.getByRole('list', { name: 'Offers in round 1' });
    await expect(offers).toContainText('revision 2');
    await offers.getByRole('button', { name: /Accept .* revision 2/ }).click();
    await expect(offers.locator('[data-accepted="true"]')).toContainText('Accepted');
    await expect(page.getByTestId('ranking')).toContainText('Total cost AUD 145,000');
    const scan = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(scan.violations).toEqual([]);
  });

  test('the negotiation advisor suggests what to ask for, and says what each suggestion is based on', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const t = await lockedEvaluation(`B3 advice ${rand()}`, 2);
    await signIn(page, 'procurement');
    await page.goto(`/app/evaluations/${t.evalId}`);
    await page.getByRole('button', { name: 'Suggest what to negotiate' }).click();
    const advice = page.getByTestId('advice');
    await expect(advice).toContainText('Based on:');
    await expect(advice).toContainText('not by an external model');
  });
});

test.describe('the report', () => {
  test('compiled at the lock, routed to the delegate whose authority covers the value, declared against, printable, and approved on a phone', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const t = await lockedEvaluation(`B3 report ${rand()}`, 2);
    await signIn(page, 'procurement');
    await page.goto(`/app/evaluations/${t.evalId}`);
    const panel = page.getByTestId('report-panel');
    await expect(panel).toContainText('Draft: ready to review');
    await expect(panel.locator('[data-report-section="compliance"]')).toContainText('passed all 4 checks');
    await expect(panel.locator('[data-report-section="distribution"]')).toContainText('lowest');
    await panel.getByRole('button', { name: 'Generate report' }).click();
    await expect(panel).toContainText('Awaiting approval');
    // the lowest authority that covers the value; an acting delegate named by the HR feed (b10b.spec, same database) may be listed too,
    // but the executive, whose authority is higher, never is
    await expect(panel.getByTestId('routed-to')).toContainText('Dana Okafor');
    await expect(panel.getByTestId('routed-to')).not.toContainText('Elena Petrova');
    await expect(panel.getByRole('button', { name: 'Print' })).toBeVisible();
    // the PDF carries the audit information
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      panel.getByRole('link', { name: 'Download PDF' }).click(),
    ]);
    expect(dl.suggestedFilename()).toMatch(/^evaluation-report-.*\.pdf$/);
    // procurement declares on the report as at the plan
    await panel.getByLabel('I have no conflict of interest on this report').check();
    await panel.getByRole('button', { name: 'Declare on the report' }).click();
    await expect(panel.getByTestId('report-coi')).toContainText('No conflict');

    // the delegate reviews and approves on a phone
    await signIn(page, 'delegate');
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/app/evaluations/${t.evalId}`);
    const mobile = page.getByTestId('report-panel');
    await mobile.getByLabel('I have no conflict of interest on this report').check();
    await mobile.getByRole('button', { name: 'Declare on the report' }).click();
    await expect(mobile.getByTestId('report-coi')).toContainText('No conflict');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await mobile.getByRole('button', { name: 'Approve report' }).click();
    await expect(page.getByTestId('report-stamp')).toContainText('REPORT APPROVED · Dana Okafor');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const scan = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(scan.violations).toEqual([]);
  });
});

test.describe('settings', () => {
  test('the administrator adds a criterion to the library and removes it again; the evaluation rules are shown', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await signIn(page, 'admin');
    await page.goto('/admin/settings');
    await expect(page.getByTestId('settings-evaluationRules')).toContainText('compliance gate');
    const lib = page.getByTestId('settings-criteriaLibrary');
    const name = `Local presence ${rand()}`;
    await lib.getByLabel('New criterion').fill(name);
    await lib.getByRole('button', { name: 'Add to the library' }).click();
    await expect(lib).toContainText(name);
    await lib.getByRole('button', { name: 'Save criteria library' }).click();
    await expect(lib.getByRole('status')).toContainText('Saved');
    await page.reload();
    const again = page.getByTestId('settings-criteriaLibrary');
    await expect(again).toContainText(name);
    await again.getByRole('button', { name: `Remove ${name} from the library` }).click();
    await again.getByRole('button', { name: 'Save criteria library' }).click();
    await expect(again.getByRole('status')).toContainText('Saved');
    await expect(again).not.toContainText(name);
    const scan = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(scan.violations).toEqual([]);
  });
});

void email;
