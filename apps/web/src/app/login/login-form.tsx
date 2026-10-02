'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Eye, EyeOff } from 'lucide-react';
import { Button, Field, Input } from '@if/ui';

interface LoginOk {
  user: { homePath: string };
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
        router.replace(safeNext(params.get('next')) ?? body.user.homePath);
        router.refresh();
        return;
      }
      setErrors({
        form:
          res.status === 429
            ? 'Too many attempts. Please wait a few minutes and try again.'
            : 'Invalid email or password, or the account is temporarily locked.',
      });
    } catch {
      setErrors({ form: 'Could not reach the server. Please try again.' });
    } finally {
      setBusy(false);
    }
  }

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
    </form>
  );
}
