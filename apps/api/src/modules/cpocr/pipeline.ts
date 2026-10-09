/**
 * The pure part of the ingestion pipeline (CP-07): from recognised pages to fields, clauses and findings, and the review
 * rules (which fields must be looked at, how a correction is applied). No database here, so each rule is tested on its own.
 */
import { AppError } from '../../http/errors.js';
import { buildFindings, detectClauses } from './clauselib.js';
import { FIELD_DEFS, applyReviewRules, displayOf, extractFields } from './extract.js';
import { amountFromText, isValidAbn, parseDateText } from './text.js';
import type {
  DetectedClause,
  ExtractedField,
  FieldKey,
  FieldMap,
  Finding,
  LibraryClause,
  OcrPage,
} from './types.js';

export interface Analysis {
  fields: ExtractedField[];
  clauses: DetectedClause[];
  findings: Finding[];
  status: 'NEEDS_REVIEW' | 'READY';
}

const toMap = (fields: ExtractedField[]): FieldMap => Object.fromEntries(fields.map((f) => [f.key, f]));

export function analyse(
  pages: OcrPage[],
  library: LibraryClause[],
  threshold: number,
  today: string,
): Analysis {
  const raw = extractFields(pages);
  const fields = applyReviewRules(
    FIELD_DEFS.map((d) => raw[d.key]!),
    threshold,
  );
  const clauses = detectClauses(pages, library);
  const findings = buildFindings(toMap(fields), clauses, today);
  return { fields, clauses, findings, status: fields.some((f) => f.needsReview) ? 'NEEDS_REVIEW' : 'READY' };
}

/** After a review step: recompute which fields still need review and the findings that depend on field values. */
export function reassess(
  fields: ExtractedField[],
  clauses: DetectedClause[],
  threshold: number,
  today: string,
): Pick<Analysis, 'fields' | 'findings' | 'status'> {
  const next = applyReviewRules(fields, threshold);
  return {
    fields: next,
    findings: buildFindings(toMap(next), clauses, today),
    status: next.some((f) => f.needsReview) ? 'NEEDS_REVIEW' : 'READY',
  };
}

// ------------------------------------------------------------------ corrections

const bad = (key: string, message: string): never => {
  throw new AppError(422, 'CORRECTION_INVALID', message, [{ field: key, message }]);
};

const CURRENCIES = ['AUD', 'USD', 'EUR', 'GBP', 'NZD', 'JPY', 'SGD'];

const text = (key: string, v: unknown, max = 200): string => {
  if (typeof v !== 'string' || v.trim().length < 1 || v.trim().length > max)
    return bad(key, `Enter text of 1 to ${max} characters`);
  return v.trim().replace(/\s+/g, ' ');
};
const int = (key: string, v: unknown, max: number): number => {
  const n = typeof v === 'string' ? Number(v.trim()) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > max)
    return bad(key, `Enter a whole number from 0 to ${max}`);
  return n;
};
const present = (key: string, v: unknown): boolean | null => {
  if (v === null || v === false) return null;
  if (v === true) return true;
  if (v && typeof v === 'object' && (v as { present?: unknown }).present === true) return true;
  return bad(key, 'Use true for present, or null for not present');
};

/**
 * Validates a reviewer's value for a field and returns the typed value stored in the field (null means "not in the contract").
 * Throws 422 CORRECTION_INVALID with the field named.
 */
export function coerceCorrection(key: FieldKey, v: unknown, old: ExtractedField): unknown {
  const def = FIELD_DEFS.find((d) => d.key === key);
  if (!def) return bad(String(key), 'Unknown field');
  if (v === null && def.required) return bad(key, 'This field is required for the contract record');
  switch (key) {
    case 'title':
    case 'contractNumber':
    case 'customer':
    case 'supplier':
    case 'governingLaw':
      return text(key, v);
    case 'supplierAbn': {
      const d = String(v ?? '').replace(/\s+/g, '');
      if (!/^\d{11}$/.test(d)) return bad(key, 'An ABN has 11 digits');
      if (!isValidAbn(d))
        return bad(key, 'This ABN does not pass the ABN check; check it against the ABN Lookup');
      return d;
    }
    case 'effectiveDate':
    case 'endDate': {
      const iso = typeof v === 'string' ? parseDateText(v) : null;
      if (!iso) return bad(key, 'Enter a real date, such as 2026-07-01 or 1 July 2026');
      return iso;
    }
    case 'termMonths':
      return int(key, v, 600);
    case 'noticeDays':
      return int(key, v, 3650);
    case 'paymentTerms':
      return int(key, v, 365);
    case 'value': {
      let amount: number | null = null;
      let currency = 'AUD';
      if (typeof v === 'number') amount = v;
      else if (typeof v === 'string') {
        const m =
          /^\s*([A-Z]{3})?\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(million|m|k|thousand)?\s*$/i.exec(v);
        if (m) {
          currency = (m[1] ?? 'AUD').toUpperCase();
          amount = amountFromText(m[2]!, m[3]);
        }
      } else if (v && typeof v === 'object') {
        const o = v as { amount?: unknown; currency?: unknown };
        if (typeof o.amount === 'number') amount = o.amount;
        if (typeof o.currency === 'string') currency = o.currency.toUpperCase();
      }
      if (amount === null || !(amount > 0) || amount > 1e11)
        return bad(key, 'Enter an amount greater than zero, such as AUD 1,250,000');
      if (!CURRENCIES.includes(currency)) return bad(key, `Currency must be one of ${CURRENCIES.join(', ')}`);
      return { amount: Math.round(amount * 100) / 100, currency };
    }
    case 'renewal': {
      if (v === null) return null;
      const o = v as { kind?: unknown; count?: unknown; months?: unknown };
      if (!o || typeof o !== 'object' || (o.kind !== 'OPTION' && o.kind !== 'AUTO_RENEWAL'))
        return bad(key, 'kind must be OPTION or AUTO_RENEWAL');
      const months = int(key, o.months, 120);
      const count = o.kind === 'OPTION' ? int(key, o.count ?? 1, 10) : 1;
      if (months < 1 || count < 1) return bad(key, 'months and count must be at least 1');
      return {
        kind: o.kind,
        count,
        months,
        extensionsMonths: o.kind === 'OPTION' ? Array(count).fill(months) : [],
      };
    }
    case 'liabilityCap': {
      if (v === null) return null;
      const o = v as { basis?: unknown; amount?: unknown; currency?: unknown; multiple?: unknown };
      if (!o || typeof o !== 'object') return bad(key, 'Enter a cap');
      if (o.basis === 'UNLIMITED') return { basis: 'UNLIMITED' };
      if (o.basis === 'FIXED') {
        const amount = typeof o.amount === 'number' ? o.amount : NaN;
        const currency = typeof o.currency === 'string' ? o.currency.toUpperCase() : 'AUD';
        if (!(amount > 0) || !CURRENCIES.includes(currency))
          return bad(key, 'A fixed cap needs an amount and a currency');
        return { basis: 'FIXED', amount, currency };
      }
      if (o.basis === 'FEES_12_MONTHS')
        return {
          basis: 'FEES_12_MONTHS',
          multiple: typeof o.multiple === 'number' && o.multiple > 0 ? o.multiple : 1,
          months: 12,
        };
      return bad(key, 'basis must be FIXED, FEES_12_MONTHS or UNLIMITED');
    }
    case 'indemnity':
      return present(key, v)
        ? {
            present: true,
            party:
              old.value && typeof old.value === 'object'
                ? ((old.value as { party?: string }).party ?? 'UNSPECIFIED')
                : 'UNSPECIFIED',
          }
        : null;
    case 'confidentiality':
      return present(key, v) ? { present: true } : null;
    case 'terminationConvenience': {
      if (present(key, v) === null) return null;
      const o = (v && typeof v === 'object' ? v : {}) as { party?: unknown; noticeDays?: unknown };
      const party = ['CUSTOMER', 'SUPPLIER', 'EITHER'].includes(String(o.party))
        ? String(o.party)
        : 'UNSPECIFIED';
      return {
        present: true,
        party,
        noticeDays: o.noticeDays === undefined || o.noticeDays === null ? null : int(key, o.noticeDays, 3650),
      };
    }
    case 'serviceLevels': {
      if (v === null) return null;
      if (
        !Array.isArray(v) ||
        v.length === 0 ||
        v.length > 20 ||
        v.some((x) => typeof x !== 'string' || x.length < 3 || x.length > 500)
      )
        return bad(key, 'Enter 1 to 20 service level statements');
      return (v as string[]).map((x) => x.trim());
    }
    case 'dataLocation': {
      if (v === null) return null;
      const loc = text(key, v, 80);
      return { location: loc, inAustralia: /^australia$/i.test(loc) };
    }
    case 'insurance': {
      if (v === null) return null;
      if (!Array.isArray(v) || v.length > 12) return bad(key, 'Enter a list of covers');
      return v.map((c) => {
        const o = c as { cover?: unknown; amount?: unknown; currency?: unknown };
        if (typeof o?.cover !== 'string' || typeof o.amount !== 'number' || !(o.amount > 0))
          return bad(key, 'Each cover needs a name and an amount');
        const currency = typeof o.currency === 'string' ? o.currency.toUpperCase() : 'AUD';
        if (!CURRENCIES.includes(currency)) return bad(key, 'Unknown currency');
        return { cover: o.cover.trim().slice(0, 80), amount: o.amount, currency };
      });
    }
    default:
      return bad(String(key), 'Unknown field');
  }
}

/** The field after a correction: the reviewer's value, full confidence, marked reviewed. The original source span is kept. */
export function applyCorrection(old: ExtractedField, value: unknown, reason?: string): ExtractedField {
  return {
    ...old,
    status: 'CORRECTED',
    value,
    display: value === null ? 'None (not in this contract)' : displayOf(old.key, value),
    confidence: 1,
    ruleConfidence: 1,
    method: 'REVIEWED',
    reviewed: true,
    needsReview: false,
    note: reason ? `Corrected: ${reason}` : 'Corrected by a reviewer',
  };
}
