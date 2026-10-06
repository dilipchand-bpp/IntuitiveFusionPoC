'use client';
import { useState } from 'react';
import { AiBadge, Badge, Button, Card, Checkbox, Field, Input, Select, Table, Td, Th } from '@if/ui';
import { send, useData, useRun } from '@/components/contract/b5-shared';

interface Provider {
  id: string;
  label: string;
  family: string;
  description: string;
}
interface CatalogueKind {
  kind: string;
  label: string;
  description: string;
  providers: Provider[];
}
interface Health {
  state: 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'CIRCUIT_OPEN' | 'RECOVERING' | 'DISABLED';
  breaker: { state: 'CLOSED' | 'OPEN' | 'HALF_OPEN'; consecutiveFailures: number; openedAt: string | null };
  lastOkAt: string | null;
  lastError: string | null;
}
interface Conn {
  kind: string;
  provider: string;
  providerLabel: string;
  enabled: boolean;
  mode: 'UP' | 'DOWN';
  health: Health;
  secret: { name: string; set: boolean; version: number | null; fingerprint: string | null };
  openManualTasks: number;
  queued: { pending: number; failed: number; deadLetter: number };
}
interface Overview {
  model: string;
  catalogue: CatalogueKind[];
  connectors: Conn[];
}
interface ManualTask {
  id: string;
  connector: string;
  title: string;
  instructions: string;
  summary: Record<string, unknown>;
  status: 'OPEN' | 'DONE' | 'SUPERSEDED';
  reference: string | null;
  createdAt: string;
  completedAt: string | null;
}
interface EventRow {
  id: string;
  kind: string;
  connector: string | null;
  direction: 'OUT' | 'IN';
  status: 'PENDING' | 'DELIVERED' | 'FAILED' | 'DEAD_LETTER';
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
}
interface RunRow {
  id: string;
  connector: string;
  status: 'RUNNING' | 'OK' | 'REPAIRED' | 'PARTIAL' | 'FAILED';
  startedAt: string;
  expected: number;
  received: number;
  missing: string[];
  repaired: number;
}
interface SecretMeta {
  name: string;
  version: number;
  fingerprint: string;
  lastRotatedAt: string;
}
interface Security {
  kind: string;
  algorithm: string;
  signedContent: string;
  headers: string[];
  replayWindowSeconds: number;
  replayProtection: string;
  inboundEndpoint: string;
  secret: { name: string; set: boolean; version: number | null; fingerprint: string | null };
  rejected: { count: number; lastAt: string | null; lastReason: string | null };
}

const HEALTH: Record<
  Health['state'],
  { tone: 'success' | 'warning' | 'error' | 'neutral' | 'info'; text: string }
> = {
  HEALTHY: { tone: 'success', text: 'Healthy' },
  DEGRADED: { tone: 'warning', text: 'Degraded' },
  DOWN: { tone: 'error', text: 'Down (simulated outage)' },
  CIRCUIT_OPEN: { tone: 'error', text: 'Circuit open' },
  RECOVERING: { tone: 'info', text: 'Recovering' },
  DISABLED: { tone: 'neutral', text: 'Switched off' },
};
const EVENT_TONE = {
  PENDING: 'neutral',
  DELIVERED: 'success',
  FAILED: 'warning',
  DEAD_LETTER: 'error',
} as const;
const RUN_TONE = {
  RUNNING: 'neutral',
  OK: 'success',
  REPAIRED: 'info',
  PARTIAL: 'warning',
  FAILED: 'error',
} as const;
const at = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-AU') : 'never');

export interface ConnectorRoles {
  /** Change connectors and secrets. */
  admin: boolean;
  /** Test and reconcile. */
  operate: boolean;
  /** Send records outward. */
  sync: boolean;
  /** Close manual tasks. */
  work: boolean;
  /** See deliveries. */
  events: boolean;
  /** See the middleware security evidence. */
  evidence: boolean;
}

/** Connector catalogue and health, secrets, deliveries, reconciliation, manual tasks and the middleware leg evidence. */
export function ConnectorsPage({ csrf, roles }: { csrf: string; roles: ConnectorRoles }) {
  const ov = useData<Overview>('/connectors');
  const tasks = useData<ManualTask[]>('/manual-tasks');
  const events = useData<EventRow[]>(roles.events ? '/integration-events' : null);
  const runs = useData<RunRow[]>('/connectors/sync-runs');
  const secrets = useData<{ secrets: SecretMeta[] }>(roles.admin ? '/secrets' : null);
  const { busy, run, messages } = useRun();
  const refresh = async () => {
    await Promise.all([ov.reload(), tasks.reload(), events.reload(), runs.reload(), secrets.reload()]);
  };

  if (ov.error && !ov.data)
    return (
      <p role="alert" className="text-sm font-medium text-error">
        {ov.error}
      </p>
    );
  if (!ov.data) return <p className="text-sm text-text-muted">Loading connectors…</p>;
  const data = ov.data;

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-heading text-xl font-bold">Everything here is simulated</h2>
          <AiBadge kind="simulated" />
          <Badge tone="info">{data.model}</Badge>
        </div>
        <p className="mt-2 max-w-prose text-sm text-text-muted" data-testid="connector-notice">
          Choosing SAP, Oracle, DocuSign or any other provider selects a deterministic stand-in with the same
          shape as the real integration. Nothing leaves this system. A connector marked down behaves exactly
          like a provider that does not answer, so the retries, the circuit breaker and the manual fallback
          can be shown.
        </p>
      </Card>

      {messages}

      <section aria-labelledby="cn-h" className="flex min-w-0 flex-col gap-3">
        <h2 id="cn-h" className="font-heading text-xl font-bold">
          Connected systems
        </h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {data.connectors.map((c) => (
            <ConnectorCard
              key={c.kind}
              c={c}
              kind={data.catalogue.find((k) => k.kind === c.kind)!}
              csrf={csrf}
              roles={roles}
              busy={busy}
              run={run}
              refresh={refresh}
            />
          ))}
        </div>
      </section>

      <section aria-labelledby="mt-h" className="flex min-w-0 flex-col gap-3">
        <h2 id="mt-h" className="font-heading text-xl font-bold">
          Work to do by hand
        </h2>
        <p className="max-w-prose text-sm text-text-muted">
          When a connected system is down, the work you started is not lost. It waits here with instructions.
          If the system recovers first, the platform sends it and the task is closed as superseded.
        </p>
        <ManualTasks
          tasks={tasks.data ?? []}
          csrf={csrf}
          canWork={roles.work}
          busy={busy}
          run={run}
          refresh={refresh}
        />
      </section>

      {roles.events && (
        <section aria-labelledby="ev-h" className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="ev-h" className="font-heading text-xl font-bold">
              Deliveries
            </h2>
            <Button
              variant="secondary"
              className="ml-auto"
              loading={busy === 'retry'}
              onClick={() =>
                void run(
                  'retry',
                  async () => {
                    await send(csrf, 'POST', '/integration-events/retry');
                    await refresh();
                  },
                  'Waiting deliveries were tried again.',
                )
              }
            >
              Retry waiting deliveries
            </Button>
          </div>
          <Events rows={events.data ?? []} csrf={csrf} busy={busy} run={run} refresh={refresh} />
        </section>
      )}

      <section aria-labelledby="sr-h" className="flex min-w-0 flex-col gap-3">
        <h2 id="sr-h" className="font-heading text-xl font-bold">
          Reconciliation runs
        </h2>
        <Table caption="Reconciliation runs">
          <thead>
            <tr>
              <Th>Connector</Th>
              <Th>Started</Th>
              <Th>Result</Th>
              <Th className="text-right">Expected</Th>
              <Th className="text-right">Received</Th>
              <Th className="text-right">Repaired</Th>
            </tr>
          </thead>
          <tbody>
            {(runs.data ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-3 text-text-muted">
                  No reconciliation has been run yet.
                </td>
              </tr>
            )}
            {(runs.data ?? []).map((r) => (
              <tr key={r.id} data-testid="sync-run-row">
                <Td label="Connector">{r.connector}</Td>
                <Td label="Started">{at(r.startedAt)}</Td>
                <Td label="Result">
                  <Badge tone={RUN_TONE[r.status]}>{r.status}</Badge>
                </Td>
                <Td label="Expected" className="text-right">
                  {r.expected}
                </Td>
                <Td label="Received" className="text-right">
                  {r.received}
                </Td>
                <Td label="Repaired" className="text-right">
                  {r.repaired}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>

      {roles.admin && (
        <SecretsSection
          secrets={secrets.data?.secrets ?? []}
          connectors={data.connectors}
          csrf={csrf}
          busy={busy}
          run={run}
          refresh={refresh}
        />
      )}

      {roles.evidence && <Evidence connectors={data.connectors} />}
    </div>
  );
}

type Run = ReturnType<typeof useRun>['run'];

function ConnectorCard({
  c,
  kind,
  csrf,
  roles,
  busy,
  run,
  refresh,
}: {
  c: Conn;
  kind: CatalogueKind;
  csrf: string;
  roles: ConnectorRoles;
  busy: string | null;
  run: Run;
  refresh: () => Promise<void>;
}) {
  const h = HEALTH[c.health.state];
  const [last, setLast] = useState<string | null>(null);
  const change = (body: Record<string, unknown>, ok: string) =>
    run(
      `put-${c.kind}`,
      async () => {
        await send(csrf, 'PUT', `/connectors/${c.kind}`, body);
        await refresh();
      },
      ok,
    );
  return (
    <Card data-testid="connector-card" data-kind={c.kind} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-heading text-lg font-bold">{kind.label}</h3>
        <Badge tone={h.tone}>{h.text}</Badge>
        {c.openManualTasks > 0 && <Badge tone="warning">{c.openManualTasks} to do by hand</Badge>}
      </div>
      <p className="text-sm text-text-muted">{kind.description}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="font-semibold">Provider</dt>
        <dd>
          {c.providerLabel} <span className="text-text-muted">(simulated)</span>
        </dd>
        <dt className="font-semibold">Circuit breaker</dt>
        <dd data-testid="breaker-state">
          {c.health.breaker.state}
          {c.health.breaker.consecutiveFailures > 0 &&
            ` (${c.health.breaker.consecutiveFailures} failures in a row)`}
        </dd>
        <dt className="font-semibold">Last success</dt>
        <dd>{at(c.health.lastOkAt)}</dd>
        {c.health.lastError && (
          <>
            <dt className="font-semibold">Last error</dt>
            <dd className="break-words">{c.health.lastError}</dd>
          </>
        )}
        <dt className="font-semibold">Waiting</dt>
        <dd>
          {c.queued.pending + c.queued.failed} to send, {c.queued.deadLetter} dead letters
        </dd>
        <dt className="font-semibold">Signing secret</dt>
        <dd>
          {c.secret.set ? `version ${c.secret.version}, fingerprint ${c.secret.fingerprint}` : 'not set'}
        </dd>
      </dl>
      {roles.admin && (
        <div className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
          <Field label={`Provider for ${kind.label}`}>
            <Select
              value={c.provider}
              onChange={(e) =>
                void change({ provider: e.target.value }, `${kind.label} now uses ${e.target.value}.`)
              }
            >
              {kind.providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Checkbox
            label="Switched on"
            checked={c.enabled}
            onChange={(e) =>
              void change(
                { enabled: e.target.checked },
                `${kind.label} ${e.target.checked ? 'switched on' : 'switched off'}.`,
              )
            }
          />
          <Button
            variant={c.mode === 'DOWN' ? 'danger' : 'secondary'}
            aria-pressed={c.mode === 'DOWN'}
            loading={busy === `put-${c.kind}`}
            onClick={() =>
              void change(
                { mode: c.mode === 'DOWN' ? 'UP' : 'DOWN' },
                c.mode === 'DOWN' ? `${kind.label} is back up.` : `${kind.label} is now simulated as down.`,
              )
            }
          >
            {c.mode === 'DOWN'
              ? `End the simulated outage of ${kind.label}`
              : `Simulate an outage of ${kind.label}`}
          </Button>
        </div>
      )}
      {(roles.operate || roles.sync) && (
        <div className="flex flex-wrap items-center gap-3">
          {roles.operate && (
            <Button
              variant="secondary"
              loading={busy === `test-${c.kind}`}
              onClick={() =>
                void run(`test-${c.kind}`, async () => {
                  const r = await send<{ ok: boolean; breaker: string; error: string | null }>(
                    csrf,
                    'POST',
                    `/connectors/${c.kind}/test`,
                  );
                  setLast(
                    r.ok
                      ? `Health check passed. Breaker ${r.breaker}.`
                      : `Health check failed: ${r.error}. Breaker ${r.breaker}.`,
                  );
                  await refresh();
                })
              }
            >
              Test {kind.label}
            </Button>
          )}
          {roles.sync && (
            <Button
              variant="secondary"
              loading={busy === `sync-${c.kind}`}
              onClick={() =>
                void run(
                  `sync-${c.kind}`,
                  async () => {
                    await send(csrf, 'POST', `/connectors/${c.kind}/sync`, {});
                    await refresh();
                  },
                  `Sample records sent through ${kind.label}. Sending the same records again changes nothing.`,
                )
              }
            >
              Send sample records
            </Button>
          )}
          {roles.operate && (
            <Button
              variant="secondary"
              loading={busy === `rec-${c.kind}`}
              onClick={() =>
                void run(`rec-${c.kind}`, async () => {
                  const r = await send<RunRow>(csrf, 'POST', `/connectors/${c.kind}/reconcile`);
                  setLast(
                    r.missing.length === 0
                      ? 'Reconciled: nothing was missing.'
                      : `Reconciled: ${r.missing.length} missing, ${r.repaired} sent again (${r.status}).`,
                  );
                  await refresh();
                })
              }
            >
              Reconcile {kind.label}
            </Button>
          )}
        </div>
      )}
      {last && (
        <p role="status" className="text-sm font-medium" data-testid="connector-result">
          {last}
        </p>
      )}
    </Card>
  );
}

function ManualTasks({
  tasks,
  csrf,
  canWork,
  busy,
  run,
  refresh,
}: {
  tasks: ManualTask[];
  csrf: string;
  canWork: boolean;
  busy: string | null;
  run: Run;
  refresh: () => Promise<void>;
}) {
  const [refs, setRefs] = useState<Record<string, string>>({});
  const open = tasks.filter((t) => t.status === 'OPEN');
  const closed = tasks.filter((t) => t.status !== 'OPEN').slice(0, 10);
  return (
    <div className="flex flex-col gap-3">
      {open.length === 0 && <p className="text-sm text-text-muted">Nothing is waiting to be done by hand.</p>}
      {open.map((t) => (
        <Card key={t.id} data-testid="manual-task" className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-heading text-lg font-bold">{t.title}</h3>
            <Badge tone="warning">{t.connector}</Badge>
          </div>
          <p className="max-w-prose text-sm">{t.instructions}</p>
          <p className="text-xs text-text-muted">
            {Object.entries(t.summary)
              .filter(([, v]) => v !== null && v !== '')
              .map(([k, v]) => `${k}: ${String(v)}`)
              .join(' · ')}
          </p>
          {canWork && (
            <form
              aria-label={`Complete: ${t.title}`}
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void run(
                  `done-${t.id}`,
                  async () => {
                    await send(csrf, 'POST', `/manual-tasks/${t.id}/complete`, { reference: refs[t.id] });
                    setRefs({ ...refs, [t.id]: '' });
                    await refresh();
                  },
                  'Marked done. The platform will not send this one again.',
                );
              }}
            >
              <Field label="Reference it shows">
                <Input
                  value={refs[t.id] ?? ''}
                  onChange={(e) => setRefs({ ...refs, [t.id]: e.target.value })}
                  maxLength={100}
                  className="w-56"
                />
              </Field>
              <Button type="submit" loading={busy === `done-${t.id}`} disabled={!(refs[t.id] ?? '').trim()}>
                Mark done
              </Button>
            </form>
          )}
        </Card>
      ))}
      {closed.length > 0 && (
        <Table caption="Closed manual tasks">
          <thead>
            <tr>
              <Th>Task</Th>
              <Th>Result</Th>
              <Th>Reference</Th>
            </tr>
          </thead>
          <tbody>
            {closed.map((t) => (
              <tr key={t.id}>
                <Td label="Task">{t.title}</Td>
                <Td label="Result">
                  <Badge tone={t.status === 'DONE' ? 'success' : 'neutral'}>
                    {t.status === 'DONE' ? 'Done by hand' : 'Superseded: sent by the platform'}
                  </Badge>
                </Td>
                <Td label="Reference">{t.reference ?? '–'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}

function Events({
  rows,
  csrf,
  busy,
  run,
  refresh,
}: {
  rows: EventRow[];
  csrf: string;
  busy: string | null;
  run: Run;
  refresh: () => Promise<void>;
}) {
  return (
    <Table caption="Deliveries to and from connected systems">
      <thead>
        <tr>
          <Th>What</Th>
          <Th>Way</Th>
          <Th>Status</Th>
          <Th className="text-right">Attempts</Th>
          <Th>Next attempt</Th>
          <Th>Last error</Th>
          <Th>
            <span className="sr-only">Action</span>
          </Th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td colSpan={7} className="px-4 py-3 text-text-muted">
              Nothing has been sent or received yet.
            </td>
          </tr>
        )}
        {rows.slice(0, 25).map((e) => (
          <tr key={e.id} data-testid="event-row" data-status={e.status}>
            <Td label="What">
              {e.kind} <span className="text-text-muted">({e.connector ?? '–'})</span>
            </Td>
            <Td label="Way">{e.direction === 'OUT' ? 'Sent' : 'Received'}</Td>
            <Td label="Status">
              <Badge tone={EVENT_TONE[e.status]}>
                {e.status === 'DEAD_LETTER' ? 'Dead letter' : e.status}
              </Badge>
            </Td>
            <Td label="Attempts" className="text-right">
              {e.attempts}
            </Td>
            <Td label="Next attempt">{e.status === 'FAILED' ? at(e.nextAttemptAt) : '–'}</Td>
            <Td label="Last error" className="max-w-xs break-words">
              {e.lastError ?? '–'}
            </Td>
            <Td label="Action">
              {e.status === 'DEAD_LETTER' && (
                <Button
                  variant="secondary"
                  loading={busy === `rq-${e.id}`}
                  onClick={() =>
                    void run(
                      `rq-${e.id}`,
                      async () => {
                        await send(csrf, 'POST', `/integration-events/${e.id}/requeue`);
                        await refresh();
                      },
                      'The delivery was put back in the queue and tried.',
                    )
                  }
                >
                  Requeue {e.kind}
                </Button>
              )}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function SecretsSection({
  secrets,
  connectors,
  csrf,
  busy,
  run,
  refresh,
}: {
  secrets: SecretMeta[];
  connectors: Conn[];
  csrf: string;
  busy: string | null;
  run: Run;
  refresh: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const names = [...new Set([...connectors.map((c) => c.secret.name), ...secrets.map((s) => s.name)])];
  return (
    <section aria-labelledby="sec-h" className="flex min-w-0 flex-col gap-3">
      <h2 id="sec-h" className="font-heading text-xl font-bold">
        Secrets
      </h2>
      <p className="max-w-prose text-sm text-text-muted">
        Integration credentials are kept encrypted in the platform&apos;s local secret store. A value cannot
        be read back after it is saved: only its name, version, fingerprint and when it was last changed are
        shown. Saving again rotates it and retires the old version.
      </p>
      <Table caption="Stored secrets">
        <thead>
          <tr>
            <Th>Name</Th>
            <Th className="text-right">Version</Th>
            <Th>Fingerprint</Th>
            <Th>Last rotated</Th>
          </tr>
        </thead>
        <tbody>
          {secrets.length === 0 && (
            <tr>
              <td colSpan={4} className="px-4 py-3 text-text-muted">
                No secret has been stored yet.
              </td>
            </tr>
          )}
          {secrets.map((s) => (
            <tr key={s.name} data-testid="secret-row">
              <Td label="Name">{s.name}</Td>
              <Td label="Version" className="text-right">
                {s.version}
              </Td>
              <Td label="Fingerprint">
                <code>{s.fingerprint}</code>
              </Td>
              <Td label="Last rotated">{at(s.lastRotatedAt)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <form
        aria-label="Set or rotate a secret"
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            'secret',
            async () => {
              await send(csrf, 'PUT', `/secrets/${encodeURIComponent(name)}`, { value });
              setValue('');
              await refresh();
            },
            'Secret saved. The value is not shown again.',
          );
        }}
      >
        <Field label="Secret name" hint="For example connector.middleware.webhook">
          <Select value={name} onChange={(e) => setName(e.target.value)}>
            <option value="">Choose…</option>
            {names.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="New value" hint="At least 8 characters">
          <Input
            type="password"
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-72"
          />
        </Field>
        <Button type="submit" loading={busy === 'secret'} disabled={!name || value.length < 8}>
          Save secret
        </Button>
      </form>
    </section>
  );
}

function Evidence({ connectors }: { connectors: Conn[] }) {
  const [kind, setKind] = useState('MIDDLEWARE');
  const sec = useData<Security>(`/connectors/${kind}/security`);
  return (
    <section aria-labelledby="ev2-h" className="flex min-w-0 flex-col gap-3">
      <h2 id="ev2-h" className="font-heading text-xl font-bold">
        Security of the integration leg
      </h2>
      <Field label="Connector">
        <Select value={kind} onChange={(e) => setKind(e.target.value)} className="w-64">
          {connectors.map((c) => (
            <option key={c.kind} value={c.kind}>
              {c.kind}
            </option>
          ))}
        </Select>
      </Field>
      {sec.error && (
        <p role="alert" className="text-sm font-medium text-error">
          {sec.error}
        </p>
      )}
      {sec.data && (
        <Card data-testid="security-evidence">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="font-semibold">Algorithm</dt>
            <dd>{sec.data.algorithm}</dd>
            <dt className="font-semibold">What is signed</dt>
            <dd>{sec.data.signedContent}</dd>
            <dt className="font-semibold">Headers</dt>
            <dd>{sec.data.headers.join(', ')}</dd>
            <dt className="font-semibold">Replay window</dt>
            <dd>{sec.data.replayWindowSeconds / 60} minutes</dd>
            <dt className="font-semibold">Replay protection</dt>
            <dd>{sec.data.replayProtection}</dd>
            <dt className="font-semibold">Inbound endpoint</dt>
            <dd>
              <code>{sec.data.inboundEndpoint}</code>
            </dd>
            <dt className="font-semibold">Signing secret</dt>
            <dd>
              {sec.data.secret.set
                ? `${sec.data.secret.name}, version ${sec.data.secret.version}, fingerprint ${sec.data.secret.fingerprint}`
                : 'not set: inbound messages are refused until one is'}
            </dd>
            <dt className="font-semibold">Rejected attempts</dt>
            <dd data-testid="rejected-count">
              {sec.data.rejected.count}
              {sec.data.rejected.lastAt &&
                ` (last ${at(sec.data.rejected.lastAt)}: ${sec.data.rejected.lastReason})`}
            </dd>
          </dl>
        </Card>
      )}
    </section>
  );
}
