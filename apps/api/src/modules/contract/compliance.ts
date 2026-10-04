/**
 * Compliance monitoring on executed contracts (FR-0550, FR-0510): supplier insurance is watched; when mandatory cover
 * has lapsed without an updated certificate a hold is placed that blocks new purchase orders, and it is lifted by
 * itself when a current certificate is recorded. A fixed warning goes out 30 days before a certificate expires.
 * Runs with the alert scheduler and whenever the alerts are read, and is safe to run any number of times.
 */
import { and, eq, inArray, isNull, lt } from 'drizzle-orm';
import type { AuditService } from '../../audit/audit-service.js';
import type { RequestContext, Tx } from '../../db/client.js';
import {
  alert,
  contract,
  contractHold,
  contractRebate,
  invoice,
  notification,
  roleAssignment,
  supplier,
} from '../../db/schema.js';
import { evaluateRebate, insuranceAlertDate } from './b5-rules.js';

type ContractRow = typeof contract.$inferSelect;
type SupplierRow = typeof supplier.$inferSelect;

/** Cover has lapsed when the certificate on record is past its expiry date. */
export const coverLapsed = (s: Pick<SupplierRow, 'insuranceExpiresOn' | 'insuranceStatus'>, today: string) =>
  s.insuranceExpiresOn ? s.insuranceExpiresOn < today : s.insuranceStatus === 'EXPIRED';

async function tell(tx: Tx, c: ContractRow, roles: string[], title: string, body: string) {
  const rows = await tx
    .select({ userId: roleAssignment.userId })
    .from(roleAssignment)
    .where(and(eq(roleAssignment.tenantId, c.tenantId), inArray(roleAssignment.role, roles as never[])));
  const ids = new Set(rows.map((r) => r.userId));
  if (c.ownerId) ids.add(c.ownerId);
  for (const userId of ids)
    await tx.insert(notification).values({
      tenantId: c.tenantId,
      userId,
      title,
      body,
      link: `/app/contracts/${c.id}`,
    });
}

export async function activeHold(tx: Tx, contractId: string) {
  const [h] = await tx
    .select()
    .from(contractHold)
    .where(and(eq(contractHold.contractId, contractId), isNull(contractHold.releasedAt)));
  return h ?? null;
}

/** Brings one contract's hold and insurance warning in line with the supplier's certificate. */
export async function syncContractCompliance(
  tx: Tx,
  audit: AuditService,
  c: ContractRow,
  s: SupplierRow,
  now: Date,
) {
  const today = now.toISOString().slice(0, 10);
  const ctx: RequestContext = { tenantId: c.tenantId, userId: null, role: 'SYSTEM' };
  const hold = await activeHold(tx, c.id);
  const lapsed = coverLapsed(s, today);
  let placed = 0;
  let released = 0;
  if (lapsed && !hold) {
    const reason = s.insuranceExpiresOn
      ? `Mandatory insurance cover lapsed on ${s.insuranceExpiresOn} and no updated certificate has been recorded`
      : 'Mandatory insurance cover has lapsed and no updated certificate has been recorded';
    await tx
      .insert(contractHold)
      .values({ tenantId: c.tenantId, contractId: c.id, kind: 'INSURANCE', reason, placedAt: now });
    await audit.record(tx, ctx, {
      action: 'contract.hold_placed',
      entityType: 'contract',
      entityId: c.id,
      after: { kind: 'INSURANCE', reason },
    });
    await tell(
      tx,
      c,
      ['PROCUREMENT', 'FINANCE', 'CONTRACT_MGR'],
      'Purchase orders on hold',
      `${c.number}: ${reason}. New purchase orders are blocked until the supplier gives a current certificate.`,
    );
    placed = 1;
  } else if (!lapsed && hold) {
    await tx
      .update(contractHold)
      .set({
        releasedAt: now,
        releaseNote: s.insuranceExpiresOn
          ? `A current certificate is on record (expires ${s.insuranceExpiresOn})`
          : 'A current certificate is on record',
      })
      .where(eq(contractHold.id, hold.id));
    await audit.record(tx, ctx, {
      action: 'contract.hold_released',
      entityType: 'contract',
      entityId: c.id,
      after: { kind: 'INSURANCE', expiresOn: s.insuranceExpiresOn },
    });
    await tell(
      tx,
      c,
      ['PROCUREMENT', 'FINANCE', 'CONTRACT_MGR'],
      'Purchase order hold lifted',
      `${c.number}: an updated insurance certificate is on record, so purchase orders can be raised again.`,
    );
    released = 1;
  }

  // the fixed warning, 30 days before the certificate expires; a renewed certificate moves it
  const want =
    !lapsed && s.insuranceExpiresOn
      ? (() => {
          const d = insuranceAlertDate(s.insuranceExpiresOn);
          return d < today ? today : d;
        })()
      : null;
  const scheduled = await tx
    .select()
    .from(alert)
    .where(and(eq(alert.contractId, c.id), eq(alert.kind, 'INSURANCE'), eq(alert.status, 'SCHEDULED')));
  for (const a of scheduled)
    if (a.triggerDate !== want) await tx.update(alert).set({ status: 'CANCELLED' }).where(eq(alert.id, a.id));
  if (want && !scheduled.some((a) => a.triggerDate === want)) {
    const [sent] = await tx
      .select({ id: alert.id })
      .from(alert)
      .where(
        and(
          eq(alert.contractId, c.id),
          eq(alert.kind, 'INSURANCE'),
          eq(alert.origin, 'SYSTEM'),
          eq(alert.triggerDate, want),
        ),
      );
    if (!sent)
      await tx.insert(alert).values({
        tenantId: c.tenantId,
        contractId: c.id,
        kind: 'INSURANCE',
        triggerDate: want,
        origin: 'SYSTEM',
        note: `The supplier's insurance certificate expires on ${s.insuranceExpiresOn}`,
      });
  }
  return { placed, released };
}

/** Every executed contract that carries cover: the whole platform, run by the scheduler. */
export async function runComplianceSweep(tx: Tx, audit: AuditService, now: Date) {
  const rows = await tx
    .select({ c: contract, s: supplier })
    .from(contract)
    .innerJoin(supplier, eq(supplier.id, contract.supplierId))
    .where(and(eq(contract.status, 'EXECUTED'), isNull(contract.deletedAt), isNull(contract.parentId)));
  let changed = 0;
  for (const r of rows) {
    if (!['CONTRACT', 'MASTER'].includes(r.c.docType)) continue;
    const x = await syncContractCompliance(tx, audit, r.c, r.s, now);
    changed += x.placed + x.released;
  }
  changed += await sweepRebates(tx, audit, now);
  return changed;
}

/**
 * Looks at every rebate whose period has ended: one that was earned and never claimed, or claimed in part, is flagged
 * for follow-up once, with a notice to finance and the contract owner (FR-0520).
 */
export async function sweepRebates(tx: Tx, audit: AuditService, now: Date) {
  const today = now.toISOString().slice(0, 10);
  const rows = await tx
    .select({ r: contractRebate, c: contract })
    .from(contractRebate)
    .innerJoin(contract, eq(contract.id, contractRebate.contractId))
    .where(
      and(
        isNull(contractRebate.followedUpAt),
        lt(contractRebate.periodEnd, today),
        isNull(contract.deletedAt),
      ),
    );
  let flagged = 0;
  for (const { r, c } of rows) {
    const inv = await tx
      .select()
      .from(invoice)
      .where(and(eq(invoice.contractId, c.id), inArray(invoice.status, ['MATCHED', 'EXCEPTION', 'PAID'])));
    const spend = inv
      .filter((i) => i.invoiceDate >= r.periodStart && i.invoiceDate <= r.periodEnd)
      .reduce((s, i) => s + Number(i.amount), 0);
    const e = evaluateRebate(
      {
        threshold: Number(r.threshold),
        ratePct: Number(r.ratePct),
        periodStart: r.periodStart,
        periodEnd: r.periodEnd,
        claimed: Number(r.claimed),
      },
      spend,
      today,
    );
    if (!e.flagged) continue;
    await tx.update(contractRebate).set({ followedUpAt: now }).where(eq(contractRebate.id, r.id));
    await audit.record(
      tx,
      { tenantId: c.tenantId, userId: null, role: 'SYSTEM' },
      {
        action: 'contract.rebate_flagged',
        entityType: 'contract',
        entityId: c.id,
        after: {
          rebate: r.title,
          status: e.status,
          earned: e.earned,
          claimed: e.claimed,
          shortfall: e.shortfall,
        },
      },
    );
    await tell(
      tx,
      c,
      ['FINANCE', 'CONTRACT_MGR'],
      `Rebate to follow up: ${r.title}`,
      `${c.number}: ${e.message}.`,
    );
    flagged += 1;
  }
  return flagged;
}
