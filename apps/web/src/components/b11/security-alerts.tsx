'use client';
import { useState } from 'react';
import { Badge, Button, Card, Field, Input, Select, type BadgeTone } from '@if/ui';
import { has, send, useData, useRun } from '@/components/contract/b5-shared';
import { formatDateTime } from '@/lib/labels';
import { SectionForm, type FieldSpec } from './section-form';

interface Alert {
  id: string;
  rule: string;
  ruleLabel: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  status: 'NEW' | 'ACKNOWLEDGED' | 'ESCALATED' | 'CLOSED';
  summary: string;
  subject: string | null;
  owner: string | null;
  createdAt: string;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  escalatedAt: string | null;
  closedBy: string | null;
  closeNote: string | null;
  sessionsEndedAt: string | null;
}
interface AlertList {
  model: string;
  open: number;
  items: Alert[];
}
interface Status {
  model: string;
  enabled: boolean;
  owner: { name: string | null; configured: boolean } | null;
  escalateAfterMinutes: number;
  lastRun: { at: string; findings: number; created: number; escalated: number } | null;
  accessLog24h: Record<string, number>;
  rules: Array<{ rule: string; label: string; on: boolean; threshold: string }>;
}

const SEV: Record<Alert['severity'], BadgeTone> = { LOW: 'neutral', MEDIUM: 'warning', HIGH: 'error' };
const STATE: Record<Alert['status'], { tone: BadgeTone; text: string }> = {
  NEW: { tone: 'warning', text: 'New: waiting to be acknowledged' },
  ACKNOWLEDGED: { tone: 'info', text: 'Acknowledged' },
  ESCALATED: { tone: 'error', text: 'Escalated to the executives' },
  CLOSED: { tone: 'success', text: 'Closed' },
};

const FIELDS: FieldSpec[] = [
  { key: 'enabled', label: 'Monitor switched on', kind: 'boolean' },
  {
    key: 'ownerUserId',
    label: 'Security owner (person id)',
    kind: 'text',
    nullable: true,
    hint: 'Empty: the first probity officer, else the first administrator.',
  },
  { key: 'viewBurstCount', label: 'Record views that raise an alert', kind: 'number' },
  { key: 'viewBurstMinutes', label: '…within minutes', kind: 'number' },
  { key: 'deniedBurstCount', label: 'Refused records that raise an alert', kind: 'number' },
  { key: 'deniedBurstMinutes', label: '…within minutes', kind: 'number' },
  { key: 'exportBurstCount', label: 'Exports that raise an alert', kind: 'number' },
  { key: 'exportBurstMinutes', label: '…within minutes', kind: 'number' },
  { key: 'failedLoginsBeforeSuccess', label: 'Failed sign-ins before a success', kind: 'number' },
  { key: 'mfaFailureCount', label: 'Wrong MFA codes that raise an alert', kind: 'number' },
  { key: 'mfaWindowMinutes', label: '…within minutes', kind: 'number' },
  { key: 'newDeviceCheck', label: 'Flag a new browser or network', kind: 'boolean' },
  { key: 'outOfHoursCheck', label: 'Flag sign-ins and privilege changes out of hours', kind: 'boolean' },
  { key: 'businessHoursStart', label: 'Business hours start (hour)', kind: 'number' },
  { key: 'businessHoursEnd', label: 'Business hours end (hour)', kind: 'number' },
  { key: 'timeZone', label: 'Time zone', kind: 'text', hint: 'For example Australia/Sydney' },
  { key: 'escalateAfterMinutes', label: 'Escalate to executives after minutes', kind: 'number' },
  { key: 'accessLogRetentionDays', label: 'Keep the access log (days)', kind: 'number' },
];

/** Alerts from the access monitor and configuration drift, routed to the security owner (SEC-L06). */
export function SecurityAlertsPanel({ csrf, roles }: { csrf: string; roles: readonly string[] }) {
  const [filter, setFilter] = useState<'OPEN' | 'CLOSED' | ''>('OPEN');
  const list = useData<AlertList>(`/security/alerts${filter ? `?status=${filter}` : ''}`);
  const status = useData<Status>('/security/monitor/status');
  const { busy, run, messages } = useRun();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const canEnd = has(roles, 'ADMIN', 'PROBITY');
  const after = async () => {
    await Promise.all([list.reload(), status.reload()]);
  };
  const note = (id: string) => (notes[id] ?? '').trim();

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Card role="region" aria-labelledby="mon-h">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="mon-h" className="font-heading text-xl font-bold">
            The monitor
          </h2>
          <Badge tone="info">Rules, simulated: {status.data?.model ?? 'rules-simulated-v1'}</Badge>
          {status.data && (
            <Badge tone={status.data.enabled ? 'success' : 'neutral'}>
              {status.data.enabled ? 'On' : 'Off'}
            </Badge>
          )}
        </div>
        <p className="mt-2 max-w-prose text-sm text-text-muted">
          Fixed rules look for unusual access: many record views, refused attempts on different records, bulk
          exports, a sign-in from a browser and network not seen before, repeated failed sign-ins followed by
          a success, wrong multi-factor codes, and out-of-hours sign-ins and privilege changes. Every alert
          states the rule, the numbers and the limit. Nothing is locked automatically. A production deployment
          would add a SIEM feed; the routing, acknowledgement and escalation here are real.
        </p>
        {status.data && (
          <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-border bg-surface-alt p-3">
              <dt className="text-xs text-text-muted">Security owner</dt>
              <dd className="mt-1 font-semibold" data-testid="monitor-owner">
                {status.data.owner?.name ?? 'None found'}
                {status.data.owner && !status.data.owner.configured ? ' (fallback)' : ''}
              </dd>
            </div>
            <div className="rounded-lg border border-border bg-surface-alt p-3">
              <dt className="text-xs text-text-muted">Escalates after</dt>
              <dd className="mt-1 font-semibold">{status.data.escalateAfterMinutes} minutes</dd>
            </div>
            <div className="rounded-lg border border-border bg-surface-alt p-3">
              <dt className="text-xs text-text-muted">Last run</dt>
              <dd className="mt-1 font-semibold">
                {status.data.lastRun
                  ? formatDateTime(status.data.lastRun.at)
                  : 'Not run since the server started'}
              </dd>
            </div>
            <div className="rounded-lg border border-border bg-surface-alt p-3">
              <dt className="text-xs text-text-muted">Access log, last 24 hours</dt>
              <dd className="mt-1 font-semibold">
                {Object.entries(status.data.accessLog24h)
                  .map(([k, v]) => `${v} ${k.toLowerCase()}`)
                  .join(', ') || 'empty'}
              </dd>
            </div>
          </dl>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            loading={busy === 'run'}
            disabled={busy !== null}
            onClick={() =>
              void run(
                'run',
                async () => {
                  await send(csrf, 'POST', '/security/monitor/run');
                  await after();
                },
                'The monitor ran.',
              )
            }
          >
            Run the monitor now
          </Button>
          <details className="text-sm">
            <summary className="cursor-pointer font-semibold">Rules and limits</summary>
            <ul className="mt-2 list-disc pl-6">
              {status.data?.rules.map((r) => (
                <li key={r.rule}>
                  {r.label}: {r.threshold}
                  {r.on ? '' : ' (off)'}
                </li>
              ))}
            </ul>
          </details>
        </div>
        {messages}
      </Card>

      <section aria-labelledby="alerts-h" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <h2 id="alerts-h" className="font-heading text-xl font-bold">
            Alerts
          </h2>
          <Field label="Show">
            <Select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
              <option value="OPEN">Open alerts</option>
              <option value="CLOSED">Closed alerts</option>
              <option value="">All alerts</option>
            </Select>
          </Field>
          {list.data && (
            <p className="text-sm text-text-muted" data-testid="alerts-open">
              {list.data.open} open
            </p>
          )}
        </div>
        {list.error && (
          <p role="alert" className="text-sm font-medium text-error">
            {list.error}
          </p>
        )}
        {list.data && list.data.items.length === 0 && (
          <p className="rounded-lg border border-border bg-surface p-4 text-sm text-text-muted">
            No alerts to show.
          </p>
        )}
        <ul className="flex flex-col gap-3" aria-label="Security alerts">
          {list.data?.items.map((a) => (
            <li key={a.id} data-testid="alert-card" data-rule={a.rule} data-status={a.status}>
              <Card>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-heading text-lg font-bold">{a.ruleLabel}</h3>
                  <Badge tone={SEV[a.severity]}>{a.severity.toLowerCase()}</Badge>
                  <Badge tone={STATE[a.status].tone}>{STATE[a.status].text}</Badge>
                </div>
                <p className="mt-2 text-sm">{a.summary}</p>
                <p className="mt-1 text-xs text-text-muted">
                  Raised {formatDateTime(a.createdAt)}. Routed to {a.owner ?? 'nobody'}.
                  {a.subject ? ` About ${a.subject}.` : ''}
                  {a.acknowledgedBy ? ` Acknowledged by ${a.acknowledgedBy}.` : ''}
                  {a.escalatedAt ? ` Escalated ${formatDateTime(a.escalatedAt)}.` : ''}
                  {a.sessionsEndedAt ? ` Sessions ended ${formatDateTime(a.sessionsEndedAt)}.` : ''}
                  {a.closeNote ? ` Closed by ${a.closedBy}: “${a.closeNote}”` : ''}
                </p>
                {a.status !== 'CLOSED' && (
                  <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-end">
                    <div className="md:w-96">
                      <Field label="Note" hint="Needed (five characters) to close.">
                        <Input
                          value={notes[a.id] ?? ''}
                          maxLength={500}
                          onChange={(e) => setNotes((x) => ({ ...x, [a.id]: e.target.value }))}
                        />
                      </Field>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {a.status !== 'ACKNOWLEDGED' && (
                        <Button
                          variant="secondary"
                          loading={busy === `ack-${a.id}`}
                          disabled={busy !== null}
                          onClick={() =>
                            void run(
                              `ack-${a.id}`,
                              async () => {
                                await send(
                                  csrf,
                                  'POST',
                                  `/security/alerts/${a.id}/acknowledge`,
                                  note(a.id) ? { note: note(a.id) } : {},
                                );
                                await after();
                              },
                              'Acknowledged.',
                            )
                          }
                        >
                          Acknowledge
                        </Button>
                      )}
                      <Button
                        variant="secondary"
                        loading={busy === `close-${a.id}`}
                        disabled={note(a.id).length < 5 || busy !== null}
                        onClick={() =>
                          void run(
                            `close-${a.id}`,
                            async () => {
                              await send(csrf, 'POST', `/security/alerts/${a.id}/close`, {
                                note: note(a.id),
                              });
                              await after();
                            },
                            'Closed.',
                          )
                        }
                      >
                        Close with note
                      </Button>
                      {canEnd && a.subject && (
                        <Button
                          variant="danger"
                          loading={busy === `end-${a.id}`}
                          disabled={busy !== null}
                          onClick={() =>
                            void run(
                              `end-${a.id}`,
                              async () => {
                                await send(
                                  csrf,
                                  'POST',
                                  `/security/alerts/${a.id}/end-sessions`,
                                  note(a.id) ? { note: note(a.id) } : {},
                                );
                                await after();
                              },
                              `${a.subject}'s sessions were ended; they must sign in again. Their account is not locked.`,
                            )
                          }
                        >
                          End their sessions
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <SectionForm
        section="securityMonitor"
        title="Monitor settings"
        intro="The limits, the security owner, business hours and when an unacknowledged alert goes to the executives. Defaults are generous so ordinary use is not flagged. Changes are audited."
        fields={FIELDS}
        csrf={csrf}
        canEdit={has(roles, 'ADMIN')}
      />
    </div>
  );
}
