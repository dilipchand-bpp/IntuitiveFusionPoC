// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { Section, SettingsPanel, type SettingsData } from './settings-panel';
import {
  checkClauses,
  checkOverrides,
  checkRecipients,
  checkRegisters,
  checkReviewRules,
  checkRoutingRules,
  checkSpendAlerts,
  nextKey,
  parseWords,
} from './settings-list-rules';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/components/b11/settings-sections', () => ({ B11dSettings: () => null }));
const apiMock = vi.fn();
vi.mock('@/lib/api-client', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/lib/api-client')),
  api: (...a: unknown[]) => apiMock(...a),
}));

const MANAGER = '3f2b8c1e-0000-4000-8000-000000000001';
const DATA: SettingsData = {
  numbering: { scheme: 'YEAR_SEQ', prefix: 'PR', digits: 4 },
  numberingExample: 'PR-2026-0007',
  fieldLabels: {},
  customFields: [],
  checkpoints: { coiBeforeApproval: true, evaluationBeforeReport: true, reportSignoffBeforeContract: true },
  intake: {
    selfServiceThresholdAud: 50_000,
    budgetCap: 'HARD',
    taxonomy: 'UNSPSC',
    layouts: {},
    engagementRules: [
      { id: 'itSoftware', label: 'IT review for software', function: 'IT', keywords: ['software'] },
    ],
  },
  notifications: {
    channels: ['IN_APP', 'EMAIL'],
    escalationHours: 48,
    rules: [{ event: 'BUDGET_BREACH', enabled: true }],
    extraRecipients: [],
  },
  security: { requireMfa: false, enforceSso: false, stepUpApprovals: false },
  onboardingQuestions: [],
  publicRegisters: [
    { register: 'AusTender', jurisdiction: 'Australia (Commonwealth)', minValueAud: 80_000, enabled: true },
    { register: 'TED', jurisdiction: 'European Union', minValueAud: 215_000, enabled: false },
  ],
  contractRules: {
    requireBankDetails: false,
    requireRiskSummaryReview: false,
    endorsements: [],
    protectedClauses: [],
    negotiationLockDays: 30,
    signingReminderHours: 48,
  },
  dashboards: { visibility: 'BROAD', capacityPerManager: 6, referenceRefreshDays: 90, capacityOverrides: [] },
  tenderRules: { dualWitnessThresholdAud: 5_000_000, witnessWindowMinutes: 30 },
  ratings: { supplierSeesRatings: false, staffSeeSupplierRatings: true },
  legalPlatform: { enabled: false, name: 'Legal platform', webhookSecret: '', simulateOutage: false },
  approvalLinks: { enabled: true, validHours: 48, showCommercial: false },
  currency: { base: 'AUD', rateMode: 'ANNUAL' },
  artefacts: { laterStage: 'REALTIME', batchMinutes: 15 },
  buying: { enabled: true, autoSourceLimitAud: 5_000 },
  externalSearch: { enabled: false },
  branding: { productName: 'Intuitive Fusion', tagline: '', palette: 'INDIGO', supportEmail: '' },
  analytics: { refreshMinutes: 15, consolidationPct: 8, varianceThresholdPct: 5, driftThresholdPct: 10 },
  contractManagement: {
    erpIntegrated: true,
    variationModel: 'CUMULATIVE',
    variationNumbering: 'SUFFIX',
    publicSectorDisclosure: false,
    disclosureThresholdPct: 10,
    disclosureDays: 42,
    highValueAud: 1_000_000,
    spendAlertPct: 70,
    extraSpendAlertPcts: [],
    planTemplates: [],
  },
  criteriaLibrary: [],
  evaluationRules: {
    requireInsurance: false,
    rankingMaxValueAud: 100_000,
    redeclarationReminderHours: 24,
    clarificationDays: 5,
  },
  erpFieldMap: [],
  workflowRouting: { simpleBelow: 50_000, intermediateBelow: 1_000_000, rules: [] },
};

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
];

let saved: SettingsData;
function show(data: SettingsData = DATA) {
  saved = data;
  apiMock.mockImplementation(async (_path: string, opts?: { body?: Record<string, unknown> }) => {
    saved = { ...saved, ...(opts?.body as object) } as SettingsData;
    return saved;
  });
  return render(
    <SettingsPanel
      initial={data}
      log={[]}
      csrf="x"
      managers={[{ id: MANAGER, name: 'Priya Procurement' }]}
    />,
  );
}
const section = (id: string) => screen.getByTestId(`settings-${id}`);
const lastPut = () => {
  const call = apiMock.mock.calls
    .filter((c) => (c[1] as { method?: string } | undefined)?.method === 'PUT')
    .at(-1);
  return call ? ((call[1] as { body: Record<string, unknown> }).body as Record<string, any>) : null; // eslint-disable-line @typescript-eslint/no-explicit-any
};

beforeEach(() => {
  apiMock.mockReset();
  refresh.mockReset();
});
afterEach(() => cleanup());

describe('Section', () => {
  it('shows the Add button beside Save with a count, and stops at the limit', async () => {
    const onAdd = vi.fn();
    const base = {
      id: 'x',
      title: 'Things',
      blurb: 'b',
      onSave: vi.fn(),
      busy: false,
      saved: false,
      error: null,
    };
    const { rerender } = render(
      <Section {...base} add={{ label: 'Add a thing', onClick: onAdd, count: 1, max: 2 }}>
        <p>body</p>
      </Section>,
    );
    expect(screen.getByTestId('x-count')).toHaveTextContent('1 of 2 used');
    await userEvent.click(screen.getByRole('button', { name: 'Add a thing' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    rerender(
      <Section {...base} add={{ label: 'Add a thing', onClick: onAdd, count: 2, max: 2 }}>
        <p>body</p>
      </Section>,
    );
    expect(screen.getByRole('button', { name: 'Add a thing' })).toBeDisabled();
    expect(screen.getByTestId('x-count')).toHaveTextContent('Limit reached: 2');
  });

  it('says a fixed section is fixed, with its reason, and offers only Save', () => {
    render(
      <Section
        id="y"
        title="Fixed"
        blurb="b"
        fixed="One value."
        onSave={vi.fn()}
        busy={false}
        saved={false}
        error={null}
      >
        <p>body</p>
      </Section>,
    );
    expect(screen.getByTestId('settings-y-fixed')).toHaveTextContent(
      'This section holds fixed values, so it only has Save. One value.',
    );
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});

describe('every section of the settings page', () => {
  it.each(ADD_SECTIONS)('%s has an "%s" button beside Save', (id, label) => {
    show();
    const s = within(section(id));
    expect(s.getByRole('button', { name: label })).toBeEnabled();
    expect(s.getByRole('button', { name: /^Save / })).toBeInTheDocument();
    expect(screen.queryByTestId(`settings-${id}-fixed`)).toBeNull();
  });

  it.each(FIXED_SECTIONS)('%s only has Save, and says why', (id) => {
    show();
    const s = within(section(id));
    expect(screen.getByTestId(`settings-${id}-fixed`)).toHaveTextContent(/only has Save\. \S/);
    expect(s.queryByTestId(`${id}-add`)).toBeNull();
    expect(s.getAllByRole('button', { name: /^Save / })).toHaveLength(1);
  });

  it('the criteria library keeps its own form for adding a criterion', () => {
    show();
    expect(
      within(section('criteriaLibrary')).getByRole('button', { name: 'Add to the library' }),
    ).toBeDisabled();
  });
});

describe('Add a review rule', () => {
  it('adds a row with a fresh key and focus on its name, refuses an empty rule, and saves a filled one', async () => {
    const u = userEvent.setup();
    show();
    const s = within(section('intake'));
    await u.click(s.getByRole('button', { name: 'Add a review rule' }));
    const name = s.getByLabelText('Rule 2');
    expect(name).toHaveFocus();
    expect(s.getByTestId('intake-count')).toHaveTextContent('2 of 30 used');
    await u.click(s.getByRole('button', { name: 'Save intake rules' }));
    expect(s.getByRole('alert')).toHaveTextContent('Review rule 2 needs a name.');
    expect(s.getByRole('alert')).toHaveTextContent('needs at least one word or a value');
    expect(apiMock).not.toHaveBeenCalled();
    await u.type(name, 'Legal for drones');
    await u.type(s.getByLabelText('Words 2 (comma separated)'), 'Drone, UAV');
    expect(s.getByLabelText('Words 2 (comma separated)')).toHaveValue('Drone, UAV');
    await u.type(s.getByLabelText('From value 2 (AUD)'), '5000');
    await u.click(s.getByRole('button', { name: 'Save intake rules' }));
    await waitFor(() => expect(lastPut()).not.toBeNull());
    expect(lastPut()!.intake.engagementRules[1]).toEqual({
      id: 'rule1',
      label: 'Legal for drones',
      function: 'LEGAL',
      keywords: ['drone', 'uav'],
      minValue: 5000,
    });
    expect(await s.findByRole('status')).toHaveTextContent('Saved and recorded in the audit trail');
  });

  it('removes a row, and the empty value clears the minimum', async () => {
    const u = userEvent.setup();
    show();
    const s = within(section('intake'));
    await u.type(s.getByLabelText('From value 1 (AUD)'), '9');
    await u.clear(s.getByLabelText('From value 1 (AUD)'));
    await u.click(s.getByRole('button', { name: 'Save intake rules' }));
    await waitFor(() => expect(lastPut()).not.toBeNull());
    expect('minValue' in lastPut()!.intake.engagementRules[0]).toBe(false);
    await u.click(s.getByRole('button', { name: 'Remove rule 1' }));
    expect(s.getByText(/No review rules/)).toBeInTheDocument();
  });

  it('stops at 30 rules', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: `r${i}x`,
      label: `Rule ${i}`,
      function: 'IT' as const,
      keywords: ['x1'],
    }));
    show({ ...DATA, intake: { ...DATA.intake, engagementRules: many } });
    expect(within(section('intake')).getByRole('button', { name: 'Add a review rule' })).toBeDisabled();
    expect(screen.getByTestId('intake-count')).toHaveTextContent('Limit reached: 30');
  });
});

describe('Add a routing rule', () => {
  it('keeps commas while typing and saves the rule with the chosen workflow', async () => {
    const u = userEvent.setup();
    show();
    const s = within(section('workflowRouting'));
    await u.click(s.getByRole('button', { name: 'Add a routing rule' }));
    await u.click(s.getByRole('button', { name: 'Save workflow routing' }));
    expect(s.getByRole('alert')).toHaveTextContent('Routing rule 1 needs a name.');
    expect(s.getByRole('alert')).toHaveTextContent('needs at least one word to look for');
    await u.type(s.getByLabelText('Routing rule 1'), 'Drones are complex');
    await u.type(s.getByLabelText(/Words in the title or category 1/), 'drone, uav, ');
    await u.selectOptions(s.getByLabelText('Follows 1'), 'wf-board');
    await u.click(s.getByRole('button', { name: 'Save workflow routing' }));
    await waitFor(() => expect(lastPut()).not.toBeNull());
    expect(lastPut()!.workflowRouting.rules).toEqual([
      { id: 'route1', label: 'Drones are complex', words: ['drone', 'uav'], workflow: 'wf-board' },
    ]);
    expect(lastPut()!.workflowRouting.simpleBelow).toBe(50_000);
  });
});

describe('Add a recipient', () => {
  it('saves the chosen event and role, and refuses the same pair twice', async () => {
    const u = userEvent.setup();
    show();
    const s = within(section('notifications'));
    await u.click(s.getByRole('button', { name: 'Add a recipient' }));
    await u.selectOptions(s.getByLabelText('Also tell 1'), 'PROBITY');
    await u.click(s.getByRole('button', { name: 'Add a recipient' }));
    await u.selectOptions(s.getByLabelText('Also tell 2'), 'PROBITY');
    await u.click(s.getByRole('button', { name: 'Save notifications' }));
    expect(s.getByRole('alert')).toHaveTextContent('Each role can be added once for an event.');
    await u.selectOptions(s.getByLabelText('When 2'), 'APPROVAL_TIMEOUT');
    await u.click(s.getByRole('button', { name: 'Save notifications' }));
    await waitFor(() => expect(lastPut()).not.toBeNull());
    expect(lastPut()!.notifications.extraRecipients).toEqual([
      { event: 'BUDGET_BREACH', role: 'PROBITY' },
      { event: 'APPROVAL_TIMEOUT', role: 'PROBITY' },
    ]);
  });
});

describe('Add a register', () => {
  it('shows the built-in names as fixed, makes an added one editable, and rejects a repeat', async () => {
    const u = userEvent.setup();
    show();
    const s = within(section('publicRegisters'));
    expect(s.queryByLabelText('Register name 1')).toBeNull();
    await u.click(s.getByRole('button', { name: 'Add a register' }));
    await u.type(s.getByLabelText('Register name 3'), 'ted');
    await u.type(s.getByLabelText('Jurisdiction 3'), 'Europe again');
    await u.click(s.getByRole('button', { name: 'Save public registers' }));
    expect(s.getByRole('alert')).toHaveTextContent('Each register can appear once.');
    await u.clear(s.getByLabelText('Register name 3'));
    await u.type(s.getByLabelText('Register name 3'), 'Buy NZ');
    await u.click(s.getByRole('button', { name: 'Save public registers' }));
    await waitFor(() => expect(lastPut()).not.toBeNull());
    expect(lastPut()!.publicRegisters[2]).toEqual({
      register: 'Buy NZ',
      jurisdiction: 'Europe again',
      minValueAud: 0,
      enabled: true,
    });
    // a built-in can be removed too
    await u.click(s.getByRole('button', { name: 'Remove register TED' }));
    expect(s.queryByText('TED')).toBeNull();
  });
});

describe('Add a spend alert', () => {
  it('refuses the fixed points, accepts another, and shows no count above five', async () => {
    const u = userEvent.setup();
    show();
    const s = within(section('contractManagement'));
    await u.click(s.getByRole('button', { name: 'Add a spend alert' }));
    const input = s.getByLabelText(/Extra alert point 1/);
    await u.clear(input);
    await u.type(input, '90');
    await u.click(s.getByRole('button', { name: 'Save contract management' }));
    expect(s.getByRole('alert')).toHaveTextContent('fixed notices at 80, 90 and 100');
    await u.clear(input);
    await u.type(input, '70');
    await u.click(s.getByRole('button', { name: 'Save contract management' }));
    expect(s.getByRole('alert')).toHaveTextContent('same as the main spend alert');
    await u.clear(input);
    await u.type(input, '40');
    await u.click(s.getByRole('button', { name: 'Save contract management' }));
    await waitFor(() => expect(lastPut()).not.toBeNull());
    expect(lastPut()!.contractManagement.extraSpendAlertPcts).toEqual([40]);
  });
});

describe('Add a capacity override', () => {
  it('chooses a manager from the procurement team and saves their capacity', async () => {
    const u = userEvent.setup();
    show();
    const s = within(section('dashboards'));
    await u.click(s.getByRole('button', { name: 'Add a capacity override' }));
    await u.click(s.getByRole('button', { name: 'Save dashboards and workload' }));
    expect(s.getByRole('alert')).toHaveTextContent('choose a manager');
    await u.selectOptions(s.getByLabelText('Manager 1'), MANAGER);
    const cap = s.getByLabelText('Capacity 1');
    expect(cap).toHaveValue(6);
    await u.clear(cap);
    await u.type(cap, '2');
    await u.click(s.getByRole('button', { name: 'Save dashboards and workload' }));
    await waitFor(() => expect(lastPut()).not.toBeNull());
    expect(lastPut()!.dashboards.capacityOverrides).toEqual([{ userId: MANAGER, capacity: 2 }]);
  });
});

describe('Add a protected clause', () => {
  it('upper-cases what is typed, refuses a repeat and saves the list', async () => {
    const u = userEvent.setup();
    show();
    const s = within(section('contractRules'));
    await u.click(s.getByRole('button', { name: 'Add a protected clause' }));
    await u.type(s.getByLabelText('Clause 1 id'), 'liability');
    expect(s.getByLabelText('Clause 1 id')).toHaveValue('LIABILITY');
    await u.click(s.getByRole('button', { name: 'Add a protected clause' }));
    await u.type(s.getByLabelText('Clause 2 id'), 'Liability');
    await u.click(s.getByRole('button', { name: 'Save contract rules' }));
    expect(s.getByRole('alert')).toHaveTextContent('Each clause can appear once.');
    await u.click(s.getByRole('button', { name: 'Remove clause 2' }));
    await u.click(s.getByRole('button', { name: 'Save contract rules' }));
    await waitFor(() => expect(lastPut()).not.toBeNull());
    expect(lastPut()!.contractRules.protectedClauses).toEqual(['LIABILITY']);
  });
});

describe('the existing lists still work from the shared button', () => {
  it('Add a field and Add a question and Add a mapping add a row each', async () => {
    const u = userEvent.setup();
    show();
    await u.click(within(section('customFields')).getByRole('button', { name: 'Add a field' }));
    expect(within(section('customFields')).getAllByTestId('custom-field-row')).toHaveLength(1);
    await u.click(within(section('onboardingQuestions')).getByRole('button', { name: 'Add a question' }));
    expect(within(section('onboardingQuestions')).getAllByTestId('onboarding-question')).toHaveLength(1);
    await u.click(within(section('erpFieldMap')).getByRole('button', { name: 'Add a mapping' }));
    expect(within(section('erpFieldMap')).getByLabelText('ERP name 1')).toBeInTheDocument();
  });
});

describe('what the server says is shown', () => {
  it('shows the API reason under the section that was saved', async () => {
    const u = userEvent.setup();
    show();
    apiMock.mockRejectedValueOnce(
      new ApiError({
        status: 422,
        code: 'VALIDATION_FAILED',
        title: 'Some settings are not valid',
        errors: [{ field: 'dashboards.capacityOverrides', message: 'Choose a procurement manager' }],
      }),
    );
    const s = within(section('dashboards'));
    await u.click(s.getByRole('button', { name: 'Save dashboards and workload' }));
    expect(await s.findByRole('alert')).toHaveTextContent(
      'Some settings are not valid Choose a procurement manager',
    );
  });
});

describe('plain-sentence checks', () => {
  it('nextKey gives a key the API accepts that no row uses', () => {
    expect(nextKey('rule', [])).toBe('rule1');
    expect(nextKey('rule', ['rule1', 'rule2'])).toBe('rule3');
    expect(nextKey('route', ['rule1'])).toMatch(/^[a-z][a-zA-Z0-9]{1,30}$/);
  });
  it('parseWords lower-cases, trims and drops empties', () => {
    expect(parseWords(' Drone, UAV ,, ')).toEqual(['drone', 'uav']);
  });
  it('each check names the row and the problem', () => {
    expect(checkReviewRules([{ id: 'a1', label: '', function: 'IT', keywords: [] }])).toHaveLength(2);
    expect(checkReviewRules([{ id: 'a1', label: 'x', function: 'IT', keywords: ['a'] }])).toEqual([
      'Review rule 1: each word needs at least two letters.',
    ]);
    expect(checkRoutingRules([{ id: 'a1', label: 'x', words: ['ok'], workflow: 'wf-simple' }])).toEqual([]);
    expect(checkRecipients([{ event: 'BUDGET_BREACH', role: 'EXEC' }])).toEqual([]);
    expect(
      checkRegisters([
        { register: 'A', jurisdiction: '', minValueAud: -1, enabled: true },
        { register: 'a', jurisdiction: 'x', minValueAud: 0, enabled: true },
      ]),
    ).toEqual(
      expect.arrayContaining([
        'Register 1 needs a name of at least two letters.',
        'Register 1 needs a jurisdiction.',
        'Register 1: the value cannot be negative.',
        'Each register can appear once.',
      ]),
    );
    expect(checkSpendAlerts([80, 100, 70, 12.5, 0], 70)).toHaveLength(5);
    expect(checkSpendAlerts([1, 2, 3, 4, 5, 6], 70)).toContain('At most 5 extra alert points.');
    expect(checkOverrides([{ userId: 'u', capacity: 201 }])).toHaveLength(1);
    expect(checkClauses(['A', ' ', 'a'])).toEqual([
      'Protected clause 2 is empty.',
      'Each clause can appear once.',
    ]);
    expect(checkClauses(Array.from({ length: 21 }, (_, i) => `C${i}`))).toEqual([
      'At most 20 protected clauses.',
    ]);
  });
});
