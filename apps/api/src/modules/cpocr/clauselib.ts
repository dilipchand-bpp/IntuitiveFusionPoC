/**
 * The clause library used to read contracts (CP-07): clause types with keywords to find them and the standard wording to compare
 * with. The defaults below are built on the standard services wording the platform drafts from (modules/contract/clauses.ts);
 * a tenant can replace the library (PUT /contract-ingest/clause-library). Detection finds the paragraph that best matches the
 * keywords, trims it to the sentences that matter, and scores its similarity to the standard wording.
 */
import { SERVICES_TEMPLATE } from '../contract/clauses.js';
import { sentencesOf } from './extract.js';
import { collapse, similarity } from './text.js';
import type {
  ClauseMatch,
  DetectedClause,
  ExtractedField,
  FieldMap,
  Finding,
  LibraryClause,
  OcrPage,
  Span,
} from './types.js';

/** Words of the standard wording with the drafting placeholders filled by neutral terms. */
const plain = (text: string) =>
  text
    .replace(/\{\{CUSTOMER\}\}/g, 'the Customer')
    .replace(/\{\{SUPPLIER\}\}/g, 'the Supplier')
    .replace(/\{\{[A-Z_]+\}\}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
const standard = (id: string) => plain(SERVICES_TEMPLATE.clauses.find((c) => c.id === id)?.text ?? '');

export const DEFAULT_LIBRARY: LibraryClause[] = [
  {
    key: 'PARTIES',
    title: 'Parties',
    mandatory: true,
    risk: 'LOW',
    keywords: [
      'made between',
      'entered into between',
      '(the customer)',
      '(the supplier)',
      '(the licensor)',
      '(the licensee)',
      'the parties are',
    ],
    standardText: standard('PARTIES') || 'This agreement is made between the Customer and the Supplier.',
    active: true,
  },
  {
    key: 'TERM',
    title: 'Term',
    mandatory: true,
    risk: 'MEDIUM',
    keywords: [
      'commences on',
      'commencement date',
      'end date',
      'ends on',
      'expires on',
      'initial term',
      'subscription term',
      'continues until',
      'term of',
    ],
    standardText: standard('TERM'),
    active: true,
  },
  {
    key: 'RENEWAL',
    title: 'Renewal and extension',
    mandatory: false,
    risk: 'MEDIUM',
    keywords: [
      'renew',
      'renewal',
      'extend the term',
      'option to extend',
      'further term',
      'further periods',
      'automatically',
    ],
    standardText:
      'The Customer may extend the term for further periods by giving the Supplier written notice before the end date.',
    active: true,
  },
  {
    key: 'PRICE',
    title: 'Price',
    mandatory: true,
    risk: 'MEDIUM',
    keywords: [
      'total contract value',
      'contract value',
      'contract sum',
      'total fees',
      'fees',
      'rent',
      'price',
      'excluding gst',
    ],
    standardText: standard('PRICE'),
    active: true,
  },
  {
    key: 'PAYMENT',
    title: 'Payment terms',
    mandatory: true,
    risk: 'LOW',
    keywords: ['valid invoice', 'invoice', 'payable within', 'pay each', 'payment', 'paid within'],
    standardText: 'The Customer will pay each valid invoice within 30 days of receipt.',
    active: true,
  },
  {
    key: 'SLA',
    title: 'Service levels',
    mandatory: false,
    risk: 'MEDIUM',
    keywords: [
      'service level',
      'service levels',
      'availability',
      'uptime',
      'response time',
      'kpi',
      'key performance',
      'service credit',
    ],
    standardText: standard('SLA') || 'The Supplier will meet the service levels set out in this agreement.',
    active: true,
  },
  {
    key: 'TERMINATION',
    title: 'Termination',
    mandatory: true,
    risk: 'HIGH',
    keywords: ['terminate', 'termination', 'material breach', 'remedied'],
    standardText: standard('TERMINATION'),
    active: true,
  },
  {
    key: 'TERMINATION_CONVENIENCE',
    title: 'Termination for convenience',
    mandatory: true,
    risk: 'HIGH',
    keywords: ['for convenience', 'without cause', 'without reason'],
    standardText:
      'The Customer may terminate this agreement for convenience by giving the Supplier written notice.',
    active: true,
  },
  {
    key: 'IP',
    title: 'Intellectual property',
    mandatory: false,
    risk: 'MEDIUM',
    keywords: ['intellectual property', 'copyright', 'moral rights', 'pre-existing'],
    standardText: standard('IP'),
    active: true,
  },
  {
    key: 'CONFIDENTIALITY',
    title: 'Confidentiality and privacy',
    mandatory: true,
    risk: 'MEDIUM',
    keywords: ['confidential', 'confidentiality', 'privacy', 'non-disclosure'],
    standardText: standard('CONFIDENTIALITY'),
    active: true,
  },
  {
    key: 'LIABILITY',
    title: 'Limitation of liability',
    mandatory: true,
    risk: 'HIGH',
    keywords: [
      'limitation of liability',
      'total liability',
      'aggregate liability',
      'liability cap',
      'liability is limited',
      'liability under this',
    ],
    standardText:
      'The total aggregate liability of the Supplier under this agreement is limited to an amount not less than the total contract value.',
    active: true,
  },
  {
    key: 'INDEMNITY',
    title: 'Indemnity',
    mandatory: true,
    risk: 'HIGH',
    keywords: ['indemnifies', 'indemnify', 'indemnified', 'hold harmless'],
    standardText:
      'The Supplier indemnifies the Customer against loss arising from the negligence of the Supplier or its breach of this agreement.',
    active: true,
  },
  {
    key: 'INSURANCE',
    title: 'Insurance',
    mandatory: true,
    risk: 'MEDIUM',
    keywords: [
      'insurance',
      'insured',
      'public liability',
      'professional indemnity',
      'certificate of currency',
    ],
    standardText:
      'The Supplier holds public liability and professional indemnity insurance appropriate to the services for the whole term, and provides a current certificate on request.',
    active: true,
  },
  {
    key: 'GOVERNING_LAW',
    title: 'Governing law',
    mandatory: true,
    risk: 'LOW',
    keywords: ['governed by', 'laws of', 'jurisdiction', 'courts of'],
    standardText:
      'This agreement is governed by the laws of an Australian State or Territory, and the parties submit to the jurisdiction of its courts.',
    active: true,
  },
  {
    key: 'DATA_LOCATION',
    title: 'Data location',
    mandatory: false,
    risk: 'HIGH',
    keywords: [
      'data location',
      'data sovereignty',
      'hosted in',
      'hosted within',
      'stored within',
      'stored in',
      'stored and processed',
      'data centre',
      'offshore',
      'onshore',
    ],
    standardText: 'All Customer data must be stored and processed within Australia.',
    active: true,
  },
];

// ------------------------------------------------------------------ detection

interface Para {
  page: number;
  start: number;
  end: number;
  text: string;
  /** The heading line ("Termination"), when the block starts with one. */
  heading: string;
  /** Where the body starts (after a heading line of its own). */
  bodyStart: number;
}

const HEADING_LINE = /^\s*(?:\d+\.\d+(?:\.\d+)*\.?|\d+\.|[A-Z]\.|Schedule\s+\d+)\s+\S/;
const SHOUT_LINE = /^[A-Z][A-Z0-9 &/,'-]{2,50}$/;

/** Paragraphs of a page: numbered clauses, all-capital headings and blank-line blocks; long unbroken text is cut into sentence groups. */
export function paragraphsOf(page: OcrPage): Para[] {
  const lines: Array<{ start: number; end: number; text: string }> = [];
  let idx = 0;
  for (const l of page.text.split('\n')) {
    lines.push({ start: idx, end: idx + l.length, text: l });
    idx += l.length + 1;
  }
  const blocks: Array<{ start: number; end: number; heading: boolean; firstEnd: number }> = [];
  let cur: (typeof blocks)[number] | null = null;
  for (const l of lines) {
    const blank = l.text.trim() === '';
    const heading = !blank && (HEADING_LINE.test(l.text) || SHOUT_LINE.test(l.text.trim()));
    if (blank) {
      if (cur) blocks.push(cur);
      cur = null;
    } else if (heading) {
      if (cur) blocks.push(cur);
      cur = { start: l.start, end: l.end, heading: true, firstEnd: l.end };
    } else if (cur) cur.end = l.end;
    else cur = { start: l.start, end: l.end, heading: false, firstEnd: l.end };
  }
  if (cur) blocks.push(cur);
  const out: Para[] = [];
  for (const b of blocks) {
    const text = page.text.slice(b.start, b.end);
    const first = page.text.slice(b.start, b.firstEnd);
    const title = collapse(first.replace(/^\s*(?:\d+\.\d+(?:\.\d+)*\.?|\d+\.|[A-Z]\.)\s+/, ''));
    const hasHeading = b.heading && title.length <= 60 && b.firstEnd < b.end;
    if (text.length > 1200 && !b.heading) {
      const ss = sentencesOf(text, b.start);
      for (let i = 0; i < ss.length; i += 3) {
        const grp = ss.slice(i, i + 3);
        out.push({
          page: page.page,
          start: grp[0]!.start,
          end: grp.at(-1)!.end,
          text: page.text.slice(grp[0]!.start, grp.at(-1)!.end),
          heading: '',
          bodyStart: grp[0]!.start,
        });
      }
    } else
      out.push({
        page: page.page,
        start: b.start,
        end: b.end,
        text,
        heading: hasHeading ? title : '',
        bodyStart: hasHeading ? b.firstEnd + 1 : b.start,
      });
  }
  return out;
}

const hasKeyword = (text: string, kw: string) => {
  const esc = kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![a-z])${esc}(?![a-z])`, 'i').test(text);
};

export const STANDARD_AT = 0.45;
export const MINOR_AT = 0.25;

export function matchOf(sim: number): ClauseMatch {
  return sim >= STANDARD_AT ? 'STANDARD' : sim >= MINOR_AT ? 'MINOR_DEVIATION' : 'MATERIAL_DEVIATION';
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function detectClauses(pages: OcrPage[], library: LibraryClause[]): DetectedClause[] {
  const paras = pages.flatMap(paragraphsOf);
  const pageConf = new Map(pages.map((p) => [p.page, p.confidence]));
  const pageText = new Map(pages.map((p) => [p.page, p.text]));
  return library
    .filter((c) => c.active)
    .map((c): DetectedClause => {
      let best: { para: Para; hits: number; heading: boolean; len: number } | null = null;
      for (const para of paras) {
        const body = para.text;
        const hits = c.keywords.filter((k) => hasKeyword(body, k)).length;
        if (hits === 0) continue;
        const heading = c.keywords.some((k) => para.heading && hasKeyword(para.heading, k));
        const score = hits + (heading ? 2 : 0);
        const prevScore = best ? best.hits + (best.heading ? 2 : 0) : -1;
        if (score > prevScore || (score === prevScore && para.text.length < best!.len))
          best = { para, hits, heading, len: para.text.length };
      }
      if (!best)
        return {
          key: c.key,
          title: c.title,
          mandatory: c.mandatory,
          risk: c.risk,
          found: false,
          similarity: null,
          match: null,
          confidence: 0,
          heading: null,
          source: null,
          text: null,
          standardText: c.standardText,
        };
      // trim to the sentences that carry a keyword, so a paragraph that covers two topics gives each its own wording
      const bodyText = pageText.get(best.para.page)!.slice(best.para.bodyStart, best.para.end);
      const ss = sentencesOf(bodyText, best.para.bodyStart).filter((s) =>
        c.keywords.some((k) => hasKeyword(s.text, k)),
      );
      let start = best.para.bodyStart;
      let end = best.para.end;
      if (ss.length) {
        start = ss[0]!.start;
        end = ss.at(-1)!.end;
      }
      const raw = pageText.get(best.para.page)!.slice(start, end);
      const text = collapse(raw.replace(/^\s*\d+(?:\.\d+)*\.?\s+/, ''));
      const sim = similarity(text, c.standardText);
      const conf =
        Math.min(0.95, 0.6 + 0.1 * Math.min(3, best.hits) + (best.heading ? 0.1 : 0)) *
        (pageConf.get(best.para.page) ?? 1);
      const source: Span = { page: best.para.page, start, end, text: text.slice(0, 400) };
      return {
        key: c.key,
        title: c.title,
        mandatory: c.mandatory,
        risk: c.risk,
        found: true,
        similarity: sim,
        match: matchOf(sim),
        confidence: r3(conf),
        heading: best.para.heading || null,
        source,
        text,
        standardText: c.standardText,
      };
    });
}

// ------------------------------------------------------------------ findings

const AU_PLACES =
  /^(new south wales|nsw|victoria|vic|queensland|qld|western australia|wa|south australia|sa|tasmania|tas|australian capital territory|act|northern territory|nt|commonwealth|australia)$/i;

const SEV_BY_RISK = { HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW' } as const;

export function buildFindings(fields: FieldMap, clauses: DetectedClause[], today: string): Finding[] {
  const out: Finding[] = [];
  const val = <T>(k: keyof FieldMap): T | null => {
    const f = fields[k];
    return f && f.status !== 'NOT_FOUND' ? (f.value as T) : null;
  };
  const src = (k: keyof FieldMap) => fields[k]?.source ?? null;

  for (const c of clauses) {
    if (!c.found) {
      if (c.mandatory)
        out.push({
          code: 'MISSING_MANDATORY_CLAUSE',
          severity: SEV_BY_RISK[c.risk],
          clauseKey: c.key,
          message: `Mandatory clause missing: ${c.title}. No wording matching this clause was found.`,
        });
      else
        out.push({
          code: 'MISSING_OPTIONAL_CLAUSE',
          severity: 'INFO',
          clauseKey: c.key,
          message: `No ${c.title.toLowerCase()} clause was found (optional in the library).`,
        });
    } else if (c.match && c.match !== 'STANDARD')
      out.push({
        code: 'CLAUSE_DEVIATION',
        severity: c.match === 'MATERIAL_DEVIATION' && c.risk === 'HIGH' ? 'MEDIUM' : 'LOW',
        clauseKey: c.key,
        message: `${c.title}: the wording is ${Math.round((c.similarity ?? 0) * 100)}% similar to the standard wording (${c.match === 'MATERIAL_DEVIATION' ? 'material' : 'minor'} deviation).`,
        source: c.source,
      });
  }

  const start = val<string>('effectiveDate');
  const end = val<string>('endDate');
  if (start && end && end <= start)
    out.push({
      code: 'DATE_ORDER',
      severity: 'HIGH',
      fieldKey: 'endDate',
      message: 'The end date is not after the effective date.',
      source: src('endDate'),
    });
  if (end && end < today)
    out.push({
      code: 'ALREADY_ENDED',
      severity: 'INFO',
      fieldKey: 'endDate',
      message: `The contract ended on ${end}; no reminders will be sent for dates already past.`,
      source: src('endDate'),
    });

  const abn = fields.supplierAbn;
  if (abn?.status === 'EXTRACTED' && abn.ruleConfidence < 0.6)
    out.push({
      code: 'ABN_INVALID',
      severity: 'MEDIUM',
      fieldKey: 'supplierAbn',
      message: 'The supplier ABN does not pass the ABN check.',
      source: abn.source,
    });

  const law = val<string>('governingLaw');
  if (law && !AU_PLACES.test(law.trim()))
    out.push({
      code: 'GOVERNING_LAW_OFFSHORE',
      severity: 'MEDIUM',
      fieldKey: 'governingLaw',
      message: `Governed by the law of ${law}, which is not an Australian jurisdiction.`,
      source: src('governingLaw'),
    });

  const loc = val<{ location: string; inAustralia: boolean }>('dataLocation');
  if (loc && !loc.inAustralia)
    out.push({
      code: 'DATA_OFFSHORE',
      severity: 'HIGH',
      fieldKey: 'dataLocation',
      message: `Customer data is held in ${loc.location}, outside Australia.`,
      source: src('dataLocation'),
    });

  const pay = val<number>('paymentTerms');
  if (pay && pay > 30)
    out.push({
      code: 'PAYMENT_TERMS_LONG',
      severity: 'LOW',
      fieldKey: 'paymentTerms',
      message: `Payment terms are ${pay} days; the standard is 30 days.`,
      source: src('paymentTerms'),
    });

  const cap = val<{ basis: string; amount?: number; multiple?: number }>('liabilityCap');
  const value = val<{ amount: number; currency: string }>('value');
  const term = val<number>('termMonths');
  const liab = clauses.find((c) => c.key === 'LIABILITY');
  if (cap && value) {
    let est: number | null = null;
    if (cap.basis === 'FIXED') est = cap.amount ?? null;
    else if (cap.basis === 'FEES_12_MONTHS' && term && term > 0)
      est = ((value.amount * 12) / term) * (cap.multiple ?? 1);
    if (est !== null && est < value.amount)
      out.push({
        code: 'LIABILITY_CAP_LOW',
        severity: 'MEDIUM',
        fieldKey: 'liabilityCap',
        message: `The liability cap (about ${Math.round(est).toLocaleString('en-AU')}) is below the contract value (${value.amount.toLocaleString('en-AU')}).`,
        source: src('liabilityCap'),
      });
  } else if (!cap && liab?.found)
    out.push({
      code: 'LIABILITY_CAP_NOT_STATED',
      severity: 'MEDIUM',
      fieldKey: 'liabilityCap',
      message: 'A liability clause was found but no cap amount could be read from it.',
      source: liab.source,
    });

  const ren = val<{ kind: string; months: number }>('renewal');
  const notice = val<number>('noticeDays');
  if (ren?.kind === 'AUTO_RENEWAL')
    out.push({
      code: 'AUTO_RENEWAL',
      severity: 'MEDIUM',
      fieldKey: 'renewal',
      message: `The contract renews automatically for ${ren.months} months unless notice is given${notice ? ` ${notice} days before the end date` : ''}.`,
      source: src('renewal'),
    });

  const tfc = val<{ party: string }>('terminationConvenience');
  if (tfc && tfc.party === 'SUPPLIER')
    out.push({
      code: 'TFC_SUPPLIER_ONLY',
      severity: 'MEDIUM',
      fieldKey: 'terminationConvenience',
      message: 'Only the supplier may terminate for convenience.',
      source: src('terminationConvenience'),
    });
  return out;
}

export const countsBySeverity = (f: Finding[]) => ({
  HIGH: f.filter((x) => x.severity === 'HIGH').length,
  MEDIUM: f.filter((x) => x.severity === 'MEDIUM').length,
  LOW: f.filter((x) => x.severity === 'LOW').length,
  INFO: f.filter((x) => x.severity === 'INFO').length,
});

export type { ExtractedField };
