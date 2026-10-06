/**
 * Roadmap batch B8, contract and legal side: plain-language redaction, redlining and clause insertion, a portal link for an
 * outside law firm or a supplier's legal team (FR-0830); matters raised on, and synchronised back from, the customer's legal
 * platform (FR-0390); contracts that are never destroyed and can be brought back (NFR-L04); and a hard stop on further
 * changes while a statutory disclosure is overdue (NFR-L02).
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { LegalPlatformGateway } from '../../adapters/legal-platform.js';
import { guard, type AuthContext } from '../../auth/guard.js';
import { withContext, withSystem, type RequestContext, type Tx } from '../../db/client.js';
import {
  auditEvent,
  clause,
  contract,
  counselLink,
  disclosureTask,
  integrationEvent,
  legalMatter,
  legalRedline,
  supplier,
} from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { hashToken } from '../tender/routes.js';
import { loadSettings } from '../settings/settings.js';
import { eventView, retryFailed } from './integration.js';
import { connectorSecret } from '../b10conn/secrets.js';
import { B8_MODEL, insertedClauseId, orderClauses, parseLegalEdit } from './rules.js';
import type { ContractDeps } from '../contract/routes.js';

type Reg = (m: string, path: string) => void;
interface Ctx {
  load: (tx: Tx, a: AuthContext, id: string) => Promise<typeof contract.$inferSelect>;
  templateClauses: (
    tx: Tx,
    tenantId: string,
    c: typeof contract.$inferSelect,
  ) => Promise<{ lib: Array<{ clauseId: string; title: string; text: string }> }>;
  legal?: LegalPlatformGateway | undefined;
}
const uuid = z.string().uuid();
const editBody = z
  .object({ instruction: z.string().trim().min(3).max(4000), apply: z.boolean().default(true) })
  .strict();
const decisionBody = z.object({ decision: z.enum(['ACCEPT', 'REJECT']) }).strict();
const linkBody = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().email().max(200),
    party: z.enum(['EXTERNAL_COUNSEL', 'SUPPLIER']),
  })
  .strict();
const counselRedline = z
  .object({ clauseId: z.string().min(1).max(60), text: z.string().trim().min(10).max(8000) })
  .strict();
const restoreBody = z.object({ reason: z.string().trim().min(10).max(500) }).strict();
const webhookBody = z
  .object({
    eventId: z.string().min(6).max(100),
    matterRef: z.string().min(3).max(60),
    stage: z.string().min(2).max(60),
    redlines: z
      .array(
        z.object({
          clauseId: z.string().min(1).max(60),
          text: z.string().min(10).max(8000),
          author: z.string().max(120),
        }),
      )
      .max(50)
      .default([]),
  })
  .strict();

const STAGE_LANE: Array<[RegExp, 'NEW' | 'IN_REVIEW' | 'WAITING' | 'DONE']> = [
  [/complete|signed|closed|done|executed/i, 'DONE'],
  [/wait|counterparty|external|hold|pending/i, 'WAITING'],
  [/review|negotiat|markup|redline|progress/i, 'IN_REVIEW'],
];

/** Sorted-key JSON: what a sender signs, so the signature does not depend on how the body was spaced or ordered. */
export const canonical = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(',')}]`
    : v && typeof v === 'object'
      ? `{${Object.keys(v as object)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
          .join(',')}}`
      : JSON.stringify(v);
export const sign = (secret: string, body: unknown) =>
  createHmac('sha256', secret).update(canonical(body)).digest('hex');

/** A disclosure that is past due on this contract or any variation of it. Used to stop further change (NFR-L02). */
export async function overdueDisclosure(tx: Tx, contractId: string, today: string) {
  // a variation that was deleted before it took effect owes nothing
  const kids = await tx
    .select({ id: contract.id })
    .from(contract)
    .where(and(eq(contract.parentId, contractId), isNull(contract.deletedAt)));
  const ids = [contractId, ...kids.map((k) => k.id)];
  const rows = await tx
    .select()
    .from(disclosureTask)
    .where(and(inArray(disclosureTask.contractId, ids), eq(disclosureTask.status, 'OPEN')));
  return rows.find((r) => r.dueOn < today) ?? null;
}

export function registerContractB8(app: FastifyInstance, p: string, d: ContractDeps, reg: Reg, x: Ctx) {
  const now = () => d.clock.now();
  const cid = (req: { params: unknown }) => parse(z.object({ id: uuid }), req.params).id;
  const integ = { clock: d.clock, audit: d.audit, ...(x.legal ? { legal: x.legal } : {}) };

  async function ordered(tx: Tx, c: typeof contract.$inferSelect) {
    const rows = await tx.select().from(clause).where(eq(clause.contractId, c.id)).orderBy(asc(clause.id));
    const { lib } = await x.templateClauses(tx, c.tenantId, c);
    return orderClauses(
      rows,
      lib.map((l) => l.clauseId),
    );
  }
  const editable = (c: typeof contract.$inferSelect) =>
    !c.locked && ['DRAFT', 'LEGAL_REVIEW'].includes(c.status);

  // ---------------------------------------------------------------- plain-language legal edits (FR-0830)
  reg('POST', '/contracts/{id}/legal-edit');
  app.post(`${p}/contracts/:id/legal-edit`, { preHandler: guard(d, ['LEGAL']) }, async (req) => {
    const a = req.auth!;
    const id = cid(req);
    const body = parse(editBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const c = await x.load(tx, a, id);
      if (!editable(c))
        throw new AppError(
          409,
          'INVALID_STATE',
          'The wording can only change before the contract is released for signature',
        );
      const rows = await ordered(tx, c);
      const parsed = parseLegalEdit(
        body.instruction,
        rows.map((r) => ({ clauseId: r.clauseId, title: r.title })),
      );
      if (!parsed.ok)
        return {
          applied: false,
          understood: false,
          explanation: 'I did not change anything.',
          hint: parsed.hint,
          model: B8_MODEL,
        };
      const it = parsed.intent;
      const target = rows.find(
        (r) => r.clauseId === (it.kind === 'INSERT' ? it.afterClauseId : it.clauseId),
      )!;
      const explain =
        it.kind === 'REDACT'
          ? `Redact "${target.title}". Its wording is withheld from exports and from everyone but Legal.`
          : it.kind === 'UNREDACT'
            ? `Show "${target.title}" again.`
            : it.kind === 'REDLINE'
              ? `Propose new wording for "${target.title}" as a tracked redline, for you to accept or reject.`
              : `Add a new clause "${it.title}" after "${target.title}". It will be reviewed as a change from the template.`;
      if (!body.apply)
        return { applied: false, understood: true, explanation: explain, intent: it.kind, model: B8_MODEL };
      let result: Record<string, unknown>;
      if (it.kind === 'REDACT' || it.kind === 'UNREDACT') {
        await tx
          .update(clause)
          .set({ redacted: it.kind === 'REDACT' })
          .where(eq(clause.id, target.id));
        result = { clauseId: target.clauseId, redacted: it.kind === 'REDACT' };
      } else if (it.kind === 'REDLINE') {
        const [r] = await tx
          .insert(legalRedline)
          .values({
            tenantId: a.user.tenantId,
            contractId: id,
            clauseId: target.clauseId,
            proposedText: it.text,
            source: 'INTERNAL',
            author: a.user.name,
            createdAt: now(),
          })
          .returning();
        result = { redlineId: r!.id, clauseId: target.clauseId };
      } else {
        const newId = insertedClauseId(
          it.title,
          rows.map((r) => r.clauseId),
        );
        await tx.insert(clause).values({
          tenantId: a.user.tenantId,
          contractId: id,
          clauseId: newId,
          title: it.title,
          text: it.text,
          mandatory: false,
          changedFromTemplate: true,
          risk: 'MEDIUM',
          afterClauseId: target.clauseId,
          editedBy: a.user.id,
          editedAt: now(),
        });
        result = { clauseId: newId, after: target.clauseId };
      }
      await d.audit.record(tx, a.ctx, {
        action: `contract.legal_${it.kind.toLowerCase()}`,
        entityType: 'contract',
        entityId: id,
        after: { instruction: body.instruction.slice(0, 200), ...result },
      });
      return {
        applied: true,
        understood: true,
        explanation: explain,
        intent: it.kind,
        ...result,
        model: B8_MODEL,
      };
    });
  });

  // ---------------------------------------------------------------- redlines and their decision
  const redlineRows = async (tx: Tx, id: string) =>
    tx
      .select()
      .from(legalRedline)
      .where(eq(legalRedline.contractId, id))
      .orderBy(desc(legalRedline.createdAt));
  const redlineView = (r: typeof legalRedline.$inferSelect, current: string) => ({
    id: r.id,
    clauseId: r.clauseId,
    currentText: current,
    proposedText: r.proposedText,
    source: r.source,
    author: r.author,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  });

  reg('GET', '/contracts/{id}/redlines');
  app.get(
    `${p}/contracts/:id/redlines`,
    { preHandler: guard(d, ['LEGAL', 'PROCUREMENT', 'DELEGATE', 'EXEC']) },
    async (req) => {
      const a = req.auth!;
      const id = cid(req);
      return withContext(d.database, a.ctx, async (tx) => {
        const c = await x.load(tx, a, id);
        const cl = new Map(
          (await tx.select().from(clause).where(eq(clause.contractId, id))).map((k) => [k.clauseId, k.text]),
        );
        const rows = await redlineRows(tx, id);
        return { editable: editable(c), redlines: rows.map((r) => redlineView(r, cl.get(r.clauseId) ?? '')) };
      });
    },
  );

  reg('POST', '/contracts/{id}/redlines/{redlineId}/decision');
  app.post(
    `${p}/contracts/:id/redlines/:redlineId/decision`,
    { preHandler: guard(d, ['LEGAL']) },
    async (req) => {
      const a = req.auth!;
      const { id, redlineId } = parse(z.object({ id: uuid, redlineId: uuid }), req.params);
      const body = parse(decisionBody, req.body);
      return withContext(d.database, a.ctx, async (tx) => {
        const c = await x.load(tx, a, id);
        const [r] = await tx
          .select()
          .from(legalRedline)
          .where(and(eq(legalRedline.id, redlineId), eq(legalRedline.contractId, id)));
        if (!r) throw new AppError(404, 'NOT_FOUND', 'Redline not found');
        if (r.status !== 'PROPOSED')
          throw new AppError(409, 'INVALID_STATE', 'That redline has already been decided');
        if (body.decision === 'ACCEPT') {
          if (!editable(c))
            throw new AppError(
              409,
              'INVALID_STATE',
              'The wording can only change before the contract is released for signature',
            );
          const [k] = await tx
            .select()
            .from(clause)
            .where(and(eq(clause.contractId, id), eq(clause.clauseId, r.clauseId)));
          if (!k) throw new AppError(404, 'NOT_FOUND', 'The clause no longer exists');
          await tx
            .update(clause)
            .set({ text: r.proposedText, changedFromTemplate: true, editedBy: a.user.id, editedAt: now() })
            .where(eq(clause.id, k.id));
        }
        await tx
          .update(legalRedline)
          .set({
            status: body.decision === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED',
            decidedBy: a.user.id,
            decidedAt: now(),
          })
          .where(eq(legalRedline.id, redlineId));
        await d.audit.record(tx, a.ctx, {
          action: `contract.redline_${body.decision.toLowerCase()}`,
          entityType: 'contract',
          entityId: id,
          after: { redlineId, clauseId: r.clauseId, source: r.source },
        });
        return { id: redlineId, status: body.decision === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED' };
      });
    },
  );

  // ---------------------------------------------------------------- portal link for outside counsel (FR-0830)
  reg('POST', '/contracts/{id}/counsel-links');
  app.post(`${p}/contracts/:id/counsel-links`, { preHandler: guard(d, ['LEGAL']) }, async (req, reply) => {
    const a = req.auth!;
    const id = cid(req);
    const body = parse(linkBody, req.body);
    const out = await withContext(d.database, a.ctx, async (tx) => {
      const c = await x.load(tx, a, id);
      if (!editable(c))
        throw new AppError(409, 'INVALID_STATE', 'A link can only be issued while the wording is still open');
      const token = randomBytes(24).toString('base64url');
      const expiresAt = new Date(now().getTime() + 14 * 86_400_000);
      const [row] = await tx
        .insert(counselLink)
        .values({
          tenantId: a.user.tenantId,
          contractId: id,
          tokenHash: hashToken(token),
          name: body.name,
          email: body.email,
          party: body.party,
          expiresAt,
          createdBy: a.user.id,
          createdAt: now(),
        })
        .returning();
      await d.audit.record(tx, a.ctx, {
        action: 'contract.counsel_link',
        entityType: 'contract',
        entityId: id,
        after: { party: body.party, email: body.email, expiresAt: expiresAt.toISOString() },
      });
      // the link is shown once, here; only its hash is kept
      return {
        id: row!.id,
        path: `/counsel/${token}`,
        expiresAt: expiresAt.toISOString(),
        name: body.name,
        party: body.party,
      };
    });
    return reply.status(201).send(out);
  });

  reg('GET', '/contracts/{id}/counsel-links');
  app.get(`${p}/contracts/:id/counsel-links`, { preHandler: guard(d, ['LEGAL']) }, async (req) => {
    const a = req.auth!;
    const id = cid(req);
    return withContext(d.database, a.ctx, async (tx) => {
      await x.load(tx, a, id);
      const rows = await tx
        .select()
        .from(counselLink)
        .where(eq(counselLink.contractId, id))
        .orderBy(desc(counselLink.createdAt));
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        party: r.party,
        expiresAt: r.expiresAt.toISOString(),
        active: !r.revokedAt && r.expiresAt > now(),
      }));
    });
  });

  reg('DELETE', '/contracts/{id}/counsel-links/{linkId}');
  app.delete(
    `${p}/contracts/:id/counsel-links/:linkId`,
    { preHandler: guard(d, ['LEGAL']) },
    async (req, reply) => {
      const a = req.auth!;
      const { id, linkId } = parse(z.object({ id: uuid, linkId: uuid }), req.params);
      await withContext(d.database, a.ctx, async (tx) => {
        await x.load(tx, a, id);
        await tx
          .update(counselLink)
          .set({ revokedAt: now() })
          .where(and(eq(counselLink.id, linkId), eq(counselLink.contractId, id)));
        await d.audit.record(tx, a.ctx, {
          action: 'contract.counsel_link_revoke',
          entityType: 'contract',
          entityId: id,
          after: { linkId },
        });
      });
      return reply.status(204).send();
    },
  );

  const publicLimit = { config: { rateLimit: { max: 60, timeWindow: '15 minutes' } } };
  const sys = (tenantId: string): RequestContext => ({ tenantId, userId: null, role: 'SYSTEM' });

  async function viaLink(token: string) {
    const [l] = await withSystem(d.database, (tx) =>
      tx
        .select()
        .from(counselLink)
        .where(eq(counselLink.tokenHash, hashToken(token))),
    );
    if (!l || l.revokedAt || l.expiresAt <= now())
      throw new AppError(404, 'NOT_FOUND', 'This link is not valid any more');
    return l;
  }

  reg('GET', '/counsel/{token}');
  app.get(`${p}/counsel/:token`, { preHandler: guard(d, 'public'), ...publicLimit }, async (req) => {
    const { token } = parse(z.object({ token: z.string().min(20).max(80) }), req.params);
    const l = await viaLink(token);
    return withSystem(d.database, async (tx) => {
      const [c] = await tx.select().from(contract).where(eq(contract.id, l.contractId));
      if (!c || c.deletedAt) throw new AppError(404, 'NOT_FOUND', 'This link is not valid any more');
      const rows = await ordered(tx, c);
      const mine = (
        await tx
          .select()
          .from(legalRedline)
          .where(and(eq(legalRedline.contractId, c.id), eq(legalRedline.author, `${l.name} <${l.email}>`)))
      ).sort((p1, p2) => p2.createdAt.getTime() - p1.createdAt.getTime());
      // the clause wording is what is under review; the contract's own value, pricing and bids are not sent
      return {
        name: l.name,
        party: l.party,
        contract: { number: c.number, title: c.title },
        open: editable(c),
        finalVersion: !editable(c),
        clauses: rows.map((k) => ({
          id: k.clauseId,
          title: k.title,
          text: k.redacted ? '[Redacted]' : k.text,
          redacted: k.redacted,
        })),
        yourRedlines: mine.map((r) => ({
          id: r.id,
          clauseId: r.clauseId,
          proposedText: r.proposedText,
          status: r.status,
          at: r.createdAt.toISOString(),
        })),
        expiresAt: l.expiresAt.toISOString(),
      };
    });
  });

  reg('POST', '/counsel/{token}/redlines');
  app.post(
    `${p}/counsel/:token/redlines`,
    { preHandler: guard(d, 'public'), ...publicLimit },
    async (req, reply) => {
      const { token } = parse(z.object({ token: z.string().min(20).max(80) }), req.params);
      const body = parse(counselRedline, req.body);
      const l = await viaLink(token);
      const out = await withSystem(d.database, async (tx) => {
        const [c] = await tx.select().from(contract).where(eq(contract.id, l.contractId));
        if (!c || c.deletedAt) throw new AppError(404, 'NOT_FOUND', 'This link is not valid any more');
        if (!editable(c))
          throw new AppError(
            423,
            'FINAL_VERSION',
            'This version is final and locked. No more changes can be proposed.',
          );
        const [k] = await tx
          .select()
          .from(clause)
          .where(and(eq(clause.contractId, c.id), eq(clause.clauseId, body.clauseId)));
        if (!k || k.redacted) throw new AppError(404, 'NOT_FOUND', 'No such clause');
        const [r] = await tx
          .insert(legalRedline)
          .values({
            tenantId: l.tenantId,
            contractId: c.id,
            clauseId: body.clauseId,
            proposedText: body.text,
            source: l.party === 'SUPPLIER' ? 'SUPPLIER' : 'EXTERNAL_COUNSEL',
            author: `${l.name} <${l.email}>`,
            createdAt: now(),
          })
          .returning();
        await d.audit.record(tx, sys(l.tenantId), {
          action: 'contract.counsel_redline',
          entityType: 'contract',
          entityId: c.id,
          after: { by: l.email, party: l.party, clauseId: body.clauseId },
        });
        return { id: r!.id, status: r!.status };
      });
      return reply.status(201).send(out);
    },
  );

  // ---------------------------------------------------------------- the customer's legal platform (FR-0390)
  const INTEG_ROLES = ['ADMIN', 'PROCUREMENT', 'LEGAL'] as const;
  reg('GET', '/integration-events');
  app.get(`${p}/integration-events`, { preHandler: guard(d, [...INTEG_ROLES]) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(integrationEvent)
        .where(eq(integrationEvent.tenantId, a.user.tenantId))
        .orderBy(desc(integrationEvent.createdAt))
        .limit(100);
      return rows.map(eventView);
    });
  });

  reg('POST', '/integration-events/retry');
  app.post(`${p}/integration-events/retry`, { preHandler: guard(d, [...INTEG_ROLES]) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const rows = await retryFailed(tx, integ, a.ctx, a.user.tenantId);
      return {
        retried: rows.length,
        delivered: rows.filter((r) => r.status === 'DELIVERED').length,
        events: rows.map(eventView),
      };
    });
  });

  reg('POST', '/integrations/legal/webhook');
  app.post(
    `${p}/integrations/legal/webhook`,
    { preHandler: guard(d, 'public'), ...publicLimit },
    async (req, reply) => {
      const body = parse(webhookBody, req.body);
      const given = String(req.headers['x-signature'] ?? '');
      const out = await withSystem(d.database, async (tx) => {
        const [m] = await tx.select().from(legalMatter).where(eq(legalMatter.externalRef, body.matterRef));
        // the same answer for "no such matter" and "bad signature", so the endpoint reveals nothing
        const deny = () => new AppError(401, 'UNAUTHORIZED', 'The message could not be verified');
        if (!m) throw deny();
        const s = await loadSettings(tx, m.tenantId);
        // the shared secret comes from the secret store; the old setting is the fallback (SEC-N03)
        const secret = await connectorSecret(tx, m.tenantId, 'LEGAL', s.legalPlatform.webhookSecret);
        if (!s.legalPlatform.enabled || !secret) throw deny();
        const want = sign(secret, body);
        const a1 = Buffer.from(want);
        const b1 = Buffer.from(given.padEnd(want.length, ' ').slice(0, want.length));
        if (given.length !== want.length || !timingSafeEqual(a1, b1)) throw deny();
        // a message seen before is acknowledged and ignored, so a retry from the other side does nothing twice (NFR-AV03)
        const key = `in:legal:${body.eventId}`;
        const [seen] = await tx
          .insert(integrationEvent)
          .values({
            tenantId: m.tenantId,
            kind: 'LEGAL_WEBHOOK',
            connectorKind: 'LEGAL',
            direction: 'IN',
            target: s.legalPlatform.name,
            idempotencyKey: key,
            payload: { matterRef: body.matterRef, stage: body.stage },
            status: 'DELIVERED',
            attempts: 1,
            createdAt: now(),
            deliveredAt: now(),
          })
          .onConflictDoNothing()
          .returning();
        if (!seen) return { duplicate: true };
        const lane = STAGE_LANE.find(([re]) => re.test(body.stage))?.[1] ?? m.lane;
        await tx
          .update(legalMatter)
          .set({ externalStage: body.stage, lane, updatedAt: now() })
          .where(eq(legalMatter.id, m.id));
        let redlines = 0;
        if (m.contractId)
          for (const r of body.redlines) {
            const [k] = await tx
              .select({ id: clause.id })
              .from(clause)
              .where(and(eq(clause.contractId, m.contractId), eq(clause.clauseId, r.clauseId)));
            if (!k) continue;
            await tx.insert(legalRedline).values({
              tenantId: m.tenantId,
              contractId: m.contractId,
              clauseId: r.clauseId,
              proposedText: r.text,
              source: 'LEGAL_PLATFORM',
              author: r.author || s.legalPlatform.name,
              createdAt: now(),
            });
            redlines += 1;
          }
        await d.audit.record(tx, sys(m.tenantId), {
          action: 'integration.legal_sync',
          entityType: 'legal_matter',
          entityId: m.id,
          after: { stage: body.stage, lane, redlines },
        });
        return { duplicate: false, matterId: m.id, lane, redlines };
      });
      return reply.status(200).send(out);
    },
  );

  // ---------------------------------------------------------------- contracts are never destroyed (NFR-L04)
  reg('GET', '/contracts/deleted');
  app.get(`${p}/contracts/deleted`, { preHandler: guard(d, ['LEGAL', 'EXEC', 'PROBITY']) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const rows = await tx
        .select({ c: contract, s: supplier.company })
        .from(contract)
        .innerJoin(supplier, eq(supplier.id, contract.supplierId))
        .where(and(eq(contract.tenantId, a.user.tenantId), isNotNull(contract.deletedAt)))
        .orderBy(desc(contract.deletedAt));
      const ids = rows.map((r) => r.c.id);
      const why = ids.length
        ? await tx
            .select()
            .from(auditEvent)
            .where(
              and(
                eq(auditEvent.tenantId, a.user.tenantId),
                eq(auditEvent.action, 'contract.delete'),
                inArray(auditEvent.entityId, ids),
              ),
            )
        : [];
      return rows.map((r) => ({
        id: r.c.id,
        number: r.c.number,
        title: r.c.title,
        supplier: r.s,
        status: r.c.status,
        value: Number(r.c.value),
        deletedAt: r.c.deletedAt!.toISOString(),
        reason: ((why.find((w) => w.entityId === r.c.id)?.after ?? {}) as { reason?: string }).reason ?? null,
      }));
    });
  });

  reg('POST', '/contracts/{id}/restore');
  app.post(`${p}/contracts/:id/restore`, { preHandler: guard(d, ['LEGAL', 'EXEC']) }, async (req) => {
    const a = req.auth!;
    const id = cid(req);
    const body = parse(restoreBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const [c] = await tx
        .select()
        .from(contract)
        .where(
          and(eq(contract.id, id), eq(contract.tenantId, a.user.tenantId), isNotNull(contract.deletedAt)),
        );
      if (!c) throw new AppError(404, 'NOT_FOUND', 'No deleted contract with that id');
      if (c.tenderId) {
        const [other] = await tx
          .select({ id: contract.id })
          .from(contract)
          .where(and(eq(contract.tenderId, c.tenderId), isNull(contract.deletedAt), ne(contract.id, id)));
        if (other)
          throw new AppError(
            409,
            'CONFLICT',
            'Another contract now stands for the same tender, so this one cannot be brought back',
          );
      }
      await tx
        .update(contract)
        .set({ deletedAt: null, updatedAt: now(), version: c.version + 1 })
        .where(eq(contract.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'contract.restore',
        entityType: 'contract',
        entityId: id,
        after: { number: c.number, reason: body.reason },
      });
      return { id, number: c.number, restored: true };
    });
  });
}
