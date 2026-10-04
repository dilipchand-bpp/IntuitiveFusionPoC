import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, type ManualClock } from '@if/shared';
import { buildApp } from '../../app.js';
import { withSystem, type Database } from '../../db/client.js';
import * as s from '../../db/schema.js';
import { emailFor, seedDatabase, TENANT_ID, uid } from '../../db/seed.js';
import { freshDb, newClock } from '../../test-helpers.js';
import { SealedStore, sha256 } from '../tender/files.js';

const PASSWORD = 'unit-test-password-123';
let app: FastifyInstance;
let database: Database;
let clock: ManualClock;
let store: SealedStore;

type Sess = { cookies: Record<string, string>; csrf: string };
const sessions = new Map<string, Sess>();
async function sessionFor(key: string): Promise<Sess> {
  if (sessions.has(key)) return sessions.get(key)!;
  const email = key.includes('@') ? key : emailFor(key);
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password: PASSWORD },
  });
  expect(res.statusCode, `${key}: ${res.body}`).toBe(200);
  const sess = {
    cookies: Object.fromEntries(res.cookies.map((c) => [c.name, c.value])),
    csrf: res.json().csrfToken as string,
  };
  sessions.set(key, sess);
  return sess;
}
async function call(key: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) {
  const sess = await sessionFor(key);
  return app.inject({
    method,
    url: `/api/v1${url}`,
    cookies: sess.cookies,
    headers: method === 'GET' ? {} : { 'x-csrf-token': sess.csrf },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
}

// ---------------------------------------------------------------- fixtures
const PDF = Buffer.from('%PDF-1.7\nTECHNICAL-CONTENT-MARKER');
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('COMMERCIAL-PRICING-MARKER')]);
const BIDDERS = ['brightwave', 'evergreen', 'northstar'] as const;
let titleSeq = 0;

/** A closed tender with submitted bids from three suppliers, each with a technical and a commercial file in sealed storage. */
async function closedTender(
  opts: { type?: 'RFT' | 'RFP' | 'RFQ' | 'RFI'; bids?: number; value?: number } = {},
) {
  const c = await call('requester', 'POST', '/requests', {
    title: `Evaluation fixture ${(titleSeq += 1)}`,
    category: 'Building cleaning (UNSPSC 76111500)',
    estimatedValue: opts.value ?? 90_000,
    termMonths: 24,
    businessUnit: 'Facilities',
    fields: { contractOwner: 'Sofia Rossi' },
  });
  expect(c.statusCode, c.body).toBe(201);
  const requestId = c.json().id as string;
  const past = new Date(clock.now().getTime() - 3 * 86_400_000);
  const tenderId = await withSystem(database, async (tx) => {
    const [t] = await tx
      .insert(s.tender)
      .values({
        tenantId: TENANT_ID,
        requestId,
        type: opts.type ?? 'RFT',
        access: 'CLOSED',
        status: 'CLOSED',
        opensAt: past,
        closesAt: past,
      })
      .returning();
    for (const key of BIDDERS.slice(0, opts.bids ?? 3)) {
      const [sub] = await tx
        .insert(s.submission)
        .values({
          tenantId: TENANT_ID,
          tenderId: t!.id,
          supplierId: uid(`supplier:${key}`),
          status: 'SUBMITTED',
          receipt: `RC-${key}`,
          submittedAt: past,
        })
        .returning();
      for (const [section, name, bytes, type] of [
        ['TECHNICAL', 'technical.pdf', PDF, 'application/pdf'],
        ['COMMERCIAL', 'pricing.xlsx', ZIP, 'application/zip'],
      ] as const) {
        const storageKey = `${TENANT_ID}/${sub!.id}/${randomUUID()}`;
        await store.put(storageKey, bytes);
        await tx.insert(s.fileObject).values({
          tenantId: TENANT_ID,
          submissionId: sub!.id,
          name,
          sizeBytes: bytes.length,
          contentType: type,
          storageKey,
          sha256: sha256(bytes),
          scan: 'CLEAN',
          section,
        });
      }
    }
    return t!.id;
  });
  return { tenderId, requestId };
}
const PANEL = (u: Record<string, string>) => [
  { userId: u.tech!, stream: 'TECHNICAL' },
  { userId: u.comm!, stream: 'COMMERCIAL' },
];
const U = { tech: uid('user:evaluator-tech'), comm: uid('user:evaluator-comm'), chair: uid('user:chair') };
type Ev = {
  id: string;
  status: string;
  tenderId: string;
  criteria: Array<{ id: string; name: string; stream: string; weight: number; passFail: boolean }>;
  panel: Array<{ userId: string; name: string; coiState: string; stream: string; scoringComplete: boolean }>;
  suppliers: Array<{
    supplierId: string;
    displayName: string;
    anonymised: boolean;
    files: Array<{ id: string; section: string; name: string }>;
  }>;
  consensus: Array<{
    supplierId: string;
    criterionId: string;
    flagged: boolean;
    variancePct: number | null;
    consensusScore: number | null;
    rationale: string | null;
    individual?: Array<{ evaluator: string; score: number; comment: string | null }>;
  }>;
  ranking: Array<{
    displayName: string;
    weightedScore: number;
    rank: number | null;
    compliance: string;
    qualityScore: number;
    priceScore: number | null;
    tco: number | null;
    valueForMoney: number | null;
  }>;
  report: null | {
    id: string;
    status: string;
    generatedAt: string;
    sections: Array<{ key: string; paragraphs: string[] }>;
    decision?: { decision: string; stamp: string };
  };
  me: null | { stream: string; coiState: string; scoringComplete: boolean; required: number; done: number };
  permissions: Record<string, boolean>;
  probitySignoff?: { by: string; stamp: string } | null;
  varianceLimitPct?: number;
  conflicts: Array<{ name: string; disposition: string; nature: string }>;
};
async function openEval(opts: Parameters<typeof closedTender>[0] = {}, panel = PANEL(U)) {
  const { tenderId, requestId } = await closedTender(opts);
  const r = await call('procurement', 'POST', `/tenders/${tenderId}/evaluation`, { panel });
  expect(r.statusCode, r.body).toBe(201);
  return { ev: r.json() as Ev, tenderId, requestId };
}
const view = async (key: string, id: string) => (await call(key, 'GET', `/evaluations/${id}`)).json() as Ev;
async function declareAll(id: string) {
  for (const k of ['evaluator-tech', 'evaluator-comm', 'chair']) {
    const r = await call(k, 'POST', `/evaluations/${id}/coi`, { none: true });
    expect(r.statusCode, `${k}: ${r.body}`).toBe(201);
  }
  expect((await view('procurement', id)).status).toBe('SCORING');
}
/** Scores every allowed cell for one evaluator; `pick` decides the score so tests can engineer agreement or disagreement. */
async function scoreAndSubmit(
  key: string,
  id: string,
  pick: (company: string, criterionName: string) => number,
  comment?: string,
) {
  const mine = (await call(key, 'GET', `/evaluations/${id}/scores/mine`)).json();
  for (const sup of mine.suppliers as Array<{ supplierId: string; displayName: string }>) {
    const put = await call(key, 'PUT', `/evaluations/${id}/scores`, {
      supplierId: sup.supplierId,
      scores: (mine.criteria as Array<{ id: string; name: string; passFail: boolean }>).map((c) => ({
        criterionId: c.id,
        score: c.passFail ? 10 : pick(sup.displayName, c.name),
        ...(comment ? { comment } : {}),
      })),
    });
    expect(put.statusCode, `${key}: ${put.body}`).toBe(200);
  }
  const sub = await call(key, 'POST', `/evaluations/${id}/scores/submit`);
  expect(sub.statusCode, `${key}: ${sub.body}`).toBe(200);
}

beforeAll(async () => {
  database = await freshDb();
  clock = newClock();
  const dir = await mkdtemp(join(tmpdir(), 'if-eval-'));
  store = new SealedStore(dir, 'e'.repeat(40));
  // the store makes the seeded bid files real (sealed on disk) so they can be downloaded like any other
  await seedDatabase(database, { clock, password: PASSWORD, store });
  app = await buildApp(loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 'e'.repeat(40), STORAGE_DIR: dir }), {
    database,
    clock,
    loginRateLimitMax: 10_000,
  });
}, 120_000);

// =================================================================== B3 helpers
const bumpFor = (company: string) =>
  company.startsWith('Brightwave') ? 2 : company.startsWith('Evergreen') ? 0 : -2;
const SUP = {
  brightwave: uid('supplier:brightwave'),
  evergreen: uid('supplier:evergreen'),
  northstar: uid('supplier:northstar'),
};
const EXTRA = uid('user:evaluator-extra');
const ADVISOR = uid('user:advisor');

async function setSetting(name: string, value: unknown) {
  const r = await call('admin', 'PUT', '/admin/settings', { [name]: value });
  expect(r.statusCode, r.body).toBe(200);
}
async function resetSuppliers() {
  await withSystem(database, (tx) =>
    tx
      .update(s.supplier)
      .set({ insuranceStatus: 'CURRENT', sanctionsStatus: 'CLEAR', onboarding: {} })
      .where(eq(s.supplier.tenantId, TENANT_ID)),
  );
}
/** Scores, agrees, locks: Brightwave > Evergreen > Northstar. */
async function lockEvaluation(id: string, pick = (c: string) => 7 + bumpFor(c)) {
  await declareAll(id);
  await scoreAndSubmit('evaluator-tech', id, (c) => pick(c), 'Solid response');
  await scoreAndSubmit('evaluator-comm', id, (c) => pick(c));
  await scoreAndSubmit('chair', id, (c) => pick(c));
  const open = (await call('chair', 'POST', `/evaluations/${id}/consensus/open`)).json() as Ev;
  for (const sup of open.suppliers) {
    const put = await call('chair', 'PUT', `/evaluations/${id}/consensus/${sup.supplierId}`, {
      items: open.criteria.map((c) => ({ criterionId: c.id, consensusScore: pick(sup.displayName) })),
    });
    expect(put.statusCode, put.body).toBe(200);
  }
  const lock = await call('chair', 'POST', `/evaluations/${id}/consensus/lock`);
  expect(lock.statusCode, lock.body).toBe(200);
}
async function lockedEval(value = 90_000) {
  const { ev, tenderId } = await openEval({ value });
  await lockEvaluation(ev.id);
  return { id: ev.id, tenderId };
}
const auditActions = async (entityId: string) =>
  (
    await withSystem(database, (tx) =>
      tx.select().from(s.auditEvent).where(eq(s.auditEvent.entityId, entityId)),
    )
  ).map((e) => e.action);

// =================================================================== FR-0265 compliance gate
describe('FR-0265 the mandatory compliance gate', () => {
  it('runs on every bidder when the evaluation opens, names each missed requirement, asks the supplier to clarify, and excludes the failed supplier from the ranking until a person waives it', async () => {
    await resetSuppliers();
    await withSystem(database, (tx) =>
      tx.update(s.supplier).set({ insuranceStatus: 'EXPIRED' }).where(eq(s.supplier.id, SUP.brightwave)),
    );
    const { ev } = await openEval();
    const pv = await view('procurement', ev.id);
    const checks = (
      pv as unknown as {
        compliance: Array<{ supplierId: string; key: string; result: string; detail: string }>;
      }
    ).compliance;
    expect(checks).toHaveLength(12); // four checks for each of three bidders
    expect(checks.filter((c) => c.result === 'FAIL')).toEqual([
      expect.objectContaining({
        supplierId: SUP.brightwave,
        key: 'INSURANCE',
        detail: expect.stringMatching(/expired/),
      }),
    ]);
    // the failing supplier was asked, automatically, to put it right
    const mine = (
      (await call('supplier', 'GET', '/supplier/clarifications')).json().clarifications as Array<{
        evaluationId: string;
        kind: string;
        subject: string;
        status: string;
      }>
    ).filter((c) => c.evaluationId === ev.id);
    expect(mine).toEqual([
      expect.objectContaining({ kind: 'COMPLIANCE', subject: 'Compliance: Insurance', status: 'OPEN' }),
    ]);
    expect(
      (
        await withSystem(database, (tx) =>
          tx.select().from(s.outboundEmail).where(eq(s.outboundEmail.kind, 'CLARIFICATION')),
        )
      ).length,
    ).toBeGreaterThan(0);

    await lockEvaluation(ev.id);
    let after = await view('procurement', ev.id);
    expect(after.ranking.find((r) => r.displayName.startsWith('Brightwave'))).toMatchObject({
      rank: null,
      compliance: 'FAIL',
    });
    expect(after.ranking.find((r) => r.displayName.startsWith('Evergreen'))!.rank).toBe(1);

    // only procurement or a delegate can waive, with a real reason, and only a failed check
    expect(
      (
        await call(
          'evaluator-tech',
          'POST',
          `/evaluations/${ev.id}/compliance/${SUP.brightwave}/INSURANCE/waive`,
          { note: 'x'.repeat(12) },
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(
          'procurement',
          'POST',
          `/evaluations/${ev.id}/compliance/${SUP.brightwave}/INSURANCE/waive`,
          { note: 'short' },
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call(
          'procurement',
          'POST',
          `/evaluations/${ev.id}/compliance/${SUP.evergreen}/INSURANCE/waive`,
          { note: 'Nothing to waive here' },
        )
      ).statusCode,
    ).toBe(409);
    const ok = await call(
      'procurement',
      'POST',
      `/evaluations/${ev.id}/compliance/${SUP.brightwave}/INSURANCE/waive`,
      {
        note: 'Certificate sighted by email; renewal in progress',
      },
    );
    expect(ok.statusCode, ok.body).toBe(200);
    after = await view('procurement', ev.id);
    expect(after.ranking.find((r) => r.displayName.startsWith('Brightwave'))!.rank).toBe(1);
    expect(await auditActions(ev.id)).toEqual(
      expect.arrayContaining(['evaluation.compliance_gate', 'compliance.waive', 'report.compile']),
    );
    // the report records the waiver
    const report = after.report!.sections.find((x) => x.key === 'compliance')!.paragraphs.join(' ');
    expect(report).toMatch(/Brightwave.*Insurance waived/);
    await resetSuppliers();
  });

  it('can require insurance to be on record, fails an unsupported declaration, and is re-run on request', async () => {
    await resetSuppliers();
    await setSetting('evaluationRules', {
      requireInsurance: true,
      rankingMaxValueAud: 100_000,
      redeclarationReminderHours: 24,
      clarificationDays: 5,
    });
    await withSystem(database, (tx) =>
      tx
        .update(s.supplier)
        .set({
          insuranceStatus: 'UNKNOWN',
          onboarding: { answers: { x: 'NO' }, flagged: ['Modern slavery policy'] },
        })
        .where(eq(s.supplier.id, SUP.evergreen)),
    );
    const { ev } = await openEval();
    const fails = (
      (await view('procurement', ev.id)) as unknown as {
        compliance: Array<{ result: string; key: string; supplierId: string }>;
      }
    ).compliance.filter((c) => c.result === 'FAIL');
    expect(fails.map((c) => c.key).sort()).toEqual(['DECLARATIONS', 'INSURANCE']);
    expect(fails.every((c) => c.supplierId === SUP.evergreen)).toBe(true);
    // fix the data and re-run: the checks become passes and no new request is sent
    await resetSuppliers();
    const rerun = await call('procurement', 'POST', `/evaluations/${ev.id}/compliance/run`);
    expect(rerun.statusCode, rerun.body).toBe(200);
    expect(
      (rerun.json() as { compliance: Array<{ result: string }> }).compliance.filter(
        (c) => c.result === 'FAIL',
      ),
    ).toEqual([]);
    expect((await call('evaluator-tech', 'POST', `/evaluations/${ev.id}/compliance/run`)).statusCode).toBe(
      403,
    );
    await setSetting('evaluationRules', {
      requireInsurance: false,
      rankingMaxValueAud: 100_000,
      redeclarationReminderHours: 24,
      clarificationDays: 5,
    });
  });
});

// =================================================================== FR-0290 clarifications
describe('FR-0290 audited clarification requests with response deadlines', () => {
  it('procurement asks, the supplier answers before the deadline, and an answer after the deadline is refused', async () => {
    await resetSuppliers();
    const { ev } = await openEval();
    const ask = await call('procurement', 'POST', `/evaluations/${ev.id}/clarifications`, {
      supplierId: SUP.brightwave,
      subject: 'Transition plan',
      question: 'Explain how the first 30 days of transition will be staffed.',
      dueInDays: 3,
    });
    expect(ask.statusCode, ask.body).toBe(201);
    const id = ask.json().id as string;
    expect(
      (
        await call('evaluator-tech', 'POST', `/evaluations/${ev.id}/clarifications`, {
          supplierId: SUP.brightwave,
          subject: 'No',
          question: 'Not allowed to ask this',
        })
      ).statusCode,
    ).toBe(403);
    const list = (await call('supplier', 'GET', '/supplier/clarifications')).json().clarifications as Array<{
      id: string;
      status: string;
    }>;
    expect(list.find((c) => c.id === id)!.status).toBe('OPEN');
    // someone else's request looks like it does not exist
    expect(
      (
        await call('evaluator-tech', 'POST', `/supplier/clarifications/${id}/response`, {
          response: 'hi there',
        })
      ).statusCode,
    ).toBe(403);
    const ans = await call('supplier', 'POST', `/supplier/clarifications/${id}/response`, {
      response: 'A dedicated transition lead and four technicians for 30 days.',
    });
    expect(ans.statusCode, ans.body).toBe(200);
    expect(ans.json().status).toBe('ANSWERED');
    expect(
      (
        await call('supplier', 'POST', `/supplier/clarifications/${id}/response`, {
          response: 'again please',
        })
      ).statusCode,
    ).toBe(409);
    const staff = (await call('probity', 'GET', `/evaluations/${ev.id}/clarifications`)).json()
      .clarifications as Array<{ id: string; response: string }>;
    expect(staff.find((c) => c.id === id)!.response).toMatch(/transition lead/);

    const late = (
      await call('procurement', 'POST', `/evaluations/${ev.id}/clarifications`, {
        supplierId: SUP.brightwave,
        subject: 'Referees',
        question: 'Provide two referees for similar work.',
        dueInDays: 1,
      })
    ).json().id as string;
    await withSystem(database, (tx) =>
      tx
        .update(s.clarification)
        .set({ dueAt: new Date(clock.now().getTime() - 1000) })
        .where(eq(s.clarification.id, late)),
    );
    const refused = await call('supplier', 'POST', `/supplier/clarifications/${late}/response`, {
      response: 'Too late for this',
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe('RESPONSE_PERIOD_ENDED');
    expect(
      (
        (await call('probity', 'GET', `/evaluations/${ev.id}/clarifications`)).json()
          .clarifications as Array<{ id: string; overdue: boolean }>
      ).find((c) => c.id === late)!.overdue,
    ).toBe(true);
    expect(await auditActions(ev.id)).toEqual(
      expect.arrayContaining(['clarification.request', 'clarification.respond']),
    );
  });
});

// =================================================================== bid pricing, ranking mode, blend
describe('FR-0280 ranking mode blended with normalised total cost of ownership', () => {
  it('a supplier enters price, implementation and running costs while the tender is open, and not after it closes', async () => {
    const { requestId } = await closedTender();
    const open = await withSystem(database, async (tx) => {
      const [t] = await tx
        .insert(s.tender)
        .values({
          tenantId: TENANT_ID,
          requestId,
          type: 'RFT',
          access: 'OPEN',
          status: 'PUBLISHED',
          opensAt: new Date(clock.now().getTime() - 86_400_000),
          closesAt: new Date(clock.now().getTime() + 5 * 86_400_000),
        })
        .returning();
      return t!;
    });
    const put = await call('supplier', 'PUT', `/supplier/tenders/${open.id}/pricing`, {
      basePrice: 100_000,
      implementation: 20_000,
      annualRunning: 10_000,
      years: 3,
    });
    expect(put.statusCode, put.body).toBe(200);
    expect(put.json().pricing.tco).toBe(150_000); // 100,000 + 20,000 + 10,000 x 3
    expect((await call('supplier', 'GET', `/supplier/tenders/${open.id}/pricing`)).json().pricing.tco).toBe(
      150_000,
    );
    // the audit trail records that pricing was entered, never the sums
    const audit = await withSystem(database, (tx) =>
      tx
        .select()
        .from(s.auditEvent)
        .where(and(eq(s.auditEvent.entityId, open.id), eq(s.auditEvent.action, 'bid.pricing'))),
    );
    expect(JSON.stringify(audit)).not.toContain('100000');
    expect(
      (await call('supplier', 'PUT', `/supplier/tenders/${open.id}/pricing`, { basePrice: -5 })).statusCode,
    ).toBe(400);
    // once closed, the tender stays visible to the suppliers invited to it, but pricing can no longer change
    await withSystem(database, async (tx) => {
      await tx.insert(s.invitation).values({
        tenantId: TENANT_ID,
        tenderId: open.id,
        email: 'sam@brightwave.example',
        company: 'Brightwave Cleaning Pty Ltd',
        tokenHash: randomUUID(),
        expiresAt: new Date(clock.now().getTime() + 86_400_000),
        supplierId: SUP.brightwave,
      });
      await tx
        .update(s.tender)
        .set({ status: 'CLOSED', closesAt: new Date(clock.now().getTime() - 1000) })
        .where(eq(s.tender.id, open.id));
    });
    const late = await call('supplier', 'PUT', `/supplier/tenders/${open.id}/pricing`, { basePrice: 1 });
    expect(late.statusCode).toBe(409);
    expect(late.json().code).toBe('BID_CLOSED');
    expect(
      (await call('evaluator-tech', 'PUT', `/supplier/tenders/${open.id}/pricing`, { basePrice: 1 }))
        .statusCode,
    ).toBe(403);
  });

  it('evaluators rank instead of scoring; the final order blends the panel view with normalised total cost, and ranking is refused above the value limit', async () => {
    await resetSuppliers();
    const big = await closedTender({ value: 400_000 });
    const refused = await call('procurement', 'POST', `/tenders/${big.tenderId}/evaluation`, {
      panel: PANEL(U),
      mode: 'RANKING',
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe('RANKING_NOT_ALLOWED');

    const { tenderId } = await closedTender({ value: 60_000 });
    const opened = await call('procurement', 'POST', `/tenders/${tenderId}/evaluation`, {
      panel: PANEL(U),
      mode: 'RANKING',
      priceWeightPct: 40,
    });
    expect(opened.statusCode, opened.body).toBe(201);
    const ev = opened.json() as Ev & { mode: string; priceWeightPct: number };
    expect(ev.mode).toBe('RANKING');
    expect(ev.priceWeightPct).toBe(40);
    expect(ev.criteria.map((c) => c.name)).toEqual(['Overall preference']);
    await declareAll(ev.id);
    // the panel prefers Brightwave > Evergreen > Northstar; Northstar is far cheaper
    await withSystem(database, async (tx) => {
      const subs = await tx.select().from(s.submission).where(eq(s.submission.tenderId, tenderId));
      const price = (key: string) =>
        key === 'brightwave' ? 300_000 : key === 'evergreen' ? 200_000 : 100_000;
      for (const sub of subs) {
        const key = (Object.entries(SUP).find(([, v]) => v === sub.supplierId) ?? ['x'])[0]!;
        await tx.insert(s.bidPricing).values({
          tenantId: TENANT_ID,
          submissionId: sub.id,
          basePrice: String(price(key)),
          tco: String(price(key)),
        });
      }
    });
    const mine = (await call('evaluator-tech', 'GET', `/evaluations/${ev.id}/scores/mine`)).json() as {
      suppliers: Array<{ supplierId: string; displayName: string }>;
    };
    const idOf = (name: string) => mine.suppliers.find((x) => x.displayName === name)!.supplierId;
    // ordering by plain language: letters are labels until the names are shown, so use the company names
    const names = (await view('evaluator-tech', ev.id)).suppliers;
    const byCompany = (prefix: string) => names.find((x) => x.displayName.startsWith(prefix))!.supplierId;
    const order = [byCompany('Brightwave'), byCompany('Evergreen'), byCompany('Northstar')];
    void idOf;
    // wrong inputs are refused
    expect(
      (await call('evaluator-tech', 'PUT', `/evaluations/${ev.id}/ranking`, { order: order.slice(0, 2) }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await call('evaluator-tech', 'PUT', `/evaluations/${ev.id}/ranking`, {
          order: [order[0], order[0], order[1]],
        })
      ).statusCode,
    ).toBe(400);
    for (const who of ['evaluator-tech', 'evaluator-comm', 'chair']) {
      const r = await call(who, 'PUT', `/evaluations/${ev.id}/ranking`, { order });
      expect(r.statusCode, `${who}: ${r.body}`).toBe(200);
      expect((await call(who, 'POST', `/evaluations/${ev.id}/scores/submit`)).statusCode).toBe(200);
    }
    const open = (await call('chair', 'POST', `/evaluations/${ev.id}/consensus/open`)).json() as Ev;
    for (const sup of open.suppliers) {
      const cell = open.consensus.find((c) => c.supplierId === sup.supplierId)!;
      expect(cell.flagged).toBe(false); // all three ranked alike, so nothing is flagged
      const agreed = sup.displayName.startsWith('Brightwave')
        ? 10
        : sup.displayName.startsWith('Evergreen')
          ? 5
          : 0;
      expect(
        (
          await call('chair', 'PUT', `/evaluations/${ev.id}/consensus/${sup.supplierId}`, {
            items: [{ criterionId: cell.criterionId, consensusScore: agreed }],
          })
        ).statusCode,
      ).toBe(200);
    }
    expect((await call('chair', 'POST', `/evaluations/${ev.id}/consensus/lock`)).statusCode).toBe(200);
    const locked = (await view('procurement', ev.id)) as Ev & {
      ranking: Array<{
        displayName: string;
        weightedScore: number;
        qualityScore: number;
        rank: number;
        tco: number;
        priceScore: number;
        valueForMoney: number;
      }>;
    };
    const r = (p: string) => locked.ranking.find((x) => x.displayName.startsWith(p))!;
    // quality: 100, 50, 0.  Price score (lowest / this): 33.33, 50, 100.  Blend 60/40.
    expect(r('Brightwave').qualityScore).toBe(100);
    expect(r('Evergreen').qualityScore).toBe(50);
    expect(r('Northstar').priceScore).toBe(100);
    expect(r('Brightwave').priceScore).toBeCloseTo(33.33, 1);
    expect(r('Brightwave').weightedScore).toBeCloseTo(73.33, 1);
    expect(r('Evergreen').weightedScore).toBeCloseTo(50, 1);
    expect(r('Northstar').weightedScore).toBeCloseTo(40, 1);
    expect(locked.ranking.map((x) => x.displayName.split(' ')[0])).toEqual([
      'Brightwave',
      'Evergreen',
      'Northstar',
    ]);
    // a higher price weighting changes the order: Northstar becomes first at 90%
    await withSystem(database, (tx) =>
      tx.update(s.evaluation).set({ priceWeightPct: 80 }).where(eq(s.evaluation.id, ev.id)),
    );
    const heavy = (await view('procurement', ev.id)) as typeof locked;
    expect(heavy.ranking[0]!.displayName).toMatch(/^Northstar/);
    // the compiled report explains the blend and the value for money
    const rep = locked.report!.sections.find((x) => x.key === 'commercial')!.paragraphs.join(' ');
    expect(rep).toMatch(/normalised/);
    expect(rep).toMatch(/Northstar.*price score 100/);
  });
});

// =================================================================== plain language
describe('FR-0315 scores, ranking and commentary in plain language', () => {
  it('reads a sentence into proposed scores, shows how it was read, and saves only when applied; a person can still change them', async () => {
    const { ev } = await openEval();
    await declareAll(ev.id);
    const v = await view('evaluator-tech', ev.id);
    const sup = v.suppliers.find((x) => x.displayName.startsWith('Evergreen'))!;
    const text =
      'Technical capability is strong. Delivery and risk management is weak, 3 out of 10. The weather was nice.';
    const preview = await call('evaluator-tech', 'POST', `/evaluations/${ev.id}/scores/plain`, {
      supplierId: sup.supplierId,
      text,
    });
    expect(preview.statusCode, preview.body).toBe(200);
    const read = preview.json() as {
      applied: boolean;
      scores: Array<{ criterion: string; score: number; basis: string }>;
      unmatched: string[];
    };
    expect(read.applied).toBe(false);
    expect(read.scores).toEqual([
      expect.objectContaining({ criterion: 'Technical capability and approach', score: 8.5 }),
      expect.objectContaining({
        criterion: 'Delivery, transition and risk management',
        score: 3,
        basis: '3 out of 10',
      }),
    ]);
    expect(read.unmatched).toEqual(['The weather was nice']);
    // nothing was saved by the preview
    expect(
      (
        (await call('evaluator-tech', 'GET', `/evaluations/${ev.id}/scores/mine`)).json().suppliers as Array<{
          supplierId: string;
          scores: unknown[];
        }>
      ).find((x) => x.supplierId === sup.supplierId)!.scores,
    ).toEqual([]);
    const applied = await call('evaluator-tech', 'POST', `/evaluations/${ev.id}/scores/plain`, {
      supplierId: sup.supplierId,
      text,
      apply: true,
    });
    expect(applied.json().applied).toBe(true);
    const saved = (
      (await call('evaluator-tech', 'GET', `/evaluations/${ev.id}/scores/mine`)).json().suppliers as Array<{
        supplierId: string;
        scores: Array<{ score: number; comment: string }>;
      }>
    ).find((x) => x.supplierId === sup.supplierId)!.scores;
    expect(saved.map((x) => x.score).sort()).toEqual([3, 8.5]);
    expect(saved.find((x) => x.score === 3)!.comment).toMatch(/Delivery and risk/); // the sentence is kept as commentary
    // a technical evaluator cannot reach a commercial criterion by naming it; nothing is read for it
    const price = await call('evaluator-tech', 'POST', `/evaluations/${ev.id}/scores/plain`, {
      supplierId: sup.supplierId,
      text: 'Price is excellent.',
    });
    expect(price.json().scores).toEqual([]);
    const nothing = await call('evaluator-tech', 'POST', `/evaluations/${ev.id}/scores/plain`, {
      supplierId: sup.supplierId,
      text: 'Nice people all round.',
      apply: true,
    });
    expect(nothing.statusCode).toBe(400);
    expect(nothing.json().code).toBe('NOTHING_UNDERSTOOD');
    expect(
      (
        await call('evaluator-tech', 'POST', `/evaluations/${ev.id}/scores/plain`, {
          supplierId: uid('supplier:summit'),
          text: 'Technical capability is strong.',
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await call('procurement', 'POST', `/evaluations/${ev.id}/scores/plain`, {
          supplierId: sup.supplierId,
          text: 'Technical capability is strong.',
        })
      ).statusCode,
    ).toBe(403);
  });

  it('reads a ranking said in words, naming suppliers by label or by name', async () => {
    const { tenderId } = await closedTender({ value: 60_000 });
    const opened = await call('procurement', 'POST', `/tenders/${tenderId}/evaluation`, {
      panel: PANEL(U),
      mode: 'RANKING',
    });
    const ev = opened.json() as Ev;
    await declareAll(ev.id);
    const peek = await call('evaluator-tech', 'POST', `/evaluations/${ev.id}/ranking/plain`, {
      text: 'Northstar first, then Evergreen, and last Brightwave',
    });
    expect(peek.statusCode, peek.body).toBe(200);
    expect(
      (peek.json().order as Array<{ displayName: string }>).map((x) => x.displayName.split(' ')[0]),
    ).toEqual(['Northstar', 'Evergreen', 'Brightwave']);
    const incomplete = await call('evaluator-tech', 'POST', `/evaluations/${ev.id}/ranking/plain`, {
      text: 'Northstar then Evergreen',
      apply: true,
    });
    expect(incomplete.statusCode).toBe(400);
    expect(incomplete.json().errors[0].message).toMatch(/Brightwave/);
    const done = await call('evaluator-tech', 'POST', `/evaluations/${ev.id}/ranking/plain`, {
      text: 'Northstar first, then Evergreen, and last Brightwave',
      apply: true,
    });
    expect(done.json().applied).toBe(true);
    const scores = (await call('evaluator-tech', 'GET', `/evaluations/${ev.id}/scores/mine`)).json()
      .suppliers as Array<{ displayName: string; scores: Array<{ score: number }> }>;
    const of = (p: string) => scores.find((x) => x.displayName.startsWith(p))!.scores[0]!.score;
    expect([of('Northstar'), of('Evergreen'), of('Brightwave')]).toEqual([10, 5, 0]);
    // a scored evaluation has no ranking entry, and vice versa
    const scored = await openEval();
    await declareAll(scored.ev.id);
    expect(
      (
        await call('evaluator-tech', 'PUT', `/evaluations/${scored.ev.id}/ranking`, {
          order: [uid('supplier:brightwave')],
        })
      ).statusCode,
    ).toBe(409);
  });
});

// =================================================================== criteria library
describe('FR-0320 criteria from a library, different for each stage', () => {
  it('procurement picks criteria from the library before scoring opens; weights must add to 100, every stream needs an evaluator, and the choice is audited', async () => {
    const lib = (await call('procurement', 'GET', '/criteria-library')).json().criteria as Array<{
      name: string;
      stream: string;
      weight: number;
      passFail: boolean;
    }>;
    expect(lib.length).toBeGreaterThan(8);
    expect((await call('evaluator-tech', 'GET', '/criteria-library')).statusCode).toBe(403);
    const { ev } = await openEval();
    const pick = (n: string) => lib.find((c) => c.name === n)!;
    const set = (criteria: unknown) =>
      call('procurement', 'PUT', `/evaluations/${ev.id}/criteria`, { criteria });
    const good = [
      { ...pick('Security and data protection'), weight: 25 },
      { ...pick('Technical capability and approach'), weight: 35 },
      { ...pick('Price and commercial terms'), weight: 30 },
      { ...pick('Sustainability and social value'), weight: 10 },
      pick('Compliance with the specification (pass or fail)'),
    ];
    expect((await set(good.map((c) => ({ ...c, weight: c.weight === 25 ? 30 : c.weight })))).statusCode).toBe(
      400,
    ); // adds to 105
    expect(
      (
        await set([
          { name: 'Alone', stream: 'TECHNICAL', weight: 100, passFail: false },
          { name: 'alone', stream: 'TECHNICAL', weight: 0, passFail: true },
        ])
      ).statusCode,
    ).toBe(400);
    const ok = await set(good);
    expect(ok.statusCode, ok.body).toBe(200);
    expect((ok.json() as Ev).criteria.map((c) => c.name).sort()).toEqual(good.map((c) => c.name).sort());
    expect(await auditActions(ev.id)).toContain('evaluation.criteria_set');
    // once everyone has declared and scoring is open, the sheet is fixed
    await declareAll(ev.id);
    const closed = await set(good);
    expect(closed.statusCode).toBe(409);
    expect(
      (await call('evaluator-tech', 'PUT', `/evaluations/${ev.id}/criteria`, { criteria: good })).statusCode,
    ).toBe(403);
  });

  it('a later stage can use different criteria from the first', async () => {
    const a = await openEval();
    const b = await openEval();
    const aNames = a.ev.criteria.map((c) => c.name).sort();
    const r = await call('procurement', 'PUT', `/evaluations/${b.ev.id}/criteria`, {
      criteria: [
        { name: 'Quality of proposed solution', stream: 'TECHNICAL', weight: 60, passFail: false },
        { name: 'Price and value for money', stream: 'COMMERCIAL', weight: 40, passFail: false },
      ],
    });
    expect(r.statusCode, r.body).toBe(200);
    expect((r.json() as Ev).criteria.map((c) => c.name).sort()).not.toEqual(aNames);
    expect((await view('procurement', a.ev.id)).criteria.map((c) => c.name).sort()).toEqual(aNames);
  });
});

// =================================================================== conflicts
describe('FR-0325 re-declaration after supplier identities are known', () => {
  it('asks each member to confirm again once they can see the names, reports who has not, reminds, and a conflict then suspends the member', async () => {
    const { ev } = await openEval();
    // the first declaration is the one made before anything is visible; once made, a second is requested at once
    expect(
      (await call('evaluator-tech', 'POST', `/evaluations/${ev.id}/coi`, { none: true })).statusCode,
    ).toBe(201);
    const note = (await call('evaluator-tech', 'GET', '/notifications')).json() as
      Array<{ title: string }> | { notifications: Array<{ title: string }> };
    const titles = (Array.isArray(note) ? note : note.notifications).map((n) => n.title);
    expect(titles).toContain('Confirm your declaration now you can see the suppliers');
    expect((await view('evaluator-tech', ev.id)).me).toMatchObject({ needsRedeclaration: true });
    expect((await view('evaluator-tech', ev.id)).permissions.canRedeclare).toBe(true);

    const status = (await call('procurement', 'GET', `/evaluations/${ev.id}/coi/status`)).json() as {
      outstanding: string[];
      members: Array<{ name: string; redeclaration: string }>;
    };
    expect(status.members.find((m) => m.name === 'Tomas Silva')!.redeclaration).toBe('OUTSTANDING');
    expect(status.members.find((m) => m.name === 'Mei Tanaka')!.redeclaration).toBe('AWAITING_FIRST');
    expect(status.outstanding).toHaveLength(3);
    expect((await call('evaluator-tech', 'GET', `/evaluations/${ev.id}/coi/status`)).statusCode).toBe(403);

    // a reminder goes to the outstanding members and is recorded; the schedule repeats it only after the period
    const first = (await call('procurement', 'POST', `/evaluations/${ev.id}/coi/remind`)).json() as {
      reminded: string[];
    };
    expect(first.reminded).toHaveLength(3);
    const reminded = await withSystem(database, (tx) =>
      tx.select().from(s.panelMember).where(eq(s.panelMember.evaluationId, ev.id)),
    );
    expect(reminded.every((m) => m.remindedAt)).toBe(true);
    await call('procurement', 'GET', '/evaluations'); // the list sweeps due reminders: none is due yet
    const remindersFor = async () =>
      (
        await withSystem(database, (tx) =>
          tx.select().from(s.notification).where(eq(s.notification.userId, U.tech)),
        )
      ).filter((x) => x.title.startsWith('Reminder') && x.link === `/app/evaluations/${ev.id}`).length;
    const n1 = await remindersFor();
    clock.advanceMs(25 * 3_600_000);
    sessions.clear();
    await call('procurement', 'GET', '/evaluations');
    expect(await remindersFor()).toBe(n1 + 1);

    expect(
      (await call('evaluator-tech', 'POST', `/evaluations/${ev.id}/coi/redeclare`, { none: true }))
        .statusCode,
    ).toBe(201);
    expect(
      (await call('evaluator-tech', 'POST', `/evaluations/${ev.id}/coi/redeclare`, { none: true }))
        .statusCode,
    ).toBe(409);
    expect(
      (await call('evaluator-comm', 'POST', `/evaluations/${ev.id}/coi/redeclare`, { none: true }))
        .statusCode,
    ).toBe(409); // not yet declared the first time
    // the other two declare, and the one who now recognises a bidder says so
    expect(
      (await call('evaluator-comm', 'POST', `/evaluations/${ev.id}/coi`, { none: true })).statusCode,
    ).toBe(201);
    expect((await call('chair', 'POST', `/evaluations/${ev.id}/coi`, { none: true })).statusCode).toBe(201);
    const c = await call('evaluator-comm', 'POST', `/evaluations/${ev.id}/coi/redeclare`, {
      none: false,
      nature: 'I now see my brother-in-law runs Northstar',
      subjectOrg: 'Northstar',
    });
    expect(c.statusCode, c.body).toBe(201);
    expect(c.json().suspended).toBe(true);
    expect((await call('evaluator-comm', 'GET', `/evaluations/${ev.id}`)).statusCode).toBe(404);
    expect(await auditActions(ev.id)).toEqual(
      expect.arrayContaining(['coi.redeclare_none', 'coi.redeclare_conflict', 'coi.remind']),
    );
    const done = (await call('procurement', 'GET', `/evaluations/${ev.id}/coi/status`)).json() as {
      members: Array<{ name: string; redeclaration: string }>;
    };
    expect(done.members.find((m) => m.name === 'Mei Tanaka')!.redeclaration).toBe('CONFLICT');
    clock.advanceMs(-25 * 3_600_000);
    sessions.clear();
  });
});

describe('FR-0330 conflict dispositions: immaterial, minor, material', () => {
  async function conflicted(subjectOrg: string) {
    const { ev } = await openEval();
    const r = await call('evaluator-comm', 'POST', `/evaluations/${ev.id}/coi`, {
      none: false,
      nature: 'A relative works at a bidder',
      subjectOrg,
    });
    expect(r.json().suspended).toBe(true);
    return ev;
  }
  it('a minor conflict keeps the evaluator on the panel but away from the supplier concerned; the ruling names who decided and in what capacity', async () => {
    const ev = await conflicted('Northstar');
    // the risk and compliance role may decide, as may a delegate; a panel colleague may not
    expect(
      (
        await call('evaluator-tech', 'POST', `/evaluations/${ev.id}/conflicts/${U.comm}/decision`, {
          disposition: 'MANAGEABLE',
        })
      ).statusCode,
    ).toBe(403);
    const ok = await call('probity', 'POST', `/evaluations/${ev.id}/conflicts/${U.comm}/decision`, {
      disposition: 'MANAGEABLE',
      rationale: 'Remote relationship; excluded from the supplier concerned.',
    });
    expect(ok.statusCode, ok.body).toBe(200);
    const rows = await withSystem(database, (tx) =>
      tx.select().from(s.coiDeclaration).where(eq(s.coiDeclaration.scopeId, ev.id)),
    );
    expect(rows[0]).toMatchObject({
      disposition: 'MANAGEABLE',
      excludedSupplierId: SUP.northstar,
      decidedByRole: 'PROBITY',
    });
    // after everyone declares, the evaluator sees two suppliers, not three, and cannot score the excluded one
    for (const k of ['evaluator-tech', 'chair'])
      await call(k, 'POST', `/evaluations/${ev.id}/coi`, { none: true });
    await call('evaluator-comm', 'GET', `/evaluations/${ev.id}`);
    const mine = (await call('evaluator-comm', 'GET', `/evaluations/${ev.id}/scores/mine`)).json() as {
      suppliers: Array<{ supplierId: string }>;
      progress: { required: number };
    };
    expect(mine.suppliers.map((x) => x.supplierId)).not.toContain(SUP.northstar);
    expect(mine.suppliers).toHaveLength(2);
    const criterion = (await view('evaluator-comm', ev.id)).criteria[0]!;
    const blocked = await call('evaluator-comm', 'PUT', `/evaluations/${ev.id}/scores`, {
      supplierId: SUP.northstar,
      scores: [{ criterionId: criterion.id, score: 5 }],
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().code).toBe('COI_EXCLUDED_SUPPLIER');
    // they can finish their own scoring of the two others, and consensus can open
    await scoreAndSubmit('evaluator-comm', ev.id, () => 7);
    await scoreAndSubmit('evaluator-tech', ev.id, () => 7);
    await scoreAndSubmit('chair', ev.id, () => 7);
    expect((await call('chair', 'POST', `/evaluations/${ev.id}/consensus/open`)).statusCode).toBe(200);
  });
  it('immaterial reinstates fully; material removes the person; only one of the three dispositions is accepted', async () => {
    const a = await conflicted('Evergreen');
    expect(
      (
        await call('delegate', 'POST', `/evaluations/${a.id}/conflicts/${U.comm}/decision`, {
          disposition: 'IMMATERIAL',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await call('delegate', 'POST', `/evaluations/${a.id}/conflicts/${U.comm}/decision`, {
          disposition: 'IMMATERIAL',
        })
      ).statusCode,
    ).toBe(409);
    const b = await conflicted('Evergreen');
    expect(
      (
        await call('delegate', 'POST', `/evaluations/${b.id}/conflicts/${U.comm}/decision`, {
          disposition: 'UNKNOWN',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call('exec', 'POST', `/evaluations/${b.id}/conflicts/${U.comm}/decision`, {
          disposition: 'MATERIAL',
        })
      ).statusCode,
    ).toBe(200);
    expect((await call('evaluator-comm', 'GET', `/evaluations/${b.id}`)).statusCode).toBe(404);
    expect(
      ((await view('procurement', b.id)).panel.find((m) => m.userId === U.comm) as { coiState: string })
        .coiState,
    ).toBe('REMOVED');
  });
});

describe('FR-0305 and FR-0335 replacing an evaluator', () => {
  it("after a material conflict the replacement is nominated, gets every outstanding task, starts with a clean matrix, and the leaver's marks stay as history but are left out of the averages", async () => {
    const { ev } = await openEval();
    await declareAll(ev.id);
    // the commercial evaluator scores most of it, then a conflict surfaces and is found material
    const mine = (await call('evaluator-comm', 'GET', `/evaluations/${ev.id}/scores/mine`)).json() as {
      criteria: Array<{ id: string }>;
      suppliers: Array<{ supplierId: string }>;
    };
    for (const sup of mine.suppliers)
      await call('evaluator-comm', 'PUT', `/evaluations/${ev.id}/scores`, {
        supplierId: sup.supplierId,
        scores: mine.criteria.map((c) => ({ criterionId: c.id, score: 9 })),
      });
    // the replacement must be an evaluator, not on the panel, not the requester and not a process role
    const tooSoon = await call('procurement', 'POST', `/evaluations/${ev.id}/panel/${U.comm}/substitute`, {
      replacementUserId: EXTRA,
      reason: 'CONFLICT',
    });
    expect(tooSoon.statusCode).toBe(409);
    expect(tooSoon.json().code).toBe('NOT_REMOVED');
    for (const bad of [uid('user:requester'), uid('user:probity'), U.tech]) {
      const r = await call('procurement', 'POST', `/evaluations/${ev.id}/panel/${U.comm}/substitute`, {
        replacementUserId: bad,
        reason: 'OTHER',
      });
      expect(r.statusCode, String(bad)).toBeGreaterThanOrEqual(400);
    }
    const sub = await call('procurement', 'POST', `/evaluations/${ev.id}/panel/${U.comm}/substitute`, {
      replacementUserId: EXTRA,
      reason: 'OTHER',
      note: 'Moved to another project',
    });
    expect(sub.statusCode, sub.body).toBe(201);
    const v = sub.json() as Ev;
    expect(v.panel.find((m) => m.userId === U.comm)!.coiState).toBe('REMOVED');
    expect(v.panel.find((m) => m.userId === EXTRA)).toMatchObject({
      stream: 'COMMERCIAL',
      coiState: 'NOT_DECLARED',
    });
    expect(
      (
        await call('procurement', 'POST', `/evaluations/${ev.id}/panel/${U.comm}/substitute`, {
          replacementUserId: EXTRA,
          reason: 'OTHER',
        })
      ).statusCode,
    ).toBe(409);
    // the leaver loses access; their marks are history
    expect((await call('evaluator-comm', 'GET', `/evaluations/${ev.id}`)).statusCode).toBe(404);
    expect(
      (
        await call('evaluator-comm', 'PUT', `/evaluations/${ev.id}/scores`, {
          supplierId: mine.suppliers[0]!.supplierId,
          scores: [{ criterionId: mine.criteria[0]!.id, score: 1 }],
        })
      ).statusCode,
    ).toBe(404);
    // the replacement was told what to do, and cannot see anything until they declare
    const told = (
      await withSystem(database, (tx) =>
        tx.select().from(s.notification).where(eq(s.notification.userId, EXTRA)),
      )
    )
      .map((n) => n.body)
      .join(' ');
    expect(told).toMatch(/declare any conflict of interest/);
    expect(told).toMatch(/clean matrix/);
    expect((await call('evaluator-extra', 'GET', `/evaluations/${ev.id}/scores/mine`)).json().code).toBe(
      'COI_REQUIRED',
    );
    expect(
      (await call('evaluator-extra', 'POST', `/evaluations/${ev.id}/coi`, { none: true })).statusCode,
    ).toBe(201);
    const fresh = (await call('evaluator-extra', 'GET', `/evaluations/${ev.id}/scores/mine`)).json() as {
      suppliers: Array<{ scores: unknown[] }>;
      progress: { done: number; required: number };
    };
    expect(fresh.progress.done).toBe(0);
    expect(fresh.suppliers.every((x) => x.scores.length === 0)).toBe(true);
    // everyone else finishes; consensus cannot open until the replacement has, and averages exclude the leaver's 9s
    await scoreAndSubmit('evaluator-tech', ev.id, () => 5);
    await scoreAndSubmit('chair', ev.id, () => 5);
    expect((await call('chair', 'POST', `/evaluations/${ev.id}/consensus/open`)).json().code).toBe(
      'SCORING_PENDING',
    );
    await scoreAndSubmit('evaluator-extra', ev.id, () => 5);
    const open = (await call('chair', 'POST', `/evaluations/${ev.id}/consensus/open`)).json() as Ev;
    const priceCell = open.consensus.find((c) => c.individual && c.individual.some((x) => x.score === 9))!;
    expect(priceCell.flagged).toBe(false); // 5s only: the departed 9s did not create a variance
    expect(priceCell.individual!.filter((x) => (x as { departed?: boolean }).departed)).toHaveLength(1);
    expect(await auditActions(ev.id)).toContain('evaluation.substitute');
  });

  it('a material conflict removes the person, and the replacement for it is nominated and tasked in one step', async () => {
    const { ev } = await openEval();
    await call('evaluator-comm', 'POST', `/evaluations/${ev.id}/coi`, {
      none: false,
      nature: 'Close friend runs a bidder',
      subjectOrg: 'Evergreen',
    });
    await call('delegate', 'POST', `/evaluations/${ev.id}/conflicts/${U.comm}/decision`, {
      disposition: 'MATERIAL',
      rationale: 'Too close to be fair',
    });
    const sub = await call('procurement', 'POST', `/evaluations/${ev.id}/panel/${U.comm}/substitute`, {
      replacementUserId: EXTRA,
      reason: 'CONFLICT',
      note: 'Nominated after the ruling',
    });
    expect(sub.statusCode, sub.body).toBe(201);
    const told = (
      await withSystem(database, (tx) =>
        tx.select().from(s.notification).where(eq(s.notification.userId, EXTRA)),
      )
    ).map((n) => n.title);
    expect(told).toContain('You have joined an evaluation panel as a replacement');
    // evaluation can now proceed once the other members and the replacement declare
    for (const k of ['evaluator-tech', 'evaluator-extra', 'chair'])
      expect((await call(k, 'POST', `/evaluations/${ev.id}/coi`, { none: true })).statusCode, k).toBe(201);
    expect((await view('procurement', ev.id)).status).toBe('SCORING');
    expect(
      (
        await withSystem(database, (tx) =>
          tx.select().from(s.panelSubstitution).where(eq(s.panelSubstitution.evaluationId, ev.id)),
        )
      )[0],
    ).toMatchObject({ reason: 'CONFLICT', departingUserId: U.comm, incomingUserId: EXTRA });
  });
});

describe('FR-0370 conflict declarations at the report stage', () => {
  it('the approver or author declares as at the plan; a declared and uncleared conflict stops that person approving, and someone else decides it', async () => {
    const { id } = await lockedEval();
    const rep = (await call('procurement', 'POST', `/evaluations/${id}/report`)).json() as Ev;
    const repId = rep.report!.id;
    expect(
      (await call('supplier', 'POST', `/evaluation-reports/${repId}/coi`, { none: true })).statusCode,
    ).toBe(403);
    const none = await call('procurement', 'POST', `/evaluation-reports/${repId}/coi`, { none: true });
    expect(none.statusCode, none.body).toBe(201);
    expect(
      (await call('procurement', 'POST', `/evaluation-reports/${repId}/coi`, { none: true })).statusCode,
    ).toBe(409);
    const c = await call('delegate', 'POST', `/evaluation-reports/${repId}/coi`, {
      none: false,
      nature: 'My former employer is the preferred supplier',
      subjectOrg: 'Brightwave',
    });
    expect(c.statusCode, c.body).toBe(201);
    expect(c.json().routedTo).toBeTruthy();
    // the conflicted delegate cannot approve while it is undecided
    const blocked = await call('delegate', 'POST', `/evaluation-reports/${repId}/decision`, {
      decision: 'APPROVE',
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('COI_DECLARED');
    // they cannot decide their own; another decision-maker rules it material
    const coiId = (await call('exec', 'GET', `/evaluation-reports/${repId}/coi`))
      .json()
      .declarations.find((d: { none: boolean }) => !d.none).id as string;
    expect(
      (
        await call('delegate', 'POST', `/evaluation-reports/${repId}/coi/${coiId}/decision`, {
          disposition: 'IMMATERIAL',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call('exec', 'POST', `/evaluation-reports/${repId}/coi/${coiId}/decision`, {
          disposition: 'MATERIAL',
          rationale: 'Too close',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await call('delegate', 'POST', `/evaluation-reports/${repId}/decision`, { decision: 'APPROVE' })
      ).json().code,
    ).toBe('COI_DECLARED');
    // someone without a conflict still can
    const approve = await call('exec', 'POST', `/evaluation-reports/${repId}/decision`, {
      decision: 'APPROVE',
    });
    expect(approve.statusCode, approve.body).toBe(200);
    expect((approve.json() as Ev).report!.status).toBe('APPROVED');
    const audit = await auditActions(id);
    expect(audit).toEqual(expect.arrayContaining(['coi.declare_none', 'coi.declare_conflict', 'coi.decide']));
  });
});

// =================================================================== the report
describe('FR-0350 the sourcing recommendation report is compiled when consensus locks', () => {
  it('compiles as a draft at the lock with compliance, scoring spread, panel justifications, total cost and a recommendation, and rebuilds when the lock is reopened and redone', async () => {
    await resetSuppliers();
    const { ev, tenderId } = await openEval();
    await withSystem(database, async (tx) => {
      const subs = await tx.select().from(s.submission).where(eq(s.submission.tenderId, tenderId));
      for (const sub of subs) {
        const price =
          sub.supplierId === SUP.brightwave ? 150_000 : sub.supplierId === SUP.evergreen ? 100_000 : 90_000;
        await tx.insert(s.bidPricing).values({
          tenantId: TENANT_ID,
          submissionId: sub.id,
          basePrice: String(price),
          tco: String(price),
        });
      }
    });
    await declareAll(ev.id);
    await scoreAndSubmit('evaluator-tech', ev.id, (c) => 7 + bumpFor(c), 'Solid response');
    await scoreAndSubmit('evaluator-comm', ev.id, (c) => 6 + bumpFor(c));
    await scoreAndSubmit('chair', ev.id, (c) => 7 + bumpFor(c));
    expect((await view('procurement', ev.id)).report).toBeNull();
    const open = (await call('chair', 'POST', `/evaluations/${ev.id}/consensus/open`)).json() as Ev;
    for (const sup of open.suppliers) {
      const items = open.criteria.map((c) => {
        const cell = open.consensus.find((x) => x.supplierId === sup.supplierId && x.criterionId === c.id)!;
        return {
          criterionId: c.id,
          consensusScore: 7 + bumpFor(sup.displayName),
          ...(cell.flagged ? { rationale: 'Agreed after discussion with the panel' } : {}),
        };
      });
      expect(
        (await call('chair', 'PUT', `/evaluations/${ev.id}/consensus/${sup.supplierId}`, { items }))
          .statusCode,
      ).toBe(200);
    }
    expect((await call('chair', 'POST', `/evaluations/${ev.id}/consensus/lock`)).statusCode).toBe(200);
    const locked = await view('procurement', ev.id);
    expect(locked.status).toBe('LOCKED');
    expect(locked.report).toMatchObject({ status: 'DRAFT' });
    const sec = (k: string) =>
      (locked.report!.sections.find((x) => x.key === k)?.paragraphs ?? []).join('\n');
    expect(sec('compliance')).toMatch(/passed all 4 checks/);
    expect(sec('distribution')).toMatch(/lowest .*average .*highest/);
    expect(sec('commercial')).toMatch(/AUD 90,000/);
    expect(sec('commercial')).toMatch(/value for money/);
    expect(sec('recommendation')).toMatch(/recommends/);
    expect(sec('process')).toMatch(/Differences above 30%/);
    // reopen, change, lock again: the draft follows
    expect(
      (
        await call('chair', 'POST', `/evaluations/${ev.id}/consensus/reopen`, {
          reason: 'Re-checking the commercial scores',
        })
      ).statusCode,
    ).toBe(200);
    expect((await view('procurement', ev.id)).report!.status).toBe('DRAFT');
    expect((await call('chair', 'POST', `/evaluations/${ev.id}/consensus/lock`)).statusCode).toBe(200);
    expect((await call('procurement', 'POST', `/evaluations/${ev.id}/report`)).statusCode).toBe(201);
    expect((await view('procurement', ev.id)).report!.status).toBe('AWAITING_APPROVAL');
  });
});

describe('FR-0375 the report is routed to the delegate whose authority covers the value', () => {
  it('goes to the lowest authority that is enough, tells only them, and the approval records the tier', async () => {
    const small = await lockedEval(90_000);
    const sv = (await call('procurement', 'POST', `/evaluations/${small.id}/report`)).json() as Ev & {
      report: { id: string };
    };
    const note = async (user: string) =>
      (
        await withSystem(database, (tx) =>
          tx
            .select()
            .from(s.notification)
            .where(eq(s.notification.userId, uid(`user:${user}`))),
        )
      )
        .filter((n) => n.link === `/app/evaluations/${small.id}`)
        .map((n) => n.title);
    expect(await note('delegate')).toContain('Evaluation report awaiting your approval');
    expect(await note('exec')).not.toContain('Evaluation report awaiting your approval');
    const row = (
      await withSystem(database, (tx) =>
        tx.select().from(s.evalReport).where(eq(s.evalReport.id, sv.report.id)),
      )
    )[0]!;
    expect(row.routedTo).toBe(uid('user:delegate'));
    expect(Number(row.requiredAuthority)).toBe(90_000);
    expect((await auditActions(small.id)).includes('report.generate')).toBe(true);

    const big = await lockedEval(400_000);
    await call('procurement', 'POST', `/evaluations/${big.id}/report`);
    expect(
      await withSystem(database, (tx) =>
        tx
          .select()
          .from(s.notification)
          .where(eq(s.notification.userId, uid('user:exec'))),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: 'Evaluation report awaiting your approval' }),
      ]),
    );
    const bigRow = (
      await withSystem(database, (tx) =>
        tx.select().from(s.evalReport).where(eq(s.evalReport.evaluationId, big.id)),
      )
    )[0]!;
    expect(bigRow.routedTo).toBe(uid('user:exec'));
    // a delegate whose limit is too low still cannot approve (the existing authority check)
    expect(
      (
        await call('delegate', 'POST', `/evaluation-reports/${bigRow.id}/decision`, { decision: 'APPROVE' })
      ).json().code,
    ).toBe('DELEGATION_EXCEEDED');
  });
});

describe('FR-0355 the report is printable, timestamped with audit information, and can be reviewed on a phone', () => {
  it('exports carry the report id, version, generation time, exporter and a content fingerprint; the PDF and Word documents agree', async () => {
    const { id } = await lockedEval();
    await call('procurement', 'POST', `/evaluations/${id}/report`);
    const pdf = await call('probity', 'GET', `/evaluations/${id}/report/pdf`);
    expect(pdf.statusCode).toBe(200);
    const text = pdf.rawPayload.toString('latin1');
    expect(text).toContain('(Exported by) Tj');
    expect(text).toMatch(/\(Jonas Becker, \d{4}-\d\d-\d\d \d\d:\d\d UTC\) Tj/);
    expect(text).toMatch(/\(Content fingerprint\) Tj/);
    expect(text).toMatch(/\(RPT-[0-9A-F]{8}-V\d+\) Tj/);
    const docx = await call('probity', 'GET', `/evaluations/${id}/report/docx`);
    expect(docx.statusCode).toBe(200);
    const fp = (b: string) => /\(([0-9a-f]{16})\) Tj/.exec(b)![1];
    const again = await call('legal', 'GET', `/evaluations/${id}/report/pdf`);
    expect(fp(again.rawPayload.toString('latin1'))).toBe(fp(text)); // the same content has the same fingerprint
    expect(again.rawPayload.toString('latin1')).toMatch(/\(Henry Albright, /);
  });
});

// =================================================================== negotiation
describe('FR-0290 best and final offer rounds', () => {
  it('a controlled mini-tender: offers sealed until the round closes, revisions kept beside the original bid, an accepted offer replaces the cost for ranking', async () => {
    await resetSuppliers();
    const { id, tenderId } = await lockedEval();
    await withSystem(database, async (tx) => {
      const subs = await tx.select().from(s.submission).where(eq(s.submission.tenderId, tenderId));
      for (const sub of subs)
        await tx
          .insert(s.bidPricing)
          .values({ tenantId: TENANT_ID, submissionId: sub.id, basePrice: '200000', tco: '200000' });
    });
    const before = await withSystem(database, (tx) => tx.select().from(s.bidPricing));
    expect(
      (
        await call('evaluator-tech', 'POST', `/evaluations/${id}/bafo`, {
          supplierIds: [SUP.brightwave],
          note: 'Please improve pricing',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call('procurement', 'POST', `/evaluations/${id}/bafo`, {
          supplierIds: [uid('supplier:summit')],
          note: 'Please improve your pricing',
        })
      ).statusCode,
    ).toBe(404);
    const open = await call('procurement', 'POST', `/evaluations/${id}/bafo`, {
      supplierIds: [SUP.brightwave],
      note: 'Please improve your pricing and the term.',
      closesInDays: 2,
    });
    expect(open.statusCode, open.body).toBe(201);
    const roundId = open.json().id as string;
    expect(
      (
        await call('procurement', 'POST', `/evaluations/${id}/bafo`, {
          supplierIds: [SUP.brightwave],
          note: 'A second round while open',
        })
      ).json().code,
    ).toBe('ROUND_OPEN');
    const mine = (await call('supplier', 'GET', '/supplier/bafo')).json().rounds as Array<{
      id: string;
      status: string;
    }>;
    expect(mine.find((r) => r.id === roundId)!.status).toBe('OPEN');
    const o1 = await call('supplier', 'PUT', `/supplier/bafo/${roundId}/offer`, {
      basePrice: 180_000,
      implementation: 5_000,
      annualRunning: 0,
      years: 1,
      note: 'First offer',
    });
    expect(o1.statusCode, o1.body).toBe(201);
    expect(o1.json().revision).toBe(1);
    const o2 = await call('supplier', 'PUT', `/supplier/bafo/${roundId}/offer`, {
      basePrice: 150_000,
      implementation: 5_000,
      years: 1,
    });
    expect(o2.json()).toMatchObject({ revision: 2, tco: 155_000 });
    // sealed from the buyer until the round closes
    const sealed = (await call('procurement', 'GET', `/evaluations/${id}/bafo`)).json() as {
      rounds: Array<{ offers: unknown[]; offersReceived: number }>;
    };
    expect(sealed.rounds[0]).toMatchObject({ offers: [], offersReceived: 2 });
    expect((await call('procurement', 'POST', `/bafo-offers/${o2.json().id}/accept`)).json().code).toBe(
      'ROUND_OPEN',
    );
    expect((await call('procurement', 'POST', `/bafo-rounds/${roundId}/close`)).statusCode).toBe(200);
    expect(
      (await call('supplier', 'PUT', `/supplier/bafo/${roundId}/offer`, { basePrice: 100_000 })).json().code,
    ).toBe('ROUND_CLOSED');
    const opened = (await call('probity', 'GET', `/evaluations/${id}/bafo`)).json() as {
      rounds: Array<{ offers: Array<{ id: string; revision: number; tco: number }> }>;
      originalTco: Array<{ supplierId: string; tco: number }>;
      canAccept: boolean;
    };
    expect(opened.rounds[0]!.offers.map((o) => o.revision)).toEqual([1, 2]);
    expect(opened.originalTco.find((x) => x.supplierId === SUP.brightwave)!.tco).toBe(200_000);
    // the original bid was never touched
    expect(await withSystem(database, (tx) => tx.select().from(s.bidPricing))).toEqual(before);
    // accepting the second revision replaces the cost for ranking, and the draft report is rebuilt
    expect((await call('probity', 'POST', `/bafo-offers/${o2.json().id}/accept`)).statusCode).toBe(403);
    expect((await call('procurement', 'POST', `/bafo-offers/${o2.json().id}/accept`)).statusCode).toBe(200);
    const after = (await view('procurement', id)) as Ev & {
      ranking: Array<{ displayName: string; tco: number }>;
      report: { sections: Array<{ key: string; paragraphs: string[] }> };
    };
    expect(after.ranking.find((r) => r.displayName.startsWith('Brightwave'))!.tco).toBe(155_000);
    expect(after.report.sections.find((x) => x.key === 'negotiation')!.paragraphs.join(' ')).toMatch(
      /round 1 \(closed\).*accepted: Brightwave/,
    );
    expect(await auditActions(id)).toEqual(
      expect.arrayContaining(['bafo.open', 'bafo.offer', 'bafo.close', 'bafo.accept']),
    );
  });

  it('rounds are refused before the panel has scored and after the report is with the approver', async () => {
    const early = await openEval();
    expect(
      (
        await call('procurement', 'POST', `/evaluations/${early.ev.id}/bafo`, {
          supplierIds: [SUP.brightwave],
          note: 'Too early for this',
        })
      ).json().code,
    ).toBe('INVALID_STATE');
    const { id } = await lockedEval();
    await call('procurement', 'POST', `/evaluations/${id}/report`);
    expect(
      (
        await call('procurement', 'POST', `/evaluations/${id}/bafo`, {
          supplierIds: [SUP.brightwave],
          note: 'Too late for this now',
        })
      ).json().code,
    ).toBe('INVALID_STATE');
  });
});

describe('FR-0295 negotiation recommendations from pricing and terms', () => {
  it('suggests a discount for an above-median bid, clauses legal rated high, and insurance to require, with the basis for each; a simulated model and not an outside service', async () => {
    await resetSuppliers();
    const { id, tenderId } = await lockedEval();
    await withSystem(database, async (tx) => {
      const subs = await tx.select().from(s.submission).where(eq(s.submission.tenderId, tenderId));
      for (const sub of subs) {
        const price =
          sub.supplierId === SUP.brightwave ? 130_000 : sub.supplierId === SUP.evergreen ? 90_000 : 80_000;
        await tx.insert(s.bidPricing).values({
          tenantId: TENANT_ID,
          submissionId: sub.id,
          basePrice: String(price),
          tco: String(price),
        });
      }
      await tx.insert(s.tenderDeviation).values({
        tenantId: TENANT_ID,
        tenderId,
        supplierId: SUP.brightwave,
        clauseRef: '12.1 Liability',
        proposal: 'Cap liability at the annual fee',
        risk: 'HIGH',
        status: 'NEGOTIATE',
      });
      await tx
        .update(s.supplier)
        .set({ insuranceStatus: 'UNKNOWN', insurance: null })
        .where(eq(s.supplier.id, SUP.evergreen));
    });
    expect((await call('evaluator-tech', 'GET', `/evaluations/${id}/negotiation-advice`)).statusCode).toBe(
      403,
    );
    const r = await call('procurement', 'GET', `/evaluations/${id}/negotiation-advice`);
    expect(r.statusCode, r.body).toBe(200);
    const advice = r.json() as {
      model: string;
      advice: Array<{
        supplier: string;
        kind: string;
        text: string;
        basis: string;
        suggestedDiscountPct?: number;
      }>;
    };
    expect(advice.model).toBe('rules-simulated-v1');
    const bright = advice.advice.filter((a) => a.supplier.startsWith('Brightwave'));
    expect(bright.find((a) => a.kind === 'DISCOUNT')).toMatchObject({
      suggestedDiscountPct: expect.any(Number),
      basis: expect.stringMatching(/median/),
    });
    expect(bright.find((a) => a.kind === 'CLAUSE')!.text).toMatch(/12\.1 Liability/);
    expect(
      advice.advice.find((a) => a.supplier.startsWith('Evergreen') && a.kind === 'INSURANCE')!.basis,
    ).toMatch(/unknown/);
    expect(advice.advice.every((a) => a.basis.length > 10)).toBe(true);
    await resetSuppliers();
    await withSystem(database, (tx) =>
      tx.update(s.supplier).set({ insurance: null }).where(eq(s.supplier.tenantId, TENANT_ID)),
    );
  });
});

// =================================================================== probity advisor
describe('FR-0310 the probity advisor oversight portal and system hold', () => {
  it('an external advisor sees only the procurements allocated to them, read-only, and can freeze and release the workspace', async () => {
    const a = await openEval();
    const b = await openEval();
    // before allocation the advisor sees nothing; an internal officer sees everything
    expect(
      (await call('advisor', 'GET', '/probity/portal')).json() as {
        external: boolean;
        procurements: unknown[];
      },
    ).toMatchObject({ external: true, procurements: [] });
    expect((await call('advisor', 'GET', `/evaluations/${a.ev.id}`)).statusCode).toBe(404);
    expect(
      ((await call('probity', 'GET', '/probity/portal')).json().procurements as unknown[]).length,
    ).toBeGreaterThanOrEqual(2);
    // procurement or an administrator allocates; others cannot
    expect(
      (await call('evaluator-tech', 'POST', `/tenders/${a.tenderId}/probity-advisors`, { userId: ADVISOR }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await call('procurement', 'POST', `/tenders/${a.tenderId}/probity-advisors`, {
          userId: uid('user:requester'),
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await call('procurement', 'POST', `/tenders/${a.tenderId}/probity-advisors`, { userId: ADVISOR }))
        .statusCode,
    ).toBe(201);
    expect(
      (await call('admin', 'POST', `/tenders/${a.tenderId}/probity-advisors`, { userId: ADVISOR }))
        .statusCode,
    ).toBe(409);
    const portal = (await call('advisor', 'GET', '/probity/portal')).json() as {
      procurements: Array<{ evaluationId: string }>;
    };
    expect(portal.procurements.map((p) => p.evaluationId)).toEqual([a.ev.id]);
    expect((await call('advisor', 'GET', `/evaluations/${a.ev.id}`)).statusCode).toBe(200);
    expect((await call('advisor', 'GET', `/evaluations/${b.ev.id}`)).statusCode).toBe(404); // not allocated
    expect(
      (
        (await call('advisor', 'GET', '/evaluations')).json() as { evaluations: Array<{ id: string }> }
      ).evaluations.map((e) => e.id),
    ).toEqual([a.ev.id]);
    // an external advisor can reach nothing outside the evaluation, probity and sign-in routes
    for (const url of ['/requests', '/audit-events', '/contracts', '/tenders'])
      expect((await call('advisor', 'GET', url)).statusCode, url).toBe(403);
    expect((await call('advisor', 'GET', '/auth/me')).json().external).toBe(true);
    // read-only: an advisor cannot score, panel or approve anything
    expect((await call('advisor', 'POST', `/evaluations/${a.ev.id}/coi`, { none: true })).statusCode).toBe(
      403,
    );
    expect((await call('advisor', 'POST', `/evaluations/${a.ev.id}/consensus/open`)).statusCode).toBe(403);

    // the hold freezes every change until released
    expect(
      (
        await call('evaluator-tech', 'POST', `/evaluations/${a.ev.id}/hold`, {
          reason: 'Suspected bias in panel',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await call('advisor', 'POST', `/evaluations/${a.ev.id}/hold`, { reason: 'short' })).statusCode,
    ).toBe(400);
    expect(
      (await call('advisor', 'POST', `/evaluations/${b.ev.id}/hold`, { reason: 'Not mine to hold this one' }))
        .statusCode,
    ).toBe(404);
    const held = await call('advisor', 'POST', `/evaluations/${a.ev.id}/hold`, {
      reason: 'Possible bias in panel selection',
    });
    expect(held.statusCode, held.body).toBe(200);
    expect((held.json() as { held: { reason: string } }).held.reason).toBe(
      'Possible bias in panel selection',
    );
    expect(
      (
        await call('advisor', 'POST', `/evaluations/${a.ev.id}/hold`, { reason: 'Doing this a second time' })
      ).json().code,
    ).toBe('ALREADY_HELD');
    for (const [who, method, url, body] of [
      ['evaluator-tech', 'POST', `/evaluations/${a.ev.id}/coi`, { none: true }],
      ['procurement', 'POST', `/evaluations/${a.ev.id}/panel`, { userId: EXTRA, stream: 'TECHNICAL' }],
      [
        'procurement',
        'PUT',
        `/evaluations/${a.ev.id}/criteria`,
        { criteria: [{ name: 'Whatever criterion', stream: 'TECHNICAL', weight: 100, passFail: false }] },
      ],
      ['chair', 'PUT', `/evaluations/${a.ev.id}/variance-limit`, { limitPct: 20 }],
      [
        'procurement',
        'POST',
        `/evaluations/${a.ev.id}/clarifications`,
        { supplierId: SUP.brightwave, subject: 'Held', question: 'Does this get through?' },
      ],
    ] as const) {
      const r = await call(who, method, url, body);
      expect(r.statusCode, `${who} ${url}`).toBe(423);
      expect(r.json().code).toBe('EVALUATION_ON_HOLD');
    }
    // reading still works for the panel, and it says why it is frozen
    expect(
      ((await view('evaluator-tech', a.ev.id)) as unknown as { held: { reason: string } }).held.reason,
    ).toMatch(/bias/);
    expect((await call('advisor', 'POST', `/evaluations/${a.ev.id}/release`, { note: 'x' })).statusCode).toBe(
      400,
    );
    const released = await call('advisor', 'POST', `/evaluations/${a.ev.id}/release`, {
      note: 'Panel reconstituted; proceed',
    });
    expect(released.statusCode, released.body).toBe(200);
    expect((released.json() as { held: unknown }).held).toBeNull();
    expect(
      (await call('evaluator-tech', 'POST', `/evaluations/${a.ev.id}/coi`, { none: true })).statusCode,
    ).toBe(201);
    expect(await auditActions(a.ev.id)).toEqual(
      expect.arrayContaining(['evaluation.hold', 'evaluation.release']),
    );
    expect(await auditActions(a.tenderId)).toContain('probity.allocate');
    // the hold is told to the panel
    expect(
      (
        await withSystem(database, (tx) =>
          tx.select().from(s.notification).where(eq(s.notification.userId, U.tech)),
        )
      ).some((n) => n.title === 'The evaluation is on hold'),
    ).toBe(true);
    // allocation can be withdrawn
    expect(
      (await call('procurement', 'DELETE', `/tenders/${a.tenderId}/probity-advisors/${ADVISOR}`)).statusCode,
    ).toBe(204);
    expect((await call('advisor', 'GET', `/evaluations/${a.ev.id}`)).statusCode).toBe(404);
  });
});

describe('FR-0340 probity plan and outcomes report with a sign-off stamp', () => {
  it('the advisor authors or uploads a plan and an outcomes report, signs each, and exports a stamped document attributing the sign-off', async () => {
    const { id } = await lockedEval();
    const body =
      'Scope of probity oversight.\n\nThe advisor will observe conflict declarations, scoring and consensus.\n\nBreaches are reported to the delegate.';
    expect(
      (await call('procurement', 'PUT', `/evaluations/${id}/probity/PLAN`, { title: 'Probity plan', body }))
        .statusCode,
    ).toBe(403);
    const plan = await call('probity', 'PUT', `/evaluations/${id}/probity/PLAN`, {
      title: 'Probity plan for the cleaning contract',
      body,
    });
    expect(plan.statusCode, plan.body).toBe(200);
    expect(plan.json()).toMatchObject({ status: 'DRAFT', version: 1, stamp: null });
    // a draft exports with no stamp; signing attributes it
    expect(
      (await call('probity', 'GET', `/evaluations/${id}/probity/PLAN/pdf`)).rawPayload.toString('latin1'),
    ).toMatch(/Draft, not signed/);
    const signed = await call('probity', 'POST', `/evaluations/${id}/probity/PLAN/sign`);
    expect(signed.statusCode, signed.body).toBe(200);
    expect(signed.json().stamp).toMatch(
      /^PROBITY PLAN SIGNED · Jonas Becker · PROBITY · \d{4}-\d\d-\d\d \d\d:\d\d UTC$/,
    );
    expect((await call('probity', 'POST', `/evaluations/${id}/probity/PLAN/sign`)).json().code).toBe(
      'ALREADY_SIGNED_OFF',
    );
    const pdf = await call('legal', 'GET', `/evaluations/${id}/probity/PLAN/pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.toString('latin1')).toMatch(/PROBITY PLAN SIGNED/);
    expect((await call('legal', 'GET', `/evaluations/${id}/probity/PLAN/docx`)).statusCode).toBe(200);
    expect((await call('requester', 'GET', `/evaluations/${id}/probity/PLAN/pdf`)).statusCode).toBe(403);
    // editing a signed document starts a new unsigned version; the earlier sign-off stays in the audit trail
    const edit = await call('probity', 'PUT', `/evaluations/${id}/probity/PLAN`, {
      title: 'Probity plan v2',
      body: `${body}\n\nAdded: the advisor may attend panel meetings.`,
    });
    expect(edit.json()).toMatchObject({ status: 'DRAFT', version: 2, stamp: null });
    // the outcomes report can be uploaded as a file instead, and is downloaded unchanged
    const bytes = Buffer.from('%PDF-1.7\nOUTCOMES-FILE-MARKER');
    const up = await call('probity', 'POST', `/evaluations/${id}/probity/OUTCOMES/upload`, {
      title: 'Probity outcomes report',
      fileName: 'outcomes.pdf',
      contentBase64: bytes.toString('base64'),
    });
    expect(up.statusCode, up.body).toBe(201);
    expect(up.json()).toMatchObject({ hasFile: true, fileName: 'outcomes.pdf' });
    const bad = await call('probity', 'POST', `/evaluations/${id}/probity/OUTCOMES/upload`, {
      title: 'Not a pdf at all',
      fileName: 'outcomes.pdf',
      contentBase64: Buffer.from('plain text').toString('base64'),
    });
    expect(bad.statusCode).toBe(400);
    expect((await call('probity', 'GET', `/evaluations/${id}/probity/OUTCOMES/pdf`)).json().code).toBe(
      'UPLOADED_FILE',
    );
    expect((await call('probity', 'POST', `/evaluations/${id}/probity/OUTCOMES/sign`)).statusCode).toBe(200);
    const dl = await call('delegate', 'GET', `/evaluations/${id}/probity/OUTCOMES/file`);
    expect(dl.statusCode).toBe(200);
    expect(dl.rawPayload.equals(bytes)).toBe(true);
    // the outcomes report can only be signed after the lock
    const early = await openEval();
    await call('probity', 'PUT', `/evaluations/${early.ev.id}/probity/OUTCOMES`, {
      title: 'Early outcomes',
      body: 'Nothing has happened yet in this evaluation.',
    });
    expect(
      (await call('probity', 'POST', `/evaluations/${early.ev.id}/probity/OUTCOMES/sign`)).json().code,
    ).toBe('INVALID_STATE');
    const docs = (await call('chair', 'GET', `/evaluations/${id}/probity`)).json().documents as Array<{
      kind: string;
      status: string;
      version: number;
    }>;
    expect(docs.find((x) => x.kind === 'PLAN')).toMatchObject({ status: 'DRAFT', version: 2 });
    expect(docs.find((x) => x.kind === 'OUTCOMES')).toMatchObject({ status: 'SIGNED' });
    const trail = await withSystem(database, (tx) =>
      tx.select().from(s.auditEvent).where(eq(s.auditEvent.entityId, id)),
    );
    expect(trail.filter((e) => e.action === 'probity.document_sign')).toHaveLength(2);
  });
});

// =================================================================== multi-stage
describe("FR-0285 and FR-0360 multi-stage evaluation keeps every stage's scores and reports each one", () => {
  it('a later stage shows the earlier stage outcome and who was shortlisted, and its report documents each stage', async () => {
    await resetSuppliers();
    const { id, tenderId } = await lockedEval();
    const next = await withSystem(database, async (tx) => {
      const [t1] = await tx.select().from(s.tender).where(eq(s.tender.id, tenderId));
      await tx
        .update(s.tender)
        .set({ shortlist: [SUP.brightwave, SUP.evergreen], shortlistedAt: clock.now() })
        .where(eq(s.tender.id, tenderId));
      const [t2] = await tx
        .insert(s.tender)
        .values({
          tenantId: TENANT_ID,
          requestId: t1!.requestId,
          type: 'RFT',
          access: 'CLOSED',
          status: 'CLOSED',
          stage: 2,
          parentTenderId: tenderId,
          opensAt: new Date(clock.now().getTime() - 3 * 86_400_000),
          closesAt: new Date(clock.now().getTime() - 86_400_000),
        })
        .returning();
      return t2!.id;
    });
    // stage 2 is run on the shortlisted suppliers' stage-2 submissions
    await withSystem(database, async (tx) => {
      for (const sup of [SUP.brightwave, SUP.evergreen]) {
        const [sub] = await tx
          .insert(s.submission)
          .values({
            tenantId: TENANT_ID,
            tenderId: next,
            supplierId: sup,
            status: 'SUBMITTED',
            receipt: `RC2-${sup.slice(0, 4)}`,
            submittedAt: clock.now(),
          })
          .returning();
        const key = `${TENANT_ID}/${sub!.id}/${randomUUID()}`;
        await store.put(key, PDF);
        await tx.insert(s.fileObject).values({
          tenantId: TENANT_ID,
          submissionId: sub!.id,
          name: 'stage2.pdf',
          sizeBytes: PDF.length,
          contentType: 'application/pdf',
          storageKey: key,
          sha256: sha256(PDF),
          scan: 'CLEAN',
          section: 'TECHNICAL',
        });
      }
    });
    const opened = await call('procurement', 'POST', `/tenders/${next}/evaluation`, { panel: PANEL(U) });
    expect(opened.statusCode, opened.body).toBe(201);
    const ev2 = opened.json() as Ev & {
      stage: number;
      previousStages: Array<{
        stage: number;
        evaluationId: string;
        suppliers: Array<{ displayName: string; rank: number | null; shortlisted: boolean }>;
      }>;
    };
    expect(ev2.stage).toBe(2);
    expect(ev2.previousStages).toHaveLength(1);
    expect(ev2.previousStages[0]).toMatchObject({ stage: 1, evaluationId: id });
    expect(
      ev2.previousStages[0]!.suppliers.map((x) => [x.displayName.split(' ')[0], x.rank, x.shortlisted]),
    ).toEqual([
      ['Brightwave', 1, true],
      ['Evergreen', 2, true],
      ['Northstar', 3, false],
    ]);
    // the first stage's scores are retained, untouched
    expect((await view('procurement', id)).consensus.length).toBeGreaterThan(0);
    await lockEvaluation(ev2.id);
    const rep = (await call('procurement', 'POST', `/evaluations/${ev2.id}/report`)).json() as Ev;
    const stages = rep.report!.sections.find((x) => x.key === 'stages')!.paragraphs.join('\n');
    expect(stages).toMatch(/Stage 1: 1\. Brightwave.*shortlisted/);
    expect(stages).toMatch(/Stage 2 \(this evaluation\): 1\. Brightwave/);
    // a single-stage report has no such section
    const solo = await lockedEval();
    const soloRep = (await call('procurement', 'POST', `/evaluations/${solo.id}/report`)).json() as Ev;
    expect(soloRep.report!.sections.find((x) => x.key === 'stages')!.paragraphs).toEqual([]);
  });
});
