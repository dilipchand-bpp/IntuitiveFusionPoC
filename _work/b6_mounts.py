def rw(p, pairs):
    s = open(p, encoding='utf8', newline='').read()
    for old, new in pairs:
        assert old in s, (p, old[:60])
        s = s.replace(old, new, 1)
    open(p, 'w', encoding='utf8', newline='').write(s)


a = 'apps/web/src/app/app/'
rw(a + 'plans/[requestId]/page.tsx', [
    ("import { EsgCard, type EsgData } from '@/components/plan/esg-card';", "import { DocumentTools } from '@/components/collab/doc-tools';\nimport { EsgCard, type EsgData } from '@/components/plan/esg-card';"),
    ("""          {esg && (
            <EsgCard""", """          <DocumentTools type="plan" id={res.data.id} csrf={user.csrfToken} />
          {esg && (
            <EsgCard"""),
])
rw(a + 'tenders/[id]/page.tsx', [
    ("import type { TenderView } from '@/components/tender/types';", "import { DocumentTools } from '@/components/collab/doc-tools';\nimport { InstructBox, ResponseSummaries } from '@/components/collab/ai-panels';\nimport type { TenderView } from '@/components/tender/types';"),
    ("""          <TenderWorkspace initial={res.data} csrf={user.csrfToken} roles={user.roles} />""", """          <TenderWorkspace initial={res.data} csrf={user.csrfToken} roles={user.roles} />
          {user.roles.includes('PROCUREMENT') && res.data.status === 'STAGED' && (
            <InstructBox
              testId="template-change"
              title="Change the template"
              label="Tell the platform which template to use"
              hint='For example "use the request for quotation template". Sections you wrote yourself are kept; the rest are filled in again.'
              path={`/tenders/${res.data.id}/template-change`}
              csrf={user.csrfToken}
              button="Change template"
              onDone={undefined}
            />
          )}
          {['CLOSED', 'EVALUATING', 'AWARDED'].includes(res.data.status) &&
            user.roles.some((r) => ['PROCUREMENT', 'LEGAL', 'CHAIR', 'EVALUATOR'].includes(r)) && (
              <ResponseSummaries tenderId={res.data.id} />
            )}
          {user.roles.some((r) => ['PROCUREMENT', 'LEGAL'].includes(r)) && (
            <DocumentTools type="tender" id={res.data.id} csrf={user.csrfToken} />
          )}"""),
])
rw(a + 'evaluations/[id]/page.tsx', [
    ("import { EvaluationWorkspace }", "import { InstructBox } from '@/components/collab/ai-panels';\nimport { EvaluationWorkspace }"),
    ("""          <EvaluationWorkspace initial={res.data} csrf={user.csrfToken} roles={user.roles} />""", """          <EvaluationWorkspace initial={res.data} csrf={user.csrfToken} roles={user.roles} />
          {user.roles.includes('PROCUREMENT') && ['COI_PENDING', 'SCORING'].includes(res.data.status) && (
            <InstructBox
              testId="committee-box"
              title="Change the committee"
              label="Say who to add or remove"
              hint='For example "add Tomas" or "remove Mei Tanaka". If several people match you choose from a list.'
              path={`/evaluations/${res.data.id}/committee/instruct`}
              csrf={user.csrfToken}
              button="Do it"
            />
          )}"""),
])
rw(a + 'requests/[id]/page.tsx', [
    ("import { DraftPanel } from '@/components/requests/draft-panel';", "import { InstructBox, RiskAssessmentPanel } from '@/components/collab/ai-panels';\nimport { DraftPanel } from '@/components/requests/draft-panel';"),
    ("""          <RequestActions view={view} csrf={user.csrfToken} canEdit={canEdit} />""", """          <RequestActions view={view} csrf={user.csrfToken} canEdit={canEdit} />
          {view.status !== 'DRAFT' && canEdit && (
            <InstructBox
              testId="advance-box"
              title="Move this procurement on"
              label="Say where it should go"
              hint='For example "go to the next phase" or "move to tender". It moves only when the work before it is finished.'
              path={`/requests/${view.id}/advance`}
              csrf={user.csrfToken}
              button="Move on"
            />
          )}
          {view.status !== 'DRAFT' && (
            <RiskAssessmentPanel requestId={view.id} csrf={user.csrfToken} canEdit={canEdit} />
          )}"""),
])

# route rules, nav, reports links
rw('packages/shared/src/access.ts', [("""  { prefix: '/app/contracts/expiring',""", """  { prefix: '/app/reports/schedule', roles: ['PROCUREMENT', 'EXEC', 'DELEGATE'] },
  { prefix: '/app/reports/capacity', roles: ['PROCUREMENT', 'EXEC'] },
  { prefix: '/app/reports/supplier-risk', roles: ['PROCUREMENT', 'EXEC', 'FINANCE', 'PROBITY'] },
  {
    prefix: '/app/reports/ask',
    roles: ['EXEC', 'FINANCE', 'PROCUREMENT', 'CONTRACT_MGR', 'DELEGATE', 'LEGAL', 'PROBITY'],
  },
  {
    prefix: '/app/dashboards',
    roles: ['PROCUREMENT', 'LEGAL', 'DELEGATE', 'EXEC', 'FINANCE', 'PROBITY', 'CONTRACT_MGR', 'ADMIN'],
  },
  { prefix: '/app/contracts/expiring',""")])
rw('apps/web/src/lib/nav.ts', [("""  {
    href: '/app/collaboration',
    label: 'Collaboration',
    icon: 'plans',
    roles: STAFF_ALL,
    section: 'Work',
    module: 'Collaboration & AI authoring',
    requirements: [
      'FR-0115',
      'FR-0125',
      'FR-0140',
      'FR-0145',
      'FR-0735',
      'FR-0740',
      'FR-0750',
      'FR-0755',
      'FR-0760',
      'FR-0765',
      'FR-0770',
      'FR-0775',
    ],
    blurb:
      'Work on tender documents together, with AI-assisted drafting and review. Planned for a later release; the proof of concept covers the single-author flow.',
  },""", """  {
    href: '/app/dashboards',
    label: 'Dashboards',
    icon: 'dashboard',
    roles: ['PROCUREMENT', 'LEGAL', 'DELEGATE', 'EXEC', 'FINANCE', 'PROBITY', 'CONTRACT_MGR', 'ADMIN'],
    section: 'Work',
    module: 'Role dashboards',
    requirements: ['FR-0600'],
    blurb: 'A dashboard for your role, scoped by the organisation hierarchy.',
  },
  {
    href: '/app/collaboration',
    label: 'Collaboration',
    icon: 'plans',
    roles: STAFF_ALL,
    section: 'Work',
    module: 'Collaboration & AI authoring',
    requirements: ['FR-0115', 'FR-0125', 'FR-0140', 'FR-0145'],
    blurb:
      'Design document layouts, find the tools for working together on a document, and the best-practice reference content.',
  },""")])
rw(a + 'reports/page.tsx', [("""        {has('CONTRACT_MGR', 'PROCUREMENT', 'LEGAL', 'EXEC') && (
          <nav aria-label="Related reports" className="mt-3 flex flex-wrap gap-2">""", """        <nav aria-label="More reports" className="mt-3 flex flex-wrap gap-2">
          {[
            ['/app/reports/ask', 'Ask for a report', ['EXEC', 'FINANCE', 'PROCUREMENT', 'CONTRACT_MGR', 'DELEGATE', 'LEGAL', 'PROBITY']],
            ['/app/reports/performance', 'Spend and performance', ['EXEC', 'FINANCE', 'PROCUREMENT']],
            ['/app/reports/schedule', 'Schedule', ['PROCUREMENT', 'EXEC', 'DELEGATE']],
            ['/app/reports/capacity', 'Workload and capacity', ['PROCUREMENT', 'EXEC']],
            ['/app/reports/supplier-risk', 'Supplier risk map', ['PROCUREMENT', 'EXEC', 'FINANCE', 'PROBITY']],
          ]
            .filter(([, , roles]) => has(...(roles as string[])))
            .map(([href, label]) => (
              <Link
                key={href as string}
                href={href as string}
                className="rounded-full border border-border-strong px-4 py-2 text-sm font-semibold no-underline"
              >
                {label as string}
              </Link>
            ))}
        </nav>
        {has('CONTRACT_MGR', 'PROCUREMENT', 'LEGAL', 'EXEC') && (
          <nav aria-label="Related reports" className="mt-3 flex flex-wrap gap-2">""")])
print('ok')
