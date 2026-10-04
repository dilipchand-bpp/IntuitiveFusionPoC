def rw(p, pairs):
    s = open(p, encoding='utf8', newline='').read()
    for old, new in pairs:
        assert old in s, (p, old[:60])
        s = s.replace(old, new, 1)
    open(p, 'w', encoding='utf8', newline='').write(s)


rw('apps/api/src/modules/reporting/b6-routes.ts', [
    ("""      for (const u of units)
        if (u.parentId && mine.has(u.parentId) && !mine.has(u.id)) (mine.add(u.id), (grew = true));""",
     """      for (const u of units) {
        if (u.parentId && mine.has(u.parentId) && !mine.has(u.id)) {
          mine.add(u.id);
          grew = true;
        }
      }"""),
    ("""      let columns: Array<{ key: string; label: string }> = [];
      let data: Array<Record<string, string | number | null>> = [];""",
     """      let columns: Array<{ key: string; label: string }>;
      let data: Array<Record<string, string | number | null>>;"""),
])
rw('apps/web/src/components/tender/tender-workspace.tsx', [
    ("                    version={t.version}\n", ""),
    ("  field,\n  version,\n  canEdit,", "  field,\n  canEdit,"),
    ("  version: number;\n  canEdit: boolean;\n  csrf: string;\n  onSaved", "  canEdit: boolean;\n  csrf: string;\n  onSaved"),
])
rw('apps/web/src/app/app/dashboards/page.tsx', [("import Link from 'next/link';\n", "")])
print('ok')
