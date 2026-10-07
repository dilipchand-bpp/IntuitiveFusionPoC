import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hash as argon2Hash } from '@node-rs/argon2';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ManualClock } from '@if/shared';
import { buildApp } from '../../app.js';
import { withSystem, type Database } from '../../db/client.js';
import * as s from '../../db/schema.js';
import { emailFor, seedDatabase, TENANT_ID, uid } from '../../db/seed.js';
import { freshDb, newClock } from '../../test-helpers.js';
import { loadConfig } from '@if/shared';

const PASSWORD = 'unit-test-password-123';
let app: FastifyInstance;
let database: Database;
let clock: ManualClock;

type Sess = { cookies: Record<string, string>; csrf: string };
const sessions = new Map<string, Sess>();
async function sessionFor(key: string): Promise<Sess> {
  if (sessions.has(key)) return sessions.get(key)!;
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: key.includes('@') ? key : emailFor(key), password: PASSWORD },
  });
  expect(res.statusCode, `${key}: ${res.body}`).toBe(200);
  const sess = {
    cookies: Object.fromEntries(res.cookies.map((c) => [c.name, c.value])),
    csrf: res.json().csrfToken as string,
  };
  sessions.set(key, sess);
  return sess;
}
async function call(
  key: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
) {
  const sess = await sessionFor(key);
  return app.inject({
    method,
    url: `/api/v1${url}`,
    cookies: sess.cookies,
    headers: method === 'GET' ? {} : { 'x-csrf-token': sess.csrf },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
}

beforeAll(async () => {
  database = await freshDb();
  clock = newClock();
  await seedDatabase(database, { clock, password: PASSWORD });
  const dir = await mkdtemp(join(tmpdir(), 'if-contract-'));
  app = await buildApp(loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 'c'.repeat(40), STORAGE_DIR: dir }), {
    database,
    clock,
    loginRateLimitMax: 10_000,
  });
}, 120_000);

let seq = 0;
const BRIGHT = uid('supplier:brightwave');
const EVERGREEN = uid('supplier:evergreen');

/** An evaluation whose report is approved, Brightwave first and Evergreen second. */
async function award(opts: { type?: 'RFT' | 'RFP' | 'RFQ'; value?: number | null; passFail?: boolean } = {}) {
  const n = (seq += 1);
  return withSystem(database, async (tx) => {
    const [req] = await tx
      .insert(s.request)
      .values({
        tenantId: TENANT_ID,
        number: `PR-TEST-${String(n).padStart(4, '0')}`,
        title: `Award fixture ${n}`,
        estimatedValue: opts.value === null ? null : String(opts.value ?? 120_000),
        termMonths: 24,
        requesterId: uid('user:requester'),
        phase: 'EVALUATION',
        status: 'IN_PROGRESS',
      })
      .returning();
    const [t] = await tx
      .insert(s.tender)
      .values({ tenantId: TENANT_ID, requestId: req!.id, type: opts.type ?? 'RFP', status: 'EVALUATING' })
      .returning();
    for (const sup of [BRIGHT, EVERGREEN])
      await tx.insert(s.submission).values({
        tenantId: TENANT_ID,
        tenderId: t!.id,
        supplierId: sup,
        status: 'SUBMITTED',
        submittedAt: clock.now(),
      });
    const [ev] = await tx
      .insert(s.evaluation)
      .values({ tenantId: TENANT_ID, tenderId: t!.id, status: 'APPROVED' })
      .returning();
    const [crit] = await tx
      .insert(s.criterion)
      .values({
        tenantId: TENANT_ID,
        evaluationId: ev!.id,
        name: 'Quality',
        weight: '100',
        stream: 'TECHNICAL',
      })
      .returning();
    for (const [sup, score] of [
      [BRIGHT, '8.00'],
      [EVERGREEN, '6.00'],
    ] as const)
      await tx.insert(s.consensusItem).values({
        tenantId: TENANT_ID,
        evaluationId: ev!.id,
        supplierId: sup,
        criterionId: crit!.id,
        consensusScore: score,
      });
    return { evaluationId: ev!.id, tenderId: t!.id, requestId: req!.id };
  });
}

async function draft(opts: Parameters<typeof award>[0] = {}, body: Record<string, unknown> = {}) {
  const a = await award(opts);
  const r = await call('legal', 'POST', '/contracts', {
    evaluationId: a.evaluationId,
    supplierId: BRIGHT,
    ...body,
  });
  expect(r.statusCode, r.body).toBe(201);
  return { ...a, c: r.json() as Contract };
}
interface Contract {
  id: string;
  number: string;
  status: string;
  value: number;
  locked: boolean;
  startDate: string;
  endDate: string;
  clauses: Array<{
    id: string;
    title: string;
    text: string;
    mandatory: boolean;
    changedFromTemplate: boolean;
  }>;
  deviations: Array<{ clauseId: string; templateText: string; currentText: string }>;
  signatures: Array<{ role: string; decision: string; stamp: string; userName: string }>;
  chain: Array<{ role: string; signedBy: string | null }>;
  permissions: {
    canEdit: boolean;
    canRelease: boolean;
    canSign: boolean;
    signBlocked: string | null;
    canDelete: boolean;
  };
}
const get = async (who: string, id: string) =>
  (await call(who, 'GET', `/contracts/${id}`)).json() as Contract;

/** Drafts, has Legal edit one clause, and releases. */
async function released(opts: Parameters<typeof award>[0] = {}) {
  const d = await draft(opts);
  expect(
    (
      await call('legal', 'PUT', `/contracts/${d.c.id}/clauses/IP`, {
        text: 'Legal reviewed wording for IP.',
      })
    ).statusCode,
  ).toBe(200);
  const r = await call('legal', 'POST', `/contracts/${d.c.id}/release-for-signing`);
  expect(r.statusCode, r.body).toBe(200);
  return d;
}

async function extraUser(
  tag: string,
  role: s.Role,
  delegations: Array<{ scope: 'SOURCING_APPROVAL' | 'CONTRACT_SIGNING'; max: string }>,
) {
  const hash = await argon2Hash(PASSWORD);
  return withSystem(database, async (tx) => {
    const email = `${tag}-${(seq += 1)}@meridian-demo.example`;
    const [u] = await tx
      .insert(s.appUser)
      .values({ tenantId: TENANT_ID, email, name: `Extra ${tag}`, passwordHash: hash })
      .returning();
    await tx.insert(s.roleAssignment).values({ tenantId: TENANT_ID, userId: u!.id, role });
    for (const d of delegations)
      await tx.insert(s.delegation).values({
        tenantId: TENANT_ID,
        scope: d.scope,
        role,
        userId: u!.id,
        maxValue: d.max,
      });
    return { email, id: u!.id };
  });
}

describe('US-CON-01 draft from the approved evaluation', () => {
  it('assembles the template for the tender route, with the winner, price and dates, and notifies legal', async () => {
    const d = await draft({ type: 'RFP', value: 120_000 });
    expect(d.c.number).toMatch(/^CT-\d{4}-\d{4}$/);
    expect(d.c.status).toBe('DRAFT');
    expect(d.c.value).toBe(120_000);
    const text = d.c.clauses.map((c) => c.text).join('\n');
    expect(text).toContain('Brightwave Cleaning Pty Ltd');
    expect(text).toContain('$120,000');
    expect(text).not.toMatch(/\{\{/);
    expect(d.c.clauses.filter((c) => c.mandatory).length).toBeGreaterThanOrEqual(5);
    expect(d.c.clauses.every((c) => !c.changedFromTemplate)).toBe(true);
    const tpl = await withSystem(
      database,
      async (tx) => (await tx.select().from(s.contract).where(eq(s.contract.id, d.c.id)))[0]!.templateId,
    );
    expect(tpl).toBe('tpl-services-std');
    const [t] = await withSystem(database, (tx) =>
      tx.select().from(s.tender).where(eq(s.tender.id, d.tenderId)),
    );
    expect(t!.status).toBe('AWARDED');
    const legalId = uid('user:legal');
    const notes = await withSystem(database, (tx) =>
      tx.select().from(s.notification).where(eq(s.notification.userId, legalId)),
    );
    expect(notes.some((x) => x.link === `/app/contracts/${d.c.id}`)).toBe(true);
    const audit = await withSystem(database, (tx) =>
      tx
        .select()
        .from(s.auditEvent)
        .where(and(eq(s.auditEvent.entityId, d.c.id), eq(s.auditEvent.action, 'contract.draft'))),
    );
    expect(audit).toHaveLength(1);
  });

  it('an RFT gets the works template', async () => {
    const d = await draft({ type: 'RFT' });
    const [row] = await withSystem(database, (tx) =>
      tx.select().from(s.contract).where(eq(s.contract.id, d.c.id)),
    );
    expect(row!.templateId).toBe('tpl-works-std');
    expect(d.c.clauses.map((c) => c.id)).toContain('WHS');
  });

  it('is refused for: an unapproved evaluation, a supplier that did not win, a second contract, a missing value, other roles and unknown ids', async () => {
    const a = await award();
    await withSystem(database, (tx) =>
      tx.update(s.evaluation).set({ status: 'REPORTED' }).where(eq(s.evaluation.id, a.evaluationId)),
    );
    expect(
      (await call('legal', 'POST', '/contracts', { evaluationId: a.evaluationId, supplierId: BRIGHT }))
        .statusCode,
    ).toBe(409);
    await withSystem(database, (tx) =>
      tx.update(s.evaluation).set({ status: 'APPROVED' }).where(eq(s.evaluation.id, a.evaluationId)),
    );
    const lost = await call('legal', 'POST', '/contracts', {
      evaluationId: a.evaluationId,
      supplierId: EVERGREEN,
    });
    expect(lost.statusCode).toBe(422);
    expect(lost.json().code).toBe('SUPPLIER_NOT_RECOMMENDED');
    const outsider = await call('legal', 'POST', '/contracts', {
      evaluationId: a.evaluationId,
      supplierId: uid('supplier:northstar'),
    });
    expect(outsider.statusCode).toBe(422);
    for (const who of ['requester', 'evaluator-tech', 'chair', 'supplier', 'admin', 'delegate', 'finance'])
      expect(
        (await call(who, 'POST', '/contracts', { evaluationId: a.evaluationId, supplierId: BRIGHT }))
          .statusCode,
        who,
      ).toBe(403);
    expect(
      (await call('procurement', 'POST', '/contracts', { evaluationId: a.evaluationId, supplierId: BRIGHT }))
        .statusCode,
    ).toBe(201);
    const dup = await call('legal', 'POST', '/contracts', {
      evaluationId: a.evaluationId,
      supplierId: BRIGHT,
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('CONTRACT_EXISTS');
    const none = await award({ value: null });
    const nv = await call('legal', 'POST', '/contracts', {
      evaluationId: none.evaluationId,
      supplierId: BRIGHT,
    });
    expect(nv.statusCode).toBe(422);
    expect(nv.json().code).toBe('VALUE_REQUIRED');
    expect(
      (
        await call('legal', 'POST', '/contracts', {
          evaluationId: none.evaluationId,
          supplierId: BRIGHT,
          value: 50_000,
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await call('legal', 'POST', '/contracts', {
          evaluationId: '00000000-0000-4000-8000-000000000000',
          supplierId: BRIGHT,
        })
      ).statusCode,
    ).toBe(404);
    expect((await call('legal', 'POST', '/contracts', { evaluationId: a.evaluationId })).statusCode).toBe(
      400,
    );
  });

  it('lists the awards waiting for a contract, and who each report recommends', async () => {
    const a = await award();
    const r = await call('legal', 'GET', '/contracts/awards');
    expect(r.statusCode).toBe(200);
    const mine = (
      r.json() as Array<{
        evaluationId: string;
        contractId: string | null;
        recommended: Array<{ company: string; score: number }>;
      }>
    ).find((x) => x.evaluationId === a.evaluationId);
    expect(mine?.contractId).toBeNull();
    expect(mine?.recommended).toEqual([
      { supplierId: BRIGHT, company: 'Brightwave Cleaning Pty Ltd', score: 80 },
    ]);
    expect((await call('requester', 'GET', '/contracts/awards')).statusCode).toBe(403);
  });

  it('terms can be changed while drafting; unedited clauses follow, edited clauses keep legal wording', async () => {
    const d = await draft({ value: 100_000 });
    await call('legal', 'PUT', `/contracts/${d.c.id}/clauses/IP`, {
      text: 'Legal wording for IP that is long enough.',
    });
    const r = await call('procurement', 'PATCH', `/contracts/${d.c.id}`, { value: 150_000, noticeDays: 60 });
    expect(r.statusCode, r.body).toBe(200);
    const c = r.json() as Contract;
    expect(c.value).toBe(150_000);
    expect(c.clauses.find((x) => x.id === 'PRICE')!.text).toContain('$150,000');
    expect(c.clauses.find((x) => x.id === 'IP')!.text).toBe('Legal wording for IP that is long enough.');
    expect(
      (await call('procurement', 'PATCH', `/contracts/${d.c.id}`, { endDate: '2000-01-01' })).statusCode,
    ).toBe(400);
    expect((await call('procurement', 'PATCH', `/contracts/${d.c.id}`, {})).statusCode).toBe(400);
    expect((await call('requester', 'PATCH', `/contracts/${d.c.id}`, { value: 1 })).statusCode).toBe(403);
  });
});

describe('legal edit with change tracking', () => {
  it('marks a changed clause, builds a deviation register, un-marks it when restored, and protects mandatory clauses', async () => {
    const d = await draft();
    const original = d.c.clauses.find((c) => c.id === 'LIABILITY')!.text;
    const r = await call('legal', 'PUT', `/contracts/${d.c.id}/clauses/LIABILITY`, {
      text: `${original} Cap: 2x fees.`,
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().changedFromTemplate).toBe(true);
    const c = await get('legal', d.c.id);
    expect(c.status).toBe('LEGAL_REVIEW');
    expect(c.deviations).toHaveLength(1);
    expect(c.deviations[0]).toMatchObject({ clauseId: 'LIABILITY', templateText: original });
    expect(c.deviations[0]!.currentText).toContain('Cap: 2x fees');
    const back = await call('legal', 'PUT', `/contracts/${d.c.id}/clauses/LIABILITY`, { text: original });
    expect(back.json().changedFromTemplate).toBe(false);
    expect((await get('legal', d.c.id)).deviations).toHaveLength(0);
    const empty = await call('legal', 'PUT', `/contracts/${d.c.id}/clauses/TERM`, { text: 'short' });
    expect(empty.statusCode).toBe(422);
    expect(empty.json().code).toBe('MANDATORY_CLAUSE');
    expect(
      (await call('legal', 'PUT', `/contracts/${d.c.id}/clauses/NOPE`, { text: 'Some wording here.' }))
        .statusCode,
    ).toBe(404);
    for (const who of ['procurement', 'delegate', 'requester', 'contract-mgr'])
      expect(
        (await call(who, 'PUT', `/contracts/${d.c.id}/clauses/IP`, { text: 'Not allowed to do this.' }))
          .statusCode,
        who,
      ).toBe(403);
    const audit = await withSystem(database, (tx) =>
      tx
        .select()
        .from(s.auditEvent)
        .where(and(eq(s.auditEvent.entityId, d.c.id), eq(s.auditEvent.action, 'contract.clause_edit'))),
    );
    expect(audit.length).toBe(2);
  });
});

describe('US-CON-03 release and sign under separate signing authority', () => {
  it('procurement cannot release a draft legal has not reviewed; release needs mandatory clauses, then the delegate signs with a stamp and the contract is executed and locked', async () => {
    const d = await draft({ value: 120_000 });
    const early = await call('procurement', 'POST', `/contracts/${d.c.id}/release-for-signing`);
    expect(early.statusCode).toBe(409);
    expect(
      (await call('delegate', 'POST', `/contracts/${d.c.id}/sign`, { decision: 'APPROVE' })).statusCode,
    ).toBe(409);

    await call('legal', 'PUT', `/contracts/${d.c.id}/clauses/IP`, { text: 'Legal reviewed wording for IP.' });
    // an unfilled placeholder blocks release
    await withSystem(database, (tx) =>
      tx
        .update(s.clause)
        .set({ text: 'Owned by {{SUPPLIER}} entirely' })
        .where(and(eq(s.clause.contractId, d.c.id), eq(s.clause.clauseId, 'SLA'))),
    );
    const blocked = await call('legal', 'POST', `/contracts/${d.c.id}/release-for-signing`);
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json().code).toBe('RELEASE_BLOCKED');
    await call('legal', 'PUT', `/contracts/${d.c.id}/clauses/SLA`, {
      text: 'Service levels agreed with the supplier.',
    });

    const rel = await call('procurement', 'POST', `/contracts/${d.c.id}/release-for-signing`);
    expect(rel.statusCode, rel.body).toBe(200);
    expect(rel.json().status).toBe('AWAITING_SIGNATURE');
    // edits stop once released
    expect(
      (await call('legal', 'PUT', `/contracts/${d.c.id}/clauses/IP`, { text: 'Changed after release.....' }))
        .statusCode,
    ).toBe(409);

    const before = await get('delegate', d.c.id);
    expect(before.permissions.canSign).toBe(true);
    const signed = await call('delegate', 'POST', `/contracts/${d.c.id}/sign`, { decision: 'APPROVE' });
    expect(signed.statusCode, signed.body).toBe(200);
    const c = signed.json() as Contract;
    expect(c.status).toBe('EXECUTED');
    expect(c.locked).toBe(true);
    expect(c.signatures).toHaveLength(1);
    expect(c.signatures[0]!.stamp).toMatch(
      /^SIGNED · Dana Okafor · DELEGATE · \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC · SES · hash [0-9a-f]{12}$/,
    );
    const alerts = await withSystem(database, (tx) =>
      tx.select().from(s.alert).where(eq(s.alert.contractId, d.c.id)),
    );
    expect(alerts.map((x) => x.kind)).toEqual(expect.arrayContaining(['EXPIRY', 'NOTICE']));
    expect(
      (await call('delegate', 'POST', `/contracts/${d.c.id}/sign`, { decision: 'APPROVE' })).statusCode,
    ).toBe(423);
  });

  it('SIGNING_AUTHORITY_INSUFFICIENT: sourcing approval does not confer signing authority; nor does a signing limit below the value', async () => {
    const d = await released({ value: 300_000 });
    const sourcer = await extraUser('sourcer', 'DELEGATE', [
      { scope: 'SOURCING_APPROVAL', max: '5000000.00' },
    ]);
    const r = await call(sourcer.email, 'POST', `/contracts/${d.c.id}/sign`, { decision: 'APPROVE' });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe('SIGNING_AUTHORITY_INSUFFICIENT');
    expect(r.json().title).toMatch(/signing authority|Sourcing approval/i);
    const view = await get(sourcer.email, d.c.id);
    expect(view.permissions.canSign).toBe(false);
    expect(view.permissions.signBlocked).toMatch(/Sourcing approval does not confer/);
    const small = await extraUser('small-signer', 'DELEGATE', [
      { scope: 'CONTRACT_SIGNING', max: '100000.00' },
    ]);
    const r2 = await call(small.email, 'POST', `/contracts/${d.c.id}/sign`, { decision: 'APPROVE' });
    expect(r2.statusCode).toBe(403);
    expect(r2.json().code).toBe('SIGNING_AUTHORITY_INSUFFICIENT');
    expect(r2.json().title).toContain('$100,000');
    const denied = await withSystem(database, (tx) =>
      tx
        .select()
        .from(s.auditEvent)
        .where(and(eq(s.auditEvent.entityId, d.c.id), eq(s.auditEvent.action, 'contract.sign'))),
    );
    expect(denied.filter((e) => e.result === 'DENIED').length).toBe(2);
    expect((await get('legal', d.c.id)).status).toBe('AWAITING_SIGNATURE');
    // roles outside the chain
    for (const who of ['legal', 'procurement', 'requester', 'contract-mgr'])
      expect(
        (await call(who, 'POST', `/contracts/${d.c.id}/sign`, { decision: 'APPROVE' })).statusCode,
        who,
      ).toBe(403);
  });

  it('above 1M the executive must also sign: partially signed, then executed; nobody signs twice', async () => {
    const d = await released({ value: 2_000_000 });
    // the executive holds no signing authority unless one is delegated explicitly
    const exec = await extraUser('exec-signer', 'EXEC', [{ scope: 'CONTRACT_SIGNING', max: '20000000.00' }]);
    expect(
      (await call('exec', 'POST', `/contracts/${d.c.id}/sign`, { decision: 'APPROVE' })).json().code,
    ).toBe('SIGNING_AUTHORITY_INSUFFICIENT');
    expect((await get('legal', d.c.id)).chain.map((s) => s.role)).toEqual(['DELEGATE', 'EXEC']);
    const first = await call('delegate', 'POST', `/contracts/${d.c.id}/sign`, { decision: 'APPROVE' });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().status).toBe('PARTIALLY_SIGNED');
    expect(first.json().locked).toBe(false);
    const again = await call('delegate', 'POST', `/contracts/${d.c.id}/sign`, { decision: 'APPROVE' });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('ALREADY_SIGNED');
    const last = await call(exec.email, 'POST', `/contracts/${d.c.id}/sign`, { decision: 'APPROVE' });
    expect(last.statusCode, last.body).toBe(200);
    expect(last.json().status).toBe('EXECUTED');
    expect(last.json().locked).toBe(true);
    expect(last.json().signatures.map((x: { role: string }) => x.role)).toEqual(['DELEGATE', 'EXEC']);
  });

  it('a signatory can return the contract to legal with a reason; signatures are withdrawn and the contract is signed again after a fix', async () => {
    const d = await released({ value: 2_000_000 });
    const exec = await extraUser('exec-signer', 'EXEC', [{ scope: 'CONTRACT_SIGNING', max: '20000000.00' }]);
    await call('delegate', 'POST', `/contracts/${d.c.id}/sign`, { decision: 'APPROVE' });
    expect((await call('exec', 'POST', `/contracts/${d.c.id}/sign`, { decision: 'REJECT' })).statusCode).toBe(
      400,
    );
    const r = await call('exec', 'POST', `/contracts/${d.c.id}/sign`, {
      decision: 'REJECT',
      comment: 'Liability cap is too low',
    });
    expect(r.statusCode, r.body).toBe(200);
    const c = r.json() as Contract;
    expect(c.status).toBe('LEGAL_REVIEW');
    expect(c.chain.every((x) => x.signedBy === null)).toBe(true);
    expect(c.permissions.canEdit).toBe(false); // exec cannot edit
    expect((await get('legal', d.c.id)).permissions.canEdit).toBe(true);
    await call('legal', 'PUT', `/contracts/${d.c.id}/clauses/LIABILITY`, {
      text: 'Higher cap of 5x annual fees applies.',
    });
    // a change to a mandatory clause needs a delegate's approval before release
    expect(
      (
        await call('delegate', 'POST', `/contracts/${d.c.id}/deviations/LIABILITY/decision`, {
          decision: 'APPROVE',
        })
      ).statusCode,
    ).toBe(200);
    await call('legal', 'POST', `/contracts/${d.c.id}/release-for-signing`);
    await call('delegate', 'POST', `/contracts/${d.c.id}/sign`, { decision: 'APPROVE' });
    const done = await call(exec.email, 'POST', `/contracts/${d.c.id}/sign`, { decision: 'APPROVE' });
    expect(done.json().status).toBe('EXECUTED');
    const rows = await withSystem(database, (tx) =>
      tx
        .select()
        .from(s.approval)
        .where(and(eq(s.approval.subjectId, d.c.id), eq(s.approval.subjectType, 'CONTRACT'))),
    );
    expect(rows.map((x) => x.decision).sort()).toEqual(['APPROVED', 'APPROVED', 'REJECTED', 'SUPERSEDED']);
  });
});

describe('US-CON-04 lock on execution', () => {
  it('423 on edit after execution, also at the database; the deviation register stays readable', async () => {
    const d = await released({ value: 80_000 });
    await call('delegate', 'POST', `/contracts/${d.c.id}/sign`, { decision: 'APPROVE' });
    const edit = await call('legal', 'PUT', `/contracts/${d.c.id}/clauses/IP`, {
      text: 'Edited after execution...',
    });
    expect(edit.statusCode).toBe(423);
    expect(edit.json().code).toBe('CONTRACT_LOCKED');
    expect((await call('procurement', 'PATCH', `/contracts/${d.c.id}`, { value: 1 })).statusCode).toBe(423);
    expect((await call('legal', 'POST', `/contracts/${d.c.id}/release-for-signing`)).statusCode).toBe(423);
    // the database refuses even a privileged direct change
    await expect(
      withSystem(database, (tx) =>
        tx.update(s.clause).set({ text: 'tampered' }).where(eq(s.clause.contractId, d.c.id)),
      ),
    ).rejects.toThrow();
    await expect(
      withSystem(database, (tx) =>
        tx.update(s.contract).set({ value: '1.00' }).where(eq(s.contract.id, d.c.id)),
      ),
    ).rejects.toThrow();
    await expect(
      withSystem(database, (tx) => tx.delete(s.clause).where(eq(s.clause.contractId, d.c.id))),
    ).rejects.toThrow();
    const c = await get('contract-mgr', d.c.id);
    expect(c.value).toBe(80_000);
    expect(c.deviations).toHaveLength(1);
  });

  it('logical delete only: limited to legal and the executive, needs a reason, hides the contract and is audited; the row stays', async () => {
    const d = await released({ value: 80_000 });
    await call('delegate', 'POST', `/contracts/${d.c.id}/sign`, { decision: 'APPROVE' });
    for (const who of ['procurement', 'delegate', 'contract-mgr', 'admin'])
      expect(
        (await call(who, 'DELETE', `/contracts/${d.c.id}`, { reason: 'No longer needed here' })).statusCode,
        who,
      ).toBe(403);
    expect((await call('legal', 'DELETE', `/contracts/${d.c.id}`, { reason: 'short' })).statusCode).toBe(400);
    const del = await call('legal', 'DELETE', `/contracts/${d.c.id}`, {
      reason: 'Raised against the wrong supplier',
    });
    expect(del.statusCode).toBe(204);
    expect((await call('legal', 'GET', `/contracts/${d.c.id}`)).statusCode).toBe(404);
    const list = (await call('legal', 'GET', '/contracts')).json() as Array<{ id: string }>;
    expect(list.some((x) => x.id === d.c.id)).toBe(false);
    const [row] = await withSystem(database, (tx) =>
      tx.select().from(s.contract).where(eq(s.contract.id, d.c.id)),
    );
    expect(row?.deletedAt).not.toBeNull();
    expect(row?.locked).toBe(true);
    const audit = await withSystem(database, (tx) =>
      tx
        .select()
        .from(s.auditEvent)
        .where(and(eq(s.auditEvent.entityId, d.c.id), eq(s.auditEvent.action, 'contract.delete'))),
    );
    expect(audit).toHaveLength(1);
    // a new contract can be drafted for the tender again
    const again = await call('legal', 'POST', '/contracts', {
      evaluationId: d.evaluationId,
      supplierId: BRIGHT,
    });
    expect(again.statusCode).toBe(201);
  });
});

describe('lists, visibility and the seeded contracts', () => {
  it('lists and filters for the roles that may read; others are refused', async () => {
    const d = await draft({ value: 77_000 });
    const all = (await call('contract-mgr', 'GET', '/contracts')).json() as Array<{
      id: string;
      number: string;
      status: string;
      supplierName: string;
    }>;
    expect(all.some((x) => x.id === d.c.id && x.supplierName === 'Brightwave Cleaning Pty Ltd')).toBe(true);
    const drafts = (await call('legal', 'GET', '/contracts?status=DRAFT')).json() as Array<{
      status: string;
    }>;
    expect(drafts.length).toBeGreaterThan(0);
    expect(drafts.every((x) => x.status === 'DRAFT')).toBe(true);
    const found = (await call('legal', 'GET', `/contracts?q=${d.c.number}`)).json() as Array<{ id: string }>;
    expect(found.map((x) => x.id)).toEqual([d.c.id]);
    for (const who of ['procurement', 'legal', 'delegate', 'exec', 'finance', 'probity', 'contract-mgr'])
      expect((await call(who, 'GET', '/contracts')).statusCode, who).toBe(200);
    for (const who of ['requester', 'evaluator-tech', 'chair', 'supplier', 'admin'])
      expect((await call(who, 'GET', '/contracts')).statusCode, who).toBe(403);
    expect((await call('legal', 'GET', '/contracts/00000000-0000-4000-8000-000000000000')).statusCode).toBe(
      404,
    );
  });

  it('the seeded executed contracts are locked, signed and cannot be edited', async () => {
    const list = (await call('legal', 'GET', '/contracts')).json() as Array<{
      id: string;
      number: string;
      locked: boolean;
      signed: number;
    }>;
    const seeded = list.filter((x) => x.number === 'CT-2026-0001' || x.number === 'CT-2026-0002');
    expect(seeded).toHaveLength(2);
    expect(seeded.every((x) => x.locked && x.signed === 1)).toBe(true);
    const c = await get('legal', seeded[0]!.id);
    expect(c.signatures[0]!.stamp).toContain('Dana Okafor');
    expect(
      (await call('legal', 'PUT', `/contracts/${c.id}/clauses/IP`, { text: 'Cannot change this now.' }))
        .statusCode,
    ).toBe(423);
  });
});
