/**
 * The Copilot's open gates as action items (CP-01, gates stay human). A gate is for the people named in it and for everyone who
 * holds one of its roles; it shows in /app/actions and counts in "Waiting for you". When the person acts the procurement changes,
 * the next tick sees it and closes the gate.
 */
import { and, asc, eq } from 'drizzle-orm';
import type { AuthContext } from '../../auth/guard.js';
import type { Tx } from '../../db/client.js';
import { cpGate, cpRun } from '../../db/schema.js';

export interface CopilotItem {
  key: string;
  kind: string;
  title: string;
  detail: string;
  link: string;
  /** True when the gate is a problem handed to a person (not the usual wait for an approval). */
  needsHuman: boolean;
}

export const gateIsFor = (
  g: { assigneeRoles: unknown; assigneeUserIds: unknown },
  user: { id: string; roles: readonly string[] },
): boolean => {
  const ids = (g.assigneeUserIds as string[] | null) ?? [];
  const roles = (g.assigneeRoles as string[] | null) ?? [];
  return ids.includes(user.id) || roles.some((r) => user.roles.includes(r));
};

export async function copilotActionItems(tx: Tx, a: AuthContext): Promise<CopilotItem[]> {
  const rows = await tx
    .select({ g: cpGate, runStatus: cpRun.status })
    .from(cpGate)
    .innerJoin(cpRun, eq(cpRun.id, cpGate.runId))
    .where(and(eq(cpGate.tenantId, a.user.tenantId), eq(cpGate.status, 'OPEN')))
    .orderBy(asc(cpGate.createdAt));
  return rows
    .filter((r) => r.runStatus !== 'CANCELLED' && gateIsFor(r.g, a.user))
    .map((r) => ({
      key: `copilot:${r.g.id}`,
      kind: r.g.kind === 'NEEDS_HUMAN' ? 'Copilot needs you' : 'Copilot is waiting',
      title: r.g.title,
      detail: r.g.reason.length > 220 ? `${r.g.reason.slice(0, 217)}...` : r.g.reason,
      link: r.g.link,
      needsHuman: r.g.kind === 'NEEDS_HUMAN',
    }));
}
