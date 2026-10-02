import re
base = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\web\src\app\app\requests\[id]\page.tsx'
t = open(base, encoding='utf8', newline='').read()
old = '<h1 className="mt-1 text-3xl font-bold">{view.title}</h1>'
assert old in t
t = t.replace(old, old + """
        {view.status !== 'DRAFT' && (
          <p className="mt-2">
            <Link href={`/app/plans/${view.id}`}>Open the procurement plan →</Link>
          </p>
        )}""", 1)
open(base, 'w', encoding='utf8', newline='').write(t)
print('ok')
