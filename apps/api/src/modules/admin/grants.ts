/**
 * Time-bound access (SEC-A05, FR-0435): a role granted to an evaluation committee member, auditor, advisor or probity
 * officer can end on a date. The end is enforced the moment it passes, because roles are read live at every request
 * (identity-provider.ts); the sweep here tidies up afterwards: it removes the ended grant, ends the person's sessions,
 * tells them and the administrators, and records it.
 */
import { and, eq, isNotNull, lte } from 'drizzle-orm';
import type { Clock } from '@if/shared';
import type { AuditService } from '../../audit/audit-service.js';
import type { SessionService } from '../../auth/session-service.js';
import { withSystem, type Database } from '../../db/client.js';
import { appUser, notification, roleAssignment } from '../../db/schema.js';
import { usersWithRole } from '../notify/dispatch.js';

export async function sweepGrants(
  database: Database,
  clock: Clock,
  audit: AuditService,
  sessions: SessionService,
): Promise<number> {
  const now = clock.now();
  const ended = await withSystem(database, (tx) =>
    tx
      .select()
      .from(roleAssignment)
      .where(and(isNotNull(roleAssignment.expiresAt), lte(roleAssignment.expiresAt, now))),
  );
  for (const g of ended) {
    await withSystem(database, async (tx) => {
      // compare-and-set: deleting the row is what makes a second run (or a second server) do nothing
      const gone = await tx
        .delete(roleAssignment)
        .where(eq(roleAssignment.id, g.id))
        .returning({ id: roleAssignment.id });
      if (gone.length === 0) return;
      const [u] = await tx.select().from(appUser).where(eq(appUser.id, g.userId));
      await audit.record(
        tx,
        { tenantId: g.tenantId, userId: null, role: 'SYSTEM' },
        {
          action: 'grant.expired',
          entityType: 'app_user',
          entityId: g.userId,
          before: { role: g.role, expiresAt: g.expiresAt?.toISOString() ?? null },
          after: { role: null },
        },
      );
      const admins = await usersWithRole(tx, g.tenantId, ['ADMIN']);
      for (const to of [g.userId, ...admins])
        await tx.insert(notification).values({
          tenantId: g.tenantId,
          userId: to,
          title:
            to === g.userId
              ? `Your ${g.role.toLowerCase()} access has ended`
              : `${u?.name ?? 'A person'}'s ${g.role.toLowerCase()} access ended`,
          body: 'The time-bound grant reached its end date.',
          link: to === g.userId ? '/app/dashboard' : '/admin/users',
        });
    });
    await sessions.revokeAllFor(g.userId);
  }
  return ended.length;
}
