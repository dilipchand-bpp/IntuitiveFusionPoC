/**
 * Matching and commit of an ingested contract (CP-07). Commit turns a reviewed document into the contract record:
 *   CREATE  a new executed (locked) contract with key dates, value, notice period, extension options and the clauses found, and
 *           the reminders (notice, expiry, extension decision, milestones, countdown) through the existing contract alert engine;
 *   LINK    attach the document to an existing contract and report the differences between the paper and the record. An executed
 *           contract is locked (FR-0455): ingestion never rewrites its terms, a variation does.
 * The supplier is matched by ABN, then by name; a merely similar name is never linked without the person saying so.
 */
import { and, eq, isNull, ne } from 'drizzle-orm';
import type { Clock } from '@if/shared';
import type { AuditService } from '../../audit/audit-service.js';
import type { AuthContext } from '../../auth/guard.js';
import type { Tx } from '../../db/client.js';
import { clause, contract, cpOcrDocument, supplier } from '../../db/schema.js';
import { AppError } from '../../http/errors.js';
import { toBaseAmount } from '../b9/fx-routes.js';
import { nextNumber } from '../contract/clauses.js';
import { iso } from '../contract/dates.js';
import { createContractRecord } from '../contract/record.js';
import { loadDoc, summaryOf, SOURCE_SYSTEM } from './service.js';
import { nameSimilarity, normaliseCompany } from './text.js';
import type { DetectedClause, ExtractedField, FieldKey, Finding } from './types.js';

type SupplierRow = typeof supplier.$inferSelect;
type ContractRow = typeof contract.$inferSelect;
type DocRow = typeof cpOcrDocument.$inferSelect;

const NO_ABN = '00000000000';

const val = <T = unknown>(fields: ExtractedField[], key: FieldKey): T | null => {
  const f = fields.find((x) => x.key === key);
  return f && f.status !== 'NOT_FOUND' ? (f.value as T | null) : null;
};

export async function matchSupplier(tx: Tx, tenantId: string, fields: ExtractedField[]) {
  const sups = await tx.select().from(supplier).where(eq(supplier.tenantId, tenantId));
  const abn = val<string>(fields, 'supplierAbn');
  const name = val<string>(fields, 'supplier');
  const view = (s: SupplierRow) => ({ id: s.id, company: s.company, abn: s.abn });
  const byAbn = abn && abn !== NO_ABN ? sups.find((s) => s.abn === abn) : undefined;
  const byName = name ? sups.find((s) => normaliseCompany(s.company) === normaliseCompany(name)) : undefined;
  const hit = byAbn ?? byName;
  const similar = name
    ? sups
        .filter((s) => s.id !== hit?.id)
        .map((s) => ({ ...view(s), score: Math.round(nameSimilarity(s.company, name) * 100) / 100 }))
        .filter((s) => s.score >= 0.6)
        .sort((x, y) => y.score - x.score)
        .slice(0, 3)
    : [];
  return {
    match: hit ? { ...view(hit), by: byAbn ? ('ABN' as const) : ('NAME' as const) } : null,
    similar,
    abnConflict: !!(byName && abn && !byAbn && byName.abn !== NO_ABN && byName.abn !== abn),
    name,
    abn,
  };
}

export interface ContractMatch {
  id: string;
  number: string;
  title: string | null;
  supplierId: string;
  startDate: string | null;
  endDate: string | null;
  value: number;
  strength: 'STRONG' | 'POSSIBLE';
  reason: string;
  /** True when the contract is itself an import, so ingestion may update it. */
  updatable: boolean;
}

export async function matchContracts(
  tx: Tx,
  tenantId: string,
  fields: ExtractedField[],
  supplierId: string | null,
): Promise<ContractMatch[]> {
  const cs = await tx
    .select()
    .from(contract)
    .where(and(eq(contract.tenantId, tenantId), isNull(contract.deletedAt), isNull(contract.parentId)));
  const number = val<string>(fields, 'contractNumber')?.toLowerCase() ?? null;
  const title = val<string>(fields, 'title');
  const start = val<string>(fields, 'effectiveDate');
  const end = val<string>(fields, 'endDate');
  const out: ContractMatch[] = [];
  for (const c of cs) {
    let strength: ContractMatch['strength'] | null = null;
    let reason = '';
    if (number && c.number.toLowerCase() === number) {
      strength = 'STRONG';
      reason = 'Same contract number';
    } else if (supplierId && c.supplierId === supplierId) {
      if (title && c.title && normaliseCompany(c.title) === normaliseCompany(title)) {
        strength = 'STRONG';
        reason = 'Same supplier and title';
      } else if (start && end && c.startDate === start && c.endDate === end) {
        strength = 'STRONG';
        reason = 'Same supplier and the same start and end dates';
      } else if (start && end && c.startDate && c.endDate && c.startDate <= end && c.endDate >= start) {
        strength = 'POSSIBLE';
        reason = 'Same supplier with an overlapping term';
      }
    }
    if (strength)
      out.push({
        id: c.id,
        number: c.number,
        title: c.title,
        supplierId: c.supplierId,
        startDate: c.startDate,
        endDate: c.endDate,
        value: Number(c.value),
        strength,
        reason,
        updatable: c.sourceSystem !== null,
      });
  }
  return out.sort((x, y) => Number(y.strength === 'STRONG') - Number(x.strength === 'STRONG'));
}

export async function matchesFor(tx: Tx, tenantId: string, r: DocRow) {
  const fields = r.fields as ExtractedField[];
  const sup = await matchSupplier(tx, tenantId, fields);
  const contracts = await matchContracts(tx, tenantId, fields, sup.match?.id ?? null);
  return { supplier: sup, contracts };
}

export interface CommitBody {
  mode: 'AUTO' | 'CREATE' | 'LINK';
  contractId?: string | undefined;
  supplierId?: string | undefined;
  createSupplier?: boolean | undefined;
  allowDuplicate?: boolean | undefined;
  ownerId?: string | undefined;
}

interface Deps {
  clock: Clock;
  audit: AuditService;
}

export async function commitDocument(d: Deps, a: AuthContext, tx: Tx, id: string, body: CommitBody) {
  const tenantId = a.user.tenantId;
  const r = await loadDoc(tx, tenantId, id);
  if (r.status === 'COMMITTED')
    throw new AppError(409, 'ALREADY_COMMITTED', 'This document has already been committed');
  if (r.status === 'REJECTED' || r.status === 'FAILED')
    throw new AppError(409, 'INVALID_STATE', `A ${r.status.toLowerCase()} document cannot be committed`);
  const fields = r.fields as ExtractedField[];
  // the review gate: nothing below the confidence threshold, and no required field missing, goes into the register unreviewed
  const pending = fields.filter((f) => f.needsReview);
  if (pending.length)
    throw new AppError(
      409,
      'REVIEW_REQUIRED',
      `Review the ${pending.length} flagged field${pending.length === 1 ? '' : 's'} first (correct or accept): ${pending.map((f) => f.label).join(', ')}.`,
      pending.map((f) => ({ field: f.key, message: f.reviewReason ?? 'Review required' })),
    );
  const title = val<string>(fields, 'title')!;
  const supplierName = val<string>(fields, 'supplier')!;
  const start = val<string>(fields, 'effectiveDate')!;
  const end = val<string>(fields, 'endDate')!;
  const money = val<{ amount: number; currency: string }>(fields, 'value')!;
  if (end <= start)
    throw new AppError(422, 'DATES_INVALID', 'The end date must be after the effective date', [
      { field: 'endDate', message: 'Not after the effective date' },
    ]);

  // the same file committed before: committing it again must be a decision
  const sameFile = (
    await tx
      .select({ id: cpOcrDocument.id })
      .from(cpOcrDocument)
      .where(
        and(
          eq(cpOcrDocument.tenantId, tenantId),
          eq(cpOcrDocument.sha256, r.sha256),
          eq(cpOcrDocument.status, 'COMMITTED'),
          ne(cpOcrDocument.id, r.id),
        ),
      )
      .limit(1)
  )[0];
  if (sameFile && !body.allowDuplicate && body.mode !== 'LINK')
    throw new AppError(
      409,
      'DUPLICATE_FILE',
      'This file has already been committed as another document. Link it to that contract, or confirm with allowDuplicate.',
    );

  // supplier
  let sup: SupplierRow | undefined;
  let supplierCreated = false;
  const sm = await matchSupplier(tx, tenantId, fields);
  if (body.supplierId) {
    [sup] = await tx
      .select()
      .from(supplier)
      .where(and(eq(supplier.id, body.supplierId), eq(supplier.tenantId, tenantId)));
    if (!sup) throw new AppError(404, 'NOT_FOUND', 'Supplier not found');
  } else if (sm.match) {
    [sup] = await tx.select().from(supplier).where(eq(supplier.id, sm.match.id));
  } else if (sm.similar.length && !body.createSupplier)
    throw new AppError(
      409,
      'SUPPLIER_CONFIRM_NEEDED',
      `No supplier matches "${supplierName}" by ABN or name, but ${sm.similar.map((s) => `"${s.company}"`).join(', ')} look similar. Choose one (supplierId) or confirm a new supplier (createSupplier).`,
    );

  const matches = await matchContracts(tx, tenantId, fields, sup?.id ?? null);
  const strong = matches.filter((m) => m.strength === 'STRONG');
  let mode = body.mode;
  if (mode === 'AUTO') mode = 'CREATE';
  if (mode === 'CREATE' && strong.length && !body.allowDuplicate)
    throw new AppError(
      409,
      'DUPLICATE_CONTRACT',
      `A contract that looks like this one already exists (${strong.map((m) => `${m.number}: ${m.reason}`).join('; ')}). Use mode LINK with its contractId, or confirm with allowDuplicate.`,
      strong.map((m) => ({ field: 'contractId', message: `${m.id} ${m.number}` })),
    );

  const now = d.clock.now();
  const today = iso(now);
  const renewal = val<{ kind: string; extensionsMonths: number[] }>(fields, 'renewal');
  const extensions = renewal?.kind === 'OPTION' ? renewal.extensionsMonths : [];
  const noticeField = val<number>(fields, 'noticeDays');
  const noticeDays = noticeField ?? 90;
  const clauses = (r.clauses as DetectedClause[]).filter((c) => c.found);
  const findings = r.findings as Finding[];

  const conv = await toBaseAmount(tx, tenantId, money.currency, money.amount, today);

  const writeClauses = async (contractId: string) => {
    for (const c of clauses) {
      const dev = c.match !== 'STANDARD';
      await tx.insert(clause).values({
        tenantId,
        contractId,
        clauseId: `OCR-${c.key}`,
        title: c.title,
        text: c.text ?? '',
        mandatory: c.mandatory,
        changedFromTemplate: dev,
        risk: dev ? c.risk : 'LOW',
      });
    }
  };

  let result: Record<string, unknown>;
  let contractRow: ContractRow;
  if (mode === 'CREATE') {
    if (!sup) {
      const abn = val<string>(fields, 'supplierAbn');
      [sup] = await tx
        .insert(supplier)
        .values({
          tenantId,
          company: supplierName,
          abn: abn ?? NO_ABN,
          sanctionsStatus: 'PENDING',
          insuranceStatus: 'UNKNOWN',
          createdAt: now,
        })
        .returning();
      supplierCreated = true;
    }
    const existing = (
      await tx.select({ number: contract.number }).from(contract).where(eq(contract.tenantId, tenantId))
    ).map((c) => c.number);
    let number = val<string>(fields, 'contractNumber') ?? nextNumber(now.getUTCFullYear(), existing);
    if (existing.some((n) => n.toLowerCase() === number.toLowerCase())) {
      // an allowed duplicate gets its own number; the original stays as it was
      number = nextNumber(now.getUTCFullYear(), existing);
    }
    contractRow = await tx
      .insert(contract)
      .values({
        tenantId,
        number,
        tenderId: null,
        supplierId: sup!.id,
        status: 'EXECUTED',
        value: String(conv.base),
        startDate: start,
        endDate: end,
        noticeDays,
        locked: false,
        title,
        sourceSystem: SOURCE_SYSTEM,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .then((x) => x[0]!);
    await writeClauses(contractRow!.id);
    // the clauses are written first: once the contract is locked (executed, FR-0455) the database refuses clause changes
    await tx.update(contract).set({ locked: true }).where(eq(contract.id, contractRow!.id));
    contractRow = { ...contractRow!, locked: true };
    const rec = await createContractRecord(tx, contractRow, {
      extensions,
      today,
      pastAsSent: end < today,
      ...(body.ownerId ? { ownerId: body.ownerId } : {}),
    });
    result = {
      mode: 'CREATE',
      contractId: contractRow!.id,
      contractNumber: number,
      ownerId: rec.ownerId,
      reminders: rec.alerts.map((x) => ({
        kind: 'kind' in x ? x.kind : 'COUNTDOWN',
        triggerDate: x.triggerDate,
      })),
      clausesRecorded: clauses.length,
      milestones: rec.milestones.length,
      extensionOptions: extensions,
    };
    await d.audit.record(tx, a.ctx, {
      action: 'contract.create_from_ocr',
      entityType: 'contract',
      entityId: contractRow!.id,
      after: {
        number,
        supplierId: sup!.id,
        value: conv.base,
        startDate: start,
        endDate: end,
        noticeDays,
        source: SOURCE_SYSTEM,
        documentId: id,
      },
    });
  } else {
    const targetId = body.contractId ?? (strong.length === 1 ? strong[0]!.id : undefined);
    if (!targetId)
      throw new AppError(422, 'CONTRACT_REQUIRED', `Say which contract to link to (contractId).`, [
        { field: 'contractId', message: 'Required' },
      ]);
    const [c] = await tx
      .select()
      .from(contract)
      .where(and(eq(contract.id, targetId), eq(contract.tenantId, tenantId), isNull(contract.deletedAt)));
    if (!c) throw new AppError(404, 'NOT_FOUND', 'Contract not found');
    contractRow = c;
    sup = (await tx.select().from(supplier).where(eq(supplier.id, c.supplierId)))[0];
    const differences = [
      { field: 'title', record: c.title, document: title },
      { field: 'startDate', record: c.startDate, document: start },
      { field: 'endDate', record: c.endDate, document: end },
      { field: 'value', record: Number(c.value), document: conv.base },
      { field: 'noticeDays', record: c.noticeDays, document: noticeDays },
    ].filter((x) => String(x.record ?? '') !== String(x.document ?? ''));
    result = { mode: 'LINK', contractId: c.id, contractNumber: c.number, differences, changed: false };
  }

  const summary = {
    ...result,
    supplier: {
      id: sup!.id,
      company: sup!.company,
      created: supplierCreated,
      matchedBy: supplierCreated ? null : (sm.match?.by ?? (body.supplierId ? 'CHOSEN' : null)),
    },
    value: { amount: money.amount, currency: money.currency, base: conv.base, rate: conv.rate },
    findings: findings.length,
    noticeDaysSource: noticeField === null ? 'default 90 (none found in the document)' : 'document',
  };
  const [u] = await tx
    .update(cpOcrDocument)
    .set({
      status: 'COMMITTED',
      contractId: contractRow!.id,
      supplierId: sup!.id,
      committedBy: a.user.id,
      committedAt: now,
      commitSummary: summary,
      updatedAt: now,
      version: r.version + 1,
    })
    .where(and(eq(cpOcrDocument.id, id), eq(cpOcrDocument.version, r.version)))
    .returning();
  if (!u)
    throw new AppError(
      409,
      'STALE',
      'The document changed while it was being committed; reload and try again',
    );
  await d.audit.record(tx, a.ctx, {
    action: 'cpocr.commit',
    entityType: 'cp_ocr_document',
    entityId: id,
    before: { status: r.status },
    after: {
      status: 'COMMITTED',
      mode,
      contractId: contractRow!.id,
      supplierId: sup!.id,
      supplierCreated,
      reminders: Array.isArray(result.reminders)
        ? result.reminders.length
        : (result.remindersRescheduled ?? 0),
    },
  });
  return { document: summaryOf(u), ...summary };
}
