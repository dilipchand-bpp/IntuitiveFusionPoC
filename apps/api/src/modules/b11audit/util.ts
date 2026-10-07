/** Small helpers shared by the B11c modules. */
import { and, eq, inArray } from 'drizzle-orm';
import type { Role } from '../../db/schema.js';
import type { Tx } from '../../db/client.js';
import { appUser, roleAssignment } from '../../db/schema.js';

export { sysCtx, tell } from '../b10erp/shared.js';

/** Active staff accounts holding any of the roles (not external advisors), in a stable order. */
export async function usersWithRoles(
  tx: Tx,
  tenantId: string,
  roles: readonly Role[],
  now: Date,
): Promise<Array<{ id: string; name: string; role: Role }>> {
  const rows = await tx
    .select({
      id: appUser.id,
      name: appUser.name,
      role: roleAssignment.role,
      expiresAt: roleAssignment.expiresAt,
      external: appUser.external,
    })
    .from(roleAssignment)
    .innerJoin(appUser, eq(appUser.id, roleAssignment.userId))
    .where(
      and(
        eq(roleAssignment.tenantId, tenantId),
        inArray(roleAssignment.role, [...roles]),
        eq(appUser.active, true),
      ),
    );
  return rows
    .filter((r) => !r.external && (!r.expiresAt || r.expiresAt > now))
    .map((r) => ({ id: r.id, name: r.name, role: r.role }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** Pretty JSON with a fixed layout, so the same data always produces the same bytes (and the same SHA-256). */
export const stableJson = (v: unknown): string => JSON.stringify(sortKeys(v), null, 2);
function sortKeys(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(sortKeys);
  return Object.fromEntries(
    Object.keys(v as object)
      .sort()
      .map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]),
  );
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
