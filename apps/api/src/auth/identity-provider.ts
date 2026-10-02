import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import type { Clock, RoleName } from '@if/shared';
import { primaryRole } from '@if/shared';
import { withSystem, type Database } from '../db/client.js';
import { appUser, roleAssignment, tenant } from '../db/schema.js';

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;

export interface AuthenticatedUser {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  roles: RoleName[];
  role: RoleName; // primary role
  orgUnitId: string | null;
  supplierId: string | null;
  pool: 'STAFF' | 'SUPPLIER';
}

export type AuthResult =
  | { ok: true; user: AuthenticatedUser }
  | {
      ok: false;
      reason: 'INVALID' | 'LOCKED';
      tenantId: string | null;
      userId: string | null;
      justLocked?: boolean;
    };

/**
 * SWAP POINT (see docs/swap-points.md). The mock implements password + lockout locally. A Cognito / Entra ID / Okta
 * adapter implements the same interface using OIDC; the rest of the API only ever sees AuthenticatedUser.
 */
export interface IdentityProvider {
  authenticate(email: string, password: string): Promise<AuthResult>;
  loadUser(userId: string): Promise<AuthenticatedUser | null>;
  /** Starts a password reset. Must do the same work whether or not the account exists. Returns the tenant for audit. */
  requestPasswordReset(email: string): Promise<{ tenantId: string | null }>;
  /** MFA hook. Mock: never required (UI step is stubbed; see Technical Specification 5.1). */
  mfaRequired(user: AuthenticatedUser): Promise<boolean>;
}

export class MockIdentityProvider implements IdentityProvider {
  private dummyHash: Promise<string>;
  constructor(
    private readonly database: Database,
    private readonly clock: Clock,
    private readonly defaultTenantSlug: string,
  ) {
    // Verified against when the account does not exist, so response time does not reveal account existence.
    this.dummyHash = argon2Hash('timing-equaliser-not-a-real-password');
  }

  async authenticate(email: string, password: string): Promise<AuthResult> {
    const now = this.clock.now();
    const norm = email.trim().toLowerCase();
    const found = await withSystem(this.database, async (tx) => {
      const [t] = await tx
        .select({ id: tenant.id })
        .from(tenant)
        .where(eq(tenant.slug, this.defaultTenantSlug));
      const [u] = await tx.select().from(appUser).where(eq(appUser.email, norm));
      return { tenantId: t?.id ?? null, user: u ?? null };
    });
    const u = found.user;
    if (!u || !u.active) {
      await argon2Verify(await this.dummyHash, password).catch(() => false);
      return { ok: false, reason: 'INVALID', tenantId: u?.tenantId ?? found.tenantId, userId: u?.id ?? null };
    }
    const locked = u.lockedUntil && u.lockedUntil > now;
    const passwordOk = await argon2Verify(u.passwordHash, password).catch(() => false);
    if (locked) return { ok: false, reason: 'LOCKED', tenantId: u.tenantId, userId: u.id };
    if (!passwordOk) {
      const attempts = (u.lockedUntil ? 0 : u.failedAttempts) + 1; // an expired lock starts a fresh count
      const lock = attempts >= MAX_FAILED_ATTEMPTS;
      await withSystem(this.database, (tx) =>
        tx
          .update(appUser)
          .set({
            failedAttempts: lock ? 0 : attempts,
            lockedUntil: lock ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : null,
          })
          .where(eq(appUser.id, u.id)),
      );
      return { ok: false, reason: 'INVALID', tenantId: u.tenantId, userId: u.id, justLocked: lock };
    }
    await withSystem(this.database, (tx) =>
      tx.update(appUser).set({ failedAttempts: 0, lockedUntil: null }).where(eq(appUser.id, u.id)),
    );
    return { ok: true, user: (await this.loadUser(u.id))! };
  }

  async requestPasswordReset(email: string): Promise<{ tenantId: string | null }> {
    const found = await withSystem(this.database, async (tx) => {
      const [t] = await tx
        .select({ id: tenant.id })
        .from(tenant)
        .where(eq(tenant.slug, this.defaultTenantSlug));
      const [u] = await tx
        .select({ id: appUser.id })
        .from(appUser)
        .where(eq(appUser.email, email.trim().toLowerCase()));
      return { tenantId: t?.id ?? null, exists: Boolean(u) };
    });
    // TODO(M5): when `exists`, enqueue a reset e-mail through the EmailService outbox. Identical timing either way.
    await argon2Verify(await this.dummyHash, 'x').catch(() => false);
    return { tenantId: found.tenantId };
  }

  async loadUser(userId: string): Promise<AuthenticatedUser | null> {
    const rows = await withSystem(this.database, async (tx) => {
      const [u] = await tx.select().from(appUser).where(eq(appUser.id, userId));
      if (!u || !u.active) return null;
      const roles = await tx
        .select({ role: roleAssignment.role })
        .from(roleAssignment)
        .where(eq(roleAssignment.userId, userId));
      return { u, roles: roles.map((r) => r.role as RoleName) };
    });
    if (!rows) return null;
    const { u, roles } = rows;
    return {
      id: u.id,
      tenantId: u.tenantId,
      name: u.name,
      email: u.email,
      roles,
      role: primaryRole(roles),
      orgUnitId: u.orgUnitId,
      supplierId: u.supplierId,
      pool: roles.includes('SUPPLIER') ? 'SUPPLIER' : 'STAFF',
    };
  }

  async mfaRequired(): Promise<boolean> {
    return false;
  }
}
