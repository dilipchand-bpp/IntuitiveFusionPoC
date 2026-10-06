/**
 * The resilient API layer (NFR-C05). Every call to an outside provider goes through `callProvider`, which adds
 *  - a timeout,
 *  - bounded retries with exponential backoff (the wait uses the injected Clock, so tests never really sleep),
 *  - a circuit breaker per connector (CLOSED, OPEN, HALF_OPEN) whose state is kept on the `connector` row, and
 *  - a fallback value, so a provider that is down gives an answer the caller can show instead of an exception.
 * A connector set to mode DOWN (the demonstration switch) behaves exactly like a provider that does not answer.
 *
 * SWAP POINT (docs/swap-points.md): in production the breaker state lives in the gateway (for example an Envoy or API
 * gateway outlier-detection policy) or a shared cache; the contract callers rely on is only this function's result.
 */
import { eq, and } from 'drizzle-orm';
import { ManualClock, type Clock } from '@if/shared';
import type { Tx } from '../../db/client.js';
import { connector } from '../../db/schema.js';

export const BREAKER = { failureThreshold: 3, cooldownMs: 60_000 } as const;
export const DEFAULTS = { timeoutMs: 3000, retries: 2, backoffMs: 100 } as const;

export interface ResilienceDeps {
  clock: Clock;
  /** Waits between retries. Defaults to moving a ManualClock on, or a real timer for a real clock. */
  sleep?: (ms: number) => Promise<void>;
}
export type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';
export type FailureReason = 'DISABLED' | 'DOWN' | 'BREAKER_OPEN' | 'TIMEOUT' | 'ERROR';

export type CallOutcome<T> =
  | { ok: true; value: T; attempts: number; breaker: BreakerState }
  | {
      ok: false;
      reason: FailureReason;
      error: string;
      /** The caller's fallback, so there is always something to show. */
      value: T;
      attempts: number;
      breaker: BreakerState;
    };

export class ProviderTimeout extends Error {
  constructor(ms: number) {
    super(`The provider did not answer within ${ms} ms`);
  }
}

const defaultSleep = (clock: Clock) => async (ms: number) => {
  if (clock instanceof ManualClock) clock.advanceMs(ms);
  else await new Promise((r) => setTimeout(r, ms));
};

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  const timer = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new ProviderTimeout(ms)), ms);
  });
  return Promise.race([p, timer]).finally(() => clearTimeout(t));
}

export async function callProvider<T>(
  tx: Tx,
  d: ResilienceDeps,
  tenantId: string,
  kind: string,
  fn: () => Promise<T>,
  opts: {
    fallback: () => T;
    timeoutMs?: number;
    retries?: number;
    backoffMs?: number;
  },
): Promise<CallOutcome<T>> {
  const timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs;
  const retries = opts.retries ?? DEFAULTS.retries;
  const backoffMs = opts.backoffMs ?? DEFAULTS.backoffMs;
  const sleep = d.sleep ?? defaultSleep(d.clock);
  const now = () => d.clock.now();
  const [row] = await tx
    .select()
    .from(connector)
    .where(and(eq(connector.tenantId, tenantId), eq(connector.kind, kind as never)));
  const fail = (reason: FailureReason, error: string, attempts: number, breaker: BreakerState) =>
    ({ ok: false, reason, error, value: opts.fallback(), attempts, breaker }) as const;

  // no connector row: nothing to break and nothing recorded, the call is simply made
  if (!row) {
    try {
      return { ok: true, value: await withTimeout(fn(), timeoutMs), attempts: 1, breaker: 'CLOSED' };
    } catch (e) {
      return fail(e instanceof ProviderTimeout ? 'TIMEOUT' : 'ERROR', msg(e), 1, 'CLOSED');
    }
  }
  if (!row.enabled) return fail('DISABLED', `The ${kind} connector is switched off`, 0, row.breakerState);

  let state: BreakerState = row.breakerState;
  if (state === 'OPEN') {
    const waited = row.breakerOpenedAt ? now().getTime() - row.breakerOpenedAt.getTime() : Infinity;
    if (waited < BREAKER.cooldownMs)
      return fail(
        'BREAKER_OPEN',
        `The circuit breaker for ${row.provider} is open after repeated failures; it tries again after ${Math.ceil((BREAKER.cooldownMs - waited) / 1000)} s`,
        0,
        'OPEN',
      );
    state = 'HALF_OPEN'; // one trial call decides
    await tx.update(connector).set({ breakerState: 'HALF_OPEN' }).where(eq(connector.id, row.id));
  }

  let attempts = 0;
  let last: unknown = null;
  let timedOut = false;
  const tries = state === 'HALF_OPEN' ? 1 : retries + 1;
  for (let i = 0; i < tries; i += 1) {
    if (i > 0) await sleep(backoffMs * 2 ** (i - 1));
    attempts += 1;
    try {
      if (row.mode === 'DOWN')
        throw new Error(`${row.provider} is not responding (the connector is marked DOWN)`);
      const value = await withTimeout(fn(), timeoutMs);
      await tx
        .update(connector)
        .set({
          breakerState: 'CLOSED',
          consecutiveFailures: 0,
          breakerOpenedAt: null,
          lastOkAt: now(),
          lastError: null,
        })
        .where(eq(connector.id, row.id));
      return { ok: true, value, attempts, breaker: 'CLOSED' };
    } catch (e) {
      last = e;
      timedOut = e instanceof ProviderTimeout;
    }
  }
  const failures = row.consecutiveFailures + 1;
  const open = state === 'HALF_OPEN' || failures >= BREAKER.failureThreshold;
  await tx
    .update(connector)
    .set({
      breakerState: open ? 'OPEN' : 'CLOSED',
      consecutiveFailures: failures,
      breakerOpenedAt: open ? now() : row.breakerOpenedAt,
      lastError: msg(last).slice(0, 500),
    })
    .where(eq(connector.id, row.id));
  return fail(
    row.mode === 'DOWN' ? 'DOWN' : timedOut ? 'TIMEOUT' : 'ERROR',
    msg(last),
    attempts,
    open ? 'OPEN' : 'CLOSED',
  );
}

const msg = (e: unknown) => (e instanceof Error ? e.message : 'The provider call failed');
