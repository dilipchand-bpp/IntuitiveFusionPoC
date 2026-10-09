/**
 * Pre-population (CP-04): suggested values for the fields of a request, a plan or a tender pack, each with the reason and the
 * source (the text, the record, in-house history, the catalogue, a policy). Nothing is written: a person applies a suggestion
 * by typing it, or through a draft.
 */
import type { DraftDoc, SourceRef } from './model.js';
import { FIELD_LABELS } from './model.js';
import { requestPayload, sectionText } from './service.js';

export interface Suggestion {
  field: string;
  label: string;
  value: string;
  current: string | null;
  reason: string;
  source: { kind: SourceRef['kind']; label: string; quote?: string };
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}
const CONF: Record<SourceRef['kind'], Suggestion['confidence']> = {
  TEXT_SPAN: 'HIGH',
  RECORD: 'HIGH',
  INSTRUCTION: 'HIGH',
  POLICY: 'MEDIUM',
  TEMPLATE: 'MEDIUM',
  HISTORY: 'LOW',
  CATALOGUE: 'LOW',
};

/** The source that says most: what your own words raised comes before standard wording. */
const firstSource = (sources: SourceRef[], path: string) => {
  const hits = sources.filter((s) => s.path === path || s.path.startsWith(`${path}.`));
  return hits.find((s) => s.kind === 'TEXT_SPAN') ?? hits.find((s) => s.kind === 'RECORD') ?? hits[0];
};

function make(
  field: string,
  label: string,
  value: string,
  current: string | null,
  src: SourceRef | undefined,
): Suggestion {
  const s = src ?? { path: field, kind: 'TEMPLATE' as const, label: 'Standard wording' };
  return {
    field,
    label,
    value,
    current,
    reason: s.quote ? `${s.label}: “${s.quote}”` : s.label,
    source: { kind: s.kind, label: s.label, ...(s.quote ? { quote: s.quote } : {}) },
    confidence: CONF[s.kind],
  };
}

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

export function requestSuggestions(
  doc: DraftDoc,
  sources: SourceRef[],
  current: Record<string, string | number | undefined>,
): Suggestion[] {
  const out: Suggestion[] = [];
  const f = doc.fields;
  for (const k of [
    'title',
    'category',
    'estimatedValue',
    'termMonths',
    'businessUnit',
    'contractOwner',
    'supplyLocation',
    'dataSensitivity',
  ]) {
    const v = f[k];
    if (!v || v === 'Untitled') continue;
    const cur = current[k] === undefined || current[k] === '' ? null : String(current[k]);
    if (cur !== null && norm(cur) === norm(v)) continue;
    // an existing title that is only the placeholder counts as empty
    if (
      k === 'title' &&
      cur &&
      !/^untitled/i.test(cur) &&
      !firstSource(sources, `fields.${k}`)?.kind.startsWith('TEXT')
    )
      continue;
    out.push(
      make(
        k,
        FIELD_LABELS[k] ?? k,
        v,
        cur && !/^untitled/i.test(cur) ? cur : null,
        firstSource(sources, `fields.${k}`),
      ),
    );
  }
  const p = requestPayload(doc);
  for (const [k, label, secKey] of [
    ['background', 'Background', 'background'],
    ['deliverables', 'Deliverables', 'deliverables'],
    ['risk', 'Key risks', 'risks'],
  ] as const) {
    const v = p.fields?.[k];
    if (!v) continue;
    const cur = current[k] === undefined || current[k] === '' ? null : String(current[k]);
    if (cur !== null && norm(cur) === norm(v)) continue;
    out.push(make(k, label, v, cur, firstSource(sources, `sections.${secKey}`)));
  }
  return out;
}

export function sectionSuggestions(
  doc: DraftDoc,
  sources: SourceRef[],
  current: Record<string, string>,
  labels: Map<string, string>,
): Suggestion[] {
  const out: Suggestion[] = [];
  for (const s of doc.sections) {
    const v = sectionText(doc, s.key);
    if (!v) continue;
    const cur = current[s.key] ?? '';
    if (norm(cur) === norm(v)) continue;
    out.push(
      make(s.key, labels.get(s.key) ?? s.title, v, cur || null, firstSource(sources, `sections.${s.key}`)),
    );
  }
  return out;
}
