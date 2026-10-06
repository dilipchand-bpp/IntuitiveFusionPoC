'use client';
import { useState } from 'react';
import { Badge, Button, Card, Checkbox, EmptyState, Field, Input, Table, Td, Th } from '@if/ui';
import { aud, formatDateTime } from '@/lib/labels';
import { Bar, has, send, useData, useRun } from './b5-shared';
import { InvoicePayments, usePayments } from '../b10/payments';

// ------------------------------------------------------------------ blocked invoices and payment (FR-0500)
interface InvoiceRow {
  id: string;
  contractId: string;
  contractNumber: string | null;
  number: string;
  invoiceDate: string;
  amount: number;
  status: 'MATCHED' | 'BLOCKED' | 'EXCEPTION' | 'PAID';
  findings: Array<{ code: string; severity: string; message: string }>;
  poNumber: string | null;
  workOrderNumber: string | null;
  overrideReason: string | null;
  paidAmount: number;
}
const TONE = { MATCHED: 'success', BLOCKED: 'error', EXCEPTION: 'warning', PAID: 'info' } as const;
const LABEL = {
  MATCHED: 'Matched',
  BLOCKED: 'Blocked',
  EXCEPTION: 'Released as exception',
  PAID: 'Paid',
} as const;

export function InvoiceQueue({ csrf, roles }: { csrf: string; roles: string[] }) {
  const [status, setStatus] = useState('');
  const { data, error, reload } = useData<InvoiceRow[]>(`/invoices${status ? `?status=${status}` : ''}`);
  const [reason, setReason] = useState<Record<string, string>>({});
  const r = useRun();
  const canRelease = has(roles, 'FINANCE', 'EXEC');
  const canPay = has(roles, 'FINANCE');
  const pays = usePayments();
  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Filter invoices" className="flex flex-wrap gap-2">
        {[
          ['', 'All'],
          ['BLOCKED', 'Blocked'],
          ['MATCHED', 'Matched'],
          ['EXCEPTION', 'Exceptions'],
          ['PAID', 'Paid'],
        ].map(([k, l]) => (
          <button
            key={k}
            type="button"
            aria-pressed={status === k}
            onClick={() => setStatus(k!)}
            className={`min-h-[44px] rounded-full border px-4 text-sm font-semibold ${status === k ? 'border-accent bg-accent/10 text-accent' : 'border-border-strong text-text'}`}
          >
            {l}
          </button>
        ))}
      </nav>
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      {data && data.length === 0 && (
        <EmptyState
          title="No invoices"
          body="Invoices recorded against contracts appear here with the result of the match."
        />
      )}
      <ul className="flex flex-col gap-3" data-testid="invoice-queue">
        {(data ?? []).map((i) => (
          <li
            key={i.id}
            className="rounded-lg border border-border bg-surface p-4 shadow-sm"
            data-invoice-status={i.status}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs">{i.number}</span>
              <Badge tone={TONE[i.status]}>{LABEL[i.status]}</Badge>
              <a href={`/app/contracts/${i.contractId}`} className="text-sm">
                {i.contractNumber}
              </a>
              <span className="ml-auto text-sm">
                {i.invoiceDate} · {aud.format(i.amount)}
                {i.poNumber ? ` · ${i.poNumber}` : ''}
              </span>
            </div>
            {i.findings.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-sm text-text-muted">
                {i.findings.map((f, k) => (
                  <li key={k}>{f.message}</li>
                ))}
              </ul>
            )}
            {i.overrideReason && (
              <p className="mt-1 text-sm text-text-muted">Released because: {i.overrideReason}</p>
            )}
            {i.status === 'BLOCKED' && canRelease && (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <Field label={`Reason for releasing ${i.number}`}>
                  <Input
                    value={reason[i.id] ?? ''}
                    onChange={(e) => setReason({ ...reason, [i.id]: e.target.value })}
                    className="w-80"
                  />
                </Field>
                <Button
                  variant="secondary"
                  aria-label={`Release ${i.number}`}
                  disabled={(reason[i.id] ?? '').trim().length < 10}
                  loading={r.busy === i.id}
                  onClick={() =>
                    void r.run(
                      i.id,
                      async () => {
                        await send(csrf, 'POST', `/invoices/${i.id}/override`, { reason: reason[i.id] });
                        await reload();
                      },
                      'Invoice released as a recorded exception.',
                    )
                  }
                >
                  Release as exception
                </Button>
              </div>
            )}
            <InvoicePayments
              invoice={{
                id: i.id,
                number: i.number,
                amount: i.amount,
                status: i.status,
                paidAmount: i.paidAmount,
              }}
              csrf={csrf}
              roles={roles}
              data={pays.data}
              reload={pays.reload}
              onPaid={reload}
            />
            {(i.status === 'MATCHED' || i.status === 'EXCEPTION') && canPay && (
              <div className="mt-3">
                <Button
                  aria-label={`Record payment of ${i.number}`}
                  variant="secondary"
                  loading={r.busy === `pay-${i.id}`}
                  onClick={() =>
                    void r.run(
                      `pay-${i.id}`,
                      async () => {
                        await send(csrf, 'POST', `/invoices/${i.id}/pay`);
                        await reload();
                      },
                      'Payment recorded.',
                    )
                  }
                >
                  Record payment made outside the run
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {r.messages}
    </div>
  );
}

// ------------------------------------------------------------------ public register disclosure (FR-0545)
interface Task {
  id: string;
  contractId: string;
  contractNumber: string;
  parentNumber: string | null;
  register: string;
  variancePct: number;
  dueOn: string;
  status: 'OPEN' | 'DONE';
  reference: string | null;
  overdue: boolean;
}
export function DisclosureTasks({ csrf, roles }: { csrf: string; roles: string[] }) {
  const { data, error, reload } = useData<Task[]>('/disclosure-tasks');
  const [ref, setRef] = useState<Record<string, string>>({});
  const r = useRun();
  const canDo = has(roles, 'PROCUREMENT', 'LEGAL');
  if (error)
    return (
      <p role="alert" className="text-sm text-error">
        {error}
      </p>
    );
  if (!data) return <p className="text-sm text-text-muted">Loading…</p>;
  if (data.length === 0)
    return (
      <EmptyState
        title="Nothing to disclose"
        body="A task appears when a contract changes by more than the threshold set in Settings."
      />
    );
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3" data-testid="disclosure-tasks">
        {data.map((t) => (
          <li key={t.id} className="rounded-lg border border-border bg-surface p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <a href={`/app/contracts/${t.contractId}`} className="font-semibold">
                {t.contractNumber}
              </a>
              <Badge tone={t.status === 'DONE' ? 'success' : t.overdue ? 'error' : 'warning'}>
                {t.status === 'DONE' ? 'Disclosed' : t.overdue ? 'Overdue' : 'To do'}
              </Badge>
              <span className="ml-auto text-sm text-text-muted">Due {t.dueOn}</span>
            </div>
            <p className="mt-1 text-sm">
              This change is {t.variancePct}% of the contract, over the threshold: record it on {t.register}.
              {t.reference && ` Reference ${t.reference}.`}
            </p>
            {t.status === 'OPEN' && canDo && (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <Field label={`Register reference for ${t.contractNumber}`}>
                  <Input
                    value={ref[t.id] ?? ''}
                    onChange={(e) => setRef({ ...ref, [t.id]: e.target.value })}
                    className="w-72"
                  />
                </Field>
                <Button
                  aria-label={`Record disclosure for ${t.contractNumber}`}
                  disabled={(ref[t.id] ?? '').trim().length < 3}
                  loading={r.busy === t.id}
                  onClick={() =>
                    void r.run(
                      t.id,
                      async () => {
                        await send(csrf, 'POST', `/disclosure-tasks/${t.id}/complete`, {
                          reference: ref[t.id],
                        });
                        await reload();
                      },
                      'Disclosure recorded.',
                    )
                  }
                >
                  Record disclosure
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {r.messages}
    </div>
  );
}

// ------------------------------------------------------------------ alert preferences (FR-0510)
interface Prefs {
  muted: string[];
  mutable: string[];
  fixed: string[];
}
interface Rules {
  fixed: Array<{ kind: string; title: string; rule: string }>;
  note: string;
}
const MUTABLE_LABEL: Record<string, string> = {
  NOTICE: 'Notice deadline approaching',
  EXPIRY: 'Contract expiry',
  MILESTONE: 'Milestones',
  EXTENSION: 'Extension decision',
  CUSTOM: 'Reminders I set myself',
  CLAUSE: 'Dates from the contract wording',
};
export function AlertPreferences({ csrf }: { csrf: string }) {
  const prefs = useData<Prefs>('/me/alert-preferences');
  const rules = useData<Rules>('/alerts/rules');
  const r = useRun();
  const [local, setLocal] = useState<string[] | null>(null);
  if (!prefs.data || !rules.data) return null;
  const muted = local ?? prefs.data.muted;
  const save = (next: string[]) => {
    setLocal(next); // shown at once; the save follows
    return r.run(
      'prefs',
      async () => {
        await send(csrf, 'PUT', '/me/alert-preferences', { muted: next });
        await prefs.reload();
      },
      'Your choices are saved.',
    );
  };
  return (
    <section aria-labelledby="pref-h" className="grid gap-4 md:grid-cols-2" data-testid="alert-preferences">
      <Card>
        <h2 id="pref-h" className="font-heading text-xl font-bold">
          Your alerts
        </h2>
        <p className="mt-1 text-sm text-text-muted">Choose which kinds of reminder you receive.</p>
        <fieldset className="mt-3 flex flex-col">
          <legend className="sr-only">Alerts you receive</legend>
          {prefs.data.mutable.map((k) => (
            <Checkbox
              key={k}
              label={MUTABLE_LABEL[k] ?? k}
              checked={!muted.includes(k)}
              onChange={(e) => void save(e.target.checked ? muted.filter((x) => x !== k) : [...muted, k])}
            />
          ))}
        </fieldset>
        {r.messages}
      </Card>
      <Card>
        <h2 className="font-heading text-xl font-bold">Fixed alerts</h2>
        <ul className="mt-2 flex flex-col gap-2 text-sm" data-testid="fixed-alerts">
          {rules.data.fixed.map((f) => (
            <li key={f.kind}>
              <strong>{f.title}:</strong> {f.rule}.
            </li>
          ))}
        </ul>
        <p className="mt-2 text-sm text-text-muted">{rules.data.note}</p>
      </Card>
    </section>
  );
}

// ------------------------------------------------------------------ funding envelopes (FR-0585)
interface Envelope {
  id: string;
  name: string;
  amount: number;
  committed: number;
  remaining: number;
  usedPct: number;
  warnPct: number;
  nearing: boolean;
  exhausted: boolean;
  holder: { id: string; name: string };
  nominees: Array<{ id: string; name: string }>;
  commitments: Array<{
    id: string;
    description: string;
    amount: number;
    contractNumber: string | null;
    approvedBy: string;
    createdAt: string;
  }>;
  canCommit: boolean;
  canTopUp: boolean;
  mine: 'HOLDER' | 'NOMINEE' | null;
}
interface Candidate {
  id: string;
  name: string;
  roles: string[];
}

export function Envelopes({ csrf, roles }: { csrf: string; roles: string[] }) {
  const list = useData<Envelope[]>('/envelopes');
  const canCreate = has(roles, 'DELEGATE', 'EXEC');
  const cand = useData<Candidate[]>(canCreate ? '/envelopes/candidates' : null);
  const [f, setF] = useState({ name: '', amount: '', warnPct: '80' });
  const [nominees, setNominees] = useState<string[]>([]);
  const [commit, setCommit] = useState<Record<string, { description: string; amount: string }>>({});
  const [top, setTop] = useState<Record<string, string>>({});
  const r = useRun();
  const [warning, setWarning] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-6">
      {list.error && (
        <p role="alert" className="text-sm text-error">
          {list.error}
        </p>
      )}
      {list.data && list.data.length === 0 && (
        <EmptyState
          title="No funding envelopes"
          body={
            canCreate
              ? 'Approve an envelope below, and nominate who can commit against it.'
              : 'You have not been nominated to approve commitments from an envelope.'
          }
        />
      )}
      {warning && (
        <p
          role="status"
          className="rounded-md border-2 border-warning bg-warning-bg p-3 text-sm font-semibold text-warning"
          data-testid="envelope-warning"
        >
          {warning}
        </p>
      )}
      <ul className="flex flex-col gap-4" data-testid="envelopes">
        {(list.data ?? []).map((e) => (
          <li key={e.id}>
            <Card data-testid={`envelope-${e.name}`}>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-heading text-lg font-bold">{e.name}</h2>
                {e.exhausted ? (
                  <Badge tone="error">Fully committed</Badge>
                ) : e.nearing ? (
                  <Badge tone="warning">Seek further approval</Badge>
                ) : (
                  <Badge tone="success">Available</Badge>
                )}
                <span className="ml-auto text-sm text-text-muted">Held by {e.holder.name}</span>
              </div>
              <div className="mt-3">
                <Bar
                  label={`${aud.format(e.committed)} committed of ${aud.format(e.amount)}`}
                  pct={e.usedPct}
                />
                <p className="mt-1 text-sm text-text-muted">
                  {aud.format(Math.max(0, e.remaining))} left. The holder is told at {e.warnPct}%.
                  {e.nominees.length > 0 && ` Nominated: ${e.nominees.map((n) => n.name).join(', ')}.`}
                </p>
              </div>
              {e.commitments.length > 0 && (
                <Table caption={`Commitments from ${e.name}`} className="mt-3">
                  <thead>
                    <tr>
                      <Th>When</Th>
                      <Th>Commitment</Th>
                      <Th>Contract</Th>
                      <Th>Approved by</Th>
                      <Th className="text-right">Amount</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {e.commitments.map((c) => (
                      <tr key={c.id}>
                        <Td label="When" className="whitespace-nowrap">
                          {formatDateTime(c.createdAt)}
                        </Td>
                        <Td label="Commitment">{c.description}</Td>
                        <Td label="Contract">{c.contractNumber ?? '–'}</Td>
                        <Td label="Approved by">{c.approvedBy}</Td>
                        <Td label="Amount" className="text-right">
                          {aud.format(c.amount)}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
              {e.canCommit && (
                <form
                  aria-label={`Approve a commitment from ${e.name}`}
                  className="mt-3 flex flex-wrap items-end gap-2"
                  onSubmit={(ev) => {
                    ev.preventDefault();
                    const v = commit[e.id] ?? { description: '', amount: '' };
                    void r.run(
                      `c-${e.id}`,
                      async () => {
                        const out = await send<{ warning: string | null }>(
                          csrf,
                          'POST',
                          `/envelopes/${e.id}/commitments`,
                          { description: v.description, amount: Number(v.amount) },
                        );
                        setWarning(out.warning);
                        setCommit({ ...commit, [e.id]: { description: '', amount: '' } });
                        await list.reload();
                      },
                      'Commitment approved.',
                    );
                  }}
                >
                  <Field label={`Commitment for ${e.name}`}>
                    <Input
                      value={commit[e.id]?.description ?? ''}
                      onChange={(ev) =>
                        setCommit({
                          ...commit,
                          [e.id]: { description: ev.target.value, amount: commit[e.id]?.amount ?? '' },
                        })
                      }
                      className="w-72"
                    />
                  </Field>
                  <Field label={`Amount for ${e.name}`}>
                    <Input
                      type="number"
                      min={0}
                      step="any"
                      value={commit[e.id]?.amount ?? ''}
                      onChange={(ev) =>
                        setCommit({
                          ...commit,
                          [e.id]: { description: commit[e.id]?.description ?? '', amount: ev.target.value },
                        })
                      }
                      className="w-36"
                    />
                  </Field>
                  <Button
                    type="submit"
                    loading={r.busy === `c-${e.id}`}
                    disabled={(commit[e.id]?.description ?? '').trim().length < 3 || !commit[e.id]?.amount}
                  >
                    Approve commitment
                  </Button>
                </form>
              )}
              {e.canTopUp && (
                <form
                  aria-label={`Add to ${e.name}`}
                  className="mt-3 flex flex-wrap items-end gap-2"
                  onSubmit={(ev) => {
                    ev.preventDefault();
                    void r.run(
                      `t-${e.id}`,
                      async () => {
                        await send(csrf, 'POST', `/envelopes/${e.id}/top-up`, { amount: Number(top[e.id]) });
                        setTop({ ...top, [e.id]: '' });
                        await list.reload();
                      },
                      'The envelope was increased.',
                    );
                  }}
                >
                  <Field label={`Add to ${e.name} (AUD)`}>
                    <Input
                      type="number"
                      min={0}
                      step="any"
                      value={top[e.id] ?? ''}
                      onChange={(ev) => setTop({ ...top, [e.id]: ev.target.value })}
                      className="w-40"
                    />
                  </Field>
                  <Button
                    type="submit"
                    variant="secondary"
                    loading={r.busy === `t-${e.id}`}
                    disabled={!top[e.id]}
                  >
                    Add funds
                  </Button>
                </form>
              )}
            </Card>
          </li>
        ))}
      </ul>
      {canCreate && (
        <Card aria-labelledby="new-env-h" role="region">
          <h2 id="new-env-h" className="font-heading text-xl font-bold">
            Approve a funding envelope
          </h2>
          <p className="mt-1 max-w-prose text-sm text-text-muted">
            You approve the allocation once, within your delegated authority. The people you nominate then
            approve individual commitments against it, and you are told as it nears exhaustion.
          </p>
          <form
            aria-label="Approve a funding envelope"
            className="mt-3 flex flex-col gap-3"
            onSubmit={(ev) => {
              ev.preventDefault();
              void r.run(
                'new',
                async () => {
                  await send(csrf, 'POST', '/envelopes', {
                    name: f.name,
                    amount: Number(f.amount),
                    nominees,
                    warnPct: Number(f.warnPct),
                  });
                  setF({ name: '', amount: '', warnPct: '80' });
                  setNominees([]);
                  await list.reload();
                },
                'Envelope approved.',
              );
            }}
          >
            <Field label="Envelope name">
              <Input
                value={f.name}
                onChange={(ev) => setF({ ...f, name: ev.target.value })}
                maxLength={160}
              />
            </Field>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Amount (AUD)">
                <Input
                  type="number"
                  min={0}
                  value={f.amount}
                  onChange={(ev) => setF({ ...f, amount: ev.target.value })}
                  className="w-44"
                />
              </Field>
              <Field label="Warn me at (% committed)">
                <Input
                  type="number"
                  min={1}
                  max={99}
                  value={f.warnPct}
                  onChange={(ev) => setF({ ...f, warnPct: ev.target.value })}
                  className="w-28"
                />
              </Field>
            </div>
            <fieldset>
              <legend className="text-sm font-semibold">People who can approve commitments</legend>
              <div className="mt-1 flex flex-wrap gap-x-5">
                {(cand.data ?? []).map((p) => (
                  <Checkbox
                    key={p.id}
                    label={p.name}
                    checked={nominees.includes(p.id)}
                    onChange={(ev) =>
                      setNominees(
                        ev.target.checked ? [...nominees, p.id] : nominees.filter((x) => x !== p.id),
                      )
                    }
                  />
                ))}
              </div>
            </fieldset>
            <div>
              <Button
                type="submit"
                loading={r.busy === 'new'}
                disabled={f.name.trim().length < 3 || !f.amount}
              >
                Approve envelope
              </Button>
            </div>
          </form>
        </Card>
      )}
      {r.messages}
    </div>
  );
}
