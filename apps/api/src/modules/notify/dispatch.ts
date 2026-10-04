/**
 * Notification dispatch and approval-timeout escalation (FR-0065, FR-0066).
 *
 * `dispatch` writes one in-app notification per recipient and, for every other channel the tenant has switched on
 * (email, Slack, Teams), one delivery record. Delivery is SIMULATED in the proof of concept: the record says what would
 * have been sent and to whom (swap point: docs/swap-points.md, "Email and chat").
 *
 * `EscalationService.runDue` finds approvals that have waited longer than the configured period (default 48 hours),
 * tells the approver's manager once (idempotent: a unique row per item and level) and dispatches on every channel.
 * "Manager" is a stand-in until the identity provider supplies the reporting line: the executive role.
 */
import { and, eq, inArray, lt } from 'drizzle-orm';
import type { Clock, RoleName } from '@if/shared';
import type { AuditService } from '../../audit/audit-service.js';
import { withSystem, type Database, type Tx } from '../../db/client.js';
import {
  appUser,
  contract,
  escalation,
  evalReport,
  evaluation,
  notification,
  notificationDelivery,
  plan,
  request,
  roleAssignment,
  tender,
  tenant,
} from '../../db/schema.js';
import { settingsFrom, type Settings } from '../settings/settings.js';

export type NotifyEvent = Settings['notifications']['rules'][number]['event'];

export interface DispatchInput {
  tenantId: string;
  recipients: readonly string[];
  title: string;
  body?: string;
  link?: string;
  /** When set, the tenant's notification rules decide whether this is sent at all. */
  event?: NotifyEvent;
}

/** Returns how many people were notified (0 when the rule for the event is switched off). */
export async function dispatch(tx: Tx, input: DispatchInput, settings: Settings): Promise<number> {
  const rule = input.event ? settings.notifications.rules.find((r) => r.event === input.event) : undefined;
  if (rule && !rule.enabled) return 0;
  const unique = [...new Set(input.recipients)];
  for (const userId of unique) {
    const [n] = await tx
      .insert(notification)
      .values({
        tenantId: input.tenantId,
        userId,
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
        event: input.event ?? null,
      })
      .returning({ id: notification.id });
    const [u] = await tx.select({ email: appUser.email }).from(appUser).where(eq(appUser.id, userId));
    for (const channel of settings.notifications.channels) {
      if (channel === 'IN_APP') continue;
      await tx.insert(notificationDelivery).values({
        tenantId: input.tenantId,
        notificationId: n!.id,
        channel,
        status: 'SENT',
        detail: `Simulated ${channel.toLowerCase()} message to ${channel === 'EMAIL' ? (u?.email ?? 'the recipient') : 'the recipient'}: ${input.title}`,
      });
    }
  }
  return unique.length;
}

export const usersWithRole = async (tx: Tx, tenantId: string, roles: RoleName[]): Promise<string[]> =>
  (
    await tx
      .select({ userId: roleAssignment.userId })
      .from(roleAssignment)
      .where(and(eq(roleAssignment.tenantId, tenantId), inArray(roleAssignment.role, roles)))
  ).map((r) => r.userId);

interface Waiting {
  type: 'plan' | 'tender' | 'report' | 'contract';
  id: string;
  label: string;
  link: string;
  since: Date;
}

export class EscalationService {
  constructor(
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  /** Escalates every approval that has waited too long. Returns how many escalations were raised in this run. */
  async runDue(database: Database): Promise<number> {
    const now = this.clock.now();
    return withSystem(database, async (tx) => {
      let raised = 0;
      for (const t of await tx.select().from(tenant)) {
        const settings = settingsFrom(t.config);
        const rule = settings.notifications.rules.find((r) => r.event === 'APPROVAL_TIMEOUT');
        if (rule && !rule.enabled) continue;
        const cutoff = new Date(now.getTime() - settings.notifications.escalationHours * 3_600_000);
        const waiting: Waiting[] = [];

        for (const p of await tx
          .select({
            id: plan.id,
            requestId: plan.requestId,
            since: plan.updatedAt,
            number: request.number,
            title: request.title,
          })
          .from(plan)
          .innerJoin(request, eq(request.id, plan.requestId))
          .where(
            and(eq(plan.tenantId, t.id), eq(plan.status, 'AWAITING_APPROVAL'), lt(plan.updatedAt, cutoff)),
          ))
          waiting.push({
            type: 'plan',
            id: p.id,
            label: `Plan ${p.number} ${p.title}`,
            link: `/app/plans/${p.requestId}`,
            since: p.since,
          });

        for (const x of await tx
          .select({ id: tender.id, since: tender.updatedAt, number: request.number, title: request.title })
          .from(tender)
          .innerJoin(request, eq(request.id, tender.requestId))
          .where(and(eq(tender.tenantId, t.id), eq(tender.status, 'STAGED'), lt(tender.updatedAt, cutoff))))
          waiting.push({
            type: 'tender',
            id: x.id,
            label: `Permission to publish ${x.number} ${x.title}`,
            link: `/app/tenders/${x.id}`,
            since: x.since,
          });

        for (const r of await tx
          .select({
            id: evalReport.id,
            evaluationId: evalReport.evaluationId,
            since: evalReport.generatedAt,
            number: request.number,
            title: request.title,
          })
          .from(evalReport)
          .innerJoin(evaluation, eq(evaluation.id, evalReport.evaluationId))
          .innerJoin(tender, eq(tender.id, evaluation.tenderId))
          .innerJoin(request, eq(request.id, tender.requestId))
          .where(
            and(
              eq(evalReport.tenantId, t.id),
              eq(evalReport.status, 'AWAITING_APPROVAL'),
              lt(evalReport.generatedAt, cutoff),
            ),
          ))
          waiting.push({
            type: 'report',
            id: r.id,
            label: `Evaluation report ${r.number} ${r.title}`,
            link: `/app/evaluations/${r.evaluationId}`,
            since: r.since,
          });

        for (const c of await tx
          .select({ id: contract.id, number: contract.number, since: contract.updatedAt })
          .from(contract)
          .where(
            and(
              eq(contract.tenantId, t.id),
              eq(contract.status, 'AWAITING_SIGNATURE'),
              lt(contract.updatedAt, cutoff),
            ),
          ))
          waiting.push({
            type: 'contract',
            id: c.id,
            label: `Contract ${c.number} awaiting signature`,
            link: `/app/contracts/${c.id}`,
            since: c.since,
          });

        if (waiting.length === 0) continue;
        const managers = await usersWithRole(tx, t.id, ['EXEC']);
        if (managers.length === 0) continue;
        for (const w of waiting) {
          // one escalation per item and level: the unique row is the compare-and-set that makes a repeat run a no-op
          const won = await tx
            .insert(escalation)
            .values({
              tenantId: t.id,
              entityType: w.type,
              entityId: w.id,
              level: 1,
              notifiedUserId: managers[0]!,
            })
            .onConflictDoNothing()
            .returning({ id: escalation.id });
          if (won.length === 0) continue;
          const hours = Math.floor((now.getTime() - w.since.getTime()) / 3_600_000);
          await dispatch(
            tx,
            {
              tenantId: t.id,
              recipients: managers,
              event: 'APPROVAL_TIMEOUT',
              title: `Escalation: waiting ${hours} hours`,
              body: `${w.label} has been waiting for approval for ${hours} hours (limit ${settings.notifications.escalationHours}).`,
              link: w.link,
            },
            settings,
          );
          await this.audit.record(
            tx,
            { tenantId: t.id, userId: null, role: 'SYSTEM' },
            {
              action: 'approval.escalated',
              entityType: w.type,
              entityId: w.id,
              after: {
                waitingHours: hours,
                limitHours: settings.notifications.escalationHours,
                notified: managers.length,
              },
            },
          );
          raised++;
        }
      }
      return raised;
    });
  }
}
