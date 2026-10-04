'use client';
import { FileDown, ShieldAlert } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Field, Input, Select, Textarea } from '@if/ui';
import { api } from '@/lib/api-client';
import { formatDateTime } from '@/lib/labels';
import { Card, useRunner } from './eval-card';
import type { CoiStatus, EvalView, LibraryCriterion, ProbityDoc, ReportCoiRow, Stream } from './types';

const STREAM = { TECHNICAL: 'Technical', COMMERCIAL: 'Commercial', OTHER: 'Chair' } as const;

interface Common {
  ev: EvalView;
  csrf: string;
  roles: string[];
  onChange: (e: EvalView) => void;
}
const send = <T,>(csrf: string, method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown) =>
  api<T>(path, { method, csrf, ...(body === undefined ? {} : { body }) });

// ------------------------------------------------------------------ the hold (FR-0310)
export function HoldBanner({ ev }: { ev: EvalView }) {
  if (!ev.held) return null;
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-md border-2 border-error bg-error-bg p-4 text-sm font-semibold text-error"
      data-testid="hold-banner"
    >
      <ShieldAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <span>
        This evaluation is on hold{ev.held.by ? ` by ${ev.held.by}` : ''}: {ev.held.reason}. Nothing can
        change until the probity advisor releases it.
      </span>
    </p>
  );
}

export function HoldControls({ ev, csrf, onChange }: Common) {
  const [text, setText] = useState('');
  const r = useRunner();
  const p = ev.permissions;
  if (!p.canHold && !p.canRelease) return null;
  return (
    <Card id="hold-h" title="System hold" tone={ev.held ? 'warning' : undefined} testId="hold-card">
      <p className="mt-2 max-w-prose text-sm text-text-muted">
        {ev.held
          ? 'The workspace is frozen. Release it once the concern is resolved; the reason is recorded.'
          : 'If you suspect bias or a process breach, freeze the workspace. Every change is refused until you release it.'}
      </p>
      <div className="mt-3">
        <Field label={ev.held ? 'Why you are releasing it' : 'Why you are placing it on hold'}>
          <Textarea rows={2} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3">
        {p.canHold ? (
          <Button
            loading={r.busy === 'hold'}
            disabled={text.trim().length < 10}
            onClick={() =>
              void r.run(
                'hold',
                async () => {
                  onChange(
                    await send<EvalView>(csrf, 'POST', `/evaluations/${ev.id}/hold`, { reason: text }),
                  );
                  setText('');
                },
                'The evaluation is on hold.',
              )
            }
          >
            Place on hold
          </Button>
        ) : (
          <Button
            loading={r.busy === 'release'}
            disabled={text.trim().length < 5}
            onClick={() =>
              void r.run(
                'release',
                async () => {
                  onChange(
                    await send<EvalView>(csrf, 'POST', `/evaluations/${ev.id}/release`, { note: text }),
                  );
                  setText('');
                },
                'The hold was released.',
              )
            }
          >
            Release the hold
          </Button>
        )}
      </div>
      {r.messages}
    </Card>
  );
}

// ------------------------------------------------------------------ compliance gate (FR-0265)
export function CompliancePanel({ ev, csrf, roles, onChange }: Common) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const r = useRunner();
  if (ev.compliance.length === 0) return null;
  const canWaive = roles.includes('PROCUREMENT') || roles.includes('DELEGATE');
  const failed = ev.compliance.filter((c) => c.result === 'FAIL').length;
  return (
    <Card
      id="gate-h2"
      title="Compliance checks"
      testId="compliance-panel"
      tone={failed ? 'warning' : undefined}
      badge={<Badge tone={failed ? 'error' : 'success'}>{failed ? `${failed} failed` : 'All passed'}</Badge>}
    >
      <p className="mt-2 max-w-prose text-sm text-text-muted">
        Every response goes through these mandatory pass or fail checks before scoring. A supplier with a
        failed check is not ranked until it is put right or a person waives it with a reason.
      </p>
      <div className="mt-3 flex flex-col gap-3">
        {ev.suppliers.map((s) => {
          const rows = ev.compliance.filter((c) => c.supplierId === s.supplierId);
          if (!rows.length) return null;
          return (
            <section
              key={s.supplierId}
              aria-label={`Checks for ${s.displayName}`}
              className="rounded-md border border-border p-3"
              data-testid="compliance-supplier"
            >
              <p className="font-semibold">{s.displayName}</p>
              <ul className="mt-2 flex flex-col gap-2 text-sm">
                {rows.map((c) => (
                  <li key={c.key} data-check={c.key} data-result={c.result}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        tone={c.result === 'PASS' ? 'success' : c.result === 'WAIVED' ? 'warning' : 'error'}
                      >
                        {c.result === 'PASS' ? 'Pass' : c.result === 'WAIVED' ? 'Waived' : 'Failed'}
                      </Badge>
                      <strong>{c.label}</strong>
                      <span className="text-text-muted">{c.detail}</span>
                    </div>
                    {c.note && <p className="mt-1 text-text-muted">Waived because: {c.note}</p>}
                    {c.result === 'FAIL' && canWaive && (
                      <div className="mt-2 flex flex-wrap items-end gap-2">
                        <Field label={`Reason for waiving: ${c.label} (${s.displayName})`}>
                          <Input
                            value={notes[`${s.supplierId}:${c.key}`] ?? ''}
                            onChange={(e) =>
                              setNotes({ ...notes, [`${s.supplierId}:${c.key}`]: e.target.value })
                            }
                            className="w-72 max-w-full"
                          />
                        </Field>
                        <Button
                          variant="secondary"
                          disabled={(notes[`${s.supplierId}:${c.key}`] ?? '').trim().length < 10}
                          loading={r.busy === `waive-${s.supplierId}-${c.key}`}
                          aria-label={`Waive ${c.label} for ${s.displayName}`}
                          onClick={() =>
                            void r.run(
                              `waive-${s.supplierId}-${c.key}`,
                              async () =>
                                onChange(
                                  await send<EvalView>(
                                    csrf,
                                    'POST',
                                    `/evaluations/${ev.id}/compliance/${s.supplierId}/${c.key}/waive`,
                                    { note: notes[`${s.supplierId}:${c.key}`] },
                                  ),
                                ),
                              'Waived and recorded.',
                            )
                          }
                        >
                          Waive
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      {ev.permissions.canRunGate && (
        <div className="mt-3">
          <Button
            variant="secondary"
            loading={r.busy === 'rerun'}
            onClick={() =>
              void r.run(
                'rerun',
                async () =>
                  onChange(await send<EvalView>(csrf, 'POST', `/evaluations/${ev.id}/compliance/run`)),
                'The checks were run again.',
              )
            }
          >
            Run the checks again
          </Button>
        </div>
      )}
      {r.messages}
    </Card>
  );
}

// ------------------------------------------------------------------ criteria (FR-0320)
export function CriteriaEditor({ ev, csrf, onChange }: Common) {
  const [rows, setRows] = useState(() =>
    ev.criteria.map((c) => ({
      name: c.name,
      stream: c.stream,
      weight: String(c.weight),
      passFail: c.passFail,
    })),
  );
  const [library, setLibrary] = useState<LibraryCriterion[]>([]);
  const [pick, setPick] = useState('');
  const r = useRunner();
  useEffect(() => {
    void api<{ criteria: LibraryCriterion[] }>('/criteria-library').then(
      (x) => setLibrary(x.criteria),
      () => undefined,
    );
  }, []);
  if (!ev.permissions.canEditCriteria || ev.mode === 'RANKING') return null;
  const total = rows.filter((x) => !x.passFail).reduce((a, x) => a + (Number(x.weight) || 0), 0);
  const unused = library.filter((l) => !rows.some((x) => x.name === l.name));
  return (
    <Card id="crit-h" title="Criteria for this evaluation" testId="criteria-editor">
      <p className="mt-2 max-w-prose text-sm text-text-muted">
        Choose from the library and set the weights. They must add up to 100, and they are fixed once scoring
        opens. A later stage can use different criteria.
      </p>
      <ul className="mt-3 flex flex-col gap-2" aria-label="Criteria">
        {rows.map((x, i) => (
          <li
            key={x.name}
            className="flex flex-wrap items-end gap-2 rounded-md border border-border p-2 text-sm"
          >
            <span className="min-w-0 flex-1">
              <span className="font-semibold">{x.name}</span>{' '}
              <span className="text-text-muted">
                {STREAM[x.stream as Stream]}
                {x.passFail ? ', pass or fail' : ''}
              </span>
            </span>
            {!x.passFail && (
              <Field label={`Weight for ${x.name}`}>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={x.weight}
                  onChange={(e) =>
                    setRows(rows.map((y, k) => (k === i ? { ...y, weight: e.target.value } : y)))
                  }
                  className="w-24"
                />
              </Field>
            )}
            <Button
              variant="secondary"
              aria-label={`Remove ${x.name}`}
              onClick={() => setRows(rows.filter((_, k) => k !== i))}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <Field label="Add from the library">
          <Select value={pick} onChange={(e) => setPick(e.target.value)} className="w-80 max-w-full">
            <option value="">Choose a criterion…</option>
            {unused.map((l) => (
              <option key={l.name} value={l.name}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
        <Button
          variant="secondary"
          disabled={!pick}
          onClick={() => {
            const l = library.find((x) => x.name === pick)!;
            setRows([
              ...rows,
              { name: l.name, stream: l.stream, weight: String(l.weight), passFail: l.passFail },
            ]);
            setPick('');
          }}
        >
          Add criterion
        </Button>
      </div>
      <p className="mt-3 text-sm" data-testid="criteria-total">
        Weights add up to <strong>{total}</strong> {total === 100 ? '' : '(they must be exactly 100)'}
      </p>
      <div className="mt-3">
        <Button
          loading={r.busy === 'save'}
          disabled={total !== 100}
          onClick={() =>
            void r.run(
              'save',
              async () =>
                onChange(
                  await send<EvalView>(csrf, 'PUT', `/evaluations/${ev.id}/criteria`, {
                    criteria: rows.map((x) => ({
                      name: x.name,
                      stream: x.stream,
                      weight: x.passFail ? 0 : Number(x.weight),
                      passFail: x.passFail,
                    })),
                  }),
                ),
              'Criteria saved.',
            )
          }
        >
          Save criteria
        </Button>
      </div>
      {r.messages}
    </Card>
  );
}

// ------------------------------------------------------------------ re-declaration (FR-0325) and the roster
export function RedeclarePrompt({ ev, csrf, onChange }: Common) {
  const [mode, setMode] = useState<'none' | 'conflict'>('none');
  const [nature, setNature] = useState('');
  const [org, setOrg] = useState('');
  const r = useRunner();
  if (!ev.me?.needsRedeclaration || !ev.permissions.canRedeclare) return null;
  return (
    <Card id="redecl-h" title="Confirm your declaration" tone="warning" testId="redeclare-card">
      <p className="mt-2 max-w-prose text-sm text-text-muted">
        Now that you can see which suppliers bid, confirm that you still have no conflict of interest, or
        declare one.
      </p>
      <fieldset className="mt-3 flex flex-col gap-1">
        <legend className="sr-only">Your declaration now that suppliers are visible</legend>
        <label className="flex min-h-[44px] items-center gap-3 text-sm">
          <input
            type="radio"
            name="redecl"
            checked={mode === 'none'}
            onChange={() => setMode('none')}
            className="size-5"
          />
          I still have no conflict of interest
        </label>
        <label className="flex min-h-[44px] items-center gap-3 text-sm">
          <input
            type="radio"
            name="redecl"
            checked={mode === 'conflict'}
            onChange={() => setMode('conflict')}
            className="size-5"
          />
          I now recognise a conflict
        </label>
      </fieldset>
      {mode === 'conflict' && (
        <div className="mt-2 flex flex-col gap-3">
          <Field label="What is the conflict?" required>
            <Textarea rows={3} maxLength={2000} value={nature} onChange={(e) => setNature(e.target.value)} />
          </Field>
          <Field label="Which organisation does it concern?">
            <Input value={org} onChange={(e) => setOrg(e.target.value)} />
          </Field>
        </div>
      )}
      <div className="mt-3">
        <Button
          loading={r.busy === 'redecl'}
          disabled={mode === 'conflict' && nature.trim().length < 3}
          onClick={() =>
            void r.run('redecl', async () => {
              const res = await send<EvalView & { suspended?: boolean }>(
                csrf,
                'POST',
                `/evaluations/${ev.id}/coi/redeclare`,
                mode === 'none'
                  ? { none: true }
                  : { none: false, nature, ...(org ? { subjectOrg: org } : {}) },
              );
              if (res.suspended) window.location.assign('/app/evaluations?conflict=1');
              else onChange(res);
            })
          }
        >
          Confirm
        </Button>
      </div>
      {r.messages}
    </Card>
  );
}

export function PanelTools({ ev, csrf, roles, onChange }: Common) {
  const [status, setStatus] = useState<CoiStatus | null>(null);
  const [people, setPeople] = useState<{
    evaluators: Array<{ id: string; name: string }>;
    chairs: Array<{ id: string; name: string }>;
  }>({
    evaluators: [],
    chairs: [],
  });
  const [leaving, setLeaving] = useState('');
  const [replacement, setReplacement] = useState('');
  const [reason, setReason] = useState<'OTHER' | 'CONFLICT'>('OTHER');
  const [note, setNote] = useState('');
  const r = useRunner();
  const canSee = ['PROCUREMENT', 'PROBITY', 'CHAIR', 'DELEGATE', 'EXEC'].some((x) => roles.includes(x));
  const canRemind = roles.includes('PROCUREMENT') || roles.includes('CHAIR');
  const load = useCallback(async () => {
    if (!canSee) return;
    try {
      setStatus(await api<CoiStatus>(`/evaluations/${ev.id}/coi/status`));
    } catch {
      /* the roster is shown without it */
    }
  }, [ev.id, canSee]);
  useEffect(() => {
    void load();
  }, [load, ev.panel, ev.status]);
  useEffect(() => {
    if (ev.permissions.canSubstitute) void api<typeof people>('/evaluators').then(setPeople, () => undefined);
  }, [ev.permissions.canSubstitute]);
  if (!canSee) return null;
  const outstanding = status?.outstanding ?? [];
  const members = ev.panel;
  const taken = new Set(members.map((m) => m.userId));
  const leaver = members.find((m) => m.userId === leaving);
  const pool = leaver?.stream === 'OTHER' ? people.chairs : people.evaluators;
  return (
    <Card id="ptools-h" title="Declarations and substitutions" testId="panel-tools">
      <p className="mt-2 text-sm text-text-muted" data-testid="redeclare-summary">
        {status
          ? outstanding.length
            ? `Still to declare or confirm again: ${outstanding.join(', ')}.`
            : 'Everyone has declared and confirmed again.'
          : 'Loading…'}
      </p>
      {status && (
        <ul className="mt-2 flex flex-col gap-1 text-sm" aria-label="Declaration status">
          {status.members.map((m) => (
            <li
              key={m.userId}
              className="flex flex-wrap items-center gap-2"
              data-redeclaration={m.redeclaration}
            >
              <strong>{m.name}</strong>
              <Badge
                tone={
                  m.redeclaration === 'CONFIRMED'
                    ? 'success'
                    : m.redeclaration === 'CONFLICT'
                      ? 'error'
                      : m.redeclaration === 'NOT_APPLICABLE'
                        ? 'neutral'
                        : 'warning'
                }
              >
                {
                  {
                    CONFIRMED: 'Confirmed again',
                    CONFLICT: 'Declared a conflict',
                    NOT_APPLICABLE: 'Not applicable',
                    AWAITING_FIRST: 'First declaration due',
                    OUTSTANDING: 'Confirmation outstanding',
                  }[m.redeclaration]
                }
              </Badge>
              {m.remindedAt && (
                <span className="text-xs text-text-muted">Reminded {formatDateTime(m.remindedAt)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {canRemind && outstanding.length > 0 && !['LOCKED', 'REPORTED', 'APPROVED'].includes(ev.status) && (
        <div className="mt-3">
          <Button
            variant="secondary"
            loading={r.busy === 'remind'}
            onClick={() =>
              void r.run(
                'remind',
                async () => {
                  await send(csrf, 'POST', `/evaluations/${ev.id}/coi/remind`);
                  await load();
                },
                'Reminders sent.',
              )
            }
          >
            Send reminders
          </Button>
        </div>
      )}
      {ev.permissions.canSubstitute && (
        <form
          className="mt-4 flex flex-col gap-3 border-t border-border pt-4"
          aria-label="Replace an evaluator"
          onSubmit={(e) => {
            e.preventDefault();
            void r.run(
              'sub',
              async () => {
                onChange(
                  await send<EvalView>(csrf, 'POST', `/evaluations/${ev.id}/panel/${leaving}/substitute`, {
                    replacementUserId: replacement,
                    reason,
                    ...(note ? { note } : {}),
                  }),
                );
                setLeaving('');
                setReplacement('');
                setNote('');
              },
              'The replacement was told what they need to do.',
            );
          }}
        >
          <h3 className="font-heading text-base font-bold">Replace an evaluator</h3>
          <p className="text-sm text-text-muted">
            The leaver&apos;s marks stay as read-only history and are left out of the averages. The
            replacement declares any conflict and starts with a clean scoring matrix.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Who is leaving">
              <Select value={leaving} onChange={(e) => setLeaving(e.target.value)}>
                <option value="">Choose…</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name} ({STREAM[m.stream]}
                    {m.coiState === 'REMOVED' ? ', removed' : ''})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Replacement">
              <Select value={replacement} onChange={(e) => setReplacement(e.target.value)}>
                <option value="">Choose…</option>
                {pool
                  .filter((p) => !taken.has(p.id))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Why">
              <Select value={reason} onChange={(e) => setReason(e.target.value as 'OTHER' | 'CONFLICT')}>
                <option value="OTHER">Another reason</option>
                <option value="CONFLICT">After a material conflict</option>
              </Select>
            </Field>
            <Field label="Note (optional)">
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
          <div>
            <Button
              type="submit"
              variant="secondary"
              disabled={!leaving || !replacement}
              loading={r.busy === 'sub'}
            >
              Replace evaluator
            </Button>
          </div>
        </form>
      )}
      {r.messages}
    </Card>
  );
}

// ------------------------------------------------------------------ earlier stages (FR-0285, FR-0360)
export function StagesCard({ ev }: { ev: EvalView }) {
  if (ev.previousStages.length === 0) return null;
  return (
    <Card id="stages-h" title={`Stage ${ev.stage}: what came before`} testId="stages-card">
      <p className="mt-2 text-sm text-text-muted">
        Earlier stages are kept with every score and shown in the report. This stage can use different
        criteria.
      </p>
      <div className="mt-3 flex flex-col gap-3">
        {ev.previousStages.map((st) => (
          <section
            key={st.tenderId}
            aria-label={`Stage ${st.stage}`}
            className="rounded-md border border-border p-3"
          >
            <p className="font-semibold">
              Stage {st.stage}
              {st.evaluationId && (
                <>
                  {' '}
                  <a href={`/app/evaluations/${st.evaluationId}`} className="ml-2 text-sm underline">
                    Open
                  </a>
                </>
              )}
            </p>
            {st.suppliers.length === 0 ? (
              <p className="mt-1 text-sm text-text-muted">No outcome recorded.</p>
            ) : (
              <ol className="mt-2 flex flex-col gap-1 text-sm">
                {st.suppliers.map((x) => (
                  <li key={x.displayName} className="flex flex-wrap items-center gap-2">
                    <span className="font-mono">{x.rank ?? '–'}</span>
                    <strong>{x.displayName}</strong>
                    <span className="text-text-muted">{x.weightedScore.toFixed(1)} / 100</span>
                    {x.shortlisted && <Badge tone="success">Shortlisted</Badge>}
                  </li>
                ))}
              </ol>
            )}
          </section>
        ))}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ the probity plan and outcomes report (FR-0340)
const KIND_LABEL = { PLAN: 'Probity plan', OUTCOMES: 'Probity outcomes report' } as const;

export function ProbityDocs({ ev, csrf, roles }: Omit<Common, 'onChange'>) {
  const [docs, setDocs] = useState<ProbityDoc[]>([]);
  const [draft, setDraft] = useState<Record<string, { title: string; body: string }>>({});
  const r = useRunner();
  const author = roles.includes('PROBITY');
  const load = useCallback(async () => {
    try {
      setDocs((await api<{ documents: ProbityDoc[] }>(`/evaluations/${ev.id}/probity`)).documents);
    } catch {
      /* not visible to this role */
    }
  }, [ev.id]);
  useEffect(() => {
    void load();
  }, [load]);
  const readers = ['PROCUREMENT', 'DELEGATE', 'LEGAL', 'PROBITY', 'EXEC', 'CHAIR'].some((x) =>
    roles.includes(x),
  );
  if (!readers || (!author && docs.length === 0)) return null;
  return (
    <Card id="probdoc-h" title="Probity plan and outcomes report" testId="probity-docs">
      <p className="mt-2 max-w-prose text-sm text-text-muted">
        The probity advisor writes the plan and the outcomes report here, or uploads them, and signs each one.
        Editing a signed document starts a new unsigned version.
      </p>
      <div className="mt-3 flex flex-col gap-4">
        {(['PLAN', 'OUTCOMES'] as const).map((kind) => {
          const d = docs.find((x) => x.kind === kind);
          if (!d && !author) return null;
          const cur = draft[kind] ?? { title: d?.title ?? KIND_LABEL[kind], body: d?.body ?? '' };
          return (
            <section
              key={kind}
              aria-label={KIND_LABEL[kind]}
              className="rounded-md border border-border p-3"
              data-testid={`probity-${kind.toLowerCase()}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-heading text-base font-bold">{KIND_LABEL[kind]}</h3>
                {d && (
                  <Badge tone={d.status === 'SIGNED' ? 'success' : 'neutral'}>
                    {d.status === 'SIGNED' ? 'Signed' : 'Draft'} · version {d.version}
                  </Badge>
                )}
              </div>
              {d?.stamp && (
                <p
                  className="mt-2 font-mono text-xs text-success"
                  data-testid={`probity-${kind.toLowerCase()}-stamp`}
                >
                  {d.stamp}
                </p>
              )}
              {d?.hasFile ? (
                <p className="mt-2 text-sm">
                  Uploaded file: <strong>{d.fileName}</strong>
                </p>
              ) : (
                d && !author && <p className="mt-2 max-w-prose whitespace-pre-wrap text-sm">{d.body}</p>
              )}
              {d && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {d.hasFile ? (
                    <Button asChild variant="secondary">
                      <a
                        href={`/api/v1/evaluations/${ev.id}/probity/${kind}/file`}
                        download
                        className="text-text no-underline"
                      >
                        <FileDown className="size-4" aria-hidden="true" />
                        Download file
                      </a>
                    </Button>
                  ) : (
                    <>
                      <Button asChild variant="secondary">
                        <a
                          href={`/api/v1/evaluations/${ev.id}/probity/${kind}/pdf`}
                          download
                          className="text-text no-underline"
                        >
                          <FileDown className="size-4" aria-hidden="true" />
                          PDF
                        </a>
                      </Button>
                      <Button asChild variant="secondary">
                        <a
                          href={`/api/v1/evaluations/${ev.id}/probity/${kind}/docx`}
                          download
                          className="text-text no-underline"
                        >
                          <FileDown className="size-4" aria-hidden="true" />
                          Word
                        </a>
                      </Button>
                    </>
                  )}
                </div>
              )}
              {author && (
                <div className="mt-3 flex flex-col gap-3">
                  <Field label={`Title of the ${KIND_LABEL[kind].toLowerCase()}`}>
                    <Input
                      value={cur.title}
                      onChange={(e) => setDraft({ ...draft, [kind]: { ...cur, title: e.target.value } })}
                    />
                  </Field>
                  <Field
                    label={`Text of the ${KIND_LABEL[kind].toLowerCase()}`}
                    hint="Leave a blank line between paragraphs."
                  >
                    <Textarea
                      rows={6}
                      value={cur.body}
                      onChange={(e) => setDraft({ ...draft, [kind]: { ...cur, body: e.target.value } })}
                    />
                  </Field>
                  <div className="flex flex-wrap items-end gap-2">
                    <Button
                      variant="secondary"
                      disabled={cur.title.trim().length < 3 || cur.body.trim().length < 10}
                      loading={r.busy === `save-${kind}`}
                      onClick={() =>
                        void r.run(
                          `save-${kind}`,
                          async () => {
                            await send(csrf, 'PUT', `/evaluations/${ev.id}/probity/${kind}`, cur);
                            setDraft({});
                            await load();
                          },
                          `${KIND_LABEL[kind]} saved.`,
                        )
                      }
                    >
                      Save {KIND_LABEL[kind].toLowerCase()}
                    </Button>
                    {d && d.status === 'DRAFT' && (
                      <Button
                        loading={r.busy === `sign-${kind}`}
                        aria-label={`Sign the ${KIND_LABEL[kind].toLowerCase()}`}
                        onClick={() =>
                          void r.run(
                            `sign-${kind}`,
                            async () => {
                              await send(csrf, 'POST', `/evaluations/${ev.id}/probity/${kind}/sign`);
                              await load();
                            },
                            'Signed.',
                          )
                        }
                      >
                        Sign
                      </Button>
                    )}
                    <Field label={`Or upload ${KIND_LABEL[kind].toLowerCase()} as a file`}>
                      <input
                        type="file"
                        accept=".pdf,.doc,.docx"
                        className="min-h-[44px] text-sm"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          e.target.value = '';
                          if (!f) return;
                          void r.run(
                            `up-${kind}`,
                            async () => {
                              const buf = new Uint8Array(await f.arrayBuffer());
                              let bin = '';
                              for (const b of buf) bin += String.fromCharCode(b);
                              await send(csrf, 'POST', `/evaluations/${ev.id}/probity/${kind}/upload`, {
                                title: cur.title.length >= 3 ? cur.title : KIND_LABEL[kind],
                                fileName: f.name,
                                contentBase64: btoa(bin),
                              });
                              setDraft({});
                              await load();
                            },
                            'File uploaded.',
                          );
                        }}
                      />
                    </Field>
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>
      {r.messages}
    </Card>
  );
}

// ------------------------------------------------------------------ allocating external advisors (FR-0310)
export function AdvisorAllocation({ ev, csrf, roles }: Omit<Common, 'onChange'>) {
  const [data, setData] = useState<null | {
    allocated: Array<{ userId: string; name: string; external: boolean }>;
    available: Array<{ id: string; name: string }>;
  }>(null);
  const [pick, setPick] = useState('');
  const r = useRunner();
  const canAllocate = roles.includes('PROCUREMENT');
  const load = useCallback(async () => {
    try {
      setData(await api(`/tenders/${ev.tenderId}/probity-advisors`));
    } catch {
      /* hidden */
    }
  }, [ev.tenderId]);
  useEffect(() => {
    if (canAllocate) void load();
  }, [canAllocate, load]);
  if (!canAllocate || !data) return null;
  return (
    <Card id="adv-h" title="Probity advisors" testId="advisor-allocation">
      <p className="mt-2 max-w-prose text-sm text-text-muted">
        An internal probity officer sees every procurement. An external advisor sees only the ones allocated
        here, read-only, and can place a hold.
      </p>
      <ul className="mt-3 flex flex-col gap-1 text-sm" aria-label="Allocated advisors">
        {data.allocated.length === 0 && (
          <li className="text-text-muted">No external advisor is allocated.</li>
        )}
        {data.allocated.map((a) => (
          <li key={a.userId} className="flex flex-wrap items-center gap-2">
            <strong>{a.name}</strong>
            <Button
              variant="secondary"
              aria-label={`Remove ${a.name}`}
              loading={r.busy === `rm-${a.userId}`}
              onClick={() =>
                void r.run(`rm-${a.userId}`, async () => {
                  await send(csrf, 'DELETE', `/tenders/${ev.tenderId}/probity-advisors/${a.userId}`);
                  await load();
                })
              }
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
      {data.available.length > 0 && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Field label="Allocate an advisor">
            <Select value={pick} onChange={(e) => setPick(e.target.value)} className="w-64">
              <option value="">Choose…</option>
              {data.available.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            variant="secondary"
            disabled={!pick}
            loading={r.busy === 'alloc'}
            onClick={() =>
              void r.run(
                'alloc',
                async () => {
                  await send(csrf, 'POST', `/tenders/${ev.tenderId}/probity-advisors`, { userId: pick });
                  setPick('');
                  await load();
                },
                'Advisor allocated.',
              )
            }
          >
            Allocate
          </Button>
        </div>
      )}
      {r.messages}
    </Card>
  );
}

// ------------------------------------------------------------------ conflicts declared on the report (FR-0370)
const COI_ROLES = ['PROCUREMENT', 'DELEGATE', 'EXEC', 'CHAIR', 'PROBITY', 'LEGAL'];
export function ReportCoi({ ev, csrf, roles, reportId }: Omit<Common, 'onChange'> & { reportId: string }) {
  const [rows, setRows] = useState<ReportCoiRow[] | null>(null);
  const [mode, setMode] = useState<'none' | 'conflict'>('none');
  const [nature, setNature] = useState('');
  const [why, setWhy] = useState<Record<string, string>>({});
  const r = useRunner();
  const allowed = COI_ROLES.some((x) => roles.includes(x));
  const canDecide = roles.includes('DELEGATE') || roles.includes('EXEC') || roles.includes('PROBITY');
  const load = useCallback(async () => {
    try {
      setRows(
        (await api<{ declarations: ReportCoiRow[] }>(`/evaluation-reports/${reportId}/coi`)).declarations,
      );
    } catch {
      setRows([]);
    }
  }, [reportId]);
  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load, ev.status]);
  if (!allowed || rows === null) return null;
  const mine = rows.find((x) => x.mine);
  return (
    <section
      aria-label="Conflicts of interest on the report"
      className="mt-4 border-t border-border pt-4"
      data-testid="report-coi"
    >
      <h3 className="font-heading text-base font-bold">Conflicts of interest on this report</h3>
      <p className="mt-1 max-w-prose text-sm text-text-muted">
        As at the plan, anyone who prepares or approves the report declares any conflict. A conflict that is
        not cleared stops that person approving.
      </p>
      <ul className="mt-2 flex flex-col gap-2 text-sm" aria-label="Report declarations">
        {rows.length === 0 && <li className="text-text-muted">No one has declared yet.</li>}
        {rows.map((c) => (
          <li key={c.id} className="rounded-md border border-border p-2" data-disposition={c.disposition}>
            <div className="flex flex-wrap items-center gap-2">
              <strong>{c.name}</strong>
              <Badge
                tone={
                  c.none
                    ? 'success'
                    : c.disposition === 'PENDING'
                      ? 'warning'
                      : c.disposition === 'MATERIAL'
                        ? 'error'
                        : 'success'
                }
              >
                {c.none
                  ? 'No conflict'
                  : {
                      PENDING: 'Conflict: awaiting decision',
                      IMMATERIAL: 'Immaterial',
                      MANAGEABLE: 'Minor',
                      MATERIAL: 'Material: cannot approve',
                    }[c.disposition]}
              </Badge>
            </div>
            {c.nature && <p className="mt-1">{c.nature}</p>}
            {!c.none && c.disposition === 'PENDING' && canDecide && !c.mine && (
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <Field label={`Reason for your decision on ${c.name}`}>
                  <Input
                    value={why[c.id] ?? ''}
                    onChange={(e) => setWhy({ ...why, [c.id]: e.target.value })}
                    className="w-64"
                  />
                </Field>
                {(['IMMATERIAL', 'MANAGEABLE', 'MATERIAL'] as const).map((d) => (
                  <Button
                    key={d}
                    variant="secondary"
                    loading={r.busy === `${c.id}-${d}`}
                    aria-label={`Report conflict ${d.toLowerCase()} for ${c.name}`}
                    onClick={() =>
                      void r.run(`${c.id}-${d}`, async () => {
                        await send(csrf, 'POST', `/evaluation-reports/${reportId}/coi/${c.id}/decision`, {
                          disposition: d,
                          ...(why[c.id] ? { rationale: why[c.id] } : {}),
                        });
                        await load();
                      })
                    }
                  >
                    {{ IMMATERIAL: 'Immaterial', MANAGEABLE: 'Minor', MATERIAL: 'Material' }[d]}
                  </Button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      {!mine && (
        <div className="mt-3 flex flex-col gap-2">
          <fieldset className="flex flex-col gap-1">
            <legend className="sr-only">Your declaration on the report</legend>
            <label className="flex min-h-[44px] items-center gap-3 text-sm">
              <input
                type="radio"
                name="rcoi"
                className="size-5"
                checked={mode === 'none'}
                onChange={() => setMode('none')}
              />
              I have no conflict of interest on this report
            </label>
            <label className="flex min-h-[44px] items-center gap-3 text-sm">
              <input
                type="radio"
                name="rcoi"
                className="size-5"
                checked={mode === 'conflict'}
                onChange={() => setMode('conflict')}
              />
              I have a conflict
            </label>
          </fieldset>
          {mode === 'conflict' && (
            <Field label="What is the conflict?" required>
              <Textarea rows={2} value={nature} onChange={(e) => setNature(e.target.value)} />
            </Field>
          )}
          <div>
            <Button
              variant="secondary"
              loading={r.busy === 'declare'}
              disabled={mode === 'conflict' && nature.trim().length < 3}
              onClick={() =>
                void r.run('declare', async () => {
                  await send(
                    csrf,
                    'POST',
                    `/evaluation-reports/${reportId}/coi`,
                    mode === 'none' ? { none: true } : { none: false, nature },
                  );
                  await load();
                })
              }
            >
              Declare on the report
            </Button>
          </div>
        </div>
      )}
      {r.messages}
    </section>
  );
}
