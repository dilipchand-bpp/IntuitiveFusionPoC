import re


def edit(p, pairs):
    t = open(p, encoding='utf8', newline='').read()
    for a, b in pairs:
        assert a in t, (p, a[:90])
        t = t.replace(a, b, 1)
    open(p, 'w', encoding='utf8', newline='').write(t)


R = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src\modules\evaluation'

# ------------------------------------------------------------------ report text knows about reviewed conflicts
edit(R + r'\report.ts', [
    ("panel: Array<{ name: string; stream: string; outcome: 'NO_CONFLICT' | 'CONFLICT_REMOVED' }>;",
     "panel: Array<{ name: string; stream: string; outcome: 'NO_CONFLICT' | 'CONFLICT_REMOVED' | 'CONFLICT_REVIEWED' }>;"),
    ("  const removed = i.panel.filter((p) => p.outcome === 'CONFLICT_REMOVED');\n  const active = i.panel.filter((p) => p.outcome === 'NO_CONFLICT');",
     "  const removed = i.panel.filter((p) => p.outcome === 'CONFLICT_REMOVED');\n  const reviewed = i.panel.filter((p) => p.outcome === 'CONFLICT_REVIEWED');\n  const active = i.panel.filter((p) => p.outcome !== 'CONFLICT_REMOVED');"),
    ("${removed.length ? ` ${removed.length} member(s) declared a conflict and were removed from the evaluation immediately.` : ''}`,",
     "${removed.length ? ` ${removed.length} member(s) declared a conflict that a delegate found material, and were removed from the evaluation.` : ''}${reviewed.length ? ` ${reviewed.length} member(s) declared a conflict that a delegate reviewed and allowed to continue.` : ''}`,"),
])

# ------------------------------------------------------------------ service
edit(R + r'\service.ts', [
    ("export const atLeast =", "/** A panel seat with no access: removed for a material conflict, or suspended while a delegate decides one. */\nexport const isSuspended = (m: { coiState: string }) => m.coiState === 'REMOVED' || m.coiState === 'DECLARED_CONFLICT';\n\nexport const atLeast ="),
    ("    return l.panel.filter((m) => m.coiState !== 'REMOVED');", "    return l.panel.filter((m) => !isSuspended(m));"),
    ("    const pending = live.filter((m) => m.coiState === 'NOT_DECLARED').length;\n    if (pending) blockers.push(`${pending} panel member(s) have not declared yet`);",
     "    const pending = live.filter((m) => m.coiState === 'NOT_DECLARED').length;\n    if (pending) blockers.push(`${pending} panel member(s) have not declared yet`);\n    const awaiting = l.panel.filter((m) => m.coiState === 'DECLARED_CONFLICT').length;\n    if (awaiting) blockers.push(`${awaiting} declared conflict(s) await a delegate decision`);"),
    ("  coiDeclaration,\n", "  coiDeclaration,\n") if False else ("import { AppError } from '../../http/errors.js';", "import { AppError } from '../../http/errors.js';"),
])
t = open(R + r'\service.ts', encoding='utf8', newline='').read()
t = t.replace("  approval,\n  consensusItem,", "  approval,\n  coiDeclaration,\n  consensusItem,", 1)
# conflicts list in the view
t = t.replace("    const roster = processRole || chair ? l.panel : l.panel.filter((m) => m.userId === a.user.id);",
              """    const roster = processRole || chair ? l.panel : l.panel.filter((m) => m.userId === a.user.id);
    // Declared conflicts are shown to those who must act on them (and to chair/probity oversight), never to other evaluators.
    const declarations =
      processRole || chair
        ? await tx
            .select()
            .from(coiDeclaration)
            .where(and(eq(coiDeclaration.scope, 'EVALUATION'), eq(coiDeclaration.scopeId, l.ev.id), eq(coiDeclaration.none, false)))
        : [];""", 1)
t = t.replace("      suppliers,\n      me: me", """      suppliers,
      conflicts: declarations.map((c) => ({
        userId: c.userId,
        name: names.get(c.userId) ?? '',
        nature: c.nature ?? '',
        subjectOrg: c.subjectOrg ?? null,
        disposition: c.disposition,
        declaredAt: c.createdAt.toISOString(),
        ...(c.decidedAt ? { decidedAt: c.decidedAt.toISOString() } : {}),
      })),
      me: me""", 1)
# permissions
t = t.replace("      canOpenConsensus:\n        chair &&", "      canOpenConsensus:\n        chair &&", 1)
open(R + r'\service.ts', 'w', encoding='utf8', newline='').write(t)

t = open(R + r'\service.ts', encoding='utf8', newline='').read()
m = re.search(r"canOpenConsensus:[^\n]*\n(?:[^\n]*\n){0,6}?\s*canSetConsensus:", t)
assert m, 'canOpenConsensus block'
block = t[m.start():m.end()]
new_block = block.replace("canOpenConsensus:", "canOpenConsensus: !l.panel.some((m) => m.coiState === 'DECLARED_CONFLICT') &&\n        ", 1)
t = t.replace(block, new_block, 1)
t = t.replace("      canSetConsensus: chair && s === 'CONSENSUS',",
              "      canSetConsensus: chair && s === 'CONSENSUS',\n      canReopen: chair && (s === 'LOCKED' || (s === 'REPORTED' && rep !== undefined && rep.status !== 'APPROVED')),\n      canDecideConflict:\n        (a.user.roles.includes('DELEGATE') || a.user.roles.includes('EXEC')) && l.panel.some((m) => m.coiState === 'DECLARED_CONFLICT'),", 1)
open(R + r'\service.ts', 'w', encoding='utf8', newline='').write(t)

# ------------------------------------------------------------------ routes
RT = R + r'\routes.ts'
t = open(RT, encoding='utf8', newline='').read()

def rep(a, b, count=1):
    global t
    assert a in t, a[:90]
    t = t.replace(a, b, count)

rep("import { atLeast, EvaluationService, type Loaded } from './service.js';", "import { atLeast, EvaluationService, isSuspended, type Loaded } from './service.js';\nimport { evaluationReportPdf } from './report-pdf.js';")
rep("if (!processRole && (!me || me.coiState === 'REMOVED'))\n      throw new AppError(404, 'NOT_FOUND', 'Evaluation not found');\n    return l;", "if (!processRole && (!me || isSuspended(me)))\n      throw new AppError(404, 'NOT_FOUND', 'Evaluation not found');\n    return l;")
rep("if (!me || me.coiState === 'REMOVED') throw new AppError(404, 'NOT_FOUND', 'Evaluation not found');\n    if (me.coiState !== 'DECLARED_NONE')", "if (!me || isSuspended(me)) throw new AppError(404, 'NOT_FOUND', 'Evaluation not found');\n    if (me.coiState !== 'DECLARED_NONE')")
rep("if (!processRole && (!mine || mine.coiState === 'REMOVED')) continue;", "if (!processRole && (!mine || isSuspended(mine))) continue;")
rep("panelSize: panel.filter((m) => m.coiState !== 'REMOVED').length,", "panelSize: panel.filter((m) => !isSuspended(m)).length,")

# declaring a conflict now suspends access and sends the decision to a delegate
rep("const next = body.none ? 'DECLARED_NONE' : 'REMOVED'; // a conflict removes access immediately", "const next = body.none ? 'DECLARED_NONE' : 'DECLARED_CONFLICT'; // a conflict suspends access immediately, pending a delegate's decision")
rep("""        await tx.insert(coiDeclaration).values({
          tenantId: a.user.tenantId,
          userId: a.user.id,
          scope: 'EVALUATION',
          scopeId: id,
          none: body.none,
          nature: body.nature ?? null,
          subjectOrg: body.subjectOrg ?? null,
          disposition: body.none ? 'IMMATERIAL' : 'MATERIAL',
          decidedAt: now,
          createdAt: now,
        });""", """        // A real conflict goes to a delegate (or the executive when there is none) for a decision.
        const approvers = body.none
          ? []
          : await tx
              .select({ userId: roleAssignment.userId, role: roleAssignment.role })
              .from(roleAssignment)
              .where(and(eq(roleAssignment.tenantId, a.user.tenantId), inArray(roleAssignment.role, ['DELEGATE', 'EXEC'])));
        const routedTo = approvers.find((x) => x.role === 'DELEGATE')?.userId ?? approvers.find((x) => x.role === 'EXEC')?.userId ?? null;
        await tx.insert(coiDeclaration).values({
          tenantId: a.user.tenantId,
          userId: a.user.id,
          scope: 'EVALUATION',
          scopeId: id,
          none: body.none,
          nature: body.nature ?? null,
          subjectOrg: body.subjectOrg ?? null,
          disposition: body.none ? 'IMMATERIAL' : 'PENDING',
          routedTo: body.none ? null : routedTo,
          decidedAt: body.none ? now : null,
          createdAt: now,
        });""")
rep("""            'Evaluator removed: conflict of interest',
            `${l.req.number}: ${a.user.name} declared a conflict and no longer has access`,
            `/app/evaluations/${id}`,
          );""", """            'Evaluator suspended: conflict of interest',
            `${l.req.number}: ${a.user.name} declared a conflict and has no access until a delegate decides`,
            `/app/evaluations/${id}`,
          );
          if (routedTo)
            await svc.notifyUsers(
              tx,
              a.user.tenantId,
              [routedTo],
              'Conflict of interest needs your decision',
              `${l.req.number}: ${a.user.name} declared a conflict on an evaluation`,
              `/app/evaluations/${id}`,
            );""")
rep("""            removed: true,
            message: 'Your conflict was recorded. You no longer have access to this evaluation.',""", """            suspended: true,
            message: 'Your conflict was recorded and your access is suspended. A delegate will decide, and you will be told the outcome.',""")

# consensus cannot open while a conflict decision is pending
rep("      if (l.ev.status !== 'SCORING') throw new AppError(409, 'INVALID_STATE', 'Consensus opens from scoring');",
    "      if (l.ev.status !== 'SCORING') throw new AppError(409, 'INVALID_STATE', 'Consensus opens from scoring');\n      if (l.panel.some((m) => m.coiState === 'DECLARED_CONFLICT'))\n        throw new AppError(409, 'CONFLICT_PENDING', 'A declared conflict is still waiting for a delegate decision');")

# report: members who declared a conflict and were allowed to stay
rep("      return { l, items, existing };", "      const decl = await tx\n        .select()\n        .from(coiDeclaration)\n        .where(and(eq(coiDeclaration.scope, 'EVALUATION'), eq(coiDeclaration.scopeId, id), eq(coiDeclaration.none, false)));\n      return { l, items, existing, conflictUsers: new Set(decl.map((x) => x.userId)) };")
rep("    const { l, items } = gathered;", "    const { l, items, conflictUsers } = gathered;")
t = re.sub(r"outcome:\s*m\.coiState === 'REMOVED' \? 'CONFLICT_REMOVED' : 'NO_CONFLICT',",
           "outcome:\n          m.coiState === 'REMOVED'\n            ? ('CONFLICT_REMOVED' as const)\n            : conflictUsers.has(m.userId)\n              ? ('CONFLICT_REVIEWED' as const)\n              : ('NO_CONFLICT' as const),", t, count=1)

# missing stored file: a clean 404 instead of a server error
rep("      const bytes = await d.store.get(found.storageKey);", "      const bytes = await d.store.get(found.storageKey).catch(() => null);\n      if (!bytes) throw new AppError(404, 'FILE_UNAVAILABLE', 'This file is not available');")

# new routes
new_routes = '''
  // ---------------------------------------------------------------- delegate decision on a declared conflict
  reg('POST', '/evaluations/{id}/conflicts/{userId}/decision');
  app.post(
    `${p}/evaluations/:id/conflicts/:userId/decision`,
    { preHandler: guard(d, ['DELEGATE', 'EXEC']) },
    async (req) => {
      const a = req.auth!;
      const { id, userId } = parse(z.object({ id: uuid, userId: uuid }), req.params);
      const body = parse(conflictDecisionBody, req.body);
      return withContext(d.database, a.ctx, async (tx) => {
        const l = await visible(tx, a, id);
        const member = l.panel.find((m) => m.userId === userId);
        if (!member || member.coiState !== 'DECLARED_CONFLICT')
          throw new AppError(409, 'INVALID_STATE', 'There is no conflict waiting for a decision for this person');
        if (userId === a.user.id) throw new AppError(403, 'ROLE_SOD_VIOLATION', 'You cannot decide your own conflict of interest');
        const [decl] = await tx
          .select()
          .from(coiDeclaration)
          .where(and(eq(coiDeclaration.scope, 'EVALUATION'), eq(coiDeclaration.scopeId, id), eq(coiDeclaration.userId, userId), eq(coiDeclaration.none, false)));
        if (!decl || decl.disposition !== 'PENDING') throw new AppError(409, 'INVALID_STATE', 'This declaration has already been decided');
        const now = d.clock.now();
        const stays = body.disposition !== 'MATERIAL';
        await tx.update(coiDeclaration).set({ disposition: body.disposition, decidedAt: now }).where(eq(coiDeclaration.id, decl.id));
        await tx
          .update(panelMember)
          .set({ coiState: stays ? 'DECLARED_NONE' : 'REMOVED' })
          .where(and(eq(panelMember.evaluationId, id), eq(panelMember.userId, userId)));
        await d.audit.record(tx, a.ctx, {
          action: 'coi.decide',
          entityType: 'evaluation',
          entityId: id,
          before: { userId, state: 'DECLARED_CONFLICT' },
          after: { userId, disposition: body.disposition, outcome: stays ? 'REINSTATED' : 'REMOVED', rationale: body.rationale ?? null },
        });
        await svc.notifyUsers(
          tx,
          a.user.tenantId,
          [userId],
          stays ? 'Your conflict was reviewed: you can continue' : 'Your conflict was reviewed: you are removed from the panel',
          `${l.req.number} ${l.req.title}${body.rationale ? `: ${body.rationale}` : ''}`,
          `/app/evaluations/${id}`,
        );
        await svc.notifyRoles(
          tx,
          a.user.tenantId,
          ['PROCUREMENT', 'CHAIR', 'PROBITY'],
          stays ? 'Conflict reviewed: evaluator reinstated' : 'Conflict reviewed: evaluator removed',
          `${l.req.number}: ${member.name}`,
          `/app/evaluations/${id}`,
        );
        const after = (await svc.load(tx, a.user.tenantId, id))!;
        const blockers = await svc.advance(tx, a, after);
        if (!stays && blockers.some((b) => b.startsWith('No active')))
          await svc.notifyRoles(tx, a.user.tenantId, ['PROCUREMENT'], 'Add a replacement evaluator', blockers.join('. '), `/app/evaluations/${id}`);
        return svc.view(tx, a, (await svc.load(tx, a.user.tenantId, id))!);
      });
    },
  );

  // ---------------------------------------------------------------- reopen consensus after the lock
  reg('POST', '/evaluations/{id}/consensus/reopen');
  app.post(`${p}/evaluations/:id/consensus/reopen`, { preHandler: guard(d, ['CHAIR']) }, async (req) => {
    const a = req.auth!;
    const id = eid(req);
    const body = parse(reopenBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a, id);
      chairOnly(l, a);
      const [rep] = await tx.select().from(evalReport).where(eq(evalReport.evaluationId, id));
      if (l.ev.status !== 'LOCKED' && !(l.ev.status === 'REPORTED' && rep && rep.status !== 'APPROVED'))
        throw new AppError(
          409,
          'INVALID_STATE',
          l.ev.status === 'APPROVED'
            ? 'An approved evaluation cannot be reopened: the approver must return the report first'
            : 'Consensus can be reopened once it has been locked',
        );
      const now = d.clock.now();
      const before = l.ev.status;
      await tx.update(evaluation).set({ status: 'CONSENSUS', updatedAt: now, version: l.ev.version + 1 }).where(eq(evaluation.id, id));
      // The report was written from the old scores, so it no longer stands and has to be generated again after re-locking.
      if (rep) await tx.update(evalReport).set({ status: 'DRAFT' }).where(eq(evalReport.id, rep.id));
      await d.audit.record(tx, a.ctx, {
        action: 'evaluation.consensus_reopen',
        entityType: 'evaluation',
        entityId: id,
        before: { status: before, reportStatus: rep?.status ?? null },
        after: { status: 'CONSENSUS', reason: body.reason, reportInvalidated: Boolean(rep) },
      });
      await svc.notifyRoles(
        tx,
        a.user.tenantId,
        ['PROCUREMENT', 'DELEGATE', 'EXEC', 'PROBITY'],
        'Consensus reopened by the chair',
        `${l.req.number} ${l.req.title}: ${body.reason}`,
        `/app/evaluations/${id}`,
      );
      return svc.view(tx, a, (await svc.load(tx, a.user.tenantId, id))!);
    });
  });

  // ---------------------------------------------------------------- report as a PDF (US-TND-05)
  reg('GET', '/evaluations/{id}/report/pdf');
  app.get(
    `${p}/evaluations/:id/report/pdf`,
    { preHandler: guard(d, ['PROCUREMENT', 'DELEGATE', 'EXEC', 'PROBITY', 'LEGAL', 'CHAIR']) },
    async (req, reply) => {
      const a = req.auth!;
      const id = eid(req);
      const out = await withContext(d.database, a.ctx, async (tx) => {
        const l = await visible(tx, a, id);
        const v = await svc.view(tx, a, l);
        if (!v.report) throw new AppError(404, 'NO_REPORT', 'There is no report to export yet');
        await d.audit.record(tx, a.ctx, {
          action: 'report.export',
          entityType: 'evaluation',
          entityId: id,
          after: { format: 'PDF', reportStatus: v.report.status, version: l.ev.version },
        });
        return { v, number: l.req.number, version: l.ev.version, type: l.tender.type };
      });
      const pdf = evaluationReportPdf({
        requestNumber: out.number,
        title: out.v.title,
        tenderType: out.type,
        evaluationVersion: out.version,
        reportStatus: out.v.report!.status,
        generatedAt: new Date(out.v.report!.generatedAt),
        sections: out.v.report!.sections,
        ranking: out.v.ranking,
        decision: out.v.report!.decision ? { stamp: out.v.report!.decision.stamp } : undefined,
      });
      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', `attachment; filename="evaluation-report-${out.number}-v${out.version}.pdf"`)
        .send(pdf);
    },
  );
'''
rep("  void atLeast;\n  return done;", new_routes + "\n  void atLeast;\n  return done;")
rep("const decisionBody = z", "const reopenBody = z.object({ reason: z.string().trim().min(10).max(1000) }).strict();\nconst conflictDecisionBody = z\n  .object({\n    disposition: z.enum(['IMMATERIAL', 'MANAGEABLE', 'MATERIAL']),\n    rationale: z.string().trim().max(2000).optional(),\n  })\n  .strict();\nconst decisionBody = z")
open(RT, 'w', encoding='utf8', newline='').write(t)
print('ok')
