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
];

/** Returns the roles allowed for a path, or null when the path is public / not guarded. */
export function rolesForPath(path: string): readonly RoleName[] | null {
  if (PUBLIC_PATHS.includes(path)) return null; // e.g. supplier self-registration is reachable from an invitation link
  const hit = [...ROUTE_RULES]
    .sort((a, b) => b.prefix.length - a.prefix.length)
    .find((r) => path === r.prefix || path.startsWith(r.prefix + '/'));
  return hit ? hit.roles : null;
}
