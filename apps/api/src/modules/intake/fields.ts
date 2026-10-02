/** The intake field catalogue: what a procurement request is made of (FR-0005, FR-0035). */
export interface FieldDef {
  key: string;
  label: string;
  /** Must be present before a request can be submitted. */
  mandatory: boolean;
  /** Mirrored into a column on `request` for listing/search. */
  column?: 'title' | 'category' | 'estimatedValue' | 'termMonths' | 'businessUnit';
  /** The assistant can draft this itself (never asks the user for it). */
  draftable?: boolean;
  /** Question the assistant asks when the field is missing. */
  question?: string;
}

export const FIELDS: readonly FieldDef[] = [
  {
    key: 'title',
    label: 'Title',
    mandatory: true,
    column: 'title',
    question: 'What would you like to call this procurement?',
  },
  {
    key: 'category',
    label: 'Category',
    mandatory: true,
    column: 'category',
    question: 'What are you buying (for example cleaning, IT services, security, catering)?',
  },
  {
    key: 'estimatedValue',
    label: 'Estimated value (AUD)',
    mandatory: true,
    column: 'estimatedValue',
    question: 'What is the estimated total value, in dollars?',
  },
  {
    key: 'termMonths',
    label: 'Term (months)',
    mandatory: true,
    column: 'termMonths',
    question: 'How long should the contract run (for example 3 years or 18 months)?',
  },
  {
    key: 'businessUnit',
    label: 'Business unit',
    mandatory: true,
    column: 'businessUnit',
    question: 'Which business unit owns this contract?',
  },
  {
    key: 'contractOwner',
    label: 'Contract owner',
    mandatory: true,
    question: 'Who will be the contract owner (name or role)?',
  },
  { key: 'background', label: 'Background', mandatory: false, draftable: true },
  { key: 'deliverables', label: 'Deliverables', mandatory: false, draftable: true },
  { key: 'risk', label: 'Key risks', mandatory: false, draftable: true },
  { key: 'dataSensitivity', label: 'Data sensitivity', mandatory: false },
  { key: 'supplyLocation', label: 'Supply location', mandatory: false },
] as const;

export const FIELD_BY_KEY = new Map(FIELDS.map((f) => [f.key, f]));

/** Order in which the assistant asks follow-up questions (FR-0035: ask only for what cannot be inferred). */
export const QUESTION_ORDER = [
  'businessUnit',
  'contractOwner',
  'category',
  'estimatedValue',
  'termMonths',
  'title',
] as const;

export type FieldMap = Record<string, string | undefined>;

export const missingMandatory = (values: FieldMap): string[] =>
  FIELDS.filter((f) => f.mandatory && !values[f.key]?.toString().trim()).map((f) => f.key);

export const nextQuestions = (missing: readonly string[]): string[] =>
  QUESTION_ORDER.filter((k) => missing.includes(k));
