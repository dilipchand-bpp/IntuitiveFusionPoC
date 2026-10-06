'use client';
import { CheckCircle2, CircleAlert } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { Badge, Button, Card, Field, Input, Logo, ThemeToggle } from '@if/ui';
import { api } from '@/lib/api-client';
import { message, useRun } from '@/components/contract/b5-shared';

/** The frame for pages a person reaches from a link, with no sign-in: a header, one card, no menu. */
export function PublicFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-hero-mesh min-h-screen">
      <header className="flex items-center justify-between p-4">
        <Link href="/" className="text-text no-underline" aria-label="Intuitive Fusion home">
          <Logo withName size={36} />
        </Link>
        <ThemeToggle />
      </header>
      <main id="main" className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pb-16 pt-4">
        <h1 className="text-3xl font-extrabold tracking-tight">{title}</h1>
        {children}
      </main>
    </div>
  );
}

function useLink<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<T>(path)
      .then(setData)
      .catch((e) => setError(message(e)));
  }, [path]);
  return { data, error };
}

// ------------------------------------------------------------------ approve from a link (NFR-U05)
interface Summary {
  kind: string;
  approver: string;
  procurement: { number: string; title: string } | null;
  waiting: boolean;
  value: string | null;
  valueWithheld: boolean;
  checks: Array<{ label: string; ok: boolean; note?: string }>;
  canApprove: boolean;
  stepUpRequired: boolean;
  expiresAt: string;
  openInPortal: string | null;
}

export function ApproveLink({ token }: { token: string }) {
  const { data, error } = useLink<Summary>(`/approval-links/${encodeURIComponent(token)}`);
  const [comment, setComment] = useState('');
  const [code, setCode] = useState('');
  const [done, setDone] = useState<'APPROVE' | 'REJECT' | null>(null);
  const r = useRun();
  const decide = (decision: 'APPROVE' | 'REJECT') =>
    r.run('d', async () => {
      await api(`/approval-links/${encodeURIComponent(token)}/decision`, {
        method: 'POST',
        body: {
          decision,
          ...(comment.trim() ? { comment: comment.trim() } : {}),
          ...(code.trim() ? { code: code.trim() } : {}),
        },
      });
      setDone(decision);
    });
  return (
    <PublicFrame title="Your decision is needed">
      {error && (
        <Card>
          <p role="alert" className="font-medium text-error" data-testid="link-error">
            {error}
          </p>
          <p className="mt-2 text-sm text-text-muted">
            <Link href="/login">Sign in to the portal</Link> to see what is waiting for you.
          </p>
        </Card>
      )}
      {!data && !error && <p className="text-text-muted">Loading…</p>}
      {done && (
        <Card data-testid="link-done">
          <p role="status" className="flex items-center gap-2 text-lg font-bold text-success">
            <CheckCircle2 className="size-5" aria-hidden="true" />
            {done === 'APPROVE' ? 'Approved. Thank you.' : 'Returned with your reason. Thank you.'}
          </p>
          <p className="mt-2 text-sm text-text-muted">
            This link has now been used and no longer works. Your decision is recorded in the audit trail with
            your name.
          </p>
        </Card>
      )}
      {data && !done && (
        <Card data-testid="approve-card">
          <p className="text-sm text-text-muted">
            {data.kind} · for {data.approver}
          </p>
          {data.procurement && (
            <h2 className="mt-1 font-heading text-2xl font-bold">
              <span className="font-mono text-base text-text-muted">{data.procurement.number}</span>{' '}
              {data.procurement.title}
            </h2>
          )}
          <dl className="mt-3 flex flex-wrap gap-6 text-sm">
            <div>
              <dt className="text-text-muted">Value</dt>
              <dd className="font-semibold">{data.value ?? 'Withheld on this page'}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Link works until</dt>
              <dd className="font-semibold">{new Date(data.expiresAt).toLocaleString('en-AU')}</dd>
            </div>
          </dl>
          <h3 className="mt-5 font-heading text-lg font-bold">Checklist</h3>
          <ul className="mt-2 flex flex-col gap-2" data-testid="checklist">
            {data.checks.map((c) => (
              <li key={c.label} className="flex items-start gap-2 text-sm">
                {c.ok ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                ) : (
                  <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                )}
                <span>
                  {c.label}: <strong>{c.ok ? 'Yes' : 'Not yet'}</strong>
                  {c.note ? ` (${c.note})` : ''}
                </span>
              </li>
            ))}
          </ul>
          {!data.waiting && (
            <p role="status" className="mt-4 text-sm font-medium text-warning">
              This is no longer waiting for approval.
            </p>
          )}
          {data.waiting && !data.canApprove && (
            <p role="status" className="mt-4 text-sm font-medium text-warning">
              This is above your approval authority, so you cannot approve it. You can still send it back with
              a reason.
            </p>
          )}
          {data.waiting && (
            <form
              className="mt-4 flex flex-col gap-3"
              aria-label="Your decision"
              onSubmit={(e) => {
                e.preventDefault();
              }}
            >
              <Field label="Comment" hint="Needed if you send it back.">
                <Input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} />
              </Field>
              {data.stepUpRequired && (
                <Field
                  label="Code from your authenticator app"
                  hint="Your organisation asks for this to approve."
                >
                  <Input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    maxLength={8}
                    className="w-40"
                  />
                </Field>
              )}
              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  loading={r.busy === 'd'}
                  disabled={!data.canApprove}
                  onClick={() => void decide('APPROVE')}
                >
                  Approve
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={comment.trim().length < 5}
                  onClick={() => void decide('REJECT')}
                >
                  Send back
                </Button>
              </div>
              {r.messages}
            </form>
          )}
          {data.openInPortal && (
            <p className="mt-4 text-sm">
              Want the whole plan?{' '}
              <Link href={`/login?next=${encodeURIComponent(data.openInPortal)}`}>
                Sign in to read it in full
              </Link>
              .
            </p>
          )}
        </Card>
      )}
    </PublicFrame>
  );
}

// ------------------------------------------------------------------ counsel portal (FR-0830)
interface Page {
  name: string;
  party: string;
  contract: { number: string; title: string | null };
  open: boolean;
  finalVersion: boolean;
  clauses: Array<{ id: string; title: string; text: string; redacted: boolean }>;
  yourRedlines: Array<{ id: string; clauseId: string; proposedText: string; status: string; at: string }>;
  expiresAt: string;
}

export function CounselPortal({ token }: { token: string }) {
  const path = `/counsel/${encodeURIComponent(token)}`;
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [text, setText] = useState('');
  const r = useRun();
  const load = () =>
    api<Page>(path)
      .then(setPage)
      .catch((e) => setError(message(e)));
  useEffect(() => {
    void load();
  }, []);
  const propose = (clauseId: string) =>
    r.run(
      'p',
      async () => {
        await api(`${path}/redlines`, { method: 'POST', body: { clauseId, text } });
        setText('');
        setPick(null);
        await load();
      },
      'Your proposed wording was sent to the legal team.',
    );
  return (
    <PublicFrame title="Contract review">
      {error && (
        <Card>
          <p role="alert" className="font-medium text-error" data-testid="link-error">
            {error}
          </p>
        </Card>
      )}
      {!page && !error && <p className="text-text-muted">Loading…</p>}
      {page && (
        <>
          <Card>
            <p className="text-sm text-text-muted">
              For {page.name} · {page.party === 'SUPPLIER' ? "supplier's legal team" : 'external counsel'}
            </p>
            <h2 className="mt-1 font-heading text-2xl font-bold">
              <span className="font-mono text-base text-text-muted">{page.contract.number}</span>{' '}
              {page.contract.title ?? ''}
            </h2>
            {page.finalVersion ? (
              <p
                role="status"
                className="mt-2 flex items-center gap-2 font-medium text-warning"
                data-testid="final-banner"
              >
                <CircleAlert className="size-4" aria-hidden="true" />
                This version is final and locked. You can read it, but no more changes can be proposed.
              </p>
            ) : (
              <p className="mt-2 text-sm text-text-muted">
                Propose new wording for any clause. Nothing changes until the legal team accepts it, and every
                proposal is recorded with your name.
              </p>
            )}
            <p className="mt-1 text-xs text-text-muted">
              Your link works until {new Date(page.expiresAt).toLocaleString('en-AU')}.
            </p>
          </Card>
          <ol className="flex flex-col gap-3" data-testid="clauses">
            {page.clauses.map((c, i) => {
              const mine = page.yourRedlines.filter((x) => x.clauseId === c.id);
              return (
                <li key={c.id}>
                  <Card>
                    <h3 className="font-heading text-lg font-bold">
                      {i + 1}. {c.title} {c.redacted && <Badge tone="neutral">Redacted</Badge>}
                    </h3>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{c.text}</p>
                    {mine.map((m) => (
                      <p
                        key={m.id}
                        className="mt-2 rounded-md border border-border bg-surface-alt p-2 text-sm"
                      >
                        <Badge
                          tone={
                            m.status === 'ACCEPTED'
                              ? 'success'
                              : m.status === 'REJECTED'
                                ? 'error'
                                : 'neutral'
                          }
                        >
                          {m.status.toLowerCase()}
                        </Badge>{' '}
                        Your proposal: {m.proposedText}
                      </p>
                    ))}
                    {page.open && !c.redacted && pick !== c.id && (
                      <Button
                        className="mt-2"
                        variant="secondary"
                        aria-label={`Propose wording for ${c.title}`}
                        onClick={() => setPick(c.id)}
                      >
                        Propose new wording
                      </Button>
                    )}
                    {pick === c.id && (
                      <form
                        className="mt-3 flex flex-col gap-2"
                        aria-label={`Propose wording for ${c.title}`}
                        onSubmit={(e) => {
                          e.preventDefault();
                          void propose(c.id);
                        }}
                      >
                        <label htmlFor={`w-${c.id}`} className="text-sm font-semibold">
                          New wording
                        </label>
                        <textarea
                          id={`w-${c.id}`}
                          value={text}
                          onChange={(e) => setText(e.target.value)}
                          rows={5}
                          maxLength={8000}
                          className="rounded-md border border-border-strong bg-surface p-2 text-sm"
                        />
                        <div className="flex gap-2">
                          <Button type="submit" loading={r.busy === 'p'} disabled={text.trim().length < 10}>
                            Send proposal
                          </Button>
                          <Button type="button" variant="secondary" onClick={() => setPick(null)}>
                            Cancel
                          </Button>
                        </div>
                      </form>
                    )}
                  </Card>
                </li>
              );
            })}
          </ol>
          {r.messages}
        </>
      )}
    </PublicFrame>
  );
}
