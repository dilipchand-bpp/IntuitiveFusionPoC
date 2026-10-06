'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge, Button, Card, Field, Input, Select } from '@if/ui';
import { send, useData, useRun } from '@/components/contract/b5-shared';

const KIND: Record<string, string> = {
  WENT_WELL: 'Went well',
  TO_IMPROVE: 'To improve',
  RISK: 'Risk',
  TIP: 'Tip',
};
const TONE: Record<string, 'success' | 'warning' | 'error' | 'info'> = {
  WENT_WELL: 'success',
  TO_IMPROVE: 'warning',
  RISK: 'error',
  TIP: 'info',
};

interface Lesson {
  id: string;
  kind: string;
  phase: string;
  text: string;
  by: string;
}
interface Recall {
  lessons: Array<{
    id: string;
    kind: string;
    phase: string;
    text: string;
    why: string[];
    from: { id: string; number: string; title: string } | null;
  }>;
}

/** Lessons learned on this procurement, lessons from comparable ones, and closing it (FR-0805). */
export function LessonsPanel({
  requestId,
  phase,
  csrf,
  canClose,
}: {
  requestId: string;
  phase: string;
  csrf: string;
  canClose: boolean;
}) {
  const router = useRouter();
  const mine = useData<Lesson[]>(`/requests/${requestId}/lessons`);
  const recall = useData<Recall>(`/requests/${requestId}/lessons/recall`);
  const [kind, setKind] = useState('TIP');
  const [text, setText] = useState('');
  const [skip, setSkip] = useState('');
  const [reason, setReason] = useState('');
  const [closing, setClosing] = useState<'COMPLETED' | 'CANCELLED' | null>(null);
  const r = useRun();
  const closed = phase === 'CLOSED';
  return (
    <Card role="region" aria-labelledby="les-h" data-testid="lessons">
      <h2 id="les-h" className="font-heading text-xl font-bold">
        Lessons learned
      </h2>
      {recall.data && recall.data.lessons.length > 0 && (
        <div className="mt-2 rounded-md border border-accent/40 bg-accent/5 p-3" data-testid="recall">
          <p className="text-sm font-semibold">From similar procurements</p>
          <ul className="mt-1 flex flex-col gap-2 text-sm">
            {recall.data.lessons.map((l) => (
              <li key={l.id}>
                <Badge tone={TONE[l.kind] ?? 'neutral'}>{KIND[l.kind] ?? l.kind}</Badge> {l.text}{' '}
                <span className="text-xs text-text-muted">
                  ({l.why.join(', ')}
                  {l.from ? (
                    <>
                      ; from <Link href={`/app/requests/${l.from.id}`}>{l.from.number}</Link>
                    </>
                  ) : (
                    '; from another procurement'
                  )}
                  )
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-text-muted">
            Chosen by a rules-based stand-in for an AI model (rules-simulated-v1).
          </p>
        </div>
      )}
      <ul className="mt-3 flex flex-col gap-2 text-sm" aria-label="Lessons on this procurement">
        {(mine.data ?? []).length === 0 && <li className="text-text-muted">None recorded yet.</li>}
        {(mine.data ?? []).map((l) => (
          <li key={l.id}>
            <Badge tone={TONE[l.kind] ?? 'neutral'}>{KIND[l.kind] ?? l.kind}</Badge> {l.text}{' '}
            <span className="text-xs text-text-muted">{l.by}</span>
          </li>
        ))}
      </ul>
      {!closed && (
        <form
          className="mt-3 flex flex-col gap-2"
          aria-label="Add a lesson"
          onSubmit={(e) => {
            e.preventDefault();
            void r.run('add', async () => {
              await send(csrf, 'POST', `/requests/${requestId}/lessons`, { kind, text });
              setText('');
              await mine.reload();
            });
          }}
        >
          <div className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <Field label="Kind">
              <Select value={kind} onChange={(e) => setKind(e.target.value)}>
                {Object.entries(KIND).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="What did you learn?">
              <Input value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} />
            </Field>
          </div>
          <div>
            <Button
              type="submit"
              variant="secondary"
              loading={r.busy === 'add'}
              disabled={text.trim().length < 10}
            >
              Add lesson
            </Button>
          </div>
        </form>
      )}
      {canClose && !closed && (
        <div className="mt-4 border-t border-border pt-4">
          {closing === null ? (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={phase !== 'CONTRACT_MGMT'}
                onClick={() => setClosing('COMPLETED')}
              >
                Close this procurement
              </Button>
              <Button variant="ghost" onClick={() => setClosing('CANCELLED')}>
                Cancel it
              </Button>
              {phase !== 'CONTRACT_MGMT' && (
                <p className="self-center text-xs text-text-muted">
                  It can be closed as complete once its contract is in management.
                </p>
              )}
            </div>
          ) : (
            <form
              className="flex flex-col gap-2"
              aria-label={closing === 'COMPLETED' ? 'Close the procurement' : 'Cancel the procurement'}
              onSubmit={(e) => {
                e.preventDefault();
                void r.run('close', async () => {
                  await send(csrf, 'POST', `/requests/${requestId}/close`, {
                    outcome: closing,
                    ...(reason ? { reason } : {}),
                    ...(skip ? { skipLessonsReason: skip } : {}),
                  });
                  router.refresh();
                });
              }}
            >
              {closing === 'CANCELLED' && (
                <Field label="Why is it being cancelled?">
                  <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
                </Field>
              )}
              {(mine.data ?? []).length === 0 && (
                <Field
                  label="No lesson is recorded. Why is there nothing to record?"
                  hint="Or add a lesson above."
                >
                  <Input value={skip} onChange={(e) => setSkip(e.target.value)} maxLength={500} />
                </Field>
              )}
              <div className="flex gap-2">
                <Button type="submit" loading={r.busy === 'close'}>
                  {closing === 'COMPLETED' ? 'Close it' : 'Cancel it'}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setClosing(null)}>
                  Not now
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
      {r.messages}
    </Card>
  );
}
