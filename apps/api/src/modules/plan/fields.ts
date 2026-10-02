/** The procurement plan field catalogue (AI notes "Procurement Plan"; FR-0075, FR-0100). */
export interface PlanFieldDef {
  key: string;
  label: string;
  /** Words people use for it; used to understand "change paragraph 2 of the background". */
  aliases: readonly string[];
  mandatory: boolean;
}

export const PLAN_FIELDS: readonly PlanFieldDef[] = [
  {
    key: 'background',
    label: 'Background',
    aliases: ['background', 'why we need', 'rationale'],
    mandatory: true,
  },
  { key: 'objectives', label: 'Objectives', aliases: ['objectives', 'objective', 'goals'], mandatory: true },
  {
    key: 'requirements',
    label: 'Detailed requirements',
    aliases: ['requirements', 'requirement', 'scope'],
    mandatory: true,
  },
  { key: 'deliverables', label: 'Deliverables', aliases: ['deliverables', 'deliverable'], mandatory: true },
  {
    key: 'milestones',
    label: 'Milestones',
    aliases: ['milestones', 'milestone', 'key dates'],
    mandatory: true,
  },
  { key: 'risks', label: 'Risks and mitigation', aliases: ['risks', 'risk', 'mitigation'], mandatory: true },
  {
    key: 'evaluationCommittee',
    label: 'Evaluation committee',
    aliases: ['evaluation committee', 'evaluators', 'evaluation panel', 'panel'],
    mandatory: true,
  },
  {
    key: 'steeringCommittee',
    label: 'Steering committee',
    aliases: ['steering committee', 'steering group', 'steering'],
    mandatory: false,
  },
  {
    key: 'approvalDelegate',
    label: 'Approval delegate',
    aliases: ['approval delegate', 'delegate', 'approver'],
    mandatory: true,
  },
  {
    key: 'consultations',
    label: 'Consultation and endorsements',
    aliases: ['consultations', 'consultation', 'endorsements', 'endorsement'],
    mandatory: false,
  },
  {
    key: 'dueDiligence',
    label: 'Supplier due diligence',
    aliases: ['due diligence', 'diligence'],
    mandatory: true,
  },
  { key: 'timeline', label: 'Timeline', aliases: ['timeline', 'timeframe', 'schedule'], mandatory: false },
] as const;

export const PLAN_FIELD_BY_KEY = new Map(PLAN_FIELDS.map((f) => [f.key, f]));

/** Paragraphs are separated by a blank line; this is what "paragraph 3" means everywhere. */
export const splitParagraphs = (value: string | null | undefined): string[] =>
  (value ?? '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
export const joinParagraphs = (ps: readonly string[]): string => ps.join('\n\n');
