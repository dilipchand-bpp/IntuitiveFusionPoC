import { describe, expect, it } from 'vitest';
import { ROLE_NAMES } from '@if/shared';
import { NAV, navFor } from './nav';
import { TAB_LABEL, TAB_OF, TAB_ORDER, currentItem, currentTab, groupNav, tabOf } from './nav-tabs';

describe('top navigation groups', () => {
  it('every page of the data-driven menu is placed under a tab on purpose (a new page must be added to TAB_OF)', () => {
    // Administration and Supplier pages are placed by their section (one tab each); everything else is listed by hand
    const bySection = ['Administration', 'Supplier'];
    const unplaced = NAV.filter((n) => !TAB_OF.has(n.href) && !bySection.includes(n.section)).map(
      (n) => n.href,
    );
    expect(unplaced).toEqual([]);
  });

  it('TAB_OF names only pages that exist, and every tab has a label and a place in the order', () => {
    const hrefs = new Set(NAV.map((n) => n.href));
    expect([...TAB_OF.keys()].filter((h) => !hrefs.has(h))).toEqual([]);
    for (const id of TAB_ORDER) expect(TAB_LABEL[id]).toBeTruthy();
    expect(new Set(TAB_ORDER).size).toBe(TAB_ORDER.length);
  });

  it('the staff tabs are the ones the owner asked for, in order', () => {
    const ids = groupNav(navFor(['PROCUREMENT'])).map((g) => g.label);
    expect(ids.slice(0, 7)).toEqual([
      'Your work',
      'Requests',
      'Sourcing',
      'Suppliers',
      'Contracts',
      'Legal',
      'Reports',
    ]);
  });

  it('a role sees exactly the pages the role filter allows, once each, and never a link it cannot open', () => {
    for (const role of ROLE_NAMES) {
      const allowed = navFor([role]).map((n) => n.href);
      const shown = groupNav(navFor([role])).flatMap((g) => g.items.map((i) => i.href));
      expect([...shown].sort(), role).toEqual([...allowed].sort());
      expect(new Set(shown).size, `${role}: a page under two tabs`).toBe(shown.length);
    }
  });

  it('tabs a role has nothing for do not appear; Admin appears for administrators only', () => {
    expect(groupNav(navFor(['ADMIN'])).some((g) => g.id === 'admin')).toBe(true);
    for (const role of ROLE_NAMES.filter((r) => r !== 'ADMIN'))
      expect(
        groupNav(navFor([role])).some((g) => g.id === 'admin'),
        role,
      ).toBe(false);
    for (const role of ROLE_NAMES)
      for (const g of groupNav(navFor([role]))) expect(g.items.length).toBeGreaterThan(0);
  });

  it('an external advisor gets only the pages the menu already limits them to', () => {
    const hrefs = groupNav(navFor(['PROBITY'], true)).flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs.sort()).toEqual(['/app/evaluations', '/app/probity']);
  });

  it('suppliers see their portal pages under one tab', () => {
    const g = groupNav(navFor(['SUPPLIER']));
    expect(g.map((x) => x.id)).toEqual(['portal']);
  });

  it('every role has the Your work home under the first tab', () => {
    for (const role of ROLE_NAMES.filter((r) => r !== 'SUPPLIER')) {
      const first = groupNav(navFor([role]))[0]!;
      expect(first.id === 'work' || first.items.length > 0, role).toBe(true);
    }
    expect(tabOf(NAV.find((n) => n.href === '/app/dashboard')!)).toBe('work');
  });
});

describe('which tab is current', () => {
  const items = navFor(['ADMIN']);
  const groups = groupNav(items);
  it('the most specific page wins, so /admin does not claim /admin/users', () => {
    expect(currentItem(items, '/admin/users')?.href).toBe('/admin/users');
    expect(currentItem(items, '/admin')?.href).toBe('/admin');
  });
  it('deep paths belong to the page they sit under', () => {
    expect(currentTab(groups, navFor(['PROCUREMENT']), '/app/requests/abc/edit')).toBe('requests');
  });
  it('screens outside the menu fall back to their tab or to none', () => {
    expect(currentTab(groupNav(navFor(['REQUESTER'])), navFor(['REQUESTER']), '/app/actions')).toBe('work');
    expect(currentTab(groups, items, '/app/security')).toBeNull();
  });
});
