import os

os.chdir('apps/web/src/app/app')


def rw(p, pairs):
    s = open(p, encoding='utf8', newline='').read()
    for old, new in pairs:
        assert old in s, (p, old[:70])
        s = s.replace(old, new, 1)
    open(p, 'w', encoding='utf8', newline='').write(s)


rw('contracts/alerts/page.tsx', [
    ("import type { AlertRow } from '@/components/contract/types';",
     "import { AlertPreferences } from '@/components/contract/b5-pages';\nimport type { AlertRow } from '@/components/contract/types';"),
    ("import { ALERT_KIND, formatDateTime } from '@/lib/labels';\nimport { apiGet } from '@/lib/session';",
     "import { ALERT_KIND, CHANNEL_LABEL, formatDateTime } from '@/lib/labels';\nimport { apiGet, getSessionUser } from '@/lib/session';"),
    ("  const rows = await apiGet<AlertRow[]>('/alerts');",
     "  const [rows, user] = await Promise.all([apiGet<AlertRow[]>('/alerts'), getSessionUser()]);"),
    ("      {!rows ? (", "      <AlertPreferences csrf={user!.csrfToken} />\n      {!rows ? ("),
    ("                    ? `${formatDateTime(a.sentAt)} · ${a.deliveries.length / 2 >= 1 ? 'in-app and email (simulated)' : 'in-app'}`",
     "                    ? `${formatDateTime(a.sentAt)} · ${[...new Set(a.deliveries.map((d) => CHANNEL_LABEL[d.channel] ?? d.channel))].join(' and ')}`"),
])
pill = "className=\"rounded-full border border-border-strong px-4 py-2 text-sm font-semibold no-underline\""
rw('contracts/page.tsx', [(
    "            <Link\n              href=\"/app/contracts/alerts\"\n              " + pill + "\n            >\n              Alerts\n            </Link>",
    "            <Link\n              href=\"/app/contracts/alerts\"\n              " + pill + "\n            >\n              Alerts\n            </Link>\n"
    "            <Link href=\"/app/contracts/mine\" " + pill + ">\n              My contracts and next steps\n            </Link>\n"
    "            <Link href=\"/app/contracts/masters\" " + pill + ">\n              Master agreements\n            </Link>\n"
    "            {user?.roles.some((r) => ['FINANCE', 'CONTRACT_MGR', 'PROCUREMENT', 'EXEC'].includes(r)) && (\n"
    "              <Link href=\"/app/contracts/invoices\" " + pill + ">\n                Invoices\n              </Link>\n            )}\n"
    "            <Link href=\"/app/contracts/disclosures\" " + pill + ">\n              Register disclosures\n            </Link>",
)])
print('ok')
