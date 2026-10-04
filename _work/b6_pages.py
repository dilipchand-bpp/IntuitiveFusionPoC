import os

root = 'apps/web/src/app/app/'


def page(path, imports, title, h1, blurb, body, back='/app/reports', back_label='Reports', user=True):
    src = "import Link from 'next/link';\n" + imports + "\n\nexport const metadata = { title: '" + title + " – Intuitive Fusion' };\n\n"
    src += "export default async function Page() {\n"
    if user:
        src += "  const user = await getSessionUser();\n"
    src += "  return (\n    <div className=\"flex flex-col gap-6\">\n"
    if back:
        src += f"      <p className=\"text-sm\">\n        <Link href=\"{back}\">← {back_label}</Link>\n      </p>\n"
    src += f"      <header>\n        <h1 className=\"text-3xl font-extrabold tracking-tight\">{h1}</h1>\n        <p className=\"mt-1 max-w-prose text-text-muted\">\n          {blurb}\n        </p>\n      </header>\n"
    src += f"      {body}\n    </div>\n  );\n}}\n"
    os.makedirs(os.path.dirname(root + path), exist_ok=True)
    open(root + path, 'w', encoding='utf8', newline='').write(src)


sess = "import { getSessionUser } from '@/lib/session';"
page('reports/schedule/page.tsx', "import { ScheduleGantt } from '@/components/reports/b6-reports';\n" + sess, 'Schedule', 'Procurement schedule',
     'Every active procurement by phase. Drag a phase to move it and everything after it; the delegate calendar is worked out again and delegates are told.',
     '<ScheduleGantt csrf={user!.csrfToken} />', user=True)
page('reports/performance/page.tsx', "import { Performance, SpendBy } from '@/components/reports/b6-reports';", 'Performance', 'Spend and performance',
     'Category spend, maverick spend, captured savings and where procurement time goes, then spend by supplier, contract, master agreement, project, business unit or division.',
     '<>\n        <Performance />\n        <section aria-labelledby="sb-h" className="flex flex-col gap-3">\n          <h2 id="sb-h" className="font-heading text-xl font-bold">\n            Spend by dimension\n          </h2>\n          <SpendBy />\n        </section>\n      </>', user=False)
page('reports/supplier-risk/page.tsx', "import { SupplierRisk } from '@/components/reports/b6-reports';\n" + sess, 'Supplier risk', 'Supplier risk map',
     'Where suppliers are, with weather, financial-distress and geopolitical signals, and the single points of failure. The external feeds are simulated.',
     "<SupplierRisk csrf={user!.csrfToken} canEdit={user!.roles.some((r) => r === 'PROCUREMENT' || r === 'ADMIN')} />")
page('reports/capacity/page.tsx', "import { CapacityView } from '@/components/reports/b6-reports';\n" + sess, 'Workload and capacity', 'Workload and capacity',
     'Active procurements and dollar exposure for each procurement manager, against how many one person can carry.',
     "<CapacityView csrf={user!.csrfToken} canAssign />")
page('reports/ask/page.tsx', "import { AskPanel } from '@/components/reports/b6-reports';\n" + sess, 'Ask for a report', 'Ask for a report',
     'Ask in plain language and see the report, with how it was understood. Save the views you use and share them.',
     '<AskPanel csrf={user!.csrfToken} />')
page('dashboards/page.tsx', "import { Dashboards } from '@/components/reports/b6-reports';", 'Dashboards', 'Dashboards',
     'A view for each role. What you see follows the organisation hierarchy unless the organisation chose broader visibility.',
     '<Dashboards />', back=None, back_label='', user=False)

collab = """import Link from 'next/link';
import { LayoutDesigner, type LayoutViewData } from '@/components/collab/layout-designer';
import { ReferenceContent } from '@/components/collab/ai-panels';
import { apiGet, getSessionUser } from '@/lib/session';

export const metadata = { title: 'Collaboration – Intuitive Fusion' };

const TOOLS = [
  ['Document tools', 'Open a procurement plan or a tender: who else is in it, tracked changes, saved versions, comparison and a digest of what changed since you last looked appear on the page.'],
  ['Risk assessment', 'Open a request to draft a risk assessment: candidate risks, your decisions and ratings, and treatments to choose from.'],
  ['Plain-language instructions', 'Move a procurement to the next phase, change a tender template, or add and remove evaluation committee members by typing what you want.'],
  ['Summary of responses', 'After a tender closes, procurement and the panel see each response summarised: pricing, dates, proposed changes, pros and cons.'],
];

export default async function CollaborationPage() {
  const user = await getSessionUser();
  const canDesign = user?.roles.some((r) => r === 'ADMIN' || r === 'PROCUREMENT') ?? false;
  const canRead = user?.roles.some((r) => ['ADMIN', 'PROCUREMENT', 'LEGAL', 'DELEGATE', 'EXEC'].includes(r)) ?? false;
  const layouts = canRead ? await apiGet<LayoutViewData[]>('/layouts') : null;
  const canContent = user?.roles.some((r) => ['ADMIN', 'PROCUREMENT', 'LEGAL', 'REQUESTER'].includes(r)) ?? false;
  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Collaboration</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Work on documents together, design how they are laid out, and let the platform draft and summarise. The drafting help is rule-based and labelled as simulated.
        </p>
      </header>
      <section aria-labelledby="tools-h">
        <h2 id="tools-h" className="font-heading text-xl font-bold">
          Where to find things
        </h2>
        <dl className="mt-2 grid gap-3 md:grid-cols-2">
          {TOOLS.map(([t, d]) => (
            <div key={t} className="rounded-lg border border-border bg-surface p-4">
              <dt className="font-semibold">{t}</dt>
              <dd className="mt-1 text-sm text-text-muted">{d}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-sm">
          <Link href="/app/plans">Procurement plans</Link> · <Link href="/app/tenders">Tenders</Link> · <Link href="/app/requests">Requests</Link>
        </p>
      </section>
      {layouts && (
        <section aria-labelledby="lay-h" className="flex flex-col gap-4">
          <h2 id="lay-h" className="font-heading text-xl font-bold">
            Document layouts
          </h2>
          {layouts.map((l) => (
            <LayoutDesigner key={l.kind} initial={l} csrf={user!.csrfToken} canEdit={canDesign} />
          ))}
        </section>
      )}
      {canContent && <ReferenceContent csrf={user!.csrfToken} canRefresh={canDesign} />}
    </div>
  );
}
"""
open(root + 'collaboration/page.tsx', 'w', encoding='utf8', newline='').write(collab)
print('ok')
