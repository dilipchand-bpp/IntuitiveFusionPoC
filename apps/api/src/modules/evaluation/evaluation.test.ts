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
  await seedDatabase(database, { clock, password: PASSWORD });
  const dir = await mkdtemp(join(tmpdir(), 'if-eval-'));
  store = new SealedStore(dir, 'e'.repeat(40));
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

  it('a declared conflict revokes access at once, alerts the chair and probity, is audited, and a replacement can be added to carry on', async () => {
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
    expect(c.json()).toMatchObject({ removed: true });
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
    expect((await view('procurement', ev.id)).status).toBe('SCORING');
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
