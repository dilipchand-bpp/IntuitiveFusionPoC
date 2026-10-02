import { describe, expect, it } from 'vitest';
import { ROLE_HOME, ROLE_NAMES, rolesForPath } from '@if/shared';
import { allowedRolesForPath } from './access';
import { NAV, navFor, resolveNav } from './nav';

describe('navigation vs route guard', () => {
  it('no nav item is shown to a role the route guard would refuse (no dead links)', () => {
    for (const item of NAV) {
      const allowed = rolesForPath(item.href);
      expect(allowed, item.href).not.toBeNull();
      for (const r of item.roles) expect(allowed, `${item.href} shown to ${r}`).toContain(r);
    }
  });

  it('every role sees its own home page in its navigation', () => {
    for (const role of ROLE_NAMES) {
      const hrefs = navFor([role]).map((n) => n.href);
      expect(hrefs, role).toContain(ROLE_HOME[role]);
    }
  });

  it('every role has at least 2 navigation entries and every item has requirement traceability', () => {
    for (const role of ROLE_NAMES) expect(navFor([role]).length, role).toBeGreaterThanOrEqual(2);
    for (const n of NAV) expect(n.requirements.length, n.href).toBeGreaterThan(0);
  });

  it('suppliers see only supplier items; staff never see supplier items', () => {
    expect(navFor(['SUPPLIER']).every((n) => n.section === 'Supplier')).toBe(true);
    expect(navFor(['REQUESTER']).some((n) => n.section === 'Supplier')).toBe(false);
  });

  it('administration items are visible to ADMIN only', () => {
    for (const n of NAV.filter((x) => x.section === 'Administration')) expect(n.roles).toEqual(['ADMIN']);
  });

  it('hrefs are unique', () => {
    expect(new Set(NAV.map((n) => n.href)).size).toBe(NAV.length);
  });

  it('resolveNav matches deep paths to their module and ignores unknown ones', () => {
    expect(resolveNav('/app/requests/abc/edit')?.href).toBe('/app/requests');
    expect(resolveNav('/admin/users')?.href).toBe('/admin/users');
    expect(resolveNav('/app/nonsense')).toBeNull();
    expect(resolveNav('/app/requestsX')).toBeNull();
  });

  it('typing a hidden page into the address bar is refused exactly like hiding it from the menu', () => {
    for (const item of NAV) {
      expect([...(allowedRolesForPath(item.href) ?? [])].sort(), item.href).toEqual([...item.roles].sort());
    }
    expect(allowedRolesForPath('/app/approvals')).not.toContain('REQUESTER');
    expect(allowedRolesForPath('/app/approvals/123')).not.toContain('REQUESTER');
    expect(allowedRolesForPath('/app/approvals')).toContain('DELEGATE');
    expect(allowedRolesForPath('/')).toBeNull();
    expect(allowedRolesForPath('/app/unknown')).toContain('REQUESTER'); // unknown => falls through to a 404 page
  });
});
