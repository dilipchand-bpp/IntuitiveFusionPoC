import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { Clock } from '@if/shared';
import { withSystem, type Database } from '../db/client.js';
import { session } from '../db/schema.js';
import type { AuthenticatedUser, IdentityProvider } from './identity-provider.js';

export const IDLE_TIMEOUT_MS = 30 * 60_000; // SEC-A07
export const ABSOLUTE_TIMEOUT_MS = 8 * 3_600_000;
/** Separate cookie per identity pool (SEC-A03): a supplier session can never be presented as a staff session. */
export const COOKIE_NAMES = { STAFF: 'if_session', SUPPLIER: 'if_supplier_session' } as const;

export type MfaState = 'NOT_REQUIRED' | 'VERIFIED' | 'ENROLMENT_REQUIRED';

export type Resolved =
  | {
      ok: true;
      sessionId: string;
      user: AuthenticatedUser;
      expiresAt: Date;
      mfaState: MfaState;
      authMethod: 'PASSWORD' | 'SSO';
    }
  | {
      ok: false;
      reason:
        | 'MALFORMED'
        | 'BAD_SIGNATURE'
        | 'UNKNOWN'
        | 'REVOKED'
        | 'IDLE'
        | 'EXPIRED'
        | 'USER_GONE'
        | 'WRONG_POOL';
    };

export class SessionService {
  constructor(
    private readonly database: Database,
    private readonly clock: Clock,
    private readonly idp: IdentityProvider,
    private readonly secret: string,
  ) {}

  private mac(data: string) {
    return createHmac('sha256', this.secret).update(data).digest('base64url');
  }
  /** Cookie value = `<sessionId>.<hmac>`; the id alone is not enough to present a session. */
  sign(sessionId: string) {
    return `${sessionId}.${this.mac('sid:' + sessionId)}`;
  }
  /** CSRF token derived from the session id; unguessable without the server secret, no extra storage. */
  csrfFor(sessionId: string) {
    return this.mac('csrf:' + sessionId);
  }
  verifyCsrf(sessionId: string, presented: string | undefined): boolean {
    if (!presented) return false;
    const a = Buffer.from(this.csrfFor(sessionId));
    const b = Buffer.from(presented);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async create(
    user: AuthenticatedUser,
    meta: { ip?: string; userAgent?: string },
    how: { mfaState?: MfaState; authMethod?: 'PASSWORD' | 'SSO' } = {},
  ) {
    const id = randomUUID();
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + ABSOLUTE_TIMEOUT_MS);
    await withSystem(this.database, (tx) =>
      tx.insert(session).values({
        id,
        tenantId: user.tenantId,
        userId: user.id,
        pool: user.pool,
        createdAt: now,
        lastSeenAt: now,
        expiresAt,
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 200),
        mfaState: how.mfaState ?? 'NOT_REQUIRED',
        authMethod: how.authMethod ?? 'PASSWORD',
      }),
    );
    return { id, cookieValue: this.sign(id), expiresAt };
  }

  async resolve(cookieValue: string | undefined, expectedPool: 'STAFF' | 'SUPPLIER'): Promise<Resolved> {
    if (!cookieValue) return { ok: false, reason: 'MALFORMED' };
    const dot = cookieValue.lastIndexOf('.');
    if (dot < 1) return { ok: false, reason: 'MALFORMED' };
    const id = cookieValue.slice(0, dot);
    const expected = Buffer.from(this.sign(id));
    const given = Buffer.from(cookieValue);
    if (expected.length !== given.length || !timingSafeEqual(expected, given))
      return { ok: false, reason: 'BAD_SIGNATURE' };
    if (!/^[0-9a-f-]{36}$/.test(id)) return { ok: false, reason: 'MALFORMED' };

    const [row] = await withSystem(this.database, (tx) =>
      tx.select().from(session).where(eq(session.id, id)),
    );
    if (!row) return { ok: false, reason: 'UNKNOWN' };
    if (row.pool !== expectedPool) return { ok: false, reason: 'WRONG_POOL' };
    if (row.revokedAt) return { ok: false, reason: 'REVOKED' };
    const now = this.clock.now();
    if (now >= row.expiresAt) return { ok: false, reason: 'EXPIRED' };
    if (now.getTime() - row.lastSeenAt.getTime() > IDLE_TIMEOUT_MS) return { ok: false, reason: 'IDLE' };
    const user = await this.idp.loadUser(row.userId);
    if (!user) return { ok: false, reason: 'USER_GONE' };
    await withSystem(this.database, (tx) =>
      tx.update(session).set({ lastSeenAt: now }).where(eq(session.id, id)),
    );
    return {
      ok: true,
      sessionId: id,
      user,
      expiresAt: row.expiresAt,
      mfaState: row.mfaState,
      authMethod: row.authMethod,
    };
  }

  /** The person finished enrolling in MFA: this session is no longer restricted. */
  async markMfaVerified(sessionId: string) {
    await withSystem(this.database, (tx) =>
      tx.update(session).set({ mfaState: 'VERIFIED' }).where(eq(session.id, sessionId)),
    );
  }

  /** Ends every live session of a person (a role change, a switch-off, a departed contact). */
  async revokeAllFor(userId: string) {
    await withSystem(this.database, (tx) =>
      tx
        .update(session)
        .set({ revokedAt: this.clock.now() })
        .where(and(eq(session.userId, userId), isNull(session.revokedAt))),
    );
  }

  async revoke(sessionId: string) {
    await withSystem(this.database, (tx) =>
      tx.update(session).set({ revokedAt: this.clock.now() }).where(eq(session.id, sessionId)),
    );
  }
}
