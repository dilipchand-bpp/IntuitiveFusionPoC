def rw(p, pairs):
    s = open(p, encoding='utf8', newline='').read()
    for old, new in pairs:
        assert old in s, (p, old[:60])
        s = s.replace(old, new)
    open(p, 'w', encoding='utf8', newline='').write(s)


rw('apps/api/src/modules/reporting/b6-rules.ts', [
    ("/** Orders and filters a document's sections by the layout; a section the layout does not mention keeps its default place at the end. */",
     "/** Orders and filters a document's sections by the layout; a section the layout does not list is left out. */"),
    ("""  return items
    .filter((i) => !off.has(i.key))
    .map((i, idx) => ({ i, k: pos.get(i.key) ?? 1000 + idx }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.i);""", """  return items
    .filter((i) => pos.has(i.key) && !off.has(i.key))
    .sort((a, b) => pos.get(a.key)! - pos.get(b.key)!);"""),
    ("const y = /\\b(20\\d{2})\\b/.exec(s);", "const y = /\\b((?:19|20)\\d{2})\\b/.exec(s);"),
])
rw('apps/api/src/modules/reporting/b6-rules.test.ts', [
    ("expect(applyLayout(items, [{ key: 'b', enabled: true }]).map((i) => i.key)).toEqual(['b', 'a', 'c']);",
     "expect(applyLayout(items, [{ key: 'b', enabled: true }]).map((i) => i.key)).toEqual(['b']); // not listed means left out"),
])
rw('apps/api/src/modules/collab/b6.test.ts', [
    ("    const t = await call('procurement', 'POST', '/tenders', { requestId: r.id, type: 'RFP', access: 'OPEN' });\n    expect(t.statusCode, t.body).toBe(201);\n    const fields",
     "    await planOf(r.id);\n    const t = await call('procurement', 'POST', '/tenders', { requestId: r.id, type: 'RFP', access: 'OPEN' });\n    expect(t.statusCode, t.body).toBe(201);\n    const fields"),
    ("    const r = await request();\n    const t = await call('procurement', 'POST', '/tenders', { requestId: r.id, type: 'RFP', access: 'OPEN' });\n    const tid",
     "    const r = await request();\n    await planOf(r.id);\n    const t = await call('procurement', 'POST', '/tenders', { requestId: r.id, type: 'RFP', access: 'OPEN' });\n    const tid"),
    ("value: '7.00', submitted: false } as never", "score: '7.00' }"),
])
print('ok')
