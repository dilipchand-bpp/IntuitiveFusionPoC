def rw(p, pairs):
    s = open(p, encoding='utf8', newline='').read()
    for old, new in pairs:
        assert old in s, (p, old[:60])
        s = s.replace(old, new, 1)
    open(p, 'w', encoding='utf8', newline='').write(s)


rw('apps/api/src/modules/evaluation/routes.ts', [
    ("""        const scored = await tx
          .select({ id: score.id })
          .from(score)
          .where(and(eq(score.evaluationId, id), eq(score.evaluatorId, person.id)))
          .limit(1);
        if (scored.length)
          throw new AppError(
            409,
            'HAS_SCORES',
            `${person.name} has already scored. Use the conflict process to substitute them so the record stays intact.`,
          );""", """        // scores are sealed from everyone else, so "has scored" is the member's own completion mark
        if (m.scoredAt)
          throw new AppError(
            409,
            'HAS_SCORES',
            `${person.name} has already scored. Use the conflict process to substitute them so the record stays intact.`,
          );"""),
])
rw('apps/api/src/modules/collab/b6.test.ts', [
    ("""    const [crit] = await env.withSystem(env.database, (tx) => tx.select().from(s.criterion).where(eq(s.criterion.evaluationId, a.evaluationId)));
    await env.withSystem(env.database, (tx) => tx.insert(s.score).values({ tenantId: TENANT_ID, evaluationId: a.evaluationId, evaluatorId: uid('user:evaluator-tech'), supplierId: BRIGHT, criterionId: crit!.id, score: '7.00' }));""",
     """    await env.withSystem(env.database, (tx) => tx.update(s.panelMember).set({ scoredAt: new Date() }).where(and(eq(s.panelMember.evaluationId, a.evaluationId), eq(s.panelMember.userId, uid('user:evaluator-tech')))));"""),
])
print('ok')
