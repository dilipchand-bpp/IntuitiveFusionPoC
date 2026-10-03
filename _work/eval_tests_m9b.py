p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src\modules\evaluation\evaluation.test.ts'
t = open(p, encoding='utf8', newline='').read()


def rep(a, b):
    global t
    assert a in t, a[:90]
    t = t.replace(a, b, 1)


rep("it('a declared conflict revokes access at once, alerts the chair and probity, is audited, and a replacement can be added to carry on'",
    "it('a declared conflict suspends access at once, alerts the chair and probity and goes to a delegate; a material conflict removes the person and a replacement carries on'")
rep("expect(c.json()).toMatchObject({ removed: true });", "expect(c.json()).toMatchObject({ suspended: true });")
rep("""    await call(replacement.email, 'POST', `/evaluations/${ev.id}/coi`, { none: true });
    expect((await view('procurement', ev.id)).status).toBe('SCORING');
  });""", """    await call(replacement.email, 'POST', `/evaluations/${ev.id}/coi`, { none: true });
    // everyone has declared, but a conflict is still waiting for a delegate, so scoring does not start yet
    expect((await view('procurement', ev.id)).status).toBe('COI_PENDING');
    const waiting = await view('delegate', ev.id);
    expect(waiting.conflicts).toEqual([expect.objectContaining({ name: 'Mei Tanaka', disposition: 'PENDING', nature: expect.stringContaining('Evergreen') })]);
    expect(waiting.permissions.canDecideConflict).toBe(true);
    expect(JSON.stringify(await view('evaluator-tech', ev.id))).not.toContain('Evergreen Facility Services'); // other evaluators never see declared conflicts
    expect((await view('evaluator-tech', ev.id)).conflicts).toEqual([]);
    expect(JSON.stringify((await call('delegate', 'GET', '/notifications')).json())).toContain('Conflict of interest needs your decision');
    const decided = await call('delegate', 'POST', `/evaluations/${ev.id}/conflicts/${U.comm}/decision`, { disposition: 'MATERIAL', rationale: 'Direct shareholding.' });
    expect(decided.statusCode, decided.body).toBe(200);
    expect(decided.json().status).toBe('SCORING');
    expect(decided.json().panel.find((m: { name: string }) => m.name === 'Mei Tanaka').coiState).toBe('REMOVED');
    expect((await call('evaluator-comm', 'GET', `/evaluations/${ev.id}`)).statusCode).toBe(404); // removed for good
    const row = (await withSystem(database, (tx) => tx.select().from(s.coiDeclaration).where(and(eq(s.coiDeclaration.scopeId, ev.id), eq(s.coiDeclaration.userId, U.comm)))))[0]!;
    expect(row).toMatchObject({ disposition: 'MATERIAL' });
    expect(row.decidedAt).not.toBeNull();
    const decisions = await withSystem(database, (tx) => tx.select().from(s.auditEvent).where(and(eq(s.auditEvent.entityId, ev.id), eq(s.auditEvent.action, 'coi.decide'))));
    expect(decisions).toHaveLength(1);
    expect(JSON.stringify((await call('evaluator-comm', 'GET', '/notifications')).json())).toContain('you are removed from the panel');
  });""")
rep("""  const dir = await mkdtemp(join(tmpdir(), 'if-eval-'));
  store = new SealedStore(dir, 'e'.repeat(40));""", """  const dir = await mkdtemp(join(tmpdir(), 'if-eval-'));
  store = new SealedStore(dir, 'e'.repeat(40));
  // seed again with the store so the seeded bid files are really written and can be downloaded
  await withSystem(database, (tx) => tx.execute(sql`select 1`));""") if False else None
open(p, 'w', encoding='utf8', newline='').write(t)
print('patched existing test')
