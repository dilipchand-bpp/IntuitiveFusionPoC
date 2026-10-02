'use client';
import { CheckCircle2, CircleDashed, Lock, Undo2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { AiBadge, Badge, Button, Card, Dialog, Field, Input, Stamp, Textarea } from '@if/ui';
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
import type { PlanConflict, PlanField, PlanView } from './types';

const when = new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short' });

/** Everything about one plan: key points, sections with per-paragraph numbering, instruction box, conflicts, decisions. */
export function PlanWorkspace({ plan, csrf, userId }: { plan: PlanView; csrf: string; userId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [instruction, setInstruction] = useState('');
  const [hint, setHint] = useState<string | null>(null);
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
          body: { value: draft, expectedVersion: plan.version },
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

  return (
    <div className="flex flex-col gap-6" data-testid="plan-workspace" data-plan-status={plan.status}>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
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
        </div>
        {plan.approvals.length > 0 && (
          <ul className="flex flex-wrap gap-3" aria-label="Approval record">
            {plan.approvals.map((a) =>
              a.decision === 'APPROVED' ? (
                <li key={a.id}>
                  <Stamp
                    label={a.subject === 'PLAN_RISK' ? 'Risk signed off' : 'Approved'}
                    who={(a.stamp ?? '').split(' · ')[1] ?? ''}
                    role={a.role.replace('_', ' ')}
                    when={when.format(new Date(a.decidedAt))}
                  />
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
      </header>

      {error && (
        <p
          role="alert"
          className="rounded-sm border border-error bg-error-bg p-3 text-sm font-medium text-error"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-sm border border-success bg-success-bg p-3 text-sm font-medium text-success"
        >
          {notice}
        </p>
      )}

      {/* Key points first: on a phone the approver sees what they need, then the decision, then the detail. */}
      <section
        aria-labelledby="kp-h"
        className="rounded-md border border-border bg-surface p-4"
        data-testid="key-points"
      >
        <div className="flex items-center gap-2">
          <h2 id="kp-h" className="font-heading text-lg font-semibold">
            Key points
          </h2>
          <AiBadge />
        </div>
        <ul className="mt-2 list-disc pl-5 text-sm">
          {plan.summaryPoints.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>

      {approverBox && (
        <section
          aria-labelledby="dec-h"
          className="rounded-md border-2 border-accent bg-surface p-4"
          data-testid="decision-panel"
        >
          <h2 id="dec-h" className="font-heading text-lg font-semibold">
            Your decision
          </h2>
          {p.reason && !p.canApprove && <p className="mt-1 text-sm font-medium text-warning">{p.reason}</p>}
          <div className="mt-2 flex flex-col gap-3">
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
        </section>
      )}

      {p.canSignOffRisk && (
        <section
          aria-labelledby="risk-h"
          className="rounded-md border-2 border-warning bg-surface p-4"
          data-testid="risk-panel"
        >
          <h2 id="risk-h" className="font-heading text-lg font-semibold">
            Independent risk sign-off
          </h2>
          <p className="mt-1 text-sm text-text-muted">
            This plan cannot go to the approver until you have reviewed the risks and conflicts below.
          </p>
          <div className="mt-2 flex flex-col gap-3">
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
                    post(`/plans/${plan.id}/decision`, { decision: 'REJECT', gate: 'RISK_SIGNOFF', comment }),
                  )
                }
              >
                Return to procurement
              </Button>
            </div>
          </div>
        </section>
      )}

      <section aria-labelledby="gates-h" className="rounded-md border border-border bg-surface p-4">
        <h2 id="gates-h" className="font-heading text-lg font-semibold">
          Required checks
        </h2>
        {plan.gates.length === 0 ? (
          <p className="mt-1 text-sm text-text-muted">
            No extra checks are required for a plan at this complexity.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {plan.gates.map((g) => (
              <li key={g.key} className="flex items-start gap-2" data-gate={g.key} data-status={g.status}>
                {g.status === 'SATISFIED' ? (
                  <CheckCircle2 className="mt-0.5 size-4 text-success" aria-hidden="true" />
                ) : (
                  <CircleDashed className="mt-0.5 size-4 text-warning" aria-hidden="true" />
                )}
                <span>
                  <strong>{g.label}</strong>{' '}
                  <span className="text-text-muted">– {g.status === 'SATISFIED' ? 'done' : 'required'}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

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
        <section aria-labelledby="ins-h" className="rounded-md border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="ins-h" className="font-heading text-lg font-semibold">
              Tell the assistant what to change
            </h2>
            <AiBadge />
          </div>
          <form
            className="mt-2 flex flex-col gap-2"
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
              <Input value={instruction} onChange={(e) => setInstruction(e.target.value)} maxLength={2000} />
            </Field>
            <div className="flex flex-wrap gap-2">
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
        </section>
      )}

      <section aria-labelledby="sec-h" className="flex flex-col gap-3">
        <h2 id="sec-h" className="font-heading text-xl font-semibold">
          Plan
        </h2>
        {plan.fields.map((f) => (
          <Card key={f.key} className="p-4" data-field={f.key}>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-heading text-base font-semibold">{f.label}</h3>
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
                  Edit
                </Button>
              )}
            </div>
            {editKey === f.key ? (
              <div className="mt-2 flex flex-col gap-2">
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
              <ol className="mt-2 flex flex-col gap-2 text-sm">
                {f.paragraphs.map((para, i) => (
                  <li key={i} className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
                    <span
                      className="mt-0.5 inline-flex size-5 items-center justify-center rounded-full bg-surface-alt text-xs font-semibold text-text-muted"
                      aria-label={`Paragraph ${i + 1}`}
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0 whitespace-pre-wrap break-words" data-paragraph={i + 1}>
                      {para}
                    </span>
                  </li>
                ))}
                {f.paragraphs.length === 0 && <li className="text-text-muted">Not set</li>}
              </ol>
            )}
          </Card>
        ))}
      </section>

      {(p.canSubmit || p.canReopen) && (
        <section
          aria-labelledby="act-h"
          className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface p-4"
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
    <section
      aria-labelledby="coi-h"
      className="rounded-md border border-border bg-surface p-4"
      data-testid="coi-panel"
    >
      <h2 id="coi-h" className="font-heading text-lg font-semibold">
        Conflicts of interest
      </h2>
      {plan.conflicts.length === 0 ? (
        <p className="mt-1 text-sm text-text-muted">No declarations yet.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2 text-sm">
          {plan.conflicts.map((c: PlanConflict) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2" data-coi={c.disposition}>
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
          className="mt-3 flex flex-col gap-2"
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
    </section>
  );
}
