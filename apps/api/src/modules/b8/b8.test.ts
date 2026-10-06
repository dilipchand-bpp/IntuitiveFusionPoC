import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import * as s from '../../db/schema.js';
import { TENANT_ID, uid } from '../../db/seed.js';
import { BRIGHT, createEnv, type Json } from '../contract/test-env.js';
import { canonical } from './contract-b8.js';
import { flagDuplicates } from './supplier-b8.js';

let env: Awaited<ReturnType<typeof createEnv>>;
const call = (...a: Parameters<typeof env.call>) => env.call(...a);
const sys = <T>(fn: Parameters<typeof env.withSystem>[1]) => env.withSystem(env.database, fn) as Promise<T>;
beforeAll(async () => {
  env = await createEnv();
}, 120_000);

const audit = async (id: string) =>
  (await sys<Json[]>((tx) => tx.select().from(s.auditEvent).where(eq(s.auditEvent.entityId, id)))).map(
    (e) => e.action,
  );
const setting = async (name: string, value: unknown) => {
  const r = await call('admin', 'PUT', '/admin/settings', { [name]: value });
  expect(r.statusCode, r.body).toBe(200);
};
const notes = (userKey: string) =>
  sys<Json[]>((tx) =>
    tx
      .select()
      .from(s.notification)
      .where(eq(s.notification.userId, uid(`user:${userKey}`))),
  );

// ------------------------------------------------------------------ FR-0790 ratings
describe('FR-0790 supplier ratings both ways, with configurable visibility', () => {
  it('the enterprise rates a supplier on a signed contract, once; the supplier rates the enterprise; visibility follows the settings', async () => {
    await setting('ratings', { supplierSeesRatings: false, staffSeeSupplierRatings: true });
    const { id } = await env.executed();
    const ok = {
      contractId: id,
      scores: { quality: 5, delivery: 4, communication: 4, value: 5, compliance: 5 },
      comment: 'Reliable.',
    };
    expect((await call('requester', 'POST', `/suppliers/${BRIGHT}/ratings`, ok)).statusCode).toBe(403);
    expect(
      (await call('contract-mgr', 'POST', `/suppliers/${BRIGHT}/ratings`, { ...ok, scores: { quality: 5 } }))
        .statusCode,
    ).toBe(422);
    expect(
      (
        await call('contract-mgr', 'POST', `/suppliers/${BRIGHT}/ratings`, {
          ...ok,
          scores: { ...ok.scores, quality: 9 },
        })
      ).statusCode,
    ).toBe(400);
    const made = await call('contract-mgr', 'POST', `/suppliers/${BRIGHT}/ratings`, ok);
    expect(made.statusCode, made.body).toBe(201);
    expect(made.json()).toMatchObject({ overall: 4.6, band: 'EXCELLENT' });
    expect((await call('contract-mgr', 'POST', `/suppliers/${BRIGHT}/ratings`, ok)).json().code).toBe(
      'ALREADY_RATED',
    );
    // a contract that is not signed cannot be rated
    const d = await env.draft();
    expect(
      (await call('contract-mgr', 'POST', `/suppliers/${BRIGHT}/ratings`, { ...ok, contractId: d.id }))
        .statusCode,
    ).toBe(409);

    // the supplier does not see it while the organisation keeps it private
    const mine = (await call('supplier', 'GET', '/supplier/ratings')).json();
    expect(mine.visible).toBe(false);
    expect(mine.received).toBeNull();
    expect(mine.contracts.find((c: Json) => c.id === id)).toMatchObject({ rated: false });
    const back = await call('supplier', 'POST', '/supplier/ratings', {
      contractId: id,
      scores: { payment: 3, clarity: 4, communication: 5, fairness: 4 },
      comment: 'Paid late once.',
    });
    expect(back.statusCode, back.body).toBe(201);
    expect(back.json().overall).toBe(4);
    expect(
      (
        await call('supplier', 'POST', '/supplier/ratings', {
          contractId: id,
          scores: { payment: 3, clarity: 4, communication: 5, fairness: 4 },
        })
      ).json().code,
    ).toBe('ALREADY_RATED');
    // enterprise dimensions are refused on the supplier side
    expect(
      (
        await call('supplier', 'POST', '/supplier/ratings', {
          contractId: id,
          scores: { quality: 5, delivery: 4, communication: 4, value: 5, compliance: 5 },
        })
      ).statusCode,
    ).toBe(422);

    const staff = (await call('procurement', 'GET', `/suppliers/${BRIGHT}/ratings`)).json();
    expect(staff.ofSupplier).toMatchObject({ count: 1, average: 4.6, band: 'EXCELLENT' });
    expect(staff.ofEnterprise).toMatchObject({ count: 1, average: 4 });
    // staff can be kept from reading what the supplier said, and the supplier can be shown what was said of them
    await setting('ratings', { supplierSeesRatings: true, staffSeeSupplierRatings: false });
    const hidden = (await call('procurement', 'GET', `/suppliers/${BRIGHT}/ratings`)).json();
    expect(hidden.ofEnterprise).toBeNull();
    expect(hidden.entries.every((e: Json) => e.direction === 'ENTERPRISE_RATES_SUPPLIER')).toBe(true);
    expect((await call('supplier', 'GET', '/supplier/ratings')).json().received).toMatchObject({
      count: 1,
      average: 4.6,
    });
    expect(await audit(BRIGHT)).toContain('supplier.rate');
    await setting('ratings', { supplierSeesRatings: false, staffSeeSupplierRatings: true });
  });
});

// ------------------------------------------------------------------ FR-0795 duplicates
describe('FR-0795 duplicate supplier detection', () => {
  it('finds suppliers that look like the same business, lets a person say they are not, and warns at registration', async () => {
    const twin = await sys<Json[]>((tx) =>
      tx
        .insert(s.supplier)
        .values({
          tenantId: TENANT_ID,
          company: 'Brightwave Cleaning Proprietary Limited',
          abn: '51824753556',
          createdAt: env.clock.now(),
        })
        .returning(),
    );
    const sameBank = await sys<Json[]>((tx) =>
      tx
        .insert(s.supplier)
        .values({
          tenantId: TENANT_ID,
          company: 'Harbour Janitorial',
          abn: '11111111111',
          bank: { bsb: '062-000', account: '99887766' },
          createdAt: env.clock.now(),
        })
        .returning(),
    );
    await sys((tx) =>
      tx.insert(s.supplier).values({
        tenantId: TENANT_ID,
        company: 'Another Bank Co',
        abn: '22222222222',
        bank: { bsb: '062-000', account: '99887766' },
        createdAt: env.clock.now(),
      }),
    );
    expect((await call('requester', 'GET', '/suppliers/duplicates')).statusCode).toBe(403);
    const r = (await call('procurement', 'GET', '/suppliers/duplicates')).json();
    const abn = r.pairs.find((p: Json) => [p.a.id, p.b.id].includes(twin[0]!.id));
    expect(abn.reasons).toEqual(expect.arrayContaining(['Same ABN']));
    expect(abn.score).toBe(1);
    const bank = r.pairs.find((p: Json) => [p.a.id, p.b.id].includes(sameBank[0]!.id));
    expect(bank.reasons).toContain('Same bank account');
    // unrelated suppliers are not paired
    expect(
      r.pairs.some(
        (p: Json) =>
          p.a.company === 'Northstar Property Care Pty Ltd' ||
          p.b.company === 'Northstar Property Care Pty Ltd',
      ),
    ).toBe(false);

    const dismiss = await call('procurement', 'POST', '/suppliers/duplicates/dismiss', {
      supplierA: abn.a.id,
      supplierB: abn.b.id,
      reason: 'A subsidiary with its own trading arrangements',
    });
    expect(dismiss.statusCode, dismiss.body).toBe(204);
    expect(
      (await call('procurement', 'GET', '/suppliers/duplicates'))
        .json()
        .pairs.some(
          (p: Json) =>
            [p.a.id, p.b.id].includes(twin[0]!.id) &&
            [p.a.id, p.b.id].includes(abn.a.id) &&
            [p.a.id, p.b.id].includes(abn.b.id),
        ),
    ).toBe(false);

    // at registration procurement is told
    const fresh = await sys<Json[]>((tx) =>
      tx
        .insert(s.supplier)
        .values({
          tenantId: TENANT_ID,
          company: 'Evergreen Facility Services',
          abn: '77777777777',
          createdAt: env.clock.now(),
        })
        .returning(),
    );
    const before = (await notes('procurement')).length;
    const n = await sys<number>((tx) => flagDuplicates(tx, TENANT_ID, fresh[0]!.id));
    expect(n).toBeGreaterThan(0);
    const after = await notes('procurement');
    expect(after.length).toBe(before + 1);
    expect(after.at(-1)!.title).toMatch(/looks like one already on file/);
  });
});

// ------------------------------------------------------------------ FR-0800 risk and ESG
describe('FR-0800 supplier risk, resilience and ESG scoring', () => {
  it('scores a supplier on named factors with recommendations and alternatives, collects ESG data and runs modern slavery checks', async () => {
    expect((await call('requester', 'GET', `/suppliers/${BRIGHT}/risk`)).statusCode).toBe(403);
    const r = (await call('procurement', 'GET', `/suppliers/${BRIGHT}/risk`)).json();
    expect(r.factors.map((f: Json) => f.key)).toEqual([
      'performance',
      'financial',
      'geopolitical',
      'disruption',
      'compliance',
      'cyber',
      'esg',
      'concentration',
    ]);
    expect(r.factors.reduce((n: number, f: Json) => n + f.weight, 0)).toBeCloseTo(1, 5);
    expect(r.score).toBeGreaterThan(0);
    expect(['LOW', 'MEDIUM', 'HIGH']).toContain(r.level);
    expect(r.model).toBe('rules-simulated-v1');
    // Evergreen shares the cleaning category, so it is offered as an alternative
    expect(r.alternatives.map((a: Json) => a.company)).toContain('Evergreen Facility Services Pty Ltd');
    expect(r.recommendations.join(' ')).toMatch(/modern slavery/i);

    // the supplier declares ESG data about itself
    const put = await call('supplier', 'PUT', '/supplier/profile/esg', {
      carbonTonnesCo2e: 120,
      renewablePct: 60,
      diversityOwned: 'WOMEN',
      modernSlaveryStatement: false,
    });
    expect(put.statusCode, put.body).toBe(200);
    expect((await call('requester', 'PUT', '/supplier/profile/esg', { renewablePct: 1 })).statusCode).toBe(
      403,
    );
    expect((await call('supplier', 'PUT', '/supplier/profile/esg', { renewablePct: 150 })).statusCode).toBe(
      400,
    );
    // cleaning is a higher-risk category: with no statement the screen asks for a review
    const check = await call('procurement', 'POST', `/suppliers/${BRIGHT}/modern-slavery-check`);
    expect(check.json().result).toBe('REVIEW');
    expect(
      (await call('procurement', 'GET', `/suppliers/${BRIGHT}/risk`)).json().recommendations.join(' '),
    ).toMatch(/needs review/);
    await call('supplier', 'PUT', '/supplier/profile/esg', { modernSlaveryStatement: true });
    expect(
      (await call('procurement', 'POST', `/suppliers/${BRIGHT}/modern-slavery-check`)).json().result,
    ).toBe('CLEAR');
    expect((await call('requester', 'POST', `/suppliers/${BRIGHT}/modern-slavery-check`)).statusCode).toBe(
      403,
    );

    const scores = (await call('exec', 'GET', '/reports/supplier-scores')).json();
    expect(scores.items.length).toBeGreaterThanOrEqual(4);
    const sorted = scores.items.map((x: Json) => x.score);
    expect([...sorted].sort((a, b) => a - b)).toEqual(sorted);
    const div = (await call('finance', 'GET', '/reports/diversity')).json();
    expect(div.carbon.tonnesCo2e).toBe(120);
    expect(div.groups.find((g: Json) => g.group === 'WOMEN')).toMatchObject({ suppliers: 1 });
    expect((await call('requester', 'GET', '/reports/diversity')).statusCode).toBe(403);
  });
});

// ------------------------------------------------------------------ FR-0805 lessons learned
describe('FR-0805 lessons learned, captured at close and recalled on comparable procurements', () => {
  const fixture = async (category: string, value: number, title: string) => {
    const a = await env.award({ value });
    await sys((tx) =>
      tx
        .update(s.request)
        .set({ category, title, phase: 'CONTRACT_MGMT' })
        .where(eq(s.request.id, a.requestId)),
    );
    return a.requestId;
  };
  it('a procurement is closed only with a lesson (or a reason for none); lessons from similar procurements are recalled with why', async () => {
    const r1 = await fixture(
      'Building cleaning (UNSPSC 76111500)',
      120_000,
      'Cleaning services for the north campus',
    );
    const noLesson = await call('procurement', 'POST', `/requests/${r1}/close`, { outcome: 'COMPLETED' });
    expect(noLesson.statusCode).toBe(409);
    expect(noLesson.json().code).toBe('LESSONS_REQUIRED');
    expect(
      (await call('requester', 'POST', `/requests/${r1}/lessons`, { kind: 'TIP', text: 'x' })).statusCode,
    ).toBe(400);
    const l = await call('procurement', 'POST', `/requests/${r1}/lessons`, {
      kind: 'TO_IMPROVE',
      text: 'Ask for cleaning rosters before award; the transition took six weeks because rosters were late.',
    });
    expect(l.statusCode, l.body).toBe(201);
    await call('procurement', 'POST', `/requests/${r1}/lessons`, {
      kind: 'WENT_WELL',
      text: 'Site visits with every bidder avoided clarification questions later.',
    });
    expect(((await call('procurement', 'GET', `/requests/${r1}/lessons`)).json() as Json[]).length).toBe(2);
    const closed = await call('procurement', 'POST', `/requests/${r1}/close`, { outcome: 'COMPLETED' });
    expect(closed.statusCode, closed.body).toBe(200);
    expect(closed.json()).toMatchObject({ phase: 'CLOSED', status: 'COMPLETE' });
    expect(
      (await call('procurement', 'POST', `/requests/${r1}/close`, { outcome: 'COMPLETED' })).json().code,
    ).toBe('INVALID_STATE');
    expect(await audit(r1)).toContain('request.close');

    // a new, similar procurement is shown what was learned; a different one is not
    const r2 = await fixture('Building cleaning (UNSPSC 76111500)', 150_000, 'Cleaning for the south depot');
    const recall = (await call('procurement', 'GET', `/requests/${r2}/lessons/recall`)).json();
    expect(recall.lessons.length).toBeGreaterThan(0);
    expect(recall.lessons[0].why).toContain('same category');
    expect(recall.lessons[0].from).toMatchObject({ id: r1 });
    const r3 = await fixture('Legal services (UNSPSC 80121700)', 5_000_000, 'Panel of legal advisers');
    const other = (await call('procurement', 'GET', `/requests/${r3}/lessons/recall`)).json();
    expect(other.lessons).toEqual([]);
    // closing without a lesson needs a reason; cancelling needs one too
    const r4 = await fixture('Landscaping', 40_000, 'Grounds care');
    expect(
      (await call('procurement', 'POST', `/requests/${r4}/close`, { outcome: 'CANCELLED' })).statusCode,
    ).toBe(422);
    const skip = await call('procurement', 'POST', `/requests/${r4}/close`, {
      outcome: 'CANCELLED',
      reason: 'The need went away',
      skipLessonsReason: 'Nothing was done',
    });
    expect(skip.statusCode, skip.body).toBe(200);
    // not everyone may close
    expect(
      (await call('requester', 'POST', `/requests/${r2}/close`, { outcome: 'COMPLETED' })).statusCode,
    ).toBe(403);
  });
});

// ------------------------------------------------------------------ FR-0830 legal edits
describe('FR-0830 plain-language legal edits and portals for outside counsel', () => {
  it('redacts, redlines and inserts clauses from plain language, and redaction holds for everyone but Legal', async () => {
    const d = await env.draft();
    const view = async (as: string) => (await call(as, 'GET', `/contracts/${d.id}`)).json() as Json;
    const clauses = (await view('legal')).clauses as Json[];
    expect(clauses.length).toBeGreaterThan(3);
    const target = clauses[1]!;
    expect(
      (
        await call('procurement', 'POST', `/contracts/${d.id}/legal-edit`, {
          instruction: `redact ${target.title}`,
        })
      ).statusCode,
    ).toBe(403);

    const preview = await call('legal', 'POST', `/contracts/${d.id}/legal-edit`, {
      instruction: `redact the ${target.title} clause`,
      apply: false,
    });
    expect(preview.json()).toMatchObject({ applied: false, understood: true, intent: 'REDACT' });
    expect(((await view('legal')).clauses as Json[])[1]!.redacted).toBe(false);
    const red = await call('legal', 'POST', `/contracts/${d.id}/legal-edit`, {
      instruction: `redact clause 2`,
    });
    expect(red.json()).toMatchObject({ applied: true, intent: 'REDACT', clauseId: target.id });
    expect(((await view('legal')).clauses as Json[])[1]).toMatchObject({ text: target.text, redacted: true });
    expect(((await view('procurement')).clauses as Json[])[1]).toMatchObject({
      text: '[Redacted]',
      redacted: true,
    });
    expect(
      (
        await call('legal', 'POST', `/contracts/${d.id}/legal-edit`, { instruction: 'unredact clause 2' })
      ).json().applied,
    ).toBe(true);

    const unknown = await call('legal', 'POST', `/contracts/${d.id}/legal-edit`, {
      instruction: 'make it better',
    });
    expect(unknown.json()).toMatchObject({ applied: false, understood: false });
    expect(unknown.json().hint).toMatch(/redact/);
    const missing = await call('legal', 'POST', `/contracts/${d.id}/legal-edit`, {
      instruction: 'redact the moon clause',
    });
    expect(missing.json().understood).toBe(false);

    // redline: proposed, not applied, until Legal accepts it
    const rl = await call('legal', 'POST', `/contracts/${d.id}/legal-edit`, {
      instruction: `redline clause 3 to: The supplier shall hold cover of at least ten million dollars at all times.`,
    });
    expect(rl.json()).toMatchObject({ applied: true, intent: 'REDLINE' });
    const list = (await call('legal', 'GET', `/contracts/${d.id}/redlines`)).json();
    expect(list.redlines).toHaveLength(1);
    expect(list.redlines[0]).toMatchObject({
      status: 'PROPOSED',
      source: 'INTERNAL',
      clauseId: clauses[2]!.id,
      currentText: clauses[2]!.text,
    });
    expect(((await view('legal')).clauses as Json[])[2]!.text).toBe(clauses[2]!.text);
    const acc = await call('legal', 'POST', `/contracts/${d.id}/redlines/${list.redlines[0].id}/decision`, {
      decision: 'ACCEPT',
    });
    expect(acc.json().status).toBe('ACCEPTED');
    expect(((await view('legal')).clauses as Json[])[2]).toMatchObject({
      text: expect.stringMatching(/ten million dollars/),
      changedFromTemplate: true,
    });
    expect(
      (
        await call('legal', 'POST', `/contracts/${d.id}/redlines/${list.redlines[0].id}/decision`, {
          decision: 'ACCEPT',
        })
      ).statusCode,
    ).toBe(409);

    // insertion at a nominated place
    const ins = await call('legal', 'POST', `/contracts/${d.id}/legal-edit`, {
      instruction:
        'insert a clause titled Data breach notice after clause 1: The supplier must tell the customer of any data breach within 24 hours.',
    });
    expect(ins.json()).toMatchObject({ applied: true, intent: 'INSERT' });
    const after = (await view('legal')).clauses as Json[];
    expect(after[1]).toMatchObject({
      title: 'Data breach notice',
      inserted: true,
      changedFromTemplate: true,
    });
    expect(after[0]!.id).toBe(clauses[0]!.id);
    expect(after[2]!.id).toBe(clauses[1]!.id);
    expect(await audit(d.id)).toEqual(
      expect.arrayContaining([
        'contract.legal_redact',
        'contract.legal_redline',
        'contract.legal_insert',
        'contract.redline_accept',
      ]),
    );

    // once released the wording is final
    await call('legal', 'POST', `/contracts/${d.id}/deviations/${after[1]!.id}/decision`, {
      decision: 'ACCEPT',
      statement: 'Reviewed.',
    });
    expect(
      await call('legal', 'POST', `/contracts/${d.id}/legal-edit`, { instruction: 'redact clause 1' }).then(
        (r) => r.statusCode,
      ),
    ).toBeLessThan(500);
  });

  it("an outside law firm or the supplier's legal team marks up one contract through a one-time link, and a final version is locked", async () => {
    const d = await env.draft();
    expect(
      (
        await call('procurement', 'POST', `/contracts/${d.id}/counsel-links`, {
          name: 'Ada Counsel',
          email: 'ada@firm.example',
          party: 'EXTERNAL_COUNSEL',
        })
      ).statusCode,
    ).toBe(403);
    const made = await call('legal', 'POST', `/contracts/${d.id}/counsel-links`, {
      name: 'Ada Counsel',
      email: 'ada@firm.example',
      party: 'EXTERNAL_COUNSEL',
    });
    expect(made.statusCode, made.body).toBe(201);
    const token = made.json().path.replace('/counsel/', '') as string;
    // the link is not kept in the clear
    const stored = await sys<Json[]>((tx) => tx.select().from(s.counselLink));
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(
      JSON.stringify((await call('legal', 'GET', `/contracts/${d.id}/counsel-links`)).json()),
    ).not.toContain(token);

    await call('legal', 'POST', `/contracts/${d.id}/legal-edit`, { instruction: 'redact clause 1' });
    const page = await env.app.inject({ method: 'GET', url: `/api/v1/counsel/${token}` });
    expect(page.statusCode, page.body).toBe(200);
    const body = page.json();
    expect(body.open).toBe(true);
    expect(body.clauses[0]).toMatchObject({ text: '[Redacted]', redacted: true });
    // the document under review is shown, but none of the contract's own commercial data: no value, no bids
    expect(Object.keys(body.contract).sort()).toEqual(['number', 'title']);
    expect(JSON.stringify(body)).not.toMatch(/"value"|estimatedValue|supplierId|bid/i);
    const target = body.clauses[2];
    const rl = await env.app.inject({
      method: 'POST',
      url: `/api/v1/counsel/${token}/redlines`,
      payload: {
        clauseId: target.id,
        text: 'Replacement wording proposed by outside counsel for this clause.',
      },
    });
    expect(rl.statusCode, rl.body).toBe(201);
    const none = await env.app.inject({
      method: 'POST',
      url: `/api/v1/counsel/${token}/redlines`,
      payload: { clauseId: body.clauses[0].id, text: 'Trying to change a redacted clause here.' },
    });
    expect(none.statusCode).toBe(404);
    const internal = (await call('legal', 'GET', `/contracts/${d.id}/redlines`)).json();
    expect(internal.redlines.find((r: Json) => r.source === 'EXTERNAL_COUNSEL')).toMatchObject({
      author: 'Ada Counsel <ada@firm.example>',
      status: 'PROPOSED',
    });

    // released for signing: the version is final and the portal is read-only
    for (const k of ['IP'])
      await call('legal', 'PUT', `/contracts/${d.id}/clauses/${k}`, {
        text: 'Legal reviewed wording for IP.',
      });
    await call('legal', 'POST', `/contracts/${d.id}/legal-edit`, { instruction: 'unredact clause 1' });
    const rel = await call('legal', 'POST', `/contracts/${d.id}/release-for-signing`);
    expect(rel.statusCode, rel.body).toBe(200);
    const locked = await env.app.inject({
      method: 'POST',
      url: `/api/v1/counsel/${token}/redlines`,
      payload: { clauseId: target.id, text: 'Another change proposed after the version was made final.' },
    });
    expect(locked.statusCode).toBe(423);
    expect(
      (await env.app.inject({ method: 'GET', url: `/api/v1/counsel/${token}` })).json().finalVersion,
    ).toBe(true);

    // a link can be withdrawn
    const d2 = await env.draft();
    const l2 = (
      await call('legal', 'POST', `/contracts/${d2.id}/counsel-links`, {
        name: 'Sam',
        email: 'sam@supplier.example',
        party: 'SUPPLIER',
      })
    ).json();
    expect((await call('legal', 'DELETE', `/contracts/${d2.id}/counsel-links/${l2.id}`)).statusCode).toBe(
      204,
    );
    expect((await env.app.inject({ method: 'GET', url: `/api/v1${l2.path}` })).statusCode).toBe(404);
    expect(
      (await env.app.inject({ method: 'GET', url: '/api/v1/counsel/not-a-real-link-0000000000000' }))
        .statusCode,
    ).toBe(404);
  });
});

// ------------------------------------------------------------------ FR-0390 legal platform
describe("FR-0390 matters raised on the customer's legal platform, and synchronised back", () => {
  const secret = 'shared-secret-for-the-test-1';
  const send = (payload: Json, key = secret) =>
    env.app.inject({
      method: 'POST',
      url: '/api/v1/integrations/legal/webhook',
      headers: { 'x-signature': createHmac('sha256', key).update(canonical(payload)).digest('hex') },
      payload,
    });
  it('raises a matter outward, keeps a failed delivery to retry, and takes stage updates and redlines back by a signed, idempotent webhook', async () => {
    // not run at all unless the customer has a legal platform
    const plain = await call('legal', 'POST', '/legal/matters', { title: 'Plain matter' });
    expect(plain.statusCode).toBe(201);
    expect(plain.json().integration).toBeNull();

    await setting('legalPlatform', {
      enabled: true,
      name: 'HighQ',
      webhookSecret: secret,
      simulateOutage: true,
    });
    const d = await env.draft();
    const down = await call('legal', 'POST', '/legal/matters', {
      title: 'Review the cleaning agreement',
      contractId: d.id,
      priority: 'HIGH',
    });
    expect(down.statusCode).toBe(201);
    expect(down.json().integration).toBe('FAILED');
    const matterId = down.json().id as string;
    const ev = (await call('legal', 'GET', '/integration-events')).json() as Json[];
    expect(ev[0]).toMatchObject({ kind: 'MATTER_INITIATED', target: 'HighQ', status: 'FAILED', attempts: 1 });
    expect(ev[0]!.lastError).toMatch(/did not respond/);
    expect((await call('requester', 'GET', '/integration-events')).statusCode).toBe(403);

    await setting('legalPlatform', {
      enabled: true,
      name: 'HighQ',
      webhookSecret: secret,
      simulateOutage: false,
    });
    const retry = (await call('legal', 'POST', '/integration-events/retry')).json();
    expect(retry).toMatchObject({ retried: 1, delivered: 1 });
    const board = (await call('legal', 'GET', '/legal/matters')).json();
    const m = board.lanes.flatMap((l: Json) => l.matters).find((x: Json) => x.id === matterId);
    expect(m.externalRef).toMatch(/^HIGH-[0-9A-F]{6}$/);
    expect((await call('legal', 'POST', '/integration-events/retry')).json().retried).toBe(0);

    // back from the legal platform: a stage and a redline
    const clauses = ((await call('legal', 'GET', `/contracts/${d.id}`)).json() as Json).clauses as Json[];
    const msg = {
      eventId: 'evt-000001',
      matterRef: m.externalRef,
      stage: 'In review by counterparty',
      redlines: [
        {
          clauseId: clauses[2]!.id,
          text: 'Counterparty proposes this replacement wording.',
          author: 'Counsel at Other Side LLP',
        },
      ],
    };
    expect((await send(msg, 'a-different-secret')).statusCode).toBe(401);
    expect((await send({ ...msg, matterRef: 'HIGH-000000' })).statusCode).toBe(401);
    const ok = await send(msg);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ duplicate: false, lane: 'WAITING', redlines: 1 });
    const again = await send(msg); // the sender retried: nothing happens twice
    expect(again.json()).toEqual({ duplicate: true });
    const after = (await call('legal', 'GET', '/legal/matters'))
      .json()
      .lanes.flatMap((l: Json) => l.matters)
      .find((x: Json) => x.id === matterId);
    expect(after).toMatchObject({ externalStage: 'In review by counterparty', lane: 'WAITING' });
    const reds = (await call('legal', 'GET', `/contracts/${d.id}/redlines`)).json().redlines as Json[];
    expect(reds.filter((r) => r.source === 'LEGAL_PLATFORM')).toHaveLength(1);
    expect(await audit(matterId)).toContain('integration.legal_sync');
    // switched off: the webhook is not accepted
    await setting('legalPlatform', {
      enabled: false,
      name: 'HighQ',
      webhookSecret: secret,
      simulateOutage: false,
    });
    expect((await send({ ...msg, eventId: 'evt-000002' })).statusCode).toBe(401);
  });
});

// ------------------------------------------------------------------ NFR-L04 retention and recovery
describe('NFR-L04 signed contracts are kept permanently, logically deleted only, and can be recovered', () => {
  it('a deleted contract is listed with the reason, can be brought back, is never physically removed, and the trail is complete', async () => {
    const { id, view } = await env.executed();
    const del = await call('legal', 'DELETE', `/contracts/${id}`, {
      reason: 'Entered against the wrong supplier by mistake',
    });
    expect(del.statusCode).toBe(204);
    expect((await call('legal', 'GET', `/contracts/${id}`)).statusCode).toBe(404);
    expect((await call('requester', 'GET', '/contracts/deleted')).statusCode).toBe(403);
    const gone = ((await call('probity', 'GET', '/contracts/deleted')).json() as Json[]).find(
      (c) => c.id === id,
    )!;
    expect(gone).toMatchObject({
      number: view.number,
      status: 'EXECUTED',
      reason: 'Entered against the wrong supplier by mistake',
    });
    // the row is still there, and the database refuses to remove it
    const row = await sys<Json[]>((tx) => tx.select().from(s.contract).where(eq(s.contract.id, id)));
    expect(row[0]!.deletedAt).not.toBeNull();
    await expect(sys((tx) => tx.delete(s.contract).where(eq(s.contract.id, id)))).rejects.toThrow();
    expect(
      (await call('procurement', 'POST', `/contracts/${id}/restore`, { reason: 'It was correct after all.' }))
        .statusCode,
    ).toBe(403);
    expect((await call('legal', 'POST', `/contracts/${id}/restore`, { reason: 'short' })).statusCode).toBe(
      400,
    );
    const back = await call('exec', 'POST', `/contracts/${id}/restore`, {
      reason: 'Deleted in error; the supplier was right.',
    });
    expect(back.statusCode, back.body).toBe(200);
    const live = (await call('legal', 'GET', `/contracts/${id}`)).json() as Json;
    expect(live.status).toBe('EXECUTED');
    expect(live.locked).toBe(true);
    expect(
      ((await call('legal', 'GET', '/contracts/deleted')).json() as Json[]).some((c) => c.id === id),
    ).toBe(false);
    // signatures, deletion and restoration are all in the trail, in order
    const trail = await audit(id);
    expect(trail).toEqual(
      expect.arrayContaining(['contract.sign', 'contract.execute', 'contract.delete', 'contract.restore']),
    );
    expect(trail.indexOf('contract.delete')).toBeLessThan(trail.indexOf('contract.restore'));
    expect((await call('probity', 'GET', '/audit/verify')).statusCode).toBeLessThan(500);
  });
});

// ------------------------------------------------------------------ NFR-L02 disclosure enforcement
describe('NFR-L02 statutory disclosure of a large change is enforced', () => {
  it('a change over the threshold stops further change to that contract once its disclosure is overdue, escalates once, and clears when it is recorded', async () => {
    await setting('contractManagement', {
      erpIntegrated: true,
      variationModel: 'CUMULATIVE',
      variationNumbering: 'SUFFIX',
      publicSectorDisclosure: true,
      disclosureThresholdPct: 10,
      disclosureDays: 42,
      highValueAud: 1_000_000,
      spendAlertPct: 70,
      planTemplates: [],
    });
    const { id } = await env.executed({ value: 100_000 });
    const big = await call('legal', 'POST', `/contracts/${id}/variations`, {
      reason: 'A large change of twenty per cent',
      value: 20_000,
    });
    expect(big.statusCode, big.body).toBe(201);
    const task = (await call('procurement', 'GET', '/disclosure-tasks'))
      .json()
      .find((t: Json) => t.contractId === big.json().id);
    // the variation is signed; before the disclosure is due another change is allowed
    expect((await call('legal', 'POST', `/contracts/${big.json().id}/release-for-signing`)).statusCode).toBe(
      200,
    );
    expect(
      (await call('delegate', 'POST', `/contracts/${big.json().id}/sign`, { decision: 'APPROVE' }))
        .statusCode,
    ).toBe(200);
    const second = await call('legal', 'POST', `/contracts/${id}/variations`, {
      reason: 'A further small change of one per cent',
      value: 1_000,
    });
    expect(second.statusCode, second.body).toBe(201);
    await call('legal', 'DELETE', `/contracts/${second.json().id}`, {
      reason: 'Withdrawn before it went anywhere',
    });
    env.clock.advanceDays(43);
    const stopped = await call('legal', 'POST', `/contracts/${id}/variations`, {
      reason: 'Yet another change to the contract',
      value: 1_000,
    });
    expect(stopped.statusCode).toBe(409);
    expect(stopped.json().code).toBe('DISCLOSURE_OVERDUE');
    // the sweep escalates once, to the executive
    await call('contract-mgr', 'GET', '/alerts');
    await call('contract-mgr', 'GET', '/alerts');
    const row = await sys<Json[]>((tx) =>
      tx.select().from(s.disclosureTask).where(eq(s.disclosureTask.id, task.id)),
    );
    expect(row[0]!.escalatedAt).not.toBeNull();
    const told = (await notes('exec')).filter((n) => n.title === 'Statutory disclosure overdue');
    expect(told).toHaveLength(1);
    expect(await audit(big.json().id)).toContain('contract.disclosure_overdue');
    // recording it lifts the stop
    expect(
      (
        await call('procurement', 'POST', `/disclosure-tasks/${task.id}/complete`, {
          reference: 'AusTender CN-2026-0099',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await call('legal', 'POST', `/contracts/${id}/variations`, {
          reason: 'Yet another change to the contract',
          value: 1_000,
        })
      ).statusCode,
    ).toBe(201);
    await setting('contractManagement', {
      erpIntegrated: true,
      variationModel: 'CUMULATIVE',
      variationNumbering: 'SUFFIX',
      publicSectorDisclosure: false,
      disclosureThresholdPct: 10,
      disclosureDays: 42,
      highValueAud: 1_000_000,
      spendAlertPct: 70,
      planTemplates: [],
    });
  });
});

// ------------------------------------------------------------------ SEC-TP02, SEC-TP03: already enforced, shown here
describe('SEC-TP02 SEC-TP03 counterparty checks before execution', () => {
  it('SEC-TP02: sanctions and financial risk are checked again when negotiation passes 30 days, before the contract can go for signature', async () => {
    const d = await env.draft();
    env.clock.advanceDays(31);
    const stopped = await call('legal', 'POST', `/contracts/${d.id}/release-for-signing`);
    expect(stopped.statusCode).toBe(422);
    expect(JSON.stringify(stopped.json())).toMatch(/Negotiation has run past 30 days/);
    const re = (await call('legal', 'POST', `/contracts/${d.id}/recheck`)).json() as Json;
    expect(re.checks.recheck.map((x: Json) => x.key)).toEqual(expect.arrayContaining(['SANCTIONS']));
    expect(re.negotiation.locked).toBe(false);
    expect((await call('legal', 'POST', `/contracts/${d.id}/release-for-signing`)).statusCode).toBe(200);
  });
  it('SEC-TP03: legal name, tax number and bank details are verified before signature options unlock', async () => {
    await setting('contractRules', {
      requireBankDetails: true,
      requireRiskSummaryReview: false,
      endorsements: [],
      protectedClauses: [],
      negotiationLockDays: 30,
      signingReminderHours: 48,
    });
    const d = await env.draft();
    const early = await call('legal', 'POST', `/contracts/${d.id}/release-for-signing`);
    expect(early.statusCode).toBe(422);
    expect(JSON.stringify(early.json())).toMatch(/Banking details/);
    await call('supplier', 'PUT', '/supplier/profile/bank', {
      bsb: '062-000',
      account: '12345678',
      accountName: 'Brightwave Cleaning Pty Ltd',
    });
    expect((await call('legal', 'POST', `/contracts/${d.id}/release-for-signing`)).statusCode).toBe(200);
    await setting('contractRules', {
      requireBankDetails: false,
      requireRiskSummaryReview: false,
      endorsements: [],
      protectedClauses: [],
      negotiationLockDays: 30,
      signingReminderHours: 48,
    });
  });
});

// ------------------------------------------------------------------ NFR-U05 approve from a link
describe('NFR-U05 approving from an emailed link without a full sign-in', () => {
  const planAwaiting = async (value = 90_000) => {
    const c = await call('requester', 'POST', '/requests', {
      title: `Link fixture ${value}`,
      category: 'Building cleaning (UNSPSC 76111500)',
      estimatedValue: value,
      termMonths: 24,
      businessUnit: 'Facilities',
      fields: { contractOwner: 'Sofia Rossi', background: 'Existing arrangements end in six months.' },
    });
    const rid = c.json().id as string;
    await call('requester', 'POST', `/requests/${rid}/submit`);
    const plan = (await call('procurement', 'GET', `/requests/${rid}/plan`)).json() as Json;
    expect((await call('procurement', 'POST', `/plans/${plan.id}/submit-for-approval`)).statusCode).toBe(200);
    return { rid, planId: plan.id as string };
  };
  const tokenFor = async (userKey: string, afterId?: number) => {
    const rows = (await notes(userKey)).filter(
      (n) => n.title === 'Approve without signing in' && (afterId === undefined || n.id > afterId),
    );
    const link = rows.at(-1)?.link as string | undefined;
    return link?.replace('/approve/', '');
  };
  it('the approver is given a one-time link to a summary checklist; the decision goes through the same checks; the link works once', async () => {
    const { planId, rid } = await planAwaiting();
    const token = (await tokenFor('delegate'))!;
    expect(token).toBeTruthy();
    // the sender never sees it, and it is not in the email log or stored in the clear
    expect(JSON.stringify(await sys<Json[]>((tx) => tx.select().from(s.outboundEmail)))).not.toContain(token);
    expect(JSON.stringify(await sys<Json[]>((tx) => tx.select().from(s.approvalLink)))).not.toContain(token);
    expect(JSON.stringify(await notes('procurement'))).not.toContain(token);

    const page = await env.app.inject({ method: 'GET', url: `/api/v1/approval-links/${token}` });
    expect(page.statusCode, page.body).toBe(200);
    const sum = page.json();
    expect(sum).toMatchObject({
      kind: 'Procurement plan',
      waiting: true,
      valueWithheld: true,
      value: null,
      approver: 'Dana Okafor',
    });
    expect(sum.procurement.title).toBe('Link fixture 90000');
    expect(sum.checks.map((c: Json) => c.label)).toEqual(
      expect.arrayContaining(['The amount is within your approval authority']),
    );
    expect(JSON.stringify(sum)).not.toMatch(/90,000|90000\b(?!")/);

    const bad = await env.app.inject({
      method: 'GET',
      url: '/api/v1/approval-links/not-a-token-0000000000000000000',
    });
    expect(bad.statusCode).toBe(404);

    const reject = await env.app.inject({
      method: 'POST',
      url: `/api/v1/approval-links/${token}/decision`,
      payload: { decision: 'REJECT' },
    });
    expect(reject.statusCode).toBe(400); // a reason is needed, exactly as when signed in
    const done = await env.app.inject({
      method: 'POST',
      url: `/api/v1/approval-links/${token}/decision`,
      payload: { decision: 'APPROVE', comment: 'Fine by me' },
    });
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json()).toEqual({ decided: true, decision: 'APPROVE' });
    const plan = (await call('procurement', 'GET', `/requests/${rid}/plan`)).json() as Json;
    expect(plan.status).toBe('APPROVED_LOCKED');
    expect(plan.approvals.find((a: Json) => a.decision === 'APPROVED')).toMatchObject({
      userName: 'Dana Okafor',
    });
    expect(await audit(planId)).toContain('plan.approve');
    const used = await sys<Json[]>((tx) =>
      tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'approval.link_used')),
    );
    expect(used.length).toBeGreaterThan(0);
    // once only
    expect((await env.app.inject({ method: 'GET', url: `/api/v1/approval-links/${token}` })).statusCode).toBe(
      404,
    );
    expect(
      (
        await env.app.inject({
          method: 'POST',
          url: `/api/v1/approval-links/${token}/decision`,
          payload: { decision: 'APPROVE' },
        })
      ).statusCode,
    ).toBe(404);
    // and the short-lived session made for it is gone
    const live = await sys<Json[]>((tx) =>
      tx.select().from(s.session).where(eq(s.session.userAgent, 'approval-link')),
    );
    expect(live.every((x) => x.revokedAt !== null)).toBe(true);
  });

  it("the usual limits still apply: a plan above the delegate's authority cannot be approved from a link, and a step-up code is asked for when the organisation requires one", async () => {
    const big = await planAwaiting(900_000);
    const t1 = (await tokenFor('delegate'))!;
    const summary = (await env.app.inject({ method: 'GET', url: `/api/v1/approval-links/${t1}` })).json();
    expect(summary.canApprove).toBe(false);
    const refused = await env.app.inject({
      method: 'POST',
      url: `/api/v1/approval-links/${t1}/decision`,
      payload: { decision: 'APPROVE' },
    });
    expect(refused.statusCode).toBe(403);
    expect(((await call('procurement', 'GET', `/requests/${big.rid}/plan`)).json() as Json).status).toBe(
      'AWAITING_APPROVAL',
    );
    // refused: the link still works for a reject, which is allowed
    const rej = await env.app.inject({
      method: 'POST',
      url: `/api/v1/approval-links/${t1}/decision`,
      payload: { decision: 'REJECT', comment: 'Needs the executive' },
    });
    expect(rej.statusCode, rej.body).toBe(200);

    await setting('security', { requireMfa: false, enforceSso: false, stepUpApprovals: true });
    const small = await planAwaiting(60_000);
    const t2 = (await tokenFor('delegate'))!;
    expect(
      (await env.app.inject({ method: 'GET', url: `/api/v1/approval-links/${t2}` })).json().stepUpRequired,
    ).toBe(true);
    const noCode = await env.app.inject({
      method: 'POST',
      url: `/api/v1/approval-links/${t2}/decision`,
      payload: { decision: 'APPROVE' },
    });
    expect(noCode.statusCode).toBeGreaterThanOrEqual(400);
    expect(((await call('procurement', 'GET', `/requests/${small.rid}/plan`)).json() as Json).status).toBe(
      'AWAITING_APPROVAL',
    );
    await setting('security', { requireMfa: false, enforceSso: false, stepUpApprovals: false });

    // commercial information is shown only if the organisation chooses to
    await setting('approvalLinks', { enabled: true, validHours: 48, showCommercial: true });
    await planAwaiting(70_000);
    const t3 = (await tokenFor('delegate'))!;
    expect(
      (await env.app.inject({ method: 'GET', url: `/api/v1/approval-links/${t3}` })).json(),
    ).toMatchObject({ valueWithheld: false, value: expect.stringMatching(/70,000/) });
    // an expired link is refused
    env.clock.advanceDays(3);
    expect((await env.app.inject({ method: 'GET', url: `/api/v1/approval-links/${t3}` })).statusCode).toBe(
      404,
    );
    // and switching the feature off stops new links being issued
    await setting('approvalLinks', { enabled: false, validHours: 48, showCommercial: false });
    const before = (await notes('delegate')).filter((n) => n.title === 'Approve without signing in').length;
    await planAwaiting(65_000);
    expect((await notes('delegate')).filter((n) => n.title === 'Approve without signing in').length).toBe(
      before,
    );
    await setting('approvalLinks', { enabled: true, validHours: 48, showCommercial: false });
  });
});

// ------------------------------------------------------------------ NFR-L01 statutory window, shown on the tender route
describe('NFR-L01 minimum publication-to-close window', () => {
  it('a public-sector tender cannot close sooner than the statutory minimum after it is published', async () => {
    const c = await call('requester', 'POST', '/requests', {
      title: 'Window fixture',
      category: 'Building cleaning (UNSPSC 76111500)',
      estimatedValue: 90_000,
      termMonths: 24,
      businessUnit: 'Facilities',
      fields: { contractOwner: 'Sofia Rossi', background: 'Existing arrangements end in six months.' },
    });
    const rid = c.json().id as string;
    await call('requester', 'POST', `/requests/${rid}/submit`);
    const plan = (await call('procurement', 'GET', `/requests/${rid}/plan`)).json() as Json;
    await call('procurement', 'POST', `/plans/${plan.id}/submit-for-approval`);
    await call('delegate', 'POST', `/plans/${plan.id}/decision`, { decision: 'APPROVE' });
    const t = (
      await call('procurement', 'POST', '/tenders', { requestId: rid, type: 'RFT', access: 'CLOSED' })
    ).json() as Json;
    await call('delegate', 'POST', `/tenders/${t.id}/publish-permission`, {});
    const org = await sys<Json[]>((tx) => tx.select().from(s.tenant));
    expect(org[0]!.sector).toBe('PUBLIC');
    const tooSoon = await call('procurement', 'POST', `/tenders/${t.id}/publish`, {
      closesAt: new Date(env.clock.now().getTime() + 10 * 86_400_000).toISOString(),
    });
    expect(tooSoon.statusCode).toBe(422);
    expect(tooSoon.json().code).toBe('STATUTORY_WINDOW');
    expect(tooSoon.json().title).toMatch(/at least 25/);
    const fine = await call('procurement', 'POST', `/tenders/${t.id}/publish`, {
      closesAt: new Date(env.clock.now().getTime() + 26 * 86_400_000).toISOString(),
    });
    expect(fine.statusCode, fine.body).toBe(200);
  });
});
