'use client';
import { useState } from 'react';
import { Badge, Button, Card, EmptyState, Field, Input, KpiCard, Select, Textarea } from '@if/ui';
import { has, send, useData, useRun } from '@/components/contract/b5-shared';

const KINDS = ['RISK', 'AUDIT_FINDING', 'OBLIGATION'] as const;
const STATUSES = ['OPEN', 'IN_PROGRESS', 'MITIGATED', 'ACCEPTED', 'CLOSED'] as const;
const KIND_TEXT: Record<string, string> = {
  RISK: 'Risk',
  AUDIT_FINDING: 'Audit finding',
  OBLIGATION: 'Obligation',
};
const STATUS_TEXT: Record<string, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  MITIGATED: 'Mitigated',
  ACCEPTED: 'Accepted',
  CLOSED: 'Closed',
};
const BAND_TONE = { HIGH: 'error', MEDIUM: 'warning', LOW: 'success' } as const;
const LEVEL = ['1', '2', '3', '4', '5'];

interface Action {
  id: string;
  text: string;
  ownerId: string | null;
  dueOn: string | null;
  doneAt: string | null;
}
interface Item {
  id: string;
  kind: string;
  title: string;
  description: string | null;
  owner: { id: string; name: string } | null;
  likelihood: number | null;
  impact: number | null;
  rating: number | null;
  band: 'HIGH' | 'MEDIUM' | 'LOW' | null;
  status: string;
  dueOn: string | null;
  reviewOn: string | null;
  overdue: boolean;
  reviewDue: boolean;
  source: string;
  treatment: string | null;
  actions: Action[];
}
interface Summary {
  open: number;
  byKind: Array<{ kind: string; open: number }>;
  high: number;
  overdue: number;
  reviewsDue: number;
  heatmap: { rows: number[]; columns: number[]; cells: number[][] };
}

const cellTone = (l: number, i: number) =>
  l * i >= 15
    ? 'bg-error-bg text-error'
    : l * i >= 8
      ? 'bg-warning-bg text-warning'
      : 'bg-success-bg text-success';

export function RiskRegister({ csrf, roles }: { csrf: string; roles: readonly string[] }) {
  const canWrite = has(roles, 'PROBITY', 'EXEC', 'LEGAL', 'PROCUREMENT', 'FINANCE');
  const canSync = has(roles, 'PROBITY', 'EXEC');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const qs = new URLSearchParams();
  if (kind) qs.set('kind', kind);
  if (status) qs.set('status', status);
  const items = useData<Item[]>(`/grc/items${qs.size ? `?${qs}` : ''}`);
  const summary = useData<Summary>('/grc/summary');
  const r = useRun();
  const [synced, setSynced] = useState<string | null>(null);
  const refresh = async () => {
    await Promise.all([items.reload(), summary.reload()]);
  };

  return (
    <div className="flex flex-col gap-6">
      {summary.error && (
        <p role="alert" className="text-sm text-error">
          {summary.error}
        </p>
      )}
      {summary.data && <Overview s={summary.data} />}

      {canSync && (
        <div>
          <Button
            type="button"
            variant="secondary"
            loading={r.busy === 'sync'}
            disabled={r.busy !== null}
            onClick={() =>
              void r.run('sync', async () => {
                const out = await send<{
                  created: number;
                  reopened: number;
                  closed: number;
                  signals: number;
                }>(csrf, 'POST', '/grc/sync');
                setSynced(
                  `${out.created} added, ${out.reopened} reopened, ${out.closed} closed (${out.signals} platform signals now).`,
                );
                await refresh();
              })
            }
          >
            Pull in platform risks
          </Button>
          <p className="mt-1 text-xs text-text-muted">
            Adds lapsed insurance, sanctions matches, overdue disclosures, holds and long-blocked invoices
            once each, and closes what is no longer true.
          </p>
          {synced && (
            <p role="status" className="mt-2 text-sm font-medium text-success">
              {synced}
            </p>
          )}
          {r.messages}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Filter the register">
        <Field label="Kind">
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All kinds</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_TEXT[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_TEXT[s]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {items.error && (
        <p role="alert" className="text-sm text-error">
          {items.error}
        </p>
      )}
      {!items.data && !items.error && <p className="text-sm text-text-muted">Loading…</p>}
      {items.data && items.data.length === 0 && (
        <EmptyState title="Nothing on the register" body="No items match these filters." />
      )}
      {items.data && items.data.length > 0 && (
        <ul className="flex flex-col gap-3" aria-label="Register items">
          {items.data.map((it) => (
            <ItemRow key={it.id} it={it} csrf={csrf} canWrite={canWrite} onChange={refresh} />
          ))}
        </ul>
      )}

      {canWrite ? (
        <CreateForm csrf={csrf} onChange={refresh} />
      ) : (
        <p className="text-sm text-text-muted">
          You can read the register. Adding and changing items is limited to probity, executive, legal,
          procurement and finance.
        </p>
      )}
    </div>
  );
}

function Overview({ s }: { s: Summary }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Open items" value={s.open} />
        <KpiCard label="High rated" value={s.high} />
        <KpiCard label="Overdue" value={s.overdue} />
        <KpiCard label="Reviews due" value={s.reviewsDue} />
      </div>
      <p className="text-sm text-text-muted">
        Open by kind: {s.byKind.map((k) => `${KIND_TEXT[k.kind] ?? k.kind} ${k.open}`).join(', ')}.
      </p>
      <Card>
        <h2 className="text-lg font-bold">Heat map of open risks</h2>
        <p className="text-sm text-text-muted">
          Likelihood (rows) against impact (columns). Each cell counts open risks.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="border-collapse text-center text-sm" data-testid="heatmap">
            <caption className="sr-only">Number of open risks by likelihood and impact</caption>
            <thead>
              <tr>
                <th scope="col" className="p-2 text-xs text-text-muted">
                  Likelihood \ Impact
                </th>
                {s.heatmap.columns.map((c) => (
                  <th key={c} scope="col" className="p-2 text-xs text-text-muted">
                    Impact {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.heatmap.rows.map((l, ri) => (
                <tr key={l}>
                  <th scope="row" className="p-2 text-left text-xs text-text-muted">
                    Likelihood {l}
                  </th>
                  {s.heatmap.columns.map((c, ci) => {
                    const n = s.heatmap.cells[ri]?.[ci] ?? 0;
                    return (
                      <td
                        key={c}
                        className={`size-14 min-w-14 border border-surface text-base font-bold ${cellTone(l, c)}`}
                        aria-label={`Likelihood ${l}, impact ${c}: ${n} open risk${n === 1 ? '' : 's'}`}
                      >
                        {n}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-text-muted">
          Rating is likelihood times impact: 15 or more is high, 8 to 14 medium, below 8 low.
        </p>
      </Card>
    </div>
  );
}

function ItemRow({
  it,
  csrf,
  canWrite,
  onChange,
}: {
  it: Item;
  csrf: string;
  canWrite: boolean;
  onChange: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(it.status);
  const [treatment, setTreatment] = useState(it.treatment ?? '');
  const [act, setAct] = useState('');
  const [actDue, setActDue] = useState('');
  const r = useRun();
  return (
    <li className="rounded-lg border border-border bg-surface p-4" data-testid="grc-item">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold">{it.title}</p>
          <p className="text-sm text-text-muted">
            {KIND_TEXT[it.kind] ?? it.kind} · {STATUS_TEXT[it.status] ?? it.status} · Owner{' '}
            {it.owner?.name ?? 'none'}
            {it.source === 'PLATFORM' && ' · From the platform'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {it.band && (
            <Badge tone={BAND_TONE[it.band]}>
              {it.band === 'HIGH' ? 'High' : it.band === 'MEDIUM' ? 'Medium' : 'Low'} ({it.rating})
            </Badge>
          )}
          {it.overdue && <Badge tone="error">Overdue {it.dueOn}</Badge>}
          {!it.overdue && it.dueOn && <Badge tone="neutral">Due {it.dueOn}</Badge>}
          {it.reviewDue && <Badge tone="warning">Review due {it.reviewOn}</Badge>}
        </div>
      </div>
      {it.description && <p className="mt-2 text-sm">{it.description}</p>}
      {it.treatment && <p className="mt-1 text-sm text-text-muted">Treatment: {it.treatment}</p>}
      <button
        type="button"
        className="mt-2 min-h-[44px] text-sm font-semibold text-accent underline focus-visible:outline-2 focus-visible:outline-ring"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? 'Hide' : 'Show'} actions
        {it.actions.length
          ? ` (${it.actions.filter((a) => !a.doneAt).length} open of ${it.actions.length})`
          : ''}
        {canWrite ? ' and edit' : ''}
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-4 border-t border-border pt-3">
          {it.actions.length === 0 ? (
            <p className="text-sm text-text-muted">No actions yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {it.actions.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className={a.doneAt ? 'text-text-muted line-through' : ''}>
                    {a.text}
                    {a.dueOn ? ` (due ${a.dueOn})` : ''}
                  </span>
                  {a.doneAt ? (
                    <Badge tone="success">Done</Badge>
                  ) : (
                    canWrite && (
                      <Button
                        type="button"
                        size="md"
                        variant="secondary"
                        aria-label={`Complete action: ${a.text}`}
                        disabled={r.busy !== null}
                        onClick={() =>
                          void r.run(
                            `c-${a.id}`,
                            async () => {
                              await send(csrf, 'POST', `/grc/items/${it.id}/actions/${a.id}/complete`);
                              await onChange();
                            },
                            'Action completed.',
                          )
                        }
                      >
                        Complete
                      </Button>
                    )
                  )}
                </li>
              ))}
            </ul>
          )}
          {canWrite && (
            <>
              <form
                className="grid items-end gap-3 sm:grid-cols-[1fr_11rem_auto]"
                aria-label={`Add an action to ${it.title}`}
                onSubmit={(e) => {
                  e.preventDefault();
                  void r.run(
                    'add',
                    async () => {
                      await send(csrf, 'POST', `/grc/items/${it.id}/actions`, {
                        text: act.trim(),
                        ...(actDue ? { dueOn: actDue } : {}),
                      });
                      setAct('');
                      setActDue('');
                      await onChange();
                    },
                    'Action added.',
                  );
                }}
              >
                <Field label="New action">
                  <Input value={act} onChange={(e) => setAct(e.target.value)} maxLength={500} />
                </Field>
                <Field label="Due date">
                  <Input type="date" value={actDue} onChange={(e) => setActDue(e.target.value)} />
                </Field>
                <Button type="submit" variant="secondary" disabled={act.trim().length < 3 || r.busy !== null}>
                  Add action
                </Button>
              </form>
              <form
                className="grid gap-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end"
                aria-label={`Change status of ${it.title}`}
                onSubmit={(e) => {
                  e.preventDefault();
                  void r.run(
                    'upd',
                    async () => {
                      await send(csrf, 'PATCH', `/grc/items/${it.id}`, {
                        status,
                        treatment: treatment.trim() || null,
                      });
                      await onChange();
                    },
                    'Saved.',
                  );
                }}
              >
                <Field label="Status">
                  <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_TEXT[s]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label="Treatment"
                  hint="Accepting an item needs the reason here (10 characters or more)."
                >
                  <Textarea
                    rows={2}
                    value={treatment}
                    onChange={(e) => setTreatment(e.target.value)}
                    maxLength={2000}
                  />
                </Field>
                <Button type="submit" loading={r.busy === 'upd'} disabled={r.busy !== null}>
                  Save
                </Button>
              </form>
            </>
          )}
          {r.messages}
        </div>
      )}
    </li>
  );
}

function CreateForm({ csrf, onChange }: { csrf: string; onChange: () => Promise<void> }) {
  const blank = {
    kind: 'RISK',
    title: '',
    description: '',
    likelihood: '3',
    impact: '3',
    dueOn: '',
    reviewOn: '',
    treatment: '',
  };
  const [f, setF] = useState(blank);
  const r = useRun();
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  const isRisk = f.kind === 'RISK';
  return (
    <Card>
      <h2 className="text-lg font-bold">Add to the register</h2>
      <form
        className="mt-3 grid gap-3 sm:grid-cols-2"
        aria-label="Add to the register"
        onSubmit={(e) => {
          e.preventDefault();
          void r.run(
            'create',
            async () => {
              await send(csrf, 'POST', '/grc/items', {
                kind: f.kind,
                title: f.title.trim(),
                ...(f.description.trim() ? { description: f.description.trim() } : {}),
                ...(isRisk ? { likelihood: Number(f.likelihood), impact: Number(f.impact) } : {}),
                ...(f.dueOn ? { dueOn: f.dueOn } : {}),
                ...(f.reviewOn ? { reviewOn: f.reviewOn } : {}),
                ...(f.treatment.trim() ? { treatment: f.treatment.trim() } : {}),
              });
              setF(blank);
              await onChange();
            },
            'Added to the register. You are its owner.',
          );
        }}
      >
        <Field label="Kind" required>
          <Select value={f.kind} onChange={set('kind')}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_TEXT[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Title" required>
          <Input value={f.title} onChange={set('title')} maxLength={200} />
        </Field>
        {isRisk && (
          <>
            <Field label="Likelihood (1 rare to 5 almost certain)" required>
              <Select value={f.likelihood} onChange={set('likelihood')}>
                {LEVEL.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </Select>
            </Field>
            <Field label="Impact (1 minor to 5 severe)" required>
              <Select value={f.impact} onChange={set('impact')}>
                {LEVEL.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </Select>
            </Field>
          </>
        )}
        <Field label="Due date">
          <Input type="date" value={f.dueOn} onChange={set('dueOn')} />
        </Field>
        <Field label="Review date">
          <Input type="date" value={f.reviewOn} onChange={set('reviewOn')} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Description">
            <Textarea rows={3} value={f.description} onChange={set('description')} maxLength={4000} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Treatment or plan">
            <Textarea rows={2} value={f.treatment} onChange={set('treatment')} maxLength={2000} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Button
            type="submit"
            loading={r.busy === 'create'}
            disabled={f.title.trim().length < 3 || r.busy !== null}
          >
            Add to the register
          </Button>
          <p className="mt-1 text-xs text-text-muted">
            You become the owner; an owner can be changed later by the API.
          </p>
          {r.messages}
        </div>
      </form>
    </Card>
  );
}
