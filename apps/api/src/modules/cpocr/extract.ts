/**
 * Rule-based extraction of contract data (CP-07). Rules only, no model: every field comes from a pattern that fired on the
 * page text, with a rule confidence (how specific the pattern is: a labelled "End Date:" beats a derived date), multiplied by
 * the confidence of the page it came from, and the exact source span (page and character offsets in the stored page text).
 * Engine label rules-simulated-v1. Fields not found are reported as NOT_FOUND, never guessed.
 */
import { addDays, addMonths } from '../contract/dates.js';
import {
  AMOUNT_RE_SRC,
  CURRENCY_RE_SRC,
  DATE_RE_SRC,
  NUM_RE_SRC,
  amountFromText,
  collapse,
  currencyFromToken,
  daysFrom,
  isValidAbn,
  monthsFrom,
  numberFromText,
  parseDateText,
  titleCaseIfShouting,
} from './text.js';
import type { ExtractedField, FieldKey, FieldMap, OcrPage, Span } from './types.js';

export interface FieldDef {
  key: FieldKey;
  label: string;
  required: boolean;
  type: 'text' | 'date' | 'int' | 'money' | 'json';
}

export const FIELD_DEFS: readonly FieldDef[] = [
  { key: 'title', label: 'Contract title', required: true, type: 'text' },
  { key: 'contractNumber', label: 'Contract number', required: false, type: 'text' },
  { key: 'customer', label: 'Customer (buyer)', required: false, type: 'text' },
  { key: 'supplier', label: 'Supplier', required: true, type: 'text' },
  { key: 'supplierAbn', label: 'Supplier ABN', required: false, type: 'text' },
  { key: 'effectiveDate', label: 'Effective date', required: true, type: 'date' },
  { key: 'endDate', label: 'End date', required: true, type: 'date' },
  { key: 'termMonths', label: 'Term (months)', required: false, type: 'int' },
  { key: 'renewal', label: 'Renewal or extension option', required: false, type: 'json' },
  { key: 'noticeDays', label: 'Notice period (days)', required: false, type: 'int' },
  { key: 'value', label: 'Contract value', required: true, type: 'money' },
  { key: 'paymentTerms', label: 'Payment terms (days)', required: false, type: 'int' },
  { key: 'governingLaw', label: 'Governing law', required: false, type: 'text' },
  { key: 'liabilityCap', label: 'Liability cap', required: false, type: 'json' },
  { key: 'indemnity', label: 'Indemnity', required: false, type: 'json' },
  { key: 'terminationConvenience', label: 'Termination for convenience', required: false, type: 'json' },
  { key: 'serviceLevels', label: 'Service levels and KPIs', required: false, type: 'json' },
  { key: 'confidentiality', label: 'Confidentiality', required: false, type: 'json' },
  { key: 'dataLocation', label: 'Data location', required: false, type: 'json' },
  { key: 'insurance', label: 'Insurance', required: false, type: 'json' },
] as const;

const DEF = new Map(FIELD_DEFS.map((d) => [d.key, d]));
const r3 = (n: number) => Math.round(n * 1000) / 1000;

// ------------------------------------------------------------------ scanning helpers

interface Hit {
  page: OcrPage;
  m: RegExpExecArray & { indices: Array<[number, number] | undefined> };
}

const rx = (src: string, flags = 'i') => new RegExp(src, `${flags}d`);

/** First match of any pattern, trying the patterns in order of how specific they are, page by page. */
function firstHit(pages: OcrPage[], re: RegExp): Hit | null {
  for (const page of pages) {
    const m = re.exec(page.text);
    if (m) return { page, m: m as Hit['m'] };
  }
  return null;
}

function allHits(pages: OcrPage[], re: RegExp): Hit[] {
  const out: Hit[] = [];
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  for (const page of pages) {
    g.lastIndex = 0;
    for (const m of page.text.matchAll(g)) out.push({ page, m: m as Hit['m'] });
  }
  return out;
}

function span(page: OcrPage, start: number, end: number): Span {
  return { page: page.page, start, end, text: collapse(page.text.slice(start, end)).slice(0, 400) };
}

/** The span of a regex group (or the whole match when group is 0). */
function groupSpan(h: Hit, group = 0): Span {
  const [s, e] = h.m.indices[group] ?? h.m.indices[0]!;
  return span(h.page, s, e);
}

function make(
  key: FieldKey,
  value: unknown,
  display: string,
  rule: number,
  method: 'LABEL' | 'PATTERN' | 'DERIVED',
  page: OcrPage | null,
  source: Span | null,
  note?: string,
  pageConfidence?: number,
): ExtractedField {
  const def = DEF.get(key)!;
  const pc = pageConfidence ?? page?.confidence ?? 1;
  return {
    key,
    label: def.label,
    required: def.required,
    status: 'EXTRACTED',
    value,
    display,
    confidence: r3(rule * pc),
    ruleConfidence: rule,
    pageConfidence: r3(pc),
    method,
    source,
    ...(note ? { note } : {}),
    reviewed: false,
    needsReview: false,
  };
}

function missing(key: FieldKey, note?: string): ExtractedField {
  const def = DEF.get(key)!;
  return {
    key,
    label: def.label,
    required: def.required,
    status: 'NOT_FOUND',
    value: null,
    display: '',
    confidence: 0,
    ruleConfidence: 0,
    pageConfidence: 0,
    method: null,
    source: null,
    ...(note ? { note } : {}),
    reviewed: false,
    needsReview: false,
  };
}

const MONEY = (n: number, c: string) => `${c} ${n.toLocaleString('en-AU', { maximumFractionDigits: 2 })}`;

/** Sentences of a text with their offsets. A full stop inside a number ("99.5%") does not end one. */
export function sentencesOf(text: string, base = 0): Array<{ start: number; end: number; text: string }> {
  const out: Array<{ start: number; end: number; text: string }> = [];
  const re = /(?:[^.!?\n]|\.(?=\S))+(?:[.!?]+(?=\s|$))?/g;
  for (const m of text.matchAll(re)) {
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const t = raw.trim();
    if (t.length < 3) continue;
    out.push({ start: base + m.index + lead, end: base + m.index + lead + t.length, text: t });
  }
  // a sentence wrapped over several lines is one sentence: join pieces that do not end in sentence punctuation
  const joined: typeof out = [];
  for (const s of out) {
    const prev = joined[joined.length - 1];
    if (
      prev &&
      !/[.!?]$/.test(prev.text) &&
      (prev.text.length >= 50 || /^[a-z0-9($]/.test(s.text)) &&
      text.slice(prev.end - base, s.start - base).trim() === ''
    ) {
      prev.end = s.end;
      prev.text = text.slice(prev.start - base, prev.end - base);
    } else joined.push({ ...s });
  }
  return joined;
}

// ------------------------------------------------------------------ the rules

const CUSTOMER_ROLES = [
  'Customer',
  'Client',
  'Principal',
  'Licensee',
  'Tenant',
  'Lessee',
  'Purchaser',
  'Buyer',
  'Agency',
];
const SUPPLIER_ROLES = [
  'Supplier',
  'Contractor',
  'Vendor',
  'Service Provider',
  'Provider',
  'Licensor',
  'Landlord',
  'Lessor',
  'Consultant',
  'Seller',
];
const ROLE_MARK = rx(
  `\\(\\s*(?:the\\s+)?[“"'‘]?(${[...CUSTOMER_ROLES, ...SUPPLIER_ROLES].join('|')})[”"'’]?\\s*\\)`,
  'gi',
);

interface PartyRead {
  name: string;
  nameSpan: Span;
  abn?: { digits: string; span: Span; valid: boolean };
}

function parseParties(pages: OcrPage[]): { customer?: PartyRead; supplier?: PartyRead; page?: OcrPage } {
  for (const page of pages.slice(0, 3)) {
    const head = page.text.slice(0, 8000);
    const markers = [...head.matchAll(new RegExp(ROLE_MARK.source, 'gid'))] as Array<
      RegExpMatchArray & { indices: Array<[number, number]> }
    >;
    if (markers.length === 0) continue;
    const between = /\b(?:between|among)\b/i.exec(head);
    let cursor =
      between && between.index < markers[0]!.index!
        ? between.index + between[0].length
        : Math.max(0, head.lastIndexOf('.', markers[0]!.index!) + 1);
    const out: { customer?: PartyRead; supplier?: PartyRead } = {};
    for (const mk of markers) {
      const role = mk[1]!.toLowerCase();
      const side = CUSTOMER_ROLES.some((r) => r.toLowerCase() === role)
        ? 'customer'
        : SUPPLIER_ROLES.some((r) => r.toLowerCase() === role)
          ? 'supplier'
          : null;
      const segStart = cursor;
      cursor = mk.index! + mk[0].length;
      if (!side || out[side]) continue;
      const read = readParty(head.slice(segStart, mk.index!), segStart, page);
      if (read) out[side] = read;
      if (out.customer && out.supplier) break;
    }
    if (out.customer || out.supplier) return { ...out, page };
  }
  return {};
}

function readParty(seg: string, segStart: number, page: OcrPage): PartyRead | null {
  const lead = /^[\s,;:]*(?:(?:and|by and between)\s+)?/i.exec(seg)![0].length;
  let body = seg.slice(lead);
  let abn: PartyRead['abn'];
  const paren = /\(\s*(?:ABN|ACN|ARBN)\s*:?\s*([\d ]{9,14})\s*\)/i.exec(body);
  const bare = /\bABN\s*:?\s*(\d{2}\s?\d{3}\s?\d{3}\s?\d{3})\b/i.exec(body);
  const ab = paren ?? bare;
  if (ab) {
    const digits = ab[1]!.replace(/\s+/g, '');
    const at = segStart + lead + ab.index + ab[0].indexOf(ab[1]!);
    abn = { digits, span: span(page, at, at + ab[1]!.length), valid: isValidAbn(digits) };
    body = body.slice(0, ab.index);
  }
  const trimmed = body.replace(/[\s,;:-]+$/, '');
  if (trimmed.length < 2 || trimmed.length > 140) return null;
  const start = segStart + lead;
  return {
    name: collapse(trimmed),
    nameSpan: span(page, start, start + trimmed.length),
    ...(abn ? { abn } : {}),
  };
}

function termFromDates(start: string, end: string): { months: number; exact: boolean } {
  const e = addDays(end, 1);
  const [y1, m1, d1] = start.split('-').map(Number) as [number, number, number];
  const [y2, m2, d2] = e.split('-').map(Number) as [number, number, number];
  const months = (y2 - y1) * 12 + (m2 - m1);
  if (d1 === d2) return { months, exact: true };
  return {
    months: Math.round(
      (new Date(`${e}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) /
        86_400_000 /
        30.4375,
    ),
    exact: false,
  };
}

const INDEMNITY_RE = rx('indemnif(?:y|ies|ied)|hold\\s+harmless');

/** Who a sentence is about: the last party named in the text before the verb ("The Licensor may terminate" is the supplier side). */
export function subjectParty(before: string): 'CUSTOMER' | 'SUPPLIER' | 'EITHER' | 'UNSPECIFIED' {
  const cut = before.slice(Math.max(before.lastIndexOf('. ') + 2, 0));
  let last: { at: number; side: 'CUSTOMER' | 'SUPPLIER' | 'EITHER' } | null = null;
  const scan = (re: RegExp, side: 'CUSTOMER' | 'SUPPLIER' | 'EITHER') => {
    for (const m of cut.matchAll(re)) if (!last || m.index > last.at) last = { at: m.index, side };
  };
  scan(/\b(?:Either|Each)\s+party\b/gi, 'EITHER');
  scan(new RegExp(`\\b(?:the\\s+)?(?:${CUSTOMER_ROLES.join('|')})\\b`, 'gi'), 'CUSTOMER');
  scan(new RegExp(`\\b(?:the\\s+)?(?:${SUPPLIER_ROLES.join('|')})\\b`, 'gi'), 'SUPPLIER');
  return (last as { side: 'CUSTOMER' | 'SUPPLIER' | 'EITHER' } | null)?.side ?? 'UNSPECIFIED';
}

export function extractFields(pages: OcrPage[]): FieldMap {
  const out: FieldMap = {};
  const put = (f: ExtractedField) => {
    out[f.key] = f;
  };

  // ---- title: the heading at the top of page 1 that names the kind of agreement (a long title may wrap over lines)
  {
    const p1 = pages[0];
    let done = false;
    if (p1) {
      const lines: Array<{ start: number; end: number; t: string }> = [];
      let idx = 0;
      for (const line of p1.text.split('\n')) {
        const t = line.trim();
        if (t) lines.push({ start: idx + line.indexOf(t), end: idx + line.indexOf(t) + t.length, t });
        idx += line.length + 1;
      }
      const titleish = (t: string) =>
        t.length <= 80 && !/[.:]$/.test(t) && !/^(this|the parties|\d+\.)/i.test(t) && !t.includes(':');
      const shout = (t: string) => t === t.toUpperCase();
      for (let i = 0; i < Math.min(lines.length, 12) && !done; i++) {
        if (!titleish(lines[i]!.t)) continue;
        let j = i;
        while (
          j + 1 < lines.length &&
          j - i < 2 &&
          titleish(lines[j + 1]!.t) &&
          shout(lines[j]!.t) &&
          shout(lines[j + 1]!.t)
        )
          j++;
        const joined = lines
          .slice(i, j + 1)
          .map((l) => l.t)
          .join(' ');
        if (
          joined.length >= 6 &&
          joined.length <= 120 &&
          /\b(agreement|contract|licen[cs]e|lease|deed|terms and conditions|order form)\b/i.test(joined)
        ) {
          const title = titleCaseIfShouting(joined);
          put(
            make(
              'title',
              title,
              title,
              i <= 2 ? 0.92 : 0.75,
              'PATTERN',
              p1,
              span(p1, lines[i]!.start, lines[j]!.end),
            ),
          );
          done = true;
        }
      }
    }
    if (!done) put(missing('title', 'No heading that names an agreement was found on the first page'));
  }

  // ---- contract number
  {
    const h =
      firstHit(
        pages,
        rx(
          '\\b(?:agreement|contract|licen[cs]e|lease|order|purchase\\s+order)\\s+(?:number|no\\.?|ref(?:erence)?\\.?|id)\\s*[:#-]?\\s*([A-Z0-9][A-Z0-9\\-/]{2,29})',
        ),
      ) ??
      firstHit(
        pages,
        rx('\\bref(?:erence)?(?:\\s+(?:number|no\\.?))?\\s*[:#]\\s*([A-Z0-9][A-Z0-9\\-/]{2,29})'),
      );
    if (h && /\d/.test(h.m[1]!))
      put(
        make(
          'contractNumber',
          h.m[1]!.replace(/[-/]+$/, ''),
          h.m[1]!.replace(/[-/]+$/, ''),
          0.96,
          'LABEL',
          h.page,
          groupSpan(h, 1),
        ),
      );
    else put(missing('contractNumber'));
  }

  // ---- parties and ABN
  {
    const pr = parseParties(pages);
    if (pr.customer && pr.page)
      put(
        make('customer', pr.customer.name, pr.customer.name, 0.93, 'PATTERN', pr.page, pr.customer.nameSpan),
      );
    else put(missing('customer'));
    if (pr.supplier && pr.page) {
      put(
        make('supplier', pr.supplier.name, pr.supplier.name, 0.93, 'PATTERN', pr.page, pr.supplier.nameSpan),
      );
      const a = pr.supplier.abn;
      if (a) {
        const pretty = a.digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3 $4');
        put(
          make(
            'supplierAbn',
            a.digits,
            pretty,
            a.valid ? 0.97 : 0.55,
            'LABEL',
            pr.page,
            a.span,
            a.valid
              ? undefined
              : 'The ABN does not pass the ABN check digit test; check it against the ABN Lookup.',
          ),
        );
      } else put(missing('supplierAbn'));
    } else {
      put(missing('supplier', 'No party marked as the Supplier, Contractor or Licensor was found'));
      put(missing('supplierAbn'));
    }
  }

  // ---- effective date
  {
    const D = DATE_RE_SRC;
    const tries: Array<[RegExp, number, 'LABEL' | 'PATTERN', string?]> = [
      [rx(`\\b(?:effective|commencement|start)\\s+date\\s*(?:is|:)?\\s*(${D})`), 0.96, 'LABEL'],
      [
        rx(`\\b(?:commences|commencing|commence|starts|begins|effective)\\s+(?:on|from)\\s+(${D})`),
        0.95,
        'PATTERN',
      ],
      [
        rx(
          `\\b(?:date\\s+of\\s+(?:this\\s+)?(?:agreement|contract)|dated|made\\s+on|executed\\s+on)\\s*:?\\s*(${D})`,
        ),
        0.7,
        'PATTERN',
        'Taken from the date of the agreement; no commencement date was stated.',
      ],
    ];
    let done = false;
    for (const [re, rule, method, note] of tries) {
      const h = firstHit(pages, re);
      const iso = h ? parseDateText(h.m[1]!) : null;
      if (h && iso) {
        put(make('effectiveDate', iso, iso, rule, method, h.page, groupSpan(h, 1), note));
        done = true;
        break;
      }
    }
    if (!done) put(missing('effectiveDate'));
  }

  // ---- term in months (stated)
  let statedTerm: { months: number; hit: Hit } | null = null;
  {
    const N = NUM_RE_SRC;
    const re1 = rx(`\\b(?:term|period|duration)\\s+of\\s+(${N})\\s*(?:\\(\\d+\\)\\s*)?(months?|years?)`);
    const re2 = rx(
      `\\bterm\\s+(?:is|will\\s+be|shall\\s+be)\\s+(?:a\\s+period\\s+of\\s+)?(${N})\\s*(?:\\(\\d+\\)\\s*)?(months?|years?)`,
    );
    // a "further term of five years" is a renewal option, not the term of the agreement
    const initial = (x: Hit) =>
      !/(further|additional|renewal|extension|successive|subsequent)\s+$/i.test(
        x.page.text.slice(Math.max(0, x.m.index - 24), x.m.index),
      );
    const h = [...allHits(pages, re1), ...allHits(pages, re2)].find(initial);
    if (h) {
      const n = numberFromText(h.m[1]!);
      if (n) statedTerm = { months: monthsFrom(n, h.m[2]!), hit: h };
    }
  }

  // ---- end date
  {
    const D = DATE_RE_SRC;
    const tries: Array<[RegExp, number, 'LABEL' | 'PATTERN']> = [
      [rx(`\\b(?:end|expiry|expiration)\\s+date\\s*(?:is|:)?\\s*(${D})`), 0.96, 'LABEL'],
      [
        rx(
          `\\b(?:ends|expires|expire|expiring|concludes|ending)\\s+(?:on|at\\s+the\\s+end\\s+of|upon)?\\s*(${D})`,
        ),
        0.95,
        'PATTERN',
      ],
      [
        rx(`\\b(?:continues?|continuing|runs?)\\s+(?:until|to|through)\\s+(?:and\\s+including\\s+)?(${D})`),
        0.93,
        'PATTERN',
      ],
      [rx(`\\buntil\\s+(?:and\\s+including\\s+)?(${D})`), 0.85, 'PATTERN'],
    ];
    let done = false;
    for (const [re, rule, method] of tries) {
      const h = firstHit(pages, re);
      const iso = h ? parseDateText(h.m[1]!) : null;
      if (h && iso) {
        put(make('endDate', iso, iso, rule, method, h.page, groupSpan(h, 1)));
        done = true;
        break;
      }
    }
    const eff = out.effectiveDate;
    if (!done && eff?.status === 'EXTRACTED' && statedTerm) {
      const iso = addDays(addMonths(eff.value as string, statedTerm.months), -1);
      const base = Math.min(eff.confidence, statedTerm.hit.page.confidence);
      put(
        make(
          'endDate',
          iso,
          iso,
          0.78,
          'DERIVED',
          null,
          groupSpan(statedTerm.hit, 0),
          `Derived: effective date ${eff.value as string} plus a term of ${statedTerm.months} months, less a day. No end date was written.`,
          base,
        ),
      );
      done = true;
    }
    if (!done) put(missing('endDate'));
  }

  // ---- term months: stated, else counted from the dates
  {
    const eff = out.effectiveDate;
    const end = out.endDate;
    const counted =
      eff?.status === 'EXTRACTED' && end?.status === 'EXTRACTED'
        ? termFromDates(eff.value as string, end.value as string)
        : null;
    if (statedTerm) {
      const agree = !counted || Math.abs(counted.months - statedTerm.months) <= 1;
      put(
        make(
          'termMonths',
          statedTerm.months,
          `${statedTerm.months} months`,
          agree ? 0.93 : 0.65,
          'PATTERN',
          statedTerm.hit.page,
          groupSpan(statedTerm.hit, 0),
          agree
            ? undefined
            : `The stated term does not match the dates, which give ${counted!.months} months.`,
        ),
      );
    } else if (counted && counted.months > 0) {
      put(
        make(
          'termMonths',
          counted.months,
          `${counted.months} months`,
          counted.exact ? 0.88 : 0.75,
          'DERIVED',
          null,
          null,
          'Counted from the effective and end dates; no term was written.',
          Math.min(eff!.confidence, end!.confidence),
        ),
      );
    } else put(missing('termMonths'));
  }

  // ---- renewal or extension option
  {
    const N = NUM_RE_SRC;
    let f: ExtractedField | null = null;
    const multi = firstHit(
      pages,
      rx(
        `\\b(?:extend|renew)\\b[^.]{0,80}?\\b(${N})\\s+(?:\\(\\d+\\)\\s*)?(?:further|additional|successive)\\s+(?:periods?|terms?)\\s+of\\s+(${N})\\s*(?:\\(\\d+\\)\\s*)?(months?|years?)`,
      ),
    );
    const opt =
      firstHit(
        pages,
        rx(
          `\\b(${N})\\s+(?:\\(\\d+\\)\\s*)?options?\\s+to\\s+(?:renew|extend)[^.]{0,100}?(?:term|period)\\s+of\\s+(${N})\\s*(?:\\(\\d+\\)\\s*)?(months?|years?)`,
        ),
      ) ??
      firstHit(
        pages,
        rx(
          `\\boptions?\\s+to\\s+(?:renew|extend)[^.]{0,100}?(?:term|period)\\s+of\\s+(${N})\\s*(?:\\(\\d+\\)\\s*)?(months?|years?)`,
        ),
      );
    const auto = firstHit(
      pages,
      rx(
        `\\b(?:renews?|renewed|extended)\\s+automatically\\s+for\\s+(?:successive\\s+)?(${N})[\\s-]*(months?|years?)(?:\\s+(?:periods?|terms?))?`,
      ),
    );
    if (multi) {
      const count = numberFromText(multi.m[1]!) ?? 1;
      const months = monthsFrom(numberFromText(multi.m[2]!) ?? 0, multi.m[3]!);
      if (months > 0)
        f = make(
          'renewal',
          { kind: 'OPTION', count, months, extensionsMonths: Array(count).fill(months) },
          `${count} x ${months} months (option)`,
          0.92,
          'PATTERN',
          multi.page,
          groupSpan(multi, 0),
        );
    } else if (opt) {
      const hasCount = opt.m.length === 4 && opt.m[3] !== undefined;
      const count = hasCount ? (numberFromText(opt.m[1]!) ?? 1) : 1;
      const months = hasCount
        ? monthsFrom(numberFromText(opt.m[2]!) ?? 0, opt.m[3]!)
        : monthsFrom(numberFromText(opt.m[1]!) ?? 0, opt.m[2]!);
      if (months > 0)
        f = make(
          'renewal',
          { kind: 'OPTION', count, months, extensionsMonths: Array(count).fill(months) },
          `${count} x ${months} months (option)`,
          0.9,
          'PATTERN',
          opt.page,
          groupSpan(opt, 0),
        );
    } else if (auto) {
      const months = monthsFrom(numberFromText(auto.m[1]!) ?? 0, auto.m[2]!);
      if (months > 0)
        f = make(
          'renewal',
          { kind: 'AUTO_RENEWAL', count: 1, months, extensionsMonths: [] },
          `Renews automatically for successive ${months}-month periods`,
          0.92,
          'PATTERN',
          auto.page,
          groupSpan(auto, 0),
        );
    }
    put(f ?? missing('renewal'));
  }

  // ---- termination for convenience (needed before the notice period, which may fall back to it)
  {
    const N = NUM_RE_SRC;
    const h = firstHit(
      pages,
      rx(
        `\\bterminate\\b[^.]{0,60}?\\bfor\\s+(?:its\\s+)?convenience(?:[^.]{0,80}?(?:by\\s+giving|on|with|upon|by\\s+providing)\\s+(?:the\\s+\\w+\\s+)?(?:not\\s+less\\s+than\\s+|at\\s+least\\s+)?(${N})\\s*(?:\\(\\d+\\)\\s*)?(days?|weeks?|months?)(?:'s)?\\s+(?:written\\s+)?notice)?`,
      ),
    );
    if (h) {
      const n = h.m[1] ? numberFromText(h.m[1]) : null;
      const noticeDays = n ? daysFrom(n, h.m[2]!) : null;
      const party = subjectParty(h.page.text.slice(Math.max(0, h.m.index - 80), h.m.index));
      put(
        make(
          'terminationConvenience',
          { present: true, party, noticeDays },
          `${party === 'EITHER' ? 'Either party' : party === 'CUSTOMER' ? 'Customer' : party === 'SUPPLIER' ? 'Supplier' : 'A party'} may terminate for convenience${noticeDays ? ` on ${noticeDays} days notice` : ''}`,
          0.92,
          'PATTERN',
          h.page,
          groupSpan(h, 0),
        ),
      );
    } else put(missing('terminationConvenience'));
  }

  // ---- notice period: to extend or not renew, else the termination notice
  {
    const N = NUM_RE_SRC;
    const tries: Array<[RegExp, boolean]> = [
      [
        rx(
          `(?:at\\s+least|not\\s+less\\s+than|no\\s+later\\s+than|not\\s+later\\s+than|minimum\\s+of)\\s+(${N})\\s*(?:\\(\\d+\\)\\s*)?(days?|weeks?|months?)(?:'s)?\\s+(?:before|prior\\s+to)\\s+(?:the\\s+)?(?:End\\s+Date|expiry|expiration|end\\s+of|expiration\\s+of)`,
        ),
        true,
      ],
      [
        rx(
          `(${N})\\s*(?:\\(\\d+\\)\\s*)?(days?|weeks?|months?)(?:'s)?\\s+(?:prior\\s+|written\\s+)*notice\\s+(?:before|prior\\s+to)\\s+(?:the\\s+)?(?:End\\s+Date|expiry|expiration|end\\s+of)`,
        ),
        true,
      ],
    ];
    let done = false;
    for (const [re] of tries) {
      const h = firstHit(pages, re);
      const n = h ? numberFromText(h.m[1]!) : null;
      if (h && n) {
        const days = daysFrom(n, h.m[2]!);
        const monthBased = /^month/i.test(h.m[2]!);
        put(
          make(
            'noticeDays',
            days,
            `${days} days`,
            monthBased ? 0.88 : 0.93,
            'PATTERN',
            h.page,
            groupSpan(h, 0),
            monthBased ? 'Months are counted as 30 days.' : undefined,
          ),
        );
        done = true;
        break;
      }
    }
    const tfc = out.terminationConvenience;
    const tfcDays = (tfc?.value as { noticeDays?: number | null } | null)?.noticeDays ?? null;
    if (!done && tfc?.status === 'EXTRACTED' && tfcDays) {
      put(
        make(
          'noticeDays',
          tfcDays,
          `${tfcDays} days`,
          0.72,
          'DERIVED',
          null,
          tfc.source,
          'No notice period for extension or non-renewal was written; the termination for convenience notice is used.',
          tfc.pageConfidence,
        ),
      );
      done = true;
    }
    if (!done)
      put(missing('noticeDays', 'No notice period found; 90 days is used when the record is created.'));
  }

  // ---- value and currency
  {
    const CUR = `((?:${CURRENCY_RE_SRC}\\s?){1,2})`;
    const AMT = AMOUNT_RE_SRC;
    const total = firstHit(
      pages,
      rx(
        `(?:total\\s+(?:contract\\s+)?(?:value|price|fees?|sum|amount|consideration|rent)|contract\\s+(?:value|price|sum)|aggregate\\s+(?:fees|value))\\b[^$\\n]{0,100}?${CUR}${AMT}`,
      ),
    );
    if (total) {
      const { currency, bare } = currencyFromToken(total.m[1]!);
      const amount = amountFromText(total.m[2]!, total.m[3]);
      if (amount !== null)
        put(
          make(
            'value',
            { amount, currency },
            MONEY(amount, currency),
            bare ? 0.93 : 0.96,
            'PATTERN',
            total.page,
            groupSpan(total, 0),
            bare ? 'The amount is written with $ only; Australian dollars are assumed.' : undefined,
          ),
        );
    }
    if (!out.value) {
      const per = firstHit(
        pages,
        rx(
          `(?:rent|fees?|charges?|price|subscription\\s+fees?|licen[cs]e\\s+fees?)\\b[^$\\n]{0,60}?${CUR}${AMT}\\s*(?:\\(excluding\\s+GST\\)\\s*)?(?:per|a|each|every|/)\\s*(annum|year|month|quarter)`,
        ),
      );
      const term = out.termMonths;
      if (per && term?.status === 'EXTRACTED') {
        const { currency, bare } = currencyFromToken(per.m[1]!);
        const unit = amountFromText(per.m[2]!, per.m[3]);
        const period = per.m[4]!.toLowerCase();
        const months = term.value as number;
        const periods = period === 'month' ? months : period === 'quarter' ? months / 3 : months / 12;
        if (unit !== null) {
          const amount = Math.round(unit * periods * 100) / 100;
          put(
            make(
              'value',
              { amount, currency },
              MONEY(amount, currency),
              bare ? 0.68 : 0.72,
              'DERIVED',
              null,
              groupSpan(per, 0),
              `Derived: ${MONEY(unit, currency)} per ${period} over ${months} months. No total was written.`,
              Math.min(per.page.confidence, term.confidence),
            ),
          );
        }
      }
    }
    if (!out.value) put(missing('value'));
  }

  // ---- payment terms
  {
    const N = NUM_RE_SRC;
    const h =
      firstHit(
        pages,
        rx(
          `\\b(?:pay|paid|payable|payment)\\b[^.]{0,80}?within\\s+(${N})\\s*(?:\\(\\d+\\)\\s*)?(?:calendar\\s+|business\\s+)?(days?)\\s+(?:of|after|from)\\s+(?:the\\s+)?(?:receipt|date|invoice|issue|receiving)`,
        ),
      ) ?? firstHit(pages, rx(`\\bpayment\\s+terms\\s*[:-]?\\s*(?:net\\s+)?(${N})\\s*(days?)`));
    const n = h ? numberFromText(h.m[1]!) : null;
    if (h && n) put(make('paymentTerms', n, `${n} days`, 0.93, 'PATTERN', h.page, groupSpan(h, 0)));
    else put(missing('paymentTerms'));
  }

  // ---- governing law
  {
    const h = firstHit(
      pages,
      rx(
        '\\bgoverned\\s+by\\s+(?:and\\s+construed\\s+in\\s+accordance\\s+with\\s+)?the\\s+laws?\\s+of\\s+(?:the\\s+(?:State|Commonwealth|Territory)\\s+of\\s+)?([A-Z][A-Za-z]+(?:\\s+[A-Z][A-Za-z]+){0,3}?)(?=\\s*[,.;]|\\s+and\\b|\\s*\\(|\\s+(?:Australia|including)\\b)',
        'i',
      ),
    );
    if (h)
      put(
        make('governingLaw', collapse(h.m[1]!), collapse(h.m[1]!), 0.95, 'PATTERN', h.page, groupSpan(h, 1)),
      );
    else put(missing('governingLaw'));
  }

  // ---- liability cap
  {
    const CUR = `((?:${CURRENCY_RE_SRC}\\s?){1,2})`;
    const N = NUM_RE_SRC;
    const fixed = firstHit(
      pages,
      rx(
        `\\bliab[^.]{0,200}?(?:limited|capped)\\s+(?:to|at)\\s+(?:an\\s+amount\\s+(?:of|equal\\s+to)\\s+)?${CUR}${AMOUNT_RE_SRC}`,
      ),
    );
    const fees = firstHit(
      pages,
      rx(
        `\\bliab[^.]{0,200}?(?:limited|capped)\\s+to\\s+(?:(${N})\\s+(?:times|x)\\s+)?(?:the\\s+)?(?:total\\s+)?(?:fees|charges|price|rent|contract\\s+(?:value|price))\\s+(?:paid\\s+or\\s+payable|paid|payable)(?:[^.]{0,60}?(${N})\\s+months)?`,
      ),
    );
    const unlimited = firstHit(
      pages,
      rx(
        '\\bliab[^.]{0,60}?\\b(?:is|are|will\\s+be|shall\\s+be)\\s+unlimited|\\bunlimited\\s+liab|\\bno\\s+limit(?:ation)?\\s+on\\s+(?:its\\s+|the\\s+)?liab',
      ),
    );
    if (fixed) {
      const { currency, bare } = currencyFromToken(fixed.m[1]!);
      const amount = amountFromText(fixed.m[2]!, fixed.m[3]);
      if (amount !== null)
        put(
          make(
            'liabilityCap',
            { basis: 'FIXED', amount, currency },
            `${MONEY(amount, currency)} (fixed cap)`,
            bare ? 0.9 : 0.94,
            'PATTERN',
            fixed.page,
            groupSpan(fixed, 0),
          ),
        );
    }
    if (!out.liabilityCap && fees) {
      const multiple = fees.m[1] ? (numberFromText(fees.m[1]) ?? 1) : 1;
      const months = fees.m[2] ? (numberFromText(fees.m[2]) ?? null) : null;
      put(
        make(
          'liabilityCap',
          { basis: months === 12 || months === null ? 'FEES_12_MONTHS' : 'FEES_PERIOD', multiple, months },
          `${multiple === 1 ? '' : `${multiple} x `}fees paid or payable${months ? ` in ${months} months` : ''}`,
          0.86,
          'PATTERN',
          fees.page,
          groupSpan(fees, 0),
        ),
      );
    }
    if (!out.liabilityCap && unlimited)
      put(
        make(
          'liabilityCap',
          { basis: 'UNLIMITED' },
          'Unlimited',
          0.88,
          'PATTERN',
          unlimited.page,
          groupSpan(unlimited, 0),
        ),
      );
    if (!out.liabilityCap) put(missing('liabilityCap'));
  }

  // ---- indemnity
  {
    const h = firstHit(pages, INDEMNITY_RE);
    if (h) {
      const ss = sentencesOf(h.page.text).find((s) => s.start <= h.m.index && s.end >= h.m.index);
      const text = ss?.text ?? h.m[0];
      const subj = subjectParty(text.slice(0, Math.max(0, h.m.index - (ss?.start ?? h.m.index))));
      const party = subj === 'EITHER' ? 'MUTUAL' : subj;
      put(
        make(
          'indemnity',
          { present: true, party },
          `${party === 'SUPPLIER' ? 'The Supplier indemnifies' : party === 'CUSTOMER' ? 'The Customer indemnifies' : party === 'MUTUAL' ? 'Mutual indemnity' : 'An indemnity is given'}`,
          0.9,
          'PATTERN',
          h.page,
          ss ? span(h.page, ss.start, ss.end) : groupSpan(h, 0),
        ),
      );
    } else put(missing('indemnity'));
  }

  // ---- service levels and KPIs: sentences that state a measurable level
  {
    const items: Array<{ text: string; span: Span; page: OcrPage }> = [];
    for (const page of pages)
      for (const s of sentencesOf(page.text)) {
        const measurable =
          /\d+(?:\.\d+)?\s*%|\bwithin\s+\d+\s*(?:hours?|minutes?|business\s+days?|days?)\b/i.test(s.text);
        const topic =
          /\b(availability|uptime|response|respond|resolve|resolution|KPIs?|key\s+performance|service\s+levels?|SLA)\b/i.test(
            s.text,
          );
        if (measurable && topic && items.length < 12)
          items.push({ text: collapse(s.text), span: span(page, s.start, s.end), page });
      }
    if (items.length)
      put({
        ...make(
          'serviceLevels',
          items.map((i) => i.text),
          `${items.length} service level statement${items.length === 1 ? '' : 's'}`,
          0.86,
          'PATTERN',
          items[0]!.page,
          items[0]!.span,
        ),
        extraSources: items.slice(1).map((i) => i.span),
      });
    else put(missing('serviceLevels'));
  }

  // ---- confidentiality
  {
    const h = firstHit(pages, rx('\\bconfidential(?:ity)?\\b|\\bnon-disclosure\\b'));
    if (h) {
      const ss = sentencesOf(h.page.text).find((s) => s.start <= h.m.index && s.end >= h.m.index);
      put(
        make(
          'confidentiality',
          { present: true },
          'Confidentiality obligation present',
          0.9,
          'PATTERN',
          h.page,
          ss ? span(h.page, ss.start, ss.end) : groupSpan(h, 0),
        ),
      );
    } else put(missing('confidentiality'));
  }

  // ---- data location
  {
    const h = firstHit(
      pages,
      rx(
        '\\b(?:stored|hosted|processed|held|located|resident|reside|retained|hosting)\\b[^.]{0,80}?\\b(?:in|within|inside|at)\\s+(?:the\\s+)?(Australia|United\\s+States(?:\\s+of\\s+America)?|USA|U\\.S\\.|US|Europe|European\\s+Union|EU|United\\s+Kingdom|UK|Singapore|New\\s+Zealand|Canada|Ireland|Germany|India)\\b',
      ),
    );
    if (h) {
      const raw = collapse(h.m[1]!);
      const loc = /^(usa|us|u\.s\.|united states(?: of america)?)$/i.test(raw)
        ? 'United States'
        : /^(uk)$/i.test(raw)
          ? 'United Kingdom'
          : /^eu$/i.test(raw)
            ? 'European Union'
            : raw;
      put(
        make(
          'dataLocation',
          { location: loc, inAustralia: /^australia$/i.test(loc) },
          `Data held in ${loc}`,
          0.9,
          'PATTERN',
          h.page,
          groupSpan(h, 0),
        ),
      );
    } else put(missing('dataLocation'));
  }

  // ---- insurance
  {
    const covers: Array<{ cover: string; amount: number; currency: string }> = [];
    const spans: Span[] = [];
    let first: OcrPage | null = null;
    const re = rx(
      `(public\\s+(?:and\\s+products\\s+)?liability|professional\\s+indemnity|cyber|workers'?\\s+compensation|product\\s+liability|contract\\s+works)(?:\\s+insurance)?(?:\\s+cover)?[^.$]{0,60}?(?:of|limit\\s+of)?\\s*(?:at\\s+least|not\\s+less\\s+than|minimum\\s+of)?\\s*((?:${CURRENCY_RE_SRC}\\s?){1,2})${AMOUNT_RE_SRC}`,
    );
    for (const h of allHits(pages, re)) {
      const amount = amountFromText(h.m[3]!, h.m[4]);
      if (amount === null) continue;
      const cover = collapse(h.m[1]!).replace(/^./, (c) => c.toUpperCase());
      covers.push({ cover, amount, currency: currencyFromToken(h.m[2]!).currency });
      spans.push(groupSpan(h, 0));
      first ??= h.page;
    }
    if (covers.length && first)
      put({
        ...make(
          'insurance',
          covers,
          covers.map((c) => `${c.cover} ${MONEY(c.amount, c.currency)}`).join('; '),
          0.92,
          'PATTERN',
          first,
          spans[0]!,
        ),
        extraSources: spans.slice(1),
      });
    else {
      const h = firstHit(pages, rx('\\binsurance\\b'));
      if (h) {
        const ss = sentencesOf(h.page.text).find((s) => s.start <= h.m.index && s.end >= h.m.index);
        put(
          make(
            'insurance',
            [],
            'Insurance required (no limits stated)',
            0.8,
            'PATTERN',
            h.page,
            ss ? span(h.page, ss.start, ss.end) : groupSpan(h, 0),
          ),
        );
      } else put(missing('insurance'));
    }
  }

  // make sure every field exists, in order
  for (const d of FIELD_DEFS) if (!out[d.key]) out[d.key] = missing(d.key);
  return out;
}

/** The display text of a typed value, used for corrections as well as extraction. */
export function displayOf(key: FieldKey, value: unknown): string {
  if (value === null || value === undefined) return '';
  switch (key) {
    case 'value': {
      const v = value as { amount: number; currency: string };
      return MONEY(v.amount, v.currency);
    }
    case 'termMonths':
      return `${value as number} months`;
    case 'noticeDays':
    case 'paymentTerms':
      return `${value as number} days`;
    case 'supplierAbn':
      return String(value).replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3 $4');
    case 'renewal': {
      const v = value as { kind: string; count: number; months: number };
      return v.kind === 'AUTO_RENEWAL'
        ? `Renews automatically for successive ${v.months}-month periods`
        : `${v.count} x ${v.months} months (option)`;
    }
    case 'liabilityCap': {
      const v = value as {
        basis: string;
        amount?: number;
        currency?: string;
        multiple?: number;
        months?: number | null;
      };
      if (v.basis === 'FIXED') return `${MONEY(v.amount ?? 0, v.currency ?? 'AUD')} (fixed cap)`;
      if (v.basis === 'UNLIMITED') return 'Unlimited';
      return `${v.multiple && v.multiple !== 1 ? `${v.multiple} x ` : ''}fees paid or payable${v.months ? ` in ${v.months} months` : ''}`;
    }
    case 'indemnity':
      return (value as { present: boolean }).present ? 'Indemnity present' : 'No indemnity';
    case 'terminationConvenience': {
      const v = value as { present: boolean; noticeDays?: number | null };
      return v.present
        ? `Termination for convenience${v.noticeDays ? ` on ${v.noticeDays} days notice` : ''}`
        : 'None';
    }
    case 'confidentiality':
      return (value as { present: boolean }).present ? 'Confidentiality obligation present' : 'None';
    case 'serviceLevels': {
      const v = value as string[];
      return `${v.length} service level statement${v.length === 1 ? '' : 's'}`;
    }
    case 'dataLocation':
      return `Data held in ${(value as { location: string }).location}`;
    case 'insurance': {
      const v = value as Array<{ cover: string; amount: number; currency: string }>;
      return v.length
        ? v.map((c) => `${c.cover} ${MONEY(c.amount, c.currency)}`).join('; ')
        : 'Insurance required (no limits stated)';
    }
    default:
      return String(value);
  }
}

/** Marks which fields must be reviewed: required fields not found, and found fields below the threshold, until reviewed. */
export function applyReviewRules(fields: ExtractedField[], threshold: number): ExtractedField[] {
  return fields.map((f) => {
    let needs = false;
    let reason: string | undefined;
    if (!f.reviewed) {
      if (f.status === 'NOT_FOUND' && f.required) {
        needs = true;
        reason = 'Required for the contract record and not found: enter it.';
      } else if (f.status === 'EXTRACTED' && f.confidence < threshold) {
        needs = true;
        reason = `Confidence ${Math.round(f.confidence * 100)}% is below the review threshold of ${Math.round(threshold * 100)}%.`;
      }
    }
    const { reviewReason: _drop, ...rest } = f;
    void _drop;
    return { ...rest, needsReview: needs, ...(reason ? { reviewReason: reason } : {}) };
  });
}
