import type { RoleName } from '@if/shared';

export type NavIcon =
  | 'dashboard'
  | 'requests'
  | 'plans'
  | 'approvals'
  | 'tenders'
  | 'evaluations'
  | 'contracts'
  | 'reports'
  | 'suppliers'
  | 'audit'
  | 'users'
  | 'delegations'
  | 'workflows'
  | 'templates'
  | 'migration'
  | 'settings'
  | 'admin'
  | 'profile';

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  /** Roles shown this item. MUST be a subset of the roles the route guard allows for `href` (tested). */
  roles: readonly RoleName[];
  section:
    | 'Overview'
    | 'Procure'
    | 'Contracts'
    | 'Insight'
    | 'Collaborate'
    | 'Oversight'
    | 'Administration'
    | 'Supplier';
  /** Module name and requirement IDs shown on the "coming soon" panel until the module is built. */
  module: string;
  requirements: readonly string[];
  /** Short description for the placeholder page. */
  blurb: string;
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

export const NAV: readonly NavItem[] = [
  {
    href: '/app/dashboard',
    label: 'Dashboard',
    icon: 'dashboard',
    roles: STAFF_ALL,
    section: 'Overview',
    module: 'Dashboard',
    requirements: ['FR-0590', 'FR-0650'],
    blurb: 'Portfolio overview.',
  },
  {
    href: '/app/requests',
    label: 'Requests',
    icon: 'requests',
    roles: ['REQUESTER', 'PROCUREMENT', 'DELEGATE', 'LEGAL', 'CONTRACT_MGR', 'PROBITY', 'FINANCE', 'EXEC'],
    section: 'Procure',
    module: 'Request intake & AI assistant',
    requirements: ['FR-0005', 'FR-0006', 'FR-0035', 'FR-0060'],
    blurb:
      'Describe what you need in plain language; the assistant drafts the request and asks for anything missing.',
  },
  {
    href: '/app/plans',
    label: 'Procurement plans',
    icon: 'plans',
    roles: ['PROCUREMENT', 'REQUESTER', 'DELEGATE', 'EXEC', 'PROBITY'],
    section: 'Procure',
    module: 'Procurement plan',
    requirements: ['FR-0075', 'FR-0080', 'FR-0100', 'FR-0105'],
    blurb:
      'Auto-populated plan with instruction-based editing, conflict-of-interest declarations and delegate approval.',
  },
  {
    href: '/app/approvals',
    label: 'Approvals',
    icon: 'approvals',
    roles: ['DELEGATE', 'EXEC'],
    section: 'Procure',
    module: 'Approvals',
    requirements: ['FR-0080', 'FR-0150', 'FR-0375', 'FR-0785'],
    blurb: 'One-screen summaries and one-tap approval within your delegation limit.',
  },
  {
    href: '/app/tenders',
    label: 'Tenders',
    icon: 'tenders',
    roles: ['PROCUREMENT', 'LEGAL', 'DELEGATE', 'EXEC', 'PROBITY'],
    section: 'Procure',
    module: 'Tender pack & supplier portal',
    requirements: ['FR-0110', 'FR-0120', 'FR-0135', 'FR-0150', 'FR-0165'],
    blurb: 'Generate the tender pack, hold it staged until permission to publish, run anonymised Q&A.',
  },
  {
    href: '/app/evaluations',
    label: 'Evaluations',
    icon: 'evaluations',
    roles: ['EVALUATOR', 'CHAIR', 'PROCUREMENT', 'DELEGATE', 'PROBITY', 'LEGAL', 'EXEC'],
    section: 'Procure',
    module: 'Evaluation',
    requirements: ['FR-0255', 'FR-0260', 'FR-0270', 'FR-0275', 'FR-0300', 'FR-0345'],
    blurb:
      'Conflict declaration, independent hidden scoring, consensus with variance flags, evaluation report.',
  },
  {
    href: '/app/suppliers',
    label: 'Suppliers',
    icon: 'suppliers',
    roles: ['PROCUREMENT', 'LEGAL', 'FINANCE'],
    section: 'Procure',
    module: 'Supplier directory',
    requirements: ['FR-0180', 'FR-0185', 'FR-0245', 'FR-0250'],
    blurb: 'Supplier profiles with sanctions and insurance status, and their contacts.',
  },
  {
    href: '/app/contracts',
    label: 'Contracts',
    icon: 'contracts',
    roles: ['LEGAL', 'CONTRACT_MGR', 'PROCUREMENT', 'DELEGATE', 'EXEC', 'FINANCE', 'PROBITY'],
    section: 'Contracts',
    module: 'Contract award & management',
    requirements: ['FR-0380', 'FR-0395', 'FR-0455', 'FR-0490', 'FR-0505', 'FR-0640'],
    blurb: 'Draft from template, sign with separate signing authority, then manage obligations and alerts.',
  },
  {
    href: '/app/envelopes',
    label: 'Funding envelopes',
    icon: 'delegations',
    roles: ['DELEGATE', 'EXEC', 'FINANCE', 'PROCUREMENT', 'CONTRACT_MGR', 'REQUESTER', 'LEGAL'],
    section: 'Contracts',
    module: 'Funding envelopes',
    requirements: ['FR-0585'],
    blurb:
      'An allocated envelope a delegate approves once, against which nominated people approve commitments, with a warning as it runs out.',
  },
  {
    href: '/app/legal',
    label: 'Legal desk',
    icon: 'contracts',
    roles: ['LEGAL', 'PROCUREMENT'],
    section: 'Contracts',
    module: 'Legal matter management',
    requirements: ['FR-0385', 'FR-0470'],
    blurb: 'A board of legal matters, review hours, and the knowledge base legal keeps for the platform.',
  },
  {
    href: '/app/reports',
    label: 'Reports',
    icon: 'reports',
    roles: ['EXEC', 'FINANCE', 'PROCUREMENT', 'CONTRACT_MGR'],
    section: 'Insight',
    module: 'Reporting',
    requirements: ['FR-0595', 'FR-0605', 'FR-0620', 'FR-0625'],
    blurb: 'Spend, maverick spend, workload and contract expiry views.',
  },
  {
    href: '/app/reports/ask',
    label: 'Ask for a report',
    icon: 'reports',
    roles: ['EXEC', 'FINANCE', 'PROCUREMENT', 'CONTRACT_MGR', 'DELEGATE', 'LEGAL', 'PROBITY'],
    section: 'Insight',
    module: 'Reporting',
    requirements: ['FR-0625'],
    blurb: 'Ask for a report in plain language and keep the views you use.',
  },
  {
    href: '/app/reports/schedule',
    label: 'Schedule',
    icon: 'reports',
    roles: ['PROCUREMENT', 'EXEC', 'DELEGATE'],
    section: 'Insight',
    module: 'Reporting',
    requirements: ['FR-0595'],
    blurb: 'A chart of every active procurement by phase, with the delegate calendar.',
  },
  {
    href: '/app/reports/supplier-risk',
    label: 'Supplier risk map',
    icon: 'reports',
    roles: ['PROCUREMENT', 'EXEC', 'FINANCE', 'PROBITY'],
    section: 'Insight',
    module: 'Reporting',
    requirements: ['FR-0610'],
    blurb: 'Where suppliers are, and the risk signals around them.',
  },
  {
    href: '/app/buy',
    label: 'Guided buying',
    icon: 'requests',
    roles: ['REQUESTER', 'PROCUREMENT'],
    section: 'Procure',
    module: 'Guided buying',
    requirements: ['FR-0820'],
    blurb: 'Buy everyday goods from the approved catalogue, or describe a need and see a recommendation.',
  },
  {
    href: '/app/search',
    label: 'Search',
    icon: 'reports',
    roles: [
      'REQUESTER',
      'PROCUREMENT',
      'DELEGATE',
      'EVALUATOR',
      'CHAIR',
      'LEGAL',
      'CONTRACT_MGR',
      'PROBITY',
      'FINANCE',
      'EXEC',
    ],
    section: 'Overview',
    module: 'Search',
    requirements: ['FR-0880'],
    blurb: 'Search your own records and, when allowed, an outside source.',
  },
  {
    href: '/app/risk',
    label: 'Risk register',
    icon: 'audit',
    roles: ['PROBITY', 'EXEC', 'LEGAL', 'FINANCE', 'PROCUREMENT', 'CONTRACT_MGR', 'DELEGATE'],
    section: 'Oversight',
    module: 'Audit, risk and compliance',
    requirements: ['FR-0855'],
    blurb: 'Risks, audit findings and obligations, with owners, actions and a heat map.',
  },
  {
    href: '/app/reports/commitment',
    label: 'Future commitment',
    icon: 'reports',
    roles: ['EXEC', 'FINANCE', 'PROCUREMENT', 'CONTRACT_MGR'],
    section: 'Insight',
    module: 'Future commitment',
    requirements: ['FR-0845'],
    blurb: 'What the enterprise has committed to pay in future, including ceilings and unknowns.',
  },
  {
    href: '/app/reports/optimisation',
    label: 'Spend optimisation',
    icon: 'reports',
    roles: ['EXEC', 'FINANCE', 'PROCUREMENT', 'CONTRACT_MGR'],
    section: 'Insight',
    module: 'Spend optimisation',
    requirements: ['FR-0840'],
    blurb: 'Where spend can be reduced: consolidation, duplicates, rate card gaps and price variance.',
  },
  {
    href: '/app/m',
    label: 'Mobile home',
    icon: 'dashboard',
    roles: [
      'PROCUREMENT',
      'LEGAL',
      'FINANCE',
      'EXEC',
      'CONTRACT_MGR',
      'PROBITY',
      'DELEGATE',
      'EVALUATOR',
      'CHAIR',
    ],
    section: 'Overview',
    module: 'Mobile',
    requirements: ['FR-0825'],
    blurb: 'A phone-sized home with your actions and notes taken during supplier reviews.',
  },
  {
    href: '/app/currency',
    label: 'Currencies',
    icon: 'settings',
    roles: ['ADMIN', 'FINANCE'],
    section: 'Insight',
    module: 'Currencies and exchange rates',
    requirements: ['FR-0810'],
    blurb: 'Annual and live exchange rates used to convert foreign-currency spend.',
  },
  {
    href: '/app/collaboration',
    label: 'Collaboration',
    icon: 'plans',
    roles: STAFF_ALL,
    section: 'Collaborate',
    module: 'Collaboration & AI authoring',
    requirements: ['FR-0115', 'FR-0125', 'FR-0140', 'FR-0145'],
    blurb:
      'Design document layouts, find the tools for working together on a document, and the best-practice reference content.',
  },
  {
    href: '/app/shared',
    label: 'Shared documents',
    icon: 'reports',
    roles: STAFF_ALL,
    section: 'Collaborate',
    module: 'Time-bound access',
    requirements: ['FR-0435'],
    blurb: 'Projects whose documents you have been given access to, and when that access ends.',
  },
  {
    href: '/app/probity',
    label: 'Probity portal',
    icon: 'audit',
    roles: ['PROBITY'],
    section: 'Oversight',
    module: 'Probity oversight',
    requirements: ['FR-0310', 'FR-0340'],
    blurb:
      'Read-only oversight of the procurements you are allocated to, with a system hold and the probity documents.',
  },
  {
    href: '/app/audit',
    label: 'Audit trail',
    icon: 'audit',
    roles: ['PROBITY', 'ADMIN', 'EXEC', 'PROCUREMENT'],
    section: 'Oversight',
    module: 'Audit & probity',
    requirements: ['FR-0615', 'FR-0630', 'SEC-L07'],
    blurb: 'Searchable, exportable evidence of who did what and when.',
  },
  {
    href: '/app/roadmap',
    label: 'Roadmap',
    icon: 'reports',
    roles: STAFF_ALL,
    section: 'Oversight',
    module: 'Roadmap',
    requirements: ['PRM-08', 'US-FUT-01'],
    blurb: 'Everything the proof of concept does not do yet, with requirement ids.',
  },
  {
    href: '/admin',
    label: 'Admin overview',
    icon: 'admin',
    roles: ['ADMIN'],
    section: 'Administration',
    module: 'Administration',
    requirements: ['FR-0680', 'FR-0685', 'FR-0690'],
    blurb: 'Configuration areas, each independently permissioned and audited.',
  },
  {
    href: '/admin/users',
    label: 'Users & roles',
    icon: 'users',
    roles: ['ADMIN'],
    section: 'Administration',
    module: 'Users & roles',
    requirements: ['FR-0685', 'SEC-AC11'],
    blurb: 'Create users and assign roles. Administrators cannot read bid content.',
  },
  {
    href: '/admin/delegations',
    label: 'Delegations',
    icon: 'delegations',
    roles: ['ADMIN'],
    section: 'Administration',
    module: 'Delegations of authority',
    requirements: ['FR-0715', 'FR-0725', 'SEC-AC04'],
    blurb: 'Set sourcing and signing limits. Changes take effect immediately and are audited.',
  },
  {
    href: '/admin/settings',
    label: 'Settings',
    icon: 'settings',
    roles: ['ADMIN'],
    section: 'Administration',
    module: 'Settings',
    requirements: ['FR-0690', 'FR-0695', 'FR-0700', 'FR-0710', 'FR-0720', 'FR-0066'],
    blurb: 'Numbering, labels, custom fields, checkpoints, intake rules, notifications and routing.',
  },
  {
    href: '/admin/workflows',
    label: 'Workflows',
    icon: 'workflows',
    roles: ['ADMIN'],
    section: 'Administration',
    module: 'Workflow library',
    requirements: ['FR-0705', 'FR-0710', 'FR-0720'],
    blurb: 'Simple, intermediate and complex workflows with mandatory checkpoints.',
  },
  {
    href: '/admin/templates',
    label: 'Templates',
    icon: 'templates',
    roles: ['ADMIN'],
    section: 'Administration',
    module: 'Template & clause library',
    requirements: ['FR-0395', 'FR-0750'],
    blurb: 'Tender, plan and contract templates and the clause library.',
  },
  {
    href: '/admin/migration',
    label: 'Data migration',
    icon: 'migration',
    roles: ['ADMIN'],
    section: 'Administration',
    module: 'Data migration',
    requirements: ['FR-0655', 'FR-0660', 'FR-0665', 'FR-0670', 'FR-0675'],
    blurb: 'Upload legacy contract records, validate them and bring them in with a "migrated" flag.',
  },
  {
    href: '/supplier',
    label: 'My tenders',
    icon: 'tenders',
    roles: ['SUPPLIER'],
    section: 'Supplier',
    module: 'Supplier portal',
    requirements: ['FR-0155', 'FR-0160', 'FR-0165', 'FR-0170'],
    blurb:
      'See the tender you are invited to, ask questions, upload and submit your response before the close.',
  },
  {
    href: '/supplier/contracts',
    label: 'Contracts',
    icon: 'contracts',
    roles: ['SUPPLIER'],
    section: 'Supplier',
    module: 'Contracts',
    requirements: ['FR-0445'],
    blurb: 'Read a contract before it is signed, and ask questions.',
  },
  {
    href: '/supplier/profile',
    label: 'Company profile',
    icon: 'profile',
    roles: ['SUPPLIER'],
    section: 'Supplier',
    module: 'Supplier profile',
    requirements: ['FR-0245', 'FR-0250'],
    blurb: 'Manage contacts, insurance certificates and compliance status.',
  },
];

/** Items a user with these roles can see in the navigation. */
export const navFor = (roles: readonly string[], external = false): NavItem[] =>
  NAV.filter(
    (n) =>
      n.roles.some((r) => roles.includes(r)) &&
      // an external advisor sees only the probity portal and the evaluations they are allocated to
      (!external || n.href === '/app/probity' || n.href === '/app/evaluations'),
  );

/** Longest-prefix match so /app/requests/123 resolves to the Requests module page. */
export function resolveNav(pathname: string): NavItem | null {
  return (
    [...NAV]
      .sort((a, b) => b.href.length - a.href.length)
      .find((n) => pathname === n.href || pathname.startsWith(n.href + '/')) ?? null
  );
}
