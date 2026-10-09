/**
 * Row validation and duplicate detection for the historical import (CP-07). Pure: it is given the mapped rows and a snapshot
 * of what is already in the system, and returns, for each row, the cleaned values, the problems found (each tagged with the
 * rule that found it), warnings, and any duplicate. The dry run shows this; the commit runs it again on the live data and
 * loads only what passes. Nothing here touches the database.
 */
import type { HistEntity } from '../../db/schema-cpd.js';
import { nameAlike, nameKey } from './names.js';
import { extractLegacy } from '../migration/rules.js';
import { CURRENCIES, FIELDS, fieldDef, type FieldDef } from './fields.js';
import type { Mapping } from './mapping.js';
import {
  ABN_PLACEHOLDER,
  abnDigits,
  abnState,
  isEmail,
  normaliseStatus,
  parseAmountLoose,
  parseDateLoose,
  parseIntLoose,
} from './normalise.js';

export const VALIDATION_ENGINE = 'rules-simulated-v1';
export const SIMILAR_NAME = 0.84;

export interface RowIssue {
  rule:
    | 'REQUIRED'
    | 'DATE_FORMAT'
    | 'DATE_ORDER'
    | 'DATE_RANGE'
    | 'DATE_FUTURE'
    | 'AMOUNT_FORMAT'
    | 'AMOUNT_RANGE'
    | 'ABN_CHECKSUM'
    | 'ALLOWED_VALUE'
    | 'INTEGER'
    | 'EMAIL'
    | 'TEXT_LENGTH'
    | 'SUPPLIER_NOT_FOUND'
    | 'DUPLICATE_IN_FILE'
    | 'DUPLICATE_EXISTING';
  field?: string;
  message: string;
  value?: string;
}
export interface RowWarning {
  rule: string;
  field?: string;
  message: string;
}
export interface Dup {
  kind: 'EXISTING' | 'IN_FILE';
  /** The record it matches in the system (existing supplier, contract or catalogue item), when there is one. */
  entityId?: string;
  label: string;
  /** The earlier row of the same file it repeats, when it repeats one. */
  ofRow?: number;
  reason: string;
}

export type RowStatus = 'VALID' | 'ERROR' | 'DUPLICATE';
export interface RowResult {
  rowNo: number;
  status: RowStatus;
  /** Clean values by field key; null when the row has problems that stop it being read. */
  values: Record<string, string | number | null> | null;
  issues: RowIssue[];
  warnings: RowWarning[];
  duplicate: Dup | null;
}

export interface SupplierLite {
  id: string;
  company: string;
  abn: string;
}
export interface Existing {
  today: string;
  suppliers: SupplierLite[];
  /** Live contract numbers (lower case) -> the contract. */
  contracts: Map<string, { id: string; label: string }>;
  /** `${supplierId}|${sku lower}` -> catalogue item. */
  catalogue: Map<string, { id: string; label: string }>;
  /** Signatures of spend lines already loaded. */
  spend: Set<string>;
  users: Array<{ id: string; name: string; email: string }>;
}

const MAX_LEN: Record<string, number> = {
  contract_number: 60,
  title: 300,
  supplier: 200,
  company: 200,
  owner: 120,
  text: 4000,
  sku: 60,
  name: 300,
  category: 120,
  unit: 30,
  city: 80,
  state: 40,
  business_unit: 120,
  cost_centre: 60,
  reference: 80,
  description: 400,
  email: 200,
};

// ------------------------------------------------------------------ supplier matching (shared with the commit)
export type SupplierMatch =
  { kind: 'EXISTING'; id: string; company: string; how: 'ABN' | 'NAME'; note?: string } | { kind: 'NEW' };

/** Finds the supplier a name and ABN refer to among existing suppliers and those already created by this batch. */
export class SupplierIndex {
  private list: SupplierLite[];
  private byAbn = new Map<string, SupplierLite>();
  private byName = new Map<string, SupplierLite>();
  constructor(suppliers: SupplierLite[]) {
    this.list = [];
    for (const s of suppliers) this.add(s);
  }
  add(s: SupplierLite) {
    this.list.push(s);
    if (s.abn && s.abn !== ABN_PLACEHOLDER && !this.byAbn.has(s.abn)) this.byAbn.set(s.abn, s);
    const n = nameKey(s.company);
    if (n && !this.byName.has(n)) this.byName.set(n, s);
  }
  find(name: string, abn: string | null): SupplierMatch {
    if (abn) {
      const hit = this.byAbn.get(abn);
      if (hit)
        return {
          kind: 'EXISTING',
          id: hit.id,
          company: hit.company,
          how: 'ABN',
          ...(nameKey(hit.company) !== nameKey(name)
            ? { note: `The ABN belongs to "${hit.company}", not "${name}"` }
            : {}),
        };
    }
    const hit = this.byName.get(nameKey(name));
    if (hit) {
      // the same name with a different real ABN is a different business until someone says otherwise
      if (abn && hit.abn !== ABN_PLACEHOLDER && hit.abn !== abn) return { kind: 'NEW' };
      return { kind: 'EXISTING', id: hit.id, company: hit.company, how: 'NAME' };
    }
    return { kind: 'NEW' };
  }
  /** The most similar other supplier (not an exact match) at or above the threshold. */
  near(name: string, abn: string | null): { company: string; score: number } | null {
    const exact = this.find(name, abn);
    let best: { company: string; score: number } | null = null;
    for (const s of this.list) {
      if (exact.kind === 'EXISTING' && exact.id === s.id) continue;
      const score = nameAlike(name, s.company);
      if (score >= SIMILAR_NAME && score < 1 && (!best || score > best.score))
        best = { company: s.company, score };
    }
    return best;
  }
}

// ------------------------------------------------------------------ validation
const cellOf = (raw: Record<string, string>, mapping: Mapping, field: string): string => {
  const h = mapping[field];
  return h ? (raw[h] ?? '').trim() : '';
};

export function spendSignature(
  supplier: string,
  date: string,
  amount: number,
  reference: string | null,
): string {
  return [nameKey(supplier), date, amount.toFixed(2), (reference ?? '').toLowerCase()].join('|');
}

export interface ValidateInput {
  entity: HistEntity;
  mapping: Mapping;
  rows: Array<{ rowNo: number; raw: Record<string, string> }>;
  existing: Existing;
}

export interface ValidateOutput {
  rows: RowResult[];
  /** Name variants found inside the file (and against existing suppliers): groups of names that look like one business. */
  variants: Array<{ names: string[]; rows: number[] }>;
  /** How many suppliers a load would create (contracts and suppliers) and how many it would link to existing ones. */
  suppliersNew: number;
  suppliersLinked: number;
}

export function validateRows(input: ValidateInput): ValidateOutput {
  const { entity, mapping, existing } = input;
  const index = new SupplierIndex(existing.suppliers);
  const fields = FIELDS[entity];
  const seenKey = new Map<string, number>();
  const seenAgreement = new Map<string, number>();
  const results: RowResult[] = [];
  let suppliersLinked = 0;
  let suppliersNew = 0;
  let rowNoNow = 0;

  /** Contract rows name suppliers: an existing one is linked; an unknown one is counted as new (once per business). */
  const noteSupplier = (name: string, abn: string | null) => {
    if (!name) return;
    const m = index.find(name, abn);
    if (m.kind === 'EXISTING') {
      if (!m.id.startsWith('new:')) suppliersLinked += 1;
      return;
    }
    suppliersNew += 1;
    index.add({ id: `new:${suppliersNew}`, company: name, abn: abn ?? ABN_PLACEHOLDER });
  };

  // ------------------------------------------------------------------ per-entity rules
  const contractRules = (
    v: Record<string, string | number | null>,
    t: Record<string, string>,
    iss: RowIssue[],
    warn: RowWarning[],
  ): Dup | null => {
    const start = v.start_date as string | null;
    const end = v.end_date as string | null;
    if (start && end) {
      if (end <= start)
        iss.push({
          rule: 'DATE_ORDER',
          field: 'end_date',
          message: 'The end date is not after the start date',
          value: t.end_date!,
        });
      else if (Number(end.slice(0, 4)) - Number(start.slice(0, 4)) > 40)
        iss.push({
          rule: 'DATE_RANGE',
          field: 'end_date',
          message: 'A term longer than 40 years is not credible; check the dates',
          value: t.end_date!,
        });
      else if (end < existing.today)
        warn.push({
          rule: 'CONTRACT_ENDED',
          field: 'end_date',
          message: 'The contract has already ended; it is kept as history and no reminders are sent.',
        });
    }
    const value = v.value as number | null;
    if (value !== null && value <= 0)
      iss.push({
        rule: 'AMOUNT_RANGE',
        field: 'value',
        message: 'The contract value must be more than zero',
        value: t.value!,
      });
    const status = v.status as string | null;
    if (status === 'TERMINATED' || status === 'CANCELLED')
      warn.push({
        rule: 'TERMINATED',
        field: 'status',
        message: 'Loaded as ended: no reminders are scheduled.',
      });
    const cur = v.currency as string | null;
    if (cur && cur !== 'AUD')
      warn.push({
        rule: 'CURRENCY_NOT_AUD',
        field: 'currency',
        message: `The value is in ${cur} and is loaded as stated, not converted.`,
      });
    if (!t.owner)
      warn.push({
        rule: 'NO_OWNER',
        field: 'owner',
        message: 'No contract owner: reminders go to contract managers.',
      });
    else {
      const o = t.owner.toLowerCase();
      if (!existing.users.some((u) => u.name.toLowerCase() === o || u.email.toLowerCase() === o))
        warn.push({
          rule: 'OWNER_NOT_FOUND',
          field: 'owner',
          message: `"${t.owner}" is not a user: reminders go to contract managers.`,
        });
    }
    if (!t.text && !t.notice_months)
      warn.push({
        rule: 'NOTICE_ASSUMED',
        field: 'notice_months',
        message: 'No notice period or wording: a 90-day notice period is assumed.',
      });
    let dup: Dup | null = null;
    const num = (v.contract_number as string | null)?.toLowerCase() ?? null;
    if (num) {
      const ex = existing.contracts.get(num);
      if (ex)
        dup = {
          kind: 'EXISTING',
          entityId: ex.id,
          label: ex.label,
          reason: `Contract ${v.contract_number} already exists`,
        };
      else if (seenKey.has(num))
        dup = {
          kind: 'IN_FILE',
          ofRow: seenKey.get(num)!,
          label: `row ${seenKey.get(num)}`,
          reason: `Contract ${v.contract_number} appears earlier in the file (row ${seenKey.get(num)})`,
        };
      else seenKey.set(num, rowNoNow);
    }
    const sup = (v.supplier as string | null) ?? '';
    if (sup && start && end && value) {
      const ag = [nameKey(sup), start, end, value].join('|');
      const prior = seenAgreement.get(ag);
      if (prior !== undefined && !dup)
        warn.push({
          rule: 'SIMILAR_CONTRACT',
          message: `Same supplier, dates and value as row ${prior} under a different number: may be the same agreement.`,
        });
      else seenAgreement.set(ag, rowNoNow);
    }
    return dup;
  };

  const supplierRules = (v: Record<string, string | number | null>, warn: RowWarning[]): Dup | null => {
    const company = (v.company as string | null) ?? '';
    const abn = (v.abn as string | null) ?? null;
    if (!abn)
      warn.push({
        rule: 'NO_ABN',
        field: 'abn',
        message: 'No ABN: the supplier is created with a placeholder and cannot be matched by ABN.',
      });
    if (!company) return null;
    let dup: Dup | null = null;
    const m = index.find(company, abn);
    if (m.kind === 'EXISTING')
      dup = {
        kind: 'EXISTING',
        entityId: m.id,
        label: m.company,
        reason:
          m.how === 'ABN'
            ? `The ABN is already held by "${m.company}"`
            : `A supplier called "${m.company}" already exists`,
      };
    else {
      const near = index.near(company, abn);
      if (near)
        warn.push({
          rule: 'SUPPLIER_VARIANT',
          field: 'company',
          message: `Looks like "${near.company}" already on file (${Math.round(near.score * 100)}% similar). Check before loading.`,
        });
    }
    const nk = `name:${nameKey(company)}`;
    const prior = (abn ? seenKey.get(`abn:${abn}`) : undefined) ?? seenKey.get(nk);
    if (prior !== undefined && !dup)
      dup = {
        kind: 'IN_FILE',
        ofRow: prior,
        label: `row ${prior}`,
        reason: `Same supplier as row ${prior} of this file`,
      };
    if (!dup) {
      if (abn) seenKey.set(`abn:${abn}`, rowNoNow);
      seenKey.set(nk, rowNoNow);
    }
    return dup;
  };

  const catalogueRules = (
    v: Record<string, string | number | null>,
    iss: RowIssue[],
    warn: RowWarning[],
  ): Dup | null => {
    const name = (v.supplier as string | null) ?? '';
    const sku = ((v.sku as string | null) ?? '').toLowerCase();
    if (!name) return null;
    const m = index.find(name, null);
    if (m.kind === 'NEW') {
      iss.push({
        rule: 'SUPPLIER_NOT_FOUND',
        field: 'supplier',
        message: `No supplier called "${name}": import the suppliers first`,
        value: name,
      });
      return null;
    }
    suppliersLinked += 1;
    const cn = ((v.contract_number as string | null) ?? '').toLowerCase();
    if (cn && !existing.contracts.has(cn))
      warn.push({
        rule: 'CONTRACT_NOT_FOUND',
        field: 'contract_number',
        message: `No contract ${v.contract_number}: the item is loaded without a contract link.`,
      });
    if (!sku) return null;
    const k = `${m.id}|${sku}`;
    const ex = existing.catalogue.get(k);
    if (ex)
      return {
        kind: 'EXISTING',
        entityId: ex.id,
        label: ex.label,
        reason: `${v.sku} is already in the catalogue for ${m.company}`,
      };
    if (seenKey.has(k))
      return {
        kind: 'IN_FILE',
        ofRow: seenKey.get(k)!,
        label: `row ${seenKey.get(k)}`,
        reason: `${v.sku} for ${m.company} appears earlier in the file (row ${seenKey.get(k)})`,
      };
    seenKey.set(k, rowNoNow);
    return null;
  };

  const spendRules = (
    v: Record<string, string | number | null>,
    t: Record<string, string>,
    iss: RowIssue[],
    warn: RowWarning[],
  ): Dup | null => {
    const amount = v.amount as number | null;
    if (amount === 0)
      iss.push({
        rule: 'AMOUNT_RANGE',
        field: 'amount',
        message: 'A spend line of zero is not loaded',
        value: t.amount!,
      });
    if (amount !== null && amount < 0)
      warn.push({
        rule: 'CREDIT',
        field: 'amount',
        message: 'A negative amount is loaded as a credit and reduces the totals.',
      });
    const date = v.date as string | null;
    if (date && date > existing.today)
      iss.push({
        rule: 'DATE_FUTURE',
        field: 'date',
        message: 'The date is in the future; historical spend must already have happened',
        value: t.date!,
      });
    const cur = v.currency as string | null;
    if (cur && cur !== 'AUD')
      warn.push({
        rule: 'CURRENCY_NOT_AUD',
        field: 'currency',
        message: `The amount is in ${cur} and is loaded as stated, not converted.`,
      });
    const sup = (v.supplier as string | null) ?? '';
    if (sup) {
      if (index.find(sup, null).kind === 'NEW')
        warn.push({
          rule: 'SUPPLIER_UNMATCHED',
          field: 'supplier',
          message: `"${sup}" is not a supplier on file; the spend is kept under that name.`,
        });
      else suppliersLinked += 1;
    }
    if (!(sup && date && amount !== null && amount !== 0)) return null;
    const sig = spendSignature(sup, date, amount, (v.reference as string | null) ?? null);
    if (existing.spend.has(sig))
      return {
        kind: 'EXISTING',
        label: 'an earlier import',
        reason: 'The same supplier, date, amount and reference were already loaded',
      };
    if (seenKey.has(sig))
      return {
        kind: 'IN_FILE',
        ofRow: seenKey.get(sig)!,
        label: `row ${seenKey.get(sig)}`,
        reason: `Repeats row ${seenKey.get(sig)} (same supplier, date, amount and reference)`,
      };
    seenKey.set(sig, rowNoNow);
    return null;
  };

  for (const { rowNo, raw } of input.rows) {
    rowNoNow = rowNo;
    const issues: RowIssue[] = [];
    const warnings: RowWarning[] = [];
    const values: Record<string, string | number | null> = {};
    const text: Record<string, string> = {};

    // 1. each field: required, then its type
    for (const f of fields) {
      const cell = cellOf(raw, mapping, f.key);
      text[f.key] = cell;
      if (cell === '') {
        values[f.key] = null;
        if (f.required) issues.push({ rule: 'REQUIRED', field: f.key, message: `${f.label} is empty` });
        continue;
      }
      checkField(entity, f, cell, values, issues);
    }

    // 2. rules that look at several fields, and duplicates
    let dup: Dup | null;
    if (entity === 'CONTRACTS') dup = contractRules(values, text, issues, warnings);
    else if (entity === 'SUPPLIERS') dup = supplierRules(values, warnings);
    else if (entity === 'CATALOGUE') dup = catalogueRules(values, issues, warnings);
    else dup = spendRules(values, text, issues, warnings);

    const hard = issues.length > 0;
    const status: RowStatus = hard ? 'ERROR' : dup ? 'DUPLICATE' : 'VALID';
    if (dup)
      issues.push({
        rule: dup.kind === 'EXISTING' ? 'DUPLICATE_EXISTING' : 'DUPLICATE_IN_FILE',
        message: dup.reason,
      });
    results.push({ rowNo, status, values: hard ? null : values, issues, warnings, duplicate: dup });
  }

  // suppliers a load would create or link, counted from the rows that would be loaded
  if (entity === 'CONTRACTS')
    for (const r of results)
      if (r.status === 'VALID')
        noteSupplier(r.values!.supplier as string, r.values!.supplier_abn as string | null);

  const variants = findVariants(entity, results);
  for (const v of variants)
    for (const rowNo of v.rows)
      results
        .find((x) => x.rowNo === rowNo)!
        .warnings.push({
          rule: 'SUPPLIER_VARIANT',
          field: entity === 'CONTRACTS' ? 'supplier' : 'company',
          message: `The name looks like other spellings in this file (${v.names.slice(0, 3).join(' / ')}). They are loaded as separate suppliers; merge them afterwards in Suppliers > Duplicates.`,
        });
  return { rows: results, variants, suppliersNew, suppliersLinked };
}

/** Contract and supplier rows whose names are not the same after normalising but look alike. */
function findVariants(entity: HistEntity, results: RowResult[]): ValidateOutput['variants'] {
  if (entity !== 'CONTRACTS' && entity !== 'SUPPLIERS') return [];
  const names = new Map<string, { name: string; rows: number[] }>();
  for (const r of results) {
    const n =
      entity === 'SUPPLIERS'
        ? (r.values?.company as string | undefined)
        : (r.values?.supplier as string | undefined);
    if (!n) continue;
    const k = nameKey(n);
    const e = names.get(k) ?? { name: n, rows: [] };
    e.rows.push(r.rowNo);
    names.set(k, e);
  }
  const variants: ValidateOutput['variants'] = [];
  const keys = [...names.keys()];
  const used = new Set<string>();
  for (let i = 0; i < keys.length; i++) {
    if (used.has(keys[i]!)) continue;
    const group = [keys[i]!];
    for (let j = i + 1; j < keys.length; j++)
      if (
        !used.has(keys[j]!) &&
        nameAlike(names.get(keys[i]!)!.name, names.get(keys[j]!)!.name) >= SIMILAR_NAME
      )
        group.push(keys[j]!);
    if (group.length > 1) {
      group.forEach((g) => used.add(g));
      variants.push({
        names: group.map((g) => names.get(g)!.name),
        rows: group.flatMap((g) => names.get(g)!.rows).sort((a, b) => a - b),
      });
    }
  }
  return variants;
}

function checkField(
  entity: HistEntity,
  f: FieldDef,
  cell: string,
  out: Record<string, string | number | null>,
  iss: RowIssue[],
) {
  const max = MAX_LEN[f.key];
  if (max && cell.length > max) {
    iss.push({
      rule: 'TEXT_LENGTH',
      field: f.key,
      message: `${f.label} is longer than ${max} characters`,
      value: cell.slice(0, 40),
    });
    out[f.key] = null;
    return;
  }
  switch (f.type) {
    case 'date': {
      const d = parseDateLoose(cell);
      if (!d) {
        iss.push({
          rule: 'DATE_FORMAT',
          field: f.key,
          message: `"${cell}" is not a date (day/month/year, yyyy-mm-dd or 1 Jul 2022)`,
          value: cell,
        });
        out[f.key] = null;
      } else if (d < '1980-01-01' || d > '2100-12-31') {
        iss.push({ rule: 'DATE_RANGE', field: f.key, message: `${d} is outside 1980 to 2100`, value: cell });
        out[f.key] = null;
      } else out[f.key] = d;
      break;
    }
    case 'amount': {
      const n = parseAmountLoose(cell);
      if (n === null) {
        iss.push({ rule: 'AMOUNT_FORMAT', field: f.key, message: `"${cell}" is not an amount`, value: cell });
        out[f.key] = null;
      } else if (n < 0 && !(entity === 'SPEND' && f.key === 'amount')) {
        iss.push({
          rule: 'AMOUNT_RANGE',
          field: f.key,
          message: `${f.label} cannot be negative`,
          value: cell,
        });
        out[f.key] = null;
      } else out[f.key] = n;
      break;
    }
    case 'abn': {
      const s = abnState(cell);
      if (s === 'BAD_FORMAT') {
        iss.push({
          rule: 'ABN_CHECKSUM',
          field: f.key,
          message: `"${cell}" is not an 11-digit ABN`,
          value: cell,
        });
        out[f.key] = null;
      } else if (s === 'BAD_CHECKSUM') {
        iss.push({
          rule: 'ABN_CHECKSUM',
          field: f.key,
          message: `"${cell}" fails the ABN check digits`,
          value: cell,
        });
        out[f.key] = null;
      } else out[f.key] = abnDigits(cell);
      break;
    }
    case 'int': {
      const n = parseIntLoose(cell);
      const hi = f.key === 'notice_months' ? 120 : 3650;
      if (n === null || n > hi) {
        iss.push({
          rule: 'INTEGER',
          field: f.key,
          message: `"${cell}" is not a whole number (0 to ${hi})`,
          value: cell,
        });
        out[f.key] = null;
      } else out[f.key] = n;
      break;
    }
    case 'enum': {
      const v = f.key === 'currency' ? cell.trim().toUpperCase() : normaliseStatus(cell);
      if (!f.allowed?.includes(v)) {
        iss.push({
          rule: 'ALLOWED_VALUE',
          field: f.key,
          message: `"${cell}" is not one of ${f.allowed?.join(', ')}`,
          value: cell,
        });
        out[f.key] = null;
      } else out[f.key] = v;
      break;
    }
    case 'email': {
      if (!isEmail(cell)) {
        iss.push({ rule: 'EMAIL', field: f.key, message: `"${cell}" is not an email address`, value: cell });
        out[f.key] = null;
      } else out[f.key] = cell.toLowerCase();
      break;
    }
    default:
      out[f.key] = cell;
  }
}

/** What the contract text gives (shown in the dry run, and used by the commit). */
export function readContractText(text: string | null | undefined) {
  return extractLegacy(text ?? undefined);
}

export const KNOWN_CURRENCIES: readonly string[] = CURRENCIES;
export { fieldDef };
