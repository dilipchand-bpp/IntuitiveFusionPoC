'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge, Button, Card, Field, Input, Select } from '@if/ui';
import { ApiError, api } from '@/lib/api-client';
import { SourceChip, type PopulationSource } from '../b11/source-chip';
import type { RequestView } from './types';

export interface ExtrasData {
  suppliers: Array<{
    id: string;
    company: string;
    sanctionsStatus: string;
    insuranceStatus: string;
    contacts: Array<{ name: string; email: string }>;
    selected: boolean;
  }>;
  ecv: {
    baseTermValue: number;
    extensionsValue: number;
    freight: number;
    implementation: number;
    exchangeRate: number;
    taxPct: number;
    subtotal: number;
    tax: number;
    ecv: number;
    applied: boolean;
  };
  artefacts: Array<{
    kind: string;
    label: string;
    status: string;
    link: string;
    carriedFromIntake: string[];
    detail?: string;
  }>;
  delegates: Array<{
    stage: string;
    label: string;
    value: number;
    delegate: { id: string; name: string } | null;
    limit: number | null;
    basis: 'AUTO' | 'REDIRECTED';
    candidates: Array<{ id: string; name: string }>;
    signedBy?: { name: string; at: string };
  }>;
  variations: Array<{
    id: string;
    action: 'ADD' | 'REMOVE';
    label?: string;
    key?: string;
    reason: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    decidedByName?: string;
  }>;
}
export interface ExtendedView extends RequestView {
  taxonomy?: { scheme: string; code: string; confirmed: boolean; source?: PopulationSource };
  workflow?: {
    id: string;
    name: string;
    subWorkflow: string;
    steps: Array<{
      key: string;
      label: string;
      mandatory: boolean;
      state: 'DONE' | 'CURRENT' | 'UPCOMING';
      variation?: 'ADDED';
    }>;
  };
  engagements: Array<{ function: string; label: string; reason: string }>;
}

const aud = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const message = (e: unknown) =>
  e instanceof ApiError
    ? [e.message, ...(e.problem.errors ?? []).map((x) => x.message)]
        .filter((x, i, a) => a.indexOf(x) === i)
        .join(' ')
    : 'Something went wrong. Please try again.';

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  async function run(fn: () => Promise<string | void>) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const n = await fn();
      if (n) setNote(n);
      router.refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, note, run };
}
const Msg = ({ error, note }: { error: string | null; note: string | null }) => (
  <>
    {error && (
      <p role="alert" className="text-sm font-medium text-error">
        {error}
      </p>
    )}
    {note && (
      <p role="status" className="text-sm font-medium text-success">
        {note}
      </p>
    )}
  </>
);

const STEP_TONE = { DONE: 'success', CURRENT: 'info', UPCOMING: 'neutral' } as const;
const STEP_TEXT = { DONE: 'Done', CURRENT: 'Now', UPCOMING: 'Ahead' } as const;

/** Where the request stands on its workflow, and changes to the steps for this procurement only (FR-0705, FR-0730). */
function ProcessCard({
  view,
  data,
  csrf,
  canEdit,
  isDelegate,
}: {
  view: ExtendedView;
  data: ExtrasData;
  csrf: string;
  canEdit: boolean;
  isDelegate: boolean;
}) {
  const { busy, error, note, run } = useAction();
  const [label, setLabel] = useState('');
  const [reason, setReason] = useState('');
  const wf = view.workflow;
  if (!wf) return null;
  const pending = data.variations.find((v) => v.status === 'PENDING');
  return (
    <Card role="region" aria-labelledby="process-h" data-testid="process-card">
      <h2 id="process-h" className="font-heading text-lg font-bold">
        Process
      </h2>
      <p className="text-sm text-text-muted">
        {wf.name}
        {wf.subWorkflow !== 'general' ? ` · ${wf.subWorkflow} procurement` : ''}
      </p>
      <ol className="mt-3 flex flex-col gap-1.5" aria-label="Workflow steps">
        {wf.steps.map((s) => (
          <li
            key={s.key}
            className="flex items-center justify-between gap-2 text-sm"
            data-step-state={s.state}
          >
            <span className={s.state === 'CURRENT' ? 'font-bold' : ''}>
              {s.label}
              {s.variation === 'ADDED' && (
                <span className="ml-2 text-xs text-text-muted">(added for this procurement)</span>
              )}
            </span>
            <Badge tone={STEP_TONE[s.state]}>{STEP_TEXT[s.state]}</Badge>
          </li>
        ))}
      </ol>
      {data.variations.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 text-sm" aria-label="Changes to the process">
          {data.variations.map((v) => (
            <li key={v.id} data-testid="variation">
              {v.action === 'ADD' ? `Add "${v.label}"` : `Remove "${v.key}"`}: {v.status.toLowerCase()}
              {v.decidedByName ? ` by ${v.decidedByName}` : ''}.{' '}
              <span className="text-text-muted">{v.reason}</span>
              {v.status === 'PENDING' && isDelegate && (
                <span className="ml-2 inline-flex gap-2">
                  <Button
                    variant="secondary"
                    loading={busy}
                    onClick={() =>
                      void run(async () => {
                        await api(`/requests/${view.id}/process-variations/${v.id}/decision`, {
                          method: 'POST',
                          csrf,
                          body: { decision: 'APPROVE' },
                        });
                        return 'The change was approved.';
                      })
                    }
                  >
                    Approve
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      void run(async () => {
                        await api(`/requests/${view.id}/process-variations/${v.id}/decision`, {
                          method: 'POST',
                          csrf,
                          body: { decision: 'REJECT' },
                        });
                        return 'The change was rejected.';
                      })
                    }
                  >
                    Reject
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && !pending && view.status !== 'COMPLETE' && (
        <div className="mt-4 flex flex-col gap-2 border-t border-border pt-3">
          <h3 className="text-sm font-semibold">Add a step for this procurement</h3>
          <p className="text-xs text-text-muted">
            A delegate must approve it. Mandatory steps cannot be removed.
          </p>
          <Field label="Step name">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <Field label="Why is it needed?" hint="At least 10 characters">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div>
            <Button
              variant="secondary"
              loading={busy}
              onClick={() =>
                void run(async () => {
                  await api(`/requests/${view.id}/process-variations`, {
                    method: 'POST',
                    csrf,
                    body: { action: 'ADD', label, reason },
                  });
                  setLabel('');
                  setReason('');
                  return 'Sent to a delegate for approval.';
                })
              }
            >
              Ask for approval
            </Button>
          </div>
        </div>
      )}
      <Msg error={error} note={note} />
    </Card>
  );
}

function ClassificationCard({ view, csrf, canEdit }: { view: ExtendedView; csrf: string; canEdit: boolean }) {
  const { busy, error, note, run } = useAction();
  const [code, setCode] = useState('');
  if (!view.taxonomy) return null;
  const t = view.taxonomy;
  return (
    <Card role="region" aria-labelledby="class-h" data-testid="classification-card">
      <h2 id="class-h" className="font-heading text-lg font-bold">
        Classification
      </h2>
      <p className="mt-1 text-sm">
        {t.scheme}{' '}
        <span className="font-mono font-semibold" data-testid="taxonomy-code">
          {t.code}
        </span>{' '}
        <Badge tone={t.confirmed ? 'success' : 'warning'}>
          {t.confirmed ? 'Confirmed' : 'Suggested, please confirm'}
        </Badge>
      </p>
      {t.source && (
        <p className="mt-1 text-sm" data-testid="taxonomy-source">
          <SourceChip source={t.source} />
        </p>
      )}
      {canEdit && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          {!t.confirmed && (
            <Button
              variant="secondary"
              loading={busy}
              onClick={() =>
                void run(async () => {
                  await api(`/requests/${view.id}/taxonomy`, {
                    method: 'POST',
                    csrf,
                    body: { confirm: true },
                  });
                  return 'Classification confirmed.';
                })
              }
            >
              Confirm this code
            </Button>
          )}
          <Field label="Or use your own code">
            <Input value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Button
            variant="ghost"
            disabled={!code.trim()}
            onClick={() =>
              void run(async () => {
                await api(`/requests/${view.id}/taxonomy`, {
                  method: 'POST',
                  csrf,
                  body: { confirm: true, code: code.trim() },
                });
                setCode('');
                return 'Your code was saved.';
              })
            }
          >
            Use my code
          </Button>
        </div>
      )}
      <Msg error={error} note={note} />
    </Card>
  );
}

function EngagementsCard({ view }: { view: ExtendedView }) {
  if (view.engagements.length === 0) return null;
  return (
    <Card role="region" aria-labelledby="eng-h" data-testid="engagements-card">
      <h2 id="eng-h" className="font-heading text-lg font-bold">
        Reviews this request needs
      </h2>
      <ul className="mt-2 flex flex-col gap-2 text-sm">
        {view.engagements.map((e) => (
          <li key={e.label}>
            <span className="font-semibold">{e.label}.</span>{' '}
            <span className="text-text-muted">{e.reason}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function SuppliersCard({
  view,
  data,
  csrf,
  canEdit,
}: {
  view: ExtendedView;
  data: ExtrasData;
  csrf: string;
  canEdit: boolean;
}) {
  const { busy, error, note, run } = useAction();
  const [chosen, setChosen] = useState(
    () => new Set(data.suppliers.filter((s) => s.selected).map((s) => s.id)),
  );
  if (data.suppliers.length === 0) return null;
  return (
    <Card role="region" aria-labelledby="sup-h" data-testid="suppliers-card">
      <h2 id="sup-h" className="font-heading text-lg font-bold">
        Suggested suppliers
      </h2>
      <p className="text-sm text-text-muted">
        From your supplier directory, for this category. You can change the list.
      </p>
      <ul className="mt-2 flex flex-col gap-2">
        {data.suppliers.map((s) => (
          <li key={s.id} className="text-sm">
            <label className="flex min-h-[44px] items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 size-5 accent-[var(--if-color-accent)]"
                checked={chosen.has(s.id)}
                disabled={!canEdit}
                onChange={(e) => {
                  const n = new Set(chosen);
                  if (e.target.checked) n.add(s.id);
                  else n.delete(s.id);
                  setChosen(n);
                }}
                aria-label={s.company}
              />
              <span>
                <span className="font-semibold">{s.company}</span>
                <span className="block text-xs text-text-muted">
                  Sanctions: {s.sanctionsStatus.toLowerCase()} · Insurance: {s.insuranceStatus.toLowerCase()}
                  {s.contacts.length > 0
                    ? ` · ${s.contacts.map((c) => `${c.name} (${c.email})`).join(', ')}`
                    : ''}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="mt-2">
          <Button
            variant="secondary"
            loading={busy}
            onClick={() =>
              void run(async () => {
                await api(`/requests/${view.id}/suggested-suppliers`, {
                  method: 'PUT',
                  csrf,
                  body: { supplierIds: [...chosen] },
                });
                return 'Your list was saved.';
              })
            }
          >
            Save the list
          </Button>
        </div>
      )}
      <Msg error={error} note={note} />
    </Card>
  );
}

function EcvCard({
  view,
  data,
  csrf,
  canEdit,
}: {
  view: ExtendedView;
  data: ExtrasData;
  csrf: string;
  canEdit: boolean;
}) {
  const { busy, error, note, run } = useAction();
  const [f, setF] = useState({
    baseTermValue: String(data.ecv.baseTermValue),
    extensionsValue: String(data.ecv.extensionsValue),
    freight: String(data.ecv.freight),
    implementation: String(data.ecv.implementation),
    exchangeRate: String(data.ecv.exchangeRate),
    taxPct: String(data.ecv.taxPct),
  });
  const [result, setResult] = useState<{ ecv: number; subtotal: number; tax: number } | null>(null);
  const body = (apply: boolean) => ({
    baseTermValue: Number(f.baseTermValue),
    extensionsValue: Number(f.extensionsValue),
    freight: Number(f.freight),
    implementation: Number(f.implementation),
    exchangeRate: Number(f.exchangeRate),
    taxPct: Number(f.taxPct),
    apply,
  });
  const field = (key: keyof typeof f, label: string) => (
    <Field key={key} label={label}>
      <Input
        type="number"
        min={0}
        step="any"
        value={f[key]}
        disabled={!canEdit}
        onChange={(e) => setF({ ...f, [key]: e.target.value })}
      />
    </Field>
  );
  return (
    <Card role="region" aria-labelledby="ecv-h" data-testid="ecv-card">
      <h2 id="ecv-h" className="font-heading text-lg font-bold">
        Estimated contract value
      </h2>
      <p className="text-sm text-text-muted">
        Every cost over the whole term. The result sets the request value, which decides the workflow and the
        approver.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {field('baseTermValue', 'Base term (AUD)')}
        {field('extensionsValue', 'Extensions (AUD)')}
        {field('freight', 'Freight (AUD)')}
        {field('implementation', 'Implementation (AUD)')}
        {field('exchangeRate', 'Exchange rate to AUD')}
        {field('taxPct', 'Tax (%)')}
      </div>
      {result && (
        <p className="mt-2 text-sm" data-testid="ecv-result" role="status">
          Subtotal {aud.format(result.subtotal)}, tax {aud.format(result.tax)},{' '}
          <strong>estimated value {aud.format(result.ecv)}</strong>
        </p>
      )}
      {canEdit && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            loading={busy}
            onClick={() =>
              void run(async () => {
                setResult(await api(`/requests/${view.id}/ecv`, { method: 'PUT', csrf, body: body(false) }));
              })
            }
          >
            Calculate
          </Button>
          <Button
            loading={busy}
            onClick={() =>
              void run(async () => {
                const r = await api<{ ecv: number; subtotal: number; tax: number }>(
                  `/requests/${view.id}/ecv`,
                  {
                    method: 'PUT',
                    csrf,
                    body: body(true),
                  },
                );
                setResult(r);
                return 'The request value was updated.';
              })
            }
          >
            Use as the request value
          </Button>
        </div>
      )}
      <Msg error={error} note={note} />
    </Card>
  );
}

function DelegatesCard({
  view,
  data,
  csrf,
  canRedirect,
}: {
  view: ExtendedView;
  data: ExtrasData;
  csrf: string;
  canRedirect: boolean;
}) {
  const { busy, error, note, run } = useAction();
  const [pick, setPick] = useState<Record<string, string>>({});
  return (
    <Card role="region" aria-labelledby="del-h" data-testid="delegates-card">
      <h2 id="del-h" className="font-heading text-lg font-bold">
        Who approves each stage
      </h2>
      <p className="text-sm text-text-muted">
        Set by value: the lowest authority that is enough. Approvals already given stay with the person who
        gave them.
      </p>
      <ul className="mt-2 flex flex-col gap-3">
        {data.delegates.map((d) => (
          <li key={d.stage} className="text-sm" data-stage={d.stage}>
            <span className="font-semibold">{d.label}:</span>{' '}
            {d.delegate ? (
              d.delegate.name
            ) : (
              <span className="text-warning">no one holds enough authority</span>
            )}
            {d.basis === 'REDIRECTED' && <Badge tone="info">Redirected</Badge>}
            {d.signedBy && (
              <span className="block text-xs text-text-muted">
                Signed by {d.signedBy.name} on {new Date(d.signedBy.at).toLocaleDateString('en-AU')}
              </span>
            )}
            {canRedirect && !d.signedBy && (
              <span className="mt-1 flex flex-wrap items-end gap-2">
                <Select
                  aria-label={`Redirect ${d.label}`}
                  value={pick[d.stage] ?? ''}
                  onChange={(e) => setPick({ ...pick, [d.stage]: e.target.value })}
                >
                  <option value="">Redirect to…</option>
                  {d.candidates.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
                <Button
                  variant="ghost"
                  disabled={!pick[d.stage]}
                  loading={busy}
                  onClick={() =>
                    void run(async () => {
                      await api(`/requests/${view.id}/delegates/${d.stage}`, {
                        method: 'PUT',
                        csrf,
                        body: { userId: pick[d.stage] },
                      });
                      return `${d.label} was redirected.`;
                    })
                  }
                >
                  Redirect
                </Button>
              </span>
            )}
          </li>
        ))}
      </ul>
      <Msg error={error} note={note} />
    </Card>
  );
}

function ArtefactsCard({ data }: { data: ExtrasData }) {
  return (
    <Card role="region" aria-labelledby="art-h" data-testid="artefacts-card">
      <h2 id="art-h" className="font-heading text-lg font-bold">
        Filled in from this request
      </h2>
      <p className="text-sm text-text-muted">What was created downstream, so nothing is typed twice.</p>
      <ul className="mt-2 flex flex-col gap-2 text-sm">
        {data.artefacts.map((a) => (
          <li key={a.kind}>
            <Link href={a.link} className="font-semibold">
              {a.label}
            </Link>{' '}
            <Badge tone="neutral">{a.status.replace(/_/g, ' ').toLowerCase()}</Badge>
            {a.detail && <span className="block text-xs text-text-muted">{a.detail}</span>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Custom fields an administrator added to every request (FR-0710): shown and, while a draft, editable here. */
function CustomFieldsCard({ view, csrf, canEdit }: { view: ExtendedView; csrf: string; canEdit: boolean }) {
  const custom = view.fields.filter((f) => (f as { custom?: boolean }).custom) as Array<
    ExtendedView['fields'][number] & { type?: 'TEXT' | 'FLAG' | 'NUMBER' }
  >;
  const { busy, error, note, run } = useAction();
  const [v, setV] = useState<Record<string, string>>(() =>
    Object.fromEntries(custom.map((f) => [f.key, f.value ?? ''])),
  );
  if (custom.length === 0) return null;
  const editable = canEdit && view.status === 'DRAFT';
  return (
    <Card role="region" aria-labelledby="cf-h" data-testid="custom-fields-card">
      <h2 id="cf-h" className="font-heading text-lg font-bold">
        Additional details
      </h2>
      <div className="mt-2 flex flex-col gap-3">
        {custom.map((f) => (
          <Field key={f.key} label={f.label} required={f.missing}>
            {f.type === 'FLAG' ? (
              <Select
                value={v[f.key] ?? ''}
                disabled={!editable}
                onChange={(e) => setV({ ...v, [f.key]: e.target.value })}
              >
                <option value="">Not set</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </Select>
            ) : (
              <Input
                type={f.type === 'NUMBER' ? 'number' : 'text'}
                value={v[f.key] ?? ''}
                disabled={!editable}
                onChange={(e) => setV({ ...v, [f.key]: e.target.value })}
              />
            )}
          </Field>
        ))}
      </div>
      {editable && (
        <div className="mt-3">
          <Button
            variant="secondary"
            loading={busy}
            onClick={() =>
              void run(async () => {
                await api(`/requests/${view.id}`, {
                  method: 'PATCH',
                  csrf,
                  body: { fields: Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '')) },
                });
                return 'Saved.';
              })
            }
          >
            Save details
          </Button>
        </div>
      )}
      <Msg error={error} note={note} />
    </Card>
  );
}

export function RequestExtras({
  view,
  data,
  csrf,
  canEdit,
  isDelegate,
  canRedirect,
}: {
  view: ExtendedView;
  data: ExtrasData;
  csrf: string;
  canEdit: boolean;
  isDelegate: boolean;
  canRedirect: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="request-extras">
      <CustomFieldsCard view={view} csrf={csrf} canEdit={canEdit} />
      <ClassificationCard view={view} csrf={csrf} canEdit={canEdit} />
      <EngagementsCard view={view} />
      <ProcessCard view={view} data={data} csrf={csrf} canEdit={canEdit} isDelegate={isDelegate} />
      <DelegatesCard view={view} data={data} csrf={csrf} canRedirect={canRedirect} />
      <SuppliersCard view={view} data={data} csrf={csrf} canEdit={canEdit} />
      <EcvCard view={view} data={data} csrf={csrf} canEdit={canEdit && view.status === 'DRAFT'} />
      {data.artefacts.length > 1 && <ArtefactsCard data={data} />}
    </div>
  );
}
