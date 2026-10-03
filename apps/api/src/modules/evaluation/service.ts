import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Clock, RoleName } from '@if/shared';
import type { AuditService } from '../../audit/audit-service.js';
import type { AuthContext } from '../../auth/guard.js';
import type { Tx } from '../../db/client.js';
import {
  appUser,
  approval,
  coiDeclaration,
  consensusItem,
  criterion,
  evalReport,
  evaluation,
  fieldValue,
  fileObject,
  notification,
  panelMember,
  request,
  roleAssignment,
  score,
  submission,
  supplier,
  tender,
} from '../../db/schema.js';
import { AppError } from '../../http/errors.js';
import { REPORT_SECTIONS } from './report.js';
import {
  anonymousName,
  canScoreCriterion,
  canSeeFileSection,
  complies,
  rank,
  weightedScore,
  type Stream,
} from './scoring.js';

type EvalRow = typeof evaluation.$inferSelect;
type CriterionRow = typeof criterion.$inferSelect;
type MemberRow = typeof panelMember.$inferSelect & { name: string };

export interface Loaded {
  ev: EvalRow;
  tender: typeof tender.$inferSelect;
  req: typeof request.$inferSelect;
  criteria: CriterionRow[];
  panel: MemberRow[];
  /** Suppliers that submitted a bid, in a fixed order that also fixes their anonymous labels. */
  bidders: Array<{ supplierId: string; submissionId: string; company: string; label: string }>;
}

const STATUS_ORDER = ['COI_PENDING', 'SCORING', 'CONSENSUS', 'LOCKED', 'REPORTED', 'APPROVED'] as const;
/** A panel seat with no access: removed for a material conflict, or suspended while a delegate decides one. */
export const isSuspended = (m: { coiState: string }) =>
  m.coiState === 'REMOVED' || m.coiState === 'DECLARED_CONFLICT';

export const atLeast = (s: EvalRow['status'], min: (typeof STATUS_ORDER)[number]) =>
  STATUS_ORDER.indexOf(s) >= STATUS_ORDER.indexOf(min);

const PROCESS_ROLES: RoleName[] = ['PROCUREMENT', 'DELEGATE', 'LEGAL', 'PROBITY', 'EXEC'];

export class EvaluationService {
  constructor(
    private readonly clock: Clock,
    readonly audit: AuditService,
  ) {}

  async load(tx: Tx, tenantId: string, id: string): Promise<Loaded | null> {
    const [ev] = await tx
      .select()
      .from(evaluation)
      .where(and(eq(evaluation.id, id), eq(evaluation.tenantId, tenantId)));
    if (!ev) return null;
    const [t] = await tx.select().from(tender).where(eq(tender.id, ev.tenderId));
    const [req] = await tx.select().from(request).where(eq(request.id, t!.requestId));
    const criteria = await tx
      .select()
      .from(criterion)
      .where(eq(criterion.evaluationId, id))
      .orderBy(asc(criterion.id));
    const members = await tx
      .select({ m: panelMember, name: appUser.name })
      .from(panelMember)
      .innerJoin(appUser, eq(appUser.id, panelMember.userId))
      .where(eq(panelMember.evaluationId, id));
    const subs = await tx
      .select({ s: submission, company: supplier.company })
      .from(submission)
      .innerJoin(supplier, eq(supplier.id, submission.supplierId))
      .where(and(eq(submission.tenderId, ev.tenderId), eq(submission.status, 'SUBMITTED')))
      .orderBy(asc(submission.id));
    return {
      ev,
      tender: t!,
      req: req!,
      criteria: criteria.sort((a, b) => Number(b.weight) - Number(a.weight) || a.name.localeCompare(b.name)),
      panel: members.map((x) => ({ ...x.m, name: x.name })).sort((a, b) => a.name.localeCompare(b.name)),
      bidders: subs.map((x, i) => ({
        supplierId: x.s.supplierId,
        submissionId: x.s.id,
        company: x.company,
        label: anonymousName(i),
      })),
    };
  }

  memberOf(l: Loaded, userId: string): MemberRow | undefined {
    return l.panel.find((m) => m.userId === userId);
  }
  /** Criteria a person may see: a panel member only their stream's (plus shared ones); everyone else all of them. */
  criteriaFor(l: Loaded, member: MemberRow | undefined): CriterionRow[] {
    return member
      ? l.criteria.filter((c) => canScoreCriterion(member.stream as Stream, c.stream as Stream))
      : l.criteria;
  }
  active(l: Loaded): MemberRow[] {
    return l.panel.filter((m) => !isSuspended(m));
  }

  async notifyUsers(tx: Tx, tenantId: string, userIds: string[], title: string, body: string, link: string) {
    for (const userId of new Set(userIds))
      await tx.insert(notification).values({ tenantId, userId, title, body, link });
  }
  async notifyRoles(tx: Tx, tenantId: string, roles: RoleName[], title: string, body: string, link: string) {
    const rows = await tx
      .select({ userId: roleAssignment.userId })
      .from(roleAssignment)
      .where(and(eq(roleAssignment.tenantId, tenantId), inArray(roleAssignment.role, roles)));
    await this.notifyUsers(
      tx,
      tenantId,
      rows.map((r) => r.userId),
      title,
      body,
      link,
    );
  }

  /**
   * Moves COI_PENDING to SCORING once every member has declared and each stream that has criteria still has someone
   * to score it. Otherwise says what is missing so procurement can add a replacement.
   */
  async advance(tx: Tx, a: AuthContext, l: Loaded): Promise<string[]> {
    if (l.ev.status !== 'COI_PENDING') return [];
    const live = this.active(l);
    const blockers: string[] = [];
    const pending = live.filter((m) => m.coiState === 'NOT_DECLARED').length;
    if (pending) blockers.push(`${pending} panel member(s) have not declared yet`);
    const awaiting = l.panel.filter((m) => m.coiState === 'DECLARED_CONFLICT').length;
    if (awaiting) blockers.push(`${awaiting} declared conflict(s) await a delegate decision`);
    for (const s of ['TECHNICAL', 'COMMERCIAL'] as const)
      if (l.criteria.some((c) => c.stream === s) && !live.some((m) => m.stream === s))
        blockers.push(`No active ${s.toLowerCase()} evaluator: add a replacement`);
    if (!live.some((m) => m.stream === 'OTHER')) blockers.push('No active chair: add a replacement');
    if (blockers.length) return blockers;
    await tx
      .update(evaluation)
      .set({ status: 'SCORING', updatedAt: this.clock.now(), version: l.ev.version + 1 })
      .where(eq(evaluation.id, l.ev.id));
    await this.audit.record(tx, a.ctx, {
      action: 'evaluation.scoring_open',
      entityType: 'evaluation',
      entityId: l.ev.id,
      before: { status: 'COI_PENDING' },
      after: { status: 'SCORING' },
    });
    await this.notifyUsers(
      tx,
      a.user.tenantId,
      live.map((m) => m.userId),
      'Scoring is open',
      `${l.req.number} ${l.req.title}: score your suppliers independently`,
      `/app/evaluations/${l.ev.id}`,
    );
    return [];
  }

  // ------------------------------------------------------------------ the role-aware view
  async view(tx: Tx, a: AuthContext, l: Loaded) {
    const roles = a.user.roles;
    const me = this.memberOf(l, a.user.id);
    const proc = roles.includes('PROCUREMENT');
    const chair = roles.includes('CHAIR') && me?.stream === 'OTHER';
    const probity = roles.includes('PROBITY');
    const processRole = roles.some((r) => PROCESS_ROLES.includes(r));
    const declared = me?.coiState === 'DECLARED_NONE';
    const status = l.ev.status;

    // A panel member sees no identity and no file until they have declared no conflict.
    const namesVisible = processRole || declared;
    const myCriteria = this.criteriaFor(l, processRole ? undefined : me);

    const files = namesVisible
      ? await tx
          .select()
          .from(fileObject)
          .where(
            inArray(
              fileObject.submissionId,
              l.bidders.map((b) => b.submissionId).concat('00000000-0000-0000-0000-000000000000'),
            ),
          )
      : []; // the database also filters these by role, stream and close time (row level security)
    const suppliers = l.bidders.map((b) => ({
      supplierId: b.supplierId,
      displayName: namesVisible ? b.company : b.label,
      anonymised: !namesVisible,
      files: files
        .filter((f) => f.submissionId === b.submissionId)
        .filter(
          (f) => processRole || (me ? canSeeFileSection(me.stream as Stream, f.section as Stream) : false),
        )
        .map((f) => ({
          id: f.id,
          name: f.name,
          section: f.section,
          sizeBytes: f.sizeBytes,
          contentType: f.contentType,
        })),
    }));

    // Scores: the database returns a member only their own before consensus; the chair and probity see all afterwards.
    const rows = await tx.select().from(score).where(eq(score.evaluationId, l.ev.id));
    const mine = rows.filter((r) => r.evaluatorId === a.user.id);
    const required = me && declared ? suppliers.length * myCriteria.length : 0;
    const done = mine.filter((r) => myCriteria.some((c) => c.id === r.criterionId)).length;

    const items = atLeast(status, 'CONSENSUS')
      ? await tx.select().from(consensusItem).where(eq(consensusItem.evaluationId, l.ev.id))
      : [];
    const names = new Map(l.panel.map((m) => [m.userId, m.name]));
    const seeIndividual = (chair || probity) && atLeast(status, 'CONSENSUS');
    const seeConsensus = seeIndividual || (processRole && atLeast(status, 'LOCKED'));
    const consensus = seeConsensus
      ? items.map((i) => ({
          supplierId: i.supplierId,
          criterionId: i.criterionId,
          variancePct: i.variancePct === null ? null : Number(i.variancePct),
          flagged: i.flagged,
          consensusScore: i.consensusScore === null ? null : Number(i.consensusScore),
          rationale: i.rationale ?? null,
          ...(seeIndividual
            ? {
                individual: rows
                  .filter((r) => r.supplierId === i.supplierId && r.criterionId === i.criterionId)
                  .map((r) => ({
                    evaluator: names.get(r.evaluatorId) ?? '',
                    score: Number(r.score),
                    comment: r.comment ?? null,
                  })),
              }
            : {}),
        }))
      : [];

    const ranking = processRole || chair ? await this.ranking(l, items) : [];
    const [rep] = await tx.select().from(evalReport).where(eq(evalReport.evaluationId, l.ev.id));
    const seeReport = rep && (processRole || chair);
    const reportFields = seeReport
      ? await tx
          .select()
          .from(fieldValue)
          .where(and(eq(fieldValue.ownerType, 'EVAL_REPORT'), eq(fieldValue.ownerId, rep.id)))
      : [];
    const [dec] = rep
      ? await tx
          .select()
          .from(approval)
          .where(and(eq(approval.subjectType, 'EVAL_REPORT'), eq(approval.subjectId, rep.id)))
      : [];

    const roster = processRole || chair ? l.panel : l.panel.filter((m) => m.userId === a.user.id);
    // Declared conflicts are shown to those who must act on them (and to chair/probity oversight), never to other evaluators.
    const declarations =
      processRole || chair
        ? await tx
            .select()
            .from(coiDeclaration)
            .where(
              and(
                eq(coiDeclaration.scope, 'EVALUATION'),
                eq(coiDeclaration.scopeId, l.ev.id),
                eq(coiDeclaration.none, false),
              ),
            )
        : [];
    const probitySignoff = await this.probityOf(tx, l);
    return {
      id: l.ev.id,
      tenderId: l.tender.id,
      requestNumber: l.req.number,
      title: l.req.title,
      tenderType: l.tender.type,
      status,
      varianceLimitPct: l.ev.varianceLimitPct,
      version: l.ev.version,
      criteria: myCriteria.map((c) => ({
        id: c.id,
        name: c.name,
        weight: Number(c.weight),
        stream: c.stream,
        passFail: c.passFail,
      })),
      panel: roster.map((m) => ({
        userId: m.userId,
        name: m.name,
        stream: m.stream,
        coiState: m.coiState,
        scoringComplete: Boolean(m.scoredAt),
      })),
      suppliers,
      conflicts: declarations.map((c) => ({
        userId: c.userId,
        name: names.get(c.userId) ?? '',
        nature: c.nature ?? '',
        subjectOrg: c.subjectOrg ?? null,
        disposition: c.disposition,
        declaredAt: c.createdAt.toISOString(),
        ...(c.decidedAt ? { decidedAt: c.decidedAt.toISOString() } : {}),
      })),
      me: me
        ? { stream: me.stream, coiState: me.coiState, scoringComplete: Boolean(me.scoredAt), required, done }
        : null,
      consensus,
      ranking,
      report: seeReport
        ? {
            id: rep.id,
            status: rep.status,
            generatedAt: rep.generatedAt.toISOString(),
            sections: REPORT_SECTIONS.map((s) => ({
              key: s.key,
              label: s.label,
              paragraphs: (reportFields.find((f) => f.key === s.key)?.value ?? '')
                .split(/\n{2,}/)
                .filter(Boolean),
            })),
            ...(dec
              ? { decision: { decision: dec.decision, stamp: dec.stamp ?? '', comment: dec.comment ?? null } }
              : {}),
          }
        : null,
      probitySignoff,
      permissions: {
        ...this.permissions(l, a, me, chair, proc, items, rep),
        canSetVarianceLimit: chair && (l.ev.status === 'COI_PENDING' || l.ev.status === 'SCORING'),
        canProbitySignOff:
          a.user.roles.includes('PROBITY') && atLeast(l.ev.status, 'LOCKED') && probitySignoff === null,
      },
    };
  }

  /** The probity advisor's sign-off that the process was followed (recorded, not a gate on the award). */
  async probityOf(tx: Tx, l: Loaded) {
    const [row] = await tx
      .select({ a: approval, name: appUser.name })
      .from(approval)
      .innerJoin(appUser, eq(appUser.id, approval.userId))
      .where(
        and(
          eq(approval.subjectType, 'EVAL_PROBITY'),
          eq(approval.subjectId, l.ev.id),
          eq(approval.decision, 'APPROVED'),
        ),
      );
    return row
      ? {
          by: row.name,
          stamp: row.a.stamp ?? '',
          at: row.a.decidedAt.toISOString(),
          comment: row.a.comment ?? null,
        }
      : null;
  }

  private permissions(
    l: Loaded,
    a: AuthContext,
    me: MemberRow | undefined,
    chair: boolean,
    proc: boolean,
    items: Array<typeof consensusItem.$inferSelect>,
    rep: typeof evalReport.$inferSelect | undefined,
  ) {
    const s = l.ev.status;
    const live = this.active(l);
    const declared = me?.coiState === 'DECLARED_NONE';
    return {
      canDeclare: Boolean(me && me.coiState === 'NOT_DECLARED' && (s === 'COI_PENDING' || s === 'SCORING')),
      canScore: Boolean(declared && s === 'SCORING' && !me!.scoredAt),
      canOpenConsensus:
        !l.panel.some((m) => m.coiState === 'DECLARED_CONFLICT') &&
        chair &&
        declared &&
        s === 'SCORING' &&
        live.every((m) => m.coiState !== 'DECLARED_NONE' || m.scoredAt) &&
        live.every((m) => m.coiState !== 'NOT_DECLARED'),
      canSetConsensus: chair && s === 'CONSENSUS',
      canReopen:
        chair && (s === 'LOCKED' || (s === 'REPORTED' && rep !== undefined && rep.status !== 'APPROVED')),
      canDecideConflict:
        (a.user.roles.includes('DELEGATE') || a.user.roles.includes('EXEC')) &&
        l.panel.some((m) => m.coiState === 'DECLARED_CONFLICT'),
      canLock: chair && s === 'CONSENSUS' && items.length > 0,
      canManagePanel: proc && (s === 'COI_PENDING' || s === 'SCORING'),
      canGenerateReport: proc && (s === 'LOCKED' || (s === 'REPORTED' && rep?.status === 'DRAFT')),
      canDecideReport:
        (a.user.roles.includes('DELEGATE') || a.user.roles.includes('EXEC')) &&
        s === 'REPORTED' &&
        rep?.status === 'AWAITING_APPROVAL',
    };
  }

  /** Weighted scores and ranks from the consensus items (only meaningful once consensus is complete). */
  async ranking(l: Loaded, items: Array<typeof consensusItem.$inferSelect>) {
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
      }))
      .sort((x, y) => (x.rank ?? 99) - (y.rank ?? 99) || y.weightedScore - x.weightedScore);
  }

  now() {
    return this.clock.now();
  }
  forbidden(message: string, code = 'FORBIDDEN'): never {
    throw new AppError(403, code, message);
  }
}
