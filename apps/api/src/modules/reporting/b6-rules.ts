/**
 * Reporting and collaboration rules (B6), as pure functions: layout catalogues, the procurement schedule and what a move
 * does to it, velocity, plain-language questions and instructions, a candidate risk library, word-level comparison of
 * versions, name matching and the reference content generator. The "AI" parts are deterministic and labelled
 * `rules-simulated-v1` (docs/swap-points.md).
 */
import { REPORT_SECTIONS } from '../evaluation/report.js';
import { PLAN_FIELDS } from '../plan/fields.js';
import { TENDER_FIELDS, TENDER_TYPES, type TenderType } from '../tender/fields.js';
import { addDays, daysBetween } from '../contract/dates.js';

export const B6_MODEL = 'rules-simulated-v1';

// ---------------------------------------------------------------- layout templates (FR-0085, FR-0115, FR-0365)
export type LayoutKind = 'PLAN' | 'RFX' | 'REPORT' | 'INTAKE' | 'CONTRACT';
export interface LayoutSection {
  key: string;
  label: string;
  mandatory: boolean;
}
export interface LayoutEntry {
  key: string;
  enabled: boolean;
}

const RFX_MANDATORY = new Set([
  'overview',
  'requirements',
  'evaluationCriteria',
  'conditions',
  'submission',
  'contact',
]);
const REPORT_MANDATORY = new Set(['summary', 'ranking', 'recommendation']);

/**
 * The panels of a page rather than the sections of a document (NFR-U04): the request page and the contract page. With the plan,
 * the tender pack and the evaluation report, they make a layout for every phase of the lifecycle. A page lists its panels in
 * the order shown; the page itself knows which column each one belongs in.
 */
const INTAKE_PANELS: LayoutSection[] = [
  { key: 'progress', label: 'Journey to completion', mandatory: false },
  { key: 'actions', label: 'Actions on this request', mandatory: true },
  { key: 'advance', label: 'Move this procurement on', mandatory: false },
  { key: 'risk', label: 'Risk assessment', mandatory: false },
  { key: 'lessons', label: 'Lessons learned and closing', mandatory: false },
  { key: 'extras', label: 'Suppliers, delegates, documents and process changes', mandatory: false },
];
const CONTRACT_PANELS: LayoutSection[] = [
  { key: 'clauses', label: 'Clauses', mandatory: true },
  { key: 'management', label: 'Contract management', mandatory: false },
  { key: 'variation', label: 'Variation details', mandatory: false },
  { key: 'deviations', label: 'Changes from the template', mandatory: false },
  { key: 'checks', label: 'Checks before signature', mandatory: false },
  { key: 'endorsements', label: 'Endorsements', mandatory: false },
  { key: 'collab', label: 'Working together on the document', mandatory: false },
  { key: 'strategy', label: 'Negotiation strategy', mandatory: false },
  { key: 'legal', label: 'Legal edits and redlines', mandatory: false },
  { key: 'terms', label: 'Terms (side)', mandatory: true },
  { key: 'signature', label: 'Signatures (side)', mandatory: true },
  { key: 'signing', label: 'Signing invitations (side)', mandatory: false },
  { key: 'risksummary', label: 'Risk summary (side)', mandatory: false },
  { key: 'questions', label: 'Questions to ask (side)', mandatory: false },
];

/** The sections each document is made of: the system default order and which cannot be left out. */
export function catalog(kind: LayoutKind): LayoutSection[] {
  if (kind === 'INTAKE') return INTAKE_PANELS;
  if (kind === 'CONTRACT') return CONTRACT_PANELS;
  if (kind === 'PLAN')
    return PLAN_FIELDS.map((f) => ({ key: f.key, label: f.label, mandatory: f.mandatory }));
  if (kind === 'RFX')
    return TENDER_FIELDS.map((f) => ({ key: f.key, label: f.label, mandatory: RFX_MANDATORY.has(f.key) }));
  return REPORT_SECTIONS.map((s) => ({ key: s.key, label: s.label, mandatory: REPORT_MANDATORY.has(s.key) }));
}

export const defaultLayout = (kind: LayoutKind): LayoutEntry[] =>
  catalog(kind).map((s) => ({ key: s.key, enabled: true }));

/** Checks a designed layout: known sections only, each once, mandatory ones present and switched on. */
export function validateLayout(kind: LayoutKind, entries: LayoutEntry[]): string[] {
  const cat = catalog(kind);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (!cat.some((c) => c.key === e.key)) out.push(`"${e.key}" is not a section of this document`);
    if (seen.has(e.key)) out.push(`"${e.key}" appears more than once`);
    seen.add(e.key);
  }
  for (const c of cat) {
    const e = entries.find((x) => x.key === c.key);
    if (c.mandatory && (!e || !e.enabled)) out.push(`"${c.label}" is required and cannot be left out`);
  }
  return out;
}

/** Orders and filters a document's sections by the layout; a section the layout does not list is left out. */
export function applyLayout<T extends { key: string }>(items: T[], layout: LayoutEntry[] | null): T[] {
  if (!layout) return items;
  const pos = new Map(layout.map((e, i) => [e.key, i]));
  const off = new Set(layout.filter((e) => !e.enabled).map((e) => e.key));
  return items
    .filter((i) => pos.has(i.key) && !off.has(i.key))
    .sort((a, b) => pos.get(a.key)! - pos.get(b.key)!);
}

// ---------------------------------------------------------------- procurement schedule (FR-0595)
export const SCHEDULE_PHASES = ['INTAKE', 'PLAN', 'TENDER', 'EVALUATION', 'CONTRACT_AWARD'] as const;
export type SchedulePhase = (typeof SCHEDULE_PHASES)[number];
export interface Slot {
  phase: SchedulePhase;
  startDate: string;
  endDate: string;
}
const DURATION: Record<SchedulePhase, number> = {
  INTAKE: 7,
  PLAN: 14,
  TENDER: 21,
  EVALUATION: 21,
  CONTRACT_AWARD: 14,
};

/** The standard schedule from the day the request was raised: each phase follows the one before. */
export function defaultSchedule(startDate: string): Slot[] {
  let from = startDate;
  return SCHEDULE_PHASES.map((phase) => {
    const slot = { phase, startDate: from, endDate: addDays(from, DURATION[phase]) };
    from = slot.endDate;
    return slot;
  });
}

/** Moving a phase by some days moves every phase after it by the same, so the downstream timeline stays whole. */
export function shiftSchedule(
  slots: Slot[],
  phase: SchedulePhase,
  deltaDays: number,
): { ok: true; slots: Slot[] } | { ok: false; message: string } {
  const i = slots.findIndex((s) => s.phase === phase);
  if (i < 0) return { ok: false, message: 'That phase is not on the schedule' };
  const moved = slots.map((s, k) =>
    k < i ? s : { ...s, startDate: addDays(s.startDate, deltaDays), endDate: addDays(s.endDate, deltaDays) },
  );
  const prev = moved[i - 1];
  if (prev && moved[i]!.startDate < prev.endDate)
    return {
      ok: false,
      message: `${phase.toLowerCase().replace('_', ' ')} cannot start before the phase before it ends (${prev.endDate})`,
    };
  return { ok: true, slots: moved };
}

const DELEGATE_STEP: Partial<Record<SchedulePhase, string>> = {
  PLAN: 'Approve the procurement plan',
  TENDER: 'Give permission to publish',
  EVALUATION: 'Approve the evaluation report',
  CONTRACT_AWARD: 'Sign the contract',
};
/** The dates on which a delegate is asked to act, worked out from the schedule so a move recalculates them. */
export function delegateCalendar(slots: Slot[]): Array<{ date: string; phase: SchedulePhase; what: string }> {
  return slots
    .filter((s) => DELEGATE_STEP[s.phase])
    .map((s) => ({
      date: s.phase === 'TENDER' ? s.startDate : s.endDate,
      phase: s.phase,
      what: DELEGATE_STEP[s.phase]!,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------- velocity and savings (FR-0605)
export interface PhaseTiming {
  phase: string;
  days: number;
  open: boolean;
}
export function velocity(rows: PhaseTiming[]) {
  const by = new Map<string, { done: number[]; waiting: number[] }>();
  for (const r of rows) {
    const x = by.get(r.phase) ?? { done: [], waiting: [] };
    (r.open ? x.waiting : x.done).push(r.days);
    by.set(r.phase, x);
  }
  const avg = (a: number[]) =>
    a.length ? Math.round((a.reduce((s, v) => s + v, 0) / a.length) * 10) / 10 : null;
  const phases = [...by.entries()].map(([phase, v]) => ({
    phase,
    completed: v.done.length,
    avgDays: avg(v.done),
    waiting: v.waiting.length,
    longestWaitDays: v.waiting.length ? Math.max(...v.waiting) : 0,
  }));
  // the bottleneck is where work takes longest, counting the wait of what is still in the phase
  const score = (p: (typeof phases)[number]) => Math.max(p.avgDays ?? 0, p.longestWaitDays);
  const worst = [...phases].sort((a, b) => score(b) - score(a))[0];
  return { phases, bottleneck: worst && score(worst) > 0 ? worst.phase : null };
}

// ---------------------------------------------------------------- plain-language questions (FR-0625)
export interface Question {
  entity: 'procurements' | 'contracts' | 'risks' | 'suppliers' | 'invoices';
  year: number | null;
  phase: string | null;
  status: string | null;
  text: string | null;
  minValue: number | null;
  expiringDays: number | null;
  level: 'HIGH' | 'MEDIUM' | 'LOW' | null;
  understood: string[];
}
const PHASE_WORDS: Array<[RegExp, string]> = [
  [/\bintake\b/, 'INTAKE'],
  [/\bplan(ning)?\b/, 'PLAN'],
  [/\btender(s|ing)?\b/, 'TENDER'],
  [/\bevaluat/, 'EVALUATION'],
  [/\bcontract award\b/, 'CONTRACT_AWARD'],
  [/\bcontract management\b/, 'CONTRACT_MGMT'],
  [/\bclosed\b/, 'CLOSED'],
];

/** Reads a question such as "all procurement risks in 2026" or "contracts expiring in 90 days". */
export function parseQuestion(q: string): Question | { error: string } {
  const s = q.toLowerCase();
  const understood: string[] = [];
  let entity: Question['entity'] | null = null;
  if (/\brisks?\b/.test(s)) entity = 'risks';
  else if (/\binvoices?\b/.test(s)) entity = 'invoices';
  else if (/\bsuppliers?\b|\bvendors?\b/.test(s)) entity = 'suppliers';
  else if (/\bcontracts?\b/.test(s)) entity = 'contracts';
  else if (/\bprocurements?\b|\brequests?\b|\bprojects?\b|\btenders?\b/.test(s)) entity = 'procurements';
  if (!entity)
    return {
      error:
        'I could not tell what to report on. Try "all procurement risks in 2026", "contracts expiring in 90 days" or "blocked invoices".',
    };
  understood.push(`Showing ${entity}`);
  const y = /\b((?:19|20)\d{2})\b/.exec(s);
  const year = y ? Number(y[1]) : null;
  if (year) understood.push(`in ${year}`);
  let phase: string | null = null;
  if (entity === 'procurements') {
    // "tenders in evaluation": the phase is the word after in/at/during, not the noun being counted
    const after = /\b(?:in|at|during)\s+(?:the\s+)?(.+)$/.exec(s)?.[1] ?? s;
    const hit = PHASE_WORDS.find(([re]) => re.test(after)) ?? PHASE_WORDS.find(([re]) => re.test(s));
    phase = hit ? hit[1] : null;
    if (phase) understood.push(`in the ${phase.toLowerCase().replace('_', ' ')} phase`);
  }
  let status: string | null = null;
  if (/\bblocked\b/.test(s)) status = 'BLOCKED';
  else if (/\boverdue\b/.test(s)) status = 'OVERDUE';
  else if (/\bexecuted\b|\bsigned\b/.test(s)) status = 'EXECUTED';
  else if (/\bdraft\b/.test(s)) status = 'DRAFT';
  else if (/\bpaid\b/.test(s)) status = 'PAID';
  if (status) understood.push(`status ${status.toLowerCase()}`);
  const v = /(?:over|above|more than|exceeding)\s+\$?\s?([\d,.]+)\s?(k|m|million|thousand)?/.exec(s);
  let minValue: number | null = null;
  if (v) {
    minValue = Number(v[1]!.replace(/,/g, ''));
    if (v[2] === 'k' || v[2] === 'thousand') minValue *= 1000;
    if (v[2] === 'm' || v[2] === 'million') minValue *= 1_000_000;
    understood.push(`value over ${minValue}`);
  }
  const e = /expir\w*\s+(?:in|within)\s+(?:the next\s+)?(\d+)\s*(day|week|month)s?/.exec(s);
  let expiringDays: number | null = null;
  if (e) {
    expiringDays = Number(e[1]) * (e[2] === 'week' ? 7 : e[2] === 'month' ? 30 : 1);
    understood.push(`expiring within ${expiringDays} days`);
  }
  const lv = /\b(high|medium|low)\b/.exec(s);
  const level = entity === 'risks' && lv ? (lv[1]!.toUpperCase() as Question['level']) : null;
  if (level) understood.push(`rated ${level!.toLowerCase()}`);
  const t = /(?:about|for|with|containing|mentioning)\s+"?([a-z0-9 ]{3,40})"?\s*$/.exec(s);
  const text = t ? t[1]!.trim() : null;
  if (text) understood.push(`mentioning "${text}"`);
  return { entity, year, phase, status, text, minValue, expiringDays, level, understood };
}

// ---------------------------------------------------------------- phase and committee instructions (FR-0770, FR-0775)
export const PHASE_ORDER = [
  'INTAKE',
  'PLAN',
  'TENDER',
  'EVALUATION',
  'CONTRACT_AWARD',
  'CONTRACT_MGMT',
  'CLOSED',
] as const;

/** "move to tender", "go to the next phase", "we are ready for evaluation". */
export function parseAdvance(text: string, current: string): { target: string } | { error: string } {
  const s = text.toLowerCase();
  if (/\bnext\b|\badvance\b|\bmove on\b|\bproceed\b/.test(s) && !PHASE_WORDS.some(([re]) => re.test(s))) {
    const i = PHASE_ORDER.indexOf(current as (typeof PHASE_ORDER)[number]);
    const next = PHASE_ORDER[i + 1];
    return next ? { target: next } : { error: 'This procurement is already at its last phase' };
  }
  const hit = PHASE_WORDS.find(([re]) => re.test(s));
  return hit
    ? { target: hit[1] }
    : { error: 'Say which phase to move to, for example "move to tender" or "go to the next phase".' };
}

export function parseCommittee(text: string): { action: 'ADD' | 'REMOVE'; name: string } | { error: string } {
  const m =
    /\b(add|include|invite|remove|drop|take off)\s+(?:the\s+)?([a-z][a-z' .-]{1,40}?)(?:\s+(?:to|from|on|onto|off)\b.*)?$/i.exec(
      text.trim(),
    );
  if (!m) return { error: 'Say who to add or remove, for example "add Tomas" or "remove Mei Tanaka".' };
  return { action: /^(add|include|invite)$/i.test(m[1]!) ? 'ADD' : 'REMOVE', name: m[2]!.trim() };
}

export function matchPeople<T extends { name: string }>(query: string, people: T[]): T[] {
  const q = query.toLowerCase().trim();
  const exact = people.filter((p) => p.name.toLowerCase() === q);
  if (exact.length) return exact;
  const parts = q.split(/\s+/);
  return people.filter((p) => parts.every((x) => p.name.toLowerCase().includes(x)));
}

/** "use the quote template", "this should be a works tender": the document type the person wants. */
export function parseTemplateChange(text: string): { type: TenderType } | { error: string } {
  const s = text.toLowerCase();
  const explicit = TENDER_TYPES.find((t) => new RegExp(`\\b${t.toLowerCase()}\\b`).test(s));
  if (explicit) return { type: explicit };
  if (/expression of interest/.test(s)) return { type: 'EOI' };
  if (/request for information|information request|\binformation\b/.test(s)) return { type: 'RFI' };
  if (/quot(e|ation)/.test(s)) return { type: 'RFQ' };
  if (/proposal/.test(s)) return { type: 'RFP' };
  if (/\btender\b|\bworks\b|\bconstruction\b/.test(s)) return { type: 'RFT' };
  return {
    error:
      'Name the template, for example "use the request for quotation template" or "this should be a proposal".',
  };
}

// ---------------------------------------------------------------- risk assessment (FR-0755)
export interface RiskFacts {
  category: string;
  value: number;
  termMonths: number;
  complexity: string | null;
  workflow: string | null;
  text: string;
}
export interface CandidateRisk {
  key: string;
  title: string;
  description: string;
  options: string[];
}
const R = (key: string, title: string, description: string, options: string[]): CandidateRisk => ({
  key,
  title,
  description,
  options,
});

/** Candidate risks for the kind of procurement; the person decides which apply, rates the rest and picks treatments. */
export function candidateRisks(f: RiskFacts): CandidateRisk[] {
  const t = `${f.category} ${f.text}`.toLowerCase();
  const out: CandidateRisk[] = [
    R(
      'delivery',
      'Late or incomplete delivery',
      'The supplier does not deliver on time or to specification.',
      ['Milestone payments tied to acceptance', 'Liquidated damages clause', 'Regular progress reviews'],
    ),
    R('price', 'Cost growth above the budget', 'The final cost exceeds the approved estimate.', [
      'Fixed price or capped fees',
      'Variation approval through the delegate',
      'Contingency held by the sponsor',
    ]),
    R('supplier', 'Supplier failure', 'The supplier becomes insolvent or withdraws.', [
      'Financial health check before award',
      'Step-in and exit provisions',
      'Second supplier on standby',
    ]),
    R(
      'probity',
      'Probity and conflicts of interest',
      'A conflict or an unfair advantage taints the process.',
      [
        'Declarations before evaluation starts',
        'Independent probity adviser',
        'Sealed responses until close',
      ],
    ),
  ];
  if (f.value >= 1_000_000)
    out.push(
      R(
        'exposure',
        'High financial exposure',
        'The value is large enough that a failure is material to the organisation.',
        ['Executive co-signature', 'Parent company guarantee', 'Staged commitment with review gates'],
      ),
    );
  if (f.termMonths >= 36)
    out.push(
      R('lockin', 'Supplier lock-in over a long term', 'A long term makes it costly to change supplier.', [
        'Break clauses at each extension',
        'Data and knowledge transfer obligations',
        'Benchmarking of price at the half-way point',
      ]),
    );
  if (/software|cloud|saas|it |data|digital|hosting/.test(t))
    out.push(
      R('cyber', 'Data security and privacy', 'Personal or sensitive data is exposed through the supplier.', [
        'Security assessment before award',
        'Data residency and breach notification terms',
        'Penetration testing evidence',
      ]),
    );
  if (/construction|works|building|clean|guard|maintenance|hazard|chemical/.test(t))
    out.push(
      R('whs', 'Work health and safety', 'Workers or the public are harmed by the work.', [
        'Safety management plan reviewed by the delegate',
        'Site induction and incident reporting',
        'Insurance and licence checks',
      ]),
    );
  if (f.complexity === 'HIGH' || f.complexity === 'CRITICAL')
    out.push(
      R(
        'complexity',
        "Complexity beyond the team's experience",
        'The procurement is more complex than the team usually runs.',
        ['Specialist adviser', 'Phased approach with decision points', 'Peer review of the evaluation'],
      ),
    );
  return out;
}

export const riskRating = (l: number | null, i: number | null) =>
  l && i ? { score: l * i, level: l * i >= 15 ? 'HIGH' : l * i >= 8 ? 'MEDIUM' : 'LOW' } : null;

// ---------------------------------------------------------------- comparing versions (FR-0740)
export type DiffPart = { t: 'same' | 'add' | 'del'; text: string };

/** A word-level comparison: what was added and what was removed, as it would be shown with tracked changes. */
export function wordDiff(before: string, after: string): DiffPart[] {
  const a = before.split(/(\s+)/).filter((x) => x !== '');
  const b = after.split(/(\s+)/).filter((x) => x !== '');
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: DiffPart[] = [];
  const push = (t: DiffPart['t'], text: string) => {
    const last = out[out.length - 1];
    if (last && last.t === t) last.text += text;
    else out.push({ t, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('same', a[i]!);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) push('del', a[i++]!);
    else push('add', b[j++]!);
  }
  while (i < n) push('del', a[i++]!);
  while (j < m) push('add', b[j++]!);
  return out;
}

export interface FieldChange {
  key: string;
  label: string;
  before: string;
  after: string;
  by: string | null;
  at: string;
}

/** An AI-style digest of what changed since someone last looked (rules-simulated). */
export function summariseChanges(changes: FieldChange[]): string {
  if (changes.length === 0) return 'Nothing has changed since you last looked.';
  const by = new Map<string, FieldChange[]>();
  for (const c of changes) by.set(c.key, [...(by.get(c.key) ?? []), c]);
  const parts = [...by.values()].map((list) => {
    const first = list[0]!;
    const last = list[list.length - 1]!;
    const who = [...new Set(list.map((c) => c.by ?? 'the platform'))].join(' and ');
    const grew = last.after.length - first.before.length;
    const kind = !first.before
      ? 'was written'
      : !last.after
        ? 'was cleared'
        : grew > 20
          ? 'was expanded'
          : grew < -20
            ? 'was shortened'
            : 'was reworded';
    return `${first.label} ${kind} by ${who}${list.length > 1 ? ` (${list.length} edits)` : ''}`;
  });
  return `${changes.length} change(s) to ${by.size} field(s): ${parts.join('; ')}.`;
}

// ---------------------------------------------------------------- supplier risk map (FR-0610)
export interface Location {
  city: string;
  state: string;
  country: string;
  lat: number;
  lng: number;
}
export interface Signal {
  feed: 'WEATHER' | 'FINANCIAL' | 'GEOPOLITICAL';
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  detail: string;
}
const WATCH = new Set(['Myanmar', 'Russia', 'Belarus', 'Iran', 'North Korea', 'Syria']);

/** Simulated external feeds: a seasonal weather outlook by state, the financial reading, and a geopolitical watchlist. */
export function supplierSignals(
  loc: Location,
  month: number,
  financial: { level: 'LOW' | 'MEDIUM' | 'HIGH'; reason: string },
): Signal[] {
  const wet = [11, 12, 1, 2, 3, 4].includes(month);
  const weather: Signal =
    ['QLD', 'NT'].includes(loc.state) && wet
      ? { feed: 'WEATHER', level: 'HIGH', detail: 'Cyclone season outlook for northern Australia' }
      : ['NSW', 'VIC'].includes(loc.state) && [12, 1, 2].includes(month)
        ? { feed: 'WEATHER', level: 'MEDIUM', detail: 'Bushfire season outlook for the south-east' }
        : { feed: 'WEATHER', level: 'LOW', detail: 'No severe weather outlook' };
  const geo: Signal = WATCH.has(loc.country)
    ? { feed: 'GEOPOLITICAL', level: 'HIGH', detail: `${loc.country} is on a geopolitical watchlist` }
    : { feed: 'GEOPOLITICAL', level: 'LOW', detail: 'Not on a watchlist' };
  return [weather, { feed: 'FINANCIAL', level: financial.level, detail: financial.reason }, geo];
}
export const overallLevel = (signals: Signal[]) =>
  signals.some((s) => s.level === 'HIGH')
    ? 'HIGH'
    : signals.some((s) => s.level === 'MEDIUM')
      ? 'MEDIUM'
      : 'LOW';

// ---------------------------------------------------------------- reference content (FR-0765)
export const CONTENT_KINDS = [
  'Project manager',
  'Business analyst',
  'Security specialist',
  'Facilities coordinator',
] as const;
export const CONTENT_LEVELS = ['Junior', 'Intermediate', 'Senior'] as const;
export const CONTENT_SECTORS = ['Public', 'Private'] as const;

/** Variants of common role descriptions across categories, sectors and experience levels, as a new generation. */
export function generateReference(
  categories: string[],
  generation: number,
): Array<{
  kind: string;
  title: string;
  category: string;
  sector: string;
  level: string;
  body: string;
}> {
  const out = [];
  for (const kind of CONTENT_KINDS)
    for (const category of categories)
      for (const sector of CONTENT_SECTORS)
        for (const level of CONTENT_LEVELS)
          out.push({
            kind,
            title: `${level} ${kind.toLowerCase()} (${category}, ${sector.toLowerCase()} sector)`,
            category,
            sector,
            level,
            body: `${level} ${kind.toLowerCase()} for ${category} work in the ${sector.toLowerCase()} sector. ${
              level === 'Senior'
                ? 'Leads delivery, owns outcomes and mentors others.'
                : level === 'Intermediate'
                  ? 'Delivers independently with periodic review.'
                  : 'Supports delivery under direction.'
            } ${sector === 'Public' ? 'Understands procurement probity, record keeping and public reporting duties.' : "Understands commercial confidentiality and the organisation's approval limits."} Current best practice, generation ${generation}.`,
          });
  return out;
}

// ---------------------------------------------------------------- spend by dimension (FR-0645)
export const SPEND_DIMENSIONS = [
  'SUPPLIER',
  'CONTRACT',
  'MASTER',
  'PROJECT',
  'BUSINESS_UNIT',
  'DIVISION',
] as const;
export type SpendDimension = (typeof SPEND_DIMENSIONS)[number];

export { daysBetween };
