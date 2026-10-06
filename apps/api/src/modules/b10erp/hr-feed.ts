/**
 * HR feed: starters, leavers, role changes and delegate changes applied automatically (FR-0815).
 *
 * SWAP POINT (docs/swap-points.md): `fetchHrBatch` is the simulated HR system (Workday, SAP SuccessFactors). A real adapter
 * returns the same event list from the HR system's worker feed (or receives it as a signed push on the HR connector); the rules
 * in `applyHrEvent` do not change. Rules the feed can never override: it does not grant ADMIN or SUPPLIER (the event is refused
 * and listed as needing a person), it does not touch an administrator, and a delegation it creates can never exceed the
 * delegator's own limit (it is capped, and listed). Every event id is applied once; a repeat changes nothing. Starters get an
 * account that cannot sign in until the person uses the one-time activation link (the same flow as a staff user an
 * administrator creates). A leaver is switched off at once, their sessions end, and their open delegations, requests and
 * contracts are listed for reassignment to the named backup.
 */
import { randomBytes } from 'node:crypto';
import { hash as argon2Hash } from '@node-rs/argon2';
import { and, desc, eq, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import type { RequestContext, Tx } from '../../db/client.js';
import {
  appUser,
  contract,
  delegation,
  hrDelegateChange,
  hrFeedBatch,
  hrFeedEvent,
  hrReassignment,
  manualTask,
  orgUnit,
  request,
  roleAssignment,
  session,
  supplierActivation,
  ROLES,
  type HrEventType,
  type HrOutcome,
  type Role,
} from '../../db/schema.js';
import { checkDelegation, type DelegationScope } from '../../authz/delegation.js';
import { AppError } from '../../http/errors.js';
import { providerEntry } from '../b10conn/catalogue.js';
import { getConnector } from '../b10conn/connectors.js';
import { callProvider } from '../b10conn/resilience.js';
import { hashToken } from '../tender/routes.js';
import { iso, tell, type SimDeps } from './shared.js';

export const HR_DOMAIN = 'meridian-demo.example';
export const HR_BATCHES = 3;
const DAY = 86_400_000;

// ---------------------------------------------------------------- the simulated HR system
export interface HrEvent {
  eventId: string;
  type: HrEventType;
  effectiveDate: string;
  person?: { email: string; name?: string; businessUnit?: string; role?: string };
  /** LEAVER: who takes over the leaver's open work. */
  backupEmail?: string;
  /** ROLE_CHANGE. */
  newRole?: string;
  /** DELEGATE_CHANGE. */
  delegate?: {
    delegatorEmail: string;
    delegateEmail: string;
    scope: string;
    limit: number;
    startsOn: string;
    endsOn: string;
  };
}
export interface HrBatch {
  batchRef: string;
  source: string;
  events: HrEvent[];
}
const em = (local: string) => `${local}@${HR_DOMAIN}`;

/** Deterministic synthetic batches. Dates are relative to `today`, so a delegation is always current when the demonstration runs. */
export async function fetchHrBatch(batch: number, today: Date, source: string): Promise<HrBatch> {
  const d0 = iso(today);
  const plus = (n: number) => iso(new Date(today.getTime() + n * DAY));
  const ref = `HR-BATCH-${String(batch).padStart(4, '0')}`;
  const events: HrEvent[] = [];
  if (batch === 1)
    events.push(
      {
        eventId: 'HR-0001',
        type: 'STARTER',
        effectiveDate: d0,
        person: {
          email: em('ava.lindqvist'),
          name: 'Ava Lindqvist',
          businessUnit: 'Procurement',
          role: 'REQUESTER',
        },
      },
      {
        eventId: 'HR-0002',
        type: 'STARTER',
        effectiveDate: d0,
        person: {
          email: em('ben.okafor'),
          name: 'Ben Okafor',
          businessUnit: 'Facilities',
          role: 'CONTRACT_MGR',
        },
      },
      {
        eventId: 'HR-0003',
        type: 'STARTER',
        effectiveDate: d0,
        person: { email: em('chloe.marsh'), name: 'Chloe Marsh', businessUnit: 'IT', role: 'EVALUATOR' },
      },
      {
        eventId: 'HR-0004',
        type: 'STARTER',
        effectiveDate: d0,
        person: { email: em('dev.admin'), name: 'Dev Admin', businessUnit: 'IT', role: 'ADMIN' },
      },
    );
  if (batch === 2)
    events.push(
      {
        eventId: 'HR-0005',
        type: 'ROLE_CHANGE',
        effectiveDate: d0,
        person: { email: em('ben.okafor') },
        newRole: 'PROCUREMENT',
      },
      {
        eventId: 'HR-0006',
        type: 'ROLE_CHANGE',
        effectiveDate: d0,
        person: { email: em('ava.lindqvist') },
        newRole: 'ADMIN',
      },
      {
        eventId: 'HR-0007',
        type: 'LEAVER',
        effectiveDate: d0,
        person: { email: em('chloe.marsh') },
        backupEmail: em('ben.okafor'),
      },
      {
        eventId: 'HR-0008',
        type: 'DELEGATE_CHANGE',
        effectiveDate: d0,
        person: { email: em('ava.lindqvist') },
        delegate: {
          delegatorEmail: em('delegate'),
          delegateEmail: em('ava.lindqvist'),
          scope: 'SOURCING_APPROVAL',
          limit: 400_000,
          startsOn: d0,
          endsOn: plus(14),
        },
      },
    );
  if (batch === 3)
    events.push(
      {
        eventId: 'HR-0009',
        type: 'LEAVER',
        effectiveDate: d0,
        person: { email: em('nobody.here') },
        backupEmail: em('ben.okafor'),
      },
      {
        eventId: 'HR-0010',
        type: 'STARTER',
        effectiveDate: d0,
        person: {
          email: em('ben.okafor'),
          name: 'Ben Okafor',
          businessUnit: 'Facilities',
          role: 'CONTRACT_MGR',
        },
      },
      {
        eventId: 'HR-0011',
        type: 'ROLE_CHANGE',
        effectiveDate: d0,
        person: { email: em('ben.okafor') },
        newRole: 'SUPPLIER',
      },
      {
        eventId: 'HR-0012',
        type: 'DELEGATE_CHANGE',
        effectiveDate: d0,
        person: { email: em('ben.okafor') },
        delegate: {
          delegatorEmail: em('delegate'),
          delegateEmail: em('ben.okafor'),
          scope: 'CONTRACT_SIGNING',
          limit: 100_000,
          startsOn: plus(7),
          endsOn: plus(21),
        },
      },
    );
  return { batchRef: ref, source, events };
}

// ---------------------------------------------------------------- applying one event
export interface EventResult {
  eventId: string;
  type: HrEventType;
  email: string;
  outcome: HrOutcome | 'DUPLICATE';
  detail: string;
  activationPath?: string;
  userId?: string;
}
type Ctx = { tx: Tx; d: SimDeps; ctx: RequestContext; dry: boolean; now: Date };

const STAFF_ROLES = ROLES.filter((r) => r !== 'SUPPLIER' && r !== 'ADMIN') as readonly Role[];

async function userByEmail(tx: Tx, tenantId: string, email: string) {
  const [u] = await tx
    .select()
    .from(appUser)
    .where(and(eq(appUser.tenantId, tenantId), sql`lower(${appUser.email}) = ${email.toLowerCase()}`));
  return u;
}
async function rolesOf(tx: Tx, userId: string): Promise<string[]> {
  return (
    await tx.select({ r: roleAssignment.role }).from(roleAssignment).where(eq(roleAssignment.userId, userId))
  ).map((x) => x.r);
}
async function endSessions(tx: Tx, userId: string, now: Date) {
  return (
    await tx
      .update(session)
      .set({ revokedAt: now })
      .where(and(eq(session.userId, userId), isNull(session.revokedAt)))
      .returning({ id: session.id })
  ).length;
}
const audit = (c: Ctx, action: string, entityId: string, after: Record<string, unknown>) =>
  c.d.audit.record(c.tx, c.ctx, {
    action,
    entityType: 'app_user',
    entityId,
    after: { source: 'HR', ...after },
  });

async function applyStarter(c: Ctx, ev: HrEvent): Promise<Omit<EventResult, 'eventId' | 'type' | 'email'>> {
  const p = ev.person!;
  const role = (p.role ?? '').toUpperCase();
  if (role === 'ADMIN' || role === 'SUPPLIER')
    return {
      outcome: 'NEEDS_HUMAN',
      detail: `The feed asks for the ${role} role. A feed never grants it: an administrator must create ${p.email} by hand if they should have it.`,
    };
  if (!(STAFF_ROLES as readonly string[]).includes(role))
    return { outcome: 'REFUSED', detail: `"${p.role ?? ''}" is not a role this platform knows` };
  if (!p.email.toLowerCase().endsWith(`@${HR_DOMAIN}`))
    return { outcome: 'REFUSED', detail: `Only ${HR_DOMAIN} addresses are accepted from this feed` };
  const existing = await userByEmail(c.tx, c.ctx.tenantId, p.email);
  if (existing)
    return { outcome: 'NO_CHANGE', detail: `${p.email} already has an account`, userId: existing.id };
  const [unit] = p.businessUnit
    ? await c.tx
        .select()
        .from(orgUnit)
        .where(
          and(
            eq(orgUnit.tenantId, c.ctx.tenantId),
            sql`lower(${orgUnit.name}) = ${p.businessUnit.toLowerCase()}`,
          ),
        )
    : [];
  const note = unit ? '' : p.businessUnit ? ` (no organisation unit named ${p.businessUnit}; none set)` : '';
  if (c.dry)
    return {
      outcome: 'APPLIED',
      detail: `Would create ${p.name ?? p.email} as ${role}, pending activation${note}`,
    };
  const placeholder = await argon2Hash(randomBytes(32).toString('hex'));
  const [u] = await c.tx
    .insert(appUser)
    .values({
      tenantId: c.ctx.tenantId,
      email: p.email.toLowerCase(),
      name: p.name ?? p.email,
      passwordHash: placeholder,
      orgUnitId: unit?.id ?? null,
      createdAt: c.now,
      updatedAt: c.now,
    })
    .returning();
  await c.tx
    .insert(roleAssignment)
    .values({ tenantId: c.ctx.tenantId, userId: u!.id, role: role as Role, grantedBy: c.ctx.userId });
  const token = randomBytes(32).toString('base64url');
  await c.tx.insert(supplierActivation).values({
    tenantId: c.ctx.tenantId,
    userId: u!.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(c.now.getTime() + 7 * DAY),
    createdBy: c.ctx.userId!,
  });
  await audit(c, 'hr.starter', u!.id, {
    eventId: ev.eventId,
    email: p.email,
    role,
    orgUnit: unit?.name ?? null,
  });
  return {
    outcome: 'APPLIED',
    detail: `Created ${u!.name} as ${role}; cannot sign in until they use the activation link${note}`,
    activationPath: `/activate?token=${token}`,
    userId: u!.id,
  };
}

async function applyRoleChange(
  c: Ctx,
  ev: HrEvent,
): Promise<Omit<EventResult, 'eventId' | 'type' | 'email'>> {
  const email = ev.person!.email;
  const role = (ev.newRole ?? '').toUpperCase();
  const u = await userByEmail(c.tx, c.ctx.tenantId, email);
  if (!u) return { outcome: 'REFUSED', detail: `No account for ${email}` };
  if (u.supplierId) return { outcome: 'REFUSED', detail: 'Supplier contacts are not managed by the HR feed' };
  const current = await rolesOf(c.tx, u.id);
  if (current.includes('ADMIN'))
    return {
      outcome: 'NEEDS_HUMAN',
      detail: `${email} is an administrator; an administrator changes that by hand`,
      userId: u.id,
    };
  if (role === 'ADMIN')
    return {
      outcome: 'NEEDS_HUMAN',
      detail: `The feed asks for the ADMIN role for ${email}. A feed never grants it: an administrator decides.`,
      userId: u.id,
    };
  if (!(STAFF_ROLES as readonly string[]).includes(role))
    return {
      outcome: 'REFUSED',
      detail: `"${ev.newRole ?? ''}" is not a role the feed may grant`,
      userId: u.id,
    };
  const permanent = await c.tx
    .select()
    .from(roleAssignment)
    .where(and(eq(roleAssignment.userId, u.id), isNull(roleAssignment.expiresAt)));
  if (permanent.length === 1 && permanent[0]!.role === role)
    return { outcome: 'NO_CHANGE', detail: `${email} already holds ${role}`, userId: u.id };
  if (c.dry)
    return {
      outcome: 'APPLIED',
      detail: `Would change ${email} from ${permanent.map((r) => r.role).join(', ')} to ${role}`,
      userId: u.id,
    };
  await c.tx
    .delete(roleAssignment)
    .where(and(eq(roleAssignment.userId, u.id), isNull(roleAssignment.expiresAt)));
  await c.tx
    .insert(roleAssignment)
    .values({ tenantId: c.ctx.tenantId, userId: u.id, role: role as Role, grantedBy: c.ctx.userId })
    .onConflictDoNothing();
  const ended = await endSessions(c.tx, u.id, c.now);
  await audit(c, 'hr.role_change', u.id, {
    eventId: ev.eventId,
    before: permanent.map((r) => r.role),
    role,
    sessionsEnded: ended,
  });
  return {
    outcome: 'APPLIED',
    detail: `${email}: ${permanent.map((r) => r.role).join(', ')} to ${role}; signed out so the new rights apply`,
    userId: u.id,
  };
}

async function applyLeaver(c: Ctx, ev: HrEvent): Promise<Omit<EventResult, 'eventId' | 'type' | 'email'>> {
  const email = ev.person!.email;
  const u = await userByEmail(c.tx, c.ctx.tenantId, email);
  if (!u) return { outcome: 'REFUSED', detail: `No account for ${email}` };
  if (u.supplierId) return { outcome: 'REFUSED', detail: 'Supplier contacts are not managed by the HR feed' };
  if ((await rolesOf(c.tx, u.id)).includes('ADMIN'))
    return {
      outcome: 'NEEDS_HUMAN',
      detail: `${email} is an administrator; an administrator switches that account off by hand`,
      userId: u.id,
    };
  if (!u.active) return { outcome: 'NO_CHANGE', detail: `${email} is already switched off`, userId: u.id };
  const backup = ev.backupEmail ? await userByEmail(c.tx, c.ctx.tenantId, ev.backupEmail) : undefined;
  const backupOk = backup && backup.active && backup.id !== u.id ? backup : undefined;
  const delegations = await c.tx
    .select()
    .from(delegation)
    .where(
      and(eq(delegation.tenantId, c.ctx.tenantId), eq(delegation.userId, u.id), eq(delegation.active, true)),
    );
  const reqs = await c.tx
    .select()
    .from(request)
    .where(
      and(
        eq(request.tenantId, c.ctx.tenantId),
        sql`(${request.requesterId} = ${u.id} or ${request.managerId} = ${u.id})`,
        ne(request.status, 'COMPLETE'),
      ),
    );
  const contracts = await c.tx
    .select()
    .from(contract)
    .where(
      and(eq(contract.tenantId, c.ctx.tenantId), eq(contract.ownerId, u.id), isNull(contract.deletedAt)),
    );
  const items = [
    ...delegations.map((x) => ({
      kind: 'DELEGATION' as const,
      id: x.id,
      label: `${x.scope.replace(/_/g, ' ').toLowerCase()} limit ${x.maxValue}`,
    })),
    ...reqs.map((x) => ({ kind: 'REQUEST' as const, id: x.id, label: `${x.number} ${x.title}` })),
    ...contracts.map((x) => ({
      kind: 'CONTRACT' as const,
      id: x.id,
      label: `${x.number} (${x.status.toLowerCase().replace(/_/g, ' ')})`,
    })),
  ];
  const tail = backupOk ? `handed to ${backupOk.name}` : 'no valid backup named: listed without an owner';
  const detail =
    `${email} switched off, sessions ended; ${items.length} open item${items.length === 1 ? '' : 's'} ${items.length ? tail : ''}`.trim();
  const outcome: HrOutcome = items.length > 0 && !backupOk ? 'NEEDS_HUMAN' : 'APPLIED';
  if (c.dry)
    return { outcome, detail: detail.replace('switched off', 'would be switched off'), userId: u.id };
  await c.tx.update(appUser).set({ active: false, updatedAt: c.now }).where(eq(appUser.id, u.id));
  const ended = await endSessions(c.tx, u.id, c.now);
  await c.tx
    .update(supplierActivation)
    .set({ usedAt: c.now })
    .where(and(eq(supplierActivation.userId, u.id), isNull(supplierActivation.usedAt)));
  if (delegations.length)
    await c.tx
      .update(delegation)
      .set({ active: false, updatedAt: c.now })
      .where(
        inArray(
          delegation.id,
          delegations.map((x) => x.id),
        ),
      );
  for (const it of items)
    await c.tx
      .insert(hrReassignment)
      .values({
        tenantId: c.ctx.tenantId,
        leaverId: u.id,
        backupId: backupOk?.id ?? null,
        kind: it.kind,
        refId: it.id,
        label: it.label,
        eventId: ev.eventId,
        createdAt: c.now,
      })
      .onConflictDoNothing();
  if (backupOk && items.length)
    await tell(
      c.tx,
      c.ctx.tenantId,
      backupOk.id,
      `Work handed to you: ${u.name} has left`,
      `${items.length} open item${items.length === 1 ? '' : 's'} (${items
        .map((i) => i.label)
        .slice(0, 3)
        .join('; ')}) need a new owner. An administrator will reassign them.`,
      '/app/dashboard',
      'HR_LEAVER',
    );
  await audit(c, 'hr.leaver', u.id, {
    eventId: ev.eventId,
    email,
    active: false,
    sessionsEnded: ended,
    flagged: items.length,
    backup: backupOk?.email ?? null,
  });
  return { outcome, detail, userId: u.id };
}

async function applyDelegate(c: Ctx, ev: HrEvent): Promise<Omit<EventResult, 'eventId' | 'type' | 'email'>> {
  const dl = ev.delegate!;
  const scope = dl.scope as DelegationScope;
  if (!['SOURCING_APPROVAL', 'CONTRACT_SIGNING', 'PUBLISH_PERMISSION'].includes(scope))
    return { outcome: 'REFUSED', detail: `Unknown delegation scope ${dl.scope}` };
  if (!(dl.limit > 0)) return { outcome: 'REFUSED', detail: 'The limit must be above zero' };
  if (dl.endsOn < dl.startsOn) return { outcome: 'REFUSED', detail: 'The end date is before the start date' };
  if (dl.endsOn < iso(c.now)) return { outcome: 'REFUSED', detail: 'The delegation has already ended' };
  const delegator = await userByEmail(c.tx, c.ctx.tenantId, dl.delegatorEmail);
  const delegate = await userByEmail(c.tx, c.ctx.tenantId, dl.delegateEmail);
  if (!delegator || !delegate || !delegator.active || !delegate.active)
    return { outcome: 'REFUSED', detail: 'The delegator and the delegate must both have an active account' };
  if (delegator.id === delegate.id)
    return { outcome: 'REFUSED', detail: 'A person cannot delegate to themselves' };
  const own = await checkDelegation(
    c.tx,
    { tenantId: c.ctx.tenantId, userId: delegator.id, roles: await rolesOf(c.tx, delegator.id) },
    scope,
    0,
  );
  if (own.limit === null)
    return {
      outcome: 'REFUSED',
      detail: `${dl.delegatorEmail} holds no ${scope.toLowerCase().replace(/_/g, ' ')} authority to pass on`,
    };
  const applied = Math.min(dl.limit, own.limit);
  const capped = applied < dl.limit;
  const detail = capped
    ? `Acting delegate ${dl.delegateEmail} limited to ${applied} (the feed asked for ${dl.limit}; the delegator's own limit is ${own.limit}), ${dl.startsOn} to ${dl.endsOn}`
    : `Acting delegate ${dl.delegateEmail} up to ${applied}, ${dl.startsOn} to ${dl.endsOn}`;
  if (c.dry)
    return { outcome: capped ? 'CAPPED' : 'APPLIED', detail: `Would set: ${detail}`, userId: delegate.id };
  await c.tx.insert(hrDelegateChange).values({
    tenantId: c.ctx.tenantId,
    eventId: ev.eventId,
    delegatorId: delegator.id,
    delegateId: delegate.id,
    scope,
    requestedLimit: dl.limit.toFixed(2),
    appliedLimit: applied.toFixed(2),
    startsOn: dl.startsOn,
    endsOn: dl.endsOn,
    status: 'SCHEDULED',
    createdAt: c.now,
  });
  await audit(c, 'hr.delegate_change', delegate.id, {
    eventId: ev.eventId,
    delegator: dl.delegatorEmail,
    scope,
    requested: dl.limit,
    applied,
    startsOn: dl.startsOn,
    endsOn: dl.endsOn,
  });
  return { outcome: capped ? 'CAPPED' : 'APPLIED', detail, userId: delegate.id };
}

/** Starts delegations whose start date has come, and ends those whose end date has passed. Safe to run any number of times. */
export async function syncDelegations(tx: Tx, d: SimDeps, ctx: RequestContext, now: Date) {
  const today = iso(now);
  let started = 0;
  let expired = 0;
  const due = await tx
    .select()
    .from(hrDelegateChange)
    .where(
      and(
        eq(hrDelegateChange.tenantId, ctx.tenantId),
        eq(hrDelegateChange.status, 'SCHEDULED'),
        lte(hrDelegateChange.startsOn, today),
      ),
    );
  for (const x of due) {
    if (x.endsOn < today) {
      await tx.update(hrDelegateChange).set({ status: 'EXPIRED' }).where(eq(hrDelegateChange.id, x.id));
      expired += 1;
      continue;
    }
    const [row] = await tx
      .insert(delegation)
      .values({
        tenantId: ctx.tenantId,
        scope: x.scope as DelegationScope,
        role: 'DELEGATE',
        userId: x.delegateId,
        maxValue: x.appliedLimit,
        active: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    // the acting delegate needs the DELEGATE role to approve; it ends with the delegation (the grant sweep removes it)
    await tx
      .insert(roleAssignment)
      .values({
        tenantId: ctx.tenantId,
        userId: x.delegateId,
        role: 'DELEGATE',
        expiresAt: new Date(new Date(`${x.endsOn}T00:00:00Z`).getTime() + DAY),
        grantedBy: ctx.userId,
      })
      .onConflictDoNothing();
    await tx
      .update(hrDelegateChange)
      .set({ status: 'ACTIVE', delegationId: row!.id })
      .where(eq(hrDelegateChange.id, x.id));
    await d.audit.record(tx, ctx, {
      action: 'hr.delegation_start',
      entityType: 'delegation',
      entityId: row!.id,
      after: { source: 'HR', eventId: x.eventId, limit: Number(x.appliedLimit), endsOn: x.endsOn },
    });
    started += 1;
  }
  const over = await tx
    .select()
    .from(hrDelegateChange)
    .where(
      and(
        eq(hrDelegateChange.tenantId, ctx.tenantId),
        eq(hrDelegateChange.status, 'ACTIVE'),
        sql`${hrDelegateChange.endsOn} < ${today}`,
      ),
    );
  for (const x of over) {
    if (x.delegationId)
      await tx
        .update(delegation)
        .set({ active: false, updatedAt: now })
        .where(eq(delegation.id, x.delegationId));
    await tx.update(hrDelegateChange).set({ status: 'EXPIRED' }).where(eq(hrDelegateChange.id, x.id));
    await d.audit.record(tx, ctx, {
      action: 'hr.delegation_end',
      entityType: 'delegation',
      entityId: x.delegationId,
      after: { source: 'HR', eventId: x.eventId, active: false },
    });
    expired += 1;
  }
  return { started, expired };
}

// ---------------------------------------------------------------- a whole batch
export interface HrRunResult {
  ok: boolean;
  dryRun: boolean;
  batchRef: string | null;
  providerLabel: string;
  results: EventResult[];
  counts: Record<string, number>;
  reason: string | null;
  error: string | null;
  manualTaskId: string | null;
  delegations: { started: number; expired: number };
  simulated: true;
}

export const countsOf = (rs: EventResult[]) =>
  rs.reduce<Record<string, number>>(
    (a, r) => ({ ...a, [r.outcome]: (a[r.outcome] ?? 0) + 1, total: (a.total ?? 0) + 1 }),
    { total: 0 },
  );

export async function nextBatchNumber(tx: Tx, tenantId: string): Promise<number> {
  const rows = await tx
    .select({ r: hrFeedBatch.batchRef })
    .from(hrFeedBatch)
    .where(eq(hrFeedBatch.tenantId, tenantId));
  const n = rows.reduce((m, r) => Math.max(m, Number(r.r.replace(/\D/g, ''))), 0);
  return n + 1;
}

export async function runHrFeed(
  tx: Tx,
  d: SimDeps,
  ctx: RequestContext,
  opts: { dryRun?: boolean; batch?: number | undefined },
): Promise<HrRunResult> {
  const conn = await getConnector(tx, ctx.tenantId, 'HR');
  if (!conn) throw new AppError(404, 'NOT_FOUND', 'No HR connector is configured');
  const dry = Boolean(opts.dryRun);
  const providerLabel = providerEntry('HR', conn.provider)?.label ?? conn.provider;
  const batchNo = opts.batch ?? (await nextBatchNumber(tx, ctx.tenantId));
  const base = {
    dryRun: dry,
    providerLabel,
    delegations: { started: 0, expired: 0 },
    simulated: true as const,
  };
  if (batchNo > HR_BATCHES)
    throw new AppError(
      409,
      'NO_NEW_BATCH',
      `The simulated HR system has no batch after ${HR_BATCHES}. Choose an earlier batch to show that a repeat changes nothing.`,
    );
  const now = d.clock.now();
  const pulled = await callProvider(
    tx,
    d,
    ctx.tenantId,
    'HR',
    () => fetchHrBatch(batchNo, now, conn.provider),
    {
      fallback: () => null,
    },
  );
  if (!pulled.ok || !pulled.value) {
    const error = pulled.ok ? 'The HR system returned nothing' : pulled.error;
    const reason = pulled.ok ? 'ERROR' : pulled.reason;
    let taskId: string | null = null;
    if (!dry) {
      const [open] = await tx
        .select()
        .from(manualTask)
        .where(
          and(
            eq(manualTask.tenantId, ctx.tenantId),
            eq(manualTask.connectorKind, 'HR'),
            eq(manualTask.status, 'OPEN'),
            isNull(manualTask.eventId),
          ),
        );
      if (open) taskId = open.id;
      else {
        const [t] = await tx
          .insert(manualTask)
          .values({
            tenantId: ctx.tenantId,
            connectorKind: 'HR',
            title: 'HR feed: apply starters, leavers and delegate changes by hand',
            instructions:
              `${providerLabel} cannot be reached (${error}). Until it is back, create starters, switch off leavers and ` +
              'change delegations from Users & roles and Delegations, then run the feed again: events already done by hand are recognised and not repeated.',
            payloadSummary: { reason, error },
            createdAt: now,
          })
          .returning();
        taskId = t!.id;
      }
      await d.audit.record(tx, ctx, {
        action: 'hr.feed_failed',
        entityType: 'connector',
        entityId: conn.id,
        result: 'FAILED',
        after: { source: 'HR', reason, error },
      });
    }
    return {
      ...base,
      ok: false,
      batchRef: null,
      results: [],
      counts: {},
      reason,
      error,
      manualTaskId: taskId,
    };
  }
  const batch = pulled.value;
  const delegations = dry ? { started: 0, expired: 0 } : await syncDelegations(tx, d, ctx, now);
  const results: EventResult[] = [];
  const known = new Map(
    (await tx.select().from(hrFeedEvent).where(eq(hrFeedEvent.tenantId, ctx.tenantId))).map((e) => [
      e.eventId,
      e,
    ]),
  );
  const c: Ctx = { tx, d, ctx, dry, now };
  for (const ev of batch.events) {
    const email = (ev.person?.email ?? ev.delegate?.delegateEmail ?? '').toLowerCase();
    const prior = known.get(ev.eventId);
    if (prior) {
      results.push({
        eventId: ev.eventId,
        type: ev.type,
        email,
        outcome: 'DUPLICATE',
        detail: `Already handled (${prior.outcome.toLowerCase().replace('_', ' ')}); nothing repeated`,
      });
      continue;
    }
    const r =
      ev.type === 'STARTER'
        ? await applyStarter(c, ev)
        : ev.type === 'ROLE_CHANGE'
          ? await applyRoleChange(c, ev)
          : ev.type === 'LEAVER'
            ? await applyLeaver(c, ev)
            : await applyDelegate(c, ev);
    results.push({ eventId: ev.eventId, type: ev.type, email, ...r });
  }
  const counts = countsOf(results);
  if (dry)
    return {
      ...base,
      ok: true,
      batchRef: batch.batchRef,
      results,
      counts,
      reason: null,
      error: null,
      manualTaskId: null,
    };

  const fresh = results.filter((r) => r.outcome !== 'DUPLICATE');
  if (fresh.length > 0) {
    let [b] = await tx
      .select()
      .from(hrFeedBatch)
      .where(and(eq(hrFeedBatch.tenantId, ctx.tenantId), eq(hrFeedBatch.batchRef, batch.batchRef)));
    if (!b)
      [b] = await tx
        .insert(hrFeedBatch)
        .values({
          tenantId: ctx.tenantId,
          batchRef: batch.batchRef,
          provider: conn.provider,
          counts,
          triggeredBy: ctx.userId,
          createdAt: now,
        })
        .returning();
    for (const r of fresh) {
      const ev = batch.events.find((e) => e.eventId === r.eventId)!;
      await tx.insert(hrFeedEvent).values({
        tenantId: ctx.tenantId,
        batchId: b!.id,
        eventId: r.eventId,
        type: r.type,
        subjectEmail: r.email,
        payload: ev as unknown as object,
        outcome: r.outcome as HrOutcome,
        detail: r.detail,
        createdAt: now,
      });
    }
  }
  // a starter whose delegation starts today is activated straight away
  const after = await syncDelegations(tx, d, ctx, now);
  delegations.started += after.started;
  delegations.expired += after.expired;
  await d.audit.record(tx, ctx, {
    action: 'hr.feed_run',
    entityType: 'connector',
    entityId: conn.id,
    after: { source: 'HR', batch: batch.batchRef, counts },
  });
  // the activation links are shown once, to the administrator who ran the feed
  return {
    ...base,
    delegations,
    ok: true,
    batchRef: batch.batchRef,
    results,
    counts,
    reason: null,
    error: null,
    manualTaskId: null,
  };
}

// ---------------------------------------------------------------- reading
export async function hrOverview(tx: Tx, tenantId: string, now: Date) {
  const batches = await tx
    .select()
    .from(hrFeedBatch)
    .where(eq(hrFeedBatch.tenantId, tenantId))
    .orderBy(desc(hrFeedBatch.createdAt));
  const events = await tx
    .select()
    .from(hrFeedEvent)
    .where(eq(hrFeedEvent.tenantId, tenantId))
    .orderBy(desc(hrFeedEvent.createdAt), desc(hrFeedEvent.eventId))
    .limit(200);
  const changes = await tx
    .select()
    .from(hrDelegateChange)
    .where(eq(hrDelegateChange.tenantId, tenantId))
    .orderBy(desc(hrDelegateChange.createdAt));
  const re = await tx
    .select()
    .from(hrReassignment)
    .where(eq(hrReassignment.tenantId, tenantId))
    .orderBy(desc(hrReassignment.createdAt));
  const ids = new Set<string>();
  for (const x of changes) ids.add(x.delegateId).add(x.delegatorId);
  for (const x of re) {
    ids.add(x.leaverId);
    if (x.backupId) ids.add(x.backupId);
  }
  const users = ids.size
    ? await tx
        .select({ id: appUser.id, name: appUser.name, email: appUser.email })
        .from(appUser)
        .where(inArray(appUser.id, [...ids]))
    : [];
  const nm = (id: string | null) => users.find((u) => u.id === id)?.name ?? null;
  const next = await nextBatchNumber(tx, tenantId);
  const created = events
    .filter((e) => e.type === 'STARTER' && e.outcome === 'APPLIED')
    .map((e) => e.subjectEmail);
  const starters = created.length
    ? await tx
        .select({ id: appUser.id, email: appUser.email, name: appUser.name, active: appUser.active })
        .from(appUser)
        .where(and(eq(appUser.tenantId, tenantId), inArray(appUser.email, created)))
    : [];
  const pending = starters.length
    ? await tx
        .select()
        .from(supplierActivation)
        .where(and(eq(supplierActivation.tenantId, tenantId), isNull(supplierActivation.usedAt)))
    : [];
  return {
    simulated: true,
    nextBatch: next <= HR_BATCHES ? next : null,
    totalBatches: HR_BATCHES,
    batches: batches.map((b) => ({
      id: b.id,
      batchRef: b.batchRef,
      provider: b.provider,
      counts: b.counts,
      at: b.createdAt.toISOString(),
    })),
    events: events.map((e) => ({
      id: e.id,
      eventId: e.eventId,
      type: e.type,
      email: e.subjectEmail,
      outcome: e.outcome,
      detail: e.detail,
      at: e.createdAt.toISOString(),
    })),
    exceptions: events
      .filter((e) => ['NEEDS_HUMAN', 'REFUSED', 'CAPPED'].includes(e.outcome))
      .map((e) => ({
        eventId: e.eventId,
        type: e.type,
        email: e.subjectEmail,
        outcome: e.outcome,
        detail: e.detail,
      })),
    delegations: changes.map((x) => ({
      id: x.id,
      eventId: x.eventId,
      delegator: nm(x.delegatorId),
      delegate: nm(x.delegateId),
      scope: x.scope,
      requestedLimit: Number(x.requestedLimit),
      appliedLimit: Number(x.appliedLimit),
      startsOn: x.startsOn,
      endsOn: x.endsOn,
      status: x.status,
    })),
    reassignments: re.map((x) => ({
      id: x.id,
      leaver: nm(x.leaverId),
      backup: nm(x.backupId),
      kind: x.kind,
      label: x.label,
      status: x.status,
      eventId: x.eventId,
    })),
    starters: starters.map((s) => ({
      id: s.id,
      email: s.email,
      name: s.name,
      active: s.active,
      awaitingActivation: pending.some((p) => p.userId === s.id && p.expiresAt > now),
    })),
  };
}
