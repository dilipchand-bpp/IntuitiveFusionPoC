import type { NavItem } from './nav';

/**
 * The top navigation: which tab each page of the data-driven NAV sits under.
 * The role filter stays in `navFor` (roles are never re-decided here): a tab shows only pages the role can open,
 * and a tab with no page for the role does not appear. A test requires every NAV entry to be placed deliberately.
 */
export type TabId =
  | 'work'
  | 'requests'
  | 'sourcing'
  | 'suppliers'
  | 'contracts'
  | 'legal'
  | 'reports'
  | 'oversight'
  | 'admin'
  | 'portal';

export const TAB_LABEL: Record<TabId, string> = {
  work: 'Your work',
  requests: 'Requests',
  sourcing: 'Sourcing',
  suppliers: 'Suppliers',
  contracts: 'Contracts',
  legal: 'Legal',
  reports: 'Reports',
  oversight: 'Oversight',
  admin: 'Admin',
  portal: 'Supplier portal',
};

/** Left to right. */
export const TAB_ORDER: readonly TabId[] = [
  'work',
  'requests',
  'sourcing',
  'suppliers',
  'contracts',
  'legal',
  'reports',
  'oversight',
  'admin',
  'portal',
];

const place = (tab: TabId, hrefs: string[]): Array<[string, TabId]> => hrefs.map((h) => [h, tab]);

/** Explicit placement of every navigation entry. */
export const TAB_OF: ReadonlyMap<string, TabId> = new Map<string, TabId>([
  ...place('work', ['/app/dashboard', '/app/copilot', '/app/m']),
  ...place('requests', [
    '/app/requests',
    '/app/plans',
    '/app/copilot/draft',
    '/app/buy',
    '/app/approvals',
    '/app/privacy',
    '/app/privacy/manage',
  ]),
  ...place('sourcing', [
    '/app/tenders',
    '/app/evaluations',
    '/app/bid-box',
    '/app/collaboration',
    '/app/shared',
    '/app/search',
  ]),
  ...place('suppliers', ['/app/suppliers', '/app/reports/supplier-risk', '/app/bank-changes']),
  ...place('contracts', [
    '/app/contracts',
    '/app/contracts/ingest',
    '/app/envelopes',
    '/app/repository',
    '/app/continuity',
  ]),
  ...place('legal', [
    '/app/legal',
    '/app/probity',
    '/app/compliance',
    '/app/restricted-projects',
    '/app/classification',
    '/app/content-safety',
    '/app/incidents',
  ]),
  ...place('reports', [
    '/app/reports',
    '/app/reports/ask',
    '/app/reports/schedule',
    '/app/reports/commitment',
    '/app/reports/optimisation',
    '/app/currency',
    '/app/risk',
    '/app/content',
    '/app/hosting-topology',
    '/app/erp',
  ]),
  ...place('oversight', [
    '/app/audit',
    '/app/audit-chain',
    '/app/audit-pack',
    '/app/security-alerts',
    '/app/ai-models',
    '/app/connectors',
    '/app/roadmap',
    '/admin/keys',
    '/admin/security-evidence',
    '/admin/quarantine',
    '/admin/residency',
  ]),
]);

/** Where a page goes if nobody has placed it yet (a test fails first, but the menu still works). */
const SECTION_TAB: Record<NavItem['section'], TabId> = {
  Overview: 'work',
  Procure: 'requests',
  Contracts: 'contracts',
  Insight: 'reports',
  Collaborate: 'sourcing',
  Oversight: 'oversight',
  Administration: 'admin',
  Supplier: 'portal',
};

export const tabOf = (item: NavItem): TabId => TAB_OF.get(item.href) ?? SECTION_TAB[item.section];

export interface NavGroup {
  id: TabId;
  label: string;
  items: NavItem[];
}

/** The tabs this person sees, each with the pages they can open (already filtered by role). */
export function groupNav(items: readonly NavItem[]): NavGroup[] {
  return TAB_ORDER.map((id) => ({
    id,
    label: TAB_LABEL[id],
    items: items.filter((i) => tabOf(i) === id),
  })).filter((g) => g.items.length > 0);
}

/** Screens that are part of a tab but not a menu entry of their own. */
const EXTRA_PREFIXES: ReadonlyArray<[string, TabId]> = [
  ['/app/actions', 'work'],
  ['/app/dashboards', 'work'],
];

/**
 * The page a path belongs to: the most specific menu entry that matches, so /admin does not claim /admin/users.
 * Returns null for pages outside the menu (security settings, 404).
 */
export function currentItem(items: readonly NavItem[], pathname: string): NavItem | null {
  return (
    [...items]
      .filter((i) => pathname === i.href || pathname.startsWith(i.href + '/'))
      .sort((a, b) => b.href.length - a.href.length)[0] ?? null
  );
}

/** The tab to underline for this path. */
export function currentTab(
  groups: readonly NavGroup[],
  items: readonly NavItem[],
  pathname: string,
): TabId | null {
  const it = currentItem(items, pathname);
  if (it) return tabOf(it);
  const extra = EXTRA_PREFIXES.find(([p]) => pathname === p || pathname.startsWith(p + '/'));
  return extra && groups.some((g) => g.id === extra[1]) ? extra[1] : null;
}
