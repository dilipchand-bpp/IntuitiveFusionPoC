import os
os.chdir(r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\web\src')


def edit(p, pairs):
    t = open(p, encoding='utf8').read()
    for a, b in pairs:
        assert a in t, (p, a[:60])
        t = t.replace(a, b, 1)
    open(p, 'w', encoding='utf8').write(t)


edit('lib/nav.ts', [
    ("  | 'reports'\n", "  | 'reports'\n  | 'suppliers'\n"),
    ("  {\n    href: '/app/reports',", """  {
    href: '/app/suppliers',
    label: 'Suppliers',
    icon: 'suppliers',
    roles: ['PROCUREMENT', 'LEGAL', 'FINANCE'],
    section: 'Work',
    module: 'Supplier directory',
    requirements: ['FR-0180', 'FR-0185', 'FR-0245', 'FR-0250'],
    blurb: 'Supplier profiles with sanctions and insurance status, and their contacts.',
  },
  {
    href: '/app/reports',"""),
])
edit('components/shell/nav-links.tsx', [("  reports: BarChart3,", "  reports: BarChart3,\n  suppliers: Building2,")])
edit(r'..\..\..\packages\shared\src\access.ts', [
    ("  '/supplier/register',", "  '/supplier/register',\n  '/supplier/activate',"),
    ("  { prefix: '/app', roles: STAFF },", "  { prefix: '/app/suppliers', roles: ['PROCUREMENT', 'LEGAL', 'FINANCE', 'ADMIN'] },\n  { prefix: '/app/reports', roles: ['EXEC', 'FINANCE', 'PROCUREMENT', 'CONTRACT_MGR'] },\n  { prefix: '/app', roles: STAFF },"),
])
print('ok')
