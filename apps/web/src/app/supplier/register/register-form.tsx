'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button, Field, Input, Select } from '@if/ui';
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
  const [done, setDone] = useState<null | { held: boolean }>(null);
  const [questions, setQuestions] = useState<
    Array<{ id: string; label: string; type: 'YESNO' | 'TEXT'; mandatory: boolean }>
  >([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [privacy, setPrivacy] = useState({ shareProfile: true, productUpdates: false });
  // the organisation's own onboarding questions, if it has set any (FR-0215)
  useEffect(() => {
    void api<typeof questions>(
      `/supplier/onboarding-questions${token ? `?token=${encodeURIComponent(token)}` : ''}`,
    )
      .then(setQuestions)
      .catch(() => setQuestions([]));
  }, [token]);

  async function submit() {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const r = await api<{ sanctionsStatus?: string }>('/supplier/register', {
        method: 'POST',
        body: {
          ...(token ? { token } : {}),
          name,
          email,
          company,
          abn,
          password,
          answers: Object.fromEntries(Object.entries(answers).filter(([, v]) => v !== '')),
          privacy,
        },
      });
      setDone({ held: r.sanctionsStatus === 'MATCH' });
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
        {done.held && (
          <p className="mt-1 text-sm" data-testid="held-notice">
            Your account is on hold while a screening result is reviewed by the buyer. You will be told when
            it is active.
          </p>
        )}
        <p className="mt-1 text-sm">
          <Link href="/login" className="underline">
            Sign in
          </Link>{' '}
          with your email and the password you just chose. You will land in the supplier portal.
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
      {questions.map((q) => (
        <Field key={q.id} label={q.label} required={q.mandatory} error={fields[`answers.${q.id}`] ?? ''}>
          {q.type === 'YESNO' ? (
            <Select
              value={answers[q.id] ?? ''}
              onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
            >
              <option value="">Choose…</option>
              <option value="YES">Yes</option>
              <option value="NO">No</option>
            </Select>
          ) : (
            <Input
              value={answers[q.id] ?? ''}
              onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
              maxLength={2000}
            />
          )}
        </Field>
      ))}
      <fieldset className="rounded-md border border-border p-3">
        <legend className="px-1 text-sm font-semibold">Your privacy choices</legend>
        <label className="flex min-h-[44px] items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-5 accent-[var(--if-color-accent)]"
            checked={privacy.shareProfile}
            onChange={(e) => setPrivacy({ ...privacy, shareProfile: e.target.checked })}
          />
          Let buyers at this organisation see my company profile
        </label>
        <label className="flex min-h-[44px] items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-5 accent-[var(--if-color-accent)]"
            checked={privacy.productUpdates}
            onChange={(e) => setPrivacy({ ...privacy, productUpdates: e.target.checked })}
          />
          Send me product updates by email
        </label>
        <p className="mt-1 text-xs text-text-muted">
          You can change these at any time on your company profile.
        </p>
      </fieldset>
      <Button type="submit" loading={busy} disabled={!ready}>
        Create account
      </Button>
    </form>
  );
}
