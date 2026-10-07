/**
 * SEC-D07: the sensitive-data classifier. Deterministic rules, labelled rules-simulated-v1 (no model).
 *
 * `classifyText` reads one piece of text and returns the detectors that fired, the class of the finding (the most
 * sensitive detector wins) and a MASKED sample for each. The sensitive value itself is never returned or stored: a masked
 * sample keeps the shape and the last three characters, for example `XXX XXX 789`.
 *
 * Detectors: TFN (checksum), ABN (checksum), bank account with BSB, credit card (Luhn), email, phone, driver licence,
 * passport, medical and health words, commercial-in-confidence markers.
 *
 * SWAP POINT (docs/swap-points.md): a managed classification service (for example Amazon Macie or Microsoft Purview)
 * replaces `classifyText`; the scan, the table and the review workflow stay.
 */
import type { DataClass } from '../../db/schema-b11b.js';

export const CLASSIFIER_MODEL = 'rules-simulated-v1';

export type DetectorId =
  | 'TFN'
  | 'ABN'
  | 'BANK_ACCOUNT'
  | 'CREDIT_CARD'
  | 'EMAIL'
  | 'PHONE'
  | 'DRIVER_LICENCE'
  | 'PASSPORT'
  | 'MEDICAL'
  | 'COMMERCIAL_IN_CONFIDENCE';

export const DETECTORS: Record<DetectorId, { label: string; class: DataClass }> = {
  TFN: { label: 'Tax file number', class: 'SENSITIVE_PERSONAL' },
  ABN: { label: 'Australian business number', class: 'INTERNAL' },
  BANK_ACCOUNT: { label: 'Bank account and BSB', class: 'FINANCIAL' },
  CREDIT_CARD: { label: 'Credit card number', class: 'FINANCIAL' },
  EMAIL: { label: 'Email address', class: 'CONFIDENTIAL' },
  PHONE: { label: 'Phone number', class: 'CONFIDENTIAL' },
  DRIVER_LICENCE: { label: 'Driver licence number', class: 'SENSITIVE_PERSONAL' },
  PASSPORT: { label: 'Passport number', class: 'SENSITIVE_PERSONAL' },
  MEDICAL: { label: 'Medical or health information', class: 'SENSITIVE_PERSONAL' },
  COMMERCIAL_IN_CONFIDENCE: { label: 'Commercial-in-confidence marker', class: 'CONFIDENTIAL' },
};

const RANK: Record<DataClass, number> = {
  PUBLIC: 0,
  INTERNAL: 1,
  CONFIDENTIAL: 2,
  SENSITIVE_PERSONAL: 3,
  FINANCIAL: 4,
};
export const classRank = (c: DataClass) => RANK[c];

/** Keeps the shape and the last three letters or digits: `123 456 789` becomes `XXX XXX 789`. */
export function mask(value: string): string {
  const keep = 3;
  let seen = 0;
  const chars = [...value];
  for (let i = chars.length - 1; i >= 0; i -= 1) {
    if (/[A-Za-z0-9]/.test(chars[i]!)) {
      seen += 1;
      if (seen > keep) chars[i] = 'X';
    }
  }
  return chars.join('');
}

const digits = (s: string) => s.replace(/\D/g, '');

export function luhnValid(num: string): boolean {
  const d = digits(num);
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = d.length - 1; i >= 0; i -= 1) {
    let n = Number(d[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function tfnValid(num: string): boolean {
  const d = digits(num);
  if (d.length !== 9) return false;
  const w = [1, 4, 3, 7, 5, 8, 6, 9, 10];
  return d.split('').reduce((s, c, i) => s + Number(c) * w[i]!, 0) % 11 === 0;
}

export function abnValid(num: string): boolean {
  const d = digits(num);
  if (d.length !== 11) return false;
  const w = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const n = d.split('').map(Number);
  n[0] = n[0]! - 1;
  return n.reduce((s, c, i) => s + c * w[i]!, 0) % 89 === 0;
}

export interface Hit {
  detector: DetectorId;
  sample: string;
}

const MEDICAL_WORDS =
  /\b(diagnos(?:is|ed)|prescription|medication|medical (?:condition|record|history|certificate)|patient|surgery|chemotherapy|therapy|disabilit(?:y|ies)|mental health|illness|injur(?:y|ed)|health (?:record|information|condition|status)|pregnan(?:t|cy)|allerg(?:y|ies)|treatment plan|hiv|diabetes|cancer)\b/gi;

function* matches(text: string, re: RegExp): Generator<RegExpExecArray> {
  const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  let m: RegExpExecArray | null;
  while ((m = r.exec(text)) !== null) {
    yield m;
    if (m[0] === '') r.lastIndex += 1;
  }
}

/** Every detector hit in the text, each with a masked sample. At most three samples per detector. */
export function detect(text: string): Hit[] {
  const hits: Hit[] = [];
  const add = (detector: DetectorId, raw: string) => {
    if (hits.filter((h) => h.detector === detector).length < 3) hits.push({ detector, sample: mask(raw) });
  };

  // credit card: 13 to 19 digits with optional single spaces or dashes, Luhn valid, a plausible first digit
  const cardSpans: Array<[number, number]> = [];
  for (const m of matches(text, /(?<![\d-])(?:\d[ -]?){12,18}\d(?![\d-])/)) {
    if (/^[3-6]/.test(digits(m[0])) && luhnValid(m[0])) {
      add('CREDIT_CARD', m[0]);
      cardSpans.push([m.index, m.index + m[0].length]);
    }
  }
  const inCard = (i: number) => cardSpans.some(([a, b]) => i >= a && i < b);

  // TFN: nine digits that pass the checksum and are either written 3-3-3 or follow the words "tax file" or "TFN"
  for (const m of matches(text, /(?<![\d-])\d{3}[ -]?\d{3}[ -]?\d{3}(?![\d-])/)) {
    if (inCard(m.index) || !tfnValid(m[0])) continue;
    const before = text.slice(Math.max(0, m.index - 40), m.index);
    if (/\b(tfn|tax file)/i.test(before) || /[ -]/.test(m[0])) add('TFN', m[0]);
  }

  // ABN: eleven digits that pass the checksum (written 2-3-3-3 or run together)
  for (const m of matches(text, /(?<![\d-])\d{2}[ ]?\d{3}[ ]?\d{3}[ ]?\d{3}(?![\d-])/)) {
    if (!inCard(m.index) && abnValid(m[0])) add('ABN', m[0]);
  }

  // bank account: a BSB (six digits) and an account number, both labelled
  const bsb = text.match(/\bBSB\s*(?:no\.?|number)?\s*[:#]?\s*(\d{3}[- ]?\d{3})\b/i);
  const acct = text.match(/\b(?:account|acct?)\s*(?:no\.?|number|num|#)?\s*[:#]?\s*(\d{6,10})\b/i);
  if (bsb && acct) add('BANK_ACCOUNT', `${bsb[1]} ${acct[1]}`);

  for (const m of matches(text, /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/)) add('EMAIL', m[0]);

  for (const m of matches(text, /(?<![\d])(?:\+?61[ -]?|0)[2-478](?:[ -]?\d){8}(?![\d])/)) {
    if (!inCard(m.index) && digits(m[0]).length >= 9) add('PHONE', m[0]);
  }

  for (const m of matches(
    text,
    /\bdriver'?s?[’']?s? licen[cs]e(?: (?:no\.?|number))?\s*[:#]?\s*([A-Z0-9]{6,10})\b/i,
  ))
    add('DRIVER_LICENCE', m[1]!);

  for (const m of matches(text, /\bpassport(?: (?:no\.?|number))?\s*[:#]?\s*([A-Z]{1,2}\d{7})\b/i))
    add('PASSPORT', m[1]!);

  for (const m of matches(text, MEDICAL_WORDS)) add('MEDICAL', m[0]);

  for (const m of matches(
    text,
    /\b(commercial[- ]in[- ]confidence|strictly confidential|company confidential|confidential and proprietary|not for distribution)\b|\bCIC\b/i,
  ))
    add('COMMERCIAL_IN_CONFIDENCE', m[0]);

  return hits;
}

export interface Classification {
  class: DataClass;
  detectors: DetectorId[];
  samples: Array<{ detector: DetectorId; sample: string }>;
}

/** The class is the most sensitive one among the detectors that fired; null when nothing fired. */
export function classifyText(text: string): Classification | null {
  const hits = detect(text);
  if (hits.length === 0) return null;
  const detectors = [...new Set(hits.map((h) => h.detector))];
  const cls = detectors.map((d) => DETECTORS[d].class).reduce((a, b) => (RANK[b] > RANK[a] ? b : a));
  return { class: cls, detectors, samples: hits };
}

/** Which detectors are normal in each kind of place. A hit outside this set is shown as a warning. */
export const EXPECTED: Record<string, readonly DetectorId[]> = {
  request: ['ABN', 'COMMERCIAL_IN_CONFIDENCE'],
  plan: ['ABN', 'COMMERCIAL_IN_CONFIDENCE'],
  lesson: ['ABN', 'COMMERCIAL_IN_CONFIDENCE'],
  review_note: ['ABN', 'COMMERCIAL_IN_CONFIDENCE'],
  clause: ['ABN', 'EMAIL', 'PHONE', 'COMMERCIAL_IN_CONFIDENCE'],
  message: ['ABN', 'EMAIL', 'PHONE', 'COMMERCIAL_IN_CONFIDENCE'],
  document: ['ABN', 'EMAIL', 'PHONE', 'COMMERCIAL_IN_CONFIDENCE'],
  chat: ['ABN', 'COMMERCIAL_IN_CONFIDENCE'],
};

export function warningFor(place: string, label: string, detectors: readonly DetectorId[]): string | null {
  const ok = EXPECTED[place] ?? [];
  const odd = detectors.filter((d) => !ok.includes(d));
  if (odd.length === 0) return null;
  return `${odd.map((d) => DETECTORS[d].label).join(', ')} found in ${label}. This is not expected there; review it and remove or move it.`;
}
