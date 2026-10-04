/** MFA storage and the short-lived token that carries a password-verified person to the code check (SEC-A01). */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { withSystem, type Database } from '../db/client.js';
import { userMfa } from '../db/schema.js';

export const MFA_TOKEN_MINUTES = 5;

const mac = (secret: string, data: string) =>
  createHmac('sha256', secret).update(`mfa-token:${data}`).digest('base64url');

/** `<userId>.<expiryMs>.<hmac>`: proves the password was right a moment ago; it is not a session. */
export function signMfaToken(secret: string, userId: string, now: Date): string {
  const exp = now.getTime() + MFA_TOKEN_MINUTES * 60_000;
  const body = `${userId}.${exp}`;
  return `${body}.${mac(secret, body)}`;
}

export function verifyMfaToken(secret: string, token: string, now: Date): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, exp, sig] = parts as [string, string, string];
  const expected = Buffer.from(mac(secret, `${userId}.${exp}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (!/^[0-9a-f-]{36}$/.test(userId) || Number(exp) <= now.getTime()) return null;
  return userId;
}

export const mfaState = (database: Database, userId: string) =>
  withSystem(database, async (tx) => {
    const [m] = await tx.select().from(userMfa).where(eq(userMfa.userId, userId));
    return m ?? null;
  });
