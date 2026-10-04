root = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC'


def patch(path, pairs):
    p = root + '\\' + path
    s = open(p, encoding='utf8').read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, s.count(a), a[:70])
        s = s.replace(a, b)
    open(p, 'w', encoding='utf8').write(s)


patch(r'apps\api\src\auth\identity-provider.ts', [
    ("  pool: 'STAFF' | 'SUPPLIER';\n}", "  pool: 'STAFF' | 'SUPPLIER';\n  /** An external person, such as a probity advisor, who may use only what they are allocated (FR-0310). */\n  external: boolean;\n}"),
    ("      pool: roles.includes('SUPPLIER') ? 'SUPPLIER' : 'STAFF',\n    };", "      pool: roles.includes('SUPPLIER') ? 'SUPPLIER' : 'STAFF',\n      external: u.external,\n    };"),
])
patch(r'apps\api\src\auth\routes.ts', [
    ("  homePath: ROLE_HOME[u.role],\n});", "  homePath: u.external ? '/app/probity' : ROLE_HOME[u.role],\n  ...(u.external ? { external: true } : {}),\n});"),
])
patch(r'apps\api\src\auth\guard.ts', [
    ("""    if (access === 'any') return;
    if (!req.auth.user.roles.some((r) => access.includes(r))) {""", """    // an external advisor can reach only the evaluation, probity and sign-in routes (FR-0310)
    if (req.auth.user.external && !EXTERNAL_OK.some((p) => (req.routeOptions.url ?? '').startsWith(`/api/v1${p}`))) {
      await deps.audit.recordOutsideTx(deps.database, req.auth.ctx, {
        action: 'access.denied',
        entityType: 'route',
        after: { method: req.method, path: req.routeOptions.url, reason: 'EXTERNAL_SCOPE' },
        result: 'DENIED',
      });
      throw forbidden();
    }
    if (access === 'any') return;
    if (!req.auth.user.roles.some((r) => access.includes(r))) {"""),
    ("const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);", "const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);\nconst EXTERNAL_OK = ['/auth', '/notifications', '/probity', '/evaluations', '/evaluation-reports', '/settings'];"),
])
patch(r'_work\gen_openapi.py', [
    ('"homePath": S, "csrfToken": S}, ["id", "name", "email", "role"]),', '"homePath": S, "external": B, "csrfToken": S}, ["id", "name", "email", "role"]),'),
])
patch(r'apps\web\src\lib\session.ts', [
    ("  homePath: string;\n  csrfToken: string;\n}", "  homePath: string;\n  external?: boolean;\n  csrfToken: string;\n}"),
])
patch(r'apps\web\src\lib\nav.ts', [
    ("""  {
    href: '/app/audit',
    label: 'Audit trail',""", """  {
    href: '/app/probity',
    label: 'Probity portal',
    icon: 'audit',
    roles: ['PROBITY'],
    section: 'Oversight',
    module: 'Probity oversight',
    requirements: ['FR-0310', 'FR-0340'],
    blurb: 'Read-only oversight of the procurements you are allocated to, with a system hold and the probity documents.',
  },
  {
    href: '/app/audit',
    label: 'Audit trail',"""),
    ("""export const navFor = (roles: readonly string[]): NavItem[] =>
  NAV.filter((n) => n.roles.some((r) => roles.includes(r)));""", """export const navFor = (roles: readonly string[], external = false): NavItem[] =>
  NAV.filter(
    (n) =>
      n.roles.some((r) => roles.includes(r)) &&
      // an external advisor sees only the probity portal and the evaluations they are allocated to
      (!external || n.href === '/app/probity' || n.href === '/app/evaluations'),
  );"""),
])
patch(r'apps\web\src\components\shell\app-shell.tsx', [
    ("      items={navFor(user.roles)}", "      items={navFor(user.roles, Boolean(user.external))}"),
])
patch(r'packages\shared\src\access.ts', [
    ("  { prefix: '/app/audit', roles: ['PROBITY', 'ADMIN', 'EXEC', 'PROCUREMENT'] },", "  { prefix: '/app/audit', roles: ['PROBITY', 'ADMIN', 'EXEC', 'PROCUREMENT'] },\n  { prefix: '/app/probity', roles: ['PROBITY'] },"),
])
print('ok')
