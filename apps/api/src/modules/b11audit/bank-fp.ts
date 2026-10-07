/** A pure helper with no imports from the rest of the platform, so duplicate detection (b8/rules.ts) can use it. */
import { createHash } from 'node:crypto';

const digits = (s: string | undefined | null) => (s ?? '').replace(/\D/g, '');

/** What duplicate detection compares: a hash of the digits, so two suppliers sharing an account match without the number being shown (SEC-AC10). */
export function bankFingerprint(
  value: { bsb?: string | undefined; account?: string | undefined } | null | undefined,
): string | null {
  const s = digits(value?.bsb) + digits(value?.account);
  return s.length >= 6 ? createHash('sha256').update(`if-bank:${s}`).digest('hex') : null;
}
