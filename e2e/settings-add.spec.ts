import AxeBuilder from '@axe-core/playwright';
import { expect, request as pwRequest, test, type APIRequestContext, type Page } from '@playwright/test';
import { API_URL } from '../playwright.config';
import { email, login, rand, signIn } from './helpers';

/**
 * Settings: every section either has an "Add ..." button beside Save that really takes effect, or says it holds fixed
 * values. These specs add items in the browser, save, reload, and then prove the behaviour changed.
 */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const scan = async (page: Page) =>
  expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations).toEqual([]);

test.describe.configure({ mode: 'serial' });

const ADD_SECTIONS: Array<[string, string]> = [
  ['customFields', 'Add a field'],
  ['intake', 'Add a review rule'],
  ['notifications', 'Add a recipient'],
  ['onboardingQuestions', 'Add a question'],
  ['publicRegisters', 'Add a register'],
  ['contractRules', 'Add a protected clause'],
  ['dashboards', 'Add a capacity override'],
  ['contractManagement', 'Add a spend alert'],
  ['workflowRouting', 'Add a routing rule'],
  ['erpFieldMap', 'Add a mapping'],
  ['signatures', 'Add a value tier'],
];
const FIXED_SECTIONS = [
  'numbering',
  'fieldLabels',
  'checkpoints',
  'evaluationRules',
  'tenderRules',
  'ratings',
  'approvalLinks',
  'currency',
  'artefacts',
  'buying',
  'externalSearch',
  'branding',
  'analytics',
  'legalPlatform',
  'security',
  'content',
  'esgPlan',
];
/** The sections this file changes, put back afterwards so the rest of the suite sees the standard settings. */
const TOUCHED = [
  'intake',
  'workflowRouting',
  'notifications',
  'publicRegisters',
  'contractRules',
  'contractManagement',
  'dashboards',
  'signatures',
] as const;

let original: Record<string, unknown> = {};
const tag = rand();
const RULE = `E2E drone review ${tag}`;

async function admin(): Promise<{ api: APIRequestContext; headers: Record<string, string> }> {
  const api = await pwRequest.newContext({ baseURL: API_URL });
  return { api, headers: await login(api, email('admin')) };
}
async function as(user: string) {
  const api = await pwRequest.newContext({ baseURL: API_URL });
  return { api, headers: await login(api, email(user)) };
}
const gotoSettings = async (page: Page) => {
  await page.goto('/admin/settings');
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await expect(page.getByTestId('settings-signatures')).toBeVisible(); // loaded after the rest
};
const saved = async (page: Page, id: string) =>
  expect(page.getByTestId(`settings-${id}`).getByRole('status')).toContainText(
    'Saved and recorded in the audit trail',
  );

test.beforeAll(async () => {
  const { api, headers } = await admin();
  const cur = await (await api.get('/api/v1/admin/settings', { headers })).json();
  original = Object.fromEntries(TOUCHED.map((k) => [k, cur[k]]));
  await api.dispose();
});
test.afterAll(async () => {
  const { api, headers } = await admin();
  const r = await api.put('/api/v1/admin/settings', { headers, data: original });
  expect(r.ok(), await r.text()).toBeTruthy();
  await api.dispose();
});

test.describe('every section has its Add button or says it is fixed', () => {
  test('ten list sections and signatures show an Add button beside Save; the rest say why they only have Save', async ({
    page,
  }) => {
    await signIn(page, 'admin');
    await gotoSettings(page);
    for (const [id, label] of ADD_SECTIONS) {
      const s = page.getByTestId(`settings-${id}`);
      await expect(s.getByRole('button', { name: label })).toBeVisible();
      await expect(s.getByRole('button', { name: /^Save / })).toBeVisible();
      await expect(page.getByTestId(`settings-${id}-fixed`)).toHaveCount(0);
    }
    for (const id of FIXED_SECTIONS) {
      await expect(page.getByTestId(`settings-${id}-fixed`)).toContainText(
        'This section holds fixed values, so it only has Save.',
      );
      await expect(page.getByTestId(`settings-${id}`).getByRole('button', { name: /^Add / })).toHaveCount(0);
    }
    // the criteria library keeps its own form for adding a criterion
    await expect(
      page.getByTestId('settings-criteriaLibrary').getByRole('button', { name: 'Add to the library' }),
    ).toBeVisible();
    await scan(page);
  });
});

test.describe('plain messages before a save', () => {
  test('an empty rule, an empty routing rule and a capacity override without a manager are explained, not sent', async ({
    page,
  }) => {
    await signIn(page, 'admin');
    await gotoSettings(page);
    const intake = page.getByTestId('settings-intake');
    await intake.getByRole('button', { name: 'Add a review rule' }).click();
    await expect(intake.getByLabel('Rule 6', { exact: true })).toBeFocused();
    await intake.getByRole('button', { name: 'Save intake rules' }).click();
    await expect(intake.getByRole('alert')).toContainText('Review rule 6 needs a name.');
    const routing = page.getByTestId('settings-workflowRouting');
    await routing.getByRole('button', { name: 'Add a routing rule' }).click();
    await routing.getByRole('button', { name: 'Save workflow routing' }).click();
    await expect(routing.getByRole('alert')).toContainText('needs at least one word to look for');
    const dash = page.getByTestId('settings-dashboards');
    await dash.getByRole('button', { name: 'Add a capacity override' }).click();
    await dash.getByRole('button', { name: 'Save dashboards and workload' }).click();
    await expect(dash.getByRole('alert')).toContainText('choose a manager');
    const cm = page.getByTestId('settings-contractManagement');
    await cm.getByRole('button', { name: 'Add a spend alert' }).click();
    await cm.getByLabel(/Extra alert point 1/).fill('90');
    await cm.getByRole('button', { name: 'Save contract management' }).click();
    await expect(cm.getByRole('alert')).toContainText('fixed notices at 80, 90 and 100');
    await scan(page);
    // nothing was saved: after a reload the lists are as they were
    await gotoSettings(page);
    await expect(page.getByTestId('settings-intake').getByTestId('engagement-rule')).toHaveCount(5);
    await expect(page.getByTestId('settings-workflowRouting').getByTestId('routing-rule')).toHaveCount(0);
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test('the Add buttons are easy to reach, a new row fits the screen and nothing scrolls sideways', async ({
    page,
  }) => {
    await signIn(page, 'admin');
    await gotoSettings(page);
    const intake = page.getByTestId('settings-intake');
    const add = intake.getByRole('button', { name: 'Add a review rule' });
    await add.scrollIntoViewIfNeeded();
    const box = (await add.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    await add.click();
    const name = intake.getByLabel('Rule 6', { exact: true });
    await expect(name).toBeFocused();
    const rule = (await name.boundingBox())!;
    expect(rule.x).toBeGreaterThanOrEqual(0);
    expect(rule.x + rule.width).toBeLessThanOrEqual(375);
    const routing = page.getByTestId('settings-workflowRouting');
    await routing.getByRole('button', { name: 'Add a routing rule' }).click();
    await expect(routing.getByLabel('Routing rule 1', { exact: true })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await scan(page);
  });
});

test.describe('an administrator adds items in several sections, saves, reloads and sees them', () => {
  test('review rule, routing rule, recipient, register, protected clause, spend alert, capacity override and signature tier', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await signIn(page, 'admin');
    await gotoSettings(page);

    const intake = page.getByTestId('settings-intake');
    await intake.getByRole('button', { name: 'Add a review rule' }).click();
    await intake.getByLabel('Rule 6', { exact: true }).fill(RULE);
    await intake.getByLabel('Function 6', { exact: true }).selectOption('FINANCE');
    await intake.getByLabel('Words 6 (comma separated)', { exact: true }).fill('drone, uav');
    await intake.getByRole('button', { name: 'Save intake rules' }).click();
    await saved(page, 'intake');

    const routing = page.getByTestId('settings-workflowRouting');
    await routing.getByRole('button', { name: 'Add a routing rule' }).click();
    await routing.getByLabel('Routing rule 1', { exact: true }).fill(`E2E drones are complex ${tag}`);
    await routing.getByLabel(/Words in the title or category 1/).fill('drone');
    await routing.getByLabel('From value 1 (AUD)', { exact: true }).fill('10000');
    await routing.getByLabel('Follows 1', { exact: true }).selectOption('wf-complex');
    await routing.getByRole('button', { name: 'Save workflow routing' }).click();
    await saved(page, 'workflowRouting');

    const notes = page.getByTestId('settings-notifications');
    await notes.getByRole('button', { name: 'Add a recipient' }).click();
    await notes.getByLabel('When 1', { exact: true }).selectOption('BUDGET_BREACH');
    await notes.getByLabel('Also tell 1', { exact: true }).selectOption('PROBITY');
    await notes.getByRole('button', { name: 'Save notifications' }).click();
    await saved(page, 'notifications');

    const regs = page.getByTestId('settings-publicRegisters');
    await regs.getByRole('button', { name: 'Add a register' }).click();
    await regs.getByLabel('Register name 4', { exact: true }).fill('Buy NZ GETS');
    await regs.getByLabel('Jurisdiction 4', { exact: true }).fill('New Zealand');
    await regs.getByLabel('Buy NZ GETS from (AUD)', { exact: true }).fill('50000');
    await regs.getByRole('button', { name: 'Save public registers' }).click();
    await saved(page, 'publicRegisters');

    const rules = page.getByTestId('settings-contractRules');
    await rules.getByRole('button', { name: 'Add a protected clause' }).click();
    await rules.getByLabel('Clause 1 id', { exact: true }).fill('e2eclause');
    await rules.getByRole('button', { name: 'Save contract rules' }).click();
    await saved(page, 'contractRules');

    const cm = page.getByTestId('settings-contractManagement');
    await cm.getByRole('button', { name: 'Add a spend alert' }).click();
    await cm.getByLabel(/Extra alert point 1/).fill('55');
    await cm.getByRole('button', { name: 'Save contract management' }).click();
    await saved(page, 'contractManagement');

    const dash = page.getByTestId('settings-dashboards');
    await dash.getByRole('button', { name: 'Add a capacity override' }).click();
    await dash.getByLabel('Manager 1', { exact: true }).selectOption({ index: 1 });
    await dash.getByLabel('Capacity 1', { exact: true }).fill('2');
    await dash.getByRole('button', { name: 'Save dashboards and workload' }).click();
    await saved(page, 'dashboards');

    const sig = page.getByTestId('settings-signatures');
    await sig.getByRole('button', { name: 'Add a value tier' }).click();
    await sig.getByLabel('From contract value (AUD), tier 1', { exact: true }).fill('123456');
    await sig.getByLabel('Level, tier 1', { exact: true }).selectOption('QES');
    await sig.getByRole('button', { name: /^Save signature levels/ }).click();
    await expect(sig.getByText('Saved and recorded in the audit trail.')).toBeVisible();

    // after a reload every item is still there
    await gotoSettings(page);
    await expect(page.getByTestId('settings-intake').getByLabel('Rule 6', { exact: true })).toHaveValue(RULE);
    await expect(
      page.getByTestId('settings-intake').getByLabel('Words 6 (comma separated)', { exact: true }),
    ).toHaveValue('drone, uav');
    await expect(
      page.getByTestId('settings-workflowRouting').getByLabel('Routing rule 1', { exact: true }),
    ).toHaveValue(`E2E drones are complex ${tag}`);
    await expect(
      page.getByTestId('settings-workflowRouting').getByLabel('Follows 1', { exact: true }),
    ).toHaveValue('wf-complex');
    await expect(
      page.getByTestId('settings-notifications').getByLabel('Also tell 1', { exact: true }),
    ).toHaveValue('PROBITY');
    await expect(
      page.getByTestId('settings-publicRegisters').getByLabel('Register name 4', { exact: true }),
    ).toHaveValue('Buy NZ GETS');
    await expect(
      page.getByTestId('settings-contractRules').getByLabel('Clause 1 id', { exact: true }),
    ).toHaveValue('E2ECLAUSE');
    await expect(
      page.getByTestId('settings-contractManagement').getByLabel(/Extra alert point 1/),
    ).toHaveValue('55');
    await expect(
      page.getByTestId('settings-dashboards').getByLabel('Capacity 1', { exact: true }),
    ).toHaveValue('2');
    await expect(
      page
        .getByTestId('settings-signatures')
        .getByLabel('From contract value (AUD), tier 1', { exact: true }),
    ).toHaveValue('123456');
    await scan(page);

    // the change log says in words what was added
    await page.goto('/app/audit');
    const row = page.getByTestId('audit-row').filter({ hasText: 'settings.intake' }).first();
    await expect(row).toContainText(`Added review rule: ${RULE} (FINANCE)`);
  });
});

test.describe('and the behaviour follows', () => {
  test('a request that mentions the rule word asks for that review and follows the routed workflow; a plain one does not', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const { api, headers } = await as('requester');
    const make = async (title: string, value: number) => {
      const r = await api.post('/api/v1/requests', {
        headers,
        data: {
          title,
          category: 'Building cleaning (UNSPSC 76111500)',
          estimatedValue: value,
          termMonths: 12,
          businessUnit: 'Facilities',
          fields: { contractOwner: 'Sofia Rossi' },
        },
      });
      expect(r.ok(), await r.text()).toBeTruthy();
      return (await r.json()).id as string;
    };
    const drone = await make(`Drone survey of depots ${tag}`, 20_000);
    const plain = await make(`Stationery ${tag}`, 20_000);
    const view = async (id: string) =>
      (await (await api.get(`/api/v1/requests/${id}`, { headers })).json()) as {
        workflow: { id: string };
        engagements: Array<{ label: string }>;
      };
    const d = await view(drone);
    expect(d.workflow.id).toBe('wf-complex');
    expect(d.engagements.map((e) => e.label)).toContain(RULE);
    const p = await view(plain);
    expect(p.workflow.id).toBe('wf-simple');
    expect(p.engagements.map((e) => e.label)).not.toContain(RULE);
    // and the requester sees it on the request page
    await signIn(page, 'requester');
    await page.goto(`/app/requests/${drone}`);
    await expect(page.getByTestId('process-card')).toContainText('Complex tender');
    await expect(page.getByTestId('engagements-card')).toContainText(RULE);
    await api.dispose();
  });

  test('a role added for a budget breach is told when a request breaks the budget', async () => {
    const { api, headers } = await as('requester');
    const title = `Budget breach ${tag}`;
    const r = await api.post('/api/v1/requests', {
      headers,
      data: {
        title,
        category: 'Building cleaning (UNSPSC 76111500)',
        estimatedValue: 900_000,
        termMonths: 12,
        businessUnit: 'Procurement',
        fields: { contractOwner: 'Sofia Rossi' },
      },
    });
    const id = (await r.json()).id as string;
    const submit = await api.post(`/api/v1/requests/${id}/submit`, { headers });
    expect(submit.status()).toBe(422); // the hard cap blocks it and tells finance
    const probity = await as('probity');
    const told = (await (
      await probity.api.get('/api/v1/notifications', { headers: probity.headers })
    ).json()) as Array<{
      title: string;
      body?: string;
    }>;
    expect(told.some((n) => `${n.title} ${n.body ?? ''}`.includes(title))).toBeTruthy();
    await api.dispose();
    await probity.api.dispose();
  });

  test('a public-sector tender worth more than the added register is sent to it', async () => {
    test.setTimeout(120_000);
    const requester = await as('requester');
    const procurement = await as('procurement');
    const delegate = await as('delegate');
    const c = await requester.api.post('/api/v1/requests', {
      headers: requester.headers,
      data: {
        title: `Register proof ${tag}`,
        category: 'Building cleaning (UNSPSC 76111500)',
        estimatedValue: 60_000,
        termMonths: 24,
        businessUnit: 'Facilities',
        fields: { contractOwner: 'Sofia Rossi', background: 'Existing arrangements end in six months.' },
      },
    });
    const id = (await c.json()).id as string;
    expect(
      (await requester.api.post(`/api/v1/requests/${id}/submit`, { headers: requester.headers })).ok(),
    ).toBeTruthy();
    const plan = await (
      await procurement.api.get(`/api/v1/requests/${id}/plan`, { headers: procurement.headers })
    ).json();
    expect(
      (
        await procurement.api.post(`/api/v1/plans/${plan.id}/submit-for-approval`, {
          headers: procurement.headers,
        })
      ).ok(),
    ).toBeTruthy();
    expect(
      (
        await delegate.api.post(`/api/v1/plans/${plan.id}/decision`, {
          headers: delegate.headers,
          data: { decision: 'APPROVE' },
        })
      ).ok(),
    ).toBeTruthy();
    const t = await (
      await procurement.api.post('/api/v1/tenders', {
        headers: procurement.headers,
        data: { requestId: id, type: 'RFT', access: 'CLOSED' },
      })
    ).json();
    expect(
      (
        await delegate.api.post(`/api/v1/tenders/${t.id}/publish-permission`, {
          headers: delegate.headers,
          data: {},
        })
      ).ok(),
    ).toBeTruthy();
    const closesAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const pub = await procurement.api.post(`/api/v1/tenders/${t.id}/publish`, {
      headers: procurement.headers,
      data: { closesAt },
    });
    expect(pub.ok(), await pub.text()).toBeTruthy();
    const notices = (await (
      await procurement.api.get(`/api/v1/tenders/${t.id}/notices`, { headers: procurement.headers })
    ).json()) as Array<{ register: string; reference: string }>;
    expect(notices.map((n) => n.register)).toEqual(['Buy NZ GETS']);
    expect(notices[0]!.reference).toMatch(/^BUYNZGETS-\d{4}-PR-/);
    await Promise.all([requester, procurement, delegate].map((x) => x.api.dispose()));
  });

  test('the manager with an override is measured against it on the capacity report', async () => {
    const exec = await as('exec');
    const rep = (await (
      await exec.api.get('/api/v1/reports/capacity', { headers: exec.headers })
    ).json()) as {
      capacityPerManager: number;
      managers: Array<{ capacity: number }>;
    };
    expect(rep.managers.some((m) => m.capacity === 2)).toBeTruthy();
    expect(rep.capacityPerManager).toBe(6); // everyone else is still measured against the shared limit
    await exec.api.dispose();
  });

  test('the other additions are stored for the behaviour that reads them (spend alert, protected clause, signature tier)', async () => {
    const { api, headers } = await admin();
    const s = await (await api.get('/api/v1/admin/settings', { headers })).json();
    expect(s.contractManagement.extraSpendAlertPcts).toEqual([55]);
    expect(s.contractRules.protectedClauses).toEqual(['E2ECLAUSE']);
    expect(s.signatures.requiredLevelByValue).toEqual([{ fromAud: 123456, level: 'QES' }]);
    expect(s.notifications.extraRecipients).toEqual([{ event: 'BUDGET_BREACH', role: 'PROBITY' }]);
    await api.dispose();
  });
});
