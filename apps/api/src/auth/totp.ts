/**
 * Time-based one-time passwords for authenticator apps (RFC 6238, SHA-1, 30 second steps, 6 digits), SEC-A01.
 * Pure functions; the secret handling and storage live in mfa.ts.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP_SECONDS = 30;
export const DIGITS = 6;

export function base32Encode(buf: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('Not a base32 secret');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newSecret = (): string => base32Encode(randomBytes(20));

/** The code for one time step. */
export function codeAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = h[h.length - 1]! & 0x0f;
  const bin = ((h[offset]! & 0x7f) << 24) | (h[offset + 1]! << 16) | (h[offset + 2]! << 8) | h[offset + 3]!;
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

export const stepOf = (now: Date): number => Math.floor(now.getTime() / 1000 / STEP_SECONDS);

/**
 * Checks a code against the current step and one step either side (clock drift). Returns the step it matched, or null.
 * A step at or below `lastStep` is refused so a code can be used once.
 */
export function verifyTotp(secret: string, code: string, now: Date, lastStep = 0): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = stepOf(now);
  for (const step of [current, current - 1, current + 1]) {
    if (step > lastStep && codeAt(secret, step) === code) return step;
  }
  return null;
}

export const otpauthUrl = (issuer: string, account: string, secret: string): string =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;

// ---------------------------------------------------------------- secrets at rest
// The shared secret is encrypted with a key derived from the server secret (AES-256-GCM), so a copy of the database
// alone is not enough to generate codes.
const key = (serverSecret: string) => createHash('sha256').update(`mfa:${serverSecret}`).digest();

export function sealSecret(secret: string, serverSecret: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(serverSecret), iv);
  const enc = Buffer.concat([c.update(secret, 'utf8'), c.final()]);
  return `${iv.toString('base64url')}.${enc.toString('base64url')}.${c.getAuthTag().toString('base64url')}`;
}

export function openSecret(sealed: string, serverSecret: string): string {
  const [iv, enc, tag] = sealed.split('.');
  if (!iv || !enc || !tag) throw new Error('Malformed secret');
  const d = createDecipheriv('aes-256-gcm', key(serverSecret), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64url')), d.final()]).toString('utf8');
}
