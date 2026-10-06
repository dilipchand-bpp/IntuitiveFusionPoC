'use client';
import { AmendmentFallback } from './amendment-fallback';
import {
  Banknote,
  CheckCircle2,
  CircleDashed,
  ClipboardCheck,
  Gauge,
  Lock,
  Pencil,
  ShieldCheck,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { AiBadge, Badge, Button, Dialog, Field, Input, Stamp, Textarea, cn } from '@if/ui';
import { ApiError, api } from '@/lib/api-client';
import {
  COI_LABEL,
  COI_TONE,
  COMPLEXITY_LABEL,
  COMPLEXITY_TONE,
  PLAN_STATUS_LABEL,
  PLAN_STATUS_TONE,
  aud,
} from '@/lib/labels';
import { appendSpoken, useDictation } from '../voice/use-dictation';
import { VoiceButton, VoiceStatus } from '../voice/voice-button';
import type { PlanConflict, PlanField, PlanView } from './types';

const when = new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short' });

/** A card in the right-hand rail. `accent` marks the panel the viewer is expected to act on. */
function Panel({
  id,
  title,
  children,
  accent,
  badge,
  testId,
}: {
  id: string;
  title: string;
  children: ReactNode;
  accent?: 'accent' | 'warning';
  badge?: ReactNode;
  testId?: string;
}) {
  return (
    <section
      aria-labelledby={id}
      data-testid={testId}
      className={cn(
        'relative overflow-hidden rounded-lg border bg-surface p-5 shadow-sm',
        accent === 'accent' && 'border-accent',
        accent === 'warning' && 'border-warning',
        !accent && 'border-border',
      )}
    >
      {accent && (
        <span
          aria-hidden="true"
          className={cn(
            'absolute inset-x-0 top-0 h-1',
            accent === 'accent' ? 'bg-brand-gradient' : 'bg-warning',
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

function Fact({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-surface-alt/60 p-3">
      <dt className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-text-muted">
        <Icon className="size-4 shrink-0 text-accent" aria-hidden="true" />
        {label}
      </dt>
      <dd className="mt-1 min-w-0 break-words font-heading text-lg font-bold leading-tight">{children}</dd>
    </div>
  );
}

/** Everything about one plan: key points, sections with per-paragraph numbering, instruction box, conflicts, decisions. */
export function PlanWorkspace({ plan, csrf, userId }: { plan: PlanView; csrf: string; userId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [instruction, setInstruction] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const voice = useDictation((spoken) => setInstruction((cur) => appendSpoken(cur, spoken)));
  const [undoToken, setUndoToken] = useState<string | undefined>(plan.undoToken);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [comment, setComment] = useState('');
  const [reopen, setReopen] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [conflictMode, setConflictMode] = useState<'none' | 'conflict'>('none');
  const [nature, setNature] = useState('');
  const p = plan.permissions;

  async function run<T>(label: string, fn: () => Promise<T>, done?: (r: T) => void) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      const r = await fn();
      done?.(r);
      router.refresh();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? [e.message, ...(e.problem.errors ?? []).map((x) => x.message)].join(' – ')
          : 'Something went wrong. Please try again.',
      );
    } finally {
      setBusy(null);
    }
  }
  const post = <T,>(path: string, body?: unknown) => api<T>(path, { method: 'POST', csrf, body: body ?? {} });

  const saveField = (f: PlanField) =>
    run(
      'save',
      () =>
        api(`/plans/${plan.id}/fields/${f.key}`, {
          method: 'PUT',
          csrf,
          body: { value: draft, expectedRev: f.rev ?? 0 },
        }),
      () => {
        setEditKey(null);
        setUndoToken(undefined);
      },
    );

  const sendInstruction = () =>
    run(
      'instruct',
      () =>
        post<{ applied: unknown[]; undoToken?: string; explanation: string; fallbackHint?: string }>(
          `/plans/${plan.id}/instructions`,
          { text: instruction },
        ),
      (r) => {
        setHint(r.fallbackHint ?? null);
        setNotice(r.applied.length ? r.explanation : null);
        setUndoToken(r.undoToken);
        if (r.applied.length) setInstruction('');
      },
    );

  const statusTone = PLAN_STATUS_TONE[plan.status] ?? 'neutral';
  const approverBox = p.canApprove || (plan.status === 'AWAITING_APPROVAL' && p.reason);
  const gatesDone = plan.gates.filter((g) => g.status === 'SATISFIED').length;
  const stampOf = (a: PlanView['approvals'][number]) => ({
    who: a.userName || (a.stamp ?? '').split(' · ')[1] || '',
    role: a.role.replace('_', ' '),
    when: when.format(new Date(a.decidedAt)),
  });

  return (
    <div className="flex flex-col gap-6" data-testid="plan-workspace" data-plan-status={plan.status}>
      <header className="flex flex-wrap items-center gap-2">
        <Badge tone={statusTone} className="text-sm">
          {plan.locked && <Lock className="size-3.5" aria-hidden="true" />}
          {PLAN_STATUS_LABEL[plan.status] ?? plan.status}
        </Badge>
        {plan.complexity && (
          <Badge tone={COMPLEXITY_TONE[plan.complexity] ?? 'neutral'}>
            Complexity: {COMPLEXITY_LABEL[plan.complexity]}
          </Badge>
        )}
        <Badge tone="neutral">{aud.format(plan.estimatedValue)}</Badge>
      </header>

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

      {/* Key points first: on a phone the approver sees what they need, then the decision, then the detail. */}
      <section
        aria-labelledby="kp-h"
        className="relative overflow-hidden rounded-lg border border-border bg-surface p-5 shadow-sm"
        data-testid="key-points"
      >
        <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-brand-gradient" />
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="kp-h" className="font-heading text-xl font-bold">
            Key points
          </h2>
          <AiBadge />
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Fact icon={Banknote} label="Value">
            {aud.format(plan.estimatedValue)}
          </Fact>
          <Fact icon={Gauge} label="Complexity">
            {plan.complexity ? COMPLEXITY_LABEL[plan.complexity] : '–'}
          </Fact>
          <Fact icon={ShieldCheck} label="Plan status">
            {PLAN_STATUS_LABEL[plan.status] ?? plan.status}
          </Fact>
          <Fact icon={ClipboardCheck} label="Checks">
            {plan.gates.length === 0 ? 'None needed' : `${gatesDone} of ${plan.gates.length} done`}
          </Fact>
        </dl>

        <ul className="mt-4 flex flex-col gap-2 text-sm">
          {plan.summaryPoints.map((s) => (
            <li key={s} className="flex gap-2">
              <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />
              {s}
            </li>
          ))}
        </ul>

        {plan.approvals.length > 0 && (
          <ul
            className="mt-4 flex flex-wrap items-start gap-3 border-t border-border pt-4"
            aria-label="Approval record"
          >
            {plan.approvals.map((a) =>
              a.decision === 'APPROVED' ? (
                <li key={a.id}>
                  <Stamp label={a.subject === 'PLAN_RISK' ? 'Risk signed off' : 'Approved'} {...stampOf(a)} />
                </li>
              ) : (
                <li key={a.id} className="text-sm text-text-muted">
                  <Badge tone={a.decision === 'REJECTED' ? 'error' : 'neutral'}>
                    {a.decision === 'REJECTED' ? 'Returned' : 'Superseded'}
                  </Badge>{' '}
                  {a.stamp ?? ''}
                  {a.comment ? ` – ${a.comment}` : ''}
                </li>
              ),
            )}
          </ul>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        {/* The rail comes first in the page so a phone shows the decision before the long plan text. */}
        <aside aria-label="Decision, checks and assistant" className="flex flex-col gap-4 lg:order-2">
          {approverBox && (
            <Panel id="dec-h" title="Your decision" accent="accent" testId="decision-panel">
              {p.reason && !p.canApprove && (
                <p className="mt-2 text-sm font-medium text-warning">{p.reason}</p>
              )}
              <div className="mt-3 flex flex-col gap-3">
                <Field label="Comment (required to return the plan)">
                  <Textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={2}
                    maxLength={2000}
                  />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="accent"
                    disabled={!p.canApprove}
                    loading={busy === 'approve'}
                    onClick={() =>
                      run('approve', () =>
                        post(`/plans/${plan.id}/decision`, {
                          decision: 'APPROVE',
                          comment: comment || undefined,
                        }),
                      )
                    }
                  >
                    Approve and lock
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={comment.trim().length < 5}
                    loading={busy === 'reject'}
                    onClick={() =>
                      run('reject', () => post(`/plans/${plan.id}/decision`, { decision: 'REJECT', comment }))
                    }
                  >
                    Return to procurement
                  </Button>
                </div>
              </div>
            </Panel>
          )}

          {p.canSignOffRisk && (
            <Panel id="risk-h" title="Independent risk sign-off" accent="warning" testId="risk-panel">
              <p className="mt-2 text-sm text-text-muted">
                This plan cannot go to the approver until you have reviewed the risks and conflicts.
              </p>
              <div className="mt-3 flex flex-col gap-3">
                <Field label="Comment">
                  <Textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={2}
                    maxLength={2000}
                  />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button
                    loading={busy === 'risk'}
                    onClick={() =>
                      run('risk', () =>
                        post(`/plans/${plan.id}/decision`, {
                          decision: 'APPROVE',
                          gate: 'RISK_SIGNOFF',
                          comment: comment || undefined,
                        }),
                      )
                    }
                  >
                    Sign off risk
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={comment.trim().length < 5}
                    onClick={() =>
                      run('riskrej', () =>
                        post(`/plans/${plan.id}/decision`, {
                          decision: 'REJECT',
                          gate: 'RISK_SIGNOFF',
                          comment,
                        }),
                      )
                    }
                  >
                    Return to procurement
                  </Button>
                </div>
              </div>
            </Panel>
          )}

          <Panel id="gates-h" title="Required checks">
            {plan.gates.length === 0 ? (
              <p className="mt-2 text-sm text-text-muted">
                No extra checks are required for a plan at this complexity.
              </p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {plan.gates.map((g) => {
                  const done = g.status === 'SATISFIED';
                  return (
                    <li
                      key={g.key}
                      className="flex items-center gap-3 rounded-md border border-border bg-surface-alt/60 px-3 py-2"
                      data-gate={g.key}
                      data-status={g.status}
                    >
                      {done ? (
                        <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden="true" />
                      ) : (
                        <CircleDashed className="size-5 shrink-0 text-warning" aria-hidden="true" />
                      )}
                      <span className="min-w-0 flex-1 text-sm">
                        <strong>{g.label}</strong>{' '}
                        <span className="text-text-muted">– {done ? 'done' : 'required'}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <ConflictPanel
            plan={plan}
            userId={userId}
            mode={conflictMode}
            setMode={setConflictMode}
            nature={nature}
            setNature={setNature}
            busy={busy}
            onDeclare={() =>
              run(
                'declare',
                () =>
                  post(
                    `/plans/${plan.id}/coi`,
                    conflictMode === 'none' ? { none: true } : { none: false, nature },
                  ),
                () => setNature(''),
              )
            }
            onDecide={(id, disposition) => run('decide', () => post(`/coi/${id}/decision`, { disposition }))}
          />

          {p.canEdit && (
            <Panel id="ins-h" title="Tell the assistant what to change" badge={<AiBadge />}>
              <form
                className="mt-3 flex flex-col gap-2"
                aria-label="Plan instruction"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (instruction.trim()) void sendInstruction();
                }}
              >
                <Field
                  label="Instruction"
                  hint='For example: "change paragraph 3 of the background to ..." or "add to the risks: supplier insolvency".'
                >
                  <Input
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    maxLength={2000}
                  />
                </Field>
                <VoiceStatus state={voice.state} interim={voice.interim} error={voice.error} />
                <div className="flex flex-wrap gap-2">
                  <VoiceButton state={voice.state} onStart={voice.start} onStop={voice.stop} />
                  <Button type="submit" loading={busy === 'instruct'} disabled={!instruction.trim()}>
                    Apply
                  </Button>
                  {(undoToken || plan.undoAvailable) && (
                    <Button
                      type="button"
                      variant="secondary"
                      loading={busy === 'undo'}
                      onClick={() =>
                        run(
                          'undo',
                          () =>
                            post(`/plans/${plan.id}/instructions/undo`, {
                              undoToken: undoToken ?? plan.undoToken,
                            }),
                          () => setUndoToken(undefined),
                        )
                      }
                    >
                      <Undo2 className="size-4" aria-hidden="true" />
                      Undo last change
                    </Button>
                  )}
                </div>
              </form>
              {hint && (
                <p role="status" className="mt-2 text-sm text-warning" data-testid="instruction-hint">
                  {hint}
                </p>
              )}
              {hint && (
                <AmendmentFallback
                  planId={plan.id}
                  csrf={csrf}
                  fields={plan.fields}
                  instruction={instruction}
                  onSaved={() => {
                    setHint(null);
                    setInstruction('');
                    setNotice('Your amended text was saved.');
                    router.refresh();
                  }}
                  onEdit={(k) => {
                    const f = plan.fields.find((x) => x.key === k);
                    setEditKey(k);
                    setDraft(f?.value ?? '');
                    setHint(null);
                  }}
                />
              )}
            </Panel>
          )}
        </aside>

        <div className="flex min-w-0 flex-col gap-4 lg:order-1">
          <section aria-labelledby="sec-h" className="flex flex-col gap-4">
            <h2 id="sec-h" className="font-heading text-2xl font-extrabold tracking-tight">
              Plan
            </h2>
            {plan.fields.map((f) => (
              <div
                key={f.key}
                className="rounded-lg border border-border bg-surface p-5 shadow-sm"
                data-field={f.key}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-heading text-lg font-bold">{f.label}</h3>
                  {f.aiDrafted && <AiBadge kind="drafted" />}
                  {p.canEdit && editKey !== f.key && (
                    <Button
                      variant="ghost"
                      className="ml-auto"
                      onClick={() => {
                        setEditKey(f.key);
                        setDraft(f.value);
                      }}
                      aria-label={`Edit ${f.label}`}
                    >
                      <Pencil className="size-4" aria-hidden="true" />
                      Edit
                    </Button>
                  )}
                </div>
                {editKey === f.key ? (
                  <div className="mt-3 flex flex-col gap-2">
                    <Field label={`${f.label} (separate paragraphs with a blank line)`}>
                      <Textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        rows={8}
                        maxLength={8000}
                      />
                    </Field>
                    <div className="flex gap-2">
                      <Button loading={busy === 'save'} onClick={() => void saveField(f)}>
                        Save
                      </Button>
                      <Button variant="secondary" onClick={() => setEditKey(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <ol className="mt-3 flex flex-col gap-3 text-base leading-relaxed">
                    {f.paragraphs.map((para, i) => (
                      <li key={i} className="grid grid-cols-[auto_minmax(0,1fr)] gap-3">
                        <span
                          className="mt-1 inline-flex size-6 items-center justify-center rounded-full bg-accent/10 text-xs font-bold text-accent"
                          aria-label={`Paragraph ${i + 1}`}
                        >
                          {i + 1}
                        </span>
                        <span
                          className="min-w-0 max-w-prose whitespace-pre-wrap break-words"
                          data-paragraph={i + 1}
                        >
                          {para}
                        </span>
                      </li>
                    ))}
                    {f.paragraphs.length === 0 && <li className="text-text-muted">Not set</li>}
                  </ol>
                )}
              </div>
            ))}
          </section>

          {(p.canSubmit || p.canReopen) && (
            <section
              aria-labelledby="act-h"
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-4 shadow-sm"
            >
              <h2 id="act-h" className="sr-only">
                Plan actions
              </h2>
              {p.canSubmit && (
                <Button
                  variant="accent"
                  loading={busy === 'submit'}
                  onClick={() => run('submit', () => post(`/plans/${plan.id}/submit-for-approval`))}
                >
                  Submit for approval
                </Button>
              )}
              {p.canReopen && (
                <Button variant="secondary" onClick={() => setReopen(true)}>
                  Reopen plan
                </Button>
              )}
            </section>
          )}
        </div>
      </div>

      <Dialog
        open={reopen}
        onOpenChange={setReopen}
        title="Reopen this approved plan?"
        description="The earlier approval is kept as history but no longer applies. The plan will need to be approved again."
        footer={
          <>
            <Button variant="secondary" onClick={() => setReopen(false)}>
              Cancel
            </Button>
            <Button
              disabled={reopenReason.trim().length < 10}
              onClick={() => {
                setReopen(false);
                void run(
                  'reopen',
                  () => post(`/plans/${plan.id}/reopen`, { reason: reopenReason }),
                  () => setReopenReason(''),
                );
              }}
            >
              Reopen
            </Button>
          </>
        }
      >
        <Field label="Reason (at least 10 characters)" required>
          <Textarea
            value={reopenReason}
            onChange={(e) => setReopenReason(e.target.value)}
            rows={3}
            maxLength={1000}
          />
        </Field>
      </Dialog>
    </div>
  );
}

function ConflictPanel(props: {
  plan: PlanView;
  userId: string;
  mode: 'none' | 'conflict';
  setMode: (m: 'none' | 'conflict') => void;
  nature: string;
  setNature: (v: string) => void;
  busy: string | null;
  onDeclare: () => void;
  onDecide: (id: string, d: 'IMMATERIAL' | 'MANAGEABLE' | 'MATERIAL') => void;
}): ReactNode {
  const { plan, mode, setMode, nature, setNature, busy, onDeclare, onDecide } = props;
  const p = plan.permissions;
  return (
    <Panel id="coi-h" title="Conflicts of interest" testId="coi-panel">
      {plan.conflicts.length === 0 ? (
        <p className="mt-2 text-sm text-text-muted">No declarations yet.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {plan.conflicts.map((c: PlanConflict) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-alt/60 px-3 py-2 text-sm"
              data-coi={c.disposition}
            >
              <strong>{c.userName}</strong>
              <span className="text-text-muted">
                {c.none ? 'declared no conflict' : `declared: ${c.nature}`}
              </span>
              <Badge tone={COI_TONE[c.disposition] ?? 'neutral'}>{COI_LABEL[c.disposition]}</Badge>
              {p.canDecideConflict && c.disposition === 'PENDING' && c.userId !== props.userId && (
                <span className="flex flex-wrap gap-1">
                  {(['IMMATERIAL', 'MANAGEABLE', 'MATERIAL'] as const).map((d) => (
                    <Button
                      key={d}
                      variant="secondary"
                      className="min-h-[44px] px-3 text-xs"
                      disabled={busy === 'decide'}
                      onClick={() => onDecide(c.id, d)}
                    >
                      Mark {(COI_LABEL[d] ?? d).toLowerCase()}
                    </Button>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {p.canDeclareConflict && (
        <form
          className="mt-4 flex flex-col gap-2 border-t border-border pt-4"
          aria-label="Declare a conflict of interest"
          onSubmit={(e) => {
            e.preventDefault();
            onDeclare();
          }}
        >
          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm font-semibold">Your declaration</legend>
            <label className="flex min-h-[44px] items-center gap-2 text-sm">
              <input type="radio" name="coi" checked={mode === 'none'} onChange={() => setMode('none')} /> I
              have no conflict of interest
            </label>
            <label className="flex min-h-[44px] items-center gap-2 text-sm">
              <input
                type="radio"
                name="coi"
                checked={mode === 'conflict'}
                onChange={() => setMode('conflict')}
              />{' '}
              I have a conflict to declare
            </label>
          </fieldset>
          {mode === 'conflict' && (
            <Field label="Describe the conflict" required>
              <Textarea
                value={nature}
                onChange={(e) => setNature(e.target.value)}
                rows={3}
                maxLength={2000}
              />
            </Field>
          )}
          <div>
            <Button
              type="submit"
              loading={busy === 'declare'}
              disabled={mode === 'conflict' && nature.trim().length < 3}
            >
              Submit declaration
            </Button>
          </div>
        </form>
      )}
    </Panel>
  );
}
