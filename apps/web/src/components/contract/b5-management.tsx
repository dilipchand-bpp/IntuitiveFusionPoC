'use client';
import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  Input,
  Select,
  Table,
  Tabs,
  Td,
  Textarea,
  Th,
} from '@if/ui';
import { ArtefactBadge } from '@/components/b9/artefact-badge';
import { aud, formatDateTime } from '@/lib/labels';
import { Bar, PRIORITY_TONE, has, send, useData, useRun } from './b5-shared';
import type { ContractView } from './types';

interface Line {
  item: string;
  qty: number;
  unitPrice: number;
}
interface Finding {
  code: string;
  severity: 'BLOCK' | 'FLAG';
  message: string;
}
interface Management {
  variationCount: number;
  variationsExecuted: number;
  variations: Array<{
    id: string;
    number: string;
    status: string;
    value: number;
    variancePct: number | null;
    model: string | null;
    businessCase: string | null;
    disclosure: string | null;
  }>;
  extensions: {
    total: number;
    exercised: number;
    remaining: number;
    list: Array<{
      position: number;
      months: number;
      startsOn: string;
      endsOn: string;
      exercised: boolean;
      requestNumber: string | null;
    }>;
  };
  cumulative: { original: number; value: number; endDate: string | null };
  versions: Array<{
    label: string;
    number: string;
    value: number;
    cumulativeValue: number;
    endDate: string | null;
    businessCase: string | null;
    variancePct: number;
  }>;
  procurements: Array<{ id: string; number: string; title: string; kind: string; status: string }>;
  hold: { reason: string; placedAt: string } | null;
  nextSteps: {
    model: string;
    steps: Array<{ priority: 'HIGH' | 'MEDIUM' | 'LOW'; action: string; text: string; why: string }>;
  };
  canLink: boolean;
}
interface Spend {
  value: number;
  invoiced: number;
  paid: number;
  committed: number;
  remaining: number;
  spentPct: number;
  paidPct: number;
  committedPct: number;
  blockedCount: number;
  blockedAmount: number;
  term: { pct: number; start: string; end: string; elapsedDays: number; totalDays: number };
  configuredPct: number;
  raised: Array<{ kind: string; threshold: number; raisedAt: string }>;
}
interface Commercial {
  rates: Array<{ item: string; unit: string; unitPrice: number }>;
  escalations: Array<{
    kind: 'CPI' | 'SCHEDULED';
    effectiveOn: string;
    pct: number;
    capPct: number | null;
    allowedPct: number;
    note: string | null;
  }>;
  factorToday: number;
  rebates: Array<{
    id: string;
    title: string;
    threshold: number;
    ratePct: number;
    periodStart: string;
    periodEnd: string;
    spend: number;
    earned: number;
    claimed: number;
    shortfall: number;
    status: string;
    flagged: boolean;
    message: string;
    followedUpAt: string | null;
  }>;
  hold: { reason: string; placedAt: string } | null;
  erpIntegrated: boolean;
  canEdit: boolean;
  canMoney: boolean;
}
interface PurchaseOrder {
  id: string;
  number: string;
  description: string;
  amount: number;
  status: 'APPROVED' | 'BLOCKED';
  blockedReason: string | null;
}
interface Invoice {
  id: string;
  number: string;
  invoiceDate: string;
  amount: number;
  status: 'MATCHED' | 'BLOCKED' | 'EXCEPTION' | 'PAID';
  findings: Finding[];
  poNumber: string | null;
  workOrderNumber: string | null;
}
interface Plans {
  tier: string | null;
  reasons: string[];
  plans: Array<{ kind: 'CMP' | 'RMP'; template: string; sections: Array<{ title: string; text: string }> }>;
  activities: Array<{
    id: string;
    plan: string;
    title: string;
    dueDate: string;
    status: string;
    overdue: boolean;
    owner: string | null;
    doneAt: string | null;
  }>;
  canGenerate: boolean;
  canComplete: boolean;
}
interface WorkOrders {
  master: { number: string; value: number };
  orders: Array<{
    id: string;
    number: string;
    title: string;
    value: number;
    startDate: string;
    endDate: string;
    status: string;
    committed: number;
    invoiced: number;
  }>;
  totals: { allocated: number; committed: number; invoiced: number; unallocated: number };
  canEdit: boolean;
}
interface Proposal {
  key: string;
  clauseTitle: string;
  quote: string;
  summary: string;
  triggerDate: string;
  applied: boolean;
}

const MATCH_TONE = { MATCHED: 'success', BLOCKED: 'error', EXCEPTION: 'warning', PAID: 'info' } as const;
const MATCH_LABEL = {
  MATCHED: 'Matched',
  BLOCKED: 'Blocked',
  EXCEPTION: 'Released as exception',
  PAID: 'Paid',
} as const;
const KIND_LABEL: Record<string, string> = { RENEW: 'Renewal', VARY: 'Variation', EXTEND: 'Extension' };
const REBATE_LABEL: Record<string, string> = {
  OPEN: 'In the period',
  EARNED_TO_CLAIM: 'Earned, to claim',
  NOT_EARNED: 'Not earned',
  CLAIMED: 'Claimed',
  MISSED: 'Missed',
  UNDER_CLAIMED: 'Under-claimed',
};
const REBATE_TONE: Record<string, 'neutral' | 'info' | 'success' | 'error' | 'warning'> = {
  OPEN: 'neutral',
  EARNED_TO_CLAIM: 'info',
  NOT_EARNED: 'neutral',
  CLAIMED: 'success',
  MISSED: 'error',
  UNDER_CLAIMED: 'warning',
};

interface Props {
  c: ContractView;
  csrf: string;
  roles: string[];
}

/** Everything about running an executed contract: its history, spend, commercial terms, plans and work orders. */
export function ContractManagementTabs({ c, csrf, roles }: Props) {
  const tabs = [
    { value: 'overview', label: 'Overview', content: <OverviewTab c={c} csrf={csrf} /> },
    { value: 'spend', label: 'Spend and invoices', content: <SpendTab c={c} csrf={csrf} roles={roles} /> },
    { value: 'terms', label: 'Rates, escalation and rebates', content: <TermsTab c={c} csrf={csrf} /> },
    { value: 'plans', label: 'Plans and activities', content: <PlansTab c={c} csrf={csrf} roles={roles} /> },
    ...(c.docType === 'MASTER'
      ? [{ value: 'orders', label: 'Work orders', content: <WorkOrdersTab c={c} csrf={csrf} /> }]
      : []),
    {
      value: 'triggers',
      label: 'Alerts from the wording',
      content: <TriggersTab c={c} csrf={csrf} roles={roles} />,
    },
  ];
  return (
    <Card aria-labelledby="b5-h" role="region" data-testid="contract-management">
      <h2 id="b5-h" className="font-heading text-xl font-bold">
        Managing this contract
      </h2>
      <p className="mt-1 max-w-prose text-sm text-text-muted">
        Spend against the contract, the prices it allows, the plans that keep it on track, and what to do
        next.
      </p>
      <div className="mt-3">
        <Tabs label="Contract management" items={tabs} />
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ overview (FR-0565, FR-0570, FR-0560)
function OverviewTab({ c, csrf }: { c: ContractView; csrf: string }) {
  const { data: m, error, reload } = useData<Management>(`/contracts/${c.id}/management`);
  const [kind, setKind] = useState<'RENEW' | 'VARY' | 'EXTEND'>('RENEW');
  const [note, setNote] = useState('');
  const [value, setValue] = useState('');
  const r = useRun();
  if (error)
    return (
      <p role="alert" className="text-sm text-error">
        {error}
      </p>
    );
  if (!m) return <p className="text-sm text-text-muted">Loading…</p>;
  return (
    <div className="flex flex-col gap-5" data-testid="mgmt-overview">
      {m.hold && (
        <p
          role="alert"
          className="rounded-md border-2 border-warning bg-warning-bg p-3 text-sm font-semibold text-warning"
          data-testid="po-hold"
        >
          New purchase orders are on hold: {m.hold.reason}.
        </p>
      )}
      <section aria-labelledby="next-h">
        <h3 id="next-h" className="font-heading font-semibold">
          What to do next
        </h3>
        {m.nextSteps.steps.length === 0 ? (
          <p className="mt-1 text-sm text-text-muted">
            Nothing needs doing yet. Suggestions appear as the end date approaches.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2" data-testid="next-steps">
            {m.nextSteps.steps.map((s) => (
              <li key={s.text} className="rounded-md border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={PRIORITY_TONE[s.priority]}>{s.priority.toLowerCase()} priority</Badge>
                  <strong>{s.text}</strong>
                </div>
                <p className="mt-1 text-text-muted">{s.why}</p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-xs text-text-muted">
          Suggestions come from fixed rules, a stand-in for an AI model ({m.nextSteps.model}).
        </p>
      </section>

      <section aria-labelledby="hist-h">
        <h3 id="hist-h" className="font-heading font-semibold">
          Variations, extensions and value
        </h3>
        <dl className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-text-muted">Variations</dt>
            <dd className="text-lg font-semibold" data-testid="variation-count">
              {m.variationCount}
            </dd>
          </div>
          <div>
            <dt className="text-text-muted">Extensions taken up</dt>
            <dd className="text-lg font-semibold" data-testid="extensions-used">
              {m.extensions.exercised} of {m.extensions.total}
            </dd>
          </div>
          <div>
            <dt className="text-text-muted">Extensions left</dt>
            <dd className="text-lg font-semibold">{m.extensions.remaining}</dd>
          </div>
          <div>
            <dt className="text-text-muted">Cumulative value</dt>
            <dd className="text-lg font-semibold" data-testid="cumulative-value">
              {aud.format(m.cumulative.value)}
            </dd>
          </div>
        </dl>
        {m.extensions.list.length > 0 && (
          <ul className="mt-2 text-sm" aria-label="Extensions">
            {m.extensions.list.map((e) => (
              <li key={e.position} className="flex flex-wrap gap-2">
                <span>
                  Option {e.position}: {e.months} months ({e.startsOn} to {e.endsOn})
                </span>
                {e.exercised ? (
                  <Badge tone="success">Taken up {e.requestNumber ?? ''}</Badge>
                ) : (
                  <Badge tone="neutral">Not taken up</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
        <Table caption="Versions of the contract" className="mt-3">
          <thead>
            <tr>
              <Th>Version</Th>
              <Th>Number</Th>
              <Th className="text-right">Change</Th>
              <Th className="text-right">Value after</Th>
              <Th>Ends</Th>
              <Th>Business case</Th>
            </tr>
          </thead>
          <tbody>
            {m.versions.map((v) => (
              <tr key={v.number}>
                <Td label="Version">{v.label}</Td>
                <Td label="Number" className="font-mono text-xs">
                  {v.number}
                </Td>
                <Td label="Change" className="text-right">
                  {v.label === 'Original' ? '–' : `${aud.format(v.value)} (${v.variancePct}%)`}
                </Td>
                <Td label="Value after" className="text-right">
                  {aud.format(v.cumulativeValue)}
                </Td>
                <Td label="Ends">{v.endDate ?? '–'}</Td>
                <Td label="Business case">{v.businessCase ?? '–'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {m.variations.some((v) => v.status !== 'EXECUTED') && (
          <p className="mt-2 text-sm text-text-muted">
            In preparation:{' '}
            {m.variations
              .filter((v) => v.status !== 'EXECUTED')
              .map((v) => v.number)
              .join(', ')}
          </p>
        )}
      </section>

      <section aria-labelledby="link-h">
        <h3 id="link-h" className="font-heading font-semibold">
          Procurements linked to this contract
        </h3>
        {m.procurements.length === 0 ? (
          <p className="mt-1 text-sm text-text-muted">
            None yet. A renewal, variation or extension gets its own procurement number.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1 text-sm" data-testid="linked-procurements">
            {m.procurements.map((p) => (
              <li key={p.id}>
                <a href={`/app/requests/${p.id}`} className="font-mono text-xs">
                  {p.number}
                </a>{' '}
                {p.title} <Badge tone="info">{KIND_LABEL[p.kind] ?? p.kind}</Badge>
              </li>
            ))}
          </ul>
        )}
        {m.canLink && (
          <form
            aria-label="Start a linked procurement"
            className="mt-3 flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void r.run(
                'link',
                async () => {
                  await send(csrf, 'POST', `/contracts/${c.id}/procurements`, {
                    kind,
                    note,
                    ...(value && kind !== 'RENEW' ? { value: Number(value) } : {}),
                  });
                  setNote('');
                  setValue('');
                  await reload();
                },
                'A new procurement number was created and linked to this contract.',
              );
            }}
          >
            <div className="flex flex-wrap items-end gap-3">
              <Field label="What for">
                <Select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as typeof kind)}
                  className="w-56"
                >
                  <option value="RENEW">Renew the contract</option>
                  <option value="VARY">Vary the contract</option>
                  <option value="EXTEND" disabled={m.extensions.remaining === 0}>
                    Take up the next extension
                  </option>
                </Select>
              </Field>
              {kind !== 'RENEW' && (
                <Field label="Additional value (AUD)">
                  <Input
                    type="number"
                    min={0}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    className="w-40"
                  />
                </Field>
              )}
            </div>
            <Field
              label="Why"
              hint="This is not a new tender: the number only links the activity to this contract in the pipeline."
            >
              <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
            </Field>
            <div>
              <Button
                type="submit"
                variant="secondary"
                loading={r.busy === 'link'}
                disabled={note.trim().length < 5}
              >
                Start linked procurement
              </Button>
            </div>
            {r.messages}
          </form>
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ lines editor
function LinesEditor({
  lines,
  onChange,
  label,
}: {
  lines: Array<{ item: string; qty: string; unitPrice: string }>;
  onChange: (l: Array<{ item: string; qty: string; unitPrice: string }>) => void;
  label: string;
}) {
  const set = (i: number, k: 'item' | 'qty' | 'unitPrice', v: string) =>
    onChange(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-semibold">{label}</legend>
      {lines.map((l, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2">
          <Field label={`Item ${i + 1}`}>
            <Input value={l.item} onChange={(e) => set(i, 'item', e.target.value)} className="w-48" />
          </Field>
          <Field label={`Quantity ${i + 1}`}>
            <Input
              type="number"
              min={0}
              step="any"
              value={l.qty}
              onChange={(e) => set(i, 'qty', e.target.value)}
              className="w-28"
            />
          </Field>
          <Field label={`Unit price ${i + 1}`}>
            <Input
              type="number"
              min={0}
              step="any"
              value={l.unitPrice}
              onChange={(e) => set(i, 'unitPrice', e.target.value)}
              className="w-32"
            />
          </Field>
          {lines.length > 1 && (
            <Button
              variant="secondary"
              aria-label={`Remove line ${i + 1}`}
              onClick={() => onChange(lines.filter((_, j) => j !== i))}
            >
              Remove
            </Button>
          )}
        </div>
      ))}
      <div>
        <Button
          variant="secondary"
          onClick={() => onChange([...lines, { item: '', qty: '1', unitPrice: '' }])}
        >
          Add a line
        </Button>
      </div>
    </fieldset>
  );
}
const toLines = (l: Array<{ item: string; qty: string; unitPrice: string }>): Line[] =>
  l
    .filter((x) => x.item.trim())
    .map((x) => ({ item: x.item.trim(), qty: Number(x.qty), unitPrice: Number(x.unitPrice) }));
const blank = () => [{ item: '', qty: '1', unitPrice: '' }];

// ------------------------------------------------------------------ spend, orders and invoices (FR-0580, FR-0500, FR-0495)
function SpendTab({ c, csrf, roles }: { c: ContractView; csrf: string; roles: string[] }) {
  const sp = useData<Spend>(`/contracts/${c.id}/spend`);
  const com = useData<Commercial>(`/contracts/${c.id}/commercial`);
  const pos = useData<PurchaseOrder[]>(`/contracts/${c.id}/purchase-orders`);
  const invs = useData<Invoice[]>(`/contracts/${c.id}/invoices`);
  const [poDesc, setPoDesc] = useState('');
  const [poLines, setPoLines] = useState(blank());
  const [invDate, setInvDate] = useState('');
  const [invPo, setInvPo] = useState('');
  const [invLines, setInvLines] = useState(blank());
  const r = useRun();
  const reloadAll = async () => {
    await Promise.all([sp.reload(), pos.reload(), invs.reload(), com.reload()]);
  };
  const s = sp.data;
  const canMoney = com.data?.canMoney ?? false;
  const canInvoice = canMoney && has(roles, 'FINANCE', 'CONTRACT_MGR');
  return (
    <div className="flex flex-col gap-5" data-testid="mgmt-spend">
      {sp.error && (
        <p role="alert" className="text-sm text-error">
          {sp.error}
        </p>
      )}
      {s ? (
        <section aria-labelledby="sp-h" className="flex flex-col gap-3">
          <h3 id="sp-h" className="font-heading font-semibold">
            Spend against the contract
          </h3>
          <Bar label={`Spend: ${aud.format(s.invoiced)} of ${aud.format(s.value)}`} pct={s.spentPct} />
          <Bar
            label={`Term: ${s.term.elapsedDays} of ${s.term.totalDays} days`}
            pct={s.term.pct}
            limit={false}
          />
          <Bar label={`Paid: ${aud.format(s.paid)}`} pct={s.paidPct} limit={false} />
          <Bar label={`Committed on purchase orders: ${aud.format(s.committed)}`} pct={s.committedPct} />
          <p className="text-sm text-text-muted">
            {aud.format(s.remaining)} left. You are told at {s.configuredPct}% and, always, at 80%, 90% and
            100% of the limit.
            {s.blockedCount > 0 &&
              ` ${s.blockedCount} blocked invoice(s) worth ${aud.format(s.blockedAmount)} are not counted.`}
          </p>
          {s.raised.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Spend notices raised">
              {s.raised.map((a) => (
                <li key={`${a.kind}${a.threshold}`}>
                  <Badge tone={a.threshold >= 100 ? 'error' : a.threshold >= 80 ? 'warning' : 'info'}>
                    {a.threshold}% {a.kind === 'MANDATORY' ? '(fixed)' : '(configured)'}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <p className="text-sm text-text-muted">Loading…</p>
      )}

      <section aria-labelledby="po-h">
        <h3 id="po-h" className="font-heading font-semibold">
          Purchase orders
        </h3>
        {com.data && !com.data.erpIntegrated && (
          <p className="mt-1 text-sm text-text-muted">
            The ERP is not integrated, so the spend-ceiling guard is off.
          </p>
        )}
        {(pos.data ?? []).length === 0 ? (
          <p className="mt-1 text-sm text-text-muted">No purchase orders yet.</p>
        ) : (
          <Table caption="Purchase orders" className="mt-2">
            <thead>
              <tr>
                <Th>Number</Th>
                <Th>For</Th>
                <Th className="text-right">Amount</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {pos.data!.map((p) => (
                <tr key={p.id}>
                  <Td label="Number" className="font-mono text-xs">
                    {p.number}
                  </Td>
                  <Td label="For">{p.description}</Td>
                  <Td label="Amount" className="text-right">
                    {aud.format(p.amount)}
                  </Td>
                  <Td label="Status">
                    {p.status === 'BLOCKED' ? (
                      <span>
                        <Badge tone="error">Blocked</Badge> <span className="text-xs">{p.blockedReason}</span>
                      </span>
                    ) : (
                      <Badge tone="success">Approved</Badge>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {canMoney && (
          <form
            aria-label="Raise a purchase order"
            className="mt-3 flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void r
                .run(
                  'po',
                  async () => {
                    await send(csrf, 'POST', `/contracts/${c.id}/purchase-orders`, {
                      description: poDesc,
                      lines: toLines(poLines),
                    });
                    setPoDesc('');
                    setPoLines(blank());
                  },
                  'Purchase order raised.',
                )
                .then(() => reloadAll());
            }}
          >
            <Field label="What the order is for">
              <Input value={poDesc} onChange={(e) => setPoDesc(e.target.value)} maxLength={300} />
            </Field>
            <LinesEditor label="Order lines" lines={poLines} onChange={setPoLines} />
            <div>
              <Button
                type="submit"
                variant="secondary"
                loading={r.busy === 'po'}
                disabled={poDesc.trim().length < 3}
              >
                Raise purchase order
              </Button>
            </div>
          </form>
        )}
      </section>

      <section aria-labelledby="inv-h">
        <h3 id="inv-h" className="font-heading font-semibold">
          Invoices and the three-way match
        </h3>
        {(invs.data ?? []).length === 0 ? (
          <p className="mt-1 text-sm text-text-muted">No invoices yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2" data-testid="invoices">
            {invs.data!.map((i) => (
              <li
                key={i.id}
                className="rounded-md border border-border p-3 text-sm"
                data-invoice-status={i.status}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs">{i.number}</span>
                  <Badge tone={MATCH_TONE[i.status]}>{MATCH_LABEL[i.status]}</Badge>
                  <span className="ml-auto">
                    {i.invoiceDate} · {aud.format(i.amount)}
                  </span>
                </div>
                {i.findings.length > 0 && (
                  <ul className="mt-1 list-disc pl-5 text-text-muted">
                    {i.findings.map((f, k) => (
                      <li key={k}>{f.message}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
        {canInvoice && (
          <form
            aria-label="Record an invoice"
            className="mt-3 flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void r
                .run(
                  'inv',
                  async () => {
                    await send(csrf, 'POST', `/contracts/${c.id}/invoices`, {
                      invoiceDate: invDate,
                      ...(invPo ? { poId: invPo } : {}),
                      lines: toLines(invLines),
                    });
                    setInvLines(blank());
                  },
                  'Invoice recorded and matched.',
                )
                .then(() => reloadAll());
            }}
          >
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Invoice date">
                <Input type="date" value={invDate} onChange={(e) => setInvDate(e.target.value)} />
              </Field>
              <Field label="Purchase order">
                <Select value={invPo} onChange={(e) => setInvPo(e.target.value)} className="w-64">
                  <option value="">None</option>
                  {(pos.data ?? [])
                    .filter((p) => p.status === 'APPROVED')
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.number} ({aud.format(p.amount)})
                      </option>
                    ))}
                </Select>
              </Field>
            </div>
            <LinesEditor label="Invoice lines" lines={invLines} onChange={setInvLines} />
            <div>
              <Button type="submit" variant="secondary" loading={r.busy === 'inv'} disabled={!invDate}>
                Record invoice
              </Button>
            </div>
          </form>
        )}
        {r.messages}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ rates, escalation, rebates (FR-0500, FR-0525, FR-0520)
function TermsTab({ c, csrf }: { c: ContractView; csrf: string }) {
  const { data: t, error, reload } = useData<Commercial>(`/contracts/${c.id}/commercial`);
  const [rates, setRates] = useState<Array<{ item: string; unit: string; unitPrice: string }> | null>(null);
  const [esc, setEsc] = useState<Array<{
    kind: string;
    effectiveOn: string;
    pct: string;
    capPct: string;
  }> | null>(null);
  const [rb, setRb] = useState({ title: '', threshold: '', ratePct: '', periodStart: '', periodEnd: '' });
  const [claim, setClaim] = useState<Record<string, string>>({});
  const r = useRun();
  if (error)
    return (
      <p role="alert" className="text-sm text-error">
        {error}
      </p>
    );
  if (!t) return <p className="text-sm text-text-muted">Loading…</p>;
  const ratesNow =
    rates ?? t.rates.map((x) => ({ item: x.item, unit: x.unit, unitPrice: String(x.unitPrice) }));
  const escNow =
    esc ??
    t.escalations.map((x) => ({
      kind: x.kind,
      effectiveOn: x.effectiveOn,
      pct: String(x.pct),
      capPct: x.capPct === null ? '' : String(x.capPct),
    }));
  return (
    <div className="flex flex-col gap-5" data-testid="mgmt-terms">
      <section aria-labelledby="rate-h">
        <h3 id="rate-h" className="font-heading font-semibold">
          Rate card
        </h3>
        <p className="text-sm text-text-muted">
          Invoices are matched to these prices. The prices due today include{' '}
          {Math.round((t.factorToday - 1) * 10_000) / 100}% of escalation.
        </p>
        {ratesNow.length === 0 && <p className="mt-1 text-sm text-text-muted">No rate card yet.</p>}
        {t.canEdit ? (
          <form
            aria-label="Rate card"
            className="mt-2 flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void r.run(
                'rates',
                async () => {
                  await send(csrf, 'PUT', `/contracts/${c.id}/rates`, {
                    rates: ratesNow
                      .filter((x) => x.item.trim())
                      .map((x) => ({
                        item: x.item.trim(),
                        unit: x.unit.trim() || 'each',
                        unitPrice: Number(x.unitPrice),
                      })),
                  });
                  setRates(null);
                  await reload();
                },
                'Rate card saved.',
              );
            }}
          >
            {ratesNow.map((x, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <Field label={`Rate item ${i + 1}`}>
                  <Input
                    value={x.item}
                    onChange={(e) =>
                      setRates(ratesNow.map((y, j) => (j === i ? { ...y, item: e.target.value } : y)))
                    }
                    className="w-48"
                  />
                </Field>
                <Field label={`Unit ${i + 1}`}>
                  <Input
                    value={x.unit}
                    onChange={(e) =>
                      setRates(ratesNow.map((y, j) => (j === i ? { ...y, unit: e.target.value } : y)))
                    }
                    className="w-24"
                  />
                </Field>
                <Field label={`Contracted price ${i + 1}`}>
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    value={x.unitPrice}
                    onChange={(e) =>
                      setRates(ratesNow.map((y, j) => (j === i ? { ...y, unitPrice: e.target.value } : y)))
                    }
                    className="w-32"
                  />
                </Field>
                <Button
                  variant="secondary"
                  aria-label={`Remove rate ${i + 1}`}
                  onClick={() => setRates(ratesNow.filter((_, j) => j !== i))}
                >
                  Remove
                </Button>
              </div>
            ))}
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => setRates([...ratesNow, { item: '', unit: 'each', unitPrice: '' }])}
              >
                Add a rate
              </Button>
              <Button type="submit" loading={r.busy === 'rates'}>
                Save rate card
              </Button>
            </div>
          </form>
        ) : (
          <ul className="mt-2 text-sm">
            {t.rates.map((x) => (
              <li key={x.item}>
                {x.item}: {aud.format(x.unitPrice)} per {x.unit}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="esc-h">
        <h3 id="esc-h" className="font-heading font-semibold">
          Price escalation
        </h3>
        <p className="text-sm text-text-muted">
          A scheduled step as written, or an index movement (such as CPI) up to its cap. An invoice that
          applies more, or earlier, is blocked.
        </p>
        {t.canEdit ? (
          <form
            aria-label="Price escalation"
            className="mt-2 flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void r.run(
                'esc',
                async () => {
                  await send(csrf, 'PUT', `/contracts/${c.id}/escalations`, {
                    escalations: escNow
                      .filter((x) => x.effectiveOn && x.pct)
                      .map((x) => ({
                        kind: x.kind,
                        effectiveOn: x.effectiveOn,
                        pct: Number(x.pct),
                        ...(x.capPct ? { capPct: Number(x.capPct) } : {}),
                      })),
                  });
                  setEsc(null);
                  await reload();
                },
                'Escalation clauses saved.',
              );
            }}
          >
            {escNow.map((x, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <Field label={`Escalation type ${i + 1}`}>
                  <Select
                    value={x.kind}
                    onChange={(e) =>
                      setEsc(escNow.map((y, j) => (j === i ? { ...y, kind: e.target.value } : y)))
                    }
                    className="w-40"
                  >
                    <option value="SCHEDULED">Scheduled step</option>
                    <option value="CPI">Index-linked (CPI)</option>
                  </Select>
                </Field>
                <Field label={`Takes effect ${i + 1}`}>
                  <Input
                    type="date"
                    value={x.effectiveOn}
                    onChange={(e) =>
                      setEsc(escNow.map((y, j) => (j === i ? { ...y, effectiveOn: e.target.value } : y)))
                    }
                  />
                </Field>
                <Field label={`Increase % ${i + 1}`}>
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    value={x.pct}
                    onChange={(e) =>
                      setEsc(escNow.map((y, j) => (j === i ? { ...y, pct: e.target.value } : y)))
                    }
                    className="w-24"
                  />
                </Field>
                {x.kind === 'CPI' && (
                  <Field label={`Cap % ${i + 1}`}>
                    <Input
                      type="number"
                      min={0}
                      step="any"
                      value={x.capPct}
                      onChange={(e) =>
                        setEsc(escNow.map((y, j) => (j === i ? { ...y, capPct: e.target.value } : y)))
                      }
                      className="w-24"
                    />
                  </Field>
                )}
                <Button
                  variant="secondary"
                  aria-label={`Remove escalation ${i + 1}`}
                  onClick={() => setEsc(escNow.filter((_, j) => j !== i))}
                >
                  Remove
                </Button>
              </div>
            ))}
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() =>
                  setEsc([...escNow, { kind: 'SCHEDULED', effectiveOn: '', pct: '', capPct: '' }])
                }
              >
                Add an escalation
              </Button>
              <Button type="submit" loading={r.busy === 'esc'}>
                Save escalation
              </Button>
            </div>
          </form>
        ) : (
          <ul className="mt-2 text-sm">
            {t.escalations.map((e) => (
              <li key={e.effectiveOn + e.kind}>
                {e.kind === 'CPI' ? 'Index-linked' : 'Scheduled'} from {e.effectiveOn}: up to {e.allowedPct}%
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="reb-h">
        <h3 id="reb-h" className="font-heading font-semibold">
          Rebates
        </h3>
        {t.rebates.length === 0 ? (
          <p className="mt-1 text-sm text-text-muted">No rebate terms recorded.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2" data-testid="rebates">
            {t.rebates.map((x) => (
              <li key={x.id} className="rounded-md border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <strong>{x.title}</strong>
                  <Badge tone={REBATE_TONE[x.status] ?? 'neutral'}>
                    {REBATE_LABEL[x.status] ?? x.status}
                  </Badge>
                  {x.flagged && <Badge tone="error">Follow up</Badge>}
                  <span className="ml-auto text-text-muted">
                    {x.periodStart} to {x.periodEnd}
                  </span>
                </div>
                <p className="mt-1 text-text-muted">{x.message}.</p>
                <p className="mt-1 text-xs text-text-muted">
                  {x.ratePct}% above {aud.format(x.threshold)}: spend {aud.format(x.spend)}, earned{' '}
                  {aud.format(x.earned)}, claimed {aud.format(x.claimed)}
                </p>
                {t.canMoney && x.shortfall > 0 && (
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <Field label={`Amount claimed for ${x.title}`}>
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={claim[x.id] ?? ''}
                        onChange={(e) => setClaim({ ...claim, [x.id]: e.target.value })}
                        className="w-32"
                      />
                    </Field>
                    <Button
                      variant="secondary"
                      disabled={!claim[x.id]}
                      loading={r.busy === `claim-${x.id}`}
                      onClick={() =>
                        void r.run(
                          `claim-${x.id}`,
                          async () => {
                            await send(csrf, 'POST', `/contracts/${c.id}/rebates/${x.id}/claim`, {
                              amount: Number(claim[x.id]),
                            });
                            setClaim({ ...claim, [x.id]: '' });
                            await reload();
                          },
                          'Claim recorded.',
                        )
                      }
                    >
                      Record claim
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {t.canEdit && (
          <form
            aria-label="Add a rebate"
            className="mt-3 flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void r.run(
                'rebate',
                async () => {
                  await send(csrf, 'POST', `/contracts/${c.id}/rebates`, {
                    title: rb.title,
                    threshold: Number(rb.threshold),
                    ratePct: Number(rb.ratePct),
                    periodStart: rb.periodStart,
                    periodEnd: rb.periodEnd,
                  });
                  setRb({ title: '', threshold: '', ratePct: '', periodStart: '', periodEnd: '' });
                  await reload();
                },
                'Rebate term added.',
              );
            }}
          >
            <Field label="Rebate term">
              <Input
                value={rb.title}
                onChange={(e) => setRb({ ...rb, title: e.target.value })}
                maxLength={160}
              />
            </Field>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Spend threshold (AUD)">
                <Input
                  type="number"
                  min={0}
                  value={rb.threshold}
                  onChange={(e) => setRb({ ...rb, threshold: e.target.value })}
                  className="w-40"
                />
              </Field>
              <Field label="Rebate rate %">
                <Input
                  type="number"
                  min={0}
                  step="any"
                  value={rb.ratePct}
                  onChange={(e) => setRb({ ...rb, ratePct: e.target.value })}
                  className="w-28"
                />
              </Field>
              <Field label="Period starts">
                <Input
                  type="date"
                  value={rb.periodStart}
                  onChange={(e) => setRb({ ...rb, periodStart: e.target.value })}
                />
              </Field>
              <Field label="Period ends">
                <Input
                  type="date"
                  value={rb.periodEnd}
                  onChange={(e) => setRb({ ...rb, periodEnd: e.target.value })}
                />
              </Field>
            </div>
            <div>
              <Button
                type="submit"
                variant="secondary"
                loading={r.busy === 'rebate'}
                disabled={!rb.title || !rb.threshold || !rb.ratePct || !rb.periodStart || !rb.periodEnd}
              >
                Add rebate
              </Button>
            </div>
          </form>
        )}
        {r.messages}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ plans and activities (FR-0555)
function PlansTab({ c, csrf, roles }: { c: ContractView; csrf: string; roles: string[] }) {
  const { data: p, error, reload } = useData<Plans>(`/contracts/${c.id}/plans`);
  const [tpl, setTpl] = useState({ kind: 'CMP', name: '', text: '' });
  const r = useRun();
  if (error)
    return (
      <p role="alert" className="text-sm text-error">
        {error}
      </p>
    );
  if (!p) return <p className="text-sm text-text-muted">Loading…</p>;
  const canTemplate = has(roles, 'CONTRACT_MGR', 'LEGAL');
  return (
    <div className="flex flex-col gap-5" data-testid="mgmt-plans">
      {p.plans.length === 0 ? (
        <EmptyState
          title="No management plans yet"
          body="Plans are made automatically for a high-value or high-risk contract. You can make them for this one now."
          action={
            p.canGenerate ? (
              <Button
                loading={r.busy === 'gen'}
                onClick={() =>
                  void r.run(
                    'gen',
                    async () => {
                      await send(csrf, 'POST', `/contracts/${c.id}/plans/generate`);
                      await reload();
                    },
                    'Plans generated.',
                  )
                }
              >
                Generate plans
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <p className="text-sm">
            Management tier:{' '}
            <Badge tone={p.tier === 'HIGH' ? 'error' : p.tier === 'ELEVATED' ? 'warning' : 'neutral'}>
              {(p.tier ?? '').toLowerCase()}
            </Badge>
          </p>
          <ul className="list-disc pl-5 text-sm text-text-muted" aria-label="Why this tier">
            {p.reasons.length === 0 ? (
              <li>Nothing raises the level above standard.</li>
            ) : (
              p.reasons.map((x) => <li key={x}>{x}</li>)
            )}
          </ul>
          {has(roles, 'CONTRACT_MGR', 'PROCUREMENT', 'LEGAL', 'EXEC') && (
            <ArtefactBadge
              kind="CONTRACT_PLANS"
              id={c.id}
              csrf={csrf}
              canRefresh={has(roles, 'CONTRACT_MGR', 'PROCUREMENT', 'LEGAL')}
              onRefreshed={() => void reload()}
            />
          )}
          {p.plans.map((pl) => (
            <details key={pl.kind} className="rounded-md border border-border p-3">
              <summary className="cursor-pointer font-semibold">
                {pl.kind === 'CMP' ? 'Contract management plan' : 'Risk management plan'}{' '}
                <span className="text-xs font-normal text-text-muted">
                  ({pl.template === 'CUSTOM' ? 'your template' : 'standard template'})
                </span>
              </summary>
              <div className="mt-2 flex flex-col gap-2 text-sm">
                {pl.sections.map((s) => (
                  <div key={s.title}>
                    <h4 className="font-semibold">{s.title}</h4>
                    <p className="text-text-muted">{s.text}</p>
                  </div>
                ))}
              </div>
            </details>
          ))}
          <section aria-labelledby="act-h">
            <h3 id="act-h" className="font-heading font-semibold">
              Activities ({p.activities.filter((a) => a.status === 'OPEN').length} open)
            </h3>
            <Table caption="Contract management activities" className="mt-2">
              <thead>
                <tr>
                  <Th>Due</Th>
                  <Th>Activity</Th>
                  <Th>Plan</Th>
                  <Th>Owner</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {p.activities.map((a) => (
                  <tr key={a.id}>
                    <Td label="Due" className="whitespace-nowrap">
                      {a.dueDate}
                    </Td>
                    <Td label="Activity">{a.title}</Td>
                    <Td label="Plan">{a.plan}</Td>
                    <Td label="Owner">{a.owner ?? '–'}</Td>
                    <Td label="Status">
                      {a.status === 'DONE' ? (
                        <Badge tone="success">Done {formatDateTime(a.doneAt)}</Badge>
                      ) : (
                        <span className="flex flex-wrap items-center gap-2">
                          {a.overdue && <Badge tone="error">Overdue</Badge>}
                          {p.canComplete && (
                            <Button
                              variant="secondary"
                              aria-label={`Mark done: ${a.title}`}
                              loading={r.busy === a.id}
                              onClick={() =>
                                void r.run(a.id, async () => {
                                  await send(
                                    csrf,
                                    'POST',
                                    `/contracts/${c.id}/activities/${a.id}/complete`,
                                    {},
                                  );
                                  await reload();
                                })
                              }
                            >
                              Done
                            </Button>
                          )}
                        </span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {p.canGenerate && (
              <Button
                variant="secondary"
                className="mt-2"
                loading={r.busy === 'gen'}
                onClick={() =>
                  void r.run(
                    'gen',
                    async () => {
                      await send(csrf, 'POST', `/contracts/${c.id}/plans/generate`);
                      await reload();
                    },
                    'Plans generated again.',
                  )
                }
              >
                Generate again
              </Button>
            )}
          </section>
        </>
      )}
      {canTemplate && (
        <section aria-labelledby="tpl-h">
          <h3 id="tpl-h" className="font-heading font-semibold">
            Use your own template
          </h3>
          <form
            aria-label="Upload a plan template"
            className="mt-2 flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void r.run(
                'tpl',
                async () => {
                  await send(csrf, 'PUT', `/contract-plan-templates/${tpl.kind}`, {
                    name: tpl.name,
                    text: tpl.text,
                  });
                  setTpl({ ...tpl, text: '' });
                },
                'Template saved. Generate the plans again to use it.',
              );
            }}
          >
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Plan">
                <Select
                  value={tpl.kind}
                  onChange={(e) => setTpl({ ...tpl, kind: e.target.value })}
                  className="w-56"
                >
                  <option value="CMP">Contract management plan</option>
                  <option value="RMP">Risk management plan</option>
                </Select>
              </Field>
              <Field label="Template name">
                <Input
                  value={tpl.name}
                  onChange={(e) => setTpl({ ...tpl, name: e.target.value })}
                  className="w-64"
                />
              </Field>
            </div>
            <Field
              label="Template text"
              hint="Start each section with a heading line such as ## Purpose. Use {{CONTRACT}}, {{SUPPLIER}}, {{VALUE}}, {{START}}, {{END}}, {{OWNER}} and {{TIER}} to fill in the details."
            >
              <Textarea
                rows={6}
                value={tpl.text}
                onChange={(e) => setTpl({ ...tpl, text: e.target.value })}
              />
            </Field>
            <div>
              <Button
                type="submit"
                variant="secondary"
                loading={r.busy === 'tpl'}
                disabled={tpl.name.trim().length < 2 || tpl.text.trim().length < 10}
              >
                Save template
              </Button>
            </div>
          </form>
        </section>
      )}
      {r.messages}
    </div>
  );
}

// ------------------------------------------------------------------ work orders under a master agreement (FR-0575)
function WorkOrdersTab({ c, csrf }: { c: ContractView; csrf: string }) {
  const { data: w, error, reload } = useData<WorkOrders>(`/contracts/${c.id}/work-orders`);
  const [f, setF] = useState({ title: '', value: '', startDate: '', endDate: '' });
  const r = useRun();
  if (error)
    return (
      <p role="alert" className="text-sm text-error">
        {error}
      </p>
    );
  if (!w) return <p className="text-sm text-text-muted">Loading…</p>;
  return (
    <div className="flex flex-col gap-4" data-testid="mgmt-orders">
      <p className="text-sm">
        Master agreement value {aud.format(w.master.value)}: {aud.format(w.totals.allocated)} allocated to
        work orders, {aud.format(w.totals.unallocated)} still to allocate; {aud.format(w.totals.invoiced)}{' '}
        invoiced.
      </p>
      {w.orders.length === 0 ? (
        <p className="text-sm text-text-muted">No work orders yet.</p>
      ) : (
        <Table caption="Work orders">
          <thead>
            <tr>
              <Th>Number</Th>
              <Th>Work order</Th>
              <Th className="text-right">Value</Th>
              <Th className="text-right">Committed</Th>
              <Th className="text-right">Invoiced</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {w.orders.map((o) => (
              <tr key={o.id}>
                <Td label="Number" className="font-mono text-xs">
                  {o.number}
                </Td>
                <Td label="Work order">{o.title}</Td>
                <Td label="Value" className="text-right">
                  {aud.format(o.value)}
                </Td>
                <Td label="Committed" className="text-right">
                  {aud.format(o.committed)}
                </Td>
                <Td label="Invoiced" className="text-right">
                  {aud.format(o.invoiced)}
                </Td>
                <Td label="Status">
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge
                      tone={o.status === 'OPEN' ? 'info' : o.status === 'COMPLETE' ? 'success' : 'neutral'}
                    >
                      {o.status.toLowerCase()}
                    </Badge>
                    {w.canEdit && o.status === 'OPEN' && (
                      <Button
                        variant="secondary"
                        aria-label={`Complete ${o.number}`}
                        onClick={() =>
                          void r.run(o.id, async () => {
                            await send(csrf, 'PATCH', `/work-orders/${o.id}`, { status: 'COMPLETE' });
                            await reload();
                          })
                        }
                      >
                        Complete
                      </Button>
                    )}
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {w.canEdit && (
        <form
          aria-label="Raise a work order"
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void r.run(
              'wo',
              async () => {
                await send(csrf, 'POST', `/contracts/${c.id}/work-orders`, {
                  title: f.title,
                  value: Number(f.value),
                  startDate: f.startDate,
                  endDate: f.endDate,
                });
                setF({ title: '', value: '', startDate: '', endDate: '' });
                await reload();
              },
              'Work order raised.',
            );
          }}
        >
          <Field label="Work order">
            <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={200} />
          </Field>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Value (AUD)">
              <Input
                type="number"
                min={0}
                value={f.value}
                onChange={(e) => setF({ ...f, value: e.target.value })}
                className="w-40"
              />
            </Field>
            <Field label="Starts">
              <Input
                type="date"
                value={f.startDate}
                onChange={(e) => setF({ ...f, startDate: e.target.value })}
              />
            </Field>
            <Field label="Ends">
              <Input
                type="date"
                value={f.endDate}
                onChange={(e) => setF({ ...f, endDate: e.target.value })}
              />
            </Field>
          </div>
          <div>
            <Button
              type="submit"
              variant="secondary"
              loading={r.busy === 'wo'}
              disabled={!f.title || !f.value || !f.startDate || !f.endDate}
            >
              Raise work order
            </Button>
          </div>
        </form>
      )}
      {r.messages}
    </div>
  );
}

// ------------------------------------------------------------------ alerts from the clause wording (FR-0530)
function TriggersTab({ c, csrf, roles }: { c: ContractView; csrf: string; roles: string[] }) {
  const [found, setFound] = useState<{ model: string; note: string; proposals: Proposal[] } | null>(null);
  const [pick, setPick] = useState<string[]>([]);
  const r = useRun();
  const canUse = has(roles, 'CONTRACT_MGR', 'PROCUREMENT', 'LEGAL', 'EXEC');
  const find = () =>
    r.run('find', async () => {
      const x = await send<{ model: string; note: string; proposals: Proposal[] }>(
        csrf,
        'POST',
        `/contracts/${c.id}/alerts/extract`,
      );
      setFound(x);
      setPick(x.proposals.filter((p) => !p.applied).map((p) => p.key));
    });
  return (
    <div className="flex flex-col gap-3" data-testid="mgmt-triggers">
      <p className="max-w-prose text-sm text-text-muted">
        Notice periods, review cycles and yearly duties are often written into the clauses. Find them and
        schedule an alert ahead of each, in addition to the standard ones.
      </p>
      {canUse && (
        <div>
          <Button variant="secondary" loading={r.busy === 'find'} onClick={() => void find()}>
            Find alerts in the clauses
          </Button>
        </div>
      )}
      {found && (
        <>
          <p className="text-xs text-text-muted">{found.note}</p>
          {found.proposals.length === 0 ? (
            <p className="text-sm">No notice periods or review cycles were found in the wording.</p>
          ) : (
            <form
              aria-label="Alerts found in the clauses"
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void r.run(
                  'apply',
                  async () => {
                    const x = await send<{ created: unknown[] }>(
                      csrf,
                      'POST',
                      `/contracts/${c.id}/alerts/extract/apply`,
                      { keys: pick },
                    );
                    await find();
                    void x;
                  },
                  'The alerts you chose are scheduled.',
                );
              }}
            >
              <ul className="flex flex-col gap-2">
                {found.proposals.map((p) => (
                  <li key={p.key} className="rounded-md border border-border p-3 text-sm">
                    <Checkbox
                      label={
                        <span>
                          <strong>{p.clauseTitle}:</strong> {p.summary}{' '}
                          <span className="text-text-muted">(alert on {p.triggerDate})</span>
                          {p.applied && <Badge tone="success"> Scheduled</Badge>}
                        </span>
                      }
                      disabled={p.applied}
                      checked={pick.includes(p.key) && !p.applied}
                      onChange={(e) =>
                        setPick(e.target.checked ? [...pick, p.key] : pick.filter((k) => k !== p.key))
                      }
                    />
                    <p className="mt-1 pl-8 text-xs text-text-muted">&ldquo;{p.quote}&rdquo;</p>
                  </li>
                ))}
              </ul>
              <div>
                <Button type="submit" loading={r.busy === 'apply'} disabled={pick.length === 0}>
                  Schedule the chosen alerts
                </Button>
              </div>
            </form>
          )}
        </>
      )}
      {r.messages}
    </div>
  );
}

// ------------------------------------------------------------------ a variation's business case, measures and disclosure (FR-0535, FR-0540, FR-0545)
export function VariationInfo({ v }: { v: NonNullable<ContractView['variation']> }) {
  return (
    <Card aria-labelledby="var-h" role="region" data-testid="variation-info">
      <h2 id="var-h" className="font-heading text-xl font-bold">
        Business case and variance
      </h2>
      <p className="mt-2 text-sm">{v.businessCase}</p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-text-muted">Measured</dt>
        <dd>
          {v.model === 'CUMULATIVE'
            ? 'Cumulatively: every variation against the original value'
            : 'Incrementally: this change against the contract as it stood'}
        </dd>
        <dt className="text-text-muted">Variance</dt>
        <dd data-testid="variance-pct">{v.variancePct ?? 0}%</dd>
        <dt className="text-text-muted">Contract value after</dt>
        <dd>{aud.format(v.cumulativeValue)}</dd>
        <dt className="text-text-muted">Must be signed by</dt>
        <dd>{v.requiredSigners.join(' and ')}</dd>
      </dl>
      {v.tierChanged && (
        <p className="mt-2 text-sm font-semibold text-warning" role="status">
          This variation moves the contract into a higher value tier, so the signing authority was worked out
          again.
        </p>
      )}
      {v.disclosure && (
        <p
          className="mt-2 rounded-md border border-warning bg-warning-bg p-2 text-sm text-warning"
          data-testid="disclosure-note"
        >
          The change is over the public register threshold. Disclosure on {v.disclosure.register} is due{' '}
          {v.disclosure.dueOn} ({v.disclosure.status === 'DONE' ? 'done' : 'open'}).
        </p>
      )}
    </Card>
  );
}
