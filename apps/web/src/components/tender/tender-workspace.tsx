'use client';
import { OpeningPanel, ResponseFormPanel } from './b8-panels';
import { CheckCircle2, Copy, Lock, Send } from 'lucide-react';
import { useCallback, useState } from 'react';
import { FileDown } from 'lucide-react';
import { Badge, Button, Card, Field, Input, Select, Stepper, Tabs, Textarea } from '@if/ui';
import { ApiError, api } from '@/lib/api-client';
import {
  TENDER_STATUS_LABEL,
  TENDER_STATUS_TONE,
  TENDER_TYPE_LABEL,
  aud,
  formatDateTime,
} from '@/lib/labels';
import { TenderB2Panel } from './b2-panel';
import type { TenderView } from './types';

const STEPS = ['Staged', 'Permission to publish', 'Open for bids', 'Closed'];
const stepIndex = (t: TenderView) =>
  t.status === 'STAGED' ? (t.permission.granted ? 1 : 0) : t.status === 'PUBLISHED' ? 2 : 3;

/** Default closing time: 26 days from now at 5pm local, safely beyond the 25-day statutory minimum. */
function defaultClose(): string {
  const d = new Date(Date.now() + 26 * 86_400_000);
  d.setHours(17, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const message = (e: unknown) =>
  e instanceof ApiError
    ? [e.message, ...(e.problem.errors ?? []).map((x) => x.message)]
        .filter((x, i, a) => a.indexOf(x) === i)
        .join(' ')
    : 'Something went wrong. Please try again.';

/** Everything the buying team does with one tender: the pack, permission, publishing, invitations, Q&A, addenda, bids. */
export function TenderWorkspace({
  initial,
  csrf,
  roles = [],
}: {
  initial: TenderView;
  csrf: string;
  roles?: string[];
}) {
  const [t, setT] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [closeAt, setCloseAt] = useState(defaultClose);
  const [comment, setComment] = useState('');

  const toAnswer = t.questions.filter((q) => q.status !== 'PUBLISHED').length;
  const refresh = useCallback(async () => setT(await api<TenderView>(`/tenders/${t.id}`)), [t.id]);
  async function run(name: string, fn: () => Promise<void>, ok?: string) {
    setBusy(name);
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (ok) setNotice(ok);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }
  const post = <R,>(path: string, body: unknown = {}) => api<R>(path, { method: 'POST', csrf, body });

  return (
    <div className="flex flex-col gap-6" data-testid="tender-workspace" data-status={t.status}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={TENDER_STATUS_TONE[t.status] ?? 'neutral'}>
          {TENDER_STATUS_LABEL[t.status] ?? t.status}
        </Badge>
        <Badge tone="info">{TENDER_TYPE_LABEL[t.type] ?? t.type}</Badge>
        <Badge tone="neutral">{t.access === 'OPEN' ? 'Open access' : 'Invited suppliers only'}</Badge>
        <span className="text-sm text-text-muted">
          Value {aud.format(t.estimatedValue)} (internal; never shown to suppliers)
        </span>
      </div>
      <Stepper steps={STEPS} current={stepIndex(t)} />

      {error && (
        <p
          role="alert"
          className="rounded-md border border-error bg-error-bg p-3 text-sm font-medium text-error"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-md border border-success bg-success-bg p-3 text-sm font-medium text-success"
        >
          {notice}
        </p>
      )}

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['Opens', formatDateTime(t.opensAt)],
          ['Closes', formatDateTime(t.closesAt)],
          ['Suppliers invited', String(t.invitations.length)],
          [
            'Bids received',
            t.submissions.sealed ? `${t.submissions.count} (sealed)` : String(t.submissions.count),
          ],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-border bg-surface p-4 shadow-sm">
            <dt className="text-xs font-bold uppercase tracking-wide text-text-muted">{k}</dt>
            <dd className="mt-1 font-heading text-lg font-bold">{v}</dd>
          </div>
        ))}
      </dl>

      {/* ---------------------------------------------------------- publish gate */}
      <Card role="region" aria-labelledby="publish-h">
        <h2 id="publish-h" className="font-heading text-xl font-bold">
          Permission and publishing
        </h2>
        {t.permission.granted ? (
          <p
            className="mt-2 flex items-start gap-2 rounded-md border-2 border-success px-3 py-2 text-sm font-semibold text-success"
            data-testid="permission-stamp"
          >
            <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            {t.permission.by}
          </p>
        ) : (
          <p className="mt-2 flex items-start gap-2 text-sm text-text-muted">
            <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {t.status === 'STAGED'
              ? 'This tender is staged. It is invisible to suppliers until a delegate gives permission to publish and procurement publishes it.'
              : 'Permission was recorded when the tender was published.'}
          </p>
        )}

        {t.permissions.canGrantPermission && (
          <form
            className="mt-4 flex flex-col gap-3"
            aria-label="Give permission to publish"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                'permit',
                async () =>
                  setT(
                    await post<TenderView>(`/tenders/${t.id}/publish-permission`, comment ? { comment } : {}),
                  ),
                'Permission to publish recorded.',
              );
            }}
          >
            <Field label="Comment (optional)">
              <Input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} />
            </Field>
            <div>
              <Button type="submit" loading={busy === 'permit'}>
                Give permission to publish
              </Button>
            </div>
          </form>
        )}

        {t.status === 'STAGED' && !t.permissions.canGrantPermission && !t.permission.granted && (
          <p className="mt-3 text-sm font-medium" data-testid="publish-blocked">
            Publish is unavailable until a delegate gives permission.
          </p>
        )}

        {t.permissions.canPublish && (
          <form
            className="mt-4 flex flex-col gap-3"
            aria-label="Publish the tender"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                'publish',
                async () =>
                  setT(
                    await post<TenderView>(`/tenders/${t.id}/publish`, {
                      closesAt: new Date(closeAt).toISOString(),
                    }),
                  ),
                'Published. Invited suppliers can now see this tender.',
              );
            }}
          >
            <Field
              label="Closing date and time"
              hint="Public-sector tenders need at least 25 days between publication and closing. The portal locks automatically at this time."
            >
              <Input
                type="datetime-local"
                value={closeAt}
                onChange={(e) => setCloseAt(e.target.value)}
                required
              />
            </Field>
            <div>
              <Button type="submit" loading={busy === 'publish'}>
                Publish tender
              </Button>
            </div>
          </form>
        )}
      </Card>

      <div className="flex flex-wrap items-center gap-2" data-testid="pack-export">
        <span className="text-sm font-semibold text-text-muted">Print or circulate the pack:</span>
        <Button asChild variant="secondary">
          <a href={`/api/v1/tenders/${t.id}/pack/pdf`} download className="text-text no-underline">
            <FileDown className="size-4" aria-hidden="true" />
            PDF
          </a>
        </Button>
        <Button asChild variant="secondary">
          <a href={`/api/v1/tenders/${t.id}/pack/docx`} download className="text-text no-underline">
            <FileDown className="size-4" aria-hidden="true" />
            Word
          </a>
        </Button>
      </div>

      <Tabs
        label="Tender sections"
        items={[
          {
            value: 'pack',
            label: 'Tender pack',
            content: (
              <section aria-labelledby="pack-h" className="flex flex-col gap-3">
                <h2 id="pack-h" className="font-heading text-xl font-bold">
                  Tender pack
                </h2>
                {!t.permissions.canEdit && (
                  <p className="text-sm text-text-muted">
                    {t.status === 'STAGED'
                      ? 'You can read the pack. Procurement and legal edit it while it is staged.'
                      : 'The pack is locked now that it is published. Issue an addendum to change what suppliers see.'}
                  </p>
                )}
                {t.fields.map((f) => (
                  <PackSection
                    key={f.key}
                    tenderId={t.id}
                    field={f}
                    canEdit={t.permissions.canEdit}
                    csrf={csrf}
                    onSaved={setT}
                  />
                ))}
              </section>
            ),
          },
          {
            value: 'invitations',
            label: `Invitations (${t.invitations.length})`,
            content: <InvitePanel t={t} csrf={csrf} onDone={refresh} />,
          },
          {
            value: 'qa',
            label: toAnswer > 0 ? `Questions and addenda (${toAnswer} to answer)` : 'Questions and addenda',
            content: <QaPanel t={t} csrf={csrf} onDone={refresh} />,
          },
          {
            value: 'stages',
            label:
              (t.stage ?? 1) > 1 ? `Stage ${t.stage}, register and notices` : 'Stages, register and notices',
            content: <TenderB2Panel t={t} roles={roles} csrf={csrf} />,
          },
          {
            value: 'response',
            label: 'Response form',
            content: <ResponseFormPanel t={t} csrf={csrf} roles={roles} />,
          },
          {
            value: 'bids',
            label: `Bids (${t.submissions.count})`,
            content: (
              <>
                <OpeningPanel t={t} csrf={csrf} roles={roles} onDone={refresh} />
                <Card role="region" aria-labelledby="bids-h">
                  <h2 id="bids-h" className="font-heading text-xl font-bold">
                    Bids
                  </h2>
                  {t.submissions.sealed ? (
                    <p
                      className="mt-2 flex items-start gap-2 text-sm text-text-muted"
                      data-testid="bids-sealed"
                    >
                      <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                      {t.submissions.count} bid(s) received. Who bid, and what they sent, stays sealed until
                      the tender closes. Nobody, including administrators, can open it before then.
                    </p>
                  ) : (
                    <ul className="mt-3 flex flex-col gap-2" aria-label="Bids received">
                      {(t.submissions.items ?? []).length === 0 && (
                        <li className="text-sm text-text-muted">No bids were received.</li>
                      )}
                      {(t.submissions.items ?? []).map((b) => (
                        <li
                          key={b.supplierId}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                        >
                          <span className="font-semibold">{b.company}</span>
                          <span className="flex gap-1">
                            {b.sanctionsStatus === 'MATCH' && <Badge tone="error">Screening match</Badge>}
                            {b.insuranceStatus && b.insuranceStatus !== 'CURRENT' && (
                              <Badge tone={b.insuranceStatus === 'EXPIRED' ? 'error' : 'warning'}>
                                Insurance {b.insuranceStatus.toLowerCase()}
                              </Badge>
                            )}
                          </span>
                          <span className="font-mono text-xs">{b.receipt}</span>
                          <span className="text-text-muted">{formatDateTime(b.submittedAt)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </>
            ),
          },
        ]}
      />
    </div>
  );
}

function PackSection({
  tenderId,
  field,
  canEdit,
  csrf,
  onSaved,
}: {
  tenderId: string;
  field: TenderView['fields'][number];
  canEdit: boolean;
  csrf: string;
  onSaved: (t: TenderView) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(field.value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await api<TenderView>(`/tenders/${tenderId}/fields/${field.key}`, {
          method: 'PUT',
          csrf,
          body: { value: text, expectedRev: field.rev ?? 0 },
        }),
      );
      setEditing(false);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="p-5" data-testid={`pack-${field.key}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-heading text-lg font-bold">{field.label}</h3>
        {canEdit && !editing && (
          <Button
            variant="secondary"
            onClick={() => {
              setText(field.value);
              setEditing(true);
            }}
            aria-label={`Edit ${field.label}`}
          >
            Edit
          </Button>
        )}
      </div>
      {editing ? (
        <div className="mt-3 flex flex-col gap-3">
          <Field label={`${field.label} text`}>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} maxLength={10000} />
          </Field>
          {error && (
            <p role="alert" className="text-sm font-medium text-error">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button loading={busy} onClick={() => void save()}>
              Save
            </Button>
            <Button variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-2 text-sm">
          {field.paragraphs.map((p, i) => (
            <p key={i} className="whitespace-pre-wrap">
              {p}
            </p>
          ))}
        </div>
      )}
    </Card>
  );
}

function InvitePanel({ t, csrf, onDone }: { t: TenderView; csrf: string; onDone: () => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [links, setLinks] = useState<Array<{ email: string; company: string; url: string }>>([]);
  async function invite() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ invitations: Array<{ email: string; company: string; registerPath: string }> }>(
        `/tenders/${t.id}/invitations`,
        { method: 'POST', csrf, body: { invitees: [{ email, company }] } },
      );
      setLinks((l) => [
        ...r.invitations.map((i) => ({
          email: i.email,
          company: i.company,
          url: `${window.location.origin}${i.registerPath}`,
        })),
        ...l,
      ]);
      setEmail('');
      setCompany('');
      await onDone();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card role="region" aria-labelledby="inv-h">
      <h2 id="inv-h" className="font-heading text-xl font-bold">
        Supplier invitations
      </h2>
      <p className="mt-1 text-sm text-text-muted">
        {t.access === 'OPEN'
          ? 'This tender is open access: any registered supplier can see it. You can still invite specific suppliers.'
          : 'Only suppliers you invite can see this tender once it is published.'}
      </p>
      {t.permissions.canInvite && (
        <form
          className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          aria-label="Invite a supplier"
          onSubmit={(e) => {
            e.preventDefault();
            void invite();
          }}
        >
          <Field label="Contact email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Company">
            <Input value={company} onChange={(e) => setCompany(e.target.value)} required minLength={2} />
          </Field>
          <Button type="submit" loading={busy}>
            <Send className="size-4" aria-hidden="true" />
            Invite
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-error">
          {error}
        </p>
      )}
      {links.length > 0 && (
        <div
          className="mt-3 flex flex-col gap-2 rounded-md border border-border bg-surface-alt p-3"
          data-testid="invite-links"
        >
          <p className="text-sm font-semibold">
            Email is simulated in this proof of concept. Copy each link and send it yourself; it is shown only
            now.
          </p>
          {links.map((l) => (
            <div key={l.url} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold">{l.company}</span>
              <code className="min-w-0 flex-1 break-all text-xs" data-testid="invite-link">
                {l.url}
              </code>
              <Button
                variant="secondary"
                aria-label={`Copy link for ${l.company}`}
                onClick={() => void navigator.clipboard?.writeText(l.url)}
              >
                <Copy className="size-4" aria-hidden="true" />
                Copy
              </Button>
            </div>
          ))}
        </div>
      )}
      <ul className="mt-3 flex flex-col gap-2" aria-label="Invited suppliers">
        {t.invitations.length === 0 && (
          <li className="text-sm text-text-muted">Nobody has been invited yet.</li>
        )}
        {t.invitations.map((i) => (
          <li
            key={i.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
          >
            <span>
              <span className="font-semibold">{i.company}</span> · {i.email}
            </span>
            <Badge tone={i.state === 'REGISTERED' ? 'success' : i.state === 'EXPIRED' ? 'error' : 'neutral'}>
              {i.state === 'REGISTERED' ? 'Registered' : i.state === 'EXPIRED' ? 'Expired' : 'Invited'}
            </Badge>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function QaPanel({ t, csrf, onDone }: { t: TenderView; csrf: string; onDone: () => Promise<void> }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [audiences, setAudiences] = useState<Record<string, 'ALL' | 'SINGLE'>>({});
  const [picked, setPicked] = useState<string[]>([]);
  const [summary, setSummary] = useState('');
  const [newClose, setNewClose] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function go(name: string, fn: () => Promise<void>) {
    setBusy(name);
    setError(null);
    try {
      await fn();
      await onDone();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }
  const ready = t.questions.filter((q) => q.status === 'ANSWERED');
  return (
    <Card role="region" aria-labelledby="qa-h">
      <h2 id="qa-h" className="font-heading text-xl font-bold">
        Questions and addenda
      </h2>
      <p className="mt-1 text-sm text-text-muted">
        Questions are shown here without saying who asked. Answers reach every supplier at the same time, as
        an addendum.
      </p>
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-error">
          {error}
        </p>
      )}
      <ul className="mt-3 flex flex-col gap-3" aria-label="Questions">
        {t.questions.length === 0 && <li className="text-sm text-text-muted">No questions yet.</li>}
        {t.questions.map((q) => (
          <li
            key={q.id}
            className="rounded-md border border-border p-3"
            data-testid="question"
            data-status={q.status}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">{q.text}</p>
              <Badge
                tone={q.status === 'PUBLISHED' ? 'success' : q.status === 'ANSWERED' ? 'info' : 'warning'}
              >
                {q.status === 'PUBLISHED'
                  ? 'Published'
                  : q.status === 'ANSWERED'
                    ? 'Answered, not yet published'
                    : 'Needs an answer'}
              </Badge>
            </div>
            {q.status === 'PUBLISHED' && (
              <p className="mt-2 text-sm">
                {q.answer}
                {q.audience === 'SINGLE' && (
                  <span className="ml-2 text-xs text-text-muted">(sent to the asker only)</span>
                )}
              </p>
            )}
            {q.status !== 'PUBLISHED' && t.permissions.canAnswer && (
              <form
                className="mt-2 flex flex-col gap-2"
                aria-label={`Answer: ${q.text}`}
                onSubmit={(e) => {
                  e.preventDefault();
                  void go(`ans-${q.id}`, async () => {
                    await api(`/tenders/${t.id}/questions/${q.id}/answer`, {
                      method: 'POST',
                      csrf,
                      body: { answer: answers[q.id] ?? q.answer ?? '', audience: audiences[q.id] ?? 'ALL' },
                    });
                  });
                }}
              >
                <Field label="Answer">
                  <Textarea
                    rows={3}
                    value={answers[q.id] ?? q.answer ?? ''}
                    onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                    maxLength={4000}
                  />
                </Field>
                <Field label="Who should get this answer?">
                  <Select
                    value={audiences[q.id] ?? 'ALL'}
                    onChange={(e) =>
                      setAudiences((a) => ({ ...a, [q.id]: e.target.value as 'ALL' | 'SINGLE' }))
                    }
                  >
                    <option value="ALL">Everyone, published with the next addendum</option>
                    <option value="SINGLE">Only the supplier who asked, sent now</option>
                  </Select>
                </Field>
                <div>
                  <Button type="submit" variant="secondary" loading={busy === `ans-${q.id}`}>
                    Save answer
                  </Button>
                </div>
              </form>
            )}
          </li>
        ))}
      </ul>

      {t.permissions.canIssueAddendum && (
        <form
          className="mt-4 flex flex-col gap-3 rounded-md bg-surface-alt p-4"
          aria-label="Issue an addendum"
          onSubmit={(e) => {
            e.preventDefault();
            void go('addendum', async () => {
              await api(`/tenders/${t.id}/addenda`, {
                method: 'POST',
                csrf,
                body: {
                  summary,
                  questionIds: picked,
                  ...(newClose ? { newClosesAt: new Date(newClose).toISOString() } : {}),
                },
              });
              setPicked([]);
              setSummary('');
              setNewClose('');
            });
          }}
        >
          <h3 className="font-heading text-lg font-bold">Issue an addendum to all suppliers</h3>
          {ready.length > 0 && (
            <fieldset className="flex flex-col gap-1">
              <legend className="text-sm font-semibold">Include these answered questions</legend>
              {ready.map((q) => (
                <label key={q.id} className="flex min-h-[44px] items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="size-5 accent-[var(--if-color-accent)]"
                    checked={picked.includes(q.id)}
                    onChange={(e) =>
                      setPicked((p) => (e.target.checked ? [...p, q.id] : p.filter((x) => x !== q.id)))
                    }
                  />
                  {q.text}
                </label>
              ))}
            </fieldset>
          )}
          <Field label="Summary for suppliers">
            <Textarea
              rows={3}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              minLength={5}
              maxLength={2000}
              required
            />
          </Field>
          <Field
            label="Extend the closing time (optional)"
            hint="An addendum can only move the closing time later."
          >
            <Input type="datetime-local" value={newClose} onChange={(e) => setNewClose(e.target.value)} />
          </Field>
          <div>
            <Button type="submit" loading={busy === 'addendum'}>
              Issue addendum
            </Button>
          </div>
        </form>
      )}

      <ul className="mt-4 flex flex-col gap-2" aria-label="Addenda issued">
        {t.addenda.map((a) => (
          <li key={a.id} className="rounded-md border border-border px-3 py-2 text-sm" data-testid="addendum">
            <span className="font-semibold">Addendum {a.number}</span> · {formatDateTime(a.issuedAt)}
            <p>{a.summary}</p>
            {a.newClosesAt && (
              <p className="text-text-muted">New closing time: {formatDateTime(a.newClosesAt)}</p>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
