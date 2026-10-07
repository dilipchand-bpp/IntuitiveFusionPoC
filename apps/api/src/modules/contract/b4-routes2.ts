/**
 * Contract award and legal, roadmap batch B4 (second half): the legal knowledge base, deviation explanations and
 * risk acceptance, the negotiation strategy, native legal matters with review hours, contract lineage, time-bound
 * access grants with the shared project documents, and the supplier's own view of a contract out for signature.
 */
import { openFieldRows } from '../b11enc/projects.js';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RoleName } from '@if/shared';
import type { SanctionsScreening } from '../../adapters/sanctions.js';
import type { VendorRegistry } from '../../adapters/vendor-registry.js';
import { guard, type AuthContext } from '../../auth/guard.js';
import { raiseMatterEvent } from '../b8/integration.js';
import { withContext, type Tx } from '../../db/client.js';
import {
  accessGrant,
  appUser,
  approval,
  bidPricing,
  clause,
  consensusItem,
  contract,
  contractQuestion,
  evalReport,
  evaluation,
  fieldValue,
  legalKnowledge,
  legalMatter,
  legalTimeEntry,
  notification,
  request,
  signingInvitation,
  submission,
  supplier,
  tender,
} from '../../db/schema.js';
import { renderPdf } from '../../documents/pdf.js';
import { AppError, parse } from '../../http/errors.js';
import { evaluationReportPdf } from '../evaluation/report-pdf.js';
import { loadSettings } from '../settings/settings.js';
import type { SealedStore } from '../tender/files.js';
import { buildStrategy, explainDeviation, isProtected, relevantKnowledge } from './b4-rules.js';
import { contractDocument } from './b4-routes.js';
import { grantsFor } from './b4-service.js';
import type { ContractDeps } from './routes.js';

type ContractRow = typeof contract.$inferSelect;
export interface B4Ctx {
  load: (tx: Tx, a: AuthContext, id: string) => Promise<ContractRow>;
  view: (tx: Tx, a: AuthContext, c: ContractRow) => Promise<unknown>;
  notifyRoles: (
    tx: Tx,
    tenantId: string,
    roles: RoleName[],
    title: string,
    body: string,
    link: string,
  ) => Promise<void>;
  signaturesOf: (
    tx: Tx,
    tenantId: string,
    contractId: string,
  ) => Promise<Array<{ role: string; decision: string; stamp: string | null }>>;
  authorityValue: (tx: Tx, c: ContractRow) => Promise<number>;
  templateClauses: (
    tx: Tx,
    tenantId: string,
    c: ContractRow,
  ) => Promise<{ lib: Array<{ clauseId: string; title: string; text: string }> }>;
  store: SealedStore;
  registry: VendorRegistry;
  sanctions: SanctionsScreening;
}

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-31');
const READERS: RoleName[] = [
  'PROCUREMENT',
  'LEGAL',
  'CONTRACT_MGR',
  'DELEGATE',
  'EXEC',
  'FINANCE',
  'PROBITY',
];
const ADVISED: RoleName[] = ['LEGAL', 'PROCUREMENT', 'DELEGATE', 'EXEC', 'CONTRACT_MGR', 'FINANCE'];
const STAFF: RoleName[] = [
  'REQUESTER',
  'PROCUREMENT',
  'DELEGATE',
  'EVALUATOR',
  'CHAIR',
  'LEGAL',
  'CONTRACT_MGR',
  'PROBITY',
  'FINANCE',
  'ADMIN',
  'EXEC',
];

const knowledgeBody = z
  .object({
    kind: z.enum(['POLICY', 'ADVICE', 'FALLBACK', 'BOILERPLATE']),
    title: z.string().trim().min(3).max(200),
    body: z.string().trim().min(10).max(20_000),
    clauseId: z.string().trim().max(60).optional(),
    tags: z.string().trim().max(300).optional(),
  })
  .strict();
const acceptBody = z.object({ statement: z.string().trim().min(10).max(2000) }).strict();
const plainRiskBody = z
  .object({ text: z.string().trim().min(3).max(1000), apply: z.boolean().default(false) })
  .strict();
const matterBody = z
  .object({
    title: z.string().trim().min(3).max(200),
    contractId: uuid.optional(),
    priority: z.enum(['LOW', 'NORMAL', 'HIGH']).optional(),
    assigneeId: uuid.optional(),
    dueOn: isoDate.optional(),
  })
  .strict();
const matterPatch = z
  .object({
    lane: z.enum(['NEW', 'IN_REVIEW', 'WAITING', 'DONE']).optional(),
    priority: z.enum(['LOW', 'NORMAL', 'HIGH']).optional(),
    assigneeId: uuid.nullable().optional(),
    dueOn: isoDate.nullable().optional(),
    title: z.string().trim().min(3).max(200).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to change' });
const timeBody = z
  .object({
    hours: z.number().min(0.25).max(24),
    workDate: isoDate,
    note: z.string().trim().max(500).optional(),
  })
  .strict();
const grantBody = z
  .object({
    userId: uuid,
    tenderId: uuid,
    label: z.enum(['COMMITTEE', 'AUDITOR', 'ADVISOR']),
    expiresOn: isoDate.optional(),
    event: z.enum(['CONTRACT_SIGNED', 'REPORT_APPROVED']).optional(),
    eventDays: z.number().int().min(0).max(3650).optional(),
  })
  .strict()
  .refine((b) => b.expiresOn || b.event, {
    message: 'Give an expiry date, an event, or both',
    path: ['expiresOn'],
  });
const revokeBody = z.object({ reason: z.string().trim().min(5).max(500) }).strict();
const askBody = z
  .object({ question: z.string().trim().min(5).max(2000), clauseId: z.string().trim().max(60).optional() })
  .strict();

/** Reads "this is high risk because ..." into a rating; the first rating word wins. */
export function readRisk(text: string): 'LOW' | 'MEDIUM' | 'HIGH' | null {
  const t = text.toLowerCase();
  const hit =
    /\b(high|serious|severe|critical|unacceptable|dangerous)\b|\b(medium|moderate|middling)\b|\b(low|minor|trivial|acceptable|harmless)\b/.exec(
      t,
    );
  if (!hit) return null;
  return hit[1] ? 'HIGH' : hit[2] ? 'MEDIUM' : 'LOW';
}

export function registerContractB4Part2(
  app: FastifyInstance,
  p: string,
  d: ContractDeps,
  reg: (m: string, path: string) => void,
  x: B4Ctx,
) {
  const cid = (req: { params: unknown }) => parse(z.object({ id: uuid }), req.params).id;
  const names = async (tx: Tx, ids: string[]) => {
    if (!ids.length) return new Map<string, string>();
    const rows = await tx
      .select({ id: appUser.id, name: appUser.name })
      .from(appUser)
      .where(inArray(appUser.id, ids));
    return new Map(rows.map((r) => [r.id, r.name]));
  };
  const knowledgeAll = async (tx: Tx, tenantId: string) =>
    tx
      .select()
      .from(legalKnowledge)
      .where(eq(legalKnowledge.tenantId, tenantId))
      .orderBy(asc(legalKnowledge.title));

  // ---------------------------------------------------------------- the legal knowledge base (FR-0385, FR-0470)
  reg('GET', '/legal-knowledge');
  app.get(`${p}/legal-knowledge`, { preHandler: guard(d, ['LEGAL', 'PROCUREMENT']) }, async (req) => {
    const a = req.auth!;
    const kind = (req.query as { kind?: string }).kind;
    return withContext(d.database, a.ctx, async (tx) => {
      const rows = (await knowledgeAll(tx, a.user.tenantId)).filter((r) => !kind || r.kind === kind);
      const n = await names(
        tx,
        rows.map((r) => r.createdBy),
      );
      return {
        items: rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          title: r.title,
          body: r.body,
          clauseId: r.clauseId,
          tags: r.tags,
          by: n.get(r.createdBy) ?? '',
          at: r.createdAt.toISOString(),
        })),
      };
    });
  });
  reg('POST', '/legal-knowledge');
  app.post(`${p}/legal-knowledge`, { preHandler: guard(d, ['LEGAL']) }, async (req, reply) => {
    const a = req.auth!;
    const body = parse(knowledgeBody, req.body);
    const out = await withContext(d.database, a.ctx, async (tx) => {
      const [row] = await tx
        .insert(legalKnowledge)
        .values({
          tenantId: a.user.tenantId,
          kind: body.kind,
          title: body.title,
          body: body.body,
          clauseId: body.clauseId ?? null,
          tags: body.tags ?? '',
          createdBy: a.user.id,
        })
        .returning();
      await d.audit.record(tx, a.ctx, {
        action: 'legal.knowledge_add',
        entityType: 'legal_knowledge',
        entityId: row!.id,
        after: { kind: body.kind, title: body.title, clauseId: body.clauseId ?? null },
      });
      return { id: row!.id };
    });
    return reply.status(201).send(out);
  });
  reg('DELETE', '/legal-knowledge/{id}');
  app.delete(`${p}/legal-knowledge/:id`, { preHandler: guard(d, ['LEGAL']) }, async (req, reply) => {
    const a = req.auth!;
    const id = cid(req);
    await withContext(d.database, a.ctx, async (tx) => {
      const gone = await tx
        .delete(legalKnowledge)
        .where(and(eq(legalKnowledge.id, id), eq(legalKnowledge.tenantId, a.user.tenantId)))
        .returning({ id: legalKnowledge.id });
      if (!gone.length) throw new AppError(404, 'NOT_FOUND', 'Entry not found');
      await d.audit.record(tx, a.ctx, {
        action: 'legal.knowledge_remove',
        entityType: 'legal_knowledge',
        entityId: id,
      });
    });
    return reply.status(204).send();
  });

  // ---------------------------------------------------------------- deviations in plain language (FR-0475)
  async function deviation(tx: Tx, a: AuthContext, id: string, clauseId: string) {
    const c = await x.load(tx, a, id);
    const [k] = await tx
      .select()
      .from(clause)
      .where(and(eq(clause.contractId, id), eq(clause.clauseId, clauseId)));
    if (!k || !k.changedFromTemplate) throw new AppError(404, 'NOT_FOUND', 'No deviation on that clause');
    return { c, k };
  }
  const params = z.object({ id: uuid, clauseId: z.string().min(1).max(60) });

  reg('POST', '/contracts/{id}/deviations/{clauseId}/explain');
  app.post(
    `${p}/contracts/:id/deviations/:clauseId/explain`,
    { preHandler: guard(d, ADVISED) },
    async (req) => {
      const a = req.auth!;
      const { id, clauseId } = parse(params, req.params);
      return withContext(d.database, a.ctx, async (tx) => {
        const { c, k } = await deviation(tx, a, id, clauseId);
        const { lib } = await x.templateClauses(tx, a.user.tenantId, c);
        const std = lib.find((l) => l.clauseId === clauseId);
        const settings = await loadSettings(tx, a.user.tenantId);
        const hits = relevantKnowledge(
          await knowledgeAll(tx, a.user.tenantId),
          `${k.title} ${k.text}`,
          clauseId,
        );
        const out = explainDeviation({
          title: k.title,
          mandatory: k.mandatory,
          protectedClause: isProtected(clauseId, settings.contractRules.protectedClauses),
          risk: k.risk ?? 'MEDIUM',
          templateText: std?.text ?? '',
          currentText: k.text,
          knowledge: hits.slice(0, 3),
        });
        await d.audit.record(tx, a.ctx, {
          action: 'contract.deviation_explain',
          entityType: 'contract',
          entityId: id,
          after: { clauseId },
        });
        return out;
      });
    },
  );

  reg('POST', '/contracts/{id}/deviations/{clauseId}/risk/plain');
  app.post(
    `${p}/contracts/:id/deviations/:clauseId/risk/plain`,
    { preHandler: guard(d, ['LEGAL']) },
    async (req) => {
      const a = req.auth!;
      const { id, clauseId } = parse(params, req.params);
      const body = parse(plainRiskBody, req.body);
      return withContext(d.database, a.ctx, async (tx) => {
        const { c, k } = await deviation(tx, a, id, clauseId);
        if (c.locked) throw new AppError(423, 'CONTRACT_LOCKED', 'This contract is executed and locked');
        const risk = readRisk(body.text);
        if (body.apply) {
          if (!risk)
            throw new AppError(400, 'NOTHING_UNDERSTOOD', 'No rating could be read from that text', [
              { field: 'text', message: 'Say whether the risk is low, medium or high' },
            ]);
          await tx.update(clause).set({ risk }).where(eq(clause.id, k.id));
          await d.audit.record(tx, a.ctx, {
            action: 'contract.deviation_risk',
            entityType: 'contract',
            entityId: id,
            before: { clauseId, risk: k.risk },
            after: { clauseId, risk, enteredAs: 'PLAIN_LANGUAGE', text: body.text },
          });
        }
        return { model: 'rules-simulated-v1', applied: body.apply, rating: risk, current: k.risk };
      });
    },
  );

  reg('POST', '/contracts/{id}/deviations/{clauseId}/accept-risk');
  app.post(
    `${p}/contracts/:id/deviations/:clauseId/accept-risk`,
    { preHandler: guard(d, ['DELEGATE', 'EXEC', 'CONTRACT_MGR']) },
    async (req) => {
      const a = req.auth!;
      const { id, clauseId } = parse(params, req.params);
      const body = parse(acceptBody, req.body);
      return withContext(d.database, a.ctx, async (tx) => {
        const { c, k } = await deviation(tx, a, id, clauseId);
        if (c.locked) throw new AppError(423, 'CONTRACT_LOCKED', 'This contract is executed and locked');
        const now = d.clock.now();
        await tx.insert(approval).values({
          tenantId: a.user.tenantId,
          subjectType: 'CONTRACT_RISK_ACCEPTANCE',
          subjectId: k.id,
          userId: a.user.id,
          role: a.user.role,
          decision: 'APPROVED',
          comment: body.statement,
          stamp: `RISK ACCEPTED · ${a.user.name} · ${a.user.role.replace('_', ' ')} · ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
          decidedAt: now,
        });
        await d.audit.record(tx, a.ctx, {
          action: 'contract.risk_accepted',
          entityType: 'contract',
          entityId: id,
          after: { clauseId, risk: k.risk, statement: body.statement },
        });
        await x.notifyRoles(
          tx,
          a.user.tenantId,
          ['LEGAL'],
          'A deviation risk was formally accepted',
          `${c.number}: ${k.title}`,
          `/app/contracts/${id}`,
        );
        return x.view(tx, a, c);
      });
    },
  );

  // ---------------------------------------------------------------- negotiation strategy (FR-0485)
  reg('GET', '/contracts/{id}/negotiation-strategy');
  app.get(
    `${p}/contracts/:id/negotiation-strategy`,
    { preHandler: guard(d, ['LEGAL', 'PROCUREMENT', 'DELEGATE', 'EXEC']) },
    async (req) => {
      const a = req.auth!;
      const id = cid(req);
      return withContext(d.database, a.ctx, async (tx) => {
        const c = await x.load(tx, a, id);
        const [t] = c.tenderId ? await tx.select().from(tender).where(eq(tender.id, c.tenderId)) : [];
        const [req0] = t ? await tx.select().from(request).where(eq(request.id, t.requestId)) : [];
        let tco: number | null = null;
        const rivals: number[] = [];
        if (t) {
          const subs = await tx.select().from(submission).where(eq(submission.tenderId, t.id));
          const prices = subs.length
            ? await tx
                .select()
                .from(bidPricing)
                .where(
                  inArray(
                    bidPricing.submissionId,
                    subs.map((s) => s.id),
                  ),
                )
            : [];
          for (const s of subs) {
            const pr = prices.find((x2) => x2.submissionId === s.id);
            if (!pr) continue;
            if (s.supplierId === c.supplierId) tco = Number(pr.tco);
            else rivals.push(Number(pr.tco));
          }
        }
        const devs = (
          await tx
            .select()
            .from(clause)
            .where(and(eq(clause.contractId, id), eq(clause.changedFromTemplate, true)))
        ).map((k) => k.title);
        const hits = relevantKnowledge(
          await knowledgeAll(tx, a.user.tenantId),
          `${req0?.category ?? ''} negotiation ${devs.join(' ')}`,
        );
        const out = buildStrategy({
          category: req0?.category ?? null,
          tenderType: t?.type ?? 'RFP',
          value: Number(c.value),
          tenderedTco: tco,
          estimate: req0?.estimatedValue ? Number(req0.estimatedValue) : null,
          competitorTcos: rivals,
          deviations: devs,
          knowledge: hits.slice(0, 3),
        });
        await d.audit.record(tx, a.ctx, {
          action: 'contract.negotiation_strategy',
          entityType: 'contract',
          entityId: id,
        });
        return out;
      });
    },
  );

  // ---------------------------------------------------------------- lineage (FR-0460)
  reg('GET', '/contracts/{id}/lineage');
  app.get(`${p}/contracts/:id/lineage`, { preHandler: guard(d, READERS) }, async (req) => {
    const a = req.auth!;
    const id = cid(req);
    return withContext(d.database, a.ctx, async (tx) => {
      const c = await x.load(tx, a, id);
      const root = c.parentId ? await x.load(tx, a, c.parentId) : c;
      const kids = await tx
        .select()
        .from(contract)
        .where(and(eq(contract.parentId, root.id), isNull(contract.deletedAt)))
        .orderBy(asc(contract.number));
      const done = kids.filter((k) => k.status === 'EXECUTED');
      return {
        root: {
          id: root.id,
          number: root.number,
          value: Number(root.value),
          endDate: root.endDate,
          status: root.status,
        },
        variations: kids.map((k) => ({
          id: k.id,
          number: k.number,
          status: k.status,
          value: Number(k.value),
          endDate: k.endDate,
          current: k.id === c.id,
        })),
        current: {
          id: c.id,
          number: c.number,
          isVariation: Boolean(c.parentId),
          parentNumber: c.parentId ? root.number : null,
        },
        cumulativeValue: Number(root.value) + done.reduce((s, k) => s + Number(k.value), 0),
        latestEndDate:
          [root.endDate, ...done.map((k) => k.endDate)]
            .filter((v): v is string => !!v)
            .sort()
            .at(-1) ?? null,
      };
    });
  });

  // ---------------------------------------------------------------- legal matters: board and review hours (FR-0385)
  const matterView = (
    m: typeof legalMatter.$inferSelect,
    extra: { hours: number; assignee: string | null; contract: string | null },
  ) => ({
    id: m.id,
    title: m.title,
    lane: m.lane,
    priority: m.priority,
    dueOn: m.dueOn,
    assigneeId: m.assigneeId,
    assignee: extra.assignee,
    contractId: m.contractId,
    contractNumber: extra.contract,
    externalRef: m.externalRef,
    externalStage: m.externalStage,
    hours: extra.hours,
    updatedAt: m.updatedAt.toISOString(),
  });
  async function board(tx: Tx, tenantId: string) {
    const ms = await tx
      .select()
      .from(legalMatter)
      .where(eq(legalMatter.tenantId, tenantId))
      .orderBy(desc(legalMatter.updatedAt));
    const time = ms.length
      ? await tx
          .select()
          .from(legalTimeEntry)
          .where(
            inArray(
              legalTimeEntry.matterId,
              ms.map((m) => m.id),
            ),
          )
      : [];
    const n = await names(
      tx,
      ms.flatMap((m) => (m.assigneeId ? [m.assigneeId] : [])),
    );
    const cs = ms.some((m) => m.contractId)
      ? await tx
          .select({ id: contract.id, number: contract.number })
          .from(contract)
          .where(
            inArray(
              contract.id,
              ms.flatMap((m) => (m.contractId ? [m.contractId] : [])),
            ),
          )
      : [];
    const rows = ms.map((m) =>
      matterView(m, {
        hours: time.filter((t) => t.matterId === m.id).reduce((s, t) => s + Number(t.hours), 0),
        assignee: m.assigneeId ? (n.get(m.assigneeId) ?? null) : null,
        contract: cs.find((c) => c.id === m.contractId)?.number ?? null,
      }),
    );
    return {
      lanes: (['NEW', 'IN_REVIEW', 'WAITING', 'DONE'] as const).map((lane) => ({
        lane,
        matters: rows.filter((r) => r.lane === lane),
      })),
      totalHours: rows.reduce((s, r) => s + r.hours, 0),
    };
  }
  reg('GET', '/legal/matters');
  app.get(`${p}/legal/matters`, { preHandler: guard(d, ['LEGAL', 'PROCUREMENT']) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, (tx) => board(tx, a.user.tenantId));
  });
  reg('POST', '/legal/matters');
  app.post(`${p}/legal/matters`, { preHandler: guard(d, ['LEGAL']) }, async (req, reply) => {
    const a = req.auth!;
    const body = parse(matterBody, req.body);
    const out = await withContext(d.database, a.ctx, async (tx) => {
      const [m] = await tx
        .insert(legalMatter)
        .values({
          tenantId: a.user.tenantId,
          title: body.title,
          contractId: body.contractId ?? null,
          priority: body.priority ?? 'NORMAL',
          assigneeId: body.assigneeId ?? null,
          dueOn: body.dueOn ?? null,
          createdBy: a.user.id,
          createdAt: d.clock.now(),
          updatedAt: d.clock.now(),
        })
        .returning();
      await d.audit.record(tx, a.ctx, {
        action: 'legal.matter_create',
        entityType: 'legal_matter',
        entityId: m!.id,
        after: { title: body.title, contractId: body.contractId ?? null },
      });
      // the customer's own legal platform is told, when there is one (FR-0390)
      const sent = await raiseMatterEvent(tx, { clock: d.clock, audit: d.audit }, a.ctx, m!);
      return {
        id: m!.id,
        externalRef:
          sent?.status === 'DELIVERED'
            ? ((sent.payload as { externalRef?: string }).externalRef ?? null)
            : null,
        integration: sent ? sent.status : null,
      };
    });
    return reply.status(201).send(out);
  });
  reg('PATCH', '/legal/matters/{id}');
  app.patch(`${p}/legal/matters/:id`, { preHandler: guard(d, ['LEGAL']) }, async (req) => {
    const a = req.auth!;
    const id = cid(req);
    const body = parse(matterPatch, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const [m] = await tx
        .select()
        .from(legalMatter)
        .where(and(eq(legalMatter.id, id), eq(legalMatter.tenantId, a.user.tenantId)));
      if (!m) throw new AppError(404, 'NOT_FOUND', 'Matter not found');
      await tx
        .update(legalMatter)
        .set({ ...body, updatedAt: d.clock.now() })
        .where(eq(legalMatter.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'legal.matter_update',
        entityType: 'legal_matter',
        entityId: id,
        before: { lane: m.lane, priority: m.priority },
        after: body,
      });
      return board(tx, a.user.tenantId);
    });
  });
  reg('POST', '/legal/matters/{id}/time');
  app.post(`${p}/legal/matters/:id/time`, { preHandler: guard(d, ['LEGAL']) }, async (req, reply) => {
    const a = req.auth!;
    const id = cid(req);
    const body = parse(timeBody, req.body);
    const out = await withContext(d.database, a.ctx, async (tx) => {
      const [m] = await tx
        .select()
        .from(legalMatter)
        .where(and(eq(legalMatter.id, id), eq(legalMatter.tenantId, a.user.tenantId)));
      if (!m) throw new AppError(404, 'NOT_FOUND', 'Matter not found');
      const [t] = await tx
        .insert(legalTimeEntry)
        .values({
          tenantId: a.user.tenantId,
          matterId: id,
          userId: a.user.id,
          hours: body.hours.toFixed(2),
          workDate: body.workDate,
          note: body.note ?? null,
        })
        .returning();
      await tx.update(legalMatter).set({ updatedAt: d.clock.now() }).where(eq(legalMatter.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'legal.time_log',
        entityType: 'legal_matter',
        entityId: id,
        after: { hours: body.hours, workDate: body.workDate },
      });
      return { id: t!.id };
    });
    return reply.status(201).send(out);
  });
  reg('GET', '/legal/matters/{id}/time');
  app.get(`${p}/legal/matters/:id/time`, { preHandler: guard(d, ['LEGAL', 'PROCUREMENT']) }, async (req) => {
    const a = req.auth!;
    const id = cid(req);
    return withContext(d.database, a.ctx, async (tx) => {
      // a matter of another organisation is "not found", not an empty list (SEC-D10)
      const [own] = await tx
        .select({ id: legalMatter.id })
        .from(legalMatter)
        .where(and(eq(legalMatter.id, id), eq(legalMatter.tenantId, a.user.tenantId)));
      if (!own) throw new AppError(404, 'NOT_FOUND', 'Matter not found');
      const rows = await tx
        .select()
        .from(legalTimeEntry)
        .where(and(eq(legalTimeEntry.matterId, id), eq(legalTimeEntry.tenantId, a.user.tenantId)))
        .orderBy(desc(legalTimeEntry.workDate));
      const n = await names(
        tx,
        rows.map((r) => r.userId),
      );
      return {
        entries: rows.map((r) => ({
          id: r.id,
          by: n.get(r.userId) ?? '',
          hours: Number(r.hours),
          workDate: r.workDate,
          note: r.note,
        })),
        totalHours: rows.reduce((s, r) => s + Number(r.hours), 0),
      };
    });
  });

  // ---------------------------------------------------------------- time-bound access grants (FR-0435)
  const grantView = (
    g: typeof accessGrant.$inferSelect,
    st: { live: boolean; endsAt: Date | null; reason: string | null },
    who?: string,
    project?: string,
  ) => ({
    id: g.id,
    userId: g.userId,
    user: who ?? null,
    tenderId: g.tenderId,
    project: project ?? null,
    label: g.label,
    expiresOn: g.expiresOn,
    event: g.event,
    eventDays: g.eventDays,
    live: st.live,
    endsAt: st.endsAt?.toISOString() ?? null,
    revokedAt: g.revokedAt?.toISOString() ?? null,
    revokedReason: g.revokedReason ?? null,
  });
  reg('POST', '/access-grants');
  app.post(`${p}/access-grants`, { preHandler: guard(d, ['PROCUREMENT', 'ADMIN']) }, async (req, reply) => {
    const a = req.auth!;
    const body = parse(grantBody, req.body);
    const out = await withContext(d.database, a.ctx, async (tx) => {
      const [u] = await tx
        .select()
        .from(appUser)
        .where(and(eq(appUser.id, body.userId), eq(appUser.tenantId, a.user.tenantId)));
      const [t] = await tx
        .select()
        .from(tender)
        .where(and(eq(tender.id, body.tenderId), eq(tender.tenantId, a.user.tenantId)));
      if (!u || !u.active || u.supplierId)
        throw new AppError(400, 'VALIDATION_FAILED', 'Choose an active member of staff', [
          { field: 'userId', message: 'Suppliers cannot be given project access this way' },
        ]);
      if (!t) throw new AppError(404, 'NOT_FOUND', 'Tender not found');
      const [g] = await tx
        .insert(accessGrant)
        .values({
          tenantId: a.user.tenantId,
          userId: body.userId,
          tenderId: body.tenderId,
          label: body.label,
          expiresOn: body.expiresOn ?? null,
          event: body.event ?? null,
          eventDays: body.eventDays ?? 0,
          createdBy: a.user.id,
          createdAt: d.clock.now(),
        })
        .returning();
      await d.audit.record(tx, a.ctx, {
        action: 'access.grant',
        entityType: 'access_grant',
        entityId: g!.id,
        after: {
          userId: body.userId,
          tenderId: body.tenderId,
          label: body.label,
          expiresOn: body.expiresOn ?? null,
          event: body.event ?? null,
          eventDays: body.eventDays ?? 0,
        },
      });
      await tx.insert(notification).values({
        tenantId: a.user.tenantId,
        userId: body.userId,
        title: 'You were given access to a project’s documents',
        body: `${body.label.toLowerCase()} access${body.expiresOn ? ` until ${body.expiresOn}` : ''}${body.event ? `, ending ${body.eventDays ?? 0} day(s) after ${body.event === 'CONTRACT_SIGNED' ? 'the contract is signed' : 'the report is approved'}` : ''}`,
        link: '/app/shared',
      });
      return { id: g!.id };
    });
    return reply.status(201).send(out);
  });
  reg('GET', '/access-grants/candidates');
  app.get(
    `${p}/access-grants/candidates`,
    { preHandler: guard(d, ['PROCUREMENT', 'ADMIN']) },
    async (req) => {
      const a = req.auth!;
      return withContext(d.database, a.ctx, async (tx) => {
        const users = await tx
          .select({ id: appUser.id, name: appUser.name, email: appUser.email })
          .from(appUser)
          .where(
            and(eq(appUser.tenantId, a.user.tenantId), eq(appUser.active, true), isNull(appUser.supplierId)),
          )
          .orderBy(asc(appUser.name));
        const tenders = await tx
          .select({ id: tender.id, number: request.number, title: request.title })
          .from(tender)
          .innerJoin(request, eq(request.id, tender.requestId))
          .where(eq(tender.tenantId, a.user.tenantId))
          .orderBy(desc(request.number));
        return { users, tenders };
      });
    },
  );
  reg('GET', '/access-grants');
  app.get(
    `${p}/access-grants`,
    { preHandler: guard(d, ['PROCUREMENT', 'ADMIN', 'PROBITY']) },
    async (req) => {
      const a = req.auth!;
      const tenderId = (req.query as { tenderId?: string }).tenderId;
      return withContext(d.database, a.ctx, async (tx) => {
        const rows = await tx
          .select()
          .from(accessGrant)
          .where(eq(accessGrant.tenantId, a.user.tenantId))
          .orderBy(desc(accessGrant.createdAt));
        const users = [...new Set(rows.map((r) => r.userId))];
        const all: ReturnType<typeof grantView>[] = [];
        const n = await names(tx, users);
        for (const uid of users) {
          for (const { g, ...st } of await grantsFor(tx, a, uid, d.clock.now(), d.audit as never))
            all.push(grantView(g, st, n.get(uid)));
        }
        return { grants: all.filter((g) => !tenderId || g.tenderId === tenderId) };
      });
    },
  );
  reg('DELETE', '/access-grants/{id}');
  app.delete(
    `${p}/access-grants/:id`,
    { preHandler: guard(d, ['PROCUREMENT', 'ADMIN']) },
    async (req, reply) => {
      const a = req.auth!;
      const id = cid(req);
      const body = parse(revokeBody, req.body);
      await withContext(d.database, a.ctx, async (tx) => {
        const [g] = await tx
          .select()
          .from(accessGrant)
          .where(and(eq(accessGrant.id, id), eq(accessGrant.tenantId, a.user.tenantId)));
        if (!g) throw new AppError(404, 'NOT_FOUND', 'Grant not found');
        if (g.revokedAt) throw new AppError(409, 'INVALID_STATE', 'This grant has already ended');
        await tx
          .update(accessGrant)
          .set({ revokedAt: d.clock.now(), revokedReason: body.reason })
          .where(eq(accessGrant.id, id));
        await d.audit.record(tx, a.ctx, {
          action: 'access.revoke',
          entityType: 'access_grant',
          entityId: id,
          after: { userId: g.userId, tenderId: g.tenderId, reason: body.reason },
        });
      });
      return reply.status(204).send();
    },
  );

  /** The live grants of the caller, each with the documents it opens. */
  async function myProjects(tx: Tx, a: AuthContext) {
    const gs = await grantsFor(tx, a, a.user.id, d.clock.now(), d.audit as never);
    const out = [];
    for (const { g, ...st } of gs) {
      const [t] = await tx.select().from(tender).where(eq(tender.id, g.tenderId));
      const [r] = t ? await tx.select().from(request).where(eq(request.id, t.requestId)) : [];
      const [c] = await tx
        .select()
        .from(contract)
        .where(and(eq(contract.tenderId, g.tenderId), isNull(contract.deletedAt)));
      const [ev] = await tx.select().from(evaluation).where(eq(evaluation.tenderId, g.tenderId));
      const [rep] = ev ? await tx.select().from(evalReport).where(eq(evalReport.evaluationId, ev.id)) : [];
      out.push({
        ...grantView(g, st, undefined, r ? `${r.number} ${r.title}` : ''),
        documents: st.live
          ? [
              ...(c
                ? [
                    {
                      kind: 'CONTRACT',
                      name: `Contract ${c.number}`,
                      url: `/api/v1/shared/projects/${g.tenderId}/contract.pdf`,
                    },
                  ]
                : []),
              ...(rep
                ? [
                    {
                      kind: 'REPORT',
                      name: 'Evaluation report',
                      url: `/api/v1/shared/projects/${g.tenderId}/report.pdf`,
                    },
                  ]
                : []),
            ]
          : [],
      });
    }
    return out;
  }
  reg('GET', '/shared/projects');
  app.get(`${p}/shared/projects`, { preHandler: guard(d, STAFF) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => ({ projects: await myProjects(tx, a) }));
  });

  for (const doc of ['contract', 'report'] as const) {
    reg('GET', `/shared/projects/{id}/${doc}.pdf`);
    app.get(`${p}/shared/projects/:id/${doc}.pdf`, { preHandler: guard(d, STAFF) }, async (req, reply) => {
      const a = req.auth!;
      const id = cid(req);
      const pdf = await withContext(d.database, a.ctx, async (tx) => {
        const live = (await myProjects(tx, a)).find((g) => g.tenderId === id && g.live);
        // the refusal is returned and thrown after the transaction, so an expiry recorded on the way is kept
        if (!live) return null;
        const now = d.clock.now();
        if (doc === 'contract') {
          const [c] = await tx
            .select()
            .from(contract)
            .where(and(eq(contract.tenderId, id), isNull(contract.deletedAt)));
          if (!c) throw new AppError(404, 'NOT_FOUND', 'There is no contract yet');
          const ks = await tx
            .select()
            .from(clause)
            .where(eq(clause.contractId, c.id))
            .orderBy(asc(clause.id));
          await d.audit.record(tx, a.ctx, {
            action: 'access.shared_view',
            entityType: 'contract',
            entityId: c.id,
            after: { document: 'contract', grant: live.id },
          });
          return renderPdf(
            contractDocument(c, 'Contract', ks, [], c.status.replace('_', ' ').toLowerCase(), now),
          );
        }
        const [ev] = await tx.select().from(evaluation).where(eq(evaluation.tenderId, id));
        const [rep] = ev ? await tx.select().from(evalReport).where(eq(evalReport.evaluationId, ev.id)) : [];
        if (!ev || !rep) throw new AppError(404, 'NOT_FOUND', 'There is no report yet');
        const [t] = await tx.select().from(tender).where(eq(tender.id, id));
        const [r] = await tx.select().from(request).where(eq(request.id, t!.requestId));
        const fields = await openFieldRows(
          tx,
          a.user.tenantId,
          t!.requestId,
          await tx
            .select()
            .from(fieldValue)
            .where(and(eq(fieldValue.ownerType, 'EVAL_REPORT'), eq(fieldValue.ownerId, rep.id))),
        );
        await d.audit.record(tx, a.ctx, {
          action: 'access.shared_view',
          entityType: 'evaluation',
          entityId: ev.id,
          after: { document: 'report', grant: live.id },
        });
        return evaluationReportPdf({
          requestNumber: r!.number,
          title: r!.title,
          tenderType: t!.type,
          evaluationVersion: ev.version,
          reportStatus: rep.status,
          generatedAt: rep.generatedAt,
          sections: fields
            .filter((f) => f.value)
            .map((f) => ({
              label: f.label ?? f.key,
              paragraphs: (f.value ?? '').split(/\n{2,}/).filter(Boolean),
            })),
          ranking: [],
        });
      });
      if (!pdf)
        throw new AppError(
          404,
          'ACCESS_ENDED',
          'You do not have access to this project’s documents, or your access has ended',
        );
      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', `attachment; filename="${doc}-${id.slice(0, 8)}.pdf"`)
        .send(pdf);
    });
  }

  // ---------------------------------------------------------------- the supplier's view of a contract out for signature (FR-0445)
  const OPEN_FOR_SUPPLIER = ['AWAITING_SIGNATURE', 'PARTIALLY_SIGNED', 'EXECUTED'];
  async function supplierContract(tx: Tx, a: AuthContext, id: string) {
    const [c] = await tx
      .select()
      .from(contract)
      .where(
        and(eq(contract.id, id), eq(contract.supplierId, a.user.supplierId!), isNull(contract.deletedAt)),
      );
    if (!c || !OPEN_FOR_SUPPLIER.includes(c.status))
      throw new AppError(404, 'NOT_FOUND', 'Contract not found');
    return c;
  }
  reg('GET', '/supplier/contracts');
  app.get(`${p}/supplier/contracts`, { preHandler: guard(d, ['SUPPLIER']) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(contract)
        .where(
          and(
            eq(contract.supplierId, a.user.supplierId!),
            inArray(contract.status, OPEN_FOR_SUPPLIER as ContractRow['status'][]),
            isNull(contract.deletedAt),
          ),
        )
        .orderBy(desc(contract.number));
      return {
        contracts: rows.map((c) => ({
          id: c.id,
          number: c.number,
          docType: c.docType,
          title: c.title,
          status: c.status,
          value: Number(c.value),
          startDate: c.startDate,
          endDate: c.endDate,
        })),
      };
    });
  });
  reg('GET', '/supplier/contracts/{id}');
  app.get(`${p}/supplier/contracts/:id`, { preHandler: guard(d, ['SUPPLIER']) }, async (req) => {
    const a = req.auth!;
    const id = cid(req);
    return withContext(d.database, a.ctx, async (tx) => {
      const c = await supplierContract(tx, a, id);
      const ks = await tx.select().from(clause).where(eq(clause.contractId, id)).orderBy(asc(clause.id));
      await tx
        .update(signingInvitation)
        .set({ viewedAt: d.clock.now() })
        .where(
          and(
            eq(signingInvitation.contractId, id),
            eq(signingInvitation.email, a.user.email),
            isNull(signingInvitation.viewedAt),
          ),
        );
      const qs = await tx
        .select()
        .from(contractQuestion)
        .where(and(eq(contractQuestion.contractId, id), eq(contractQuestion.askedBy, a.user.id)))
        .orderBy(asc(contractQuestion.createdAt));
      return {
        id: c.id,
        number: c.number,
        docType: c.docType,
        title: c.title,
        status: c.status,
        value: Number(c.value),
        startDate: c.startDate,
        endDate: c.endDate,
        clauses: ks.map((k) => ({ id: k.clauseId, title: k.title, text: k.text })),
        questions: qs.map((q) => ({
          id: q.id,
          clauseId: q.clauseId,
          question: q.question,
          answer: q.answer,
          answeredAt: q.answeredAt?.toISOString() ?? null,
        })),
      };
    });
  });
  reg('POST', '/supplier/contracts/{id}/questions');
  app.post(
    `${p}/supplier/contracts/:id/questions`,
    { preHandler: guard(d, ['SUPPLIER']) },
    async (req, reply) => {
      const a = req.auth!;
      const id = cid(req);
      const body = parse(askBody, req.body);
      const out = await withContext(d.database, a.ctx, async (tx) => {
        const c = await supplierContract(tx, a, id);
        if (c.status === 'EXECUTED')
          throw new AppError(409, 'INVALID_STATE', 'This contract is already signed');
        const [q] = await tx
          .insert(contractQuestion)
          .values({
            tenantId: a.user.tenantId,
            contractId: id,
            askedBy: a.user.id,
            side: 'SUPPLIER',
            clauseId: body.clauseId ?? null,
            question: body.question,
          })
          .returning();
        await d.audit.record(tx, a.ctx, {
          action: 'contract.question',
          entityType: 'contract',
          entityId: id,
          after: { questionId: q!.id, side: 'SUPPLIER' },
        });
        await x.notifyRoles(
          tx,
          a.user.tenantId,
          ['LEGAL', 'PROCUREMENT'],
          'The supplier asked a question about the contract',
          `${c.number}: ${body.question.slice(0, 120)}`,
          `/app/contracts/${id}`,
        );
        return { id: q!.id };
      });
      return reply.status(201).send(out);
    },
  );

  void consensusItem;
  void supplier;
}
