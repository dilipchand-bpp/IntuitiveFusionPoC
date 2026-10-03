/**
 * The contract record and its alert engine (M11, US-CMG-01/02). The record is created in the same transaction that
 * executes (locks) the contract; alerts are fired by `AlertService.runDue`, which uses the injected clock so that the
 * tests can travel in time, and is safe to run any number of times (each alert fires once).
 */
import { and, eq, inArray, lte } from 'drizzle-orm';
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
} from '../../db/schema.js';
import { daysBetween, defaultMilestones, iso, scheduleAlerts } from './dates.js';

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
  const alerts = scheduleAlerts(
    { endDate: c.endDate!, noticeDays: c.noticeDays, milestones, extensions: opts.extensions },
    opts.today,
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
        const recipients = await this.recipients(tx, c);
        const [req] = c.tenderId
          ? await tx
              .select({ number: request.number, title: request.title })
              .from(tender)
              .innerJoin(request, eq(request.id, tender.requestId))
              .where(eq(tender.id, c.tenderId))
          : [];
        const left = daysBetween(today, c.endDate!);
        const body = `${c.number}${req ? ` ${req.title}` : ''}: ${WHAT[a.kind] ?? a.kind}. ${
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

  /** The recipient rule is resolved when the alert fires, not when it was created. */
  private async recipients(tx: Tx, c: ContractRow): Promise<string[]> {
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
