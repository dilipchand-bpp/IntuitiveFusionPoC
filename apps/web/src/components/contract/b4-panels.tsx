'use client';
import { FileDown } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Badge, Button, Card, Field, Input, Textarea } from '@if/ui';
import { ApiError, api } from '@/lib/api-client';
import { formatDateTime } from '@/lib/labels';
import type { ContractView } from './types';

const message = (e: unknown) =>
  e instanceof ApiError
    ? [e.message, ...(e.problem.errors ?? []).map((x) => x.message)]
        .filter((x, i, a) => a.indexOf(x) === i)
        .join(' ')
    : 'Something went wrong. Please try again.';

function useRun() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  async function run(name: string, fn: () => Promise<void>, ok?: string) {
    setBusy(name);
    setError(null);
    setNote(null);
    try {
      await fn();
      if (ok) setNote(ok);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }
  const messages: ReactNode = (
    <>
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-error">
          {error}
        </p>
      )}
      {note && (
        <p role="status" className="mt-2 text-sm font-medium text-success">
          {note}
        </p>
      )}
    </>
  );
  return { busy, run, messages };
}
const send = <T,>(csrf: string, method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown) =>
  api<T>(path, { method, csrf, ...(body === undefined ? {} : { body }) });

interface Common {
  c: ContractView;
  csrf: string;
  roles: string[];
  onChange: (c: ContractView) => void;
}
const has = (roles: string[], ...r: string[]) => r.some((x) => roles.includes(x));
const RESULT_TONE = { PASS: 'success', WARN: 'warning', FAIL: 'error', REVIEWED: 'info' } as const;
const RESULT_LABEL = { PASS: 'Pass', WARN: 'Check', FAIL: 'Failed', REVIEWED: 'Reviewed' } as const;

// ------------------------------------------------------------------ banners
export function ContractBanners({ c }: { c: ContractView }) {
  return (
    <>
      {c.negotiation.locked && (
        <p
          role="alert"
          className="rounded-md border-2 border-warning bg-warning-bg p-3 text-sm font-semibold text-warning"
          data-testid="negotiation-lock"
        >
          Negotiation has run past {c.negotiation.limitDays} days ({c.negotiation.daysOpen} so far). Signature
          blocks are locked until sanctions and financial risk are checked again.
        </p>
      )}
      {c.blind && (
        <p
          role="status"
          className="rounded-md border border-border bg-surface-alt p-3 text-sm"
          data-testid="blind-banner"
        >
          Blind signing: you see only your own signature until the contract is executed.
        </p>
      )}
    </>
  );
}

// ------------------------------------------------------------------ checks (FR-0405, FR-0415, FR-0440)
export function ChecksCard({ c, csrf, roles, onChange }: Common) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const r = useRun();
  const all = [...c.checks.tender, ...c.checks.vendor, ...c.checks.recheck];
  const canRun = c.permissions.canRunChecks;
  if (all.length === 0 && !canRun) return null;
  const reload = async () => onChange(await api<ContractView>(`/contracts/${c.id}`));
  const group = (title: string, rows: typeof all) =>
    rows.length === 0 ? null : (
      <section aria-label={title} className="mt-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <ul className="mt-1 flex flex-col gap-2 text-sm">
          {rows.map((x) => (
            <li key={`${x.kind}-${x.key}`} data-check={x.key} data-result={x.result}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={RESULT_TONE[x.result]}>{RESULT_LABEL[x.result]}</Badge>
                <strong>{x.label}</strong>
                <span className="text-text-muted">{x.detail}</span>
              </div>
              {x.reviewNote && <p className="mt-1 text-text-muted">Reviewed: {x.reviewNote}</p>}
              {(x.result === 'FAIL' || x.result === 'WARN') && canRun && !c.locked && (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <Field label={`Reason for reviewing: ${x.label}`}>
                    <Input
                      value={notes[`${x.kind}-${x.key}`] ?? ''}
                      onChange={(e) => setNotes({ ...notes, [`${x.kind}-${x.key}`]: e.target.value })}
                    />
                  </Field>
                  <Button
                    variant="secondary"
                    aria-label={`Review ${x.label}`}
                    disabled={(notes[`${x.kind}-${x.key}`] ?? '').trim().length < 10}
                    loading={r.busy === `rev-${x.kind}-${x.key}`}
                    onClick={() =>
                      void r.run(
                        `rev-${x.kind}-${x.key}`,
                        async () => {
                          await send(csrf, 'POST', `/contracts/${c.id}/checks/${x.kind}/${x.key}/review`, {
                            note: notes[`${x.kind}-${x.key}`],
                          });
                          await reload();
                        },
                        'Reviewed and recorded.',
                      )
                    }
                  >
                    Review
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    );
  return (
    <Card role="region" aria-labelledby="checks-h" data-testid="checks-card">
      <h2 id="checks-h" className="font-heading text-xl font-bold">
        Checks before signing
      </h2>
      <p className="mt-1 max-w-prose text-sm text-text-muted">
        The draft is compared with what was tendered, the supplier&apos;s name, tax and banking are verified,
        and after a long negotiation the counterparty is screened again. A failure holds release or signing
        until someone has reviewed it with a reason.
      </p>
      {group('Against the tender', c.checks.tender)}
      {group('The supplier', c.checks.vendor)}
      {group('Counterparty re-check', c.checks.recheck)}
      {canRun && !c.locked && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            loading={r.busy === 'run'}
            onClick={() =>
              void r.run(
                'run',
                async () => {
                  await send(csrf, 'POST', `/contracts/${c.id}/checks/run`);
                  await reload();
                },
                'The checks were run.',
              )
            }
          >
            Run the checks
          </Button>
          <Button
            variant="secondary"
            loading={r.busy === 'recheck'}
            onClick={() =>
              void r.run(
                'recheck',
                async () => onChange(await send<ContractView>(csrf, 'POST', `/contracts/${c.id}/recheck`)),
                'Sanctions and financial risk were checked again.',
              )
            }
          >
            Check sanctions and financial risk again
          </Button>
        </div>
      )}
      {r.messages}
      {void roles}
    </Card>
  );
}

// ------------------------------------------------------------------ endorsements (FR-0480)
export function EndorsementsCard({ c, csrf, onChange }: Common) {
  const r = useRun();
  const e = c.endorsements;
  if (e.required.length === 0) return null;
  return (
    <Card role="region" aria-labelledby="endorse-h" data-testid="endorsements">
      <h2 id="endorse-h" className="font-heading text-xl font-bold">
        Endorsements before release
      </h2>
      <ul className="mt-3 flex flex-col gap-2 text-sm">
        {e.required.map((role) => {
          const d = e.done.find((x) => x.role === role);
          return (
            <li key={role} className="flex flex-wrap items-center gap-2">
              <Badge tone={d ? 'success' : 'warning'}>{d ? 'Endorsed' : 'Waiting'}</Badge>
              <strong>{role === 'LEGAL' ? 'Legal' : 'Finance'}</strong>
              {d && (
                <span className="text-text-muted">
                  {d.by}, {formatDateTime(d.at)}
                  {d.comment ? `: ${d.comment}` : ''}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {c.permissions.canEndorse && (
        <div className="mt-3">
          <Button
            loading={r.busy === 'endorse'}
            onClick={() =>
              void r.run(
                'endorse',
                async () =>
                  onChange(await send<ContractView>(csrf, 'POST', `/contracts/${c.id}/endorse`, {})),
                'Endorsement recorded.',
              )
            }
          >
            Endorse this contract
          </Button>
        </div>
      )}
      {r.messages}
    </Card>
  );
}

// ------------------------------------------------------------------ signing progress (FR-0425, FR-0445)
interface Progress {
  signed: number;
  required: number;
  invitations: Array<{
    name: string;
    role: string;
    external: boolean;
    viewedAt: string | null;
    remindedAt: string | null;
    reminders: number;
    signed: boolean;
  }>;
}
export function SigningCard({ c, csrf, roles }: Common) {
  const [data, setData] = useState<Progress | null>(null);
  const r = useRun();
  const manage = has(roles, 'LEGAL', 'PROCUREMENT');
  const load = useCallback(async () => {
    try {
      setData(await api<Progress>(`/contracts/${c.id}/signing`));
    } catch {
      /* not visible */
    }
  }, [c.id]);
  useEffect(() => {
    if (c.status !== 'DRAFT' && c.status !== 'LEGAL_REVIEW') void load();
  }, [load, c.status, c.signed]);
  if (!data || data.invitations.length === 0) return null;
  return (
    <Card role="region" aria-labelledby="inv-h" data-testid="signing-progress">
      <h2 id="inv-h" className="font-heading text-xl font-bold">
        Signing progress
      </h2>
      <p className="mt-1 text-sm text-text-muted">
        {data.signed} of {data.required} signature(s). Each signatory was invited by email and in the app.
      </p>
      <ul className="mt-2 flex flex-col gap-1 text-sm" aria-label="Invitations">
        {data.invitations.map((i) => (
          <li
            key={`${i.name}-${i.role}`}
            className="flex flex-wrap items-center gap-2"
            data-signed={i.signed}
          >
            <strong>{i.name}</strong>
            <span className="text-text-muted">
              {i.external ? 'Supplier (reads and asks questions)' : i.role.toLowerCase()}
            </span>
            {i.signed ? (
              <Badge tone="success">Signed</Badge>
            ) : (
              <Badge tone={i.viewedAt ? 'info' : 'neutral'}>
                {i.viewedAt ? 'Has read it' : 'Not opened'}
              </Badge>
            )}
            {i.reminders > 0 && <span className="text-xs text-text-muted">{i.reminders} reminder(s)</span>}
          </li>
        ))}
      </ul>
      {manage && c.status !== 'EXECUTED' && (
        <div className="mt-3">
          <Button
            variant="secondary"
            loading={r.busy === 'remind'}
            onClick={() =>
              void r.run(
                'remind',
                async () => {
                  const out = await send<{ reminded: string[] }>(
                    csrf,
                    'POST',
                    `/contracts/${c.id}/signing/remind`,
                  );
                  await load();
                  if (out.reminded.length === 0) throw new Error('Everyone has signed');
                },
                'Reminders sent.',
              )
            }
          >
            Remind signatories
          </Button>
        </div>
      )}
      {r.messages}
    </Card>
  );
}

// ------------------------------------------------------------------ questions before signing (FR-0445)
interface Question {
  id: string;
  side: 'INTERNAL' | 'SUPPLIER';
  askedBy: string;
  clauseId: string | null;
  question: string;
  answer: string | null;
  answeredBy: string | null;
}
export function QuestionsCard({ c, csrf, roles }: Common) {
  const [rows, setRows] = useState<Question[] | null>(null);
  const [text, setText] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const r = useRun();
  const load = useCallback(async () => {
    try {
      setRows((await api<{ questions: Question[] }>(`/contracts/${c.id}/questions`)).questions);
    } catch {
      setRows([]);
    }
  }, [c.id]);
  useEffect(() => {
    void load();
  }, [load]);
  if (rows === null) return null;
  const canAsk = c.permissions.canAskQuestion && c.status !== 'EXECUTED';
  const legal = roles.includes('LEGAL');
  if (rows.length === 0 && !canAsk) return null;
  return (
    <Card role="region" aria-labelledby="q-h" data-testid="questions-card">
      <h2 id="q-h" className="font-heading text-xl font-bold">
        Questions
      </h2>
      <ul className="mt-2 flex flex-col gap-2 text-sm" aria-label="Questions">
        {rows.length === 0 && <li className="text-text-muted">No questions have been raised.</li>}
        {rows.map((q) => (
          <li key={q.id} className="rounded-md border border-border p-2">
            <p>
              <strong>{q.askedBy}</strong>{' '}
              <span className="text-text-muted">
                ({q.side === 'SUPPLIER' ? 'supplier' : 'internal'}
                {q.clauseId ? `, ${q.clauseId}` : ''})
              </span>
            </p>
            <p className="mt-1">{q.question}</p>
            {q.answer ? (
              <p className="mt-1 rounded bg-surface-alt p-2">
                Answer from {q.answeredBy}: {q.answer}
              </p>
            ) : (
              legal && (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <Field label={`Answer to: ${q.question.slice(0, 40)}`}>
                    <Input
                      value={answers[q.id] ?? ''}
                      onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                    />
                  </Field>
                  <Button
                    variant="secondary"
                    disabled={(answers[q.id] ?? '').trim().length < 2}
                    loading={r.busy === `ans-${q.id}`}
                    aria-label={`Send answer: ${q.question.slice(0, 40)}`}
                    onClick={() =>
                      void r.run(`ans-${q.id}`, async () => {
                        await send(csrf, 'POST', `/contract-questions/${q.id}/answer`, {
                          answer: answers[q.id],
                        });
                        await load();
                      })
                    }
                  >
                    Answer
                  </Button>
                </div>
              )
            )}
          </li>
        ))}
      </ul>
      {canAsk && (
        <div className="mt-3 flex flex-col gap-2">
          <Field label="Ask a question about this contract">
            <Textarea rows={2} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <div>
            <Button
              variant="secondary"
              disabled={text.trim().length < 5}
              loading={r.busy === 'ask'}
              onClick={() =>
                void r.run(
                  'ask',
                  async () => {
                    await send(csrf, 'POST', `/contracts/${c.id}/questions`, { question: text });
                    setText('');
                    await load();
                  },
                  'Your question was sent to legal.',
                )
              }
            >
              Send question
            </Button>
          </div>
        </div>
      )}
      {r.messages}
    </Card>
  );
}

// ------------------------------------------------------------------ the risk summary (FR-0450)
interface Summary {
  generated: { level: 'LOW' | 'MEDIUM' | 'HIGH'; headline: string; points: string[]; model: string };
  edited: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
}
export function RiskSummaryCard({ c, csrf, roles }: Common) {
  const [s, setS] = useState<Summary | null>(null);
  const [text, setText] = useState('');
  const r = useRun();
  const legal = roles.includes('LEGAL');
  const show = has(roles, 'DELEGATE', 'EXEC', 'LEGAL', 'PROCUREMENT') && c.status !== 'EXECUTED';
  const load = useCallback(
    async (refresh = false) => {
      const out = await api<Summary>(`/contracts/${c.id}/risk-summary${refresh ? '?refresh=true' : ''}`);
      setS(out);
      setText(out.edited ?? '');
    },
    [c.id],
  );
  useEffect(() => {
    if (show) void load().catch(() => undefined);
  }, [load, show]);
  if (!show || !s) return null;
  return (
    <Card role="region" aria-labelledby="risk-h" data-testid="risk-summary">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="risk-h" className="font-heading text-xl font-bold">
          Risk summary
        </h2>
        <Badge
          tone={
            s.generated.level === 'HIGH' ? 'error' : s.generated.level === 'MEDIUM' ? 'warning' : 'success'
          }
        >
          {s.generated.level.toLowerCase()}
        </Badge>
        {s.reviewedBy && <Badge tone="info">Reviewed by {s.reviewedBy}</Badge>}
      </div>
      <p className="mt-1 text-xs text-text-muted">
        Drafted by a rules model, not an outside service. Legal reviews and may edit it before release.
      </p>
      <p className="mt-2 text-sm font-semibold">{s.generated.headline}</p>
      <ul className="mt-1 list-disc pl-5 text-sm">
        {s.generated.points.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      {s.edited && !legal && (
        <p className="mt-2 rounded bg-surface-alt p-2 text-sm">Legal&apos;s view: {s.edited}</p>
      )}
      {legal && (
        <div className="mt-3 flex flex-col gap-2">
          <Field label="Legal's edit of the summary">
            <Textarea rows={3} maxLength={8000} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={text.trim().length < 10}
              loading={r.busy === 'edit'}
              onClick={() =>
                void r.run(
                  'edit',
                  async () =>
                    setS(await send<Summary>(csrf, 'PUT', `/contracts/${c.id}/risk-summary`, { text })),
                  'Saved.',
                )
              }
            >
              Save edit
            </Button>
            <Button
              loading={r.busy === 'review'}
              onClick={() =>
                void r.run(
                  'review',
                  async () =>
                    setS(await send<Summary>(csrf, 'POST', `/contracts/${c.id}/risk-summary/review`)),
                  'Marked as reviewed.',
                )
              }
            >
              Mark as reviewed
            </Button>
            <Button
              variant="secondary"
              loading={r.busy === 'refresh'}
              onClick={() => void r.run('refresh', () => load(true), 'Regenerated.')}
            >
              Regenerate
            </Button>
          </div>
        </div>
      )}
      {r.messages}
    </Card>
  );
}

// ------------------------------------------------------------------ per-deviation tools (FR-0475)
interface Explanation {
  summary: string;
  whatChanged: string;
  whyItMatters: string[];
  suggestion: string;
  basedOn: string[];
}
export function DeviationTools({
  c,
  csrf,
  roles,
  clauseId,
  title,
  onChange,
}: Common & { clauseId: string; title: string }) {
  const [ex, setEx] = useState<Explanation | null>(null);
  const [words, setWords] = useState('');
  const [reading, setReading] = useState<string | null>(null);
  const [statement, setStatement] = useState('');
  const r = useRun();
  const accept = has(roles, 'DELEGATE', 'EXEC', 'CONTRACT_MGR') && !c.locked;
  const legal = roles.includes('LEGAL') && c.permissions.canAmendRisk;
  return (
    <div
      className="mt-3 flex flex-col gap-2 border-t border-border pt-3"
      data-testid={`deviation-tools-${clauseId}`}
    >
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          aria-label={`What does the change to ${title} mean?`}
          loading={r.busy === 'explain'}
          onClick={() =>
            void r.run('explain', async () =>
              setEx(
                await send<Explanation>(csrf, 'POST', `/contracts/${c.id}/deviations/${clauseId}/explain`),
              ),
            )
          }
        >
          What does this mean?
        </Button>
      </div>
      {ex && (
        <div className="rounded-md bg-surface-alt p-3 text-sm" data-testid="explanation">
          <p className="font-semibold">{ex.summary}</p>
          <p className="mt-1">{ex.whatChanged}</p>
          <ul className="mt-1 list-disc pl-5">
            {ex.whyItMatters.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <p className="mt-1">{ex.suggestion}</p>
          {ex.basedOn.length > 0 && (
            <p className="mt-1 text-xs text-text-muted">Based on: {ex.basedOn.join('; ')}</p>
          )}
        </div>
      )}
      {legal && (
        <div className="flex flex-wrap items-end gap-2">
          <Field
            label={`Rate ${title} in words`}
            hint="For example: this is serious because it removes the cap"
          >
            <Input
              value={words}
              onChange={(e) => {
                setWords(e.target.value);
                setReading(null);
              }}
            />
          </Field>
          <Button
            variant="secondary"
            disabled={words.trim().length < 3}
            aria-label={`Read back the rating for ${title}`}
            loading={r.busy === 'peek'}
            onClick={() =>
              void r.run('peek', async () => {
                const out = await send<{ rating: string | null }>(
                  csrf,
                  'POST',
                  `/contracts/${c.id}/deviations/${clauseId}/risk/plain`,
                  { text: words },
                );
                setReading(out.rating);
              })
            }
          >
            Read it back
          </Button>
          {reading && (
            <Button
              loading={r.busy === 'apply'}
              onClick={() =>
                void r.run('apply', async () => {
                  await send(csrf, 'POST', `/contracts/${c.id}/deviations/${clauseId}/risk/plain`, {
                    text: words,
                    apply: true,
                  });
                  onChange(await api<ContractView>(`/contracts/${c.id}`));
                  setReading(null);
                  setWords('');
                })
              }
            >
              Set to {reading.toLowerCase()} risk
            </Button>
          )}
        </div>
      )}
      {accept && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label={`Statement accepting the risk of ${title}`}>
            <Input value={statement} onChange={(e) => setStatement(e.target.value)} />
          </Field>
          <Button
            variant="secondary"
            disabled={statement.trim().length < 10}
            aria-label={`Formally accept the risk of ${title}`}
            loading={r.busy === 'accept'}
            onClick={() =>
              void r.run(
                'accept',
                async () => {
                  onChange(
                    await send<ContractView>(
                      csrf,
                      'POST',
                      `/contracts/${c.id}/deviations/${clauseId}/accept-risk`,
                      { statement },
                    ),
                  );
                  setStatement('');
                },
                'The risk was formally accepted and recorded.',
              )
            }
          >
            Accept the risk
          </Button>
        </div>
      )}
      {r.messages}
    </div>
  );
}

// ------------------------------------------------------------------ working on the draft together (FR-0465)
interface Comment {
  id: string;
  clauseId: string | null;
  by: string;
  body: string;
  at: string;
}
interface Draft {
  id: string;
  name: string;
  version: number;
  note: string | null;
  uploadedBy: string;
  at: string;
}
export function CollabCard({ c, csrf, roles }: Common) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [body, setBody] = useState('');
  const r = useRun();
  const load = useCallback(async () => {
    try {
      setComments((await api<{ comments: Comment[] }>(`/contracts/${c.id}/comments`)).comments);
      setDrafts((await api<{ drafts: Draft[] }>(`/contracts/${c.id}/drafts`)).drafts);
    } catch {
      /* not visible */
    }
  }, [c.id]);
  useEffect(() => {
    void load();
  }, [load]);
  const legal = roles.includes('LEGAL') && !c.locked;
  return (
    <Card role="region" aria-labelledby="collab-h" data-testid="collab-card">
      <h2 id="collab-h" className="font-heading text-xl font-bold">
        Working on the draft
      </h2>
      <p className="mt-1 max-w-prose text-sm text-text-muted">
        Legal edits clauses directly above, and the change is in the draft at once. Comment here, download the
        current draft, or upload a draft amended outside the platform.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button asChild variant="secondary">
          <a href={`/api/v1/contracts/${c.id}/export.pdf`} download className="text-text no-underline">
            <FileDown className="size-4" aria-hidden="true" />
            Download PDF
          </a>
        </Button>
        <Button asChild variant="secondary">
          <a href={`/api/v1/contracts/${c.id}/export.docx`} download className="text-text no-underline">
            <FileDown className="size-4" aria-hidden="true" />
            Download Word
          </a>
        </Button>
      </div>
      <ul className="mt-3 flex flex-col gap-2 text-sm" aria-label="Comments">
        {comments.map((m) => (
          <li key={m.id} className="rounded-md border border-border p-2">
            <strong>{m.by}</strong>{' '}
            <span className="text-xs text-text-muted">
              {formatDateTime(m.at)}
              {m.clauseId ? `, ${m.clauseId}` : ''}
            </span>
            <p>{m.body}</p>
          </li>
        ))}
      </ul>
      {c.permissions.canComment && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <Field label="Add a comment">
            <Input value={body} onChange={(e) => setBody(e.target.value)} className="w-72 max-w-full" />
          </Field>
          <Button
            variant="secondary"
            disabled={body.trim().length < 2}
            loading={r.busy === 'comment'}
            onClick={() =>
              void r.run('comment', async () => {
                await send(csrf, 'POST', `/contracts/${c.id}/comments`, { body });
                setBody('');
                await load();
              })
            }
          >
            Comment
          </Button>
        </div>
      )}
      {drafts.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 text-sm" aria-label="Amended drafts">
          {drafts.map((d) => (
            <li key={d.id}>
              <a href={`/api/v1/contracts/${c.id}/drafts/${d.id}`} download>
                Version {d.version}: {d.name}
              </a>{' '}
              <span className="text-text-muted">
                by {d.uploadedBy}
                {d.note ? `, ${d.note}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      {legal && (
        <div className="mt-2">
          <Field label="Upload an amended draft (Word or PDF)">
            <input
              type="file"
              accept=".docx,.pdf"
              className="min-h-[44px] text-sm"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                void r.run(
                  'upload',
                  async () => {
                    const buf = new Uint8Array(await f.arrayBuffer());
                    let bin = '';
                    for (const b of buf) bin += String.fromCharCode(b);
                    await send(csrf, 'POST', `/contracts/${c.id}/drafts`, {
                      fileName: f.name,
                      contentBase64: btoa(bin),
                    });
                    await load();
                  },
                  'The draft was uploaded as a new version.',
                );
              }}
            />
          </Field>
        </div>
      )}
      {r.messages}
    </Card>
  );
}

// ------------------------------------------------------------------ negotiation strategy (FR-0485)
interface Strategy {
  framing: string;
  techniques: string[];
  positions: Array<{ level: string; price: number; note: string }>;
  levers: Array<{ lever: string; suggestion: string }>;
  basedOn: string[];
}
export function StrategyCard({ c, roles }: Common) {
  const [s, setS] = useState<Strategy | null>(null);
  const r = useRun();
  if (!has(roles, 'LEGAL', 'PROCUREMENT', 'DELEGATE', 'EXEC') || c.status === 'EXECUTED') return null;
  return (
    <Card role="region" aria-labelledby="strat-h" data-testid="strategy-card">
      <h2 id="strat-h" className="font-heading text-xl font-bold">
        Negotiation strategy
      </h2>
      <p className="mt-1 text-xs text-text-muted">
        A rules model, not an outside service: it frames the negotiation and sets graduated positions.
      </p>
      <div className="mt-2">
        <Button
          variant="secondary"
          loading={r.busy === 'strategy'}
          onClick={() =>
            void r.run('strategy', async () =>
              setS(await api<Strategy>(`/contracts/${c.id}/negotiation-strategy`)),
            )
          }
        >
          Suggest a strategy
        </Button>
      </div>
      {s && (
        <div className="mt-3 flex flex-col gap-3 text-sm" data-testid="strategy">
          <p>{s.framing}</p>
          <ul className="list-disc pl-5">
            {s.techniques.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <ol className="flex flex-col gap-1" aria-label="Positions">
            {s.positions.map((p) => (
              <li key={p.level}>
                <strong>{p.level}:</strong> AUD {p.price.toLocaleString('en-AU')}{' '}
                <span className="text-text-muted">{p.note}</span>
              </li>
            ))}
          </ol>
          <ul className="flex flex-col gap-1" aria-label="Levers">
            {s.levers.map((l) => (
              <li key={l.lever}>
                <strong>{l.lever}:</strong> {l.suggestion}
              </li>
            ))}
          </ul>
        </div>
      )}
      {r.messages}
    </Card>
  );
}
