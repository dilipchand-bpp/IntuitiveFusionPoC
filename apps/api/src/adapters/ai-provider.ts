/**
 * SWAP POINT (docs/swap-points.md): the AI assistant. The mock is deterministic and rule-based; a Bedrock adapter
 * implements the same interface. Callers only ever receive PROPOSALS: nothing the AI returns is committed without
 * being stored as "AI-drafted", audited and editable by a person (NFR-AV05).
 */
import {
  CATEGORIES,
  canonicalUnit,
  extractFromText,
  looksLikeShortAnswer,
  parseMoney,
  parseTermMonths,
} from '../modules/intake/extract.js';
import { FIELD_BY_KEY, missingMandatory, nextQuestions, type FieldMap } from '../modules/intake/fields.js';
import { draftPlan, type PlanDraftInput } from '../modules/plan/generate.js';
import { PLAN_FIELD_BY_KEY } from '../modules/plan/fields.js';
import { applyIntent, describeIntent, parseInstruction } from '../modules/plan/instructions.js';

export interface AiDraftInput {
  text: string;
  /** Values already on the request. */
  current: FieldMap;
  /** Mandatory fields still missing before this message, in the order they were asked. */
  pending: string[];
}
export interface AiChange {
  key: string;
  value: string;
}
export interface AiDraftResult {
  changes: AiChange[];
  reply: string;
  /** Mandatory fields still missing after applying `changes`. */
  stillMissing: string[];
}
export interface AiProvider {
  readonly name: string;
  /** True for any non-production model; surfaced in the UI as "Simulated AI". */
  readonly simulated: boolean;
  draftRequest(input: AiDraftInput): Promise<AiDraftResult>;
  /** Drafts every plan section from the request (FR-0075). Output is a proposal; the caller marks it AI-drafted. */
  draftPlan(input: PlanDraftInput): Promise<Record<string, string>>;
  /** Understands "change paragraph 3 of the background to ...". Never guesses: returns a hint when unsure. */
  interpretPlanInstruction(
    text: string,
    current: Record<string, string | undefined>,
  ): Promise<PlanInstructionResult>;
}
export type PlanInstructionResult =
  | { ok: true; key: string; label: string; newValue: string; explanation: string }
  | { ok: false; hint: string };

const fmtMoney = (v: string) => `AUD ${Number(v).toLocaleString('en-AU')}`;
const describe = (key: string, value: string) => {
  const label = FIELD_BY_KEY.get(key)?.label ?? key;
  return `${label}: ${key === 'estimatedValue' ? fmtMoney(value) : key === 'termMonths' ? `${value} months` : value}`;
};

export class MockAiProvider implements AiProvider {
  readonly name = 'mock-rules-v1';
  readonly simulated = true;

  async draftPlan(input: PlanDraftInput): Promise<Record<string, string>> {
    return draftPlan(input);
  }

  async interpretPlanInstruction(
    text: string,
    current: Record<string, string | undefined>,
  ): Promise<PlanInstructionResult> {
    const parsed = parseInstruction(text);
    if (!parsed.ok) return { ok: false, hint: parsed.hint };
    const def = PLAN_FIELD_BY_KEY.get(parsed.intent.key)!;
    try {
      const newValue = applyIntent(parsed.intent, current[parsed.intent.key]);
      return {
        ok: true,
        key: def.key,
        label: def.label,
        newValue,
        explanation: describeIntent(parsed.intent, def.label),
      };
    } catch (e) {
      if (e instanceof RangeError) return { ok: false, hint: e.message };
      throw e;
    }
  }

  async draftRequest({ text, current, pending }: AiDraftInput): Promise<AiDraftResult> {
    const ex = extractFromText(text);
    const changes = new Map<string, string>();
    for (const [k, v] of Object.entries(ex.fields))
      if (v !== undefined && v !== current[k]) changes.set(k, v);

    // A short answer to the question we just asked ("Facilities", "36 months", "$80k") fills that field.
    let misunderstood: string | null = null;
    const asked = pending[0];
    if (asked && !ex.mentioned.includes(asked)) {
      const answer = text.trim();
      if (asked === 'estimatedValue') {
        const v = parseMoney(answer) ?? (/^\d+$/.test(answer) ? Number(answer) : null);
        if (v === null) misunderstood = asked;
        else changes.set(asked, String(v));
      } else if (asked === 'termMonths') {
        const v = parseTermMonths(answer) ?? (/^\d+$/.test(answer) ? Number(answer) : null);
        if (v === null) misunderstood = asked;
        else changes.set(asked, String(v));
      } else if (asked === 'businessUnit') {
        const unit = canonicalUnit(answer);
        if (unit) changes.set(asked, unit);
        else if (ex.mentioned.length === 0 && looksLikeShortAnswer(answer)) changes.set(asked, answer);
      } else if (ex.mentioned.length === 0 && looksLikeShortAnswer(answer)) {
        changes.set(asked, answer);
      }
    }

    const merged: FieldMap = { ...current, ...Object.fromEntries(changes) };

    // Draft the narrative fields once we know what is being bought (never overwrites what a person wrote).
    const rule = CATEGORIES.find((c) => merged.category?.startsWith(c.category));
    if (rule && !merged.background) {
      const value = merged.estimatedValue
        ? ` with an estimated value of ${fmtMoney(merged.estimatedValue)}`
        : '';
      const term = merged.termMonths ? ` over ${merged.termMonths} months` : '';
      changes.set(
        'background',
        `A compliant market approach is required for ${rule.category.toLowerCase()}${value}${term}. Existing arrangements are ending and the requirement continues.`,
      );
    }
    if (rule && !merged.deliverables) {
      changes.set(
        'deliverables',
        `Delivery of ${rule.category.toLowerCase()} to agreed service levels across all sites, with monthly performance reporting.`,
      );
    }

    const stillMissing = missingMandatory({ ...merged, ...Object.fromEntries(changes) });
    const shown = [...changes].filter(
      ([k]) => FIELD_BY_KEY.get(k)?.mandatory || k === 'dataSensitivity' || k === 'supplyLocation',
    );
    const questions = nextQuestions(stillMissing);

    const parts: string[] = [];
    if (misunderstood)
      parts.push(
        `Sorry, I could not read that as ${misunderstood === 'estimatedValue' ? 'an amount' : 'a length of time'}.`,
      );
    if (shown.length > 0)
      parts.push(`I have updated the draft. ${shown.map(([k, v]) => describe(k, v)).join('; ')}.`);
    else if (!misunderstood) parts.push('I could not find anything new to add from that message.');
    if (changes.has('background'))
      parts.push('I also drafted the background and deliverables for you to review.');
    if (questions[0]) parts.push(FIELD_BY_KEY.get(questions[0])!.question!);
    else
      parts.push(
        'Everything I need is filled in. Please review the draft, change anything that is wrong, and submit when you are ready.',
      );

    return {
      changes: [...changes].map(([key, value]) => ({ key, value })),
      reply: parts.join(' '),
      stillMissing,
    };
  }
}
