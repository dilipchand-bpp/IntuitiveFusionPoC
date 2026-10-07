import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash as argon2Hash } from '@node-rs/argon2';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { redact } from '../../audit/audit-service.js';
import * as s from '../../db/schema.js';
import { TENANT_ID, emailFor, uid } from '../../db/seed.js';
import { PASSWORD, createEnv, type Json } from '../contract/test-env.js';
import { findDuplicates } from '../b8/rules.js';
import { bankFingerprint, maskBank } from './bank.js';
import { actionFor } from './policy-routes.js';

let env: Awaited<ReturnType<typeof createEnv>>;
const call = (...a: Parameters<typeof env.call>) => env.call(...a);
const sys = <T>(fn: Parameters<typeof env.withSystem>[1]) => env.withSystem(env.database, fn) as Promise<T>;
const NOW = '2026-10-02T00:00:00.000Z';
let reqs: Array<{ id: string; unit: string | null; requester: string; number: string }> = [];
beforeAll(async () => {
  env = await createEnv();
  reqs = (await sys<Array<typeof s.request.$inferSelect>>((tx) => tx.select().from(s.request))).map((r) => ({
    id: r.id,
    unit: r.businessUnit,
    requester: r.requesterId,
    number: r.number,
  }));
}, 120_000);

const policy = async (body: Json) => {
  const r = await call('admin', 'POST', '/access/policies', {
    selector: {},
    conditions: {},
    reason: 'Test policy for the access rules',
    ...body,
  });
  expect(r.statusCode, r.body).toBe(201);
  return r.json() as Json;
};
const listIds = async (who: string) => {
  const r = await call(who, 'GET', '/reports/procurements');
  expect(r.statusCode, r.body).toBe(200);
  return ((r.json() as Json).items as Json[]).map((x) => x.id as string);
};
const events = (action: string) =>
  sys<Json[]>((tx) => tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, action)));

describe('SEC-AC09 access policies override the default hierarchy', () => {
  let tagged: string;
  let other: string;
  beforeAll(async () => {
    tagged = reqs.find((r) => r.unit === 'Facilities')!.id;
    other = reqs.find((r) => r.id !== tagged && r.unit === 'IT')!.id;
  });

  it('pure: which action a route is, and policies are administrator-made but readable by probity and executives', async () => {
    expect(actionFor('GET', '/api/v1/requests/:id')).toBe('view');
    expect(actionFor('POST', '/api/v1/plans/:id/submit-for-approval')).toBe('approve');
    expect(actionFor('PUT', '/api/v1/plans/:id/fields/:key')).toBe('edit');
    expect(actionFor('GET', '/api/v1/contracts/:id/export.${format}')).toBe('export');
    for (const who of ['probity', 'exec', 'admin'])
      expect((await call(who, 'GET', '/access/policies')).statusCode).toBe(200);
    for (const who of ['procurement', 'requester', 'finance'])
      expect((await call(who, 'GET', '/access/policies')).statusCode).toBe(403);
    const base = {
      name: 'Deny',
      effect: 'DENY',
      subjectType: 'ROLE',
      subject: 'EXEC',
      action: 'view',
      reason: 'Because of a test',
    };
    for (const who of ['probity', 'exec', 'procurement'])
      expect((await call(who, 'POST', '/access/policies', base)).statusCode, who).toBe(403);
    expect(
      (await call('admin', 'POST', '/access/policies', { ...base, subject: 'NOT_A_ROLE' })).statusCode,
    ).toBe(400);
    expect((await call('admin', 'POST', '/access/policies', { ...base, reason: 'no' })).statusCode).toBe(400);
    expect(
      (
        await call('admin', 'POST', '/access/policies', {
          ...base,
          subjectType: 'USER',
          subject: uid('nobody'),
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await call('admin', 'POST', '/access/policies', { ...base, expiresAt: '2020-01-01T00:00:00Z' }))
        .statusCode,
    ).toBe(400);
  });

  it('an explicit DENY wins over the role rules: executives lose sight of a tagged procurement, everyone else keeps it', async () => {
    expect(await listIds('exec')).toContain(tagged);
    const t = await call('admin', 'POST', '/access/tags', { requestId: tagged, tag: 'hr-sensitive' });
    expect(t.statusCode, t.body).toBe(201);
    expect(
      (await call('procurement', 'POST', '/access/tags', { requestId: tagged, tag: 'x-tag' })).statusCode,
    ).toBe(403);
    const p = await policy({
      name: 'No executive access to HR-sensitive procurements',
      effect: 'DENY',
      subjectType: 'ROLE',
      subject: 'EXEC',
      action: 'view',
      selector: { tag: 'hr-sensitive' },
      reason: 'HR matters are restricted to the people running them',
    });
    expect(await listIds('exec')).not.toContain(tagged);
    expect(await listIds('exec')).toContain(other);
    expect(await listIds('procurement')).toContain(tagged);
    // the per-record route says so too (policy guard), and the decision is audited
    const direct = await call('exec', 'GET', `/requests/${tagged}`);
    expect(direct.statusCode).toBe(403);
    expect(direct.json().code).toBe('POLICY_DENIED');
    expect((await call('exec', 'GET', `/requests/${other}`)).statusCode).toBe(200);
    expect((await call('procurement', 'GET', `/requests/${tagged}`)).statusCode).toBe(200);
    const denies = await events('policy.deny');
    expect(
      denies.some(
        (e) => (e.after as Json).policyId === p.id && e.entityId === tagged && e.result === 'DENIED',
      ),
    ).toBe(true);
    // a grant to the same person does not beat the denial
    await policy({
      name: 'Grant exec',
      effect: 'ALLOW',
      subjectType: 'USER',
      subject: uid('user:exec'),
      action: 'view',
      selector: { tag: 'hr-sensitive' },
    });
    expect(await listIds('exec')).not.toContain(tagged);
    // the tag and policy are administrative changes in the audit trail
    expect((await events('policy.create'))[0]!.actorRole).toBe('ADMIN');
    expect((await events('config.access_tag_add')).length).toBe(1);
  });

  it('the simulator says what a person can see, and which policy decided', async () => {
    const r = await call('probity', 'POST', '/access/policies/simulate', {
      userId: uid('user:exec'),
      requestId: tagged,
      action: 'view',
    });
    expect(r.statusCode, r.body).toBe(200);
    const j = r.json() as Json;
    expect(j).toMatchObject({ decision: 'DENY', decidedBy: 'DENY_OVERRIDE', defaultAllowed: true });
    expect(j.policy.name).toMatch(/HR-sensitive/);
    expect(j.evaluated.length).toBeGreaterThanOrEqual(2);
    expect(j.procurement.tags).toContain('hr-sensitive');
    const ok = (
      await call('probity', 'POST', '/access/policies/simulate', {
        userId: uid('user:exec'),
        requestId: other,
        action: 'view',
      })
    ).json() as Json;
    expect(ok).toMatchObject({ decision: 'ALLOW', decidedBy: 'DEFAULT', policy: null });
    expect(
      (
        await call('requester', 'POST', '/access/policies/simulate', {
          userId: uid('user:exec'),
          requestId: other,
          action: 'view',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call('probity', 'POST', '/access/policies/simulate', {
          userId: uid('nobody'),
          requestId: other,
          action: 'view',
        })
      ).statusCode,
    ).toBe(404);
  });

  it('an ALLOW grants a named person visibility beyond their scope, with an expiry that ends it', async () => {
    // every seeded procurement is Riley's, so another person's procurement is made for this test
    const stranger = await env.extraUser('stranger', 'REQUESTER');
    const [made] = await sys<Array<{ id: string }>>((tx) =>
      tx
        .insert(s.request)
        .values({
          tenantId: TENANT_ID,
          number: 'PR-AC09-0001',
          title: 'Legal panel review',
          businessUnit: 'Legal',
          requesterId: stranger.id,
          estimatedValue: '90000',
        })
        .returning({ id: s.request.id }),
    );
    reqs.push({ id: made!.id, unit: 'Legal', requester: stranger.id, number: 'PR-AC09-0001' });
    const foreign = reqs.at(-1)!;
    const itRequest = foreign.id;
    expect(await listIds('requester')).not.toContain(itRequest);
    const p = await policy({
      name: `Riley may view ${foreign.unit} procurements`,
      effect: 'ALLOW',
      subjectType: 'USER',
      subject: uid('user:requester'),
      action: 'view',
      selector: { businessUnit: foreign.unit },
      reason: 'Riley covers for the IT category manager',
      expiresAt: new Date(env.clock.now().getTime() + 3_600_000).toISOString(),
    });
    const seen = await listIds('requester');
    expect(seen).toContain(itRequest);
    expect(
      seen.filter(
        (id) =>
          reqs.find((r) => r.id === id)!.requester !== uid('user:requester') &&
          reqs.find((r) => r.id === id)!.unit !== foreign.unit,
      ),
    ).toEqual([]);
    const allows = await events('policy.allow');
    expect(allows.some((e) => (e.after as Json).policyId === p.id && e.entityId === itRequest)).toBe(true);
    const sim = (
      await call('exec', 'POST', '/access/policies/simulate', {
        userId: uid('user:requester'),
        requestId: itRequest,
        action: 'view',
      })
    ).json() as Json;
    expect(sim).toMatchObject({ decision: 'ALLOW', decidedBy: 'ALLOW_GRANT', defaultAllowed: false });
    expect(sim.policy.id).toBe(p.id);
    // documented limit: a grant widens the lists built from the role rules, not each record's own route
    expect((await call('requester', 'GET', `/requests/${itRequest}`)).statusCode).not.toBe(200);
    // after the expiry the grant no longer applies
    env.clock.advanceMs(2 * 3_600_000);
    expect(await listIds('requester')).not.toContain(itRequest);
    const expired = (await call('admin', 'GET', '/access/policies?includeInactive=true')).json() as Json;
    expect(expired.items.find((x: Json) => x.id === p.id).status).toBe('EXPIRED');
    env.clock.set(NOW);
  });

  it('a denial on export applies to the export routes; conditions (time window, MFA) decide when a policy is in force', async () => {
    expect((await call('admin', 'GET', '/audit-events/export')).statusCode).toBe(200);
    // outside its window the policy does nothing (11:00 in Sydney; the window is 0 to 6)
    const quiet = await policy({
      name: 'Night-time export ban',
      effect: 'DENY',
      subjectType: 'ROLE',
      subject: 'ADMIN',
      action: 'export',
      conditions: { timeWindow: { startHour: 0, endHour: 6 } },
    });
    expect((await call('admin', 'GET', '/audit-events/export')).statusCode).toBe(200);
    await call('admin', 'POST', `/access/policies/${quiet.id}/disable`, { reason: 'Window test finished' });
    const day = await policy({
      name: 'Daytime export ban',
      effect: 'DENY',
      subjectType: 'ROLE',
      subject: 'ADMIN',
      action: 'export',
      conditions: { timeWindow: { startHour: 9, endHour: 17 } },
    });
    const denied = await call('admin', 'GET', '/audit-events/export');
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe('POLICY_DENIED');
    expect((await call('probity', 'GET', '/audit-events/export')).statusCode).toBe(200);
    await call('admin', 'POST', `/access/policies/${day.id}/disable`, { reason: 'Window test finished' });
    const mfa = await policy({
      name: 'Exports need MFA',
      effect: 'DENY',
      subjectType: 'ROLE',
      subject: 'ADMIN',
      action: 'export',
      conditions: { requiresMfa: true },
    });
    expect((await call('admin', 'GET', '/audit-events/export')).statusCode).toBe(403); // this session was not verified with MFA
    const sim = (
      await call('probity', 'POST', '/access/policies/simulate', {
        userId: uid('user:admin'),
        requestId: other,
        action: 'export',
        mfaVerified: true,
      })
    ).json() as Json;
    expect(sim.decision).toBe('ALLOW');
    await call('admin', 'POST', `/access/policies/${mfa.id}/disable`, { reason: 'MFA test finished' });
    expect((await call('admin', 'GET', '/audit-events/export')).statusCode).toBe(200);
  });

  it('disabling and deleting need a reason and are audited; a value selector matches only above the amount', async () => {
    const p = await policy({
      name: 'Large procurements: no edits by procurement',
      effect: 'DENY',
      subjectType: 'ROLE',
      subject: 'PROCUREMENT',
      action: 'edit',
      selector: { minValue: 10_000_000_000 },
    });
    const sim = (
      await call('exec', 'POST', '/access/policies/simulate', {
        userId: uid('user:procurement'),
        requestId: other,
        action: 'edit',
      })
    ).json() as Json;
    expect(sim.decision).toBe('ALLOW');
    expect(sim.evaluated.find((x: Json) => x.id === p.id).why).toMatch(/not above/);
    expect(
      (await call('admin', 'POST', `/access/policies/${p.id}/disable`, { reason: 'no' })).statusCode,
    ).toBe(400);
    expect(
      (
        await call('admin', 'POST', `/access/policies/${p.id}/disable`, {
          reason: 'Superseded by a tighter rule',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await call('admin', 'POST', `/access/policies/${p.id}/disable`, {
          reason: 'Superseded by a tighter rule',
        })
      ).statusCode,
    ).toBe(409);
    const del = await call('admin', 'DELETE', `/access/policies/${p.id}`, {
      reason: 'Removed during the review',
    });
    expect(del.statusCode, del.body).toBe(200);
    expect(del.json()).toMatchObject({ status: 'DELETED', deletedReason: 'Removed during the review' });
    expect(
      (await call('probity', 'DELETE', `/access/policies/${p.id}`, { reason: 'Not allowed to do this' }))
        .statusCode,
    ).toBe(403);
    const trail = await sys<Json[]>((tx) => tx.select().from(s.auditEvent));
    for (const a of ['policy.disable', 'policy.delete'])
      expect(trail.find((e) => e.action === a && e.entityId === p.id)).toBeTruthy();
    const cat = await sys<Array<{ category: string }>>(async (tx) => {
      const r = await tx.execute(
        (await import('drizzle-orm'))
          .sql`select category from audit_event where action = 'policy.deny' limit 1`,
      );
      return (r as unknown as { rows: Array<{ category: string }> }).rows;
    });
    expect(cat[0]!.category).toBe('GENERAL'); // a decision is not an administrative action; creating a policy is
    // tidy up: the tag policy off, so later tests see the default hierarchy
    const all = (await call('admin', 'GET', '/access/policies')).json() as Json;
    for (const x of all.items)
      await call('admin', 'POST', `/access/policies/${x.id}/disable`, { reason: 'End of the policy tests' });
    expect(await listIds('exec')).toContain(tagged);
  });
});

// ------------------------------------------------------------------------------------------------------------------
describe('SEC-AC10 bank details are visible to finance only', () => {
  const BRIGHTWAVE = uid('supplier:brightwave');
  const EVERGREEN = uid('supplier:evergreen');
  const numbers = { bsb: '062-000', account: '12345678', accountName: 'Brightwave Cleaning Pty Ltd' };
  const hasRaw = (v: unknown) => /062-?000|12345678/.test(JSON.stringify(v));

  it('pure: maskBank shows the numbers to finance (or the supplier itself) and the last three digits to everyone else', () => {
    const b = { bsb: '062-000', account: '12345678', accountName: 'X' };
    expect(maskBank('FINANCE', b)).toMatchObject({ bsb: '062-000', account: '12345678', masked: false });
    expect(maskBank(['PROCUREMENT', 'FINANCE'], b)!.masked).toBe(false);
    expect(maskBank('SUPPLIER', b, { self: true })!.masked).toBe(false);
    for (const role of ['ADMIN', 'PROCUREMENT', 'EXEC', 'LEGAL', 'PROBITY', 'DELEGATE'])
      expect(maskBank(role, b), role).toMatchObject({ bsb: 'XXX-XXX', account: '*****678', masked: true });
    expect(maskBank('ADMIN', null)).toBeNull();
    expect(bankFingerprint({ bsb: '062-000', account: '12345678' })).toBe(
      bankFingerprint({ bsb: '062000', account: '12 345 678' }),
    );
    expect(bankFingerprint({ bsb: '062-000', account: '12345678' })).not.toContain('12345678');
    expect(JSON.stringify(redact({ bsb: '062000', account: '12345678', accountName: 'Keep me' }))).toBe(
      '{"bsb":"[REDACTED]","account":"[REDACTED]","accountName":"Keep me"}',
    );
  });

  it('a supplier records its details: in force at once, flagged for finance to confirm; only the supplier and finance see the numbers', async () => {
    const put = await call('supplier', 'PUT', '/supplier/profile/bank', numbers);
    expect(put.statusCode, put.body).toBe(200);
    expect(put.json()).toMatchObject({ account: '*****678', status: 'IN_FORCE_UNCONFIRMED' });
    const own = (await call('supplier', 'GET', '/supplier/profile/bank')).json() as Json;
    expect(own).toMatchObject({ status: 'UNCONFIRMED', bank: { account: '12345678', masked: false } });
    const reads0 = (await events('supplier.bank_read')).length;
    const fin = (await call('finance', 'GET', `/suppliers/${BRIGHTWAVE}/bank`)).json() as Json;
    expect(fin.bank).toMatchObject({ bsb: '062-000', account: '12345678', masked: false });
    expect((await events('supplier.bank_read')).length).toBe(reads0 + 1); // every unmasked read by finance is audited
    for (const who of ['admin', 'procurement', 'exec', 'legal', 'probity', 'delegate', 'contract-mgr']) {
      const r = await call(who, 'GET', `/suppliers/${BRIGHTWAVE}/bank`);
      expect(r.statusCode, who).toBe(200);
      expect(r.json().bank, who).toMatchObject({ bsb: 'XXX-XXX', account: '*****678', masked: true });
      expect(hasRaw(r.json()), who).toBe(false);
    }
    expect((await events('supplier.bank_read')).length).toBe(reads0 + 1); // masked reads are not "unmasked reads"
    for (const who of ['requester', 'supplier', 'evaluator-tech'])
      expect((await call(who, 'GET', `/suppliers/${BRIGHTWAVE}/bank`)).statusCode, who).toBe(403);
    expect(JSON.stringify(await events('supplier.bank_read'))).not.toMatch(/12345678|062-?000/);
  });

  it('a change to details in force is held PENDING until a finance person confirms; the old details stay in force', async () => {
    const [open] = ((await call('finance', 'GET', '/bank-changes')).json() as Json).items as Json[];
    expect(open).toMatchObject({ status: 'UNCONFIRMED', canConfirm: true });
    expect((await call('procurement', 'POST', `/bank-changes/${open!.id}/confirm`, {})).statusCode).toBe(403);
    expect((await call('admin', 'POST', `/bank-changes/${open!.id}/confirm`, {})).statusCode).toBe(403);
    expect(
      (
        await call('finance', 'POST', `/bank-changes/${open!.id}/confirm`, { note: 'Matches the invoice' })
      ).json(),
    ).toMatchObject({ status: 'CONFIRMED' });

    const next = await call('supplier', 'PUT', '/supplier/profile/bank', {
      bsb: '082-001',
      account: '99887766',
      accountName: 'Brightwave Cleaning Pty Ltd',
    });
    expect(next.json()).toMatchObject({ status: 'PENDING_FINANCE', account: '*****766' });
    const still = (await call('finance', 'GET', `/suppliers/${BRIGHTWAVE}/bank`)).json() as Json;
    expect(still.bank.account).toBe('12345678'); // the old details are still in force
    expect(still.change).toMatchObject({
      status: 'PENDING',
      newBank: { account: '99887766', masked: false },
    });
    const masked = (await call('exec', 'GET', `/suppliers/${BRIGHTWAVE}/bank`)).json() as Json;
    expect(masked.change.newBank).toMatchObject({ account: '*****766', masked: true });
    expect(JSON.stringify(masked)).not.toMatch(/99887766|082-?001/);
    expect((await call('supplier', 'GET', '/supplier/profile/bank')).json() as Json).toMatchObject({
      pending: true,
      bank: { account: '12345678' },
    });
    // finance was told
    const notes = await sys<Json[]>((tx) =>
      tx.select().from(s.notification).where(eq(s.notification.event, 'bank.change')),
    );
    expect(notes.some((n) => n.userId === uid('user:finance'))).toBe(true);
    const [pending] = ((await call('finance', 'GET', '/bank-changes')).json() as Json).items as Json[];
    expect(
      (await call('finance', 'POST', `/bank-changes/${pending!.id}/reject`, { note: 'no' })).statusCode,
    ).toBe(400);
    expect(
      (
        await call('finance', 'POST', `/bank-changes/${pending!.id}/reject`, {
          note: 'Account name does not match',
        })
      ).json(),
    ).toMatchObject({ status: 'REJECTED' });
    expect(
      ((await call('finance', 'GET', `/suppliers/${BRIGHTWAVE}/bank`)).json() as Json).bank.account,
    ).toBe('12345678');
    // a rejected change cannot be decided again
    expect((await call('finance', 'POST', `/bank-changes/${pending!.id}/confirm`, {})).statusCode).toBe(409);
  });

  it('a change staff ask for needs a DIFFERENT finance person; the supplier cannot confirm its own', async () => {
    const asked = await call('finance', 'POST', `/suppliers/${BRIGHTWAVE}/bank-change`, {
      bsb: '082-001',
      account: '55443322',
      accountName: 'Brightwave Cleaning Pty Ltd',
    });
    expect(asked.statusCode, asked.body).toBe(201);
    const id = asked.json().id as string;
    expect(asked.json()).toMatchObject({ status: 'PENDING', canConfirm: false });
    const same = await call('finance', 'POST', `/bank-changes/${id}/confirm`, {});
    expect(same.statusCode).toBe(403);
    expect(same.json().code).toBe('SECOND_PERSON');
    const second = await env.extraUser('fin2', 'FINANCE');
    const done = await call(second.email, 'POST', `/bank-changes/${id}/confirm`, {
      note: 'Checked by phone with the supplier',
    });
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json()).toMatchObject({ status: 'CONFIRMED', decidedBy: 'Extra fin2' });
    expect(
      ((await call('finance', 'GET', `/suppliers/${BRIGHTWAVE}/bank`)).json() as Json).bank.account,
    ).toBe('55443322');
    expect(
      (await call('procurement', 'POST', `/suppliers/${BRIGHTWAVE}/bank-change`, numbers)).statusCode,
    ).toBe(201);
    for (const who of ['admin', 'exec', 'legal', 'requester'])
      expect((await call(who, 'POST', `/suppliers/${BRIGHTWAVE}/bank-change`, numbers)).statusCode, who).toBe(
        403,
      );
    const trail = await sys<Json[]>((tx) => tx.select().from(s.auditEvent));
    for (const a of [
      'bank_change.request',
      'bank_change.confirm',
      'bank_change.reject',
      'bank_change.first_record',
    ])
      expect(
        trail.some((e) => e.action === a),
        a,
      ).toBe(true);
    expect(JSON.stringify(trail)).not.toMatch(/55443322|99887766|12345678/);
    // the database refuses a decision by the person who asked
    const row = (
      await sys<Json[]>((tx) =>
        tx.select().from(s.bankDetailChange).where(eq(s.bankDetailChange.status, 'PENDING')),
      )
    )[0]!;
    await expect(
      sys((tx) =>
        tx
          .update(s.bankDetailChange)
          .set({ status: 'CONFIRMED', decidedBy: row.requestedBy })
          .where(eq(s.bankDetailChange.id, row.id)),
      ),
    ).rejects.toThrow();
  });

  it('rejecting details that were provisionally in force puts the previous state back', async () => {
    const hash = await argon2Hash(PASSWORD);
    const email = 'evergreen-sup@meridian-demo.example';
    await sys(async (tx) => {
      const [u] = await tx
        .insert(s.appUser)
        .values({ tenantId: TENANT_ID, email, name: 'Eve Green', passwordHash: hash, supplierId: EVERGREEN })
        .returning();
      await tx.insert(s.roleAssignment).values({ tenantId: TENANT_ID, userId: u!.id, role: 'SUPPLIER' });
    });
    expect(
      (
        await call(email, 'PUT', '/supplier/profile/bank', {
          bsb: '012-345',
          account: '20406080',
          accountName: 'Evergreen Facility Services Pty Ltd',
        })
      ).statusCode,
    ).toBe(200);
    expect(((await call('finance', 'GET', `/suppliers/${EVERGREEN}/bank`)).json() as Json).bank.account).toBe(
      '20406080',
    );
    const open = (((await call('finance', 'GET', '/bank-changes')).json() as Json).items as Json[]).find(
      (x) => x.company.startsWith('Evergreen'),
    )!;
    expect(
      (
        await call('finance', 'POST', `/bank-changes/${open.id}/reject`, { note: 'Not our supplier account' })
      ).json(),
    ).toMatchObject({ status: 'REJECTED' });
    expect(((await call('finance', 'GET', `/suppliers/${EVERGREEN}/bank`)).json() as Json).bank).toBeNull();
    // while details are still unconfirmed a newer submission replaces them directly (nothing confirmed is at stake)
    for (const a of ['11111111', '22222222'])
      expect(
        (
          await call(email, 'PUT', '/supplier/profile/bank', {
            bsb: '012-345',
            account: a,
            accountName: 'Evergreen Facility Services Pty Ltd',
          })
        ).json().status,
      ).toBe('IN_FORCE_UNCONFIRMED');
    expect(((await call('finance', 'GET', `/suppliers/${EVERGREEN}/bank`)).json() as Json).bank.account).toBe(
      '22222222',
    );
  });

  it('duplicate detection compares hashes of the details, never the numbers, and the existing rule still finds a shared account', async () => {
    const same = { bsb: '062-000', account: '77665544', accountName: 'Shared' };
    await sys(async (tx) => {
      await tx
        .update(s.supplier)
        .set({ bank: same })
        .where(eq(s.supplier.id, uid('supplier:northstar')));
      await tx
        .update(s.supplier)
        .set({ bank: { ...same, bsb: '062000' } })
        .where(eq(s.supplier.id, uid('supplier:summit')));
    });
    const r = await call('procurement', 'GET', '/suppliers/duplicates');
    expect(r.statusCode).toBe(200);
    const pair = (r.json() as Json).pairs.find((p: Json) => p.reasons.includes('Same bank account'));
    expect(pair).toBeTruthy();
    expect(hasRaw(r.json()) || /77665544/.test(r.body)).toBe(false);
    const lite = (id: string, bank: Json | null, fp?: string) => ({
      id,
      company: `Co ${id}`,
      abn: id.padEnd(11, '0'),
      bank,
      ...(fp ? { bankFp: fp } : {}),
    });
    expect(
      findDuplicates([lite('1', same), lite('2', { bsb: '062000', account: '77665544' })], new Set())[0]!
        .reasons,
    ).toContain('Same bank account');
    const fp = bankFingerprint(same)!;
    expect(findDuplicates([lite('3', null, fp), lite('4', null, fp)], new Set())[0]!.reasons).toContain(
      'Same bank account',
    );
    expect(findDuplicates([lite('5', null, fp), lite('6', null, 'other')], new Set())).toEqual([]);
    await sys(async (tx) => {
      await tx
        .update(s.supplier)
        .set({ bank: null })
        .where(eq(s.supplier.id, uid('supplier:northstar')));
      await tx
        .update(s.supplier)
        .set({ bank: null })
        .where(eq(s.supplier.id, uid('supplier:summit')));
    });
  });

  it('every route that returns supplier objects, for every role, never shows the numbers to anyone but finance (and the supplier itself)', async () => {
    // every GET route in the source that names a supplier or bank; a new one fails this test until it is listed
    const registered = new Set<string>();
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const f = join(dir, e.name);
        if (e.isDirectory()) walk(f);
        else if (f.endsWith('.ts') && !f.endsWith('.test.ts')) {
          const t = readFileSync(f, 'utf8');
          for (const m of t.matchAll(/reg\('GET', '([^']*)'\)/g))
            if (/supplier|bank/.test(m[1]!)) registered.add(m[1]!.replace(/\{(\w+)\}/g, ':$1'));
        }
      }
    };
    walk(fileURLToPath(new URL('../..', import.meta.url)));
    const someRequest = reqs[0]!.id;
    const checked: Record<string, string> = {
      '/bank-changes': '/bank-changes',
      '/reports/supplier-risk': '/reports/supplier-risk',
      '/reports/supplier-scores': '/reports/supplier-scores',
      '/requests/:id/suggested-suppliers': `/requests/${someRequest}/suggested-suppliers`,
      '/supplier/bafo': '/supplier/bafo',
      '/supplier/clarifications': '/supplier/clarifications',
      '/supplier/contracts': '/supplier/contracts',
      '/supplier/onboarding-questions': '/supplier/onboarding-questions',
      '/supplier/profile': '/supplier/profile',
      '/supplier/profile/bank': '/supplier/profile/bank',
      '/supplier/profile/esg': '/supplier/profile/esg',
      '/supplier/ratings': '/supplier/ratings',
      '/supplier/tenders': '/supplier/tenders',
      '/suppliers': '/suppliers',
      '/suppliers/:id': `/suppliers/${BRIGHTWAVE}`,
      '/suppliers/:id/bank': `/suppliers/${BRIGHTWAVE}/bank`,
      '/suppliers/:id/ratings': `/suppliers/${BRIGHTWAVE}/ratings`,
      '/suppliers/:id/risk': `/suppliers/${BRIGHTWAVE}/risk`,
      '/suppliers/duplicates': '/suppliers/duplicates',
    };
    // routes that need a one-time token or are about a single tender or file, and carry no supplier master data
    const tokenOrRecordScoped = [
      '/evaluations/:id/suppliers/:supplierId/files/:fileId',
      '/supplier/activate/:token',
      '/supplier/contracts/:id',
      '/supplier/invitations/:token',
      '/supplier/tenders/:id',
      '/supplier/tenders/:id/deviations',
      '/supplier/tenders/:id/pricing',
      '/supplier/tenders/:id/response',
    ];
    const unlisted = [...registered].filter((r) => !(r in checked) && !tokenOrRecordScoped.includes(r));
    expect(unlisted, `supplier routes not covered by the masking test: ${unlisted.join(', ')}`).toEqual([]);
    expect(registered.size).toBeGreaterThan(20);
    for (const who of [
      'finance',
      'procurement',
      'admin',
      'exec',
      'legal',
      'probity',
      'delegate',
      'contract-mgr',
      'supplier',
    ]) {
      for (const [pattern, url] of Object.entries(checked)) {
        const r = await call(who, 'GET', url);
        if (r.statusCode !== 200) continue; // a role the route refuses sees nothing
        const raw = hasRaw(r.json());
        const allowed = who === 'finance' || (who === 'supplier' && pattern === '/supplier/profile/bank');
        if (allowed && /bank$|bank-changes$/.test(pattern)) {
          if (pattern.endsWith('bank'))
            expect((r.json() as Json).bank?.masked, `${who} ${pattern}`).toBe(false);
        } else expect(raw, `${who} ${pattern}`).toBe(false);
      }
    }
  });

  it('exports, the audit export, the evidence pack and Ask AI carry no numbers', async () => {
    await call('supplier', 'PUT', '/supplier/profile/bank', numbers); // a new request, so the audit trail has bank events in it
    const csv = await call('probity', 'GET', '/audit-events/export');
    expect(csv.statusCode).toBe(200);
    expect(hasRaw(csv.body)).toBe(false);
    expect(csv.body).toMatch(/bank_change|supplier\.bank_read|supplier\.bank_update/);
    const pack = await call('probity', 'POST', '/audit/export-pack', {
      from: '2026-01-01',
      to: '2026-12-31',
    });
    expect(hasRaw(pack.body)).toBe(false);
    const ask = await call('procurement', 'POST', '/assistant/chat', {
      message: 'What are the bank account number and BSB for Brightwave?',
    });
    expect(ask.statusCode, ask.body).toBe(200);
    expect(hasRaw(ask.body)).toBe(false);
    const search = await call('procurement', 'GET', '/search?q=Brightwave');
    if (search.statusCode === 200) expect(hasRaw(search.body)).toBe(false);
    const sup = await call('supplier', 'GET', '/supplier/profile');
    if (sup.statusCode === 200) expect(/99887766|55443322/.test(sup.body)).toBe(false);
    void and;
    void emailFor;
  });
});
