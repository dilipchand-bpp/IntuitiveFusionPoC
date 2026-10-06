import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import * as s from '../../db/schema.js';
import { TENANT_ID } from '../../db/seed.js';
import { createEnv, type Json } from '../contract/test-env.js';
import { readSecret } from '../b10conn/secrets.js';
import { signMessage } from '../b10conn/signing.js';

let env: Awaited<ReturnType<typeof createEnv>>;
const call = (...a: Parameters<typeof env.call>) => env.call(...a);
const sys = <T>(fn: Parameters<typeof env.withSystem>[1]) => env.withSystem(env.database, fn) as Promise<T>;
let contractId = '';
let poId = '';
beforeAll(async () => {
  env = await createEnv();
  const { id } = await env.executed();
  contractId = id;
  const rates = await call('contract-mgr', 'PUT', `/contracts/${id}/rates`, {
    rates: [{ item: 'Cleaning hour', unit: 'hour', unitPrice: 50 }],
  });
  expect(rates.statusCode, rates.body).toBe(200);
  const po = await call('finance', 'POST', `/contracts/${id}/purchase-orders`, {
    description: 'Supply of services',
    lines: [{ item: 'Cleaning hour', qty: 1000, unitPrice: 50 }],
  });
  expect(po.statusCode, po.body).toBe(201);
  poId = po.json().id as string;
  const on = await call('admin', 'PUT', '/connectors/PAYMENTS', { enabled: true });
  expect(on.statusCode, on.body).toBe(200);
}, 120_000);

let day = 0;
/** A matched invoice for `qty` hours at 50. */
const invoice = async (qty = 40, unitPrice = 50) => {
  day += 1;
  const r = await call('finance', 'POST', `/contracts/${contractId}/invoices`, {
    invoiceDate: `2026-11-${String(day).padStart(2, '0')}`,
    poId,
    lines: [{ item: 'Cleaning hour', qty, unitPrice }],
  });
  expect(r.statusCode, r.body).toBe(201);
  return r.json().invoice as Json;
};
const propose = (id: string, body: Json = {}, who = 'finance') =>
  call(who, 'POST', `/invoices/${id}/payments`, body);
const approve = (id: string, who = 'exec') => call(who, 'POST', `/payments/${id}/approve`);
const inv = async (id: string) =>
  ((await call('finance', 'GET', '/invoices')).json() as Json[]).find((i) => i.id === id)!;

describe('FR-0875 payment execution through a simulated finance system', () => {
  it('finance proposes, a different person approves, the order is sent and confirmed, and the invoice becomes paid', async () => {
    const i = await invoice();
    expect(i.status).toBe('MATCHED');
    const p = await propose(i.id);
    expect(p.statusCode, p.body).toBe(201);
    expect(p.json()).toMatchObject({
      status: 'PROPOSED',
      amount: 2000,
      createdBy: 'Aisha Rahman',
      simulated: true,
    });
    expect((await inv(i.id)).status).toBe('MATCHED'); // nothing is paid until the finance system confirms
    const a = await approve(p.json().id);
    expect(a.statusCode, a.body).toBe(200);
    expect(a.json()).toMatchObject({ status: 'CONFIRMED', approvedBy: 'Elena Petrova', attempts: 1 });
    expect(a.json().financeRef).toMatch(/^FIN-[0-9A-F]{10}$/);
    expect(a.json().trail.map((t: Json) => t.status)).toEqual(['PROPOSED', 'APPROVED', 'SENT', 'CONFIRMED']);
    expect(await inv(i.id)).toMatchObject({ status: 'PAID', paidAmount: 2000 });
    // the spend and ceiling figures stay right: paid counts, invoiced is unchanged
    const spend = (await call('finance', 'GET', `/contracts/${contractId}/spend`)).json() as Json;
    expect(spend.paid).toBeGreaterThanOrEqual(2000);
    // cannot pay twice
    const again = await propose(i.id, { idempotencyKey: 'a-different-key-1' });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('INVOICE_NOT_PAYABLE');
    expect((await approve(p.json().id)).statusCode).toBe(409);
    const actions = (
      await sys<Json[]>((tx) => tx.select().from(s.auditEvent).where(eq(s.auditEvent.entityId, p.json().id)))
    ).map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining(['payment.propose', 'payment.approve', 'payment.confirmed']),
    );
  });

  it('only finance proposes, and the person who proposed cannot approve (segregation of duties)', async () => {
    const i = await invoice();
    for (const who of ['exec', 'procurement', 'requester', 'contract-mgr'])
      expect((await propose(i.id, {}, who)).statusCode, who).toBe(403);
    const p = (await propose(i.id)).json();
    const self = await approve(p.id, 'finance');
    expect(self.statusCode).toBe(403);
    expect(self.json().code).toBe('ROLE_SOD_VIOLATION');
    for (const who of ['procurement', 'legal', 'requester'])
      expect((await approve(p.id, who)).statusCode, who).toBe(403);
    expect((await call('finance', 'GET', `/payments/${p.id}`)).json().status).toBe('PROPOSED');
    // a second finance person may approve
    const other = await env.extraUser('finance2', 'FINANCE');
    expect((await approve(p.id, other.email)).json().status).toBe('CONFIRMED');
  });

  it('repeating a request with the same idempotency key returns the same payment and creates nothing', async () => {
    const i = await invoice();
    const a = await propose(i.id, { idempotencyKey: 'click-once-12345' });
    const b = await propose(i.id, { idempotencyKey: 'click-once-12345' });
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(200);
    expect(b.json()).toMatchObject({ id: a.json().id, duplicate: true });
    // without a key a double click is the same payment too
    const j = await invoice();
    const c = await propose(j.id);
    const d = await propose(j.id);
    expect(d.json().id).toBe(c.json().id);
    expect(
      await sys<Json[]>((tx) => tx.select().from(s.payment).where(eq(s.payment.invoiceId, j.id))),
    ).toHaveLength(1);
  });

  it('cannot pay an invoice that is blocked or released as an exception; the payment run refuses it', async () => {
    const bad = await invoice(40, 55);
    expect(bad.status).toBe('BLOCKED');
    const r = await propose(bad.id);
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('INVOICE_NOT_PAYABLE');
    expect(r.body).toMatch(/blocked/);
    await call('finance', 'POST', `/invoices/${bad.id}/override`, {
      reason: 'Agreed with the supplier today',
    });
    expect((await inv(bad.id)).status).toBe('EXCEPTION');
    expect((await propose(bad.id)).json().code).toBe('INVOICE_NOT_PAYABLE');
  });

  it('part payments are tracked: what is left is what can still be paid, and the invoice is paid when the last part is confirmed', async () => {
    const i = await invoice();
    const first = await propose(i.id, { amount: 600 });
    expect(first.json()).toMatchObject({ amount: 600 });
    expect((await approve(first.json().id)).json().status).toBe('CONFIRMED');
    expect(await inv(i.id)).toMatchObject({ status: 'MATCHED', paidAmount: 600 });
    const tooMuch = await propose(i.id, { amount: 1500 });
    expect(tooMuch.statusCode).toBe(409);
    expect(tooMuch.json().code).toBe('PAYMENT_EXCEEDS_INVOICE');
    expect(tooMuch.body).toMatch(/1400\.00 still unpaid/);
    // a part payment in flight also counts against what is left
    const second = await propose(i.id, { amount: 1000 });
    expect((await propose(i.id, { amount: 500 })).statusCode).toBe(409);
    expect((await approve(second.json().id)).json().status).toBe('CONFIRMED');
    const rest = await propose(i.id); // the default is what is left
    expect(rest.json().amount).toBe(400);
    await approve(rest.json().id);
    expect(await inv(i.id)).toMatchObject({ status: 'PAID', paidAmount: 2000 });
  });

  it('a payment in the run stops the old "record payment" shortcut from paying the same invoice a second time', async () => {
    const i = await invoice();
    await propose(i.id);
    const direct = await call('finance', 'POST', `/invoices/${i.id}/pay`);
    expect(direct.statusCode).toBe(409);
    expect(direct.json().code).toBe('PAYMENT_IN_PROGRESS');
  });

  it('a payment the finance system declines is FAILED, the invoice stays unpaid, and a retry succeeds', async () => {
    const i = await invoice();
    const p = await propose(i.id, { simulateFailure: true });
    const a = await approve(p.json().id);
    expect(a.json()).toMatchObject({ status: 'FAILED', attempts: 1 });
    expect(a.json().failureReason).toMatch(/declined/);
    expect((await inv(i.id)).status).toBe('MATCHED');
    expect(
      (await call('finance', 'GET', '/payments')).json().payments.find((x: Json) => x.id === p.json().id)
        .status,
    ).toBe('FAILED');
    const r = await call('exec', 'POST', `/payments/${p.json().id}/retry`);
    expect(r.json()).toMatchObject({ status: 'CONFIRMED', attempts: 2 });
    expect(r.json().trail.map((t: Json) => t.status)).toContain('FAILED');
    expect(await inv(i.id)).toMatchObject({ status: 'PAID' });
    // the order of each attempt was its own event, so the finance system never saw the same one twice
    const events = await sys<Json[]>((tx) =>
      tx
        .select()
        .from(s.integrationEvent)
        .where(and(eq(s.integrationEvent.tenantId, TENANT_ID), eq(s.integrationEvent.kind, 'PAYMENT_ORDER'))),
    );
    expect(events.filter((e) => String(e.idempotencyKey).startsWith(`payment:${p.json().id}:`))).toHaveLength(
      2,
    );
    // a failed one can be cancelled instead
    const j = await invoice();
    const q = await propose(j.id, { simulateFailure: true });
    await approve(q.json().id);
    expect((await call('finance', 'POST', `/payments/${q.json().id}/cancel`)).json().status).toBe(
      'CANCELLED',
    );
    expect((await call('finance', 'POST', `/payments/${q.json().id}/retry`)).statusCode).toBe(409);
  });

  it('while the finance system is down the payment waits with a manual task, is not lost or duplicated, and goes when it recovers (NFR-AV04)', async () => {
    const i = await invoice();
    const p = await propose(i.id);
    expect((await call('admin', 'PUT', '/connectors/PAYMENTS', { mode: 'DOWN' })).statusCode).toBe(200);
    const a = await approve(p.json().id);
    expect(a.json().status).toBe('APPROVED');
    expect(a.json().waiting).toMatchObject({ eventStatus: 'FAILED' });
    expect(a.json().waiting.manualTaskId).toBeTruthy();
    expect(a.json().trail.at(-1).note).toMatch(/Waiting/);
    expect((await inv(i.id)).status).toBe('MATCHED');
    // trying again while it is still down changes nothing and sends nothing twice
    const still = await call('exec', 'POST', `/payments/${p.json().id}/retry`);
    expect(still.json().status).toBe('APPROVED');
    expect((await call('admin', 'PUT', '/connectors/PAYMENTS', { mode: 'UP' })).statusCode).toBe(200);
    const ok = await call('exec', 'POST', `/payments/${p.json().id}/retry`);
    expect(ok.json()).toMatchObject({ status: 'CONFIRMED', waiting: null });
    expect(await inv(i.id)).toMatchObject({ status: 'PAID' });
    const orders = await sys<Json[]>((tx) =>
      tx.select().from(s.integrationEvent).where(eq(s.integrationEvent.kind, 'PAYMENT_ORDER')),
    );
    expect(orders.filter((e) => String(e.idempotencyKey).startsWith(`payment:${p.json().id}:`))).toHaveLength(
      1,
    );
    const open = ((await call('finance', 'GET', '/manual-tasks?status=OPEN')).json() as Json[]).filter(
      (t) => t.connector === 'PAYMENTS',
    );
    expect(open).toHaveLength(0); // superseded by the delivery
  });

  it('a payment made by hand while the system is down is recorded with the reference the person typed', async () => {
    const i = await invoice();
    const p = await propose(i.id);
    await call('admin', 'PUT', '/connectors/PAYMENTS', { mode: 'DOWN' });
    const a = await approve(p.json().id);
    const done = await call('finance', 'POST', `/manual-tasks/${a.json().waiting.manualTaskId}/complete`, {
      reference: 'BANK-778899',
    });
    expect(done.statusCode, done.body).toBe(200);
    await call('admin', 'PUT', '/connectors/PAYMENTS', { mode: 'UP' });
    const settled = await call('exec', 'POST', '/payments/settle');
    expect(settled.json()).toEqual({ settled: 1 });
    const v = (await call('finance', 'GET', `/payments/${p.json().id}`)).json();
    expect(v).toMatchObject({ status: 'CONFIRMED', financeRef: 'BANK-778899' });
    expect(await inv(i.id)).toMatchObject({ status: 'PAID' });
  });

  it('a switched-off connector holds the payment the same way', async () => {
    const i = await invoice();
    const p = await propose(i.id);
    await call('admin', 'PUT', '/connectors/PAYMENTS', { enabled: false });
    expect((await approve(p.json().id)).json().status).toBe('APPROVED');
    await call('admin', 'PUT', '/connectors/PAYMENTS', { enabled: true });
    expect((await call('exec', 'POST', `/payments/${p.json().id}/retry`)).json().status).toBe('CONFIRMED');
  });

  it("the finance system's confirmation callback must be signed, and an event id is applied once", async () => {
    const i = await invoice();
    const p = (await propose(i.id)).json();
    await approve(p.id);
    const secret = (await sys<string | null>((tx) =>
      readSecret(tx, TENANT_ID, 'connector.payments.webhook'),
    ))!;
    const send = (body: Json, key = secret) => {
      const ts = String(Math.floor(env.clock.now().getTime() / 1000));
      return env.app.inject({
        method: 'POST',
        url: '/api/v1/integrations/payments/confirmation',
        headers: { 'x-if-signature': signMessage(key, ts, body), 'x-if-timestamp': ts },
        payload: body,
      });
    };
    const body = {
      eventId: `PAYCONF-${p.id}-1`,
      type: 'PAYMENT_CONFIRMED',
      data: { paymentId: p.id, financeRef: 'FIN-REPLAY' },
    };
    expect((await send(body, 'wrong-secret-entirely')).statusCode).toBe(401);
    expect(
      (
        await env.app.inject({
          method: 'POST',
          url: '/api/v1/integrations/payments/confirmation',
          payload: body,
        })
      ).statusCode,
    ).toBe(401);
    const replay = await send(body); // the simulated system already sent this event id
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ accepted: true, duplicate: true });
    const fresh = await send({ ...body, eventId: 'PAYCONF-other-0001' });
    expect(fresh.statusCode).toBe(409); // already confirmed: only a sent payment can be confirmed
    expect((await call('finance', 'GET', `/payments/${p.id}`)).json().financeRef).not.toBe('FIN-REPLAY');
  });

  it('who can read: finance, executives, procurement and contract managers; not requesters or suppliers', async () => {
    for (const who of ['finance', 'exec', 'procurement', 'contract-mgr'])
      expect((await call(who, 'GET', '/payments')).statusCode, who).toBe(200);
    for (const who of ['requester', 'legal', 'supplier'])
      expect((await call(who, 'GET', '/payments')).statusCode, who).toBe(403);
    expect((await call('finance', 'GET', '/payments')).json().connector).toMatchObject({
      provider: 'SIMULATED_PAYMENTS',
      enabled: true,
    });
  });
});
