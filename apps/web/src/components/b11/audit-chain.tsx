'use client';
import { Badge, Button, Card, Table, Td, Th } from '@if/ui';
import { send, useData, useRun } from '@/components/contract/b5-shared';
import { formatDateTime } from '@/lib/labels';

interface Chain {
  status: 'INTACT' | 'BROKEN';
  ok: boolean;
  checked: number;
  adminEvents: number;
  headSeq: number | null;
  headHash: string | null;
  adminHeadSeq: number | null;
  adminDigest: string;
  brokenAtSeq: number | null;
  reason: string | null;
  categoryMismatches: number;
  verifiedAt: string;
  guards: Array<{ name: string; kind: string }>;
  lastRecordedVerification: {
    at: string;
    by: string | null;
    ok: boolean;
    checked: number;
    headHash: string | null;
  } | null;
  recordedVerifications: number;
  recent: Array<{
    seq: number;
    at: string;
    action: string;
    actor: string | null;
    actorRole: string | null;
    result: string;
    hash: string;
    prevHash: string;
  }>;
}

const short = (h: string | null) => (h ? `${h.slice(0, 12)}…${h.slice(-6)}` : 'none');

/** Re-computes the whole hash chain and shows the administrative events in it. Readable by probity, executives and administrators (SEC-L02). */
export function AuditChainPanel({ csrf }: { csrf: string }) {
  const { data, error, reload } = useData<Chain>('/audit/admin-chain');
  const { busy, run, messages } = useRun();
  if (error && !data)
    return (
      <p role="alert" className="text-sm font-medium text-error">
        {error}
      </p>
    );
  if (!data) return <p className="text-sm text-text-muted">Checking the chain…</p>;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Card role="region" aria-labelledby="chain-h">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="chain-h" className="font-heading text-xl font-bold">
            Chain status
          </h2>
          <Badge tone={data.ok ? 'success' : 'error'}>
            <span data-testid="chain-status" data-status={data.status}>
              {data.ok ? 'Intact' : `Broken at event ${data.brokenAtSeq}`}
            </span>
          </Badge>
        </div>
        <p className="mt-2 max-w-prose text-sm text-text-muted">
          Every event is hashed together with the hash of the event before it, so changing, removing or
          reordering any event breaks every link after it. This page re-computes the whole chain now; it does
          not trust a stored result. Administrative actions (users, roles, delegations, settings, connectors,
          secrets, keys, AI model approvals, configuration import, residency) are flagged in the database
          itself and cannot be re-labelled. Probity and executives can check this as well as administrators,
          so the people whose actions are recorded are not the only ones who can vouch for the record.
        </p>
        {!data.ok && (
          <p role="alert" className="mt-3 text-sm font-semibold text-error">
            {data.reason} The first broken link is event {data.brokenAtSeq}.
          </p>
        )}
        <dl className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ['Events checked', String(data.checked)],
            ['Administrative events', String(data.adminEvents)],
            ['Head of the chain', short(data.headHash)],
            ['Administrative digest', short(data.adminDigest)],
          ].map(([k = '', v]) => (
            <div key={k} className="rounded-lg border border-border bg-surface-alt p-3">
              <dt className="text-xs text-text-muted">{k}</dt>
              <dd
                className="mt-1 break-all font-mono text-sm font-semibold"
                data-testid={`chain-${(k.split(' ')[0] ?? '').toLowerCase()}`}
              >
                {v}
              </dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            loading={busy === 'verify'}
            disabled={busy !== null}
            onClick={() =>
              void run(
                'verify',
                async () => {
                  await send(csrf, 'POST', '/audit/admin-chain/verify');
                  await reload();
                },
                'Verified and recorded in the audit trail.',
              )
            }
          >
            Verify and record
          </Button>
          <p className="text-sm text-text-muted">
            {data.lastRecordedVerification
              ? `Last recorded verification: ${formatDateTime(data.lastRecordedVerification.at)} by ${data.lastRecordedVerification.by ?? 'the system'} (${data.recordedVerifications} in all).`
              : 'No verification has been recorded yet.'}
          </p>
        </div>
        {messages}
      </Card>

      <Card role="region" aria-labelledby="guards-h">
        <h2 id="guards-h" className="font-heading text-xl font-bold">
          What stops the record being changed
        </h2>
        <ul className="mt-2 list-disc pl-6 text-sm" data-testid="chain-guards">
          <li>
            The application&apos;s database role can only add and read audit events; update, delete and
            truncate are refused.
          </li>
          {data.guards.map((g) => (
            <li key={g.name}>
              <code className="text-xs">{g.name}</code>: {g.kind}.
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-text-muted">
          A person with direct access to the database who disables these guards can still change a row, and
          the chain check above then fails at that row. Production adds an external anchor for the head hash.
        </p>
      </Card>

      <section aria-labelledby="recent-h" className="flex flex-col gap-3">
        <h2 id="recent-h" className="font-heading text-xl font-bold">
          Recent administrative events
        </h2>
        <Table caption="Recent administrative events">
          <thead>
            <tr>
              <Th>Event</Th>
              <Th>Time</Th>
              <Th>Who</Th>
              <Th>Action</Th>
              <Th>Result</Th>
              <Th>Hash</Th>
            </tr>
          </thead>
          <tbody>
            {data.recent.map((r) => (
              <tr key={r.seq} data-testid="chain-row">
                <Td label="Event">{r.seq}</Td>
                <Td label="Time" className="whitespace-nowrap text-xs">
                  {formatDateTime(r.at)}
                </Td>
                <Td label="Who">
                  {r.actor ?? '–'}
                  {r.actorRole && <span className="block text-xs text-text-muted">{r.actorRole}</span>}
                </Td>
                <Td label="Action" className="font-mono text-xs">
                  {r.action}
                </Td>
                <Td label="Result">{r.result.toLowerCase()}</Td>
                <Td label="Hash" className="font-mono text-xs">
                  {short(r.hash)}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>
    </div>
  );
}
