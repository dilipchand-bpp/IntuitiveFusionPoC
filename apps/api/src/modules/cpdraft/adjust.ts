/**
 * Plain-language adjustment of a draft (CP-05, engine rules-simulated-v1).
 *
 * An instruction is matched against a documented list of patterns (ADJUST_PATTERNS below, also returned by the API so the
 * page can show examples). Each pattern edits the structured document, never free text. Where a pattern matches but the change
 * cannot be made ("there is no requirement 9", "the weights must add up to 100") the answer says exactly why. Where no pattern
 * matches the answer is "I could not apply that" with examples. It never guesses what was meant.
 */
import { canonicalUnit, UNITS } from '../intake/extract.js';
import {
  CLAUSES,
  CRITERIA,
  CRITERION_SYNONYMS,
  EXPANSIONS,
  REQUIREMENTS,
  RISKS,
  riskLine,
  toned,
} from './library.js';
import {
  QUANTITY_UNITS,
  addDaysIso,
  addMonthsIso,
  endOfTerm,
  extractFacts,
  findCategory,
  findMoney,
  monthsBetween,
  normaliseSpoken,
  parseDate,
  sentenceCase,
} from './lang.js';
import { rescaleWeights } from './generate.js';
import {
  aud,
  clone,
  longDate,
  newId,
  refreshDerived,
  type DraftDoc,
  type Item,
  type Section,
  type SourceRef,
} from './model.js';

export type Refusal = 'NOT_UNDERSTOOD' | 'NOT_ALLOWED' | 'NO_CHANGE';
export type AdjustOutcome =
  | { ok: true; doc: DraftDoc; sources: SourceRef[]; summary: string }
  | { ok: false; reason: Refusal; message: string };

class Stop extends Error {
  constructor(
    readonly reason: Refusal,
    message: string,
  ) {
    super(message);
  }
}
const refuse = (m: string): never => {
  throw new Stop('NOT_ALLOWED', m);
};
const nochange = (m: string): never => {
  throw new Stop('NO_CHANGE', m);
};

/** The documented set. `example` is shown to people; `id` is stable for tests. */
export const ADJUST_PATTERNS: ReadonlyArray<{ id: string; area: string; example: string; note: string }> = [
  {
    id: 'weights',
    area: 'Weights',
    example: 'make price 60% and quality 40%',
    note: 'Named criteria get the weights you give; the others are scaled so the total stays 100.',
  },
  {
    id: 'weights-relative',
    area: 'Weights',
    example: 'increase the price weighting by 10 points',
    note: 'Moves one weight up or down; the others are scaled to keep 100.',
  },
  {
    id: 'weights-equal',
    area: 'Weights',
    example: 'weight all criteria equally',
    note: 'Splits 100 evenly across the scored criteria.',
  },
  {
    id: 'criterion-add',
    area: 'Criteria',
    example: 'add a sustainability criterion at 10%',
    note: 'Standard wording for sustainability, innovation, local participation, security, support and more.',
  },
  {
    id: 'criterion-remove',
    area: 'Criteria',
    example: 'remove the innovation criterion',
    note: 'The remaining weights are scaled to 100.',
  },
  {
    id: 'requirement-add',
    area: 'Requirements',
    example: 'add a data-sovereignty requirement',
    note: 'Uses the approved wording when there is some; otherwise give the wording after a colon.',
  },
  {
    id: 'requirement-add-text',
    area: 'Requirements',
    example: 'add requirement: staff must hold a current police check',
    note: 'Your own wording is kept exactly.',
  },
  {
    id: 'requirement-remove',
    area: 'Requirements',
    example: 'remove requirement 3',
    note: 'Or "remove the data sovereignty requirement".',
  },
  {
    id: 'requirement-replace',
    area: 'Requirements',
    example: 'replace requirement 2 with: the supplier must provide monthly reports',
    note: 'Your wording replaces the item.',
  },
  {
    id: 'clause-add',
    area: 'Clauses',
    example: 'add a step-in rights clause',
    note: 'From the clause library; or "add a clause called X: wording".',
  },
  {
    id: 'clause-remove',
    area: 'Clauses',
    example: 'remove the IP clause',
    note: 'Mandatory clauses cannot be removed.',
  },
  {
    id: 'clause-replace',
    area: 'Clauses',
    example: 'replace the termination clause with: either party may terminate on 60 days notice',
    note: 'Your wording replaces the clause text.',
  },
  {
    id: 'budget',
    area: 'Budget',
    example: 'change the budget to 450k',
    note: 'Also "increase the budget by 10%"; every sentence that quotes the budget follows.',
  },
  {
    id: 'dates',
    area: 'Dates and term',
    example: 'start on 1 March 2027',
    note: 'Also "move the start date back two weeks", "finish by 30 June 2028", "set the term to 24 months", "set the closing date to 15 December 2026".',
  },
  {
    id: 'notice',
    area: 'Dates and term',
    example: 'set the notice period to 60 days',
    note: 'Contract drafts only.',
  },
  {
    id: 'quantity',
    area: 'Quantity',
    example: 'change the number of sites to 60',
    note: 'Also "increase the number of users by 20%".',
  },
  {
    id: 'shorten',
    area: 'Length',
    example: 'shorten the scope',
    note: 'Keeps the first sentence of each point. Nothing is dropped.',
  },
  {
    id: 'expand',
    area: 'Length',
    example: 'expand the background',
    note: 'Adds standard explanatory wording, one step at a time.',
  },
  {
    id: 'tone',
    area: 'Tone',
    example: 'make it plainer',
    note: 'Or "use a formal tone". Applies to the whole document.',
  },
  {
    id: 'risk-add',
    area: 'Risks',
    example: 'add a risk: supplier insolvency',
    note: 'Standard risks come with a level and mitigation; your own wording is kept as written.',
  },
  { id: 'risk-remove', area: 'Risks', example: 'remove risk 2', note: 'Or "remove the cost overrun risk".' },
  {
    id: 'reorder',
    area: 'Order',
    example: 'move the timeline before the scope',
    note: 'Also "put risks first", "swap scope and deliverables", "move requirement 3 to the top".',
  },
  {
    id: 'text',
    area: 'Text',
    example: 'add to the scope: include after-hours cover',
    note: 'Also "replace paragraph 2 of the background with: ..." and "remove paragraph 3 of the scope".',
  },
  {
    id: 'field',
    area: 'Fields',
    example: 'set the business unit to Facilities',
    note: 'Title, category, business unit, contract owner, supply location, data sensitivity.',
  },
];
export const ADJUST_EXAMPLES: readonly string[] = [
  'make price 60% and quality 40%',
  'add a data-sovereignty requirement',
  'shorten the scope',
  'change the budget to 450k',
  'start on 1 March 2027',
  'add a risk: supplier insolvency',
  'make it plainer',
  'move the timeline before the scope',
];

// ------------------------------------------------------------------------------------------------ helpers
const WORD_NUM: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
  eighteen: 18,
  twenty: 20,
  thirty: 30,
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
};
const num = (s: string): number =>
  /^\d/.test(s) ? Number(s.replace(/,/g, '')) : (WORD_NUM[s.toLowerCase()] ?? NaN);
const NUMW = '(\\d[\\d,]*|one|two|three|four|five|six|seven|eight|nine|ten|twelve|eighteen|twenty|thirty)';
const clipQ = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const clean = (s: string) =>
  s
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/[.\s]+$/, '')
    .trim();
const sentence = (s: string) => {
  const t = clean(s);
  return t ? `${sentenceCase(t)}.` : t;
};
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const SECTION_ALIASES: Record<string, string[]> = {
  background: ['background'],
  objectives: ['objectives', 'objective', 'goals'],
  scope: ['scope of work', 'scope of works', 'scope'],
  requirements: ['requirements', 'requirement list', 'requirement'],
  deliverables: ['deliverables', 'deliverable'],
  serviceLevels: ['service levels', 'service level', 'slas', 'sla'],
  personnel: ['skills and personnel', 'personnel', 'skills', 'staffing'],
  timeline: ['timeline', 'timeframe', 'schedule'],
  milestones: ['milestones', 'milestone'],
  evaluationHints: ['evaluation hints', 'evaluation guidance'],
  assumptions: ['assumptions', 'assumption'],
  risks: ['risks and mitigation', 'risk register', 'risks', 'risk'],
  overview: ['overview', 'introduction'],
  timetable: ['timetable'],
  evaluationCriteria: ['evaluation criteria', 'criteria'],
  conditions: ['conditions of tendering', 'conditions'],
  submission: ['how to submit', 'submission'],
  contact: ['questions and contact', 'contact'],
  schedule: ['key terms', 'schedule'],
  clauses: ['clauses', 'contract clauses'],
  criteria: ['criteria and weights', 'criteria', 'weights'],
  mandatoryGates: ['pass or fail requirements', 'pass or fail', 'mandatory criteria', 'gates'],
  scoringMethod: ['how scoring works', 'scoring method', 'scoring'],
  notes: ['notes for evaluators', 'notes'],
  evaluationCommittee: ['evaluation committee', 'evaluators', 'evaluation panel', 'panel'],
  steeringCommittee: ['steering committee', 'steering group', 'steering'],
  approvalDelegate: ['approval delegate', 'delegate', 'approver'],
  consultations: ['consultations', 'consultation', 'endorsements'],
  dueDiligence: ['due diligence', 'diligence'],
};

interface Hit {
  section: Section;
  index: number;
  end: number;
}
/** The first section named in `text` (earliest mention wins; the longest name wins at the same place). */
function findSectionIn(doc: DraftDoc, text: string, from = 0): Hit | null {
  let best: Hit | null = null;
  for (const s of doc.sections) {
    const names = [s.title.toLowerCase(), ...(SECTION_ALIASES[s.key] ?? [s.key.toLowerCase()])];
    for (const n of names) {
      const m = new RegExp(`\\b${esc(n).replace(/ /g, '\\s+')}\\b`, 'i').exec(text.slice(from));
      if (!m) continue;
      const hit = { section: s, index: from + m.index, end: from + m.index + m[0].length };
      if (!best || hit.index < best.index || (hit.index === best.index && hit.end > best.end)) best = hit;
    }
  }
  return best;
}
const sectionNames = (doc: DraftDoc) => doc.sections.map((s) => s.title.toLowerCase()).join(', ');
const get = (doc: DraftDoc, key: string) => doc.sections.find((s) => s.key === key);

class Ctx {
  touched = new Set<string>();
  removed = new Set<string>();
  notes: string[] = [];
  constructor(
    readonly doc: DraftDoc,
    readonly today: Date,
    readonly raw: string,
  ) {}
  touchField(k: string) {
    this.touched.add(`fields.${k}`);
  }
  touchItem(s: Section, it: Item) {
    this.touched.add(`sections.${s.key}.${it.id}`);
  }
}

// ------------------------------------------------------------------------------------------------ tone
// ------------------------------------------------------------------------------------------------ item lookup
function lookupItems(
  s: Section,
  topic: string,
  libAliases: Array<{ aliases: RegExp; text: string; title?: string }>,
): Item[] {
  const t = topic
    .toLowerCase()
    .replace(/\bip\b/g, 'intellectual property')
    .trim();
  const titled = s.items.filter((it) => t.length >= 2 && (it.title ?? '').toLowerCase().includes(t));
  if (titled.length) return titled;
  const byLib = libAliases.filter((l) => l.aliases.test(topic));
  const out: Item[] = [];
  if (byLib.length)
    for (const it of s.items)
      if (
        byLib.some(
          (l) =>
            l.aliases.test(`${it.title ?? ''} ${it.text}`) ||
            it.text === l.text ||
            (l.title !== undefined && it.title === l.title),
        )
      )
        out.push(it);
  if (out.length) return out;
  const words = t
    .split(/[^a-z0-9]+/)
    .filter(
      (w) =>
        w.length >= 4 &&
        ![
          'about',
          'that',
          'with',
          'this',
          'requirement',
          'clause',
          'risk',
          'criterion',
          'mentioning',
          'mentions',
          'regarding',
        ].includes(w),
    );
  if (!words.length) return [];
  const stems = words.map((w) => w.slice(0, Math.max(4, w.length - 2)));
  const scored = s.items
    .map((it) => {
      const hay = `${it.title ?? ''} ${it.text}`.toLowerCase();
      return { it, n: stems.filter((w) => hay.includes(w)).length };
    })
    .filter((x) => x.n > 0);
  const top = Math.max(0, ...scored.map((x) => x.n));
  return scored.filter((x) => x.n === top).map((x) => x.it);
}
function oneItem(
  s: Section,
  topic: string,
  noun: string,
  libs: Array<{ aliases: RegExp; text: string; title?: string }>,
): { item: Item; n: number } {
  const hits = lookupItems(s, topic, libs);
  if (!hits.length)
    return refuse(
      `No ${noun} mentions “${clipQ(topic, 40)}”. Say the number instead, for example “remove ${noun} 2”. The list has ${s.items.length} item${s.items.length === 1 ? '' : 's'}.`,
    );
  if (hits.length > 1)
    return refuse(
      `More than one ${noun} matches “${clipQ(topic, 40)}” (numbers ${hits.map((h) => s.items.indexOf(h) + 1).join(', ')}). Say which number.`,
    );
  const item = hits[0]!;
  return { item, n: s.items.indexOf(item) + 1 };
}
function nthItem(s: Section, n: number, noun: string): Item {
  if (!Number.isInteger(n) || n < 1 || n > s.items.length)
    return refuse(
      `There is no ${noun} ${n}; the list has ${s.items.length} item${s.items.length === 1 ? '' : 's'}.`,
    );
  return s.items[n - 1]!;
}

// ------------------------------------------------------------------------------------------------ weights
function scored(s: Section) {
  return s.items.filter((i) => !(i.mandatory && (i.weight ?? 0) === 0));
}
function criterionMatch(s: Section, label: string): Item | null {
  const l = label.toLowerCase().trim();
  if (!l) return null;
  const direct = s.items.filter((i) => (i.title ?? '').toLowerCase().includes(l));
  if (direct.length === 1) return direct[0]!;
  const syn = CRITERION_SYNONYMS[l];
  if (syn) {
    const hits = s.items.filter((i) => syn.some((w) => (i.title ?? '').toLowerCase().includes(w)));
    if (hits.length >= 1) return hits[0]!;
  }
  if (direct.length > 1) return direct[0]!;
  const stem = l.length > 5 ? l.slice(0, l.length - 2) : l;
  return s.items.find((i) => (i.title ?? '').toLowerCase().includes(stem)) ?? null;
}
const STOP = new Set([
  'make',
  'set',
  'change',
  'weight',
  'weighting',
  'weightings',
  'the',
  'a',
  'an',
  'and',
  'to',
  'at',
  'of',
  'criterion',
  'criteria',
  'for',
  'on',
  'put',
  'give',
  'be',
  'is',
  'should',
  'keep',
  'it',
  'please',
  'then',
  'with',
  'or',
  'by',
  'score',
  'scoring',
  'percent',
  'points',
  'point',
  'scored',
  'worth',
  'only',
]);
const tokens = (s: string) => s.toLowerCase().match(/[a-z][a-z-]*/g) ?? [];
const labelFrom = (s: Section, text: string, fromEnd: boolean): string | null => {
  const ws = tokens(text).filter((w) => !STOP.has(w));
  if (!ws.length) return null;
  const order = fromEnd ? [...ws].reverse() : ws;
  // try the nearest word, then the nearest two words together
  const one = order[0]!;
  if (criterionMatch(s, one)) return one;
  const two = fromEnd
    ? `${ws[ws.length - 2] ?? ''} ${ws[ws.length - 1]}`.trim()
    : `${ws[0]} ${ws[1] ?? ''}`.trim();
  if (two !== one && criterionMatch(s, two)) return two;
  return one;
};

function weightPairs(s: Section, c: string): Array<{ label: string; value: number }> | null {
  const re = /(\d{1,3}(?:\.\d+)?)\s*(?:%|percent|per cent)/gi;
  const found: Array<{ idx: number; end: number; v: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(c))) found.push({ idx: m.index, end: m.index + m[0].length, v: Number(m[1]) });
  if (!found.length) {
    // "weight price at 50" without a percent sign
    const w =
      /\b(?:weight|weighting)\b[^\d]*?([a-z][a-z -]{2,30}?)\s+(?:at|to|=|of)\s*(\d{1,3})\b(?!\s*(?:months?|years?|sites?|days?))/i.exec(
        c,
      );
    return w ? [{ label: w[1]!.trim(), value: Number(w[2]) }] : null;
  }
  const firstLeft = c.slice(0, found[0]!.idx);
  const percentFirst = labelFrom(s, firstLeft, true) === null;
  const out: Array<{ label: string; value: number }> = [];
  found.forEach((f, i) => {
    const prevEnd = i === 0 ? 0 : found[i - 1]!.end;
    const nextIdx = i + 1 < found.length ? found[i + 1]!.idx : c.length;
    const label = percentFirst
      ? labelFrom(s, c.slice(f.end, nextIdx), false)
      : labelFrom(s, c.slice(prevEnd, f.idx), true);
    out.push({ label: label ?? '', value: f.v });
  });
  return out;
}

function applyWeights(ctx: Ctx, s: Section, named: Map<Item, number>): string {
  const pool = scored(s);
  const unnamed = pool.filter((i) => !named.has(i));
  const sumNamed = [...named.values()].reduce((a, c) => a + c, 0);
  if ([...named.values()].some((v) => !Number.isInteger(v) || v < 0 || v > 100))
    refuse('Weights must be whole numbers from 0 to 100.');
  const rest = 100 - sumNamed;
  if (rest < 0) refuse(`Those weights add up to ${sumNamed}%, which is more than 100%. Lower one of them.`);
  const summary = [...named.entries()]
    .map(([i, v]) => `${(i.title ?? 'criterion').toLowerCase()} ${v}%`)
    .join(', ');
  if (!unnamed.length) {
    if (sumNamed !== 100) refuse(`The weights must add up to 100%. You gave ${sumNamed}% (${summary}).`);
    for (const [i, v] of named) {
      i.weight = v;
      ctx.touchItem(s, i);
    }
    return `Set ${summary}.`;
  }
  const rawUnnamed = unnamed.map((i) => i.weight ?? 0);
  if (rest > 0 && rawUnnamed.every((w) => w === 0))
    refuse(
      `That leaves ${rest}% for the other criteria, but they have no weight to share it by. Name every weight, for example “price 60%, quality 30%, delivery 10%”.`,
    );
  const scaled = rescaleWeights(rawUnnamed, rest);
  for (const [i, v] of named) {
    i.weight = v;
    ctx.touchItem(s, i);
  }
  unnamed.forEach((i, k) => {
    if (i.weight !== scaled[k]) {
      i.weight = scaled[k]!;
      ctx.touchItem(s, i);
    }
  });
  const zeroed = unnamed.filter((i) => i.weight === 0 && (rawUnnamed[unnamed.indexOf(i)] ?? 0) > 0);
  return zeroed.length
    ? `Set ${summary}. Nothing is left for ${zeroed.map((i) => (i.title ?? 'a criterion').toLowerCase()).join(' and ')}, so ${zeroed.length === 1 ? 'it is' : 'they are'} now 0%.`
    : `Set ${summary}. The other criteria were scaled so the total is 100%.`;
}

function criteriaSection(doc: DraftDoc): Section {
  const s = doc.sections.find((x) => x.type === 'CRITERIA');
  if (!s)
    return refuse(
      'This document has no evaluation criteria to weight. Try a tender document or an evaluation criteria draft.',
    );
  return s;
}

function handleWeights(ctx: Ctx, c: string): string | null {
  const rel = new RegExp(
    `\\b(increase|raise|lift|boost|reduce|lower|decrease|cut|drop)\\s+(?:the\\s+)?([a-z][a-z -]{2,30}?)(?:\\s+(?:weighting|weight|criterion))?\\s+by\\s+${NUMW}\\s*(?:%|percent|points?|pts?)?`,
    'i',
  ).exec(c);
  const equal =
    /\b(?:weight|weigh|split|share|score)\b.*\b(?:all\b.*\b)?(?:criteria|criterion|weights)?\b.*\b(?:equally|evenly|the same|equal)\b|\bequal (?:weights|weightings)\b/i.test(
      c,
    );
  const hasWeightWord = /\b(?:weight|weighting|weightings|criteria|criterion|percent|%)/i.test(c);
  if (equal && /\b(?:weight|criteria|equal)/i.test(c) && !/\b(?:budget|requirement)/i.test(c)) {
    const s = criteriaSection(ctx.doc);
    const pool = scored(s);
    const w = rescaleWeights(
      pool.map(() => 1),
      100,
    );
    pool.forEach((i, k) => {
      if (i.weight !== w[k]) {
        i.weight = w[k]!;
        ctx.touchItem(s, i);
      }
    });
    return `Weighted the ${pool.length} scored criteria equally (${w.join(', ')}).`;
  }
  if (rel && !/\b(?:budget|value|cost|quantity|sites|users|term)\b/i.test(rel[2]!)) {
    const s = criteriaSection(ctx.doc);
    const item = criterionMatch(s, rel[2]!.trim());
    if (item) {
      const by = num(rel[3]!);
      const up = /^(?:increase|raise|lift|boost)/i.test(rel[1]!);
      const next = Math.max(0, Math.min(100, (item.weight ?? 0) + (up ? by : -by)));
      return applyWeights(ctx, s, new Map([[item, next]]));
    }
  }
  if (!hasWeightWord) return null;
  const doc = ctx.doc;
  const s = doc.sections.find((x) => x.type === 'CRITERIA');
  if (!s) {
    if (/\d\s*(?:%|percent)/i.test(c) && /\b(?:weight|weighting|price|quality|criteria|criterion)\b/i.test(c))
      return criteriaSection(doc) && null;
    return null;
  }
  const pairs = weightPairs(s, c);
  if (!pairs || !pairs.length) return null;
  const named = new Map<Item, number>();
  for (const p of pairs) {
    const item = p.label ? criterionMatch(s, p.label) : null;
    if (!item)
      return refuse(
        `I could not find a criterion called “${p.label || '?'}”. The criteria are: ${s.items.map((i) => i.title).join('; ')}.`,
      );
    if (named.has(item) && named.get(item) !== p.value)
      refuse(`You gave two different weights for ${item.title?.toLowerCase()}.`);
    named.set(item, p.value);
  }
  return applyWeights(ctx, s, named);
}

function handleCriterion(ctx: Ctx, c: string): string | null {
  const doc = ctx.doc;
  const add =
    /^(?:please\s+)?(?:add|include|introduce|insert)\s+(?:an?\s+|the\s+|new\s+)*(?:(?:evaluation|scoring)\s+)?criteri(?:on|a)\s+(?:for|called|named|on|about|:)\s*(.+?)(?:\s+(?:at|of|weighted(?: at)?|with(?: a)? weight(?:ing)?(?: of)?)\s*(\d{1,3})\s*(?:%|percent))?\s*$/i.exec(
      c,
    ) ??
    /^(?:please\s+)?(?:add|include|introduce|insert)\s+(?:an?\s+|the\s+|new\s+)*(.+?)\s+(?:evaluation\s+|scoring\s+)?criterion(?:\s+(?:at|of|weighted(?: at)?|with(?: a)? weight(?:ing)?(?: of)?)\s*(\d{1,3})\s*(?:%|percent))?\s*$/i.exec(
      c,
    );
  const rem =
    /^(?:please\s+)?(?:remove|delete|drop|take out)\s+(?:the\s+)?(.+?)\s+criterion\s*$/i.exec(c) ??
    /^(?:please\s+)?(?:remove|delete|drop)\s+criterion\s+(?:number\s+|no\.?\s*|#)?(\d+)\s*$/i.exec(c);
  if (!add && !rem) return null;
  const s = criteriaSection(doc);
  const pool = scored(s);
  if (add) {
    const name = clean(add[1]!);
    const w = add[2] ? Number(add[2]) : 10;
    const lib = CRITERIA.find((x) => x.aliases.test(name));
    if (!lib && name.split(/\s+/).length > 5)
      return refuse('Give the criterion a short name, for example “add a sustainability criterion at 10%”.');
    const title = lib?.name ?? sentenceCase(name);
    if (s.items.some((i) => (i.title ?? '').toLowerCase() === title.toLowerCase()))
      nochange(`There is already a criterion called ${title}.`);
    if (w < 1 || w > 60) refuse('A new criterion needs a weight between 1% and 60%.');
    const scaled = rescaleWeights(
      pool.map((i) => i.weight ?? 0),
      100 - w,
    );
    pool.forEach((i, k) => {
      if (i.weight !== scaled[k]) {
        i.weight = scaled[k]!;
        ctx.touchItem(s, i);
      }
    });
    const it: Item = {
      id: newId(doc),
      title,
      text: lib?.description ?? `Respondents are scored on ${name.toLowerCase()}.`,
      weight: w,
      stream: lib?.stream ?? 'OTHER',
    };
    s.items.push(it);
    ctx.touchItem(s, it);
    return `Added the criterion “${title}” at ${w}%${add[2] ? '' : ' (no weight was given, so 10% was used)'}; the others were scaled so the total is 100%.`;
  }
  const item =
    rem![2] === undefined && /^\d+$/.test(rem![1]!)
      ? nthItem(s, Number(rem![1]), 'criterion')
      : oneItem(s, rem![1]!, 'criterion', []).item;
  if (pool.length <= 1 && pool.includes(item))
    refuse('That is the only scored criterion, so it cannot be removed.');
  const rest = pool.filter((i) => i !== item);
  const scaled = rescaleWeights(
    rest.map((i) => i.weight ?? 0),
    100,
  );
  rest.forEach((i, k) => {
    if (i.weight !== scaled[k]) {
      i.weight = scaled[k]!;
      ctx.touchItem(s, i);
    }
  });
  s.items = s.items.filter((i) => i !== item);
  ctx.removed.add(`sections.${s.key}.${item.id}`);
  return `Removed the criterion “${item.title}”; the others were scaled so the total is 100%.`;
}

// ------------------------------------------------------------------------------------------------ requirements, clauses, risks
const reqSection = (doc: DraftDoc) =>
  doc.sections.find((s) => s.key === 'requirements') ?? doc.sections.find((s) => s.key === 'mandatoryGates');
const REQ_LIBS = REQUIREMENTS.map((r) => ({
  aliases: r.aliases,
  text: r.text,
  code: r.code,
  label: r.label,
  clause: r.clause,
}));
const CLAUSE_LIBS = CLAUSES.map((c) => ({ aliases: c.aliases, text: c.text, title: c.title }));

function addClauseItem(ctx: Ctx, title: string, text: string, mandatory = false): string {
  const s = get(ctx.doc, 'clauses')!;
  if (s.items.some((i) => (i.title ?? '').toLowerCase() === title.toLowerCase()))
    nochange(`The contract already has a “${title}” clause.`);
  const it: Item = { id: newId(ctx.doc), title, text, mandatory, tpl: text };
  s.items.push(it);
  ctx.touchItem(s, it);
  return `Added the “${title}” clause at the end of the clauses.`;
}

function handleRequirement(ctx: Ctx, c: string): string | null {
  const doc = ctx.doc;
  const contract = Boolean(get(doc, 'clauses'));
  const addRe =
    /^(?:please\s+)?(?:add|include|insert|append|introduce)\s+(?:an?\s+|the\s+|new\s+)*(?:(.+?)\s+)?requirements?\b(?:\s*[:\-–]\s*(.+)|\s+(?:that|for|about|on|regarding|to say|saying)\s+(.+)|\s*$)/i.exec(
      c,
    ) ?? /^(?:please\s+)?(?:require|mandate|insist on|stipulate)\s+(?:that\s+)?(.+)$/i.exec(c);
  const remNum =
    /^(?:please\s+)?(?:remove|delete|drop|take out|strike)\s+(?:the\s+)?requirements?\s+(?:number\s+|no\.?\s*|#)?(\d+)\b/i.exec(
      c,
    );
  const remTopic =
    /^(?:please\s+)?(?:remove|delete|drop|take out|strike)\s+(?:the\s+)?requirements?\s+(?:about|on|for|regarding|mentioning|that mentions|covering)\s+(.+)$/i.exec(
      c,
    ) ??
    /^(?:please\s+)?(?:remove|delete|drop|take out|strike)\s+(?:the\s+)?(.+?)\s+requirements?\s*$/i.exec(c);
  const rep =
    /^(?:please\s+)?(?:replace|change|update|rewrite|amend|reword)\s+requirement\s+(?:number\s+|no\.?\s*|#)?(\d+)\s+(?:with|to|:)\s*:?\s*(.+)$/i.exec(
      c,
    );
  if (!addRe && !remNum && !remTopic && !rep) return null;

  if (contract) {
    if (addRe) {
      const m = /^(?:please\s+)?(?:require|mandate|insist on|stipulate)/i.test(c) ? null : addRe;
      const topic = clean((m ? (m[1] ?? m[3] ?? '') : (addRe[1] ?? '')) || '');
      const text = m ? clean(m[2] ?? '') : '';
      const lib = REQ_LIBS.find((r) => r.clause && r.aliases.test(topic || text || addRe[1] || ''));
      if (lib?.clause) return addClauseItem(ctx, lib.clause.title, lib.clause.text);
      return refuse(
        'This is a contract draft, so requirements are clauses. Try “add a data-sovereignty clause” or “add a clause called Reporting: the Supplier reports monthly”.',
      );
    }
    return refuse(
      'This is a contract draft, so these are clauses. Try “remove the IP clause” or “replace clause 3 with: ...”.',
    );
  }
  const s = reqSection(doc);
  if (!s) return refuse(`This document has no requirements list. Its sections are: ${sectionNames(doc)}.`);
  const noun = s.key === 'mandatoryGates' ? 'pass or fail requirement' : 'requirement';

  if (addRe) {
    const verbatimIntro = !/^(?:please\s+)?(?:require|mandate|insist on|stipulate)/i.test(c);
    const topic = verbatimIntro ? clean(addRe[1] ?? '') : '';
    const tail = verbatimIntro ? clean(addRe[2] ?? addRe[3] ?? '') : clean(addRe[1] ?? '');
    const probe = tail || topic;
    // your own wording after a colon is kept as written; only a short topic ("data sovereignty") brings in the standard wording
    const short =
      probe.split(/\s+/).length <= 4 && !/\b(?:must|shall|should|will|needs?|has|have)\b/i.test(probe);
    const lib = REQ_LIBS.find((r) => r.aliases.test(topic || (short ? tail : '')));
    const libForTail = !topic && short ? REQ_LIBS.find((r) => r.aliases.test(tail)) : undefined;
    const pick = lib ?? libForTail;
    let text: string;
    if (pick && (topic || short))
      text = s.key === 'mandatoryGates' ? `Pass or fail: ${pick.label}. ${pick.text}` : pick.text;
    else if (tail) text = sentence(tail);
    else
      return refuse(
        `I do not have standard wording for a “${clipQ(topic, 40)}” requirement. Give me the wording, for example “add requirement: ${topic || 'the supplier must ...'}”.`,
      );
    if (s.items.some((i) => i.text.toLowerCase() === text.toLowerCase()))
      nochange('That requirement is already in the list.');
    const it: Item = { id: newId(doc), text };
    s.items.push(it);
    ctx.touchItem(s, it);
    return `Added a ${noun} at position ${s.items.length}${pick ? ` (standard wording: ${pick.label})` : ' (your wording, as written)'}.`;
  }
  if (rep) {
    const it = nthItem(s, Number(rep[1]), noun);
    it.text = sentence(rep[2]!);
    delete it.tpl;
    it.manual = true;
    ctx.touchItem(s, it);
    return `Replaced ${noun} ${rep[1]} with your wording.`;
  }
  const target = remNum
    ? { item: nthItem(s, Number(remNum[1]), noun), n: Number(remNum[1]) }
    : oneItem(s, remTopic![1]!, noun, REQ_LIBS);
  s.items = s.items.filter((i) => i !== target.item);
  ctx.removed.add(`sections.${s.key}.${target.item.id}`);
  return `Removed ${noun} ${target.n}: “${clipQ(target.item.text)}”.`;
}

function handleClause(ctx: Ctx, c: string): string | null {
  const add =
    /^(?:please\s+)?(?:add|include|insert|append|introduce)\s+(?:an?\s+|the\s+|new\s+)*clause\s+(?:called|named|titled)\s+([^:]+?)\s*[:\-–]\s*(.+)$/i.exec(
      c,
    ) ??
    /^(?:please\s+)?(?:add|include|insert|append|introduce)\s+(?:an?\s+|the\s+|new\s+)*(.+?)\s+clause\s*$/i.exec(
      c,
    );
  const remNum =
    /^(?:please\s+)?(?:remove|delete|drop|take out)\s+clause\s+(?:number\s+|no\.?\s*|#)?(\d+)\s*$/i.exec(c);
  const rem = /^(?:please\s+)?(?:remove|delete|drop|take out)\s+(?:the\s+)?(.+?)\s+clause\s*$/i.exec(c);
  const repNum =
    /^(?:please\s+)?(?:replace|change|rewrite|amend|update|reword)\s+clause\s+(?:number\s+|no\.?\s*|#)?(\d+)\s+(?:with|to|:)\s*:?\s*(.+)$/i.exec(
      c,
    );
  const rep =
    /^(?:please\s+)?(?:replace|change|rewrite|amend|update|reword)\s+(?:the\s+)?(.+?)\s+clause\s+(?:with|to|:)\s*:?\s*(.+)$/i.exec(
      c,
    );
  if (!add && !remNum && !rem && !repNum && !rep) return null;
  const s = get(ctx.doc, 'clauses');
  if (!s)
    return refuse(
      `Only a contract draft has clauses. This document’s sections are: ${sectionNames(ctx.doc)}.`,
    );
  if (add) {
    if (add[2]) return addClauseItem(ctx, sentenceCase(clean(add[1]!)), sentence(add[2]!));
    const topic = clean(add[1]!);
    const lib = CLAUSE_LIBS.find((l) => l.aliases.test(topic));
    if (!lib)
      return refuse(
        `I do not have standard wording for a “${clipQ(topic, 40)}” clause. The library has: ${CLAUSE_LIBS.map((l) => l.title.toLowerCase()).join(', ')}. Or give the wording: “add a clause called ${sentenceCase(topic)}: the Supplier must ...”.`,
      );
    return addClauseItem(ctx, lib.title, lib.text);
  }
  if (rep || repNum) {
    const target = repNum
      ? { item: nthItem(s, Number(repNum[1]), 'clause'), n: Number(repNum[1]) }
      : oneItem(s, rep![1]!, 'clause', CLAUSE_LIBS);
    const text = sentence((repNum ?? rep)![2]!);
    if (text.length < 10) refuse('The new clause wording is too short to be a clause.');
    target.item.text = text;
    delete target.item.tpl;
    target.item.manual = true;
    ctx.touchItem(s, target.item);
    return `Replaced the wording of the “${target.item.title}” clause${target.item.mandatory ? ' (it stays mandatory)' : ''}.`;
  }
  const t = remNum
    ? { item: nthItem(s, Number(remNum[1]), 'clause'), n: Number(remNum[1]) }
    : oneItem(s, rem![1]!, 'clause', CLAUSE_LIBS);
  if (t.item.mandatory)
    refuse(
      `The “${t.item.title}” clause is mandatory in the clause library and cannot be removed. You can replace its wording instead.`,
    );
  s.items = s.items.filter((i) => i !== t.item);
  ctx.removed.add(`sections.${s.key}.${t.item.id}`);
  return `Removed the “${t.item.title}” clause.`;
}

function handleRisk(ctx: Ctx, c: string): string | null {
  const add =
    /^(?:please\s+)?(?:add|include|record|log|note)\s+(?:an?\s+|the\s+|new\s+)*(?:(high|medium|low)\s+)?risk(?:\s*[:\-–]\s*|\s+(?:of|about|for|on|that|regarding|from)\s+)(.+)$/i.exec(
      c,
    ) ??
    /^(?:please\s+)?(?:add|include|record|log|note)\s+(?:an?\s+|the\s+|new\s+)*(?:(high|medium|low)\s+)?(.+?)\s+risk\s*$/i.exec(
      c,
    );
  const remNum =
    /^(?:please\s+)?(?:remove|delete|drop|take out)\s+risk\s+(?:number\s+|no\.?\s*|#)?(\d+)\s*$/i.exec(c);
  const rem = /^(?:please\s+)?(?:remove|delete|drop|take out)\s+(?:the\s+)?(.+?)\s+risk\s*$/i.exec(c);
  if (!add && !remNum && !rem) return null;
  const s = get(ctx.doc, 'risks');
  if (!s) return refuse(`This document has no risks section. Its sections are: ${sectionNames(ctx.doc)}.`);
  const libs = RISKS.map((r) => ({ aliases: r.aliases, text: riskLine(r), title: r.title }));
  if (add) {
    const level = add[1] ? sentenceCase(add[1].toLowerCase()) : undefined;
    const topic = clean(add[2]!);
    const lib = RISKS.find((r) => r.aliases.test(topic));
    const short = topic.split(/\s+/).length <= 6;
    const line =
      lib && short
        ? riskLine({ ...lib, level: (level as 'Low' | 'Medium' | 'High' | undefined) ?? lib.level })
        : `${sentenceCase(topic)}. Level: ${level ?? 'to be assessed'}. Mitigation: to be agreed.`;
    if (
      s.items.some(
        (i) => i.text.split('. Level')[0]!.toLowerCase() === line.split('. Level')[0]!.toLowerCase(),
      )
    )
      nochange('That risk is already listed.');
    const it: Item = { id: newId(ctx.doc), text: line };
    s.items.push(it);
    ctx.touchItem(s, it);
    return lib && short
      ? `Added the risk “${lib.title}” with its standard mitigation at position ${s.items.length}.`
      : `Added your risk at position ${s.items.length}. Its level and mitigation are marked to be agreed, because they were not given.`;
  }
  const t = remNum
    ? { item: nthItem(s, Number(remNum[1]), 'risk'), n: Number(remNum[1]) }
    : oneItem(s, rem![1]!, 'risk', libs);
  s.items = s.items.filter((i) => i !== t.item);
  ctx.removed.add(`sections.${s.key}.${t.item.id}`);
  return `Removed risk ${t.n}: “${clipQ(t.item.text.split('. Level')[0]!)}”.`;
}

// ------------------------------------------------------------------------------------------------ fields: budget, quantity, dates
function reconcile(ctx: Ctx, changed: 'start' | 'end' | 'term') {
  const f = ctx.doc.fields;
  const before = { ...f };
  if (changed === 'end' && f.startDate && f.endDate) {
    if (f.endDate <= f.startDate) refuse('The end date must be after the start date.');
    f.termMonths = String(monthsBetween(f.startDate, f.endDate));
  } else if (changed === 'start' && f.startDate) {
    if (f.termMonths) f.endDate = endOfTerm(f.startDate, Number(f.termMonths));
    else if (f.endDate) {
      if (f.endDate <= f.startDate) refuse('The start date must be before the end date.');
      f.termMonths = String(monthsBetween(f.startDate, f.endDate));
    }
  } else if (changed === 'term' && f.startDate && f.termMonths)
    f.endDate = endOfTerm(f.startDate, Number(f.termMonths));
  for (const k of ['termMonths', 'endDate']) if (f[k] !== before[k]) ctx.touchField(k);
}

function handleBudget(ctx: Ctx, c: string): string | null {
  const kw = /\b(?:budget|estimated value|contract value|cost ceiling|spend cap)\b/i;
  if (!kw.test(c)) return null;
  const rel =
    /\b(increase|raise|lift|reduce|lower|decrease|cut|drop)\b[^.]*?\b(?:budget|estimated value|contract value)\b[^.]*?\bby\s+(.+)$/i.exec(
      c,
    );
  const abs =
    /\b(?:change|set|make|update|adjust|revise|amend|put|fix)\b[^.]*?\b(?:budget|estimated value|contract value)\b[^.]*?\b(?:to|at|of|=|:)\s+(.+)$/i.exec(
      c,
    ) ?? /\bbudget\s+(?:is|of|:)\s+(.+)$/i.exec(c);
  if (!rel && !abs) return null;
  if (ctx.doc.kind === 'TENDER_DOC')
    return refuse(
      'A tender document never states the budget, because it is internal. Change the budget on the request or the plan instead.',
    );
  const f = ctx.doc.fields;
  const old = Number(f.estimatedValue);
  const term = f.termMonths ? Number(f.termMonths) : null;
  const amount = (s: string) => {
    const m =
      findMoney(normaliseSpoken(s), term) ??
      (/(\d[\d,]{3,})/.test(s) ? { value: Number(/(\d[\d,]{3,})/.exec(s)![1]!.replace(/,/g, '')) } : null);
    return m?.value ?? null;
  };
  let next: number | null;
  let how: string;
  if (rel) {
    if (!Number.isFinite(old) || !f.estimatedValue)
      return refuse('There is no budget yet to change. Say “set the budget to 450k” first.');
    const up = /^(?:increase|raise|lift)/i.test(rel[1]!);
    const pct = /(\d+(?:\.\d+)?)\s*(?:%|percent)/.exec(rel[2]!);
    const by = pct ? Math.round((old * Number(pct[1])) / 100) : amount(rel[2]!);
    if (by === null)
      return refuse(
        'I could not read the amount to change the budget by. Try “increase the budget by 10%” or “reduce the budget by $50k”.',
      );
    next = up ? old + by : old - by;
    how = `${up ? 'Increased' : 'Reduced'} the budget by ${pct ? `${pct[1]}%` : aud(by)}`;
  } else {
    next = amount(abs![1]!);
    if (next === null)
      return refuse(
        'I could not read that amount. Try “change the budget to 450k” or “set the budget to $1.2M”.',
      );
    how = 'Set the budget';
  }
  if (!(next > 0)) return refuse('The budget must be more than zero.');
  if (next === old) nochange(`The budget is already ${aud(old)}.`);
  f.estimatedValue = String(next);
  ctx.touchField('estimatedValue');
  return `${how}${Number.isFinite(old) && f.estimatedValue ? `: ${Number.isFinite(old) ? aud(old) : 'none'} to ${aud(next)}` : ` to ${aud(next)}`}. Every sentence that quotes the budget follows it.`;
}

const UNIT_ALT = QUANTITY_UNITS.join('|');
function handleQuantity(ctx: Ctx, c: string): string | null {
  const f = ctx.doc.fields;
  const rel = new RegExp(
    `\\b(increase|raise|grow|reduce|lower|decrease|cut|drop)\\b[^.]*?\\b(?:the\\s+)?(?:number of\\s+)?(${UNIT_ALT}|quantity|volume|headcount)\\b[^.]*?\\bby\\s+(\\d[\\d,]*)\\s*(%|percent)?`,
    'i',
  ).exec(c);
  const abs =
    new RegExp(
      `\\b(?:change|set|make|update|adjust|revise)\\b[^.]*?\\b(?:the\\s+)?(?:number of\\s+)?(${UNIT_ALT}|quantity|volume|headcount)\\b[^.]*?\\b(?:to|at|of|=|:)\\s*(\\d[\\d,]*)\\b`,
      'i',
    ).exec(c) ??
    new RegExp(`^(?:make it|cover|set it to|change it to)\\s+(\\d[\\d,]*)\\s+(${UNIT_ALT})\\b`, 'i').exec(c);
  if (!rel && !abs) return null;
  const unitWord = (w: string) => (/^(?:quantity|volume|headcount)$/i.test(w) ? null : w.toLowerCase());
  const old = f.quantity ? Number(f.quantity) : null;
  let next: number;
  let unit: string | null;
  if (rel) {
    if (old === null)
      return refuse(
        `There is no quantity yet to change. Say “set the number of ${unitWord(rel[2]!) ?? 'sites'} to 60” first.`,
      );
    unit = unitWord(rel[2]!);
    const by = Number(rel[3]!.replace(/,/g, ''));
    const amount = rel[4] ? Math.round((old * by) / 100) : by;
    next = /^(?:increase|raise|grow)/i.test(rel[1]!) ? old + amount : old - amount;
  } else {
    const m = abs!;
    const numberFirst = /^\d/.test(m[1]!);
    unit = unitWord(numberFirst ? m[2]! : m[1]!);
    next = Number((numberFirst ? m[1]! : m[2]!).replace(/,/g, ''));
    if (!unit && old === null)
      return refuse('Say what is being counted, for example “set the number of sites to 60”.');
  }
  if (!(next > 0) || !Number.isFinite(next)) return refuse('The quantity must be more than zero.');
  const oldUnit = f.quantityUnit;
  if (unit && oldUnit && unit !== oldUnit.toLowerCase() && old !== null)
    return refuse(
      `This draft counts ${oldUnit}, not ${unit}. Say “set the number of ${oldUnit} to ${next}”.`,
    );
  if (next === old && (!unit || unit === oldUnit))
    nochange(`The quantity is already ${old} ${oldUnit ?? ''}.`.trim());
  f.quantity = String(next);
  ctx.touchField('quantity');
  if (unit && !oldUnit) {
    f.quantityUnit = unit;
    ctx.touchField('quantityUnit');
  }
  return `Set the quantity to ${next} ${f.quantityUnit ?? ''}${old !== null ? ` (was ${old})` : ''}. Every sentence that quotes it follows.`.replace(
    /\s+\./,
    '.',
  );
}

function readDate(ctx: Ctx, s: string, role: 'START' | 'END'): string {
  const p = parseDate(normaliseSpoken(s), ctx.today, role, true);
  if (!p) return refuse('I could not read that as a date. Try “1 March 2027”, “2027-03-01” or “next March”.');
  return p.iso;
}
function shiftIso(iso: string, n: number, unit: string, dir: 1 | -1): string {
  const u = unit.toLowerCase();
  if (u.startsWith('day')) return addDaysIso(iso, dir * n);
  if (u.startsWith('week')) return addDaysIso(iso, dir * n * 7);
  if (u.startsWith('month')) return addMonthsIso(iso, dir * n);
  return addMonthsIso(iso, dir * n * 12);
}

function handleDates(ctx: Ctx, c: string): string | null {
  const f = ctx.doc.fields;
  const notice = /\bnotice period\b.*?(\d{1,3})\s*days?/i.exec(c);
  if (notice) {
    if (ctx.doc.kind !== 'CONTRACT_DRAFT')
      return refuse('The notice period is part of the contract draft. Make a contract draft to set it.');
    if (f.noticeDays === notice[1]) nochange(`The notice period is already ${notice[1]} days.`);
    const was = f.noticeDays;
    f.noticeDays = notice[1]!;
    ctx.touchField('noticeDays');
    return `Set the notice period to ${notice[1]} days${was ? ` (was ${was})` : ''}.`;
  }
  const kw =
    /\b(?:start|starting|starts|commenc\w*|begin\w*|go[- ]?live|end|ending|finish\w*|completion|expir\w*|clos(?:e|es|ing)|term|duration|contract length)\b/i;
  if (!kw.test(c)) return null;

  const rel = new RegExp(
    `\\b(move|push|delay|defer|postpone|bring forward|pull forward|shift|extend|bring)\\b[^.]*?\\b(start|end|finish\\w*|completion|clos\\w*|term)(?:\\s+date)?\\b[^.]*?\\b(back|forward|later|earlier|out)?\\s*(?:by\\s+)?${NUMW}\\s*(days?|weeks?|months?|years?)\\b`,
    'i',
  ).exec(c);
  if (rel) {
    const verb = rel[1]!.toLowerCase();
    const what = rel[2]!.toLowerCase();
    const dir: 1 | -1 =
      /forward|earlier|bring|pull/.test(`${verb} ${rel[3] ?? ''}`) && !/back|later|out/.test(rel[3] ?? '')
        ? -1
        : 1;
    const n = num(rel[4]!);
    if (!Number.isFinite(n)) return refuse('I could not read how long to move it by.');
    if (what.startsWith('term') || (verb === 'extend' && what.startsWith('term'))) {
      if (!f.termMonths)
        return refuse('There is no term yet to change. Say “set the term to 24 months” first.');
      const months = /^year/i.test(rel[5]!) ? n * 12 : /^month/i.test(rel[5]!) ? n : Math.round(n / 4);
      const next = Number(f.termMonths) + (verb === 'extend' ? months : dir * months);
      if (next < 1) return refuse('That would make the term shorter than a month.');
      f.termMonths = String(next);
      ctx.touchField('termMonths');
      reconcile(ctx, 'term');
      return `Changed the term to ${next} months.`;
    }
    const key = what.startsWith('start') ? 'startDate' : what.startsWith('clos') ? 'closeDate' : 'endDate';
    if (!f[key])
      return refuse(
        `There is no ${key === 'startDate' ? 'start' : key === 'closeDate' ? 'closing' : 'end'} date yet to move. Give one first, for example “start on 1 March 2027”.`,
      );
    f[key] = shiftIso(f[key]!, n, rel[5]!, verb === 'extend' ? 1 : dir);
    ctx.touchField(key);
    if (key === 'startDate') {
      if (f.termMonths && f.endDate) f.endDate = shiftIso(f.endDate, n, rel[5]!, dir); // the whole contract moves together
      ctx.touchField('endDate');
    } else if (key === 'endDate') reconcile(ctx, 'end');
    return `Moved the ${what.startsWith('start') ? 'start' : what.startsWith('clos') ? 'closing' : 'end'} date to ${longDate(f[key]!)}${key === 'startDate' && f.endDate ? `; the end date moved with it to ${longDate(f.endDate)}` : ''}.`;
  }
  const term =
    new RegExp(
      `\\b(?:set|change|make|update|adjust)\\b[^.]*?\\b(?:the\\s+)?(?:term|duration|contract length|length)\\b[^.]*?\\b(?:to|at|of|=|:)\\s*${NUMW}[- ]?(years?|yrs?|months?)\\b`,
      'i',
    ).exec(c) ?? new RegExp(`\\bmake it a\\s+${NUMW}[- ]?(year|month)\\b`, 'i').exec(c);
  if (term) {
    const n = num(term[1]!);
    const months = /^y/i.test(term[2]!) ? Math.round(n * 12) : n;
    if (!(months >= 1 && months <= 360)) return refuse('The term must be between 1 month and 30 years.');
    if (String(months) === f.termMonths) nochange(`The term is already ${months} months.`);
    f.termMonths = String(months);
    ctx.touchField('termMonths');
    reconcile(ctx, 'term');
    return `Set the term to ${months} months${f.endDate && f.startDate ? `; the end date is now ${longDate(f.endDate)}` : ''}.`;
  }
  const field = (
    re: RegExp,
    key: 'startDate' | 'endDate' | 'closeDate',
    role: 'START' | 'END',
    name: string,
  ) => {
    const m = re.exec(c);
    if (!m) return null;
    const iso = readDate(ctx, m[1]!, role);
    if (f[key] === iso) nochange(`The ${name} date is already ${longDate(iso)}.`);
    f[key] = iso;
    ctx.touchField(key);
    if (key === 'startDate') reconcile(ctx, 'start');
    else if (key === 'endDate') reconcile(ctx, 'end');
    return `Set the ${name} date to ${longDate(iso)}${key === 'startDate' && f.endDate ? `; the end date is ${longDate(f.endDate)}` : ''}.`;
  };
  return (
    field(
      /\b(?:tender|submissions?|responses?)?\s*clos(?:e|es|ing)(?:\s+date)?\b[^.]*?\b(?:to|on|at|by|is|=|:)\s+(.+)$/i,
      'closeDate',
      'END',
      'closing',
    ) ??
    field(
      /\b(?:start|starting|starts|commence\w*|begin\w*|go[- ]?live)(?:\s+date)?\b[^.]*?\b(?:to|on|at|from|is|=|:|in)\s+(.+)$/i,
      'startDate',
      'START',
      'start',
    ) ??
    field(/^(?:start|starting|commence|begin)\s+(.+)$/i, 'startDate', 'START', 'start') ??
    field(
      /\b(?:end|ending|ends|finish\w*|completion|expir\w*)(?:\s+date)?\b[^.]*?\b(?:to|on|at|by|is|=|:|in)\s+(.+)$/i,
      'endDate',
      'END',
      'end',
    ) ??
    field(/^(?:finish|end|complete)\s+(?:by|on|before)\s+(.+)$/i, 'endDate', 'END', 'end')
  );
}

// ------------------------------------------------------------------------------------------------ fields: generic
function handleField(ctx: Ctx, c: string): string | null {
  const m =
    /^(?:please\s+)?(?:change|set|update|rename|make|put)\s+(?:the\s+)?(title|name|category|business unit|unit|contract owner|owner|supply location|data sensitivity)\s+(?:to|as|is|:)\s*(.+)$/i.exec(
      c,
    ) ?? /^(title|business unit|contract owner|owner|category)\s+(?:is|:)\s*(.+)$/i.exec(c);
  if (!m) return null;
  const f = ctx.doc.fields;
  const label = m[1]!.toLowerCase();
  const raw = clean(m[2]!);
  if (!raw) return refuse('What should it be set to?');
  let key: string;
  let value: string;
  if (label === 'title' || label === 'name') {
    key = 'title';
    value = raw.length > 200 ? raw.slice(0, 200) : raw;
  } else if (label === 'category') {
    const hit = findCategory(raw);
    if (!hit)
      return refuse(
        'I do not recognise that category. Try one like cleaning, IT services, security, catering, landscaping, print, or training.',
      );
    key = 'category';
    value = `${hit.category} (UNSPSC ${hit.unspsc})`;
  } else if (label === 'business unit' || label === 'unit') {
    const u = canonicalUnit(raw);
    if (!u) return refuse(`I do not recognise that business unit. The units are: ${UNITS.join(', ')}.`);
    key = 'businessUnit';
    value = u;
  } else if (label === 'contract owner' || label === 'owner') {
    key = 'contractOwner';
    value = raw;
  } else if (label === 'supply location') {
    if (/off ?shore|overseas|international/i.test(raw)) value = 'OFFSHORE';
    else if (/local|on ?shore|australia/i.test(raw)) value = 'LOCAL';
    else return refuse('Supply location is either local (onshore) or offshore.');
    key = 'supplyLocation';
  } else {
    if (/sensitive|personal|confidential|classified/i.test(raw)) value = 'SENSITIVE';
    else if (/none|no\b|not sensitive/i.test(raw)) value = 'NONE';
    else return refuse('Data sensitivity is either sensitive (personal or confidential data) or none.');
    key = 'dataSensitivity';
  }
  if (f[key] === value) nochange(`That is already set to “${value}”.`);
  f[key] = value;
  ctx.touchField(key);
  if (key === 'title') ctx.doc.title = `${ctx.doc.title.split(':')[0]}: ${value}`;
  return `Set ${label === 'name' ? 'title' : label} to “${value}”.`;
}

// ------------------------------------------------------------------------------------------------ sections: text, length, tone, order
const FIRST_SENTENCE = /^(.+?[.!?])(?:\s+(?=[A-Z“"(])|$)/s;
function shortenText(t: string): string {
  const m = FIRST_SENTENCE.exec(t.trim());
  return m ? m[1]! : t;
}

function handleLength(ctx: Ctx, c: string): string | null {
  const shorten =
    /\b(?:shorten|shorter|condense|trim|cut down|concise|summari[sz]e|reduce the length of)\b/i.test(c);
  const expand = /\b(?:expand|elaborate|lengthen|longer|flesh out|more detail|add (?:more )?detail)\b/i.test(
    c,
  );
  if (!shorten && !expand) return null;
  if (shorten && expand) return refuse('Say either shorten or expand, not both in one instruction.');
  const doc = ctx.doc;
  const whole = /\b(?:whole document|entire document|everything|all sections|the document)\b/i.test(c);
  const hit = findSectionIn(doc, c);
  if (!hit && !whole)
    return refuse(
      `Which section? For example “${shorten ? 'shorten' : 'expand'} the ${doc.sections[0]?.title.toLowerCase() ?? 'background'}”. This document has: ${sectionNames(doc)}.`,
    );
  const targets = whole && !hit ? doc.sections : [hit!.section];
  let changed = 0;
  if (shorten) {
    for (const s of targets) {
      if (s.type === 'CRITERIA') continue;
      for (const it of s.items) {
        if (it.mandatory && s.type === 'CLAUSES') continue; // legal wording is not shortened for the sake of length
        const next = shortenText(it.text);
        if (next !== it.text) {
          it.text = next;
          if (it.tpl) it.manual = true;
          ctx.touchItem(s, it);
          changed += 1;
        }
      }
    }
    if (!changed)
      nochange(
        `The ${targets.length === 1 ? targets[0]!.title.toLowerCase() : 'document'} is already as short as I can make it without dropping content.`,
      );
    return `Shortened ${changed} item${changed === 1 ? '' : 's'} to their first sentence; no items were removed.`;
  }
  for (const s of targets) {
    if (s.type === 'CRITERIA' || s.type === 'CLAUSES') continue;
    const more = EXPANSIONS[s.key] ?? [];
    const next = more.findIndex((_, i) => !s.items.some((it) => it.tag === `exp:${s.key}:${i}`));
    if (next < 0) continue;
    const it: Item = { id: newId(doc), text: more[next]!, tag: `exp:${s.key}:${next}` };
    s.items.push(it);
    ctx.touchItem(s, it);
    changed += 1;
  }
  if (!changed)
    nochange(
      `I have no more standard detail to add to ${targets.length === 1 ? `the ${targets[0]!.title.toLowerCase()}` : 'the document'}. To add your own, say “add to the ${targets[0]?.title.toLowerCase() ?? 'scope'}: ...”.`,
    );
  return `Added standard explanatory wording to ${changed} section${changed === 1 ? '' : 's'}. It is general text, so read it before you use it.`;
}

function handleTone(ctx: Ctx, c: string): string | null {
  const plain =
    /\bplain(?:er)?\b|\bsimpl(?:er|e|ify)\b|\beveryday (?:language|words)\b|\beasier to read\b|\bless formal\b|\binformal\b|\bfriendl(?:y|ier)\b/i.test(
      c,
    );
  const formal =
    !plain && /\bformal(?:ly)?\b|\bprofessional (?:tone|language)\b|\blegal(?:istic)? tone\b/i.test(c);
  if (!plain && !formal) return null;
  if (
    !/\b(?:make|use|write|change|switch|set|tone|language|english|wording|words|style|rewrite|simplify|plainer|simpler|formal)\b/i.test(
      c,
    )
  )
    return null;
  if (/\b(?:requirement|clause|criterion|risk|budget|date|term)\s+\d/i.test(c)) return null;
  const doc = ctx.doc;
  const to: 'PLAIN' | 'FORMAL' = plain ? 'PLAIN' : 'FORMAL';
  let changed = 0;
  const scoped = findSectionIn(doc, c);
  for (const s of doc.sections)
    for (const it of s.items) {
      const next = toned(it.text, to);
      if (next !== it.text) {
        it.text = next;
        ctx.touchItem(s, it);
        changed += 1;
      }
    }
  const was = doc.tone;
  doc.tone = to;
  if (!changed && was === to)
    nochange(`The document is already in a ${to === 'PLAIN' ? 'plain' : 'formal'} tone.`);
  return `Changed the tone to ${to === 'PLAIN' ? 'plain' : 'formal'} wording in ${changed} item${changed === 1 ? '' : 's'}${scoped ? '. Tone applies to the whole document, not one section' : ''}.`;
}

function handleReorder(ctx: Ctx, c: string): string | null {
  const doc = ctx.doc;
  const item =
    /^(?:please\s+)?(?:move|put|place|shift)\s+(requirement|clause|criterion|risk)\s+(?:number\s+|no\.?\s*|#)?(\d+)\s+(.+)$/i.exec(
      c,
    );
  if (item) {
    const noun = item[1]!.toLowerCase();
    const s =
      noun === 'clause'
        ? get(doc, 'clauses')
        : noun === 'criterion'
          ? doc.sections.find((x) => x.type === 'CRITERIA')
          : noun === 'risk'
            ? get(doc, 'risks')
            : reqSection(doc);
    if (!s) return refuse(`This document has no ${noun} list.`);
    const from = Number(item[2]);
    const it = nthItem(s, from, noun);
    const where = item[3]!.toLowerCase();
    let to: number;
    const rel =
      /(before|after|above|below)\s+(?:the\s+)?(?:requirement|clause|criterion|risk|item)?\s*(?:number\s+|no\.?\s*|#)?(\d+)/.exec(
        where,
      );
    if (/\b(?:top|first|start|beginning)\b/.test(where)) to = 1;
    else if (/\b(?:end|last|bottom)\b/.test(where)) to = s.items.length;
    else if (/\bup\b/.test(where)) to = from - 1;
    else if (/\bdown\b/.test(where)) to = from + 1;
    else if (rel) {
      const other = Number(rel[2]);
      nthItem(s, other, noun);
      to = /before|above/.test(rel[1]!)
        ? other > from
          ? other - 1
          : other
        : other > from
          ? other
          : other + 1;
    } else
      return refuse(
        `Where should ${noun} ${from} go? Try “move ${noun} ${from} to the top”, “to the end” or “before ${noun} 1”.`,
      );
    to = Math.max(1, Math.min(s.items.length, to));
    if (to === from) nochange(`${sentenceCase(noun)} ${from} is already there.`);
    s.items.splice(from - 1, 1);
    s.items.splice(to - 1, 0, it);
    ctx.touched.add(`sections.${s.key}.__order`);
    return `Moved ${noun} ${from} to position ${to}.`;
  }
  const swap = /^(?:please\s+)?swap\s+(?:the\s+)?(.+?)\s+and\s+(?:the\s+)?(.+)$/i.exec(c);
  const edge =
    /^(?:please\s+)?(?:move|put|place|shift)\s+(?:the\s+)?(.+?)\s+(?:to the\s+)?(first|top|start|beginning|last|end|bottom)\s*$/i.exec(
      c,
    ) ?? /^(?:please\s+)?(?:put|place)\s+(?:the\s+)?(.+?)\s+(first|last)\s*$/i.exec(c);
  const rel =
    /^(?:please\s+)?(?:move|put|place|shift)\s+(?:the\s+)?(.+?)\s+(before|after|above|below|ahead of)\s+(?:the\s+)?(.+)$/i.exec(
      c,
    );
  if (!swap && !edge && !rel) return null;
  const one = (txt: string) => {
    const h = findSectionIn(doc, txt);
    if (!h)
      return refuse(
        `I could not find a section called “${clipQ(txt.trim(), 30)}”. This document has: ${sectionNames(doc)}.`,
      );
    return h.section;
  };
  const order = () => doc.sections.map((s) => s.key);
  const before = order().join(',');
  if (swap) {
    const a = one(swap[1]!);
    const b = one(swap[2]!);
    if (a === b) return refuse('Those are the same section.');
    const i = doc.sections.indexOf(a);
    const j = doc.sections.indexOf(b);
    doc.sections[i] = b;
    doc.sections[j] = a;
    ctx.touched.add('doc.sectionOrder');
    return `Swapped ${a.title.toLowerCase()} and ${b.title.toLowerCase()}.`;
  }
  if (edge) {
    const s = one(edge[1]!);
    const first = /first|top|start|beginning/i.test(edge[2]!);
    doc.sections = doc.sections.filter((x) => x !== s);
    if (first) doc.sections.unshift(s);
    else doc.sections.push(s);
    if (order().join(',') === before)
      nochange(`The ${s.title.toLowerCase()} section is already ${first ? 'first' : 'last'}.`);
    ctx.touched.add('doc.sectionOrder');
    return `Moved ${s.title.toLowerCase()} to the ${first ? 'start' : 'end'}.`;
  }
  const s = one(rel![1]!);
  const t = one(rel![3]!);
  if (s === t) return refuse('A section cannot go before or after itself.');
  doc.sections = doc.sections.filter((x) => x !== s);
  const at = doc.sections.indexOf(t);
  doc.sections.splice(/before|above|ahead/i.test(rel![2]!) ? at : at + 1, 0, s);
  if (order().join(',') === before) nochange(`The ${s.title.toLowerCase()} section is already there.`);
  ctx.touched.add('doc.sectionOrder');
  return `Moved ${s.title.toLowerCase()} ${/before|above|ahead/i.test(rel![2]!) ? 'before' : 'after'} ${t.title.toLowerCase()}.`;
}

function handleText(ctx: Ctx, c: string): string | null {
  const doc = ctx.doc;
  const addTo =
    /^(?:please\s+)?(?:add|append|insert)\s+(?:an?\s+(?:new\s+)?(?:paragraph|point|line|item|sentence|note)\s+)?(?:to|in|into|at the end of)\s+(?:the\s+)?([^:]+?)\s*(?::|[-–]|\s+(?:saying|that says|reading))\s*(.+)$/i.exec(
      c,
    );
  const repPara =
    /^(?:please\s+)?(?:replace|change|rewrite|update|amend|edit|reword)\s+(?:paragraph|item|point|line)\s+(\d+)\s+(?:of|in)\s+(?:the\s+)?(.+?)\s+(?:with|to|:)\s*:?\s*(.+)$/i.exec(
      c,
    );
  const remPara =
    /^(?:please\s+)?(?:remove|delete|drop)\s+(?:paragraph|item|point|line)\s+(\d+)\s+(?:of|from|in)\s+(?:the\s+)?(.+)$/i.exec(
      c,
    );
  const setAll =
    /^(?:please\s+)?(?:set|replace|rewrite|change)\s+(?:the\s+)?([a-z][a-z ]{2,40}?)\s+(?:to|with|:)\s*(.+)$/i.exec(
      c,
    );
  const resolve = (name: string) => {
    const h = findSectionIn(doc, name);
    if (!h)
      return refuse(
        `I could not find a section called “${clipQ(name.trim(), 30)}”. This document has: ${sectionNames(doc)}.`,
      );
    return h.section;
  };
  const writable = (s: Section) => {
    if (s.type === 'CRITERIA')
      return refuse(
        'Criteria have weights, so change them with “make price 60% and quality 40%” or “add a sustainability criterion”.',
      );
    if (s.type === 'CLAUSES')
      return refuse(
        'Clauses have titles, so use “add a clause called X: wording” or “replace the termination clause with: ...”.',
      );
    return s;
  };
  if (addTo) {
    const s = writable(resolve(addTo[1]!));
    const text = sentence(addTo[2]!);
    if (s.items.some((i) => i.text.toLowerCase() === text.toLowerCase()))
      nochange('That text is already there.');
    const it: Item = { id: newId(doc), text, manual: true };
    s.items.push(it);
    ctx.touchItem(s, it);
    return `Added your text to the end of the ${s.title.toLowerCase()} (item ${s.items.length}).`;
  }
  if (repPara) {
    const s = writable(resolve(repPara[2]!));
    const it = nthItem(s, Number(repPara[1]), 'paragraph');
    it.text = sentence(repPara[3]!);
    delete it.tpl;
    it.manual = true;
    ctx.touchItem(s, it);
    return `Replaced paragraph ${repPara[1]} of the ${s.title.toLowerCase()}; the others are unchanged.`;
  }
  if (remPara) {
    const s = writable(resolve(remPara[2]!));
    const it = nthItem(s, Number(remPara[1]), 'paragraph');
    s.items = s.items.filter((i) => i !== it);
    ctx.removed.add(`sections.${s.key}.${it.id}`);
    return `Removed paragraph ${remPara[1]} of the ${s.title.toLowerCase()}.`;
  }
  if (
    setAll &&
    findSectionIn(doc, setAll[1]!) &&
    !/\b(?:budget|title|term|date|category|unit|owner)\b/i.test(setAll[1]!)
  ) {
    const s = writable(resolve(setAll[1]!));
    const text = sentence(setAll[2]!);
    const it: Item = { id: newId(doc), text, manual: true };
    for (const old of s.items) ctx.removed.add(`sections.${s.key}.${old.id}`);
    s.items = [it];
    ctx.touchItem(s, it);
    return `Replaced the whole ${s.title.toLowerCase()} section with your wording.`;
  }
  return null;
}

// ------------------------------------------------------------------------------------------------ entry
type Handler = (ctx: Ctx, clause: string) => string | null;
const HANDLERS: Handler[] = [
  handleReorder,
  handleTone,
  handleLength,
  handleText,
  handleCriterion,
  handleClause,
  handleRequirement,
  handleRisk,
  handleBudget,
  handleQuantity,
  handleDates,
  handleWeights,
  handleField,
];

const NOT_UNDERSTOOD = (clause: string) =>
  `I could not apply that: “${clipQ(clause, 90)}”. I only change a draft with the instructions I know, and I will not guess. Try one like: ${ADJUST_EXAMPLES.slice(
    0,
    5,
  )
    .map((e) => `“${e}”`)
    .join(', ')}.`;

/** Splits a compound instruction into clauses on semicolons, new lines, " then " and sentence ends. */
export function clausesOf(instruction: string): string[] {
  return instruction
    .split(/\s*;\s*|\n+|\s+then\s+|(?<=[a-z0-9%)])\.\s+(?=[A-Za-z])/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function adjustDoc(
  doc: DraftDoc,
  sources: SourceRef[],
  instruction: string,
  today: Date,
): AdjustOutcome {
  const raw = normaliseSpoken(instruction).replace(/\s+/g, ' ').trim();
  if (!raw) return { ok: false, reason: 'NOT_UNDERSTOOD', message: NOT_UNDERSTOOD('') };
  const work = clone(doc);
  const ctx = new Ctx(work, today, raw);
  const done: string[] = [];
  const idle: string[] = [];
  for (const clause of clausesOf(raw)) {
    try {
      let summary: string | null = null;
      for (const h of HANDLERS) {
        summary = h(ctx, clause);
        if (summary !== null) break;
      }
      if (summary === null) return { ok: false, reason: 'NOT_UNDERSTOOD', message: NOT_UNDERSTOOD(clause) };
      done.push(summary);
    } catch (e) {
      if (e instanceof Stop) {
        if (e.reason === 'NO_CHANGE') idle.push(e.message);
        else
          return {
            ok: false,
            reason: e.reason,
            message: `I could not apply that. ${e.message}`,
          };
      } else throw e;
    }
  }
  if (!done.length) return { ok: false, reason: 'NO_CHANGE', message: `Nothing changed. ${idle.join(' ')}` };
  refreshDerived(work);
  // sources: what a person asked for replaces what the rules said for that place
  const label = `Your instruction: “${clipQ(raw, 80)}”`;
  const next = sources.filter(
    (s) =>
      ![...ctx.touched, ...ctx.removed].some((p) => s.path === p || s.path.startsWith(`${p}.`)) &&
      ![...ctx.removed].some((p) => s.path === p),
  );
  for (const p of ctx.touched) next.push({ path: p, kind: 'INSTRUCTION', label });
  return { ok: true, doc: work, sources: next, summary: [...done, ...idle.map((m) => `(${m})`)].join(' ') };
}

export { extractFacts };
