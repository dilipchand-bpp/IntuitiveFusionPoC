import { and, eq, like } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import * as s from '../../db/schema.js';
import { TENANT_ID, uid } from '../../db/seed.js';
import { addDays } from './dates.js';
import { BRIGHT, SEED_DATE, createEnv, type Json } from './test-env.js';

let env: Awaited<ReturnType<typeof createEnv>>;
const call = (...a: Parameters<typeof env.call>) => env.call(...a);
beforeAll(async () => {
  env = await createEnv();
}, 120_000);

const CM = {
  erpIntegrated: true,
  variationModel: 'CUMULATIVE',
  variationNumbering: 'SUFFIX',
  publicSectorDisclosure: false,
  disclosureThresholdPct: 10,
  disclosureDays: 42,
  highValueAud: 1_000_000,
  spendAlertPct: 70,
  planTemplates: [] as unknown[],
};
const cm = async (over: Partial<typeof CM> = {}) => {
  const r = await call('admin', 'PUT', '/admin/settings', { contractManagement: { ...CM, ...over } });
  expect(r.statusCode, r.body).toBe(200);
};
const back = () => env.clock.set(SEED_DATE);
const at = (date: string) => env.clock.set(`${date}T09:00:00Z`);
const rates = (id: string, rows: Array<{ item: string; unit?: string; unitPrice: number }>) =>
  call('contract-mgr', 'PUT', `/contracts/${id}/rates`, { rates: rows });
const po = (
  id: string,
  lines: Array<{ item: string; qty: number; unitPrice: number }>,
  extra = {},
  who = 'finance',
) =>
  call(who, 'POST', `/contracts/${id}/purchase-orders`, {
    description: 'Supply of services',
    lines,
    ...extra,
  });
const inv = (id: string, body: Json, who = 'finance') => call(who, 'POST', `/contracts/${id}/invoices`, body);
const codes = (r: { json(): unknown }) =>
  ((r.json() as Json).invoice.findings as Array<{ code: string }>).map((f) => f.code);
const notes = (key: string, link: string) =>
  env
    .withSystem(env.database, (tx) =>
      tx
        .select()
        .from(s.notification)
        .where(eq(s.notification.userId, uid(`user:${key}`))),
    )
    .then((rows) => rows.filter((n) => (n.link ?? '').includes(link)));
const auditActions = async (entityId: string) =>
  (
    await env.withSystem(env.database, (tx) =>
      tx.select().from(s.auditEvent).where(eq(s.auditEvent.entityId, entityId)),
    )
  ).map((e) => e.action);
const supplierCert = (expiresOn: string | null, status: 'CURRENT' | 'EXPIRED' | 'UNKNOWN') =>
  env.withSystem(env.database, (tx) =>
    tx
      .update(s.supplier)
      .set({ insuranceExpiresOn: expiresOn, insuranceStatus: status })
      .where(eq(s.supplier.id, BRIGHT)),
  );

describe('FR-0500 the three-way match', () => {
  it('matches an invoice to the purchase order and the rate card, blocks an unapproved price increase, and lets finance release it with a reason', async () => {
    const { id } = await env.executed();
    expect((await call('requester', 'PUT', `/contracts/${id}/rates`, { rates: [] })).statusCode).toBe(403);
    expect((await rates(id, [{ item: 'Cleaning hour', unit: 'hour', unitPrice: 50 }])).statusCode).toBe(200);
    const o = await po(id, [{ item: 'Cleaning hour', qty: 100, unitPrice: 50 }]);
    expect(o.statusCode, o.body).toBe(201);
    const poId = o.json().id as string;

    const ok = await inv(id, {
      invoiceDate: '2026-11-01',
      poId,
      lines: [{ item: 'Cleaning hour', qty: 40, unitPrice: 50 }],
    });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json().invoice).toMatchObject({ status: 'MATCHED', amount: 2000, findings: [] });

    const bad = await inv(id, {
      invoiceDate: '2026-11-02',
      poId,
      lines: [{ item: 'Cleaning hour', qty: 40, unitPrice: 55 }],
    });
    expect(bad.json().invoice.status).toBe('BLOCKED');
    expect(codes(bad)).toContain('RATE_INCREASE');
    expect(bad.json().invoice.findings[0].message).toMatch(/unapproved price increase/);

    // a blocked invoice is not spend, and cannot be paid
    const spend = (await call('contract-mgr', 'GET', `/contracts/${id}/spend`)).json();
    expect(spend).toMatchObject({ invoiced: 2000, blockedCount: 1, blockedAmount: 2200 });
    const blockedId = bad.json().invoice.id as string;
    expect((await call('finance', 'POST', `/invoices/${blockedId}/pay`)).statusCode).toBe(409);
    expect(
      (await call('finance', 'GET', '/invoices?status=BLOCKED')).json().map((i: Json) => i.id),
    ).toContain(blockedId);

    // only finance (or an executive) releases it, and must say why
    expect(
      (await call('legal', 'POST', `/invoices/${blockedId}/override`, { reason: 'Agreed with the supplier' }))
        .statusCode,
    ).toBe(403);
    expect(
      (await call('finance', 'POST', `/invoices/${blockedId}/override`, { reason: 'short' })).statusCode,
    ).toBe(400);
    const rel = await call('finance', 'POST', `/invoices/${blockedId}/override`, {
      reason: 'Price rise agreed in writing with the supplier on 1 November',
    });
    expect(rel.statusCode, rel.body).toBe(200);
    expect(rel.json().status).toBe('EXCEPTION');
    const paid = await call('finance', 'POST', `/invoices/${blockedId}/pay`);
    expect(paid.json()).toMatchObject({ status: 'PAID', paidAmount: 2200 });
    expect(((await call('contract-mgr', 'GET', `/contracts/${id}/spend`)).json() as Json).invoiced).toBe(
      4200,
    );
    expect(await auditActions(id)).toEqual(
      expect.arrayContaining([
        'contract.rates_edit',
        'contract.po_create',
        'contract.invoice_matched',
        'contract.invoice_blocked',
        'contract.invoice_override',
        'contract.invoice_pay',
      ]),
    );
  });

  it('blocks an item that is not on the contract, an invoice with no order, and more than was ordered', async () => {
    const { id } = await env.executed();
    await rates(id, [{ item: 'Hour', unitPrice: 100 }]);
    const o = await po(id, [{ item: 'Hour', qty: 10, unitPrice: 100 }]);
    const poId = o.json().id as string;
    expect(
      codes(
        await inv(id, {
          invoiceDate: '2026-11-01',
          poId,
          lines: [{ item: 'Mystery fee', qty: 1, unitPrice: 5 }],
        }),
      ),
    ).toEqual(expect.arrayContaining(['NOT_ON_CONTRACT', 'NOT_ON_PO']));
    expect(
      codes(await inv(id, { invoiceDate: '2026-11-01', lines: [{ item: 'Hour', qty: 1, unitPrice: 100 }] })),
    ).toEqual(['NO_PO']);
    const over = await inv(id, {
      invoiceDate: '2026-11-01',
      poId,
      lines: [{ item: 'Hour', qty: 11, unitPrice: 100 }],
    });
    expect(codes(over)).toEqual(expect.arrayContaining(['OVER_PO_QTY', 'OVER_PO_AMOUNT']));
    const dup = await inv(id, {
      number: 'DUP-1',
      invoiceDate: '2026-11-01',
      poId,
      lines: [{ item: 'Hour', qty: 1, unitPrice: 100 }],
    });
    expect(dup.statusCode).toBe(201);
    expect(
      (
        await inv(id, {
          number: 'DUP-1',
          invoiceDate: '2026-11-01',
          poId,
          lines: [{ item: 'Hour', qty: 1, unitPrice: 100 }],
        })
      ).json().code,
    ).toBe('DUPLICATE_INVOICE');
  });
});

describe('FR-0495 the spend-ceiling guard', () => {
  it('blocks a requisition that takes commitments above the contract limit, keeps a record of it, and is off where the ERP is not integrated', async () => {
    const { id } = await env.executed({ value: 120_000 });
    const first = await po(id, [{ item: 'Project work', qty: 1, unitPrice: 100_000 }]);
    expect(first.statusCode, first.body).toBe(201);
    const over = await po(id, [{ item: 'Project work', qty: 1, unitPrice: 30_000 }]);
    expect(over.statusCode).toBe(422);
    expect(over.json().code).toBe('SPEND_CEILING');
    expect(over.json().title).toMatch(/above the contract limit of 120000\.00/);
    const list = (await call('contract-mgr', 'GET', `/contracts/${id}/purchase-orders`)).json() as Json[];
    expect(list.map((p) => p.status)).toEqual(['APPROVED', 'BLOCKED']);
    expect(list[1]!.blockedReason).toMatch(/contract limit/);
    expect(await auditActions(id)).toContain('contract.po_blocked');
    // exactly up to the limit is fine
    expect((await po(id, [{ item: 'Project work', qty: 1, unitPrice: 20_000 }])).statusCode).toBe(201);
    // the people who may not raise orders
    expect((await call('requester', 'POST', `/contracts/${id}/purchase-orders`, {})).statusCode).toBe(403);

    await cm({ erpIntegrated: false });
    expect((await po(id, [{ item: 'Project work', qty: 1, unitPrice: 30_000 }])).statusCode).toBe(201);
    await cm();
  });
});

describe('FR-0525 price escalation clauses', () => {
  it('allows the escalated price from its effective date and flags an escalation applied early or above the formula', async () => {
    const { id } = await env.executed();
    await rates(id, [{ item: 'Service day', unitPrice: 1000 }]);
    const esc = await call('contract-mgr', 'PUT', `/contracts/${id}/escalations`, {
      escalations: [
        { kind: 'SCHEDULED', effectiveOn: '2027-07-01', pct: 4, note: 'Annual step' },
        { kind: 'CPI', effectiveOn: '2028-07-01', pct: 6.2, capPct: 5 },
      ],
    });
    expect(esc.statusCode, esc.body).toBe(200);
    expect(
      (
        await call('contract-mgr', 'PUT', `/contracts/${id}/escalations`, {
          escalations: [{ kind: 'SCHEDULED', effectiveOn: '2020-01-01', pct: 2 }],
        })
      ).json().code,
    ).toBe('ESCALATION_BEFORE_START');
    const com = (await call('contract-mgr', 'GET', `/contracts/${id}/commercial`)).json() as Json;
    expect(com.escalations.map((e: Json) => e.allowedPct)).toEqual([4, 5]); // the index moved 6.2%, the cap is 5%
    const p = await po(id, [{ item: 'Service day', qty: 50, unitPrice: 1100 }]);
    const poId = p.json().id as string;
    const line = (price: number) => ({ item: 'Service day', qty: 1, unitPrice: price });
    const early = await inv(id, { invoiceDate: '2027-06-30', poId, lines: [line(1040)] });
    expect(codes(early)).toEqual(['ESCALATION_OUTSIDE_FORMULA']);
    expect(early.json().invoice.findings[0].message).toMatch(/not due until 2027-07-01/);
    const due = await inv(id, { invoiceDate: '2027-07-01', poId, lines: [line(1040)] });
    expect(due.json().invoice.status).toBe('MATCHED');
    const high = await inv(id, { invoiceDate: '2027-08-01', poId, lines: [line(1060)] });
    expect(codes(high)).toEqual(['ESCALATION_OUTSIDE_FORMULA']);
    expect(high.json().invoice.findings[0].message).toMatch(/above the .*1,040/);
    const capped = await inv(id, { invoiceDate: '2028-08-01', poId, lines: [line(1092)] }); // 1000 x 1.04 x 1.05
    expect(capped.json().invoice.status).toBe('MATCHED');
    expect(codes(await inv(id, { invoiceDate: '2028-08-01', poId, lines: [line(1100)] }))).toEqual([
      'ESCALATION_OUTSIDE_FORMULA',
    ]);
  });
});

describe('FR-0520 rebate tracking', () => {
  it('finds a rebate that was earned and never claimed, flags it for follow-up once, and clears when it is claimed', async () => {
    const { id } = await env.executed();
    await rates(id, [{ item: 'Unit', unitPrice: 100 }]);
    const p = await po(id, [{ item: 'Unit', qty: 100, unitPrice: 100 }]);
    const poId = p.json().id as string;
    const made = await call('contract-mgr', 'POST', `/contracts/${id}/rebates`, {
      title: 'Volume rebate 2026-27 H1',
      threshold: 5000,
      ratePct: 2,
      periodStart: '2026-10-01',
      periodEnd: '2027-03-31',
    });
    expect(made.statusCode, made.body).toBe(201);
    expect(made.json()).toMatchObject({ status: 'OPEN', earned: 0 });
    const rebateId = made.json().id as string;
    await inv(id, { invoiceDate: '2026-11-01', poId, lines: [{ item: 'Unit', qty: 40, unitPrice: 100 }] });
    await inv(id, { invoiceDate: '2027-02-01', poId, lines: [{ item: 'Unit', qty: 20, unitPrice: 100 }] });
    const live = (await call('finance', 'GET', `/contracts/${id}/commercial`)).json() as Json;
    expect(live.rebates[0]).toMatchObject({
      spend: 6000,
      earned: 120,
      status: 'EARNED_TO_CLAIM',
      flagged: false,
    });

    // not yet flagged inside the period; once it has ended the platform raises it by itself
    expect((await call('finance', 'POST', `/contracts/${id}/rebates/${rebateId}/follow-up`)).statusCode).toBe(
      409,
    );
    at('2027-04-02');
    await call('contract-mgr', 'GET', `/contracts/${id}/alerts`); // reading alerts runs the sweeps
    const after = (await call('finance', 'GET', `/contracts/${id}/commercial`)).json() as Json;
    expect(after.rebates[0]).toMatchObject({ status: 'MISSED', flagged: true, shortfall: 120 });
    expect(after.rebates[0].followedUpAt).not.toBeNull();
    expect((await notes('finance', id)).filter((n) => n.title.startsWith('Rebate to follow up')).length).toBe(
      1,
    );
    await call('contract-mgr', 'GET', `/contracts/${id}/alerts`);
    expect((await notes('finance', id)).filter((n) => n.title.startsWith('Rebate to follow up')).length).toBe(
      1,
    );

    const part = await call('finance', 'POST', `/contracts/${id}/rebates/${rebateId}/claim`, { amount: 50 });
    expect(part.json()).toMatchObject({ status: 'UNDER_CLAIMED', claimed: 50, shortfall: 70 });
    const full = await call('finance', 'POST', `/contracts/${id}/rebates/${rebateId}/claim`, { amount: 70 });
    expect(full.json()).toMatchObject({ status: 'CLAIMED', flagged: false });
    expect(
      (await call('requester', 'POST', `/contracts/${id}/rebates/${rebateId}/claim`, { amount: 1 }))
        .statusCode,
    ).toBe(403);
    expect(await auditActions(id)).toEqual(
      expect.arrayContaining(['contract.rebate_add', 'contract.rebate_flagged', 'contract.rebate_claim']),
    );
    back();
  });
});

describe('FR-0550 compliance monitoring and the purchase-order hold', () => {
  it('holds new purchase orders while mandatory cover has lapsed and lifts the hold by itself when a current certificate is recorded', async () => {
    const { id } = await env.executed();
    await supplierCert('2026-09-30', 'EXPIRED');
    const held = await po(id, [{ item: 'Service', qty: 1, unitPrice: 1000 }]);
    expect(held.statusCode).toBe(409);
    expect(held.json().code).toBe('PURCHASE_ORDER_HELD');
    expect(held.json().title).toMatch(/lapsed on 2026-09-30/);
    const com = (await call('contract-mgr', 'GET', `/contracts/${id}/commercial`)).json() as Json;
    expect(com.hold).toMatchObject({ kind: 'INSURANCE' });
    expect((await notes('procurement', id)).some((n) => n.title === 'Purchase orders on hold')).toBe(true);
    expect((await notes('finance', id)).some((n) => n.title === 'Purchase orders on hold')).toBe(true);

    // the supplier records a current certificate in its portal
    const cert = await call('supplier', 'PUT', '/supplier/profile/insurance', {
      insurer: 'Southern Cross Mutual',
      policyNumber: 'PL-20931',
      coverAud: 10_000_000,
      expiresOn: '2027-12-31',
    });
    expect(cert.statusCode, cert.body).toBe(200);
    const ok = await po(id, [{ item: 'Service', qty: 1, unitPrice: 1000 }]);
    expect(ok.statusCode, ok.body).toBe(201);
    expect(
      ((await call('contract-mgr', 'GET', `/contracts/${id}/commercial`)).json() as Json).hold,
    ).toBeNull();
    expect(await auditActions(id)).toEqual(
      expect.arrayContaining(['contract.hold_placed', 'contract.hold_released']),
    );
    expect((await notes('finance', id)).some((n) => n.title === 'Purchase order hold lifted')).toBe(true);
    await supplierCert(null, 'CURRENT');
  });
});

describe('FR-0510 fixed alerts that cannot be muted', () => {
  it('schedules the 180, 90 and 60 day countdown, refuses to mute it, and delivers it even to someone who muted everything else', async () => {
    const { id, view } = await env.executed();
    const end = view.endDate as string;
    const fixed = (view.record.alerts as Json[]).filter((a) => a.kind === 'COUNTDOWN');
    expect(fixed.map((a) => a.triggerDate)).toEqual(
      expect.arrayContaining([addDays(end, -180), addDays(end, -90), addDays(end, -60)]),
    );
    expect(fixed.map((a) => a.triggerDate)).toEqual(
      expect.arrayContaining([addDays(end, -270), addDays(end, -150)]),
    ); // the extension decision closes at -90

    const rules = await call('contract-mgr', 'GET', '/alerts/rules');
    expect(rules.json().fixed.map((r: Json) => r.kind)).toEqual(['COUNTDOWN', 'INSURANCE', 'SPEND']);
    expect(rules.json().note).toMatch(/cannot be muted/);
    expect((await call('requester', 'GET', '/alerts/rules')).statusCode).toBe(403);
    const refused = await call('contract-mgr', 'PUT', '/me/alert-preferences', {
      muted: ['NOTICE', 'COUNTDOWN'],
    });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().code).toBe('ALERT_NOT_MUTABLE');
    expect(
      (await call('contract-mgr', 'PUT', '/me/alert-preferences', { muted: ['INSURANCE'] })).json().code,
    ).toBe('ALERT_NOT_MUTABLE');
    // the platform's own settings have no way to change or switch off the fixed alerts
    expect(
      (
        await call('admin', 'PUT', '/admin/settings', {
          contractManagement: { ...CM, mandatoryAlerts: false },
        })
      ).statusCode,
    ).toBe(400);

    const mute = await call('contract-mgr', 'PUT', '/me/alert-preferences', {
      muted: ['NOTICE', 'EXPIRY', 'MILESTONE', 'EXTENSION', 'CUSTOM', 'CLAUSE'],
    });
    expect(mute.statusCode, mute.body).toBe(200);
    // on the notice date the muted notice alert is not delivered, but the countdown that falls on it is
    at(addDays(end, -150));
    await call('contract-mgr', 'GET', `/contracts/${id}/alerts`);
    const mine = await notes('contract-mgr', id);
    expect(mine.some((n) => n.title === 'Contract alert: countdown')).toBe(true);
    expect(mine.some((n) => n.title === 'Contract alert: notice')).toBe(false);
    const list = (await call('contract-mgr', 'GET', `/contracts/${id}/alerts`)).json() as Json[];
    expect(list.find((a) => a.kind === 'NOTICE')!.status).toBe('SENT'); // it fired, to the people who had not muted it
    await call('contract-mgr', 'PUT', '/me/alert-preferences', { muted: [] });
    back();
  });

  it('warns 30 days before an insurance certificate expires, and moves the warning when the certificate is renewed', async () => {
    const { id } = await env.executed();
    await supplierCert('2026-11-16', 'CURRENT');
    const list = (await call('contract-mgr', 'GET', `/contracts/${id}/alerts`)).json() as Json[]; // runs the monitor
    const w = list.find((a) => a.kind === 'INSURANCE')!;
    expect(w).toMatchObject({ triggerDate: '2026-10-17', status: 'SCHEDULED', origin: 'SYSTEM' });
    expect(w.note).toMatch(/expires on 2026-11-16/);
    // renewing the certificate moves the warning
    await supplierCert('2027-06-30', 'CURRENT');
    const moved = (await call('contract-mgr', 'GET', `/contracts/${id}/alerts`)).json() as Json[];
    expect(
      moved.filter((a) => a.kind === 'INSURANCE' && a.status === 'SCHEDULED').map((a) => a.triggerDate),
    ).toEqual(['2027-05-31']);
    expect(moved.find((a) => a.triggerDate === '2026-10-17')?.status).toBe('CANCELLED');
    at('2027-05-31');
    await call('contract-mgr', 'GET', `/contracts/${id}/alerts`);
    expect((await notes('contract-mgr', id)).some((n) => n.title === 'Contract alert: insurance')).toBe(true);
    back();
    await supplierCert(null, 'CURRENT');
  });

  it('gives a spend notice at 80, 90 and 100 per cent of the limit, each once, and the configured one besides', async () => {
    const { id } = await env.executed({ value: 120_000 });
    await rates(id, [{ item: 'Unit', unitPrice: 1000 }]);
    const p = await po(id, [{ item: 'Unit', qty: 120, unitPrice: 1000 }]);
    const poId = p.json().id as string;
    const bill = (qty: number, n: number) =>
      inv(id, {
        number: `SP-${id.slice(0, 6)}-${n}`,
        invoiceDate: '2026-11-01',
        poId,
        lines: [{ item: 'Unit', qty, unitPrice: 1000 }],
      });
    const titles = async () => (await notes('finance', id)).map((n) => n.title).sort();

    const a = await bill(85, 1); // 70.8%
    expect(a.json().spendAlerts).toEqual([expect.objectContaining({ kind: 'CONFIGURED', threshold: 70 })]);
    await bill(12, 2); // 80.8%
    await bill(12, 3); // 90.8%
    const number = ((await call('legal', 'GET', `/contracts/${id}`)).json() as Json).number as string;
    expect((await notes('contract-mgr', id)).map((n) => n.title)).toContain(
      `Spend alert: 70% of ${number} spent`,
    );
    const last = await bill(11, 4); // 100%
    expect(last.json().spendAlerts.map((x: Json) => x.threshold)).toEqual([100]);
    const spend = (await call('contract-mgr', 'GET', `/contracts/${id}/spend`)).json() as Json;
    expect(spend.raised.map((r: Json) => `${r.kind}:${r.threshold}`)).toEqual([
      'CONFIGURED:70',
      'MANDATORY:80',
      'MANDATORY:90',
      'MANDATORY:100',
    ]);
    const mandatory = (await titles()).filter((t) => t.startsWith('Spend ceiling'));
    expect(mandatory).toHaveLength(3);
    // at the limit the delegate hears too
    expect((await notes('delegate', id)).some((n) => n.title.includes('100%'))).toBe(true);
    // nothing is raised twice
    const again = await call('finance', 'POST', `/invoices/${a.json().invoice.id}/pay`);
    expect(again.statusCode).toBe(200);
    expect((await titles()).filter((t) => t.startsWith('Spend ceiling'))).toHaveLength(3);
  });
});

describe('FR-0580 live spend against the contract', () => {
  it('shows spend and term progress from invoice and payment data, with the notices that were raised', async () => {
    const { id } = await env.executed({ value: 100_000 });
    await rates(id, [{ item: 'Unit', unitPrice: 1000 }]);
    const p = await po(id, [{ item: 'Unit', qty: 60, unitPrice: 1000 }]);
    const poId = p.json().id as string;
    const one = await inv(id, {
      invoiceDate: '2026-11-01',
      poId,
      lines: [{ item: 'Unit', qty: 40, unitPrice: 1000 }],
    });
    await call('finance', 'POST', `/invoices/${one.json().invoice.id}/pay`);
    await inv(id, { invoiceDate: '2026-11-15', poId, lines: [{ item: 'Unit', qty: 10, unitPrice: 1000 }] });
    const sp = (await call('delegate', 'GET', `/contracts/${id}/spend`)).json() as Json;
    expect(sp).toMatchObject({
      value: 100_000,
      invoiced: 50_000,
      paid: 40_000,
      committed: 60_000,
      remaining: 50_000,
      spentPct: 50,
      paidPct: 40,
      committedPct: 60,
      configuredPct: 70,
    });
    expect(sp.term.pct).toBeGreaterThanOrEqual(0);
    expect(sp.term.totalDays).toBeGreaterThan(300);
    expect(sp.owner).toBe('Sofia Rossi');
    expect((await call('requester', 'GET', `/contracts/${id}/spend`)).statusCode).toBe(403);
    // a variation raises the value the spend is measured against
    const v = await call('legal', 'POST', `/contracts/${id}/variations`, {
      reason: 'Additional scope agreed',
      value: 20_000,
    });
    expect(v.statusCode, v.body).toBe(201);
  });
});

describe('FR-0515 custom alerts with channels and owners', () => {
  it('delivers a plain-language alert on the channels chosen and to the person it is assigned to', async () => {
    const { id } = await env.executed();
    const other = await env.extraUser('assigned', 'CONTRACT_MGR');
    const bad = await call('contract-mgr', 'POST', `/contracts/${id}/alerts`, {
      instruction: 'alert me 1 month before expiry',
      channels: ['FAX'],
    });
    expect(bad.statusCode).toBe(400);
    expect(
      (
        await call('contract-mgr', 'POST', `/contracts/${id}/alerts`, {
          instruction: 'alert me 1 month before expiry',
          ownerId: '00000000-0000-4000-8000-000000000000',
        })
      ).json().code,
    ).toBe('OWNER_NOT_FOUND');
    const r = await call('contract-mgr', 'POST', `/contracts/${id}/alerts`, {
      instruction: 'alert me 1 month before expiry',
      channels: ['SMS', 'SLACK'],
      ownerId: other.id,
    });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json()).toMatchObject({ channels: ['SMS', 'SLACK'], ownerId: other.id });
    const alertId = r.json().id as string;
    at(r.json().triggerDate);
    await call('contract-mgr', 'GET', `/contracts/${id}/alerts`);
    const dl = await env.withSystem(env.database, (tx) =>
      tx.select().from(s.alertDelivery).where(eq(s.alertDelivery.alertId, alertId)),
    );
    expect([...new Set(dl.map((x) => `${x.channel}:${x.status}`))].sort()).toEqual([
      'SLACK:SIMULATED',
      'SMS:SIMULATED',
    ]);
    expect(new Set(dl.map((x) => x.userId))).toEqual(new Set([uid('user:contract-mgr'), other.id]));
    // no in-app notice was asked for
    expect(
      (await notes('contract-mgr', id)).filter((n) => n.title === 'Contract alert: custom'),
    ).toHaveLength(0);
    back();
  });
});

describe('FR-0530 alert triggers taken from clause wording', () => {
  it('proposes an alert ahead of a notice period stated in a clause, and schedules it only when a person confirms', async () => {
    const d = await env.draft();
    await call('legal', 'PUT', `/contracts/${d.id}/clauses/IP`, {
      text: "Either party may terminate the licence of intellectual property on six months' written notice.",
    });
    expect((await call('legal', 'POST', `/contracts/${d.id}/release-for-signing`)).statusCode).toBe(200);
    const signed = await call('delegate', 'POST', `/contracts/${d.id}/sign`, { decision: 'APPROVE' });
    expect(signed.json().status).toBe('EXECUTED');
    const end = signed.json().endDate as string;

    expect((await call('requester', 'POST', `/contracts/${d.id}/alerts/extract`)).statusCode).toBe(403);
    const ex = await call('contract-mgr', 'POST', `/contracts/${d.id}/alerts/extract`);
    expect(ex.statusCode, ex.body).toBe(200);
    expect(ex.json().model).toBe('rules-simulated-v1');
    const six = (ex.json().proposals as Json[]).find((p) => p.key.startsWith('IP:notice-6-month'))!;
    expect(six.triggerDate).toBe(addDays(addMonthsIso(end, -6), -30));
    expect(six.quote.toLowerCase()).toContain('six months');
    // the standard clauses carry a 90 day notice too
    expect((ex.json().proposals as Json[]).some((p) => p.clauseId === 'TERMINATION')).toBe(true);
    expect(
      ((await call('contract-mgr', 'GET', `/contracts/${d.id}/alerts`)).json() as Json[]).some(
        (a) => a.kind === 'CLAUSE',
      ),
    ).toBe(false);

    const apply = await call('contract-mgr', 'POST', `/contracts/${d.id}/alerts/extract/apply`, {
      keys: [six.key],
    });
    expect(apply.statusCode, apply.body).toBe(201);
    expect(apply.json().created).toHaveLength(1);
    const made = ((await call('contract-mgr', 'GET', `/contracts/${d.id}/alerts`)).json() as Json[]).find(
      (a) => a.kind === 'CLAUSE',
    )!;
    expect(made).toMatchObject({ origin: 'AI', triggerDate: six.triggerDate, status: 'SCHEDULED' });
    expect(made.note).toMatch(/six months/);
    // confirming again creates nothing new; an unknown key is refused
    expect(
      (
        await call('contract-mgr', 'POST', `/contracts/${d.id}/alerts/extract/apply`, { keys: [six.key] })
      ).json().created,
    ).toHaveLength(0);
    expect(
      (
        await call('contract-mgr', 'POST', `/contracts/${d.id}/alerts/extract/apply`, {
          keys: ['IP:nothing'],
        })
      ).json().code,
    ).toBe('PROPOSAL_NOT_FOUND');

    at(six.triggerDate);
    await call('contract-mgr', 'GET', `/contracts/${d.id}/alerts`);
    expect((await notes('contract-mgr', d.id)).some((n) => n.title === 'Contract alert: clause')).toBe(true);
    expect(await auditActions(d.id)).toEqual(
      expect.arrayContaining(['contract.alert_extract', 'contract.alert_extract_apply']),
    );
    back();
  });
});

const addMonthsIso = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  const total = x.getUTCFullYear() * 12 + x.getUTCMonth() + n;
  const y = Math.floor(total / 12);
  const m = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(x.getUTCDate(), last))).toISOString().slice(0, 10);
};

describe('FR-0535 FR-0540 FR-0545 variations: business case, model and disclosure', () => {
  it('logs the business case and the cumulative variance as a versioned sub-record of the contract', async () => {
    const { id, view } = await env.executed({ value: 100_000 });
    const v1 = await call('legal', 'POST', `/contracts/${id}/variations`, {
      reason: 'Extra floors added to the cleaning scope after the building extension',
      value: 8_000,
    });
    expect(v1.statusCode, v1.body).toBe(201);
    expect(v1.json().number).toBe(`${view.number}-V1`);
    expect(v1.json().variation).toMatchObject({
      businessCase: expect.stringMatching(/Extra floors/),
      variancePct: 8,
      model: 'CUMULATIVE',
      standingValue: 100_000,
      cumulativeValue: 108_000,
      tierChanged: false,
    });
    expect(v1.json().clauses[0].text).toMatch(/Business case: Extra floors/);
    expect(await auditActions(v1.json().id)).toContain('contract.variation_create');
    await call('legal', 'POST', `/contracts/${v1.json().id}/release-for-signing`);
    expect(
      (await call('delegate', 'POST', `/contracts/${v1.json().id}/sign`, { decision: 'APPROVE' })).json()
        .status,
    ).toBe('EXECUTED');
    // the second variation is measured against the original value, with the first included
    const v2 = await call('legal', 'POST', `/contracts/${id}/variations`, {
      reason: 'Out-of-hours cover for the new wing',
      value: 6_000,
    });
    expect(v2.json().number).toBe(`${view.number}-V2`);
    expect(v2.json().variation).toMatchObject({ variancePct: 14, cumulativeValue: 114_000 });
  });

  it("re-evaluates the authority needed when a variation moves the contract into a higher value tier, by the organisation's model", async () => {
    const { id, view } = await env.executed({ value: 950_000 });
    expect(view.chain.map((x: Json) => x.role)).toEqual(['DELEGATE']);
    const make = async () => {
      const v = await call('legal', 'POST', `/contracts/${id}/variations`, {
        reason: 'Scope growth agreed by the delegate',
        value: 100_000,
      });
      expect(v.statusCode, v.body).toBe(201);
      return v.json() as Json;
    };
    const cum = await make();
    expect(cum.variation).toMatchObject({ tierBefore: 1, tierAfter: 2, tierChanged: true });
    expect(cum.variation.requiredSigners).toEqual(['Authorised delegate', 'Executive']);
    expect(cum.chain.map((x: Json) => x.role)).toEqual(['DELEGATE', 'EXEC']);
    await call('legal', 'DELETE', `/contracts/${cum.id}`, { reason: 'Replaced to try the other model' });

    await cm({ variationModel: 'INCREMENTAL' });
    const inc = await make();
    expect(inc.variation).toMatchObject({ model: 'INCREMENTAL', tierChanged: true, variancePct: 10.53 });
    expect(inc.variation.requiredSigners).toEqual(['Authorised delegate']); // judged on the additional spend alone
    expect(inc.chain.map((x: Json) => x.role)).toEqual(['DELEGATE']);
    await cm();
  });

  it('FR-0545 creates a mandatory public register disclosure task when a public-sector contract changes by more than the threshold', async () => {
    await cm({ publicSectorDisclosure: true, disclosureThresholdPct: 10, disclosureDays: 42 });
    const { id } = await env.executed({ value: 100_000 });
    const small = await call('legal', 'POST', `/contracts/${id}/variations`, {
      reason: 'A small change of five per cent',
      value: 5_000,
    });
    expect(small.json().variation.disclosure).toBeNull();
    await call('legal', 'DELETE', `/contracts/${small.json().id}`, { reason: 'Not needed after all' });

    const big = await call('legal', 'POST', `/contracts/${id}/variations`, {
      reason: 'A large change of fifteen per cent',
      value: 15_000,
    });
    expect(big.statusCode, big.body).toBe(201);
    expect(big.json().variation.disclosure).toMatchObject({
      register: 'AusTender',
      status: 'OPEN',
      dueOn: addDays('2026-10-02', 42),
    });
    const tasks = (await call('procurement', 'GET', '/disclosure-tasks')).json() as Json[];
    const mine = tasks.find((t) => t.contractId === big.json().id)!;
    expect(mine).toMatchObject({ variancePct: 15, status: 'OPEN', overdue: false });
    expect((await notes('procurement', '/app/contracts/disclosures')).length).toBeGreaterThan(0);
    expect((await call('requester', 'GET', '/disclosure-tasks')).statusCode).toBe(403);
    expect(
      (await call('contract-mgr', 'POST', `/disclosure-tasks/${mine.id}/complete`, { reference: 'AT-1' }))
        .statusCode,
    ).toBe(403);
    expect(
      (await call('procurement', 'POST', `/disclosure-tasks/${mine.id}/complete`, { reference: 'x' }))
        .statusCode,
    ).toBe(400);
    const done = await call('procurement', 'POST', `/disclosure-tasks/${mine.id}/complete`, {
      reference: 'AusTender CN-2026-0042',
    });
    expect(done.json()).toMatchObject({ status: 'DONE', reference: 'AusTender CN-2026-0042' });
    expect(
      (await call('procurement', 'POST', `/disclosure-tasks/${mine.id}/complete`, { reference: 'again' }))
        .statusCode,
    ).toBe(409);
    expect(await auditActions(big.json().id)).toEqual(
      expect.arrayContaining(['contract.disclosure_task', 'contract.disclosure_complete']),
    );
    await cm();
  });
});

describe('FR-0565 FR-0570 variations, extensions and linked procurements', () => {
  it('shows the variation count, extensions exercised and remaining, the cumulative value and the historic versions', async () => {
    const { id, view } = await env.executed({ value: 100_000 });
    const v = await call('legal', 'POST', `/contracts/${id}/variations`, {
      reason: 'Additional scope for the annex',
      value: 10_000,
    });
    await call('legal', 'POST', `/contracts/${v.json().id}/release-for-signing`);
    await call('delegate', 'POST', `/contracts/${v.json().id}/sign`, { decision: 'APPROVE' });
    const m = (await call('contract-mgr', 'GET', `/contracts/${id}/management`)).json() as Json;
    expect(m).toMatchObject({ variationCount: 1, variationsExecuted: 1 });
    expect(m.extensions).toMatchObject({ total: 1, exercised: 0, remaining: 1 });
    expect(m.cumulative).toMatchObject({ original: 100_000, value: 110_000 });
    expect(m.versions.map((x: Json) => `${x.label}:${x.cumulativeValue}`)).toEqual([
      'Original:100000',
      'V1:110000',
    ]);
    expect(m.versions[1]).toMatchObject({
      number: `${view.number}-V1`,
      businessCase: expect.stringMatching(/annex/),
    });
    // from the variation itself the same view of the parent is shown
    expect(
      ((await call('legal', 'GET', `/contracts/${v.json().id}/management`)).json() as Json).contractId,
    ).toBe(id);
  });

  it('creates a new procurement number linked to the contract to renew, vary or take up an extension, visible in the pipeline and not a new tender', async () => {
    const { id, view } = await env.executed({ value: 100_000 });
    expect(
      (
        await call('requester', 'POST', `/contracts/${id}/procurements`, {
          kind: 'RENEW',
          note: 'Renew the contract',
        })
      ).statusCode,
    ).toBe(403);
    const renew = await call('contract-mgr', 'POST', `/contracts/${id}/procurements`, {
      kind: 'RENEW',
      note: 'Renew for another three years',
    });
    expect(renew.statusCode, renew.body).toBe(201);
    expect(renew.json().request).toMatchObject({ kind: 'RENEW', title: expect.stringMatching(/^Renewal: /) });
    const list = (await call('procurement', 'GET', '/requests?limit=50')).json() as { items: Json[] };
    const row = list.items.find((r) => r.id === renew.json().request.id)!;
    expect(row).toMatchObject({ linkKind: 'RENEW', phase: 'CONTRACT_MGMT', estimatedValue: 100_000 });
    expect(row.linkedContract).toMatchObject({ id, number: view.number });
    const tenders = await env.withSystem(env.database, (tx) =>
      tx.select().from(s.tender).where(eq(s.tender.requestId, row.id)),
    );
    expect(tenders).toHaveLength(0); // not a new tender

    // an extension: the number is linked, the option is marked taken up and a variation is drafted to extend the end date
    const ext = await call('contract-mgr', 'POST', `/contracts/${id}/procurements`, {
      kind: 'EXTEND',
      note: 'Take up option 1 for twelve months',
    });
    expect(ext.statusCode, ext.body).toBe(201);
    expect(ext.json().variation.number).toBe(`${view.number}-V1`);
    const m = (await call('contract-mgr', 'GET', `/contracts/${id}/management`)).json() as Json;
    expect(m.extensions).toMatchObject({ exercised: 1, remaining: 0 });
    expect(m.extensions.list[0]).toMatchObject({ exercised: true, requestNumber: ext.json().request.number });
    expect(m.procurements.map((p: Json) => p.kind).sort()).toEqual(['EXTEND', 'RENEW']);
    const draft = (await call('legal', 'GET', `/contracts/${ext.json().variation.id}`)).json() as Json;
    expect(draft.endDate > view.endDate).toBe(true);
    expect(draft.variation.linkedRequestId).toBe(ext.json().request.id);
    expect(
      (
        await call('contract-mgr', 'POST', `/contracts/${id}/procurements`, {
          kind: 'EXTEND',
          note: 'Take it up again',
        })
      ).json().code,
    ).toBe('NO_EXTENSION');
    // a procurement to vary the contract can be named on the variation
    const vary = await call('contract-mgr', 'POST', `/contracts/${id}/procurements`, {
      kind: 'VARY',
      note: 'Add the annexe',
      value: 5_000,
    });
    expect(vary.statusCode).toBe(201);
    expect(
      (
        await call('legal', 'POST', `/contracts/${id}/variations`, {
          reason: 'Another change',
          value: 1_000,
          requestId: '00000000-0000-4000-8000-000000000000',
        })
      ).json().code,
    ).toBe('PROCUREMENT_NOT_LINKED');
    expect(await auditActions(id)).toContain('contract.procurement_link');
  });

  it('gives a variation its own procurement number where the organisation treats each one as a new procurement', async () => {
    await cm({ variationNumbering: 'NEW_PROCUREMENT' });
    const { id } = await env.executed({ value: 100_000 });
    const v = await call('legal', 'POST', `/contracts/${id}/variations`, {
      reason: 'Treated as its own procurement',
      value: 4_000,
    });
    expect(v.statusCode, v.body).toBe(201);
    const linked = v.json().variation.linkedRequestId as string;
    expect(linked).toBeTruthy();
    const r = (await call('procurement', 'GET', `/requests/${linked}`)).json() as Json;
    expect(r.number).toMatch(/^PR-/);
    const m = (await call('contract-mgr', 'GET', `/contracts/${id}/management`)).json() as Json;
    expect(m.procurements.map((p: Json) => p.id)).toContain(linked);
    await cm();
  });
});

describe('FR-0575 master agreements and work orders', () => {
  async function master(value: number) {
    const made = await call('legal', 'POST', '/contracts/documents', {
      docType: 'MASTER',
      supplierId: BRIGHT,
      title: 'Master services agreement',
      text: 'The Supplier provides services under work orders issued under this master agreement. Each work order is a separate engagement.',
    });
    expect(made.statusCode, made.body).toBe(201);
    const id = made.json().id as string;
    expect((await call('legal', 'PATCH', `/contracts/${id}`, { value })).statusCode).toBe(200);
    expect((await call('legal', 'POST', `/contracts/${id}/release-for-signing`)).statusCode).toBe(200);
    expect(
      (await call('delegate', 'POST', `/contracts/${id}/sign`, { decision: 'APPROVE' })).json().status,
    ).toBe('EXECUTED');
    return id;
  }

  it('links work orders to their master agreement within its value and term, and reports at both levels', async () => {
    const id = await master(500_000);
    const num = ((await call('legal', 'GET', `/contracts/${id}`)).json() as Json).number as string;
    const wo = (title: string, value: number, extra = {}) =>
      call('contract-mgr', 'POST', `/contracts/${id}/work-orders`, {
        title,
        value,
        startDate: '2026-11-01',
        endDate: '2027-05-31',
        ...extra,
      });
    expect((await call('requester', 'POST', `/contracts/${id}/work-orders`, {})).statusCode).toBe(403);
    const a = await wo('Lobby refurbishment', 300_000);
    expect(a.statusCode, a.body).toBe(201);
    expect(a.json()).toMatchObject({ number: `WO-${num}-001`, value: 300_000, status: 'OPEN' });
    expect((await wo('Car park resurfacing', 150_000)).statusCode).toBe(201);
    const over = await wo('Roof repairs', 100_000);
    expect(over.statusCode).toBe(422);
    expect(over.json().code).toBe('WORK_ORDER_OVER_MASTER');
    expect((await wo('Too late', 10_000, { endDate: '2040-01-01' })).json().code).toBe(
      'WORK_ORDER_OUTSIDE_TERM',
    );
    // a contract that is not a master agreement has no work orders
    const plain = await env.executed();
    expect(
      (
        await call('contract-mgr', 'POST', `/contracts/${plain.id}/work-orders`, {
          title: 'Nope',
          value: 1,
          startDate: '2026-11-01',
          endDate: '2026-12-01',
        })
      ).json().code,
    ).toBe('NOT_A_MASTER');

    // orders and invoices at work-order level
    await rates(id, [{ item: 'Labour hour', unitPrice: 100 }]);
    const woId = a.json().id as string;
    const p = await po(id, [{ item: 'Labour hour', qty: 1000, unitPrice: 100 }], { workOrderId: woId });
    expect(p.statusCode, p.body).toBe(201);
    expect(
      (await po(id, [{ item: 'Labour hour', qty: 3000, unitPrice: 100 }], { workOrderId: woId })).json().code,
    ).toBe('SPEND_CEILING'); // 100,000 + 300,000 is above the work order's 300,000
    const bill = await inv(id, {
      invoiceDate: '2026-12-01',
      poId: p.json().id,
      lines: [{ item: 'Labour hour', qty: 400, unitPrice: 100 }],
    });
    expect(bill.json().invoice).toMatchObject({ status: 'MATCHED', amount: 40_000, workOrderId: woId });

    const detail = (await call('procurement', 'GET', `/contracts/${id}/work-orders`)).json() as Json;
    expect(detail.master).toMatchObject({ number: num, value: 500_000 });
    expect(detail.orders[0]).toMatchObject({ committed: 100_000, invoiced: 40_000 });
    expect(detail.totals).toMatchObject({ allocated: 450_000, unallocated: 50_000, invoiced: 40_000 });
    const report = (await call('finance', 'GET', '/reports/master-agreements')).json() as Json;
    const m = report.masters.find((x: Json) => x.id === id);
    expect(m).toMatchObject({ workOrders: 2, allocated: 450_000, invoiced: 40_000 });
    expect(report.workOrders.filter((w: Json) => w.masterId === id)).toHaveLength(2);

    const closed = await call('contract-mgr', 'PATCH', `/work-orders/${woId}`, { status: 'COMPLETE' });
    expect(closed.json().status).toBe('COMPLETE');
    expect(
      (await po(id, [{ item: 'Labour hour', qty: 1, unitPrice: 100 }], { workOrderId: woId })).json().code,
    ).toBe('WORK_ORDER_NOT_OPEN');
    expect(await auditActions(id)).toEqual(
      expect.arrayContaining(['contract.work_order_create', 'contract.work_order_status']),
    );
  });
});

describe('FR-0555 contract management and risk plans', () => {
  it('auto-populates both plans and their activities for a high-value contract, scaled to its risk, and completes activities', async () => {
    await cm({ highValueAud: 100_000 });
    const { id, view } = await env.executed({ value: 120_000 });
    const pl = (await call('contract-mgr', 'GET', `/contracts/${id}/plans`)).json() as Json;
    expect(pl.tier).toBe('ELEVATED');
    expect(pl.reasons[0]).toMatch(/high-value line/);
    expect(pl.plans.map((x: Json) => `${x.kind}:${x.template}`).sort()).toEqual([
      'CMP:STANDARD',
      'RMP:STANDARD',
    ]);
    expect(pl.plans[0].sections[0].text).toContain(view.number);
    expect(pl.activities.length).toBeGreaterThan(8);
    expect(pl.activities[0].owner).toBe('Sofia Rossi');
    expect((await notes('contract-mgr', id)).some((n) => n.title === 'Contract management plans ready')).toBe(
      true,
    );
    const first = pl.activities[0] as Json;
    expect(
      (await call('requester', 'POST', `/contracts/${id}/activities/${first.id}/complete`, {})).statusCode,
    ).toBe(403);
    const done = await call('contract-mgr', 'POST', `/contracts/${id}/activities/${first.id}/complete`, {
      note: 'Held on site',
    });
    expect(done.json().activities.find((a: Json) => a.id === first.id)).toMatchObject({
      status: 'DONE',
      note: 'Held on site',
    });
    expect(
      (await call('contract-mgr', 'POST', `/contracts/${id}/activities/${first.id}/complete`, {})).statusCode,
    ).toBe(409);
    expect(await auditActions(id)).toEqual(
      expect.arrayContaining(['contract.plans_generate', 'contract.activity_complete']),
    );
    await cm();

    // a smaller contract gets no plans until someone asks, and fewer activities than a larger one over the same term
    const small = await env.executed({ value: 120_000 });
    expect(
      ((await call('contract-mgr', 'GET', `/contracts/${small.id}/plans`)).json() as Json).plans,
    ).toEqual([]);
    const gen = await call('contract-mgr', 'POST', `/contracts/${small.id}/plans/generate`);
    expect(gen.statusCode, gen.body).toBe(201);
    expect(gen.json().generated.tier).toBe('STANDARD');
    const std = (await call('contract-mgr', 'GET', `/contracts/${small.id}/plans`)).json() as Json;
    expect(std.tier).toBe('STANDARD');
    expect(std.activities.length).toBeLessThan(pl.activities.length);
  });

  it('uses a template the customer uploaded in place of the standard one, with the contract details filled in', async () => {
    const { id, view } = await env.executed();
    const t = await call('contract-mgr', 'GET', '/contract-plan-templates');
    expect(t.json().standard.CMP.length).toBeGreaterThan(3);
    expect(t.json().placeholders).toContain('SUPPLIER');
    expect((await call('requester', 'GET', '/contract-plan-templates')).statusCode).toBe(403);
    const up = await call('contract-mgr', 'PUT', '/contract-plan-templates/CMP', {
      name: 'Meridian contract management plan',
      text: '## Our approach\nWe manage {{CONTRACT}} with {{SUPPLIER}} through {{OWNER}}.\n\n## Review rhythm\nMonthly check-ins for the {{TIER}} tier.',
    });
    expect(up.statusCode, up.body).toBe(200);
    expect(up.json().custom).toHaveLength(1);
    expect(
      (
        await call('contract-mgr', 'PUT', '/contract-plan-templates/CMP', {
          name: 'Bad',
          text: 'No headings here at all, just words.',
        })
      ).statusCode,
    ).toBe(400);
    const gen = await call('contract-mgr', 'POST', `/contracts/${id}/plans/generate`);
    expect(gen.statusCode, gen.body).toBe(201);
    const cmp = (gen.json().plans as Json[]).find((p) => p.kind === 'CMP')!;
    expect(cmp.template).toBe('CUSTOM');
    expect(cmp.sections.map((x: Json) => x.title)).toEqual(['Our approach', 'Review rhythm']);
    expect(cmp.sections[0].text).toBe(
      `We manage ${view.number} with ${(await call('legal', 'GET', `/contracts/${id}`)).json().supplierName} through Sofia Rossi.`,
    );
    expect((gen.json().plans as Json[]).find((p) => p.kind === 'RMP')!.template).toBe('STANDARD');
    const gone = await call('contract-mgr', 'DELETE', '/contract-plan-templates/CMP');
    expect(gone.json().custom).toEqual([]);
  });
});

describe('FR-0560 my contracts, and suggestions as the end date approaches', () => {
  it('searches only the contracts of the person and their team, down the organisation hierarchy', async () => {
    const mine = await env.executed();
    const theirs = await env.executed();
    const stranger = await env.extraUser('elsewhere', 'CONTRACT_MGR');
    await call('legal', 'PUT', `/contracts/${theirs.id}/owner`, { ownerId: stranger.id });

    const ids = async (who: string) =>
      ((await call(who, 'GET', '/contracts/search')).json() as Json).items.map((i: Json) => i.id) as string[];
    const sofia = await call('contract-mgr', 'GET', '/contracts/search');
    expect(sofia.json().scope).toBe('TEAM');
    expect(await ids('contract-mgr')).toContain(mine.id);
    expect(await ids('contract-mgr')).not.toContain(theirs.id);
    expect((await call('contract-mgr', 'GET', `/contracts/${theirs.id}`)).statusCode).toBe(404);
    expect(
      ((await call('contract-mgr', 'GET', '/contracts')).json() as Json[]).map((c) => c.id),
    ).not.toContain(theirs.id);
    expect((await call('contract-mgr', 'GET', `/contracts/${theirs.id}/spend`)).statusCode).toBe(404);
    // legal and procurement see everything
    expect(await ids('legal')).toEqual(expect.arrayContaining([mine.id, theirs.id]));
    expect(((await call('legal', 'GET', '/contracts/search')).json() as Json).scope).toBe('ALL');
    expect(await ids(stranger.email)).toContain(theirs.id);

    // the team: someone in the same unit, or in a unit beneath it, counts; one in another branch does not
    const [sofiaRow] = await env.withSystem(env.database, (tx) =>
      tx
        .select()
        .from(s.appUser)
        .where(eq(s.appUser.id, uid('user:contract-mgr'))),
    );
    const unit = sofiaRow!.orgUnitId!;
    const child = await env.withSystem(env.database, async (tx) => {
      const [u] = await tx
        .insert(s.orgUnit)
        .values({ tenantId: TENANT_ID, name: 'Facilities - Night shift', parentId: unit })
        .returning();
      return u!.id;
    });
    const sameUnit = await env.extraUser('teammate', 'CONTRACT_MGR');
    const beneath = await env.extraUser('beneath', 'CONTRACT_MGR');
    await env.withSystem(env.database, async (tx) => {
      await tx.update(s.appUser).set({ orgUnitId: unit }).where(eq(s.appUser.id, sameUnit.id));
      await tx.update(s.appUser).set({ orgUnitId: child }).where(eq(s.appUser.id, beneath.id));
    });
    const a = await env.executed();
    const b = await env.executed();
    await call('legal', 'PUT', `/contracts/${a.id}/owner`, { ownerId: sameUnit.id });
    await call('legal', 'PUT', `/contracts/${b.id}/owner`, { ownerId: beneath.id });
    expect(await ids('contract-mgr')).toEqual(expect.arrayContaining([a.id, b.id]));
    // the person beneath does not see their manager's contracts
    expect(await ids(beneath.email)).toContain(b.id);
    expect(await ids(beneath.email)).not.toContain(mine.id);
  });

  it('suggests next steps as a contract approaches its end date, and nothing far from it', async () => {
    const { id, view } = await env.executed();
    const far = ((await call('contract-mgr', 'GET', '/contracts/search')).json() as Json).items.find(
      (i: Json) => i.id === id,
    );
    expect(far.nextStep).toBeNull();
    at(addDays(view.endDate as string, -100));
    const res = (await call('contract-mgr', 'GET', '/contracts/search?endingWithinDays=120')).json() as Json;
    const item = res.items.find((i: Json) => i.id === id);
    expect(item).toMatchObject({ daysToEnd: 100 });
    expect(item.nextStep).toMatchObject({ action: 'EXTEND', priority: 'HIGH' });
    expect(item.nextStep.text).toMatch(/next extension \(12 months\) by /);
    const m = (await call('contract-mgr', 'GET', `/contracts/${id}/management`)).json() as Json;
    expect(m.nextSteps.model).toBe('rules-simulated-v1');
    expect(m.nextSteps.steps.map((x: Json) => x.action)).toEqual(
      expect.arrayContaining(['EXTEND', 'NOTICE']),
    );
    expect(
      ((await call('contract-mgr', 'GET', '/contracts/search?endingWithinDays=30')).json() as Json).items.map(
        (i: Json) => i.id,
      ),
    ).not.toContain(id);
    back();
  });
});

describe('FR-0585 funding envelopes', () => {
  it('lets the delegate approve an envelope within their authority, lets nominated people commit against it, and warns as it nears exhaustion', async () => {
    const nominee = await env.extraUser('nominee', 'PROCUREMENT');
    expect((await call('requester', 'POST', '/envelopes', { name: 'X', amount: 1000 })).statusCode).toBe(403);
    // the delegate's sourcing authority is 250,000
    const tooBig = await call('delegate', 'POST', '/envelopes', {
      name: 'Facilities programme',
      amount: 400_000,
      nominees: [nominee.id],
    });
    expect(tooBig.statusCode).toBe(403);
    expect(tooBig.json().code).toBe('DELEGATION_EXCEEDED');
    expect(tooBig.json().title).toMatch(/above your delegated authority of \$250,000/);
    expect(
      (
        await call('delegate', 'POST', '/envelopes', {
          name: 'Facilities programme',
          amount: 100_000,
          nominees: [uid('user:supplier')],
        })
      ).json().code,
    ).toBe('INVALID_NOMINEE');
    const made = await call('delegate', 'POST', '/envelopes', {
      name: 'Facilities programme',
      amount: 100_000,
      nominees: [nominee.id],
      warnPct: 80,
    });
    expect(made.statusCode, made.body).toBe(201);
    const e = made.json() as Json;
    expect(e).toMatchObject({
      amount: 100_000,
      committed: 0,
      remaining: 100_000,
      canCommit: true,
      holder: { name: 'Dana Okafor' },
    });
    expect((await notes(nominee.email.split('@')[0]!, '/app/envelopes')).length).toBe(0); // keyed by seeded users only
    const told = await env.withSystem(env.database, (tx) =>
      tx.select().from(s.notification).where(eq(s.notification.userId, nominee.id)),
    );
    expect(told.some((n) => n.title.startsWith('You can approve commitments'))).toBe(true);

    // the nominee commits; others cannot
    const c1 = await call(nominee.email, 'POST', `/envelopes/${e.id}/commitments`, {
      description: 'Cleaning contract top-up',
      amount: 70_000,
    });
    expect(c1.statusCode, c1.body).toBe(201);
    expect(c1.json()).toMatchObject({ committed: 70_000, remaining: 30_000, usedPct: 70, warning: null });
    expect(
      (
        await call('finance', 'POST', `/envelopes/${e.id}/commitments`, {
          description: 'Not nominated',
          amount: 100,
        })
      ).statusCode,
    ).toBe(403);
    expect((await call('requester', 'GET', `/envelopes/${e.id}`)).statusCode).toBe(404);
    const c2 = await call(nominee.email, 'POST', `/envelopes/${e.id}/commitments`, {
      description: 'Security guards',
      amount: 15_000,
    });
    expect(c2.json().warning).toMatch(/85% committed .* Seek further delegate approval/);
    expect(
      (await notes('delegate', '/app/envelopes')).some((n) => n.title === 'Funding envelope nearly used'),
    ).toBe(true);
    // one warning only, until the envelope is topped up
    await call(nominee.email, 'POST', `/envelopes/${e.id}/commitments`, {
      description: 'Small item',
      amount: 1_000,
    });
    expect(
      (await notes('delegate', '/app/envelopes')).filter((n) => n.title === 'Funding envelope nearly used'),
    ).toHaveLength(1);
    // more than is left is refused, with who to ask
    const over = await call(nominee.email, 'POST', `/envelopes/${e.id}/commitments`, {
      description: 'Big item',
      amount: 20_000,
    });
    expect(over.statusCode).toBe(422);
    expect(over.json().code).toBe('ENVELOPE_EXHAUSTED');
    expect(over.json().title).toMatch(/ask Dana Okafor for further approval/);
    // the delegate adds to it, within authority
    expect(
      (await call('delegate', 'POST', `/envelopes/${e.id}/top-up`, { amount: 200_000 })).json().code,
    ).toBe('DELEGATION_EXCEEDED');
    const top = await call('delegate', 'POST', `/envelopes/${e.id}/top-up`, { amount: 100_000 });
    expect(top.statusCode, top.body).toBe(200);
    expect(top.json()).toMatchObject({ amount: 200_000, remaining: 114_000 });
    expect(
      (
        await call(nominee.email, 'POST', `/envelopes/${e.id}/commitments`, {
          description: 'Big item',
          amount: 20_000,
        })
      ).statusCode,
    ).toBe(201);
    // who sees it
    expect(((await call('exec', 'GET', '/envelopes')).json() as Json[]).map((x) => x.id)).toContain(e.id);
    expect(((await call('finance', 'GET', '/envelopes')).json() as Json[]).map((x) => x.id)).toContain(e.id);
    expect(((await call(nominee.email, 'GET', '/envelopes')).json() as Json[])[0]!.mine).toBe('NOMINEE');
    expect(await auditActions(e.id)).toEqual(
      expect.arrayContaining(['envelope.create', 'envelope.commit', 'envelope.top_up']),
    );
    const denied = await env.withSystem(env.database, (tx) =>
      tx
        .select()
        .from(s.auditEvent)
        .where(and(eq(s.auditEvent.entityId, e.id), eq(s.auditEvent.result, 'DENIED'))),
    );
    expect(denied.map((x) => x.action)).toEqual(
      expect.arrayContaining(['envelope.commit', 'envelope.top_up']),
    );
    const rows = await env.withSystem(env.database, (tx) =>
      tx.select().from(s.envelopeCommitment).where(like(s.envelopeCommitment.description, '%')),
    );
    expect(rows.length).toBeGreaterThanOrEqual(4);
  });
});
