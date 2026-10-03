'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button, Field, Input } from '@if/ui';
import { ApiError, api } from '@/lib/api-client';

export function ActivateForm({ token, name, email }: { token: string; name: string; email: string }) {
  const [ready, setReady] = useState(false); // a form submitted before hydration would reload the page natively
  useEffect(() => setReady(true), []);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState('');
  const [done, setDone] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    setFieldError('');
    try {
      await api('/supplier/activate', { method: 'POST', body: { token, password } });
      setDone(true);
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        setFieldError(e.problem.errors?.find((x) => x.field === 'password')?.message ?? '');
      } else setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <div
        role="status"
        className="rounded-md border border-success bg-success-bg p-4 text-success"
        data-testid="activated"
      >
        <p className="font-bold">Your account is ready.</p>
        <p className="mt-1 text-sm">
          <Link href="/login">Sign in</Link> with {email} and the password you just chose.
        </p>
      </div>
    );
  return (
    <form
      className="flex flex-col gap-4"
      aria-label="Activate account"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) void submit();
      }}
    >
      {error && (
        <p
          role="alert"
          className="rounded-md border border-error bg-error-bg p-3 text-sm font-medium text-error"
        >
          {error}
        </p>
      )}
      <p className="text-sm">
        <span className="font-semibold">{name}</span> · {email}
      </p>
      <Field
        label="Choose a password"
        required
        hint="At least 12 characters, with letters and numbers."
        error={fieldError}
      >
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={12}
        />
      </Field>
      <Button type="submit" loading={busy} disabled={password.length < 12}>
        Activate account
      </Button>
    </form>
  );
}
