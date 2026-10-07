/**
 * NFR-R03: field population combines in-house data with periodically refreshed outside content.
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import * as s from '../../db/schema.js';
import { TENANT_ID } from '../../db/seed.js';
import { createEnv, type Json } from '../contract/test-env.js';
import { LATEST_VERSION, fetchContentRelease, itemsAt } from './content-source.js';
import { runContentSchedule, stateOf } from './content.js';
import { AuditService } from '../../audit/audit-service.js';

let env: Awaited<ReturnType<typeof createEnv>>;
const call = (...a: Parameters<typeof env.call>) => env.call(...a);
const sys = <T>(fn: Parameters<typeof env.withSystem>[1]) => env.withSystem(env.database, fn) as Promise<T>;
beforeAll(async () => {
  env = await createEnv();
}, 120_000);

const setContent = async (over: Json = {}) => {
  const r = await call('admin', 'PUT', '/admin/settings', {
    content: { refreshDays: 30, validDays: 45, useOutsideContent: true, ...over },
  });
  expect(r.statusCode, r.body).toBe(200);
};
const packs = async (who = 'procurement') => {
  const r = await call(who, 'GET', '/content');
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as Json;
};
const pack = async (kind: string) => ((await packs()).packs as Json[]).find((p) => p.kind === kind)!;
const refresh = async (body: Json = {}, who = 'procurement') => {
  const r = await call(who, 'POST', '/content/refresh', body);
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as Json;
};
async function request(over: Json = {}) {
  const r = await call('requester', 'POST', '/requests', {
    title: 'Content fixture',
    category: 'Software licences',
    estimatedValue: 240_000,
    termMonths: 24,
    businessUnit: 'Facilities',
    fields: { contractOwner: 'Sofia Rossi' },
    ...over,
  });
  expect(r.statusCode, r.body).toBe(201);
  return r.json() as Json;
}
const hints = async (id: string, who = 'procurement') => {
  const r = await call(who, 'GET', `/requests/${id}/content-hints`);
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as Json;
};

describe('NFR-R03 the simulated outside source changes by version number (pure)', () => {
  it('adds, changes and removes items from one release to the next, and is the same every time it is asked', async () => {
    const keys = (v: number) => itemsAt('UNSPSC_TAXONOMY', v).map((i) => i.key);
    expect(keys(2)).toEqual(expect.arrayContaining(keys(1)));
    expect(keys(2).length).toBeGreaterThan(keys(1).length); // added
    const clean = (v: number) => itemsAt('UNSPSC_TAXONOMY', v).find((i) => i.key === 'building-cleaning')!;
    expect(clean(3).label).not.toBe(clean(1).label); // changed
    expect(keys(4)).toContain('apparel');
    expect(keys(5)).not.toContain('apparel'); // removed
    expect(JSON.stringify(itemsAt('RISK_LIBRARY', 3))).toBe(JSON.stringify(itemsAt('RISK_LIBRARY', 3)));
    const r = await fetchContentRelease('MARKET_BENCHMARKS', 99);
    expect(r.version).toBe(LATEST_VERSION);
    expect(r.sourceUrl).toMatch(/\.simulated\.test\//);
  });
});

describe('NFR-R03 refresh on demand changes the content, and is idempotent', () => {
  it('starts empty, loads release 1, then each refresh adds, changes or removes items and says which', async () => {
    await setContent();
    const empty = await packs();
    expect(empty.packs).toHaveLength(5);
    expect(empty.packs.every((p: Json) => p.state === 'NONE' && p.version === null)).toBe(true);
    expect(empty.simulated).toBe(true);

    const first = await refresh({ kind: 'UNSPSC_TAXONOMY' });
    expect(first.results[0]).toMatchObject({
      kind: 'UNSPSC_TAXONOMY',
      outcome: 'UPDATED',
      fromVersion: null,
      toVersion: 1,
    });
    expect(first.results[0].diff.added.length).toBe(itemsAt('UNSPSC_TAXONOMY', 1).length);
    const p1 = await pack('UNSPSC_TAXONOMY');
    expect(p1).toMatchObject({ state: 'CURRENT', version: 1, sourceName: 'Simulated UNSPSC registry' });
    expect(p1.sourceUrl).toMatch(/^https:\/\/.*\.simulated\.test\//);
    expect(p1.itemCount).toBe(itemsAt('UNSPSC_TAXONOMY', 1).length);
    expect(p1.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(Date.parse(p1.validUntil) - Date.parse(p1.refreshedAt)).toBe(45 * 86_400_000);

    const second = await refresh({ kind: 'UNSPSC_TAXONOMY' });
    expect(second.results[0]).toMatchObject({ outcome: 'UPDATED', fromVersion: 1, toVersion: 2 });
    expect(second.results[0].diff.added).toEqual(
      expect.arrayContaining(['software-licences', 'cloud-hosting']),
    );
    const p2 = await pack('UNSPSC_TAXONOMY');
    expect(p2.version).toBe(2);
    expect(p2.checksum).not.toBe(p1.checksum);

    const third = await refresh({ kind: 'UNSPSC_TAXONOMY' });
    expect(third.results[0].diff.changed).toContain('building-cleaning');
    await refresh({ kind: 'UNSPSC_TAXONOMY', toVersion: 4 });
    const fifth = await refresh({ kind: 'UNSPSC_TAXONOMY' });
    expect(fifth.results[0].diff.removed).toContain('apparel');
    const items = (await call('legal', 'GET', '/content/UNSPSC_TAXONOMY/items')).json() as Json;
    expect(items.version).toBe(5);
    expect(items.items.map((i: Json) => i.key)).not.toContain('apparel');
    expect(items.items.find((i: Json) => i.key === 'building-cleaning').label).toMatch(/Commercial/);
    // never backwards
    const back = await call('procurement', 'POST', '/content/refresh', {
      kind: 'UNSPSC_TAXONOMY',
      toVersion: 2,
    });
    expect(back.statusCode).toBe(422);
    expect(back.json().code).toBe('VERSION_OLDER');
  });

  it('refreshing when the source has nothing newer changes nothing: same version, checksum and rows, no duplicates', async () => {
    await refresh({ kind: 'RISK_LIBRARY', toVersion: LATEST_VERSION });
    const before = await pack('RISK_LIBRARY');
    const rowsBefore = await sys<Json[]>((tx) =>
      tx
        .select()
        .from(s.contentItem)
        .where(and(eq(s.contentItem.tenantId, TENANT_ID), eq(s.contentItem.kind, 'RISK_LIBRARY'))),
    );
    for (let i = 0; i < 3; i += 1) {
      const again = await refresh({ kind: 'RISK_LIBRARY' });
      expect(again.results[0]).toMatchObject({
        outcome: 'UNCHANGED',
        fromVersion: LATEST_VERSION,
        toVersion: LATEST_VERSION,
      });
      expect(again.results[0].diff).toEqual({ added: [], changed: [], removed: [] });
    }
    const after = await pack('RISK_LIBRARY');
    expect(after.version).toBe(before.version);
    expect(after.checksum).toBe(before.checksum);
    expect(after.itemCount).toBe(before.itemCount);
    const rowsAfter = await sys<Json[]>((tx) =>
      tx
        .select()
        .from(s.contentItem)
        .where(and(eq(s.contentItem.tenantId, TENANT_ID), eq(s.contentItem.kind, 'RISK_LIBRARY'))),
    );
    expect(rowsAfter).toHaveLength(rowsBefore.length);
    expect(new Set(rowsAfter.map((r) => r.itemKey)).size).toBe(rowsAfter.length);
    const audit = await sys<Json[]>((tx) =>
      tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'content.refresh')),
    );
    expect(audit.length).toBeGreaterThan(5);
  });

  it('is for administrators and procurement to run; legal and executives can read it; others cannot', async () => {
    expect((await call('admin', 'POST', '/content/refresh', { kind: 'CLAUSE_REFERENCE' })).statusCode).toBe(
      200,
    );
    for (const who of ['legal', 'exec'])
      expect((await call(who, 'POST', '/content/refresh', {})).statusCode, who).toBe(403);
    for (const who of ['legal', 'exec', 'admin', 'procurement'])
      expect((await call(who, 'GET', '/content')).statusCode, who).toBe(200);
    for (const who of ['requester', 'finance', 'delegate'])
      expect((await call(who, 'GET', '/content')).statusCode, who).toBe(403);
    const canRefresh = (who: string) => call(who, 'GET', '/content').then((r) => r.json().canRefresh);
    expect(await canRefresh('legal')).toBe(false);
    expect(await canRefresh('procurement')).toBe(true);
    expect((await call('procurement', 'POST', '/content/refresh', { kind: 'NOPE' })).statusCode).toBe(400);
  });
});

describe('NFR-R03 each populated field shows its source', () => {
  it('taxonomy: a category only the outside pack knows is sourced from the pack, with its name and version', async () => {
    await refresh({ kind: 'UNSPSC_TAXONOMY', toVersion: LATEST_VERSION });
    const r = await request({ category: 'Software licences' });
    const h = await hints(r.id);
    expect(h.taxonomy).toMatchObject({ scheme: 'UNSPSC', code: '43232300', category: 'Software licences' });
    expect(h.taxonomy.source).toMatchObject({ kind: 'OUTSIDE_PACK' });
    expect(h.taxonomy.source.label).toMatch(/UNSPSC taxonomy v6/);
    expect(h.taxonomy.source.pack).toMatchObject({
      kind: 'UNSPSC_TAXONOMY',
      version: 6,
      name: 'Simulated UNSPSC registry',
    });
    // the same answer is on the request itself, where the intake page reads it
    const view = (await call('requester', 'GET', `/requests/${r.id}`)).json() as Json;
    expect(view.taxonomy).toMatchObject({ code: '43232300' });
    expect(view.taxonomy.source).toMatchObject({ kind: 'OUTSIDE_PACK' });
  });

  it('taxonomy: a category both know is BOTH, the outside code is used and the in-house code is kept beside it', async () => {
    const r = await request({ category: 'Building cleaning (UNSPSC 76111500)', title: 'Cleaning fixture' });
    const h = await hints(r.id);
    expect(h.taxonomy.source.kind).toBe('BOTH');
    expect(h.taxonomy.source.label).toMatch(/In-house and outside content/);
    expect(h.taxonomy.code).toBe('76111501');
    expect(h.taxonomy.inHouse).toMatchObject({ code: '76111500' });
    expect(h.taxonomy.differs).toBe(true);
    // a category only in-house knows is In-house
    const r2 = await request({ category: 'Health services', title: 'Health fixture' });
    const h2 = await hints(r2.id);
    expect(h2.taxonomy.source.kind).toBe('BOTH'); // both hold health services
    const r3 = await request({ category: 'Apparel', title: 'Apparel fixture' });
    const h3 = await hints(r3.id);
    // apparel was removed from the outside pack in release 5, so only the in-house table answers
    expect(h3.taxonomy.source).toMatchObject({ kind: 'IN_HOUSE', pack: null });
    expect(h3.taxonomy.code).toBe('53100000');
  });

  it('market benchmark: a range from the outside survey and the in-house history, and where the estimate sits', async () => {
    await refresh({ kind: 'MARKET_BENCHMARKS', toVersion: LATEST_VERSION });
    const r = await request({
      category: 'Cloud hosting',
      estimatedValue: 400_000,
      termMonths: 24,
      title: 'Hosting',
    });
    const h = await hints(r.id);
    expect(h.benchmark.source.kind).toBe('OUTSIDE_PACK'); // no earlier request in this category yet
    expect(h.benchmark.inHouse).toBeNull();
    expect(h.benchmark.outside).toMatchObject({ unit: 'AUD per year' });
    expect(h.benchmark.annualEstimate).toBe(200_000); // 400,000 over 24 months
    expect(h.benchmark.verdict).toBe('WITHIN');
    expect(h.benchmark.text).toMatch(/Market benchmark for Cloud hosting/);
    expect(h.benchmark.source.label).toMatch(/Market price benchmarks v6/);
    const high = await request({
      category: 'Cloud hosting',
      estimatedValue: 4_000_000,
      termMonths: 12,
      title: 'Hosting big',
    });
    expect((await hints(high.id)).benchmark.verdict).toBe('ABOVE');
    // a second request in the category now has in-house history too: the first one
    expect(h.benchmark.inHouse).toBeNull();
    const again = await hints(high.id);
    expect(again.benchmark.inHouse).toMatchObject({ count: 1, median: 400_000 });
    expect(again.benchmark.source.kind).toBe('BOTH');
    expect(again.benchmark.text).toMatch(/In-house: 1 earlier request in this category/);
  });

  it('candidate risks: standard statements from the library are added, each with its source, beside the built-in ones', async () => {
    await refresh({ kind: 'RISK_LIBRARY', toVersion: LATEST_VERSION });
    const r = await request({
      category: 'Building cleaning (UNSPSC 76111500)',
      title: 'Cleaning risks',
      estimatedValue: 200_000,
    });
    const h = await hints(r.id);
    expect(h.risks.map((x: Json) => x.key)).toEqual(
      expect.arrayContaining(['lib-modern-slavery', 'lib-supplier-concentration']),
    );
    const gen = await call('procurement', 'POST', `/requests/${r.id}/risk-assessment/generate`);
    expect(gen.statusCode, gen.body).toBe(201);
    const items = gen.json().items as Json[];
    const lib = items.find((i) => i.key === 'lib-modern-slavery')!;
    expect(lib.source).toMatchObject({ kind: 'OUTSIDE_PACK' });
    expect(lib.source.label).toMatch(/Standard risk library v6/);
    const builtIn = items.find((i) => i.key === 'delivery')!;
    expect(builtIn.source).toEqual({ kind: 'IN_HOUSE', label: 'In-house', pack: null, note: null });
    expect(items.length).toBeGreaterThan(5);
  });
});

describe('NFR-R03 stale content falls back to in-house data, visibly', () => {
  it('a pack past its end date is flagged STALE and no longer used; refreshing brings it back', async () => {
    await refresh({ toVersion: LATEST_VERSION });
    expect((await packs()).packs.every((p: Json) => p.state === 'CURRENT')).toBe(true);
    const r = await request({ category: 'Software licences', title: 'Stale fixture' });
    expect((await hints(r.id)).taxonomy.source.kind).toBe('OUTSIDE_PACK');

    env.clock.advanceDays(46); // validDays is 45
    const stale = await packs();
    expect(stale.packs.every((p: Json) => p.state === 'STALE')).toBe(true);
    expect(stale.packs[0].fallbackNote).toMatch(/stale/);
    const h = await hints(r.id);
    // Software licences is not in the in-house table, so there is nothing to suggest, and the note says why
    expect(h.taxonomy).toBeNull();
    expect(h.notes.map((n: Json) => n.note).join(' ')).toMatch(/stale.*in-house data only/);
    expect(h.risks).toEqual([]);
    expect(h.riskNote).toMatch(/stale/);
    const cleaning = await request({
      category: 'Building cleaning (UNSPSC 76111500)',
      title: 'Stale cleaning',
    });
    const hc = await hints(cleaning.id);
    expect(hc.taxonomy.source).toMatchObject({ kind: 'IN_HOUSE', pack: null });
    expect(hc.taxonomy.code).toBe('76111500'); // in-house answer only
    expect(hc.taxonomy.source.note).toMatch(/stale/);
    // a risk assessment drafted now has built-in risks only
    const gen = await call('procurement', 'POST', `/requests/${cleaning.id}/risk-assessment/generate`);
    expect((gen.json().items as Json[]).some((i) => String(i.key).startsWith('lib-'))).toBe(false);

    await refresh({});
    expect((await packs()).packs.every((p: Json) => p.state === 'CURRENT')).toBe(true);
    expect((await hints(r.id)).taxonomy.source.kind).toBe('OUTSIDE_PACK');
    expect(stateOf(null, new Date())).toBe('NONE');
  });

  it('a request taxonomy keeps working in-house when no pack has ever been loaded, and when outside content is switched off', async () => {
    await setContent({ useOutsideContent: false });
    const r = await request({ category: 'Building cleaning (UNSPSC 76111500)', title: 'Switched off' });
    const h = await hints(r.id);
    expect(h.taxonomy.source.kind).toBe('IN_HOUSE');
    expect(h.notes[0].note).toMatch(/switched off/);
    await setContent();
  });

  it('a failed refresh (the middleware connector is down) keeps what is held, and says it failed', async () => {
    await sys((tx) =>
      tx
        .delete(s.contentPack)
        .where(and(eq(s.contentPack.tenantId, TENANT_ID), eq(s.contentPack.kind, 'ESG_REFERENCE'))),
    );
    await refresh({ kind: 'ESG_REFERENCE', toVersion: 2 });
    const held = await pack('ESG_REFERENCE');
    expect(held.state).toBe('CURRENT');
    await call('admin', 'PUT', '/connectors/MIDDLEWARE', {
      provider: 'SIMULATED_MIDDLEWARE',
      enabled: true,
      mode: 'DOWN',
    });
    const out = await refresh({ kind: 'ESG_REFERENCE' });
    expect(out.results[0]).toMatchObject({ outcome: 'FAILED', fromVersion: 2, toVersion: 2 });
    expect(out.results[0].error).toMatch(/not responding|DOWN/i);
    const after = await pack('ESG_REFERENCE');
    expect(after).toMatchObject({ version: 2, state: 'CURRENT', itemCount: held.itemCount });
    expect(after.lastError).toBeTruthy();
    // a kind never loaded becomes FAILED, not CURRENT
    await sys((tx) =>
      tx
        .delete(s.contentPack)
        .where(and(eq(s.contentPack.tenantId, TENANT_ID), eq(s.contentPack.kind, 'CLAUSE_REFERENCE'))),
    );
    await refresh({ kind: 'CLAUSE_REFERENCE' });
    expect((await pack('CLAUSE_REFERENCE')).state).toBe('FAILED');
    // time passes with the source still down: the held pack goes stale
    env.clock.advanceDays(46);
    await refresh({ kind: 'ESG_REFERENCE' });
    expect((await pack('ESG_REFERENCE')).state).toBe('STALE');
    // back up: the next refresh recovers
    env.clock.advanceMs(120_000);
    await call('admin', 'PUT', '/connectors/MIDDLEWARE', {
      provider: 'SIMULATED_MIDDLEWARE',
      enabled: true,
      mode: 'UP',
    });
    const ok = await refresh({ kind: 'ESG_REFERENCE' });
    expect(ok.results[0].outcome).toBe('UPDATED');
    expect((await pack('ESG_REFERENCE')).state).toBe('CURRENT');
  });
});

describe('NFR-R03 refreshed on a schedule', () => {
  it('the scheduled run loads what is due and leaves what is not until content.refreshDays have passed', async () => {
    await setContent({ refreshDays: 7, validDays: 14 });
    await sys((tx) => tx.delete(s.contentPack).where(eq(s.contentPack.tenantId, TENANT_ID)));
    const deps = { clock: env.clock, audit: new AuditService(env.clock) };
    expect(await runContentSchedule(env.database, deps)).toBe(5); // all five loaded
    expect((await pack('UNSPSC_TAXONOMY')).version).toBe(1);
    expect(await runContentSchedule(env.database, deps)).toBe(0); // nothing is due yet
    env.clock.advanceDays(6);
    expect(await runContentSchedule(env.database, deps)).toBe(0);
    env.clock.advanceDays(2); // eight days since the refresh: due
    expect(await runContentSchedule(env.database, deps)).toBe(5);
    expect((await pack('UNSPSC_TAXONOMY')).version).toBe(2);
    // switched off: the schedule does nothing
    await setContent({ refreshDays: 7, validDays: 14, useOutsideContent: false });
    env.clock.advanceDays(10);
    expect(await runContentSchedule(env.database, deps)).toBe(0);
    await setContent();
  });
});
