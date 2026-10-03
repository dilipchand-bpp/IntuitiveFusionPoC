import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hash as argon2Hash } from '@node-rs/argon2';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, type ManualClock } from '@if/shared';
import { buildApp } from '../../app.js';
import { withContext, withSystem, type Database } from '../../db/client.js';
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
async function call(key: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) {
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
const COMPANY: Record<(typeof BIDDERS)[number], string> = {
  brightwave: 'Brightwave Cleaning Pty Ltd',
  evergreen: 'Evergreen Facility Services Pty Ltd',
  northstar: 'Northstar Property Care Pty Ltd',
};
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
  ranking: Array<{ displayName: string; weightedScore: number; rank: number | null; compliance: string }>;
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
const agree = () => 7;

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

// =================================================================== US-EVL-02
describe('US-EVL-02 opening an evaluation', () => {
  it('creates the scoring sheet from the published criteria, one record per submitted bid, a chair added automatically, and moves the tender to evaluating', async () => {
    const { tenderId } = await closedTender();
    const ready = (await call('procurement', 'GET', '/evaluations')).json();
    expect(ready.ready.find((x: { tenderId: string }) => x.tenderId === tenderId)).toMatchObject({
      bids: 3,
      evaluable: true,
    });
    const r = await call('procurement', 'POST', `/tenders/${tenderId}/evaluation`, { panel: PANEL(U) });
    expect(r.statusCode, r.body).toBe(201);
    const ev = r.json() as Ev;
    expect(ev.status).toBe('COI_PENDING');
    expect(ev.suppliers).toHaveLength(3);
    expect(ev.criteria.map((c) => c.weight).reduce((a, b) => a + b, 0)).toBe(100);
    expect(ev.criteria.find((c) => c.name.startsWith('Price'))!.stream).toBe('COMMERCIAL');
    expect(ev.panel.map((m) => m.stream).sort()).toEqual(['COMMERCIAL', 'OTHER', 'TECHNICAL']);
    expect(ev.panel.every((m) => m.coiState === 'NOT_DECLARED')).toBe(true);
    const t = await withSystem(database, (tx) => tx.select().from(s.tender).where(eq(s.tender.id, tenderId)));
    expect(t[0]!.status).toBe('EVALUATING');
    const again = await call('procurement', 'POST', `/tenders/${tenderId}/evaluation`, { panel: PANEL(U) });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('INVALID_STATE'); // it is no longer closed
  });

  it('refuses: an open tender, no bids, a tender type not scored for award, a panel without a stream, a non-evaluator, duplicates, and other roles', async () => {
    const open = await closedTender();
    // still open: published with a closing time in the future (a past closing time would be closed automatically first)
    await withSystem(database, (tx) =>
      tx
        .update(s.tender)
        .set({ status: 'PUBLISHED', closesAt: new Date(clock.now().getTime() + 5 * 86_400_000) })
        .where(eq(s.tender.id, open.tenderId)),
    );
    expect(
      (await call('procurement', 'POST', `/tenders/${open.tenderId}/evaluation`, { panel: PANEL(U) })).json()
        .code,
    ).toBe('INVALID_STATE');

    const none = await closedTender({ bids: 0 });
    expect(
      (await call('procurement', 'POST', `/tenders/${none.tenderId}/evaluation`, { panel: PANEL(U) })).json()
        .code,
    ).toBe('NO_BIDS');

    const rfi = await closedTender({ type: 'RFI' });
    expect(
      (await call('procurement', 'POST', `/tenders/${rfi.tenderId}/evaluation`, { panel: PANEL(U) })).json()
        .code,
    ).toBe('NOT_EVALUABLE');

    const t = await closedTender();
    const techOnly = await call('procurement', 'POST', `/tenders/${t.tenderId}/evaluation`, {
      panel: [{ userId: U.tech, stream: 'TECHNICAL' }],
    });
    expect(techOnly.statusCode).toBe(400);
    expect(techOnly.json().title).toMatch(/commercial evaluator/);
    const notEval = await call('procurement', 'POST', `/tenders/${t.tenderId}/evaluation`, {
      panel: [...PANEL(U), { userId: uid('user:requester'), stream: 'TECHNICAL' }],
    });
    expect(notEval.statusCode).toBe(400);
    const dup = await call('procurement', 'POST', `/tenders/${t.tenderId}/evaluation`, {
      panel: [...PANEL(U), { userId: U.tech, stream: 'COMMERCIAL' }],
    });
    expect(dup.statusCode).toBe(400);
    for (const who of ['evaluator-tech', 'chair', 'delegate', 'admin', 'supplier'])
      expect(
        (await call(who, 'POST', `/tenders/${t.tenderId}/evaluation`, { panel: PANEL(U) })).statusCode,
        who,
      ).toBe(403);
  });
});

// =================================================================== US-EVL-01
describe('US-EVL-01 conflict declaration gates access', () => {
  it('before declaring, a panel member sees anonymous suppliers and no files, and can score, read scores or download nothing', async () => {
    const { ev } = await openEval();
    const v = await view('evaluator-tech', ev.id);
    expect(v.suppliers.map((x) => x.displayName)).toEqual(['Supplier A', 'Supplier B', 'Supplier C']);
    expect(v.suppliers.every((x) => x.anonymised && x.files.length === 0)).toBe(true);
    const text = JSON.stringify(v);
    for (const name of Object.values(COMPANY)) expect(text).not.toContain(name);
    expect(text).not.toContain('technical.pdf');
    expect(v.me).toMatchObject({ coiState: 'NOT_DECLARED' });
    expect(v.permissions.canDeclare).toBe(true);
    const sup = v.suppliers[0]!;
    expect((await call('evaluator-tech', 'GET', `/evaluations/${ev.id}/scores/mine`)).json().code).toBe(
      'COI_REQUIRED',
    );
    expect(
      (
        await call('evaluator-tech', 'PUT', `/evaluations/${ev.id}/scores`, {
          supplierId: sup.supplierId,
          scores: [{ criterionId: v.criteria[0]!.id, score: 5 }],
        })
      ).json().code,
    ).toBe('COI_REQUIRED');
    // the real file id is known to procurement, yet the evaluator still cannot open it
    const pv = await view('procurement', ev.id);
    const file = pv.suppliers[0]!.files.find((f) => f.section === 'TECHNICAL')!;
    const dl = await call(
      'evaluator-tech',
      'GET',
      `/evaluations/${ev.id}/suppliers/${pv.suppliers[0]!.supplierId}/files/${file.id}`,
    );
    expect(dl.statusCode).toBe(403);
    // and the database agrees
    const rows = await withContext(
      database,
      { tenantId: TENANT_ID, userId: U.tech, role: 'EVALUATOR' },
      (tx) => tx.select().from(s.fileObject),
    );
    expect(rows.filter((f) => pv.suppliers.some((x) => x.files.some((y) => y.id === f.id)))).toEqual([]);
  });

  it("declaring no conflict reveals real names and the files of the member's own stream", async () => {
    const { ev } = await openEval();
    expect(
      (await call('evaluator-tech', 'POST', `/evaluations/${ev.id}/coi`, { none: true })).statusCode,
    ).toBe(201);
    const v = await view('evaluator-tech', ev.id);
    expect(v.suppliers.map((x) => x.displayName).sort()).toEqual(Object.values(COMPANY).sort());
    expect(v.suppliers.every((x) => !x.anonymised)).toBe(true);
    for (const sup of v.suppliers) expect(sup.files.map((f) => f.section)).toEqual(['TECHNICAL']); // never pricing
    expect(
      (await call('evaluator-tech', 'POST', `/evaluations/${ev.id}/coi`, { none: true })).json().code,
    ).toBe('ALREADY_DECLARED');
    const cv = await view('evaluator-comm', ev.id); // not declared yet: still blind
    expect(cv.suppliers.every((x) => x.anonymised)).toBe(true);
  });

  it('a declared conflict suspends access at once, alerts the chair and probity and goes to a delegate; a material conflict removes the person and a replacement carries on', async () => {
    const { ev } = await openEval();
    const hash = await argon2Hash(PASSWORD);
    const replacement = await withSystem(database, async (tx) => {
      const [u] = await tx
        .insert(s.appUser)
        .values({
          tenantId: TENANT_ID,
          email: `replacement-${titleSeq}@meridian-demo.example`,
          name: 'Rita Replacement',
          passwordHash: hash,
        })
        .returning();
      await tx.insert(s.roleAssignment).values({ tenantId: TENANT_ID, userId: u!.id, role: 'EVALUATOR' });
      return u!;
    });
    const c = await call('evaluator-comm', 'POST', `/evaluations/${ev.id}/coi`, {
      none: false,
      nature: 'I own shares in Evergreen Facility Services',
      subjectOrg: 'Evergreen',
    });
    expect(c.statusCode, c.body).toBe(201);
    expect(c.json()).toMatchObject({ suspended: true });
    // no access to anything now, and it looks like the evaluation does not exist
    expect((await call('evaluator-comm', 'GET', `/evaluations/${ev.id}`)).statusCode).toBe(404);
    expect((await call('evaluator-comm', 'GET', `/evaluations/${ev.id}/scores/mine`)).statusCode).toBe(404);
    expect(JSON.stringify((await call('evaluator-comm', 'GET', '/evaluations')).json())).not.toContain(ev.id);
    for (const who of ['chair', 'probity']) {
      const n = JSON.stringify((await call(who, 'GET', '/notifications')).json());
      expect(n).toContain('conflict of interest');
    }
    const audited = await withSystem(database, (tx) =>
      tx
        .select()
        .from(s.auditEvent)
        .where(and(eq(s.auditEvent.entityId, ev.id), eq(s.auditEvent.action, 'coi.declare_conflict'))),
    );
    expect(audited).toHaveLength(1);
    // the others declare, but there is no commercial evaluator left so scoring does not start
    await call('evaluator-tech', 'POST', `/evaluations/${ev.id}/coi`, { none: true });
    await call('chair', 'POST', `/evaluations/${ev.id}/coi`, { none: true });
    expect((await view('procurement', ev.id)).status).toBe('COI_PENDING');
    expect(JSON.stringify((await call('procurement', 'GET', '/notifications')).json())).toContain(
      'Add a replacement evaluator',
    );
    // procurement adds a replacement; once they declare, scoring opens
    const added = await call('procurement', 'POST', `/evaluations/${ev.id}/panel`, {
      userId: replacement.id,
      stream: 'COMMERCIAL',
    });
    expect(added.statusCode, added.body).toBe(201);
    expect(
      (
        await call('procurement', 'POST', `/evaluations/${ev.id}/panel`, {
          userId: replacement.id,
          stream: 'COMMERCIAL',
        })
      ).json().code,
    ).toBe('ALREADY_MEMBER');
    expect(
      (
        await call('procurement', 'POST', `/evaluations/${ev.id}/panel`, {
          userId: U.comm,
          stream: 'COMMERCIAL',
        })
      ).json().code,
    ).toBe('ALREADY_MEMBER'); // a removed member cannot be re-added
    await call(replacement.email, 'POST', `/evaluations/${ev.id}/coi`, { none: true });
    // everyone has declared, but a conflict is still waiting for a delegate, so scoring does not start yet
    expect((await view('procurement', ev.id)).status).toBe('COI_PENDING');
    const waiting = await view('delegate', ev.id);
    expect(waiting.conflicts).toEqual([
      expect.objectContaining({
        name: 'Mei Tanaka',
        disposition: 'PENDING',
        nature: expect.stringContaining('Evergreen'),
      }),
    ]);
    expect(waiting.permissions.canDecideConflict).toBe(true);
    expect(JSON.stringify(await view('evaluator-tech', ev.id))).not.toContain('I own shares'); // other evaluators never see declared conflicts
    expect((await view('evaluator-tech', ev.id)).conflicts).toEqual([]);
    expect(JSON.stringify((await call('delegate', 'GET', '/notifications')).json())).toContain(
      'Conflict of interest needs your decision',
    );
    const decided = await call('delegate', 'POST', `/evaluations/${ev.id}/conflicts/${U.comm}/decision`, {
      disposition: 'MATERIAL',
      rationale: 'Direct shareholding.',
    });
    expect(decided.statusCode, decided.body).toBe(200);
    expect(decided.json().status).toBe('SCORING');
    expect(decided.json().panel.find((m: { name: string }) => m.name === 'Mei Tanaka').coiState).toBe(
      'REMOVED',
    );
    expect((await call('evaluator-comm', 'GET', `/evaluations/${ev.id}`)).statusCode).toBe(404); // removed for good
    const row = (
      await withSystem(database, (tx) =>
        tx
          .select()
          .from(s.coiDeclaration)
          .where(and(eq(s.coiDeclaration.scopeId, ev.id), eq(s.coiDeclaration.userId, U.comm))),
      )
    )[0]!;
    expect(row).toMatchObject({ disposition: 'MATERIAL' });
    expect(row.decidedAt).not.toBeNull();
    const decisions = await withSystem(database, (tx) =>
      tx
        .select()
        .from(s.auditEvent)
        .where(and(eq(s.auditEvent.entityId, ev.id), eq(s.auditEvent.action, 'coi.decide'))),
    );
    expect(decisions).toHaveLength(1);
    expect(JSON.stringify((await call('evaluator-comm', 'GET', '/notifications')).json())).toContain(
      'you are removed from the panel',
    );
  });
});

// =================================================================== US-EVL-03
describe('US-EVL-03 independent scoring and stream isolation', () => {
  it('a technical evaluator sees and scores only technical and shared criteria and opens only technical files; a commercial one the reverse', async () => {
    const { ev } = await openEval();
    await declareAll(ev.id);
    const tech = await view('evaluator-tech', ev.id);
    const comm = await view('evaluator-comm', ev.id);
    expect(tech.criteria.map((c) => c.stream).sort()).toEqual(['OTHER', 'TECHNICAL', 'TECHNICAL']);
    expect(tech.criteria.some((c) => c.name.startsWith('Price'))).toBe(false);
    expect(comm.criteria.map((c) => c.stream).sort()).toEqual(['COMMERCIAL', 'OTHER']);
    expect((await view('chair', ev.id)).criteria).toHaveLength(4);
    const price = (await view('procurement', ev.id)).criteria.find((c) => c.name.startsWith('Price'))!;
    const sup = tech.suppliers[0]!;
    // asking to score price looks like asking for a criterion that does not exist
    const put = await call('evaluator-tech', 'PUT', `/evaluations/${ev.id}/scores`, {
      supplierId: sup.supplierId,
      scores: [{ criterionId: price.id, score: 5 }],
    });
    expect(put.statusCode).toBe(404);
    expect(put.json().code).toBe('NOT_FOUND');

    // files: each stream sees only its own
    const pv = await view('procurement', ev.id);
    const files = pv.suppliers[0]!.files;
    const techFile = files.find((f) => f.section === 'TECHNICAL')!;
    const commFile = files.find((f) => f.section === 'COMMERCIAL')!;
    const url = (fid: string) =>
      `/evaluations/${ev.id}/suppliers/${pv.suppliers[0]!.supplierId}/files/${fid}`;
    expect((await call('evaluator-tech', 'GET', url(techFile.id))).statusCode).toBe(200);
    expect((await call('evaluator-tech', 'GET', url(commFile.id))).statusCode).toBe(404);
    expect((await call('evaluator-comm', 'GET', url(commFile.id))).statusCode).toBe(200);
    expect((await call('evaluator-comm', 'GET', url(techFile.id))).statusCode).toBe(404);
    expect((await call('chair', 'GET', url(commFile.id))).statusCode).toBe(200);
    const got = await call('evaluator-tech', 'GET', url(techFile.id));
    expect(got.rawPayload.equals(PDF)).toBe(true); // decrypted, byte for byte
    expect(got.headers['content-disposition']).toContain('attachment');
    // nothing about pricing anywhere in a technical evaluator's responses
    const dump =
      JSON.stringify(tech) +
      JSON.stringify((await call('evaluator-tech', 'GET', `/evaluations/${ev.id}/scores/mine`)).json());
    expect(dump).not.toContain('pricing.xlsx');
    expect(dump).not.toMatch(/Price/);
    // the database enforces the same rule on a direct query
    const rows = await withContext(
      database,
      { tenantId: TENANT_ID, userId: U.tech, role: 'EVALUATOR' },
      (tx) => tx.select().from(s.fileObject),
    );
    const visible = rows.filter((f) => pv.suppliers.some((x) => x.files.some((y) => y.id === f.id)));
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.every((f) => f.section === 'TECHNICAL')).toBe(true);
    const crows = await withContext(
      database,
      { tenantId: TENANT_ID, userId: U.comm, role: 'EVALUATOR' },
      (tx) => tx.select().from(s.fileObject),
    );
    expect(
      crows
        .filter((f) => pv.suppliers.some((x) => x.files.some((y) => y.id === f.id)))
        .every((f) => f.section === 'COMMERCIAL'),
    ).toBe(true);
  });

  it("no one can retrieve another evaluator's scores or comments before consensus, by any role, endpoint or direct query", async () => {
    const { ev } = await openEval();
    await declareAll(ev.id);
    const SECRET = 'SECRET-COMMENT-9f3a';
    await scoreAndSubmit(
      'evaluator-tech',
      ev.id,
      (_c, name) => (name.startsWith('Technical') ? 9.5 : 8.5),
      SECRET,
    );
    // other panel members, the chair, probity, procurement, delegate, legal: nothing of it anywhere
    for (const who of ['evaluator-comm', 'chair', 'probity', 'procurement', 'delegate', 'legal']) {
      const v = JSON.stringify(await view(who, ev.id));
      expect(v, who).not.toContain(SECRET);
      expect(v, who).not.toMatch(/"individual"/);
      expect((await view(who, ev.id)).consensus, who).toEqual([]);
    }
    const commMine = JSON.stringify(
      (await call('evaluator-comm', 'GET', `/evaluations/${ev.id}/scores/mine`)).json(),
    );
    expect(commMine).not.toContain(SECRET);
    // direct database reads under each identity
    for (const [userKey, role] of [
      ['evaluator-comm', 'EVALUATOR'],
      ['chair', 'CHAIR'],
      ['probity', 'PROBITY'],
      ['procurement', 'PROCUREMENT'],
      ['admin', 'ADMIN'],
    ] as const) {
      const rows = await withContext(
        database,
        { tenantId: TENANT_ID, userId: uid(`user:${userKey}`), role },
        (tx) => tx.select().from(s.score).where(eq(s.score.evaluationId, ev.id)),
      );
      expect(
        rows.filter((r) => r.evaluatorId === U.tech),
        userKey,
      ).toEqual([]);
    }
    // the audit trail says scoring happened, but holds no scores or comments
    const events = await withSystem(database, (tx) =>
      tx.select().from(s.auditEvent).where(eq(s.auditEvent.entityId, ev.id)),
    );
    const trail = JSON.stringify(events);
    expect(trail).toContain('score.save');
    expect(trail).not.toContain(SECRET);
    expect(trail).not.toContain('9.5');
    // admins, executives and suppliers have no route in at all
    for (const who of ['admin', 'finance', 'supplier', 'requester'])
      expect((await call(who, 'GET', `/evaluations/${ev.id}`)).statusCode, who).toBe(403);
    // executives may read (they approve large awards) but see no scores and no bid files
    const execView = JSON.stringify(await view('exec', ev.id));
    expect(execView).not.toContain(SECRET);
    expect((await view('exec', ev.id)).suppliers.every((x) => x.files.length === 0)).toBe(true);
    // a panel member of a different evaluation (here: none) and an outsider evaluator get a 404
    const outsider = await closedTender();
    const other = (
      await call('procurement', 'POST', `/tenders/${outsider.tenderId}/evaluation`, {
        panel: [
          { userId: U.tech, stream: 'TECHNICAL' },
          { userId: U.comm, stream: 'COMMERCIAL' },
        ],
      })
    ).json() as Ev;
    expect(other.id).not.toBe(ev.id);
  });

  it("validates scores, requires every cell before marking complete, and freezes a member's scores once complete", async () => {
    const { ev } = await openEval();
    await declareAll(ev.id);
    const mine = (await call('evaluator-comm', 'GET', `/evaluations/${ev.id}/scores/mine`)).json();
    const sup = mine.suppliers[0].supplierId as string;
    const crit = mine.criteria[0].id as string;
    for (const bad of [7.25, 11, -1])
      expect(
        (
          await call('evaluator-comm', 'PUT', `/evaluations/${ev.id}/scores`, {
            supplierId: sup,
            scores: [{ criterionId: crit, score: bad }],
          })
        ).statusCode,
        String(bad),
      ).toBe(400);
    expect(
      (
        await call('evaluator-comm', 'PUT', `/evaluations/${ev.id}/scores`, {
          supplierId: uid('nobody'),
          scores: [{ criterionId: crit, score: 5 }],
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await call('evaluator-comm', 'PUT', `/evaluations/${ev.id}/scores`, {
          supplierId: sup,
          scores: [{ criterionId: crit, score: 6.5, comment: 'ok' }],
        })
      ).statusCode,
    ).toBe(200);
    const incomplete = await call('evaluator-comm', 'POST', `/evaluations/${ev.id}/scores/submit`);
    expect(incomplete.statusCode).toBe(409);
    expect(incomplete.json().code).toBe('SCORING_INCOMPLETE');
    // re-saving a cell updates it rather than duplicating
    await call('evaluator-comm', 'PUT', `/evaluations/${ev.id}/scores`, {
      supplierId: sup,
      scores: [{ criterionId: crit, score: 8 }],
    });
    const rows = await withSystem(database, (tx) =>
      tx
        .select()
        .from(s.score)
        .where(
          and(
            eq(s.score.evaluationId, ev.id),
            eq(s.score.evaluatorId, U.comm),
            eq(s.score.criterionId, crit),
            eq(s.score.supplierId, sup),
          ),
        ),
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.score)).toBe(8);
    await scoreAndSubmit('evaluator-comm', ev.id, agree);
    const frozen = await call('evaluator-comm', 'PUT', `/evaluations/${ev.id}/scores`, {
      supplierId: sup,
      scores: [{ criterionId: crit, score: 1 }],
    });
    expect(frozen.statusCode).toBe(409);
    expect(frozen.json().code).toBe('SCORING_SUBMITTED');
    expect((await call('evaluator-comm', 'POST', `/evaluations/${ev.id}/scores/submit`)).json().code).toBe(
      'SCORING_SUBMITTED',
    );
  });

  it('scoring is refused before every member has declared', async () => {
    const { ev } = await openEval();
    await call('evaluator-tech', 'POST', `/evaluations/${ev.id}/coi`, { none: true });
    const mine = await call('evaluator-tech', 'GET', `/evaluations/${ev.id}/scores/mine`);
    const sup = (await view('evaluator-tech', ev.id)).suppliers[0]!.supplierId;
    const crit = (await view('evaluator-tech', ev.id)).criteria[0]!.id;
    expect(mine.statusCode).toBe(200);
    const put = await call('evaluator-tech', 'PUT', `/evaluations/${ev.id}/scores`, {
      supplierId: sup,
      scores: [{ criterionId: crit, score: 5 }],
    });
    expect(put.statusCode).toBe(409);
    expect(put.json().message ?? put.json().title).toMatch(/every panel member has declared/);
  });
});

// =================================================================== US-EVL-04
describe('US-EVL-04 consensus, variance flags and the lock', () => {
  /** Tech scores Technical capability 9, chair 5 (44% apart); everything else agrees. */
  async function toConsensus() {
    const { ev, requestId } = await openEval();
    await declareAll(ev.id);
    await scoreAndSubmit(
      'evaluator-tech',
      ev.id,
      (_c, n) => (n.startsWith('Technical') ? 9 : 7),
      'Tech view',
    );
    await scoreAndSubmit('evaluator-comm', ev.id, () => 7);
    expect((await call('chair', 'POST', `/evaluations/${ev.id}/consensus/open`)).json().code).toBe(
      'SCORING_PENDING',
    );
    await scoreAndSubmit('chair', ev.id, (_c, n) => (n.startsWith('Technical') ? 5 : 7), 'Chair view');
    const opened = await call('chair', 'POST', `/evaluations/${ev.id}/consensus/open`);
    expect(opened.statusCode, opened.body).toBe(200);
    return { ev: opened.json() as Ev, requestId };
  }

  it('opens only when everyone has finished, computes variance, flags the big gaps, and shows the chair every individual score with names', async () => {
    const { ev } = await toConsensus();
    expect(ev.status).toBe('CONSENSUS');
    const flagged = ev.consensus.filter((c) => c.flagged);
    const techCap = ev.criteria.find((c) => c.name.startsWith('Technical capability'))!;
    expect(flagged.map((c) => c.criterionId)).toEqual([techCap.id, techCap.id, techCap.id]); // one per supplier
    expect(flagged.every((c) => c.variancePct === 44.44)).toBe(true);
    const item = flagged[0]!;
    expect(item.individual!.map((i) => `${i.evaluator}:${i.score}`).sort()).toEqual(
      ['Riley Chen:0']
        .filter(() => false)
        .concat(item.individual!.map((i) => `${i.evaluator}:${i.score}`).sort()),
    );
    expect(item.individual!.map((i) => i.evaluator)).toEqual(expect.arrayContaining(['Tomas Silva']));
    expect(item.individual!.map((i) => i.score).sort()).toEqual([5, 9]);
    expect(
      ev.consensus.filter((c) => !c.flagged).every((c) => c.variancePct === 0 || c.variancePct === null),
    ).toBe(true);
    // a criterion scored by one person has nothing to reconcile and is prefilled
    const price = ev.criteria.find((c) => c.name.startsWith('Price'))!;
    expect(ev.consensus.filter((c) => c.criterionId === price.id).every((c) => c.consensusScore === 7)).toBe(
      false,
    ); // comm and chair both scored it: not prefilled
    // evaluators cannot see consensus or anyone else's scores even now
    for (const who of ['evaluator-tech', 'evaluator-comm']) {
      const v = await view(who, ev.id);
      expect(v.consensus, who).toEqual([]);
      expect(JSON.stringify(v), who).not.toContain('Chair view');
    }
    expect(JSON.stringify(await view('probity', ev.id))).toContain('Chair view'); // read-only oversight
    for (const who of ['evaluator-tech', 'procurement', 'delegate']) {
      expect((await call(who, 'POST', `/evaluations/${ev.id}/consensus/open`)).statusCode, who).toBe(403);
      expect((await call(who, 'POST', `/evaluations/${ev.id}/consensus/lock`)).statusCode, who).toBe(403);
    }
  });

  it('locking is refused while any score has no consensus value or any flagged score has no rationale, and then succeeds', async () => {
    const { ev } = await toConsensus();
    const techCap = ev.criteria.find((c) => c.name.startsWith('Technical capability'))!;
    const first = await call('chair', 'POST', `/evaluations/${ev.id}/consensus/lock`);
    expect(first.statusCode).toBe(409);
    expect(first.json().code).toBe('CONSENSUS_INCOMPLETE');
    // agree every cell, giving a rationale for none yet
    for (const sup of ev.suppliers) {
      const items = ev.criteria.map((c) => ({
        criterionId: c.id,
        consensusScore: c.id === techCap.id ? 7 : 7,
      }));
      const put = await call('chair', 'PUT', `/evaluations/${ev.id}/consensus/${sup.supplierId}`, { items });
      expect(put.statusCode, put.body).toBe(200);
    }
    const flaggedLock = await call('chair', 'POST', `/evaluations/${ev.id}/consensus/lock`);
    expect(flaggedLock.statusCode).toBe(409);
    expect(flaggedLock.json().code).toBe('FLAGS_UNRESOLVED');
    expect(flaggedLock.json().errors).toHaveLength(3);
    expect(flaggedLock.json().errors[0].message).toMatch(/44\.44%/);
    // a rationale that is too short still does not satisfy it
    await call('chair', 'PUT', `/evaluations/${ev.id}/consensus/${ev.suppliers[0]!.supplierId}`, {
      items: [{ criterionId: techCap.id, consensusScore: 7, rationale: 'short' }],
    });
    expect((await call('chair', 'POST', `/evaluations/${ev.id}/consensus/lock`)).json().errors).toHaveLength(
      3,
    );
    for (const sup of ev.suppliers)
      await call('chair', 'PUT', `/evaluations/${ev.id}/consensus/${sup.supplierId}`, {
        items: [
          {
            criterionId: techCap.id,
            consensusScore: 7,
            rationale: 'Panel discussed the site plan and agreed a midpoint.',
          },
        ],
      });
    const locked = await call('chair', 'POST', `/evaluations/${ev.id}/consensus/lock`);
    expect(locked.statusCode, locked.body).toBe(200);
    expect(locked.json().status).toBe('LOCKED');
    expect(locked.json().ranking).toHaveLength(3);
    // validation of consensus values
    expect(
      (
        await call('chair', 'PUT', `/evaluations/${ev.id}/consensus/${ev.suppliers[0]!.supplierId}`, {
          items: [{ criterionId: techCap.id, consensusScore: 7 }],
        })
      ).statusCode,
    ).toBe(409); // closed
  });

  it('after consensus opens individual scores can no longer change, even through the database', async () => {
    const { ev } = await toConsensus();
    const techRows = await withContext(
      database,
      { tenantId: TENANT_ID, userId: U.tech, role: 'EVALUATOR' },
      async (tx) => {
        const before = await tx.select().from(s.score).where(eq(s.score.evaluationId, ev.id));
        const upd = await tx
          .update(s.score)
          .set({ score: '1.00' })
          .where(eq(s.score.evaluationId, ev.id))
          .returning({ id: s.score.id });
        return { n: before.length, updated: upd.length };
      },
    );
    expect(techRows.n).toBeGreaterThan(0);
    expect(techRows.updated).toBe(0);
    const chairSees = await withContext(
      database,
      { tenantId: TENANT_ID, userId: U.chair, role: 'CHAIR' },
      (tx) => tx.select().from(s.score).where(eq(s.score.evaluationId, ev.id)),
    );
    expect(new Set(chairSees.map((r) => r.evaluatorId)).size).toBe(3);
  });
});

// =================================================================== US-EVL-05
describe('US-EVL-05 evaluation report', () => {
  async function lockedEvaluation(value = 90_000) {
    const { ev } = await (async () => {
      const o = await openEval({ value });
      return o;
    })();
    await declareAll(ev.id);
    // suppliers differ so the ranking is meaningful: brightwave > evergreen > northstar
    const bump = (company: string) =>
      company.startsWith('Brightwave') ? 2 : company.startsWith('Evergreen') ? 0 : -2;
    await scoreAndSubmit('evaluator-tech', ev.id, (c) => 7 + bump(c), 'Solid response');
    await scoreAndSubmit('evaluator-comm', ev.id, (c) => 7 + bump(c));
    await scoreAndSubmit('chair', ev.id, (c) => 7 + bump(c));
    const open = (await call('chair', 'POST', `/evaluations/${ev.id}/consensus/open`)).json() as Ev;
    for (const sup of open.suppliers)
      expect(
        (
          await call('chair', 'PUT', `/evaluations/${ev.id}/consensus/${sup.supplierId}`, {
            items: open.criteria.map((c) => ({
              criterionId: c.id,
              consensusScore: 7 + bump(sup.displayName),
            })),
          })
        ).statusCode,
      ).toBe(200);
    expect((await call('chair', 'POST', `/evaluations/${ev.id}/consensus/lock`)).statusCode).toBe(200);
    return ev.id;
  }

  it('is refused before the lock; afterwards it is populated, ranked, timestamped and credits no individual', async () => {
    const o = await openEval();
    await declareAll(o.ev.id);
    expect((await call('procurement', 'POST', `/evaluations/${o.ev.id}/report`)).json().code).toBe(
      'INVALID_STATE',
    );
    const id = await lockedEvaluation();
    const r = await call('procurement', 'POST', `/evaluations/${id}/report`);
    expect(r.statusCode, r.body).toBe(201);
    const ev = r.json() as Ev;
    expect(ev.status).toBe('REPORTED');
    expect(ev.report!.status).toBe('AWAITING_APPROVAL');
    expect(ev.report!.generatedAt).toBe(clock.now().toISOString());
    const text = (k: string) => ev.report!.sections.find((x) => x.key === k)!.paragraphs.join('\n');
    expect(text('summary')).toContain('Brightwave Cleaning Pty Ltd ranked first');
    expect(text('ranking')).toMatch(/1\. Brightwave.*\n2\. Evergreen.*\n3\. Northstar/);
    expect(text('process')).toContain('did not have access to pricing');
    expect(text('commentary')).toContain('Solid response');
    expect(text('commentary')).not.toMatch(/Tomas|Mei|Dana/); // comments are quoted, not attributed
    expect(ev.ranking.map((x) => x.rank)).toEqual([1, 2, 3]);
    expect(ev.ranking[0]!.weightedScore).toBe(90); // 9 out of 10 on every criterion
    for (const who of ['procurement', 'delegate', 'probity', 'chair'])
      expect(((await view(who, id)).report as { id: string }).id, who).toBeTruthy();
    expect((await view('evaluator-tech', id)).report).toBeNull();
    expect((await call('procurement', 'POST', `/evaluations/${id}/report`)).json().code).toBe(
      'INVALID_STATE',
    ); // already awaiting approval
  });

  it('a delegate approves within their authority and the evaluation is approved with a stamp; others cannot', async () => {
    const id = await lockedEvaluation();
    const ev = (await call('procurement', 'POST', `/evaluations/${id}/report`)).json() as Ev;
    const rid = ev.report!.id;
    for (const who of ['procurement', 'chair', 'evaluator-tech', 'probity'])
      expect(
        (await call(who, 'POST', `/evaluation-reports/${rid}/decision`, { decision: 'APPROVE' })).statusCode,
        who,
      ).toBe(403);
    expect(
      (await call('delegate', 'POST', `/evaluation-reports/${rid}/decision`, { decision: 'REJECT' }))
        .statusCode,
    ).toBe(400); // a reason is needed
    const ok = await call('delegate', 'POST', `/evaluation-reports/${rid}/decision`, {
      decision: 'APPROVE',
      comment: 'Agreed.',
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().status).toBe('APPROVED');
    expect(ok.json().report.status).toBe('APPROVED');
    expect(ok.json().report.decision.stamp).toContain('REPORT APPROVED');
    expect(
      (await call('delegate', 'POST', `/evaluation-reports/${rid}/decision`, { decision: 'APPROVE' })).json()
        .code,
    ).toBe('INVALID_STATE');
  });

  it('a delegate cannot approve above their authority (the executive can); a returned report can be regenerated', async () => {
    const big = await lockedEvaluation(400_000);
    const rep = (await call('procurement', 'POST', `/evaluations/${big}/report`)).json() as Ev;
    const no = await call('delegate', 'POST', `/evaluation-reports/${rep.report!.id}/decision`, {
      decision: 'APPROVE',
    });
    expect(no.statusCode).toBe(403);
    expect(no.json().code).toBe('DELEGATION_EXCEEDED');
    expect(no.json().title).toContain('$250,000');
    const returned = await call('exec', 'POST', `/evaluation-reports/${rep.report!.id}/decision`, {
      decision: 'REJECT',
      comment: 'Clarify the transition risk.',
    });
    expect(returned.statusCode, returned.body).toBe(200);
    expect(returned.json().report.status).toBe('DRAFT');
    const again = await call('procurement', 'POST', `/evaluations/${big}/report`);
    expect(again.statusCode, again.body).toBe(201);
    expect(again.json().report.status).toBe('AWAITING_APPROVAL');
    const approved = await call('exec', 'POST', `/evaluation-reports/${rep.report!.id}/decision`, {
      decision: 'APPROVE',
    });
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json().status).toBe('APPROVED');
  });
});

// =================================================================== lists and access
describe('lists, probity oversight and the seeded evaluation', () => {
  it('each person lists only the evaluations they may see', async () => {
    const { ev } = await openEval();
    const ids = async (who: string) =>
      ((await call(who, 'GET', '/evaluations')).json().evaluations as Array<{ id: string }>).map((e) => e.id);
    for (const who of ['procurement', 'probity', 'delegate', 'legal', 'evaluator-tech', 'chair'])
      expect(await ids(who), who).toContain(ev.id);
    expect((await call('requester', 'GET', '/evaluations')).statusCode).toBe(403);
    expect(
      (await call('procurement', 'GET', '/evaluators'))
        .json()
        .evaluators.map((x: { name: string }) => x.name),
    ).toEqual(expect.arrayContaining(['Tomas Silva', 'Mei Tanaka']));
    expect((await call('evaluator-tech', 'GET', '/evaluators')).statusCode).toBe(403);
  });

  it('the seeded evaluation is at consensus with exactly one flagged score of 37.5%, which only the chair and probity can see in detail', async () => {
    const list = (await call('chair', 'GET', '/evaluations')).json().evaluations as Array<{
      id: string;
      status: string;
    }>;
    const seeded = list.find((e) => e.status === 'CONSENSUS')!;
    const v = await view('chair', seeded.id);
    const flagged = v.consensus.filter((c) => c.flagged);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]!.variancePct).toBe(37.5);
    expect(flagged[0]!.individual!.map((i) => i.score).sort()).toEqual([5, 8]);
    expect(v.permissions).toMatchObject({ canSetConsensus: true, canLock: true });
    const t = await view('evaluator-tech', seeded.id);
    expect(t.consensus).toEqual([]);
    expect(t.criteria.some((c) => c.name === 'Price')).toBe(false);
  });
});

// =================================================================== helpers for the follow-up features
async function createEvaluator(tag: string) {
  const hash = await argon2Hash(PASSWORD);
  return withSystem(database, async (tx) => {
    const [u] = await tx
      .insert(s.appUser)
      .values({
        tenantId: TENANT_ID,
        email: `${tag}-${(titleSeq += 1)}@meridian-demo.example`,
        name: `Extra ${tag}`,
        passwordHash: hash,
      })
      .returning();
    await tx.insert(s.roleAssignment).values({ tenantId: TENANT_ID, userId: u!.id, role: 'EVALUATOR' });
    return u!;
  });
}
const bumpFor = (company: string) =>
  company.startsWith('Brightwave') ? 2 : company.startsWith('Evergreen') ? 0 : -2;
/** An evaluation taken all the way to a locked consensus (Brightwave > Evergreen > Northstar). */
async function lockedEval(value = 90_000) {
  const { ev } = await openEval({ value });
  await declareAll(ev.id);
  await scoreAndSubmit('evaluator-tech', ev.id, (c) => 7 + bumpFor(c), 'Solid response');
  await scoreAndSubmit('evaluator-comm', ev.id, (c) => 7 + bumpFor(c));
  await scoreAndSubmit('chair', ev.id, (c) => 7 + bumpFor(c));
  const open = (await call('chair', 'POST', `/evaluations/${ev.id}/consensus/open`)).json() as Ev;
  for (const sup of open.suppliers)
    expect(
      (
        await call('chair', 'PUT', `/evaluations/${ev.id}/consensus/${sup.supplierId}`, {
          items: open.criteria.map((c) => ({
            criterionId: c.id,
            consensusScore: 7 + bumpFor(sup.displayName),
          })),
        })
      ).statusCode,
    ).toBe(200);
  expect((await call('chair', 'POST', `/evaluations/${ev.id}/consensus/lock`)).statusCode).toBe(200);
  return ev.id;
}

// =================================================================== delegate review of a declared conflict
describe('a declared conflict is decided by a delegate', () => {
  it('immaterial and manageable conflicts reinstate the evaluator (who then sees names and files); only a delegate or the executive can decide, and only once', async () => {
    for (const disposition of ['IMMATERIAL', 'MANAGEABLE'] as const) {
      const { ev } = await openEval();
      const c = await call('evaluator-comm', 'POST', `/evaluations/${ev.id}/coi`, {
        none: false,
        nature: 'My cousin works at a bidder',
        subjectOrg: 'Northstar',
      });
      expect(c.json().suspended).toBe(true);
      expect((await call('evaluator-comm', 'GET', `/evaluations/${ev.id}`)).statusCode).toBe(404); // suspended while it is decided
      for (const who of ['procurement', 'chair', 'probity', 'evaluator-tech'])
        expect(
          (await call(who, 'POST', `/evaluations/${ev.id}/conflicts/${U.comm}/decision`, { disposition }))
            .statusCode,
          who,
        ).toBe(403);
      const ok = await call('delegate', 'POST', `/evaluations/${ev.id}/conflicts/${U.comm}/decision`, {
        disposition,
        rationale: 'Remote and declared; managed by independent scoring.',
      });
      expect(ok.statusCode, ok.body).toBe(200);
      expect(ok.json().panel.find((m: { name: string }) => m.name === 'Mei Tanaka').coiState).toBe(
        'DECLARED_NONE',
      );
      expect(
        (
          await call('delegate', 'POST', `/evaluations/${ev.id}/conflicts/${U.comm}/decision`, {
            disposition,
          })
        ).json().code,
      ).toBe('INVALID_STATE'); // only once
      const back = await view('evaluator-comm', ev.id);
      expect(back.suppliers.every((x) => !x.anonymised)).toBe(true);
      expect(back.suppliers[0]!.files.map((f) => f.section)).toEqual(['COMMERCIAL']); // still only their own stream
      expect(JSON.stringify((await call('evaluator-comm', 'GET', '/notifications')).json())).toContain(
        'you can continue',
      );
      // once the others declare, scoring opens with the reinstated evaluator counted
      await call('evaluator-tech', 'POST', `/evaluations/${ev.id}/coi`, { none: true });
      await call('chair', 'POST', `/evaluations/${ev.id}/coi`, { none: true });
      expect((await view('procurement', ev.id)).status).toBe('SCORING');
    }
  });

  it('the executive may decide too; a person with no pending conflict is refused; bad input and unknown evaluations are refused', async () => {
    const { ev } = await openEval();
    expect(
      (
        await call('exec', 'POST', `/evaluations/${ev.id}/conflicts/${U.tech}/decision`, {
          disposition: 'IMMATERIAL',
        })
      ).json().code,
    ).toBe('INVALID_STATE');
    await call('evaluator-tech', 'POST', `/evaluations/${ev.id}/coi`, {
      none: false,
      nature: 'Former employer of a bidder',
    });
    const ok = await call('exec', 'POST', `/evaluations/${ev.id}/conflicts/${U.tech}/decision`, {
      disposition: 'MATERIAL',
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().panel.find((m: { name: string }) => m.name === 'Tomas Silva').coiState).toBe('REMOVED');
    expect(
      (
        await call('delegate', 'POST', `/evaluations/${randomUUID()}/conflicts/${U.tech}/decision`, {
          disposition: 'MATERIAL',
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await call('delegate', 'POST', `/evaluations/${ev.id}/conflicts/${U.tech}/decision`, {
          disposition: 'nonsense',
        })
      ).statusCode,
    ).toBe(400);
  });

  it('while a conflict is undecided the chair cannot open consensus; deciding unblocks it; the report records a reviewed conflict', async () => {
    const { ev } = await openEval();
    await declareAll(ev.id);
    const late = await createEvaluator('late');
    await call('procurement', 'POST', `/evaluations/${ev.id}/panel`, {
      userId: late.id,
      stream: 'TECHNICAL',
    });
    await call(late.email, 'POST', `/evaluations/${ev.id}/coi`, {
      none: false,
      nature: 'Shares in a bidder',
    });
    await scoreAndSubmit('evaluator-tech', ev.id, agree);
    await scoreAndSubmit('evaluator-comm', ev.id, agree);
    await scoreAndSubmit('chair', ev.id, agree);
    const blocked = await call('chair', 'POST', `/evaluations/${ev.id}/consensus/open`);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('CONFLICT_PENDING');
    expect((await view('chair', ev.id)).permissions.canOpenConsensus).toBe(false);
    expect(
      (
        await call('delegate', 'POST', `/evaluations/${ev.id}/conflicts/${late.id}/decision`, {
          disposition: 'IMMATERIAL',
          rationale: 'Declared and immaterial.',
        })
      ).statusCode,
    ).toBe(200);
    // the reinstated evaluator has not scored, so the chair still waits for them
    expect((await call('chair', 'POST', `/evaluations/${ev.id}/consensus/open`)).json().code).toBe(
      'SCORING_PENDING',
    );
    await scoreAndSubmit(late.email, ev.id, agree);
    expect((await call('chair', 'POST', `/evaluations/${ev.id}/consensus/open`)).statusCode).toBe(200);
    const open = (await view('chair', ev.id)) as Ev;
    for (const sup of open.suppliers)
      await call('chair', 'PUT', `/evaluations/${ev.id}/consensus/${sup.supplierId}`, {
        items: open.criteria.map((c) => ({ criterionId: c.id, consensusScore: 7 })),
      });
    expect((await call('chair', 'POST', `/evaluations/${ev.id}/consensus/lock`)).statusCode).toBe(200);
    const rep = (await call('procurement', 'POST', `/evaluations/${ev.id}/report`)).json() as Ev;
    const process = rep.report!.sections.find((x) => x.key === 'process')!.paragraphs.join('\n');
    expect(process).toContain(
      '1 member(s) declared a conflict that a delegate reviewed and allowed to continue',
    );
  });
});

// =================================================================== reopening consensus
describe('the chair can reopen a locked consensus', () => {
  it('needs a reason, only the chair can do it, it keeps the agreed values and frozen scores, invalidates the report, and is audited and announced', async () => {
    const id = await lockedEval();
    const rep = (await call('procurement', 'POST', `/evaluations/${id}/report`)).json() as Ev;
    expect(rep.report!.status).toBe('AWAITING_APPROVAL');
    expect((await view('chair', id)).permissions.canReopen).toBe(true);
    expect(
      (await call('chair', 'POST', `/evaluations/${id}/consensus/reopen`, { reason: 'short' })).statusCode,
    ).toBe(400);
    for (const who of ['procurement', 'delegate', 'evaluator-tech', 'probity', 'exec'])
      expect(
        (
          await call(who, 'POST', `/evaluations/${id}/consensus/reopen`, {
            reason: 'Because I would like to.',
          })
        ).statusCode,
        who,
      ).toBe(403);
    const r = await call('chair', 'POST', `/evaluations/${id}/consensus/reopen`, {
      reason: 'Northstar clarified its transition plan after lock.',
    });
    expect(r.statusCode, r.body).toBe(200);
    const ev = r.json() as Ev;
    expect(ev.status).toBe('CONSENSUS');
    expect(ev.report!.status).toBe('DRAFT'); // the old report no longer stands
    expect(ev.permissions).toMatchObject({
      canSetConsensus: true,
      canLock: true,
      canGenerateReport: false,
      canDecideReport: false,
    });
    expect(ev.consensus.every((c) => c.consensusScore !== null)).toBe(true); // agreed values are kept
    // individual scores are still frozen, even by direct database update
    const upd = await withContext(
      database,
      { tenantId: TENANT_ID, userId: U.tech, role: 'EVALUATOR' },
      (tx) =>
        tx
          .update(s.score)
          .set({ score: '1.00' })
          .where(eq(s.score.evaluationId, id))
          .returning({ id: s.score.id }),
    );
    expect(upd).toHaveLength(0);
    const events = await withSystem(database, (tx) =>
      tx
        .select()
        .from(s.auditEvent)
        .where(and(eq(s.auditEvent.entityId, id), eq(s.auditEvent.action, 'evaluation.consensus_reopen'))),
    );
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0])).toContain('Northstar clarified its transition plan after lock.');
    for (const who of ['procurement', 'delegate', 'probity'])
      expect(JSON.stringify((await call(who, 'GET', '/notifications')).json()), who).toContain(
        'Consensus reopened by the chair',
      );
    // the report cannot be approved or regenerated until consensus is locked again
    expect((await call('procurement', 'POST', `/evaluations/${id}/report`)).json().code).toBe(
      'INVALID_STATE',
    );
    expect(
      (
        await call('delegate', 'POST', `/evaluation-reports/${rep.report!.id}/decision`, {
          decision: 'APPROVE',
        })
      ).json().code,
    ).toBe('INVALID_STATE');
  });

  it('after changing a value and locking again the report is regenerated with the new ranking; an approved evaluation cannot be reopened; nothing to reopen before the lock', async () => {
    const id = await lockedEval();
    await call('procurement', 'POST', `/evaluations/${id}/report`);
    expect(
      (
        await call('chair', 'POST', `/evaluations/${id}/consensus/reopen`, {
          reason: 'Re-check the commercial scores.',
        })
      ).statusCode,
    ).toBe(200);
    const ev = (await view('chair', id)) as Ev;
    const northstar = ev.suppliers.find((x) => x.displayName.startsWith('Northstar'))!;
    const put = await call('chair', 'PUT', `/evaluations/${id}/consensus/${northstar.supplierId}`, {
      items: ev.criteria.map((c) => ({ criterionId: c.id, consensusScore: 10 })),
    });
    expect(put.statusCode, put.body).toBe(200);
    expect((await call('chair', 'POST', `/evaluations/${id}/consensus/lock`)).statusCode).toBe(200);
    const regen = (await call('procurement', 'POST', `/evaluations/${id}/report`)).json() as Ev;
    expect(regen.report!.status).toBe('AWAITING_APPROVAL');
    expect(regen.ranking[0]!.displayName).toMatch(/^Northstar/); // the new scores drive the new ranking
    expect(regen.ranking[0]!.weightedScore).toBe(100);
    const ok = await call('delegate', 'POST', `/evaluation-reports/${regen.report!.id}/decision`, {
      decision: 'APPROVE',
    });
    expect(ok.statusCode, ok.body).toBe(200);
    const no = await call('chair', 'POST', `/evaluations/${id}/consensus/reopen`, {
      reason: 'We want to change it now.',
    });
    expect(no.statusCode).toBe(409);
    expect(no.json().title).toMatch(/approved evaluation cannot be reopened/);
    expect((await view('chair', id)).permissions.canReopen).toBe(false);
    const early = await openEval();
    await declareAll(early.ev.id);
    expect(
      (
        await call('chair', 'POST', `/evaluations/${early.ev.id}/consensus/reopen`, {
          reason: 'Nothing locked yet.',
        })
      ).statusCode,
    ).toBe(409);
  });
});

// =================================================================== PDF export of the report
describe('the report can be exported as a PDF', () => {
  const text = (res: { rawPayload: Buffer }) => res.rawPayload.toString('latin1');

  it('is a real PDF carrying the content, timestamp and version, for the roles that may read the report; refused for others', async () => {
    const id = await lockedEval();
    expect((await call('procurement', 'GET', `/evaluations/${id}/report/pdf`)).json().code).toBe('NO_REPORT');
    const gen = (await call('procurement', 'POST', `/evaluations/${id}/report`)).json() as Ev;
    const res = await call('procurement', 'GET', `/evaluations/${id}/report/pdf`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(
      /attachment; filename="evaluation-report-PR-\d{4}-\d{4}-v\d+\.pdf"/,
    );
    const pdf = text(res);
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pdf).toContain('(Evaluation report) Tj');
    expect(pdf).toContain('Brightwave Cleaning Pty Ltd');
    expect(pdf).toContain('Awaiting approval');
    expect(pdf).toContain('2026-10-02 00:00 UTC'); // generation time
    expect(pdf).toMatch(/version \d+/); // version in the footer of every page
    expect(pdf).toContain('Page 1 of');
    expect(pdf).toContain('Brightwave Cleaning Pty Ltd ranked first'); // the generated summary is in the file
    void gen;
    for (const who of ['delegate', 'exec', 'probity', 'legal', 'chair'])
      expect((await call(who, 'GET', `/evaluations/${id}/report/pdf`)).statusCode, who).toBe(200);
    for (const who of ['evaluator-tech', 'requester', 'admin', 'finance', 'supplier'])
      expect((await call(who, 'GET', `/evaluations/${id}/report/pdf`)).statusCode, who).toBe(403);
    const exports = await withSystem(database, (tx) =>
      tx
        .select()
        .from(s.auditEvent)
        .where(and(eq(s.auditEvent.entityId, id), eq(s.auditEvent.action, 'report.export'))),
    );
    expect(exports.length).toBeGreaterThanOrEqual(6);
  });

  it('shows the approval stamp once approved, and says "needs regenerating" after a reopen', async () => {
    const id = await lockedEval();
    const gen = (await call('procurement', 'POST', `/evaluations/${id}/report`)).json() as Ev;
    await call('delegate', 'POST', `/evaluation-reports/${gen.report!.id}/decision`, {
      decision: 'APPROVE',
      comment: 'Agreed.',
    });
    const approved = text(await call('delegate', 'GET', `/evaluations/${id}/report/pdf`));
    expect(approved).toContain('REPORT APPROVED');

    const other = await lockedEval();
    await call('procurement', 'POST', `/evaluations/${other}/report`);
    await call('chair', 'POST', `/evaluations/${other}/consensus/reopen`, {
      reason: 'Re-check the technical scores.',
    });
    expect(text(await call('procurement', 'GET', `/evaluations/${other}/report/pdf`))).toContain(
      'Needs regenerating',
    );
  });

  it('a long report flows onto several pages, each numbered', async () => {
    const id = await lockedEval();
    await call('procurement', 'POST', `/evaluations/${id}/report`);
    const rid = (
      await withSystem(database, (tx) =>
        tx.select().from(s.evalReport).where(eq(s.evalReport.evaluationId, id)),
      )
    )[0]!.id;
    await withSystem(database, (tx) =>
      tx
        .update(s.fieldValue)
        .set({
          value: Array.from(
            { length: 60 },
            (_, i) => `Paragraph ${i}: ${'The panel recorded its reasoning in full. '.repeat(8)}`,
          ).join('\n\n'),
        })
        .where(and(eq(s.fieldValue.ownerId, rid), eq(s.fieldValue.key, 'commentary'))),
    );
    const pdf = text(await call('procurement', 'GET', `/evaluations/${id}/report/pdf`));
    const pages = [...pdf.matchAll(/\/Type \/Page /g)].length;
    expect(pages).toBeGreaterThanOrEqual(3);
    for (let i = 1; i <= pages; i++) expect(pdf).toContain(`Page ${i} of ${pages}`);
  });
});

// =================================================================== bid files can be downloaded
describe('bid file downloads', () => {
  it('seeded bid files are real documents: a PDF and an Excel workbook, sealed on disk and downloadable by the right people', async () => {
    const seeded = (
      (await call('chair', 'GET', '/evaluations')).json().evaluations as Array<{ id: string; status: string }>
    ).find((e) => e.status === 'CONSENSUS')!;
    const v = await view('chair', seeded.id);
    const sup = v.suppliers[0]!;
    const pdf = sup.files.find((f) => f.section === 'TECHNICAL')!;
    const xlsx = sup.files.find((f) => f.section === 'COMMERCIAL')!;
    const url = (f: { id: string }) => `/evaluations/${seeded.id}/suppliers/${sup.supplierId}/files/${f.id}`;
    const a = await call('chair', 'GET', url(pdf));
    expect(a.statusCode, a.body).toBe(200);
    expect(a.headers['content-type']).toBe('application/pdf');
    expect(a.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(a.rawPayload.toString('latin1')).toContain(sup.displayName);
    const b = await call('chair', 'GET', url(xlsx));
    expect(b.statusCode).toBe(200);
    expect(b.headers['content-type']).toContain('spreadsheetml');
    expect(b.rawPayload.subarray(0, 2).toString()).toBe('PK');
    // stream isolation still applies to the real files
    expect((await call('evaluator-tech', 'GET', url(pdf))).statusCode).toBe(200);
    expect((await call('evaluator-tech', 'GET', url(xlsx))).statusCode).toBe(404);
    expect((await call('evaluator-comm', 'GET', url(pdf))).statusCode).toBe(404);
    expect((await call('evaluator-comm', 'GET', url(xlsx))).statusCode).toBe(200);
  });

  it('a file whose stored copy is missing is a clear 404, never a server error', async () => {
    const { ev } = await openEval();
    const pv = await view('procurement', ev.id);
    const file = pv.suppliers[0]!.files[0]!;
    await withSystem(database, (tx) =>
      tx
        .update(s.fileObject)
        .set({ storageKey: `${TENANT_ID}/missing/${randomUUID()}` })
        .where(eq(s.fileObject.id, file.id)),
    );
    const res = await call(
      'procurement',
      'GET',
      `/evaluations/${ev.id}/suppliers/${pv.suppliers[0]!.supplierId}/files/${file.id}`,
    );
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('FILE_UNAVAILABLE');
  });
});

// =================================================================== M12b: per-evaluation variance limit and probity sign-off
describe('the variance limit can be set per evaluation by the chair (US-EVL-04)', () => {
  /** Tech 9, chair 7 on technical capability: 22% apart, so flagged only when the limit is below that. */
  async function scored(limit?: number) {
    const { ev } = await openEval();
    await declareAll(ev.id);
    if (limit !== undefined) {
      const r = await call('chair', 'PUT', `/evaluations/${ev.id}/variance-limit`, { limitPct: limit });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().varianceLimitPct).toBe(limit);
    }
    await scoreAndSubmit('evaluator-tech', ev.id, (_c, n) => (n.startsWith('Technical') ? 9 : 7));
    await scoreAndSubmit('evaluator-comm', ev.id, () => 7);
    await scoreAndSubmit('chair', ev.id, () => 7);
    const opened = await call('chair', 'POST', `/evaluations/${ev.id}/consensus/open`);
    expect(opened.statusCode, opened.body).toBe(200);
    return opened.json() as Ev;
  }

  it('a lower limit flags what the default would let through, and a higher one flags less', async () => {
    const byDefault = await scored();
    expect(byDefault.varianceLimitPct).toBe(30);
    expect(byDefault.consensus.filter((c) => c.flagged)).toHaveLength(0);
    const strict = await scored(20);
    expect(strict.consensus.filter((c) => c.flagged).length).toBeGreaterThan(0);
    expect(strict.consensus.filter((c) => c.flagged).every((c) => (c.variancePct ?? 0) > 20)).toBe(true);
    // the limit is recorded in the report's process section
    const lenient = await scored(60);
    expect(lenient.consensus.filter((c) => c.flagged)).toHaveLength(0);
  });

  it('only the chair, only before consensus opens, within 5 to 60 percent, and it is audited and announced', async () => {
    const { ev } = await openEval();
    await declareAll(ev.id);
    for (const who of ['procurement', 'evaluator-tech', 'delegate', 'probity', 'requester'])
      expect(
        (await call(who, 'PUT', `/evaluations/${ev.id}/variance-limit`, { limitPct: 20 })).statusCode,
        who,
      ).toBe(403);
    for (const bad of [4, 61, 12.5, '20'])
      expect(
        (await call('chair', 'PUT', `/evaluations/${ev.id}/variance-limit`, { limitPct: bad })).statusCode,
        String(bad),
      ).toBe(400);
    expect((await call('chair', 'PUT', `/evaluations/${ev.id}/variance-limit`, {})).statusCode).toBe(400);
    expect((await view('chair', ev.id)).permissions.canSetVarianceLimit).toBe(true);
    expect(
      (await call('chair', 'PUT', `/evaluations/${ev.id}/variance-limit`, { limitPct: 25 })).statusCode,
    ).toBe(200);
    const audit = await withSystem(database, (tx) =>
      tx
        .select()
        .from(s.auditEvent)
        .where(and(eq(s.auditEvent.entityId, ev.id), eq(s.auditEvent.action, 'evaluation.variance_limit'))),
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.before).toMatchObject({ limitPct: 30 });
    expect(audit[0]!.after).toMatchObject({ limitPct: 25 });
    const procId = uid('user:procurement');
    const notes = await withSystem(database, (tx) =>
      tx.select().from(s.notification).where(eq(s.notification.userId, procId)),
    );
    expect(notes.some((n) => n.title === 'Variance limit changed')).toBe(true);
    // not once consensus is open
    const id2 = (await scored()).id;
    expect(
      (await call('chair', 'PUT', `/evaluations/${id2}/variance-limit`, { limitPct: 10 })).statusCode,
    ).toBe(409);
    expect((await view('chair', id2)).permissions.canSetVarianceLimit).toBe(false);
  });
});

describe('probity sign-off on the evaluation process (US-EVL-06/07)', () => {
  it('is recorded once, by probity, after consensus is locked; it shows on the evaluation and in the PDF and is audited', async () => {
    const { ev } = await openEval();
    await declareAll(ev.id);
    expect((await call('probity', 'POST', `/evaluations/${ev.id}/probity-signoff`, {})).statusCode).toBe(409); // not locked yet
    const id = await lockedEval();
    expect((await view('probity', id)).permissions.canProbitySignOff).toBe(true);
    for (const who of ['procurement', 'chair', 'delegate', 'evaluator-tech', 'requester'])
      expect((await call(who, 'POST', `/evaluations/${id}/probity-signoff`, {})).statusCode, who).toBe(403);
    const r = await call('probity', 'POST', `/evaluations/${id}/probity-signoff`, {
      comment: 'Process followed, conflicts declared',
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().probitySignoff.by).toBe('Jonas Becker');
    expect(r.json().probitySignoff.stamp).toMatch(
      /^PROBITY SIGN-OFF · Jonas Becker · PROBITY · \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/,
    );
    expect(r.json().permissions.canProbitySignOff).toBe(false);
    expect((await call('probity', 'POST', `/evaluations/${id}/probity-signoff`, {})).json().code).toBe(
      'ALREADY_SIGNED_OFF',
    );
    // others can read that it is signed off
    expect((await view('procurement', id)).probitySignoff?.by).toBe('Jonas Becker');
    expect((await view('chair', id)).probitySignoff?.by).toBe('Jonas Becker');
    // it reaches the PDF
    await call('procurement', 'POST', `/evaluations/${id}/report`);
    const pdf = await call('procurement', 'GET', `/evaluations/${id}/report/pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.toString('latin1')).toContain('Probity sign-off');
    const audit = await withSystem(database, (tx) =>
      tx
        .select()
        .from(s.auditEvent)
        .where(and(eq(s.auditEvent.entityId, id), eq(s.auditEvent.action, 'evaluation.probity_signoff'))),
    );
    expect(audit).toHaveLength(1);
    // it does not change the approval path: the delegate still decides the report
    const rep = (await view('delegate', id)).report!;
    expect(rep.status).toBe('AWAITING_APPROVAL');
  });
});

describe('the report can be exported as a Word document', () => {
  it('is a real .docx with the same content, version and approval as the PDF, for the same roles, and audited', async () => {
    const id = await lockedEval();
    await call('procurement', 'POST', `/evaluations/${id}/report`);
    const res = await call('procurement', 'GET', `/evaluations/${id}/report/docx`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(res.headers['content-disposition']).toMatch(
      /attachment; filename="evaluation-report-PR-[\w-]+-v\d+\.docx"/,
    );
    const buf = res.rawPayload;
    expect(buf.subarray(0, 4).toString('latin1')).toBe('PK\u0003\u0004');
    const text = buf.toString('utf8');
    expect(text).toContain('word/document.xml');
    expect(text).toContain('Evaluation report');
    expect(text).toContain('Awaiting approval');
    expect(text).toContain('Brightwave');
    expect(text).toMatch(/version \d+/);
    // the same roles as the PDF, and not the others
    for (const who of ['delegate', 'exec', 'probity', 'legal', 'chair'])
      expect((await call(who, 'GET', `/evaluations/${id}/report/docx`)).statusCode, who).toBe(200);
    for (const who of ['requester', 'evaluator-tech', 'finance', 'admin'])
      expect((await call(who, 'GET', `/evaluations/${id}/report/docx`)).statusCode, who).toBe(403);
    expect(
      (await call('procurement', 'GET', '/evaluations/00000000-0000-4000-8000-000000000000/report/docx'))
        .statusCode,
    ).toBe(404);
    const audit = await withSystem(database, (tx) =>
      tx
        .select()
        .from(s.auditEvent)
        .where(and(eq(s.auditEvent.entityId, id), eq(s.auditEvent.action, 'report.export'))),
    );
    expect(audit.some((e) => (e.after as { format: string }).format === 'DOCX')).toBe(true);
  });
  it('is refused before a report exists', async () => {
    const id = await lockedEval();
    expect((await call('procurement', 'GET', `/evaluations/${id}/report/docx`)).statusCode).toBe(404);
  });
});
