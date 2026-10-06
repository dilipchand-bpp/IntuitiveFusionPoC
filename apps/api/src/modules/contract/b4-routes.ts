/**
 * Contract award and legal, roadmap batch B4 (first half): the checks recorded against a contract, endorsements, the
 * signing mode, invitations and questions, the risk summary, other signing documents, exports and amended drafts,
 * and clause comments. Every change is audited.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RoleName } from '@if/shared';
import { guard, type AuthContext } from '../../auth/guard.js';
import { withContext, type Tx } from '../../db/client.js';
import {
  appUser,
  clause,
  contract,
  contractCheck,
  contractComment,
  contractEndorsement,
  contractFile,
  contractQuestion,
  contractRiskSummary,
  legalKnowledge,
  notification,
  signingInvitation,
  supplier,
  tender,
  request,
} from '../../db/schema.js';
import { renderDocx } from '../../documents/docx.js';
import { renderPdf, type PdfBlock, type PdfDocument } from '../../documents/pdf.js';
import { AppError, parse } from '../../http/errors.js';
import { loadSettings } from '../settings/settings.js';
import { checkUpload, sha256 } from '../tender/files.js';
import { buildRiskSummary, isProtected } from './b4-rules.js';
import {
  checkRows,
  inviteSigners,
  lockState,
  openQuestionCount,
  remindUnsigned,
  runPreflight,
  runRecheck,
  runTenderChecks,
  endorsementState,
} from './b4-service.js';
import { nextNumber, requiredSigners } from './clauses.js';
import type { B4Ctx } from './b4-routes2.js';
import { registerContractB4Part2 } from './b4-routes2.js';
import type { ContractDeps } from './routes.js';

type ContractRow = typeof contract.$inferSelect;
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
const EDITORS: RoleName[] = ['LEGAL', 'PROCUREMENT'];
const COLLAB: RoleName[] = ['LEGAL', 'PROCUREMENT', 'CONTRACT_MGR', 'FINANCE'];
const SIGNERS: RoleName[] = ['DELEGATE', 'EXEC'];
const stamp = (verb: string, name: string, role: string, at: Date) =>
  `${verb} · ${name} · ${role.replace('_', ' ')} · ${at.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

const reviewBody = z.object({ note: z.string().trim().min(10).max(1000) }).strict();
const endorseBody = z
  .object({ role: z.enum(['LEGAL', 'FINANCE']).optional(), comment: z.string().trim().max(1000).optional() })
  .strict();
const modeBody = z.object({ signingMode: z.enum(['STANDARD', 'BLIND', 'STAGED']) }).strict();
const questionBody = z
  .object({ question: z.string().trim().min(5).max(2000), clauseId: z.string().trim().max(60).optional() })
  .strict();
const answerBody = z.object({ answer: z.string().trim().min(2).max(4000) }).strict();
const summaryEditBody = z.object({ text: z.string().trim().min(10).max(8000) }).strict();
const docBody = z
  .object({
    docType: z.enum(['NDA', 'CONFIDENTIALITY', 'MASTER']),
    supplierId: uuid,
    title: z.string().trim().min(3).max(200),
    text: z.string().trim().min(20).max(20_000),
    startDate: isoDate.optional(),
    endDate: isoDate.optional(),
  })
  .strict();
const draftBody = z
  .object({
    fileName: z.string().trim().min(3).max(200),
    contentBase64: z.string().min(4).max(14_000_000),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();
const commentBody = z
  .object({ body: z.string().trim().min(2).max(4000), clauseId: z.string().trim().max(60).optional() })
  .strict();
const releaseExtra = z.object({ signingMode: z.enum(['STANDARD', 'BLIND', 'STAGED']).optional() }).strict();
export { releaseExtra };

export function contractDocument(
  c: ContractRow,
  title: string,
  clauses: Array<{ title: string; text: string }>,
  signed: string[],
  statusLabel: string,
  at: Date,
): PdfDocument {
  const stampText = (d: Date) => `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  const blocks: PdfBlock[] = [
    { type: 'title', text: title },
    { type: 'subtitle', text: c.number },
    { type: 'kv', label: 'Status', value: statusLabel },
    { type: 'kv', label: 'Version', value: `Record version ${c.version}` },
    { type: 'kv', label: 'Generated', value: stampText(at) },
    ...signed.map((s) => ({ type: 'kv', label: 'Signature', value: s }) as PdfBlock),
    { type: 'rule' },
  ];
  for (const k of clauses) {
    blocks.push({ type: 'h2', text: k.title });
    blocks.push({ type: 'p', text: k.text });
  }
  return {
    title: `${title} ${c.number}`,
    footer: `${title} ${c.number} - version ${c.version} - generated ${stampText(at)}`,
    created: at,
    blocks,
  };
}

export function registerContractB4(
  app: FastifyInstance,
  p: string,
  d: ContractDeps,
  reg: (m: string, path: string) => void,
  x: B4Ctx,
) {
  const cid = (req: { params: unknown }) => parse(z.object({ id: uuid }), req.params).id;
  const registry = x.registry;
  const names = async (tx: Tx, ids: string[]) => {
    if (!ids.length) return new Map<string, string>();
    const rows = await tx
      .select({ id: appUser.id, name: appUser.name })
      .from(appUser)
      .where(inArray(appUser.id, ids));
    return new Map(rows.map((r) => [r.id, r.name]));
  };

  // ---------------------------------------------------------------- checks (FR-0405, FR-0415, FR-0440)
  reg('GET', '/contracts/{id}/checks');
  app.get(`${p}/contracts/:id/checks`, { preHandler: guard(d, READERS) }, async (req) => {
    const a = req.auth!;
    const id = cid(req);
    return withContext(d.database, a.ctx, async (tx) => {
      const c = await x.load(tx, a, id);
      const rows = await checkRows(tx, c.id);
      return {
        tender: rows.filter((r) => r.kind === 'TENDER_CONSISTENCY'),
        vendor: rows.filter((r) => r.kind === 'VENDOR_PREFLIGHT'),
        recheck: rows.filter((r) => r.kind === 'RECHECK'),
        negotiation: await lockState(tx, c, d.clock.now()),
      };
    });
  });

  reg('POST', '/contracts/{id}/checks/run');
  app.post(`${p}/contracts/:id/checks/run`, { preHandler: guard(d, EDITORS) }, async (req) => {
    const a = req.auth!;
    const id = cid(req);
    return withContext(d.database, a.ctx, async (tx) => {
      const c = await x.load(tx, a, id);
      if (c.locked) throw new AppError(423, 'CONTRACT_LOCKED', 'This contract is executed and locked');
      const now = d.clock.now();
      await runTenderChecks(tx, c, now);
      await runPreflight(tx, c, registry, now);
      await d.audit.record(tx, a.ctx, {
        action: 'contract.checks_run',
        entityType: 'contract',
        entityId: id,
        after: { kinds: ['TENDER_CONSISTENCY', 'VENDOR_PREFLIGHT'] },
      });
      const rows = await checkRows(tx, c.id);
      return {
        tender: rows.filter((r) => r.kind === 'TENDER_CONSISTENCY'),
        vendor: rows.filter((r) => r.kind === 'VENDOR_PREFLIGHT'),
        recheck: rows.filter((r) => r.kind === 'RECHECK'),
      };
    });
  });

  reg('POST', '/contracts/{id}/checks/{kind}/{key}/review');
  app.post(`${p}/contracts/:id/checks/:kind/:key/review`, { preHandler: guard(d, EDITORS) }, async (req) => {
    const a = req.auth!;
    const { id, kind, key } = parse(
      z.object({
        id: uuid,
        kind: z.enum(['TENDER_CONSISTENCY', 'VENDOR_PREFLIGHT', 'RECHECK']),
        key: z.string().min(1).max(40),
      }),
      req.params,
    );
    const body = parse(reviewBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const c = await x.load(tx, a, id);
      const [row] = await tx
        .select()
        .from(contractCheck)
        .where(
          and(
            eq(contractCheck.contractId, c.id),
            eq(contractCheck.kind, kind),
            eq(contractCheck.checkKey, key),
          ),
        );
      if (!row || (row.result !== 'FAIL' && row.result !== 'WARN'))
        throw new AppError(409, 'INVALID_STATE', 'Only a failed or flagged check can be reviewed');
      await tx
        .update(contractCheck)
        .set({ result: 'REVIEWED', reviewedBy: a.user.id, reviewNote: body.note, reviewedAt: d.clock.now() })
        .where(eq(contractCheck.id, row.id));
      await d.audit.record(tx, a.ctx, {
        action: 'contract.check_review',
        entityType: 'contract',
        entityId: id,
        before: { kind, key, result: row.result, detail: row.detail },
        after: { result: 'REVIEWED', note: body.note },
      });
      return x.view(tx, a, c);
    });
  });

  reg('POST', '/contracts/{id}/recheck');
  app.post(`${p}/contracts/:id/recheck`, { preHandler: guard(d, EDITORS) }, async (req) => {
    const a = req.auth!;
    const id = cid(req);
    return withContext(d.database, a.ctx, async (tx) => {
      const c = await x.load(tx, a, id);
      if (c.locked) throw new AppError(423, 'CONTRACT_LOCKED', 'This contract is executed and locked');
      const results = await runRecheck(tx, c, x.sanctions, registry, d.clock.now());
      await d.audit.record(tx, a.ctx, {
        action: 'contract.recheck',
        entityType: 'contract',
        entityId: id,
        after: { results: results.map((r) => `${r.key}:${r.result}`) },
      });
      return x.view(tx, a, await x.load(tx, a, id));
    });
  });

  // ---------------------------------------------------------------- the supplier's banking details (FR-0415)
  reg('PUT', '/supplier/profile/bank');
  app.put(`${p}/supplier/profile/bank`, { preHandler: guard(d, ['SUPPLIER']) }, async (req) => {
    const a = req.auth!;
    const body = parse(
      z
        .object({
          bsb: z
            .string()
            .trim()
            .regex(/^\d{3}-?\d{3}$/, 'Six digits, for example 062-000'),
          account: z
            .string()
            .trim()
            .regex(/^\d{6,10}$/, 'Six to ten digits'),
          accountName: z.string().trim().min(2).max(200),
        })
        .strict(),
      req.body,
    );
    return withContext(d.database, a.ctx, async (tx) => {
      await tx
        .update(supplier)
        .set({ bank: { ...body, recordedAt: d.clock.now().toISOString() } })
        .where(eq(supplier.id, a.user.supplierId!));
      // the audit trail records that details were given, not the numbers
      await d.audit.record(tx, a.ctx, {
        action: 'supplier.bank_update',
        entityType: 'supplier',
        entityId: a.user.supplierId,
        after: { accountName: body.accountName },
      });
      return {
        bsb: body.bsb,
        account: `${'*'.repeat(Math.max(body.account.length - 3, 0))}${body.account.slice(-3)}`,
        accountName: body.accountName,
      };
    });
  });

  // ---------------------------------------------------------------- endorsements (FR-0480)
  reg('POST', '/contracts/{id}/endorse');
  app.post(`${p}/contracts/:id/endorse`, { preHandler: guard(d, ['LEGAL', 'FINANCE']) }, async (req) => {
    const a = req.auth!;
    const id = cid(req);
    const body = parse(endorseBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const c = await x.load(tx, a, id);
      if (c.locked || !['DRAFT', 'LEGAL_REVIEW'].includes(c.status))
        throw new AppError(
          409,
          'INVALID_STATE',
          'A contract can be endorsed before it is released for signing',
        );
      const role = body.role ?? (a.user.roles.includes('LEGAL') ? 'LEGAL' : 'FINANCE');
      if (!a.user.roles.includes(role))
        throw new AppError(403, 'FORBIDDEN', 'You cannot endorse on behalf of that function');
      const e = await endorsementState(tx, c);
      if (!e.required.includes(role))
        throw new AppError(
          409,
          'NOT_REQUIRED',
          `A ${role.toLowerCase()} endorsement is not required by this organisation`,
        );
      if (e.done.some((x2) => x2.role === role))
        throw new AppError(409, 'ALREADY_ENDORSED', 'This contract is already endorsed by that function');
      await tx.insert(contractEndorsement).values({
        tenantId: a.user.tenantId,
        contractId: id,
        role,
        userId: a.user.id,
        comment: body.comment ?? null,
        decidedAt: d.clock.now(),
      });
      await d.audit.record(tx, a.ctx, {
        action: 'contract.endorse',
        entityType: 'contract',
        entityId: id,
        after: { role, comment: body.comment ?? null },
      });
      await x.notifyRoles(
        tx,
        a.user.tenantId,
        ['LEGAL', 'PROCUREMENT'],
        `${role === 'LEGAL' ? 'Legal' : 'Finance'} endorsed the contract`,
        `${c.number}`,
        `/app/contracts/${id}`,
      );
      return x.view(tx, a, c);
    });
  });

  // ---------------------------------------------------------------- signing mode (FR-0425)
  reg('PUT', '/contracts/{id}/signing-mode');
  app.put(`${p}/contracts/:id/signing-mode`, { preHandler: guard(d, EDITORS) }, async (req) => {
    const a = req.auth!;
    const id = cid(req);
    const body = parse(modeBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const c = await x.load(tx, a, id);
      if (c.locked || !['DRAFT', 'LEGAL_REVIEW'].includes(c.status))
        throw new AppError(
          409,
          'INVALID_STATE',
          'The signing mode is set before the contract is released for signing',
        );
      await tx
        .update(contract)
        .set({ signingMode: body.signingMode, updatedAt: d.clock.now(), version: c.version + 1 })
        .where(eq(contract.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'contract.signing_mode',
        entityType: 'contract',
        entityId: id,
        before: { signingMode: c.signingMode },
        after: { signingMode: body.signingMode },
      });
      return x.view(tx, a, await x.load(tx, a, id));
    });
  });

  // ---------------------------------------------------------------- invitations, reminders and questions (FR-0445)
  reg('GET', '/contracts/{id}/signing');
  app.get(`${p}/contracts/:id/signing`, { preHandler: guard(d, READERS) }, async (req) => {
    const a = req.auth!;
    const id = cid(req);
    return withContext(d.database, a.ctx, async (tx) => {
      const c = await x.load(tx, a, id);
      const inv = await tx
        .select()
        .from(signingInvitation)
        .where(eq(signingInvitation.contractId, c.id))
        .orderBy(asc(signingInvitation.name));
      const sigs = (await x.signaturesOf(tx, a.user.tenantId, c.id)).filter((s) => s.decision === 'APPROVED');
      const chain = requiredSigners(await x.authorityValue(tx, c));
      return {
        status: c.status,
        signed: sigs.length,
        required: chain.length,
        invitations: inv.map((i) => ({
          name: i.name,
          role: i.roleLabel,
          external: Boolean(i.supplierId),
          invitedAt: i.invitedAt.toISOString(),
          viewedAt: i.viewedAt?.toISOString() ?? null,
          remindedAt: i.remindedAt?.toISOString() ?? null,
          reminders: i.reminderCount,
          signed: !i.supplierId && sigs.some((s) => s.role === i.roleLabel),
        })),
      };
    });
  });

  reg('POST', '/contracts/{id}/signing/remind');
  app.post(`${p}/contracts/:id/signing/remind`, { preHandler: guard(d, EDITORS) }, async (req) => {
    const a = req.auth!;
    const id = cid(req);
    return withContext(d.database, a.ctx, async (tx) => {
      const c = await x.load(tx, a, id);
      const reminded = await remindUnsigned(tx, c, d.clock.now(), false);
      await d.audit.record(tx, a.ctx, {
        action: 'contract.signing_remind',
        entityType: 'contract',
        entityId: id,
        after: { reminded: reminded.length },
      });
      return { reminded };
    });
  });

  reg('POST', '/contracts/{id}/questions');
  app.post(
    `${p}/contracts/:id/questions`,
    { preHandler: guard(d, [...SIGNERS, ...EDITORS]) },
    async (req, reply) => {
      const a = req.auth!;
      const id = cid(req);
      const body = parse(questionBody, req.body);
      const out = await withContext(d.database, a.ctx, async (tx) => {
        const c = await x.load(tx, a, id);
        const [q] = await tx
          .insert(contractQuestion)
          .values({
            tenantId: a.user.tenantId,
            contractId: id,
            askedBy: a.user.id,
            side: 'INTERNAL',
            clauseId: body.clauseId ?? null,
            question: body.question,
          })
          .returning();
        await d.audit.record(tx, a.ctx, {
          action: 'contract.question',
          entityType: 'contract',
          entityId: id,
          after: { questionId: q!.id, clauseId: body.clauseId ?? null },
        });
        await x.notifyRoles(
          tx,
          a.user.tenantId,
          ['LEGAL'],
          'A question about a contract',
          `${c.number}: ${body.question.slice(0, 120)}`,
          `/app/contracts/${id}`,
        );
        return { id: q!.id };
      });
      return reply.status(201).send(out);
    },
  );

  const questionView = async (tx: Tx, contractId: string) => {
    const rows = await tx
      .select()
      .from(contractQuestion)
      .where(eq(contractQuestion.contractId, contractId))
      .orderBy(asc(contractQuestion.createdAt));
    const n = await names(
      tx,
      rows.flatMap((r) => [r.askedBy, ...(r.answeredBy ? [r.answeredBy] : [])]),
    );
    return rows.map((r) => ({
      id: r.id,
      side: r.side,
      askedBy: n.get(r.askedBy) ?? '',
      clauseId: r.clauseId,
      question: r.question,
      answer: r.answer,
      answeredBy: r.answeredBy ? (n.get(r.answeredBy) ?? '') : null,
      answeredAt: r.answeredAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  };
  reg('GET', '/contracts/{id}/questions');
  app.get(`${p}/contracts/:id/questions`, { preHandler: guard(d, READERS) }, async (req) => {
    const a = req.auth!;
    const id = cid(req);
    return withContext(d.database, a.ctx, async (tx) => {
      await x.load(tx, a, id);
      return { questions: await questionView(tx, id) };
    });
  });

  reg('POST', '/contract-questions/{id}/answer');
  app.post(`${p}/contract-questions/:id/answer`, { preHandler: guard(d, ['LEGAL']) }, async (req) => {
    const a = req.auth!;
    const id = cid(req);
    const body = parse(answerBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const [q] = await tx
        .select()
        .from(contractQuestion)
        .where(and(eq(contractQuestion.id, id), eq(contractQuestion.tenantId, a.user.tenantId)));
      if (!q) throw new AppError(404, 'NOT_FOUND', 'Question not found');
      if (q.answer) throw new AppError(409, 'INVALID_STATE', 'This question is already answered');
      const c = await x.load(tx, a, q.contractId);
      await tx
        .update(contractQuestion)
        .set({ answer: body.answer, answeredBy: a.user.id, answeredAt: d.clock.now() })
        .where(eq(contractQuestion.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'contract.question_answer',
        entityType: 'contract',
        entityId: q.contractId,
        after: { questionId: id, side: q.side },
      });
      await tx.insert(notification).values({
        tenantId: a.user.tenantId,
        userId: q.askedBy,
        title: 'Your question about a contract was answered',
        body: `${c.number}: ${body.answer.slice(0, 120)}`,
        link: q.side === 'SUPPLIER' ? `/supplier/contracts/${c.id}` : `/app/contracts/${c.id}`,
      });
      return (await questionView(tx, q.contractId)).find((r) => r.id === id);
    });
  });

  // ---------------------------------------------------------------- risk summary for the signing delegate (FR-0450)
  async function summaryFor(tx: Tx, a: AuthContext, c: ContractRow, refresh: boolean) {
    const [existing] = await tx
      .select()
      .from(contractRiskSummary)
      .where(eq(contractRiskSummary.contractId, c.id));
    if (existing && !refresh) return existing;
    const v = (await x.view(tx, a, c)) as {
      deviations: Array<{ title: string; clauseId: string; risk: string; decision: string | null }>;
      title: string | null;
    };
    const settings = await loadSettings(tx, c.tenantId);
    const [s] = await tx.select().from(supplier).where(eq(supplier.id, c.supplierId));
    const checks = (await checkRows(tx, c.id)).filter((r) => r.result === 'FAIL' || r.result === 'WARN');
    const months =
      c.startDate && c.endDate
        ? Math.round((Date.parse(c.endDate) - Date.parse(c.startDate)) / (30.44 * 86_400_000))
        : null;
    const generated = buildRiskSummary({
      title: v.title ?? c.title ?? c.number,
      value: Number(c.value),
      months,
      signingLimit: null,
      deviations: v.deviations.map((dv) => ({
        title: dv.title,
        risk: dv.risk,
        decision: dv.decision,
        protected: isProtected(dv.clauseId, settings.contractRules.protectedClauses),
      })),
      checks,
      supplier: {
        insuranceStatus: s?.insuranceStatus ?? 'UNKNOWN',
        sanctionsStatus: s?.sanctionsStatus ?? 'PENDING',
      },
      openQuestions: await openQuestionCount(tx, c.id),
    });
    const now = d.clock.now();
    if (existing)
      await tx
        .update(contractRiskSummary)
        .set({ generated, generatedAt: now, edited: null, reviewedBy: null, reviewedAt: null })
        .where(eq(contractRiskSummary.id, existing.id));
    else
      await tx
        .insert(contractRiskSummary)
        .values({ tenantId: c.tenantId, contractId: c.id, generated, generatedAt: now });
    const [row] = await tx.select().from(contractRiskSummary).where(eq(contractRiskSummary.contractId, c.id));
    return row!;
  }
  const summaryView = async (tx: Tx, row: typeof contractRiskSummary.$inferSelect) => {
    const n = await names(tx, row.reviewedBy ? [row.reviewedBy] : []);
    return {
      generated: row.generated,
      edited: row.edited,
      generatedAt: row.generatedAt.toISOString(),
      reviewedBy: row.reviewedBy ? (n.get(row.reviewedBy) ?? '') : null,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
    };
  };
  reg('GET', '/contracts/{id}/risk-summary');
  app.get(
    `${p}/contracts/:id/risk-summary`,
    { preHandler: guard(d, ['DELEGATE', 'EXEC', 'LEGAL', 'PROCUREMENT']) },
    async (req) => {
      const a = req.auth!;
      const id = cid(req);
      const refresh = (req.query as { refresh?: string }).refresh === 'true';
      return withContext(d.database, a.ctx, async (tx) => {
        const c = await x.load(tx, a, id);
        if (refresh && !a.user.roles.some((r) => EDITORS.includes(r)))
          throw new AppError(403, 'FORBIDDEN', 'Only legal or procurement can regenerate the summary');
        return summaryView(tx, await summaryFor(tx, a, c, refresh));
      });
    },
  );
  reg('PUT', '/contracts/{id}/risk-summary');
  app.put(`${p}/contracts/:id/risk-summary`, { preHandler: guard(d, ['LEGAL']) }, async (req) => {
    const a = req.auth!;
    const id = cid(req);
    const body = parse(summaryEditBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const c = await x.load(tx, a, id);
      const row = await summaryFor(tx, a, c, false);
      await tx
        .update(contractRiskSummary)
        .set({ edited: body.text, reviewedBy: null, reviewedAt: null })
        .where(eq(contractRiskSummary.id, row.id));
      await d.audit.record(tx, a.ctx, {
        action: 'contract.risk_summary_edit',
        entityType: 'contract',
        entityId: id,
      });
      const [fresh] = await tx.select().from(contractRiskSummary).where(eq(contractRiskSummary.id, row.id));
      return summaryView(tx, fresh!);
    });
  });
  reg('POST', '/contracts/{id}/risk-summary/review');
  app.post(`${p}/contracts/:id/risk-summary/review`, { preHandler: guard(d, ['LEGAL']) }, async (req) => {
    const a = req.auth!;
    const id = cid(req);
    return withContext(d.database, a.ctx, async (tx) => {
      const c = await x.load(tx, a, id);
      const row = await summaryFor(tx, a, c, false);
      await tx
        .update(contractRiskSummary)
        .set({ reviewedBy: a.user.id, reviewedAt: d.clock.now() })
        .where(eq(contractRiskSummary.id, row.id));
      await d.audit.record(tx, a.ctx, {
        action: 'contract.risk_summary_review',
        entityType: 'contract',
        entityId: id,
      });
      const [fresh] = await tx.select().from(contractRiskSummary).where(eq(contractRiskSummary.id, row.id));
      return summaryView(tx, fresh!);
    });
  });

  // ---------------------------------------------------------------- other signing documents (FR-0430)
  reg('POST', '/contracts/documents');
  app.post(`${p}/contracts/documents`, { preHandler: guard(d, EDITORS) }, async (req, reply) => {
    const a = req.auth!;
    const body = parse(docBody, req.body);
    const out = await withContext(d.database, a.ctx, async (tx) => {
      const [s] = await tx
        .select()
        .from(supplier)
        .where(and(eq(supplier.id, body.supplierId), eq(supplier.tenantId, a.user.tenantId)));
      if (!s) throw new AppError(404, 'NOT_FOUND', 'Supplier not found');
      const today = d.clock.now().toISOString().slice(0, 10);
      const existing = await tx
        .select({ number: contract.number })
        .from(contract)
        .where(eq(contract.tenantId, a.user.tenantId));
      const number = nextNumber(
        d.clock.now().getUTCFullYear(),
        existing.map((e) => e.number),
      );
      const [row] = await tx
        .insert(contract)
        .values({
          tenantId: a.user.tenantId,
          number,
          supplierId: body.supplierId,
          status: 'DRAFT',
          value: '0.00',
          startDate: body.startDate ?? today,
          endDate: body.endDate ?? `${Number(today.slice(0, 4)) + 3}${today.slice(4)}`,
          noticeDays: 30,
          docType: body.docType,
          title: body.title,
          createdAt: d.clock.now(),
          updatedAt: d.clock.now(),
        })
        .returning();
      await tx.insert(clause).values({
        tenantId: a.user.tenantId,
        contractId: row!.id,
        clauseId: 'BODY',
        title: body.title,
        text: body.text,
        mandatory: true,
      });
      await d.audit.record(tx, a.ctx, {
        action: 'contract.document_create',
        entityType: 'contract',
        entityId: row!.id,
        after: { number, docType: body.docType, supplierId: body.supplierId },
      });
      await x.notifyRoles(
        tx,
        a.user.tenantId,
        ['LEGAL'],
        'A document is ready for legal review',
        `${number} ${body.title}`,
        `/app/contracts/${row!.id}`,
      );
      return x.view(tx, a, await x.load(tx, a, row!.id));
    });
    return reply.status(201).send(out);
  });

  // ---------------------------------------------------------------- download and amended drafts (FR-0465)
  for (const format of ['pdf', 'docx'] as const) {
    reg('GET', `/contracts/{id}/export.${format}`);
    app.get(`${p}/contracts/:id/export.${format}`, { preHandler: guard(d, READERS) }, async (req, reply) => {
      const a = req.auth!;
      const id = cid(req);
      const out = await withContext(d.database, a.ctx, async (tx) => {
        const c = await x.load(tx, a, id);
        const v = (await x.view(tx, a, c)) as {
          clauses: Array<{ title: string; text: string; redacted?: boolean }>;
          title: string | null;
          signatures: Array<{ decision: string; stamp: string | null }>;
        };
        await d.audit.record(tx, a.ctx, {
          action: 'contract.export',
          entityType: 'contract',
          entityId: id,
          after: { format: format.toUpperCase(), status: c.status, version: c.version },
        });
        const label = {
          CONTRACT: 'Contract',
          NDA: 'Non-disclosure agreement',
          CONFIDENTIALITY: 'Confidentiality agreement',
          MASTER: 'Master agreement',
        }[c.docType];
        return {
          c,
          doc: contractDocument(
            c,
            `${label}${v.title ? `: ${v.title}` : ''}`,
            v.clauses.map((k) => (k.redacted ? { ...k, text: '[Redacted]' } : k)), // redaction holds in every document (FR-0830)
            v.signatures.filter((s) => s.decision === 'APPROVED').map((s) => s.stamp ?? ''),
            c.status.replace('_', ' ').toLowerCase(),
            d.clock.now(),
          ),
        };
      });
      return reply
        .header(
          'content-type',
          format === 'pdf'
            ? 'application/pdf'
            : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        )
        .header('content-disposition', `attachment; filename="${out.c.number}-v${out.c.version}.${format}"`)
        .send(format === 'pdf' ? renderPdf(out.doc) : renderDocx(out.doc));
    });
  }

  reg('POST', '/contracts/{id}/drafts');
  app.post(
    `${p}/contracts/:id/drafts`,
    { preHandler: guard(d, ['LEGAL']), bodyLimit: 16 * 1024 * 1024 },
    async (req, reply) => {
      const a = req.auth!;
      const id = cid(req);
      const body = parse(draftBody, req.body);
      const bytes = Buffer.from(body.contentBase64, 'base64');
      const check = checkUpload(body.fileName, bytes);
      if (!check.ok) throw new AppError(400, check.code, check.message);
      const out = await withContext(d.database, a.ctx, async (tx) => {
        const c = await x.load(tx, a, id);
        if (c.locked) throw new AppError(423, 'CONTRACT_LOCKED', 'This contract is executed and locked');
        const key = `${a.user.tenantId}/contract/${id}/${randomUUID()}`;
        await x.store.put(key, bytes);
        const prior = await tx.select().from(contractFile).where(eq(contractFile.contractId, id));
        const [f] = await tx
          .insert(contractFile)
          .values({
            tenantId: a.user.tenantId,
            contractId: id,
            kind: 'AMENDED_DRAFT',
            name: check.safeName,
            sizeBytes: bytes.length,
            contentType: check.contentType,
            storageKey: key,
            sha256: sha256(bytes),
            version: prior.length + 1,
            note: body.note ?? null,
            uploadedBy: a.user.id,
          })
          .returning();
        await d.audit.record(tx, a.ctx, {
          action: 'contract.draft_upload',
          entityType: 'contract',
          entityId: id,
          after: { fileId: f!.id, name: f!.name, sha256: f!.sha256, version: f!.version },
        });
        return { id: f!.id, name: f!.name, version: f!.version, sha256: f!.sha256 };
      });
      return reply.status(201).send(out);
    },
  );
  reg('GET', '/contracts/{id}/drafts');
  app.get(`${p}/contracts/:id/drafts`, { preHandler: guard(d, READERS) }, async (req) => {
    const a = req.auth!;
    const id = cid(req);
    return withContext(d.database, a.ctx, async (tx) => {
      await x.load(tx, a, id);
      const rows = await tx
        .select()
        .from(contractFile)
        .where(eq(contractFile.contractId, id))
        .orderBy(desc(contractFile.version));
      const n = await names(
        tx,
        rows.map((r) => r.uploadedBy),
      );
      return {
        drafts: rows.map((r) => ({
          id: r.id,
          name: r.name,
          version: r.version,
          sizeBytes: r.sizeBytes,
          sha256: r.sha256,
          note: r.note,
          uploadedBy: n.get(r.uploadedBy) ?? '',
          at: r.createdAt.toISOString(),
        })),
      };
    });
  });
  reg('GET', '/contracts/{id}/drafts/{fileId}');
  app.get(`${p}/contracts/:id/drafts/:fileId`, { preHandler: guard(d, READERS) }, async (req, reply) => {
    const a = req.auth!;
    const { id, fileId } = parse(z.object({ id: uuid, fileId: uuid }), req.params);
    const f = await withContext(d.database, a.ctx, async (tx) => {
      await x.load(tx, a, id);
      const [row] = await tx
        .select()
        .from(contractFile)
        .where(and(eq(contractFile.id, fileId), eq(contractFile.contractId, id)));
      if (!row) throw new AppError(404, 'NOT_FOUND', 'File not found');
      await d.audit.record(tx, a.ctx, {
        action: 'contract.draft_download',
        entityType: 'contract',
        entityId: id,
        after: { fileId },
      });
      return row;
    });
    const bytes = await x.store.get(f.storageKey).catch(() => null);
    if (!bytes) throw new AppError(404, 'FILE_UNAVAILABLE', 'This file is not available');
    return reply
      .header('content-type', f.contentType)
      .header('content-disposition', `attachment; filename="${f.name.replace(/[^\w. -]/g, '_')}"`)
      .send(bytes);
  });

  // ---------------------------------------------------------------- comments: working on the draft together (FR-0465)
  reg('POST', '/contracts/{id}/comments');
  app.post(`${p}/contracts/:id/comments`, { preHandler: guard(d, COLLAB) }, async (req, reply) => {
    const a = req.auth!;
    const id = cid(req);
    const body = parse(commentBody, req.body);
    const out = await withContext(d.database, a.ctx, async (tx) => {
      const c = await x.load(tx, a, id);
      const [row] = await tx
        .insert(contractComment)
        .values({
          tenantId: a.user.tenantId,
          contractId: id,
          clauseId: body.clauseId ?? null,
          userId: a.user.id,
          body: body.body,
        })
        .returning();
      await d.audit.record(tx, a.ctx, {
        action: 'contract.comment',
        entityType: 'contract',
        entityId: id,
        after: { clauseId: body.clauseId ?? null },
      });
      await x.notifyRoles(
        tx,
        a.user.tenantId,
        ['LEGAL', 'PROCUREMENT'].filter((r) => !a.user.roles.includes(r as RoleName)) as RoleName[],
        'A comment on a contract',
        `${c.number}: ${a.user.name}`,
        `/app/contracts/${id}`,
      );
      return { id: row!.id };
    });
    return reply.status(201).send(out);
  });
  reg('GET', '/contracts/{id}/comments');
  app.get(`${p}/contracts/:id/comments`, { preHandler: guard(d, READERS) }, async (req) => {
    const a = req.auth!;
    const id = cid(req);
    return withContext(d.database, a.ctx, async (tx) => {
      await x.load(tx, a, id);
      const rows = await tx
        .select()
        .from(contractComment)
        .where(eq(contractComment.contractId, id))
        .orderBy(asc(contractComment.createdAt));
      const n = await names(
        tx,
        rows.map((r) => r.userId),
      );
      return {
        comments: rows.map((r) => ({
          id: r.id,
          clauseId: r.clauseId,
          by: n.get(r.userId) ?? '',
          body: r.body,
          at: r.createdAt.toISOString(),
        })),
      };
    });
  });

  void legalKnowledge;
  void tender;
  void request;
  void stamp;
  void inviteSigners;
  registerContractB4Part2(app, p, d, reg, x);
}
