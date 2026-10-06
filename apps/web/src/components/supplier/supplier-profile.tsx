'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge, Button, Card, Field, Input } from '@if/ui';
import { ApiError, api } from '@/lib/api-client';
import { CertificateUploader, EsgCard, RateEnterpriseCard } from './b8-cards';

export interface SupplierSelfProfile {
  id: string;
  company: string;
  abn: string;
  sanctionsStatus: string;
  onHold: boolean;
  insuranceStatus: 'UNKNOWN' | 'CURRENT' | 'EXPIRING' | 'EXPIRED';
  insurance: { insurer: string; policyNumber: string; coverAud: number; expiresOn: string } | null;
  privacy: { shareProfile: boolean; productUpdates: boolean };
  onboarding: { answers?: Record<string, string>; flagged?: string[] };
  contacts: Array<{ id: string; name: string; email: string; active: boolean }>;
}

const INSURANCE_TONE = {
  UNKNOWN: 'neutral',
  CURRENT: 'success',
  EXPIRING: 'warning',
  EXPIRED: 'error',
} as const;
const INSURANCE_LABEL = {
  UNKNOWN: 'Not recorded',
  CURRENT: 'Current',
  EXPIRING: 'Expiring soon',
  EXPIRED: 'Expired',
} as const;
const message = (e: unknown) =>
  e instanceof ApiError
    ? [e.message, ...(e.problem.errors ?? []).map((x) => x.message)]
        .filter((x, i, a) => a.indexOf(x) === i)
        .join(' ')
    : 'Something went wrong. Please try again.';

/** The supplier's own company profile: screening and insurance status, privacy, and who can sign in (FR-0240, FR-0245, FR-0250). */
export function SupplierProfile({
  initial,
  csrf,
  meId,
}: {
  initial: SupplierSelfProfile;
  csrf: string;
  meId: string;
}) {
  const router = useRouter();
  const [p, setP] = useState(initial);
  const [ins, setIns] = useState({
    insurer: initial.insurance?.insurer ?? '',
    policyNumber: initial.insurance?.policyNumber ?? '',
    coverAud: String(initial.insurance?.coverAud ?? ''),
    expiresOn: initial.insurance?.expiresOn ?? '',
  });
  const [contact, setContact] = useState({ name: '', email: '' });
  const [link, setLink] = useState<string | null>(null);
  const [reason, setReason] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function run(name: string, fn: () => Promise<string | void>) {
    setBusy(name);
    setError(null);
    setNote(null);
    try {
      const n = await fn();
      if (n) setNote(n);
      setP(await api<SupplierSelfProfile>('/supplier/profile'));
      router.refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-6" data-testid="supplier-profile">
      {p.onHold && (
        <p
          role="alert"
          className="rounded-md border border-warning bg-warning-bg p-4 text-sm font-medium text-warning"
          data-testid="hold-banner"
        >
          Your account is on hold while a screening result is reviewed by the buyer. You cannot see tender
          documents until it is released.
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
      {error && (
        <p
          role="alert"
          className="rounded-md border border-error bg-error-bg p-3 text-sm font-medium text-error"
        >
          {error}
        </p>
      )}

      <Card role="region" aria-labelledby="status-h">
        <h2 id="status-h" className="font-heading text-xl font-bold">
          {p.company}
        </h2>
        <p className="font-mono text-sm text-text-muted">ABN {p.abn}</p>
        <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          Screening:{' '}
          <Badge
            tone={
              p.sanctionsStatus === 'CLEAR' ? 'success' : p.sanctionsStatus === 'MATCH' ? 'error' : 'warning'
            }
          >
            {p.sanctionsStatus === 'CLEAR' ? 'Clear' : p.sanctionsStatus === 'MATCH' ? 'On hold' : 'Pending'}
          </Badge>
          Insurance:{' '}
          <Badge tone={INSURANCE_TONE[p.insuranceStatus]}>{INSURANCE_LABEL[p.insuranceStatus]}</Badge>
        </p>
        <p className="mt-1 text-xs text-text-muted">
          Both are shared with the buyer&apos;s onboarding checks for every tender you respond to.
        </p>
      </Card>

      <Card role="region" aria-labelledby="ins-h" data-testid="insurance-card">
        <h2 id="ins-h" className="font-heading text-xl font-bold">
          Insurance certificate
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Insurer">
            <Input value={ins.insurer} onChange={(e) => setIns({ ...ins, insurer: e.target.value })} />
          </Field>
          <Field label="Policy number">
            <Input
              value={ins.policyNumber}
              onChange={(e) => setIns({ ...ins, policyNumber: e.target.value })}
            />
          </Field>
          <Field label="Cover (AUD)">
            <Input
              type="number"
              min={0}
              value={ins.coverAud}
              onChange={(e) => setIns({ ...ins, coverAud: e.target.value })}
            />
          </Field>
          <Field label="Valid until">
            <Input
              type="date"
              value={ins.expiresOn}
              onChange={(e) => setIns({ ...ins, expiresOn: e.target.value })}
            />
          </Field>
        </div>
        <div className="mt-3">
          <Button
            variant="secondary"
            loading={busy === 'ins'}
            disabled={!ins.insurer.trim() || !ins.policyNumber.trim() || !ins.expiresOn}
            onClick={() =>
              void run('ins', async () => {
                await api('/supplier/profile/insurance', {
                  method: 'PUT',
                  csrf,
                  body: {
                    insurer: ins.insurer,
                    policyNumber: ins.policyNumber,
                    coverAud: Number(ins.coverAud || 0),
                    expiresOn: ins.expiresOn,
                  },
                });
                return 'Insurance recorded.';
              })
            }
          >
            Record the certificate
          </Button>
        </div>
        <div className="mt-4 border-t border-border pt-4">
          <CertificateUploader csrf={csrf} onDone={() => router.refresh()} />
        </div>
      </Card>

      <BankCard csrf={csrf} />
      <EsgCard csrf={csrf} />
      <RateEnterpriseCard csrf={csrf} />

      <Card role="region" aria-labelledby="priv-h" data-testid="privacy-card">
        <h2 id="priv-h" className="font-heading text-xl font-bold">
          Privacy
        </h2>
        {(
          [
            ['shareProfile', 'Let buyers at the organisations you respond to see my company profile'],
            ['productUpdates', 'Send me product updates by email'],
          ] as const
        ).map(([key, text]) => (
          <label key={key} className="flex min-h-[44px] items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="size-5 accent-[var(--if-color-accent)]"
              checked={p.privacy[key]}
              onChange={(e) =>
                void run('priv', async () => {
                  await api('/supplier/profile/privacy', {
                    method: 'PUT',
                    csrf,
                    body: { ...p.privacy, [key]: e.target.checked },
                  });
                  return 'Privacy choice saved.';
                })
              }
            />
            {text}
          </label>
        ))}
      </Card>

      <Card role="region" aria-labelledby="contacts-h" data-testid="supplier-contacts">
        <h2 id="contacts-h" className="font-heading text-xl font-bold">
          People who can sign in for {p.company}
        </h2>
        <ul className="mt-3 flex flex-col gap-3" aria-label="Contacts">
          {p.contacts.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-end justify-between gap-2 text-sm"
              data-testid="contact-row"
            >
              <span>
                <span className="font-semibold">{c.name}</span>
                {c.id === meId && <span className="ml-2 text-xs text-text-muted">(you)</span>}
                <span className="block text-text-muted">{c.email}</span>
              </span>
              {!c.active ? (
                <Badge tone="neutral">No access</Badge>
              ) : c.id !== meId ? (
                <span className="flex flex-wrap items-end gap-2">
                  <Field label={`Reason to remove ${c.name}`}>
                    <Input
                      value={reason[c.id] ?? ''}
                      onChange={(e) => setReason({ ...reason, [c.id]: e.target.value })}
                    />
                  </Field>
                  <Button
                    variant="secondary"
                    aria-label={`Remove ${c.name}`}
                    loading={busy === `rm-${c.id}`}
                    disabled={(reason[c.id] ?? '').trim().length < 3}
                    onClick={() =>
                      void run(`rm-${c.id}`, async () => {
                        await api(`/supplier/contacts/${c.id}/deprovision`, {
                          method: 'POST',
                          csrf,
                          body: { reason: reason[c.id] },
                        });
                        return `${c.name} no longer has access.`;
                      })
                    }
                  >
                    Remove access
                  </Button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
          <Field label="Add a colleague: name">
            <Input value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} />
          </Field>
          <Field label="Add a colleague: email">
            <Input
              type="email"
              value={contact.email}
              onChange={(e) => setContact({ ...contact, email: e.target.value })}
            />
          </Field>
          <div className="sm:col-span-2">
            <Button
              variant="secondary"
              loading={busy === 'add'}
              disabled={contact.name.trim().length < 2 || !contact.email.includes('@')}
              onClick={() =>
                void run('add', async () => {
                  const r = await api<{ activationPath: string }>('/supplier/contacts', {
                    method: 'POST',
                    csrf,
                    body: contact,
                  });
                  setLink(`${window.location.origin}${r.activationPath}`);
                  setContact({ name: '', email: '' });
                  return 'Your colleague was added and told.';
                })
              }
            >
              Add colleague
            </Button>
          </div>
        </div>
        {link && (
          <div className="mt-3 flex flex-col gap-1" data-testid="contact-link">
            <p className="text-sm font-semibold">
              Pass this one-time link to your colleague so they can choose a password. It is shown only now.
            </p>
            <input
              readOnly
              aria-label="Activation link"
              value={link}
              className="w-full rounded-md border border-border-strong bg-surface-alt p-2 font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
            />
          </div>
        )}
      </Card>
    </div>
  );
}

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
        The account name must match your company&apos;s legal name. The buyer checks this before a contract is
        signed. Only the last three digits are ever shown back to you.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Field label="BSB">
          <Input value={f.bsb} onChange={(e) => setF({ ...f, bsb: e.target.value })} placeholder="062-000" />
        </Field>
        <Field label="Account number">
          <Input
            value={f.account}
            onChange={(e) => setF({ ...f, account: e.target.value })}
            inputMode="numeric"
          />
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
        <Button
          variant="secondary"
          loading={busy}
          disabled={!f.bsb || !f.account || !f.accountName}
          onClick={() => void save()}
        >
          Save banking details
        </Button>
      </div>
    </Card>
  );
}
