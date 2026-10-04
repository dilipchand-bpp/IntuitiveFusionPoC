def rw(p, pairs):
    s = open(p, encoding='utf8', newline='').read()
    for old, new in pairs:
        assert old in s, (p, old[:60])
        s = s.replace(old, new)
    open(p, 'w', encoding='utf8', newline='').write(s)


rw('apps/web/src/app/app/tenders/page.tsx', [
    ("<Link href={`/app/tenders/${t.id}`}>{t.title}</Link>", "<Link href={`/app/tenders/${t.id}`} className=\"underline\">\n                      {t.title}\n                    </Link>"),
])
rw('apps/web/src/components/collab/doc-tools.tsx', [
    ("            Save version\n", "            Keep this version\n"),
])
rw('e2e/b6.spec.ts', [
    ("name: 'Save version'", "name: 'Keep this version'"),
])
rw('e2e/crawler.spec.ts', [
    ("""  await page.goto('/app/collaboration');
  await expect(page.getByRole('heading', { name: /coming soon/i })).toBeVisible();""",
     """  await page.goto('/app/collaboration'); // built in roadmap batch B6
  await expect(page.getByRole('heading', { name: 'Collaboration', level: 1 })).toBeVisible();"""),
])
print('ok')
