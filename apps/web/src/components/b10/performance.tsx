'use client';
import { useState } from 'react';
import { Badge, Button, Card, Field, Input } from '@if/ui';
import { send, useData, useRun } from '@/components/contract/b5-shared';

interface Summary {
  count: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
}
interface Perf extends Summary {
  targetMs: number;
  window: number;
  pass: boolean | null;
  intakeMessage: Summary;
  timer: string;
  note: string;
}
const ms = (n: number | null) =>
  n === null ? 'no data' : `${n.toLocaleString('en-AU', { maximumFractionDigits: 2 })} ms`;

function Stat({ label, value, testid }: { label: string; value: string; testid?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-alt p-3">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="mt-1 text-xl font-bold" data-testid={testid}>
        {value}
      </dd>
    </div>
  );
}

/** How fast the budget check answers inside the intake conversation, measured, against a target an administrator sets (NFR-P04). */
export function PerformancePanel({ csrf }: { csrf: string }) {
  const { data, error, reload } = useData<Perf>('/admin/performance/budget-check');
  const { busy, run, messages } = useRun();
  const [target, setTarget] = useState('');
  if (error && !data)
    return (
      <p role="alert" className="text-sm font-medium text-error">
        {error}
      </p>
    );
  if (!data) return <p className="text-sm text-text-muted">Loading measurements…</p>;
  const shown = target === '' ? String(data.targetMs) : target;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-heading text-xl font-bold">Budget check inside the conversation</h2>
          {data.pass === null ? (
            <Badge tone="neutral">No measurements yet</Badge>
          ) : (
            <Badge tone={data.pass ? 'success' : 'error'}>
              <span data-testid="perf-verdict">
                {data.pass ? 'Pass: p95 within target' : 'Fail: p95 over target'}
              </span>
            </Badge>
          )}
        </div>
        <p className="mt-2 max-w-prose text-sm text-text-muted">
          When someone states a value while describing a need, the budget check answers in the same reply.
          Each check is timed, and the latest {data.window} are summarised here. The target is judged on the
          95th percentile (p95): 95 checks in 100 are at least this fast.
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="Checks measured" value={String(data.count)} testid="perf-count" />
          <Stat label="Median (p50)" value={ms(data.p50)} testid="perf-p50" />
          <Stat label="p95" value={ms(data.p95)} testid="perf-p95" />
          <Stat label="Slowest" value={ms(data.max)} />
          <Stat label="Target" value={ms(data.targetMs)} testid="perf-target" />
        </dl>
        <p className="mt-3 text-sm text-text-muted">
          Whole intake messages (reading the message, updating the draft and the budget check):{' '}
          {data.intakeMessage.count} measured, median {ms(data.intakeMessage.p50)}, p95{' '}
          {ms(data.intakeMessage.p95)}.
        </p>
        <p className="mt-2 text-xs text-text-muted">
          Timer: {data.timer}. {data.note}
        </p>
      </Card>
      <Card>
        <h2 className="font-heading text-xl font-bold">Target</h2>
        <form
          className="mt-3 flex max-w-sm flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              'save',
              async () => {
                await send(csrf, 'PUT', '/admin/settings', { performance: { budgetCheckMs: Number(shown) } });
                setTarget('');
                await reload();
              },
              'Target saved. It applies to the next reading.',
            );
          }}
        >
          <Field label="Budget check target (milliseconds)" hint="Between 50 and 60,000. Default 2,000.">
            <Input
              type="number"
              min={50}
              max={60000}
              step={50}
              value={shown}
              onChange={(e) => setTarget(e.target.value)}
            />
          </Field>
          <Button type="submit" loading={busy === 'save'} disabled={!(Number(shown) >= 50) || busy !== null}>
            Save target
          </Button>
          {messages}
        </form>
      </Card>
    </div>
  );
}
