'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button, Field, Input } from '@if/ui';
import { ApiError, api } from '@/lib/api-client';

export function RegisterForm({
  token,
  email: e0,
  company: c0,
}: {
  token?: string | undefined;
  email?: string;
  company?: string;
}) {
  const [ready, setReady] = useState(false); // forms submitted before hydration would reload the page natively
  useEffect(() => setReady(true), []);
  const [name, setName] = useState('');
  const [email, setEmail] = useState(e0 ?? '');
  const [company, setCompany] = useState(c0 ?? '');
  const [abn, setAbn] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await api('/supplier/register', {
        method: 'POST',
        body: { ...(token ? { token } : {}), name, email, company, abn, password },
      });
      setDone(true);
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        setFields(Object.fromEntries((e.problem.errors ?? []).map((x) => [x.field, x.message])));
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
        data-testid="registered"
      >
        <p className="font-bold">You are registered.</p>
        <p className="mt-1 text-sm">
          <Link href="/login">Sign in</Link> with your email and the password you just chose. You will land in
          the supplier portal.
        </p>
      </div>
    );

  return (
    <form
      className="flex flex-col gap-4"
      aria-label="Supplier registration"
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
      <Field label="Your name" required error={fields.name ?? ''}>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          minLength={2}
          maxLength={120}
        />
      </Field>
      <Field label="Work email" required error={fields.email ?? ''}>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      </Field>
      <Field label="Company name" required error={fields.company ?? ''}>
        <Input
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          autoComplete="organization"
          minLength={2}
          maxLength={200}
        />
      </Field>
      <Field
        label="ABN"
        required
        hint="11 digits. It is checked against the official ABN checksum."
        error={fields.abn ?? ''}
      >
        <Input value={abn} onChange={(e) => setAbn(e.target.value)} inputMode="numeric" maxLength={14} />
      </Field>
      <Field
        label="Password"
        required
        hint="At least 12 characters, with letters and numbers."
        error={fields.password ?? ''}
      >
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={12}
        />
      </Field>
      <Button type="submit" loading={busy} disabled={!ready}>
        Create account
      </Button>
    </form>
  );
}
