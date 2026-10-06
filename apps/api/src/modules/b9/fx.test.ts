import { beforeAll, describe, expect, it } from 'vitest';
import { createEnv, SEED_DATE, type Json } from '../contract/test-env.js';
import {
  ANCHORS,
  convert,
  financialYear,
  fyStart,
  isForeign,
  rateOn,
  simulatedLiveRate,
  toBase,
  type Rate,
} from './fx-rules.js';

describe('FR-0810 currency rules', () => {
  const rates: Rate[] = [
    { currency: 'USD', rate: 1.5, asOf: '2026-07-01', source: 'ANNUAL' },
    { currency: 'USD', rate: 1.6, asOf: '2027-07-01', source: 'ANNUAL' },
    { currency: 'EUR', rate: 1.7, asOf: '2026-07-01', source: 'ANNUAL' },
    { currency: 'USD', rate: 1.55, asOf: '2026-10-01', source: 'LIVE' },
  ];
  it('names the Australian financial year and its first day', () => {
    expect([financialYear('2026-06-30'), financialYear('2026-07-01'), financialYear('2027-01-15')]).toEqual([
      2026, 2027, 2027,
    ]);
    expect(fyStart(2027)).toBe('2026-07-01');
  });
  it('uses the rate set for the financial year in annual mode, and the latest in live mode', () => {
    expect(rateOn(rates, 'USD', '2026-12-01', 'ANNUAL')?.rate).toBe(1.5);
    expect(rateOn(rates, 'USD', '2027-08-01', 'ANNUAL')?.rate).toBe(1.6);
    expect(rateOn(rates, 'USD', '2026-12-01', 'LIVE')?.rate).toBe(1.55);
    // a year with no rate is not guessed from another
    expect(rateOn([rates[0]!], 'USD', '2027-08-01', 'ANNUAL')).toBeNull();
    expect(rateOn(rates, 'GBP', '2026-12-01', 'ANNUAL')).toBeNull();
  });
  it('converts to the base, keeps the original, and refuses when there is no rate', () => {
    expect(toBase(100, 'AUD', 'AUD', null)).toMatchObject({ base: 100, rate: 1 });
    expect(toBase(100_000, 'USD', 'AUD', rates[0]!)).toMatchObject({
      base: 150_000,
      original: 100_000,
      rate: 1.5,
      asOf: '2026-07-01',
    });
    expect(toBase(100, 'GBP', 'AUD', null)).toBeNull();
  });
  it('converts between two foreign currencies by way of the base', () => {
    expect(convert(150, 'USD', 'AUD', 'AUD', rates, '2026-12-01', 'ANNUAL')).toMatchObject({ amount: 225 });
    expect(convert(150, 'USD', 'EUR', 'AUD', rates, '2026-12-01', 'ANNUAL')?.amount).toBeCloseTo(
      (150 * 1.5) / 1.7,
      2,
    );
    expect(convert(5, 'USD', 'USD', 'AUD', rates, '2026-12-01', 'ANNUAL')?.amount).toBe(5);
    expect(convert(5, 'USD', 'GBP', 'AUD', rates, '2026-12-01', 'ANNUAL')).toBeNull();
  });
  it('a foreign currency is international spend; the base is local', () => {
    expect([isForeign('USD'), isForeign('AUD'), isForeign(null)]).toEqual([true, false, false]);
  });
  it('the simulated feed is repeatable, moves a little, and differs by day', () => {
    const a = simulatedLiveRate('USD', ANCHORS.USD!, '2026-10-06');
    expect(simulatedLiveRate('USD', ANCHORS.USD!, '2026-10-06')).toBe(a);
    expect(Math.abs(a / ANCHORS.USD! - 1)).toBeLessThan(0.04);
    expect(simulatedLiveRate('USD', ANCHORS.USD!, '2026-10-07')).not.toBe(a);
    expect(simulatedLiveRate('EUR', ANCHORS.EUR!, '2026-10-06')).not.toBe(
      simulatedLiveRate('USD', ANCHORS.USD!, '2026-10-06') * (ANCHORS.EUR! / ANCHORS.USD!),
    );
  });
});

let env: Awaited<ReturnType<typeof createEnv>>;
const call = (...a: Parameters<typeof env.call>) => env.call(...a);
beforeAll(async () => {
  env = await createEnv();
}, 120_000);
const setting = async (name: string, value: unknown) => {
  const r = await call('admin', 'PUT', '/admin/settings', { [name]: value });
  expect(r.statusCode, r.body).toBe(200);
};
const draft = async (body: Json) => {
  const c = await call('requester', 'POST', '/requests', {
    title: 'Currency fixture',
    category: 'IT managed services (UNSPSC 81111800)',
    termMonths: 24,
    businessUnit: 'Facilities',
    fields: { contractOwner: 'Sofia Rossi', background: 'Existing arrangements end in six months.' },
    ...body,
  });
  expect(c.statusCode, c.body).toBe(201);
  return c.json() as Json;
};

describe('FR-0810 amounts in a foreign currency', () => {
  it('lists the rates, lets finance set one, and refuses people who may not', async () => {
    const r = (await call('requester', 'GET', '/fx/rates')).json() as Json;
    expect(r).toMatchObject({ base: 'AUD', mode: 'ANNUAL', financialYear: 2027 });
    expect(r.current.find((c: Json) => c.currency === 'USD')).toMatchObject({ rate: 1.52, source: 'ANNUAL' });
    expect((await call('supplier', 'GET', '/fx/rates')).statusCode).toBe(403);
    expect((await call('requester', 'PUT', '/fx/rates', { currency: 'USD', rate: 1.6 })).statusCode).toBe(
      403,
    );
    expect((await call('finance', 'PUT', '/fx/rates', { currency: 'AUD', rate: 1 })).statusCode).toBe(400);
    expect((await call('finance', 'PUT', '/fx/rates', { currency: 'USD', rate: -2 })).statusCode).toBe(400);
    const set = await call('finance', 'PUT', '/fx/rates', { currency: 'NZD', rate: 0.93 });
    expect(set.json()).toMatchObject({ currency: 'NZD', rate: 0.93, asOf: '2026-07-01' });
    expect(
      ((await call('requester', 'GET', '/fx/rates')).json() as Json).current.find(
        (c: Json) => c.currency === 'NZD',
      ).rate,
    ).toBe(0.93);
    const conv = (await call('requester', 'GET', '/fx/convert?amount=1520&from=AUD&to=USD')).json() as Json;
    expect(conv.result).toBeCloseTo(1000, 1);
    expect((await call('requester', 'GET', '/fx/convert?amount=1&from=USD&to=EUR')).json().via).toBe('AUD');
  });

  it('converts a request typed in dollars of another country once, keeps the original and the rate, and keeps converting what is typed after', async () => {
    const v = await draft({ title: 'US licence renewal', estimatedValue: 100_000, currency: 'USD' });
    expect(v).toMatchObject({
      currency: 'USD',
      estimatedValue: 152_000,
      originalAmount: 100_000,
      fxRate: 1.52,
    });
    // the value alone, on a request in USD, is in USD
    const p = await call('requester', 'PATCH', `/requests/${v.id}`, { estimatedValue: 50_000 });
    expect(p.json()).toMatchObject({ currency: 'USD', estimatedValue: 76_000, originalAmount: 50_000 });
    // a different currency needs the amount in it
    const bad = await call('requester', 'PATCH', `/requests/${v.id}`, { currency: 'EUR' });
    expect(bad.statusCode).toBe(422);
    const eur = await call('requester', 'PATCH', `/requests/${v.id}`, {
      currency: 'EUR',
      estimatedValue: 40_000,
    });
    expect(eur.json()).toMatchObject({
      currency: 'EUR',
      estimatedValue: 66_000,
      originalAmount: 40_000,
      fxRate: 1.65,
    });
    // back to the base: the original and the rate are cleared
    const aud = await call('requester', 'PATCH', `/requests/${v.id}`, {
      currency: 'AUD',
      estimatedValue: 70_000,
    });
    const out = aud.json() as Json;
    expect(out).toMatchObject({ currency: 'AUD', estimatedValue: 70_000 });
    expect(out.originalAmount).toBeUndefined();
    expect(out.fxRate).toBeUndefined();
    expect((await call('requester', 'PATCH', `/requests/${v.id}`, { currency: 'XXX' })).statusCode).toBe(400);
  });

  it('never guesses a rate: in a financial year with none set, the request is refused until finance sets one', async () => {
    env.clock.advanceDays(300); // into the next financial year (from 2 October 2026 to late July 2027)
    const refused = await call('requester', 'POST', '/requests', {
      title: 'No rate fixture',
      estimatedValue: 10_000,
      currency: 'USD',
    });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().code).toBe('NO_FX_RATE');
    expect((await call('finance', 'PUT', '/fx/rates', { currency: 'USD', rate: 1.6 })).json().asOf).toBe(
      '2027-07-01',
    );
    const ok = await call('requester', 'POST', '/requests', {
      title: 'With a rate fixture',
      estimatedValue: 10_000,
      currency: 'USD',
    });
    expect(ok.json()).toMatchObject({ estimatedValue: 16_000, fxRate: 1.6 });
    env.clock.set(SEED_DATE);
  });

  it("live mode takes the day's rates from the feed, and the feed button works only in live mode", async () => {
    expect((await call('finance', 'POST', '/fx/refresh')).statusCode).toBe(409);
    await setting('currency', { base: 'AUD', rateMode: 'LIVE' });
    const live = (await call('requester', 'GET', '/fx/rates')).json() as Json;
    expect(live.mode).toBe('LIVE');
    for (const c of live.current) expect(c).toMatchObject({ source: 'LIVE', asOf: '2026-10-02' });
    const usd = live.current.find((c: Json) => c.currency === 'USD').rate as number;
    expect(Math.abs(usd / 1.52 - 1)).toBeLessThan(0.04);
    expect((await call('finance', 'POST', '/fx/refresh')).statusCode).toBe(200);
    const v = await draft({ title: 'Live rate fixture', estimatedValue: 1000, currency: 'USD' });
    expect(v.fxRate).toBe(usd);
    await setting('currency', { base: 'AUD', rateMode: 'ANNUAL' });
  });
});

describe('FR-0810 approval limits for local and international spend', () => {
  it("spend in a foreign currency is approved against the approver's international limit, and local spend against the local one", async () => {
    // 100,000 USD is 152,000 AUD: inside the delegate's local limit (250,000) but above the international one (100,000)
    const prep = async (body: Json) => {
      const v = await draft({
        title: `Limit fixture ${body.currency ?? 'AUD'}`,
        category: 'Building cleaning (UNSPSC 76111500)',
        ...body,
      });
      expect((await call('requester', 'POST', `/requests/${v.id}/submit`)).statusCode).toBe(200);
      const plan = (await call('procurement', 'GET', `/requests/${v.id}/plan`)).json() as Json;
      expect((await call('procurement', 'POST', `/plans/${plan.id}/submit-for-approval`)).statusCode).toBe(
        200,
      );
      return { id: v.id as string, planId: plan.id as string };
    };
    const local = await prep({ estimatedValue: 152_000 });
    const foreign = await prep({ estimatedValue: 100_000, currency: 'USD' });
    const seenBy = async (reqId: string, who: string) =>
      ((await call(who, 'GET', `/requests/${reqId}/plan`)).json() as Json).permissions;
    expect((await seenBy(local.id, 'delegate')).canApprove).toBe(true);
    const view = await seenBy(foreign.id, 'delegate');
    expect(view.canApprove).toBe(false);
    expect(view.reason).toMatch(/100,000/);
    const refused = await call('delegate', 'POST', `/plans/${foreign.planId}/decision`, {
      decision: 'APPROVE',
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().code).toBe('DELEGATION_EXCEEDED');
    expect(refused.json().title).toMatch(/\$100,000/);
    // the executive holds a larger international grant
    expect(
      (await call('exec', 'POST', `/plans/${foreign.planId}/decision`, { decision: 'APPROVE' })).statusCode,
    ).toBe(200);
    expect(
      (await call('delegate', 'POST', `/plans/${local.planId}/decision`, { decision: 'APPROVE' })).statusCode,
    ).toBe(200);
  });

  it('an administrator can grant an international limit, a person can hold a local and an international one, and without an international grant a person cannot approve foreign spend', async () => {
    const list = (await call('admin', 'GET', '/admin/delegations')).json() as Json[];
    expect(list.filter((x) => x.international).length).toBeGreaterThanOrEqual(3);
    const finance = await env.extraUser('intl-approver', 'DELEGATE', [
      { scope: 'SOURCING_APPROVAL', max: '900000' },
    ]);
    const mine = await call('admin', 'POST', '/admin/delegations', {
      scope: 'SOURCING_APPROVAL',
      userId: finance.id,
      maxValue: 50_000,
      international: true,
    });
    expect(mine.statusCode, mine.body).toBe(201);
    expect(mine.json()).toMatchObject({ international: true, maxValue: 50_000 });
    // a second international grant for the same scope is a duplicate; a local one is not
    expect(
      (
        await call('admin', 'POST', '/admin/delegations', {
          scope: 'SOURCING_APPROVAL',
          userId: finance.id,
          maxValue: 60_000,
          international: true,
        })
      ).statusCode,
    ).toBe(409);
  });
});
