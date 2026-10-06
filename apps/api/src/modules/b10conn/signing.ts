/**
 * Middleware leg security (SEC-TP04). Every message in either direction carries
 *   X-IF-Timestamp  Unix seconds when it was signed
 *   X-IF-Signature  hex HMAC-SHA256 of `${timestamp}.${canonicalJson(body)}` with the connector's secret
 * `canonicalJson` sorts object keys, so the signature does not depend on how the body was spaced or ordered.
 * A receiver refuses a message whose timestamp is more than five minutes from its own clock, or whose event id it has seen.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Clock } from '@if/shared';

export const ALGORITHM = 'HMAC-SHA256';
export const REPLAY_WINDOW_SECONDS = 300;
export const SIGNATURE_HEADER = 'X-IF-Signature';
export const TIMESTAMP_HEADER = 'X-IF-Timestamp';

export const canonicalJson = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canonicalJson).join(',')}]`
    : v && typeof v === 'object'
      ? `{${Object.keys(v as object)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`)
          .join(',')}}`
      : JSON.stringify(v);

export const signMessage = (secret: string, timestamp: string, body: unknown): string =>
  createHmac('sha256', secret)
    .update(`${timestamp}.${canonicalJson(body)}`)
    .digest('hex');

export const signedHeaders = (secret: string, clock: Clock, body: unknown) => {
  const ts = String(Math.floor(clock.now().getTime() / 1000));
  return { 'X-IF-Timestamp': ts, 'X-IF-Signature': signMessage(secret, ts, body) };
};

export type VerifyFailure = 'MISSING_HEADERS' | 'STALE_TIMESTAMP' | 'BAD_SIGNATURE' | 'NO_SECRET';

/** Checks timestamp and signature (never the replay: the caller knows the event ids). */
export function verifyMessage(input: {
  secret: string | null;
  signature: string | undefined;
  timestamp: string | undefined;
  body: unknown;
  clock: Clock;
}): { ok: true } | { ok: false; reason: VerifyFailure } {
  if (!input.secret) return { ok: false, reason: 'NO_SECRET' };
  if (!input.signature || !input.timestamp || !/^\d{9,12}$/.test(input.timestamp))
    return { ok: false, reason: 'MISSING_HEADERS' };
  const skew = Math.abs(input.clock.now().getTime() / 1000 - Number(input.timestamp));
  if (skew > REPLAY_WINDOW_SECONDS) return { ok: false, reason: 'STALE_TIMESTAMP' };
  const want = Buffer.from(signMessage(input.secret, input.timestamp, input.body));
  const got = Buffer.from(input.signature.padEnd(want.length, ' ').slice(0, want.length));
  if (input.signature.length !== want.length || !timingSafeEqual(want, got))
    return { ok: false, reason: 'BAD_SIGNATURE' };
  return { ok: true };
}
