import { describe, expect, it } from 'vitest';
import { ROLE_HOME, ROLE_NAMES, primaryRole, rolesForPath } from './access.js';

describe('access vocabulary', () => {
  it('every role has a home page and the home page is allowed for that role', () => {
    for (const r of ROLE_NAMES) {
      const allowed = rolesForPath(ROLE_HOME[r]);
      expect(allowed, `${r} -> ${ROLE_HOME[r]}`).not.toBeNull();
      expect(allowed).toContain(r);
    }
  });
  it('longest prefix wins and unknown public paths are unguarded', () => {
    expect(rolesForPath('/admin/users')).toEqual(['ADMIN']);
    expect(rolesForPath('/app/audit/export')).toContain('PROBITY');
    expect(rolesForPath('/app/audit')).not.toContain('REQUESTER');
    expect(rolesForPath('/app/requests')).toContain('REQUESTER');
    expect(rolesForPath('/')).toBeNull();
    expect(rolesForPath('/administrator')).toBeNull(); // not a path-segment match for /admin
  });
  it('suppliers are excluded from all staff areas; staff excluded from /supplier', () => {
    expect(rolesForPath('/app/requests')).not.toContain('SUPPLIER');
    expect(rolesForPath('/supplier')).toEqual(['SUPPLIER']);
  });
  it('primaryRole prefers more privileged roles', () => {
    expect(primaryRole(['REQUESTER', 'DELEGATE'])).toBe('DELEGATE');
    expect(primaryRole(['SUPPLIER'])).toBe('SUPPLIER');
  });
});
