/**
 * Roadmap batch B8: the rules behind response schedules, insurance certificate reading, duplicate supplier detection,
 * ratings, supplier risk and ESG scoring, lessons-learned recall and plain-language legal edits. Pure functions, so every
 * rule can be tested without a database. Anything that stands in for an AI model or an outside service is labelled
 * `B8_MODEL` and has a swap point (docs/swap-points.md).
 */
import { bankFingerprint } from '../b11audit/bank-fp.js';

export const B8_MODEL = 'rules-simulated-v1';

// ------------------------------------------------------------------ FR-0130 response schedules

export const ITEM_KINDS = ['TEXT', 'NUMBER', 'CHOICE', 'YESNO', 'DATE'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
export interface ScheduleItem {
  key: string;
  label: string;
  section: 'TECHNICAL' | 'COMMERCIAL';
  kind: ItemKind;
  required: boolean;
  options: string[];
  unit: string | null;
  maxLength: number | null;
}

/** Checks one answer against the question that was asked. Returns the cleaned value, or the reason it is not acceptable. */
export function checkAnswer(
  item: ScheduleItem,
  raw: string,
): { ok: true; value: string } | { ok: false; message: string } {
  const v = raw.trim();
  if (v === '')
    return { ok: false, message: 'Give an answer, or leave this question out until you have one' };
  switch (item.kind) {
    case 'NUMBER': {
      const n = Number(v.replace(/[$,\s]/g, ''));
      if (!Number.isFinite(n)) return { ok: false, message: 'Enter a number' };
      if (n < 0) return { ok: false, message: 'Enter zero or more' };
      return { ok: true, value: String(n) };
    }
    case 'YESNO':
      return /^(yes|no)$/i.test(v)
        ? { ok: true, value: v.toLowerCase() === 'yes' ? 'yes' : 'no' }
        : { ok: false, message: 'Answer yes or no' };
    case 'CHOICE':
      return item.options.includes(v)
        ? { ok: true, value: v }
        : { ok: false, message: `Choose one of: ${item.options.join(', ')}` };
    case 'DATE':
      return /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v
        ? { ok: true, value: v }
        : { ok: false, message: 'Enter a real date as YYYY-MM-DD' };
    default:
      return item.maxLength && v.length > item.maxLength
        ? { ok: false, message: `Keep this to ${item.maxLength} characters or fewer` }
        : { ok: true, value: v };
  }
}

/** Required questions without an answer. A bid with any of these cannot be submitted. */
export const missingAnswers = (items: ScheduleItem[], answers: Record<string, string>) =>
  items.filter((i) => i.required && !(answers[i.key] ?? '').trim());

// ------------------------------------------------------------------ FR-0185 insurance certificates

export interface CertificateReading {
  insurer: string | null;
  policyNumber: string | null;
  coverAud: number | null;
  expiresOn: string | null;
  /** 0 to 1: how many of the four things were found. */
  confidence: number;
  readable: boolean;
  notes: string[];
}
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function toIso(s: string): string | null {
  let m = /(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})/.exec(s);
  if (m) {
    const mo = MONTHS.indexOf(m[2]!.toLowerCase());
    if (mo >= 0) return `${m[3]}-${String(mo + 1).padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  }
  m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  return null;
}

/**
 * Reads the policy limit and expiry out of the text of a certificate (a stand-in for optical character recognition: it
 * reads the text layer of a document, it does not look at pictures). A certificate it cannot read is reported as such, and
 * the supplier is asked to enter the details by hand, which is never treated as verified.
 */
export function readCertificate(bytes: Uint8Array): CertificateReading {
  const text = Buffer.from(bytes)
    .toString('latin1')
    .replace(/[^\x20-\x7e\r\n]/g, ' ');
  const notes: string[] = [];
  let cover: number | null = null;
  const c =
    /(public (?:and products )?liability|professional indemnity|limit of liability|sum insured|cover(?:age)?(?: limit)?|policy limit)[^0-9$\r\n]{0,40}\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(million|mil|m|k|thousand)?/i.exec(
      text,
    );
  if (c) {
    let n = Number(c[2]!.replace(/,/g, ''));
    const unit = (c[3] ?? '').toLowerCase();
    if (unit === 'million' || unit === 'mil' || unit === 'm') n *= 1_000_000;
    else if (unit === 'k' || unit === 'thousand') n *= 1_000;
    cover = n;
  } else notes.push('No policy limit found');
  let expiresOn: string | null = null;
  const e =
    /(expiry(?: date)?|expires(?: on)?|period of insurance to|valid until|to)[^0-9\r\n]{0,20}(\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]{3,9}\.?,?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4})/i.exec(
      text,
    );
  if (e) expiresOn = toIso(e[2]!);
  if (!expiresOn) notes.push('No expiry date found');
  const insurer = /insurer[:\s]+([^\r\n]{3,60})/i.exec(text)?.[1]?.trim() ?? null;
  const policy = /policy (?:number|no\.?)[:\s#]+([A-Za-z0-9-]{4,30})/i.exec(text)?.[1] ?? null;
  const found = [cover !== null, expiresOn !== null, insurer !== null, policy !== null].filter(
    Boolean,
  ).length;
  return {
    insurer,
    policyNumber: policy,
    coverAud: cover,
    expiresOn,
    confidence: found / 4,
    readable: cover !== null && expiresOn !== null,
    notes,
  };
}

/** Does this supplier's cover meet what the tender requires, today? */
export function coverCheck(
  required: number | null,
  held: { coverAud: number | null; expiresOn: string | null } | null,
  today: string,
): { ok: boolean; reason: string | null } {
  if (!required) return { ok: true, reason: null };
  if (!held || held.coverAud === null)
    return { ok: false, reason: 'No insurance cover is recorded for your company' };
  if (!held.expiresOn || held.expiresOn <= today) return { ok: false, reason: 'Your insurance has expired' };
  if (held.coverAud < required)
    return {
      ok: false,
      reason: `Your cover of ${held.coverAud.toLocaleString('en-AU')} is below the ${required.toLocaleString('en-AU')} this tender requires`,
    };
  return { ok: true, reason: null };
}

// ------------------------------------------------------------------ FR-0795 duplicate suppliers

const NOISE = new Set([
  'pty',
  'ltd',
  'limited',
  'proprietary',
  'inc',
  'llc',
  'co',
  'company',
  'the',
  'and',
  'of',
  'group',
  'australia',
]);
export const normaliseName = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !NOISE.has(w))
    .join(' ');

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length]!;
}
export function nameSimilarity(a: string, b: string): number {
  const x = normaliseName(a);
  const y = normaliseName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const edit = 1 - levenshtein(x, y) / Math.max(x.length, y.length);
  const ta = new Set(x.split(' '));
  const tb = new Set(y.split(' '));
  const common = [...ta].filter((t) => tb.has(t)).length;
  const jaccard = common / new Set([...ta, ...tb]).size;
  return Math.max(edit, jaccard);
}

export interface SupplierLite {
  id: string;
  company: string;
  abn: string;
  bank?: { bsb?: string; account?: string } | null;
  /** A hash of the bank digits (SEC-AC10): duplicate detection compares this, so the numbers themselves need not be passed around. */
  bankFp?: string | null;
  location?: { city?: string; state?: string } | null;
}
export interface DuplicatePair {
  a: SupplierLite;
  b: SupplierLite;
  score: number;
  reasons: string[];
}
const digits = (s: string | undefined | null) => (s ?? '').replace(/\D/g, '');

/** Pairs of suppliers that look like the same business. A shared ABN or bank account is near certain; similar names are a prompt to look. */
export function findDuplicates(
  list: SupplierLite[],
  dismissed: Set<string>,
  threshold = 0.84,
): DuplicatePair[] {
  const out: DuplicatePair[] = [];
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]!;
      const b = list[j]!;
      const key = [a.id, b.id].sort().join('|');
      if (dismissed.has(key)) continue;
      const reasons: string[] = [];
      let score = 0;
      if (digits(a.abn) && digits(a.abn) === digits(b.abn)) {
        reasons.push('Same ABN');
        score = 1;
      }
      const ba = a.bankFp ?? bankFingerprint(a.bank) ?? '';
      const bb = b.bankFp ?? bankFingerprint(b.bank) ?? '';
      if (ba !== '' && ba === bb) {
        reasons.push('Same bank account');
        score = Math.max(score, 0.98);
      }
      const sim = nameSimilarity(a.company, b.company);
      if (sim >= threshold) {
        reasons.push(
          sim === 1
            ? 'Same name apart from Pty Ltd and similar words'
            : `Similar name (${Math.round(sim * 100)}% alike)`,
        );
        score = Math.max(score, sim);
      } else if (
        sim >= 0.6 &&
        a.location?.city &&
        a.location.city === b.location?.city &&
        a.location.state === b.location?.state
      ) {
        reasons.push('Alike name in the same city');
        score = Math.max(score, 0.7);
      }
      if (reasons.length) out.push({ a, b, score: Math.round(score * 100) / 100, reasons });
    }
  return out.sort((p, q) => q.score - p.score);
}

// ------------------------------------------------------------------ FR-0790 ratings

export const RATING_DIMENSIONS = {
  ENTERPRISE_RATES_SUPPLIER: ['quality', 'delivery', 'communication', 'value', 'compliance'],
  SUPPLIER_RATES_ENTERPRISE: ['payment', 'clarity', 'communication', 'fairness'],
} as const;
export type RatingDirection = keyof typeof RATING_DIMENSIONS;

export function overallRating(scores: Record<string, number>): number {
  const v = Object.values(scores);
  return v.length ? Math.round((v.reduce((s, n) => s + n, 0) / v.length) * 100) / 100 : 0;
}
export const ratingBand = (n: number) =>
  n >= 4.25 ? 'EXCELLENT' : n >= 3.5 ? 'GOOD' : n >= 2.5 ? 'FAIR' : 'POOR';

// ------------------------------------------------------------------ FR-0800 supplier risk, resilience and ESG

export interface EsgData {
  carbonTonnesCo2e?: number | null;
  renewablePct?: number | null;
  diversityOwned?: 'NONE' | 'INDIGENOUS' | 'WOMEN' | 'DISABILITY' | 'SOCIAL_ENTERPRISE' | null;
  modernSlaveryStatement?: boolean | null;
  lastModernSlaveryCheck?: string | null;
  modernSlaveryResult?: 'CLEAR' | 'REVIEW' | null;
}
export interface RiskInputs {
  ratingAvg: number | null;
  ratingCount: number;
  sanctions: 'PENDING' | 'CLEAR' | 'MATCH';
  insurance: 'UNKNOWN' | 'CURRENT' | 'EXPIRING' | 'EXPIRED';
  signals: Array<{ kind: string; level: 'LOW' | 'MEDIUM' | 'HIGH'; note: string }>;
  flaggedOnboarding: number;
  esg: EsgData;
  /** Share (0 to 1) of all committed spend that goes to this supplier. */
  spendShare: number;
  hasCyberAnswer: boolean | null;
  today: string;
}
export interface RiskFactor {
  key: string;
  label: string;
  /** 0 (worst) to 100 (best). */
  score: number;
  weight: number;
  note: string;
}
const HIGH_RISK_CATEGORIES = /clean|security|construction|garment|agricultur|mining|labour|catering|textile/i;

/** The modern slavery screen: a supplier in a higher-risk category with no statement is sent for review. */
export function modernSlaverySignal(categories: string[], esg: EsgData): 'CLEAR' | 'REVIEW' {
  const risky = categories.some((c) => HIGH_RISK_CATEGORIES.test(c));
  return risky && !esg.modernSlaveryStatement ? 'REVIEW' : 'CLEAR';
}

export function scoreSupplier(i: RiskInputs): {
  score: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  factors: RiskFactor[];
  recommendations: string[];
} {
  const lvl = (l: string) => (l === 'HIGH' ? 20 : l === 'MEDIUM' ? 60 : 100);
  const sig = (k: string) => i.signals.find((s) => s.kind === k);
  const f: RiskFactor[] = [];
  const recs: string[] = [];
  f.push({
    key: 'performance',
    label: 'Performance',
    weight: 0.2,
    score: i.ratingAvg === null ? 60 : Math.round(((i.ratingAvg - 1) / 4) * 100),
    note:
      i.ratingAvg === null
        ? 'No ratings yet'
        : `${i.ratingAvg.toFixed(1)} out of 5 from ${i.ratingCount} rating(s)`,
  });
  if (i.ratingAvg !== null && i.ratingAvg < 3)
    recs.push('Performance is poor: agree an improvement plan before awarding more work');
  const fin = sig('FINANCIAL');
  f.push({
    key: 'financial',
    label: 'Financial health',
    weight: 0.15,
    score: fin ? lvl(fin.level) : 60,
    note: fin?.note ?? 'No financial signal',
  });
  if (fin?.level === 'HIGH')
    recs.push('Financial distress signalled: ask for recent accounts and consider a guarantee');
  const geo = sig('GEOPOLITICAL');
  f.push({
    key: 'geopolitical',
    label: 'Geopolitical exposure',
    weight: 0.1,
    score: geo ? lvl(geo.level) : 100,
    note: geo?.note ?? 'No exposure signalled',
  });
  const wx = sig('WEATHER');
  f.push({
    key: 'disruption',
    label: 'Operational disruption',
    weight: 0.1,
    score: wx ? lvl(wx.level) : 100,
    note: wx?.note ?? 'No disruption signalled',
  });
  const comp =
    i.sanctions === 'MATCH'
      ? 0
      : (i.sanctions === 'PENDING' ? 50 : 100) -
        (i.insurance === 'EXPIRED'
          ? 50
          : i.insurance === 'EXPIRING'
            ? 20
            : i.insurance === 'UNKNOWN'
              ? 30
              : 0) -
        Math.min(30, i.flaggedOnboarding * 15);
  f.push({
    key: 'compliance',
    label: 'Compliance',
    weight: 0.2,
    score: Math.max(0, comp),
    note: `Sanctions ${i.sanctions.toLowerCase()}, insurance ${i.insurance.toLowerCase()}${i.flaggedOnboarding ? `, ${i.flaggedOnboarding} onboarding answer(s) flagged` : ''}`,
  });
  if (i.sanctions === 'MATCH') recs.push('Sanctions match: no new work until it is reviewed');
  if (i.insurance === 'EXPIRED' || i.insurance === 'EXPIRING')
    recs.push('Ask for a current insurance certificate');
  f.push({
    key: 'cyber',
    label: 'Cyber',
    weight: 0.05,
    score: i.hasCyberAnswer === null ? 60 : i.hasCyberAnswer ? 100 : 30,
    note:
      i.hasCyberAnswer === null
        ? 'No cyber answer given at onboarding'
        : i.hasCyberAnswer
          ? 'Cyber controls declared'
          : 'No cyber controls declared',
  });
  const days = i.esg.lastModernSlaveryCheck
    ? Math.floor((Date.parse(i.today) - Date.parse(i.esg.lastModernSlaveryCheck)) / 86_400_000)
    : null;
  const slavery = i.esg.modernSlaveryResult === 'REVIEW' ? 30 : i.esg.modernSlaveryStatement ? 100 : 70;
  const esgScore = Math.round(
    (slavery +
      (typeof i.esg.renewablePct === 'number' ? Math.min(100, 40 + i.esg.renewablePct * 0.6) : 60) +
      (typeof i.esg.carbonTonnesCo2e === 'number' ? 90 : 50)) /
      3,
  );
  f.push({
    key: 'esg',
    label: 'ESG',
    weight: 0.1,
    score: esgScore,
    note: `${i.esg.modernSlaveryStatement ? 'Modern slavery statement given' : 'No modern slavery statement'}; ${typeof i.esg.carbonTonnesCo2e === 'number' ? `${i.esg.carbonTonnesCo2e} t CO2e reported` : 'no carbon data'}`,
  });
  if (i.esg.modernSlaveryResult === 'REVIEW')
    recs.push('Modern slavery screen needs review: ask for a statement and supply chain detail');
  else if (days === null || days > 180)
    recs.push('Run the modern slavery check again (none in the last six months)');
  f.push({
    key: 'concentration',
    label: 'Dependence on this supplier',
    weight: 0.1,
    score: i.spendShare >= 0.4 ? 20 : i.spendShare >= 0.2 ? 60 : 100,
    note: `${Math.round(i.spendShare * 100)}% of committed spend`,
  });
  if (i.spendShare >= 0.4)
    recs.push('Over 40% of committed spend sits with this supplier: line up an alternative');
  const score = Math.round(f.reduce((s, x) => s + x.score * x.weight, 0));
  return {
    score,
    level: score >= 75 ? 'LOW' : score >= 55 ? 'MEDIUM' : 'HIGH',
    factors: f,
    recommendations: recs,
  };
}

// ------------------------------------------------------------------ FR-0805 lessons learned

export interface LessonLite {
  id: string;
  requestId: string;
  category: string | null;
  value: number | null;
  text: string;
  kind: string;
  phase: string;
}
const STOP = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'was',
  'were',
  'from',
  'have',
  'had',
  'are',
  'but',
  'not',
  'our',
  'all',
  'new',
  'services',
  'service',
]);
const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3 && !STOP.has(w)),
  );

/** Lessons from other procurements ranked by how like this one they are: same category, similar size, shared words. */
export function recallLessons(
  target: { category: string | null; value: number | null; title: string; phase: string },
  lessons: LessonLite[],
  limit = 5,
): Array<LessonLite & { score: number; why: string[] }> {
  const tw = words(`${target.title} ${target.category ?? ''}`);
  return lessons
    .map((l) => {
      let score = 0;
      const why: string[] = [];
      if (target.category && l.category && target.category.toLowerCase() === l.category.toLowerCase()) {
        score += 4;
        why.push('same category');
      }
      if (
        target.value &&
        l.value &&
        Math.max(target.value, l.value) / Math.min(target.value, l.value) <= 2.5
      ) {
        score += 2;
        why.push('similar size');
      }
      const shared = [...words(l.text)].filter((w) => tw.has(w));
      if (shared.length) {
        score += Math.min(3, shared.length);
        why.push(`mentions ${shared.slice(0, 3).join(', ')}`);
      }
      if (l.phase === target.phase) {
        score += 1;
        why.push('same phase');
      }
      return { ...l, score, why };
    })
    .filter((l) => l.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ------------------------------------------------------------------ FR-0830 plain-language legal edits

export interface ClauseLite {
  clauseId: string;
  title: string;
}
export type LegalIntent =
  | { kind: 'REDACT'; clauseId: string }
  | { kind: 'UNREDACT'; clauseId: string }
  | { kind: 'REDLINE'; clauseId: string; text: string }
  | { kind: 'INSERT'; afterClauseId: string; title: string; text: string };

/** Finds the clause a person named: by its number in the list ("clause 3"), its id, or part of its title. */
export function findClause(ref: string, clauses: ClauseLite[]): ClauseLite | null {
  const r = ref
    .trim()
    .replace(/^(the\s+)?(clause|section)\s+/i, '')
    .replace(/\s+(clause|section)$/i, '')
    .replace(/^["']|["']$/g, '')
    .toLowerCase();
  if (!r) return null;
  const n = /^\d+$/.test(r) ? Number(r) : null;
  if (n !== null && n >= 1 && n <= clauses.length) return clauses[n - 1]!;
  return (
    clauses.find((c) => c.clauseId.toLowerCase() === r) ??
    clauses.find((c) => c.title.toLowerCase() === r) ??
    clauses.find((c) => c.title.toLowerCase().includes(r)) ??
    null
  );
}

export function parseLegalEdit(
  text: string,
  clauses: ClauseLite[],
): { ok: true; intent: LegalIntent } | { ok: false; hint: string } {
  const t = text.trim();
  const hint =
    'Try: "redact the liability clause", "redline clause 4 to: <new wording>" or "insert a clause titled Data breach after clause 6: <wording>".';
  let m = /^(?:please\s+)?(redact|black out|hide)\s+(?:the\s+)?(.+?)(?:\s+clause)?\.?$/i.exec(t);
  if (m) {
    const c = findClause(m[2]!, clauses);
    return c
      ? { ok: true, intent: { kind: 'REDACT', clauseId: c.clauseId } }
      : { ok: false, hint: `I could not find a clause matching "${m[2]}". ${hint}` };
  }
  m = /^(?:please\s+)?(?:unredact|restore|show)\s+(?:the\s+)?(.+?)(?:\s+clause)?\.?$/i.exec(t);
  if (m) {
    const c = findClause(m[1]!, clauses);
    return c
      ? { ok: true, intent: { kind: 'UNREDACT', clauseId: c.clauseId } }
      : { ok: false, hint: `I could not find a clause matching "${m[1]}". ${hint}` };
  }
  m =
    /^(?:please\s+)?(?:redline|propose a change to|suggest a change to|mark up)\s+(?:the\s+)?(.+?)\s*(?:to|:|as)\s*:?\s*([\s\S]{10,})$/i.exec(
      t,
    );
  if (m) {
    const c = findClause(m[1]!, clauses);
    return c
      ? { ok: true, intent: { kind: 'REDLINE', clauseId: c.clauseId, text: m[2]!.trim() } }
      : { ok: false, hint: `I could not find a clause matching "${m[1]}". ${hint}` };
  }
  m =
    /^(?:please\s+)?(?:insert|add)\s+(?:a\s+)?(?:new\s+)?clause\s+(?:titled|called|named)?\s*["']?([^"':]{3,80}?)["']?\s+(?:after|following|below)\s+(?:the\s+)?(.+?)\s*:\s*([\s\S]{10,})$/i.exec(
      t,
    );
  if (m) {
    const c = findClause(m[2]!, clauses);
    return c
      ? {
          ok: true,
          intent: { kind: 'INSERT', afterClauseId: c.clauseId, title: m[1]!.trim(), text: m[3]!.trim() },
        }
      : { ok: false, hint: `I could not find a clause matching "${m[2]}". ${hint}` };
  }
  return { ok: false, hint };
}

/** A clause id for a clause Legal inserts: stable, readable and never clashing with the template's. */
export const insertedClauseId = (title: string, existing: string[]) => {
  const base = `X-${
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 30) || 'clause'
  }`;
  let id = base;
  for (let n = 2; existing.includes(id); n++) id = `${base}-${n}`;
  return id;
};

/** Template clauses in the library's order, then each inserted clause directly after the clause it was placed after. */
export function orderClauses<T extends { clauseId: string; afterClauseId: string | null }>(
  rows: T[],
  libOrder: string[],
): T[] {
  const at = (k: string) => {
    const i = libOrder.indexOf(k);
    return i < 0 ? 99 : i;
  };
  const base = rows.filter((r) => !r.afterClauseId).sort((x, y) => at(x.clauseId) - at(y.clauseId));
  return placeInserted(
    base,
    rows.filter((r) => r.afterClauseId),
  );
}

/** Where inserted clauses go: directly after the clause they were placed after, in the order they were inserted. */
export function placeInserted<T extends { clauseId: string; afterClauseId: string | null }>(
  ordered: T[],
  inserted: T[],
): T[] {
  const out = [...ordered];
  for (const x of inserted) {
    let at = out.findIndex((c) => c.clauseId === x.afterClauseId);
    if (at < 0) at = out.length - 1;
    while (at + 1 < out.length && out[at + 1]!.afterClauseId === x.afterClauseId) at += 1; // behind earlier siblings
    out.splice(at + 1, 0, x);
  }
  return out;
}
