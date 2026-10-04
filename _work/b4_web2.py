import os
root = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\web\src'


def write(path, text):
    p = root + '\\' + path
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, 'w', encoding='utf8').write(text)


def patch(path, pairs):
    p = root + '\\' + path
    s = open(p, encoding='utf8').read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, s.count(a), a[:80])
        s = s.replace(a, b)
    open(p, 'w', encoding='utf8').write(s)


# ------------------------------------------------------------------ a new NDA, confidentiality or master agreement
write(r'components\contract\new-document.tsx', """'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, Dialog, Field, Input, Select, Textarea } from '@if/ui';
import { ApiError, api } from '@/lib/api-client';

/** Legal or procurement starts an NDA, confidentiality agreement or master agreement, signed the same way as a contract (FR-0430). */
export function NewDocument({ csrf }: { csrf: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [suppliers, setSuppliers] = useState<Array<{ id: string; company: string }>>([]);
  const [f, setF] = useState({ docType: 'NDA', supplierId: '', title: '', text: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open && suppliers.length === 0)
      void api<Array<{ id: string; company: string }>>('/suppliers').then(setSuppliers, () => undefined);
  }, [open, suppliers.length]);
  async function create() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: string }>('/contracts/documents', { method: 'POST', csrf, body: f });
      router.push(`/app/contracts/${r.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? [e.message, ...(e.problem.errors ?? []).map((x) => x.message)].join(' ') : 'Something went wrong.');
      setBusy(false);
    }
  }
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        New agreement (NDA, confidentiality, master)
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="New agreement"
        description="It goes through legal review and is signed by the same authorised people as a contract."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={busy}
              disabled={!f.supplierId || f.title.trim().length < 3 || f.text.trim().length < 20}
              onClick={() => void create()}
            >
              Create the draft
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Type of agreement">
            <Select value={f.docType} onChange={(e) => setF({ ...f, docType: e.target.value })}>
              <option value="NDA">Non-disclosure agreement</option>
              <option value="CONFIDENTIALITY">Confidentiality agreement</option>
              <option value="MASTER">Master agreement</option>
            </Select>
          </Field>
          <Field label="Counterparty">
            <Select value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}>
              <option value="">Choose a supplier…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.company}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Title">
            <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </Field>
          <Field label="Wording" hint="At least 20 characters. Legal can edit it in review.">
            <Textarea rows={5} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} />
          </Field>
          {error && (
            <p role="alert" className="text-sm font-medium text-error">
              {error}
            </p>
          )}
        </div>
      </Dialog>
    </>
  );
}
""")
patch(r'app\app\contracts\page.tsx', [
    ("import { DraftContract } from '@/components/contract/draft-contract';", "import { DraftContract } from '@/components/contract/draft-contract';\nimport { NewDocument } from '@/components/contract/new-document';"),
    ("""        {manager && (
          <nav aria-label="Contract management" className="mt-3 flex flex-wrap gap-2">""", """        {drafter && (
          <div className="mt-3">
            <NewDocument csrf={user!.csrfToken} />
          </div>
        )}
        {manager && (
          <nav aria-label="Contract management" className="mt-3 flex flex-wrap gap-2">"""),
])

# ------------------------------------------------------------------ the legal desk: kanban, hours, knowledge base
write(r'components\legal\legal-desk.tsx', """'use client';
import { useCallback, useState } from 'react';
import { Badge, Button, Card, Field, Input, Select, Textarea } from '@if/ui';
import { ApiError, api } from '@/lib/api-client';

export interface Matter {
  id: string;
  title: string;
  lane: 'NEW' | 'IN_REVIEW' | 'WAITING' | 'DONE';
  priority: 'LOW' | 'NORMAL' | 'HIGH';
  dueOn: string | null;
  assignee: string | null;
  contractNumber: string | null;
  hours: number;
}
export interface Board {
  lanes: Array<{ lane: Matter['lane']; matters: Matter[] }>;
  totalHours: number;
}
export interface Knowledge {
  id: string;
  kind: 'POLICY' | 'ADVICE' | 'FALLBACK' | 'BOILERPLATE';
  title: string;
  body: string;
  clauseId: string | null;
  tags: string;
  by: string;
}
const LANE = { NEW: 'New', IN_REVIEW: 'In review', WAITING: 'Waiting', DONE: 'Done' } as const;
const KIND = { POLICY: 'Policy', ADVICE: 'Historical advice', FALLBACK: 'Fallback position', BOILERPLATE: 'Boilerplate' } as const;
const message = (e: unknown) =>
  e instanceof ApiError ? [e.message, ...(e.problem.errors ?? []).map((x) => x.message)].join(' ') : 'Something went wrong.';

/** Native legal matter management: a board, review hours, and the knowledge base the advisers draw on (FR-0385, FR-0470). */
export function LegalDesk({
  initialBoard,
  initialKnowledge,
  csrf,
  canEdit,
}: {
  initialBoard: Board;
  initialKnowledge: Knowledge[];
  csrf: string;
  canEdit: boolean;
}) {
  const [board, setBoard] = useState(initialBoard);
  const [kb, setKb] = useState(initialKnowledge);
  const [title, setTitle] = useState('');
  const [hours, setHours] = useState<Record<string, string>>({});
  const [nk, setNk] = useState({ kind: 'FALLBACK', title: '', body: '', clauseId: '', tags: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  const reload = useCallback(async () => {
    setBoard(await api<Board>('/legal/matters'));
    setKb((await api<{ items: Knowledge[] }>('/legal-knowledge')).items);
  }, []);
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
  const lanes = ['NEW', 'IN_REVIEW', 'WAITING', 'DONE'] as const;
  return (
    <div className="flex flex-col gap-8" data-testid="legal-desk">
      {error && (
        <p role="alert" className="rounded-md border border-error bg-error-bg p-3 text-sm font-medium text-error">
          {error}
        </p>
      )}
      {note && (
        <p role="status" className="rounded-md border border-success bg-success-bg p-3 text-sm font-medium text-success">
          {note}
        </p>
      )}
      <section aria-labelledby="board-h" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="board-h" className="font-heading text-xl font-bold">
            Matters
          </h2>
          <Badge tone="info">{board.totalHours.toFixed(2)} review hours logged</Badge>
        </div>
        {canEdit && (
          <form
            className="flex flex-wrap items-end gap-2"
            aria-label="Open a matter"
            onSubmit={(e) => {
              e.preventDefault();
              void go('create', async () => {
                await api('/legal/matters', { method: 'POST', csrf, body: { title } });
                setTitle('');
              }, 'Matter opened.');
            }}
          >
            <Field label="New matter">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} className="w-80 max-w-full" />
            </Field>
            <Button type="submit" variant="secondary" disabled={title.trim().length < 3} loading={busy === 'create'}>
              Open matter
            </Button>
          </form>
        )}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {board.lanes.map((l) => (
            <section key={l.lane} aria-label={LANE[l.lane]} className="rounded-lg border border-border bg-surface-alt/50 p-3" data-lane={l.lane}>
              <h3 className="text-sm font-bold uppercase tracking-wide text-text-muted">
                {LANE[l.lane]} ({l.matters.length})
              </h3>
              <ul className="mt-2 flex flex-col gap-2">
                {l.matters.map((m) => (
                  <li key={m.id} className="rounded-md border border-border bg-surface p-3 text-sm shadow-sm" data-testid="matter">
                    <p className="font-semibold">{m.title}</p>
                    <p className="mt-1 text-xs text-text-muted">
                      {m.contractNumber ?? 'No contract'} · {m.priority.toLowerCase()} · {m.hours.toFixed(2)} h
                      {m.assignee ? ` · ${m.assignee}` : ''}
                      {m.dueOn ? ` · due ${m.dueOn}` : ''}
                    </p>
                    {canEdit && (
                      <div className="mt-2 flex flex-col gap-2">
                        <Field label={`Move ${m.title}`}>
                          <Select
                            value={m.lane}
                            onChange={(e) => void go(`move-${m.id}`, async () => { await api(`/legal/matters/${m.id}`, { method: 'PATCH', csrf, body: { lane: e.target.value } }); })}
                          >
                            {lanes.map((x) => (
                              <option key={x} value={x}>
                                {LANE[x]}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <div className="flex items-end gap-2">
                          <Field label={`Hours on ${m.title}`}>
                            <Input type="number" min={0.25} max={24} step={0.25} value={hours[m.id] ?? ''} onChange={(e) => setHours({ ...hours, [m.id]: e.target.value })} />
                          </Field>
                          <Button
                            variant="secondary"
                            aria-label={`Log hours on ${m.title}`}
                            disabled={!hours[m.id] || Number(hours[m.id]) <= 0}
                            loading={busy === `time-${m.id}`}
                            onClick={() =>
                              void go(`time-${m.id}`, async () => {
                                await api(`/legal/matters/${m.id}/time`, { method: 'POST', csrf, body: { hours: Number(hours[m.id]), workDate: today } });
                                setHours({ ...hours, [m.id]: '' });
                              }, 'Hours logged.')
                            }
                          >
                            Log
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </section>

      <section aria-labelledby="kb-h" className="flex flex-col gap-3">
        <h2 id="kb-h" className="font-heading text-xl font-bold">
          Knowledge base
        </h2>
        <p className="max-w-prose text-sm text-text-muted">
          Policies, historical advice, corporate fallback positions and mandatory boilerplate. The advisers use them
          when they explain a deviation or suggest a negotiation strategy.
        </p>
        <ul className="grid gap-3 md:grid-cols-2" aria-label="Knowledge entries">
          {kb.length === 0 && <li className="text-sm text-text-muted">Nothing has been added yet.</li>}
          {kb.map((k) => (
            <li key={k.id} className="rounded-md border border-border bg-surface p-3 text-sm" data-testid="knowledge">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="neutral">{KIND[k.kind]}</Badge>
                <strong>{k.title}</strong>
                {k.clauseId && <span className="text-xs text-text-muted">clause {k.clauseId}</span>}
              </div>
              <p className="mt-1 whitespace-pre-wrap">{k.body}</p>
              {canEdit && (
                <Button
                  variant="secondary"
                  className="mt-2"
                  aria-label={`Remove ${k.title}`}
                  loading={busy === `rm-${k.id}`}
                  onClick={() => void go(`rm-${k.id}`, async () => { await api(`/legal-knowledge/${k.id}`, { method: 'DELETE', csrf }); })}
                >
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
        {canEdit && (
          <Card role="region" aria-labelledby="addkb-h">
            <h3 id="addkb-h" className="font-heading text-lg font-bold">
              Add to the knowledge base
            </h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Kind">
                <Select value={nk.kind} onChange={(e) => setNk({ ...nk, kind: e.target.value })}>
                  {(Object.keys(KIND) as Array<keyof typeof KIND>).map((k) => (
                    <option key={k} value={k}>
                      {KIND[k]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Title">
                <Input value={nk.title} onChange={(e) => setNk({ ...nk, title: e.target.value })} />
              </Field>
              <Field label="Clause it concerns (optional)">
                <Input value={nk.clauseId} onChange={(e) => setNk({ ...nk, clauseId: e.target.value })} />
              </Field>
              <Field label="Tags (words the advisers match on)">
                <Input value={nk.tags} onChange={(e) => setNk({ ...nk, tags: e.target.value })} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Text" hint="At least 10 characters">
                  <Textarea rows={4} value={nk.body} onChange={(e) => setNk({ ...nk, body: e.target.value })} />
                </Field>
              </div>
            </div>
            <div className="mt-3">
              <Button
                loading={busy === 'addkb'}
                disabled={nk.title.trim().length < 3 || nk.body.trim().length < 10}
                onClick={() =>
                  void go('addkb', async () => {
                    await api('/legal-knowledge', {
                      method: 'POST',
                      csrf,
                      body: { kind: nk.kind, title: nk.title, body: nk.body, ...(nk.clauseId ? { clauseId: nk.clauseId } : {}), ...(nk.tags ? { tags: nk.tags } : {}) },
                    });
                    setNk({ kind: 'FALLBACK', title: '', body: '', clauseId: '', tags: '' });
                  }, 'Added.')
                }
              >
                Add entry
              </Button>
            </div>
          </Card>
        )}
      </section>
    </div>
  );
}
""")
write(r'app\app\legal\page.tsx', """import { EmptyState } from '@if/ui';
import { LegalDesk, type Board, type Knowledge } from '@/components/legal/legal-desk';
import { apiGet, getSessionUser } from '@/lib/session';

export const metadata = { title: 'Legal desk – Intuitive Fusion' };

export default async function LegalPage() {
  const [user, board, kb] = await Promise.all([
    getSessionUser(),
    apiGet<Board>('/legal/matters'),
    apiGet<{ items: Knowledge[] }>('/legal-knowledge'),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Legal desk</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Legal matters on a board, the hours spent reviewing each, and the policies and fallback positions legal
          keeps for the platform to draw on.
        </p>
      </header>
      {!board || !kb || !user ? (
        <EmptyState title="The legal desk is unavailable" body="Please refresh the page." />
      ) : (
        <LegalDesk initialBoard={board} initialKnowledge={kb.items} csrf={user.csrfToken} canEdit={user.roles.includes('LEGAL')} />
      )}
    </div>
  );
}
""")

# ------------------------------------------------------------------ shared project documents and grants (FR-0435)
write(r'components\shared\shared-projects.tsx', """'use client';
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
  e instanceof ApiError ? [e.message, ...(e.problem.errors ?? []).map((x) => x.message)].join(' ') : 'Something went wrong.';

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
  const [f, setF] = useState({ userId: '', tenderId: '', label: 'AUDITOR', mode: 'EVENT', expiresOn: '', event: 'CONTRACT_SIGNED', days: '30' });
  const [reason, setReason] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const reload = useCallback(async () => setGrants((await api<{ grants: Grant[] }>('/access-grants')).grants), []);
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
    [g.expiresOn ? `until ${g.expiresOn}` : '', g.event ? `${g.eventDays} day(s) after ${g.event === 'CONTRACT_SIGNED' ? 'the contract is signed' : 'the report is approved'}` : ''].filter(Boolean).join(', or ');
  return (
    <div className="flex flex-col gap-8" data-testid="shared-projects">
      <section aria-labelledby="mine-h" className="flex flex-col gap-3">
        <h2 id="mine-h" className="font-heading text-xl font-bold">
          Projects shared with you
        </h2>
        {initial.length === 0 ? (
          <p className="text-sm text-text-muted" data-testid="no-projects">
            Nothing has been shared with you. When procurement gives you access to a project&apos;s documents, they appear here until the access ends.
          </p>
        ) : (
          <ul className="grid gap-3" aria-label="Shared projects">
            {initial.map((p) => (
              <li key={p.id} className="rounded-lg border border-border bg-surface p-4 shadow-sm" data-testid="shared-project" data-live={p.live}>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-heading text-lg font-semibold">{p.project}</p>
                  <Badge tone="neutral">{LABEL[p.label]}</Badge>
                  <Badge tone={p.live ? 'success' : 'error'}>{p.live ? 'Access open' : 'Access ended'}</Badge>
                </div>
                <p className="mt-1 text-sm text-text-muted">
                  {p.live ? `Open ${when(p)}${p.endsAt ? ` (ends ${formatDateTime(p.endsAt)})` : ''}.` : p.revokedReason ?? 'Your access has ended.'}
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
                {p.live && p.documents.length === 0 && <p className="mt-2 text-sm text-text-muted">No documents exist for this project yet.</p>}
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
            Committee members, auditors and advisors see one project&apos;s contract and evaluation report (never bid files) and
            lose access on their own at the date or event you set.
          </p>
          {error && (
            <p role="alert" className="rounded-md border border-error bg-error-bg p-3 text-sm font-medium text-error">
              {error}
            </p>
          )}
          {note && (
            <p role="status" className="rounded-md border border-success bg-success-bg p-3 text-sm font-medium text-success">
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
                  <Input type="date" value={f.expiresOn} onChange={(e) => setF({ ...f, expiresOn: e.target.value })} />
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
                    <Input type="number" min={0} max={3650} value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} />
                  </Field>
                </>
              )}
            </div>
            <div className="mt-3">
              <Button
                loading={busy === 'grant'}
                disabled={!f.userId || !f.tenderId || (f.mode === 'DATE' && !f.expiresOn)}
                onClick={() =>
                  void go('grant', async () => {
                    await api('/access-grants', {
                      method: 'POST',
                      csrf,
                      body: {
                        userId: f.userId,
                        tenderId: f.tenderId,
                        label: f.label,
                        ...(f.mode === 'DATE' ? { expiresOn: f.expiresOn } : { event: f.event, eventDays: Number(f.days || 0) }),
                      },
                    });
                  }, 'Access granted.')
                }
              >
                Give access
              </Button>
            </div>
          </Card>
          <ul className="flex flex-col gap-2" aria-label="Access grants">
            {grants.length === 0 && <li className="text-sm text-text-muted">No access has been granted.</li>}
            {grants.map((g) => (
              <li key={g.id} className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3 text-sm" data-testid="grant" data-live={g.live}>
                <span className="min-w-0 flex-1">
                  <strong>{g.user}</strong> <span className="text-text-muted">({g.label.toLowerCase()}, {when(g)})</span>
                  <br />
                  <Badge tone={g.live ? 'success' : 'neutral'}>{g.live ? 'Live' : 'Ended'}</Badge>{' '}
                  {g.revokedReason && <span className="text-xs text-text-muted">{g.revokedReason}</span>}
                </span>
                {g.live && (
                  <>
                    <Field label={`Reason to end ${g.user}'s access`}>
                      <Input value={reason[g.id] ?? ''} onChange={(e) => setReason({ ...reason, [g.id]: e.target.value })} />
                    </Field>
                    <Button
                      variant="secondary"
                      aria-label={`End access for ${g.user}`}
                      disabled={(reason[g.id] ?? '').trim().length < 5}
                      loading={busy === `end-${g.id}`}
                      onClick={() => void go(`end-${g.id}`, async () => { await api(`/access-grants/${g.id}`, { method: 'DELETE', csrf, body: { reason: reason[g.id] } }); }, 'Access ended.')}
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
""")
write(r'app\app\shared\page.tsx', """import { EmptyState } from '@if/ui';
import { SharedProjects, type Project } from '@/components/shared/shared-projects';
import { apiGet, getSessionUser } from '@/lib/session';

export const metadata = { title: 'Shared documents – Intuitive Fusion' };

export default async function SharedPage() {
  const user = await getSessionUser();
  const admin = user?.roles.some((r) => r === 'PROCUREMENT' || r === 'ADMIN') ?? false;
  const [mine, grants, candidates] = await Promise.all([
    apiGet<{ projects: Project[] }>('/shared/projects'),
    admin ? apiGet<{ grants: never[] }>('/access-grants') : Promise.resolve(null),
    admin ? apiGet<{ users: never[]; tenders: never[] }>('/access-grants/candidates') : Promise.resolve(null),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Shared documents</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Time-bound access to one project&apos;s documents, for committee members, auditors and advisors. Access ends on
          its own at the date or event it was given for.
        </p>
      </header>
      {!mine || !user ? (
        <EmptyState title="Shared documents are unavailable" body="Please refresh the page." />
      ) : (
        <SharedProjects initial={mine.projects} grants={grants?.grants ?? null} candidates={candidates} csrf={user.csrfToken} />
      )}
    </div>
  );
}
""")

# ------------------------------------------------------------------ the supplier reads the contract and asks questions (FR-0445)
write(r'components\supplier\supplier-contract.tsx', """'use client';
import { useState } from 'react';
import { Badge, Button, Card, Field, Textarea } from '@if/ui';
import { ApiError, api } from '@/lib/api-client';

export interface SupplierContract {
  id: string;
  number: string;
  title: string | null;
  status: string;
  value: number;
  startDate: string | null;
  endDate: string | null;
  clauses: Array<{ id: string; title: string; text: string }>;
  questions: Array<{ id: string; clauseId: string | null; question: string; answer: string | null }>;
}
const aud = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });

/** The full contract text for the supplier to read before it is signed, with a place to raise questions. */
export function SupplierContractView({ initial, csrf }: { initial: SupplierContract; csrf: string }) {
  const [c, setC] = useState(initial);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function ask() {
    setBusy(true);
    setError(null);
    try {
      await api(`/supplier/contracts/${c.id}/questions`, { method: 'POST', csrf, body: { question: text } });
      setC(await api<SupplierContract>(`/supplier/contracts/${c.id}`));
      setText('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-6" data-testid="supplier-contract">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={c.status === 'EXECUTED' ? 'success' : 'warning'}>{c.status === 'EXECUTED' ? 'Signed' : 'Out for signature'}</Badge>
        <span className="text-sm text-text-muted">
          {aud.format(c.value)}, {c.startDate} to {c.endDate}
        </span>
      </div>
      <Card role="region" aria-labelledby="sc-h">
        <h2 id="sc-h" className="font-heading text-xl font-bold">
          The contract
        </h2>
        <ol className="mt-3 flex flex-col gap-4">
          {c.clauses.map((k) => (
            <li key={k.id}>
              <h3 className="font-heading font-semibold">{k.title}</h3>
              <p className="mt-1 whitespace-pre-line text-sm">{k.text}</p>
            </li>
          ))}
        </ol>
      </Card>
      <Card role="region" aria-labelledby="sq-h">
        <h2 id="sq-h" className="font-heading text-xl font-bold">
          Your questions
        </h2>
        <ul className="mt-2 flex flex-col gap-2 text-sm" aria-label="Your questions">
          {c.questions.length === 0 && <li className="text-text-muted">You have not asked a question.</li>}
          {c.questions.map((q) => (
            <li key={q.id} className="rounded-md border border-border p-2">
              <p>{q.question}</p>
              {q.answer ? <p className="mt-1 rounded bg-surface-alt p-2">Answer: {q.answer}</p> : <p className="mt-1 text-text-muted">Waiting for an answer.</p>}
            </li>
          ))}
        </ul>
        {c.status !== 'EXECUTED' && (
          <div className="mt-3 flex flex-col gap-2">
            <Field label="Ask a question before the contract is signed">
              <Textarea rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
            {error && (
              <p role="alert" className="text-sm font-medium text-error">
                {error}
              </p>
            )}
            <div>
              <Button loading={busy} disabled={text.trim().length < 5} onClick={() => void ask()}>
                Send question
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
""")
write(r'app\supplier\(portal)\contracts\page.tsx', """import Link from 'next/link';
import { Badge, EmptyState } from '@if/ui';
import { apiGet } from '@/lib/session';

export const metadata = { title: 'Contracts – Intuitive Fusion' };

interface Row {
  id: string;
  number: string;
  title: string | null;
  docType: string;
  status: string;
  value: number;
}

export default async function SupplierContractsPage() {
  const data = await apiGet<{ contracts: Row[] }>('/supplier/contracts');
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Contracts</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Contracts out for signature or signed. You can read the full text and ask questions before it is signed.
        </p>
      </header>
      {!data || data.contracts.length === 0 ? (
        <EmptyState title="No contracts yet" body="When a contract is released for signature you will be told, and it appears here." />
      ) : (
        <ul className="grid gap-3" aria-label="Contracts">
          {data.contracts.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm" data-testid="supplier-contract-row">
              <span className="font-mono text-xs text-text-muted">{c.number}</span>
              <Link href={`/supplier/contracts/${c.id}`} className="font-heading text-lg font-semibold">
                {c.title ?? 'Contract'}
              </Link>
              <Badge tone={c.status === 'EXECUTED' ? 'success' : 'warning'}>{c.status === 'EXECUTED' ? 'Signed' : 'Out for signature'}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
""")
write(r'app\supplier\(portal)\contracts\[id]\page.tsx', """import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SupplierContractView, type SupplierContract } from '@/components/supplier/supplier-contract';
import { apiGetResult, getSessionUser } from '@/lib/session';

export const metadata = { title: 'Contract – Intuitive Fusion' };

export default async function SupplierContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [user, res] = await Promise.all([getSessionUser(), apiGetResult<SupplierContract>(`/supplier/contracts/${id}`)]);
  if (!user || !res.data) notFound();
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">
        <Link href="/supplier/contracts">← Contracts</Link>
      </p>
      <h1 className="text-3xl font-extrabold tracking-tight">
        <span className="font-mono text-lg text-text-muted">{res.data.number}</span> {res.data.title ?? 'Contract'}
      </h1>
      <SupplierContractView initial={res.data} csrf={user.csrfToken} />
    </div>
  );
}
""")

# ------------------------------------------------------------------ navigation and routes
patch(r'lib\nav.ts', [
    ("""  {
    href: '/app/audit',
    label: 'Audit trail',""", """  {
    href: '/app/legal',
    label: 'Legal desk',
    icon: 'contracts',
    roles: ['LEGAL', 'PROCUREMENT'],
    section: 'Work',
    module: 'Legal matter management',
    requirements: ['FR-0385', 'FR-0470'],
    blurb: 'A board of legal matters, review hours, and the knowledge base legal keeps for the platform.',
  },
  {
    href: '/app/shared',
    label: 'Shared documents',
    icon: 'reports',
    roles: STAFF_ALL,
    section: 'Oversight',
    module: 'Time-bound access',
    requirements: ['FR-0435'],
    blurb: 'Projects whose documents you have been given access to, and when that access ends.',
  },
  {
    href: '/app/audit',
    label: 'Audit trail',"""),
    ("""  {
    href: '/supplier/profile',
    label: 'Company profile',""", """  {
    href: '/supplier/contracts',
    label: 'Contracts',
    icon: 'contracts',
    roles: ['SUPPLIER'],
    section: 'Supplier',
    module: 'Contracts',
    requirements: ['FR-0445'],
    blurb: 'Read a contract before it is signed, and ask questions.',
  },
  {
    href: '/supplier/profile',
    label: 'Company profile',"""),
])
patch(r'..\..\..\..\packages\shared\src\access.ts', [
    ("  { prefix: '/app/probity', roles: ['PROBITY'] },", "  { prefix: '/app/probity', roles: ['PROBITY'] },\n  { prefix: '/app/legal', roles: ['LEGAL', 'PROCUREMENT'] },"),
])

# ------------------------------------------------------------------ banking details on the supplier profile
patch(r'components\supplier\supplier-profile.tsx', [
    ("""      <Card role="region" aria-labelledby="priv-h" data-testid="privacy-card">""", """      <BankCard csrf={csrf} />

      <Card role="region" aria-labelledby="priv-h" data-testid="privacy-card">"""),
])
s = open(root + r'\components\supplier\supplier-profile.tsx', encoding='utf8').read()
s += """
/** Banking details, checked against the company's legal name before a contract can be signed (FR-0415). */
function BankCard({ csrf }: { csrf: string }) {
  const [f, setF] = useState({ bsb: '', account: '', accountName: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const r = await api<{ account: string }>('/supplier/profile/bank', { method: 'PUT', csrf, body: f });
      setNote(`Saved. Account ${r.account} is on record.`);
      setF({ bsb: '', account: '', accountName: '' });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card role="region" aria-labelledby="bank-h" data-testid="bank-card">
      <h2 id="bank-h" className="font-heading text-xl font-bold">
        Banking details
      </h2>
      <p className="mt-1 max-w-prose text-sm text-text-muted">
        The account name must match your company&apos;s legal name. The buyer checks this before a contract is signed. Only
        the last three digits are ever shown back to you.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Field label="BSB">
          <Input value={f.bsb} onChange={(e) => setF({ ...f, bsb: e.target.value })} placeholder="062-000" />
        </Field>
        <Field label="Account number">
          <Input value={f.account} onChange={(e) => setF({ ...f, account: e.target.value })} inputMode="numeric" />
        </Field>
        <Field label="Account name">
          <Input value={f.accountName} onChange={(e) => setF({ ...f, accountName: e.target.value })} />
        </Field>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-error">
          {error}
        </p>
      )}
      {note && (
        <p role="status" className="mt-2 text-sm font-medium text-success">
          {note}
        </p>
      )}
      <div className="mt-3">
        <Button variant="secondary" loading={busy} disabled={!f.bsb || !f.account || !f.accountName} onClick={() => void save()}>
          Save banking details
        </Button>
      </div>
    </Card>
  );
}
"""
open(root + r'\components\supplier\supplier-profile.tsx', 'w', encoding='utf8').write(s)

# ------------------------------------------------------------------ settings
patch(r'components\admin\settings-panel.tsx', [
    ("""  criteriaLibrary: Array<{""", """  contractRules: {
    requireBankDetails: boolean;
    requireRiskSummaryReview: boolean;
    endorsements: Array<'LEGAL' | 'FINANCE'>;
    protectedClauses: string[];
    negotiationLockDays: number;
    signingReminderHours: number;
  };
  criteriaLibrary: Array<{"""),
    ("""      <Section
        {...sec('criteriaLibrary')}""", """      <Section
        {...sec('contractRules')}
        title="Contract rules"
        blurb="What must happen before a contract is released for signing, which clauses are non-negotiable, and how long a negotiation may run."
        onSave={() => void save('contractRules', s.contractRules)}
      >
        {(
          [
            ['requireBankDetails', 'The supplier must have banking details on record, matching its legal name'],
            ['requireRiskSummaryReview', 'Legal must review the risk summary before a contract is released'],
          ] as const
        ).map(([key, text]) => (
          <label key={key} className="flex min-h-[44px] items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="size-5 accent-[var(--if-color-accent)]"
              checked={s.contractRules[key]}
              onChange={(e) => setS({ ...s, contractRules: { ...s.contractRules, [key]: e.target.checked } })}
            />
            <span>{text}</span>
          </label>
        ))}
        <fieldset className="flex flex-wrap gap-4">
          <legend className="text-sm font-semibold">Endorsements needed before release</legend>
          {(['LEGAL', 'FINANCE'] as const).map((r) => (
            <label key={r} className="flex min-h-[44px] items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-5 accent-[var(--if-color-accent)]"
                checked={s.contractRules.endorsements.includes(r)}
                onChange={(e) =>
                  setS({
                    ...s,
                    contractRules: {
                      ...s.contractRules,
                      endorsements: e.target.checked
                        ? [...s.contractRules.endorsements, r]
                        : s.contractRules.endorsements.filter((x) => x !== r),
                    },
                  })
                }
              />
              {r === 'LEGAL' ? 'Legal' : 'Finance'}
            </label>
          ))}
        </fieldset>
        <Field label="Non-negotiable clause ids (comma separated)" >
          <Input
            value={s.contractRules.protectedClauses.join(', ')}
            onChange={(e) =>
              setS({
                ...s,
                contractRules: {
                  ...s.contractRules,
                  protectedClauses: e.target.value.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean),
                },
              })
            }
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Lock signing after this many days of negotiation">
            <Input
              type="number"
              min={1}
              max={365}
              value={s.contractRules.negotiationLockDays}
              onChange={(e) =>
                setS({ ...s, contractRules: { ...s.contractRules, negotiationLockDays: Number(e.target.value) } })
              }
            />
          </Field>
          <Field label="Remind unsigned signatories every (hours)">
            <Input
              type="number"
              min={1}
              max={720}
              value={s.contractRules.signingReminderHours}
              onChange={(e) =>
                setS({ ...s, contractRules: { ...s.contractRules, signingReminderHours: Number(e.target.value) } })
              }
            />
          </Field>
        </div>
      </Section>

      <Section
        {...sec('criteriaLibrary')}"""),
])
print('ok')
