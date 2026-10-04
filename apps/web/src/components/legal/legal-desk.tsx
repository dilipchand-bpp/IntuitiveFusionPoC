'use client';
import { useCallback, useState } from 'react';
import { Badge, Button, Card, Field, Input, Select, Textarea } from '@if/ui';
import { ApiError, api } from '@/lib/api-client';

export interface Matter {
  id: string;
  title: string;
  lane: 'NEW' | 'IN_REVIEW' | 'WAITING' | 'DONE';
  priority: 'LOW' | 'NORMAL' | 'HIGH';
  dueOn: string | null;
  assignee: string | null;
  contractNumber: string | null;
  hours: number;
}
export interface Board {
  lanes: Array<{ lane: Matter['lane']; matters: Matter[] }>;
  totalHours: number;
}
export interface Knowledge {
  id: string;
  kind: 'POLICY' | 'ADVICE' | 'FALLBACK' | 'BOILERPLATE';
  title: string;
  body: string;
  clauseId: string | null;
  tags: string;
  by: string;
}
const LANE = { NEW: 'New', IN_REVIEW: 'In review', WAITING: 'Waiting', DONE: 'Done' } as const;
const KIND = {
  POLICY: 'Policy',
  ADVICE: 'Historical advice',
  FALLBACK: 'Fallback position',
  BOILERPLATE: 'Boilerplate',
} as const;
const message = (e: unknown) =>
  e instanceof ApiError
    ? [e.message, ...(e.problem.errors ?? []).map((x) => x.message)].join(' ')
    : 'Something went wrong.';

/** Native legal matter management: a board, review hours, and the knowledge base the advisers draw on (FR-0385, FR-0470). */
export function LegalDesk({
  initialBoard,
  initialKnowledge,
  csrf,
  canEdit,
}: {
  initialBoard: Board;
  initialKnowledge: Knowledge[];
  csrf: string;
  canEdit: boolean;
}) {
  const [board, setBoard] = useState(initialBoard);
  const [kb, setKb] = useState(initialKnowledge);
  const [title, setTitle] = useState('');
  const [hours, setHours] = useState<Record<string, string>>({});
  const [nk, setNk] = useState({ kind: 'FALLBACK', title: '', body: '', clauseId: '', tags: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  const reload = useCallback(async () => {
    setBoard(await api<Board>('/legal/matters'));
    setKb((await api<{ items: Knowledge[] }>('/legal-knowledge')).items);
  }, []);
  async function go(name: string, fn: () => Promise<void>, ok?: string) {
    setBusy(name);
    setError(null);
    setNote(null);
    try {
      await fn();
      await reload();
      if (ok) setNote(ok);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }
  const lanes = ['NEW', 'IN_REVIEW', 'WAITING', 'DONE'] as const;
  return (
    <div className="flex flex-col gap-8" data-testid="legal-desk">
      {error && (
        <p
          role="alert"
          className="rounded-md border border-error bg-error-bg p-3 text-sm font-medium text-error"
        >
          {error}
        </p>
      )}
      {note && (
        <p
          role="status"
          className="rounded-md border border-success bg-success-bg p-3 text-sm font-medium text-success"
        >
          {note}
        </p>
      )}
      <section aria-labelledby="board-h" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="board-h" className="font-heading text-xl font-bold">
            Matters
          </h2>
          <Badge tone="info">{board.totalHours.toFixed(2)} review hours logged</Badge>
        </div>
        {canEdit && (
          <form
            className="flex flex-wrap items-end gap-2"
            aria-label="Open a matter"
            onSubmit={(e) => {
              e.preventDefault();
              void go(
                'create',
                async () => {
                  await api('/legal/matters', { method: 'POST', csrf, body: { title } });
                  setTitle('');
                },
                'Matter opened.',
              );
            }}
          >
            <Field label="New matter">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} className="w-80 max-w-full" />
            </Field>
            <Button
              type="submit"
              variant="secondary"
              disabled={title.trim().length < 3}
              loading={busy === 'create'}
            >
              Open matter
            </Button>
          </form>
        )}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {board.lanes.map((l) => (
            <section
              key={l.lane}
              aria-label={LANE[l.lane]}
              className="rounded-lg border border-border bg-surface-alt/50 p-3"
              data-lane={l.lane}
            >
              <h3 className="text-sm font-bold uppercase tracking-wide text-text-muted">
                {LANE[l.lane]} ({l.matters.length})
              </h3>
              <ul className="mt-2 flex flex-col gap-2">
                {l.matters.map((m) => (
                  <li
                    key={m.id}
                    className="rounded-md border border-border bg-surface p-3 text-sm shadow-sm"
                    data-testid="matter"
                  >
                    <p className="font-semibold">{m.title}</p>
                    <p className="mt-1 text-xs text-text-muted">
                      {m.contractNumber ?? 'No contract'} · {m.priority.toLowerCase()} · {m.hours.toFixed(2)}{' '}
                      h{m.assignee ? ` · ${m.assignee}` : ''}
                      {m.dueOn ? ` · due ${m.dueOn}` : ''}
                    </p>
                    {canEdit && (
                      <div className="mt-2 flex flex-col gap-2">
                        <Field label={`Move ${m.title}`}>
                          <Select
                            value={m.lane}
                            onChange={(e) =>
                              void go(`move-${m.id}`, async () => {
                                await api(`/legal/matters/${m.id}`, {
                                  method: 'PATCH',
                                  csrf,
                                  body: { lane: e.target.value },
                                });
                              })
                            }
                          >
                            {lanes.map((x) => (
                              <option key={x} value={x}>
                                {LANE[x]}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <div className="flex items-end gap-2">
                          <Field label={`Hours on ${m.title}`}>
                            <Input
                              type="number"
                              min={0.25}
                              max={24}
                              step={0.25}
                              value={hours[m.id] ?? ''}
                              onChange={(e) => setHours({ ...hours, [m.id]: e.target.value })}
                            />
                          </Field>
                          <Button
                            variant="secondary"
                            aria-label={`Log hours on ${m.title}`}
                            disabled={!hours[m.id] || Number(hours[m.id]) <= 0}
                            loading={busy === `time-${m.id}`}
                            onClick={() =>
                              void go(
                                `time-${m.id}`,
                                async () => {
                                  await api(`/legal/matters/${m.id}/time`, {
                                    method: 'POST',
                                    csrf,
                                    body: { hours: Number(hours[m.id]), workDate: today },
                                  });
                                  setHours({ ...hours, [m.id]: '' });
                                },
                                'Hours logged.',
                              )
                            }
                          >
                            Log
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </section>

      <section aria-labelledby="kb-h" className="flex flex-col gap-3">
        <h2 id="kb-h" className="font-heading text-xl font-bold">
          Knowledge base
        </h2>
        <p className="max-w-prose text-sm text-text-muted">
          Policies, historical advice, corporate fallback positions and mandatory boilerplate. The advisers
          use them when they explain a deviation or suggest a negotiation strategy.
        </p>
        <ul className="grid gap-3 md:grid-cols-2" aria-label="Knowledge entries">
          {kb.length === 0 && <li className="text-sm text-text-muted">Nothing has been added yet.</li>}
          {kb.map((k) => (
            <li
              key={k.id}
              className="rounded-md border border-border bg-surface p-3 text-sm"
              data-testid="knowledge"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="neutral">{KIND[k.kind]}</Badge>
                <strong>{k.title}</strong>
                {k.clauseId && <span className="text-xs text-text-muted">clause {k.clauseId}</span>}
              </div>
              <p className="mt-1 whitespace-pre-wrap">{k.body}</p>
              {canEdit && (
                <Button
                  variant="secondary"
                  className="mt-2"
                  aria-label={`Remove ${k.title}`}
                  loading={busy === `rm-${k.id}`}
                  onClick={() =>
                    void go(`rm-${k.id}`, async () => {
                      await api(`/legal-knowledge/${k.id}`, { method: 'DELETE', csrf });
                    })
                  }
                >
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
        {canEdit && (
          <Card role="region" aria-labelledby="addkb-h">
            <h3 id="addkb-h" className="font-heading text-lg font-bold">
              Add to the knowledge base
            </h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Kind">
                <Select value={nk.kind} onChange={(e) => setNk({ ...nk, kind: e.target.value })}>
                  {(Object.keys(KIND) as Array<keyof typeof KIND>).map((k) => (
                    <option key={k} value={k}>
                      {KIND[k]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Title">
                <Input value={nk.title} onChange={(e) => setNk({ ...nk, title: e.target.value })} />
              </Field>
              <Field label="Clause it concerns (optional)">
                <Input value={nk.clauseId} onChange={(e) => setNk({ ...nk, clauseId: e.target.value })} />
              </Field>
              <Field label="Tags (words the advisers match on)">
                <Input value={nk.tags} onChange={(e) => setNk({ ...nk, tags: e.target.value })} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Text" hint="At least 10 characters">
                  <Textarea
                    rows={4}
                    value={nk.body}
                    onChange={(e) => setNk({ ...nk, body: e.target.value })}
                  />
                </Field>
              </div>
            </div>
            <div className="mt-3">
              <Button
                loading={busy === 'addkb'}
                disabled={nk.title.trim().length < 3 || nk.body.trim().length < 10}
                onClick={() =>
                  void go(
                    'addkb',
                    async () => {
                      await api('/legal-knowledge', {
                        method: 'POST',
                        csrf,
                        body: {
                          kind: nk.kind,
                          title: nk.title,
                          body: nk.body,
                          ...(nk.clauseId ? { clauseId: nk.clauseId } : {}),
                          ...(nk.tags ? { tags: nk.tags } : {}),
                        },
                      });
                      setNk({ kind: 'FALLBACK', title: '', body: '', clauseId: '', tags: '' });
                    },
                    'Added.',
                  )
                }
              >
                Add entry
              </Button>
            </div>
          </Card>
        )}
      </section>
    </div>
  );
}
