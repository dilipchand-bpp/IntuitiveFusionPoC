'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Dialog, Field, Input } from '@if/ui';
import { ApiError, api } from '@/lib/api-client';

const message = (e: unknown) =>
  e instanceof ApiError
    ? [e.message, ...(e.problem.errors ?? []).map((x) => x.message)].join(' ')
    : 'Something went wrong. Please try again.';

/** A contact has left (SEC-A06): switch them off, or hand over to someone else in one step. */
export function ContactActions({
  supplierId,
  contact,
  csrf,
}: {
  supplierId: string;
  contact: { id: string; name: string };
  csrf: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<null | 'remove' | 'replace'>(null);
  const [reason, setReason] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  const close = () => {
    setMode(null);
    setReason('');
    setName('');
    setEmail('');
    setError(null);
    setLink(null);
  };
  async function go() {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'remove') {
        await api(`/suppliers/${supplierId}/contacts/${contact.id}/deprovision`, {
          method: 'POST',
          csrf,
          body: { reason },
        });
        close();
      } else {
        const r = await api<{ activationPath: string }>(
          `/suppliers/${supplierId}/contacts/${contact.id}/reassign`,
          {
            method: 'POST',
            csrf,
            body: { name, email, reason },
          },
        );
        setLink(`${window.location.origin}${r.activationPath}`);
      }
      router.refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <span className="flex gap-1">
        <Button
          variant="ghost"
          aria-label={`Remove access for ${contact.name}`}
          onClick={() => setMode('remove')}
        >
          Remove access
        </Button>
        <Button variant="ghost" aria-label={`Replace ${contact.name}`} onClick={() => setMode('replace')}>
          Replace
        </Button>
      </span>
      <Dialog
        open={mode !== null}
        onOpenChange={(o) => !o && close()}
        title={mode === 'remove' ? `Remove access for ${contact.name}` : `Replace ${contact.name}`}
        description={
          mode === 'remove'
            ? 'They can no longer sign in, any open link stops working and their sessions end.'
            : 'Their access ends and the new person gets their own one-time link, shown once.'
        }
        footer={
          link ? (
            <Button onClick={close}>Done</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={close}>
                Cancel
              </Button>
              <Button
                loading={busy}
                disabled={
                  reason.trim().length < 3 ||
                  (mode === 'replace' && (name.trim().length < 2 || !email.includes('@')))
                }
                onClick={() => void go()}
              >
                {mode === 'remove' ? 'Remove access' : 'Replace'}
              </Button>
            </>
          )
        }
      >
        {link ? (
          <div className="flex flex-col gap-2" data-testid="reassign-link">
            <p className="text-sm font-semibold">Send this link to {name}. It is shown only now.</p>
            <input
              readOnly
              aria-label="Activation link"
              value={link}
              className="w-full rounded-md border border-border-strong bg-surface-alt p-2 font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Field label="Why is this changing?" required>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            {mode === 'replace' && (
              <>
                <Field label="New contact's name" required>
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label="New contact's email" required>
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </Field>
              </>
            )}
            {error && (
              <p role="alert" className="text-sm font-medium text-error">
                {error}
              </p>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}
