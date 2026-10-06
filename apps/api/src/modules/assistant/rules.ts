/**
 * The conversational assistant (FR-X01): a fixed set of rules, a stand-in for an AI model, that reads a message, works out
 * what is being asked and answers from what the portal actually does. Nothing here calls an outside service; the swap
 * point is `answer` (see docs/swap-points.md). Everything it says about who may do what comes from the same tables the
 * portal enforces (route rules, role names), or from rules written out below that mirror the guards in the API.
 */
import { ROLE_NAMES, rolesForPath, type RoleName } from '@if/shared';

export const ASSISTANT_MODEL = 'rules-simulated-v1';

export interface Action {
  label: string;
  href: string;
}
export interface Reply {
  topic: string;
  answer: string;
  bullets: string[];
  actions: Action[];
  followUps: string[];
}

const ROLE_LABEL: Record<RoleName, string> = {
  REQUESTER: 'Requester',
  PROCUREMENT: 'Procurement team',
  DELEGATE: 'Delegate (approver)',
  EVALUATOR: 'Evaluator',
  CHAIR: 'Evaluation chair',
  LEGAL: 'Legal',
  CONTRACT_MGR: 'Contract manager',
  PROBITY: 'Probity and risk officer',
  FINANCE: 'Finance',
  ADMIN: 'Administrator',
  EXEC: 'Executive',
  SUPPLIER: 'Supplier',
};

const ROLE_DOES: Record<RoleName, string> = {
  REQUESTER: 'Raises procurement requests and tracks them. Sees only their own requests.',
  PROCUREMENT:
    'Runs procurements end to end: triages requests, builds the plan and the tender pack, publishes, runs the evaluation and prepares contracts. Also sees the portfolio reports.',
  DELEGATE:
    'Holds delegated authority. Approves plans and evaluation recommendations up to their sourcing limit, grants permission to publish, and signs contracts up to their signing limit.',
  EVALUATOR: 'Scores the tenders they are assigned to, after declaring any conflict of interest.',
  CHAIR: 'Chairs an evaluation panel: runs the consensus and signs off the panel result.',
  LEGAL: 'Reviews contract drafts and clauses, handles legal matters and holds.',
  CONTRACT_MGR: 'Manages executed contracts: obligations, alerts, variations, invoices and disclosures.',
  PROBITY:
    'Independent oversight: signs off the risk gate and probity steps, releases evaluation results and reads the audit trail.',
  FINANCE: 'Watches spend, invoices and funding envelopes. Can override a blocked invoice and mark it paid.',
  ADMIN:
    'Configures the portal: users and roles, delegations, workflows, templates and settings. Cannot read bid content.',
  EXEC: 'Sees everything across the portfolio, and can act as an approver and signer.',
  SUPPLIER: 'Responds to tenders, keeps the company profile current and works with contracts they hold.',
};

export const WORKFLOW: Array<{ phase: string; who: string; what: string }> = [
  {
    phase: 'Intake',
    who: 'Requester, then the procurement team',
    what: 'A request is raised with its value, term and category, and submitted. Procurement triages it and a manager is assigned.',
  },
  {
    phase: 'Plan',
    who: 'Procurement builds it; a delegate approves it',
    what: 'The plan is drafted, checked, signed off at the risk gate by the probity officer, then approved by a delegate whose sourcing limit covers the value. An approved plan is locked.',
  },
  {
    phase: 'Tender',
    who: 'Procurement builds the pack; a delegate gives permission; procurement publishes',
    what: 'The tender pack is written, a different person grants permission to publish, and suppliers respond before the close date.',
  },
  {
    phase: 'Evaluation',
    who: 'Evaluators and the chair; probity signs off',
    what: 'The panel declares conflicts, scores, agrees consensus and the report is prepared. Probity signs off and releases the result; a delegate decides on the recommendation.',
  },
  {
    phase: 'Contract award',
    who: 'Legal reviews; a delegate or executive signs',
    what: 'The contract is drafted from the award, reviewed by legal, then signed by someone holding a signing limit that covers its value.',
  },
  {
    phase: 'Contract management',
    who: 'Contract manager, finance',
    what: 'Obligations, alerts, variations, invoices (three-way match) and spend against the contract are managed until it ends or is renewed.',
  },
];

type Topic =
  'plan' | 'publish' | 'evaluation' | 'contract' | 'invoice' | 'request' | 'variation' | 'supplier';
const APPROVAL: Record<Topic, { title: string; text: string; roles: RoleName[]; href: string }> = {
  request: {
    title: 'A request',
    text: 'Nobody approves a request as such. A requester submits it and procurement triages it. Approval starts at the plan.',
    roles: ['REQUESTER', 'PROCUREMENT'],
    href: '/app/requests',
  },
  plan: {
    title: 'A procurement plan',
    text: 'A delegate (or an executive) approves it, and only if the value is within their sourcing approval limit. The probity officer signs off the risk gate separately. You cannot approve a plan you authored.',
    roles: ['DELEGATE', 'EXEC', 'PROBITY'],
    href: '/app/approvals',
  },
  publish: {
    title: 'Publishing a tender',
    text: 'A delegate grants permission to publish, and it must be someone other than the person who built the pack. Procurement then publishes.',
    roles: ['DELEGATE', 'PROCUREMENT'],
    href: '/app/tenders',
  },
  evaluation: {
    title: 'An evaluation result',
    text: 'The probity officer signs off and releases it. A delegate or executive then decides on the evaluation report, within their authority.',
    roles: ['PROBITY', 'DELEGATE', 'EXEC'],
    href: '/app/evaluations',
  },
  contract: {
    title: 'Signing a contract',
    text: 'A delegate or executive signs, and only with a separate contract signing limit that covers the value. Sourcing approval does not give signing authority.',
    roles: ['DELEGATE', 'EXEC', 'LEGAL'],
    href: '/app/contracts',
  },
  invoice: {
    title: 'A blocked invoice',
    text: 'Finance or an executive can override a blocked invoice with a reason. Only finance can mark an invoice paid.',
    roles: ['FINANCE', 'EXEC'],
    href: '/app/contracts/invoices',
  },
  variation: {
    title: 'A contract variation',
    text: 'Variations are raised by the contract manager or procurement. Anything past the disclosure threshold creates a disclosure task, and a changed value still needs someone with signing authority.',
    roles: ['CONTRACT_MGR', 'PROCUREMENT', 'LEGAL'],
    href: '/app/contracts/disclosures',
  },
  supplier: {
    title: 'A supplier',
    text: 'Procurement, legal and finance review supplier onboarding, sanctions and insurance. Suppliers cannot see each other.',
    roles: ['PROCUREMENT', 'LEGAL', 'FINANCE'],
    href: '/app/suppliers',
  },
};

const GLOSSARY: Array<{ re: RegExp; term: string; text: string }> = [
  {
    re: /three.?way|3.?way/,
    term: 'Three-way match',
    text: 'Each invoice is checked against the purchase order and what was received. A mismatch blocks the invoice until it is resolved or overridden with a reason.',
  },
  {
    re: /delegat(ion|e) of authority|sourcing limit|signing limit|\bdelegation\b/,
    term: 'Delegation of authority',
    text: 'The dollar limit a person may approve or sign. Sourcing approval, contract signing and permission to publish are three separate grants. Having one never implies another.',
  },
  {
    re: /maker.?checker|separation of dut|segregation/,
    term: 'Separation of duties',
    text: 'You cannot approve what you wrote, tender administrators cannot evaluate the same tender, and the pack author cannot grant permission to publish.',
  },
  {
    re: /probity/,
    term: 'Probity',
    text: 'Independent assurance that the process is fair: conflict declarations, risk sign-off, sealed scores and the audit trail.',
  },
  {
    re: /conflict of interest|\bcoi\b/,
    term: 'Conflict of interest',
    text: 'Panel members declare any conflict before they see bids. A material conflict removes them from the panel; a minor one stops them assessing that supplier.',
  },
  {
    re: /variation/,
    term: 'Variation',
    text: 'A change to a contract. It is measured cumulatively or incrementally against the original value, and large ones create disclosure tasks.',
  },
  {
    re: /spend ceiling|ceiling/,
    term: 'Spend ceiling',
    text: 'The cap on total spend under a contract. Invoices that would exceed it are blocked and an alert is raised.',
  },
  {
    re: /rules.?simulated|simulated|ai model|stand.?in/,
    term: 'Rules-simulated AI',
    text: 'Every AI feature here is a fixed set of rules standing in for a model, and is labelled so. Real model providers plug in at the documented swap points.',
  },
  {
    re: /dual.?witness|two witnesses|sealed bids?|bid opening/,
    term: 'Dual-witness opening',
    text: 'A high-value tender stays sealed after it closes until two different, independent people confirm with their password within a short window. Neither may have raised the request or sit on the evaluation panel.',
  },
  {
    re: /response (form|schedule)/,
    term: 'Response form',
    text: 'Instead of attaching documents, a supplier answers structured questions in the portal. Each answer is checked as it is entered, and a bid with a required question blank cannot be submitted.',
  },
  {
    re: /redact|redline|counsel link/,
    term: 'Redaction and redlines',
    text: "Legal can redact a clause, which withholds its wording from everyone else and from exports, and can propose a redline, which changes nothing until Legal accepts it. Outside counsel and a supplier's legal team can propose wording through a one-time link.",
  },
  {
    re: /approval link|approve from (a|the|an emailed) link|without signing in/,
    term: 'Approval link',
    text: 'An approver is sent a one-time link to a checklist for one procurement. They can approve or send it back without signing in, and the same authority limits and checks apply. Dollar values are withheld unless the organisation chooses to show them.',
  },
  {
    re: /currenc|exchange rate|foreign|international delegation|\bfx\b/,
    term: 'Currencies and international delegations',
    text: 'A request can be in a foreign currency. It is converted to Australian dollars at the rate for the financial year (July to June), or at a live rate if the organisation chooses, and both amounts are kept. Approval limits for foreign-currency spend are a separate, international delegation.',
  },
  {
    re: /guided buying|catalogue|autonomous sourcing|auto.?source/,
    term: 'Guided buying',
    text: 'For everyday goods you can buy from the approved catalogue, or describe what you need and see a recommendation scored on price, supplier standing and delivery. Nothing is ordered by the platform: approving only drafts a request, which goes through the usual checks. Above the limit the organisation sets, a full request is needed.',
  },
  {
    re: /future commitment|committed to pay|spend optimi[sz]ation|where can we save/,
    term: 'Future commitment and optimisation',
    text: 'Future commitment adds up what the organisation has agreed to pay later, showing fixed amounts, ceilings, ranges and unknowns separately. Spend optimisation lists where spend could fall: contracts worth consolidating, duplicate contracts, missing rate cards and prices that drifted. Savings are estimates.',
  },
  {
    re: /risk register|audit finding|obligation|heat ?map/,
    term: 'Audit, risk and compliance register',
    text: 'A register of risks, audit findings and obligations with a likelihood and impact rating, an owner, due dates and actions. Probity and executive staff can also pull in the risks the platform already knows about, such as a sanctions match.',
  },
  {
    re: /my dashboard|personali[sz]e.*dashboard|dashboard.*(widget|3d|layout)/,
    term: 'My dashboard',
    text: 'You can choose, order, size and style the widgets on your own dashboard, within what your role may see. Reset returns you to the default for your role.',
  },
  {
    re: /out of date|stale|batched|refresh.*(report|plan)|real.?time update/,
    term: 'Keeping reports and plans up to date',
    text: 'The evaluation report and contract management plans follow the records behind them. The organisation chooses whether they are rewritten at once, in a batch every few minutes, or only when someone presses refresh. An approved report is never rewritten.',
  },
  {
    re: /outside (source|search)|external search|search the web/,
    term: 'Search with an outside source',
    text: 'Search covers your own records first. If the organisation allows it you can also ask an outside source; reference numbers, ABNs, email addresses, amounts and supplier names are taken out of the question first, and every outbound question is logged.',
  },
  {
    re: /envelope/,
    term: 'Funding envelope',
    text: 'A pool of money that procurements and contracts draw down, so you can see what remains.',
  },
  {
    re: /master agreement|work order/,
    term: 'Master agreement and work orders',
    text: 'A master agreement sets the terms once; work orders call on it for specific pieces of work.',
  },
];

interface Target {
  label: string;
  href: string;
  words: string[];
}
const TARGETS: Target[] = [
  {
    label: 'New request',
    href: '/app/requests/new',
    words: ['new request', 'raise a request', 'create a request', 'start a request', 'new procurement'],
  },
  { label: 'Requests', href: '/app/requests', words: ['requests', 'my requests', 'procurements'] },
  {
    label: 'Approvals',
    href: '/app/approvals',
    words: ['approvals', 'approval queue', 'waiting for approval'],
  },
  { label: 'Plans', href: '/app/plans', words: ['plans', 'procurement plan'] },
  { label: 'Tenders', href: '/app/tenders', words: ['tenders', 'tender'] },
  { label: 'Evaluations', href: '/app/evaluations', words: ['evaluations', 'evaluation', 'scoring'] },
  { label: 'Contracts', href: '/app/contracts', words: ['contracts', 'contract list'] },
  {
    label: 'My contracts / search',
    href: '/app/contracts/mine',
    words: ['search contracts', 'my contracts', 'find a contract'],
  },
  {
    label: 'Expiring contracts',
    href: '/app/contracts/expiring',
    words: ['expiring', 'expiry', 'ending contracts'],
  },
  { label: 'Contract alerts', href: '/app/contracts/alerts', words: ['alerts', 'contract alerts'] },
  { label: 'Invoices', href: '/app/contracts/invoices', words: ['invoices', 'invoice'] },
  { label: 'Disclosures', href: '/app/contracts/disclosures', words: ['disclosures'] },
  { label: 'Master agreements', href: '/app/contracts/masters', words: ['master agreements', 'work orders'] },
  { label: 'Funding envelopes', href: '/app/envelopes', words: ['envelopes', 'funding'] },
  { label: 'Suppliers', href: '/app/suppliers', words: ['suppliers', 'supplier list'] },
  { label: 'Legal', href: '/app/legal', words: ['legal matters', 'legal'] },
  { label: 'Probity', href: '/app/probity', words: ['probity'] },
  { label: 'Audit trail', href: '/app/audit', words: ['audit', 'audit trail', 'who did what'] },
  { label: 'Dashboard', href: '/app/dashboard', words: ['dashboard', 'home', 'overview'] },
  { label: 'Role dashboards', href: '/app/dashboards', words: ['dashboards', 'role dashboard'] },
  { label: 'Reports', href: '/app/reports', words: ['reports', 'report'] },
  {
    label: 'Ask for a report',
    href: '/app/reports/ask',
    words: ['ask for a report', 'plain language report'],
  },
  { label: 'Schedule', href: '/app/reports/schedule', words: ['schedule', 'gantt', 'calendar'] },
  { label: 'Performance', href: '/app/reports/performance', words: ['performance', 'savings', 'velocity'] },
  { label: 'Supplier risk', href: '/app/reports/supplier-risk', words: ['supplier risk', 'risk map'] },
  { label: 'Workload and capacity', href: '/app/reports/capacity', words: ['capacity', 'workload'] },
  { label: 'Collaboration', href: '/app/collaboration', words: ['collaboration', 'concurrent editing'] },
  { label: 'Roadmap', href: '/app/roadmap', words: ['roadmap', 'coming soon'] },
  { label: 'Security', href: '/app/security', words: ['security', 'mfa', 'authenticator', 'password'] },
  { label: 'Administration', href: '/admin', words: ['admin', 'administration', 'settings'] },
];

const PAGES: Array<{ prefix: string; text: string }> = [
  {
    prefix: '/app/requests/new',
    text: 'Raise a request: give the title, category, value and term. Fields the portal can work out are suggested, and it checks the budget before you submit.',
  },
  {
    prefix: '/app/requests',
    text: 'Procurement requests. Open one to see its phase, documents and the plan, tender and contract that follow from it.',
  },
  {
    prefix: '/app/approvals',
    text: 'Everything waiting for your decision. A plan above your sourcing limit is refused with the reason, and you cannot approve your own work.',
  },
  {
    prefix: '/app/plans',
    text: 'Procurement plans. Sections can be edited together, with presence and tracked changes; an approved plan is locked until reopened.',
  },
  {
    prefix: '/app/tenders',
    text: 'Tender packs and supplier responses. Publishing needs a delegate’s permission from someone other than the pack author.',
  },
  {
    prefix: '/app/evaluations',
    text: 'Evaluation panels and scoring. Scores are sealed until the panel finishes, and probity releases the result.',
  },
  {
    prefix: '/app/contracts/invoices',
    text: 'Invoices are matched three ways against the purchase order and what was received. Blocked invoices need finance to resolve or override.',
  },
  {
    prefix: '/app/contracts/expiring',
    text: 'Contracts approaching their end, so you can renew, extend or let them lapse in time.',
  },
  {
    prefix: '/app/contracts/alerts',
    text: 'Contract alerts. Countdown, insurance and spend alerts are fixed and cannot be muted; others follow your preferences.',
  },
  {
    prefix: '/app/contracts',
    text: 'Contracts you can see: draft, legal review, signature and executed. Open one for obligations, variations, spend and alerts.',
  },
  { prefix: '/app/suppliers', text: 'The supplier directory: onboarding status, sanctions and insurance.' },
  {
    prefix: '/app/connectors',
    text: 'The systems the platform connects to (all simulated here): health, secrets, deliveries, reconciliation and manual tasks for when a system is down.',
  },
  {
    prefix: '/app/reports',
    text: 'Portfolio reports. You only see procurements your role is allowed to see.',
  },
  {
    prefix: '/app/dashboard',
    text: 'Your starting point: what needs attention, and the view for your role.',
  },
  { prefix: '/app/audit', text: 'The audit trail: who did what and when. It cannot be edited.' },
  {
    prefix: '/app/roadmap',
    text: 'What is built and what is still coming, with the requirement each belongs to.',
  },
  {
    prefix: '/admin',
    text: 'Administration: users and roles, delegations of authority, workflows, templates and settings.',
  },
  {
    prefix: '/supplier',
    text: 'The supplier portal: tenders you were invited to, your profile and your contracts.',
  },
];

const ROLE_ALIASES: Array<[RegExp, RoleName]> = [
  [/\brequesters?\b/, 'REQUESTER'],
  [/\bprocurement\b/, 'PROCUREMENT'],
  [/\bdelegates?\b|\bapprovers?\b/, 'DELEGATE'],
  [/\bevaluators?\b/, 'EVALUATOR'],
  [/\bchair\b/, 'CHAIR'],
  [/\blegal\b|\bcounsel\b/, 'LEGAL'],
  [/\bcontract manager\b/, 'CONTRACT_MGR'],
  [/\bprobity\b|\brisk officer\b/, 'PROBITY'],
  [/\bfinance\b/, 'FINANCE'],
  [/\badmin(istrator)?s?\b/, 'ADMIN'],
  [/\bexec(utive)?s?\b/, 'EXEC'],
  [/\bsuppliers?\b|\bvendors?\b/, 'SUPPLIER'],
];

export type Intent =
  | { kind: 'greeting' }
  | { kind: 'thanks' }
  | { kind: 'help' }
  | { kind: 'workflow' }
  | { kind: 'who-approves'; topic: Topic | null }
  | { kind: 'my-role' }
  | { kind: 'my-authority' }
  | { kind: 'role-info'; role: RoleName }
  | { kind: 'glossary'; entry: number }
  | { kind: 'page' }
  | { kind: 'navigate'; target: Target }
  | { kind: 'attention' }
  | { kind: 'review' }
  | { kind: 'mark-read' }
  | { kind: 'data' }
  | { kind: 'unknown' };

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s'/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function approvalTopic(m: string): Topic | null {
  if (/\bplan\b/.test(m)) return 'plan';
  if (/publish|release (the )?tender|go to market/.test(m)) return 'publish';
  if (/evaluat|award|recommend|score/.test(m)) return 'evaluation';
  if (/contract|sign|execut/.test(m)) return 'contract';
  if (/invoice|payment|pay\b/.test(m)) return 'invoice';
  if (/variation|extension|change to a contract/.test(m)) return 'variation';
  if (/supplier|onboard/.test(m)) return 'supplier';
  if (/request/.test(m)) return 'request';
  return null;
}

/** Works out what the person is asking. The order matters: the most specific questions come first. */
export function classify(message: string, canQueryData: boolean): Intent {
  const m = norm(message);
  if (/^(hi|hello|hey|g'?day|good (morning|afternoon|evening))\b/.test(m) && m.split(' ').length <= 4)
    return { kind: 'greeting' };
  if (/^(thanks|thank you|cheers|great|perfect)\b/.test(m)) return { kind: 'thanks' };
  if (/mark (all )?(my )?notifications? (as )?read|clear (my )?notifications/.test(m))
    return { kind: 'mark-read' };
  if (/\b(my|what('?s| is) my)\b.*\b(limit|authority|delegation)\b|how much can i (approve|sign)/.test(m))
    return { kind: 'my-authority' };
  if (
    /\b(who|which (role|person|people))\b.*\b(approv|sign|authori[sz]|publish|release|decid)/.test(m) ||
    /\bcan (a |an |the )?\w+ approve\b/.test(m) ||
    /\bapproval (process|chain|rules?)\b/.test(m)
  )
    return { kind: 'who-approves', topic: approvalTopic(m) };
  if (/\b(what can i do|my role|my permissions?|my access|what am i allowed|what do i have access)\b/.test(m))
    return { kind: 'my-role' };
  if (
    /\b(what|how)\b.*\b(does|do|is|are)\b.*\b(role|responsible|do)\b|\bwhat does (a |an |the )?\w+ (role )?do\b|\brole of\b/.test(
      m,
    )
  ) {
    const hit = ROLE_ALIASES.find(([re]) => re.test(m));
    if (hit) return { kind: 'role-info', role: hit[1] };
  }
  const g = GLOSSARY.findIndex((x) => x.re.test(m));
  if (g >= 0 && /\b(what|explain|mean|means|define|how does|why)\b/.test(m))
    return { kind: 'glossary', entry: g };
  if (/\b(this page|where am i|what is this|what can i do here|explain this|help with this)\b/.test(m))
    return { kind: 'page' };
  if (
    /\b(workflow|work flow|process|stages|phases|lifecycle|end to end|how does (the )?(portal|procurement|it) work|steps)\b/.test(
      m,
    )
  )
    return { kind: 'workflow' };
  if (
    /\b(fix|correct|improve|wrong|issues?|problems?|review|suggest|recommend|anomal|clean up|missing|stuck|stalled|health)\b/.test(
      m,
    )
  )
    return { kind: 'review' };
  if (
    /\b(attention|to ?do|pending|waiting|urgent|priorit|what should i|summary|status|overview|insights?|happening|my day|brief me)\b/.test(
      m,
    )
  )
    return { kind: 'attention' };
  if (
    /\b(go to|open|take me|navigate|show me the|where (do|can) i (find|see)|bring up|jump to|find the)\b/.test(
      m,
    )
  ) {
    const t = [...TARGETS]
      .sort((a, b) => Math.max(...b.words.map((w) => w.length)) - Math.max(...a.words.map((w) => w.length)))
      .find((x) => x.words.some((w) => m.includes(w)));
    if (t) return { kind: 'navigate', target: t };
  }
  const t2 = TARGETS.find((x) => x.words.some((w) => w.includes(' ') && m.includes(w)));
  if (t2 && /\b(create|raise|new|start)\b/.test(m)) return { kind: 'navigate', target: t2 };
  if (g >= 0) return { kind: 'glossary', entry: g };
  if (canQueryData && /\b(show|list|how many|all|which|contracts?|procurements?|risks?|invoices?)\b/.test(m))
    return { kind: 'data' };
  if (/\b(help|what can you do|how do you work|can you)\b/.test(m)) return { kind: 'help' };
  return { kind: 'unknown' };
}

export const canOpen = (roles: readonly string[], href: string) => {
  const allowed = rolesForPath(href.split('?')[0]!);
  return !allowed || allowed.some((r) => roles.includes(r));
};
const whoCan = (href: string) => {
  const allowed = rolesForPath(href) ?? [];
  const names = allowed.filter((r) => r !== 'SUPPLIER').map((r) => ROLE_LABEL[r]);
  return names.length === ROLE_NAMES.length - 1 ? 'any staff member' : names.join(', ');
};

const base = (topic: string, answer: string, extra: Partial<Reply> = {}): Reply => ({
  topic,
  answer,
  bullets: [],
  actions: [],
  followUps: [],
  ...extra,
});

export interface Who {
  roles: readonly string[];
  name: string;
}

export function followUpsFor(roles: readonly string[]): string[] {
  if (roles.includes('SUPPLIER'))
    return ['How do I respond to a tender?', 'What does the evaluation panel do?', 'What can I do here?'];
  return [
    'What needs my attention?',
    'How does the workflow work?',
    'Who can approve a plan?',
    'Anything I should fix?',
  ];
}

/** Answers that need no live data. Live-data intents are completed by the caller with `attentionReply` / `reviewReply`. */
export function answer(intent: Intent, who: Who, page: string | null): Reply | null {
  const supplier = who.roles.includes('SUPPLIER');
  switch (intent.kind) {
    case 'greeting':
      return base(
        'greeting',
        `Hello ${who.name.split(' ')[0]}. I can explain how the portal works, who can approve what, tell you what needs your attention, and suggest things to fix.`,
        {
          followUps: followUpsFor(who.roles),
        },
      );
    case 'thanks':
      return base('thanks', 'You are welcome. Ask me anything else about the portal.', {
        followUps: followUpsFor(who.roles),
      });
    case 'help':
      return base(
        'help',
        'Here is what I can do. I answer from the portal’s own rules and your own data, and I label myself as a simulation.',
        {
          bullets: supplier
            ? [
                'Explain how tenders, responses and contracts work for suppliers',
                'Explain terms such as probity and conflict of interest',
                'Take you to a page',
              ]
            : [
                'Explain the workflow and what each role does',
                'Say who can approve a plan, a tender, an evaluation, a contract or an invoice',
                'Tell you what needs your attention, and suggest what to fix',
                'Explain the page you are on and take you to another',
                'Answer report questions such as "contracts expiring in 90 days"',
                'Mark your notifications as read',
              ],
          followUps: followUpsFor(who.roles),
        },
      );
    case 'workflow':
      return base(
        'workflow',
        supplier
          ? 'For a supplier it runs like this: you are invited or find an open tender, you register and respond before it closes, the buyer evaluates, and if you win a contract is prepared for signature.'
          : 'A procurement moves through six phases. Each hands over to the next, and nothing skips a gate.',
        {
          bullets: supplier ? [] : WORKFLOW.map((w) => `${w.phase}: ${w.what} (${w.who}.)`),
          actions: supplier ? [] : [{ label: 'Open requests', href: '/app/requests' }],
          followUps: ['Who can approve a plan?', 'What is a delegation of authority?'],
        },
      );
    case 'who-approves': {
      if (intent.topic) {
        const a = APPROVAL[intent.topic];
        return base('approval', `${a.title}: ${a.text}`, {
          bullets: [`Roles involved: ${a.roles.map((r) => ROLE_LABEL[r]).join(', ')}`],
          actions: canOpen(who.roles, a.href) ? [{ label: 'Open', href: a.href }] : [],
          followUps: ['Who can sign a contract?', 'What is separation of duties?'],
        });
      }
      return base(
        'approval',
        'Approval is staged. Different people hold each gate, and the limits are separate.',
        {
          bullets: (Object.keys(APPROVAL) as Topic[])
            .filter((k) => k !== 'request' && k !== 'supplier')
            .map((k) => `${APPROVAL[k].title}: ${APPROVAL[k].text}`),
          followUps: ['Who can approve a plan?', 'What is my approval limit?'],
        },
      );
    }
    case 'my-role': {
      const names = who.roles.map((r) => ROLE_LABEL[r as RoleName] ?? r);
      const pages = TARGETS.filter((t) => canOpen(who.roles, t.href)).slice(0, 8);
      return base('role', `You hold: ${names.join(', ')}.`, {
        bullets: who.roles.map((r) => `${ROLE_LABEL[r as RoleName] ?? r}: ${ROLE_DOES[r as RoleName] ?? ''}`),
        actions: pages.map((p) => ({ label: p.label, href: p.href })),
        followUps: ['What is my approval limit?', 'What needs my attention?'],
      });
    }
    case 'role-info': {
      const r = intent.role;
      return base('role', `${ROLE_LABEL[r]}: ${ROLE_DOES[r]}`, {
        followUps: ['Who can approve a plan?', 'How does the workflow work?'],
      });
    }
    case 'glossary': {
      const g = GLOSSARY[intent.entry]!;
      return base('glossary', `${g.term}: ${g.text}`, {
        followUps: ['How does the workflow work?', 'Who can approve a plan?'],
      });
    }
    case 'page': {
      const p = page
        ? [...PAGES]
            .sort((a, b) => b.prefix.length - a.prefix.length)
            .find((x) => page === x.prefix || page.startsWith(x.prefix + '/'))
        : undefined;
      return base(
        'page',
        p
          ? p.text
          : 'I cannot tell which page you are on. Ask about a specific page, for example "what is the approvals page?".',
        {
          followUps: ['What needs my attention?', 'Who can approve a plan?'],
        },
      );
    }
    case 'navigate': {
      const t = intent.target;
      if (!canOpen(who.roles, t.href))
        return base(
          'navigate',
          `${t.label} is not available to your role. It is open to: ${whoCan(t.href)}.`,
          { followUps: ['What can I do?'] },
        );
      return base('navigate', `Here is ${t.label}.`, {
        actions: [{ label: `Open ${t.label}`, href: t.href }],
        followUps: followUpsFor(who.roles),
      });
    }
    default:
      return null;
  }
}

export function unknownReply(who: Who): Reply {
  return base(
    'unknown',
    'I did not catch that. I can answer questions about the workflow, roles and approvals, show what needs attention, and suggest what to fix. Try one of these.',
    {
      followUps: followUpsFor(who.roles),
    },
  );
}

export function askLink(message: string): Action {
  return {
    label: 'Show this as a report',
    href: `/app/reports/ask?q=${encodeURIComponent(message.slice(0, 300))}`,
  };
}

// ---------------------------------------------------------------- live insights

export interface Facts {
  unread: number;
  draftsMine: number;
  blockedRequests: number;
  unassigned: number;
  stalled: number;
  plansToApprove: number;
  plansToSignOff: number;
  contractsEnding: number;
  contractsNoOwner: number;
  invoicesBlocked: number;
  suppliersAtRisk: number;
  limits: Array<{ scope: string; limit: number }>;
  /** Which of the figures above this person is allowed to see; absent ones are never mentioned. */
  has: Set<keyof Facts>;
}
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const aud = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });

export function attentionReply(f: Facts): Reply {
  const items: Array<{ text: string; href: string; label: string }> = [];
  if (f.has.has('plansToApprove') && f.plansToApprove)
    items.push({
      text: `${plural(f.plansToApprove, 'plan')} waiting for approval`,
      href: '/app/approvals',
      label: 'Open approvals',
    });
  if (f.has.has('plansToSignOff') && f.plansToSignOff)
    items.push({
      text: `${plural(f.plansToSignOff, 'plan')} waiting for risk sign-off`,
      href: '/app/probity',
      label: 'Open probity',
    });
  if (f.has.has('invoicesBlocked') && f.invoicesBlocked)
    items.push({
      text: `${plural(f.invoicesBlocked, 'invoice')} blocked`,
      href: '/app/contracts/invoices',
      label: 'Open invoices',
    });
  if (f.has.has('contractsEnding') && f.contractsEnding)
    items.push({
      text: `${plural(f.contractsEnding, 'contract')} ending within 90 days`,
      href: '/app/contracts/expiring',
      label: 'Open expiring contracts',
    });
  if (f.has.has('unassigned') && f.unassigned)
    items.push({
      text: `${plural(f.unassigned, 'procurement')} not yet assigned to a manager`,
      href: '/app/reports/capacity',
      label: 'Assign managers',
    });
  if (f.has.has('draftsMine') && f.draftsMine)
    items.push({
      text: `${plural(f.draftsMine, 'draft request')} not yet submitted`,
      href: '/app/requests',
      label: 'Open requests',
    });
  if (f.unread)
    items.push({
      text: `${plural(f.unread, 'unread notification')}`,
      href: '/app/dashboard',
      label: 'Open dashboard',
    });
  if (!items.length)
    return base('attention', 'Nothing needs your attention right now.', {
      followUps: ['Anything I should fix?', 'How does the workflow work?'],
    });
  return base('attention', `You have ${plural(items.length, 'thing')} to look at:`, {
    bullets: items.map((i) => i.text),
    actions: items.map((i) => ({ label: i.label, href: i.href })),
    followUps: ['Anything I should fix?', 'Who can approve a plan?'],
  });
}

export function reviewReply(f: Facts): Reply {
  const s: Array<{ text: string; href: string; label: string }> = [];
  if (f.has.has('stalled') && f.stalled)
    s.push({
      text: `${plural(f.stalled, 'procurement')} in progress with no change for over 14 days. Check whether each is waiting on someone.`,
      href: '/app/requests',
      label: 'Open requests',
    });
  if (f.has.has('blockedRequests') && f.blockedRequests)
    s.push({
      text: `${plural(f.blockedRequests, 'request')} marked blocked. Find what is holding each one and record it.`,
      href: '/app/requests',
      label: 'Open requests',
    });
  if (f.has.has('unassigned') && f.unassigned)
    s.push({
      text: `${plural(f.unassigned, 'procurement')} with no manager, so workload figures understate demand. Assign them.`,
      href: '/app/reports/capacity',
      label: 'Assign managers',
    });
  if (f.has.has('contractsNoOwner') && f.contractsNoOwner)
    s.push({
      text: `${plural(f.contractsNoOwner, 'contract')} with no owner, so alerts go to a default person. Set an owner on each.`,
      href: '/app/contracts',
      label: 'Open contracts',
    });
  if (f.has.has('contractsEnding') && f.contractsEnding)
    s.push({
      text: `${plural(f.contractsEnding, 'contract')} ending within 90 days. Decide now between renew, extend or retire so supply is not interrupted.`,
      href: '/app/contracts/expiring',
      label: 'Open expiring contracts',
    });
  if (f.has.has('invoicesBlocked') && f.invoicesBlocked)
    s.push({
      text: `${plural(f.invoicesBlocked, 'invoice')} blocked. Resolve the mismatch, or override with a reason if it is legitimate.`,
      href: '/app/contracts/invoices',
      label: 'Open invoices',
    });
  if (f.has.has('suppliersAtRisk') && f.suppliersAtRisk)
    s.push({
      text: `${plural(f.suppliersAtRisk, 'supplier')} with expired or expiring insurance, or a sanctions match. Request updated certificates.`,
      href: '/app/suppliers',
      label: 'Open suppliers',
    });
  if (f.has.has('draftsMine') && f.draftsMine)
    s.push({
      text: `${plural(f.draftsMine, 'draft request')} still unsubmitted. Submit or delete them so they do not linger.`,
      href: '/app/requests',
      label: 'Open requests',
    });
  if (!s.length)
    return base('review', 'I checked what you can see and found nothing that needs correcting.', {
      followUps: ['What needs my attention?'],
    });
  return base('review', `I checked what you can see and have ${plural(s.length, 'suggestion')}:`, {
    bullets: s.map((x) => x.text),
    actions: s.map((x) => ({ label: x.label, href: x.href })),
    followUps: ['What needs my attention?', 'Who can approve a plan?'],
  });
}

export function authorityReply(f: Facts, roles: readonly string[]): Reply {
  if (!f.limits.length) {
    const approver = roles.some((r) => ['DELEGATE', 'EXEC'].includes(r));
    return base(
      'authority',
      approver
        ? 'No active delegation covers you, so you cannot approve or sign anything until an administrator grants one.'
        : 'You do not hold a delegation of authority. Only delegates and executives approve plans and sign contracts.',
      {
        followUps: ['Who can approve a plan?', 'What is a delegation of authority?'],
      },
    );
  }
  const name: Record<string, string> = {
    SOURCING_APPROVAL: 'Approve a plan or an evaluation',
    CONTRACT_SIGNING: 'Sign a contract',
    PUBLISH_PERMISSION: 'Give permission to publish',
  };
  return base('authority', 'These are your active limits:', {
    bullets: f.limits.map((l) => `${name[l.scope] ?? l.scope}: up to ${aud.format(l.limit)}`),
    followUps: ['Who can approve a plan?', 'What is separation of duties?'],
  });
}
