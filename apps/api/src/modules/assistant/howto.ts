/**
 * "How do I ..." for the whole application (rules-simulated-v1). Each entry is a short, numbered procedure with links, the roles
 * who can do it, and the next step. When the signed-in person cannot do it, the answer says who can. The roles here mirror the
 * guards in the API (and a test checks that every link is a real page in the page guide).
 */
import type { RoleName } from '@if/shared';

export interface HowStep {
  text: string;
  href?: string;
}
export interface HowTo {
  id: string;
  title: string;
  /** Matched against the normalised question. */
  re: RegExp;
  /** Roles that can do it. */
  who: readonly RoleName[];
  steps: readonly HowStep[];
  next: string;
}

const REQ = '/app/requests';
export const HOWTOS: readonly HowTo[] = [
  {
    id: 'create-request',
    title: 'Create a request',
    re: /(create|raise|start|make|submit|new|open|log) (a |an |my )?(new )?(procurement )?(request|procurement|purchase)|how do i buy/,
    who: ['REQUESTER', 'PROCUREMENT'],
    steps: [
      { text: 'Open New request.', href: '/app/requests/new' },
      {
        text: 'Describe what you need in plain words (or speak it). The portal suggests the title, category, value and term.',
      },
      { text: 'Check each field. Anything marked missing must be filled in before you can submit.' },
      { text: 'Press "Submit request". The budget is checked at this point.' },
    ],
    next: 'Procurement triages it and builds the plan.',
  },
  {
    id: 'triage-request',
    title: 'Take a submitted request and assign a manager',
    re: /(take|triage|assign|pick up|own) (a |the |this )?(submitted )?(request|manager|procurement)/,
    who: ['PROCUREMENT'],
    steps: [
      { text: 'Open the request.', href: REQ },
      { text: 'Press "Take this request" so it is yours, or assign a manager.' },
      { text: 'Open its plan and start filling the sections.', href: '/app/plans' },
    ],
    next: 'Build the plan and submit it for approval.',
  },
  {
    id: 'build-plan',
    title: 'Build and submit a procurement plan',
    re: /(build|write|fill|edit|draft|create|complete|submit) (a |the |my )?(procurement )?plan/,
    who: ['PROCUREMENT'],
    steps: [
      { text: 'Open the request, then its plan.', href: '/app/plans' },
      {
        text: 'Fill every mandatory section (use "Edit" on a section, or ask for a change in plain language).',
      },
      { text: 'Declare any conflict of interest on the plan.' },
      { text: 'Press "Submit for approval".' },
    ],
    next: 'The probity officer signs off the risk gate, then a delegate approves.',
  },
  {
    id: 'approve-plan',
    title: 'Approve a plan',
    re: /(approve|sign off|decide on|authori[sz]e) (a |the |my )?(procurement )?plan|plan approval/,
    who: ['DELEGATE', 'EXEC'],
    steps: [
      { text: 'Open Approvals.', href: '/app/approvals' },
      { text: 'Open the plan and read its sections, checks and value.' },
      {
        text: 'Press "Approve and lock". The value must be within your sourcing approval limit, and you cannot approve a plan you wrote.',
      },
    ],
    next: 'The plan is locked and procurement creates the tender pack.',
  },
  {
    id: 'risk-signoff',
    title: 'Sign off the risk gate on a plan',
    re: /(risk|probity) (sign.?off|gate)|sign off (the )?risk/,
    who: ['PROBITY'],
    steps: [
      { text: 'Open the Probity portal.', href: '/app/probity' },
      { text: 'Open the plan that is waiting for sign-off and read the risk assessment.' },
      { text: 'Record the sign-off.' },
    ],
    next: 'The plan goes to a delegate for approval.',
  },
  {
    id: 'create-tender',
    title: 'Create a tender pack',
    re: /(create|build|stage|prepare|write) (a |the |my )?(tender|rfp|rfq|tender pack)/,
    who: ['PROCUREMENT'],
    steps: [
      { text: 'Open the approved plan.', href: '/app/plans' },
      { text: 'Press "Create tender pack". The pack is staged, not yet visible to suppliers.' },
      { text: 'Review and edit the pack.', href: '/app/tenders' },
    ],
    next: 'A delegate gives permission to publish.',
  },
  {
    id: 'publish-permission',
    title: 'Give permission to publish a tender',
    re: /(give|grant) (permission|approval)( to publish)?|permission to publish/,
    who: ['DELEGATE', 'EXEC'],
    steps: [
      { text: 'Open the tender.', href: '/app/tenders' },
      { text: 'Press "Review and give permission". You cannot grant permission for a pack you built.' },
      { text: 'Press "Give permission to publish". Your publish limit must cover the value.' },
    ],
    next: 'A procurement officer can publish.',
  },
  {
    id: 'publish-tender',
    title: 'Publish a tender',
    re: /publish (a |the |my )?(tender|pack|rfp|rfq)|release (the )?tender|go to market/,
    who: ['PROCUREMENT'],
    steps: [
      { text: 'Open the staged tender.', href: '/app/tenders' },
      { text: 'Check that permission to publish has been given.' },
      { text: 'Choose a closing time at least the statutory minimum from now.' },
      { text: 'Press "Publish tender".' },
    ],
    next: 'Suppliers respond until the closing time.',
  },
  {
    id: 'respond-tender',
    title: 'Respond to a tender',
    re: /\b(respond to|reply to|bid (for|on)|submit (a |my |the )?(bid|response|tender response)|tender response|respond)\b/,
    who: ['SUPPLIER'],
    steps: [
      { text: 'Open My tenders.', href: '/supplier' },
      { text: 'Open the tender, read the pack and ask any questions before the close.' },
      { text: 'Answer the response form and upload your documents.' },
      { text: 'Press "Submit bid" before the closing time. You can withdraw until it closes.' },
    ],
    next: 'The buyer evaluates after the close; you are told the outcome.',
  },
  {
    id: 'open-bids',
    title: 'Open sealed bids (witness)',
    re: /(open|unseal) (the )?(sealed )?bids?|witness|bid opening/,
    who: ['PROBITY', 'LEGAL', 'DELEGATE', 'EXEC', 'PROCUREMENT'],
    steps: [
      { text: 'Open the closed tender.', href: '/app/tenders' },
      { text: 'Find "Open the bids" and confirm with your own password.' },
      {
        text: 'A second, different witness confirms too. Neither may have raised the request or sit on the panel.',
      },
    ],
    next: 'The bids are unsealed and procurement sets up the evaluation.',
  },
  {
    id: 'setup-evaluation',
    title: 'Set up an evaluation',
    re: /(set up|setup|open|start|create) (an |the )?evaluation|name (the )?panel|evaluation panel/,
    who: ['PROCUREMENT'],
    steps: [
      { text: 'Open the closed tender.', href: '/app/tenders' },
      { text: 'Press "Set up the evaluation".' },
      {
        text: 'Name the panel: a technical and a commercial evaluator, not the requester, and not anyone linked to a bidder.',
      },
    ],
    next: 'The panel declares conflicts of interest, then scores.',
  },
  {
    id: 'declare-coi',
    title: 'Declare a conflict of interest',
    re: /(declare|record|submit) (a |my |the )?(conflict|coi|declaration)|conflict of interest declaration/,
    who: ['EVALUATOR', 'CHAIR', 'PROCUREMENT'],
    steps: [
      { text: 'Open Evaluations (or the plan, for a plan declaration).', href: '/app/evaluations' },
      { text: 'Open the evaluation you are on.' },
      {
        text: 'Say whether you have a conflict, and press "Submit declaration". Do this before you look at any bid.',
      },
    ],
    next: 'When everyone has declared, scoring opens.',
  },
  {
    id: 'score-bids',
    title: 'Score bids',
    re: /(score|scoring|assess|mark|evaluate) (the |a |my )?(bids?|tenders?|responses?)|how do i score/,
    who: ['EVALUATOR', 'CHAIR'],
    steps: [
      { text: 'Open Evaluations.', href: '/app/evaluations' },
      { text: 'Open the evaluation you are on. Your conflict declaration must be done first.' },
      { text: 'Score each bid against every criterion on your own. Other scores stay hidden.' },
      { text: 'Press "Mark my scoring complete".' },
    ],
    next: 'When everyone has scored, the chair opens consensus.',
  },
  {
    id: 'consensus',
    title: 'Run consensus',
    re: /consensus|lock (the )?scores/,
    who: ['CHAIR'],
    steps: [
      { text: 'Open the evaluation.', href: '/app/evaluations' },
      { text: 'Press "Open consensus".' },
      { text: 'Agree each score with the panel (variances are flagged) and press "Save consensus".' },
      { text: 'Press "Lock consensus".' },
    ],
    next: 'A procurement officer generates the report.',
  },
  {
    id: 'evaluation-report',
    title: 'Generate the evaluation report',
    re: /(generate|create|write|produce) (the |an )?(evaluation )?report/,
    who: ['PROCUREMENT'],
    steps: [
      { text: 'Open the evaluation once consensus is locked.', href: '/app/evaluations' },
      { text: 'Press "Generate report" and read it.' },
    ],
    next: 'Probity releases the result and a delegate approves the award.',
  },
  {
    id: 'award',
    title: 'Award (approve the evaluation report)',
    re: /\baward\b|(approve|decide on) (the |an )?(evaluation )?(report|recommendation)/,
    who: ['DELEGATE', 'EXEC'],
    steps: [
      { text: 'Open Approvals.', href: '/app/approvals' },
      { text: 'Open the evaluation and read the report and the recommended supplier.' },
      { text: 'Press "Approve report". The value must be within your sourcing limit.' },
    ],
    next: 'Legal or procurement drafts the contract from the award.',
  },
  {
    id: 'draft-contract',
    title: 'Draft a contract from an award',
    re: /(draft|create|prepare) (a |the |my )?contract/,
    who: ['LEGAL', 'PROCUREMENT'],
    steps: [
      { text: 'Open the approved evaluation.', href: '/app/evaluations' },
      { text: 'Press "Draft the contract with" the recommended supplier.' },
      { text: 'Open the contract and edit the clauses.', href: '/app/contracts' },
    ],
    next: 'Legal reviews it and releases it for signing.',
  },
  {
    id: 'legal-review',
    title: 'Review a contract and release it for signing',
    re: /(review|release) (a |the )?contract|release for signing|legal review/,
    who: ['LEGAL'],
    steps: [
      { text: 'Open the contract.', href: '/app/contracts' },
      { text: 'Review the clauses; fill any empty mandatory clause and the start and end dates.' },
      { text: 'Press "Release for signing".' },
    ],
    next: 'A delegate or executive signs.',
  },
  {
    id: 'sign-contract',
    title: 'Sign a contract',
    re: /sign (a |the |my )?contract|how do i sign|signing/,
    who: ['DELEGATE', 'EXEC'],
    steps: [
      { text: 'Open the contract that was released for signing.', href: '/app/contracts' },
      {
        text: 'Read it, then press "Sign contract". You need a contract signing limit that covers the value; sourcing approval is a separate grant.',
      },
    ],
    next: 'The contract is executed and the contract manager takes over.',
  },
  {
    id: 'invoice',
    title: 'Deal with an invoice',
    re: /invoice|blocked payment|three.?way/,
    who: ['FINANCE', 'CONTRACT_MGR', 'EXEC'],
    steps: [
      { text: 'Open Invoices.', href: '/app/contracts/invoices' },
      { text: 'Open the blocked invoice and read the mismatch.' },
      {
        text: 'Fix the mismatch, or override with a reason (finance or an executive). Only finance marks it paid.',
      },
    ],
    next: 'A paid invoice counts against the contract spend.',
  },
  {
    id: 'variation',
    title: 'Raise a contract variation',
    re: /(raise|create|add|make) (a |the )?(contract )?variation|extend (a |the )?contract|renew (a |the )?contract/,
    who: ['CONTRACT_MGR', 'PROCUREMENT'],
    steps: [
      { text: 'Open the contract.', href: '/app/contracts' },
      { text: 'Add the variation with its value and reason.' },
      { text: 'Record any disclosure task it creates.', href: '/app/contracts/disclosures' },
    ],
    next: 'A changed value still needs someone with signing authority.',
  },
  {
    id: 'import-data',
    title: 'Import data',
    re: /(import|migrate|bring in|upload) (my |the |some |legacy )?(data|records|contracts|file|spreadsheet|csv)|data migration/,
    who: ['ADMIN'],
    steps: [
      { text: 'Open Data migration.', href: '/admin/migration' },
      { text: 'Open Import and choose the file; map its columns.', href: '/admin/migration/import' },
      { text: 'Run the checks and fix the rows that fail.' },
      { text: 'Apply the import. Imported records carry a "migrated" flag.' },
    ],
    next: 'Open Contracts to check the imported records.',
  },
  {
    id: 'use-ocr',
    title: 'Read existing contracts with OCR',
    re: /\bocr\b|scan(ned)? (a |the )?contract|ingest|read (an |the )?(existing )?contract (file|pdf)/,
    who: ['LEGAL', 'CONTRACT_MGR', 'PROCUREMENT', 'EXEC', 'FINANCE', 'PROBITY'],
    steps: [
      { text: 'Open Contract ingestion.', href: '/app/contracts/ingest' },
      { text: 'Upload one or more contract files as a batch.' },
      { text: 'Open each document and confirm or correct the extracted fields (the confidence is shown).' },
      { text: 'Create the contract record. Reminders are created from the dates.' },
    ],
    next: 'Check the ingestion report.',
  },
  {
    id: 'change-settings',
    title: 'Change settings',
    re: /(change|edit|update|set|configure) (the |a |my )?(settings?|numbering|custom fields?|labels?|checkpoints?|notifications?)|where (are|is) (the )?settings/,
    who: ['ADMIN'],
    steps: [
      { text: 'Open Settings.', href: '/admin/settings' },
      {
        text: 'Choose the area (numbering, labels, custom fields, checkpoints, intake rules, notifications, routing).',
      },
      { text: 'Make the change and press the Save button for that area.' },
    ],
    next: 'New records use the change straight away; it is in the audit trail.',
  },
  {
    id: 'users-roles',
    title: 'Add a user or change a role',
    re: /(add|create|invite|deactivate|remove) (a |the )?user|(assign|give|change|remove) (a |the )?role/,
    who: ['ADMIN'],
    steps: [
      { text: 'Open Users and roles.', href: '/admin/users' },
      { text: 'Create the user, or open the person and change their roles.' },
      { text: 'Send or confirm the activation link.' },
    ],
    next: 'Set their approval limits in Delegations if they approve or sign.',
  },
  {
    id: 'delegations',
    title: 'Set approval and signing limits',
    re: /(set|change|give|grant|raise) (a |the |an )?(approval |signing |sourcing )?(limit|delegation)/,
    who: ['ADMIN'],
    steps: [
      { text: 'Open Delegations.', href: '/admin/delegations' },
      {
        text: 'Choose the person, the scope (sourcing, publish permission or contract signing) and the dollar limit.',
      },
      { text: 'Press "Save limit". It takes effect at once and is audited.' },
    ],
    next: 'The person can approve or sign up to that limit.',
  },
  {
    id: 'run-copilot',
    title: 'Run a procurement with the Copilot',
    re: /(run|start|use|launch) (a |the |my )?(procurement )?(copilot|agent)|run this for me/,
    who: ['REQUESTER', 'PROCUREMENT'],
    steps: [
      { text: 'Open Procurement Copilot.', href: '/app/copilot' },
      { text: 'Describe the procurement and press Start.' },
      { text: 'Watch the run. When it waits for a person, open the card and press "What do I do?".' },
    ],
    next: 'It carries the procurement from request to contract, stopping at every approval.',
  },
  {
    id: 'draft-ai',
    title: 'Draft a document by typing or speaking',
    re: /(draft|write|dictate|speak) (a |the )?(document|request|plan|job spec|specification|criteria)|draft with ai/,
    who: ['REQUESTER', 'PROCUREMENT', 'DELEGATE', 'LEGAL', 'CONTRACT_MGR', 'EXEC'],
    steps: [
      { text: 'Open Draft with AI.', href: '/app/copilot/draft' },
      { text: 'Pick the kind of document and type or speak what you need.' },
      { text: 'Ask for changes in plain language; the before and after is shown.' },
      { text: 'Apply the draft to a record.' },
    ],
    next: 'Continue on the record it created.',
  },
  {
    id: 'ask-report',
    title: 'Get a report',
    re: /(get|run|ask for|see|export) (a |the |my )?report|report on/,
    who: ['EXEC', 'FINANCE', 'PROCUREMENT', 'CONTRACT_MGR', 'DELEGATE', 'LEGAL', 'PROBITY'],
    steps: [
      { text: 'Open Ask for a report.', href: '/app/reports/ask' },
      { text: 'Type your question, for example "contracts expiring in 90 days".' },
      { text: 'Open the result and save the view if you will use it again.' },
    ],
    next: 'Open the records behind a figure to act on them.',
  },
  {
    id: 'audit',
    title: 'Find who did what',
    re: /audit trail|who did (what|this)|find (the )?audit/,
    who: ['PROBITY', 'ADMIN', 'EXEC', 'PROCUREMENT'],
    steps: [
      { text: 'Open the Audit trail.', href: '/app/audit' },
      { text: 'Search by person, action or record, and export the results if needed.' },
    ],
    next: 'Take any follow-up to the record concerned.',
  },
  {
    id: 'mfa',
    title: 'Set up multi-factor sign-in',
    re: /\bmfa\b|authenticator|two.?factor|change (my )?password|2fa/,
    who: [
      ...([
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
      ] as RoleName[]),
    ],
    steps: [
      { text: 'Open Security.', href: '/app/security' },
      { text: 'Choose "Set up an authenticator app" and scan the code.' },
      { text: 'Enter the code it shows to confirm.' },
    ],
    next: 'You are asked for the code at the next sign-in.',
  },
];

export const HOWTO_CUE =
  /\b(how (do|can|should|would|could|might) (i|we|you)|how to|what are the steps|steps (to|for)|walk me through|show me how|guide me|help me (to )?(create|raise|approve|publish|score|sign|import|set|change|add|run|draft|find|get|submit|open|declare|use))\b/;

export function matchHowTo(normalised: string): HowTo | null {
  return HOWTOS.find((h) => h.re.test(normalised)) ?? null;
}
