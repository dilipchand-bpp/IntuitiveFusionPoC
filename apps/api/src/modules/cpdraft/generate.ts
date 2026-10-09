/**
 * Deterministic drafting (CP-04): free text, and the record when there is one, become a structured document by fixed rules.
 * Nothing is invented: a fact is used only when the text, the record, the organisation's own history, the catalogue or a
 * written policy supports it, and each field says which. Facts the sources do not give stay "to be confirmed" and are listed
 * as missing. Engine label: rules-simulated-v1.
 */
import { gatesFor, scoreComplexity } from '../intake/complexity.js';
import type { FieldMap } from '../intake/fields.js';
import { PLAN_FIELDS, splitParagraphs } from '../plan/fields.js';
import { draftPlan } from '../plan/generate.js';
import { SERVICES_TEMPLATE, WORKS_TEMPLATE, type TemplateBody } from '../contract/clauses.js';
import { buildTenderPack, evaluationCriteria } from '../tender/pack.js';
import { TENDER_TYPE_NAME, type TenderType } from '../tender/fields.js';
import type { DraftKind } from '../../db/schema-cpb.js';
import {
  CLAUSES,
  CRITERIA,
  REQUIREMENTS,
  RISKS,
  profileFor,
  riskLine,
  type LibRequirement,
  type LibRisk,
} from './library.js';
import {
  addMonthsIso,
  endOfTerm,
  extractFacts,
  monthsBetween,
  sentenceCase,
  type Facts,
  type FlagCode,
  type Span,
} from './lang.js';
import {
  aud,
  newId,
  refreshDerived,
  render,
  type DraftDoc,
  type Item,
  type Section,
  type SectionType,
  type SourceRef,
} from './model.js';

export interface RecordInfo {
  id: string;
  number: string;
  title: string;
  category?: string | undefined;
  estimatedValue?: number | undefined;
  termMonths?: number | undefined;
  businessUnit?: string | undefined;
  status?: string | undefined;
  /** Stored request field values (background, deliverables, risk, contractOwner, dataSensitivity, supplyLocation, ...). */
  fields: Record<string, string>;
}
export interface HistoryInfo {
  count: number;
  medianValue?: number | undefined;
  medianTerm?: number | undefined;
  commonUnit?: string | undefined;
}
export interface CatalogueHit {
  sku: string;
  name: string;
  supplier: string;
  unitPrice: number;
  unit: string;
}
export interface GenInput {
  kind: DraftKind;
  text: string;
  today: Date;
  organisation: string;
  record?: RecordInfo | undefined;
  history?: HistoryInfo | undefined;
  catalogue?: CatalogueHit[] | undefined;
  knownSuppliers?: string[] | undefined;
  /** The tenant's active contract clause templates (the clause library), when it has them. */
  templates?: Array<{ id: string; body: unknown }> | undefined;
}
export interface Generated {
  doc: DraftDoc;
  sources: SourceRef[];
  /** Fields a person still has to give. */
  missing: string[];
  /** Fields filled from in-house history, to be confirmed. */
  suggested: string[];
  warnings: string[];
  facts: Facts;
}

const KIND_TITLE: Record<DraftKind, string> = {
  REQUEST: 'Procurement request',
  PLAN: 'Procurement plan',
  JOB_SPEC: 'Job specification (scope of work)',
  TENDER_DOC: 'Tender document',
  CONTRACT_DRAFT: 'Contract draft',
  EVAL_CRITERIA: 'Evaluation criteria',
};
export const SECTION_TITLES: Record<string, string> = {
  background: 'Background',
  objectives: 'Objectives',
  scope: 'Scope of work',
  requirements: 'Requirements',
  deliverables: 'Deliverables',
  serviceLevels: 'Service levels',
  personnel: 'Skills and personnel',
  timeline: 'Timeline',
  evaluationHints: 'Evaluation hints',
  assumptions: 'Assumptions',
  risks: 'Risks and mitigation',
  overview: 'Overview',
  timetable: 'Timetable',
  evaluationCriteria: 'Evaluation criteria',
  conditions: 'Conditions of tendering',
  submission: 'How to submit',
  contact: 'Questions and contact',
  schedule: 'Key terms',
  clauses: 'Clauses',
  criteria: 'Criteria and weights',
  mandatoryGates: 'Pass or fail requirements',
  scoringMethod: 'How scoring works',
  notes: 'Notes for evaluators',
};
export const TYPE_OF: Record<string, SectionType> = {
  background: 'TEXT',
  objectives: 'LIST',
  scope: 'LIST',
  requirements: 'LIST',
  deliverables: 'LIST',
  serviceLevels: 'LIST',
  personnel: 'LIST',
  timeline: 'LIST',
  evaluationHints: 'LIST',
  assumptions: 'LIST',
  risks: 'LIST',
  overview: 'TEXT',
  timetable: 'LIST',
  evaluationCriteria: 'CRITERIA',
  conditions: 'LIST',
  submission: 'TEXT',
  contact: 'TEXT',
  schedule: 'LIST',
  clauses: 'CLAUSES',
  criteria: 'CRITERIA',
  mandatoryGates: 'LIST',
  scoringMethod: 'TEXT',
  notes: 'LIST',
};

// ------------------------------------------------------------------------------------------------ builder
class Builder {
  doc: DraftDoc;
  sources: SourceRef[] = [];
  constructor(kind: DraftKind) {
    this.doc = {
      kind,
      title: KIND_TITLE[kind],
      tone: 'FORMAL',
      fields: {},
      sections: [],
      warnings: [],
      suggested: [],
      seq: 0,
    };
  }
  src(path: string, kind: SourceRef['kind'], label: string, span?: Span) {
    this.sources.push({ path, kind, label, ...(span ? { quote: span.quote, span: span.span } : {}) });
  }
  field(
    key: string,
    value: string | number | undefined,
    kind: SourceRef['kind'],
    label: string,
    span?: Span,
  ) {
    if (value === undefined || String(value).trim() === '') return;
    this.doc.fields[key] = String(value);
    this.src(`fields.${key}`, kind, label, span);
  }
  section(key: string, title?: string, type?: SectionType): Section {
    let s = this.doc.sections.find((x) => x.key === key);
    if (!s) {
      s = {
        key,
        title: title ?? SECTION_TITLES[key] ?? key,
        type: type ?? TYPE_OF[key] ?? 'LIST',
        items: [],
      };
      this.doc.sections.push(s);
    }
    return s;
  }
  /** Adds an item; `tpl` makes it follow the fields it quotes. */
  add(
    key: string,
    text: string,
    src?: { kind: SourceRef['kind']; label: string; span?: Span | undefined },
    extra: Partial<Item> = {},
  ): Item {
    const s = this.section(key);
    const it: Item = { id: newId(this.doc), text, ...extra };
    s.items.push(it);
    if (src) this.src(`sections.${key}.${it.id}`, src.kind, src.label, src.span);
    return it;
  }
  /** A templated item: the text is worked out from the fields now, and again whenever they change. */
  tpl(
    key: string,
    tpl: string,
    src?: { kind: SourceRef['kind']; label: string; span?: Span | undefined },
    extra: Partial<Item> = {},
  ) {
    return this.add(key, render(tpl, this.doc), src, { ...extra, tpl });
  }
}

const TPL = { kind: 'TEMPLATE' as const };
/** "managed print service" -> "a managed print service"; plurals are left alone. */
const withArticle = (s: string) =>
  /^(?:a|an|the|some)\s/i.test(s) || /[^s]s$/i.test(s) ? s : `${/^[aeiou]/i.test(s) ? 'an' : 'a'} ${s}`;
const clip = (s: string, n = 300) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const ends = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);

function medianOf(xs: number[]): number | undefined {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round(((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2);
}
export const median = medianOf;

// ------------------------------------------------------------------------------------------------ fields
interface Resolved {
  b: Builder;
  facts: Facts;
  missing: string[];
  suggested: string[];
  warnings: string[];
  category: string | undefined;
  value: number | undefined;
  term: number | undefined;
  record: RecordInfo | undefined;
  subject: string;
}

function collectFields(input: GenInput, b: Builder, facts: Facts): Resolved {
  const { record, history } = input;
  const missing: string[] = [];
  const suggested: string[] = [];
  const warnings: string[] = [];
  const recSrc = (what: string) => `Record ${record?.number}: ${what}`;
  b.field('organisation', input.organisation, 'POLICY', 'Your organisation');

  // title
  const subject = facts.subject?.phrase;
  const titleFromText = subject ? sentenceCase(subject) : facts.category?.title;
  if (subject) b.field('title', sentenceCase(subject), 'TEXT_SPAN', 'The thing you asked for', facts.subject);
  else if (record && record.title && !/^untitled/i.test(record.title))
    b.field('title', record.title, 'RECORD', recSrc('title'));
  else if (titleFromText)
    b.field(
      'title',
      titleFromText,
      'TEMPLATE',
      'Named from the category, as the text did not say what is needed',
    );
  else missing.push('title');
  if (!b.doc.fields.title) b.doc.fields.title = 'Untitled';

  // category
  let category: string | undefined;
  if (facts.category) {
    category = `${facts.category.category} (UNSPSC ${facts.category.unspsc})`;
    b.field(
      'category',
      category,
      'TEXT_SPAN',
      `Matched the category "${facts.category.category}" from your words`,
      {
        quote: facts.category.quote,
        span: facts.category.span,
      },
    );
  } else if (record?.category) {
    category = record.category;
    b.field('category', category, 'RECORD', recSrc('category'));
  } else missing.push('category');

  // value
  let value: number | undefined;
  if (facts.money) {
    value = facts.money.value;
    b.field(
      'estimatedValue',
      value,
      'TEXT_SPAN',
      facts.money.basis
        ? `A ${facts.money.basis === 'ANNUAL' ? 'yearly' : 'monthly'} figure of AUD ${facts.money.raw.toLocaleString('en-AU')}${facts.term ? ` over ${facts.term.months} months` : ''}`
        : 'The amount you gave',
      facts.money,
    );
    if (facts.money.basis && !facts.term)
      warnings.push(
        'The amount looks like a yearly or monthly figure and no term was given, so it was not multiplied. Say how long it runs.',
      );
  } else if (record?.estimatedValue) {
    value = record.estimatedValue;
    b.field('estimatedValue', value, 'RECORD', recSrc('estimated value'));
  } else if (history?.medianValue) {
    value = history.medianValue;
    b.field(
      'estimatedValue',
      value,
      'HISTORY',
      `Median of ${history.count} earlier request${history.count === 1 ? '' : 's'} in this category: confirm it`,
    );
    suggested.push('estimatedValue');
  } else missing.push('estimatedValue');

  // dates and term
  const d = facts.dates;
  let term = facts.term?.months;
  if (facts.term) b.field('termMonths', term, 'TEXT_SPAN', 'The term you gave', facts.term);
  if (d.start) b.field('startDate', d.start.iso, 'TEXT_SPAN', 'The start date you gave', d.start);
  if (d.close) b.field('closeDate', d.close.iso, 'TEXT_SPAN', 'The closing date you gave', d.close);
  if (d.end) b.field('endDate', d.end.iso, 'TEXT_SPAN', 'The end date you gave', d.end);
  if (!term && d.start && d.end) {
    term = monthsBetween(d.start.iso, d.end.iso);
    b.field('termMonths', term, 'TEMPLATE', 'Worked out from the start and end dates');
  }
  if (!term && record?.termMonths) {
    term = record.termMonths;
    b.field('termMonths', term, 'RECORD', recSrc('term'));
  }
  if (!term && history?.medianTerm) {
    term = history.medianTerm;
    b.field(
      'termMonths',
      term,
      'HISTORY',
      `Median term of ${history.count} earlier request${history.count === 1 ? '' : 's'} in this category: confirm it`,
    );
    suggested.push('termMonths');
  }
  if (!term) missing.push('termMonths');
  if (term && d.start && !d.end)
    b.field(
      'endDate',
      endOfTerm(d.start.iso, term),
      'TEMPLATE',
      'Worked out from the start date and the term',
    );
  if (!d.start) missing.push('startDate');

  // people and place
  if (facts.businessUnit)
    b.field(
      'businessUnit',
      facts.businessUnit.value,
      'TEXT_SPAN',
      'The business unit you named',
      facts.businessUnit,
    );
  else if (record?.businessUnit)
    b.field('businessUnit', record.businessUnit, 'RECORD', recSrc('business unit'));
  else missing.push('businessUnit');
  if (facts.owner)
    b.field('contractOwner', facts.owner.value, 'TEXT_SPAN', 'The contract owner you named', facts.owner);
  else if (record?.fields.contractOwner)
    b.field('contractOwner', record.fields.contractOwner, 'RECORD', recSrc('contract owner'));
  else missing.push('contractOwner');
  if (facts.supplyLocation)
    b.field(
      'supplyLocation',
      facts.supplyLocation.value,
      'TEXT_SPAN',
      facts.supplyLocation.quote === facts.flags.find((x) => x.code === 'DATA_RESIDENCY')?.quote
        ? 'Hosting in Australia means local supply'
        : 'Where you said supply comes from',
      facts.supplyLocation,
    );
  else if (record?.fields.supplyLocation)
    b.field('supplyLocation', record.fields.supplyLocation, 'RECORD', recSrc('supply location'));
  if (facts.dataSensitivity)
    b.field(
      'dataSensitivity',
      facts.dataSensitivity.value,
      'TEXT_SPAN',
      'The text mentions sensitive or personal data',
      facts.dataSensitivity,
    );
  else if (record?.fields.dataSensitivity)
    b.field('dataSensitivity', record.fields.dataSensitivity, 'RECORD', recSrc('data sensitivity'));

  if (facts.quantity) {
    b.field('quantity', facts.quantity.n, 'TEXT_SPAN', 'The quantity you gave', facts.quantity);
    b.field('quantityUnit', facts.quantity.unit, 'TEXT_SPAN', 'The quantity you gave', facts.quantity);
  }
  if (facts.suppliers.length)
    b.field(
      'supplierHints',
      facts.suppliers.map((s) => s.name).join('; '),
      'HISTORY',
      'Suppliers in the directory that your words name',
      facts.suppliers[0],
    );
  if (facts.flags.length)
    b.field(
      'riskFlags',
      facts.flags.map((f) => f.code).join(', '),
      'TEXT_SPAN',
      'Words in the text that raise a requirement or a risk',
      facts.flags[0],
    );

  return {
    b,
    facts,
    missing,
    suggested,
    warnings,
    category,
    value,
    term,
    record,
    subject:
      subject ??
      facts.category?.title.toLowerCase() ??
      record?.title.toLowerCase() ??
      'the requested goods or services',
  };
}

// ------------------------------------------------------------------------------------------------ shared content
const REQ_BY_FLAG = new Map<FlagCode, LibRequirement>(
  REQUIREMENTS.filter((r) => r.flag).map((r) => [r.flag!, r]),
);

/** Requirements for this text: the category's own, then one for every flagged topic, then policy-driven ones. */
function addRequirements(r: Resolved, key = 'requirements') {
  const { b, facts } = r;
  const prof = profileFor(r.category);
  for (const t of prof.requirements)
    b.add(key, t, {
      ...TPL,
      label: `Standard wording for ${r.category?.replace(/\s*\(UNSPSC[^)]*\)/, '') ?? 'this kind of procurement'}`,
    });
  const seen = new Set<string>();
  for (const f of facts.flags) {
    const lib = REQ_BY_FLAG.get(f.code);
    if (!lib || seen.has(lib.code)) continue;
    seen.add(lib.code);
    b.add(key, lib.text, {
      kind: 'TEXT_SPAN',
      label: `Raised by “${f.quote}” in your text (${lib.label})`,
      span: f,
    });
  }
  const cat = facts.category;
  if (cat?.critical && !seen.has('SECURITY_CERT')) {
    const lib = REQUIREMENTS.find((x) => x.code === 'SECURITY_CERT')!;
    b.add(key, lib.text, {
      kind: 'POLICY',
      label: `${cat.category} is a critical category, so information security controls are required (IT endorsement gate)`,
    });
    seen.add('SECURITY_CERT');
  }
  if (r.facts.dataSensitivity && !seen.has('PRIVACY')) {
    const lib = REQUIREMENTS.find((x) => x.code === 'PRIVACY')!;
    b.add(key, lib.text, {
      kind: 'POLICY',
      label: 'Sensitive or personal data is involved, so privacy obligations apply',
      span: r.facts.dataSensitivity,
    });
  }
  return [...seen];
}

const RISK_BY_FLAG: Partial<Record<FlagCode, string>> = {
  DATA_RESIDENCY: 'data-sovereignty',
  PRIVACY: 'data-breach',
  SECURITY_CERT: 'data-breach',
  CLOUD: 'data-breach',
  INCUMBENT: 'transition',
  URGENT: 'urgency',
  SOLE_SOURCE: 'sole-source',
  AFTER_HOURS: 'service-failure',
  CONTINUITY: 'service-failure',
  SUSTAINABILITY: 'regulatory-change',
};
const RISK_BY_KEY = new Map<string, LibRisk>(RISKS.map((x) => [x.key, x]));

function derivedRisks(
  r: Resolved,
): Array<{ risk: LibRisk; src: { kind: SourceRef['kind']; label: string; span?: Span } }> {
  const out: Array<{ risk: LibRisk; src: { kind: SourceRef['kind']; label: string; span?: Span } }> = [];
  const used = new Set<string>();
  const push = (key: string, src: { kind: SourceRef['kind']; label: string; span?: Span }) => {
    const risk = RISK_BY_KEY.get(key);
    if (!risk || used.has(key)) return;
    used.add(key);
    out.push({ risk, src });
  };
  for (const f of r.facts.flags) {
    const key = RISK_BY_FLAG[f.code];
    if (key) push(key, { kind: 'TEXT_SPAN', label: `Raised by “${f.quote}” in your text`, span: f });
  }
  push('delivery-delay', { kind: 'TEMPLATE', label: 'Standard risk for every procurement' });
  if ((r.value ?? 0) > 0)
    push('cost-overrun', { kind: 'TEMPLATE', label: 'Standard risk when a budget is set' });
  if ((r.value ?? 0) >= 250_000)
    push('supplier-insolvency', {
      kind: 'POLICY',
      label: 'Value of AUD 250,000 or more: financial viability is checked before award',
    });
  if ((r.facts.quantity?.n ?? 0) >= 20)
    push('transition', {
      kind: 'TEXT_SPAN',
      label: `Many ${r.facts.quantity!.unit} make transition harder`,
      span: r.facts.quantity!,
    });
  return out;
}

function addRisks(r: Resolved, key = 'risks') {
  for (const { risk, src } of derivedRisks(r)) r.b.add(key, riskLine(risk), src);
}

function addBackground(r: Resolved, key = 'background') {
  const { b, facts } = r;
  b.add(
    key,
    `${sentenceCase(withArticle(r.subject))}${facts.quantity ? ` for ${facts.quantity.n.toLocaleString('en-AU')} ${facts.quantity.unit}` : ''} is needed.`,
    facts.subject
      ? { kind: 'TEXT_SPAN', label: 'Built from what you said you need', span: facts.subject }
      : { kind: 'TEMPLATE', label: 'Built from the facts found' },
  );
  b.tpl(key, 'Owner: {{UNIT}}. Estimated value: {{VALUE}}. Term: {{TERM}}. Start: {{START}}.', {
    kind: 'TEMPLATE',
    label: 'The fields above, so this follows them when they change',
  });
  if (facts.text.length > 20)
    b.add(key, `The need as first described: “${clip(facts.text)}”`, {
      kind: 'TEXT_SPAN',
      label: 'Your own words, kept for the record',
      span: { quote: clip(facts.text, 120), span: [0, Math.min(120, facts.text.length)] },
    });
  const rec = r.record?.fields.background;
  if (rec)
    b.add(key, rec, { kind: 'RECORD', label: `Record ${r.record?.number}: background already written` });
}

function addDeliverables(r: Resolved, key = 'deliverables') {
  const { b, facts } = r;
  const prof = profileFor(r.category);
  prof.deliverables.forEach((t, i) =>
    i === 0 && facts.quantity
      ? b.tpl(key, `${t.replace(/\.$/, '')} across {{QTY}}.`, {
          ...TPL,
          label: 'Standard deliverables for this kind of procurement, with your quantity',
        })
      : b.add(key, t, { ...TPL, label: 'Standard deliverables for this kind of procurement' }),
  );
  if (facts.flags.some((f) => f.code === 'TRAINING')) {
    const f = facts.flags.find((x) => x.code === 'TRAINING')!;
    b.add(key, 'Training and handover materials for the organisation’s staff.', {
      kind: 'TEXT_SPAN',
      label: `Raised by “${f.quote}”`,
      span: f,
    });
  }
}

function serviceLevelItems(r: Resolved, key = 'serviceLevels') {
  const { b, facts } = r;
  const found = facts.flags.filter((f) => f.code === 'SERVICE_LEVEL');
  if (found.length)
    for (const f of found) {
      const sentence =
        new RegExp(`[^.;]*${f.quote.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^.;]*`, 'i')
          .exec(facts.text)?.[0]
          ?.trim() ?? f.quote;
      b.add(key, ends(sentenceCase(sentence)), {
        kind: 'TEXT_SPAN',
        label: 'A service level you stated',
        span: f,
      });
    }
  else
    for (const t of profileFor(r.category).serviceLevels)
      b.add(key, t, { ...TPL, label: 'Typical service levels for this kind of procurement: confirm them' });
  const ah = facts.flags.find((f) => f.code === 'AFTER_HOURS');
  if (ah)
    b.add(key, 'Support is available at all hours, with a named escalation contact for critical faults.', {
      kind: 'TEXT_SPAN',
      label: `Raised by “${ah.quote}”`,
      span: ah,
    });
}

// ------------------------------------------------------------------------------------------------ criteria
export interface CritRow {
  title: string;
  weight: number;
  stream: 'TECHNICAL' | 'COMMERCIAL' | 'OTHER';
  text: string;
  mandatory?: boolean;
}
/** Whole-number weights that add to exactly `total`, in the proportions of `raw` (largest remainder). */
export function rescaleWeights(raw: number[], total: number): number[] {
  const sum = raw.reduce((a, c) => a + c, 0);
  if (sum <= 0) return raw.map(() => 0);
  const exact = raw.map((w) => (w * total) / sum);
  const out = exact.map(Math.floor);
  let left = total - out.reduce((a, c) => a + c, 0);
  const order = exact
    .map((x, i) => [x - Math.floor(x), i] as const)
    .sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (left <= 0) break;
    out[i] = (out[i] ?? 0) + 1;
    left -= 1;
  }
  return out;
}

const DESCRIPTIONS: Record<string, string> = {
  quality: 'How well the proposed solution meets the requirements, and how convincing the approach is.',
  technical: 'How well the proposed solution meets the requirements, and how convincing the approach is.',
  delivery: 'The plan, team and timetable for delivery and transition, and how risks are managed.',
  price: 'Whole-of-term cost and value for money, scored from the pricing schedule.',
  experience: 'Relevant experience and references from comparable work.',
  compliance: 'Whether the response meets every mandatory requirement. Pass or fail, not weighted.',
};
const describe = (name: string): string => {
  const n = name.toLowerCase();
  const k = Object.keys(DESCRIPTIONS).find((x) => n.includes(x));
  return k ? DESCRIPTIONS[k]! : `Respondents are scored on ${name.toLowerCase()}.`;
};

export function pickTenderType(r: Resolved): TenderType {
  const t = r.facts.text;
  if (/\bworks\b|construction|refurbish|fit-?out|building/i.test(t)) return 'RFT';
  if ((r.value ?? 0) > 0 && (r.value ?? 0) < 100_000) return 'RFQ';
  return 'RFP';
}

function criteriaRows(r: Resolved, type: TenderType): { rows: CritRow[]; notes: SourceRef[] } {
  const base = evaluationCriteria(type) ?? evaluationCriteria('RFP')!;
  let rows: CritRow[] = base.map((c) => ({
    title: c.name.replace(/ \(pass or fail\)$/, ''),
    weight: c.weight,
    stream: c.stream,
    text: describe(c.name),
    ...(c.passFail ? { mandatory: true } : {}),
  }));
  const add: Array<{
    name: string;
    description: string;
    stream: CritRow['stream'];
    code: string;
    quote?: Span;
  }> = [];
  const flag = (c: FlagCode) => r.facts.flags.find((f) => f.code === c);
  if (flag('SUSTAINABILITY'))
    add.push({
      ...CRITERIA.find((x) => x.key === 'sustainability')!,
      code: 'SUSTAINABILITY',
      quote: flag('SUSTAINABILITY')!,
    });
  if (flag('LOCAL_SME'))
    add.push({ ...CRITERIA.find((x) => x.key === 'local')!, code: 'LOCAL_SME', quote: flag('LOCAL_SME')! });
  if (flag('AFTER_HOURS'))
    add.push({
      ...CRITERIA.find((x) => x.key === 'support')!,
      code: 'AFTER_HOURS',
      quote: flag('AFTER_HOURS')!,
    });
  const added = add.slice(0, 2);
  if (added.length && type !== 'RFQ') {
    const each = 10;
    const scored = rows.filter((x) => !x.mandatory && x.weight > 0);
    const scaled = rescaleWeights(
      scored.map((x) => x.weight),
      100 - each * added.length,
    );
    scored.forEach((x, i) => (x.weight = scaled[i] ?? 0));
    for (const a of added) rows.push({ title: a.name, weight: each, stream: a.stream, text: a.description });
  }
  rows = rows.filter((x) => x.weight > 0 || x.mandatory);
  return { rows, notes: [] };
}

function addCriteria(r: Resolved, key: string, type: TenderType) {
  const { b, facts } = r;
  const { rows } = criteriaRows(r, type);
  for (const c of rows) {
    const flagged = [...facts.flags].find((f) => {
      const lib = REQ_BY_FLAG.get(f.code);
      return (
        lib?.criterion?.name === c.title ||
        CRITERIA.some((x) => x.name === c.title && x.aliases.test(f.quote))
      );
    });
    b.add(
      key,
      c.text,
      flagged
        ? { kind: 'TEXT_SPAN', label: `Added because the text says “${flagged.quote}”`, span: flagged }
        : { ...TPL, label: `Standard ${TENDER_TYPE_NAME[type]} scoring sheet used by the tender pack` },
      { title: c.title, weight: c.weight, stream: c.stream, ...(c.mandatory ? { mandatory: true } : {}) },
    );
  }
  // weights stated in the same text ("price 60% quality 40%") are applied by the adjust rules in the caller
  void b;
}

// ------------------------------------------------------------------------------------------------ the kinds
function buildRequest(r: Resolved) {
  const { b } = r;
  addBackground(r);
  addRequirements(r);
  addDeliverables(r);
  addRisks(r, 'risks');
  b.doc.sections = ['background', 'requirements', 'deliverables', 'risks'].map((k) => b.section(k));
}

function buildJobSpec(r: Resolved) {
  const { b, facts } = r;
  const prof = profileFor(r.category);
  addBackground(r);
  b.tpl(
    'objectives',
    `Secure ${withArticle(r.subject)} that meets the requirements below at best value for money over {{TERM}}.`,
    { ...TPL, label: 'Standard objective with your term' },
  );
  b.tpl('objectives', 'Keep total cost within the budget of {{VALUE}}.', {
    ...TPL,
    label: 'Standard objective with your budget',
  });
  b.add(
    'objectives',
    'Run a fair, transparent and auditable process, with conflicts of interest declared before evaluation begins.',
    { kind: 'POLICY', label: 'Probity requirement for every procurement' },
  );
  prof.scope.forEach((t, i) =>
    i === 0 && facts.quantity
      ? b.tpl('scope', `${t.replace(/\.$/, '')}, covering {{QTY}}.`, {
          ...TPL,
          label: 'Standard scope for this kind of procurement, with your quantity',
        })
      : b.add('scope', t, { ...TPL, label: 'Standard scope for this kind of procurement' }),
  );
  addRequirements(r);
  addDeliverables(r);
  serviceLevelItems(r);
  prof.personnel.forEach((t) =>
    b.add('personnel', t, { ...TPL, label: 'Standard skills and personnel for this kind of procurement' }),
  );
  const cl = facts.flags.find((f) => f.code === 'CLEARANCE');
  if (cl)
    b.add('personnel', REQUIREMENTS.find((x) => x.code === 'CLEARANCE')!.text, {
      kind: 'TEXT_SPAN',
      label: `Raised by “${cl.quote}”`,
      span: cl,
    });
  b.tpl(
    'timeline',
    'Start: {{START}}.',
    facts.dates.start
      ? { kind: 'TEXT_SPAN', label: 'The start date you gave', span: facts.dates.start }
      : { ...TPL, label: 'Not given: to be confirmed' },
  );
  b.tpl(
    'timeline',
    'Term: {{TERM}}.',
    facts.term
      ? { kind: 'TEXT_SPAN', label: 'The term you gave', span: facts.term }
      : { ...TPL, label: 'Not given: to be confirmed' },
  );
  b.tpl('timeline', 'End: {{END}}.', { ...TPL, label: 'Worked out from the start date and the term' });
  b.add(
    'timeline',
    'Tender released and closed, evaluation and award follow the approved plan; contract start depends on award approval.',
    { kind: 'POLICY', label: 'The approval steps every procurement goes through' },
  );
  // evaluation hints
  b.add('evaluationHints', 'Score price over the whole term, not unit price alone.', {
    ...TPL,
    label: 'Standard hint',
  });
  const flagged = REQUIREMENTS.filter(
    (x) => facts.flags.some((f) => f.code === x.flag) && x.code !== 'INTEGRATION',
  );
  for (const lib of flagged.slice(0, 4)) {
    const f = facts.flags.find((x) => x.code === lib.flag)!;
    b.add('evaluationHints', `Check ${lib.label} as a pass or fail requirement before scoring.`, {
      kind: 'TEXT_SPAN',
      label: `Because the text says “${f.quote}”`,
      span: f,
    });
  }
  b.add('evaluationHints', 'Score only what the response says; record the reason for each score.', {
    ...TPL,
    label: 'Standard hint',
  });
  // assumptions
  b.tpl('assumptions', 'The budget of {{VALUE}} covers the full term, including any transition costs.', {
    ...TPL,
    label: 'Standard assumption: confirm it',
  });
  if (facts.quantity)
    b.tpl('assumptions', 'Access to {{QTY}} is available from the start date.', {
      kind: 'TEXT_SPAN',
      label: 'Your quantity',
      span: facts.quantity,
    });
  if (facts.suppliers.length)
    b.add(
      'assumptions',
      `Suppliers named in the request (${facts.suppliers.map((s) => s.name).join(', ')}) are noted for information. They compete on the same basis as every other respondent.`,
      { kind: 'POLICY', label: 'Probity: no supplier is favoured by being named', span: facts.suppliers[0]! },
    );
  if (facts.flags.some((f) => f.code === 'INCUMBENT')) {
    const f = facts.flags.find((x) => x.code === 'INCUMBENT')!;
    b.add(
      'assumptions',
      'The current supplier will cooperate with transition for the period the contract requires.',
      { kind: 'TEXT_SPAN', label: `Raised by “${f.quote}”`, span: f },
    );
  }
  addRisks(r);
  b.doc.sections = [
    'background',
    'objectives',
    'scope',
    'requirements',
    'deliverables',
    'serviceLevels',
    'personnel',
    'timeline',
    'evaluationHints',
    'assumptions',
    'risks',
  ].map((k) => b.section(k));
}

function buildPlan(r: Resolved, input: GenInput) {
  const { b, facts } = r;
  const values: FieldMap = {
    title: b.doc.fields.title,
    category: r.category,
    estimatedValue: r.value !== undefined ? String(r.value) : undefined,
    termMonths: r.term !== undefined ? String(r.term) : undefined,
    businessUnit: b.doc.fields.businessUnit,
    contractOwner: b.doc.fields.contractOwner,
    dataSensitivity: b.doc.fields.dataSensitivity,
    supplyLocation: b.doc.fields.supplyLocation,
    background: r.record?.fields.background,
    deliverables: r.record?.fields.deliverables,
    risk: r.record?.fields.risk,
  };
  const score = scoreComplexity({
    estimatedValue: r.value ?? 0,
    category: r.category,
    supplyLocation: values.supplyLocation,
    dataSensitivity: values.dataSensitivity,
  });
  const gates = gatesFor(score.level, r.category, r.value ?? 0, 'NOT_RUN');
  const planText = draftPlan({
    values,
    complexity: score.level,
    gateKeys: gates.map((g) => g.key),
    today: input.today,
  });
  const valueLit = r.value !== undefined ? aud(r.value) : null;
  const termLit = r.term !== undefined ? `${r.term} months` : null;
  for (const def of PLAN_FIELDS) {
    if (def.key === 'esg' || def.key === 'subWorkflow') continue; // set on their own pages
    const text = planText[def.key]?.replace(/\s*\(unspsc \d+\)/gi, '');
    if (!text) continue;
    b.section(
      def.key,
      def.label,
      ['requirements', 'risks', 'deliverables', 'consultations', 'dueDiligence'].includes(def.key)
        ? 'LIST'
        : 'TEXT',
    );
    for (const para of splitParagraphs(text)) {
      let tpl = para;
      if (valueLit) tpl = tpl.split(valueLit).join('{{VALUE}}');
      if (termLit) tpl = tpl.split(termLit).join('{{TERM}}');
      if (def.key === 'approvalDelegate')
        tpl = tpl.replace(/^[^.]*\(sourcing authority[^)]*\)/, '{{APPROVER}}');
      const hasTpl = tpl !== para;
      const src: { kind: SourceRef['kind']; label: string } =
        def.key === 'approvalDelegate'
          ? {
              kind: 'POLICY',
              label: 'Delegation of authority: Executive above AUD 250,000, Delegate up to it',
            }
          : def.key === 'consultations'
            ? {
                kind: 'POLICY',
                label: `Gates triggered by this procurement: ${gates.map((g) => g.label).join('; ') || 'none'}`,
              }
            : def.key === 'evaluationCommittee' ||
                def.key === 'dueDiligence' ||
                def.key === 'steeringCommittee'
              ? { kind: 'POLICY', label: 'Probity and governance rules for every procurement' }
              : {
                  ...TPL,
                  label: `Standard plan wording from the ${score.level.toLowerCase()} complexity profile`,
                };
      const it = b.add(def.key, hasTpl ? render(tpl, b.doc) : para, src, hasTpl ? { tpl } : {});
      void it;
    }
  }
  // what the text added on top of the standard plan
  for (const lib of REQUIREMENTS) {
    const f = facts.flags.find((x) => x.code === lib.flag);
    if (
      f &&
      [
        'DATA_RESIDENCY',
        'SECURITY_CERT',
        'CLEARANCE',
        'AFTER_HOURS',
        'SUSTAINABILITY',
        'LOCAL_SME',
        'ACCESSIBILITY',
        'CONTINUITY',
        'MODERN_SLAVERY',
        'WHS',
        'INSURANCE',
        'TRAINING',
        'INTEGRATION',
        'PRIVACY',
      ].includes(lib.code)
    )
      b.add('requirements', lib.text, {
        kind: 'TEXT_SPAN',
        label: `Raised by “${f.quote}” in your text (${lib.label})`,
        span: f,
      });
  }
  const have = new Set(b.section('risks').items.map((i) => i.text.split('. Level')[0]!.toLowerCase()));
  for (const { risk, src } of derivedRisks(r)) {
    if (src.kind !== 'TEXT_SPAN') continue;
    if (!have.has(risk.title.toLowerCase())) b.add('risks', riskLine(risk), src);
  }
  if (facts.dates.start || facts.dates.end)
    b.tpl('timeline', 'Requested contract start: {{START}}; requested end: {{END}}.', {
      kind: 'TEXT_SPAN',
      label: 'The dates you gave',
      span: (facts.dates.start ?? facts.dates.end)!,
    });
  b.doc.sections = PLAN_FIELDS.filter(
    (d) => d.key !== 'esg' && d.key !== 'subWorkflow' && b.doc.sections.some((s) => s.key === d.key),
  ).map((d) => {
    const s = b.section(d.key);
    s.type = ['requirements', 'risks', 'deliverables', 'consultations', 'dueDiligence'].includes(d.key)
      ? 'LIST'
      : 'TEXT';
    return s;
  });
  void score;
}

function buildTender(r: Resolved, input: GenInput) {
  const { b, facts } = r;
  const type = pickTenderType(r);
  b.doc.fields.tenderType = type;
  b.src(
    'fields.tenderType',
    'POLICY',
    `${TENDER_TYPE_NAME[type]}: chosen from the value and the kind of work (works use RFT; under AUD 100,000 uses RFQ)`,
  );
  b.tpl('overview', `{{CUSTOMER}} invites responses to this ${TENDER_TYPE_NAME[type]}: {{TITLE}}.`, {
    ...TPL,
    label: 'Standard opening',
  });
  if (r.category)
    b.tpl('overview', 'Category: {{CATEGORY}}.', {
      kind: 'TEXT_SPAN',
      label: 'Your category',
      span: facts.category ? { quote: facts.category.quote, span: facts.category.span } : undefined,
    });
  b.tpl('overview', 'The successful respondent would provide the services over {{TERM}}.', {
    ...TPL,
    label: 'Standard wording with your term',
  });
  const prof = profileFor(r.category);
  prof.scope.forEach((t, i) =>
    i === 0 && facts.quantity
      ? b.tpl('scope', `${t.replace(/\.$/, '')}, covering {{QTY}}.`, {
          ...TPL,
          label: 'Standard scope, with your quantity',
        })
      : b.add('scope', t, { ...TPL, label: 'Standard scope for this kind of procurement' }),
  );
  addRequirements(r);
  addDeliverables(r);
  const closing = facts.dates.close?.iso ?? addMonthsIso(input.today.toISOString().slice(0, 10), 0);
  if (!facts.dates.close) {
    const days = (r.value ?? 0) >= 250_000 ? 30 : 14;
    const dt = new Date(input.today.getTime() + days * 86_400_000).toISOString().slice(0, 10);
    b.doc.fields.closeDate = dt;
    b.src(
      'fields.closeDate',
      'POLICY',
      `Proposed ${days} days from today (the statutory minimum is checked again at publication)`,
    );
  } else void closing;
  b.tpl('timetable', 'Closing date: {{CLOSE}}. Responses are locked automatically at that time.', {
    ...TPL,
    label: 'Closing date field',
  });
  b.tpl('timetable', 'Planned contract start: {{START}}.', { ...TPL, label: 'Start date field' });
  addCriteria(r, 'evaluationCriteria', type);
  const pack = buildTenderPack({
    type,
    title: b.doc.fields.title ?? 'Tender',
    organisation: input.organisation,
    plan: {},
    request: {},
    contactEmail: 'the contact named in the portal',
  });
  for (const p of splitParagraphs(pack.conditions))
    b.add('conditions', p, { ...TPL, label: 'The standard conditions the tender pack uses' });
  b.add('submission', pack.submission!.split('\n\n').join(' '), {
    ...TPL,
    label: 'The standard submission instructions the tender pack uses',
  });
  b.add(
    'contact',
    'Ask questions in the portal. Questions are published to all respondents, without naming the questioner.',
    { ...TPL, label: 'The standard contact wording the tender pack uses' },
  );
  b.doc.sections = [
    'overview',
    'scope',
    'requirements',
    'deliverables',
    'timetable',
    'evaluationCriteria',
    'conditions',
    'submission',
    'contact',
  ].map((k) => b.section(k));
  r.warnings.push(
    'A tender document never states the budget: it is internal. The budget stays on the request and plan.',
  );
}

function buildEval(r: Resolved) {
  const { b, facts } = r;
  const type = pickTenderType(r);
  b.doc.fields.tenderType = type;
  b.src('fields.tenderType', 'POLICY', `${TENDER_TYPE_NAME[type]} scoring sheet`);
  addCriteria(r, 'criteria', type);
  const seen = new Set<string>();
  for (const f of facts.flags) {
    const lib = REQ_BY_FLAG.get(f.code);
    if (
      !lib ||
      seen.has(lib.code) ||
      ['SUSTAINABILITY', 'LOCAL_SME', 'AFTER_HOURS', 'TRAINING', 'INTEGRATION', 'CLOUD'].includes(lib.code)
    )
      continue;
    seen.add(lib.code);
    b.add('mandatoryGates', `Pass or fail: ${lib.label}. ${lib.text}`, {
      kind: 'TEXT_SPAN',
      label: `Because the text says “${f.quote}”`,
      span: f,
    });
  }
  b.add('mandatoryGates', 'Pass or fail: a conflict of interest declaration is made by the respondent.', {
    kind: 'POLICY',
    label: 'Required for every tender',
  });
  b.add('mandatoryGates', 'Pass or fail: current insurance certificates are provided.', {
    kind: 'POLICY',
    label: 'Required for every tender',
  });
  b.add(
    'scoringMethod',
    'Each evaluator scores every criterion independently from 0 to 10, without seeing the other evaluators’ scores. The panel then agrees a consensus score for each criterion and records the reason.',
    { kind: 'POLICY', label: 'Independent scoring and consensus, as the evaluation module runs it' },
  );
  b.add(
    'scoringMethod',
    'A criterion’s weighted result is its score divided by 10, multiplied by its weight. The weights add up to 100.',
    { ...TPL, label: 'Standard scoring arithmetic' },
  );
  b.add('notes', 'The technical evaluators do not see pricing.', {
    kind: 'POLICY',
    label: 'Separation of technical and commercial streams',
  });
  b.add(
    'notes',
    'Large differences between evaluators are flagged for discussion before consensus is recorded.',
    { ...TPL, label: 'Standard evaluator guidance' },
  );
  b.doc.sections = ['criteria', 'mandatoryGates', 'scoringMethod', 'notes'].map((k) => b.section(k));
}

function buildContract(r: Resolved, input: GenInput) {
  const { b, facts } = r;
  const works = /\bworks\b|construction|refurbish|fit-?out|building works/i.test(facts.text);
  const tplRow = (input.templates ?? []).find((t) => {
    const body = t.body as Partial<TemplateBody>;
    return body.appliesTo?.includes(works ? 'RFT' : 'RFP');
  });
  const body = (tplRow?.body as TemplateBody | undefined) ?? (works ? WORKS_TEMPLATE : SERVICES_TEMPLATE);
  const levels = profileFor(r.category).serviceLevels.slice(0, 2).join(' ');
  const stated = facts.flags.some((f) => f.code === 'SERVICE_LEVEL');
  b.doc.fields.serviceLevels = stated
    ? (facts.text.match(/[^.;]*(?:uptime|availability|response time|service level)[^.;]*/i)?.[0]?.trim() ??
      levels)
    : levels;
  b.src(
    'fields.serviceLevels',
    stated ? 'TEXT_SPAN' : 'TEMPLATE',
    stated
      ? 'The service levels you stated'
      : 'Typical service levels for this kind of procurement: confirm them',
    stated ? facts.flags.find((f) => f.code === 'SERVICE_LEVEL')! : undefined,
  );
  b.doc.fields.noticeDays = '90';
  b.src('fields.noticeDays', 'TEMPLATE', 'Standard notice period: change it if the contract needs another');
  b.tpl('schedule', 'Contract value: {{VALUE}} (excluding GST).', { ...TPL, label: 'Budget field' });
  b.tpl('schedule', 'Term: {{TERM}}, from {{START}} to {{END}}.', { ...TPL, label: 'Term and date fields' });
  b.tpl('schedule', 'Notice period: {{NOTICE_DAYS}} days.', { ...TPL, label: 'Notice period field' });
  b.tpl('schedule', 'Contract owner: {{OWNER}}.', { ...TPL, label: 'Contract owner field' });
  if (facts.quantity)
    b.tpl('schedule', 'Coverage: {{QTY}}.', {
      kind: 'TEXT_SPAN',
      label: 'Your quantity',
      span: facts.quantity,
    });
  for (const c of body.clauses) {
    const filled = c.text;
    b.add(
      'clauses',
      render(filled, b.doc),
      {
        kind: 'TEMPLATE',
        label: `Clause library${tplRow ? '' : ' (standard template)'}: ${c.mandatory ? 'mandatory clause' : 'optional clause'}`,
      },
      { title: c.title, mandatory: c.mandatory, tpl: filled },
    );
  }
  const added = new Set<string>();
  for (const f of facts.flags) {
    const lib = REQUIREMENTS.find((x) => x.flag === f.code && x.clause);
    if (
      !lib ||
      added.has(lib.code) ||
      (['INSURANCE', 'WHS'].includes(lib.code) &&
        body.clauses.some((c) =>
          c.title.toLowerCase().startsWith(lib.clause!.title.toLowerCase().slice(0, 8)),
        ))
    )
      continue;
    added.add(lib.code);
    b.add(
      'clauses',
      lib.clause!.text,
      { kind: 'TEXT_SPAN', label: `Added because the text says “${f.quote}” (${lib.label})`, span: f },
      { title: lib.clause!.title, mandatory: false },
    );
  }
  b.doc.sections = ['schedule', 'clauses'].map((k) => b.section(k));
  r.warnings.push(
    'The supplier’s name and ABN are filled in at award; the placeholders stay visible until then.',
  );
  if (!tplRow)
    r.warnings.push(
      'No active clause template was found for this tender route, so the standard library was used.',
    );
}

// ------------------------------------------------------------------------------------------------ entry
export function generateDraft(input: GenInput): Generated {
  const facts = extractFacts(input.text, input.today, input.knownSuppliers ?? []);
  const b = new Builder(input.kind);
  const r = collectFields(input, b, facts);
  if (input.catalogue?.length)
    for (const c of input.catalogue.slice(0, 3))
      b.src(
        'doc.catalogue',
        'CATALOGUE',
        `${c.name} (${c.sku}) from ${c.supplier}: AUD ${c.unitPrice.toLocaleString('en-AU')} per ${c.unit}`,
      );
  switch (input.kind) {
    case 'REQUEST':
      buildRequest(r);
      break;
    case 'PLAN':
      buildPlan(r, input);
      break;
    case 'JOB_SPEC':
      buildJobSpec(r);
      break;
    case 'TENDER_DOC':
      buildTender(r, input);
      break;
    case 'CONTRACT_DRAFT':
      buildContract(r, input);
      break;
    case 'EVAL_CRITERIA':
      buildEval(r);
      break;
  }
  b.doc.title = `${KIND_TITLE[input.kind]}: ${b.doc.fields.title ?? 'untitled'}`;
  refreshDerived(b.doc);
  const kindNeeds: Record<DraftKind, string[]> = {
    REQUEST: ['title', 'category', 'estimatedValue', 'termMonths', 'businessUnit', 'contractOwner'],
    PLAN: ['category', 'estimatedValue', 'termMonths'],
    JOB_SPEC: ['category', 'estimatedValue', 'termMonths', 'startDate'],
    TENDER_DOC: ['category', 'termMonths'],
    CONTRACT_DRAFT: ['estimatedValue', 'termMonths', 'startDate'],
    EVAL_CRITERIA: [],
  };
  const missing = r.missing.filter((m) => kindNeeds[input.kind].includes(m));
  b.doc.warnings = [...r.warnings];
  b.doc.suggested = [...r.suggested];
  return { doc: b.doc, sources: b.sources, missing, suggested: r.suggested, warnings: r.warnings, facts };
}

export { CLAUSES, RISK_BY_KEY };
