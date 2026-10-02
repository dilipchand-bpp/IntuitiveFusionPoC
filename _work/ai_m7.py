p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src\adapters\ai-provider.ts'
t = open(p, encoding='utf8', newline='').read()

def sub(old, new):
    global t
    assert old in t, old[:60]
    t = t.replace(old, new, 1)

sub("import { FIELD_BY_KEY, missingMandatory, nextQuestions, type FieldMap } from '../modules/intake/fields.js';",
    "import { FIELD_BY_KEY, missingMandatory, nextQuestions, type FieldMap } from '../modules/intake/fields.js';\nimport { draftPlan, type PlanDraftInput } from '../modules/plan/generate.js';\nimport { PLAN_FIELD_BY_KEY } from '../modules/plan/fields.js';\nimport { applyIntent, describeIntent, parseInstruction } from '../modules/plan/instructions.js';")
sub("  draftRequest(input: AiDraftInput): Promise<AiDraftResult>;\n}",
    """  draftRequest(input: AiDraftInput): Promise<AiDraftResult>;
  /** Drafts every plan section from the request (FR-0075). Output is a proposal; the caller marks it AI-drafted. */
  draftPlan(input: PlanDraftInput): Promise<Record<string, string>>;
  /** Understands "change paragraph 3 of the background to ...". Never guesses: returns a hint when unsure. */
  interpretPlanInstruction(text: string, current: Record<string, string | undefined>): Promise<PlanInstructionResult>;
}
export type PlanInstructionResult =
  | { ok: true; key: string; label: string; newValue: string; explanation: string }
  | { ok: false; hint: string };""")
sub("export class MockAiProvider implements AiProvider {\n  readonly name = 'mock-rules-v1';\n  readonly simulated = true;\n",
    """export class MockAiProvider implements AiProvider {
  readonly name = 'mock-rules-v1';
  readonly simulated = true;

  async draftPlan(input: PlanDraftInput): Promise<Record<string, string>> {
    return draftPlan(input);
  }

  async interpretPlanInstruction(text: string, current: Record<string, string | undefined>): Promise<PlanInstructionResult> {
    const parsed = parseInstruction(text);
    if (!parsed.ok) return { ok: false, hint: parsed.hint };
    const def = PLAN_FIELD_BY_KEY.get(parsed.intent.key)!;
    try {
      const newValue = applyIntent(parsed.intent, current[parsed.intent.key]);
      return { ok: true, key: def.key, label: def.label, newValue, explanation: describeIntent(parsed.intent, def.label) };
    } catch (e) {
      if (e instanceof RangeError) return { ok: false, hint: e.message };
      throw e;
    }
  }
""")
open(p, 'w', encoding='utf8', newline='').write(t)
print('ok')
