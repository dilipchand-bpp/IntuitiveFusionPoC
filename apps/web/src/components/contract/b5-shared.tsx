'use client';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ApiError, api } from '@/lib/api-client';

export const message = (e: unknown) =>
  e instanceof ApiError
    ? [e.message, ...(e.problem.errors ?? []).map((x) => x.message)]
        .filter((x, i, a) => a.indexOf(x) === i)
        .join(' ')
    : 'Something went wrong. Please try again.';

/** Loads a read-only endpoint, with a way to load it again after a change. */
export function useData<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!path) return;
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError(message(e));
    }
  }, [path]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, reload };
}

/** Runs a change, keeping the busy name and the outcome to show under the form. */
export function useRun() {
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
      return true;
    } catch (e) {
      setError(message(e));
      return false;
    } finally {
      setBusy(null);
    }
  }
  const messages: ReactNode = (
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
  return { busy, run, messages };
}

export const send = <T,>(
  csrf: string,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
) => api<T>(path, { method, csrf, ...(body === undefined ? {} : { body }) });

export const has = (roles: readonly string[], ...r: string[]) => r.some((x) => roles.includes(x));

/** A labelled progress bar; the colour moves from the accent to amber to red as a limit is approached. */
export function Bar({ label, pct, limit = true }: { label: string; pct: number; limit?: boolean }) {
  const shown = Math.max(0, Math.min(100, pct));
  const tone = !limit ? 'bg-accent' : pct >= 100 ? 'bg-error' : pct >= 80 ? 'bg-warning' : 'bg-accent';
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="font-semibold">{label}</span>
        <span className="text-text-muted">{Math.round(pct * 10) / 10}%</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(shown)}
        className="mt-1 h-3 w-full overflow-hidden rounded-full border border-border bg-surface-alt"
      >
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${shown}%` }} />
      </div>
    </div>
  );
}

export const PRIORITY_TONE = { HIGH: 'error', MEDIUM: 'warning', LOW: 'neutral' } as const;
