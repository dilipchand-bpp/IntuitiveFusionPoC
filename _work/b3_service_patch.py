p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src\modules\evaluation\service.ts'
s = open(p, encoding='utf8').read()


def rep(a, b, count=1):
    global s
    assert s.count(a) == count, (s.count(a), a)
    s = s.replace(a, b)


rep("""import { REPORT_SECTIONS } from './report.js';""", """import { REPORT_SECTIONS } from './report.js';
import { blend, valueForMoney } from './commercial.js';
import { gateRows, loadExtras, previousStages, type RankExtras } from './b3-service.js';""")

# the suppliers a person is kept away from after a minor conflict
rep("""  active(l: Loaded): MemberRow[] {
    return l.panel.filter((m) => !isSuspended(m));
  }
""", """  active(l: Loaded): MemberRow[] {
    return l.panel.filter((m) => !isSuspended(m));
  }
  /** Suppliers this person may not assess because a delegate ruled their conflict minor and excluded them (FR-0330). */
  async excludedFor(tx: Tx, l: Loaded, userId: string): Promise<Set<string>> {
    const rows = await tx
      .select({ s: coiDeclaration.excludedSupplierId })
      .from(coiDeclaration)
      .where(
        and(
          eq(coiDeclaration.scope, 'EVALUATION'),
          eq(coiDeclaration.scopeId, l.ev.id),
          eq(coiDeclaration.userId, userId),
          eq(coiDeclaration.disposition, 'MANAGEABLE'),
        ),
      );
    return new Set(rows.flatMap((r) => (r.s ? [r.s] : [])));
  }
""")

rep("""    const namesVisible = processRole || declared;
    const myCriteria = this.criteriaFor(l, processRole ? undefined : me);
""", """    const namesVisible = processRole || declared;
    const myCriteria = this.criteriaFor(l, processRole ? undefined : me);
    const excluded = processRole || !me ? new Set<string>() : await this.excludedFor(tx, l, a.user.id);
""")

rep("""    const suppliers = l.bidders.map((b) => ({
      supplierId: b.supplierId,""", """    const suppliers = l.bidders
      .filter((b) => !excluded.has(b.supplierId))
      .map((b) => ({
      supplierId: b.supplierId,""")
rep("""        .map((f) => ({
          id: f.id,
          name: f.name,
          section: f.section,
          sizeBytes: f.sizeBytes,
          contentType: f.contentType,
        })),
    }));
""", """        .map((f) => ({
          id: f.id,
          name: f.name,
          section: f.section,
          sizeBytes: f.sizeBytes,
          contentType: f.contentType,
        })),
    }));
""")

rep("""                    evaluator: names.get(r.evaluatorId) ?? '',
                    score: Number(r.score),
                    comment: r.comment ?? null,
                  })),""", """                    evaluator: names.get(r.evaluatorId) ?? '',
                    score: Number(r.score),
                    comment: r.comment ?? null,
                    // a departed evaluator's marks stay as read-only history and are left out of the averages (FR-0305)
                    ...(l.panel.find((m) => m.userId === r.evaluatorId)?.coiState === 'REMOVED'
                      ? { departed: true }
                      : {}),
                  })),""")

rep("""    const ranking = processRole || chair ? await this.ranking(l, items) : [];""", """    const extras = processRole || chair ? await loadExtras(tx, l) : undefined;
    const ranking = extras ? await this.ranking(l, items, extras) : [];
    const gate = extras ? await gateRows(tx, l.ev.id) : [];
    const stages = extras ? await previousStages(tx, l, this) : [];
    const heldBy = l.ev.heldBy
      ? (await tx.select({ name: appUser.name }).from(appUser).where(eq(appUser.id, l.ev.heldBy)))[0]?.name
      : undefined;""")

rep("""      status,
      varianceLimitPct: l.ev.varianceLimitPct,
      version: l.ev.version,""", """      status,
      mode: l.ev.mode,
      priceWeightPct: l.ev.priceWeightPct,
      stage: l.tender.stage,
      previousStages: stages,
      held: l.ev.held
        ? { reason: l.ev.holdReason ?? '', by: heldBy ?? '', at: l.ev.heldAt?.toISOString() ?? '' }
        : null,
      compliance: gate,
      varianceLimitPct: l.ev.varianceLimitPct,
      version: l.ev.version,""")

rep("""        stream: m.stream,
        coiState: m.coiState,
        scoringComplete: Boolean(m.scoredAt),
      })),""", """        stream: m.stream,
        coiState: m.coiState,
        scoringComplete: Boolean(m.scoredAt),
        redeclaration: m.redeclaration ?? null,
        ...(m.redeclaredAt ? { redeclaredAt: m.redeclaredAt.toISOString() } : {}),
      })),""")

rep("""        ? { stream: me.stream, coiState: me.coiState, scoringComplete: Boolean(me.scoredAt), required, done }
        : null,""", """        ? {
            stream: me.stream,
            coiState: me.coiState,
            scoringComplete: Boolean(me.scoredAt),
            required,
            done,
            needsRedeclaration: me.coiState === 'DECLARED_NONE' && !me.redeclaredAt,
          }
        : null,""")

rep("""      permissions: {
        ...this.permissions(l, a, me, chair, proc, items, rep),""", """      permissions: {
        ...this.permissions(l, a, me, chair, proc, items, rep),
        canRedeclare: Boolean(
          me && me.coiState === 'DECLARED_NONE' && !me.redeclaredAt && !atLeast(status, 'LOCKED') && !l.ev.held,
        ),
        canHold: probity && !l.ev.held && status !== 'APPROVED',
        canRelease: probity && l.ev.held,
        canRunGate: proc && (status === 'COI_PENDING' || status === 'SCORING') && !l.ev.held,
        canEditCriteria: proc && status === 'COI_PENDING' && !l.ev.held,
        canSubstitute: proc && (status === 'COI_PENDING' || status === 'SCORING') && !l.ev.held,""")

rep("""  async ranking(l: Loaded, items: Array<typeof consensusItem.$inferSelect>) {
    if (!atLeast(l.ev.status, 'LOCKED')) return [];
    const defs = l.criteria.map((c) => ({ id: c.id, weight: Number(c.weight), passFail: c.passFail }));
    const entries = l.bidders.map((b) => {
      const m = new Map(
        items
          .filter((i) => i.supplierId === b.supplierId && i.consensusScore !== null)
          .map((i) => [i.criterionId, Number(i.consensusScore)] as const),
      );
      return { supplierId: b.supplierId, score: weightedScore(defs, m), compliant: complies(defs, m) };
    });
    const ranked = rank(entries);
    return ranked
      .map((r) => ({
        supplierId: r.supplierId,
        displayName: l.bidders.find((b) => b.supplierId === r.supplierId)!.company,
        weightedScore: r.score,
        rank: r.rank,
        compliance: r.compliant ? 'PASS' : 'FAIL',
      }))""", """  async ranking(
    l: Loaded,
    items: Array<typeof consensusItem.$inferSelect>,
    extras?: RankExtras,
  ) {
    if (!atLeast(l.ev.status, 'LOCKED')) return [];
    const defs = l.criteria.map((c) => ({ id: c.id, weight: Number(c.weight), passFail: c.passFail }));
    const entries = l.bidders.map((b) => {
      const m = new Map(
        items
          .filter((i) => i.supplierId === b.supplierId && i.consensusScore !== null)
          .map((i) => [i.criterionId, Number(i.consensusScore)] as const),
      );
      const quality = weightedScore(defs, m);
      const priceScore = extras?.priceScore.get(b.supplierId) ?? null;
      // in ranking mode the final order blends the panel's view with normalised total cost of ownership (FR-0280)
      const final = l.ev.mode === 'RANKING' ? blend(quality, priceScore, l.ev.priceWeightPct) : quality;
      return {
        supplierId: b.supplierId,
        score: final,
        quality,
        compliant: complies(defs, m) && !extras?.gateFailed.has(b.supplierId),
      };
    });
    const ranked = rank(entries);
    return ranked
      .map((r) => ({
        supplierId: r.supplierId,
        displayName: l.bidders.find((b) => b.supplierId === r.supplierId)!.company,
        weightedScore: r.score,
        qualityScore: entries.find((e) => e.supplierId === r.supplierId)!.quality,
        rank: r.rank,
        compliance: r.compliant ? 'PASS' : 'FAIL',
        tco: extras?.tco.get(r.supplierId) ?? null,
        priceScore: extras?.priceScore.get(r.supplierId) ?? null,
        valueForMoney: valueForMoney(
          entries.find((e) => e.supplierId === r.supplierId)!.quality,
          extras?.priceScore.get(r.supplierId) ?? null,
        ),
      }))""")

open(p, 'w', encoding='utf8').write(s)
print('ok')
