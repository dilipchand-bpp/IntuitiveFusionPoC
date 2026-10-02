/**
 * Plain-language editing for the plan ("change paragraph 3 of the background to ..."). Deterministic and rule-based
 * for the SIMULATED assistant. Returns a precise edit, or a hint explaining how to rephrase: it never guesses
 * which field or paragraph is meant (FR-0745, NFR-U08 fallback).
 */
import { PLAN_FIELDS, joinParagraphs, splitParagraphs } from './fields.js';

export type Intent =
  | { op: 'replaceParagraph'; key: string; n: number; text: string }
  | { op: 'removeParagraph'; key: string; n: number }
  | { op: 'addParagraph'; key: string; text: string }
  | { op: 'replaceAll'; key: string; text: string };

export type Parsed = { ok: true; intent: Intent } | { ok: false; hint: string };

const HINT =
  'I could not tell what to change. Try for example: "change paragraph 2 of the background to ...", "add to the risks: ...", "remove paragraph 3 of the deliverables" or "set the timeline to ...". You can also edit the field directly.';

/** Longest alias first, so "evaluation committee" wins over "committee". */
const ALIASES = PLAN_FIELDS.flatMap((f) => f.aliases.map((a) => [a, f.key] as const)).sort(
  (a, b) => b[0].length - a[0].length,
);

export function findField(text: string): { key: string; end: number } | null {
  const lower = text.toLowerCase();
  for (const [alias, key] of ALIASES) {
    const m = new RegExp(String.raw`\b${alias.replace(/ /g, '\\s+')}\b`, 'i').exec(lower);
    if (m) return { key, end: m.index + m[0].length };
  }
  return null;
}

const clean = (s: string) =>
  s
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .trim();
const sentence = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** The new wording: everything after the first "to", "with" or colon that follows the field/paragraph mention. */
function newText(text: string, from: number): string | null {
  const m = /(?:\bto\b|\bwith\b|\bsay(?:ing)?\b|:)\s*(.+)$/is.exec(text.slice(from));
  const t = m ? clean(m[1]!) : '';
  return t.length > 0 ? sentence(t) : null;
}

export function parseInstruction(raw: string): Parsed {
  const text = raw.trim();
  if (!text) return { ok: false, hint: HINT };
  const field = findField(text);
  const para = /\bparagraph\s+(\d{1,2})\b/i.exec(text);
  const n = para ? Number(para[1]) : null;

  if (/^\s*(?:please\s+)?(?:remove|delete|drop)\b/i.test(text)) {
    if (!field)
      return {
        ok: false,
        hint: 'Which section should I remove it from? Name it, for example "remove paragraph 2 of the risks".',
      };
    if (n === null)
      return {
        ok: false,
        hint: 'Which paragraph should I remove? For example "remove paragraph 2 of the risks".',
      };
    return { ok: true, intent: { op: 'removeParagraph', key: field.key, n } };
  }
  if (/^\s*(?:please\s+)?(?:add|append|insert)\b/i.test(text)) {
    if (!field)
      return {
        ok: false,
        hint: 'Which section should I add it to? For example "add to the risks: supplier insolvency".',
      };
    const t = newText(text, field.end) ?? clean(text.slice(field.end).replace(/^\W+/, ''));
    return t
      ? { ok: true, intent: { op: 'addParagraph', key: field.key, text: sentence(t) } }
      : { ok: false, hint: HINT };
  }
  if (/\b(?:change|replace|rewrite|update|amend|edit)\b/i.test(text) && n !== null) {
    if (!field)
      return {
        ok: false,
        hint: `Paragraph ${n} of which section? For example "change paragraph ${n} of the background to ...".`,
      };
    const t = newText(text, Math.max(field.end, (para?.index ?? 0) + (para?.[0].length ?? 0)));
    return t
      ? { ok: true, intent: { op: 'replaceParagraph', key: field.key, n, text: t } }
      : {
          ok: false,
          hint: `What should paragraph ${n} say? For example "change paragraph ${n} of the ${field.key} to ...".`,
        };
  }
  if (/\b(?:set|change|replace|rewrite|update|amend)\b/i.test(text) && field) {
    const t = newText(text, field.end);
    return t
      ? { ok: true, intent: { op: 'replaceAll', key: field.key, text: t } }
      : { ok: false, hint: HINT };
  }
  return { ok: false, hint: HINT };
}

/** Applies an intent to the current field text. Throws a user-readable Error when the paragraph does not exist. */
export function applyIntent(intent: Intent, current: string | null | undefined): string {
  const ps = splitParagraphs(current);
  switch (intent.op) {
    case 'replaceAll':
      return intent.text;
    case 'addParagraph':
      return joinParagraphs([...ps, intent.text]);
    case 'replaceParagraph':
      if (intent.n < 1 || intent.n > ps.length)
        throw new RangeError(`There is no paragraph ${intent.n}; this section has ${ps.length}.`);
      return joinParagraphs(ps.map((p, i) => (i === intent.n - 1 ? intent.text : p)));
    case 'removeParagraph':
      if (intent.n < 1 || intent.n > ps.length)
        throw new RangeError(`There is no paragraph ${intent.n}; this section has ${ps.length}.`);
      return joinParagraphs(ps.filter((_, i) => i !== intent.n - 1));
  }
}

export function describeIntent(intent: Intent, label: string): string {
  switch (intent.op) {
    case 'replaceAll':
      return `Replaced the whole ${label} section.`;
    case 'addParagraph':
      return `Added a paragraph to ${label}.`;
    case 'replaceParagraph':
      return `Changed paragraph ${intent.n} of ${label}; the other paragraphs are unchanged.`;
    case 'removeParagraph':
      return `Removed paragraph ${intent.n} of ${label}.`;
  }
}
