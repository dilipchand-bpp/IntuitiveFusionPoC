'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Eye, EyeOff } from 'lucide-react';
import { Button, Field, Input } from '@if/ui';

interface LoginOk {
  user?: { homePath: string };
  mfaRequired?: boolean;
  mfaToken?: string;
}

/** Only same-site relative paths are honoured after login (prevents open redirects). */
function safeNext(next: string | null): string | null {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : null;
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [ready, setReady] = useState(false); // submit stays disabled until hydrated
  useEffect(() => setReady(true), []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) next.email = 'Enter a valid email address.';
    if (password.length < 8) next.password = 'Password must be at least 8 characters.';
    setErrors(next);
    if (next.email || next.password) return;

    setBusy(true);
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        const body = (await res.json()) as LoginOk;
        if (body.mfaRequired && body.mfaToken) {
          setMfaToken(body.mfaToken); // the password was right; a code from the authenticator app comes next
          return;
        }
        router.replace(safeNext(params.get('next')) ?? body.user!.homePath);
        router.refresh();
        return;
      }
      const problem = (await res.json().catch(() => null)) as { code?: string; title?: string } | null;
      setErrors({
        form:
          res.status === 429
            ? 'Too many attempts. Please wait a few minutes and try again.'
            : problem?.code === 'SSO_REQUIRED'
              ? 'Your organisation requires single sign-on. Use the single sign-on button below.'
              : 'Invalid email or password, or the account is temporarily locked.',
      });
    } catch {
      setErrors({ form: 'Could not reach the server. Please try again.' });
    } finally {
      setBusy(false);
    }
  }

  async function finish(path: string, body: unknown, failure: string) {
    setBusy(true);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const ok = (await res.json()) as LoginOk;
        router.replace(safeNext(params.get('next')) ?? ok.user!.homePath);
        router.refresh();
        return;
      }
      setErrors({
        form: res.status === 429 ? 'Too many attempts. Please wait a few minutes and try again.' : failure,
      });
    } catch {
      setErrors({ form: 'Could not reach the server. Please try again.' });
    } finally {
      setBusy(false);
    }
  }

  async function onCode(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    await finish(
      '/api/v1/auth/mfa/verify',
      { mfaToken, code: code.trim() },
      'That code did not work. Check the code in your authenticator app, or sign in again.',
    );
  }

  /** Single sign-on. The identity provider is simulated: it vouches for the person named in the email box. */
  async function onSso() {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setErrors({ email: 'Enter your work email, then choose single sign-on.' });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const nonce = crypto.randomUUID();
      const sim = await fetch('/api/v1/auth/sso/simulate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, nonce }),
      });
      if (!sim.ok) {
        setErrors({ form: 'Single sign-on failed. Check your email address.' });
        return;
      }
      const { idToken } = (await sim.json()) as { idToken: string };
      setBusy(false);
      await finish('/api/v1/auth/sso/callback', { idToken, nonce }, 'Single sign-on failed.');
    } catch {
      setErrors({ form: 'Could not reach the server. Please try again.' });
    } finally {
      setBusy(false);
    }
  }

  if (mfaToken)
    return (
      <form onSubmit={onCode} noValidate className="flex flex-col gap-4" aria-label="Enter your code">
        {errors.form && (
          <p
            role="alert"
            className="rounded-sm border border-error bg-error-bg p-3 text-sm font-medium text-error"
          >
            {errors.form}
          </p>
        )}
        <p className="text-sm text-text-muted">
          Open your authenticator app and enter the 6-digit code for Intuitive Fusion.
        </p>
        <Field label="6-digit code" required>
          <Input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
        </Field>
        <Button type="submit" loading={busy} disabled={code.length !== 6}>
          Verify and sign in
        </Button>
        <button
          type="button"
          className="min-h-[44px] text-sm font-medium text-accent"
          onClick={() => {
            setMfaToken(null);
            setCode('');
            setPassword('');
          }}
        >
          Back to sign in
        </button>
      </form>
    );

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4" aria-label="Sign in">
      {errors.form && (
        <p
          role="alert"
          className="rounded-sm border border-error bg-error-bg p-3 text-sm font-medium text-error"
        >
          {errors.form}
        </p>
      )}
      <Field label="Email" error={errors.email} required>
        <Input
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Field label="Password" error={errors.password} required>
        <Input
          type={show ? 'text' : 'password'}
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <div className="-mt-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-pressed={show}
          className="inline-flex min-h-[44px] items-center gap-2 text-sm font-medium text-accent"
        >
          {show ? (
            <EyeOff className="size-4" aria-hidden="true" />
          ) : (
            <Eye className="size-4" aria-hidden="true" />
          )}
          {show ? 'Hide password' : 'Show password'}
        </button>
        <Link href="/forgot-password" className="text-sm">
          Forgot password?
        </Link>
      </div>
      <Button type="submit" loading={busy} disabled={!ready}>
        Sign in
      </Button>
      <div className="flex items-center gap-3 text-xs text-text-muted" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>
      <Button type="button" variant="secondary" disabled={!ready || busy} onClick={() => void onSso()}>
        Continue with single sign-on
      </Button>
      <p className="text-xs text-text-muted">
        Single sign-on uses a simulated identity provider in this proof of concept.
      </p>
    </form>
  );
}
