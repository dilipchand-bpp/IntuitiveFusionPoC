/**
 * Shared access vocabulary used by BOTH the API and the web app's route guards, so the two can never disagree.
 */
export const ROLE_NAMES = [
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
  'SUPPLIER',
] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

/** When a user holds several roles, the first match here is their "primary" role (home page, display). */
export const ROLE_PRIORITY: readonly RoleName[] = [
  'ADMIN',
  'EXEC',
  'DELEGATE',
  'PROCUREMENT',
  'CHAIR',
  'EVALUATOR',
  'LEGAL',
  'CONTRACT_MGR',
  'PROBITY',
  'FINANCE',
  'REQUESTER',
  'SUPPLIER',
];
export const primaryRole = (roles: readonly string[]): RoleName =>
  ROLE_PRIORITY.find((r) => roles.includes(r)) ?? 'REQUESTER';

/** Role-based landing page after login (Requirements US-PLT-02). */
export const ROLE_HOME: Record<RoleName, string> = {
  REQUESTER: '/app/requests',
  PROCUREMENT: '/app/dashboard',
  DELEGATE: '/app/approvals',
  EVALUATOR: '/app/evaluations',
  CHAIR: '/app/evaluations',
  LEGAL: '/app/contracts',
  CONTRACT_MGR: '/app/contracts',
  PROBITY: '/app/audit',
  FINANCE: '/app/dashboard',
  ADMIN: '/admin',
  EXEC: '/app/dashboard',
  SUPPLIER: '/supplier',
};

const STAFF: RoleName[] = ROLE_NAMES.filter((r) => r !== 'SUPPLIER');

/**
 * Web route guard table: longest matching prefix wins. Absent prefix under /app => any signed-in staff user.
 * Module pages added in later milestones inherit /app unless they need to be narrower (listed here first).
 */
export const ROUTE_RULES: ReadonlyArray<{ prefix: string; roles: readonly RoleName[] }> = [
  { prefix: '/admin', roles: ['ADMIN'] },
  { prefix: '/supplier', roles: ['SUPPLIER'] },
  { prefix: '/app/audit', roles: ['PROBITY', 'ADMIN', 'EXEC', 'PROCUREMENT'] },
  { prefix: '/app/probity', roles: ['PROBITY'] },
  { prefix: '/app/legal', roles: ['LEGAL', 'PROCUREMENT'] },
  {
    prefix: '/app/evaluations',
    roles: ['EVALUATOR', 'CHAIR', 'PROCUREMENT', 'DELEGATE', 'PROBITY', 'LEGAL', 'EXEC'],
  },
  { prefix: '/app/buy', roles: ['REQUESTER', 'PROCUREMENT'] },
  {
    prefix: '/app/search',
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
  },
  {
    prefix: '/app/risk',
    roles: ['PROBITY', 'EXEC', 'LEGAL', 'FINANCE', 'PROCUREMENT', 'CONTRACT_MGR', 'DELEGATE'],
  },
  {
    prefix: '/app/m',
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
  },
  { prefix: '/app/connectors', roles: ['ADMIN', 'PROCUREMENT', 'FINANCE', 'LEGAL', 'EXEC'] },
  { prefix: '/app/content', roles: ['ADMIN', 'PROCUREMENT', 'LEGAL', 'EXEC'] },
  {
    prefix: '/app/repository',
    roles: ['REQUESTER', 'PROCUREMENT', 'DELEGATE', 'LEGAL', 'CONTRACT_MGR', 'PROBITY', 'FINANCE', 'EXEC'],
  },
  { prefix: '/app/continuity', roles: ['PROCUREMENT', 'CONTRACT_MGR', 'EXEC', 'LEGAL'] },
  // the simulated e-signature ceremony: a signed-in signatory only (a link alone never signs anything)
  { prefix: '/esign', roles: ['DELEGATE', 'EXEC'] },
  { prefix: '/app/erp', roles: ['ADMIN', 'FINANCE', 'PROCUREMENT', 'EXEC'] },
  { prefix: '/app/currency', roles: ['ADMIN', 'FINANCE'] },
  { prefix: '/app/ai-models', roles: ['PROBITY', 'EXEC', 'PROCUREMENT'] },
  // B11c: audit chain and evidence pack, security alerts, configuration compliance, bank detail changes
  { prefix: '/app/audit-chain', roles: ['PROBITY', 'EXEC', 'ADMIN'] },
  { prefix: '/app/audit-pack', roles: ['PROBITY', 'EXEC', 'ADMIN'] },
  { prefix: '/app/security-alerts', roles: ['ADMIN', 'PROBITY', 'EXEC'] },
  { prefix: '/app/compliance', roles: ['ADMIN', 'PROBITY', 'EXEC'] },
  { prefix: '/app/bank-changes', roles: ['FINANCE', 'PROCUREMENT', 'ADMIN', 'EXEC', 'PROBITY'] },
  { prefix: '/app/reports/schedule', roles: ['PROCUREMENT', 'EXEC', 'DELEGATE'] },
  { prefix: '/app/reports/capacity', roles: ['PROCUREMENT', 'EXEC'] },
  { prefix: '/app/reports/supplier-risk', roles: ['PROCUREMENT', 'EXEC', 'FINANCE', 'PROBITY'] },
  {
    prefix: '/app/reports/ask',
    roles: ['EXEC', 'FINANCE', 'PROCUREMENT', 'CONTRACT_MGR', 'DELEGATE', 'LEGAL', 'PROBITY'],
  },
  {
    prefix: '/app/dashboards',
    roles: ['PROCUREMENT', 'LEGAL', 'DELEGATE', 'EXEC', 'FINANCE', 'PROBITY', 'CONTRACT_MGR', 'ADMIN'],
  },
  { prefix: '/app/contracts/deleted', roles: ['LEGAL', 'EXEC', 'PROBITY'] },
  { prefix: '/app/contracts/expiring', roles: ['CONTRACT_MGR', 'PROCUREMENT', 'LEGAL', 'EXEC'] },
  { prefix: '/app/contracts/alerts', roles: ['CONTRACT_MGR', 'PROCUREMENT', 'LEGAL', 'EXEC'] },
  { prefix: '/app/contracts/invoices', roles: ['FINANCE', 'CONTRACT_MGR', 'PROCUREMENT', 'EXEC'] },
  { prefix: '/app/contracts/disclosures', roles: ['PROCUREMENT', 'LEGAL', 'CONTRACT_MGR', 'EXEC'] },
  {
    prefix: '/app/envelopes',
    roles: ['DELEGATE', 'EXEC', 'FINANCE', 'PROCUREMENT', 'CONTRACT_MGR', 'REQUESTER', 'LEGAL'],
  },
  {
    prefix: '/app/contracts',
    roles: ['LEGAL', 'CONTRACT_MGR', 'PROCUREMENT', 'DELEGATE', 'EXEC', 'FINANCE', 'PROBITY'],
  },
  { prefix: '/app/suppliers', roles: ['PROCUREMENT', 'LEGAL', 'FINANCE', 'ADMIN'] },
  { prefix: '/app/reports', roles: ['EXEC', 'FINANCE', 'PROCUREMENT', 'CONTRACT_MGR'] },
  // B11b: residency and egress are read by oversight roles; privacy management, classification and content safety are narrower
  { prefix: '/admin/residency', roles: ['ADMIN', 'PROBITY', 'EXEC'] },
  // B11a: keys and security evidence are read by oversight roles; the quarantine list by administrators and probity
  { prefix: '/admin/keys', roles: ['ADMIN', 'PROBITY', 'EXEC'] },
  { prefix: '/admin/security-evidence', roles: ['ADMIN', 'PROBITY', 'EXEC'] },
  { prefix: '/admin/quarantine', roles: ['ADMIN', 'PROBITY'] },
  { prefix: '/app/restricted-projects', roles: ['PROCUREMENT', 'EXEC', 'PROBITY'] },
  { prefix: '/app/bid-box', roles: ['PROCUREMENT', 'PROBITY', 'LEGAL', 'EXEC'] },
  { prefix: '/app/privacy/manage', roles: ['ADMIN', 'LEGAL', 'PROBITY'] },
  { prefix: '/app/classification', roles: ['PROBITY', 'ADMIN', 'LEGAL', 'EXEC'] },
  { prefix: '/app/content-safety', roles: ['ADMIN', 'PROBITY', 'PROCUREMENT'] },
  { prefix: '/app', roles: STAFF },
];

export const PUBLIC_PATHS = [
  '/',
  '/login',
  '/forbidden',
  '/forgot-password',
  '/ui-kit',
  '/supplier/register',
  '/supplier/activate',
  '/activate',
  '/preview',
  '/browser-support',
  // a one-time link in an SMS or email: no sign-in (like /approve/[token], these have no route rule)
  '/respond',
];

/** Returns the roles allowed for a path, or null when the path is public / not guarded. */
export function rolesForPath(path: string): readonly RoleName[] | null {
  if (PUBLIC_PATHS.includes(path)) return null; // e.g. supplier self-registration is reachable from an invitation link
  const hit = [...ROUTE_RULES]
    .sort((a, b) => b.prefix.length - a.prefix.length)
    .find((r) => path === r.prefix || path.startsWith(r.prefix + '/'));
  return hit ? hit.roles : null;
}
