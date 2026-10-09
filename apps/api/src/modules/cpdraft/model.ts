/**
 * The structured document model behind every Copilot draft (CP-04, CP-05, engine rules-simulated-v1).
 *
 * A draft is NOT a block of prose. It is a small tree: named fields (budget, dates, quantity, ...) and sections that hold
 * items (a paragraph, a requirement, a weighted criterion, a contract clause). Because it is structured, an instruction such
 * as "change the budget to 450k" or "make price 60% and quality 40%" is applied to the right place, never guessed at in
 * text, and two revisions can be compared field by field.
 */
import type { DraftKind } from '../../db/schema-cpb.js';
import { toned } from './library.js';

export const ENGINE = 'rules-simulated-v1';

export type SectionType = 'TEXT' | 'LIST' | 'CRITERIA' | 'CLAUSES';
export interface Item {
  id: string;
  text: string;
  /** Clause title or criterion name. */
  title?: string;
  /** Percent, for criteria. */
  weight?: number;
  mandatory?: boolean;
  stream?: 'TECHNICAL' | 'COMMERCIAL' | 'OTHER';
  /** The wording with {{tokens}}; the text is worked out from it again when a field it quotes changes. */
  tpl?: string;
  /** A person asked for this wording, so it is never re-worked from the template. */
  manual?: boolean;
  /** Marks wording added by "expand" so the same detail is not added twice. */
  tag?: string;
}
export interface Section {
  key: string;
  title: string;
  type: SectionType;
  items: Item[];
}
export interface DraftDoc {
  kind: DraftKind;
  title: string;
  tone: 'FORMAL' | 'PLAIN';
  /** Plain string values keyed by FIELD_LABELS. */
  fields: Record<string, string>;
  sections: Section[];
  /** Things a reader should know before relying on the draft (a placeholder left open, a standard used instead of a template). */
  warnings: string[];
  /** Fields filled from the organisation's own history, so a person confirms them. */
  suggested: string[];
  /** Counter for item ids (i1, i2, ...). Ids never repeat inside a document, so a diff can follow an item. */
  seq: number;
}

export type SourceKind =
  'TEXT_SPAN' | 'HISTORY' | 'CATALOGUE' | 'POLICY' | 'TEMPLATE' | 'RECORD' | 'INSTRUCTION';
export interface SourceRef {
  /** `fields.<key>` or `sections.<key>` or `sections.<key>.<itemId>`. */
  path: string;
  kind: SourceKind;
  label: string;
  quote?: string;
  span?: [number, number];
}

export const FIELD_LABELS: Record<string, string> = {
  title: 'Title',
  category: 'Category',
  estimatedValue: 'Budget (estimated value, AUD)',
  termMonths: 'Term (months)',
  startDate: 'Start date',
  endDate: 'End date',
  closeDate: 'Closing date',
  businessUnit: 'Business unit',
  contractOwner: 'Contract owner',
  supplyLocation: 'Supply location',
  dataSensitivity: 'Data sensitivity',
  quantity: 'Quantity',
  quantityUnit: 'Quantity unit',
  supplierHints: 'Suppliers mentioned',
  riskFlags: 'Risk flags',
  tenderType: 'Tender type',
  organisation: 'Organisation',
  noticeDays: 'Notice period (days)',
  serviceLevels: 'Service levels (summary)',
};

export const newId = (doc: DraftDoc) => `i${(doc.seq += 1)}`;
export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
export const sectionOf = (doc: DraftDoc, key: string) => doc.sections.find((s) => s.key === key);

// ------------------------------------------------------------------------------------------------ formatting
export const aud = (n: number) => `AUD ${Math.round(n).toLocaleString('en-AU')}`;
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
export const longDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : iso;
};

/** The values a {{token}} can stand for. Tokens in the contract clause library are upper case; both spellings work. */
export function tokenValues(doc: DraftDoc): Record<string, string> {
  const f = doc.fields;
  const v = Number(f.estimatedValue);
  const qty = f.quantity ? `${f.quantity}${f.quantityUnit ? ` ${f.quantityUnit}` : ''}` : '';
  return {
    TITLE: f.title ?? doc.title,
    CATEGORY: (f.category ?? '').replace(/\s*\(UNSPSC[^)]*\)/, ''),
    VALUE: Number.isFinite(v) && f.estimatedValue ? aud(v) : 'to be confirmed',
    TERM: f.termMonths ? `${f.termMonths} months` : 'to be confirmed',
    START: f.startDate ? longDate(f.startDate) : 'to be confirmed',
    END: f.endDate ? longDate(f.endDate) : 'to be confirmed',
    CLOSE: f.closeDate ? longDate(f.closeDate) : 'to be confirmed',
    APPROVER:
      Number.isFinite(v) && v >= 250_000
        ? 'Executive (sourcing authority above AUD 250,000)'
        : 'Delegate (sourcing authority up to AUD 250,000)',
    QTY: qty || 'the agreed quantity',
    UNIT: f.businessUnit ?? 'to be confirmed',
    OWNER: f.contractOwner ?? 'to be confirmed',
    CUSTOMER: f.organisation ?? 'the Customer',
    SUPPLIER: '{{SUPPLIER}}',
    ABN: '{{ABN}}',
    NOTICE_DAYS: f.noticeDays ?? '90',
    SLA: f.serviceLevels ?? 'as set out in the service levels schedule',
    REQUEST: f.requestNumber ?? 'the procurement',
  };
}
export const render = (tpl: string, doc: DraftDoc): string => {
  const t = tokenValues(doc);
  return tpl.replace(/\{\{([A-Za-z_]+)\}\}/g, (m, k: string) =>
    k === 'SUPPLIER' || k === 'ABN' ? m : (t[k.toUpperCase()] ?? m),
  );
};
/** Works the wording of every item that quotes a field out again, after a field has changed. */
export function refreshDerived(doc: DraftDoc): void {
  for (const s of doc.sections)
    for (const it of s.items)
      if (it.tpl && !it.manual)
        it.text = doc.tone === 'PLAIN' ? toned(render(it.tpl, doc), 'PLAIN') : render(it.tpl, doc);
}

// ------------------------------------------------------------------------------------------------ flatten and diff
export interface DiffEntry {
  path: string;
  label: string;
  change: 'ADDED' | 'REMOVED' | 'CHANGED';
  before?: string;
  after?: string;
}
interface Flat {
  label: string;
  value: string;
}
const short = (s: string, n = 40) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const itemName = (s: Section, i: Item, idx: number) =>
  s.type === 'CRITERIA'
    ? (i.title ?? `item ${idx + 1}`)
    : s.type === 'CLAUSES'
      ? (i.title ?? `clause ${idx + 1}`)
      : `item ${idx + 1}`;

/** Every value in the document with a stable path and a readable label. */
export function flatten(doc: DraftDoc): Map<string, Flat> {
  const out = new Map<string, Flat>();
  out.set('doc.tone', { label: 'Tone', value: doc.tone === 'PLAIN' ? 'Plain' : 'Formal' });
  out.set('doc.sectionOrder', {
    label: 'Order of sections',
    value: doc.sections.map((s) => s.title).join(', '),
  });
  for (const [k, v] of Object.entries(doc.fields))
    if (v !== '') out.set(`fields.${k}`, { label: FIELD_LABELS[k] ?? k, value: v });
  for (const s of doc.sections) {
    s.items.forEach((it, idx) => {
      const base = `sections.${s.key}.${it.id}`;
      const name = `${s.title} · ${itemName(s, it, idx)}`;
      if (s.type === 'CRITERIA') {
        out.set(`${base}.weight`, { label: `${name} · weight`, value: `${it.weight ?? 0}%` });
        out.set(`${base}.text`, { label: `${name} · description`, value: it.text });
        out.set(`${base}.title`, {
          label: `${s.title} · criterion ${idx + 1} · name`,
          value: it.title ?? '',
        });
      } else if (s.type === 'CLAUSES') {
        out.set(`${base}.title`, { label: `${s.title} · clause ${idx + 1} · title`, value: it.title ?? '' });
        out.set(`${base}.text`, { label: name, value: it.text });
      } else out.set(base, { label: name, value: it.text });
    });
    out.set(`sections.${s.key}.__order`, {
      label: `${s.title} · order of items`,
      value: s.items.map((it, i) => `${i + 1}. ${short(it.title ?? it.text, 28)}`).join(' | '),
    });
  }
  return out;
}

/** Field-level before and after. Items are followed by id, so a moved or reworded item is one change, not a delete and an add. */
export function diffDocs(before: DraftDoc, after: DraftDoc): DiffEntry[] {
  const a = flatten(before);
  const b = flatten(after);
  const out: DiffEntry[] = [];
  for (const [path, v] of b) {
    const o = a.get(path);
    if (!o) {
      if (path.endsWith('.__order')) continue; // a new section's order is not news on its own
      out.push({ path, label: v.label, change: 'ADDED', after: v.value });
    } else if (o.value !== v.value)
      out.push({ path, label: v.label, change: 'CHANGED', before: o.value, after: v.value });
  }
  for (const [path, v] of a)
    if (!b.has(path) && !path.endsWith('.__order'))
      out.push({ path, label: v.label, change: 'REMOVED', before: v.value });
  return out;
}

// ------------------------------------------------------------------------------------------------ plain text view
/** The document as readable text, the same text a person would paste into a record. */
export function renderContent(doc: DraftDoc): string {
  const lines: string[] = [`# ${doc.title}`, ''];
  const f = doc.fields;
  const facts = [
    f.category && `Category: ${f.category}`,
    f.estimatedValue && doc.kind !== 'TENDER_DOC' && `Budget: ${aud(Number(f.estimatedValue))}`,
    f.termMonths && `Term: ${f.termMonths} months`,
    f.startDate && `Start: ${longDate(f.startDate)}`,
    f.endDate && `End: ${longDate(f.endDate)}`,
    f.quantity && `Quantity: ${f.quantity}${f.quantityUnit ? ` ${f.quantityUnit}` : ''}`,
  ].filter(Boolean);
  if (facts.length) lines.push(facts.join(' | '), '');
  for (const s of doc.sections) {
    lines.push(`## ${s.title}`);
    s.items.forEach((it, i) => {
      if (s.type === 'TEXT') lines.push(it.text, '');
      else if (s.type === 'LIST') lines.push(`${i + 1}. ${it.text}`);
      else if (s.type === 'CRITERIA')
        lines.push(`${i + 1}. ${it.title ?? ''} (${it.weight ?? 0}%): ${it.text}`);
      else lines.push(`${i + 1}. ${it.title ?? ''}: ${it.text}`);
    });
    if (s.type !== 'TEXT') lines.push('');
    if (s.type === 'CRITERIA') {
      const total = s.items.reduce((n, it) => n + (it.weight ?? 0), 0);
      lines.splice(lines.length - 1, 0, `Total weight: ${total}%`);
    }
  }
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
