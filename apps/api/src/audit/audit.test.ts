import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withContext, withSystem, type RequestContext } from '../db/client.js';
import * as s from '../db/schema.js';
import { newClock, freshDb } from '../test-helpers.js';
import { AuditService, GENESIS, canonical, diff, redact } from './audit-service.js';

describe('pure helpers', () => {
  it('redact masks sensitive keys at any depth, case-insensitively, and keeps the rest', () => {
    const out = redact({
      name: 'A',
      passwordHash: 'x',
      nested: { API_KEY: 'k', sessionToken: 't', ok: 1 },
      list: [{ secret: 's' }],
    });
    expect(out).toEqual({
      name: 'A',
      passwordHash: '[REDACTED]',
      nested: { API_KEY: '[REDACTED]', sessionToken: '[REDACTED]', ok: 1 },
      list: [{ secret: '[REDACTED]' }],
    });
  });
  it('canonical ignores key order and is stable', () => {
    expect(canonical({ b: 1, a: { d: 2, c: 3 } })).toBe(canonical({ a: { c: 3, d: 2 }, b: 1 }));
    expect(canonical({ a: 1 })).not.toBe(canonical({ a: 2 }));
  });
  it('diff keeps only changed fields (field-level before/after)', () => {
    expect(diff({ a: 1, b: 2, c: 3 }, { a: 1, b: 9, c: 3, d: 4 })).toEqual({
      before: { b: 2 },
      after: { b: 9, d: 4 },
    });
  });
  it('diff of a create keeps all of after; of a delete all of before', () => {
    expect(diff(null, { a: 1 })).toEqual({ before: null, after: { a: 1 } });
    expect(diff({ a: 1 }, null)).toEqual({ before: { a: 1 }, after: null });
  });
  it('diff redacts before comparing, so a changed password shows no value', () => {
    const d = diff({ password: 'old' }, { password: 'new' });
    expect(JSON.stringify(d)).not.toMatch(/old|new/);
  });
});

async function setup() {
  const database = await freshDb();
  const tenantId = crypto.randomUUID();
  await database.db.insert(s.tenant).values({ id: tenantId, slug: 't', name: 'T', sector: 'PRIVATE' });
  const userId = crypto.randomUUID();
  await database.db
    .insert(s.appUser)
    .values({ id: userId, tenantId, email: 'a@b.example', name: 'A', passwordHash: 'h' });
  const ctx: RequestContext = { tenantId, userId, role: 'PROCUREMENT', correlationId: 'c-1' };
  const clock = newClock();
  return { database, tenantId, userId, ctx, clock, audit: new AuditService(clock) };
}

describe('AuditService (in-transaction, hash-chained, append-only)', () => {
  it('first event chains from GENESIS and each next event chains from the previous hash', async () => {
    const { database, ctx, audit, tenantId } = await setup();
    await withContext(database, ctx, async (tx) => {
      await audit.record(tx, ctx, { action: 'a.one', entityType: 'x' });
      await audit.record(tx, ctx, { action: 'a.two', entityType: 'x' });
    });
    const rows = await database.db
      .select()
      .from(s.auditEvent)
      .where(eq(s.auditEvent.tenantId, tenantId))
      .orderBy(s.auditEvent.seq);
    expect(rows[0]!.prevHash).toBe(GENESIS);
    expect(rows[1]!.prevHash).toBe(rows[0]!.hash);
    expect(await audit.verifyChain(database, tenantId)).toEqual({ ok: true, checked: 2 });
    await database.close();
  });

  it('writes correlation id, actor, role and a redacted field-level diff', async () => {
    const { database, ctx, audit, tenantId, userId } = await setup();
    await withContext(database, ctx, (tx) =>
      audit.record(tx, ctx, {
        action: 'user.update',
        entityType: 'app_user',
        before: { name: 'A', passwordHash: 'p1' },
        after: { name: 'B', passwordHash: 'p2' },
      }),
    );
    const [row] = await database.db.select().from(s.auditEvent).where(eq(s.auditEvent.tenantId, tenantId));
    expect(row).toMatchObject({
      actorId: userId,
      actorRole: 'PROCUREMENT',
      correlationId: 'c-1',
      result: 'SUCCESS',
    });
    expect(row!.before).toEqual({ name: 'A' });
    expect(row!.after).toEqual({ name: 'B' });
    await database.close();
  });

  it('rolls the business change back if the audit step fails (fail closed)', async () => {
    const { database, ctx, audit, tenantId } = await setup();
    await expect(
      withContext(database, ctx, async (tx) => {
        await tx.insert(s.orgUnit).values({ tenantId, name: 'Should not persist' });
        await audit.record(tx, ctx, { action: 'x', entityType: 'org_unit', entityId: 'not-a-uuid' });
      }),
    ).rejects.toThrow();
    const rows = await database.db.select().from(s.orgUnit);
    expect(rows).toHaveLength(0);
    await database.close();
  });

  it('rolls the audit record back with a failed business change', async () => {
    const { database, ctx, audit, tenantId } = await setup();
    await expect(
      withContext(database, ctx, async (tx) => {
        await audit.record(tx, ctx, { action: 'will.rollback', entityType: 'x' });
        throw new Error('business failure');
      }),
    ).rejects.toThrow('business failure');
    expect(await audit.verifyChain(database, tenantId)).toEqual({ ok: true, checked: 0 });
    await database.close();
  });

  it('application role cannot UPDATE, DELETE or TRUNCATE the audit trail (grants)', async () => {
    const { database, ctx, audit } = await setup();
    await withContext(database, ctx, (tx) => audit.record(tx, ctx, { action: 'a', entityType: 'x' }));
    for (const stmt of [
      sql`update audit_event set action = 'tampered'`,
      sql`delete from audit_event`,
      sql`truncate audit_event`,
    ]) {
      await expect(withContext(database, ctx, (tx) => tx.execute(stmt))).rejects.toThrow();
    }
    const [row] = await database.db.select().from(s.auditEvent);
    expect(row!.action).toBe('a');
    await database.close();
  });

  it('even a privileged connection is stopped by the append-only trigger', async () => {
    const { database, ctx, audit } = await setup();
    await withContext(database, ctx, (tx) => audit.record(tx, ctx, { action: 'a', entityType: 'x' }));
    for (const stmt of [sql`update audit_event set action = 'tampered'`, sql`delete from audit_event`]) {
      const err = await withSystem(database, (tx) => tx.execute(stmt)).then(
        () => null,
        (e: Error & { cause?: Error }) => e,
      );
      expect(err?.cause?.message ?? err?.message).toMatch(/append-only/); // Drizzle wraps the Postgres error in .cause
    }
    await database.close();
  });

  it('detects tampering with an event (content altered) at exactly that sequence', async () => {
    const { database, ctx, audit, tenantId } = await setup();
    await withContext(database, ctx, async (tx) => {
      for (let i = 0; i < 5; i++)
        await audit.record(tx, ctx, { action: `a.${i}`, entityType: 'x', after: { i } });
    });
    await database.pg.exec('alter table audit_event disable trigger audit_event_no_update'); // simulate a DBA bypass
    const rows = await database.db.select().from(s.auditEvent).orderBy(s.auditEvent.seq);
    const target = rows[2]!;
    await database.pg.query(`update audit_event set after = '{"i": 999}' where seq = $1`, [target.seq]);
    expect(await audit.verifyChain(database, tenantId)).toMatchObject({ ok: false, brokenAtSeq: target.seq });
    await database.close();
  });

  it('detects a deleted event (chain gap)', async () => {
    const { database, ctx, audit, tenantId } = await setup();
    await withContext(database, ctx, async (tx) => {
      for (let i = 0; i < 4; i++) await audit.record(tx, ctx, { action: `a.${i}`, entityType: 'x' });
    });
    await database.pg.exec('alter table audit_event disable trigger audit_event_no_update');
    const rows = await database.db.select().from(s.auditEvent).orderBy(s.auditEvent.seq);
    await database.pg.query('delete from audit_event where seq = $1', [rows[1]!.seq]);
    const r = await audit.verifyChain(database, tenantId);
    expect(r.ok).toBe(false);
    expect(r.brokenAtSeq).toBe(rows[2]!.seq);
    await database.close();
  });

  it('chains are per tenant (a second tenant starts at GENESIS)', async () => {
    const { database, ctx, audit } = await setup();
    const t2 = crypto.randomUUID();
    await database.db.insert(s.tenant).values({ id: t2, slug: 't2', name: 'T2', sector: 'PRIVATE' });
    const ctx2 = { ...ctx, tenantId: t2 };
    await withContext(database, ctx, (tx) => audit.record(tx, ctx, { action: 'a', entityType: 'x' }));
    await withContext(database, ctx2, (tx) => audit.record(tx, ctx2, { action: 'b', entityType: 'x' }));
    const rows = await database.db.select().from(s.auditEvent).where(eq(s.auditEvent.tenantId, t2));
    expect(rows[0]!.prevHash).toBe(GENESIS);
    await database.close();
  });

  it('sequential throughput sanity: 300 audited changes verify in well under 5 s', async () => {
    const { database, ctx, audit, tenantId } = await setup();
    const t0 = Date.now();
    for (let i = 0; i < 300; i++)
      await withContext(database, ctx, (tx) =>
        audit.record(tx, ctx, { action: 'bulk', entityType: 'x', after: { i } }),
      );
    const v = await audit.verifyChain(database, tenantId);
    expect(v).toEqual({ ok: true, checked: 300 });
    expect(Date.now() - t0).toBeLessThan(5000);
    await database.close();
  });
});
