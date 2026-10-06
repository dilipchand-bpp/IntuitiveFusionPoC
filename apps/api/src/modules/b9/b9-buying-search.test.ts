import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../../audit/audit-service.js';
import * as s from '../../db/schema.js';
import { TENANT_ID } from '../../db/seed.js';
import { createEnv, type Json } from '../contract/test-env.js';
import { noteChange, runDue } from './artefacts.js';
import { sanitise } from './search.js';
import { matching, scoreCandidates, standingOf, tokensOf, type Candidate } from './buying.js';

let env: Awaited<ReturnType<typeof createEnv>>;
const call = (...a: Parameters<typeof env.call>) => env.call(...a);
beforeAll(async () => {
  env = await createEnv();
}, 120_000);
const setting = async (name: string, value: unknown) => {
  const r = await call('admin', 'PUT', '/admin/settings', { [name]: value });
  expect(r.statusCode, r.body).toBe(200);
};

const cand = (o: Partial<Candidate>): Candidate => ({
  itemId: 'i',
  sku: 'S',
  name: 'Paper',
  category: 'Office supplies',
  supplierId: 's',
  supplier: 'X',
  unit: 'ream',
  unitPrice: 5,
  leadDays: 0,
  standing: 80,
  ...o,
});

describe('FR-0820 the buying rules', () => {
  it('matches the words of a need to items, ignoring filler, and tolerates plurals', () => {
    expect(tokensOf('We need some new paper please')).toEqual(['paper']);
    const items = [cand({ name: 'Copy paper' }), cand({ name: 'Bin liners', category: 'Cleaning' })];
    expect(matching('reams of papers', items).map((i) => i.name)).toEqual(['Copy paper']);
    expect(matching('the', items)).toEqual([]);
  });
  it('weights price 50%, standing 30%, delivery 20%, and says why', () => {
    const [a, b] = scoreCandidates(
      [
        cand({ itemId: 'a', unitPrice: 5, leadDays: 14, standing: 100 }),
        cand({ itemId: 'b', unitPrice: 10, leadDays: 0, standing: 100 }),
      ],
      10,
    );
    expect(a!.itemId).toBe('a'); // 50 + 30 + 0 = 80 against 25 + 30 + 20 = 75
    expect(a!.score).toBe(80);
    expect(b!.score).toBe(75);
    expect(a!.why[0]).toBe('lowest total price');
    expect(b!.why[0]).toBe('100% dearer than the cheapest');
    expect(a!.total).toBe(50);
    expect(scoreCandidates([], 3)).toEqual([]);
  });
  it('rates standing from the enterprise rating and the insurance', () => {
    expect(standingOf(null, 'CURRENT')).toBe(76);
    expect(standingOf(5, 'CURRENT')).toBe(100);
    expect(standingOf(5, 'EXPIRING')).toBe(84);
    expect(standingOf(1, 'EXPIRED')).toBe(12);
  });
});

describe('FR-0820 guided buying and autonomous sourcing', () => {
  it('lists the catalogue, leaving the supplier that is on hold unorderable', async () => {
    const r = (await call('requester', 'GET', '/catalogue?q=paper')).json() as Json;
    expect(r.categories).toEqual(expect.arrayContaining(['Office supplies', 'Safety equipment']));
    expect(r.items).toHaveLength(4);
    const summit = r.items.find((i: Json) => i.supplier.startsWith('Summit'));
    expect(summit).toMatchObject({
      orderable: false,
      notOrderableBecause: 'The supplier is on hold after screening',
    });
    expect((await call('supplier', 'GET', '/catalogue')).statusCode).toBe(403);
  });

  it('recommends the best of the approved suppliers, never the one on hold, and drafts only when a person decides', async () => {
    const p = await call('requester', 'POST', '/buying/auto-source', {
      need: 'copy paper for the office',
      quantity: 200,
    });
    expect(p.statusCode, p.body).toBe(201);
    const v = p.json() as Json;
    expect(v).toMatchObject({ status: 'PROPOSED', withinLimit: true, model: 'rules-simulated-v1' });
    expect(v.shortlist).toHaveLength(3);
    expect(v.shortlist.some((x: Json) => x.supplier.startsWith('Summit'))).toBe(false);
    expect(v.shortlist[0].supplier).toBe('Northstar Property Care Pty Ltd');
    expect(v.recommendedItemId).toBe(v.shortlist[0].itemId);
    expect(v.total).toBe(900);
    // nothing has been ordered yet
    expect(v.requestId).toBeNull();
    const ok = (
      await call('requester', 'POST', `/buying/proposals/${v.id}/decision`, {
        decision: 'APPROVE',
        businessUnit: 'Facilities',
      })
    ).json() as Json;
    expect(ok).toMatchObject({ status: 'ORDERED' });
    const req = (await call('requester', 'GET', `/requests/${ok.requestId}`)).json() as Json;
    expect(req).toMatchObject({ status: 'DRAFT', estimatedValue: 900 });
    expect(req.title).toMatch(/^Catalogue purchase: Recycled A4 copy paper/);
    expect(
      (await call('requester', 'POST', `/buying/proposals/${v.id}/decision`, { decision: 'APPROVE' }))
        .statusCode,
    ).toBe(409);
  });

  it('refuses a purchase over the limit the organisation set, and one nobody could match', async () => {
    const big = (
      await call('requester', 'POST', '/buying/auto-source', { need: 'copy paper', quantity: 2000 })
    ).json() as Json;
    expect(big).toMatchObject({ total: 9000, withinLimit: false, limit: 5000 });
    const refused = await call('requester', 'POST', `/buying/proposals/${big.id}/decision`, {
      decision: 'APPROVE',
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe('OVER_LIMIT');
    const none = (
      await call('requester', 'POST', '/buying/auto-source', { need: 'helicopter', quantity: 1 })
    ).json() as Json;
    expect(none).toMatchObject({ status: 'NO_MATCH', recommendedItemId: null, shortlist: [] });
    // a raised limit lets the same proposal through
    await setting('buying', { enabled: true, autoSourceLimitAud: 20000 });
    const again = (
      await call('requester', 'POST', `/buying/proposals/${big.id}/decision`, { decision: 'APPROVE' })
    ).json() as Json;
    expect(again.status).toBe('ORDERED');
    await setting('buying', { enabled: true, autoSourceLimitAud: 5000 });
  });

  it('shows a requester their own proposals only, lets them reject, and does not order from a supplier put on hold since', async () => {
    const mine = (await call('requester', 'GET', '/buying/proposals')).json() as Json[];
    expect(mine.length).toBeGreaterThanOrEqual(3);
    const other = await env.extraUser('other-buyer', 'REQUESTER');
    expect((await call(other.email, 'GET', '/buying/proposals')).json() as Json[]).toEqual([]);
    const p = (
      await call('requester', 'POST', '/buying/auto-source', { need: 'work gloves', quantity: 10 })
    ).json() as Json;
    expect(
      (await call(other.email, 'POST', `/buying/proposals/${p.id}/decision`, { decision: 'REJECT' }))
        .statusCode,
    ).toBe(404);
    const rej = (
      await call('requester', 'POST', `/buying/proposals/${p.id}/decision`, { decision: 'REJECT' })
    ).json() as Json;
    expect(rej.status).toBe('REJECTED');
    const q = (
      await call('requester', 'POST', '/buying/auto-source', { need: 'work gloves', quantity: 10 })
    ).json() as Json;
    await env.withSystem(env.database, (tx) =>
      tx
        .update(s.supplier)
        .set({ sanctionsStatus: 'MATCH' })
        .where(eq(s.supplier.company, 'Northstar Property Care Pty Ltd')),
    );
    const blocked = await call('requester', 'POST', `/buying/proposals/${q.id}/decision`, {
      decision: 'APPROVE',
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('SUPPLIER_NOT_APPROVED');
    await env.withSystem(env.database, (tx) =>
      tx
        .update(s.supplier)
        .set({ sanctionsStatus: 'CLEAR' })
        .where(eq(s.supplier.company, 'Northstar Property Care Pty Ltd')),
    );
  });

  it('orders from chosen catalogue lines, and procurement alone manages the catalogue', async () => {
    const items = ((await call('requester', 'GET', '/catalogue?q=gloves')).json() as Json).items as Json[];
    const o = await call('requester', 'POST', '/buying/orders', {
      lines: [{ itemId: items[0]!.itemId, qty: 4 }],
      businessUnit: 'Facilities',
    });
    expect(o.statusCode, o.body).toBe(201);
    expect(o.json().total).toBe(39);
    const summit = ((await call('requester', 'GET', '/catalogue?q=paper')).json() as Json).items.find(
      (i: Json) => !i.orderable,
    );
    expect(
      (
        await call('requester', 'POST', '/buying/orders', {
          lines: [{ itemId: summit.itemId, qty: 1 }],
          businessUnit: 'Facilities',
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await call('requester', 'PATCH', `/catalogue/${items[0]!.itemId}`, { unitPrice: 1 })).statusCode,
    ).toBe(403);
    const upd = await call('procurement', 'PATCH', `/catalogue/${items[0]!.itemId}`, { unitPrice: 10.25 });
    expect(upd.statusCode).toBe(200);
    const add = await call('procurement', 'POST', '/catalogue', {
      supplierId: summit.supplierId,
      sku: 'X1',
      name: 'Staples, box',
      category: 'Office supplies',
      unitPrice: 2,
    });
    expect(add.statusCode).toBe(201);
    expect(
      (
        await call('procurement', 'POST', '/catalogue', {
          supplierId: summit.supplierId,
          sku: 'X1',
          name: 'Staples, box',
          category: 'Office supplies',
          unitPrice: 2,
        })
      ).statusCode,
    ).toBe(409);
    await setting('buying', { enabled: false, autoSourceLimitAud: 5000 });
    expect(
      (await call('requester', 'POST', '/buying/auto-source', { need: 'copy paper', quantity: 1 }))
        .statusCode,
    ).toBe(409);
    await setting('buying', { enabled: true, autoSourceLimitAud: 5000 });
  });
});

describe('FR-0870 and NFR-P02 artefacts follow the records at the speed the organisation chose', () => {
  const audit = () => new AuditService(env.clock);
  const state = async (id: string) =>
    (await call('contract-mgr', 'GET', `/artefacts/CONTRACT_PLANS/${id}/state`)).json() as Json;
  const change = (id: string, why: string) =>
    env.withSystem(env.database, (tx) =>
      noteChange(
        tx,
        { audit: audit(), clock: env.clock },
        TENANT_ID,
        'CONTRACT_PLANS',
        id,
        why,
        env.clock.now(),
      ),
    );

  it('REALTIME rewrites at once', async () => {
    await setting('artefacts', { laterStage: 'REALTIME', batchMinutes: 10 });
    const { id } = await env.executed({ value: 120_000 });
    const before = await state(id);
    expect(await change(id, 'A variation was signed')).toBe('REFRESHED');
    const st = await state(id);
    expect(st).toMatchObject({ mode: 'REALTIME', stale: false, model: 'rules-simulated-v1' });
    expect(st.refreshCount).toBe(before.refreshCount + 1);
  });

  it('BATCHED waits for the interval, then one run covers every change', async () => {
    await setting('artefacts', { laterStage: 'BATCHED', batchMinutes: 10 });
    const { id } = await env.executed({ value: 120_000 });
    const base = (await state(id)).refreshCount;
    expect(await change(id, 'first')).toBe('STALE');
    expect(await change(id, 'second')).toBe('STALE');
    const st = await state(id);
    expect(st).toMatchObject({ stale: true, reason: 'second' });
    expect(st.nextRefreshAt).not.toBeNull();
    env.clock.advanceMs(6 * 60_000);
    expect(await runDue(env.database, { audit: audit(), clock: env.clock }, env.clock.now())).toBe(0);
    env.clock.advanceMs(6 * 60_000);
    // looking at it after the interval brings it up to date
    const after = await state(id);
    expect(after).toMatchObject({ stale: false, refreshCount: base + 1, nextRefreshAt: null });
  });

  it('MANUAL leaves it marked out of date until someone refreshes it', async () => {
    await setting('artefacts', { laterStage: 'MANUAL', batchMinutes: 10 });
    const { id } = await env.executed({ value: 120_000 });
    expect(await change(id, 'edited')).toBe('STALE');
    env.clock.advanceMs(60 * 60_000);
    expect((await state(id)).stale).toBe(true);
    expect((await call('requester', 'POST', `/artefacts/CONTRACT_PLANS/${id}/refresh`)).statusCode).toBe(403);
    expect((await call('contract-mgr', 'POST', `/artefacts/CONTRACT_PLANS/${id}/refresh`)).statusCode).toBe(
      200,
    );
    expect(await state(id)).toMatchObject({ stale: false });
    expect((await call('contract-mgr', 'GET', `/artefacts/NOPE/${id}/state`)).statusCode).toBe(400);
    await setting('artefacts', { laterStage: 'REALTIME', batchMinutes: 10 });
  });
});

describe('FR-0880 search, with an outside source only when allowed', () => {
  it('sanitises: reference numbers, ABNs, emails, amounts and supplier names never leave', () => {
    const r = sanitise(
      'Is PR-2026-0001 with Brightwave Cleaning Pty Ltd (ABN 51 824 753 556, a@b.example) at $1.2m fair for cleaning?',
      ['Brightwave Cleaning Pty Ltd'],
    );
    expect(r.sent).toContain('fair for cleaning?');
    expect(r.withheld.map((w) => w.split(':')[0]).sort()).toEqual([
      'ABN',
      'amount',
      'email',
      'reference',
      'supplier name',
    ]);
    expect(r.sent).not.toMatch(/Brightwave|PR-2026|51 824|\$1/);
  });

  it("searches the person's own records by the same visibility as elsewhere", async () => {
    const proc = (await call('procurement', 'POST', '/search', { query: 'cleaning' })).json() as Json;
    expect(proc.groups.map((g: Json) => g.kind)).toEqual(expect.arrayContaining(['REQUEST', 'SUPPLIER']));
    expect(proc.external).toMatchObject({ enabled: false, asked: false, simulated: true });
    // a requester does not see suppliers, and only their own requests
    const req = (await call('requester', 'POST', '/search', { query: 'cleaning' })).json() as Json;
    expect(req.groups.some((g: Json) => g.kind === 'SUPPLIER')).toBe(false);
    const other = await env.extraUser('other-searcher', 'REQUESTER');
    expect(
      ((await call(other.email, 'POST', '/search', { query: 'cleaning' })).json() as Json).groups.some(
        (g: Json) => g.kind === 'REQUEST',
      ),
    ).toBe(false);
    expect((await call('supplier', 'POST', '/search', { query: 'cleaning' })).statusCode).toBe(403);
    expect((await call('requester', 'POST', '/search', { query: 'a' })).statusCode).toBe(400);
  });

  it('says outside search is off, and when on sends only the cleaned question and logs it', async () => {
    const off = (
      await call('procurement', 'POST', '/search', {
        query: 'cleaning price benchmark',
        includeExternal: true,
      })
    ).json() as Json;
    expect(off.external.asked).toBe(false);
    expect(off.external.note).toMatch(/switched off/);
    await setting('externalSearch', { enabled: true });
    const on = (
      await call('procurement', 'POST', '/search', {
        query: 'Is Brightwave Cleaning at $90,000 fair for commercial cleaning PR-2026-0001?',
        includeExternal: true,
      })
    ).json() as Json;
    expect(on.external).toMatchObject({ asked: true, simulated: true });
    expect(on.external.sent).not.toMatch(/Brightwave|\$90|PR-2026/);
    expect(on.external.withheld).toHaveLength(3);
    expect(on.external.hits[0].title).toMatch(/cleaning/i);
    const log = (await call('probity', 'GET', '/search/external-log')).json() as Json[];
    expect(log[0]).toMatchObject({ sent: on.external.sent });
    expect(JSON.stringify(log)).not.toContain('Brightwave Cleaning Pty');
    expect((await call('requester', 'GET', '/search/external-log')).statusCode).toBe(403);
    const empty = (
      await call('procurement', 'POST', '/search', { query: 'PR-2026-0001', includeExternal: true })
    ).json() as Json;
    expect(empty.external).toMatchObject({ asked: false });
    expect(empty.external.note).toMatch(/nothing was sent/i);
    await setting('externalSearch', { enabled: false });
  });
});
