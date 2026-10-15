/**
 * The page guide behind "Ask" (rules-simulated-v1). One entry per screen of the application: what the page is for, what a
 * person can do there and who may, the next step in the procurement lifecycle, and where to go from it. Who may OPEN a page is
 * not repeated here: it comes from the route rules in ./access.ts, so the guide cannot disagree with the guard.
 *
 * A unit test (apps/web/src/lib/page-guide.test.ts) walks every page file of the web app and every navigation item and fails
 * when a screen has no entry, so a new page cannot ship without a guide entry.
 */
import { rolesForPath, type RoleName } from './access.js';

export interface GuideLink {
  label: string;
  href: string;
}
export interface GuideAction {
  text: string;
  /** Who can do it, when that is narrower than everyone who can open the page. */
  who?: readonly RoleName[];
}
export interface PageGuideEntry {
  /** The route as the web app names it, for example `/app/requests/[id]`. */
  route: string;
  title: string;
  purpose: string;
  can: readonly GuideAction[];
  /** The next step in the lifecycle once this page's work is done. */
  next: string;
  links: readonly GuideLink[];
  /** What kind of record the page shows, when the route carries an id. */
  entity?: EntityType;
}

export type EntityType =
  'request' | 'plan' | 'tender' | 'evaluation' | 'contract' | 'supplier' | 'copilot-run';

export interface PageContext {
  path: string;
  entityType?: EntityType;
  entityId?: string;
}

const UUID = '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})';
const ENTITY_ROUTES: ReadonlyArray<[EntityType, RegExp]> = [
  ['request', new RegExp(`^/app/requests/${UUID}(?:/|$)`)],
  ['plan', new RegExp(`^/app/plans/${UUID}(?:/|$)`)], // the plan page is keyed by its request id
  ['tender', new RegExp(`^/app/tenders/${UUID}(?:/|$)`)],
  ['evaluation', new RegExp(`^/app/evaluations/${UUID}(?:/|$)`)],
  ['contract', new RegExp(`^/app/contracts/${UUID}(?:/|$)`)],
  ['supplier', new RegExp(`^/app/suppliers/${UUID}(?:/|$)`)],
  ['copilot-run', new RegExp(`^/app/copilot/${UUID}(?:/|$)`)],
  ['contract', new RegExp(`^/supplier/contracts/${UUID}(?:/|$)`)],
  ['tender', new RegExp(`^/supplier/tenders/${UUID}(?:/|$)`)],
];

/** Works out the page context from a path: the route and, where the path carries one, the record's id. Never trusts a client's claim of the type. */
export function parsePageContext(rawPath: string | null | undefined): PageContext | null {
  if (!rawPath) return null;
  const path = rawPath.split(/[?#]/)[0]!.replace(/\/+$/, '') || '/';
  if (!path.startsWith('/')) return null;
  for (const [type, re] of ENTITY_ROUTES) {
    const m = re.exec(path);
    if (m) return { path, entityType: type, entityId: m[1]!.toLowerCase() };
  }
  return { path };
}

const STAFF_ALL: readonly RoleName[] = [
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

type Can = string | [string, readonly RoleName[]];
const L = (label: string, href: string): GuideLink => ({ label, href });
const entry = (
  route: string,
  title: string,
  purpose: string,
  can: readonly Can[],
  next: string,
  links: readonly GuideLink[] = [],
  entity?: EntityType,
): PageGuideEntry => ({
  route,
  title,
  purpose,
  can: can.map((c) => (typeof c === 'string' ? { text: c } : { text: c[0], who: c[1] })),
  next,
  links,
  ...(entity ? { entity } : {}),
});

const REQ = L('Requests', '/app/requests');
const PLANS = L('Procurement plans', '/app/plans');
const TENDERS = L('Tenders', '/app/tenders');
const EVALS = L('Evaluations', '/app/evaluations');
const CONTRACTS = L('Contracts', '/app/contracts');
const APPROVALS = L('Approvals', '/app/approvals');
const COPILOT = L('Procurement Copilot', '/app/copilot');
const ADMIN = L('Admin overview', '/admin');
const DASH = L('Dashboard', '/app/dashboard');

/** Every screen. Keep the route spelled exactly as the folder under apps/web/src/app (without route groups). */
export const PAGE_GUIDE: readonly PageGuideEntry[] = [
  // ------------------------------------------------------------------ overview
  entry(
    '/app/dashboard',
    'Dashboard',
    'Your starting point: what needs your attention and the overview for your role, with your open action items.',
    [
      'See the items waiting for you and open each one',
      'Read the figures for your role (spend, workload, approvals)',
      ['Open My dashboard to choose and order your own widgets', STAFF_ALL],
    ],
    'Open the first item that needs you, usually Actions or Approvals.',
    [L('Actions waiting for you', '/app/actions'), L('My dashboard', '/app/dashboard/my'), REQ],
  ),
  entry(
    '/app/dashboard/my',
    'My dashboard',
    'Your own dashboard: choose, order, size and style the widgets, within what your role may see.',
    ['Add, remove, reorder and resize widgets', 'Reset to the default for your role'],
    'Go back to the dashboard to use it.',
    [DASH],
  ),
  entry(
    '/app/dashboards',
    'Role dashboards',
    'The standard dashboard of each role (procurement, legal, delegate, executive, finance, probity, contract manager).',
    ['Pick a role view and read its figures', 'Open any figure to see the records behind it'],
    'Open the records behind a figure to act on them.',
    [DASH],
  ),
  entry(
    '/app/actions',
    'Actions waiting for you',
    'Everything waiting for you in one list, including what the Procurement Copilot is waiting for you to decide.',
    [
      'Open an item to go to the page where it is done',
      'For a Copilot item, read the "What to do" line and follow the steps',
    ],
    'When you act, the item closes; if it was a Copilot item, press Advance now on the run so it carries on.',
    [COPILOT, APPROVALS],
  ),
  entry(
    '/app/search',
    'Search',
    'Search across the records you may see; an outside source is used only if your organisation allows it.',
    ['Search by reference number, title, supplier or contract', 'Open a result'],
    'Open the record you found and act there.',
    [REQ, CONTRACTS],
  ),
  entry(
    '/app/m',
    'Mobile home',
    'A phone-sized home with your actions and your notes taken during supplier reviews.',
    ['Open your actions', 'Add a note during a supplier review'],
    'Open an action to do it on your phone.',
    [L('Actions waiting for you', '/app/actions')],
  ),
  entry(
    '/app/roadmap',
    'Roadmap',
    'Everything the proof of concept does not do yet, with the requirement id each belongs to.',
    ['Filter by status or area', 'Open the area a requirement belongs to'],
    'Nothing to action here; it is read only.',
    [],
  ),
  entry(
    '/app/security',
    'Security',
    'Your sign-in security: set up or change multi-factor authentication and review your sessions.',
    ['Set up an authenticator app', 'Change your password', 'Sign out other sessions'],
    'Return to your work; MFA applies at the next sign-in.',
    [DASH],
  ),
  entry(
    '/app/privacy',
    'Privacy',
    'The collection notice, and a way to ask to see or correct the personal information held about you.',
    ['Read the notice', 'Raise an access or correction request'],
    'The privacy team answers the request by its due date.',
    [L('Privacy requests', '/app/privacy/manage')],
  ),
  entry(
    '/app/privacy/manage',
    'Privacy requests',
    'Access and correction requests with due dates, AI conversation retention, legal holds and the notice text.',
    ['Work an access or correction request', 'Set retention and place a legal hold', 'Edit the notice text'],
    'Close each request before its due date.',
    [L('Privacy', '/app/privacy')],
  ),
  // ------------------------------------------------------------------ procure
  entry(
    '/app/requests',
    'Requests',
    'Procurement requests you may see. Each one carries its phase, documents and the plan, tender and contract that follow.',
    [
      ['Raise a new request', ['REQUESTER', 'PROCUREMENT']],
      'Open a request to see its status and what is missing',
      ['Take a submitted request and assign a manager', ['PROCUREMENT']],
    ],
    'Open a request; once it is submitted the plan is the next step.',
    [L('New request', '/app/requests/new'), PLANS],
  ),
  entry(
    '/app/requests/new',
    'New request',
    'Raise a request: describe the need, then confirm the title, category, value, term and business unit. The portal suggests what it can work out and checks the budget.',
    [
      ['Describe the need in plain words or by voice', ['REQUESTER', 'PROCUREMENT']],
      ['Fix any field marked missing and press Submit request', ['REQUESTER', 'PROCUREMENT']],
    ],
    'After Submit request, procurement triages it and builds the plan.',
    [REQ, L('Draft with AI', '/app/copilot/draft')],
  ),
  entry(
    '/app/requests/[id]',
    'Request',
    'One request: its status and phase, the fields and which are missing, the gates it needs, and its progress through plan, tender, evaluation and contract.',
    [
      ['Edit the fields and submit a draft', ['REQUESTER', 'PROCUREMENT']],
      ['Take the request and open its plan', ['PROCUREMENT']],
      'Follow the progress strip to the plan, tender, evaluation or contract',
    ],
    'Once submitted, the plan is built and approved before any tender.',
    [REQ, PLANS],
    'request',
  ),
  entry(
    '/app/plans',
    'Procurement plans',
    'Plans for the requests you may see. A plan is drafted from the request, checked, signed off at the risk gate and approved by a delegate.',
    ['Open a plan to read or edit its sections', ['Submit a finished plan for approval', ['PROCUREMENT']]],
    'An approved plan is locked and the tender can be created from it.',
    [REQ, APPROVALS],
  ),
  entry(
    '/app/plans/[requestId]',
    'Procurement plan',
    'The plan for one request: sections, checks, conflict-of-interest declaration, risk sign-off and approval. An approved plan is locked until reopened.',
    [
      ['Edit sections and press Submit for approval', ['PROCUREMENT']],
      ['Declare conflicts of interest on the plan', ['PROCUREMENT']],
      ['Sign off the risk gate', ['PROBITY']],
      ['Approve and lock the plan within your sourcing limit', ['DELEGATE', 'EXEC']],
    ],
    'After approval, procurement stages the tender pack.',
    [REQ, TENDERS, APPROVALS],
    'plan',
  ),
  entry(
    '/app/copilot',
    'Procurement Copilot',
    'An agent that carries a procurement from request to contract and stops at every gate a person must decide (simulated, rules-simulated-v1). Start a run or open one.',
    [
      ['Describe a procurement and press Start to begin a run', ['REQUESTER', 'PROCUREMENT']],
      'Open a run to see what it is waiting for',
    ],
    'Open a run that is waiting and press "What do I do?" to be told where to go.',
    [L('Draft with AI', '/app/copilot/draft'), L('Actions waiting for you', '/app/actions')],
  ),
  entry(
    '/app/copilot/[id]',
    'Copilot run',
    'One Copilot run: the stage timeline, the live activity, what it is waiting for and who must act, and the problems it tried to repair.',
    [
      'Read each Waiting for card and press What do I do? for the steps',
      ['Pause, resume, cancel or press Advance now', ['PROCUREMENT', 'REQUESTER', 'ADMIN']],
      'Open the page where the waiting person acts',
    ],
    'After the person acts, press Advance now (or wait up to a few seconds) and the run carries on.',
    [COPILOT, L('Actions waiting for you', '/app/actions')],
    'copilot-run',
  ),
  entry(
    '/app/copilot/draft',
    'Draft with AI',
    'Describe a need by typing or speaking and get a request, plan, job specification, tender document, contract draft or evaluation criteria; change it in plain language with a before and after (simulated).',
    [
      'Pick the kind of document and describe it',
      'Ask for a change and check the before and after',
      'Apply the draft to a record',
    ],
    'Apply the draft, then continue on the record it created.',
    [REQ, COPILOT],
  ),
  entry(
    '/app/approvals',
    'Approvals',
    'Everything waiting for your decision. A plan above your sourcing limit is refused with the reason, and you cannot approve your own work.',
    [
      ['Review and decide on a plan', ['DELEGATE', 'EXEC']],
      ['Review and give permission to publish a tender', ['DELEGATE', 'EXEC']],
      ['Approve an evaluation report', ['DELEGATE', 'EXEC']],
    ],
    'Approved plans go to the tender; approved reports go to contract drafting.',
    [PLANS, TENDERS, EVALS],
  ),
  entry(
    '/app/tenders',
    'Tenders',
    'Tender packs and supplier responses. A pack stays staged until a delegate gives permission to publish.',
    [
      ['Create a tender pack from an approved plan', ['PROCUREMENT']],
      ['Give permission to publish', ['DELEGATE', 'EXEC']],
      ['Publish a staged tender', ['PROCUREMENT']],
    ],
    'After the close date the bids are opened and an evaluation is set up.',
    [PLANS, EVALS],
  ),
  entry(
    '/app/tenders/[id]',
    'Tender',
    'One tender: the pack, its status, permission to publish, invitations, supplier questions, bids and the opening of sealed bids.',
    [
      ['Edit the pack and press Create tender pack or Publish tender', ['PROCUREMENT']],
      ['Review and give permission to publish (not the pack author)', ['DELEGATE', 'EXEC']],
      ['Answer supplier questions', ['PROCUREMENT']],
      ['Confirm as a witness to open sealed bids', ['PROBITY', 'LEGAL', 'DELEGATE', 'EXEC', 'PROCUREMENT']],
    ],
    'After the tender closes and bids are opened, procurement opens the evaluation.',
    [TENDERS, EVALS],
    'tender',
  ),
  entry(
    '/app/evaluations',
    'Evaluations',
    'Evaluation panels and scoring. Scores are sealed until the panel finishes, and probity releases the result.',
    [
      'Open an evaluation you are on or may oversee',
      ['Open an evaluation for a closed tender', ['PROCUREMENT']],
    ],
    'When the report is approved the contract is drafted.',
    [TENDERS, CONTRACTS],
  ),
  entry(
    '/app/evaluations/[id]',
    'Evaluation',
    'One evaluation: panel and conflict declarations, independent scoring, consensus, the report and the award decision.',
    [
      ['Submit your conflict declaration', ['EVALUATOR', 'CHAIR']],
      ['Score each bid and press Mark my scoring complete', ['EVALUATOR', 'CHAIR']],
      ['Open consensus and Lock consensus', ['CHAIR']],
      ['Generate the report', ['PROCUREMENT']],
      ['Approve the report (award)', ['DELEGATE', 'EXEC']],
      ['Release or hold the result', ['PROBITY']],
    ],
    'After the award is approved, legal drafts the contract.',
    [EVALS, CONTRACTS],
    'evaluation',
  ),
  entry(
    '/app/buy',
    'Guided buying',
    'Buy everyday goods from the approved catalogue, or describe a need and see a recommendation. Nothing is ordered by the platform; approving only drafts a request.',
    ['Choose from the catalogue', 'Describe a need and read the recommendation', 'Draft a request from it'],
    'The drafted request goes through the usual checks.',
    [REQ],
  ),
  // ------------------------------------------------------------------ contracts
  entry(
    '/app/contracts',
    'Contracts',
    'Contracts you can see: draft, legal review, signature and executed. Open one for obligations, variations, spend and alerts.',
    [
      'Open a contract',
      'Search contracts and filter by status',
      ['Raise a variation', ['CONTRACT_MGR', 'PROCUREMENT']],
    ],
    'Executed contracts are managed through obligations, alerts, invoices and renewals.',
    [L('Expiring contracts', '/app/contracts/expiring'), L('Invoices', '/app/contracts/invoices')],
  ),
  entry(
    '/app/contracts/[id]',
    'Contract',
    'One contract: status, parties, value, clauses, drafts, signing, obligations, spend and alerts.',
    [
      ['Draft the contract and edit clauses', ['LEGAL', 'PROCUREMENT']],
      ['Review as legal and press Release for signing', ['LEGAL']],
      ['Sign the contract within your signing limit', ['DELEGATE', 'EXEC']],
      ['Add obligations and alerts, raise a variation', ['CONTRACT_MGR', 'PROCUREMENT']],
    ],
    'Once executed it is managed by the contract manager until it ends or is renewed.',
    [CONTRACTS, L('Invoices', '/app/contracts/invoices')],
    'contract',
  ),
  entry(
    '/app/contracts/mine',
    'My contracts',
    'The contracts you own or can search, with filters.',
    ['Search and filter', 'Open a contract'],
    'Open a contract to act.',
    [CONTRACTS],
  ),
  entry(
    '/app/contracts/expiring',
    'Expiring contracts',
    'Contracts approaching their end, so you can renew, extend or let them lapse in time.',
    ['Open a contract and decide to renew, extend or retire it'],
    'Start the renewal or a new procurement before the end date.',
    [CONTRACTS, REQ],
  ),
  entry(
    '/app/contracts/alerts',
    'Contract alerts',
    'Contract alerts. Countdown, insurance and spend alerts are fixed and cannot be muted; others follow your preferences.',
    ['Open the contract an alert is about', 'Acknowledge an alert', 'Set your alert preferences'],
    'Fix the cause on the contract and the alert closes.',
    [CONTRACTS],
  ),
  entry(
    '/app/contracts/invoices',
    'Invoices',
    'Invoices are matched three ways against the purchase order and what was received. Blocked invoices need finance to resolve or override.',
    [
      ['Record an invoice', ['FINANCE', 'CONTRACT_MGR']],
      ['Override a blocked invoice with a reason', ['FINANCE', 'EXEC']],
      ['Mark an invoice paid', ['FINANCE']],
    ],
    'Paid invoices count against the contract spend.',
    [CONTRACTS],
  ),
  entry(
    '/app/contracts/disclosures',
    'Disclosures',
    'Disclosure tasks created when a variation passes the disclosure threshold.',
    ['Record a disclosure', 'Open the contract it belongs to'],
    'Close each task by its due date.',
    [CONTRACTS],
  ),
  entry(
    '/app/contracts/masters',
    'Master agreements',
    'Master agreements set terms once; work orders call on them for specific pieces of work.',
    ['Open a master agreement', 'Raise a work order against it'],
    'Work orders follow the master terms.',
    [CONTRACTS],
  ),
  entry(
    '/app/contracts/deleted',
    'Deleted contracts',
    'Contracts that were deleted and can still be recovered by those who may.',
    ['Review a deleted contract', 'Restore it'],
    'A restored contract returns to the contract list.',
    [CONTRACTS],
  ),
  entry(
    '/app/contracts/ingest',
    'Contract ingestion (OCR)',
    'Read existing contracts: extract dates, value, parties and clauses with confidence, review them, then create the record and reminders (simulated OCR).',
    [
      'Upload one or more contract files as a batch',
      'Open a document and confirm or correct each extracted field',
      'Create the contract record from the reviewed document',
    ],
    'Review the ingestion report, then manage the new contracts.',
    [L('Ingestion report', '/app/contracts/ingest/report'), CONTRACTS],
  ),
  entry(
    '/app/contracts/ingest/documents/[id]',
    'Ingested document',
    'One scanned contract: the extracted fields with confidence, the source text and what still needs a person.',
    ['Confirm or correct a field', 'Create the contract record'],
    'Once confirmed, the contract record and reminders exist.',
    [L('Contract ingestion', '/app/contracts/ingest')],
  ),
  entry(
    '/app/contracts/ingest/report',
    'Ingestion report',
    'The result of the ingestion batches: counts, accuracy and what was created.',
    ['Review the batch results', 'Open any document that needs review'],
    'Fix the flagged documents, then create their records.',
    [L('Contract ingestion', '/app/contracts/ingest')],
  ),
  entry(
    '/app/envelopes',
    'Funding envelopes',
    'An allocated envelope a delegate approves once, against which nominated people approve commitments, with a warning as it runs out.',
    [
      ['Create an envelope', ['DELEGATE', 'EXEC']],
      'Approve a commitment against it (if nominated)',
      'Watch what remains',
    ],
    'Commitments draw the envelope down as procurements proceed.',
    [REQ],
  ),
  entry(
    '/app/suppliers',
    'Suppliers',
    'The supplier directory: onboarding status, sanctions and insurance.',
    ['Open a supplier', 'Request an updated certificate', 'Review onboarding'],
    'Approved suppliers can be invited to tenders.',
    [TENDERS],
  ),
  entry(
    '/app/suppliers/[id]',
    'Supplier',
    'One supplier: profile, contacts, sanctions and insurance status, the tenders and contracts they are in.',
    ['Review the sanctions and insurance status', 'Open a tender or contract they are in'],
    'Resolve any risk flag before awarding to them.',
    [L('Suppliers', '/app/suppliers'), L('Supplier risk map', '/app/reports/supplier-risk')],
    'supplier',
  ),
  entry(
    '/app/legal',
    'Legal desk',
    'A board of legal matters, review hours and the knowledge base legal keeps for the platform.',
    ['Open or create a matter', 'Log review hours', 'Maintain knowledge articles'],
    'Contract reviews continue from the contract page.',
    [CONTRACTS],
  ),
  entry(
    '/app/probity',
    'Probity portal',
    'Read-only oversight of the procurements you are allocated to, with a system hold and the probity documents.',
    [
      ['Place or release a hold', ['PROBITY']],
      ['Sign off the risk gate on a plan', ['PROBITY']],
      'Read the probity documents',
    ],
    'Sign-offs release the plan to the approver.',
    [PLANS, EVALS],
  ),
  entry(
    '/app/audit',
    'Audit trail',
    'Searchable, exportable evidence of who did what and when. It cannot be edited.',
    ['Search by person, action or record', 'Export the results'],
    'Read only; take any follow-up to the record concerned.',
    [L('Audit chain', '/app/audit-chain')],
  ),
  entry(
    '/app/audit-chain',
    'Audit chain',
    'Check that the administrative history has not been altered; a person other than an administrator can do it.',
    ['Run the chain check', 'Read the result'],
    'Raise a security incident if the chain does not verify.',
    [L('Audit trail', '/app/audit')],
  ),
  entry(
    '/app/audit-pack',
    'Auditor evidence pack',
    'Download a signed probity and audit evidence pack, see what an external auditor would look for, and verify a pack.',
    ['Download the pack', 'Verify a pack'],
    'Give the pack to the auditor.',
    [L('Audit trail', '/app/audit')],
  ),
  entry(
    '/app/security-alerts',
    'Security alerts',
    'Unusual access found by the monitor, routed to the security owner to acknowledge, close or escalate.',
    ['Acknowledge, close or escalate an alert'],
    'An escalated alert becomes an incident.',
    [L('Data breach incidents', '/app/incidents')],
  ),
  entry(
    '/app/compliance',
    'Configuration compliance',
    'Checks of the tenant configuration with guidance and one-click safe fixes.',
    ['Run the checks', 'Apply a safe fix'],
    'Re-run the checks to confirm.',
    [ADMIN],
  ),
  entry(
    '/app/bank-changes',
    'Bank detail changes',
    'Supplier bank details are masked for everyone but finance; a change waits for a finance confirmation.',
    [['Confirm or reject a bank detail change', ['FINANCE']], 'See that a change is pending'],
    'A confirmed change applies to future payments.',
    [L('Suppliers', '/app/suppliers')],
  ),
  entry(
    '/app/risk',
    'Risk register',
    'Risks, audit findings and obligations, with owners, actions and a heat map.',
    ['Add a risk or finding', 'Assign an owner and an action', 'Import the risks the platform already knows'],
    'Close actions by their due date.',
    [],
  ),
  entry(
    '/app/connectors',
    'Connectors',
    'The systems the platform connects to (all simulated here): health, secrets, deliveries, reconciliation and manual tasks for when a system is down.',
    ['Check health', 'Run a sync', 'Work a manual fallback task'],
    'Re-run the sync once the system is back.',
    [L('ERP data', '/app/erp')],
  ),
  entry(
    '/app/repository',
    'Document repository',
    'The documents the platform keeps, by record, with their classification and versions.',
    ['Search and open a document', 'Check its classification'],
    'Open the record the document belongs to.',
    [REQ],
  ),
  entry(
    '/app/continuity',
    'Continuity alerts',
    'Raise a continuity event, reach people by SMS and email, and track who is safe, affected or needs help.',
    ['Raise an event', 'Send a message to the people affected', 'Record responses'],
    'Close the event when everyone is accounted for.',
    [],
  ),
  entry(
    '/app/erp',
    'ERP data',
    'Budgets, cost centres, organisation and ledger imported from the ERP, and the result of each import.',
    ['Run an import', 'Read the result and the rows that failed'],
    'Fix failed rows and import again.',
    [L('Connectors', '/app/connectors')],
  ),
  entry(
    '/app/currency',
    'Currencies',
    'Annual and live exchange rates used to convert foreign-currency spend.',
    [['Set an annual rate', ['ADMIN', 'FINANCE']], 'Read the live rate'],
    'New requests convert at the rate set here.',
    [],
  ),
  entry(
    '/app/collaboration',
    'Collaboration',
    'Design document layouts, find the tools for working together on a document, and the best-practice reference content.',
    ['Edit a layout', 'Open the reference content'],
    'Use the layout in a plan or tender.',
    [PLANS],
  ),
  entry(
    '/app/shared',
    'Shared documents',
    'Projects whose documents you have been given access to, and when that access ends.',
    ['Open a shared project', 'See when access ends'],
    'Ask the owner for an extension before access ends.',
    [],
  ),
  entry(
    '/app/ai-models',
    'AI model approvals',
    'Request, decide and withdraw approvals for third-party AI models.',
    ['Request an approval', ['Decide or withdraw an approval', ['PROBITY', 'EXEC']]],
    'An approved model can be chosen by an administrator.',
    [L('AI models (admin)', '/admin/ai-models')],
  ),
  entry(
    '/app/content',
    'Outside content',
    'Classification codes, market prices, standard risks and clause references refreshed from outside sources (simulated).',
    ['Refresh a content set', 'See what changed'],
    'Fresh content is used in new requests and contracts.',
    [],
  ),
  entry(
    '/app/restricted-projects',
    'Restricted projects',
    'Projects invisible outside their sourcing group, with their text encrypted by a per-project key.',
    ['Create a restricted project', 'Manage its group'],
    'Only the group sees the project from then on.',
    [],
  ),
  entry(
    '/app/bid-box',
    'Sealed bids',
    'Bids are encrypted at upload; only metadata is shown until the tender closes and is opened.',
    ['See the bid metadata', 'Open the tender for the opening steps'],
    'After opening, the evaluation can start.',
    [TENDERS],
  ),
  entry(
    '/app/classification',
    'Data classification',
    'Sensitive data found in text fields, by class and location, with a review step.',
    ['Review a finding', 'Mark it handled'],
    'Remove the data at its source.',
    [],
  ),
  entry(
    '/app/content-safety',
    'Content safety',
    'Supplier text that read like instructions to an AI, flagged and neutralised.',
    ['Review a flagged item'],
    'Nothing to action unless the item is a real attempt; then raise it with probity.',
    [],
  ),
  entry(
    '/app/incidents',
    'Data breach incidents',
    'Report a suspected breach; managers assess, contain, draft notices and close it.',
    [
      'Report a suspected breach',
      ['Assess, contain and draft a notice', ['ADMIN', 'LEGAL', 'PROBITY', 'EXEC']],
    ],
    'Close the incident when contained and notified.',
    [],
  ),
  entry(
    '/app/hosting-topology',
    'Hosting topology',
    'Platform-hosted, customer cloud or hybrid: data flows, responsibilities and keys. Design only.',
    ['Read the topologies'],
    'Nothing to action; it is a design reference.',
    [],
  ),
  // ------------------------------------------------------------------ reports
  entry(
    '/app/reports',
    'Reports',
    'Portfolio reports: spend, maverick spend, workload and contract expiry. You only see procurements your role may see.',
    ['Open a report', 'Export it'],
    'Open the records behind a figure to act.',
    [L('Ask for a report', '/app/reports/ask')],
  ),
  entry(
    '/app/reports/ask',
    'Ask for a report',
    'Ask for a report in plain language and keep the views you use.',
    ['Type a question such as "contracts expiring in 90 days"', 'Save the view'],
    'Open a saved view whenever you need it.',
    [L('Reports', '/app/reports')],
  ),
  entry(
    '/app/reports/schedule',
    'Schedule',
    'A chart of every active procurement by phase, with the delegate calendar.',
    ['Read the chart', 'Move a date where allowed'],
    'Follow up a late procurement on its request page.',
    [REQ],
  ),
  entry(
    '/app/reports/supplier-risk',
    'Supplier risk map',
    'Where suppliers are, and the risk signals around them.',
    ['Filter the map', 'Open a supplier'],
    'Resolve the risk on the supplier page.',
    [L('Suppliers', '/app/suppliers')],
  ),
  entry(
    '/app/reports/capacity',
    'Workload and capacity',
    'Workload per procurement manager, and procurements with no manager.',
    ['See who is overloaded', ['Assign a manager', ['PROCUREMENT', 'EXEC']]],
    'Assigned managers appear in the workload figures.',
    [REQ],
  ),
  entry(
    '/app/reports/performance',
    'Performance',
    'Savings, velocity and cycle times across procurements.',
    ['Read the figures', 'Export them'],
    'Nothing to action; use it to plan.',
    [L('Reports', '/app/reports')],
  ),
  entry(
    '/app/reports/commitment',
    'Future commitment',
    'What the enterprise has committed to pay in future, including ceilings and unknowns.',
    ['Read the totals by type', 'Open a contract'],
    'Review the unknowns on their contracts.',
    [CONTRACTS],
  ),
  entry(
    '/app/reports/optimisation',
    'Spend optimisation',
    'Where spend can be reduced: consolidation, duplicates, rate card gaps and price variance. Savings are estimates.',
    ['Open a finding', 'Open the contracts involved'],
    'Start a procurement or a variation to capture the saving.',
    [CONTRACTS],
  ),
  // ------------------------------------------------------------------ admin
  entry(
    '/admin',
    'Admin overview',
    'Configuration areas, each independently permissioned and audited.',
    ['Open an area'],
    'Make the change in the area, then check the audit trail.',
    [L('Users and roles', '/admin/users'), L('Settings', '/admin/settings')],
  ),
  entry(
    '/admin/users',
    'Users and roles',
    'Create users and assign roles. Administrators cannot read bid content.',
    ['Create a user', 'Assign or remove a role', 'Deactivate a user'],
    'A new user activates their account from the email link.',
    [L('Delegations', '/admin/delegations')],
  ),
  entry(
    '/admin/delegations',
    'Delegations',
    'Set sourcing, publish-permission and signing limits. Changes take effect immediately and are audited.',
    ['Change a limit', 'Add a delegation for a person or a role'],
    'The person can then approve or sign up to the new limit.',
    [L('Users and roles', '/admin/users')],
  ),
  entry(
    '/admin/settings',
    'Settings',
    'Numbering, labels, custom fields, checkpoints, intake rules, notifications and routing.',
    ['Change a setting and press Save', 'Add custom fields'],
    'The change applies to new records straight away.',
    [ADMIN],
  ),
  entry(
    '/admin/workflows',
    'Workflows',
    'Simple, intermediate and complex workflows with mandatory checkpoints.',
    ['Edit a workflow and Save workflow'],
    'New requests follow the saved workflow.',
    [ADMIN],
  ),
  entry(
    '/admin/templates',
    'Templates',
    'Tender, plan and contract templates and the clause library.',
    ['Edit a template', 'Add a clause'],
    'New documents use the template.',
    [ADMIN],
  ),
  entry(
    '/admin/hr-feed',
    'HR feed',
    'Starters, leavers and delegate changes from the HR system, with what needs a person.',
    ['Run the sync', 'Resolve an item that needs a person'],
    'Resolved items change users and delegations.',
    [L('Users and roles', '/admin/users')],
  ),
  entry(
    '/admin/ai-models',
    'AI models',
    'Choose the AI model, and request approval for a third-party one.',
    ['Choose the model', 'Request approval'],
    'The chosen model is named on every AI answer.',
    [L('AI model approvals', '/app/ai-models')],
  ),
  entry(
    '/admin/access-policies',
    'Access policies',
    'Rules that override the default hierarchy: explicit denials, named grants, expiry, and a what-can-this-person-see simulator.',
    ['Add a policy', 'Run the simulator'],
    'The policy applies at once.',
    [ADMIN],
  ),
  entry(
    '/admin/config',
    'Configuration',
    'Every setting and where to change it, export and import, and the browsers signing in.',
    ['Export or import the configuration', 'See which browsers sign in'],
    'Open the setting you want to change.',
    [L('Settings', '/admin/settings')],
  ),
  entry(
    '/admin/performance',
    'Performance',
    'How fast the budget check answers inside the intake conversation.',
    ['Read the timings'],
    'Nothing to action unless a timing is over target.',
    [],
  ),
  entry(
    '/admin/usage',
    'Usage and plan',
    'The usage plan this organisation is on, its limits and what has been used today.',
    ['Read the usage'],
    'Nothing to action.',
    [],
  ),
  entry(
    '/admin/migration',
    'Data migration',
    'Upload legacy contract records, validate them and bring them in with a "migrated" flag.',
    ['Upload a file', 'Review the validation', 'Apply the batch'],
    'Review the imported records in Contracts.',
    [L('Import', '/admin/migration/import'), CONTRACTS],
  ),
  entry(
    '/admin/migration/import',
    'Import data',
    'Map the columns of a legacy file, check them and import the rows.',
    ['Choose the file and map the columns', 'Run the checks', 'Apply the import'],
    'Open the new records to check them.',
    [L('Data migration', '/admin/migration')],
  ),
  entry(
    '/admin/keys',
    'Encryption keys',
    'Customer-managed keys per purpose with rotation, re-wrapping and disabling (simulated key service).',
    ['Rotate a key', 'Disable a key'],
    'Re-wrapping follows a rotation.',
    [],
  ),
  entry(
    '/admin/security-evidence',
    'Security evidence',
    'What is encrypted in transit and at rest, measured now, and the tenant isolation check.',
    ['Run the isolation check'],
    'Keep the evidence for the audit.',
    [],
  ),
  entry(
    '/admin/quarantine',
    'Upload quarantine',
    'Uploads refused as infected and uploads held while the simulated scanner was down.',
    ['Rescan a held upload', 'Release or discard it'],
    'A clean upload joins its record.',
    [],
  ),
  entry(
    '/admin/residency',
    'Residency and egress',
    'The elected hosting country, every outbound path with its region, the egress allow-list and what was refused.',
    ['Save residency settings', 'Read the refused calls'],
    'Nothing to action unless something was refused.',
    [],
  ),
  // ------------------------------------------------------------------ supplier portal
  entry(
    '/supplier',
    'My tenders',
    'The tenders you are invited to or can see. Open one to read the pack, ask questions and respond before it closes.',
    ['Open a tender', 'Ask a question', 'Upload and Submit bid before the close'],
    'After the close the buyer evaluates; you are told the outcome.',
    [L('Company profile', '/supplier/profile')],
  ),
  entry(
    '/supplier/tenders/[id]',
    'Tender response',
    'One tender as a supplier: the pack, the questions and answers, your response form and the close time.',
    ['Answer the response form', 'Upload documents', 'Submit bid or withdraw it'],
    'After the close the buyer evaluates.',
    [L('My tenders', '/supplier')],
    'tender',
  ),
  entry(
    '/supplier/contracts',
    'Contracts',
    'Read a contract before it is signed, ask questions, and see the ones you hold.',
    ['Open a contract', 'Ask a question'],
    'The buyer signs after legal review.',
    [L('My tenders', '/supplier')],
  ),
  entry(
    '/supplier/contracts/[id]',
    'Contract (supplier)',
    'One contract as a supplier: the draft, questions and the signing state.',
    ['Read the draft', 'Ask a question'],
    'The buyer signs after legal review.',
    [L('Contracts', '/supplier/contracts')],
    'contract',
  ),
  entry(
    '/supplier/profile',
    'Company profile',
    'Manage contacts, insurance certificates and compliance status.',
    ['Update contacts', 'Upload a certificate', 'Save banking details'],
    'Keep insurance current so you stay eligible.',
    [L('My tenders', '/supplier')],
  ),
  entry(
    '/supplier/privacy',
    'Privacy (supplier)',
    'The collection notice, and a way to ask to see or correct your personal information.',
    ['Read the notice', 'Raise a request'],
    'The privacy team answers by the due date.',
    [L('My tenders', '/supplier')],
  ),
  entry(
    '/supplier/register',
    'Supplier registration',
    'Register your company to respond to tenders.',
    ['Enter your company details and create an account'],
    'Activate your account from the email link.',
    [],
  ),
  entry(
    '/supplier/activate',
    'Supplier activation',
    'Activate a supplier account from the invitation link.',
    ['Set a password and sign in'],
    'Open My tenders.',
    [],
  ),
  // ------------------------------------------------------------------ signed-out and link pages
  entry(
    '/',
    'Home',
    'The public home page. Sign in to reach the portal, or register as a supplier.',
    ['Sign in', 'Register as a supplier'],
    'After signing in you land on the home page for your role.',
    [L('Sign in', '/login'), L('Supplier registration', '/supplier/register')],
  ),
  entry(
    '/login',
    'Sign in',
    'Sign in with your email and password, or single sign-on.',
    ['Sign in', 'Use a recovery link'],
    'You land on the home page for your role.',
    [],
  ),
  entry(
    '/forgot-password',
    'Forgot password',
    'Ask for a link to reset your password.',
    ['Enter your email'],
    'Follow the link in the email.',
    [],
  ),
  entry(
    '/activate',
    'Activate account',
    'Activate a new account from your invitation link.',
    ['Set a password'],
    'Sign in.',
    [],
  ),
  entry(
    '/forbidden',
    'Not allowed',
    'Your role may not open the page you asked for.',
    ['Go to your home page'],
    'Ask an administrator for the role if you need it.',
    [],
  ),
  entry(
    '/browser-support',
    'Browser support',
    'Which browsers the portal supports.',
    ['Read the list'],
    'Open the portal in a supported browser.',
    [],
  ),
  entry(
    '/preview',
    'Device preview',
    'A preview of the portal on a phone or tablet frame.',
    ['Pick a device'],
    'Close the preview.',
    [],
  ),
  entry(
    '/ui-kit',
    'UI kit',
    'The shared components and the theme, for review.',
    ['Look at the components'],
    'Nothing to action.',
    [],
  ),
  entry(
    '/legal/[slug]',
    'Legal notice',
    'A legal notice such as terms or privacy.',
    ['Read the notice'],
    'Nothing to action.',
    [],
  ),
  entry(
    '/approve/[token]',
    'Approval link',
    'Approve or send back one procurement from a one-time link, without signing in. The same limits and checks apply.',
    ['Work through the checklist', 'Approve or send back'],
    'The approver is done; the procurement moves on.',
    [],
  ),
  entry(
    '/counsel/[token]',
    'Counsel link',
    'Outside counsel proposes wording for a contract through a one-time link.',
    ['Propose a redline'],
    'Legal accepts or rejects the redline.',
    [],
  ),
  entry(
    '/esign/[token]',
    'Signing ceremony',
    'The simulated e-signature ceremony for one contract; only a signed-in signatory can sign.',
    ['Confirm and sign'],
    'The contract becomes executed.',
    [],
  ),
  entry(
    '/respond/[token]',
    'Respond link',
    'A supplier responds to an invitation from a one-time link.',
    ['Accept or decline', 'Open the tender'],
    'Register or sign in to respond.',
    [],
  ),
];

/** The path the guide uses for a route pattern: dynamic segments become a sample id. */
const SAMPLE = '00000000-0000-4000-8000-000000000000';
export const sampleRouteFor = (route: string): string =>
  route.replace(
    /\[\.{0,3}[A-Za-z]+\]/g,
    route.includes('[token]') || route.includes('[slug]') ? 'x' : SAMPLE,
  );

const matches = (route: string, path: string): boolean => {
  const a = route.split('/');
  const b = path.split('/');
  if (a.length !== b.length) return false;
  return a.every((seg, i) => /^\[.+\]$/.test(seg) || seg === b[i]);
};

/** The guide entry for a page path (the most specific route wins), or null when there is none. */
export function guideFor(path: string | null | undefined): PageGuideEntry | null {
  if (!path) return null;
  const clean = path.split(/[?#]/)[0]!.replace(/\/+$/, '') || '/';
  const exact = PAGE_GUIDE.filter((g) => matches(g.route, clean));
  if (exact.length) {
    // a fixed segment beats a dynamic one
    return exact.sort(
      (x, y) => (x.route.match(/\[/g)?.length ?? 0) - (y.route.match(/\[/g)?.length ?? 0),
    )[0]!;
  }
  // a sub-page that has no entry of its own falls back to the nearest parent page (for example /app/requests/<id>/something)
  const parts = clean.split('/');
  while (parts.length > 2) {
    parts.pop();
    const hit = PAGE_GUIDE.find((g) => matches(g.route, parts.join('/')));
    if (hit) return hit;
  }
  return null;
}

/** Roles that may open the page. Public pages return null. */
export const rolesOpening = (route: string): readonly RoleName[] | null =>
  rolesForPath(sampleRouteFor(route));
