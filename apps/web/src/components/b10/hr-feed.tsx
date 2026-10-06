'use client';
import { useState } from 'react';
import { Badge, Button, Card, Field, Select, Table, Td, Th } from '@if/ui';
import { send, useData, useRun } from '@/components/contract/b5-shared';

interface Result {
  eventId: string;
  type: string;
  email: string;
  outcome: string;
  detail: string;
  activationPath?: string;
}
interface Run {
  ok: boolean;
  dryRun: boolean;
  batchRef: string | null;
  results: Result[];
  counts: Record<string, number>;
  reason: string | null;
  error: string | null;
}
interface Overview {
  nextBatch: number | null;
  totalBatches: number;
  connector: { providerLabel: string; enabled: boolean; mode: string; health: string } | null;
  batches: Array<{ id: string; batchRef: string; at: string; counts: Record<string, number> }>;
  events: Array<{
    id: string;
    eventId: string;
    type: string;
    email: string;
    outcome: string;
    detail: string;
    at: string;
  }>;
  exceptions: Array<{ eventId: string; type: string; email: string; outcome: string; detail: string }>;
  delegations: Array<{
    id: string;
    delegator: string | null;
    delegate: string | null;
    scope: string;
    requestedLimit: number;
    appliedLimit: number;
    startsOn: string;
    endsOn: string;
    status: string;
  }>;
  reassignments: Array<{
    id: string;
    leaver: string | null;
    backup: string | null;
    kind: string;
    label: string;
    status: string;
  }>;
  starters: Array<{ id: string; email: string; name: string; awaitingActivation: boolean }>;
}

const TONE: Record<string, 'success' | 'warning' | 'error' | 'neutral' | 'info'> = {
  APPLIED: 'success',
  NO_CHANGE: 'neutral',
  DUPLICATE: 'neutral',
  CAPPED: 'warning',
  REFUSED: 'error',
  NEEDS_HUMAN: 'warning',
};
const LABEL: Record<string, string> = {
  APPLIED: 'Applied',
  NO_CHANGE: 'No change',
  DUPLICATE: 'Already handled',
  CAPPED: 'Applied, capped',
  REFUSED: 'Refused',
  NEEDS_HUMAN: 'Needs a person',
};
const TYPE: Record<string, string> = {
  STARTER: 'Starter',
  LEAVER: 'Leaver',
  ROLE_CHANGE: 'Role change',
  DELEGATE_CHANGE: 'Delegate change',
};

function ResultTable({ rows, caption }: { rows: Result[]; caption: string }) {
  return (
    <Table caption={caption}>
      <thead>
        <tr>
          <Th>Event</Th>
          <Th>Person</Th>
          <Th>Outcome</Th>
          <Th>What happened</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.eventId} data-testid="hr-result-row">
            <Td label="Event">
              <span className="font-mono text-xs">{r.eventId}</span> {TYPE[r.type] ?? r.type}
            </Td>
            <Td label="Person">{r.email}</Td>
            <Td label="Outcome">
              <Badge tone={TONE[r.outcome] ?? 'neutral'}>{LABEL[r.outcome] ?? r.outcome}</Badge>
            </Td>
            <Td label="What happened">
              {r.detail}
              {r.activationPath && (
                <span className="mt-1 block text-xs text-text-muted">
                  Activation link (shown once):{' '}
                  <span className="break-all font-mono">{r.activationPath}</span>
                </span>
              )}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** The simulated HR feed: preview, apply, history and the exceptions that need a person (FR-0815). */
export function HrFeedPanel({ csrf }: { csrf: string }) {
  const ov = useData<Overview>('/hr-feed/overview');
  const { busy, run, messages } = useRun();
  const [last, setLast] = useState<Run | null>(null);
  const [batch, setBatch] = useState('');
  const o = ov.data;
  if (ov.error && !o)
    return (
      <p role="alert" className="text-sm font-medium text-error">
        {ov.error}
      </p>
    );
  if (!o) return <p className="text-sm text-text-muted">Loading the HR feed…</p>;
  const go = (dryRun: boolean) =>
    run(dryRun ? 'preview' : 'apply', async () => {
      const r = await send<Run>(csrf, 'POST', '/hr-feed/run', {
        dryRun,
        ...(batch ? { batch: Number(batch) } : {}),
      });
      setLast(r);
      await ov.reload();
    });
  const c = o.connector;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-heading text-xl font-bold">HR system</h2>
          <Badge tone="info">SIMULATED</Badge>
          {c && (
            <Badge tone={c.enabled && c.mode === 'UP' ? 'success' : 'error'}>
              {c.providerLabel}: {c.enabled ? c.health.toLowerCase() : 'switched off'}
            </Badge>
          )}
        </div>
        <p className="mt-2 max-w-prose text-sm text-text-muted">
          Starters, leavers, role changes and acting delegates arrive in batches. Each event is applied once.
          The feed never grants the administrator role and never lifts a delegation above the delegator&apos;s
          own limit; those are listed below for a person to decide. Starters cannot sign in until they use the
          one-time activation link.
          {c && !c.enabled ? ' Switch the HR connector on in Connectors first.' : ''}
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Field
            label="Batch"
            hint={
              o.nextBatch
                ? `Next is ${o.nextBatch} of ${o.totalBatches}.`
                : 'All batches have been applied; choose one to show that a repeat changes nothing.'
            }
          >
            <Select value={batch} onChange={(e) => setBatch(e.target.value)} aria-label="Batch">
              <option value="">{o.nextBatch ? `Next (${o.nextBatch})` : 'Choose'}</option>
              {Array.from({ length: o.totalBatches }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  Batch {n}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            variant="secondary"
            onClick={() => void go(true)}
            loading={busy === 'preview'}
            disabled={busy !== null || (!o.nextBatch && !batch)}
          >
            Preview
          </Button>
          <Button
            onClick={() => void go(false)}
            loading={busy === 'apply'}
            disabled={busy !== null || (!o.nextBatch && !batch)}
          >
            Apply batch
          </Button>
        </div>
        {messages}
        {last && !last.ok && (
          <p role="alert" className="mt-3 text-sm font-medium text-error" data-testid="hr-failed">
            The feed was not applied ({last.reason}): {last.error}. A task for doing it by hand was queued on
            the Connectors page.
          </p>
        )}
        {last?.ok && (
          <div className="mt-4 flex flex-col gap-2" data-testid="hr-run">
            <p role="status" className="text-sm font-medium text-success">
              {last.dryRun ? 'Preview of' : 'Applied'} {last.batchRef}:{' '}
              {Object.entries(last.counts)
                .filter(([k]) => k !== 'total')
                .map(([k, v]) => `${v} ${(LABEL[k] ?? k).toLowerCase()}`)
                .join(', ')}
              .{last.dryRun ? ' Nothing was changed.' : ''}
            </p>
            <ResultTable rows={last.results} caption="Events in this batch" />
          </div>
        )}
      </Card>

      <Card>
        <h2 className="font-heading text-xl font-bold">Needs a person ({o.exceptions.length})</h2>
        {o.exceptions.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">Nothing needs attention.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2" data-testid="hr-exceptions">
            {o.exceptions.map((e) => (
              <li key={e.eventId} className="rounded-md border border-border p-3 text-sm">
                <Badge tone={TONE[e.outcome] ?? 'neutral'}>{LABEL[e.outcome] ?? e.outcome}</Badge>{' '}
                <span className="font-mono text-xs">{e.eventId}</span> {TYPE[e.type]} for {e.email}:{' '}
                {e.detail}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="font-heading text-xl font-bold">Acting delegates</h2>
        <Table caption="Delegations from the feed">
          <thead>
            <tr>
              <Th>Delegate</Th>
              <Th>From</Th>
              <Th>Scope</Th>
              <Th className="text-right">Limit</Th>
              <Th>Dates</Th>
              <Th>State</Th>
            </tr>
          </thead>
          <tbody>
            {o.delegations.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-3 text-text-muted">
                  None yet.
                </td>
              </tr>
            )}
            {o.delegations.map((d) => (
              <tr key={d.id} data-testid="hr-delegation-row">
                <Td label="Delegate">{d.delegate}</Td>
                <Td label="From">{d.delegator}</Td>
                <Td label="Scope">{d.scope.replace(/_/g, ' ').toLowerCase()}</Td>
                <Td label="Limit" className="text-right">
                  {d.appliedLimit.toLocaleString('en-AU')}
                  {d.appliedLimit < d.requestedLimit
                    ? ` (asked ${d.requestedLimit.toLocaleString('en-AU')})`
                    : ''}
                </Td>
                <Td label="Dates">
                  {d.startsOn} to {d.endsOn}
                </Td>
                <Td label="State">
                  <Badge tone={d.status === 'ACTIVE' ? 'success' : 'neutral'}>{d.status.toLowerCase()}</Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card>
        <h2 className="font-heading text-xl font-bold">Leavers: work to reassign</h2>
        <Table caption="Open items of leavers">
          <thead>
            <tr>
              <Th>Leaver</Th>
              <Th>Item</Th>
              <Th>Named backup</Th>
              <Th>State</Th>
              <Th>
                <span className="sr-only">Action</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {o.reassignments.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-3 text-text-muted">
                  None.
                </td>
              </tr>
            )}
            {o.reassignments.map((r) => (
              <tr key={r.id} data-testid="hr-reassignment-row">
                <Td label="Leaver">{r.leaver}</Td>
                <Td label="Item">
                  {r.kind.toLowerCase()}: {r.label}
                </Td>
                <Td label="Named backup">{r.backup ?? 'None named'}</Td>
                <Td label="State">
                  <Badge tone={r.status === 'DONE' ? 'success' : 'warning'}>
                    {r.status === 'DONE' ? 'Done' : 'Open'}
                  </Badge>
                </Td>
                <Td label="Action">
                  {r.status === 'OPEN' && (
                    <Button
                      variant="secondary"
                      aria-label={`Mark reassigned: ${r.label}`}
                      loading={busy === r.id}
                      onClick={() =>
                        void run(r.id, async () => {
                          await send(csrf, 'POST', `/hr-feed/reassignments/${r.id}/done`);
                          await ov.reload();
                        })
                      }
                    >
                      Mark reassigned
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card>
        <h2 className="font-heading text-xl font-bold">History</h2>
        <p className="mt-1 text-sm text-text-muted">
          {o.batches.length} batch{o.batches.length === 1 ? '' : 'es'} applied.{' '}
          {o.starters.filter((s) => s.awaitingActivation).length} starter(s) still to activate; issue a new
          link from{' '}
          <a href="/admin/users" className="underline">
            Users &amp; roles
          </a>
          .
        </p>
        <ResultTable
          caption="Every event applied"
          rows={o.events.map((e) => ({
            eventId: e.eventId,
            type: e.type,
            email: e.email,
            outcome: e.outcome,
            detail: e.detail,
          }))}
        />
      </Card>
    </div>
  );
}
