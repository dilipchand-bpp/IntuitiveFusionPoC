/**
 * The specialist agents of the Procurement Copilot (CP-06) and the tools each one owns. A tool is one call to the application's own
 * HTTP routes (or one local rule); the adapter in tools.ts refuses a call that the calling agent does not list here, and every call
 * is made with the session of the person who started the run, so a tool can never do more than that person may.
 * The roles shown are the same roles the route guards allow (tested against the OpenAPI contract in cpagent.test.ts).
 */
import type { RoleName } from '@if/shared';

export const AGENT_KEYS = [
  'ORCHESTRATOR',
  'INTAKE',
  'COMPLIANCE',
  'WORKFLOW',
  'DOCFILL',
  'CONTRACT_DATA',
] as const;
export type AgentKey = (typeof AGENT_KEYS)[number];

export interface ToolDef {
  name: string;
  /** HTTP method and path under /api/v1 (`:id`-style placeholders); LOCAL for a rule that makes no call. */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'LOCAL';
  path: string;
  /** Roles the route guard allows. */
  roles: readonly RoleName[] | 'any';
  summary: string;
  /** Another module builds this route (drafting, OCR): a 404 or 501 means "capability not available", never a failure. */
  optionalCapability?: boolean;
}

export interface AgentDef {
  key: AgentKey;
  label: string;
  purpose: string;
  tools: readonly ToolDef[];
  mayNot: readonly string[];
}

const STAFF: readonly RoleName[] = [
  'REQUESTER',
  'PROCUREMENT',
  'DELEGATE',
  'EVALUATOR',
  'CHAIR',
  'LEGAL',
  'CONTRACT_MGR',
  'PROBITY',
  'FINANCE',
  'ADMIN',
  'EXEC',
];
export const COPILOT_ROLES = STAFF;
export const COPILOT_MANAGERS: readonly RoleName[] = ['PROCUREMENT', 'EXEC', 'ADMIN'];

const NEVER = [
  'approve anything (plan, award, contract signature, delegate decisions)',
  'declare a conflict of interest or score as a panel member',
  'act beyond the role of the person who started the run',
] as const;

export const AGENTS: readonly AgentDef[] = [
  {
    key: 'ORCHESTRATOR',
    label: 'Orchestrator',
    purpose:
      'Reads the state of the procurement on every tick, picks the next step, hands it to a specialist, raises gates for people and problems for repair.',
    tools: [
      {
        name: 'run_store',
        method: 'LOCAL',
        path: '(run, step, gate, problem and event tables)',
        roles: 'any',
        summary: 'Reads and records the run; makes no call on the procurement itself',
      },
    ],
    mayNot: [...NEVER, 'change a procurement record directly (only the specialists, through the routes)'],
  },
  {
    key: 'INTAKE',
    label: 'Intake and drafting',
    purpose:
      'Turns the request text into a request record, pre-populates fields, fills what is missing from what the text and the profile say, and submits.',
    tools: [
      {
        name: 'draft_request',
        method: 'POST',
        path: '/copilot/draft',
        roles: STAFF,
        summary: 'Draft request fields from text (drafting module)',
        optionalCapability: true,
      },
      {
        name: 'prepopulate',
        method: 'POST',
        path: '/copilot/prepopulate',
        roles: STAFF,
        summary: 'Suggested values per field with source (drafting module)',
        optionalCapability: true,
      },
      {
        name: 'assistant_start',
        method: 'POST',
        path: '/assistant/conversations',
        roles: ['REQUESTER', 'PROCUREMENT'],
        summary: 'Start the intake assistant (used when the drafting module is not available)',
      },
      {
        name: 'assistant_message',
        method: 'POST',
        path: '/assistant/conversations/:id/messages',
        roles: ['REQUESTER', 'PROCUREMENT'],
        summary: 'Send the request text to the intake assistant, which creates and fills the request',
      },
      {
        name: 'create_request',
        method: 'POST',
        path: '/requests',
        roles: ['REQUESTER', 'PROCUREMENT'],
        summary: 'Create a request',
      },
      {
        name: 'get_request',
        method: 'GET',
        path: '/requests/:id',
        roles: [
          'REQUESTER',
          'PROCUREMENT',
          'DELEGATE',
          'LEGAL',
          'CONTRACT_MGR',
          'PROBITY',
          'FINANCE',
          'EXEC',
        ],
        summary: 'Read the request and what is missing',
      },
      {
        name: 'patch_request',
        method: 'PATCH',
        path: '/requests/:id',
        roles: ['REQUESTER', 'PROCUREMENT'],
        summary: 'Fill request fields',
      },
      {
        name: 'submit_request',
        method: 'POST',
        path: '/requests/:id/submit',
        roles: ['REQUESTER', 'PROCUREMENT'],
        summary: 'Submit the request (budget check and routing run as for a person)',
      },
    ],
    mayNot: [...NEVER, 'invent an estimated value that the text does not give'],
  },
  {
    key: 'COMPLIANCE',
    label: 'Compliance',
    purpose:
      'Screens text for sensitive data, checks statutory windows and mandatory clauses, explains a refused check and proposes the remediation.',
    tools: [
      {
        name: 'classify_text',
        method: 'LOCAL',
        path: '(sensitive data rules, rules-simulated-v1)',
        roles: 'any',
        summary: 'Finds tax file numbers, cards, bank accounts and similar before text is used',
      },
      {
        name: 'get_tender',
        method: 'GET',
        path: '/tenders/:id',
        roles: ['PROCUREMENT', 'DELEGATE', 'EVALUATOR', 'CHAIR', 'LEGAL', 'PROBITY', 'EXEC', 'ADMIN'],
        summary: 'Read the tender to check windows and permissions',
      },
      {
        name: 'get_contract',
        method: 'GET',
        path: '/contracts/:id',
        roles: ['PROCUREMENT', 'LEGAL', 'CONTRACT_MGR', 'DELEGATE', 'EXEC', 'FINANCE', 'PROBITY'],
        summary: 'Read the contract and its checks',
      },
      {
        name: 'patch_contract_terms',
        method: 'PATCH',
        path: '/contracts/:id',
        roles: ['LEGAL', 'PROCUREMENT'],
        summary: 'Set missing dates or value',
      },
      {
        name: 'put_contract_clause',
        method: 'PUT',
        path: '/contracts/:id/clauses/:clauseId',
        roles: ['LEGAL'],
        summary: 'Fill an empty mandatory clause with the standard wording',
      },
    ],
    mayNot: [...NEVER, 'waive a failed compliance check', 'remove or weaken a protected clause'],
  },
  {
    key: 'WORKFLOW',
    label: 'Workflow',
    purpose:
      'Moves the procurement through plan, tender, evaluation set-up, award and contract, and works out who must approve each gate.',
    tools: [
      {
        name: 'open_plan',
        method: 'GET',
        path: '/requests/:id/plan',
        roles: ['REQUESTER', 'PROCUREMENT', 'DELEGATE', 'EVALUATOR', 'CHAIR', 'LEGAL', 'PROBITY', 'EXEC'],
        summary: 'Open (and if needed create) the plan',
      },
      {
        name: 'submit_plan',
        method: 'POST',
        path: '/plans/:id/submit-for-approval',
        roles: ['PROCUREMENT'],
        summary: 'Move the plan to approval',
      },
      {
        name: 'create_tender',
        method: 'POST',
        path: '/tenders',
        roles: ['PROCUREMENT'],
        summary: 'Stage the tender pack',
      },
      {
        name: 'publish_tender',
        method: 'POST',
        path: '/tenders/:id/publish',
        roles: ['PROCUREMENT'],
        summary: 'Publish once permission is given',
      },
      {
        name: 'list_evaluators',
        method: 'GET',
        path: '/evaluators',
        roles: ['PROCUREMENT'],
        summary: 'Candidates for the panel',
      },
      {
        name: 'open_evaluation',
        method: 'POST',
        path: '/tenders/:id/evaluation',
        roles: ['PROCUREMENT'],
        summary: 'Open the evaluation with a panel',
      },
      {
        name: 'generate_report',
        method: 'POST',
        path: '/evaluations/:id/report',
        roles: ['PROCUREMENT'],
        summary: 'Generate the evaluation report once consensus is locked',
      },
      {
        name: 'list_awards',
        method: 'GET',
        path: '/contracts/awards',
        roles: ['LEGAL', 'PROCUREMENT'],
        summary: 'Approved awards and the recommended supplier',
      },
      {
        name: 'draft_contract',
        method: 'POST',
        path: '/contracts',
        roles: ['LEGAL', 'PROCUREMENT'],
        summary: 'Draft the contract from the approved award',
      },
      {
        name: 'release_contract',
        method: 'POST',
        path: '/contracts/:id/release-for-signing',
        roles: ['LEGAL', 'PROCUREMENT'],
        summary: 'Release for signature once the checks pass',
      },
      {
        name: 'action_items',
        method: 'GET',
        path: '/action-items',
        roles: STAFF,
        summary: 'What is waiting for a person',
      },
    ],
    mayNot: [...NEVER, 'publish without the delegate permission', 'open sealed bids without two witnesses'],
  },
  {
    key: 'DOCFILL',
    label: 'Document filling',
    purpose:
      'Fills plan sections, tender documents and contract drafts from the record and the request text.',
    tools: [
      {
        name: 'draft_plan',
        method: 'POST',
        path: '/copilot/draft',
        roles: STAFF,
        summary: 'Draft plan or tender content (drafting module)',
        optionalCapability: true,
      },
      {
        name: 'apply_draft',
        method: 'POST',
        path: '/copilot/draft/:id/apply',
        roles: STAFF,
        summary: 'Write a draft into the real record as the acting user (drafting module)',
        optionalCapability: true,
      },
      {
        name: 'get_plan',
        method: 'GET',
        path: '/requests/:id/plan',
        roles: ['REQUESTER', 'PROCUREMENT', 'DELEGATE', 'EVALUATOR', 'CHAIR', 'LEGAL', 'PROBITY', 'EXEC'],
        summary: 'Read the plan sections',
      },
      {
        name: 'put_plan_field',
        method: 'PUT',
        path: '/plans/:id/fields/:key',
        roles: ['PROCUREMENT', 'REQUESTER'],
        summary: 'Write one plan section',
      },
    ],
    mayNot: [...NEVER, 'overwrite text a person wrote'],
  },
  {
    key: 'CONTRACT_DATA',
    label: 'Contract data',
    purpose:
      'Reads the executed contract, keeps key dates and reminders in view, and uses contract ingestion when it is available.',
    tools: [
      {
        name: 'get_contract',
        method: 'GET',
        path: '/contracts/:id',
        roles: ['PROCUREMENT', 'LEGAL', 'CONTRACT_MGR', 'DELEGATE', 'EXEC', 'FINANCE', 'PROBITY'],
        summary: 'Key dates, value, parties and clauses',
      },
      {
        name: 'contract_alerts',
        method: 'GET',
        path: '/contracts/:id/alerts',
        roles: ['CONTRACT_MGR', 'PROCUREMENT', 'LEGAL', 'EXEC'],
        summary: 'Reminders scheduled for the contract',
      },
      {
        name: 'ingest_batches',
        method: 'GET',
        path: '/contract-ingest/batches',
        roles: ['PROCUREMENT', 'LEGAL', 'CONTRACT_MGR', 'EXEC', 'ADMIN'],
        summary: 'Contract ingestion batches (OCR module)',
        optionalCapability: true,
      },
    ],
    mayNot: [...NEVER, 'commit extracted data without human review of low-confidence fields'],
  },
];

export const AGENT_BY_KEY = new Map(AGENTS.map((a) => [a.key, a]));
export const agentLabel = (k: string) => AGENT_BY_KEY.get(k as AgentKey)?.label ?? k;
export const STAGES = [
  { key: 'REQUEST', label: 'Request' },
  { key: 'PLAN', label: 'Plan' },
  { key: 'TENDER', label: 'Tender' },
  { key: 'EVALUATION', label: 'Evaluation' },
  { key: 'AWARD', label: 'Award' },
  { key: 'CONTRACT', label: 'Contract' },
] as const;
