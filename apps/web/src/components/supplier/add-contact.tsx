'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Dialog, Field, Input } from '@if/ui';
import { ApiError, api } from '@/lib/api-client';

/** The buyer adds a checked colleague of an existing supplier; the one-time link is shown once, to pass on. */
export function AddContact({
  supplierId,
  company,
  csrf,
}: {
  supplierId: string;
  company: string;
  csrf: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ activationPath: string }>(`/suppliers/${supplierId}/contacts`, {
        method: 'POST',
        csrf,
        body: { name, email },
      });
      setLink(`${window.location.origin}${r.activationPath}`);
      router.refresh();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? [e.message, ...(e.problem.errors ?? []).map((x) => x.message)].join(' ')
          : 'Something went wrong. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }
  function close(o: boolean) {
    setOpen(o);
    if (!o) {
      setName('');
      setEmail('');
      setLink(null);
      setError(null);
    }
  }
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Add a contact
      </Button>
      <Dialog
        open={open}
        onOpenChange={close}
        title={`Add a contact at ${company}`}
        description="Only add people you have checked. They set their own password with a one-time link that lasts 7 days."
        footer={
          link ? (
            <Button onClick={() => close(false)}>Done</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button
                loading={busy}
                disabled={name.trim().length < 2 || !email.includes('@')}
                onClick={() => void add()}
              >
                Add contact
              </Button>
            </>
          )
        }
      >
        {link ? (
          <div className="flex flex-col gap-2" data-testid="activation-link">
            <p className="text-sm font-semibold">Send this link to {name}. It is shown only now.</p>
            <input
              readOnly
              aria-label="Activation link"
              value={link}
              className="w-full rounded-md border border-border-strong bg-surface-alt p-2 font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
            />
            <p className="text-xs text-text-muted">
              The proof of concept sends no email, so pass the link on yourself.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Field label="Name" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Work email" required>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
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
