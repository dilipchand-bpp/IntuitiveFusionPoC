import re

root = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC'
src = open(root + r'\apps\api\src\modules\evaluation\evaluation.test.ts', encoding='utf8').read()
cut = src.index('// =================================================================== US-EVL-02')
head = src[:cut]
head = head.replace("method: 'GET' | 'POST' | 'PUT', url: string", "method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string")
assert "'DELETE'" in head
head = head.replace("headers: method === 'GET' ? {} : { 'x-csrf-token': sess.csrf },", "headers: method === 'GET' ? {} : { 'x-csrf-token': sess.csrf },")
body = open(root + r'\_work\b3_test_body.ts', encoding='utf8').read()


def rep(a, b):
    global body
    assert a in body, a[:70]
    body = body.replace(a, b, 1)


rep("call('procurement', 'DELETE' as never, ", "call('procurement', 'DELETE', ")

# clarifications of this evaluation only
rep("""    const mine = (await call('supplier', 'GET', '/supplier/clarifications')).json().clarifications as Array<{
      kind: string;
      subject: string;
      status: string;
    }>;
    expect(mine).toEqual(""", """    const mine = (
      (await call('supplier', 'GET', '/supplier/clarifications')).json().clarifications as Array<{
        evaluationId: string;
        kind: string;
        subject: string;
        status: string;
      }>
    ).filter((c) => c.evaluationId === ev.id);
    expect(mine).toEqual(""")

# ranking mode: agree the consensus before locking
rep("""    for (const sup of open.suppliers) {
      const first = open.consensus.find((c) => c.supplierId === sup.supplierId)!;
      expect(first.consensusScore).not.toBeNull(); // all three ranked alike, so nothing is flagged
      expect(first.flagged).toBe(false);
    }
    expect((await call('chair', 'POST', `/evaluations/${ev.id}/consensus/lock`)).statusCode).toBe(200);""", """    for (const sup of open.suppliers) {
      const cell = open.consensus.find((c) => c.supplierId === sup.supplierId)!;
      expect(cell.flagged).toBe(false); // all three ranked alike, so nothing is flagged
      const agreed = sup.displayName.startsWith('Brightwave') ? 10 : sup.displayName.startsWith('Evergreen') ? 5 : 0;
      expect(
        (
          await call('chair', 'PUT', `/evaluations/${ev.id}/consensus/${sup.supplierId}`, {
            items: [{ criterionId: cell.criterionId, consensusScore: agreed }],
          })
        ).statusCode,
      ).toBe(200);
    }
    expect((await call('chair', 'POST', `/evaluations/${ev.id}/consensus/lock`)).statusCode).toBe(200);""")

# reminders: count this evaluation's only
rep("""    const n1 = (await withSystem(database, (tx) => tx.select().from(s.notification).where(eq(s.notification.userId, U.tech)))).filter((x) => x.title.startsWith('Reminder')).length;""", """    const remindersFor = async () =>
      (await withSystem(database, (tx) => tx.select().from(s.notification).where(eq(s.notification.userId, U.tech)))).filter(
        (x) => x.title.startsWith('Reminder') && x.link === `/app/evaluations/${ev.id}`,
      ).length;
    const n1 = await remindersFor();""")
rep("""    const n2 = (await withSystem(database, (tx) => tx.select().from(s.notification).where(eq(s.notification.userId, U.tech)))).filter((x) => x.title.startsWith('Reminder')).length;
    expect(n2).toBe(n1 + 1);""", """    expect(await remindersFor()).toBe(n1 + 1);""")

# report export audit info: values are drawn as separate text items
rep("""    expect(text).toMatch(/Exported by Jonas Becker/);
    expect(text).toMatch(/Content fingerprint [0-9a-f]{16}/);
    expect(text).toMatch(/Audit reference/);""", """    expect(text).toContain('(Exported by) Tj');
    expect(text).toMatch(/\\(Jonas Becker, \\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d UTC\\) Tj/);
    expect(text).toMatch(/\\(Content fingerprint\\) Tj/);
    expect(text).toMatch(/\\(RPT-[0-9A-F]{8}-V\\d+\\) Tj/);""")
rep("""    const fp = (b: string) => /Content fingerprint ([0-9a-f]{16})/.exec(b)![1];""", """    const fp = (b: string) => /\\(([0-9a-f]{16})\\) Tj/.exec(b)![1];""")
rep("""    expect(again.rawPayload.toString('latin1')).toMatch(/Exported by Henry Albright/);""", """    expect(again.rawPayload.toString('latin1')).toMatch(/\\(Henry Albright, /);""")
rep("""/Draft \\(not signed\\)/""", """/Draft, not signed/""")

# multi-stage: build stage 2 directly (the B2 shortlist route needs a full tender pack)
a = body.index("    const sl = await call('procurement', 'POST', `/tenders/${tenderId}/shortlist`")
b = body.index("    // stage 2 is run on the shortlisted suppliers' stage-2 submissions")
body = body[:a] + """    const next = await withSystem(database, async (tx) => {
      const [t1] = await tx.select().from(s.tender).where(eq(s.tender.id, tenderId));
      await tx
        .update(s.tender)
        .set({ shortlist: [SUP.brightwave, SUP.evergreen], shortlistedAt: clock.now() })
        .where(eq(s.tender.id, tenderId));
      const [t2] = await tx
        .insert(s.tender)
        .values({
          tenantId: TENANT_ID,
          requestId: t1!.requestId,
          type: 'RFT',
          access: 'CLOSED',
          status: 'CLOSED',
          stage: 2,
          parentTenderId: tenderId,
          opensAt: new Date(clock.now().getTime() - 3 * 86_400_000),
          closesAt: new Date(clock.now().getTime() - 86_400_000),
        })
        .returning();
      return t2!.id;
    });
""" + body[b:]
rep("""      await tx.update(s.tender).set({ status: 'CLOSED', closesAt: new Date(clock.now().getTime() - 1000) }).where(eq(s.tender.id, next));
      for (const sup of""", """      for (const sup of""")

open(root + r'\apps\api\src\modules\evaluation\b3.test.ts', 'w', encoding='utf8').write(head + body)
print('ok')
