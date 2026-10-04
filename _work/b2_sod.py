p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src\modules\evaluation\routes.ts'
s = open(p, encoding='utf8').read()


def sub(a, b):
    global s
    assert a in s, a[:80]
    s = s.replace(a, b, 1)


# at opening: nobody who administers tenders or acts as probity officer or administrator may be put on the panel (FR-0190)
sub("""      if (ids.includes(req0!.requesterId))
        throw new AppError(
          400,
          'PANEL_INVALID',
          'The person who raised the request cannot evaluate the responses',
        );
      for (const s of ['TECHNICAL', 'COMMERCIAL'] as const)""",
    """      if (ids.includes(req0!.requesterId))
        throw new AppError(
          400,
          'PANEL_INVALID',
          'The person who raised the request cannot evaluate the responses',
        );
      await assertSegregated(tx, a.user.tenantId, [...ids, ...(chairCandidate ? [chairCandidate] : [])]);
      for (const s of ['TECHNICAL', 'COMMERCIAL'] as const)""")
sub("""      const chairId = roleRows.find((r) => r.role === 'CHAIR')?.userId;
      if (!chairId) throw new AppError(409, 'NO_CHAIR', 'There is no panel chair in the system');""",
    """      const chairId = roleRows.find((r) => r.role === 'CHAIR')?.userId;
      if (!chairId) throw new AppError(409, 'NO_CHAIR', 'There is no panel chair in the system');
      void chairId;""")
sub("      const isEvaluator = new Set(roleRows.filter((r) => r.role === 'EVALUATOR').map((r) => r.userId));",
    "      const isEvaluator = new Set(roleRows.filter((r) => r.role === 'EVALUATOR').map((r) => r.userId));\n      const chairCandidate = roleRows.find((r) => r.role === 'CHAIR')?.userId;")
# when adding a person later
sub("""      await tx.insert(panelMember).values({
        tenantId: a.user.tenantId,
        evaluationId: id,
        userId: body.userId,
        stream: body.stream,
        coiState: 'NOT_DECLARED',
      });""",
    """      await assertSegregated(tx, a.user.tenantId, [body.userId]);
      await tx.insert(panelMember).values({
        tenantId: a.user.tenantId,
        evaluationId: id,
        userId: body.userId,
        stream: body.stream,
        coiState: 'NOT_DECLARED',
      });""")
# helper
sub("export function registerEvaluationRoutes(",
    """/**
 * Tender administrators (procurement), probity officers and administrators cannot also hold evaluator access on the same
 * project (FR-0190): the person who runs or oversees the process does not score it.
 */
async function assertSegregated(tx: Tx, tenantId: string, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const rows = await tx
    .select({ userId: roleAssignment.userId, role: roleAssignment.role })
    .from(roleAssignment)
    .where(and(eq(roleAssignment.tenantId, tenantId), inArray(roleAssignment.userId, userIds)));
  const bad = rows.find((r) => ['PROCUREMENT', 'PROBITY', 'ADMIN'].includes(r.role));
  if (bad) {
    const res = checkSod('JOIN_EVALUATION_PANEL', {
      roles: rows.filter((r) => r.userId === bad.userId).map((r) => r.role as RoleName),
      isTenderAdministrator: bad.role === 'PROCUREMENT' || bad.role === 'PROBITY',
    });
    if (!res.ok) throw new AppError(403, res.code, res.message, [{ field: 'userId', message: `Rule ${res.rule}` }]);
  }
}

export function registerEvaluationRoutes(""")
open(p, 'w', encoding='utf8').write(s)
print('ok')
