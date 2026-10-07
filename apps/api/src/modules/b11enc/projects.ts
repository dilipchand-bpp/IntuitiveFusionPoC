/**
 * Restricted projects (FR-0865). A procurement marked restricted is invisible outside its sourcing group: the requester, the
 * assigned procurement manager or reviewer, the person who restricted it, the evaluation panel, the probity adviser allocated
 * to its tender and named delegates. Everyone else gets 404 (never 403) because the database itself hides the rows (row level
 * security policies request_scope, plan_scope, tender_scope, evaluation_scope, contract_scope call b11_can_see_request in
 * migration 0024), and every list, count, search and report built on those tables simply does not contain it.
 *
 * Its plan text, evaluation report narrative, tender text and documents are encrypted with a per-project data key that is
 * itself wrapped by the tenant PROJECT key (keys.ts), so the stored text is unreadable without both the key service and
 * membership of the group.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { AuditService } from '../../audit/audit-service.js';
import type { RequestContext, Tx } from '../../db/client.js';
import {
  contract,
  contractFile,
  evalReport,
  evaluation,
  fieldValue,
  plan,
  probityDocument,
  request,
  restrictedDelegate,
  restrictedProject,
  tender,
} from '../../db/schema.js';
import { AppError } from '../../http/errors.js';
import { PLAN_FIELDS } from '../plan/fields.js';
import { REPORT_SECTIONS } from '../evaluation/report.js';
import type { SealedStore } from '../tender/files.js';
import {
  isProjectText,
  newWrappedDek,
  openWithDek,
  rewrapWrapped,
  sealWithDek,
  unwrapDek,
  type Rewrapper,
} from './keys.js';

const PLAN_KEYS = new Set<string>([...PLAN_FIELDS.map((f) => f.key), '_undo']);
const REPORT_KEYS = new Set<string>(REPORT_SECTIONS.map((x) => x.key));
const ctxOf = (kind: string, ownerId: string, key: string) => `project|${kind}|${ownerId}|${key}`;

/** The project's data key, or null when the procurement is not restricted (or not visible to the caller). */
export async function projectDek(tx: Tx, tenantId: string, requestId: string): Promise<Buffer | null> {
  const [rp] = await tx.select().from(restrictedProject).where(eq(restrictedProject.requestId, requestId));
  if (!rp) return null;
  return unwrapDek(tx, tenantId, rp);
}

/** Seals text for a field of an owner record when its procurement is restricted; otherwise returns it untouched. */
export async function sealField(
  tx: Tx,
  tenantId: string,
  requestId: string,
  owner: { type: string; id: string; key: string },
  text: string,
): Promise<string> {
  const dek = await projectDek(tx, tenantId, requestId);
  return dek ? sealWithDek(dek, tenantId, ctxOf(owner.type, owner.id, owner.key), text) : text;
}

/** Plaintext of a stored field value (a value that is not project-encrypted is returned as it is). */
export async function openField(
  tx: Tx,
  tenantId: string,
  requestId: string,
  owner: { type: string; id: string; key: string },
  value: string | null,
): Promise<string | null> {
  if (value === null || !isProjectText(value)) return value;
  const dek = await projectDek(tx, tenantId, requestId);
  if (!dek) throw new AppError(404, 'NOT_FOUND', 'Not found');
  return openWithDek(dek, tenantId, ctxOf(owner.type, owner.id, owner.key), value);
}

/** Decrypts every project-encrypted value in a set of field rows (same owner), in place on copies. */
export async function openFieldRows<
  T extends { ownerType: string; ownerId: string; key: string; value: string | null },
>(tx: Tx, tenantId: string, requestId: string, rows: T[]): Promise<T[]> {
  if (!rows.some((r) => isProjectText(r.value))) return rows;
  const out: T[] = [];
  for (const r of rows)
    out.push({
      ...r,
      value: await openField(
        tx,
        tenantId,
        requestId,
        { type: r.ownerType, id: r.ownerId, key: r.key },
        r.value,
      ),
    });
  return out;
}

export const planSummaryContext = (planId: string) => ({ type: 'PLAN', id: planId, key: '__summary' });

export interface RestrictResult {
  requestId: string;
  restrictedAt: string;
  encrypted: { planFields: number; reportFields: number; tenderFields: number; documents: number };
}

/** Marks a procurement restricted and encrypts what it already holds. */
export async function restrictProject(
  tx: Tx,
  d: { audit: AuditService; now: Date; store: SealedStore },
  ctx: RequestContext,
  requestId: string,
  reason: string,
): Promise<RestrictResult> {
  const [r] = await tx
    .select()
    .from(request)
    .where(and(eq(request.id, requestId), eq(request.tenantId, ctx.tenantId)));
  if (!r) throw new AppError(404, 'NOT_FOUND', 'Request not found');
  const [existing] = await tx
    .select()
    .from(restrictedProject)
    .where(eq(restrictedProject.requestId, requestId));
  if (existing)
    throw new AppError(409, 'ALREADY_RESTRICTED', 'This procurement is already a restricted project');
  const k = await newWrappedDek(tx, ctx.tenantId, d.now);
  await tx.insert(restrictedProject).values({
    requestId,
    tenantId: ctx.tenantId,
    reason,
    setBy: ctx.userId!,
    setAt: d.now,
    keyVersion: k.keyVersion,
    wrappedDek: k.wrappedDek,
    iv: k.iv,
  });
  const enc = { planFields: 0, reportFields: 0, tenderFields: 0, documents: 0 };
  const sealRows = async (owner: 'PLAN' | 'EVAL_REPORT', ownerId: string, bucket: keyof typeof enc) => {
    const keys = owner === 'PLAN' ? PLAN_KEYS : REPORT_KEYS;
    const rows = await tx
      .select()
      .from(fieldValue)
      .where(and(eq(fieldValue.ownerType, owner), eq(fieldValue.ownerId, ownerId)));
    for (const f of rows) {
      if (!keys.has(f.key) || f.value === null || isProjectText(f.value)) continue;
      await tx
        .update(fieldValue)
        .set({
          value: sealWithDek(k.dek, ctx.tenantId, ctxOf(owner, ownerId, f.key), f.value),
          previousValue:
            f.previousValue === null
              ? null
              : sealWithDek(k.dek, ctx.tenantId, ctxOf(owner, ownerId, f.key), f.previousValue),
        })
        .where(eq(fieldValue.id, f.id));
      enc[bucket] += 1;
    }
  };
  const [pl] = await tx.select().from(plan).where(eq(plan.requestId, requestId));
  if (pl) {
    await sealRows('PLAN', pl.id, 'planFields');
    if (pl.summary && !isProjectText(pl.summary)) {
      const c = planSummaryContext(pl.id);
      await tx
        .update(plan)
        .set({ summary: sealWithDek(k.dek, ctx.tenantId, ctxOf(c.type, c.id, c.key), pl.summary) })
        .where(eq(plan.id, pl.id));
      enc.planFields += 1;
    }
  }
  const tenders = await tx.select().from(tender).where(eq(tender.requestId, requestId));
  for (const t of tenders) {
    const [ev] = await tx.select().from(evaluation).where(eq(evaluation.tenderId, t.id));
    if (ev) {
      const [rep] = await tx.select().from(evalReport).where(eq(evalReport.evaluationId, ev.id));
      if (rep) await sealRows('EVAL_REPORT', rep.id, 'reportFields');
      const docs = await tx.select().from(probityDocument).where(eq(probityDocument.evaluationId, ev.id));
      for (const doc of docs) {
        if (!doc.fileKey) continue;
        try {
          const bytes = await d.store.get(doc.fileKey, { tx });
          await d.store.put(doc.fileKey, bytes, { tx, purpose: 'PROJECT' });
          enc.documents += 1;
        } catch {
          /* a file missing on disk cannot be sealed */
        }
      }
    }
    const cs = await tx.select().from(contract).where(eq(contract.tenderId, t.id));
    if (cs.length) {
      const files = await tx
        .select()
        .from(contractFile)
        .where(
          inArray(
            contractFile.contractId,
            cs.map((c) => c.id),
          ),
        );
      for (const f of files) {
        try {
          const bytes = await d.store.get(f.storageKey, { tx });
          await d.store.put(f.storageKey, bytes, { tx, purpose: 'PROJECT' });
          enc.documents += 1;
        } catch {
          /* missing on disk */
        }
      }
    }
  }
  await d.audit.record(tx, ctx, {
    action: 'project.restrict',
    entityType: 'request',
    entityId: requestId,
    after: { restricted: true, reason, keyVersion: k.keyVersion, encrypted: enc },
  });
  return { requestId, restrictedAt: d.now.toISOString(), encrypted: enc };
}

export async function addDelegate(
  tx: Tx,
  d: { audit: AuditService; now: Date },
  ctx: RequestContext,
  requestId: string,
  userId: string,
): Promise<void> {
  const [rp] = await tx.select().from(restrictedProject).where(eq(restrictedProject.requestId, requestId));
  if (!rp) throw new AppError(404, 'NOT_FOUND', 'Not found');
  await tx
    .insert(restrictedDelegate)
    .values({ tenantId: ctx.tenantId, requestId, userId, addedBy: ctx.userId!, addedAt: d.now })
    .onConflictDoNothing();
  await d.audit.record(tx, ctx, {
    action: 'project.delegate_added',
    entityType: 'request',
    entityId: requestId,
    after: { userId },
  });
}

/** PROJECT re-wrap family: each project's own data key moves to the newest tenant PROJECT key version. */
export const projectRewrappers = (): Rewrapper[] => [
  async (tx, tenantId, now) => {
    const r = { family: 'restricted project keys', rewrapped: 0, alreadyCurrent: 0, skipped: 0 };
    const rows = await tx.select().from(restrictedProject).where(eq(restrictedProject.tenantId, tenantId));
    for (const row of rows) {
      const n = await rewrapWrapped(tx, tenantId, 'PROJECT', row, now);
      if (n === 'same') r.alreadyCurrent += 1;
      else if (n === 'skipped') r.skipped += 1;
      else {
        await tx
          .update(restrictedProject)
          .set({ keyVersion: n.keyVersion, wrappedDek: n.wrappedDek, iv: n.iv, rewrappedAt: now })
          .where(eq(restrictedProject.requestId, row.requestId));
        r.rewrapped += 1;
      }
    }
    return r;
  },
];

// ---------------------------------------------------------------------------------------------------- readers of owner rows
/** The procurement a field owner belongs to. */
export async function requestIdOf(tx: Tx, ownerType: string, ownerId: string): Promise<string | null> {
  if (ownerType === 'REQUEST') return ownerId;
  if (ownerType === 'PLAN')
    return (await tx.select({ r: plan.requestId }).from(plan).where(eq(plan.id, ownerId)))[0]?.r ?? null;
  if (ownerType === 'TENDER')
    return (
      (await tx.select({ r: tender.requestId }).from(tender).where(eq(tender.id, ownerId)))[0]?.r ?? null
    );
  if (ownerType === 'EVAL_REPORT') {
    const [row] = await tx
      .select({ r: tender.requestId })
      .from(evalReport)
      .innerJoin(evaluation, eq(evaluation.id, evalReport.evaluationId))
      .innerJoin(tender, eq(tender.id, evaluation.tenderId))
      .where(eq(evalReport.id, ownerId));
    return row?.r ?? null;
  }
  return null;
}

/** Decrypts project-encrypted values in rows of one owner; rows of an unrestricted procurement are returned untouched. */
export async function openOwnerRows<
  T extends { ownerType: string; ownerId: string; key: string; value: string | null },
>(tx: Tx, tenantId: string, rows: T[]): Promise<T[]> {
  const first = rows.find((r) => isProjectText(r.value));
  if (!first) return rows;
  const rid = await requestIdOf(tx, first.ownerType, first.ownerId);
  return rid ? openFieldRows(tx, tenantId, rid, rows) : rows;
}

/** A document-version snapshot is stored sealed for a restricted project (the version table must not hold its text in clear). */
export async function sealSnapshot(
  tx: Tx,
  tenantId: string,
  ownerType: string,
  ownerId: string,
  snap: Record<string, { label: string; value: string }>,
): Promise<Record<string, { label: string; value: string }>> {
  const rid = await requestIdOf(tx, ownerType, ownerId);
  const dek = rid ? await projectDek(tx, tenantId, rid) : null;
  if (!dek) return snap;
  return Object.fromEntries(
    Object.entries(snap).map(([k, v]) => [
      k,
      { label: v.label, value: sealWithDek(dek, tenantId, ctxOf(ownerType, ownerId, `snap|${k}`), v.value) },
    ]),
  );
}
export async function openSnapshot(
  tx: Tx,
  tenantId: string,
  ownerType: string,
  ownerId: string,
  snap: Record<string, { label: string; value: string }>,
): Promise<Record<string, { label: string; value: string }>> {
  if (!Object.values(snap).some((v) => isProjectText(v.value))) return snap;
  const rid = await requestIdOf(tx, ownerType, ownerId);
  const dek = rid ? await projectDek(tx, tenantId, rid) : null;
  if (!dek) throw new AppError(404, 'NOT_FOUND', 'Not found');
  return Object.fromEntries(
    Object.entries(snap).map(([k, v]) => [
      k,
      {
        label: v.label,
        value: isProjectText(v.value)
          ? openWithDek(dek, tenantId, ctxOf(ownerType, ownerId, `snap|${k}`), v.value)
          : v.value,
      },
    ]),
  );
}

/** Documents of a restricted project are sealed with the PROJECT key; everything else with the DATA key. */
export async function filePurposeFor(
  tx: Tx,
  requestId: string | null | undefined,
): Promise<'DATA' | 'PROJECT'> {
  if (!requestId) return 'DATA';
  const [rp] = await tx
    .select({ id: restrictedProject.requestId })
    .from(restrictedProject)
    .where(eq(restrictedProject.requestId, requestId));
  return rp ? 'PROJECT' : 'DATA';
}
export async function requestOfTender(tx: Tx, tenderId: string | null | undefined): Promise<string | null> {
  if (!tenderId) return null;
  return (await tx.select({ r: tender.requestId }).from(tender).where(eq(tender.id, tenderId)))[0]?.r ?? null;
}
