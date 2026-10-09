/**
 * Reads the current state of one procurement (design principle 3): stage, plan, tender, evaluation, contract. The agent keeps no
 * script position; every tick starts from what this returns. This is a read-only, tenant-scoped look used to decide what is next
 * (so that it still works for a person who may not read, say, tenders); everything the agent then DOES goes through the routes.
 */
import { createHash } from 'node:crypto';
import { and, asc, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import { withSystem, type Database } from '../../db/client.js';
import {
  appUser,
  contract,
  evalReport,
  evaluation,
  fieldValue,
  panelMember,
  plan,
  request,
  roleAssignment,
  submission,
  tender,
} from '../../db/schema.js';
import { missingMandatory } from '../intake/fields.js';
import { valuesOf } from '../intake/service.js';
import { PLAN_FIELDS } from '../plan/fields.js';

export interface Obs {
  now: Date;
  request: null | {
    id: string;
    number: string;
    title: string;
    status: string;
    phase: string;
    version: number;
    estimatedValue: number;
    category: string | null;
    termMonths: number | null;
    businessUnit: string | null;
    requesterId: string;
    missing: string[];
  };
  plan: null | {
    id: string;
    status: string;
    locked: boolean;
    version: number;
    missingSections: string[];
  };
  tender: null | {
    id: string;
    status: string;
    type: string;
    access: string;
    closesAt: Date | null;
    permissionGranted: boolean;
    dualWitness: boolean;
    openedAt: Date | null;
    bids: number;
    version: number;
  };
  evaluation: null | {
    id: string;
    status: string;
    held: boolean;
    version: number;
    panel: Array<{ userId: string; name: string; stream: string; coiState: string; scored: boolean }>;
    reportId: string | null;
    reportStatus: string | null;
    chairIds: string[];
  };
  contract: null | { id: string; number: string; status: string; value: number; version: number };
  fingerprint: string;
}

export async function observe(
  db: Database,
  tenantId: string,
  requestId: string | null,
  now: Date,
): Promise<Obs> {
  const empty: Obs = {
    now,
    request: null,
    plan: null,
    tender: null,
    evaluation: null,
    contract: null,
    fingerprint: 'none',
  };
  if (!requestId) return empty;
  return withSystem(db, async (tx) => {
    const [r] = await tx
      .select()
      .from(request)
      .where(and(eq(request.id, requestId), eq(request.tenantId, tenantId)));
    if (!r) return empty;
    const fields = await tx
      .select()
      .from(fieldValue)
      .where(and(eq(fieldValue.ownerType, 'REQUEST'), eq(fieldValue.ownerId, r.id)));
    const obs: Obs = {
      ...empty,
      request: {
        id: r.id,
        number: r.number,
        title: r.title,
        status: r.status,
        phase: r.phase,
        version: r.version,
        estimatedValue: Number(r.estimatedValue ?? 0),
        category: r.category ?? null,
        termMonths: r.termMonths ?? null,
        businessUnit: r.businessUnit ?? null,
        requesterId: r.requesterId,
        missing: missingMandatory(valuesOf(r, fields)),
      },
    };
    const [p] = await tx.select().from(plan).where(eq(plan.requestId, r.id));
    if (p) {
      const pf = await tx
        .select()
        .from(fieldValue)
        .where(and(eq(fieldValue.ownerType, 'PLAN'), eq(fieldValue.ownerId, p.id)));
      const have = new Set(pf.filter((f) => (f.value ?? '').trim() !== '').map((f) => f.key));
      obs.plan = {
        id: p.id,
        status: p.status,
        locked: p.locked,
        version: p.version,
        missingSections: PLAN_FIELDS.filter((f) => f.mandatory && !have.has(f.key)).map((f) => f.key),
      };
    }
    const [t] = await tx.select().from(tender).where(eq(tender.requestId, r.id));
    if (t) {
      const [b] = await tx
        .select({ n: count() })
        .from(submission)
        .where(and(eq(submission.tenderId, t.id), eq(submission.status, 'SUBMITTED')));
      // a published tender whose closing time has passed is closed, whether or not a scheduler has recorded it yet
      const closed = t.status === 'PUBLISHED' && t.closesAt !== null && t.closesAt.getTime() <= now.getTime();
      obs.tender = {
        id: t.id,
        status: closed ? 'CLOSED' : t.status,
        type: t.type,
        access: t.access,
        closesAt: t.closesAt,
        permissionGranted: Boolean(t.publishPermissionId),
        dualWitness: t.dualWitness,
        openedAt: t.openedAt,
        bids: b?.n ?? 0,
        version: t.version,
      };
      const [ev] = await tx.select().from(evaluation).where(eq(evaluation.tenderId, t.id));
      if (ev) {
        const panel = await tx
          .select({ m: panelMember, name: appUser.name })
          .from(panelMember)
          .innerJoin(appUser, eq(appUser.id, panelMember.userId))
          .where(eq(panelMember.evaluationId, ev.id))
          .orderBy(asc(appUser.name));
        const [rep] = await tx.select().from(evalReport).where(eq(evalReport.evaluationId, ev.id));
        const chairs = await tx
          .select({ userId: roleAssignment.userId })
          .from(roleAssignment)
          .where(and(eq(roleAssignment.tenantId, tenantId), eq(roleAssignment.role, 'CHAIR')));
        obs.evaluation = {
          id: ev.id,
          status: ev.status,
          held: ev.held,
          version: ev.version,
          panel: panel.map((x) => ({
            userId: x.m.userId,
            name: x.name,
            stream: x.m.stream,
            coiState: x.m.coiState,
            scored: Boolean(x.m.scoredAt),
          })),
          reportId: rep?.id ?? null,
          reportStatus: rep?.status ?? null,
          chairIds: chairs.map((c) => c.userId),
        };
      }
      const [c] = await tx
        .select()
        .from(contract)
        .where(and(eq(contract.tenderId, t.id), isNull(contract.deletedAt), isNull(contract.parentId)))
        .orderBy(desc(contract.number))
        .limit(1);
      if (c)
        obs.contract = {
          id: c.id,
          number: c.number,
          status: c.status,
          value: Number(c.value),
          version: c.version,
        };
    }
    obs.fingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          obs.request,
          obs.plan,
          obs.tender && { ...obs.tender, closesAt: obs.tender.closesAt?.toISOString() },
          obs.evaluation,
          obs.contract,
        ]),
      )
      .digest('hex')
      .slice(0, 16);
    return obs;
  });
}

/** People holding a role in a tenant (for who a gate is waiting for). */
export async function usersWithRoles(
  db: Database,
  tenantId: string,
  roles: readonly string[],
): Promise<Array<{ id: string; name: string }>> {
  return withSystem(db, async (tx) => {
    const rows = await tx
      .select({ id: appUser.id, name: appUser.name })
      .from(roleAssignment)
      .innerJoin(appUser, eq(appUser.id, roleAssignment.userId))
      .where(
        and(
          eq(roleAssignment.tenantId, tenantId),
          inArray(roleAssignment.role, roles as never),
          eq(appUser.active, true),
        ),
      )
      .orderBy(asc(appUser.name));
    const seen = new Set<string>();
    return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  });
}

export async function namesOf(db: Database, tenantId: string, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  return withSystem(db, async (tx) => {
    const rows = await tx
      .select({ id: appUser.id, name: appUser.name })
      .from(appUser)
      .where(and(eq(appUser.tenantId, tenantId), inArray(appUser.id, [...ids])));
    const m = new Map(rows.map((r) => [r.id, r.name]));
    return ids.map((i) => m.get(i) ?? 'Unknown');
  });
}
