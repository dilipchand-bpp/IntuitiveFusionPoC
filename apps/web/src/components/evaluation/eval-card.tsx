'use client';
import { useState, type ReactNode } from 'react';
import { SectionHeader, cn } from '@if/ui';
import { ApiError } from '@/lib/api-client';

export const problem = (e: unknown) =>
  e instanceof ApiError
    ? [e.message, ...(e.problem.errors ?? []).map((x) => x.message)]
        .filter((x, i, a) => a.indexOf(x) === i)
        .join(' ')
    : 'Something went wrong. Please try again.';

/** A titled panel on the evaluation screen. */
export function Card({
  id,
  title,
  children,
  tone,
  testId,
  badge,
}: {
  id: string;
  title: string;
  children: ReactNode;
  tone?: 'accent' | 'warning';
  testId?: string;
  badge?: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      data-testid={testId}
      className={cn(
        'relative overflow-hidden rounded-lg border p-5',
        tone === 'accent' ? 'border-accent' : tone === 'warning' ? 'border-warning' : 'border-border',
      )}
    >
      {tone && (
        <span
          aria-hidden="true"
          className={cn('absolute inset-x-0 top-0 h-1', tone === 'accent' ? 'bg-accent' : 'bg-warning')}
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <SectionHeader id={id} title={title} />
        {badge}
      </div>
      {children}
    </section>
  );
}

/** Runs an action, tracking which one is busy and showing its error or confirmation. */
export function useRunner() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  async function run(name: string, fn: () => Promise<void>, ok?: string) {
    setBusy(name);
    setError(null);
    setNote(null);
    try {
      await fn();
      if (ok) setNote(ok);
    } catch (e) {
      setError(problem(e));
    } finally {
      setBusy(null);
    }
  }
  const messages = (
    <>
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
    </>
  );
  return { busy, error, note, run, messages };
}
