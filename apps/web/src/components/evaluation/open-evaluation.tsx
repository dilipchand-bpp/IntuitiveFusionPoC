'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Dialog, Field, Input, Select } from '@if/ui';
import { ApiError, api } from '@/lib/api-client';

interface Candidate {
  id: string;
  name: string;
}

/** Procurement picks the panel: who evaluates, and whether each person reads technical or commercial responses. */
export function OpenEvaluation({ tenderId, title, csrf }: { tenderId: string; title: string; csrf: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<Candidate[] | null>(null);
  const [chairs, setChairs] = useState<Candidate[]>([]);
  const [picked, setPicked] = useState<Record<string, 'TECHNICAL' | 'COMMERCIAL'>>({});
  const [ranking, setRanking] = useState(false);
  const [weight, setWeight] = useState('30');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function show() {
    setOpen(true);
    setError(null);
    try {
      const r = await api<{ evaluators: Candidate[]; chairs: Candidate[] }>('/evaluators');
      setPeople(r.evaluators);
      setChairs(r.chairs);
    } catch {
      setError('The list of evaluators could not be loaded.');
    }
  }
  async function create() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: string }>(`/tenders/${tenderId}/evaluation`, {
        method: 'POST',
        csrf,
        body: {
          panel: Object.entries(picked).map(([userId, stream]) => ({ userId, stream })),
          ...(ranking ? { mode: 'RANKING', priceWeightPct: Number(weight) || 30 } : {}),
        },
      });
      router.push(`/app/evaluations/${r.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  }
  const count = Object.keys(picked).length;
  return (
    <>
      <Button onClick={() => void show()} aria-label={`Set up the evaluation for ${title}`}>
        Set up evaluation
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Choose the evaluation panel"
        description="Each evaluator declares any conflict of interest before they see who bid. Technical evaluators never see pricing."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button loading={busy} disabled={count === 0} onClick={() => void create()}>
              Open evaluation
            </Button>
          </>
        }
      >
        {!people ? (
          <p className="text-sm text-text-muted">{error ?? 'Loading…'}</p>
        ) : (
          <div className="flex flex-col gap-3">
            <ul className="flex flex-col gap-2" aria-label="Evaluators">
              {people.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-border px-3 py-2"
                >
                  <label className="flex min-h-[44px] flex-1 items-center gap-3 text-sm font-semibold">
                    <input
                      type="checkbox"
                      className="size-5 accent-[var(--if-color-accent)]"
                      checked={p.id in picked}
                      onChange={(e) =>
                        setPicked((cur) => {
                          const next = { ...cur };
                          if (e.target.checked) next[p.id] = 'TECHNICAL';
                          else delete next[p.id];
                          return next;
                        })
                      }
                    />
                    {p.name}
                  </label>
                  {p.id in picked && (
                    <Select
                      aria-label={`Stream for ${p.name}`}
                      className="w-48"
                      value={picked[p.id]}
                      onChange={(e) =>
                        setPicked((cur) => ({ ...cur, [p.id]: e.target.value as 'TECHNICAL' | 'COMMERCIAL' }))
                      }
                    >
                      <option value="TECHNICAL">Technical</option>
                      <option value="COMMERCIAL">Commercial</option>
                    </Select>
                  )}
                </li>
              ))}
            </ul>
            <div className="rounded-md border border-border p-3">
              <label className="flex min-h-[44px] items-center gap-3 text-sm font-semibold">
                <input
                  type="checkbox"
                  className="size-5 accent-[var(--if-color-accent)]"
                  checked={ranking}
                  onChange={(e) => setRanking(e.target.checked)}
                />
                Rank the suppliers instead of scoring every criterion
              </label>
              <p className="text-xs text-text-muted">
                For low-value, low-risk arrangements. The final order blends the panel&apos;s ranking with
                normalised total cost of ownership.
              </p>
              {ranking && (
                <div className="mt-2">
                  <Field label="Weight of total cost in the final ranking (%)">
                    <Input
                      type="number"
                      min={0}
                      max={80}
                      value={weight}
                      onChange={(e) => setWeight(e.target.value)}
                      className="w-28"
                    />
                  </Field>
                </div>
              )}
            </div>
            <p className="text-sm text-text-muted">
              {chairs.length
                ? `${chairs.map((c) => c.name).join(', ')} chairs the panel and is added automatically.`
                : 'There is no panel chair in the system.'}
            </p>
            {error && (
              <p role="alert" className="text-sm font-medium text-error">
                {error}
              </p>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}
