def sub(p, a, b):
    t = open(p, encoding='utf8', newline='').read()
    assert a in t, (p, a[:70])
    open(p, 'w', encoding='utf8', newline='').write(t.replace(a, b, 1))


R = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\web\src'
dp = R + r'\components\requests\draft-panel.tsx'
sub(dp, 'export function DraftPanel({ view }: { view: RequestView }) {',
    'export function DraftPanel({ view, hideHeader = false }: { view: RequestView; hideHeader?: boolean }) {')
t = open(dp, encoding='utf8', newline='').read()
a = t.index('      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">')
b = t.index('      <section aria-label="Key facts">')
header = t[a:b]
t = t[:a] + '      {!hideHeader && (\n' + header.rstrip('\n') + '\n      )}\n\n' + t[b:]
open(dp, 'w', encoding='utf8', newline='').write(t)

page = R + r'\app\app\requests\[id]\page.tsx'
t = open(page, encoding='utf8', newline='').read()
a = t.index('      <header>')
b = t.index('      <div className="grid gap-6 lg:grid-cols-')
new_header = '''      <header className="flex flex-col gap-3">
        <p className="text-sm">
          <Link href="/app/requests">← Requests</Link>
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-md bg-surface-alt px-2 py-1 font-mono text-sm font-semibold text-text-muted">
            {view.number}
          </span>
          <Badge tone={STATUS_TONE[view.status] ?? 'neutral'}>{STATUS_LABEL[view.status] ?? view.status}</Badge>
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight">{view.title}</h1>
        {view.status !== 'DRAFT' && (
          <div>
            <Button asChild variant="secondary">
              <Link href={`/app/plans/${view.id}`} className="text-text no-underline">
                Open the procurement plan
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        )}
      </header>
'''
t = t[:a] + new_header + t[b:]
t = t.replace('<div className="min-w-0 rounded-md border border-border bg-surface p-4">\n          <DraftPanel view={view} />',
              '<div className="min-w-0 rounded-lg border border-border bg-surface p-5 shadow-sm">\n          <DraftPanel view={view} hideHeader />')
t = t.replace("import Link from 'next/link';", "import { ArrowRight } from 'lucide-react';\nimport Link from 'next/link';")
t = t.replace("import { notFound } from 'next/navigation';", "import { notFound } from 'next/navigation';\nimport { Badge, Button } from '@if/ui';")
t = t.replace("import { apiGet, getSessionUser } from '@/lib/session';", "import { STATUS_LABEL, STATUS_TONE } from '@/lib/labels';\nimport { apiGet, getSessionUser } from '@/lib/session';")
open(page, 'w', encoding='utf8', newline='').write(t)
print('ok')
