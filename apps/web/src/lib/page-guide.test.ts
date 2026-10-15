/**
 * The page guide behind Ask covers every screen. The test walks the web app's page files, the navigation and the roadmap areas,
 * so a new page without a guide entry fails here (add it to packages/shared/src/page-guide.ts).
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PAGE_GUIDE, guideFor, rolesOpening } from '@if/shared';
import { ROADMAP_DATA } from '../../../../packages/shared/src/roadmap-data';
import { NAV } from './nav';

const APP = fileURLToPath(new URL('../app', import.meta.url));

function pageRoutes(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      // a route group such as (portal) is not part of the address
      const seg = /^\(.+\)$/.test(name) ? '' : `/${name}`;
      out.push(...pageRoutes(full, rel + seg));
    } else if (name === 'page.tsx') out.push(rel === '' ? '/' : rel);
  }
  return out;
}
const CATCH_ALL = /\[\[?\.\.\./;
const ROUTES = pageRoutes(APP).filter((r) => !CATCH_ALL.test(r));

describe('page guide covers every screen', () => {
  it('finds the pages of the app', () => {
    expect(ROUTES.length).toBeGreaterThan(80);
    expect(ROUTES).toContain('/app/requests/[id]');
    expect(ROUTES).toContain('/supplier');
  });

  it('every page file of the web app has a guide entry', () => {
    const missing = ROUTES.filter((r) => !PAGE_GUIDE.some((g) => g.route === r));
    expect(
      missing,
      `pages without a guide entry (add to packages/shared/src/page-guide.ts): ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('every guide entry is for a page that exists (no stale or misspelt routes)', () => {
    const stale = PAGE_GUIDE.filter((g) => !ROUTES.includes(g.route)).map((g) => g.route);
    expect(stale).toEqual([]);
  });

  it('every navigation item has its own guide entry, so a new menu item cannot ship without one', () => {
    const missing = NAV.filter((n) => !PAGE_GUIDE.some((g) => g.route === n.href)).map((n) => n.href);
    expect(missing, `navigation items without a guide entry: ${missing.join(', ')}`).toEqual([]);
  });

  it('every area a roadmap requirement belongs to resolves to a guide entry', () => {
    const areas = [...new Set(ROADMAP_DATA.map((r) => r.area).filter((a): a is string => Boolean(a)))];
    expect(areas.length).toBeGreaterThan(3);
    const missing = areas.filter((a) => !guideFor(a));
    expect(missing).toEqual([]);
  });

  it('each entry says what the page is for, what to do, the next step and links to real pages', () => {
    for (const g of PAGE_GUIDE) {
      expect(g.title.length, g.route).toBeGreaterThan(2);
      expect(g.purpose.length, g.route).toBeGreaterThan(20);
      expect(g.can.length, g.route).toBeGreaterThan(0);
      expect(g.next.length, g.route).toBeGreaterThan(5);
      for (const l of g.links) expect(guideFor(l.href), `${g.route} links to ${l.href}`).not.toBeNull();
    }
  });

  it('the roles an action is limited to can open the page (the guide agrees with the route guard)', () => {
    const bad: string[] = [];
    for (const g of PAGE_GUIDE) {
      const open = rolesOpening(g.route);
      if (!open) continue;
      for (const c of g.can)
        for (const r of c.who ?? [])
          if (!open.includes(r)) bad.push(`${g.route}: "${c.text}" names ${r}, who cannot open the page`);
    }
    expect(bad).toEqual([]);
  });

  it('routes are unique and a path with an id resolves to the record page, not a list', () => {
    expect(new Set(PAGE_GUIDE.map((g) => g.route)).size).toBe(PAGE_GUIDE.length);
    const id = '11111111-2222-4333-8444-555555555555';
    expect(guideFor(`/app/requests/${id}`)?.route).toBe('/app/requests/[id]');
    expect(guideFor('/app/requests/new')?.route).toBe('/app/requests/new');
    expect(guideFor(`/app/copilot/${id}`)?.route).toBe('/app/copilot/[id]');
    expect(guideFor('/app/copilot/draft')?.route).toBe('/app/copilot/draft');
    expect(guideFor(`/app/requests/${id}/extra`)?.route).toBe('/app/requests/[id]');
  });
});
