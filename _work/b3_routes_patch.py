import re

p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src\modules\evaluation\routes.ts'
s = open(p, encoding='utf8').read()


def rep(a, b, count=1):
    global s
    assert s.count(a) == count, (s.count(a), a[:80])
    s = s.replace(a, b)


# ---- imports
rep("""import { REPORT_SECTIONS, buildReport } from './report.js';
""", """import { REPORT_SECTIONS } from './report.js';
import { composeReport, storeReport } from './report-compose.js';
import {
  allocatedTenders,
  noticeToSupplier,
  routeApproval,
  runComplianceGate,
} from './b3-service.js';
""")
rep("import { and, count, desc, eq, inArray } from 'drizzle-orm';", "import { and, count, desc, eq, inArray } from 'drizzle-orm';")
rep("""  fieldValue,
  fileObject,
  panelMember,""", """  fileObject,
  panelMember,""")

# ---- body schemas
rep("""const openBody = z
  .object({
    panel: z
      .array(z.object({ userId: uuid, stream: z.enum(['TECHNICAL', 'COMMERCIAL']) }).strict())
      .min(1)
      .max(12),
  })
  .strict();""", """const openBody = z
  .object({
    panel: z
      .array(z.object({ userId: uuid, stream: z.enum(['TECHNICAL', 'COMMERCIAL']) }).strict())
      .min(1)
      .max(12),
    /** Ranking instead of numeric scoring, for low-value arrangements (FR-0280). */
    mode: z.enum(['SCORING', 'RANKING']).optional(),
    /** In ranking mode, the share of the final order that comes from normalised total cost of ownership. */
    priceWeightPct: z.number().int().min(0).max(80).optional(),
  })
  .strict();""")
rep("""const conflictDecisionBody = z
  .object({
    disposition: z.enum(['IMMATERIAL', 'MANAGEABLE', 'MATERIAL']),
    rationale: z.string().trim().max(2000).optional(),
  })
  .strict();""", """const conflictDecisionBody = z
  .object({
    disposition: z.enum(['IMMATERIAL', 'MANAGEABLE', 'MATERIAL']),
    rationale: z.string().trim().max(2000).optional(),
    /** For a minor (MANAGEABLE) conflict: the supplier this person may not assess (FR-0330). */
    excludeSupplierId: uuid.optional(),
  })
  .strict();""")

# ---- hold gate + scoping helper, right after eid()
rep("""  const eid = (req: FastifyRequest) => parse(z.object({ id: uuid }), req.params).id;
""", """  const eid = (req: FastifyRequest) => parse(z.object({ id: uuid }), req.params).id;

  /** A probity advisor's system hold freezes the workspace: every change is refused until it is released (FR-0310). */
  const heldGate = async (req: FastifyRequest) => {
    const raw = (req.params as { id?: string } | undefined)?.id;
    if (!raw || !uuid.safeParse(raw).success) return;
    const reason = await withSystem(d.database, async (tx) => {
      const evId = req.url.includes('/evaluation-reports/')
        ? (await tx.select({ e: evalReport.evaluationId }).from(evalReport).where(eq(evalReport.id, raw)))[0]?.e
        : raw;
      if (!evId) return null;
      const [ev] = await tx
        .select({ held: evaluation.held, reason: evaluation.holdReason })
        .from(evaluation)
        .where(eq(evaluation.id, evId));
      return ev?.held ? (ev.reason ?? '') : null;
    });
    if (reason !== null)
      throw new AppError(
        423,
        'EVALUATION_ON_HOLD',
        `This evaluation is on hold by the probity advisor${reason ? `: ${reason}` : ''}. Nothing can change until it is released.`,
      );
  };
  const mguard = (dd: GuardDeps, roles: Parameters<typeof guard>[1]) => [guard(dd, roles), heldGate];

  /** An external probity advisor sees only the procurements they are allocated to (FR-0310). */
  async function advisorScope(tx: Tx, a: AuthContext): Promise<Set<string> | null> {
    if (!a.user.roles.includes('PROBITY')) return null;
    const [u] = await tx.select({ e: appUser.external }).from(appUser).where(eq(appUser.id, a.user.id));
    return allocatedTenders(tx, a.user.tenantId, { id: a.user.id, external: Boolean(u?.e) });
  }
""")

rep("""    if (!l) throw new AppError(404, 'NOT_FOUND', 'Evaluation not found');
    const processRole = a.user.roles.some((r) => PROCESS.includes(r));
    const me = svc.memberOf(l, a.user.id);""", """    if (!l) throw new AppError(404, 'NOT_FOUND', 'Evaluation not found');
    const scope = await advisorScope(tx, a);
    if (scope && !scope.has(l.tender.id)) throw new AppError(404, 'NOT_FOUND', 'Evaluation not found');
    const processRole = a.user.roles.some((r) => PROCESS.includes(r));
    const me = svc.memberOf(l, a.user.id);""")

rep("""        const processRole = a.user.roles.some((r) => PROCESS.includes(r));
        const rows = await tx
          .select({ ev: evaluation, r: request })
          .from(evaluation)
          .innerJoin(tender, eq(tender.id, evaluation.tenderId))
          .innerJoin(request, eq(request.id, tender.requestId))
          .where(eq(evaluation.tenantId, a.user.tenantId))
          .orderBy(desc(evaluation.updatedAt));""", """        const processRole = a.user.roles.some((r) => PROCESS.includes(r));
        const scope = await advisorScope(tx, a);
        const rows = (
          await tx
            .select({ ev: evaluation, r: request })
            .from(evaluation)
            .innerJoin(tender, eq(tender.id, evaluation.tenderId))
            .innerJoin(request, eq(request.id, tender.requestId))
            .where(eq(evaluation.tenantId, a.user.tenantId))
            .orderBy(desc(evaluation.updatedAt))
        ).filter((x) => !scope || scope.has(x.ev.tenderId));""")
rep("""            status: ev.status,
            bids: bids?.n ?? 0,
            panelSize:""", """            status: ev.status,
            held: ev.held,
            mode: ev.mode,
            bids: bids?.n ?? 0,
            panelSize:""")

# ---- change guards on mutating routes to the held-aware version
SKIP = ('/probity-signoff', '/tenders/:id/evaluation')


def swap(m):
    path = m.group(2)
    if any(path.endswith(x) or x in path for x in SKIP):
        return m.group(0)
    return m.group(0).replace('guard(d,', 'mguard(d,')


s = re.sub(r"app\.(post|put)\(\s*`([^`]+)`,\s*\{ preHandler: guard\(d,", swap, s)

# ---- open: ranking mode, price weight, the compliance gate
rep("""      const [req0] = await tx.select().from(request).where(eq(request.id, t.requestId));
""", """      const [req0] = await tx.select().from(request).where(eq(request.id, t.requestId));
      const rules = (await loadSettings(tx, a.user.tenantId)).evaluationRules;
      const rankingMode = body.mode === 'RANKING';
      if (rankingMode && Number(req0!.estimatedValue ?? 0) > rules.rankingMaxValueAud)
        throw new AppError(
          409,
          'RANKING_NOT_ALLOWED',
          `Ranking is for arrangements up to ${aud.format(rules.rankingMaxValueAud)}; this one is estimated at ${aud.format(Number(req0!.estimatedValue ?? 0))}`,
        );
      const criteriaSet = rankingMode
        ? [{ name: 'Overall preference', weight: 100, stream: 'OTHER' as const, passFail: false }]
        : template;
""")
rep("""      for (const s of ['TECHNICAL', 'COMMERCIAL'] as const)
        if (template.some((c) => c.stream === s) && !body.panel.some((m) => m.stream === s))""", """      for (const s of ['TECHNICAL', 'COMMERCIAL'] as const)
        if (criteriaSet.some((c) => c.stream === s) && !body.panel.some((m) => m.stream === s))""")
rep("""          status: 'COI_PENDING',
          varianceLimitPct: 30,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      for (const c of template)""", """          status: 'COI_PENDING',
          varianceLimitPct: 30,
          mode: rankingMode ? 'RANKING' : 'SCORING',
          priceWeightPct: body.priceWeightPct ?? 30,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      for (const c of criteriaSet)""")
rep("""        after: { tenderId, bidders: bids.length, panel: members.length, criteria: template.length },
      });""", """        after: {
          tenderId,
          bidders: bids.length,
          panel: members.length,
          criteria: criteriaSet.length,
          mode: rankingMode ? 'RANKING' : 'SCORING',
        },
      });
      // the mandatory pass or fail gate runs on every bidder at once; each missed requirement gets a clarification request
      const opened = (await svc.load(tx, a.user.tenantId, ev!.id))!;
      const gate = await runComplianceGate(tx, opened, now, a.user.id);
      for (const r of gate.requests)
        await noticeToSupplier(tx, a.user.tenantId, r.supplierId, {
          title: r.subject,
          body: `${req0!.number} ${req0!.title}: ${r.question}`,
          link: `/supplier/tenders/${tenderId}`,
          kind: 'CLARIFICATION',
        });
      if (gate.failed)
        await d.audit.record(tx, a.ctx, {
          action: 'evaluation.compliance_gate',
          entityType: 'evaluation',
          entityId: ev!.id,
          after: { failed: gate.failed, requests: gate.requests.length },
        });""")

# ---- a member who declares no conflict can now see supplier names: ask them to confirm again (FR-0325)
rep("""        if (!body.none) {
          await svc.notifyRoles(
            tx,
            a.user.tenantId,
            ['PROBITY', 'CHAIR', 'PROCUREMENT'],
            'Evaluator suspended: conflict of interest',""", """        if (body.none)
          await svc.notifyUsers(
            tx,
            a.user.tenantId,
            [a.user.id],
            'Confirm your declaration now you can see the suppliers',
            `${l.req.number} ${l.req.title}: supplier names are now visible to you. Confirm that you still have no conflict of interest.`,
            `/app/evaluations/${id}`,
          );
        if (!body.none) {
          await svc.notifyRoles(
            tx,
            a.user.tenantId,
            ['PROBITY', 'CHAIR', 'PROCUREMENT'],
            'Evaluator suspended: conflict of interest',""")

# ---- exclusions on scoring
rep("""    const me = declaredMember(l, a);
    const criteria = svc.criteriaFor(l, me);
    const rows = await tx
      .select()
      .from(score)
      .where(and(eq(score.evaluationId, l.ev.id), eq(score.evaluatorId, a.user.id)));
    return {
      me,
      criteria,
      rows,
      suppliers: l.bidders.map((b) => ({""", """    const me = declaredMember(l, a);
    const criteria = svc.criteriaFor(l, me);
    const excluded = await svc.excludedFor(tx, l, a.user.id);
    const rows = await tx
      .select()
      .from(score)
      .where(and(eq(score.evaluationId, l.ev.id), eq(score.evaluatorId, a.user.id)));
    return {
      me,
      criteria,
      rows,
      suppliers: l.bidders
        .filter((b) => !excluded.has(b.supplierId))
        .map((b) => ({""")
rep("""      if (!l.bidders.some((b) => b.supplierId === body.supplierId))
        throw new AppError(404, 'NOT_FOUND', 'Supplier not found');
      const allowed = svc.criteriaFor(l, me);""", """      if (!l.bidders.some((b) => b.supplierId === body.supplierId))
        throw new AppError(404, 'NOT_FOUND', 'Supplier not found');
      if ((await svc.excludedFor(tx, l, a.user.id)).has(body.supplierId))
        throw new AppError(
          403,
          'COI_EXCLUDED_SUPPLIER',
          'You were excluded from assessing this supplier because of a conflict of interest',
        );
      const allowed = svc.criteriaFor(l, me);""")

# ---- departed evaluators' marks stay as history and are left out of the averages
rep("""      const rows = await tx.select().from(score).where(eq(score.evaluationId, id));
      let flagged = 0;""", """      const departed = new Set(l.panel.filter((m) => m.coiState === 'REMOVED').map((m) => m.userId));
      const rows = (await tx.select().from(score).where(eq(score.evaluationId, id))).filter(
        (r) => !departed.has(r.evaluatorId),
      );
      let flagged = 0;""")

# ---- lock compiles the sourcing recommendation report as a draft (FR-0350)
rep("""  reg('POST', '/evaluations/{id}/consensus/lock');
  app.post(`${p}/evaluations/:id/consensus/lock`, { preHandler: mguard(d, ['CHAIR']) }, async (req) => {
    const a = req.auth!;
    const id = eid(req);
    return withContext(d.database, a.ctx, async (tx) => {""", """  reg('POST', '/evaluations/{id}/consensus/lock');
  app.post(`${p}/evaluations/:id/consensus/lock`, { preHandler: mguard(d, ['CHAIR']) }, async (req) => {
    const a = req.auth!;
    const id = eid(req);
    const locked = await withContext(d.database, a.ctx, async (tx) => {""")
rep("""        `${l.req.number} ${l.req.title}: you can generate the evaluation report`,
        `/app/evaluations/${id}`,
      );
      return svc.view(tx, a, (await svc.load(tx, a.user.tenantId, id))!);
    });
  });
""", """        `${l.req.number} ${l.req.title}: you can generate the evaluation report`,
        `/app/evaluations/${id}`,
      );
      return svc.view(tx, a, (await svc.load(tx, a.user.tenantId, id))!);
    });
    // the report is compiled at once, as a draft that procurement reviews and puts forward for approval
    await withSystem(d.database, async (tx) => {
      const l = (await svc.load(tx, a.user.tenantId, id))!;
      const now = d.clock.now();
      const text = await composeReport(tx, svc, l, now);
      const rep = await storeReport(tx, a.user.tenantId, id, text, 'DRAFT', now);
      await d.audit.record(tx, a.ctx, {
        action: 'report.compile',
        entityType: 'evaluation',
        entityId: id,
        after: { reportId: rep.id, status: 'DRAFT' },
      });
    });
    return locked;
  });
""")

# ---- the report route: compile, route the approval to the right delegate
a0 = s.index("  reg('POST', '/evaluations/{id}/report');")
a1 = s.index("  reg('POST', '/evaluation-reports/{id}/decision');")
new_report = """  reg('POST', '/evaluations/{id}/report');
  app.post(`${p}/evaluations/:id/report`, { preHandler: mguard(d, ['PROCUREMENT']) }, async (req, reply) => {
    const a = req.auth!;
    const id = eid(req);
    // 1. check state (inside the caller's own permissions)
    const gathered = await withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a, id);
      const [existing] = await tx.select().from(evalReport).where(eq(evalReport.evaluationId, id));
      const regenerate = l.ev.status === 'REPORTED' && existing?.status === 'DRAFT';
      const items = await tx.select().from(consensusItem).where(eq(consensusItem.evaluationId, id));
      // an enterprise may relax "evaluation complete before the report" (FR-0720): consensus must still be fully scored
      const relaxable =
        !(await loadSettings(tx, a.user.tenantId)).checkpoints.evaluationBeforeReport &&
        l.ev.status === 'CONSENSUS' &&
        items.length > 0 &&
        items.every((i) => i.consensusScore !== null);
      if (l.ev.status !== 'LOCKED' && !regenerate && !relaxable)
        throw new AppError(409, 'INVALID_STATE', 'A report can be generated once consensus is locked');
      if (relaxable && l.ev.status !== 'LOCKED')
        await d.audit.record(tx, a.ctx, {
          action: 'checkpoint.relaxed',
          entityType: 'evaluation',
          entityId: id,
          after: {
            checkpoint: 'evaluationBeforeReport',
            note: 'Report generated before consensus was locked',
          },
        });
      return { l };
    });
    // 2. the evaluators' comments are readable only by the chair and probity (row level security), so the report reads
    //    them as the system, and quotes them without saying who wrote them
    const now = d.clock.now();
    const text = await withSystem(d.database, (tx) => composeReport(tx, svc, gathered.l, now));
    // 3. store it and route it to the delegate whose authority covers the value (FR-0375)
    const out = await withContext(d.database, a.ctx, async (tx) => {
      const l2 = (await svc.load(tx, a.user.tenantId, id))!;
      const value = Number(l2.req.estimatedValue ?? 0);
      const routing = await routeApproval(tx, a.user.tenantId, value);
      const rep = await storeReport(tx, a.user.tenantId, id, text, 'AWAITING_APPROVAL', now, {
        routedTo: routing.userIds[0] ?? null,
        requiredAuthority: value,
      });
      await tx
        .update(evaluation)
        .set({ status: 'REPORTED', updatedAt: now, version: l2.ev.version + 1 })
        .where(eq(evaluation.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'report.generate',
        entityType: 'evaluation',
        entityId: id,
        after: {
          reportId: rep.id,
          generatedAt: now.toISOString(),
          routedTo: routing.userIds,
          requiredAuthority: value,
        },
      });
      if (routing.userIds.length)
        await svc.notifyUsers(
          tx,
          a.user.tenantId,
          routing.userIds,
          'Evaluation report awaiting your approval',
          `${l2.req.number} ${l2.req.title}: ${aud.format(value)} is within your authority`,
          `/app/evaluations/${id}`,
        );
      else
        await svc.notifyRoles(
          tx,
          a.user.tenantId,
          ['EXEC', 'PROCUREMENT'],
          'Evaluation report needs an approver',
          `${l2.req.number} ${l2.req.title}: nobody holds sourcing authority for ${aud.format(value)}`,
          `/app/evaluations/${id}`,
        );
      return svc.view(tx, a, (await svc.load(tx, a.user.tenantId, id))!);
    });
    return reply.status(201).send(out);
  });

"""
s = s[:a0] + new_report + s[a1:]

# ---- a conflict declared for the report may stop the approver approving (FR-0370)
rep("""        const now = d.clock.now();
        const stamp = (verb: string) =>""", """        if (body.decision === 'APPROVE') {
          const [own] = await tx
            .select({ d: coiDeclaration.disposition })
            .from(coiDeclaration)
            .where(
              and(
                eq(coiDeclaration.scope, 'REPORT'),
                eq(coiDeclaration.scopeId, reportId),
                eq(coiDeclaration.userId, a.user.id),
                eq(coiDeclaration.none, false),
              ),
            )
            .orderBy(desc(coiDeclaration.createdAt));
          if (own && own.d !== 'IMMATERIAL' && own.d !== 'MANAGEABLE')
            throw new AppError(
              409,
              'COI_DECLARED',
              'You declared a conflict of interest on this report, which has not been cleared: someone else must approve it',
            );
        }
        const now = d.clock.now();
        const stamp = (verb: string) =>""")

# ---- conflict decision: probity may decide, newest declaration, minor conflicts exclude a supplier
rep("""    `${p}/evaluations/:id/conflicts/:userId/decision`,
    { preHandler: mguard(d, ['DELEGATE', 'EXEC']) },""", """    `${p}/evaluations/:id/conflicts/:userId/decision`,
    { preHandler: mguard(d, ['DELEGATE', 'EXEC', 'PROBITY']) },""")
rep("""              eq(coiDeclaration.userId, userId),
              eq(coiDeclaration.none, false),
            ),
          );
        if (!decl || decl.disposition !== 'PENDING')""", """              eq(coiDeclaration.userId, userId),
              eq(coiDeclaration.none, false),
            ),
          )
          .orderBy(desc(coiDeclaration.createdAt));
        if (!decl || decl.disposition !== 'PENDING')""")
rep("""        const now = d.clock.now();
        const stays = body.disposition !== 'MATERIAL';
        await tx
          .update(coiDeclaration)
          .set({ disposition: body.disposition, decidedAt: now })
          .where(eq(coiDeclaration.id, decl.id));""", """        const now = d.clock.now();
        const stays = body.disposition !== 'MATERIAL';
        // a minor conflict keeps the person on the panel but away from the supplier the conflict concerns
        let excludeId: string | null = null;
        if (body.disposition === 'MANAGEABLE') {
          excludeId =
            body.excludeSupplierId ??
            l.bidders.find((b) => decl.subjectOrg && b.company.toLowerCase().includes(decl.subjectOrg.toLowerCase()))
              ?.supplierId ??
            null;
          if (excludeId && !l.bidders.some((b) => b.supplierId === excludeId))
            throw new AppError(400, 'VALIDATION_FAILED', 'That supplier did not bid', [
              { field: 'excludeSupplierId', message: 'Choose one of the bidders' },
            ]);
        }
        await tx
          .update(coiDeclaration)
          .set({
            disposition: body.disposition,
            decidedAt: now,
            excludedSupplierId: excludeId,
            decidedBy: a.user.id,
            decidedByRole: a.user.role,
            decisionNote: body.rationale ?? null,
          })
          .where(eq(coiDeclaration.id, decl.id));""")
rep("""            outcome: stays ? 'REINSTATED' : 'REMOVED',
            rationale: body.rationale ?? null,""", """            outcome: stays ? 'REINSTATED' : 'REMOVED',
            excludedSupplierId: excludeId,
            decidedByRole: a.user.role,
            rationale: body.rationale ?? null,""")

open(p, 'w', encoding='utf8').write(s)
print('ok')
