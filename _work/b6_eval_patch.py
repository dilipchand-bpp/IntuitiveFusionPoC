def rw(p, pairs):
    s = open(p, encoding='utf8', newline='').read()
    for old, new in pairs:
        assert old in s, (p, old[:70])
        s = s.replace(old, new, 1)
    open(p, 'w', encoding='utf8', newline='').write(s)


b = 'apps/api/src/modules/evaluation/'
rw(b + 'service.ts', [
    ("""            sections: REPORT_SECTIONS.map((s) => ({
              key: s.key,
              label: s.label,
              paragraphs: (reportFields.find((f) => f.key === s.key)?.value ?? '')
                .split(/\\n{2,}/)
                .filter(Boolean),
            })),""", """            // the organisation's own layout orders the report and leaves out what it has switched off (FR-0365)
            sections: applyLayout(
              REPORT_SECTIONS.map((s) => ({
                key: s.key,
                label: s.label,
                paragraphs: (reportFields.find((f) => f.key === s.key)?.value ?? '')
                  .split(/\\n{2,}/)
                  .filter(Boolean),
              })),
              await loadLayout(tx, a.user.tenantId, 'REPORT'),
            ),"""),
    ("import { REPORT_SECTIONS } from './report.js';", "import { applyLayout, loadLayout } from '../collab/routes.js';\nimport { REPORT_SECTIONS } from './report.js';"),
])

s = open(b + 'routes.ts', encoding='utf8', newline='').read()
# the committee instruction, after the panel add route
anchor = "  reg('GET', '/evaluations/{id}');"
assert anchor in s
new = """  // ---------------------------------------------------------------- committee by instruction or name (FR-0775)
  reg('POST', '/evaluations/{id}/committee/instruct');
  app.post(`${p}/evaluations/:id/committee/instruct`, { preHandler: mguard(d, ['PROCUREMENT']) }, async (req) => {
    const a = req.auth!;
    const id = eid(req);
    const body = parse(committeeBody, req.body);
    const parsed = parseCommittee(body.instruction);
    if ('error' in parsed)
      throw new AppError(422, 'INSTRUCTION_NOT_UNDERSTOOD', parsed.error, [
        { field: 'instruction', message: parsed.error },
      ]);
    return withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a, id);
      if (l.ev.status !== 'COI_PENDING' && l.ev.status !== 'SCORING')
        throw new AppError(409, 'INVALID_STATE', 'The committee can only change before consensus');
      const stream = body.stream ?? 'TECHNICAL';
      let pool: Array<{ id: string; name: string; unit: string | null }>;
      if (parsed.action === 'ADD') {
        const want = stream === 'OTHER' ? 'CHAIR' : 'EVALUATOR';
        const rows = await tx
          .select({ id: appUser.id, name: appUser.name, roles: roleAssignment.role })
          .from(appUser)
          .innerJoin(roleAssignment, eq(roleAssignment.userId, appUser.id))
          .where(and(eq(appUser.tenantId, a.user.tenantId), eq(appUser.active, true), eq(roleAssignment.role, want)));
        pool = rows
          .filter((r) => !l.panel.some((m) => m.userId === r.id) && r.id !== l.req.requesterId)
          .map((r) => ({ id: r.id, name: r.name, unit: null }));
      } else
        pool = l.panel
          .filter((m) => m.coiState !== 'REMOVED')
          .map((m) => ({ id: m.userId, name: m.name, unit: null }));
      const hits = matchPeople(parsed.name, pool);
      const chosen = body.userId ? hits.filter((h) => h.id === body.userId) : hits;
      if (chosen.length === 0)
        throw new AppError(
          422,
          'NO_MATCH',
          parsed.action === 'ADD'
            ? `No available ${stream === 'OTHER' ? 'chair' : 'evaluator'} is called "${parsed.name}"`
            : `No one on the committee is called "${parsed.name}"`,
          [{ field: 'instruction', message: 'Check the spelling or pick from the list' }],
        );
      if (chosen.length > 1)
        return {
          status: 'AMBIGUOUS' as const,
          action: parsed.action,
          message: `More than one person matches "${parsed.name}". Choose one.`,
          candidates: chosen.map((c) => ({ id: c.id, name: c.name })),
        };
      const person = chosen[0]!;
      if (parsed.action === 'ADD') {
        await addPanelMember(tx, a, l, person.id, stream);
      } else {
        const m = l.panel.find((x) => x.userId === person.id)!;
        const scored = await tx
          .select({ id: score.id })
          .from(score)
          .where(and(eq(score.evaluationId, id), eq(score.evaluatorId, person.id)))
          .limit(1);
        if (scored.length)
          throw new AppError(
            409,
            'HAS_SCORES',
            `${person.name} has already scored. Use the conflict process to substitute them so the record stays intact.`,
          );
        await tx
          .update(panelMember)
          .set({ coiState: 'REMOVED' })
          .where(and(eq(panelMember.evaluationId, id), eq(panelMember.userId, person.id)));
        await d.audit.record(tx, a.ctx, {
          action: 'evaluation.panel_remove',
          entityType: 'evaluation',
          entityId: id,
          after: { userId: person.id, stream: m.stream, instruction: body.instruction },
        });
      }
      return {
        status: 'DONE' as const,
        action: parsed.action,
        person: { id: person.id, name: person.name },
        message: `${person.name} was ${parsed.action === 'ADD' ? 'added to' : 'removed from'} the committee.`,
      };
    });
  });

"""
s = s.replace(anchor, new + anchor, 1)

open(b + 'routes.ts', 'w', encoding='utf8', newline='').write(s)
print('part1 ok')
