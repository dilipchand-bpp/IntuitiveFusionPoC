import { and, eq } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import { delegation } from '../db/schema.js';

export type DelegationScope = 'SOURCING_APPROVAL' | 'CONTRACT_SIGNING' | 'PUBLISH_PERMISSION';

export interface DelegationCheck {
  allowed: boolean;
  code?: 'DELEGATION_EXCEEDED' | 'SIGNING_AUTHORITY_INSUFFICIENT' | 'NO_DELEGATION';
  limit: number | null;
  value: number;
  delegationId?: string;
}

/**
 * Delegation-of-authority engine (SEC-AC04/AC05). Authority is looked up per SCOPE, so sourcing approval and
 * contract signing are separate grants: holding one never implies the other. The highest active limit that
 * applies to the user (personally, or via their role) and, when given, the division, is used.
 */
export async function checkDelegation(
  tx: Tx,
  actor: { tenantId: string; userId: string; roles: readonly string[] },
  scope: DelegationScope,
  value: number,
  division?: string | null,
  /** Spend in a foreign currency is covered only by grants made for international spend, and the reverse (FR-0810). */
  international = false,
): Promise<DelegationCheck> {
  const rows = await tx
    .select()
    .from(delegation)
    .where(
      and(eq(delegation.tenantId, actor.tenantId), eq(delegation.scope, scope), eq(delegation.active, true)),
    );
  const applicable = rows.filter(
    (d) =>
      (d.userId ? d.userId === actor.userId : actor.roles.includes(d.role)) &&
      (!d.division || d.division === division) &&
      d.international === international,
  );
  if (applicable.length === 0) {
    return {
      allowed: false,
      code: scope === 'CONTRACT_SIGNING' ? 'SIGNING_AUTHORITY_INSUFFICIENT' : 'NO_DELEGATION',
      limit: null,
      value,
    };
  }
  const best = applicable.reduce((a, b) => (Number(b.maxValue) > Number(a.maxValue) ? b : a));
  const limit = Number(best.maxValue);
  if (value > limit) {
    return {
      allowed: false,
      code: scope === 'CONTRACT_SIGNING' ? 'SIGNING_AUTHORITY_INSUFFICIENT' : 'DELEGATION_EXCEEDED',
      limit,
      value,
      delegationId: best.id,
    };
  }
  return { allowed: true, limit, value, delegationId: best.id };
}
