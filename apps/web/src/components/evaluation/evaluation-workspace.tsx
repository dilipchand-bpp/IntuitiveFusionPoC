'use client';
import {
  CheckCircle2,
  CircleDashed,
  Download,
  EyeOff,
  FileDown,
  Flag,
  Info,
  Lock,
  RotateCcw,
  UserX,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Badge, Button, Dialog, Field, Select, Stepper, Textarea, cn } from '@if/ui';
import { ApiError, api } from '@/lib/api-client';
import { TENDER_TYPE_LABEL, formatDateTime } from '@/lib/labels';
import type { EvalCriterion, EvalView, MyScores } from './types';

const STEPS = ['Conflicts', 'Scoring', 'Consensus', 'Locked', 'Report', 'Approved'];
const STEP_OF: Record<EvalView['status'], number> = {
  COI_PENDING: 0,
  SCORING: 1,
  CONSENSUS: 2,
  LOCKED: 3,
  REPORTED: 4,
  APPROVED: 5,
};
const COI_LABEL: Record<string, string> = {
  NOT_DECLARED: 'Not declared',
  DECLARED_CONFLICT: 'Conflict: awaiting decision',
  DECLARED_NONE: 'No conflict',
  REMOVED: 'Removed (conflict)',
};
const STREAM_LABEL = { TECHNICAL: 'Technical', COMMERCIAL: 'Commercial', OTHER: 'Chair' } as const;

const problem = (e: unknown) =>
  e instanceof ApiError
    ? [e.message, ...(e.problem.errors ?? []).map((x) => x.message)]
        .filter((x, i, a) => a.indexOf(x) === i)
        .join(' ')
    : 'Something went wrong. Please try again.';
const kb = (n: number) =>
  n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

function Card({
  id,
  title,
  children,
  tone,
  testId,
  badge,
}: {
  id: string;
  title: string;
  children: ReactNode;
  tone?: 'accent' | 'warning';
  testId?: string;
  badge?: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      data-testid={testId}
      className={cn(
        'relative overflow-hidden rounded-lg border bg-surface p-5 shadow-sm',
        tone === 'accent' ? 'border-accent' : tone === 'warning' ? 'border-warning' : 'border-border',
      )}
    >
      {tone && (
        <span
          aria-hidden="true"
          className={cn(
            'absolute inset-x-0 top-0 h-1',
            tone === 'accent' ? 'bg-brand-gradient' : 'bg-warning',
          )}
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={id} className="font-heading text-lg font-bold">
          {title}
        </h2>
        {badge}
      </div>
      {children}
    </section>
  );
}

/** One screen for every person on an evaluation. What it shows depends on who is looking and which stage it is at. */
export function EvaluationWorkspace({ initial, csrf }: { initial: EvalView; csrf: string }) {
  const router = useRouter();
  const [ev, setEv] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const p = ev.permissions;
  const me = ev.me;

  const refresh = useCallback(async () => setEv(await api<EvalView>(`/evaluations/${ev.id}`)), [ev.id]);
  async function run(name: string, fn: () => Promise<void>, ok?: string) {
    setBusy(name);
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (ok) setNotice(ok);
    } catch (e) {
      setError(problem(e));
    } finally {
      setBusy(null);
    }
  }
  const post = <T,>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', csrf, body });
  const chair = me?.stream === 'OTHER';
  const live = ev.panel.filter((m) => m.coiState !== 'REMOVED' && m.coiState !== 'DECLARED_CONFLICT');
  const flagged = ev.consensus.filter((c) => c.flagged).length;

  // People who score or agree consensus keep the documents beside their work; read-only roles get them in the main column.
  const suppliersInRail =
    p.canScore || p.canSetConsensus || ev.consensus.length > 0 || me?.coiState === 'NOT_DECLARED';
  const suppliersCard = (wide: boolean) => (
    <Card id="sup-h" title="Suppliers" testId="suppliers-card">
      {ev.suppliers.some((s) => s.anonymised) && (
        <p className="mt-2 flex items-start gap-2 text-sm text-text-muted" data-testid="anonymised-note">
          <EyeOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Names and documents stay hidden until you declare that you have no conflict of interest.
        </p>
      )}
      <ul className={cn('mt-3 gap-3', wide ? 'grid sm:grid-cols-2' : 'flex flex-col')}>
        {ev.suppliers.map((s) => (
          <li key={s.supplierId} className="rounded-md border border-border p-3" data-testid="supplier-row">
            <p className="font-semibold">{s.displayName}</p>
            {s.files.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1 text-sm" aria-label={`Documents from ${s.displayName}`}>
                {s.files.map((f) => (
                  <li key={f.id}>
                    <a
                      href={`/api/v1/evaluations/${ev.id}/suppliers/${s.supplierId}/files/${f.id}`}
                      className="flex min-h-[44px] items-start gap-2 py-1"
                      download
                    >
                      <Download className="mt-1 size-4 shrink-0" aria-hidden="true" />
                      <span className="min-w-0">
                        <span className="block break-all font-medium">{f.name}</span>
                        <span className="block text-xs text-text-muted">
                          {STREAM_LABEL[f.section]} · {kb(f.sizeBytes)}
                        </span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );

  return (
    <div className="flex flex-col gap-6" data-testid="evaluation-workspace" data-status={ev.status}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="info">{TENDER_TYPE_LABEL[ev.tenderType] ?? ev.tenderType}</Badge>
        {me && <Badge tone="neutral">Your seat: {STREAM_LABEL[me.stream]}</Badge>}
        {!me && <Badge tone="neutral">Read-only view</Badge>}
      </div>
      <Stepper steps={STEPS} current={STEP_OF[ev.status]} />

      {error && (
        <p
          role="alert"
          className="rounded-md border border-error bg-error-bg p-3 text-sm font-medium text-error"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-md border border-success bg-success-bg p-3 text-sm font-medium text-success"
        >
          {notice}
        </p>
      )}

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['Bidders', String(ev.suppliers.length)],
          ['Criteria you see', String(ev.criteria.length)],
          ['Panel', `${live.length} active`],
          [
            me && !chair && me.coiState === 'DECLARED_NONE' ? 'Your scores' : 'Flagged scores',
            me && !chair && me.coiState === 'DECLARED_NONE'
              ? `${me.done} of ${me.required}`
              : ev.status === 'CONSENSUS' ||
                  ev.status === 'LOCKED' ||
                  ev.status === 'REPORTED' ||
                  ev.status === 'APPROVED'
                ? String(flagged)
                : '–',
          ],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-border bg-surface p-4 shadow-sm">
            <dt className="text-xs font-bold uppercase tracking-wide text-text-muted">{k}</dt>
            <dd className="mt-1 font-heading text-lg font-bold">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <aside aria-label="Conflicts, panel and suppliers" className="flex flex-col gap-4 lg:order-2">
          {p.canDeclare && (
            <ConflictGate
              busy={busy === 'coi'}
              onDeclare={(body) =>
                run('coi', async () => {
                  const r = await post<{ suspended?: boolean; message?: string }>(
                    `/evaluations/${ev.id}/coi`,
                    body,
                  );
                  if (r.suspended) {
                    router.push('/app/evaluations?conflict=1');
                    return;
                  }
                  setEv(r as unknown as EvalView);
                  router.refresh();
                })
              }
            />
          )}

          <Card id="panel-h" title="Panel" testId="panel-card">
            <ul className="mt-3 flex flex-col gap-2">
              {ev.panel.map((m) => (
                <li
                  key={m.userId}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-alt/60 px-3 py-2 text-sm"
                  data-coi={m.coiState}
                >
                  {m.coiState === 'REMOVED' ? (
                    <UserX className="size-4 text-error" aria-hidden="true" />
                  ) : m.coiState === 'DECLARED_NONE' ? (
                    <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
                  ) : (
                    <CircleDashed className="size-4 text-warning" aria-hidden="true" />
                  )}
                  <strong>{m.name}</strong>
                  <span className="text-text-muted">{STREAM_LABEL[m.stream]}</span>
                  <Badge
                    tone={
                      m.coiState === 'DECLARED_NONE'
                        ? 'success'
                        : m.coiState === 'REMOVED'
                          ? 'error'
                          : 'warning'
                    }
                  >
                    {COI_LABEL[m.coiState]}
                  </Badge>
                  {m.scoringComplete && <Badge tone="info">Scores in</Badge>}
                </li>
              ))}
            </ul>
            {p.canManagePanel && <AddMember evalId={ev.id} csrf={csrf} onDone={refresh} />}
          </Card>

          {ev.conflicts.length > 0 && (
            <ConflictReview ev={ev} csrf={csrf} onDone={setEv} run={run} busy={busy} />
          )}

          {suppliersInRail && suppliersCard(false)}
        </aside>

        <div className="flex min-w-0 flex-col gap-4 lg:order-1">
          <StageGuide ev={ev} />
          {!suppliersInRail && suppliersCard(true)}
          {me?.coiState === 'NOT_DECLARED' && (
            <Card id="gate-h" title="Declare before you begin" tone="warning">
              <p className="mt-2 text-sm text-text-muted">
                Scoring and supplier documents unlock after you declare any conflict of interest. Use the
                panel on this page.
              </p>
            </Card>
          )}

          {ev.status === 'COI_PENDING' && me?.coiState === 'DECLARED_NONE' && (
            <Card id="wait-h" title="Waiting for the rest of the panel">
              <p className="mt-2 text-sm text-text-muted">
                Scoring opens when every panel member has declared.
              </p>
            </Card>
          )}

          {p.canScore && <ScoringSheet ev={ev} csrf={csrf} onDone={refresh} />}

          {ev.status === 'SCORING' && me?.scoringComplete && (
            <Card id="done-h" title="Your scores are in">
              <p className="mt-2 text-sm text-text-muted">
                Your scores are locked. The chair opens consensus once everyone has finished. Nobody can see
                your scores until then.
              </p>
            </Card>
          )}

          {chair && ev.status === 'SCORING' && (
            <Card id="chair-h" title="Open consensus" tone="accent" testId="chair-panel">
              <p className="mt-2 text-sm text-text-muted">
                {p.canOpenConsensus
                  ? 'Everyone has finished. Opening consensus reveals all scores to you and flags differences above the limit.'
                  : 'Waiting for every panel member to declare and finish scoring.'}
              </p>
              <div className="mt-3">
                <Button
                  disabled={!p.canOpenConsensus}
                  loading={busy === 'open'}
                  onClick={() =>
                    void run('open', async () =>
                      setEv(await post<EvalView>(`/evaluations/${ev.id}/consensus/open`)),
                    )
                  }
                >
                  Open consensus
                </Button>
              </div>
            </Card>
          )}

          {ev.consensus.length > 0 && (
            <ConsensusPanel ev={ev} csrf={csrf} onSaved={setEv} run={run} busy={busy} post={post} />
          )}

          {ev.ranking.length > 0 && (
            <Card id="rank-h" title="Ranking" testId="ranking">
              <ol className="mt-3 flex flex-col gap-2">
                {ev.ranking.map((r) => (
                  <li
                    key={r.supplierId}
                    className="flex flex-wrap items-center gap-3 rounded-md border border-border px-3 py-2"
                  >
                    <span className="inline-flex size-8 items-center justify-center rounded-full bg-brand-gradient text-sm font-extrabold">
                      {r.rank ?? '–'}
                    </span>
                    <strong className="min-w-0 flex-1">{r.displayName}</strong>
                    <span className="font-mono text-sm">{r.weightedScore.toFixed(1)} / 100</span>
                    {r.compliance === 'FAIL' && <Badge tone="error">Not compliant</Badge>}
                  </li>
                ))}
              </ol>
            </Card>
          )}

          {p.canReopen && <ReopenCard ev={ev} csrf={csrf} onDone={setEv} />}

          <ReportPanel ev={ev} csrf={csrf} busy={busy} run={run} post={post} setEv={setEv} />
        </div>
      </div>
    </div>
  );
}

function ConflictGate({
  onDeclare,
  busy,
}: {
  onDeclare: (b: { none: boolean; nature?: string }) => void;
  busy: boolean;
}) {
  const [mode, setMode] = useState<'none' | 'conflict'>('none');
  const [nature, setNature] = useState('');
  return (
    <Card id="coi-h" title="Conflict of interest" tone="accent" testId="coi-gate">
      <p className="mt-2 text-sm text-text-muted">
        Required before you can see who bid or open any document.
      </p>
      <form
        className="mt-3 flex flex-col gap-2"
        aria-label="Declare a conflict of interest"
        onSubmit={(e) => {
          e.preventDefault();
          onDeclare(mode === 'none' ? { none: true } : { none: false, nature });
        }}
      >
        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-semibold">Your declaration</legend>
          <label className="flex min-h-[44px] items-center gap-2 text-sm">
            <input type="radio" name="evcoi" checked={mode === 'none'} onChange={() => setMode('none')} /> I
            have no conflict of interest
          </label>
          <label className="flex min-h-[44px] items-center gap-2 text-sm">
            <input
              type="radio"
              name="evcoi"
              checked={mode === 'conflict'}
              onChange={() => setMode('conflict')}
            />{' '}
            I have a conflict to declare
          </label>
        </fieldset>
        {mode === 'conflict' && (
          <>
            <Field label="Describe the conflict" required>
              <Textarea
                rows={3}
                value={nature}
                onChange={(e) => setNature(e.target.value)}
                maxLength={2000}
              />
            </Field>
            <p className="text-sm font-medium text-warning">
              Declaring a conflict removes you from this evaluation immediately.
            </p>
          </>
        )}
        <div>
          <Button type="submit" loading={busy} disabled={mode === 'conflict' && nature.trim().length < 3}>
            Submit declaration
          </Button>
        </div>
      </form>
    </Card>
  );
}

function AddMember({ evalId, csrf, onDone }: { evalId: string; csrf: string; onDone: () => Promise<void> }) {
  const [list, setList] = useState<{
    evaluators: Array<{ id: string; name: string }>;
    chairs: Array<{ id: string; name: string }>;
  } | null>(null);
  const [user, setUser] = useState('');
  const [stream, setStream] = useState<'TECHNICAL' | 'COMMERCIAL' | 'OTHER'>('TECHNICAL');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api<NonNullable<typeof list>>('/evaluators').then(setList, () => undefined);
  }, []);
  if (!list) return null;
  const options = stream === 'OTHER' ? list.chairs : list.evaluators;
  return (
    <form
      className="mt-4 flex flex-col gap-2 border-t border-border pt-4"
      aria-label="Add a replacement panel member"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        api(`/evaluations/${evalId}/panel`, { method: 'POST', csrf, body: { userId: user, stream } })
          .then(() => onDone())
          .catch((er) => setError(problem(er)));
      }}
    >
      <p className="text-sm font-semibold">Add a replacement</p>
      <Select
        aria-label="Seat"
        value={stream}
        onChange={(e) => {
          setStream(e.target.value as typeof stream);
          setUser('');
        }}
      >
        <option value="TECHNICAL">Technical evaluator</option>
        <option value="COMMERCIAL">Commercial evaluator</option>
        <option value="OTHER">Chair</option>
      </Select>
      <Select aria-label="Person" value={user} onChange={(e) => setUser(e.target.value)}>
        <option value="">Choose a person…</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </Select>
      {error && (
        <p role="alert" className="text-sm font-medium text-error">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" variant="secondary" disabled={!user}>
          Add to panel
        </Button>
      </div>
    </form>
  );
}

function ScoreInput({
  c,
  value,
  onChange,
  label,
}: {
  c: EvalCriterion;
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return c.passFail ? (
    <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="w-32">
      <option value="">Choose…</option>
      <option value="10">Pass</option>
      <option value="0">Fail</option>
    </Select>
  ) : (
    <input
      aria-label={label}
      type="number"
      inputMode="decimal"
      min={0}
      max={10}
      step={0.5}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="min-h-[44px] w-28 rounded-md border border-border-strong bg-surface px-3 text-base text-text"
    />
  );
}

function ScoringSheet({ ev, csrf, onDone }: { ev: EvalView; csrf: string; onDone: () => Promise<void> }) {
  const [data, setData] = useState<MyScores | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<MyScores>(`/evaluations/${ev.id}/scores/mine`).then(
      (d) => {
        setData(d);
        const v: Record<string, string> = {};
        for (const s of d.suppliers)
          for (const x of s.scores) v[`${s.supplierId}:${x.criterionId}`] = String(x.score);
        setVals(v);
      },
      (e) => setError(problem(e)),
    );
  }, [ev.id]);

  if (!data)
    return (
      <Card id="score-h" title="Your scores">
        {error ? (
          <p role="alert" className="mt-2 text-sm font-medium text-error">
            {error}
          </p>
        ) : (
          <p className="mt-2 text-sm text-text-muted">Loading…</p>
        )}
      </Card>
    );

  async function save(supplierId: string) {
    setBusy(`save-${supplierId}`);
    setError(null);
    try {
      const scores = data!.criteria
        .map((c) => ({ criterionId: c.id, v: vals[`${supplierId}:${c.id}`] }))
        .filter((x) => x.v !== undefined && x.v !== '')
        .map((x) => ({
          criterionId: x.criterionId,
          score: Number(x.v),
          ...(notes[supplierId] ? { comment: notes[supplierId] } : {}),
        }));
      if (scores.length === 0) throw new Error('Enter at least one score');
      setData(
        await api<MyScores>(`/evaluations/${ev.id}/scores`, {
          method: 'PUT',
          csrf,
          body: { supplierId, scores },
        }),
      );
    } catch (e) {
      setError(e instanceof Error && !(e instanceof ApiError) ? e.message : problem(e));
    } finally {
      setBusy(null);
    }
  }
  async function submit() {
    setBusy('submit');
    setError(null);
    try {
      await api(`/evaluations/${ev.id}/scores/submit`, { method: 'POST', csrf, body: {} });
      await onDone();
    } catch (e) {
      setError(problem(e));
    } finally {
      setBusy(null);
    }
  }
  const filled = Object.values(vals).filter((v) => v !== '').length;
  const need = data.suppliers.length * data.criteria.length;
  return (
    <Card id="score-h" title="Your scores" tone="accent" testId="scoring-sheet">
      <p className="mt-2 text-sm text-text-muted">
        Score each supplier from 0 to 10 in half points. Nobody sees your scores until the chair opens
        consensus.{' '}
        <strong>
          {data.progress.done} of {need} saved
        </strong>
        {filled !== data.progress.done && ' (unsaved changes below)'}.
      </p>
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-error">
          {error}
        </p>
      )}
      <div className="mt-4 flex flex-col gap-4">
        {data.suppliers.map((s) => (
          <fieldset
            key={s.supplierId}
            className="rounded-lg border border-border p-4"
            data-testid="score-supplier"
          >
            <legend className="px-1 font-heading text-base font-bold">{s.displayName}</legend>
            <ul className="flex flex-col gap-3">
              {data.criteria.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 text-sm">
                    <span className="font-semibold">{c.name}</span>{' '}
                    <span className="text-text-muted">{c.passFail ? 'pass or fail' : `${c.weight}%`}</span>
                  </span>
                  <ScoreInput
                    c={c}
                    label={`${s.displayName}: ${c.name}`}
                    value={vals[`${s.supplierId}:${c.id}`] ?? ''}
                    onChange={(v) => setVals((cur) => ({ ...cur, [`${s.supplierId}:${c.id}`]: v }))}
                  />
                </li>
              ))}
            </ul>
            <div className="mt-3">
              <Field label="Comment (optional)">
                <Textarea
                  rows={2}
                  maxLength={2000}
                  value={notes[s.supplierId] ?? s.scores.find((x) => x.comment)?.comment ?? ''}
                  onChange={(e) => setNotes((cur) => ({ ...cur, [s.supplierId]: e.target.value }))}
                />
              </Field>
            </div>
            <div className="mt-3">
              <Button
                variant="secondary"
                loading={busy === `save-${s.supplierId}`}
                onClick={() => void save(s.supplierId)}
                aria-label={`Save scores for ${s.displayName}`}
              >
                Save scores
              </Button>
            </div>
          </fieldset>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button
          loading={busy === 'submit'}
          disabled={data.progress.done < need}
          onClick={() => void submit()}
        >
          Mark my scoring complete
        </Button>
        <span className="text-sm text-text-muted">After this you cannot change your scores.</span>
      </div>
    </Card>
  );
}

function ConsensusPanel({
  ev,
  csrf,
  onSaved,
  run,
  busy,
  post,
}: {
  ev: EvalView;
  csrf: string;
  onSaved: (e: EvalView) => void;
  run: (n: string, f: () => Promise<void>, ok?: string) => Promise<void>;
  busy: string | null;
  post: <T>(path: string, body?: unknown) => Promise<T>;
}) {
  const editable = ev.permissions.canSetConsensus;
  const [vals, setVals] = useState<Record<string, string>>({});
  const [why, setWhy] = useState<Record<string, string>>({});
  const key = (s: string, c: string) => `${s}:${c}`;
  const row = (s: string, c: string) => ev.consensus.find((x) => x.supplierId === s && x.criterionId === c);
  const value = (s: string, c: EvalCriterion) => {
    const k = key(s, c.id);
    if (vals[k] !== undefined) return vals[k]!;
    const r = row(s, c.id);
    return r?.consensusScore === null || r?.consensusScore === undefined ? '' : String(r.consensusScore);
  };
  const reason = (s: string, c: string) => why[key(s, c)] ?? row(s, c)?.rationale ?? '';

  /** The average of the individual scores, to the nearest half point: only a starting suggestion for agreeing scores. */
  const average = (s: string, c: string) => {
    const xs = row(s, c)?.individual?.map((i) => i.score) ?? [];
    return xs.length ? String(Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 2) / 2) : '';
  };
  const useAverages = () =>
    setVals((cur) => {
      const next = { ...cur };
      for (const r of ev.consensus)
        if (!r.flagged && r.consensusScore === null && next[key(r.supplierId, r.criterionId)] === undefined) {
          const c = ev.criteria.find((x) => x.id === r.criterionId);
          const a = average(r.supplierId, r.criterionId);
          if (a && c && !c.passFail) next[key(r.supplierId, r.criterionId)] = a;
        }
      return next;
    });
  const needReason = ev.consensus.filter(
    (r) => r.flagged && reason(r.supplierId, r.criterionId).trim().length < 10,
  ).length;

  async function save(supplierId: string) {
    const items = ev.criteria
      .filter((c) => row(supplierId, c.id))
      .map((c) => ({ criterionId: c.id, v: value(supplierId, c), r: reason(supplierId, c.id) }))
      .filter((x) => x.v !== '')
      .map((x) => ({
        criterionId: x.criterionId,
        consensusScore: Number(x.v),
        ...(x.r ? { rationale: x.r } : {}),
      }));
    onSaved(
      await api<EvalView>(`/evaluations/${ev.id}/consensus/${supplierId}`, {
        method: 'PUT',
        csrf,
        body: { items },
      }),
    );
  }
  return (
    <Card
      id="cons-h"
      title="Consensus"
      tone={editable ? 'accent' : undefined}
      testId="consensus-panel"
      badge={<Badge tone="warning">Difference limit {ev.varianceLimitPct}%</Badge>}
    >
      <p className="mt-2 text-sm text-text-muted">
        {editable
          ? 'Agree a score for each criterion. Any score where the panel differs by more than the limit is flagged and needs a recorded reason before you can lock.'
          : 'Read-only view of the consensus discussion.'}
      </p>
      {editable && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={useAverages}>
            Use the average where scorers agree
          </Button>
          <span className="text-sm text-text-muted" role="status">
            {needReason > 0
              ? `${needReason} flagged score(s) still need a reason.`
              : ev.consensus.some((r) => r.flagged)
                ? 'Every flagged score has a reason.'
                : 'No scores are flagged.'}
          </span>
        </div>
      )}
      <div className="mt-4 flex flex-col gap-4">
        {ev.suppliers.map((s) => (
          <fieldset
            key={s.supplierId}
            className="rounded-lg border border-border p-4"
            data-testid="consensus-supplier"
          >
            <legend className="px-1 font-heading text-base font-bold">{s.displayName}</legend>
            <ul className="flex flex-col gap-4">
              {ev.criteria
                .filter((c) => row(s.supplierId, c.id))
                .map((c) => {
                  const r = row(s.supplierId, c.id)!;
                  return (
                    <li
                      key={c.id}
                      className={cn(
                        'rounded-md p-3',
                        r.flagged ? 'border border-warning bg-warning-bg/40' : 'bg-surface-alt/60',
                      )}
                      data-flagged={r.flagged}
                      data-testid="consensus-item"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{c.name}</span>
                        {r.flagged && (
                          <Badge tone="warning">
                            <Flag className="size-3.5" aria-hidden="true" />
                            {r.variancePct}% apart: flagged
                          </Badge>
                        )}
                      </div>
                      {r.individual && (
                        <ul className="mt-2 flex flex-wrap gap-2 text-sm" aria-label="Individual scores">
                          {r.individual.map((i, n) => (
                            <li key={n} className="rounded-full border border-border bg-surface px-3 py-1">
                              {i.evaluator}: <strong>{i.score}</strong>
                            </li>
                          ))}
                        </ul>
                      )}
                      {editable ? (
                        <div className="mt-3 grid gap-3 sm:grid-cols-[8rem_1fr] sm:items-start">
                          <Field label="Consensus">
                            <ScoreInput
                              c={c}
                              label={`${s.displayName}: ${c.name} consensus`}
                              value={value(s.supplierId, c)}
                              onChange={(v) => setVals((cur) => ({ ...cur, [key(s.supplierId, c.id)]: v }))}
                            />
                          </Field>
                          <Field
                            label={
                              r.flagged ? 'Why the panel settled here (required)' : 'Rationale (optional)'
                            }
                          >
                            <Textarea
                              rows={2}
                              maxLength={2000}
                              value={reason(s.supplierId, c.id)}
                              onChange={(e) =>
                                setWhy((cur) => ({ ...cur, [key(s.supplierId, c.id)]: e.target.value }))
                              }
                            />
                          </Field>
                        </div>
                      ) : (
                        <p className="mt-2 text-sm">
                          Consensus: <strong>{r.consensusScore ?? 'not agreed yet'}</strong>
                          {r.rationale ? ` · ${r.rationale}` : ''}
                        </p>
                      )}
                    </li>
                  );
                })}
            </ul>
            {editable && (
              <div className="mt-3">
                <Button
                  variant="secondary"
                  loading={busy === `cons-${s.supplierId}`}
                  onClick={() =>
                    void run(`cons-${s.supplierId}`, () => save(s.supplierId), 'Consensus saved.')
                  }
                  aria-label={`Save consensus for ${s.displayName}`}
                >
                  Save consensus
                </Button>
              </div>
            )}
          </fieldset>
        ))}
      </div>
      {ev.permissions.canLock && (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <Button
            loading={busy === 'lock'}
            onClick={() =>
              void run(
                'lock',
                async () => onSaved(await post<EvalView>(`/evaluations/${ev.id}/consensus/lock`)),
                'Consensus locked.',
              )
            }
          >
            <Lock className="size-4" aria-hidden="true" />
            Lock consensus
          </Button>
          <span className="text-sm text-text-muted">
            Locking is refused while any flagged score has no reason.
          </span>
        </div>
      )}
    </Card>
  );
}

function ReportPanel({
  ev,
  csrf,
  busy,
  run,
  post,
  setEv,
}: {
  ev: EvalView;
  csrf: string;
  busy: string | null;
  run: (n: string, f: () => Promise<void>, ok?: string) => Promise<void>;
  post: <T>(path: string, body?: unknown) => Promise<T>;
  setEv: (e: EvalView) => void;
}) {
  const [comment, setComment] = useState('');
  const p = ev.permissions;
  const rep = ev.report;
  if (!rep && !p.canGenerateReport) return null;
  void csrf;
  return (
    <Card
      id="rep-h"
      title="Evaluation report"
      tone={p.canDecideReport ? 'accent' : undefined}
      testId="report-panel"
      badge={
        rep && (
          <Badge
            tone={rep.status === 'APPROVED' ? 'success' : rep.status === 'DRAFT' ? 'neutral' : 'warning'}
          >
            {rep.status === 'APPROVED'
              ? 'Approved'
              : rep.status === 'DRAFT'
                ? 'Needs regenerating'
                : 'Awaiting approval'}
          </Badge>
        )
      }
    >
      {rep && (
        <div className="mt-3">
          <Button asChild variant="secondary">
            <a href={`/api/v1/evaluations/${ev.id}/report/pdf`} download className="text-text no-underline">
              <FileDown className="size-4" aria-hidden="true" />
              Download PDF
            </a>
          </Button>
        </div>
      )}
      {p.canGenerateReport && (
        <div className="mt-3">
          <Button
            loading={busy === 'report'}
            onClick={() =>
              void run(
                'report',
                async () => setEv(await post<EvalView>(`/evaluations/${ev.id}/report`)),
                'Report generated from the locked consensus.',
              )
            }
          >
            {rep ? 'Regenerate report' : 'Generate report'}
          </Button>
        </div>
      )}
      {rep && (
        <>
          <p className="mt-2 text-sm text-text-muted">
            Generated {formatDateTime(rep.generatedAt)} from the locked consensus scores.
          </p>
          <div className="mt-3 flex flex-col gap-4">
            {rep.sections.map((s) => (
              <section key={s.key} aria-label={s.label} data-report-section={s.key}>
                <h3 className="font-heading text-base font-bold">{s.label}</h3>
                <div className="mt-1 flex flex-col gap-2 text-sm">
                  {s.paragraphs.map((t, i) => (
                    <p key={i} className="max-w-prose whitespace-pre-wrap">
                      {t}
                    </p>
                  ))}
                </div>
              </section>
            ))}
          </div>
          {rep.decision && (
            <p
              className="mt-3 rounded-md border-2 border-success px-3 py-2 text-sm font-semibold text-success"
              data-testid="report-stamp"
            >
              {rep.decision.stamp}
            </p>
          )}
        </>
      )}
      {p.canDecideReport && (
        <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4">
          <Field label="Comment (required to return the report)">
            <Textarea
              rows={2}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={2000}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              loading={busy === 'approve'}
              onClick={() =>
                void run('approve', async () =>
                  setEv(
                    await post<EvalView>(`/evaluation-reports/${rep!.id}/decision`, {
                      decision: 'APPROVE',
                      comment: comment || undefined,
                    }),
                  ),
                )
              }
            >
              Approve report
            </Button>
            <Button
              variant="secondary"
              disabled={comment.trim().length < 5}
              loading={busy === 'return'}
              onClick={() =>
                void run('return', async () =>
                  setEv(
                    await post<EvalView>(`/evaluation-reports/${rep!.id}/decision`, {
                      decision: 'REJECT',
                      comment,
                    }),
                  ),
                )
              }
            >
              Return to procurement
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

/** Says where the evaluation is, what is happening and what comes next, so the page is never an unexplained empty space. */
function StageGuide({ ev }: { ev: EvalView }) {
  const live = ev.panel.filter((m) => m.coiState !== 'REMOVED' && m.coiState !== 'DECLARED_CONFLICT');
  const declared = live.filter((m) => m.coiState === 'DECLARED_NONE').length;
  const finished = live.filter((m) => m.scoringComplete).length;
  const awaiting = ev.panel.filter((m) => m.coiState === 'DECLARED_CONFLICT').length;
  const roster = ev.panel.length > 1; // only people who run the evaluation can see everyone
  const flagged = ev.consensus.filter((c) => c.flagged).length;
  const text: Record<EvalView['status'], { title: string; body: string }> = {
    COI_PENDING: {
      title: 'Waiting for conflict declarations',
      body: `${roster ? `${declared} of ${live.length} panel members have declared. ` : ''}${awaiting ? `${awaiting} declared conflict(s) are waiting for a delegate to decide. ` : ''}Scoring opens when every member has declared and every conflict is decided.`,
    },
    SCORING: {
      title: 'Evaluators are scoring independently',
      body: `${roster ? `${finished} of ${live.length} have finished. ` : ''}Scores stay hidden from everyone, including the chair, until the chair opens consensus.`,
    },
    CONSENSUS: {
      title: 'The chair is agreeing consensus scores',
      body: `${flagged ? `${flagged} score(s) differ by more than ${ev.varianceLimitPct}% and need a recorded reason. ` : ''}The consensus is shown to procurement, delegates and the executive once it is locked.`,
    },
    LOCKED: { title: 'Consensus is locked', body: 'Procurement generates the evaluation report next.' },
    REPORTED: {
      title:
        ev.report?.status === 'DRAFT'
          ? 'The report needs regenerating'
          : 'The report is waiting for approval',
      body:
        ev.report?.status === 'DRAFT'
          ? 'Consensus was reopened, so the earlier report no longer stands. It is regenerated after the chair locks again.'
          : 'A delegate, or the executive for larger awards, approves or returns it.',
    },
    APPROVED: { title: 'The report is approved', body: 'The award can proceed to contract.' },
  };
  const s = text[ev.status];
  return (
    <section
      aria-labelledby="stage-h"
      data-testid="stage-guide"
      className="flex items-start gap-3 rounded-lg border border-border bg-surface p-5 shadow-sm"
    >
      <span className="icon-tile shrink-0">
        <Info className="size-5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <h2 id="stage-h" className="font-heading text-lg font-bold">
          {s.title}
        </h2>
        <p className="mt-1 text-sm text-text-muted">{s.body}</p>
      </div>
    </section>
  );
}

const DISPOSITION: Record<string, string> = {
  PENDING: 'Awaiting decision',
  IMMATERIAL: 'Immaterial: reinstated',
  MANAGEABLE: 'Manageable: reinstated',
  MATERIAL: 'Material: removed',
};

/** Declared conflicts: a delegate (or the executive) decides each one; everyone else on the process can see them. */
function ConflictReview({
  ev,
  csrf,
  onDone,
  run,
  busy,
}: {
  ev: EvalView;
  csrf: string;
  onDone: (e: EvalView) => void;
  run: (n: string, f: () => Promise<void>, ok?: string) => Promise<void>;
  busy: string | null;
}) {
  const [why, setWhy] = useState<Record<string, string>>({});
  const decide = (userId: string, disposition: 'IMMATERIAL' | 'MANAGEABLE' | 'MATERIAL') =>
    run(
      `conflict-${userId}`,
      async () =>
        onDone(
          await api<EvalView>(`/evaluations/${ev.id}/conflicts/${userId}/decision`, {
            method: 'POST',
            csrf,
            body: { disposition, ...(why[userId] ? { rationale: why[userId] } : {}) },
          }),
        ),
      'Decision recorded.',
    );
  return (
    <Card
      id="conf-h"
      title="Declared conflicts"
      tone={ev.permissions.canDecideConflict ? 'warning' : undefined}
      testId="conflict-review"
    >
      <ul className="mt-3 flex flex-col gap-3">
        {ev.conflicts.map((c) => (
          <li
            key={c.userId}
            className="rounded-md border border-border p-3 text-sm"
            data-conflict={c.disposition}
          >
            <div className="flex flex-wrap items-center gap-2">
              <strong>{c.name}</strong>
              <Badge
                tone={
                  c.disposition === 'PENDING' ? 'warning' : c.disposition === 'MATERIAL' ? 'error' : 'success'
                }
              >
                {DISPOSITION[c.disposition]}
              </Badge>
            </div>
            <p className="mt-1">{c.nature}</p>
            {c.subjectOrg && <p className="text-text-muted">Concerning: {c.subjectOrg}</p>}
            {ev.permissions.canDecideConflict && c.disposition === 'PENDING' && (
              <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                <Field label="Reason for your decision (optional)">
                  <Textarea
                    rows={2}
                    maxLength={2000}
                    value={why[c.userId] ?? ''}
                    onChange={(e) => setWhy((cur) => ({ ...cur, [c.userId]: e.target.value }))}
                  />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    loading={busy === `conflict-${c.userId}`}
                    onClick={() => void decide(c.userId, 'IMMATERIAL')}
                    aria-label={`Immaterial: reinstate ${c.name}`}
                  >
                    Immaterial: reinstate
                  </Button>
                  <Button
                    variant="secondary"
                    loading={busy === `conflict-${c.userId}`}
                    onClick={() => void decide(c.userId, 'MANAGEABLE')}
                    aria-label={`Manageable: reinstate ${c.name}`}
                  >
                    Manageable: reinstate
                  </Button>
                  <Button
                    loading={busy === `conflict-${c.userId}`}
                    onClick={() => void decide(c.userId, 'MATERIAL')}
                    aria-label={`Material: remove ${c.name}`}
                  >
                    Material: remove
                  </Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** The chair can reopen a locked consensus, with a recorded reason. Any report written from the old scores is invalidated. */
function ReopenCard({ ev, csrf, onDone }: { ev: EvalView; csrf: string; onDone: (e: EvalView) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      onDone(
        await api<EvalView>(`/evaluations/${ev.id}/consensus/reopen`, {
          method: 'POST',
          csrf,
          body: { reason },
        }),
      );
      setOpen(false);
      setReason('');
    } catch (e) {
      setError(problem(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Card id="reopen-h" title="Reopen consensus" testId="reopen-card">
        <p className="mt-2 text-sm text-text-muted">
          If something needs to change after the lock, reopen it with a reason. Agreed values are kept,
          individual scores stay frozen, and the report has to be generated again after you lock.
        </p>
        <div className="mt-3">
          <Button variant="secondary" onClick={() => setOpen(true)}>
            <RotateCcw className="size-4" aria-hidden="true" />
            Reopen consensus
          </Button>
        </div>
      </Card>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Reopen consensus?"
        description="The reason is recorded in the audit trail and sent to procurement, the delegates and probity."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button loading={busy} disabled={reason.trim().length < 10} onClick={() => void go()}>
              Reopen
            </Button>
          </>
        }
      >
        <Field label="Reason (at least 10 characters)" required>
          <Textarea rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {error && (
          <p role="alert" className="mt-2 text-sm font-medium text-error">
            {error}
          </p>
        )}
      </Dialog>
    </>
  );
}
