'use client';
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, Field, Input, Select, Table, Td, Th, Textarea } from '@if/ui';
import { ApiError, api } from '@/lib/api-client';
import { formatDateTime } from '@/lib/labels';
import type { TenderView } from './types';

interface Permission {
  id: string;
  supplierId: string;
  company: string;
  reason: string;
  expiresAt: string;
  active: boolean;
  revoked: boolean;
}
interface Stage {
  tenderId: string;
  stage: number;
  type: string;
  status: string;
  submissions: number;
  evaluationId: string | null;
  evaluationStatus: string | null;
  shortlisted: string[] | null;
  current: boolean;
}
interface Deviation {
  id: string;
  company: string;
  clauseRef: string;
  proposal: string;
  reason?: string;
  risk?: 'LOW' | 'MEDIUM' | 'HIGH';
  legalComment?: string;
  status: 'PROPOSED' | 'ACCEPTABLE' | 'NEGOTIATE' | 'REJECTED';
}
interface Notice {
  id: string;
  register: string;
  reference: string;
  status: string;
}

const message = (e: unknown) =>
  e instanceof ApiError
    ? [e.message, ...(e.problem.errors ?? []).map((x) => x.message)]
        .filter((x, i, a) => a.indexOf(x) === i)
        .join(' ')
    : 'Something went wrong. Please try again.';
const STATUS_LABEL = {
  PROPOSED: 'Proposed',
  ACCEPTABLE: 'Acceptable',
  NEGOTIATE: 'To negotiate',
  REJECTED: 'Rejected',
} as const;
const RISK_TONE = { LOW: 'success', MEDIUM: 'warning', HIGH: 'error' } as const;

/** Late-submission permission, stages and shortlisting, the legal deviation register and public notices (roadmap batch B2). */
export function TenderB2Panel({ t, roles, csrf }: { t: TenderView; roles: string[]; csrf: string }) {
  const procurement = roles.includes('PROCUREMENT');
  const legal = roles.includes('LEGAL');
  const closed = !['DRAFT', 'STAGED', 'PUBLISHED'].includes(t.status);
  const [perms, setPerms] = useState<Permission[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [register, setRegister] = useState<{ sealed: boolean; items: Deviation[] } | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [late, setLate] = useState({ supplierId: '', reason: '', hours: '24' });
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [shortNote, setShortNote] = useState('');
  const [edits, setEdits] = useState<Record<string, { risk: string; comment: string; status: string }>>({});

  const load = useCallback(async () => {
    const [p, st, n] = await Promise.all([
      api<Permission[]>(`/tenders/${t.id}/late-permissions`).catch(() => []),
      api<Stage[]>(`/tenders/${t.id}/stages`).catch(() => []),
      api<Notice[]>(`/tenders/${t.id}/notices`).catch(() => []),
    ]);
    setPerms(p);
    setStages(st);
    setNotices(n);
    if (legal || procurement)
      setRegister(
        await api<{ sealed: boolean; items: Deviation[] }>(`/tenders/${t.id}/deviations`).catch(() => null),
      );
  }, [t.id, legal, procurement]);
  useEffect(() => void load(), [load]);

  async function run(name: string, fn: () => Promise<string | void>) {
    setBusy(name);
    setError(null);
    setNote(null);
    try {
      const n = await fn();
      if (n) setNote(n);
      await load();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }
  const registered = t.invitations.filter((i) => i.supplierId);
  const bidders = t.submissions.items ?? [];
  const mine = stages.find((s) => s.current);

  return (
    <div className="flex flex-col gap-4" data-testid="b2-panel">
      {note && (
        <p
          role="status"
          className="rounded-md border border-success bg-success-bg p-3 text-sm font-medium text-success"
        >
          {note}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-md border border-error bg-error-bg p-3 text-sm font-medium text-error"
        >
          {error}
        </p>
      )}

      <Card role="region" aria-labelledby="stages-h" data-testid="stages-card">
        <h2 id="stages-h" className="font-heading text-xl font-bold">
          Stages
        </h2>
        <ol className="mt-2 flex flex-col gap-2 text-sm" aria-label="Stages of this procurement">
          {stages.map((s) => (
            <li key={s.tenderId} data-testid="stage-row" data-stage={s.stage}>
              <span className="font-semibold">Stage {s.stage}</span> ({s.type}) · {s.status.toLowerCase()} ·{' '}
              {s.submissions} bid(s)
              {s.current && <Badge tone="info">This tender</Badge>}
              {s.shortlisted && (
                <span className="ml-2 text-text-muted">{s.shortlisted.length} shortlisted</span>
              )}
              {!s.current && (
                <a className="ml-2 underline" href={`/app/tenders/${s.tenderId}`}>
                  Open
                </a>
              )}
            </li>
          ))}
        </ol>
        {procurement &&
          closed &&
          mine &&
          !mine.shortlisted &&
          mine.evaluationStatus &&
          ['LOCKED', 'REPORTED', 'APPROVED'].includes(mine.evaluationStatus) && (
            <div className="mt-4 flex flex-col gap-3 border-t border-border pt-3">
              <h3 className="font-semibold">Shortlist for the next stage</h3>
              <p className="text-sm text-text-muted">
                Shortlisted suppliers get their own pack and round. Everyone else who bid is told they were
                not shortlisted.
              </p>
              <ul className="flex flex-col gap-1" aria-label="Suppliers to shortlist">
                {bidders.map((b) => (
                  <li key={b.supplierId}>
                    <label className="flex min-h-[44px] items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        className="size-5 accent-[var(--if-color-accent)]"
                        checked={pick.has(b.supplierId)}
                        onChange={(e) => {
                          const n = new Set(pick);
                          if (e.target.checked) n.add(b.supplierId);
                          else n.delete(b.supplierId);
                          setPick(n);
                        }}
                        aria-label={`Shortlist ${b.company}`}
                      />
                      {b.company}
                    </label>
                  </li>
                ))}
              </ul>
              <Field label="A note for the suppliers who are not shortlisted (optional)">
                <Input value={shortNote} onChange={(e) => setShortNote(e.target.value)} />
              </Field>
              <div>
                <Button
                  loading={busy === 'short'}
                  disabled={pick.size === 0}
                  onClick={() =>
                    void run('short', async () => {
                      const r = await api<{
                        nextStage: number;
                        shortlisted: number;
                        unsuccessfulNotified: number;
                      }>(`/tenders/${t.id}/shortlist`, {
                        method: 'POST',
                        csrf,
                        body: {
                          supplierIds: [...pick],
                          ...(shortNote.trim() ? { note: shortNote.trim() } : {}),
                        },
                      });
                      setPick(new Set());
                      return `Stage ${r.nextStage} created for ${r.shortlisted} supplier(s); ${r.unsuccessfulNotified} told they were not shortlisted.`;
                    })
                  }
                >
                  Confirm the shortlist
                </Button>
              </div>
            </div>
          )}
      </Card>

      {closed && (
        <Card role="region" aria-labelledby="late-h" data-testid="late-card">
          <h2 id="late-h" className="font-heading text-xl font-bold">
            Late submissions
          </h2>
          <p className="text-sm text-text-muted">
            A supplier with a good reason can be given extra time, before evaluation begins. It is recorded
            and the supplier is told.
          </p>
          {perms.length > 0 && (
            <ul className="mt-2 flex flex-col gap-2 text-sm" aria-label="Late-submission permissions">
              {perms.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <span className="font-semibold">{p.company}</span> until {formatDateTime(p.expiresAt)}
                    <span className="block text-xs text-text-muted">{p.reason}</span>
                  </span>
                  {p.active ? (
                    procurement ? (
                      <Button
                        variant="ghost"
                        aria-label={`Withdraw permission for ${p.company}`}
                        onClick={() =>
                          void run('revoke', async () => {
                            await api(`/tenders/${t.id}/late-permissions/${p.id}`, {
                              method: 'DELETE',
                              csrf,
                            });
                            return 'Permission withdrawn.';
                          })
                        }
                      >
                        Withdraw
                      </Button>
                    ) : (
                      <Badge tone="info">Active</Badge>
                    )
                  ) : (
                    <Badge tone="neutral">{p.revoked ? 'Withdrawn' : 'Expired'}</Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
          {procurement && t.status === 'CLOSED' && (
            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
              <Field label="Supplier">
                <Select
                  value={late.supplierId}
                  onChange={(e) => setLate({ ...late, supplierId: e.target.value })}
                >
                  <option value="">Choose…</option>
                  {registered.map((i) => (
                    <option key={i.id} value={i.supplierId!}>
                      {i.company}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Reason" hint="At least 10 characters">
                <Input value={late.reason} onChange={(e) => setLate({ ...late, reason: e.target.value })} />
              </Field>
              <Field label="Hours">
                <Input
                  type="number"
                  min={1}
                  max={72}
                  value={late.hours}
                  onChange={(e) => setLate({ ...late, hours: e.target.value })}
                />
              </Field>
              <div className="sm:col-span-3">
                <Button
                  loading={busy === 'late'}
                  disabled={!late.supplierId || late.reason.trim().length < 10}
                  onClick={() =>
                    void run('late', async () => {
                      await api(`/tenders/${t.id}/late-permissions`, {
                        method: 'POST',
                        csrf,
                        body: { supplierId: late.supplierId, reason: late.reason, hours: Number(late.hours) },
                      });
                      setLate({ supplierId: '', reason: '', hours: '24' });
                      return 'Permission recorded and the supplier told.';
                    })
                  }
                >
                  Allow a late submission
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {(legal || procurement) && (
        <Card role="region" aria-labelledby="dev-h" data-testid="deviations-card">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="dev-h" className="font-heading text-xl font-bold">
              Deviation register
            </h2>
            {register && !register.sealed && register.items.length > 0 && (
              <span className="ml-auto flex gap-2">
                <Button asChild variant="secondary">
                  <a
                    href={`/api/v1/tenders/${t.id}/deviations/export.xlsx`}
                    className="text-text no-underline"
                  >
                    Excel
                  </a>
                </Button>
                <Button asChild variant="secondary">
                  <a
                    href={`/api/v1/tenders/${t.id}/deviations/export.docx`}
                    className="text-text no-underline"
                  >
                    Word
                  </a>
                </Button>
              </span>
            )}
          </div>
          {!register || register.sealed ? (
            <p className="mt-2 text-sm text-text-muted" data-testid="deviations-sealed">
              Changes suppliers propose to the contract are sealed with their bids and appear here when the
              tender closes.
            </p>
          ) : register.items.length === 0 ? (
            <p className="mt-2 text-sm text-text-muted">No supplier proposed a change to the contract.</p>
          ) : (
            <Table caption="Proposed contract changes">
              <thead>
                <tr>
                  <Th>Supplier</Th>
                  <Th>Clause</Th>
                  <Th>Proposed change</Th>
                  <Th>Risk</Th>
                  <Th>Status</Th>
                  <Th>
                    <span className="sr-only">Legal</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {register.items.map((d) => {
                  const e = edits[d.id] ?? {
                    risk: d.risk ?? '',
                    comment: d.legalComment ?? '',
                    status: d.status,
                  };
                  return (
                    <tr key={d.id} data-testid="deviation-row">
                      <Td label="Supplier">{d.company}</Td>
                      <Td label="Clause">{d.clauseRef}</Td>
                      <Td label="Proposed change">
                        {d.proposal}
                        {d.reason && <span className="block text-xs text-text-muted">{d.reason}</span>}
                        {d.legalComment && (
                          <span className="block text-xs text-text-muted">Legal: {d.legalComment}</span>
                        )}
                      </Td>
                      <Td label="Risk">
                        {d.risk ? <Badge tone={RISK_TONE[d.risk]}>{d.risk.toLowerCase()}</Badge> : '–'}
                      </Td>
                      <Td label="Status">{STATUS_LABEL[d.status]}</Td>
                      <Td label="Legal">
                        {legal && (
                          <div className="flex min-w-48 flex-col gap-1">
                            <Select
                              aria-label={`Risk for ${d.clauseRef}`}
                              value={e.risk}
                              onChange={(ev) =>
                                setEdits({ ...edits, [d.id]: { ...e, risk: ev.target.value } })
                              }
                            >
                              <option value="">Not rated</option>
                              <option value="LOW">Low</option>
                              <option value="MEDIUM">Medium</option>
                              <option value="HIGH">High</option>
                            </Select>
                            <Select
                              aria-label={`Status for ${d.clauseRef}`}
                              value={e.status}
                              onChange={(ev) =>
                                setEdits({ ...edits, [d.id]: { ...e, status: ev.target.value } })
                              }
                            >
                              {Object.entries(STATUS_LABEL).map(([k, v]) => (
                                <option key={k} value={k}>
                                  {v}
                                </option>
                              ))}
                            </Select>
                            <Textarea
                              aria-label={`Commentary for ${d.clauseRef}`}
                              rows={2}
                              value={e.comment}
                              onChange={(ev) =>
                                setEdits({ ...edits, [d.id]: { ...e, comment: ev.target.value } })
                              }
                            />
                            <Button
                              variant="secondary"
                              loading={busy === `dev-${d.id}`}
                              aria-label={`Save assessment for ${d.clauseRef}`}
                              onClick={() =>
                                void run(`dev-${d.id}`, async () => {
                                  await api(`/tender-deviations/${d.id}`, {
                                    method: 'PUT',
                                    csrf,
                                    body: {
                                      ...(e.risk ? { risk: e.risk } : {}),
                                      comment: e.comment,
                                      status: e.status,
                                    },
                                  });
                                  return 'Assessment saved.';
                                })
                              }
                            >
                              Save
                            </Button>
                          </div>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {notices.length > 0 && (
        <Card role="region" aria-labelledby="notice-h" data-testid="notices-card">
          <h2 id="notice-h" className="font-heading text-xl font-bold">
            Public notices
          </h2>
          <ul className="mt-2 flex flex-col gap-1 text-sm" aria-label="Public notices">
            {notices.map((n) => (
              <li key={n.id}>
                <span className="font-semibold">{n.register}</span>{' '}
                <span className="font-mono text-xs">{n.reference}</span>{' '}
                <Badge tone="info">{n.status === 'SIMULATED' ? 'Simulated' : n.status}</Badge>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-text-muted">
            Public-sector tenders at or above a register&apos;s value are sent to the register for that
            jurisdiction. Registers are simulated in the proof of concept.
          </p>
        </Card>
      )}
    </div>
  );
}
