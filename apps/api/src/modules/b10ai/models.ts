/**
 * SWAP POINT (docs/swap-points.md): the AI model registry (NFR-C01, NFR-M06, SEC-TP07).
 *
 * Every model the platform can use is an `AiModel`. `rules-simulated-v1` is built in and always approved; the two
 * `sim-llm-*` models stand in for third-party providers: deterministic, no network, but with a declared data-handling
 * profile so the approval step has something real to decide on. A real adapter (for example an in-region Bedrock model)
 * implements the same interface and is added to MODELS; nothing that calls `complete()` changes.
 *
 * Nothing here is a real language model. Every output is built from the input by fixed rules and labelled simulated.
 */
export type AiTask = 'assistant-footer' | 'recommendation-summary';
export const AI_TASKS: readonly AiTask[] = ['assistant-footer', 'recommendation-summary'];

export interface DataHandling {
  /** Where the content is processed. */
  processedIn: string;
  /** Whether the provider keeps what it was sent, and for how long. */
  retention: string;
  retained: boolean;
  /** Whether the provider may use what it was sent to train its own models. */
  usedForTraining: boolean;
  /** Whether processing stays inside the customer's country (NFR-R02). */
  inCountry: boolean;
}

export interface AiCompletion {
  /** The text produced for the task. */
  text: string;
  /** A short extra line some models add, for example a confidence note. */
  note?: string;
}

export interface AiModel {
  id: string;
  provider: string;
  label: string;
  simulated: boolean;
  /** Built-in models run inside the platform and need no approval. */
  builtIn: boolean;
  dataHandling: DataHandling;
  complete(task: AiTask, input: Record<string, unknown>): Promise<AiCompletion>;
}

export const DEFAULT_MODEL_ID = 'rules-simulated-v1';

const money = (n: unknown) => `AUD ${Number(n ?? 0).toLocaleString('en-AU')}`;
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
interface Cand {
  name?: string;
  supplier?: string;
  total?: number;
  score?: number;
}
const cands = (v: unknown): Cand[] => (Array.isArray(v) ? (v as Cand[]) : []);

/** The built-in model: fixed rules, nothing leaves the platform. */
const rulesModel: AiModel = {
  id: 'rules-simulated-v1',
  provider: 'Intuitive Fusion (built in)',
  label: 'Rules (simulated, built in)',
  simulated: true,
  builtIn: true,
  dataHandling: {
    processedIn: 'Inside this platform; nothing is sent out',
    retention: 'Nothing is sent, so nothing is retained by anyone else',
    retained: false,
    usedForTraining: false,
    inCountry: true,
  },
  async complete(task, input) {
    if (task === 'assistant-footer')
      return { text: 'Answered by fixed rules from this portal. Simulated; no external AI model was used.' };
    const [best] = cands(input.candidates);
    if (!best) return { text: 'No approved catalogue item matched the need, so nothing is recommended.' };
    return {
      text: `Recommended ${str(best.name)} from ${str(best.supplier)} at ${money(best.total)}, the highest score on price, supplier standing and delivery.`,
    };
  },
};

/** A fast, terse third-party style model: short wording, offshore processing, thirty-day retention. */
const fastModel: AiModel = {
  id: 'sim-llm-fast-v1',
  provider: 'SimuLLM Fast (simulated third party)',
  label: 'SimuLLM Fast (simulated)',
  simulated: true,
  builtIn: false,
  dataHandling: {
    processedIn: 'Simulated vendor region us-east-1 (outside Australia)',
    retention: 'Prompts kept 30 days for abuse monitoring',
    retained: true,
    usedForTraining: false,
    inCountry: false,
  },
  async complete(task, input) {
    if (task === 'assistant-footer')
      return {
        text: 'Quick answer from sim-llm-fast-v1 (simulated third-party model). Check the linked page for detail.',
      };
    const [best] = cands(input.candidates);
    if (!best) return { text: 'No match.' };
    return { text: `Pick: ${str(best.name)} (${money(best.total)}).` };
  },
};

/** A slower, fuller third-party style model: longer wording, a confidence note, onshore with no retention. */
const carefulModel: AiModel = {
  id: 'sim-llm-careful-v1',
  provider: 'CarefulAI (simulated third party)',
  label: 'CarefulAI (simulated)',
  simulated: true,
  builtIn: false,
  dataHandling: {
    processedIn: 'Simulated vendor region ap-southeast-2 (Sydney)',
    retention: 'Zero retention: prompts are discarded after the answer is returned',
    retained: false,
    usedForTraining: false,
    inCountry: true,
  },
  async complete(task, input) {
    if (task === 'assistant-footer')
      return {
        text: "Prepared by sim-llm-careful-v1 (simulated third-party model) using the portal's own figures. Please verify against the linked pages before acting.",
        note: 'Confidence: medium. Simulated wording; the figures come from fixed rules.',
      };
    const list = cands(input.candidates);
    const [best, second] = list;
    if (!best)
      return {
        text: 'No approved catalogue item matched the need, so there is nothing to recommend.',
        note: 'Confidence: high that nothing matches.',
      };
    const gap = second ? Number(best.score ?? 0) - Number(second.score ?? 0) : null;
    const confidence =
      gap === null
        ? 'medium (only one candidate)'
        : gap >= 10
          ? 'high'
          : gap >= 3
            ? 'medium'
            : 'low (the top two are close)';
    const alt = second
      ? ` The next best option is ${str(second.name)} from ${str(second.supplier)} at ${money(second.total)}.`
      : '';
    return {
      text: `After weighing ${list.length} candidate${list.length === 1 ? '' : 's'} on price, supplier standing and delivery, I recommend ${str(best.name)} from ${str(best.supplier)} at a total of ${money(best.total)}.${alt} A person must still approve it.`,
      note: `Confidence: ${confidence}.`,
    };
  },
};

export const MODELS: readonly AiModel[] = [rulesModel, fastModel, carefulModel];
export const modelById = (id: string): AiModel | undefined => MODELS.find((m) => m.id === id);
