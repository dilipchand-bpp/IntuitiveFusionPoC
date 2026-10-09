/**
 * The database side of the historical import (CP-07): reading what already exists for the checks, the dry run (which writes
 * only the batch's own staging rows), the commit, and the per-batch rollback.
 *
 * What a commit creates is recorded row by row in `hist_created`, so a rollback removes exactly that and nothing else:
 *   - suppliers and catalogue items it created are deleted (suppliers a retained contract still refers to are kept and reported);
 *   - what a merge changed is put back (and only if nobody has changed it since);
 *   - historical spend lines are deleted by batch;
 *   - contracts are only ever deleted logically (NFR-L04, a signed contract is kept), their reminders cancelled, and only while
 *     untouched: if anyone edited an imported contract, varied it, invoiced against it, or added to it, the rollback is refused
 *     and says what was touched.
 */
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Clock } from '@if/shared';
import type { AuditService } from '../../audit/audit-service.js';
import type { RequestContext, Tx } from '../../db/client.js';
import {
  alert,
  appUser,
  catalogueItem,
  clause,
  contract,
  contractExtension,
  histBatch,
  histCreated,
  histRow,
  histSpendLine,
  supplier,
  type DuplicateRule,
  type HistEntity,
} from '../../db/schema.js';
import { AppError } from '../../http/errors.js';
import { iso } from '../contract/dates.js';
import { createContractRecord } from '../contract/record.js';
import { ABN_PLACEHOLDER } from './normalise.js';
import {
  SupplierIndex,
  VALIDATION_ENGINE,
  readContractText,
  spendSignature,
  validateRows,
  type Existing,
  type RowResult,
  type ValidateOutput,
} from './validate.js';
import type { Mapping } from './mapping.js';

type Batch = typeof histBatch.$inferSelect;
type HRow = typeof histRow.$inferSelect;

export interface Deps {
  clock: Clock;
  audit: AuditService;
}

const chunks = <T>(list: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
};

// ------------------------------------------------------------------ what exists now
export async function loadExisting(tx: Tx, tenantId: string, today: string): Promise<Existing> {
  const suppliers = await tx
    .select({ id: supplier.id, company: supplier.company, abn: supplier.abn })
    .from(supplier)
    .where(eq(supplier.tenantId, tenantId));
  const contracts = new Map<string, { id: string; label: string }>();
  for (const c of await tx
    .select({ id: contract.id, number: contract.number, title: contract.title })
    .from(contract)
    .where(and(eq(contract.tenantId, tenantId), isNull(contract.deletedAt))))
    contracts.set(c.number.toLowerCase(), { id: c.id, label: c.title ? `${c.number} ${c.title}` : c.number });
  const catalogue = new Map<string, { id: string; label: string }>();
  for (const i of await tx
    .select({
      id: catalogueItem.id,
      supplierId: catalogueItem.supplierId,
      sku: catalogueItem.sku,
      name: catalogueItem.name,
    })
    .from(catalogueItem)
    .where(eq(catalogueItem.tenantId, tenantId)))
    catalogue.set(`${i.supplierId}|${i.sku.toLowerCase()}`, { id: i.id, label: `${i.sku} ${i.name}` });
  const spend = new Set<string>();
  for (const s of await tx
    .select({
      name: histSpendLine.supplierName,
      date: histSpendLine.spendDate,
      amount: histSpendLine.amount,
      reference: histSpendLine.reference,
    })
    .from(histSpendLine)
    .where(eq(histSpendLine.tenantId, tenantId)))
    spend.add(spendSignature(s.name, s.date, Number(s.amount), s.reference));
  const users = await tx
    .select({ id: appUser.id, name: appUser.name, email: appUser.email })
    .from(appUser)
    .where(and(eq(appUser.tenantId, tenantId), isNull(appUser.supplierId), eq(appUser.active, true)));
  return { today, suppliers, contracts, catalogue, spend, users };
}

export const rowInput = (rows: HRow[]) =>
  rows.map((r) => ({ rowNo: r.rowNo, raw: r.raw as Record<string, string> }));

// ------------------------------------------------------------------ the dry run
export interface DrySummary {
  engine: typeof VALIDATION_ENGINE;
  entity: HistEntity;
  duplicateRule: DuplicateRule;
  total: number;
  valid: number;
  errors: number;
  duplicates: number;
  withWarnings: number;
  /** Errors by the rule that found them, and warnings by rule. */
  errorsByRule: Record<string, number>;
  warningsByRule: Record<string, number>;
  /** Rows a commit would load (valid rows, plus matches it would merge under the MERGE rule). */
  wouldLoad: number;
  wouldMerge: number;
  wouldSkip: number;
  suppliers: { wouldCreate: number; linked: number };
  variants: Array<{ names: string[]; rows: number[] }>;
  reminders?: { contractsWithReminders: number; endedOrTerminated: number };
  spend?: { lines: number; total: number; from: string | null; to: string | null };
  note: string | null;
}

export function summarise(
  entity: HistEntity,
  rule: DuplicateRule,
  out: ValidateOutput,
  today: string,
): DrySummary {
  const errorsByRule: Record<string, number> = {};
  const warningsByRule: Record<string, number> = {};
  for (const r of out.rows) {
    for (const i of r.issues) errorsByRule[i.rule] = (errorsByRule[i.rule] ?? 0) + 1;
    for (const w of r.warnings) warningsByRule[w.rule] = (warningsByRule[w.rule] ?? 0) + 1;
  }
  const valid = out.rows.filter((r) => r.status === 'VALID');
  const dups = out.rows.filter((r) => r.status === 'DUPLICATE');
  const mergeable =
    rule === 'MERGE' && (entity === 'SUPPLIERS' || entity === 'CATALOGUE')
      ? dups.filter((r) => r.duplicate?.kind === 'EXISTING').length
      : 0;
  const summary: DrySummary = {
    engine: VALIDATION_ENGINE,
    entity,
    duplicateRule: rule,
    total: out.rows.length,
    valid: valid.length,
    errors: out.rows.filter((r) => r.status === 'ERROR').length,
    duplicates: dups.length,
    withWarnings: out.rows.filter((r) => r.warnings.length > 0).length,
    errorsByRule,
    warningsByRule,
    wouldLoad: valid.length + mergeable,
    wouldMerge: mergeable,
    wouldSkip: out.rows.length - valid.length - mergeable,
    suppliers: { wouldCreate: out.suppliersNew, linked: out.suppliersLinked },
    variants: out.variants.slice(0, 25),
    note:
      rule === 'MERGE' && (entity === 'CONTRACTS' || entity === 'SPEND')
        ? 'MERGE does not apply to this entity: a signed contract or a spend line already loaded is never changed, so duplicates are skipped.'
        : null,
  };
  if (entity === 'CONTRACTS') {
    const ended = valid.filter(
      (r) =>
        (r.values!.end_date as string) < today ||
        ['TERMINATED', 'CANCELLED', 'EXPIRED', 'ENDED'].includes((r.values!.status as string | null) ?? ''),
    ).length;
    summary.reminders = { contractsWithReminders: valid.length - ended, endedOrTerminated: ended };
  }
  if (entity === 'SPEND') {
    const dates = valid.map((r) => r.values!.date as string).sort();
    summary.spend = {
      lines: valid.length,
      total: Math.round(valid.reduce((n, r) => n + (r.values!.amount as number), 0) * 100) / 100,
      from: dates[0] ?? null,
      to: dates.at(-1) ?? null,
    };
  }
  return summary;
}

/** Validates the batch against what exists now and stores the row results. Writes only hist_row and hist_batch (never the entity tables). */
export async function dryRun(
  tx: Tx,
  d: Deps,
  tenantId: string,
  batch: Batch,
  rule: DuplicateRule,
): Promise<{ summary: DrySummary; results: RowResult[] }> {
  const rows = await tx
    .select()
    .from(histRow)
    .where(eq(histRow.batchId, batch.id))
    .orderBy(asc(histRow.rowNo));
  const today = iso(d.clock.now());
  const existing = await loadExisting(tx, tenantId, today);
  const out = validateRows({
    entity: batch.entity as HistEntity,
    mapping: batch.mapping as Mapping,
    rows: rowInput(rows),
    existing,
  });
  const summary = summarise(batch.entity as HistEntity, rule, out, today);
  const byNo = new Map(rows.map((r) => [r.rowNo, r.id]));
  for (const part of chunks(out.rows, 100))
    for (const r of part)
      await tx
        .update(histRow)
        .set({
          status: r.status,
          normalised: r.values,
          issues: r.issues,
          warnings: r.warnings,
          duplicate: r.duplicate,
          createdRef: null,
        })
        .where(eq(histRow.id, byNo.get(r.rowNo)!));
  await tx
    .update(histBatch)
    .set({ status: 'DRY_RUN', summary, duplicateRule: rule, dryRunAt: d.clock.now() })
    .where(eq(histBatch.id, batch.id));
  return { summary, results: out.rows };
}

// ------------------------------------------------------------------ the commit
export interface CommitSummary {
  entity: HistEntity;
  duplicateRule: DuplicateRule;
  total: number;
  loaded: number;
  merged: number;
  skippedDuplicates: number;
  skippedErrors: number;
  suppliersCreated: number;
  suppliersMerged: number;
  contractsCreated: number;
  remindersCreated: number;
  catalogueCreated: number;
  catalogueUpdated: number;
  spendLines: number;
  spendTotal: number;
  /** loaded + merged + skipped always equals total. */
  reconciles: boolean;
}

interface LedgerEntry {
  entityType: (typeof histCreated.$inferInsert)['entityType'];
  entityId: string;
  action: 'CREATED' | 'MERGED';
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

const NO_REMINDER = new Set(['TERMINATED', 'CANCELLED', 'EXPIRED', 'ENDED']);

export async function commit(
  tx: Tx,
  d: Deps,
  tenantId: string,
  userId: string,
  batch: Batch,
  rule: DuplicateRule,
): Promise<CommitSummary> {
  const entity = batch.entity as HistEntity;
  const now = d.clock.now();
  const today = iso(now);
  const rows = await tx
    .select()
    .from(histRow)
    .where(eq(histRow.batchId, batch.id))
    .orderBy(asc(histRow.rowNo));
  const existing = await loadExisting(tx, tenantId, today);
  // judged again on the data as it is now, not as it was at the dry run
  const out = validateRows({ entity, mapping: batch.mapping as Mapping, rows: rowInput(rows), existing });
  const rowId = new Map(rows.map((r) => [r.rowNo, r.id]));
  const ledger: LedgerEntry[] = [];
  const sum: CommitSummary = {
    entity,
    duplicateRule: rule,
    total: out.rows.length,
    loaded: 0,
    merged: 0,
    skippedDuplicates: 0,
    skippedErrors: 0,
    suppliersCreated: 0,
    suppliersMerged: 0,
    contractsCreated: 0,
    remindersCreated: 0,
    catalogueCreated: 0,
    catalogueUpdated: 0,
    spendLines: 0,
    spendTotal: 0,
    reconciles: false,
  };
  const people = existing.users;
  const index = new SupplierIndex(existing.suppliers);
  const setRow = (
    r: RowResult,
    status: 'LOADED' | 'MERGED' | 'SKIPPED' | 'ERROR' | 'DUPLICATE',
    ref: string | null,
    note?: string,
  ) =>
    tx
      .update(histRow)
      .set({
        status,
        normalised: r.values,
        issues: r.issues,
        warnings: note ? [...r.warnings, { rule: 'COMMIT_NOTE', message: note }] : r.warnings,
        duplicate: r.duplicate,
        createdRef: ref,
      })
      .where(eq(histRow.id, rowId.get(r.rowNo)!));

  /** An existing supplier or a new one for this name, created once however many rows name it. */
  async function supplierFor(
    name: string,
    abn: string | null,
    category: string | null,
    extra: Record<string, unknown> = {},
  ) {
    const m = index.find(name, abn);
    if (m.kind === 'EXISTING') {
      if (rule === 'MERGE' && abn && !m.id.startsWith('new:')) {
        const [cur] = await tx.select().from(supplier).where(eq(supplier.id, m.id));
        if (cur && cur.abn === ABN_PLACEHOLDER) {
          await tx.update(supplier).set({ abn }).where(eq(supplier.id, m.id));
          ledger.push({
            entityType: 'SUPPLIER',
            entityId: m.id,
            action: 'MERGED',
            before: { abn: cur.abn },
            after: { abn },
          });
          sum.suppliersMerged += 1;
          index.add({ id: cur.id, company: cur.company, abn });
        }
      }
      return m.id;
    }
    const [s] = await tx
      .insert(supplier)
      .values({
        tenantId,
        company: name,
        // the database needs 11 digits; all zeros means "not supplied", and sanctions stay pending until someone checks
        abn: abn ?? ABN_PLACEHOLDER,
        sanctionsStatus: 'PENDING',
        insuranceStatus: 'UNKNOWN',
        categories: category ? [category] : [],
        onboarding: { import: { batchId: batch.id, sourceSystem: batch.sourceSystem, ...extra } },
      })
      .returning();
    ledger.push({ entityType: 'SUPPLIER', entityId: s!.id, action: 'CREATED' });
    sum.suppliersCreated += 1;
    index.add({ id: s!.id, company: name, abn: abn ?? ABN_PLACEHOLDER });
    return s!.id;
  }

  const spendLines: Array<typeof histSpendLine.$inferInsert> = [];

  for (const r of out.rows) {
    if (r.status === 'ERROR') {
      sum.skippedErrors += 1;
      await setRow(r, 'ERROR', null);
      continue;
    }
    const v = r.values;
    if (r.status === 'DUPLICATE') {
      // contracts and spend lines are never changed once loaded; suppliers and catalogue prices can be merged
      if (rule === 'MERGE' && r.duplicate?.kind === 'EXISTING' && entity === 'SUPPLIERS') {
        const id = r.duplicate.entityId!;
        const [cur] = await tx.select().from(supplier).where(eq(supplier.id, id));
        const vals = v;
        const before = { abn: cur!.abn, categories: cur!.categories, onboarding: cur!.onboarding };
        const cats = (cur!.categories as string[]) ?? [];
        const cat = (vals?.category as string | null) ?? null;
        const next = {
          abn: cur!.abn === ABN_PLACEHOLDER && vals?.abn ? (vals.abn as string) : cur!.abn,
          categories: cat && !cats.includes(cat) ? [...cats, cat] : cats,
          onboarding: cur!.onboarding,
        };
        if (next.abn !== before.abn || next.categories.length !== cats.length) {
          await tx
            .update(supplier)
            .set({ abn: next.abn, categories: next.categories })
            .where(eq(supplier.id, id));
          ledger.push({ entityType: 'SUPPLIER', entityId: id, action: 'MERGED', before, after: next });
          sum.merged += 1;
          sum.suppliersMerged += 1;
          await setRow(r, 'MERGED', id);
          continue;
        }
        sum.skippedDuplicates += 1;
        await setRow(
          r,
          'SKIPPED',
          id,
          'The supplier already holds everything in this row; nothing to merge.',
        );
        continue;
      }
      if (rule === 'MERGE' && r.duplicate?.kind === 'EXISTING' && entity === 'CATALOGUE') {
        const id = r.duplicate.entityId!;
        const vals = v!;
        const [cur] = await tx.select().from(catalogueItem).where(eq(catalogueItem.id, id));
        const next = {
          name: (vals.name as string) ?? cur!.name,
          unitPrice: String(vals.unit_price ?? cur!.unitPrice),
          unit: (vals.unit as string | null) ?? cur!.unit,
          category: (vals.category as string | null) ?? cur!.category,
          leadDays: (vals.lead_days as number | null) ?? cur!.leadDays,
        };
        const before = {
          name: cur!.name,
          unitPrice: cur!.unitPrice,
          unit: cur!.unit,
          category: cur!.category,
          leadDays: cur!.leadDays,
        };
        if (
          Number(next.unitPrice) !== Number(before.unitPrice) ||
          next.name !== before.name ||
          next.unit !== before.unit ||
          next.category !== before.category ||
          next.leadDays !== before.leadDays
        ) {
          await tx.update(catalogueItem).set(next).where(eq(catalogueItem.id, id));
          ledger.push({ entityType: 'CATALOGUE_ITEM', entityId: id, action: 'MERGED', before, after: next });
          sum.merged += 1;
          sum.catalogueUpdated += 1;
          await setRow(r, 'MERGED', id);
          continue;
        }
        sum.skippedDuplicates += 1;
        await setRow(r, 'SKIPPED', id, 'The catalogue already holds this price; nothing to merge.');
        continue;
      }
      sum.skippedDuplicates += 1;
      await setRow(r, 'SKIPPED', null);
      continue;
    }

    // a valid row
    if (entity === 'SUPPLIERS') {
      const id = await supplierFor(
        v!.company as string,
        (v!.abn as string | null) ?? null,
        (v!.category as string | null) ?? null,
        {
          city: v!.city ?? null,
          state: v!.state ?? null,
          contactEmail: v!.email ?? null,
        },
      );
      sum.loaded += 1;
      await setRow(r, 'LOADED', id);
    } else if (entity === 'CONTRACTS') {
      const supplierId = await supplierFor(
        v!.supplier as string,
        (v!.supplier_abn as string | null) ?? null,
        null,
      );
      const text = readContractText(v!.text as string | null);
      const status = (v!.status as string | null) ?? 'ACTIVE';
      const owner = v!.owner
        ? people.find(
            (u) =>
              u.name.toLowerCase() === String(v!.owner).toLowerCase() ||
              u.email.toLowerCase() === String(v!.owner).toLowerCase(),
          )
        : undefined;
      const noticeDays =
        text.noticeDays ??
        (v!.notice_months !== null && v!.notice_months !== undefined ? Number(v!.notice_months) * 30 : 90);
      const [c] = await tx
        .insert(contract)
        .values({
          tenantId,
          number: v!.contract_number as string,
          title: v!.title as string,
          tenderId: null,
          supplierId,
          status: 'EXECUTED',
          value: String(v!.value),
          startDate: v!.start_date as string,
          endDate: v!.end_date as string,
          noticeDays,
          sourceSystem: batch.sourceSystem,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const lines: Array<[string, string, string]> = [
        ...text.obligations.map((t, i) => [`OBL-${i + 1}`, 'Obligation', t] as [string, string, string]),
        ...text.kpis.map(
          (t, i) => [`KPI-${i + 1}`, 'Key performance indicator', t] as [string, string, string],
        ),
        ...text.slas.map((t, i) => [`SLA-${i + 1}`, 'Service level', t] as [string, string, string]),
      ];
      for (const [clauseId, title, body] of lines)
        await tx
          .insert(clause)
          .values({ tenantId, contractId: c!.id, clauseId, title, text: body, mandatory: false });
      // an executed contract is locked like any other (NFR-L04); imported ones are told apart by source_system and the ledger
      await tx.update(contract).set({ locked: true }).where(eq(contract.id, c!.id));
      const rec = await createContractRecord(
        tx,
        { ...c!, locked: true },
        {
          extensions: text.extensions,
          today,
          // history that is already due is recorded as sent, so importing a register does not fire a flood of old reminders
          pastAsSent: true,
          ...(owner ? { ownerId: owner.id } : {}),
        },
      );
      let live = rec.alerts.length;
      if (NO_REMINDER.has(status) || (v!.end_date as string) < today) {
        await tx
          .update(alert)
          .set({ status: 'CANCELLED' })
          .where(and(eq(alert.contractId, c!.id), eq(alert.status, 'SCHEDULED')));
        live = 0;
      }
      sum.remindersCreated += live;
      sum.contractsCreated += 1;
      sum.loaded += 1;
      const [fresh] = await tx.select().from(contract).where(eq(contract.id, c!.id));
      ledger.push({
        entityType: 'CONTRACT',
        entityId: c!.id,
        action: 'CREATED',
        after: { version: fresh!.version, updatedAt: fresh!.updatedAt.toISOString(), reminders: live },
      });
      await setRow(r, 'LOADED', c!.id);
    } else if (entity === 'CATALOGUE') {
      const m = index.find(v!.supplier as string, null);
      const supplierId = (m as { id: string }).id;
      const contractRef = v!.contract_number
        ? existing.contracts.get(String(v!.contract_number).toLowerCase())
        : undefined;
      const [item] = await tx
        .insert(catalogueItem)
        .values({
          tenantId,
          supplierId,
          contractId: contractRef?.id ?? null,
          sku: v!.sku as string,
          name: v!.name as string,
          category: (v!.category as string | null) ?? 'Uncategorised',
          unit: (v!.unit as string | null) ?? 'each',
          unitPrice: String(v!.unit_price),
          leadDays: (v!.lead_days as number | null) ?? 0,
          active: true,
          createdAt: now,
        })
        .returning();
      ledger.push({ entityType: 'CATALOGUE_ITEM', entityId: item!.id, action: 'CREATED' });
      sum.catalogueCreated += 1;
      sum.loaded += 1;
      await setRow(r, 'LOADED', item!.id);
    } else {
      const name = v!.supplier as string;
      const m = index.find(name, null);
      spendLines.push({
        tenantId,
        batchId: batch.id,
        supplierId: m.kind === 'EXISTING' ? m.id : null,
        supplierName: name,
        category: (v!.category as string | null) ?? 'Uncategorised',
        amount: String(v!.amount),
        currency: (v!.currency as string | null) ?? 'AUD',
        spendDate: v!.date as string,
        businessUnit: (v!.business_unit as string | null) ?? 'Not recorded',
        costCentre: (v!.cost_centre as string | null) ?? 'Not recorded',
        reference: (v!.reference as string | null) ?? null,
        description: (v!.description as string | null) ?? null,
        createdAt: now,
      });
      sum.spendLines += 1;
      sum.spendTotal += v!.amount as number;
      sum.loaded += 1;
      await setRow(r, 'LOADED', null);
    }
  }
  for (const part of chunks(spendLines, 200)) await tx.insert(histSpendLine).values(part);
  sum.spendTotal = Math.round(sum.spendTotal * 100) / 100;
  for (const part of chunks(ledger, 200))
    await tx.insert(histCreated).values(
      part.map((l) => ({
        tenantId,
        batchId: batch.id,
        ...l,
        before: l.before ?? null,
        after: l.after ?? null,
      })),
    );
  sum.reconciles = sum.loaded + sum.merged + sum.skippedDuplicates + sum.skippedErrors === sum.total;
  await tx
    .update(histBatch)
    .set({
      status: 'COMMITTED',
      commitSummary: sum,
      duplicateRule: rule,
      committedAt: now,
      committedBy: userId,
    })
    .where(eq(histBatch.id, batch.id));
  return sum;
}

// ------------------------------------------------------------------ rollback
const referencing = async (tx: Tx, table: string, ids: string[]) => {
  if (ids.length === 0) return [] as Array<{ table: string; column: string }>;
  const rows = (
    await tx.execute(
      sql`select cl.relname as tbl, a.attname as col
            from pg_constraint c
            join pg_class cl on cl.oid = c.conrelid
            join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
           where c.contype = 'f' and c.confrelid = ${table}::regclass`,
    )
  ).rows as Array<{ tbl: string; col: string }>;
  return rows.map((x) => ({ table: x.tbl, column: x.col }));
};

const uuidList = (ids: string[]) =>
  sql.raw(`ARRAY[${ids.map((i) => `'${i.replace(/[^0-9a-f-]/gi, '')}'`).join(',')}]::uuid[]`);

async function countWhere(
  tx: Tx,
  table: string,
  column: string,
  ids: string[],
  extra = sql``,
): Promise<number> {
  if (ids.length === 0) return 0;
  const r = await tx.execute(
    sql`select count(*)::int as n from ${sql.identifier(table)} where ${sql.identifier(column)} = any(${uuidList(ids)}) ${extra}`,
  );
  return Number((r.rows[0] as { n: number }).n);
}

export interface Blocker {
  entity: string;
  message: string;
}

/** Why this batch can no longer be rolled back, if anything has touched what it created. Empty means it can. */
export async function rollbackBlockers(tx: Tx, batch: Batch): Promise<Blocker[]> {
  const ledger = await tx.select().from(histCreated).where(eq(histCreated.batchId, batch.id));
  const blockers: Blocker[] = [];
  const created = (t: string) => ledger.filter((l) => l.entityType === t && l.action === 'CREATED');
  const contractIds = created('CONTRACT').map((l) => l.entityId);
  const supplierIds = created('SUPPLIER').map((l) => l.entityId);
  const itemIds = created('CATALOGUE_ITEM').map((l) => l.entityId);

  // contracts: unedited, and nothing has been built on them
  if (contractIds.length) {
    const cs = await tx.select().from(contract).where(inArray(contract.id, contractIds));
    for (const l of created('CONTRACT')) {
      const c = cs.find((x) => x.id === l.entityId);
      const was = l.after as { version: number; updatedAt: string } | null;
      if (!c || c.deletedAt)
        blockers.push({ entity: 'contract', message: `${c?.number ?? l.entityId} has already been deleted` });
      else if (!was || c.version !== was.version || c.updatedAt.toISOString() !== was.updatedAt)
        blockers.push({ entity: 'contract', message: `${c.number} has been edited since it was imported` });
    }
    const label = (id: string) => cs.find((c) => c.id === id)?.number ?? id;
    for (const ref of await referencing(tx, 'contract', contractIds)) {
      if (['clause', 'alert', 'contract_milestone', 'contract_extension'].includes(ref.table)) continue;
      const n = await countWhere(tx, ref.table, ref.column, contractIds);
      if (n > 0)
        blockers.push({
          entity: 'contract',
          message: `${n} row(s) in ${ref.table} refer to the imported contracts`,
        });
    }
    const edited = await tx
      .select({ contractId: clause.contractId })
      .from(clause)
      .where(
        and(
          inArray(clause.contractId, contractIds),
          sql`(${clause.editedAt} is not null or ${clause.changedFromTemplate})`,
        ),
      );
    for (const e of edited)
      blockers.push({ entity: 'contract', message: `A clause of ${label(e.contractId)} has been edited` });
    const userAlerts = await tx
      .select({ contractId: alert.contractId })
      .from(alert)
      .where(and(inArray(alert.contractId, contractIds), sql`${alert.origin} <> 'SYSTEM'`));
    for (const a of userAlerts)
      blockers.push({ entity: 'contract', message: `${label(a.contractId)} has a reminder someone added` });
    const exercised = await tx
      .select({ contractId: contractExtension.contractId })
      .from(contractExtension)
      .where(
        and(
          inArray(contractExtension.contractId, contractIds),
          sql`${contractExtension.exercisedAt} is not null`,
        ),
      );
    for (const e of exercised)
      blockers.push({
        entity: 'contract',
        message: `An extension of ${label(e.contractId)} has been taken up`,
      });
  }

  // suppliers the batch created: anything outside the batch that now refers to them blocks the removal of that supplier... unless a
  // retained (logically deleted) contract of this batch is the only reference, in which case it is kept and reported by the rollback
  for (const ref of await referencing(tx, 'supplier', supplierIds)) {
    const extra =
      ref.table === 'contract' && contractIds.length
        ? sql`and ${sql.identifier('id')} <> all(${uuidList(contractIds)})`
        : ref.table === 'catalogue_item' && itemIds.length
          ? sql`and ${sql.identifier('id')} <> all(${uuidList(itemIds)})`
          : sql``;
    const n = await countWhere(tx, ref.table, ref.column, supplierIds, extra);
    if (n > 0)
      blockers.push({
        entity: 'supplier',
        message: `${n} row(s) in ${ref.table} refer to suppliers this import created`,
      });
  }
  if (supplierIds.length) {
    // catalogue items have no declared foreign key to the supplier, so they are checked by name
    const items = await countWhere(
      tx,
      'catalogue_item',
      'supplier_id',
      supplierIds,
      itemIds.length ? sql`and id <> all(${uuidList(itemIds)})` : sql``,
    );
    if (items > 0)
      blockers.push({
        entity: 'supplier',
        message: `${items} catalogue item(s) from another import or entry refer to suppliers this import created`,
      });
  }
  if (supplierIds.length) {
    const n = await countWhere(
      tx,
      'hist_spend_line',
      'supplier_id',
      supplierIds,
      sql`and batch_id <> ${batch.id}`,
    );
    if (n > 0)
      blockers.push({
        entity: 'supplier',
        message: `${n} spend line(s) from another import refer to suppliers this import created`,
      });
  }
  // merges: put back only if nobody has changed the value since
  for (const l of ledger.filter((x) => x.action === 'MERGED')) {
    if (l.entityType === 'SUPPLIER') {
      const [s] = await tx.select().from(supplier).where(eq(supplier.id, l.entityId));
      const after = l.after as { abn: string } | null;
      if (!s)
        blockers.push({ entity: 'supplier', message: 'A supplier this import changed has been deleted' });
      else if (after && s.abn !== after.abn)
        blockers.push({ entity: 'supplier', message: `${s.company} has been changed since the merge` });
    } else if (l.entityType === 'CATALOGUE_ITEM') {
      const [i] = await tx.select().from(catalogueItem).where(eq(catalogueItem.id, l.entityId));
      const after = l.after as { unitPrice: string } | null;
      if (!i)
        blockers.push({
          entity: 'catalogue',
          message: 'A catalogue item this import changed has been deleted',
        });
      else if (after && Number(i.unitPrice) !== Number(after.unitPrice))
        blockers.push({ entity: 'catalogue', message: `${i.sku} has been repriced since the merge` });
    }
  }
  // catalogue items created: not chosen by a sourcing proposal since
  if (itemIds.length) {
    const n = await countWhere(tx, 'sourcing_proposal', 'recommended_item_id', itemIds);
    if (n > 0)
      blockers.push({
        entity: 'catalogue',
        message: `${n} sourcing proposal(s) recommend items this import created`,
      });
  }
  return blockers;
}

export interface RollbackSummary {
  contractsDeleted: number;
  remindersCancelled: number;
  suppliersDeleted: number;
  suppliersKept: number;
  suppliersRestored: number;
  catalogueDeleted: number;
  cataloguePricesRestored: number;
  spendLinesDeleted: number;
}

export async function rollback(
  tx: Tx,
  d: Deps,
  ctx: RequestContext,
  batch: Batch,
  reason: string,
): Promise<RollbackSummary> {
  const blockers = await rollbackBlockers(tx, batch);
  if (blockers.length > 0)
    throw new AppError(
      409,
      'ROLLBACK_BLOCKED',
      'This import can no longer be rolled back: something it created has been used or changed',
      blockers.slice(0, 20).map((b) => ({ field: b.entity, message: b.message })),
    );
  const now = d.clock.now();
  const ledger = await tx.select().from(histCreated).where(eq(histCreated.batchId, batch.id));
  const sum: RollbackSummary = {
    contractsDeleted: 0,
    remindersCancelled: 0,
    suppliersDeleted: 0,
    suppliersKept: 0,
    suppliersRestored: 0,
    catalogueDeleted: 0,
    cataloguePricesRestored: 0,
    spendLinesDeleted: 0,
  };
  // contracts are only deleted logically (NFR-L04); their reminders are cancelled
  for (const l of ledger.filter((x) => x.entityType === 'CONTRACT' && x.action === 'CREATED')) {
    const [c] = await tx.select().from(contract).where(eq(contract.id, l.entityId));
    if (!c) continue;
    const cancelled = await tx
      .update(alert)
      .set({ status: 'CANCELLED' })
      .where(and(eq(alert.contractId, c.id), eq(alert.status, 'SCHEDULED')))
      .returning({ id: alert.id });
    sum.remindersCancelled += cancelled.length;
    await tx
      .update(contract)
      .set({ deletedAt: now, updatedAt: now, version: c.version + 1 })
      .where(eq(contract.id, c.id));
    await d.audit.record(tx, ctx, {
      action: 'contract.delete',
      entityType: 'contract',
      entityId: c.id,
      after: {
        number: c.number,
        status: c.status,
        locked: c.locked,
        reason: `Rolled back with import ${batch.filename}: ${reason}`,
        logical: true,
        importBatchId: batch.id,
      },
    });
    sum.contractsDeleted += 1;
  }
  // what merges changed goes back
  for (const l of ledger.filter((x) => x.action === 'MERGED')) {
    if (l.entityType === 'SUPPLIER') {
      const b = l.before as { abn: string; categories?: unknown; onboarding?: unknown };
      await tx
        .update(supplier)
        .set({
          abn: b.abn,
          ...(b.categories !== undefined ? { categories: b.categories } : {}),
          ...(b.onboarding !== undefined ? { onboarding: b.onboarding } : {}),
        })
        .where(eq(supplier.id, l.entityId));
      sum.suppliersRestored += 1;
    } else if (l.entityType === 'CATALOGUE_ITEM') {
      const b = l.before as {
        name: string;
        unitPrice: string;
        unit: string;
        category: string;
        leadDays: number;
      };
      await tx.update(catalogueItem).set(b).where(eq(catalogueItem.id, l.entityId));
      sum.cataloguePricesRestored += 1;
    }
  }
  const items = ledger
    .filter((x) => x.entityType === 'CATALOGUE_ITEM' && x.action === 'CREATED')
    .map((x) => x.entityId);
  if (items.length) {
    await tx.delete(catalogueItem).where(inArray(catalogueItem.id, items));
    sum.catalogueDeleted = items.length;
  }
  const spent = await tx
    .delete(histSpendLine)
    .where(and(eq(histSpendLine.batchId, batch.id), eq(histSpendLine.tenantId, ctx.tenantId)))
    .returning({ id: histSpendLine.id });
  sum.spendLinesDeleted = spent.length;
  // suppliers the batch created: deleted when nothing refers to them; kept when a retained contract still does
  for (const l of ledger.filter((x) => x.entityType === 'SUPPLIER' && x.action === 'CREATED')) {
    const stillUsed = await tx
      .select({ id: contract.id })
      .from(contract)
      .where(eq(contract.supplierId, l.entityId))
      .limit(1);
    if (stillUsed.length > 0) {
      sum.suppliersKept += 1;
      continue;
    }
    await tx.delete(supplier).where(eq(supplier.id, l.entityId));
    sum.suppliersDeleted += 1;
  }
  await tx
    .update(histBatch)
    .set({ status: 'ROLLED_BACK', rolledBackAt: now, rolledBackBy: ctx.userId, rollbackNote: reason })
    .where(eq(histBatch.id, batch.id));
  await tx
    .update(histRow)
    .set({ status: 'SKIPPED' })
    .where(and(eq(histRow.batchId, batch.id), inArray(histRow.status, ['LOADED', 'MERGED'])));
  return sum;
}
