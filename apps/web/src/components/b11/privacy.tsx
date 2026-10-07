'use client';
import { useState } from 'react';
import { Badge, Button, Card, Field, Input, Select, Table, Td, Textarea, Th } from '@if/ui';
import { has, send, useData, useRun } from '@/components/contract/b5-shared';

type Context = 'SUPPLIER_REGISTRATION' | 'USER_ACTIVATION' | 'REQUEST_INTAKE' | 'PRIVACY_PAGE';
interface Notice {
  context: Context;
  version: string;
  text: string;
  collectedFor: string;
}
interface NoticeStatus {
  version: string;
  acknowledged: Record<Context, string | null>;
}

/**
 * The collection notice, shown where personal information is collected (SEC-D08). With a CSRF token (signed in) it also
 * records that the person acknowledged this version in this place; without one (registration, activation) it only shows it.
 */
export function PrivacyNotice({ context, csrf }: { context: Context; csrf?: string }) {
  const { data } = useData<Notice>(`/privacy/notice?context=${context}`);
  const status = useData<NoticeStatus>(csrf ? '/privacy/notice/status' : null);
  const { busy, run, messages } = useRun();
  if (!data) return null;
  const acked = status.data?.acknowledged[context] ?? null;
  return (
    <section
      aria-label="Privacy collection notice"
      className="rounded-lg border border-border bg-surface-alt p-4 text-sm"
      data-testid={`privacy-notice-${context}`}
    >
      <h2 className="font-heading text-base font-bold">How we handle your personal information</h2>
      <p className="mt-1 max-w-prose">{data.text}</p>
      <p className="mt-1 text-xs text-text-muted">
        {data.collectedFor} Notice version {data.version}.
      </p>
      {csrf && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {acked ? (
            <Badge tone="success">Acknowledged for version {data.version}</Badge>
          ) : (
            <Button
              variant="secondary"
              loading={busy === 'ack'}
              disabled={busy !== null}
              onClick={() =>
                void run('ack', async () => {
                  await send(csrf, 'POST', '/privacy/notice/ack', { context });
                  await status.reload();
                })
              }
            >
              I have read this notice
            </Button>
          )}
          {messages}
        </div>
      )}
    </section>
  );
}

interface Req {
  id: string;
  number: string;
  kind: 'ACCESS' | 'CORRECTION';
  status: 'RECEIVED' | 'IN_PROGRESS' | 'COMPLETED' | 'REFUSED';
  requesterName: string;
  requesterEmail: string;
  channel: 'SELF' | 'STAFF_LOGGED';
  details: string;
  correctionField: string | null;
  correctionValue: string | null;
  correctionApplied: boolean;
  dueDate: string;
  overdue: boolean;
  escalatedAt: string | null;
  assignedTo: { id: string; name: string | null } | null;
  identityVerified: boolean;
  verificationMethod: string | null;
  verifiedBy: string | null;
  responseSummary: string | null;
  refusalReason: string | null;
  exportGeneratedAt: string | null;
  createdAt: string;
}
const TONE = { RECEIVED: 'info', IN_PROGRESS: 'warning', COMPLETED: 'success', REFUSED: 'error' } as const;
const dateOnly = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-AU', { dateStyle: 'medium', timeZone: 'UTC' });
const StatusBadge = ({ r }: { r: Req }) => (
  <span className="inline-flex flex-wrap items-center gap-1">
    <Badge tone={TONE[r.status]}>{r.status.replace('_', ' ').toLowerCase()}</Badge>
    {r.overdue && <Badge tone="error">Overdue</Badge>}
  </span>
);

/** A person lodges and tracks their own access or correction request (staff in /app/privacy, supplier contacts in the portal). */
export function PrivacyPanel({ csrf, context }: { csrf: string; context: Context }) {
  const mine = useData<{ items: Req[] }>('/privacy/requests/mine');
  const { busy, run, messages } = useRun();
  const [kind, setKind] = useState<'ACCESS' | 'CORRECTION'>('ACCESS');
  const [details, setDetails] = useState('');
  const [field, setField] = useState<'name' | 'email'>('name');
  const [value, setValue] = useState('');
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PrivacyNotice context={context} csrf={csrf} />
      <Card>
        <h2 className="font-heading text-xl font-bold">Ask about your personal information</h2>
        <p className="mt-1 max-w-prose text-sm text-text-muted">
          You can ask to see the personal information held about you, or to correct it. Because you are signed
          in, your identity is already verified. We respond within the number of days set by the organisation.
        </p>
        <form
          className="mt-4 flex max-w-xl flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              'lodge',
              async () => {
                await send(csrf, 'POST', '/privacy/requests', {
                  kind,
                  details,
                  ...(kind === 'CORRECTION' ? { correctionField: field, correctionValue: value } : {}),
                });
                setDetails('');
                setValue('');
                await mine.reload();
              },
              'Your request was received.',
            );
          }}
        >
          <Field label="What do you want to do?">
            <Select value={kind} onChange={(e) => setKind(e.target.value as 'ACCESS' | 'CORRECTION')}>
              <option value="ACCESS">See my personal information (access)</option>
              <option value="CORRECTION">Correct my personal information</option>
            </Select>
          </Field>
          {kind === 'CORRECTION' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Which detail is wrong?">
                <Select value={field} onChange={(e) => setField(e.target.value as 'name' | 'email')}>
                  <option value="name">My name</option>
                  <option value="email">My email address</option>
                </Select>
              </Field>
              <Field label="What it should be" required>
                <Input value={value} onChange={(e) => setValue(e.target.value)} />
              </Field>
            </div>
          )}
          <Field label="Details" hint="Tell us what you are after (5 characters or more)." required>
            <Textarea rows={3} value={details} onChange={(e) => setDetails(e.target.value)} />
          </Field>
          <Button
            type="submit"
            loading={busy === 'lodge'}
            disabled={details.trim().length < 5 || (kind === 'CORRECTION' && !value.trim()) || busy !== null}
          >
            Lodge request
          </Button>
          {messages}
        </form>
      </Card>
      <Card>
        <h2 className="font-heading text-xl font-bold">Your requests</h2>
        {mine.error && (
          <p role="alert" className="mt-2 text-sm font-medium text-error">
            {mine.error}
          </p>
        )}
        {(mine.data?.items ?? []).length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">You have not made a request.</p>
        ) : (
          <div className="mt-3">
            <Table caption="Your privacy requests">
              <thead>
                <tr>
                  <Th>Number</Th>
                  <Th>Kind</Th>
                  <Th>Status</Th>
                  <Th>Due</Th>
                  <Th>Outcome</Th>
                </tr>
              </thead>
              <tbody>
                {mine.data!.items.map((r) => (
                  <tr key={r.id}>
                    <Td label="Number">{r.number}</Td>
                    <Td label="Kind">{r.kind === 'ACCESS' ? 'Access' : 'Correction'}</Td>
                    <Td label="Status">
                      <StatusBadge r={r} />
                    </Td>
                    <Td label="Due">{dateOnly(r.dueDate)}</Td>
                    <Td label="Outcome">
                      {r.status === 'COMPLETED' && r.kind === 'ACCESS' ? (
                        <a href={`/api/v1/privacy/requests/${r.id}/export`} download>
                          Download my information (JSON)
                        </a>
                      ) : r.status === 'COMPLETED' ? (
                        (r.responseSummary ?? 'Completed')
                      ) : r.status === 'REFUSED' ? (
                        `Refused: ${r.refusalReason ?? ''}`
                      ) : (
                        'In progress'
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- management
interface List {
  responseDays: number;
  officerRole: string;
  summary: { open: number; overdue: number; completed: number; refused: number };
  items: Req[];
}
interface Hold {
  id: string;
  entityType: string;
  entityId: string;
  reason: string;
  placedBy: string | null;
  placedAt: string;
  open: boolean;
  releaseReason: string | null;
}
interface RunRow {
  id: string;
  at: string;
  by: string | null;
  trigger: string;
  retentionDays: number;
  expired: number;
  anonymised: number;
  messagesCleared: number;
  skippedHeld: number;
  held: Array<{ conversationId: string; reason: string; via: string }>;
}
interface Retention {
  aiConversationDays: number;
  minimumDays: number;
  aiRegion: string;
  aiRegionAllowed: boolean;
  conversations: { total: number; stamped: number; anonymised: number };
  scope: string;
  holds: Hold[];
  runs: RunRow[];
}
interface PSettings {
  noticeVersion: string;
  noticeText: string;
  officerRole: 'ADMIN' | 'LEGAL' | 'PROBITY';
  responseDays: number;
}
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });

function Detail({ r, csrf, done }: { r: Req; csrf: string; done: () => Promise<void> }) {
  const { busy, run, messages } = useRun();
  const [method, setMethod] = useState('');
  const [summary, setSummary] = useState('');
  const [refusal, setRefusal] = useState('');
  const closed = r.status === 'COMPLETED' || r.status === 'REFUSED';
  const act = (name: string, path: string, body?: unknown, ok?: string) =>
    run(
      name,
      async () => {
        await send(csrf, 'POST', `/privacy/requests/${r.id}/${path}`, body);
        await done();
      },
      ok,
    );
  return (
    <Card data-testid="privacy-detail">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-heading text-lg font-bold">
          {r.number}: {r.kind === 'ACCESS' ? 'Access' : 'Correction'} request from {r.requesterName}
        </h3>
        <StatusBadge r={r} />
        {r.escalatedAt && <Badge tone="error">Escalated to the privacy officer</Badge>}
      </div>
      <p className="mt-2 text-sm">{r.details}</p>
      {r.kind === 'CORRECTION' && (
        <p className="mt-1 text-sm">
          Correct <strong>{r.correctionField}</strong> to <strong>{r.correctionValue}</strong>
          {r.correctionApplied ? ' (applied)' : ''}.
        </p>
      )}
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-text-muted">Requester</dt>
          <dd>
            {r.requesterName} ({r.requesterEmail}),{' '}
            {r.channel === 'SELF' ? 'lodged by themselves' : 'logged by staff'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Due</dt>
          <dd>{dateOnly(r.dueDate)}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Identity</dt>
          <dd>{r.identityVerified ? `Verified: ${r.verificationMethod}` : 'Not verified yet'}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Owner</dt>
          <dd>{r.assignedTo?.name ?? 'Nobody yet'}</dd>
        </div>
      </dl>
      {closed ? (
        <p className="mt-3 text-sm">
          {r.status === 'COMPLETED' ? `Response: ${r.responseSummary}` : `Refused: ${r.refusalReason}`}
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              loading={busy === 'assign'}
              disabled={busy !== null}
              onClick={() => void act('assign', 'assign', {})}
            >
              Take this request
            </Button>
            {r.kind === 'ACCESS' && r.identityVerified && (
              <a
                className="inline-flex min-h-[44px] items-center rounded-md border border-border-strong px-4 text-sm font-semibold"
                href={`/api/v1/privacy/requests/${r.id}/export`}
                download
                onClick={() => window.setTimeout(() => void done(), 1500)}
              >
                Build and download the data export
              </a>
            )}
            {r.kind === 'CORRECTION' && r.identityVerified && !r.correctionApplied && (
              <Button
                variant="secondary"
                loading={busy === 'apply'}
                disabled={busy !== null}
                onClick={() =>
                  void act(
                    'apply',
                    'apply-correction',
                    undefined,
                    'Correction applied and audited with before and after.',
                  )
                }
              >
                Apply the correction
              </Button>
            )}
          </div>
          {!r.identityVerified && (
            <div className="flex max-w-xl flex-wrap items-end gap-2">
              <div className="min-w-[16rem] flex-1">
                <Field
                  label="How was identity verified?"
                  hint="For example: called back on the number on file."
                >
                  <Input value={method} onChange={(e) => setMethod(e.target.value)} />
                </Field>
              </div>
              <Button
                loading={busy === 'verify'}
                disabled={method.trim().length < 5 || busy !== null}
                onClick={() => void act('verify', 'verify', { method }, 'Identity recorded.')}
              >
                Record verification
              </Button>
            </div>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Field label="Response summary" hint="Sent to the requester when you complete.">
                <Textarea rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} />
              </Field>
              <Button
                loading={busy === 'complete'}
                disabled={summary.trim().length < 5 || busy !== null}
                onClick={() => void act('complete', 'complete', { summary }, 'Request completed.')}
              >
                Complete
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              <Field label="Reason for refusing" hint="At least 10 characters.">
                <Textarea rows={2} value={refusal} onChange={(e) => setRefusal(e.target.value)} />
              </Field>
              <Button
                variant="danger"
                loading={busy === 'refuse'}
                disabled={refusal.trim().length < 10 || busy !== null}
                onClick={() =>
                  void act(
                    'refuse',
                    'refuse',
                    { reason: refusal },
                    'Request refused with the reason recorded.',
                  )
                }
              >
                Refuse
              </Button>
            </div>
          </div>
        </div>
      )}
      {messages}
    </Card>
  );
}

/** The privacy officer's workspace: the request queue, calls logged for someone, retention and legal holds, the notice (SEC-D08, SEC-D06). */
export function PrivacyManagePanel({ csrf, roles }: { csrf: string; roles: readonly string[] }) {
  const admin = has(roles, 'ADMIN');
  const list = useData<List>('/privacy/requests');
  const ret = useData<Retention>('/privacy/retention');
  const settings = useData<PSettings>('/privacy/settings');
  const [open, setOpen] = useState<string | null>(null);
  const [esc, setEsc] = useState<string | null>(null);
  const log = useRun();
  const over = useRun();
  const retRun = useRun();
  const hold = useRun();
  const cfg = useRun();
  const [lg, setLg] = useState({
    name: '',
    email: '',
    kind: 'ACCESS',
    details: '',
    method: '',
    field: 'name',
    value: '',
  });
  const [hd, setHd] = useState({ type: 'REQUEST', id: '', reason: '' });
  const [days, setDays] = useState<string | null>(null);
  const [ps, setPs] = useState<PSettings | null>(null);
  const reload = async () => {
    await list.reload();
    await ret.reload();
  };
  const chosen = list.data?.items.find((i) => i.id === open) ?? null;
  const set = ps ?? settings.data;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-heading text-xl font-bold">Requests</h2>
          <Button
            variant="secondary"
            loading={over.busy === 'over'}
            disabled={over.busy !== null}
            onClick={() =>
              void over.run('over', async () => {
                const r = await send<{ escalated: number }>(csrf, 'POST', '/privacy/requests/run-overdue');
                setEsc(
                  `${r.escalated} overdue request${r.escalated === 1 ? '' : 's'} escalated to the privacy officer.`,
                );
                await reload();
              })
            }
          >
            Escalate overdue requests
          </Button>
        </div>
        {over.messages}
        {esc && (
          <p role="status" className="mt-2 text-sm font-medium text-success">
            {esc}
          </p>
        )}
        {list.data && (
          <dl className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ['Open', list.data.summary.open],
              ['Overdue', list.data.summary.overdue],
              ['Completed', list.data.summary.completed],
              ['Refused', list.data.summary.refused],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-border bg-surface-alt p-3">
                <dt className="text-xs text-text-muted">{k}</dt>
                <dd className="mt-1 text-xl font-bold">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        {list.error && (
          <p role="alert" className="mt-2 text-sm font-medium text-error">
            {list.error}
          </p>
        )}
        {list.data && list.data.items.length === 0 && (
          <p className="mt-3 text-sm text-text-muted">No requests yet.</p>
        )}
        {list.data && list.data.items.length > 0 && (
          <div className="mt-3">
            <Table caption="Privacy requests, soonest due first">
              <thead>
                <tr>
                  <Th>Number</Th>
                  <Th>Requester</Th>
                  <Th>Kind</Th>
                  <Th>Status</Th>
                  <Th>Due</Th>
                  <Th>Action</Th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((r) => (
                  <tr key={r.id}>
                    <Td label="Number">{r.number}</Td>
                    <Td label="Requester">{r.requesterName}</Td>
                    <Td label="Kind">{r.kind === 'ACCESS' ? 'Access' : 'Correction'}</Td>
                    <Td label="Status">
                      <StatusBadge r={r} />
                    </Td>
                    <Td label="Due">{dateOnly(r.dueDate)}</Td>
                    <Td label="Action">
                      <Button
                        variant="secondary"
                        aria-label={`Open ${r.number}`}
                        onClick={() => setOpen(r.id)}
                      >
                        Open
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
      {chosen && <Detail key={chosen.id} r={chosen} csrf={csrf} done={reload} />}

      <Card>
        <h2 className="font-heading text-xl font-bold">Log a request from a caller</h2>
        <form
          className="mt-3 grid max-w-3xl gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void log.run(
              'log',
              async () => {
                await send(csrf, 'POST', '/privacy/requests/log', {
                  requesterName: lg.name,
                  requesterEmail: lg.email,
                  kind: lg.kind,
                  details: lg.details,
                  ...(lg.method.trim() ? { verificationMethod: lg.method } : {}),
                  ...(lg.kind === 'CORRECTION'
                    ? { correctionField: lg.field, correctionValue: lg.value }
                    : {}),
                });
                setLg({
                  name: '',
                  email: '',
                  kind: 'ACCESS',
                  details: '',
                  method: '',
                  field: 'name',
                  value: '',
                });
                await reload();
              },
              'Request logged.',
            );
          }}
        >
          <Field label="Caller's name" required>
            <Input value={lg.name} onChange={(e) => setLg({ ...lg, name: e.target.value })} />
          </Field>
          <Field label="Caller's email" required>
            <Input type="email" value={lg.email} onChange={(e) => setLg({ ...lg, email: e.target.value })} />
          </Field>
          <Field label="Kind">
            <Select value={lg.kind} onChange={(e) => setLg({ ...lg, kind: e.target.value })}>
              <option value="ACCESS">Access</option>
              <option value="CORRECTION">Correction</option>
            </Select>
          </Field>
          <Field label="How identity was verified" hint="Leave empty to verify later.">
            <Input value={lg.method} onChange={(e) => setLg({ ...lg, method: e.target.value })} />
          </Field>
          {lg.kind === 'CORRECTION' && (
            <>
              <Field label="Field to correct">
                <Select value={lg.field} onChange={(e) => setLg({ ...lg, field: e.target.value })}>
                  <option value="name">Name</option>
                  <option value="email">Email address</option>
                </Select>
              </Field>
              <Field label="Corrected value" required>
                <Input value={lg.value} onChange={(e) => setLg({ ...lg, value: e.target.value })} />
              </Field>
            </>
          )}
          <div className="sm:col-span-2">
            <Field label="What the caller asked" required>
              <Textarea
                rows={2}
                value={lg.details}
                onChange={(e) => setLg({ ...lg, details: e.target.value })}
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Button
              type="submit"
              loading={log.busy === 'log'}
              disabled={
                !lg.name.trim() || !lg.email.trim() || lg.details.trim().length < 5 || log.busy !== null
              }
            >
              Log request
            </Button>
            {log.messages}
          </div>
        </form>
      </Card>

      <Card>
        <h2 className="font-heading text-xl font-bold">AI conversation retention and legal holds</h2>
        {ret.data && (
          <>
            <p className="mt-2 max-w-prose text-sm text-text-muted">{ret.data.scope}</p>
            <p className="mt-2 text-sm" data-testid="retention-days">
              Transcripts are kept for <strong>{ret.data.aiConversationDays} days</strong> (at least{' '}
              {ret.data.minimumDays}), held in region <strong>{ret.data.aiRegion}</strong>
              {ret.data.aiRegionAllowed
                ? ''
                : ' (not an allowed region: new conversations are refused)'}. {ret.data.conversations.stamped}{' '}
              of {ret.data.conversations.total} conversations are stamped; {ret.data.conversations.anonymised}{' '}
              anonymised. Audit events are never purged.
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              {admin && (
                <>
                  <div className="w-44">
                    <Field label="Days to keep" hint={`${ret.data.minimumDays} to 3650`}>
                      <Input
                        type="number"
                        min={ret.data.minimumDays}
                        value={days ?? String(ret.data.aiConversationDays)}
                        onChange={(e) => setDays(e.target.value)}
                      />
                    </Field>
                  </div>
                  <Button
                    variant="secondary"
                    loading={retRun.busy === 'days'}
                    disabled={
                      days === null || !(Number(days) >= ret.data.minimumDays) || retRun.busy !== null
                    }
                    onClick={() =>
                      void retRun.run(
                        'days',
                        async () => {
                          await send(csrf, 'PUT', '/privacy/retention', {
                            aiConversationDays: Number(days),
                            reason: 'Changed on the privacy page',
                          });
                          setDays(null);
                          await ret.reload();
                        },
                        'Retention saved.',
                      )
                    }
                  >
                    Save days
                  </Button>
                  <Button
                    loading={retRun.busy === 'run'}
                    disabled={retRun.busy !== null}
                    onClick={() =>
                      void retRun.run(
                        'run',
                        async () => {
                          await send(csrf, 'POST', '/privacy/retention/run');
                          await ret.reload();
                        },
                        'Retention run complete.',
                      )
                    }
                  >
                    Run the purge now
                  </Button>
                </>
              )}
            </div>
            {retRun.messages}
            <h3 className="mt-5 text-sm font-bold uppercase tracking-wide text-text-muted">Recent runs</h3>
            {ret.data.runs.length === 0 ? (
              <p className="mt-1 text-sm text-text-muted">No runs yet.</p>
            ) : (
              <div className="mt-2">
                <Table caption="Retention runs">
                  <thead>
                    <tr>
                      <Th>When</Th>
                      <Th>By</Th>
                      <Th className="text-right">Expired</Th>
                      <Th className="text-right">Anonymised</Th>
                      <Th className="text-right">Skipped (legal hold)</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {ret.data.runs.slice(0, 8).map((r) => (
                      <tr key={r.id}>
                        <Td label="When">{when(r.at)}</Td>
                        <Td label="By">{r.by}</Td>
                        <Td label="Expired" className="text-right">
                          {r.expired}
                        </Td>
                        <Td label="Anonymised" className="text-right">
                          {r.anonymised}
                        </Td>
                        <Td label="Skipped (legal hold)" className="text-right">
                          {r.skippedHeld}
                          {r.held[0] && (
                            <span className="block text-xs text-text-muted">{r.held[0].reason}</span>
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
            <h3 className="mt-5 text-sm font-bold uppercase tracking-wide text-text-muted">Legal holds</h3>
            {ret.data.holds.length === 0 ? (
              <p className="mt-1 text-sm text-text-muted">No legal holds.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2 text-sm">
                {ret.data.holds.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-center gap-2">
                    <Badge tone={h.open ? 'warning' : 'neutral'}>{h.open ? 'On hold' : 'Released'}</Badge>
                    <span>
                      {h.entityType.toLowerCase()} <code>{h.entityId.slice(0, 8)}</code>: {h.reason}
                    </span>
                    {h.open && (
                      <Button
                        variant="secondary"
                        aria-label={`Release hold on ${h.entityType.toLowerCase()} ${h.entityId.slice(0, 8)}`}
                        onClick={() =>
                          void hold.run('rel', async () => {
                            await send(csrf, 'POST', `/privacy/legal-holds/${h.id}/release`, {
                              reason: 'Released from the privacy page',
                            });
                            await ret.reload();
                          })
                        }
                      >
                        Release
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <form
              className="mt-4 grid max-w-3xl gap-3 sm:grid-cols-4"
              onSubmit={(e) => {
                e.preventDefault();
                void hold.run(
                  'hold',
                  async () => {
                    await send(csrf, 'POST', '/privacy/legal-holds', {
                      entityType: hd.type,
                      entityId: hd.id,
                      reason: hd.reason,
                    });
                    setHd({ type: 'REQUEST', id: '', reason: '' });
                    await ret.reload();
                  },
                  'Legal hold placed.',
                );
              }}
            >
              <Field label="Hold on">
                <Select value={hd.type} onChange={(e) => setHd({ ...hd, type: e.target.value })}>
                  <option value="REQUEST">A request</option>
                  <option value="CONVERSATION">A conversation</option>
                </Select>
              </Field>
              <Field label="Record id" required>
                <Input value={hd.id} onChange={(e) => setHd({ ...hd, id: e.target.value })} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Reason" required>
                  <Input value={hd.reason} onChange={(e) => setHd({ ...hd, reason: e.target.value })} />
                </Field>
              </div>
              <div className="sm:col-span-4">
                <Button
                  type="submit"
                  variant="secondary"
                  loading={hold.busy === 'hold'}
                  disabled={
                    !/^[0-9a-f-]{36}$/i.test(hd.id) || hd.reason.trim().length < 10 || hold.busy !== null
                  }
                >
                  Place legal hold
                </Button>
                {hold.messages}
              </div>
            </form>
          </>
        )}
      </Card>

      {admin && set && (
        <Card>
          <h2 className="font-heading text-xl font-bold">Collection notice and request handling</h2>
          <form
            className="mt-3 flex max-w-2xl flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void cfg.run(
                'cfg',
                async () => {
                  await send(csrf, 'PUT', '/privacy/settings', set);
                  setPs(null);
                  await settings.reload();
                },
                'Saved and audited. A new notice version needs a fresh acknowledgement.',
              );
            }}
          >
            <Field
              label="Notice version"
              hint="Change it whenever the text changes so people acknowledge the new one."
            >
              <Input
                value={set.noticeVersion}
                onChange={(e) => setPs({ ...set, noticeVersion: e.target.value })}
              />
            </Field>
            <Field label="Notice text">
              <Textarea
                rows={5}
                value={set.noticeText}
                onChange={(e) => setPs({ ...set, noticeText: e.target.value })}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Privacy officer role" hint="Receives overdue escalations.">
                <Select
                  value={set.officerRole}
                  onChange={(e) => setPs({ ...set, officerRole: e.target.value as PSettings['officerRole'] })}
                >
                  <option value="ADMIN">Administrator</option>
                  <option value="LEGAL">Legal</option>
                  <option value="PROBITY">Probity</option>
                </Select>
              </Field>
              <Field label="Days to respond" hint="1 to 90. Default 30.">
                <Input
                  type="number"
                  min={1}
                  max={90}
                  value={String(set.responseDays)}
                  onChange={(e) => setPs({ ...set, responseDays: Number(e.target.value) })}
                />
              </Field>
            </div>
            <Button type="submit" loading={cfg.busy === 'cfg'} disabled={!ps || cfg.busy !== null}>
              Save notice settings
            </Button>
            {cfg.messages}
          </form>
        </Card>
      )}
    </div>
  );
}
