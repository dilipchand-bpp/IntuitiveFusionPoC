p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\web\src\components\tender\tender-workspace.tsx'
t = open(p, encoding='utf8', newline='').read()
t = t.replace('<Card aria-labelledby=', '<Card role="region" aria-labelledby=')
open(p, 'w', encoding='utf8', newline='').write(t)

p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\web\src\app\app\approvals\page.tsx'
t = open(p, encoding='utf8', newline='').read()
t = t.replace("import { apiGet } from '@/lib/session';",
              "import type { TenderSummary } from '@/components/tender/types';\nimport { apiGet } from '@/lib/session';")
old = "  const rows = await apiGet<Row[]>('/plans?status=AWAITING_APPROVAL');"
assert old in t
t = t.replace(old, """  const [rows, tenders] = await Promise.all([
    apiGet<Row[]>('/plans?status=AWAITING_APPROVAL'),
    apiGet<TenderSummary[]>('/tenders'),
  ]);
  const staged = (tenders ?? []).filter((x) => x.status === 'STAGED' && !x.permissionGranted);""")
section = """      {staged.length > 0 && (
        <section aria-labelledby="permit-h" className="flex flex-col gap-3">
          <h2 id="permit-h" className="font-heading text-xl font-bold">
            Tenders waiting for permission to publish
          </h2>
          <ul className="grid gap-3" aria-label="Tenders awaiting permission to publish">
            {staged.map((x) => (
              <li
                key={x.id}
                className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm sm:flex-row sm:items-center"
                data-testid="permit-item"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs text-text-muted">{x.requestNumber}</p>
                  <p className="font-heading text-lg font-semibold">{x.title}</p>
                  <p className="text-sm text-text-muted">
                    {aud.format(x.estimatedValue)} · staged, not visible to suppliers
                  </p>
                </div>
                <Button asChild variant="accent">
                  <Link href={`/app/tenders/${x.id}`} className="text-gradient-fg no-underline">
                    Review and give permission
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
"""
idx = t.rindex("    </div>\n  );\n}")
t = t[:idx] + section + t[idx:]
open(p, 'w', encoding='utf8', newline='').write(t)
print('ok')
