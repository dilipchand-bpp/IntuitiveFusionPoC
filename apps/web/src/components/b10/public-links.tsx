'use client';
import Link from 'next/link';
import { useState } from 'react';
import { AiBadge, Badge, Button, Card, Field, Textarea } from '@if/ui';
import { api } from '@/lib/api-client';
import { PublicFrame } from '@/components/b8/public-pages';
import { message, useData, useRun } from '@/components/contract/b5-shared';

// ------------------------------------------------------------------ continuity response link (FR-0860, no sign-in)
interface Respond {
  organisation: string;
  number: string;
  title: string;
  kindLabel: string;
  severity: string;
  message: string;
  recipient: string;
  closed: boolean;
  response: string | null;
  note: string | null;
  changeCount: number;
  expiresAt: string;
}
const CHOICES = [
  { key: 'SAFE', label: 'I am safe' },
  { key: 'AFFECTED', label: 'I am affected' },
  { key: 'NEED_HELP', label: 'I need help' },
] as const;

export function RespondLink({ token }: { token: string }) {
  const path = `/respond-links/${encodeURIComponent(token)}`;
  const { data, error, reload } = useData<Respond>(path);
  const [note, setNote] = useState('');
  const { busy, run, messages } = useRun();
  return (
    <PublicFrame title="Are you safe?">
      {error && (
        <Card>
          <p role="alert" className="font-medium text-error" data-testid="respond-error">
            {error}
          </p>
        </Card>
      )}
      {data && (
        <Card data-testid="respond-card">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-heading text-xl font-bold">
              {data.number}: {data.title}
            </h2>
            <Badge tone={data.severity === 'CRITICAL' || data.severity === 'HIGH' ? 'error' : 'warning'}>
              {data.severity.toLowerCase()}
            </Badge>
            <AiBadge kind="simulated" />
          </div>
          <p className="mt-1 text-sm text-text-muted">
            {data.kindLabel} · from {data.organisation} · for {data.recipient}
          </p>
          <p className="mt-3 max-w-prose">{data.message}</p>
          {data.closed ? (
            <p role="status" className="mt-4 font-medium" data-testid="respond-closed">
              This event is closed, so answers can no longer be changed.
              {data.response ? ` Your last answer was recorded.` : ''}
            </p>
          ) : (
            <>
              <p className="mt-4 text-sm text-text-muted">
                Tell us how you are. You can change your answer until the event is closed.
              </p>
              <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Your answer">
                {CHOICES.map((c) => (
                  <Button
                    key={c.key}
                    variant={data.response === c.key ? 'primary' : 'secondary'}
                    loading={busy === c.key}
                    aria-pressed={data.response === c.key}
                    data-testid={`respond-${c.key}`}
                    onClick={() =>
                      void run(
                        c.key,
                        async () => {
                          await api(path, {
                            method: 'POST',
                            body: { response: c.key, ...(note.trim() ? { note: note.trim() } : {}) },
                          });
                          await reload();
                        },
                        'Thank you. Your answer is recorded.',
                      )
                    }
                  >
                    {c.label}
                  </Button>
                ))}
              </div>
              <div className="mt-3 max-w-md">
                <Field label="A note (optional)">
                  <Textarea rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
                </Field>
              </div>
              {data.response && (
                <p className="mt-2 text-sm" data-testid="respond-current">
                  Your current answer: <strong>{CHOICES.find((c) => c.key === data.response)?.label}</strong>
                </p>
              )}
              {messages}
            </>
          )}
        </Card>
      )}
    </PublicFrame>
  );
}

// ------------------------------------------------------------------ simulated e-signature ceremony (NFR-C04, signed in)
interface Ceremony {
  providerLabel: string;
  externalId: string;
  envelopeStatus: string;
  contract: {
    number: string;
    title: string;
    supplier: string;
    value: number;
    startDate: string | null;
    endDate: string | null;
    clauseCount: number;
    id: string;
  } | null;
  signingMode: string;
  me: { name: string; role: string; status: string };
  others: Array<{ name: string; role: string; status: string }>;
  waitingFor: string | null;
  canSign: boolean;
}
const aud = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });

export function EsignCeremony({ token }: { token: string }) {
  const path = `/esign/${encodeURIComponent(token)}`;
  const { data, error, reload } = useData<Ceremony>(path);
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [fail, setFail] = useState<string | null>(null);
  const { busy, run } = useRun();
  const confirm = (decision: 'SIGN' | 'DECLINE', csrf: string) =>
    run(decision, async () => {
      setFail(null);
      try {
        await api(`${path}/confirm`, {
          method: 'POST',
          csrf,
          body: { decision, ...(decision === 'DECLINE' ? { reason } : {}) },
        });
        setResult(
          decision === 'SIGN'
            ? 'You have signed. The contract record is updated.'
            : 'You declined. The contract is back with legal.',
        );
        await reload();
      } catch (e) {
        setFail(message(e));
      }
    });
  return (
    <PublicFrame title={data ? `${data.providerLabel}: review and sign` : 'Review and sign'}>
      {error && (
        <Card>
          <p role="alert" className="font-medium text-error" data-testid="esign-error">
            {error}
          </p>
          <p className="mt-2 text-sm text-text-muted">
            <Link href="/app/contracts">Open the contract in the portal</Link> to get a new signing link.
          </p>
        </Card>
      )}
      {data && (
        <Card data-testid="esign-card">
          <div className="flex flex-wrap items-center gap-2">
            <AiBadge kind="simulated" />
            <span className="text-sm text-text-muted">
              Simulated {data.providerLabel} signing page · envelope <code>{data.externalId}</code> ·{' '}
              <Badge tone="info">{data.envelopeStatus}</Badge>
            </span>
          </div>
          {data.contract && (
            <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2" data-testid="esign-summary">
              <dt className="text-text-muted">Contract</dt>
              <dd>
                {data.contract.number}: {data.contract.title}
              </dd>
              <dt className="text-text-muted">Supplier</dt>
              <dd>{data.contract.supplier}</dd>
              <dt className="text-text-muted">Value</dt>
              <dd>{aud.format(data.contract.value)}</dd>
              <dt className="text-text-muted">Term</dt>
              <dd>
                {data.contract.startDate ?? '?'} to {data.contract.endDate ?? '?'}
              </dd>
              <dt className="text-text-muted">Clauses</dt>
              <dd>{data.contract.clauseCount}</dd>
              <dt className="text-text-muted">You sign as</dt>
              <dd>
                {data.me.name}, {data.me.role} <Badge tone="neutral">{data.me.status}</Badge>
              </dd>
            </dl>
          )}
          {data.others.length > 0 && (
            <p className="mt-2 text-sm text-text-muted">
              Others: {data.others.map((o) => `${o.name} (${o.status.toLowerCase()})`).join(', ')}
            </p>
          )}
          {data.waitingFor && (
            <p role="status" className="mt-2 text-sm font-medium text-warning">
              Signatures are collected in order: {data.waitingFor} signs first.
            </p>
          )}
          {data.contract && (
            <p className="mt-2 text-sm">
              <Link href={`/app/contracts/${data.contract.id}`}>Read the full contract in the portal</Link>
            </p>
          )}
          {result && (
            <p role="status" className="mt-3 font-medium text-success" data-testid="esign-result">
              {result}
            </p>
          )}
          {fail && (
            <p role="alert" className="mt-3 font-medium text-error" data-testid="esign-fail">
              {fail}
            </p>
          )}
          {data.canSign && !result && (
            <div className="mt-4 flex flex-col gap-3">
              <p className="text-sm text-text-muted">
                Signing is your own confirmation. It is recorded as your signature on the contract and still
                follows your signing authority.
              </p>
              <Csrf>
                {(csrf) => (
                  <div className="flex flex-wrap items-end gap-3">
                    <Button
                      loading={busy === 'SIGN'}
                      onClick={() => void confirm('SIGN', csrf)}
                      data-testid="esign-sign"
                    >
                      Confirm and sign
                    </Button>
                    <div className="min-w-60 flex-1">
                      <Field label="Reason, if you decline">
                        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
                      </Field>
                    </div>
                    <Button
                      variant="secondary"
                      loading={busy === 'DECLINE'}
                      onClick={() => void confirm('DECLINE', csrf)}
                      data-testid="esign-decline"
                    >
                      Decline
                    </Button>
                  </div>
                )}
              </Csrf>
            </div>
          )}
          {!data.canSign && !result && (
            <p className="mt-3 text-sm text-text-muted" data-testid="esign-closed">
              Nothing more to do on this envelope (it is {data.envelopeStatus.toLowerCase()}, or you have
              already acted).
            </p>
          )}
        </Card>
      )}
    </PublicFrame>
  );
}

/** The signed-in person's CSRF token, fetched from the session endpoint for pages outside the app shell. */
function Csrf({ children }: { children: (csrf: string) => React.ReactNode }) {
  const me = useData<{ csrfToken: string }>('/auth/me');
  return me.data ? (
    <>{children(me.data.csrfToken)}</>
  ) : (
    <p className="text-sm text-text-muted">Checking your sign-in…</p>
  );
}
