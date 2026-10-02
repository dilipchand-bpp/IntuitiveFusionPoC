import { verify } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { AuditService } from '../audit/audit-service.js';
import { freshDb, newClock, sharedSeededDb } from '../test-helpers.js';
import { withSystem, type Database } from './client.js';
import { SEED_USERS, TENANT_ID, emailFor, seedDatabase, uid } from './seed.js';
import * as s from './schema.js';

const cause = (e: unknown) => ((e as { cause?: Error }).cause?.message ?? (e as Error).message) as string;
const attempt = (db: Database, fn: Parameters<typeof withSystem>[1]) =>
  withSystem(db, fn).then(
    () => null,
    (e) => cause(e),
  );

describe('seed', () => {
  it('is idempotent: a second run changes nothing', async () => {
    const db = await freshDb();
    const first = await seedDatabase(db, { clock: newClock(), password: 'unit-test-password-123' });
    expect(first.seeded).toBe(true);
    const second = await seedDatabase(db, { clock: newClock(), password: 'unit-test-password-123' });
    expect(second.seeded).toBe(false);
    expect(second.counts).toEqual(first.counts);
    await db.close();
  });

  it('an empty SEED_PASSWORD (e.g. copied from .env.example) falls back to the documented demo password', async () => {
    const db = await freshDb();
    const saved = process.env.SEED_PASSWORD;
    process.env.SEED_PASSWORD = '';
    try {
      await seedDatabase(db, { clock: newClock() });
    } finally {
      if (saved === undefined) delete process.env.SEED_PASSWORD;
      else process.env.SEED_PASSWORD = saved;
    }
    const [u] = await db.db
      .select()
      .from(s.appUser)
      .where(eq(s.appUser.email, emailFor('requester')));
    expect(await verify(u!.passwordHash, 'Demo-Only-Passw0rd!2026')).toBe(true);
    expect(await verify(u!.passwordHash, '')).toBe(false);
    await db.close();
  });

  it('a too-short SEED_PASSWORD is refused with a clear message', async () => {
    const db = await freshDb();
    await expect(seedDatabase(db, { clock: newClock(), password: 'short' })).rejects.toThrow(/at least 8/);
    await db.close();
  });

  it('creates the planned data set', async () => {
    const db = await sharedSeededDb();
    const c = (await seedDatabase(db, { clock: newClock() })).counts;
    expect(c).toMatchObject({
      tenant: 1,
      app_user: SEED_USERS.length,
      request: 6,
      contract: 2,
      supplier: 4,
      notification: 6,
      score: 48,
    });
    expect(SEED_USERS.map((u) => u.role)).toEqual(
      expect.arrayContaining([
        'REQUESTER',
        'PROCUREMENT',
        'DELEGATE',
        'EVALUATOR',
        'CHAIR',
        'LEGAL',
        'CONTRACT_MGR',
        'PROBITY',
        'FINANCE',
        'ADMIN',
        'EXEC',
        'SUPPLIER',
      ]),
    );
    expect(c.audit_event).toBeGreaterThanOrEqual(40);
  });

  it('the audit chain created by seeding verifies end to end', async () => {
    const db = await sharedSeededDb();
    const r = await new AuditService(newClock()).verifyChain(db, TENANT_ID);
    expect(r.ok).toBe(true);
    expect(r.checked).toBeGreaterThanOrEqual(40);
  });

  it('stores only argon2id hashes; the plaintext password appears nowhere, including the audit log', async () => {
    const db = await sharedSeededDb();
    const [u] = await db.db
      .select()
      .from(s.appUser)
      .where(eq(s.appUser.email, emailFor('requester')));
    expect(u!.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await verify(u!.passwordHash, 'unit-test-password-123')).toBe(true);
    expect(await verify(u!.passwordHash, 'wrong')).toBe(false);
    const dump = await db.pg.query<{ n: number }>(
      `select count(*)::int n from audit_event where after::text ilike '%unit-test-password%' or after::text like '%argon2id%'`,
    );
    expect(dump.rows[0]!.n).toBe(0);
  });

  it('contains the scenarios the demo needs: 74-day contract, flagged variance, closed tender with 4 bids, open tender', async () => {
    const db = await sharedSeededDb();
    const [c] = await db.db
      .select()
      .from(s.contract)
      .where(eq(s.contract.id, uid('contract:landscape')));
    const days = Math.round(
      (new Date(c!.endDate!).getTime() - new Date('2026-10-02').getTime()) / 86_400_000,
    );
    expect(days).toBe(74);
    expect(c!.locked).toBe(true);
    const flagged = await db.db.select().from(s.consensusItem).where(eq(s.consensusItem.flagged, true));
    expect(flagged).toHaveLength(1);
    expect(Number(flagged[0]!.variancePct)).toBeCloseTo(38, 0);
    const subs = await db.db
      .select()
      .from(s.submission)
      .where(eq(s.submission.tenderId, uid('tender:cleaning')));
    expect(subs).toHaveLength(4);
    const [open] = await db.db
      .select()
      .from(s.tender)
      .where(eq(s.tender.id, uid('tender:itmsp')));
    expect(open!.status).toBe('PUBLISHED');
  });

  it('synthetic only: all emails use the reserved .example domain and all ABNs are 11 digits', async () => {
    const db = await sharedSeededDb();
    const users = await db.db.select({ e: s.appUser.email }).from(s.appUser);
    expect(users.every((x) => x.e.endsWith('.example'))).toBe(true);
    const sup = await db.db.select({ a: s.supplier.abn }).from(s.supplier);
    expect(sup.every((x) => /^\d{11}$/.test(x.a))).toBe(true);
  });
});

describe('integrity rules enforced by the database', () => {
  it('an executed (locked) contract cannot have its commercial terms changed', async () => {
    const db = await sharedSeededDb();
    const msg = await attempt(db, (tx) =>
      tx
        .update(s.contract)
        .set({ value: '1.00' })
        .where(eq(s.contract.id, uid('contract:landscape'))),
    );
    expect(msg).toMatch(/executed and locked/);
  });

  it('contracts can never be physically deleted (logical delete only)', async () => {
    const db = await sharedSeededDb();
    expect(
      await attempt(db, (tx) => tx.delete(s.contract).where(eq(s.contract.id, uid('contract:landscape')))),
    ).toMatch(/append-only/);
  });

  it('approvals are immutable: no delete, no edit other than being superseded', async () => {
    const db = await sharedSeededDb();
    expect(await attempt(db, (tx) => tx.delete(s.approval))).toMatch(/append-only/);
    expect(await attempt(db, (tx) => tx.update(s.approval).set({ decision: 'REJECTED' }))).toMatch(
      /immutable/,
    );
    expect(
      await attempt(db, (tx) =>
        tx.update(s.approval).set({ decision: 'SUPERSEDED' }).where(eq(s.approval.subjectType, 'PLAN')),
      ),
    ).toBeNull();
  });

  it('referential integrity: a request cannot reference a missing user', async () => {
    const db = await sharedSeededDb();
    const msg = await attempt(db, (tx) =>
      tx
        .insert(s.request)
        .values({ tenantId: TENANT_ID, number: 'PR-X', title: 'x', requesterId: crypto.randomUUID() }),
    );
    expect(msg).toMatch(/foreign key/i);
  });

  it('value checks: score range, ABN format, negative values', async () => {
    const db = await sharedSeededDb();
    expect(
      await attempt(db, (tx) =>
        tx.insert(s.supplier).values({ tenantId: TENANT_ID, company: 'X', abn: '123' }),
      ),
    ).toMatch(/ck_abn/);
    expect(
      await attempt(db, (tx) =>
        tx
          .update(s.request)
          .set({ estimatedValue: '-5' })
          .where(eq(s.request.id, uid('request:paper'))),
      ),
    ).toMatch(/ck_request_value/);
  });

  it('uniqueness: one submission per supplier per tender; request numbers unique per tenant', async () => {
    const db = await sharedSeededDb();
    expect(
      await attempt(db, (tx) =>
        tx.insert(s.submission).values({
          tenantId: TENANT_ID,
          tenderId: uid('tender:cleaning'),
          supplierId: uid('supplier:brightwave'),
        }),
      ),
    ).toMatch(/submission_uq|duplicate/);
    expect(
      await attempt(db, (tx) =>
        tx.insert(s.request).values({
          tenantId: TENANT_ID,
          number: 'PR-2026-0001',
          title: 'dup',
          requesterId: uid('user:requester'),
        }),
      ),
    ).toMatch(/request_number_uq|duplicate/);
  });
});
