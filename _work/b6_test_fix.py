p = 'apps/api/src/modules/collab/b6.test.ts'
s = open(p, encoding='utf8', newline='').read()


def rep(old, new):
    global s
    assert old in s, old[:60]
    s = s.replace(old, new, 1)


rep("(await planOf(r.id)).fields as Json[])[0].key", "(await planOf(r.id)).fields as Json[])[0]!.key")
rep("expect(slots[2].startDate).toBe(addDays(before[2].startDate, 10));", "expect(slots[2]!.startDate).toBe(addDays(before[2]!.startDate, 10));")
rep("expect(slots[4].endDate).toBe(addDays(before[4].endDate, 10));", "expect(slots[4]!.endDate).toBe(addDays(before[4]!.endDate, 10));")
rep(".date).toBe(slots[4].endDate);", ".date).toBe(slots[4]!.endDate);")
rep("expect(own.find((v) => v.name === 'My 2026 risks').filters.question)", "expect(own.find((v) => v.name === 'My 2026 risks')!.filters.question)")
rep("""    const saved = perf.savings.items.find((x: Json) => x.title === `Env fixture ${(await env.withSystem(env.database, (tx) => tx.select().from(s.request).where(eq(s.request.id, d.requestId))))[0]!.title.split(' ').pop()}`);""",
    """    const [rq] = await env.withSystem(env.database, (tx) => tx.select().from(s.request).where(eq(s.request.id, d.requestId)));
    const saved = perf.savings.items.find((x: Json) => x.number === rq!.number);""")
open(p, 'w', encoding='utf8', newline='').write(s)
print('ok')
