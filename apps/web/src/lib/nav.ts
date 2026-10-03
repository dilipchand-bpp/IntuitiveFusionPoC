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
  | 'audit'
  | 'users'
  | 'delegations'
  | 'workflows'
  | 'templates'
  | 'migration'
  | 'admin'
  | 'profile';

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  /** Roles shown this item. MUST be a subset of the roles the route guard allows for `href` (tested). */
  roles: readonly RoleName[];
  section: 'Work' | 'Oversight' | 'Administration' | 'Supplier';
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
    section: 'Work',
    module: 'Dashboard',
    requirements: ['FR-0590', 'FR-0650'],
    blurb: 'Portfolio overview.',
  },
  {
    href: '/app/requests',
    label: 'Requests',
    icon: 'requests',
    roles: ['REQUESTER', 'PROCUREMENT', 'DELEGATE', 'LEGAL', 'CONTRACT_MGR', 'PROBITY', 'FINANCE', 'EXEC'],
    section: 'Work',
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
    section: 'Work',
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
    section: 'Work',
    module: 'Approvals',
    requirements: ['FR-0080', 'FR-0150', 'FR-0375', 'FR-0785'],
    blurb: 'One-screen summaries and one-tap approval within your delegation limit.',
  },
  {
    href: '/app/tenders',
    label: 'Tenders',
    icon: 'tenders',
    roles: ['PROCUREMENT', 'LEGAL', 'DELEGATE', 'EXEC', 'PROBITY'],
    section: 'Work',
    module: 'Tender pack & supplier portal',
    requirements: ['FR-0110', 'FR-0120', 'FR-0135', 'FR-0150', 'FR-0165'],
    blurb: 'Generate the tender pack, hold it staged until permission to publish, run anonymised Q&A.',
  },
  {
    href: '/app/evaluations',
    label: 'Evaluations',
    icon: 'evaluations',
    roles: ['EVALUATOR', 'CHAIR', 'PROCUREMENT', 'DELEGATE', 'PROBITY', 'LEGAL', 'EXEC'],
    section: 'Work',
    module: 'Evaluation',
    requirements: ['FR-0255', 'FR-0260', 'FR-0270', 'FR-0275', 'FR-0300', 'FR-0345'],
    blurb:
      'Conflict declaration, independent hidden scoring, consensus with variance flags, evaluation report.',
  },
  {
    href: '/app/contracts',
    label: 'Contracts',
    icon: 'contracts',
    roles: ['LEGAL', 'CONTRACT_MGR', 'PROCUREMENT', 'DELEGATE', 'EXEC', 'FINANCE', 'PROBITY'],
    section: 'Work',
    module: 'Contract award & management',
    requirements: ['FR-0380', 'FR-0395', 'FR-0455', 'FR-0490', 'FR-0505', 'FR-0640'],
    blurb: 'Draft from template, sign with separate signing authority, then manage obligations and alerts.',
  },
  {
    href: '/app/reports',
    label: 'Reports',
    icon: 'reports',
    roles: ['EXEC', 'FINANCE', 'PROCUREMENT', 'CONTRACT_MGR'],
    section: 'Oversight',
    module: 'Reporting',
    requirements: ['FR-0595', 'FR-0605', 'FR-0620', 'FR-0625'],
    blurb: 'Spend, maverick spend, workload and contract expiry views.',
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
export const navFor = (roles: readonly string[]): NavItem[] =>
  NAV.filter((n) => n.roles.some((r) => roles.includes(r)));

/** Longest-prefix match so /app/requests/123 resolves to the Requests module page. */
export function resolveNav(pathname: string): NavItem | null {
  return (
    [...NAV]
      .sort((a, b) => b.href.length - a.href.length)
      .find((n) => pathname === n.href || pathname.startsWith(n.href + '/')) ?? null
  );
}
