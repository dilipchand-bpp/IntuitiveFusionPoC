'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Field, Input, Textarea } from '@if/ui';
import { ApiError, api } from '@/lib/api-client';

interface Deviation {
  id: string;
  clauseRef: string;
  proposal: string;
  reason?: string;
}

/** Changes to the contract the supplier proposes as part of their response. They go to legal's register at close (FR-0125). */
export function DeviationsCard({ tenderId, open, csrf }: { tenderId: string; open: boolean; csrf: string }) {
  const [list, setList] = useState<Deviation[]>([]);
  const [clauseRef, setClauseRef] = useState('');
  const [proposal, setProposal] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async () => setList(await api<Deviation[]>(`/supplier/tenders/${tenderId}/deviations`).catch(() => [])),
    [tenderId],
  );
  useEffect(() => void load(), [load]);

  async function go(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? [e.message, ...(e.problem.errors ?? []).map((x) => x.message)].join(' ')
          : 'Something went wrong.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card role="region" aria-labelledby="dev-h" data-testid="supplier-deviations">
      <h2 id="dev-h" className="font-heading text-xl font-bold">
        Proposed changes to the contract
      </h2>
      <p className="mt-1 max-w-prose text-sm text-text-muted">
        If you need a clause to read differently, say so here. Each change is listed separately for the
        buyer&apos;s legal team. Nothing here is agreed until the buyer says so.
      </p>
      <ul className="mt-3 flex flex-col gap-2" aria-label="Your proposed changes">
        {list.length === 0 && <li className="text-sm text-text-muted">You have not proposed any changes.</li>}
        {list.map((d) => (
          <li
            key={d.id}
            className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-border p-3 text-sm"
            data-testid="my-deviation"
          >
            <span>
              <span className="font-semibold">{d.clauseRef}</span>
              <span className="block">{d.proposal}</span>
              {d.reason && <span className="block text-xs text-text-muted">{d.reason}</span>}
            </span>
            {open && (
              <Button
                variant="ghost"
                aria-label={`Withdraw change to ${d.clauseRef}`}
                onClick={() =>
                  void go(
                    async () =>
                      void (await api(`/supplier/tenders/${tenderId}/deviations/${d.id}`, {
                        method: 'DELETE',
                        csrf,
                      })),
                  )
                }
              >
                Withdraw
              </Button>
            )}
          </li>
        ))}
      </ul>
      {open && (
        <form
          className="mt-4 flex flex-col gap-2"
          aria-label="Propose a change"
          onSubmit={(e) => {
            e.preventDefault();
            void go(async () => {
              await api(`/supplier/tenders/${tenderId}/deviations`, {
                method: 'POST',
                csrf,
                body: { clauseRef, proposal, ...(reason.trim() ? { reason } : {}) },
              });
              setClauseRef('');
              setProposal('');
              setReason('');
            });
          }}
        >
          <Field label="Clause" hint="For example 12.1 Liability">
            <Input value={clauseRef} onChange={(e) => setClauseRef(e.target.value)} maxLength={80} required />
          </Field>
          <Field label="What you propose instead">
            <Textarea
              rows={3}
              value={proposal}
              onChange={(e) => setProposal(e.target.value)}
              minLength={5}
              maxLength={3000}
              required
            />
          </Field>
          <Field label="Why (optional)">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} />
          </Field>
          {error && (
            <p role="alert" className="text-sm font-medium text-error">
              {error}
            </p>
          )}
          <div>
            <Button type="submit" variant="secondary" loading={busy}>
              Add the proposed change
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
