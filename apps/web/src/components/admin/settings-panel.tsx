'use client';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Badge, Button, Card, Field, Input, Select, Table, Td, Th } from '@if/ui';
import { ApiError, api } from '@/lib/api-client';

/** The colour palettes an organisation can choose (the same names the theme defines). */
const PALETTE_NAMES = ['INDIGO', 'TEAL', 'CRIMSON', 'FOREST', 'SLATE'] as const;

export interface SettingsData {
  numbering: { scheme: 'YEAR_SEQ' | 'FY_SEQ' | 'SEQ'; prefix: string; digits: number };
  numberingExample: string;
  fieldLabels: Record<string, string>;
  customFields: Array<{ key: string; label: string; type: 'TEXT' | 'FLAG' | 'NUMBER'; mandatory: boolean }>;
  checkpoints: {
    coiBeforeApproval: boolean;
    evaluationBeforeReport: boolean;
    reportSignoffBeforeContract: boolean;
  };
  intake: {
    selfServiceThresholdAud: number;
    budgetCap: 'HARD' | 'SOFT';
    taxonomy: 'UNSPSC' | 'CPV' | 'NAICS';
    layouts: Record<string, 'LIST' | 'KANBAN' | 'CALENDAR' | 'DENSE'>;
    engagementRules: Array<{
      id: string;
      label: string;
      function: 'IT' | 'LEGAL' | 'CYBER' | 'FINANCE' | 'RISK';
      keywords: string[];
      minValue?: number;
    }>;
  };
  notifications: {
    channels: Array<'IN_APP' | 'EMAIL' | 'SLACK' | 'TEAMS'>;
    escalationHours: number;
    rules: Array<{ event: 'BUDGET_BREACH' | 'DELEGATE_ACTION' | 'APPROVAL_TIMEOUT'; enabled: boolean }>;
  };
  security: { requireMfa: boolean; enforceSso: boolean; stepUpApprovals: boolean };
  onboardingQuestions: Array<{
    id: string;
    label: string;
    type: 'YESNO' | 'TEXT';
    mandatory: boolean;
    flagIf?: 'YES' | 'NO';
  }>;
  publicRegisters: Array<{
    register: 'AusTender' | 'SAM.gov' | 'TED';
    jurisdiction: string;
    minValueAud: number;
    enabled: boolean;
  }>;
  contractRules: {
    requireBankDetails: boolean;
    requireRiskSummaryReview: boolean;
    endorsements: Array<'LEGAL' | 'FINANCE'>;
    protectedClauses: string[];
    negotiationLockDays: number;
    signingReminderHours: number;
  };
  dashboards: { visibility: 'HIERARCHY' | 'BROAD'; capacityPerManager: number; referenceRefreshDays: number };
  tenderRules: { dualWitnessThresholdAud: number; witnessWindowMinutes: number };
  ratings: { supplierSeesRatings: boolean; staffSeeSupplierRatings: boolean };
  legalPlatform: { enabled: boolean; name: string; webhookSecret: string; simulateOutage: boolean };
  approvalLinks: { enabled: boolean; validHours: number; showCommercial: boolean };
  currency: { base: 'AUD'; rateMode: 'ANNUAL' | 'LIVE' };
  artefacts: { laterStage: 'REALTIME' | 'BATCHED' | 'MANUAL'; batchMinutes: number };
  buying: { enabled: boolean; autoSourceLimitAud: number };
  externalSearch: { enabled: boolean };
  branding: {
    productName: string;
    tagline: string;
    palette: (typeof PALETTE_NAMES)[number];
    supportEmail: string;
  };
  analytics: {
    refreshMinutes: number;
    consolidationPct: number;
    varianceThresholdPct: number;
    driftThresholdPct: number;
  };
  contractManagement: {
    erpIntegrated: boolean;
    variationModel: 'CUMULATIVE' | 'INCREMENTAL';
    variationNumbering: 'SUFFIX' | 'NEW_PROCUREMENT';
    publicSectorDisclosure: boolean;
    disclosureThresholdPct: number;
    disclosureDays: number;
    highValueAud: number;
    spendAlertPct: number;
    planTemplates: Array<{
      kind: 'CMP' | 'RMP';
      name: string;
      sections: Array<{ title: string; text: string }>;
    }>;
  };
  criteriaLibrary: Array<{
    name: string;
    stream: 'TECHNICAL' | 'COMMERCIAL' | 'OTHER';
    weight: number;
    passFail: boolean;
  }>;
  evaluationRules: {
    requireInsurance: boolean;
    rankingMaxValueAud: number;
    redeclarationReminderHours: number;
    clarificationDays: number;
  };
  erpFieldMap: Array<{ erpName: string; platformKey: string }>;
  workflowRouting: { simpleBelow: number; intermediateBelow: number };
}
export interface EmailEntry {
  id: string;
  to: string;
  subject: string;
  kind: string;
  status: string;
  createdAt: string;
}
export interface LogEntry {
  id: string;
  channel: string;
  status: string;
  detail?: string;
  title: string;
  recipient: string;
  createdAt: string;
}

const BUILT_IN_FIELDS: Array<[string, string]> = [
  ['title', 'Title'],
  ['category', 'Category'],
  ['estimatedValue', 'Estimated value (AUD)'],
  ['termMonths', 'Term (months)'],
  ['businessUnit', 'Business unit'],
  ['contractOwner', 'Contract owner'],
  ['background', 'Background'],
  ['deliverables', 'Deliverables'],
  ['risk', 'Key risks'],
  ['dataSensitivity', 'Data sensitivity'],
  ['supplyLocation', 'Supply location'],
];
const STAFF_ROLES: Array<[string, string]> = [
  ['REQUESTER', 'Requester'],
  ['PROCUREMENT', 'Procurement'],
  ['DELEGATE', 'Delegate'],
  ['EVALUATOR', 'Evaluator'],
  ['CHAIR', 'Chair'],
  ['LEGAL', 'Legal'],
  ['CONTRACT_MGR', 'Contract manager'],
  ['PROBITY', 'Probity'],
  ['FINANCE', 'Finance'],
  ['EXEC', 'Executive'],
  ['ADMIN', 'Administrator'],
];
const CHANNEL_LABEL = {
  IN_APP: 'In the app',
  EMAIL: 'Email',
  SLACK: 'Slack',
  TEAMS: 'Microsoft Teams',
} as const;
const EVENT_LABEL = {
  BUDGET_BREACH: 'A request breaks the budget',
  DELEGATE_ACTION: 'An approver is asked to act',
  APPROVAL_TIMEOUT: 'An approval waits too long',
} as const;
const message = (e: unknown) =>
  e instanceof ApiError
    ? [e.message, ...(e.problem.errors ?? []).map((x) => x.message)]
        .filter((x, i, a) => a.indexOf(x) === i)
        .join(' ')
    : 'Something went wrong. Please try again.';

function Section({
  id,
  title,
  blurb,
  children,
  onSave,
  busy,
  saved,
  error,
}: {
  id: string;
  title: string;
  blurb: string;
  children: ReactNode;
  onSave: () => void;
  busy: boolean;
  saved: boolean;
  error: string | null;
}) {
  return (
    <Card role="region" aria-labelledby={`${id}-h`} data-testid={`settings-${id}`}>
      <h2 id={`${id}-h`} className="font-heading text-xl font-bold">
        {title}
      </h2>
      <p className="mt-1 max-w-prose text-sm text-text-muted">{blurb}</p>
      <div className="mt-4 flex flex-col gap-3">{children}</div>
      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-error">
          {error}
        </p>
      )}
      <div className="mt-4 flex items-center gap-3">
        <Button loading={busy} onClick={onSave} aria-label={`Save ${title.toLowerCase()}`}>
          Save
        </Button>
        {saved && (
          <span role="status" className="text-sm font-medium text-success">
            Saved and recorded in the audit trail
          </span>
        )}
      </div>
    </Card>
  );
}

/** Tenant settings: every rule an administrator can change without a release. Each section saves on its own. */
export function SettingsPanel({
  initial,
  log,
  emails = [],
  csrf,
}: {
  initial: SettingsData;
  log: LogEntry[];
  emails?: EmailEntry[];
  csrf: string;
}) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [entries, setEntries] = useState(log);
  const [escalated, setEscalated] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ direction: 'INBOUND' | 'OUTBOUND'; text: string; out: string }>({
    direction: 'INBOUND',
    text: '{"cost": 1200}',
    out: '',
  });

  async function save(name: string, value: unknown) {
    setBusy(name);
    setSaved(null);
    setErrors((e) => ({ ...e, [name]: null }));
    try {
      const next = await api<SettingsData>('/admin/settings', {
        method: 'PUT',
        csrf,
        body: { [name]: value },
      });
      setS(next);
      setSaved(name);
      router.refresh();
    } catch (e) {
      setErrors((x) => ({ ...x, [name]: message(e) }));
    } finally {
      setBusy(null);
    }
  }
  const sec = (id: string) => ({
    id,
    busy: busy === id,
    saved: saved === id,
    error: errors[id] ?? null,
  });

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Section
        {...sec('numbering')}
        title="Procurement numbers"
        blurb="The format of the number every new request receives. The sequence continues within the year or financial year."
        onSave={() => void save('numbering', s.numbering)}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Scheme">
            <Select
              value={s.numbering.scheme}
              onChange={(e) =>
                setS({
                  ...s,
                  numbering: {
                    ...s.numbering,
                    scheme: e.target.value as SettingsData['numbering']['scheme'],
                  },
                })
              }
            >
              <option value="YEAR_SEQ">Calendar year (PR-2026-0001)</option>
              <option value="FY_SEQ">Financial year, 1 July (PR-FY27-0001)</option>
              <option value="SEQ">Plain sequence (PR-0001)</option>
            </Select>
          </Field>
          <Field label="Prefix" hint="Capitals and digits, up to 8">
            <Input
              value={s.numbering.prefix}
              onChange={(e) =>
                setS({ ...s, numbering: { ...s.numbering, prefix: e.target.value.toUpperCase() } })
              }
            />
          </Field>
          <Field label="Digits in the sequence">
            <Input
              type="number"
              min={3}
              max={8}
              value={s.numbering.digits}
              onChange={(e) => setS({ ...s, numbering: { ...s.numbering, digits: Number(e.target.value) } })}
            />
          </Field>
        </div>
        <p className="text-sm text-text-muted">
          Variations of a contract carry the parent number with a version, for example{' '}
          <span className="font-mono">{s.numbering.prefix}-0001.v1</span>. Last saved format looks like{' '}
          <span className="font-mono" data-testid="numbering-example">
            {s.numberingExample}
          </span>
          .
        </p>
      </Section>

      <Section
        {...sec('fieldLabels')}
        title="Field labels"
        blurb="Use your own wording for the built-in request fields. Leave a box empty to keep the standard label."
        onSave={() =>
          void save(
            'fieldLabels',
            Object.fromEntries(Object.entries(s.fieldLabels).filter(([, v]) => v.trim())),
          )
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {BUILT_IN_FIELDS.map(([key, std]) => (
            <Field key={key} label={std}>
              <Input
                placeholder={std}
                value={s.fieldLabels[key] ?? ''}
                onChange={(e) => setS({ ...s, fieldLabels: { ...s.fieldLabels, [key]: e.target.value } })}
              />
            </Field>
          ))}
        </div>
      </Section>

      <Section
        {...sec('customFields')}
        title="Custom fields"
        blurb="Add your own fields to every request, for example an Indigenous procurement flag. A mandatory field blocks submission until it is filled."
        onSave={() => void save('customFields', s.customFields)}
      >
        {s.customFields.map((f, i) => (
          <div
            key={i}
            className="grid items-end gap-3 sm:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]"
            data-testid="custom-field-row"
          >
            <Field label={`Key ${i + 1} (letters and digits)`}>
              <Input
                value={f.key}
                onChange={(e) =>
                  setS({
                    ...s,
                    customFields: s.customFields.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)),
                  })
                }
              />
            </Field>
            <Field label={`Label ${i + 1}`}>
              <Input
                value={f.label}
                onChange={(e) =>
                  setS({
                    ...s,
                    customFields: s.customFields.map((x, j) =>
                      j === i ? { ...x, label: e.target.value } : x,
                    ),
                  })
                }
              />
            </Field>
            <Field label={`Type ${i + 1}`}>
              <Select
                value={f.type}
                onChange={(e) =>
                  setS({
                    ...s,
                    customFields: s.customFields.map((x, j) =>
                      j === i ? { ...x, type: e.target.value as 'TEXT' | 'FLAG' | 'NUMBER' } : x,
                    ),
                  })
                }
              >
                <option value="TEXT">Text</option>
                <option value="FLAG">Yes or no</option>
                <option value="NUMBER">Number</option>
              </Select>
            </Field>
            <label className="flex min-h-[44px] items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-5 accent-[var(--if-color-accent)]"
                checked={f.mandatory}
                onChange={(e) =>
                  setS({
                    ...s,
                    customFields: s.customFields.map((x, j) =>
                      j === i ? { ...x, mandatory: e.target.checked } : x,
                    ),
                  })
                }
                aria-label={`Field ${i + 1} is mandatory`}
              />
              Mandatory
            </label>
            <Button
              variant="ghost"
              aria-label={`Remove field ${i + 1}`}
              onClick={() => setS({ ...s, customFields: s.customFields.filter((_, j) => j !== i) })}
            >
              Remove
            </Button>
          </div>
        ))}
        <div>
          <Button
            variant="secondary"
            disabled={s.customFields.length >= 20}
            onClick={() =>
              setS({
                ...s,
                customFields: [...s.customFields, { key: '', label: '', type: 'TEXT', mandatory: false }],
              })
            }
          >
            Add a field
          </Button>
        </div>
      </Section>

      <Section
        {...sec('checkpoints')}
        title="Mandatory checkpoints"
        blurb="Steps the platform enforces by default. An enterprise may relax one; every time a relaxed checkpoint is used it is recorded in the audit trail."
        onSave={() => void save('checkpoints', s.checkpoints)}
      >
        {(
          [
            [
              'coiBeforeApproval',
              'Conflict-of-interest declarations signed before a delegate approves a plan',
            ],
            ['evaluationBeforeReport', 'Consensus locked before the evaluation report is generated'],
            ['reportSignoffBeforeContract', 'Evaluation report approved before a contract is drafted'],
          ] as const
        ).map(([key, text]) => (
          <label key={key} className="flex min-h-[44px] items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="size-5 accent-[var(--if-color-accent)]"
              checked={s.checkpoints[key]}
              onChange={(e) => setS({ ...s, checkpoints: { ...s.checkpoints, [key]: e.target.checked } })}
            />
            <span>{text}</span>
            {!s.checkpoints[key] && <Badge tone="warning">Relaxed</Badge>}
          </label>
        ))}
      </Section>

      <Section
        {...sec('intake')}
        title="Intake rules"
        blurb="Who may self-serve, what happens when the budget is exceeded, which classification scheme is used, which layout each role starts with, and which reviews a request triggers."
        onSave={() => void save('intake', s.intake)}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Self-service below (AUD)" hint="Larger requests are team-led">
            <Input
              type="number"
              min={0}
              value={s.intake.selfServiceThresholdAud}
              onChange={(e) =>
                setS({ ...s, intake: { ...s.intake, selfServiceThresholdAud: Number(e.target.value) } })
              }
            />
          </Field>
          <Field label="When the budget is exceeded">
            <Select
              value={s.intake.budgetCap}
              onChange={(e) =>
                setS({ ...s, intake: { ...s.intake, budgetCap: e.target.value as 'HARD' | 'SOFT' } })
              }
            >
              <option value="HARD">Block, and raise a budget amendment task</option>
              <option value="SOFT">Allow, flag, and escalate to the executive</option>
            </Select>
          </Field>
          <Field label="Classification scheme">
            <Select
              value={s.intake.taxonomy}
              onChange={(e) =>
                setS({
                  ...s,
                  intake: { ...s.intake, taxonomy: e.target.value as 'UNSPSC' | 'CPV' | 'NAICS' },
                })
              }
            >
              <option value="UNSPSC">UNSPSC</option>
              <option value="CPV">CPV</option>
              <option value="NAICS">NAICS</option>
            </Select>
          </Field>
        </div>
        <fieldset className="rounded-md border border-border p-3">
          <legend className="px-1 text-sm font-semibold">Starting layout for requests, by role</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {STAFF_ROLES.map(([role, name]) => (
              <Field key={role} label={name}>
                <Select
                  value={s.intake.layouts[role] ?? 'LIST'}
                  onChange={(e) =>
                    setS({
                      ...s,
                      intake: {
                        ...s.intake,
                        layouts: { ...s.intake.layouts, [role]: e.target.value as 'LIST' },
                      },
                    })
                  }
                >
                  <option value="LIST">List</option>
                  <option value="DENSE">Dense table</option>
                  <option value="KANBAN">Board by phase</option>
                  <option value="CALENDAR">Calendar</option>
                </Select>
              </Field>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-col gap-2" aria-label="Review rules">
          <h3 className="text-sm font-semibold">Reviews a request triggers</h3>
          {s.intake.engagementRules.map((r, i) => (
            <div
              key={r.id}
              className="grid items-end gap-3 sm:grid-cols-[2fr_1fr_2fr_auto]"
              data-testid="engagement-rule"
            >
              <Field label={`Rule ${i + 1}`}>
                <Input
                  value={r.label}
                  onChange={(e) =>
                    setS({
                      ...s,
                      intake: {
                        ...s.intake,
                        engagementRules: s.intake.engagementRules.map((x, j) =>
                          j === i ? { ...x, label: e.target.value } : x,
                        ),
                      },
                    })
                  }
                />
              </Field>
              <Field label={`Function ${i + 1}`}>
                <Select
                  value={r.function}
                  onChange={(e) =>
                    setS({
                      ...s,
                      intake: {
                        ...s.intake,
                        engagementRules: s.intake.engagementRules.map((x, j) =>
                          j === i ? { ...x, function: e.target.value as 'IT' } : x,
                        ),
                      },
                    })
                  }
                >
                  {['IT', 'LEGAL', 'CYBER', 'FINANCE', 'RISK'].map((f) => (
                    <option key={f} value={f}>
                      {f.charAt(0) + f.slice(1).toLowerCase()}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={`Words ${i + 1} (comma separated)`}>
                <Input
                  value={r.keywords.join(', ')}
                  onChange={(e) =>
                    setS({
                      ...s,
                      intake: {
                        ...s.intake,
                        engagementRules: s.intake.engagementRules.map((x, j) =>
                          j === i
                            ? {
                                ...x,
                                keywords: e.target.value
                                  .split(',')
                                  .map((k) => k.trim().toLowerCase())
                                  .filter(Boolean),
                              }
                            : x,
                        ),
                      },
                    })
                  }
                />
              </Field>
              <Button
                variant="ghost"
                aria-label={`Remove rule ${i + 1}`}
                onClick={() =>
                  setS({
                    ...s,
                    intake: {
                      ...s.intake,
                      engagementRules: s.intake.engagementRules.filter((_, j) => j !== i),
                    },
                  })
                }
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      </Section>

      <Section
        {...sec('notifications')}
        title="Notifications"
        blurb="Which channels notifications go to, which events notify, and how long an approval may wait before it is escalated to the approver's manager."
        onSave={() => void save('notifications', s.notifications)}
      >
        <fieldset className="flex flex-wrap gap-4">
          <legend className="sr-only">Channels</legend>
          {(Object.keys(CHANNEL_LABEL) as Array<keyof typeof CHANNEL_LABEL>).map((c) => (
            <label key={c} className="flex min-h-[44px] items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-5 accent-[var(--if-color-accent)]"
                checked={s.notifications.channels.includes(c)}
                disabled={c === 'IN_APP'}
                onChange={(e) =>
                  setS({
                    ...s,
                    notifications: {
                      ...s.notifications,
                      channels: e.target.checked
                        ? [...s.notifications.channels, c]
                        : s.notifications.channels.filter((x) => x !== c),
                    },
                  })
                }
              />
              {CHANNEL_LABEL[c]}
            </label>
          ))}
        </fieldset>
        <Field label="Escalate an approval after (hours)">
          <Input
            type="number"
            min={1}
            max={720}
            value={s.notifications.escalationHours}
            onChange={(e) =>
              setS({ ...s, notifications: { ...s.notifications, escalationHours: Number(e.target.value) } })
            }
          />
        </Field>
        {s.notifications.rules.map((r, i) => (
          <label key={r.event} className="flex min-h-[44px] items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="size-5 accent-[var(--if-color-accent)]"
              checked={r.enabled}
              onChange={(e) =>
                setS({
                  ...s,
                  notifications: {
                    ...s.notifications,
                    rules: s.notifications.rules.map((x, j) =>
                      j === i ? { ...x, enabled: e.target.checked } : x,
                    ),
                  },
                })
              }
            />
            Notify when: {EVENT_LABEL[r.event]}
          </label>
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            onClick={async () => {
              const r = await api<{ escalated: number }>('/admin/notifications/run-escalations', {
                method: 'POST',
                csrf,
              });
              setEscalated(r.escalated);
              setEntries(await api<LogEntry[]>('/admin/notification-log'));
            }}
          >
            Check for waiting approvals now
          </Button>
          {escalated !== null && (
            <span role="status" className="text-sm" data-testid="escalated">
              {escalated === 0 ? 'Nothing is waiting too long.' : `${escalated} approval(s) escalated.`}
            </span>
          )}
        </div>
        <p className="text-xs text-text-muted">
          Email, Slack and Teams are simulated in the proof of concept: the log below shows what would have
          been sent.
        </p>
        {emails.length > 0 && (
          <Table caption="Recent emails to suppliers (simulated)">
            <thead>
              <tr>
                <Th>When</Th>
                <Th>To</Th>
                <Th>Subject</Th>
                <Th>Kind</Th>
              </tr>
            </thead>
            <tbody>
              {emails.slice(0, 10).map((m) => (
                <tr key={m.id} data-testid="email-row">
                  <Td label="When" className="whitespace-nowrap text-xs">
                    {new Date(m.createdAt).toLocaleString('en-AU')}
                  </Td>
                  <Td label="To" className="break-all text-xs">
                    {m.to}
                  </Td>
                  <Td label="Subject">{m.subject}</Td>
                  <Td label="Kind">
                    <Badge tone="info">{m.kind.replace(/_/g, ' ').toLowerCase()}</Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {entries.length > 0 && (
          <Table caption="Recent deliveries">
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Channel</Th>
                <Th>To</Th>
                <Th>Message</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {entries.slice(0, 10).map((l) => (
                <tr key={l.id}>
                  <Td label="When" className="whitespace-nowrap text-xs">
                    {new Date(l.createdAt).toLocaleString('en-AU')}
                  </Td>
                  <Td label="Channel">{l.channel}</Td>
                  <Td label="To">{l.recipient}</Td>
                  <Td label="Message">{l.title}</Td>
                  <Td label="Status">
                    <Badge tone="info">{l.status === 'SENT' ? 'Simulated' : l.status}</Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>

      <Section
        {...sec('onboardingQuestions')}
        title="Supplier onboarding questions"
        blurb="Questions every new supplier answers when they register, for example about modern slavery or sustainability. A yes or no answer can be flagged so procurement looks at it before the supplier bids."
        onSave={() => void save('onboardingQuestions', s.onboardingQuestions)}
      >
        {s.onboardingQuestions.map((q, i) => (
          <div
            key={i}
            className="grid items-end gap-3 sm:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]"
            data-testid="onboarding-question"
          >
            <Field label={`Key ${i + 1} (letters and digits)`}>
              <Input
                value={q.id}
                onChange={(e) =>
                  setS({
                    ...s,
                    onboardingQuestions: s.onboardingQuestions.map((x, j) =>
                      j === i ? { ...x, id: e.target.value } : x,
                    ),
                  })
                }
              />
            </Field>
            <Field label={`Question ${i + 1}`}>
              <Input
                value={q.label}
                onChange={(e) =>
                  setS({
                    ...s,
                    onboardingQuestions: s.onboardingQuestions.map((x, j) =>
                      j === i ? { ...x, label: e.target.value } : x,
                    ),
                  })
                }
              />
            </Field>
            <Field label={`Answer type ${i + 1}`}>
              <Select
                value={q.type}
                onChange={(e) =>
                  setS({
                    ...s,
                    onboardingQuestions: s.onboardingQuestions.map((x, j) =>
                      j === i ? { ...x, type: e.target.value as 'YESNO' | 'TEXT' } : x,
                    ),
                  })
                }
              >
                <option value="YESNO">Yes or no</option>
                <option value="TEXT">Text</option>
              </Select>
            </Field>
            {q.type === 'YESNO' && (
              <Field label={`Flag when ${i + 1}`}>
                <Select
                  value={q.flagIf ?? ''}
                  onChange={(e) =>
                    setS({
                      ...s,
                      onboardingQuestions: s.onboardingQuestions.map((x, j) => {
                        if (j !== i) return x;
                        const { flagIf: _drop, ...rest } = x;
                        void _drop;
                        return e.target.value ? { ...rest, flagIf: e.target.value as 'YES' | 'NO' } : rest;
                      }),
                    })
                  }
                >
                  <option value="">Never</option>
                  <option value="NO">The answer is no</option>
                  <option value="YES">The answer is yes</option>
                </Select>
              </Field>
            )}
            <label className="flex min-h-[44px] items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-5 accent-[var(--if-color-accent)]"
                checked={q.mandatory}
                onChange={(e) =>
                  setS({
                    ...s,
                    onboardingQuestions: s.onboardingQuestions.map((x, j) =>
                      j === i ? { ...x, mandatory: e.target.checked } : x,
                    ),
                  })
                }
                aria-label={`Question ${i + 1} is required`}
              />
              Required
            </label>
            <Button
              variant="ghost"
              aria-label={`Remove question ${i + 1}`}
              onClick={() =>
                setS({ ...s, onboardingQuestions: s.onboardingQuestions.filter((_, j) => j !== i) })
              }
            >
              Remove
            </Button>
          </div>
        ))}
        <div>
          <Button
            variant="secondary"
            disabled={s.onboardingQuestions.length >= 15}
            onClick={() =>
              setS({
                ...s,
                onboardingQuestions: [
                  ...s.onboardingQuestions,
                  { id: '', label: '', type: 'YESNO', mandatory: true },
                ],
              })
            }
          >
            Add a question
          </Button>
        </div>
      </Section>

      <Section
        {...sec('publicRegisters')}
        title="Public registers"
        blurb="A public-sector tender at or above a register's value is sent to that register when it is published. Registers are simulated in the proof of concept."
        onSave={() => void save('publicRegisters', s.publicRegisters)}
      >
        {s.publicRegisters.map((r, i) => (
          <div
            key={r.register}
            className="grid items-end gap-3 sm:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]"
          >
            <label className="flex min-h-[44px] items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                className="size-5 accent-[var(--if-color-accent)]"
                checked={r.enabled}
                onChange={(e) =>
                  setS({
                    ...s,
                    publicRegisters: s.publicRegisters.map((x, j) =>
                      j === i ? { ...x, enabled: e.target.checked } : x,
                    ),
                  })
                }
                aria-label={`Send to ${r.register}`}
              />
              {r.register}
            </label>
            <span className="text-sm text-text-muted">{r.jurisdiction}</span>
            <Field label={`${r.register} from (AUD)`}>
              <Input
                type="number"
                min={0}
                value={r.minValueAud}
                onChange={(e) =>
                  setS({
                    ...s,
                    publicRegisters: s.publicRegisters.map((x, j) =>
                      j === i ? { ...x, minValueAud: Number(e.target.value) } : x,
                    ),
                  })
                }
              />
            </Field>
          </div>
        ))}
      </Section>

      <Section
        {...sec('evaluationRules')}
        title="Evaluation rules"
        blurb="How evaluations run: the compliance gate, when ranking may replace scoring, and how often reminders go out."
        onSave={() => void save('evaluationRules', s.evaluationRules)}
      >
        <label className="flex min-h-[44px] items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-5 accent-[var(--if-color-accent)]"
            checked={s.evaluationRules.requireInsurance}
            onChange={(e) =>
              setS({ ...s, evaluationRules: { ...s.evaluationRules, requireInsurance: e.target.checked } })
            }
          />
          <span>
            A supplier with no insurance certificate on record fails the compliance gate (an expired one
            always fails)
          </span>
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Ranking allowed up to (AUD)">
            <Input
              type="number"
              min={0}
              value={s.evaluationRules.rankingMaxValueAud}
              onChange={(e) =>
                setS({
                  ...s,
                  evaluationRules: { ...s.evaluationRules, rankingMaxValueAud: Number(e.target.value) },
                })
              }
            />
          </Field>
          <Field label="Reminder every (hours)">
            <Input
              type="number"
              min={1}
              max={720}
              value={s.evaluationRules.redeclarationReminderHours}
              onChange={(e) =>
                setS({
                  ...s,
                  evaluationRules: {
                    ...s.evaluationRules,
                    redeclarationReminderHours: Number(e.target.value),
                  },
                })
              }
            />
          </Field>
          <Field label="Days to answer a clarification">
            <Input
              type="number"
              min={1}
              max={60}
              value={s.evaluationRules.clarificationDays}
              onChange={(e) =>
                setS({
                  ...s,
                  evaluationRules: { ...s.evaluationRules, clarificationDays: Number(e.target.value) },
                })
              }
            />
          </Field>
        </div>
      </Section>

      <Section
        {...sec('contractRules')}
        title="Contract rules"
        blurb="What must happen before a contract is released for signing, which clauses are non-negotiable, and how long a negotiation may run."
        onSave={() => void save('contractRules', s.contractRules)}
      >
        {(
          [
            [
              'requireBankDetails',
              'The supplier must have banking details on record, matching its legal name',
            ],
            ['requireRiskSummaryReview', 'Legal must review the risk summary before a contract is released'],
          ] as const
        ).map(([key, text]) => (
          <label key={key} className="flex min-h-[44px] items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="size-5 accent-[var(--if-color-accent)]"
              checked={s.contractRules[key]}
              onChange={(e) => setS({ ...s, contractRules: { ...s.contractRules, [key]: e.target.checked } })}
            />
            <span>{text}</span>
          </label>
        ))}
        <fieldset className="flex flex-wrap gap-4">
          <legend className="text-sm font-semibold">Endorsements needed before release</legend>
          {(['LEGAL', 'FINANCE'] as const).map((r) => (
            <label key={r} className="flex min-h-[44px] items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-5 accent-[var(--if-color-accent)]"
                checked={s.contractRules.endorsements.includes(r)}
                onChange={(e) =>
                  setS({
                    ...s,
                    contractRules: {
                      ...s.contractRules,
                      endorsements: e.target.checked
                        ? [...s.contractRules.endorsements, r]
                        : s.contractRules.endorsements.filter((x) => x !== r),
                    },
                  })
                }
              />
              {r === 'LEGAL' ? 'Legal' : 'Finance'}
            </label>
          ))}
        </fieldset>
        <Field label="Non-negotiable clause ids (comma separated)">
          <Input
            value={s.contractRules.protectedClauses.join(', ')}
            onChange={(e) =>
              setS({
                ...s,
                contractRules: {
                  ...s.contractRules,
                  protectedClauses: e.target.value
                    .split(',')
                    .map((x) => x.trim().toUpperCase())
                    .filter(Boolean),
                },
              })
            }
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Lock signing after this many days of negotiation">
            <Input
              type="number"
              min={1}
              max={365}
              value={s.contractRules.negotiationLockDays}
              onChange={(e) =>
                setS({
                  ...s,
                  contractRules: { ...s.contractRules, negotiationLockDays: Number(e.target.value) },
                })
              }
            />
          </Field>
          <Field label="Remind unsigned signatories every (hours)">
            <Input
              type="number"
              min={1}
              max={720}
              value={s.contractRules.signingReminderHours}
              onChange={(e) =>
                setS({
                  ...s,
                  contractRules: { ...s.contractRules, signingReminderHours: Number(e.target.value) },
                })
              }
            />
          </Field>
        </div>
      </Section>

      <Section
        {...sec('dashboards')}
        title="Dashboards and workload"
        blurb="Who sees whose procurements on a dashboard, how many procurements one manager can carry, and how often the reference content is refreshed."
        onSave={() => void save('dashboards', s.dashboards)}
      >
        <Field
          label="Dashboard visibility"
          hint="By hierarchy, a person sees their own unit and those beneath it; broad shows the whole organisation. Procurement and the executive always see everything."
        >
          <Select
            value={s.dashboards.visibility}
            onChange={(e) =>
              setS({
                ...s,
                dashboards: { ...s.dashboards, visibility: e.target.value as 'HIERARCHY' | 'BROAD' },
              })
            }
          >
            <option value="BROAD">Broad: the whole organisation</option>
            <option value="HIERARCHY">By the organisation hierarchy</option>
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Procurements one manager can carry">
            <Input
              type="number"
              min={1}
              max={200}
              value={s.dashboards.capacityPerManager}
              onChange={(e) =>
                setS({ ...s, dashboards: { ...s.dashboards, capacityPerManager: Number(e.target.value) } })
              }
            />
          </Field>
          <Field label="Refresh the reference content every (days)">
            <Input
              type="number"
              min={1}
              max={365}
              value={s.dashboards.referenceRefreshDays}
              onChange={(e) =>
                setS({ ...s, dashboards: { ...s.dashboards, referenceRefreshDays: Number(e.target.value) } })
              }
            />
          </Field>
        </div>
      </Section>

      <Section
        {...sec('tenderRules')}
        title="Opening high-value bids"
        blurb="A tender at or above this value stays sealed after it closes until two independent witnesses confirm. A single tender can also be marked this way when its pack is prepared."
        onSave={() => void save('tenderRules', s.tenderRules)}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Needs two witnesses at or above (AUD)">
            <Input
              type="number"
              min={0}
              value={s.tenderRules.dualWitnessThresholdAud}
              onChange={(e) =>
                setS({
                  ...s,
                  tenderRules: { ...s.tenderRules, dualWitnessThresholdAud: Number(e.target.value) },
                })
              }
            />
          </Field>
          <Field label="Both witnesses within (minutes)">
            <Input
              type="number"
              min={1}
              max={240}
              value={s.tenderRules.witnessWindowMinutes}
              onChange={(e) =>
                setS({
                  ...s,
                  tenderRules: { ...s.tenderRules, witnessWindowMinutes: Number(e.target.value) },
                })
              }
            />
          </Field>
        </div>
      </Section>

      <Section
        {...sec('ratings')}
        title="Supplier ratings"
        blurb="Who can see the ratings the enterprise and its suppliers give each other."
        onSave={() => void save('ratings', s.ratings)}
      >
        <label className="flex min-h-[44px] items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-5 accent-[var(--if-color-accent)]"
            checked={s.ratings.supplierSeesRatings}
            onChange={(e) => setS({ ...s, ratings: { ...s.ratings, supplierSeesRatings: e.target.checked } })}
          />
          <span>A supplier can see how the enterprise rated them</span>
        </label>
        <label className="flex min-h-[44px] items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-5 accent-[var(--if-color-accent)]"
            checked={s.ratings.staffSeeSupplierRatings}
            onChange={(e) =>
              setS({ ...s, ratings: { ...s.ratings, staffSeeSupplierRatings: e.target.checked } })
            }
          />
          <span>The buying team can read what suppliers said about the enterprise</span>
        </label>
      </Section>

      <Section
        {...sec('approvalLinks')}
        title="Approve from a link"
        blurb="Approvers are sent a one-time link that lets them decide without signing in. The same limits and checks still apply."
        onSave={() => void save('approvalLinks', s.approvalLinks)}
      >
        <label className="flex min-h-[44px] items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-5 accent-[var(--if-color-accent)]"
            checked={s.approvalLinks.enabled}
            onChange={(e) => setS({ ...s, approvalLinks: { ...s.approvalLinks, enabled: e.target.checked } })}
          />
          <span>Send approvers a one-time link</span>
        </label>
        <label className="flex min-h-[44px] items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-5 accent-[var(--if-color-accent)]"
            checked={s.approvalLinks.showCommercial}
            onChange={(e) =>
              setS({ ...s, approvalLinks: { ...s.approvalLinks, showCommercial: e.target.checked } })
            }
          />
          <span>Show the dollar value on the link page (off keeps commercial information back)</span>
        </label>
        <Field label="A link works for (hours)">
          <Input
            type="number"
            min={1}
            max={336}
            value={s.approvalLinks.validHours}
            onChange={(e) =>
              setS({ ...s, approvalLinks: { ...s.approvalLinks, validHours: Number(e.target.value) } })
            }
            className="w-32"
          />
        </Field>
      </Section>

      <Section
        {...sec('currency')}
        title="Currency and exchange rates"
        blurb="Every total is kept in Australian dollars. Annual mode uses one rate per currency for each financial year (1 July to 30 June), set by finance. Live mode uses the latest rate from the rates feed."
        onSave={() => void save('currency', s.currency)}
      >
        <Field label="Rates in use">
          <Select
            value={s.currency.rateMode}
            onChange={(e) =>
              setS({
                ...s,
                currency: { ...s.currency, rateMode: e.target.value as SettingsData['currency']['rateMode'] },
              })
            }
          >
            <option value="ANNUAL">Annual rates, one per financial year</option>
            <option value="LIVE">Live rates from the feed</option>
          </Select>
        </Field>
        <p className="text-sm text-text-muted">Base currency: {s.currency.base} (fixed).</p>
      </Section>

      <Section
        {...sec('artefacts')}
        title="Reports and plans following changes"
        blurb="How fast the evaluation report and the contract management plans catch up when the records behind them change."
        onSave={() => void save('artefacts', s.artefacts)}
      >
        <Field label="Update">
          <Select
            value={s.artefacts.laterStage}
            onChange={(e) =>
              setS({
                ...s,
                artefacts: {
                  ...s.artefacts,
                  laterStage: e.target.value as SettingsData['artefacts']['laterStage'],
                },
              })
            }
          >
            <option value="REALTIME">Real-time, at once</option>
            <option value="BATCHED">Batched, after a delay</option>
            <option value="MANUAL">Manual, when someone refreshes</option>
          </Select>
        </Field>
        <Field label="Batch interval (minutes)" hint="Used in batched mode, 1 to 1440">
          <Input
            type="number"
            min={1}
            max={1440}
            value={s.artefacts.batchMinutes}
            onChange={(e) =>
              setS({ ...s, artefacts: { ...s.artefacts, batchMinutes: Number(e.target.value) } })
            }
            className="w-32"
          />
        </Field>
      </Section>

      <Section
        {...sec('buying')}
        title="Buying assistant"
        blurb="Recommended purchases can be drafted as requests for the buyer. Up to the limit the platform may draft without a procurement officer starting it."
        onSave={() => void save('buying', s.buying)}
      >
        <label className="flex min-h-[44px] items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-5 accent-[var(--if-color-accent)]"
            checked={s.buying.enabled}
            onChange={(e) => setS({ ...s, buying: { ...s.buying, enabled: e.target.checked } })}
          />
          <span>Buying recommendations are on</span>
        </label>
        <Field label="Draft without an officer up to (AUD)">
          <Input
            type="number"
            min={0}
            max={10000000}
            value={s.buying.autoSourceLimitAud}
            onChange={(e) =>
              setS({ ...s, buying: { ...s.buying, autoSourceLimitAud: Number(e.target.value) } })
            }
            className="w-40"
          />
        </Field>
      </Section>

      <Section
        {...sec('externalSearch')}
        title="Outside AI search"
        blurb="Allow a search to also ask an outside AI source. Only the words of the question go out; nothing from the organisation's records."
        onSave={() => void save('externalSearch', s.externalSearch)}
      >
        <label className="flex min-h-[44px] items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-5 accent-[var(--if-color-accent)]"
            checked={s.externalSearch.enabled}
            onChange={(e) => setS({ ...s, externalSearch: { enabled: e.target.checked } })}
          />
          <span>Allow searches to ask an outside AI source</span>
        </label>
      </Section>

      <Section
        {...sec('branding')}
        title="Branding"
        blurb="The name, tagline and colours people see. A change shows on the next page load."
        onSave={() => void save('branding', s.branding)}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Product name" hint="2 to 40 characters">
            <Input
              maxLength={40}
              value={s.branding.productName}
              onChange={(e) => setS({ ...s, branding: { ...s.branding, productName: e.target.value } })}
            />
          </Field>
          <Field label="Tagline" hint="Up to 80 characters">
            <Input
              maxLength={80}
              value={s.branding.tagline}
              onChange={(e) => setS({ ...s, branding: { ...s.branding, tagline: e.target.value } })}
            />
          </Field>
          <Field label="Colour palette">
            <Select
              value={s.branding.palette}
              onChange={(e) =>
                setS({
                  ...s,
                  branding: { ...s.branding, palette: e.target.value as SettingsData['branding']['palette'] },
                })
              }
            >
              {PALETTE_NAMES.map((n) => (
                <option key={n} value={n}>
                  {n.charAt(0) + n.slice(1).toLowerCase()}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Support email" hint="Leave empty for none">
            <Input
              type="email"
              maxLength={120}
              value={s.branding.supportEmail}
              onChange={(e) => setS({ ...s, branding: { ...s.branding, supportEmail: e.target.value } })}
            />
          </Field>
        </div>
      </Section>

      <Section
        {...sec('analytics')}
        title="Analytics"
        blurb="How often dashboards refresh and the thresholds that flag a saving, a variance or drift."
        onSave={() => void save('analytics', s.analytics)}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Refresh every (minutes)">
            <Input
              type="number"
              min={1}
              max={1440}
              value={s.analytics.refreshMinutes}
              onChange={(e) =>
                setS({ ...s, analytics: { ...s.analytics, refreshMinutes: Number(e.target.value) } })
              }
              className="w-32"
            />
          </Field>
          <Field label="Consolidation saving (%)" hint="0 to 50">
            <Input
              type="number"
              min={0}
              max={50}
              step="any"
              value={s.analytics.consolidationPct}
              onChange={(e) =>
                setS({ ...s, analytics: { ...s.analytics, consolidationPct: Number(e.target.value) } })
              }
              className="w-32"
            />
          </Field>
          <Field label="Variance threshold (%)" hint="0 to 100">
            <Input
              type="number"
              min={0}
              max={100}
              step="any"
              value={s.analytics.varianceThresholdPct}
              onChange={(e) =>
                setS({ ...s, analytics: { ...s.analytics, varianceThresholdPct: Number(e.target.value) } })
              }
              className="w-32"
            />
          </Field>
          <Field label="Drift threshold (%)" hint="0 to 100">
            <Input
              type="number"
              min={0}
              max={100}
              step="any"
              value={s.analytics.driftThresholdPct}
              onChange={(e) =>
                setS({ ...s, analytics: { ...s.analytics, driftThresholdPct: Number(e.target.value) } })
              }
              className="w-32"
            />
          </Field>
        </div>
      </Section>

      <Section
        {...sec('legalPlatform')}
        title="Legal platform"
        blurb="If the organisation runs an enterprise legal platform, each new legal matter is raised there, and its stage and redlines come back to the contract. Here the platform is simulated."
        onSave={() => void save('legalPlatform', s.legalPlatform)}
      >
        <label className="flex min-h-[44px] items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-5 accent-[var(--if-color-accent)]"
            checked={s.legalPlatform.enabled}
            onChange={(e) => setS({ ...s, legalPlatform: { ...s.legalPlatform, enabled: e.target.checked } })}
          />
          <span>We run a legal platform</span>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Its name">
            <Input
              value={s.legalPlatform.name}
              maxLength={60}
              onChange={(e) => setS({ ...s, legalPlatform: { ...s.legalPlatform, name: e.target.value } })}
            />
          </Field>
          <Field
            label="Shared secret that signs what it sends back"
            hint="Kept here for the demonstration; a production deployment holds it in a secret store."
          >
            <Input
              type="password"
              autoComplete="off"
              value={s.legalPlatform.webhookSecret}
              maxLength={200}
              onChange={(e) =>
                setS({ ...s, legalPlatform: { ...s.legalPlatform, webhookSecret: e.target.value } })
              }
            />
          </Field>
        </div>
        <label className="flex min-h-[44px] items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-5 accent-[var(--if-color-accent)]"
            checked={s.legalPlatform.simulateOutage}
            onChange={(e) =>
              setS({ ...s, legalPlatform: { ...s.legalPlatform, simulateOutage: e.target.checked } })
            }
          />
          <span>Pretend the platform is down (to show failed deliveries and the retry)</span>
        </label>
      </Section>

      <Section
        {...sec('contractManagement')}
        title="Contract management"
        blurb="How spend is guarded, how a variation is measured and disclosed, and when a contract gets management and risk plans."
        onSave={() => void save('contractManagement', s.contractManagement)}
      >
        <label className="flex min-h-[44px] items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-5 accent-[var(--if-color-accent)]"
            checked={s.contractManagement.erpIntegrated}
            onChange={(e) =>
              setS({ ...s, contractManagement: { ...s.contractManagement, erpIntegrated: e.target.checked } })
            }
          />
          <span>
            Our ERP is integrated: block a requisition above the contract limit, and require a purchase order
            on every invoice
          </span>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="How a variation is measured"
            hint="Cumulative judges the whole contract; incremental judges only the extra spend."
          >
            <Select
              value={s.contractManagement.variationModel}
              onChange={(e) =>
                setS({
                  ...s,
                  contractManagement: {
                    ...s.contractManagement,
                    variationModel: e.target.value as 'CUMULATIVE' | 'INCREMENTAL',
                  },
                })
              }
            >
              <option value="CUMULATIVE">Cumulative spend</option>
              <option value="INCREMENTAL">Incremental (additional spend only)</option>
            </Select>
          </Field>
          <Field
            label="Variation numbers"
            hint="A suffix keeps the contract number; a new procurement number also links a procurement."
          >
            <Select
              value={s.contractManagement.variationNumbering}
              onChange={(e) =>
                setS({
                  ...s,
                  contractManagement: {
                    ...s.contractManagement,
                    variationNumbering: e.target.value as 'SUFFIX' | 'NEW_PROCUREMENT',
                  },
                })
              }
            >
              <option value="SUFFIX">A suffix on the contract number (CT-2026-0001-V1)</option>
              <option value="NEW_PROCUREMENT">A new procurement number as well</option>
            </Select>
          </Field>
        </div>
        <label className="flex min-h-[44px] items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-5 accent-[var(--if-color-accent)]"
            checked={s.contractManagement.publicSectorDisclosure}
            onChange={(e) =>
              setS({
                ...s,
                contractManagement: { ...s.contractManagement, publicSectorDisclosure: e.target.checked },
              })
            }
          />
          <span>We are a public-sector customer: disclose large contract changes on the public register</span>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Disclose a change over (% of the contract)">
            <Input
              type="number"
              min={0}
              max={1000}
              value={s.contractManagement.disclosureThresholdPct}
              onChange={(e) =>
                setS({
                  ...s,
                  contractManagement: {
                    ...s.contractManagement,
                    disclosureThresholdPct: Number(e.target.value),
                  },
                })
              }
            />
          </Field>
          <Field label="Days allowed to disclose">
            <Input
              type="number"
              min={1}
              max={365}
              value={s.contractManagement.disclosureDays}
              onChange={(e) =>
                setS({
                  ...s,
                  contractManagement: { ...s.contractManagement, disclosureDays: Number(e.target.value) },
                })
              }
            />
          </Field>
          <Field
            label="High-value contract from (AUD)"
            hint="Contracts at or above this, or judged high risk, get management and risk plans."
          >
            <Input
              type="number"
              min={0}
              value={s.contractManagement.highValueAud}
              onChange={(e) =>
                setS({
                  ...s,
                  contractManagement: { ...s.contractManagement, highValueAud: Number(e.target.value) },
                })
              }
            />
          </Field>
          <Field
            label="Spend alert at (% of contract value)"
            hint="Besides the fixed notices at 80, 90 and 100 per cent, which cannot be changed."
          >
            <Input
              type="number"
              min={1}
              max={100}
              value={s.contractManagement.spendAlertPct}
              onChange={(e) =>
                setS({
                  ...s,
                  contractManagement: { ...s.contractManagement, spendAlertPct: Number(e.target.value) },
                })
              }
            />
          </Field>
        </div>
      </Section>

      <Section
        {...sec('criteriaLibrary')}
        title="Criteria library"
        blurb="The criteria procurement chooses from when setting up an evaluation. Each evaluation, and each stage of it, picks its own and sets the weights."
        onSave={() => void save('criteriaLibrary', s.criteriaLibrary)}
      >
        <ul className="flex flex-col gap-2" aria-label="Library criteria">
          {s.criteriaLibrary.map((c, i) => (
            <li
              key={`${c.name}-${i}`}
              className="grid items-end gap-3 sm:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] rounded-md border border-border p-2 text-sm"
            >
              <span className="min-w-0 flex-1">
                <span className="font-semibold">{c.name}</span>{' '}
                <span className="text-text-muted">
                  {{ TECHNICAL: 'Technical', COMMERCIAL: 'Commercial', OTHER: 'Shared' }[c.stream]}
                  {c.passFail ? ', pass or fail' : `, usual weight ${c.weight}`}
                </span>
              </span>
              <Button
                variant="secondary"
                aria-label={`Remove ${c.name} from the library`}
                onClick={() => setS({ ...s, criteriaLibrary: s.criteriaLibrary.filter((_, j) => j !== i) })}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
        <LibraryAdd onAdd={(c) => setS({ ...s, criteriaLibrary: [...s.criteriaLibrary, c] })} />
      </Section>

      <Section
        {...sec('security')}
        title="Sign-in security"
        blurb="How staff prove who they are. Suppliers sign in separately and are not affected."
        onSave={() => void save('security', s.security)}
      >
        {(
          [
            [
              'requireMfa',
              'Everyone must set up an authenticator app (they cannot use anything else until they have)',
            ],
            ['enforceSso', 'Staff must use single sign-on: passwords and activation links are refused'],
            ['stepUpApprovals', 'Every approval and signature needs a fresh code from the authenticator app'],
          ] as const
        ).map(([key, text]) => (
          <label key={key} className="flex min-h-[44px] items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="size-5 accent-[var(--if-color-accent)]"
              checked={s.security[key]}
              onChange={(e) => setS({ ...s, security: { ...s.security, [key]: e.target.checked } })}
            />
            <span>{text}</span>
          </label>
        ))}
        <p className="text-xs text-text-muted">
          Single sign-on uses a simulated identity provider in the proof of concept. Turning it on for staff
          means they sign in with the single sign-on button on the sign-in page.
        </p>
      </Section>

      <Section
        {...sec('workflowRouting')}
        title="Workflow routing"
        blurb="Which workflow a new request follows, by value. Critical-rated work always follows the governance workflow."
        onSave={() => void save('workflowRouting', s.workflowRouting)}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Simple workflow below (AUD)">
            <Input
              type="number"
              min={0}
              value={s.workflowRouting.simpleBelow}
              onChange={(e) =>
                setS({ ...s, workflowRouting: { ...s.workflowRouting, simpleBelow: Number(e.target.value) } })
              }
            />
          </Field>
          <Field label="Intermediate workflow below (AUD)">
            <Input
              type="number"
              min={0}
              value={s.workflowRouting.intermediateBelow}
              onChange={(e) =>
                setS({
                  ...s,
                  workflowRouting: { ...s.workflowRouting, intermediateBelow: Number(e.target.value) },
                })
              }
            />
          </Field>
        </div>
      </Section>

      <Section
        {...sec('erpFieldMap')}
        title="ERP field names"
        blurb="Map your ERP's field names to the platform's, in both directions, so reports show one consistent label."
        onSave={() => void save('erpFieldMap', s.erpFieldMap)}
      >
        {s.erpFieldMap.map((m, i) => (
          <div key={i} className="grid items-end gap-3 sm:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]">
            <Field label={`ERP name ${i + 1}`}>
              <Input
                value={m.erpName}
                onChange={(e) =>
                  setS({
                    ...s,
                    erpFieldMap: s.erpFieldMap.map((x, j) =>
                      j === i ? { ...x, erpName: e.target.value } : x,
                    ),
                  })
                }
              />
            </Field>
            <Field label={`Platform name ${i + 1}`}>
              <Input
                value={m.platformKey}
                onChange={(e) =>
                  setS({
                    ...s,
                    erpFieldMap: s.erpFieldMap.map((x, j) =>
                      j === i ? { ...x, platformKey: e.target.value } : x,
                    ),
                  })
                }
              />
            </Field>
            <Button
              variant="ghost"
              aria-label={`Remove mapping ${i + 1}`}
              onClick={() => setS({ ...s, erpFieldMap: s.erpFieldMap.filter((_, j) => j !== i) })}
            >
              Remove
            </Button>
          </div>
        ))}
        <div className="grid items-end gap-3 sm:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]">
          <Button
            variant="secondary"
            onClick={() => setS({ ...s, erpFieldMap: [...s.erpFieldMap, { erpName: '', platformKey: '' }] })}
          >
            Add a mapping
          </Button>
          <Field label="Try it on a record">
            <Input value={preview.text} onChange={(e) => setPreview({ ...preview, text: e.target.value })} />
          </Field>
          <Select
            aria-label="Direction"
            value={preview.direction}
            onChange={(e) => setPreview({ ...preview, direction: e.target.value as 'INBOUND' | 'OUTBOUND' })}
          >
            <option value="INBOUND">From the ERP</option>
            <option value="OUTBOUND">To the ERP</option>
          </Select>
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                const r = await api<{ record: unknown }>('/admin/erp-mapping/preview', {
                  method: 'POST',
                  csrf,
                  body: { direction: preview.direction, record: JSON.parse(preview.text) },
                });
                setPreview({ ...preview, out: JSON.stringify(r.record) });
              } catch (e) {
                setPreview({
                  ...preview,
                  out: e instanceof SyntaxError ? 'That is not a valid record.' : message(e),
                });
              }
            }}
          >
            Try mapping
          </Button>
        </div>
        {preview.out && (
          <p className="font-mono text-sm" data-testid="erp-preview" role="status">
            {preview.out}
          </p>
        )}
      </Section>
    </div>
  );
}

function LibraryAdd({ onAdd }: { onAdd: (c: SettingsData['criteriaLibrary'][number]) => void }) {
  const [name, setName] = useState('');
  const [stream, setStream] = useState<'TECHNICAL' | 'COMMERCIAL' | 'OTHER'>('TECHNICAL');
  const [weight, setWeight] = useState('10');
  const [passFail, setPassFail] = useState(false);
  return (
    <div className="grid items-end gap-3 sm:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] border-t border-border pt-3">
      <Field label="New criterion">
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Stream">
        <Select value={stream} onChange={(e) => setStream(e.target.value as typeof stream)}>
          <option value="TECHNICAL">Technical</option>
          <option value="COMMERCIAL">Commercial</option>
          <option value="OTHER">Shared</option>
        </Select>
      </Field>
      <Field label="Usual weight">
        <Input type="number" min={0} max={100} value={weight} onChange={(e) => setWeight(e.target.value)} />
      </Field>
      <label className="flex min-h-[44px] items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-5"
          checked={passFail}
          onChange={(e) => setPassFail(e.target.checked)}
        />
        Pass or fail
      </label>
      <Button
        variant="secondary"
        disabled={name.trim().length < 3}
        onClick={() => {
          onAdd({ name: name.trim(), stream, weight: passFail ? 0 : Number(weight) || 0, passFail });
          setName('');
        }}
      >
        Add to the library
      </Button>
    </div>
  );
}
