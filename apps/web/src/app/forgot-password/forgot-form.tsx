'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { Button, Field, Input } from '@if/ui';

export function ForgotForm() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false); // submit stays disabled until hydrated
  useEffect(() => setReady(true), []);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Enter a valid email address.');
    setError(undefined);
    setBusy(true);
    try {
      const res = await fetch('/api/v1/auth/forgot-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (res.status === 429) setError('Too many requests. Please wait a few minutes and try again.');
      else setSent(true); // identical outcome whether or not the account exists
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <p
        role="status"
        className="rounded-sm border border-success bg-success-bg p-4 text-sm font-medium text-success"
      >
        If an account exists for that address, a reset link has been sent. (Proof of concept: no email is
        actually sent.)
      </p>
    );
  }
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4" aria-label="Reset password">
      <Field label="Email" error={error} required>
        <Input
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Button type="submit" loading={busy} disabled={!ready}>
        Send reset link
      </Button>
    </form>
  );
}
