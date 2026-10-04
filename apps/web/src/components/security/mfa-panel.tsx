'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge, Button, Card, Field, Input } from '@if/ui';
import { ApiError, api } from '@/lib/api-client';

export interface MfaStatus {
  enrolled: boolean;
  pending: boolean;
  required: boolean;
  method?: string;
}

const message = (e: unknown) =>
  e instanceof ApiError ? e.message : 'Something went wrong. Please try again.';

/** Set up, or remove, the authenticator app for this account (SEC-A01). Used on its own page and as the sign-in gate. */
export function MfaPanel({
  status,
  csrf,
  gate = false,
}: {
  status: MfaStatus;
  csrf: string;
  gate?: boolean;
}) {
  const router = useRouter();
  const [secret, setSecret] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card role="region" aria-labelledby="mfa-h" data-testid="mfa-panel">
      <h2 id="mfa-h" className="font-heading text-xl font-bold">
        {gate ? 'Set up your authenticator app to continue' : 'Authenticator app'}
      </h2>
      <p className="mt-1 max-w-prose text-sm text-text-muted">
        {gate
          ? 'Your organisation requires a second step at sign-in. Until you finish this, nothing else in the portal is available.'
          : 'A one-time code from an app on your phone adds a second step at sign-in.'}
      </p>
      <p className="mt-2 text-sm">
        Status:{' '}
        {status.enrolled ? <Badge tone="success">Set up</Badge> : <Badge tone="warning">Not set up</Badge>}
        {status.required && <span className="ml-2 text-text-muted">Required by your organisation</span>}
      </p>

      {!status.enrolled && !secret && (
        <div className="mt-4">
          <Button
            loading={busy}
            onClick={() =>
              void run(async () => setSecret(await api('/auth/mfa/enroll', { method: 'POST', csrf })))
            }
          >
            Start set-up
          </Button>
        </div>
      )}

      {!status.enrolled && secret && (
        <div className="mt-4 flex flex-col gap-3">
          <p className="text-sm">
            In your authenticator app choose to enter a setup key, and type this key. It is shown once.
          </p>
          <p
            className="break-all rounded-md bg-surface-alt p-3 font-mono text-lg font-semibold"
            data-testid="mfa-secret"
          >
            {secret.secret}
          </p>
          <Field label="6-digit code from the app">
            <Input
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
          </Field>
          <div>
            <Button
              loading={busy}
              disabled={code.length !== 6}
              onClick={() =>
                void run(async () => {
                  await api('/auth/mfa/confirm', { method: 'POST', csrf, body: { code } });
                  setNote('Your authenticator app is set up.');
                  router.refresh();
                })
              }
            >
              Confirm
            </Button>
          </div>
        </div>
      )}

      {status.enrolled && !status.required && (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <Field label="Current code, to remove the app">
            <Input
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
          </Field>
          <Button
            variant="secondary"
            loading={busy}
            disabled={code.length !== 6}
            onClick={() =>
              void run(async () => {
                await api('/auth/mfa', { method: 'DELETE', csrf, body: { code } });
                setCode('');
                setNote('The authenticator app was removed.');
                router.refresh();
              })
            }
          >
            Remove
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-error">
          {error}
        </p>
      )}
      {note && (
        <p role="status" className="mt-3 text-sm font-medium text-success">
          {note}
        </p>
      )}
    </Card>
  );
}
