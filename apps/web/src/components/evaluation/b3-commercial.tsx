'use client';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Field, Input, Select, Textarea } from '@if/ui';
import { api } from '@/lib/api-client';
import { formatDateTime } from '@/lib/labels';
import { Card, useRunner } from './eval-card';
import type { AdviceItem, BafoStaffView, Clarification, EvalView, MyScores } from './types';

const send = <T,>(csrf: string, method: 'POST' | 'PUT', path: string, body?: unknown) =>
  api<T>(path, { method, csrf, ...(body === undefined ? {} : { body }) });
const aud = (v: number) => `AUD ${Math.round(v).toLocaleString('en-AU')}`;
const STAFF = ['PROCUREMENT', 'DELEGATE', 'LEGAL', 'PROBITY', 'EXEC', 'CHAIR'];

// ------------------------------------------------------------------ clarification requests (FR-0265, FR-0290)
export function ClarificationsPanel({ ev, csrf, roles }: { ev: EvalView; csrf: string; roles: string[] }) {
  const [rows, setRows] = useState<Clarification[] | null>(null);
  const [form, setForm] = useState({ supplierId: '', subject: '', question: '', days: '' });
  const r = useRunner();
  const canAsk = roles.includes('PROCUREMENT') && ev.status !== 'APPROVED' && !ev.held;
  const load = useCallback(async () => {
    try {
      setRows(
        (await api<{ clarifications: Clarification[] }>(`/evaluations/${ev.id}/clarifications`))
          .clarifications,
      );
    } catch {
      setRows([]);
    }
  }, [ev.id]);
  useEffect(() => {
    if (STAFF.some((x) => roles.includes(x))) void load();
  }, [load, roles, ev.compliance.length]);
  if (!STAFF.some((x) => roles.includes(x)) || rows === null) return null;
  if (rows.length === 0 && !canAsk) return null;
  return (
    <Card id="clar-h" title="Clarifications" testId="clarifications-panel">
      <p className="mt-2 max-w-prose text-sm text-text-muted">
        Requests to bidders, each with a response deadline. A failed compliance check sends one automatically.
      </p>
      <ul className="mt-3 flex flex-col gap-2" aria-label="Clarification requests">
        {rows.length === 0 && <li className="text-sm text-text-muted">No requests have been made.</li>}
        {rows.map((c) => (
          <li
            key={c.id}
            className="rounded-md border border-border p-3 text-sm"
            data-kind={c.kind}
            data-status={c.status}
          >
            <div className="flex flex-wrap items-center gap-2">
              <strong>{c.subject}</strong>
              <span className="text-text-muted">{c.supplier}</span>
              <Badge tone={c.status === 'ANSWERED' ? 'success' : c.overdue ? 'error' : 'warning'}>
                {c.status === 'ANSWERED'
                  ? 'Answered'
                  : c.status === 'CLOSED'
                    ? 'Closed'
                    : c.overdue
                      ? 'Overdue'
                      : 'Waiting'}
              </Badge>
              <span className="text-xs text-text-muted">Due {formatDateTime(c.dueAt)}</span>
            </div>
            <p className="mt-1 max-w-prose">{c.question}</p>
            {c.response && (
              <p className="mt-1 max-w-prose rounded bg-surface-alt p-2">Answer: {c.response}</p>
            )}
            {canAsk && c.status !== 'CLOSED' && (
              <div className="mt-2">
                <Button
                  variant="secondary"
                  aria-label={`Close the request: ${c.subject}`}
                  loading={r.busy === `close-${c.id}`}
                  onClick={() =>
                    void r.run(`close-${c.id}`, async () => {
                      await send(csrf, 'POST', `/clarifications/${c.id}/close`);
                      await load();
                    })
                  }
                >
                  Close request
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {canAsk && (
        <form
          className="mt-4 flex flex-col gap-3 border-t border-border pt-4"
          aria-label="Ask a supplier to clarify"
          onSubmit={(e) => {
            e.preventDefault();
            void r.run(
              'ask',
              async () => {
                await send(csrf, 'POST', `/evaluations/${ev.id}/clarifications`, {
                  supplierId: form.supplierId,
                  subject: form.subject,
                  question: form.question,
                  ...(form.days ? { dueInDays: Number(form.days) } : {}),
                });
                setForm({ supplierId: '', subject: '', question: '', days: '' });
                await load();
              },
              'The supplier was asked, in the portal and by email.',
            );
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Supplier">
              <Select
                value={form.supplierId}
                onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
              >
                <option value="">Choose…</option>
                {ev.suppliers.map((s) => (
                  <option key={s.supplierId} value={s.supplierId}>
                    {s.displayName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Subject">
              <Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
            </Field>
          </div>
          <Field label="What do you need to know?" hint="At least 10 characters">
            <Textarea
              rows={3}
              maxLength={4000}
              value={form.question}
              onChange={(e) => setForm({ ...form, question: e.target.value })}
            />
          </Field>
          <Field label="Days to answer (optional)">
            <Input
              type="number"
              min={1}
              max={60}
              value={form.days}
              onChange={(e) => setForm({ ...form, days: e.target.value })}
              className="w-28"
            />
          </Field>
          <div>
            <Button
              type="submit"
              variant="secondary"
              loading={r.busy === 'ask'}
              disabled={
                !form.supplierId || form.subject.trim().length < 3 || form.question.trim().length < 10
              }
            >
              Ask the supplier
            </Button>
          </div>
        </form>
      )}
      {r.messages}
    </Card>
  );
}

// ------------------------------------------------------------------ best and final offer and the advisor (FR-0290, FR-0295)
export function NegotiationPanel({
  ev,
  csrf,
  roles,
  onChanged,
}: {
  ev: EvalView;
  csrf: string;
  roles: string[];
  onChanged: () => Promise<void>;
}) {
  const [data, setData] = useState<BafoStaffView | null>(null);
  const [advice, setAdvice] = useState<{ note: string; advice: AdviceItem[] } | null>(null);
  const [form, setForm] = useState({ note: '', days: '3', picks: [] as string[] });
  const r = useRunner();
  const proc = roles.includes('PROCUREMENT');
  const canAdvice = proc || roles.includes('DELEGATE') || roles.includes('EXEC');
  const stageOk = ['CONSENSUS', 'LOCKED', 'REPORTED', 'APPROVED'].includes(ev.status);
  const load = useCallback(async () => {
    try {
      setData(await api<BafoStaffView>(`/evaluations/${ev.id}/bafo`));
    } catch {
      setData({ rounds: [], originalTco: [], canAccept: false });
    }
  }, [ev.id]);
  useEffect(() => {
    if (stageOk && STAFF.some((x) => roles.includes(x))) void load();
  }, [load, stageOk, roles, ev.status]);
  if (!stageOk || !STAFF.some((x) => roles.includes(x)) || !data) return null;
  const canOpen =
    proc &&
    (ev.status === 'CONSENSUS' || ev.status === 'LOCKED') &&
    !ev.held &&
    !data.rounds.some((x) => x.status === 'OPEN');
  if (data.rounds.length === 0 && !canOpen && !canAdvice) return null;
  return (
    <Card id="nego-h" title="Negotiation and best and final offers" testId="negotiation-panel">
      <p className="mt-2 max-w-prose text-sm text-text-muted">
        A controlled round for updated pricing. Original bids are kept unchanged beside every new offer,
        offers stay sealed until the round closes, and an accepted offer replaces that supplier&apos;s cost
        for ranking.
      </p>
      {canAdvice && ev.status !== 'CONSENSUS' && (
        <div className="mt-3">
          <Button
            variant="secondary"
            loading={r.busy === 'advice'}
            onClick={() =>
              void r.run('advice', async () =>
                setAdvice(await api(`/evaluations/${ev.id}/negotiation-advice`)),
              )
            }
          >
            Suggest what to negotiate
          </Button>
        </div>
      )}
      {advice && (
        <section
          aria-label="Negotiation suggestions"
          className="mt-3 rounded-md border border-border p-3"
          data-testid="advice"
        >
          <p className="text-xs text-text-muted">{advice.note}</p>
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {advice.advice.length === 0 && <li>Nothing stands out to negotiate on these bids.</li>}
            {advice.advice.map((a, i) => (
              <li key={i} data-kind={a.kind}>
                <p className="font-semibold">{a.text}</p>
                <p className="text-text-muted">Based on: {a.basis}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      <ul className="mt-3 flex flex-col gap-3" aria-label="Rounds">
        {data.rounds.map((rd) => (
          <li
            key={rd.id}
            className="rounded-md border border-border p-3 text-sm"
            data-round={rd.round}
            data-status={rd.status}
          >
            <div className="flex flex-wrap items-center gap-2">
              <strong>Round {rd.round}</strong>
              <Badge tone={rd.status === 'OPEN' ? 'warning' : 'neutral'}>
                {rd.status === 'OPEN' ? 'Open' : 'Closed'}
              </Badge>
              <span className="text-text-muted">Closes {formatDateTime(rd.closesAt)}</span>
              <span className="text-text-muted">Invited: {rd.invited.map((x) => x.company).join(', ')}</span>
            </div>
            <p className="mt-1 max-w-prose">{rd.note}</p>
            {rd.status === 'OPEN' ? (
              <p className="mt-1 text-text-muted">
                {rd.offersReceived} offer(s) received, sealed until the round closes.
              </p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1" aria-label={`Offers in round ${rd.round}`}>
                {rd.offers.length === 0 && <li className="text-text-muted">No offers were made.</li>}
                {rd.offers.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center gap-2" data-accepted={o.accepted}>
                    <strong>{o.company}</strong>
                    <span>revision {o.revision}</span>
                    <span className="font-mono">{aud(o.tco)}</span>
                    {o.note && <span className="text-text-muted">{o.note}</span>}
                    {o.accepted ? (
                      <Badge tone="success">Accepted</Badge>
                    ) : (
                      data.canAccept && (
                        <Button
                          variant="secondary"
                          aria-label={`Accept ${o.company} revision ${o.revision}`}
                          loading={r.busy === `acc-${o.id}`}
                          onClick={() =>
                            void r.run(
                              `acc-${o.id}`,
                              async () => {
                                await send(csrf, 'POST', `/bafo-offers/${o.id}/accept`);
                                await load();
                                await onChanged();
                              },
                              'Accepted: it now stands in the ranking.',
                            )
                          }
                        >
                          Accept
                        </Button>
                      )
                    )}
                  </li>
                ))}
              </ul>
            )}
            {rd.status === 'OPEN' && proc && (
              <div className="mt-2">
                <Button
                  variant="secondary"
                  aria-label={`Close round ${rd.round}`}
                  loading={r.busy === `close-${rd.id}`}
                  onClick={() =>
                    void r.run(`close-${rd.id}`, async () => {
                      await send(csrf, 'POST', `/bafo-rounds/${rd.id}/close`);
                      await load();
                    })
                  }
                >
                  Close the round
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {data.originalTco.some((x) => x.tco !== null) && (
        <p className="mt-2 text-xs text-text-muted">
          Original total costs:{' '}
          {data.originalTco
            .filter((x) => x.tco !== null)
            .map((x) => `${x.company} ${aud(x.tco!)}`)
            .join('; ')}
        </p>
      )}
      {canOpen && (
        <form
          className="mt-4 flex flex-col gap-3 border-t border-border pt-4"
          aria-label="Open a best and final offer round"
          onSubmit={(e) => {
            e.preventDefault();
            void r.run(
              'open',
              async () => {
                await send(csrf, 'POST', `/evaluations/${ev.id}/bafo`, {
                  supplierIds: form.picks,
                  note: form.note,
                  closesInDays: Number(form.days) || 3,
                });
                setForm({ note: '', days: '3', picks: [] });
                await load();
              },
              'The round is open and the suppliers were told.',
            );
          }}
        >
          <h3 className="font-heading text-base font-bold">Open a round</h3>
          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm font-semibold">Invite</legend>
            {ev.suppliers.map((s) => (
              <label key={s.supplierId} className="flex min-h-[44px] items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  className="size-5"
                  checked={form.picks.includes(s.supplierId)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      picks: e.target.checked
                        ? [...form.picks, s.supplierId]
                        : form.picks.filter((x) => x !== s.supplierId),
                    })
                  }
                />
                {s.displayName}
              </label>
            ))}
          </fieldset>
          <Field label="What you are asking for" hint="At least 10 characters">
            <Textarea
              rows={2}
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </Field>
          <Field label="Days to respond">
            <Input
              type="number"
              min={1}
              max={30}
              value={form.days}
              onChange={(e) => setForm({ ...form, days: e.target.value })}
              className="w-28"
            />
          </Field>
          <div>
            <Button
              type="submit"
              variant="secondary"
              loading={r.busy === 'open'}
              disabled={form.picks.length === 0 || form.note.trim().length < 10}
            >
              Open the round
            </Button>
          </div>
        </form>
      )}
      {r.messages}
    </Card>
  );
}

// ------------------------------------------------------------------ plain-language scores (FR-0315)
interface Reading {
  applied: boolean;
  scores: Array<{ criterionId: string; criterion: string; score: number; basis: string; comment: string }>;
  unmatched: string[];
}
export function PlainScoreEntry({ ev, csrf, onSaved }: { ev: EvalView; csrf: string; onSaved: () => void }) {
  const [suppliers, setSuppliers] = useState<MyScores['suppliers']>([]);
  const [supplierId, setSupplierId] = useState('');
  const [text, setText] = useState('');
  const [reading, setReading] = useState<Reading | null>(null);
  const r = useRunner();
  useEffect(() => {
    void api<MyScores>(`/evaluations/${ev.id}/scores/mine`).then(
      (d) => setSuppliers(d.suppliers),
      () => undefined,
    );
  }, [ev.id]);
  const body = (apply: boolean) => ({ supplierId, text, apply });
  return (
    <Card id="plain-h" title="Say it in words" testId="plain-scores">
      <p className="mt-2 max-w-prose text-sm text-text-muted">
        Describe how a supplier did, for example &ldquo;technical capability is strong, delivery is weak, 3
        out of 10&rdquo;. You see how it was read before anything is saved, and you can still change any score
        below.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Supplier">
          <Select
            value={supplierId}
            onChange={(e) => {
              setSupplierId(e.target.value);
              setReading(null);
            }}
          >
            <option value="">Choose…</option>
            {suppliers.map((s) => (
              <option key={s.supplierId} value={s.supplierId}>
                {s.displayName}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="mt-3">
        <Field label="Your assessment">
          <Textarea
            rows={3}
            maxLength={4000}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setReading(null);
            }}
          />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={!supplierId || text.trim().length < 3}
          loading={r.busy === 'read'}
          onClick={() =>
            void r.run('read', async () =>
              setReading(
                await send<Reading>(csrf, 'POST', `/evaluations/${ev.id}/scores/plain`, body(false)),
              ),
            )
          }
        >
          Read it back
        </Button>
        {reading && reading.scores.length > 0 && (
          <Button
            loading={r.busy === 'apply'}
            onClick={() =>
              void r.run(
                'apply',
                async () => {
                  await send(csrf, 'POST', `/evaluations/${ev.id}/scores/plain`, body(true));
                  setReading(null);
                  setText('');
                  onSaved();
                },
                'Saved. The scores are in the sheet below.',
              )
            }
          >
            Save these scores
          </Button>
        )}
      </div>
      {reading && (
        <div className="mt-3 rounded-md border border-border p-3 text-sm" data-testid="plain-reading">
          {reading.scores.length === 0 ? (
            <p>Nothing could be read as a score. Name a criterion and say how the supplier did.</p>
          ) : (
            <ul className="flex flex-col gap-1" aria-label="How your words were read">
              {reading.scores.map((s) => (
                <li key={s.criterionId}>
                  <strong>{s.criterion}</strong>: {s.score} out of 10{' '}
                  <span className="text-text-muted">(from &ldquo;{s.basis}&rdquo;)</span>
                </li>
              ))}
            </ul>
          )}
          {reading.unmatched.length > 0 && (
            <p className="mt-2 text-text-muted">Not used as a score: {reading.unmatched.join('; ')}</p>
          )}
        </div>
      )}
      {r.messages}
    </Card>
  );
}

// ------------------------------------------------------------------ ranking mode (FR-0280, FR-0315)
export function RankingEntry({
  ev,
  csrf,
  onDone,
}: {
  ev: EvalView;
  csrf: string;
  onDone: () => Promise<void>;
}) {
  const [data, setData] = useState<MyScores | null>(null);
  const [order, setOrder] = useState<Array<{ supplierId: string; displayName: string }>>([]);
  const [text, setText] = useState('');
  const [saved, setSaved] = useState(false);
  const r = useRunner();
  const load = useCallback(async () => {
    const d = await api<MyScores>(`/evaluations/${ev.id}/scores/mine`);
    setData(d);
    const crit = d.criteria[0]?.id;
    const has = d.suppliers.every((s) => s.scores.some((x) => x.criterionId === crit));
    setSaved(has);
    setOrder(
      d.suppliers
        .map((s) => ({
          supplierId: s.supplierId,
          displayName: s.displayName,
          score: s.scores.find((x) => x.criterionId === crit)?.score ?? -1,
        }))
        .sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName)),
    );
  }, [ev.id]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!data) return null;
  const move = (i: number, d: -1 | 1) => {
    const next = order.slice();
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    setOrder(next);
    setSaved(false);
  };
  return (
    <Card id="rankentry-h" title="Rank the suppliers" tone="accent" testId="ranking-entry">
      <p className="mt-2 max-w-prose text-sm text-text-muted">
        Put the suppliers in order, best first. The panel&apos;s order is blended with total cost of ownership
        ({ev.priceWeightPct}% weight) to give the final ranking. Nobody sees your order until the chair opens
        consensus.
      </p>
      <ol className="mt-3 flex flex-col gap-2" aria-label="Your order">
        {order.map((s, i) => (
          <li
            key={s.supplierId}
            className="flex items-center gap-2 rounded-md border border-border px-3 py-2"
            data-testid="rank-row"
          >
            <span className="inline-flex size-8 items-center justify-center rounded-full bg-brand-gradient text-sm font-extrabold">
              {i + 1}
            </span>
            <strong className="min-w-0 flex-1">{s.displayName}</strong>
            <Button
              variant="secondary"
              aria-label={`Move ${s.displayName} up`}
              disabled={i === 0}
              onClick={() => move(i, -1)}
            >
              <ArrowUp className="size-4" aria-hidden="true" />
            </Button>
            <Button
              variant="secondary"
              aria-label={`Move ${s.displayName} down`}
              disabled={i === order.length - 1}
              onClick={() => move(i, 1)}
            >
              <ArrowDown className="size-4" aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          loading={r.busy === 'save'}
          onClick={() =>
            void r.run(
              'save',
              async () => {
                await send(csrf, 'PUT', `/evaluations/${ev.id}/ranking`, {
                  order: order.map((x) => x.supplierId),
                });
                await load();
              },
              'Your ranking is saved.',
            )
          }
        >
          Save my ranking
        </Button>
        <Button
          loading={r.busy === 'submit'}
          disabled={!saved}
          onClick={() =>
            void r.run('submit', async () => {
              await send(csrf, 'POST', `/evaluations/${ev.id}/scores/submit`, {});
              await onDone();
            })
          }
        >
          Mark my ranking complete
        </Button>
      </div>
      <div className="mt-4 border-t border-border pt-3">
        <Field
          label="Or say it in words"
          hint='For example "Brightwave first, then Evergreen, and last Northstar"'
        >
          <Input value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <div className="mt-2">
          <Button
            variant="secondary"
            disabled={text.trim().length < 3}
            loading={r.busy === 'plain'}
            onClick={() =>
              void r.run(
                'plain',
                async () => {
                  await send(csrf, 'POST', `/evaluations/${ev.id}/ranking/plain`, { text, apply: true });
                  setText('');
                  await load();
                },
                'Read and saved.',
              )
            }
          >
            Save this order
          </Button>
        </div>
      </div>
      {r.messages}
    </Card>
  );
}
