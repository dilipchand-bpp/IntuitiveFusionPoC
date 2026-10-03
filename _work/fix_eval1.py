import re


def edit(p, pairs, regex=False):
    t = open(p, encoding='utf8', newline='').read()
    for a, b in pairs:
        if regex:
            t, n = re.subn(a, b, t, flags=re.S)
            assert n, a[:80]
        else:
            assert a in t, (p, a[:80])
            t = t.replace(a, b)
    open(p, 'w', encoding='utf8', newline='').write(t)


R = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src\modules\evaluation'
# executives can read (they approve large awards) but hold no bid-file access
edit(R + r'\service.ts', [("const PROCESS_ROLES: RoleName[] = ['PROCUREMENT', 'DELEGATE', 'LEGAL', 'PROBITY'];",
                           "const PROCESS_ROLES: RoleName[] = ['PROCUREMENT', 'DELEGATE', 'LEGAL', 'PROBITY', 'EXEC'];")])
edit(R + r'\routes.ts', [
    ("const PROCESS: readonly RoleName[] = ['PROCUREMENT', 'DELEGATE', 'LEGAL', 'PROBITY'];",
     "const PROCESS: readonly RoleName[] = ['PROCUREMENT', 'DELEGATE', 'LEGAL', 'PROBITY', 'EXEC'];"),
])
t = open(R + r'\routes.ts', encoding='utf8', newline='').read()
t = t.replace("guard(d, ['PROCUREMENT', 'EVALUATOR', 'CHAIR', 'DELEGATE', 'PROBITY', 'LEGAL'])", "guard(d, ['PROCUREMENT', 'EVALUATOR', 'CHAIR', 'DELEGATE', 'PROBITY', 'LEGAL', 'EXEC'])")
open(R + r'\routes.ts', 'w', encoding='utf8', newline='').write(t)

g = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\_work\gen_openapi.py'
edit(g, [('ER = ["PROCUREMENT", "EVALUATOR", "CHAIR", "DELEGATE", "PROBITY", "LEGAL"]', 'ER = ["PROCUREMENT", "EVALUATOR", "CHAIR", "DELEGATE", "PROBITY", "LEGAL", "EXEC"]')])

# ---------------------------------------------------------------- tests
T = R + r'\evaluation.test.ts'
t = open(T, encoding='utf8', newline='').read()

# 1. an open tender needs a future closing time, otherwise it is (correctly) closed automatically first
t = t.replace(
    "await withSystem(database, (tx) => tx.update(s.tender).set({ status: 'PUBLISHED' }).where(eq(s.tender.id, open.tenderId)));",
    "await withSystem(database, (tx) =>\n      tx.update(s.tender).set({ status: 'PUBLISHED', closesAt: new Date(clock.now().getTime() + 5 * 86_400_000) }).where(eq(s.tender.id, open.tenderId)),\n    );")

# 2. score by company name, not by position (the order of suppliers is deliberately unpredictable)
t = t.replace("pick: (supplierIndex: number, criterionName: string) => number", "pick: (company: string, criterionName: string) => number")
t = t.replace("for (const [si, sup] of (mine.suppliers as Array<{ supplierId: string }>).entries()) {", "for (const sup of mine.suppliers as Array<{ supplierId: string; displayName: string }>) {")
t = t.replace("score: c.passFail ? 10 : pick(si, c.name),", "score: c.passFail ? 10 : pick(sup.displayName, c.name),")
t = t.replace("(_i, name) => (name.startsWith('Technical') ? 9.5 : 8.5)", "(_c, name) => (name.startsWith('Technical') ? 9.5 : 8.5)")
t = t.replace("(_i, n) => (n.startsWith('Technical') ? 9 : 7)", "(_c, n) => (n.startsWith('Technical') ? 9 : 7)")
t = t.replace("(_i, n) => (n.startsWith('Technical') ? 5 : 7)", "(_c, n) => (n.startsWith('Technical') ? 5 : 7)")
t = t.replace("const bump = (i: number) => [2, 0, -2][i]!;", "const bump = (company: string) => (company.startsWith('Brightwave') ? 2 : company.startsWith('Evergreen') ? 0 : -2);")
t = t.replace("await scoreAndSubmit('evaluator-tech', ev.id, (i) => 7 + bump(i), 'Solid response');", "await scoreAndSubmit('evaluator-tech', ev.id, (c) => 7 + bump(c), 'Solid response');")
t = t.replace("await scoreAndSubmit('evaluator-comm', ev.id, (i) => 7 + bump(i));", "await scoreAndSubmit('evaluator-comm', ev.id, (c) => 7 + bump(c));")
t = t.replace("await scoreAndSubmit('chair', ev.id, (i) => 7 + bump(i));", "await scoreAndSubmit('chair', ev.id, (c) => 7 + bump(c));")
t = re.sub(r"for \(const \[i, sup\] of open\.suppliers\.entries\(\)\)", "for (const sup of open.suppliers)", t)
t = t.replace("consensusScore: 7 + bump(i) })", "consensusScore: 7 + bump(sup.displayName) })")

# 3. the executive can read, so is no longer in the "no route in at all" list
t = t.replace("for (const who of ['admin', 'exec', 'finance', 'supplier', 'requester'])\n      expect((await call(who, 'GET', `/evaluations/${ev.id}`)).statusCode, who).toBe(403);",
              "for (const who of ['admin', 'finance', 'supplier', 'requester'])\n      expect((await call(who, 'GET', `/evaluations/${ev.id}`)).statusCode, who).toBe(403);\n    // executives may read (they approve large awards) but see no scores and no bid files\n    const execView = JSON.stringify(await view('exec', ev.id));\n    expect(execView).not.toContain(SECRET);\n    expect((await view('exec', ev.id)).suppliers.every((x) => x.files.length === 0)).toBe(true);")
open(T, 'w', encoding='utf8', newline='').write(t)
print('ok')
