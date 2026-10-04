'use client';
import { useCallback, useState } from 'react';
import { Badge, Button, Card, Field, Input, Select } from '@if/ui';
import { ApiError, api } from '@/lib/api-client';
import { formatDateTime } from '@/lib/labels';

export interface Project {
  id: string;
  tenderId: string;
  project: string | null;
  label: 'COMMITTEE' | 'AUDITOR' | 'ADVISOR';
  live: boolean;
  endsAt: string | null;
  expiresOn: string | null;
  event: 'CONTRACT_SIGNED' | 'REPORT_APPROVED' | null;
  eventDays: number;
  revokedReason: string | null;
  documents: Array<{ kind: string; name: string; url: string }>;
}
interface Grant {
  id: string;
  user: string | null;
  tenderId: string;
  label: string;
  expiresOn: string | null;
  event: string | null;
  eventDays: number;
  live: boolean;
  endsAt: string | null;
  revokedReason: string | null;
}
interface Candidates {
  users: Array<{ id: string; name: string; email: string }>;
  tenders: Array<{ id: string; number: string; title: string }>;
}
const LABEL = { COMMITTEE: 'Committee member', AUDITOR: 'Auditor', ADVISOR: 'Advisor' } as const;
const message = (e: unknown) =>
  e instanceof ApiError
    ? [e.message, ...(e.problem.errors ?? []).map((x) => x.message)].join(' ')
    : 'Something went wrong.';

/** The projects a person has been given time-bound access to, and (for procurement) who has been given what (FR-0435). */
export function SharedProjects({
  initial,
  grants: initialGrants,
  candidates,
  csrf,
}: {
  initial: Project[];
  grants: Grant[] | null;
  candidates: Candidates | null;
  csrf: string;
}) {
  const [grants, setGrants] = useState(initialGrants);
  const [f, setF] = useState({
    userId: '',
    tenderId: '',
    label: 'AUDITOR',
    mode: 'EVENT',
    expiresOn: '',
    event: 'CONTRACT_SIGNED',
    days: '30',
  });
  const [reason, setReason] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const reload = useCallback(
    async () => setGrants((await api<{ grants: Grant[] }>('/access-grants')).grants),
    [],
  );
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
  const when = (g: { expiresOn: string | null; event: string | null; eventDays: number }) =>
    [
      g.expiresOn ? `until ${g.expiresOn}` : '',
      g.event
        ? `${g.eventDays} day(s) after ${g.event === 'CONTRACT_SIGNED' ? 'the contract is signed' : 'the report is approved'}`
        : '',
    ]
      .filter(Boolean)
      .join(', or ');
  return (
    <div className="flex flex-col gap-8" data-testid="shared-projects">
      <section aria-labelledby="mine-h" className="flex flex-col gap-3">
        <h2 id="mine-h" className="font-heading text-xl font-bold">
          Projects shared with you
        </h2>
        {initial.length === 0 ? (
          <p className="text-sm text-text-muted" data-testid="no-projects">
            Nothing has been shared with you. When procurement gives you access to a project&apos;s documents,
            they appear here until the access ends.
          </p>
        ) : (
          <ul className="grid gap-3" aria-label="Shared projects">
            {initial.map((p) => (
              <li
                key={p.id}
                className="rounded-lg border border-border bg-surface p-4 shadow-sm"
                data-testid="shared-project"
                data-live={p.live}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-heading text-lg font-semibold">{p.project}</p>
                  <Badge tone="neutral">{LABEL[p.label]}</Badge>
                  <Badge tone={p.live ? 'success' : 'error'}>{p.live ? 'Access open' : 'Access ended'}</Badge>
                </div>
                <p className="mt-1 text-sm text-text-muted">
                  {p.live
                    ? `Open ${when(p)}${p.endsAt ? ` (ends ${formatDateTime(p.endsAt)})` : ''}.`
                    : (p.revokedReason ?? 'Your access has ended.')}
                </p>
                {p.live && p.documents.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1 text-sm" aria-label="Documents">
                    {p.documents.map((d) => (
                      <li key={d.url}>
                        <a href={d.url} download>
                          {d.name} (PDF)
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                {p.live && p.documents.length === 0 && (
                  <p className="mt-2 text-sm text-text-muted">No documents exist for this project yet.</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {grants && candidates && (
        <section aria-labelledby="grants-h" className="flex flex-col gap-3" data-testid="grants-admin">
          <h2 id="grants-h" className="font-heading text-xl font-bold">
            Give access to a project
          </h2>
          <p className="max-w-prose text-sm text-text-muted">
            Committee members, auditors and advisors see one project&apos;s contract and evaluation report
            (never bid files) and lose access on their own at the date or event you set.
          </p>
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
          <Card role="region" aria-labelledby="newgrant-h">
            <h3 id="newgrant-h" className="sr-only">
              New access grant
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Person">
                <Select value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })}>
                  <option value="">Choose…</option>
                  {candidates.users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Project">
                <Select value={f.tenderId} onChange={(e) => setF({ ...f, tenderId: e.target.value })}>
                  <option value="">Choose…</option>
                  {candidates.tenders.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.number} {t.title}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Capacity">
                <Select value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })}>
                  <option value="COMMITTEE">Committee member</option>
                  <option value="AUDITOR">Auditor</option>
                  <option value="ADVISOR">Advisor</option>
                </Select>
              </Field>
              <Field label="Access ends">
                <Select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>
                  <option value="EVENT">After an event</option>
                  <option value="DATE">On a date</option>
                </Select>
              </Field>
              {f.mode === 'DATE' ? (
                <Field label="Last day of access">
                  <Input
                    type="date"
                    value={f.expiresOn}
                    onChange={(e) => setF({ ...f, expiresOn: e.target.value })}
                  />
                </Field>
              ) : (
                <>
                  <Field label="Event">
                    <Select value={f.event} onChange={(e) => setF({ ...f, event: e.target.value })}>
                      <option value="CONTRACT_SIGNED">The contract is signed</option>
                      <option value="REPORT_APPROVED">The evaluation report is approved</option>
                    </Select>
                  </Field>
                  <Field label="Days after the event">
                    <Input
                      type="number"
                      min={0}
                      max={3650}
                      value={f.days}
                      onChange={(e) => setF({ ...f, days: e.target.value })}
                    />
                  </Field>
                </>
              )}
            </div>
            <div className="mt-3">
              <Button
                loading={busy === 'grant'}
                disabled={!f.userId || !f.tenderId || (f.mode === 'DATE' && !f.expiresOn)}
                onClick={() =>
                  void go(
                    'grant',
                    async () => {
                      await api('/access-grants', {
                        method: 'POST',
                        csrf,
                        body: {
                          userId: f.userId,
                          tenderId: f.tenderId,
                          label: f.label,
                          ...(f.mode === 'DATE'
                            ? { expiresOn: f.expiresOn }
                            : { event: f.event, eventDays: Number(f.days || 0) }),
                        },
                      });
                    },
                    'Access granted.',
                  )
                }
              >
                Give access
              </Button>
            </div>
          </Card>
          <ul className="flex flex-col gap-2" aria-label="Access grants">
            {grants.length === 0 && <li className="text-sm text-text-muted">No access has been granted.</li>}
            {grants.map((g) => (
              <li
                key={g.id}
                className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3 text-sm"
                data-testid="grant"
                data-live={g.live}
              >
                <span className="min-w-0 flex-1">
                  <strong>{g.user}</strong>{' '}
                  <span className="text-text-muted">
                    ({g.label.toLowerCase()}, {when(g)})
                  </span>
                  <br />
                  <Badge tone={g.live ? 'success' : 'neutral'}>{g.live ? 'Live' : 'Ended'}</Badge>{' '}
                  {g.revokedReason && <span className="text-xs text-text-muted">{g.revokedReason}</span>}
                </span>
                {g.live && (
                  <>
                    <Field label={`Reason to end ${g.user}'s access`}>
                      <Input
                        value={reason[g.id] ?? ''}
                        onChange={(e) => setReason({ ...reason, [g.id]: e.target.value })}
                      />
                    </Field>
                    <Button
                      variant="secondary"
                      aria-label={`End access for ${g.user}`}
                      disabled={(reason[g.id] ?? '').trim().length < 5}
                      loading={busy === `end-${g.id}`}
                      onClick={() =>
                        void go(
                          `end-${g.id}`,
                          async () => {
                            await api(`/access-grants/${g.id}`, {
                              method: 'DELETE',
                              csrf,
                              body: { reason: reason[g.id] },
                            });
                          },
                          'Access ended.',
                        )
                      }
                    >
                      End access
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
