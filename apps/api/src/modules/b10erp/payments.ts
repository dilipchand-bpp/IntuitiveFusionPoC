/**
 * Payment execution through a simulated finance system (FR-0875).
 *
 *   POST /invoices/{id}/payments        FINANCE proposes a payment for a MATCHED invoice (idempotent by key; partial allowed)
 *   POST /payments/{id}/approve         a different FINANCE or EXEC person approves (segregation of duties); the order is sent
 *   POST /payments/{id}/retry           send again after a failure, or try a waiting payment now
 *   POST /payments/{id}/cancel          a proposed or failed payment is cancelled
 *   POST /payments/settle               picks up payments whose order was delivered later (retry run, or done by hand)
 *   GET  /payments, GET /payments/{id}  the payments with their status trail
 *   POST /integrations/payments/confirmation   the finance system's signed confirmation callback (public, signed)
 *
 * The order goes through the PAYMENTS connector (b10conn): signed, retried on a backoff, dead-lettered after MAX_ATTEMPTS, and
 * while the connector is DOWN (or switched off) the payment WAITS as APPROVED with a manual task, so it is never lost and never
 * sent twice (each attempt has its own event key and the finance system receives the payment's idempotency key). The simulated
 * finance system answers with a signed confirmation, applied by the same code as the public callback; a payment created with
 * simulateFailure is declined on its first send, so a failure and a retry can be shown.
 *
 * SWAP POINT (docs/swap-points.md): the simulated finance system is `simulatedFinanceAnswer` plus the receiving side inside the
 * connector (b10conn/delivery.ts `simulatedReceive`). A real payment gateway or ERP accounts-payable API receives the order
 * (same payload, same idempotency key) and calls `/api/v1/integrations/payments/confirmation` with the connector secret.
 */
import { createHash } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { guard } from '../../auth/guard.js';
import { withContext, withSystem, type RequestContext, type Tx } from '../../db/client.js';
import {
  appUser,
  connector,
  contract,
  integrationEvent,
  invoice,
  manualTask,
  payment,
  paymentTrail,
  supplier,
  tenant,
} from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { deliver, retryFailed } from '../b8/integration.js';
import { getConnector, healthOf } from '../b10conn/connectors.js';
import { enqueueOutbound } from '../b10conn/delivery.js';
import { connectorSecret } from '../b10conn/secrets.js';
import { signedHeaders, verifyMessage } from '../b10conn/signing.js';
import type { B10bDeps } from './index.js';
import { ensureSimulatedSecret, iso, r2, sysCtx, tell } from './shared.js';

type PaymentRow = typeof payment.$inferSelect;
const OPEN = ['PROPOSED', 'APPROVED', 'SENT'] as const;
export const payRef = (id: string) => `PAY-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
const financeRefFor = (id: string, attempt: number) =>
  `FIN-${createHash('sha256').update(`${id}:${attempt}`).digest('hex').slice(0, 10).toUpperCase()}`;

async function trail(tx: Tx, d: B10bDeps, p: PaymentRow, status: string, actorId: string | null, note = '') {
  await tx
    .insert(paymentTrail)
    .values({ tenantId: p.tenantId, paymentId: p.id, at: d.clock.now(), status, actorId, note });
}

async function setStatus(tx: Tx, d: B10bDeps, p: PaymentRow, set: Partial<typeof payment.$inferInsert>) {
  const [row] = await tx
    .update(payment)
    .set({ ...set, updatedAt: d.clock.now() })
    .where(eq(payment.id, p.id))
    .returning();
  return row!;
}

/** What is still unpaid on an invoice after confirmed payments and payments in flight. */
export async function invoiceRemaining(tx: Tx, inv: typeof invoice.$inferSelect) {
  const open = await tx
    .select({ a: sql<string>`coalesce(sum(${payment.amount}), 0)` })
    .from(payment)
    .where(and(eq(payment.invoiceId, inv.id), inArray(payment.status, [...OPEN])));
  const inFlight = Number(open[0]?.a ?? 0);
  const paid = Number(inv.paidAmount);
  return { paid, inFlight: r2(inFlight), remaining: r2(Number(inv.amount) - paid - inFlight) };
}

// ---------------------------------------------------------------- the finance system's answer
function simulatedFinanceAnswer(p: PaymentRow): { outcome: 'CONFIRMED' | 'FAILED'; reason?: string } {
  if (p.simulateFailure)
    return {
      outcome: 'FAILED',
      reason: 'The simulated finance system declined the payment (simulated failure)',
    };
  return { outcome: 'CONFIRMED' };
}

async function applyConfirmation(
  tx: Tx,
  d: B10bDeps,
  ctx: RequestContext,
  p: PaymentRow,
  outcome: 'CONFIRMED' | 'FAILED',
  financeRef: string,
  reason?: string,
): Promise<PaymentRow> {
  const at = d.clock.now();
  if (outcome === 'CONFIRMED') {
    const row = await setStatus(tx, d, p, {
      status: 'CONFIRMED',
      confirmedAt: at,
      financeRef,
      failureReason: null,
    });
    const [inv] = await tx.select().from(invoice).where(eq(invoice.id, p.invoiceId));
    if (inv) {
      const paid = r2(Number(inv.paidAmount) + Number(p.amount));
      const full = paid >= Number(inv.amount) - 0.004;
      await tx
        .update(invoice)
        .set({ paidAmount: paid.toFixed(2), paidOn: iso(at), ...(full ? { status: 'PAID' as const } : {}) })
        .where(eq(invoice.id, inv.id));
    }
    await trail(tx, d, row, 'CONFIRMED', null, `Confirmed by the finance system, reference ${financeRef}`);
    await d.audit.record(tx, ctx, {
      action: 'payment.confirmed',
      entityType: 'payment',
      entityId: p.id,
      after: { amount: Number(p.amount), financeRef, invoice: p.invoiceId },
    });
    await tell(
      tx,
      p.tenantId,
      p.createdBy,
      `Payment ${payRef(p.id)} confirmed`,
      `The finance system confirmed ${Number(p.amount).toLocaleString('en-AU')} (${financeRef}).`,
      '/app/contracts/invoices',
      'PAYMENT',
    );
    return row;
  }
  const row = await setStatus(tx, d, p, {
    status: 'FAILED',
    failureReason: reason ?? 'Declined',
    financeRef,
  });
  await trail(tx, d, row, 'FAILED', null, reason ?? 'Declined by the finance system');
  await d.audit.record(tx, ctx, {
    action: 'payment.failed',
    entityType: 'payment',
    entityId: p.id,
    result: 'FAILED',
    after: { reason: reason ?? 'Declined', financeRef },
  });
  await tell(
    tx,
    p.tenantId,
    p.createdBy,
    `Payment ${payRef(p.id)} failed`,
    `${reason ?? 'The finance system declined it'}. Open Invoices to retry.`,
    '/app/contracts/invoices',
    'PAYMENT',
  );
  return row;
}

export interface ConfirmResult {
  httpStatus: 200 | 202 | 401 | 409;
  body: Record<string, unknown>;
}
const confirmBody = z
  .object({
    eventId: z.string().min(6).max(100),
    type: z.enum(['PAYMENT_CONFIRMED', 'PAYMENT_FAILED']),
    data: z
      .object({
        paymentId: z.string().uuid(),
        financeRef: z.string().min(3).max(60),
        reason: z.string().max(300).optional(),
      })
      .strict(),
  })
  .strict();

/** The finance system's callback: verified, applied once per event id. Used by the public endpoint and by the simulation. */
export async function receivePaymentConfirmation(
  tx: Tx,
  d: B10bDeps,
  input: { tenantSlug: string; body: unknown; signature: string | undefined; timestamp: string | undefined },
): Promise<ConfirmResult> {
  const denied: ConfirmResult = {
    httpStatus: 401,
    body: { code: 'UNAUTHORIZED', message: 'The message could not be verified' },
  };
  const [t] = await tx.select({ id: tenant.id }).from(tenant).where(eq(tenant.slug, input.tenantSlug));
  const c = t ? await getConnector(tx, t.id, 'PAYMENTS') : undefined;
  if (!t || !c || !c.enabled) return denied;
  const secret = await connectorSecret(tx, t.id, 'PAYMENTS');
  const v = verifyMessage({
    secret,
    signature: input.signature,
    timestamp: input.timestamp,
    body: input.body,
    clock: d.clock,
  });
  if (!v.ok) {
    await tx
      .update(connector)
      .set({
        rejectedCount: c.rejectedCount + 1,
        lastRejectedAt: d.clock.now(),
        lastRejectedReason: v.reason,
      })
      .where(eq(connector.id, c.id));
    await d.audit.record(tx, sysCtx(t.id), {
      action: 'integration.webhook_rejected',
      entityType: 'connector',
      entityId: c.id,
      result: 'FAILED',
      after: { kind: 'PAYMENTS', reason: v.reason },
    });
    return denied;
  }
  const parsed = confirmBody.safeParse(input.body);
  if (!parsed.success)
    return {
      httpStatus: 202,
      body: { accepted: false, error: `The message is not valid: ${parsed.error.issues[0]?.message ?? ''}` },
    };
  const m = parsed.data;
  const key = `in:payments:${m.eventId}`;
  const [seen] = await tx
    .select()
    .from(integrationEvent)
    .where(and(eq(integrationEvent.tenantId, t.id), eq(integrationEvent.idempotencyKey, key)));
  if (seen) return { httpStatus: 200, body: { accepted: true, duplicate: true, eventId: m.eventId } };
  const [p] = await tx
    .select()
    .from(payment)
    .where(and(eq(payment.id, m.data.paymentId), eq(payment.tenantId, t.id)));
  if (!p) return { httpStatus: 202, body: { accepted: false, eventId: m.eventId, error: 'No such payment' } };
  if (p.status !== 'SENT')
    return {
      httpStatus: 409,
      body: {
        code: 'INVALID_STATE',
        message: `The payment is ${p.status}; only a payment that was sent can be confirmed or failed`,
      },
    };
  await tx.insert(integrationEvent).values({
    tenantId: t.id,
    kind: m.type,
    connectorKind: 'PAYMENTS',
    direction: 'IN',
    target: c.provider,
    idempotencyKey: key,
    payload: { type: m.type, data: m.data },
    status: 'DELIVERED',
    attempts: 1,
    createdAt: d.clock.now(),
    deliveredAt: d.clock.now(),
  });
  const row = await applyConfirmation(
    tx,
    d,
    sysCtx(t.id),
    p,
    m.type === 'PAYMENT_CONFIRMED' ? 'CONFIRMED' : 'FAILED',
    m.data.financeRef,
    m.data.reason,
  );
  return {
    httpStatus: 200,
    body: { accepted: true, duplicate: false, eventId: m.eventId, status: row.status },
  };
}

/** The simulated finance system receiving the order and calling back, signed, through the same receiver as an outside caller. */
async function simulateCallback(
  tx: Tx,
  d: B10bDeps,
  ctx: RequestContext,
  p: PaymentRow,
): Promise<PaymentRow> {
  const answer = simulatedFinanceAnswer(p);
  const secret = await ensureSimulatedSecret(tx, d, ctx, 'PAYMENTS');
  const body = {
    eventId: `PAYCONF-${p.id}-${p.attempts}`,
    type: answer.outcome === 'CONFIRMED' ? 'PAYMENT_CONFIRMED' : 'PAYMENT_FAILED',
    data: {
      paymentId: p.id,
      financeRef: p.financeRef ?? financeRefFor(p.id, p.attempts),
      ...(answer.reason ? { reason: answer.reason } : {}),
    },
  };
  const h = signedHeaders(secret, d.clock, body);
  const [tn] = await tx.select({ slug: tenant.slug }).from(tenant).where(eq(tenant.id, p.tenantId));
  await receivePaymentConfirmation(tx, d, {
    tenantSlug: tn!.slug,
    body,
    signature: h['X-IF-Signature'],
    timestamp: h['X-IF-Timestamp'],
  });
  // a failure that was asked for is used up, so the retry succeeds
  if (answer.outcome === 'FAILED')
    await tx.update(payment).set({ simulateFailure: false }).where(eq(payment.id, p.id));
  const [row] = await tx.select().from(payment).where(eq(payment.id, p.id));
  return row!;
}

/** Sends the approved payment's order through the connector. If the system cannot be reached it waits, with a manual task. */
export async function sendPayment(
  tx: Tx,
  d: B10bDeps,
  ctx: RequestContext,
  p0: PaymentRow,
): Promise<PaymentRow> {
  const [inv] = await tx.select().from(invoice).where(eq(invoice.id, p0.invoiceId));
  const [k] = inv ? await tx.select().from(contract).where(eq(contract.id, inv.contractId)) : [];
  const [s] = k ? await tx.select().from(supplier).where(eq(supplier.id, k.supplierId)) : [];
  const c = await getConnector(tx, ctx.tenantId, 'PAYMENTS');
  if (c?.enabled) await ensureSimulatedSecret(tx, d, ctx, 'PAYMENTS');
  const attempt = p0.attempts + 1;
  const p = await setStatus(tx, d, p0, { attempts: attempt });
  const r = await enqueueOutbound(tx, d, ctx, {
    kind: 'PAYMENTS',
    eventKind: 'PAYMENT_ORDER',
    key: `payment:${p.id}:${attempt}`,
    payload: {
      ref: payRef(p.id),
      paymentId: p.id,
      idempotencyKey: p.idempotencyKey,
      invoiceNumber: inv?.number ?? '',
      contractNumber: k?.number ?? '',
      payee: s?.company ?? '',
      amount: Number(p.amount),
      currency: p.currency,
    },
  });
  const ev = r.created ? await deliver(tx, d, ctx, r.event) : r.event;
  let row = await setStatus(tx, d, p, { eventId: ev.id });
  if (ev.status === 'DELIVERED') return afterDelivery(tx, d, ctx, row, ev);
  await trail(
    tx,
    d,
    row,
    'APPROVED',
    ctx.userId,
    `Waiting: the finance system did not take the order (${ev.lastError ?? 'not reachable'}). A manual task was queued; it is sent again by the retry run or when you retry.`,
  );
  row = (await tx.select().from(payment).where(eq(payment.id, p.id)))[0]!;
  return row;
}

async function afterDelivery(
  tx: Tx,
  d: B10bDeps,
  ctx: RequestContext,
  p: PaymentRow,
  ev: typeof integrationEvent.$inferSelect,
): Promise<PaymentRow> {
  const manual = (ev.payload as { handledBy?: string }).handledBy === 'MANUAL';
  if (manual) {
    const ref = String(
      (ev.payload as { externalRef?: string }).externalRef ?? financeRefFor(p.id, p.attempts),
    );
    const sent = await setStatus(tx, d, p, { status: 'SENT', sentAt: d.clock.now(), financeRef: ref });
    await trail(tx, d, sent, 'SENT', ctx.userId, `Paid by hand in the finance system, reference ${ref}`);
    return applyConfirmation(tx, d, ctx, sent, 'CONFIRMED', ref);
  }
  const sent = await setStatus(tx, d, p, {
    status: 'SENT',
    sentAt: d.clock.now(),
    financeRef: financeRefFor(p.id, p.attempts),
  });
  await trail(
    tx,
    d,
    sent,
    'SENT',
    ctx.userId,
    `Order delivered to the finance system (attempt ${p.attempts})`,
  );
  return simulateCallback(tx, d, ctx, sent);
}

/** Payments approved but not yet sent whose order has since been delivered (retry run) or done by hand (manual task). */
export async function settlePayments(tx: Tx, d: B10bDeps, ctx: RequestContext) {
  const waiting = await tx
    .select()
    .from(payment)
    .where(and(eq(payment.tenantId, ctx.tenantId), eq(payment.status, 'APPROVED')));
  let settled = 0;
  for (const p of waiting) {
    if (!p.eventId) continue;
    const [ev] = await tx.select().from(integrationEvent).where(eq(integrationEvent.id, p.eventId));
    if (ev?.status === 'DELIVERED') {
      await afterDelivery(tx, d, ctx, p, ev);
      settled += 1;
    }
  }
  return { settled };
}

// ---------------------------------------------------------------- views
async function view(tx: Tx, p: PaymentRow, withTrail = true) {
  const [inv] = await tx.select().from(invoice).where(eq(invoice.id, p.invoiceId));
  const [k] = inv
    ? await tx.select({ n: contract.number }).from(contract).where(eq(contract.id, inv.contractId))
    : [];
  const ids = [p.createdBy, ...(p.approvedBy ? [p.approvedBy] : [])];
  const people = await tx
    .select({ id: appUser.id, name: appUser.name })
    .from(appUser)
    .where(inArray(appUser.id, ids));
  const nm = (id: string | null) => people.find((x) => x.id === id)?.name ?? null;
  let waiting: { reason: string | null; manualTaskId: string | null; eventStatus: string } | null = null;
  if (p.status === 'APPROVED' && p.eventId) {
    const [ev] = await tx.select().from(integrationEvent).where(eq(integrationEvent.id, p.eventId));
    const [mt] = ev
      ? await tx
          .select()
          .from(manualTask)
          .where(and(eq(manualTask.eventId, ev.id), eq(manualTask.status, 'OPEN')))
      : [];
    if (ev && ev.status !== 'DELIVERED')
      waiting = { reason: ev.lastError, manualTaskId: mt?.id ?? null, eventStatus: ev.status };
  }
  const tr = withTrail
    ? await tx.select().from(paymentTrail).where(eq(paymentTrail.paymentId, p.id)).orderBy(paymentTrail.at)
    : [];
  const actors = tr.length
    ? await tx
        .select({ id: appUser.id, name: appUser.name })
        .from(appUser)
        .where(
          inArray(
            appUser.id,
            tr.map((x) => x.actorId ?? p.createdBy),
          ),
        )
    : [];
  return {
    id: p.id,
    ref: payRef(p.id),
    invoiceId: p.invoiceId,
    invoiceNumber: inv?.number ?? null,
    contractNumber: k?.n ?? null,
    amount: Number(p.amount),
    currency: p.currency,
    status: p.status,
    financeRef: p.financeRef,
    createdBy: nm(p.createdBy),
    createdById: p.createdBy,
    approvedBy: nm(p.approvedBy),
    approvedAt: p.approvedAt?.toISOString() ?? null,
    sentAt: p.sentAt?.toISOString() ?? null,
    confirmedAt: p.confirmedAt?.toISOString() ?? null,
    failureReason: p.failureReason,
    attempts: p.attempts,
    simulateFailure: p.simulateFailure,
    idempotencyKey: p.idempotencyKey,
    waiting,
    createdAt: p.createdAt.toISOString(),
    trail: tr.map((x) => ({
      at: x.at.toISOString(),
      status: x.status,
      by: x.actorId ? (actors.find((a) => a.id === x.actorId)?.name ?? null) : 'Finance system',
      note: x.note,
    })),
    simulated: true as const,
  };
}

// ---------------------------------------------------------------- routes
const READ = ['FINANCE', 'EXEC', 'PROCUREMENT', 'CONTRACT_MGR'] as const;
const APPROVERS = ['FINANCE', 'EXEC'] as const;
const createBody = z
  .object({
    amount: z.number().positive().max(1_000_000_000).optional(),
    idempotencyKey: z.string().trim().min(8).max(100).optional(),
    simulateFailure: z.boolean().optional(),
  })
  .strict();
const uuid = z.string().uuid();

export function registerPayments(app: FastifyInstance, p: string, d: B10bDeps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);
  const load = async (tx: Tx, tenantId: string, id: string) => {
    const [row] = await tx
      .select()
      .from(payment)
      .where(and(eq(payment.id, id), eq(payment.tenantId, tenantId)));
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Payment not found');
    return row;
  };

  reg('POST', '/invoices/{id}/payments');
  app.post(`${p}/invoices/:id/payments`, { preHandler: guard(d, ['FINANCE']) }, async (req, reply) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    const body = parse(createBody, req.body ?? {});
    const out = await withContext(d.database, a.ctx, async (tx) => {
      const [inv] = await tx
        .select()
        .from(invoice)
        .where(and(eq(invoice.id, id), eq(invoice.tenantId, a.user.tenantId)));
      if (!inv) throw new AppError(404, 'NOT_FOUND', 'Invoice not found');
      if (body.idempotencyKey) {
        const [again] = await tx
          .select()
          .from(payment)
          .where(and(eq(payment.tenantId, a.user.tenantId), eq(payment.idempotencyKey, body.idempotencyKey)));
        if (again) return { created: false, view: await view(tx, again) };
      }
      if (!body.idempotencyKey) {
        // without a key, a double click is the same payment: an open proposal of mine for the same amount is returned
        const mine = await tx
          .select()
          .from(payment)
          .where(
            and(
              eq(payment.invoiceId, inv.id),
              eq(payment.status, 'PROPOSED'),
              eq(payment.createdBy, a.user.id),
            ),
          );
        const same = mine.find(
          (x) => body.amount === undefined || Math.abs(Number(x.amount) - body.amount) < 0.004,
        );
        if (same) return { created: false, view: await view(tx, same) };
      }
      if (inv.status !== 'MATCHED')
        throw new AppError(
          409,
          'INVOICE_NOT_PAYABLE',
          inv.status === 'PAID'
            ? 'This invoice is already paid'
            : inv.status === 'BLOCKED'
              ? 'A blocked invoice cannot be paid: the three-way match has not passed'
              : 'Only an invoice that passed the three-way match (matched) can be paid through the payment run',
        );
      const rem = await invoiceRemaining(tx, inv);
      const amount = r2(body.amount ?? rem.remaining);
      if (amount <= 0 || amount > rem.remaining + 0.004)
        throw new AppError(
          409,
          'PAYMENT_EXCEEDS_INVOICE',
          rem.remaining <= 0
            ? 'There is nothing left to pay on this invoice (paid or payments already in progress)'
            : `The amount ${amount.toFixed(2)} is more than the ${rem.remaining.toFixed(2)} still unpaid on this invoice`,
        );
      const key =
        body.idempotencyKey ??
        `inv:${inv.id}:${amount.toFixed(2)}:${rem.paid.toFixed(2)}:${rem.inFlight.toFixed(2)}`;
      const [dupe] = await tx
        .select()
        .from(payment)
        .where(and(eq(payment.tenantId, a.user.tenantId), eq(payment.idempotencyKey, key)));
      if (dupe) return { created: false, view: await view(tx, dupe) };
      const at = d.clock.now();
      const [row] = await tx
        .insert(payment)
        .values({
          tenantId: a.user.tenantId,
          invoiceId: inv.id,
          amount: amount.toFixed(2),
          idempotencyKey: key,
          createdBy: a.user.id,
          simulateFailure: body.simulateFailure ?? false,
          createdAt: at,
          updatedAt: at,
        })
        .returning();
      await trail(
        tx,
        d,
        row!,
        'PROPOSED',
        a.user.id,
        `Proposed ${amount.toFixed(2)} of ${Number(inv.amount).toFixed(2)}${amount < rem.remaining ? ' (part payment)' : ''}`,
      );
      await d.audit.record(tx, a.ctx, {
        action: 'payment.propose',
        entityType: 'payment',
        entityId: row!.id,
        after: { invoice: inv.number, amount, partial: amount < Number(inv.amount) - rem.paid - 0.004 },
      });
      return { created: true, view: await view(tx, row!) };
    });
    return reply.status(out.created ? 201 : 200).send({ ...out.view, duplicate: !out.created });
  });

  reg('POST', '/payments/{id}/approve');
  app.post(`${p}/payments/:id/approve`, { preHandler: guard(d, [...APPROVERS]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    return withContext(d.database, a.ctx, async (tx) => {
      const pay = await load(tx, a.user.tenantId, id);
      if (pay.createdBy === a.user.id)
        throw new AppError(
          403,
          'ROLE_SOD_VIOLATION',
          'You proposed this payment, so a different person must approve it',
        );
      if (pay.status !== 'PROPOSED')
        throw new AppError(
          409,
          'INVALID_STATE',
          `This payment is ${pay.status.toLowerCase()}; only a proposed payment can be approved`,
        );
      const [inv] = await tx.select().from(invoice).where(eq(invoice.id, pay.invoiceId));
      if (!inv || inv.status !== 'MATCHED')
        throw new AppError(
          409,
          'INVOICE_NOT_PAYABLE',
          'The invoice is no longer matched, so the payment cannot go ahead',
        );
      const approved = await setStatus(tx, d, pay, {
        status: 'APPROVED',
        approvedBy: a.user.id,
        approvedAt: d.clock.now(),
      });
      await trail(tx, d, approved, 'APPROVED', a.user.id, 'Approved by a second person');
      await d.audit.record(tx, a.ctx, {
        action: 'payment.approve',
        entityType: 'payment',
        entityId: id,
        before: { status: 'PROPOSED' },
        after: { status: 'APPROVED', amount: Number(pay.amount), proposedBy: pay.createdBy },
      });
      return view(tx, await sendPayment(tx, d, a.ctx, approved));
    });
  });

  reg('POST', '/payments/{id}/retry');
  app.post(`${p}/payments/:id/retry`, { preHandler: guard(d, [...APPROVERS]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    return withContext(d.database, a.ctx, async (tx) => {
      const pay = await load(tx, a.user.tenantId, id);
      if (pay.status === 'FAILED') {
        const [inv] = await tx.select().from(invoice).where(eq(invoice.id, pay.invoiceId));
        if (!inv || inv.status !== 'MATCHED')
          throw new AppError(
            409,
            'INVOICE_NOT_PAYABLE',
            'The invoice is no longer matched, so the payment cannot be retried',
          );
        const again = await setStatus(tx, d, pay, { status: 'APPROVED', failureReason: null });
        await trail(tx, d, again, 'APPROVED', a.user.id, 'Retried after a failure');
        await d.audit.record(tx, a.ctx, {
          action: 'payment.retry',
          entityType: 'payment',
          entityId: id,
          after: { attempt: pay.attempts + 1 },
        });
        return view(tx, await sendPayment(tx, d, a.ctx, again));
      }
      if (pay.status === 'APPROVED' && pay.eventId) {
        const [ev] = await tx.select().from(integrationEvent).where(eq(integrationEvent.id, pay.eventId));
        if (ev && ev.status !== 'DELIVERED') await retryFailed(tx, d, a.ctx, a.user.tenantId, ev.id);
        await settlePayments(tx, d, a.ctx);
        await d.audit.record(tx, a.ctx, {
          action: 'payment.retry',
          entityType: 'payment',
          entityId: id,
          after: { waiting: true },
        });
        return view(tx, await load(tx, a.user.tenantId, id));
      }
      throw new AppError(409, 'INVALID_STATE', `A ${pay.status.toLowerCase()} payment cannot be retried`);
    });
  });

  reg('POST', '/payments/{id}/cancel');
  app.post(`${p}/payments/:id/cancel`, { preHandler: guard(d, [...APPROVERS]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    return withContext(d.database, a.ctx, async (tx) => {
      const pay = await load(tx, a.user.tenantId, id);
      if (pay.status !== 'PROPOSED' && pay.status !== 'FAILED')
        throw new AppError(409, 'INVALID_STATE', `A ${pay.status.toLowerCase()} payment cannot be cancelled`);
      const row = await setStatus(tx, d, pay, { status: 'CANCELLED' });
      await trail(tx, d, row, 'CANCELLED', a.user.id, 'Cancelled');
      await d.audit.record(tx, a.ctx, {
        action: 'payment.cancel',
        entityType: 'payment',
        entityId: id,
        before: { status: pay.status },
        after: { status: 'CANCELLED' },
      });
      return view(tx, row);
    });
  });

  reg('POST', '/payments/settle');
  app.post(`${p}/payments/settle`, { preHandler: guard(d, [...APPROVERS]) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, (tx) => settlePayments(tx, d, a.ctx));
  });

  reg('GET', '/payments');
  app.get(`${p}/payments`, { preHandler: guard(d, [...READ]) }, async (req) => {
    const a = req.auth!;
    const q = parse(z.object({ invoiceId: uuid.optional() }), req.query);
    return withContext(d.database, a.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(payment)
        .where(
          and(
            eq(payment.tenantId, a.user.tenantId),
            ...(q.invoiceId ? [eq(payment.invoiceId, q.invoiceId)] : []),
          ),
        )
        .orderBy(desc(payment.createdAt))
        .limit(200);
      const conn = await getConnector(tx, a.user.tenantId, 'PAYMENTS');
      return {
        simulated: true,
        connector: conn
          ? { provider: conn.provider, enabled: conn.enabled, mode: conn.mode, health: healthOf(conn) }
          : null,
        payments: await Promise.all(rows.map((r) => view(tx, r))),
      };
    });
  });

  reg('GET', '/payments/{id}');
  app.get(`${p}/payments/:id`, { preHandler: guard(d, [...READ]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    return withContext(d.database, a.ctx, async (tx) => view(tx, await load(tx, a.user.tenantId, id)));
  });

  reg('POST', '/integrations/payments/confirmation');
  app.post(
    `${p}/integrations/payments/confirmation`,
    { preHandler: guard(d, 'public'), config: { rateLimit: { max: 300, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const h = (n: string) => {
        const v = req.headers[n];
        return Array.isArray(v) ? v[0] : v;
      };
      const r = await withSystem(d.database, (tx) =>
        receivePaymentConfirmation(tx, d, {
          tenantSlug: h('x-if-tenant') ?? d.defaultTenantSlug,
          body: req.body,
          signature: h('x-if-signature'),
          timestamp: h('x-if-timestamp'),
        }),
      );
      if (r.httpStatus === 401) throw new AppError(401, 'UNAUTHORIZED', 'The message could not be verified');
      if (r.httpStatus === 409) throw new AppError(409, 'INVALID_STATE', String(r.body.message));
      return reply.status(r.httpStatus).send(r.body);
    },
  );

  return done;
}
