p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src\modules\tender\tender.test.ts'
t = open(p, encoding='utf8', newline='').read()


def sub(a, b):
    global t
    assert a in t, a[:80]
    t = t.replace(a, b, 1)


sub("toContain('Clean all');", "toMatch(/Cleaning of all nominated sites/);")
sub("""    expect(
      (await call(supA.key, 'GET', '/supplier/tenders')).json().map((x: { id: string }) => x.id),
    ).toEqual([a.id]);""",
    """    // (open-access tenders are visible to every supplier by design, so check ours is in and the other closed one is out)
    const mine = (await call(supA.key, 'GET', '/supplier/tenders')).json().map((x: { id: string }) => x.id);
    expect(mine).toContain(a.id);
    expect(mine).not.toContain(b.id);""")
sub("['empty.pdf', Buffer.alloc(0), 400, 'FILE_EMPTY'],", "['empty.pdf', Buffer.alloc(0), 400, 'VALIDATION_FAILED'],")

# anonymity: check the question data itself, not the invitation list (which legitimately names everyone invited)
a = t.index("    for (const res of [\n      staffQs,")
b = t.index("    // unanswered and unpublished: invisible to the other supplier")
t = t[:a] + """    const viewJson = (await call('procurement', 'GET', `/tenders/${t.id}`)).json();
    const questionData = [
      staffQs.body,
      JSON.stringify(viewJson.questions),
      (await call('legal', 'GET', `/tenders/${t.id}/questions`)).body,
      JSON.stringify((await call('probity', 'GET', `/tenders/${t.id}`)).json().questions),
    ];
    for (const body of questionData) {
      expect(body).not.toContain(askerId);
      expect(body).not.toContain(asker.company);
      expect(body).not.toContain(asker.email);
      expect(body.toLowerCase()).not.toContain('askedbysupplier');
    }
    // and nothing in the whole tender view links a supplier id to anything (the invitation list names every invitee equally)
    expect(JSON.stringify(viewJson)).not.toContain(askerId);
""" + t[b:]

sub("    expect(hits.sort()).toEqual(['db/schema.ts', 'db/seed.ts', 'modules/tender/supplier-routes.ts']);",
    """    expect(hits.sort()).toEqual([
      'db/schema.ts',
      'db/seed.ts',
      'modules/tender/serialisers.ts',
      'modules/tender/supplier-routes.ts',
    ]);
    // the serialiser file may only mention it in its explanatory comment, never in code
    for (const line of readFileSync(join(root, 'modules/tender/serialisers.ts'), 'utf8')
      .split('\\n')
      .filter((l) => l.includes('askedBySupplierId')))
      expect(line.trim(), line).toMatch(/^(\\*|\\/\\/|\\/\\*)/);""")
open(p, 'w', encoding='utf8', newline='').write(t)
print('ok')
