import { rolesForPath, type RoleName } from '@if/shared';
import { resolveNav } from './nav';

/**
 * Roles allowed to OPEN a path in the browser: the shared route table narrowed by the navigation entry for that
 * module, so a page hidden from a role in the menu is also refused when typed into the address bar.
 * (The API enforces permissions independently; this keeps the UI honest.)
 */
export function allowedRolesForPath(pathname: string): readonly RoleName[] | null {
  const base = rolesForPath(pathname);
  if (!base) return null;
  const item = resolveNav(pathname);
  return item ? base.filter((r) => item.roles.includes(r)) : base;
}
