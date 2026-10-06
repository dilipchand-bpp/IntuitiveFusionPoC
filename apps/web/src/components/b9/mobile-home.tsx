'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Button, Card, EmptyState, Field, Select, Textarea } from '@if/ui';
import { allowedRolesForPath } from '@/lib/access';
import { api } from '@/lib/api-client';
import { send, useData, useRun } from '@/components/contract/b5-shared';
import { appendSpoken, useDictation } from '@/components/voice/use-dictation';
import { VoiceButton, VoiceStatus } from '@/components/voice/voice-button';

interface Notification {
  id: string;
  title: string;
  body?: string;
  link?: string;
  read: boolean;
  createdAt: string;
}
interface Target {
  supplierId: string;
  company: string;
}
interface Note {
  id: string;
  supplierId: string;
  supplier: string;
  text: string;
  visibility: 'PRIVATE' | 'TEAM';
  by: string;
  mine: boolean;
  at: string;
}

const tile =
  'flex min-h-[88px] flex-col justify-center rounded-lg border border-border bg-surface p-4 text-text no-underline shadow-sm hover:bg-surface-alt focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

export function MobileHome({ csrf, name, roles }: { csrf: string; name: string; roles: readonly string[] }) {
  // only offer what this person can open
  const canOpen = (href: string) => (allowedRolesForPath(href) ?? []).some((r) => roles.includes(r));
  const notifications = useData<Notification[]>('/notifications');
  const approvals = useData<Array<{ requestId: string }>>(
    canOpen('/app/approvals') ? '/plans?status=AWAITING_APPROVAL' : null,
  );
  const unread = (notifications.data ?? []).filter((n) => !n.read);
  const waiting = Array.isArray(approvals.data) ? approvals.data.length : null;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5" data-testid="mobile-home">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight">Hello, {name.split(' ')[0]}</h1>
        <p className="mt-1 text-sm text-text-muted">
          Your approvals and alerts, and quick notes on suppliers.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3">
        {canOpen('/app/approvals') && (
          <Link href="/app/approvals" className={tile}>
            <span className="text-3xl font-extrabold">{waiting ?? '–'}</span>
            <span className="text-sm font-semibold">Approvals waiting</span>
          </Link>
        )}
        <a href="#alerts" className={tile}>
          <span className="text-3xl font-extrabold">{notifications.data ? unread.length : '–'}</span>
          <span className="text-sm font-semibold">Unread notifications</span>
        </a>
      </div>

      <nav aria-label="Quick links" className="grid grid-cols-3 gap-3">
        {[
          ['/app/approvals', 'Approvals'],
          ['/app/search', 'Search'],
          ['/app/requests', 'Requests'],
        ]
          .filter(([href]) => canOpen(href!))
          .map(([href, label]) => (
            <Link
              key={href}
              href={href!}
              className="flex min-h-[44px] items-center justify-center rounded-md border border-border-strong bg-surface px-2 text-sm font-semibold text-text no-underline hover:bg-surface-alt focus-visible:outline-2 focus-visible:outline-ring"
            >
              {label}
            </Link>
          ))}
      </nav>

      <section id="alerts" aria-labelledby="alerts-h">
        <h2 id="alerts-h" className="text-lg font-bold">
          Notifications
        </h2>
        {notifications.error && (
          <p role="alert" className="text-sm text-error">
            {notifications.error}
          </p>
        )}
        {notifications.data && notifications.data.length === 0 && (
          <EmptyState title="All clear" body="You have no notifications." />
        )}
        {notifications.data && notifications.data.length > 0 && (
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-surface">
            {notifications.data.slice(0, 5).map((n) => (
              <li key={n.id} className="px-4 py-3 text-sm">
                <p className="font-semibold">
                  {!n.read && <Badge tone="info">New</Badge>} {n.title}
                </p>
                {n.body && <p className="text-text-muted">{n.body}</p>}
                {n.link && (
                  <Link href={n.link} className="mt-1 inline-flex min-h-[44px] items-center">
                    Open
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <ReviewNotes csrf={csrf} />

      <p className="text-xs text-text-muted">
        This is the installable web app. Add it to your home screen from your browser menu. It works offline
        only for static pages: approvals, search and notes need a connection.
      </p>
    </div>
  );
}

function ReviewNotes({ csrf }: { csrf: string }) {
  const targets = useData<Target[]>('/notes/targets');
  const [supplierId, setSupplierId] = useState('');
  const notes = useData<Note[]>(supplierId ? `/notes?supplierId=${supplierId}` : null);
  const [text, setText] = useState('');
  const [visibility, setVisibility] = useState<'PRIVATE' | 'TEAM'>('PRIVATE');
  const voice = useDictation((spoken) => setText((cur) => appendSpoken(cur, spoken)));
  const r = useRun();

  return (
    <section aria-labelledby="notes-h">
      <h2 id="notes-h" className="text-lg font-bold">
        Supplier review notes
      </h2>
      <Card className="mt-2 flex flex-col gap-4 p-4">
        {targets.error && (
          <p role="alert" className="text-sm text-error">
            {targets.error}
          </p>
        )}
        {targets.data && targets.data.length === 0 ? (
          <p className="text-sm text-text-muted">There are no suppliers you can write notes about yet.</p>
        ) : (
          <Field label="Supplier">
            <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Choose a supplier</option>
              {(targets.data ?? []).map((t) => (
                <option key={t.supplierId} value={t.supplierId}>
                  {t.company}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {supplierId && (
          <>
            <form
              className="flex flex-col gap-3"
              aria-label="Add a note"
              onSubmit={(e) => {
                e.preventDefault();
                void r.run(
                  'add',
                  async () => {
                    await send(csrf, 'POST', '/notes', { supplierId, text: text.trim(), visibility });
                    setText('');
                    await notes.reload();
                  },
                  'Note saved.',
                );
              }}
            >
              <Field label="Note" hint="Type, or tap the microphone to speak. You can edit before saving.">
                <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} />
              </Field>
              <div className="flex items-center gap-2">
                <VoiceButton state={voice.state} onStart={voice.start} onStop={voice.stop} />
                <VoiceStatus state={voice.state} interim={voice.interim} error={voice.error} />
              </div>
              <Field label="Who can read it">
                <Select
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as 'PRIVATE' | 'TEAM')}
                >
                  <option value="PRIVATE">Only me</option>
                  <option value="TEAM">My review team</option>
                </Select>
              </Field>
              <Button
                type="submit"
                size="lg"
                loading={r.busy === 'add'}
                disabled={text.trim().length < 3 || r.busy !== null}
              >
                Save note
              </Button>
            </form>
            {r.messages}

            {notes.error && (
              <p role="alert" className="text-sm text-error">
                {notes.error}
              </p>
            )}
            {notes.data && notes.data.length === 0 && (
              <p className="text-sm text-text-muted">No notes on this supplier yet.</p>
            )}
            {notes.data && notes.data.length > 0 && (
              <ul className="divide-y divide-border" aria-label="Notes on this supplier">
                {notes.data.map((n) => (
                  <li key={n.id} className="py-3 text-sm">
                    <p className="whitespace-pre-wrap">{n.text}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                      {n.by} · {new Date(n.at).toLocaleDateString('en-AU')}{' '}
                      <Badge tone={n.visibility === 'TEAM' ? 'info' : 'neutral'}>
                        {n.visibility === 'TEAM' ? 'Team' : 'Private'}
                      </Badge>
                    </p>
                    {n.mine && (
                      <Button
                        type="button"
                        variant="secondary"
                        className="mt-2"
                        aria-label={`Delete my note: ${n.text.slice(0, 40)}`}
                        disabled={r.busy !== null}
                        onClick={() =>
                          void r.run(
                            `del-${n.id}`,
                            async () => {
                              await api(`/notes/${n.id}`, { method: 'DELETE', csrf });
                              await notes.reload();
                            },
                            'Note deleted.',
                          )
                        }
                      >
                        Delete
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Card>
    </section>
  );
}
