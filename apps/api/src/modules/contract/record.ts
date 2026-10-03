/**
 * The contract record and its alert engine (M11, US-CMG-01/02). The record is created in the same transaction that
 * executes (locks) the contract; alerts are fired by `AlertService.runDue`, which uses the injected clock so that the
 * tests can travel in time, and is safe to run any number of times (each alert fires once).
 */
import { and, eq, inArray, isNull, lte } from 'drizzle-orm';
import type { Clock } from '@if/shared';
import type { AuditService } from '../../audit/audit-service.js';
import { withSystem, type Database, type RequestContext, type Tx } from '../../db/client.js';
import {
  alert,
  alertDelivery,
  appUser,
  contract,
  contractExtension,
  contractMilestone,
  fieldValue,
  notification,
  request,
  roleAssignment,
  tender,
  tenant,
} from '../../db/schema.js';
import { daysBetween, defaultMilestones, iso, leadsFrom, scheduleAlerts } from './dates.js';

type ContractRow = typeof contract.$inferSelect;

/** The contract owner named on the request (matched by name), else the first contract manager. */
export async function resolveOwner(
  tx: Tx,
  tenantId: string,
  tenderId: string | null,
): Promise<string | null> {
  if (tenderId) {
    const [t] = await tx.select().from(tender).where(eq(tender.id, tenderId));
    if (t) {
      const [f] = await tx
        .select()
        .from(fieldValue)
        .where(
          and(
            eq(fieldValue.ownerType, 'REQUEST'),
            eq(fieldValue.ownerId, t.requestId),
            eq(fieldValue.key, 'contractOwner'),
          ),
        );
      const name = (f?.value ?? '').trim().toLowerCase();
      if (name) {
        const people = await tx.select().from(appUser).where(eq(appUser.tenantId, tenantId));
        const hit = people.find((u) => u.name.toLowerCase() === name);
        if (hit) return hit.id;
      }
    }
  }
  const [mgr] = await tx
    .select({ userId: roleAssignment.userId })
    .from(roleAssignment)
    .where(and(eq(roleAssignment.tenantId, tenantId), eq(roleAssignment.role, 'CONTRACT_MGR')));
  return mgr?.userId ?? null;
}

/**
 * Populates the management record of an executed contract: owner, milestones, optional extensions and the system
 * alerts (notice 150 days before the end for a 90-day notice period, expiry, extension decision, milestones).
 * With `pastAsSent` the alerts already due are recorded as sent without delivery (used for seeded history).
 */
export async function createContractRecord(
  tx: Tx,
  c: ContractRow,
  opts: { extensions: number[]; today: string; pastAsSent?: boolean; ownerId?: string | null },
) {
  const ownerId = opts.ownerId === undefined ? await resolveOwner(tx, c.tenantId, c.tenderId) : opts.ownerId;
  if (ownerId) await tx.update(contract).set({ ownerId }).where(eq(contract.id, c.id));
  const milestones = defaultMilestones(c.startDate!, c.endDate!);
  for (const m of milestones)
    await tx.insert(contractMilestone).values({ tenantId: c.tenantId, contractId: c.id, ...m });
  for (const [i, months] of opts.extensions.entries())
    await tx
      .insert(contractExtension)
      .values({ tenantId: c.tenantId, contractId: c.id, months, position: i + 1 });
  const [tn] = await tx.select({ config: tenant.config }).from(tenant).where(eq(tenant.id, c.tenantId));
  const alerts = scheduleAlerts(
    { endDate: c.endDate!, noticeDays: c.noticeDays, milestones, extensions: opts.extensions },
    opts.today,
    leadsFrom(tn?.config),
  );
  for (const a of alerts)
    await tx
      .insert(alert)
      .values({
        tenantId: c.tenantId,
        contractId: c.id,
        kind: a.kind,
        triggerDate: a.triggerDate,
        origin: 'SYSTEM',
        ...(opts.pastAsSent && a.triggerDate < opts.today ? { status: 'SENT' as const } : {}),
      })
      .onConflictDoNothing();
  return { ownerId, milestones, alerts };
}

/** The end date that counts: the contract's own, or a later one set by an executed variation. */
export async function effectiveEnd(tx: Tx, c: ContractRow): Promise<string | null> {
  const kids = await tx
    .select({ endDate: contract.endDate })
    .from(contract)
    .where(and(eq(contract.parentId, c.id), eq(contract.status, 'EXECUTED'), isNull(contract.deletedAt)));
  return (
    [c.endDate, ...kids.map((k) => k.endDate)]
      .filter((x): x is string => !!x)
      .sort()
      .at(-1) ?? null
  );
}

/**
 * Recomputes the scheduled system alerts after the record changed (milestones, extensions, a variation, new lead
 * times). Alerts already sent stay as history; scheduled ones are replaced.
 */
export async function rescheduleAlerts(tx: Tx, c: ContractRow, today: string) {
  const end = (await effectiveEnd(tx, c)) ?? c.endDate!;
  const milestones = await tx
    .select({ title: contractMilestone.title, dueDate: contractMilestone.dueDate })
    .from(contractMilestone)
    .where(eq(contractMilestone.contractId, c.id));
  const ext = await tx
    .select({ months: contractExtension.months })
    .from(contractExtension)
    .where(eq(contractExtension.contractId, c.id));
  const [tn] = await tx.select({ config: tenant.config }).from(tenant).where(eq(tenant.id, c.tenantId));
  await tx
    .delete(alert)
    .where(and(eq(alert.contractId, c.id), eq(alert.origin, 'SYSTEM'), eq(alert.status, 'SCHEDULED')));
  const planned = scheduleAlerts(
    { endDate: end, noticeDays: c.noticeDays, milestones, extensions: ext.map((e) => e.months) },
    today,
    leadsFrom(tn?.config),
  );
  for (const a of planned)
    await tx
      .insert(alert)
      .values({
        tenantId: c.tenantId,
        contractId: c.id,
        kind: a.kind,
        triggerDate: a.triggerDate,
        origin: 'SYSTEM',
      })
      .onConflictDoNothing();
  return planned.length;
}

const WHAT: Record<string, string> = {
  NOTICE: 'The last date to give notice is approaching',
  EXPIRY: 'The contract is about to end',
  EXTENSION: 'Decide whether to take up the optional extension',
  MILESTONE: 'A milestone is coming up',
  CUSTOM: 'Your reminder',
};

export class AlertService {
  constructor(
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  /** Fires every scheduled alert whose date has come. Returns how many fired in this run. */
  async runDue(database: Database): Promise<number> {
    const today = iso(this.clock.now());
    const now = this.clock.now();
    return withSystem(database, async (tx) => {
      const due = await tx
        .select()
        .from(alert)
        .where(and(eq(alert.status, 'SCHEDULED'), lte(alert.triggerDate, today)));
      let fired = 0;
      for (const a of due) {
        const [c] = await tx.select().from(contract).where(eq(contract.id, a.contractId));
        if (!c || c.deletedAt) {
          await tx.update(alert).set({ status: 'CANCELLED' }).where(eq(alert.id, a.id));
          continue;
        }
        // Compare-and-set: whoever flips SCHEDULED to SENT first delivers; a concurrent or repeated run does nothing.
        const won = await tx
          .update(alert)
          .set({ status: 'SENT', sentAt: now })
          .where(and(eq(alert.id, a.id), eq(alert.status, 'SCHEDULED')))
          .returning({ id: alert.id });
        if (won.length === 0) continue;
        const recipients = await this.recipients(tx, c, a);
        const [req] = c.tenderId
          ? await tx
              .select({ number: request.number, title: request.title })
              .from(tender)
              .innerJoin(request, eq(request.id, tender.requestId))
              .where(eq(tender.id, c.tenderId))
          : [];
        const left = daysBetween(today, c.endDate!);
        const body = `${c.number}${req ? ` ${req.title}` : ''}: ${a.note ? `Your reminder: "${a.note}"` : (WHAT[a.kind] ?? a.kind)}. ${
          left >= 0
            ? `The contract ends in ${left} day(s) on ${c.endDate}.`
            : `The contract ended on ${c.endDate}.`
        }`;
        for (const userId of recipients) {
          await tx.insert(notification).values({
            tenantId: c.tenantId,
            userId,
            title: `Contract alert: ${a.kind.toLowerCase()}`,
            body,
            link: `/app/contracts/${c.id}`,
          });
          await tx.insert(alertDelivery).values([
            {
              tenantId: c.tenantId,
              alertId: a.id,
              userId,
              channel: 'IN_APP',
              status: 'DELIVERED',
              deliveredAt: now,
            },
            // No mail server in the proof of concept: the email is recorded as simulated (docs/swap-points.md).
            {
              tenantId: c.tenantId,
              alertId: a.id,
              userId,
              channel: 'EMAIL',
              status: 'SIMULATED',
              deliveredAt: now,
            },
          ]);
        }
        const ctx: RequestContext = { tenantId: c.tenantId, userId: null, role: 'SYSTEM' };
        await this.audit.record(tx, ctx, {
          action: 'alert.fire',
          entityType: 'contract',
          entityId: c.id,
          after: { alertId: a.id, kind: a.kind, triggerDate: a.triggerDate, recipients: recipients.length },
        });
        fired += 1;
      }
      return fired;
    });
  }

  /**
   * The recipient rule is resolved when the alert fires, not when it was created. System alerts go to the contract
   * owner (else the contract managers). A custom alert goes to its author plus whoever the rule adds: their manager
   * as it is at that moment, or everyone holding a named role.
   */
  private async recipients(tx: Tx, c: ContractRow, a: typeof alert.$inferSelect): Promise<string[]> {
    if (a.origin === 'USER' && a.createdBy) {
      const out = new Set<string>([a.createdBy]);
      for (const part of a.recipientRule.split('+').slice(1)) {
        if (part === 'MANAGER') {
          const m = await resolveManager(tx, c.tenantId, a.createdBy);
          if (m) out.add(m);
        } else if (part.startsWith('ROLE:')) {
          const rows = await tx
            .select({ userId: roleAssignment.userId })
            .from(roleAssignment)
            .where(
              and(eq(roleAssignment.tenantId, c.tenantId), eq(roleAssignment.role, part.slice(5) as never)),
            );
          for (const r of rows) out.add(r.userId);
        }
      }
      return [...out];
    }
    return this.ownerRecipients(tx, c);
  }

  private async ownerRecipients(tx: Tx, c: ContractRow): Promise<string[]> {
    if (c.ownerId) {
      const [u] = await tx.select({ id: appUser.id }).from(appUser).where(eq(appUser.id, c.ownerId));
      if (u) return [u.id];
    }
    const mgrs = await tx
      .select({ userId: roleAssignment.userId })
      .from(roleAssignment)
      .where(and(eq(roleAssignment.tenantId, c.tenantId), inArray(roleAssignment.role, ['CONTRACT_MGR'])));
    return [...new Set(mgrs.map((m) => m.userId))];
  }
}

/**
 * "My manager": the nearest delegate or executive in the person's own organisation unit or the units above it, else any
 * delegate. The proof of concept has no reporting lines, so this stands in for them (docs/swap-points.md).
 */
export async function resolveManager(tx: Tx, tenantId: string, userId: string): Promise<string | null> {
  const people = await tx.select().from(appUser).where(eq(appUser.tenantId, tenantId));
  const roles = await tx
    .select({ userId: roleAssignment.userId, role: roleAssignment.role })
    .from(roleAssignment)
    .where(and(eq(roleAssignment.tenantId, tenantId), inArray(roleAssignment.role, ['DELEGATE', 'EXEC'])));
  const approvers = people.filter((p) => p.id !== userId && roles.some((r) => r.userId === p.id));
  const me = people.find((p) => p.id === userId);
  return (
    approvers.find(
      (p) =>
        me?.orgUnitId &&
        p.orgUnitId === me.orgUnitId &&
        roles.some((r) => r.userId === p.id && r.role === 'DELEGATE'),
    )?.id ??
    approvers.find((p) => roles.some((r) => r.userId === p.id && r.role === 'DELEGATE'))?.id ??
    approvers[0]?.id ??
    null
  );
}
