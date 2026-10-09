'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AiBadge, Badge, Button, EmptyState, Field, Textarea, type BadgeTone } from '@if/ui';
import { api } from '@/lib/api-client';
import { message as problemText } from '@/components/contract/b5-shared';
import { appendSpoken, useDictation } from '../voice/use-dictation';
import { VoiceButton, VoiceStatus } from '../voice/voice-button';

export const STATUS_TONE: Record<string, BadgeTone> = {
  RUNNING: 'info',
  WAITING_GATE: 'warning',
  NEEDS_HUMAN: 'error',
  PAUSED: 'neutral',
  COMPLETED: 'success',
  FAILED: 'error',
  CANCELLED: 'neutral',
};
export const STATUS_TEXT: Record<string, string> = {
  RUNNING: 'Running',
  WAITING_GATE: 'Waiting for a person',
  NEEDS_HUMAN: 'Needs a person',
  PAUSED: 'Paused',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};
export function StatusChip({ status }: { status: string }) {
  return (
    <Badge tone={STATUS_TONE[status] ?? 'neutral'}>
      <span data-testid="run-status" data-status={status}>
        {STATUS_TEXT[status] ?? status}
      </span>
    </Badge>
  );
}

interface RunBrief {
  id: string;
  title: string;
  status: string;
  stage: string;
  requestNumber: string | null;
  currentAction: string | null;
  startedBy: { name: string };
  updatedAt: string;
}

/** The list of runs and the box to start one from typed or dictated text (CP-01, CP-03). */
export function CopilotHome({ csrf, initialText = '' }: { csrf: string; initialText?: string }) {
  const router = useRouter();
  const [runs, setRuns] = useState<RunBrief[] | null>(null);
  const [scope, setScope] = useState('MINE');
  const [text, setText] = useState(initialText);
  const [mode, setMode] = useState<'FULL' | 'ASSISTED'>('FULL');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const voice = useDictation((spoken) => setText((cur) => appendSpoken(cur, spoken)));
  const load = useCallback(async () => {
    try {
      const r = await api<{ items: RunBrief[]; scope: string }>('/copilot/runs');
      setRuns(r.items);
      setScope(r.scope);
    } catch (e) {
      setError(problemText(e));
    }
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [load]);

  async function startRun() {
    setBusy(true);
    setError(null);
    try {
      const v = await api<{ run: { id: string } }>('/copilot/runs', {
        method: 'POST',
        csrf,
        body: { text: text.trim(), mode, source: 'TEXT' },
      });
      router.push(`/app/copilot/${v.run.id}`);
    } catch (e) {
      setError(problemText(e));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="start" className="rounded-lg border border-border bg-surface p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="start" className="font-heading text-lg font-semibold">
            Run this for me
          </h2>
          <AiBadge />
          <Badge tone="info">SIMULATED · rules-simulated-v1</Badge>
        </div>
        <p className="mt-1 max-w-prose text-sm text-text-muted">
          Describe what you need, typed or spoken. The Copilot acts as you through the normal screens&apos;
          rules and stops wherever a person must decide: it never approves, signs, scores or declares.
        </p>
        <form
          className="mt-3 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void startRun();
          }}
        >
          <Field
            label="What do you need?"
            hint="For example: Cleaning services for head office, about $90,000 over 24 months."
          >
            <Textarea
              rows={3}
              maxLength={4000}
              value={text}
              onChange={(e) => setText(e.target.value)}
              data-testid="copilot-text"
            />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <VoiceButton state={voice.state} onStart={voice.start} onStop={voice.stop} />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={mode === 'ASSISTED'}
                onChange={(e) => setMode(e.target.checked ? 'ASSISTED' : 'FULL')}
              />
              One step at a time (I press Advance)
            </label>
            <Button type="submit" disabled={busy || text.trim().length < 3} data-testid="copilot-start">
              {busy ? 'Starting…' : 'Start'}
            </Button>
          </div>
          <VoiceStatus state={voice.state} interim={voice.interim} error={voice.error} />
          {error && (
            <p role="alert" className="text-sm font-medium text-error">
              {error}
            </p>
          )}
        </form>
      </section>

      <section aria-labelledby="runs">
        <h2 id="runs" className="font-heading text-lg font-semibold">
          {scope === 'ALL' ? 'All runs in the organisation' : 'My runs'}
        </h2>
        {runs === null ? (
          <p className="mt-2 text-text-muted">Loading…</p>
        ) : runs.length === 0 ? (
          <EmptyState title="No runs yet" body="Start one above and watch it work." />
        ) : (
          <ul className="mt-3 flex flex-col gap-3" data-testid="run-list">
            {runs.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/app/copilot/${r.id}`}
                  className="flex min-h-[44px] flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-4 text-text no-underline shadow-sm hover:bg-surface-alt"
                >
                  <StatusChip status={r.status} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{r.title}</span>
                    <span className="block text-sm text-text-muted">
                      {r.requestNumber ? `${r.requestNumber} · ` : ''}
                      {r.stage.charAt(0) + r.stage.slice(1).toLowerCase()} · {r.startedBy.name}
                      {r.currentAction ? ` · ${r.currentAction}` : ''}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

interface Step {
  id: string;
  seq: number;
  agentLabel: string;
  status: string;
  title: string;
  reason: string;
  rule: string;
  tool: string | null;
  durationMs: number;
  at: string;
}
interface Gate {
  id: string;
  kind: string;
  title: string;
  reason: string;
  link: string;
  roles: string[];
  names: string[];
  status: string;
}
interface Attempt {
  n: number;
  label: string;
  outcome: string;
  note: string;
}
interface Problem {
  id: string;
  title: string;
  status: string;
  attempts: Attempt[];
  escalatedTo: string[];
}
interface Detail {
  run: RunBrief & {
    sourceText: string;
    mode: string;
    currentAgentLabel: string;
    startedBy: { name: string; role: string };
  };
  procurement: { number: string; title: string; link: string } | null;
  stages: Array<{ key: string; label: string; state: 'DONE' | 'CURRENT' | 'TODO' }>;
  steps: Step[];
  gates: Gate[];
  agents: Array<{ key: string; label: string; steps: number; current: boolean }>;
  handoffs: Array<{ id: string; fromLabel: string; toLabel: string; reason: string }>;
  problems: Problem[];
  assumptions: string[];
}
interface FeedEvent {
  seq: number;
  at: string;
  kind: string;
  agentLabel: string;
  title: string;
  detail: string;
}

const KIND_TONE: Record<string, BadgeTone> = {
  STEP: 'success',
  GATE: 'warning',
  PROBLEM: 'error',
  REPAIR: 'info',
  HANDOFF: 'neutral',
  STATUS: 'neutral',
  NOTE: 'neutral',
};

/** The live run page (CP-03): timeline, activity feed, who it is waiting for, problems and repairs, and the controls. */
export function RunPage({ id, csrf, canControl }: { id: string; csrf: string; canControl: boolean }) {
  const [d, setD] = useState<Detail | null>(null);
  const [feed, setFeed] = useState<FeedEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const cursor = useRef(0);
  const status = useRef('');

  const loadDetail = useCallback(async () => {
    try {
      const v = await api<Detail>(`/copilot/runs/${id}`);
      setD(v);
      status.current = v.run.status;
    } catch (e) {
      setError(problemText(e));
    }
  }, [id]);
  const poll = useCallback(async () => {
    try {
      const r = await api<{ events: FeedEvent[]; cursor: number; status: string }>(
        `/copilot/runs/${id}/events?after=${cursor.current}`,
      );
      if (r.events.length) {
        cursor.current = Math.max(cursor.current, r.cursor);
        // two polls can overlap (the timer, a button press, the first load) and fetch the same events: keep each once
        setFeed((f) => {
          const seen = new Set(f.map((e) => e.seq));
          return [...f, ...r.events.filter((e) => !seen.has(e.seq))].slice(-300);
        });
      }
      if (r.events.length || r.status !== status.current) await loadDetail();
    } catch {
      /* the next poll tries again */
    }
  }, [id, loadDetail]);
  useEffect(() => {
    void loadDetail().then(() => poll());
    const t = setInterval(() => void poll(), 3000);
    return () => clearInterval(t);
  }, [loadDetail, poll]);

  async function act(name: string, label: string) {
    setBusy(name);
    setError(null);
    setNote(null);
    try {
      const v = await api<
        Detail & { result?: { bids?: Array<{ supplier: string; outcome: string; note: string }> } }
      >(`/copilot/runs/${id}/${name}`, { method: 'POST', csrf });
      setD(v);
      status.current = v.run.status;
      if (v.result?.bids)
        setNote(`SIMULATED: ${v.result.bids.map((b) => `${b.supplier}: ${b.note}`).join('; ')}`);
      else setNote(`${label} done`);
      await poll();
    } catch (e) {
      setError(problemText(e));
    } finally {
      setBusy(null);
    }
  }

  if (error && !d)
    return (
      <p role="alert" className="font-medium text-error">
        {error}
      </p>
    );
  if (!d) return <p className="text-text-muted">Loading…</p>;
  const finished = ['COMPLETED', 'CANCELLED', 'FAILED'].includes(d.run.status);
  const open = d.gates.filter((g) => g.status === 'OPEN');
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{d.run.title}</h1>
          <StatusChip status={d.run.status} />
          <AiBadge />
          <Badge tone="info">SIMULATED</Badge>
        </div>
        <p className="text-sm text-text-muted">
          Acting as {d.run.startedBy.name} ({d.run.startedBy.role.replace('_', ' ').toLowerCase()}) ·{' '}
          {d.procurement ? (
            <Link href={d.procurement.link} className="font-semibold underline">
              {d.procurement.number}
            </Link>
          ) : (
            'no request yet'
          )}{' '}
          · now: <span data-testid="current-action">{d.run.currentAction ?? 'starting'}</span> (
          {d.run.currentAgentLabel})
        </p>
      </header>

      <ol
        aria-label="Stage timeline"
        className="grid grid-cols-3 gap-2 sm:grid-cols-6"
        data-testid="timeline"
      >
        {d.stages.map((s) => (
          <li
            key={s.key}
            aria-current={s.state === 'CURRENT' ? 'step' : undefined}
            data-state={s.state}
            className={`rounded-md border px-2 py-2 text-center text-sm font-semibold ${
              s.state === 'CURRENT'
                ? 'border-accent bg-accent/10 text-accent'
                : s.state === 'DONE'
                  ? 'border-success bg-success-bg text-success'
                  : 'border-border bg-surface text-text-muted'
            }`}
          >
            {s.label}
            <span className="sr-only">
              {s.state === 'DONE' ? ' (done)' : s.state === 'CURRENT' ? ' (current)' : ' (not yet)'}
            </span>
          </li>
        ))}
      </ol>

      <section aria-label="Controls" className="flex flex-wrap items-center gap-2">
        {canControl && !finished && (
          <>
            <Button
              disabled={busy !== null || d.run.status === 'PAUSED'}
              onClick={() => void act('advance', 'Advance')}
              data-testid="advance"
            >
              {busy === 'advance' ? 'Working…' : 'Advance now'}
            </Button>
            {d.run.status === 'PAUSED' ? (
              <Button
                variant="secondary"
                disabled={busy !== null}
                onClick={() => void act('resume', 'Resume')}
              >
                Resume
              </Button>
            ) : (
              <Button variant="secondary" disabled={busy !== null} onClick={() => void act('pause', 'Pause')}>
                Pause
              </Button>
            )}
            <Button variant="danger" disabled={busy !== null} onClick={() => void act('cancel', 'Cancel')}>
              Cancel run
            </Button>
            {d.run.stage === 'TENDER' && d.run.status !== 'PAUSED' && (
              <Button
                variant="accent"
                disabled={busy !== null}
                onClick={() => void act('simulate-suppliers', 'Simulated responses')}
                data-testid="simulate"
              >
                Simulate supplier responses (SIMULATED)
              </Button>
            )}
            {d.run.stage === 'TENDER' && d.run.status !== 'PAUSED' && (
              <Button
                variant="secondary"
                disabled={busy !== null}
                onClick={() => void act('simulate-close', 'Simulated closing time')}
                data-testid="simulate-close"
                title="Demonstration only: skips the statutory open period so the run can move on to evaluation. Needs at least one bid."
              >
                Simulate closing time (SIMULATED)
              </Button>
            )}
          </>
        )}
        {note && (
          <p role="status" className="text-sm font-medium text-success">
            {note}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm font-medium text-error">
            {error}
          </p>
        )}
      </section>

      <section aria-labelledby="waiting" className="flex flex-col gap-3">
        <h2 id="waiting" className="font-heading text-lg font-semibold">
          Waiting for
        </h2>
        {open.length === 0 ? (
          <p className="text-text-muted">
            {finished ? 'Nothing: this run has finished.' : 'Nobody. The Copilot is moving on its own.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-3" data-testid="waiting-cards">
            {open.map((g) => (
              <li key={g.id} className="rounded-lg border border-warning bg-warning-bg p-4 text-text">
                <p className="font-semibold">{g.title}</p>
                <p className="text-sm">{g.reason}</p>
                <p className="mt-1 text-sm">
                  <strong>Who:</strong> {g.names.length ? g.names.join(', ') : g.roles.join(', ')}
                  {g.roles.length && g.names.length ? ` (${g.roles.join(', ').toLowerCase()})` : ''} ·{' '}
                  <Link href={g.link} className="font-semibold underline">
                    Open where it is done
                  </Link>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="feed" className="min-w-0">
          <h2 id="feed" className="font-heading text-lg font-semibold">
            Live activity
          </h2>
          <p className="text-xs text-text-muted">Updates every 3 seconds.</p>
          <ol
            className="mt-2 flex max-h-[28rem] flex-col gap-2 overflow-y-auto"
            data-testid="feed"
            tabIndex={0}
            aria-label="Live activity feed"
            aria-live="polite"
          >
            {[...feed].reverse().map((e) => (
              <li key={e.seq} className="rounded-md border border-border bg-surface p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={KIND_TONE[e.kind] ?? 'neutral'}>{e.kind.toLowerCase()}</Badge>
                  <span className="font-semibold">{e.title}</span>
                </div>
                <p className="mt-1 text-text-muted">
                  {e.agentLabel} · {new Date(e.at).toISOString().slice(11, 19)} UTC
                </p>
                {e.detail && <p className="mt-1">{e.detail}</p>}
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="problems" className="min-w-0">
          <h2 id="problems" className="font-heading text-lg font-semibold">
            Problems and repairs
          </h2>
          {d.problems.length === 0 ? (
            <p className="mt-2 text-text-muted">No problems so far.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-3" data-testid="problems">
              {d.problems.map((p) => (
                <li key={p.id} className="rounded-md border border-border bg-surface p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      tone={
                        p.status === 'REPAIRED' || p.status === 'RESOLVED'
                          ? 'success'
                          : p.status === 'ESCALATED'
                            ? 'error'
                            : 'warning'
                      }
                    >
                      {p.status.toLowerCase()}
                    </Badge>
                    <span className="font-semibold">{p.title}</span>
                  </div>
                  <ol className="mt-2 list-decimal pl-5">
                    {p.attempts.map((a) => (
                      <li key={a.n}>
                        {a.label}: {a.note} <em>({a.outcome.toLowerCase().replace('_', ' ')})</em>
                      </li>
                    ))}
                  </ol>
                  {p.status === 'ESCALATED' && <p className="mt-2">Raised to {p.escalatedTo.join(', ')}.</p>}
                </li>
              ))}
            </ul>
          )}
          {d.assumptions.length > 0 && (
            <p className="mt-3 text-sm">
              <strong>Assumed (please confirm):</strong> {d.assumptions.join('; ')}
            </p>
          )}
        </section>
      </div>

      <section aria-labelledby="agents">
        <h2 id="agents" className="font-heading text-lg font-semibold">
          Specialist agents and hand-offs
        </h2>
        <ul className="mt-2 flex flex-wrap gap-2">
          {d.agents.map((a) => (
            <li key={a.key}>
              <Badge tone={a.current ? 'info' : 'neutral'}>
                {a.label}: {a.steps} step{a.steps === 1 ? '' : 's'}
              </Badge>
            </li>
          ))}
        </ul>
        <ul className="mt-2 text-sm text-text-muted">
          {d.handoffs.slice(-6).map((h) => (
            <li key={h.id}>
              {h.fromLabel} → {h.toLabel}: {h.reason}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="steps">
        <h2 id="steps" className="font-heading text-lg font-semibold">
          Step log
        </h2>
        <ol className="mt-2 flex flex-col gap-2" data-testid="steps">
          {d.steps.map((s) => (
            <li key={s.id} className="rounded-md border border-border bg-surface p-3 text-sm">
              <span className="font-semibold">
                {s.seq}. {s.title}
              </span>{' '}
              <Badge tone={s.status === 'FAILED' ? 'error' : s.status === 'REPAIRED' ? 'info' : 'success'}>
                {s.status.toLowerCase().replace('_', ' ')}
              </Badge>
              <p className="text-text-muted">
                {s.agentLabel}
                {s.tool ? ` · ${s.tool}` : ''} · {s.durationMs} ms
              </p>
              <p>Why: {s.reason}</p>
              <p className="text-text-muted">Rule: {s.rule}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export interface CopilotSummary {
  active: number;
  waitingForPerson: number;
  repaired: number;
  completed: number;
  waitingOnMe: number;
}
