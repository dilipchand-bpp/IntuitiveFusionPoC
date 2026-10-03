import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { newClock, freshDb } from '../test-helpers.js';
import { withContext, withSystem, type Database, type RequestContext } from './client.js';
import { seedDatabase, TENANT_ID, uid } from './seed.js';
import * as s from './schema.js';

const EV = uid('evaluation:cleaning');
const ctxFor = (key: string, role: s.Role): RequestContext => ({
  tenantId: TENANT_ID,
  userId: uid(`user:${key}`),
  role,
});
const scoreRows = (db: Database, ctx: RequestContext) =>
  withContext(db, ctx, (tx) => tx.select().from(s.score).where(eq(s.score.evaluationId, EV)));
const cause = (e: unknown) => ((e as { cause?: Error }).cause?.message ?? (e as Error).message) as string;

async function seeded() {
  const database = await freshDb();
  await seedDatabase(database, { clock: newClock(), password: 'unit-test-password-123' });
  return database;
}

describe('row level security on evaluator scores (ADR-0007)', () => {
  it('each evaluator reads only their own scores', async () => {
    const db = await seeded();
    const tech = await scoreRows(db, ctxFor('evaluator-tech', 'EVALUATOR'));
    expect(tech.length).toBe(12); // technical criteria and the shared one, never price
    expect(new Set(tech.map((r) => r.evaluatorId))).toEqual(new Set([uid('user:evaluator-tech')]));
    const comm = await scoreRows(db, ctxFor('evaluator-comm', 'EVALUATOR'));
    expect(new Set(comm.map((r) => r.evaluatorId))).toEqual(new Set([uid('user:evaluator-comm')]));
    await db.close();
  });

  it("asking explicitly for another evaluator's rows returns nothing", async () => {
    const db = await seeded();
    const rows = await withContext(db, ctxFor('evaluator-tech', 'EVALUATOR'), (tx) =>
      tx
        .select()
        .from(s.score)
        .where(eq(s.score.evaluatorId, uid('user:evaluator-comm'))),
    );
    expect(rows).toEqual([]);
    await db.close();
  });

  it('chair sees all scores only once consensus is open (status CONSENSUS in the seed), not while SCORING', async () => {
    const db = await seeded();
    expect((await scoreRows(db, ctxFor('chair', 'CHAIR'))).length).toBe(36);
    await withSystem(db, (tx) =>
      tx.update(s.evaluation).set({ status: 'SCORING' }).where(eq(s.evaluation.id, EV)),
    );
    expect(
      (await scoreRows(db, ctxFor('chair', 'CHAIR'))).filter((r) => r.evaluatorId !== uid('user:chair')),
    ).toEqual([]);
    await db.close();
  });

  it('roles with no score entitlement (PROCUREMENT, ADMIN, SUPPLIER) read nothing', async () => {
    const db = await seeded();
    for (const [k, role] of [
      ['procurement', 'PROCUREMENT'],
      ['admin', 'ADMIN'],
      ['supplier', 'SUPPLIER'],
    ] as const) {
      expect(await scoreRows(db, ctxFor(k, role))).toEqual([]);
    }
    await db.close();
  });

  it('fails closed when no identity is published (settings unset => zero rows)', async () => {
    const db = await seeded();
    const rows = await db.db.transaction(async (tx) => {
      await tx.execute(sql`set local role app_user`);
      return tx.select().from(s.score);
    });
    expect(rows).toEqual([]);
    await db.close();
  });

  it('identity does not leak to the next transaction on the same connection (SET LOCAL semantics)', async () => {
    const db = await seeded();
    await scoreRows(db, ctxFor('evaluator-tech', 'EVALUATOR'));
    // Next "request" on the same single connection publishes nothing: must see nothing, and the settings must be empty.
    const probe = await db.db.transaction(async (tx) => {
      await tx.execute(sql`set local role app_user`);
      const cfg = await tx.execute(
        sql`select current_setting('app.user_id', true) as u, current_setting('app.role', true) as r`,
      );
      const rows = await tx.select().from(s.score);
      return { cfg: cfg.rows[0] as { u: string | null; r: string | null }, rows };
    });
    expect(probe.cfg.u ?? '').toBe('');
    expect(probe.cfg.r ?? '').toBe('');
    expect(probe.rows).toEqual([]);
    await db.close();
  });

  it('a rolled-back request does not leak identity either', async () => {
    const db = await seeded();
    await expect(
      withContext(db, ctxFor('evaluator-tech', 'EVALUATOR'), async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const probe = await db.db.transaction(async (tx) => {
      await tx.execute(sql`set local role app_user`);
      return (await tx.execute(sql`select current_setting('app.user_id', true) as u`)).rows[0] as {
        u: string | null;
      };
    });
    expect(probe.u ?? '').toBe('');
    await db.close();
  });

  it('an evaluator cannot insert a score as someone else', async () => {
    const db = await seeded();
    const err = await withContext(db, ctxFor('evaluator-tech', 'EVALUATOR'), (tx) =>
      tx.insert(s.score).values({
        tenantId: TENANT_ID,
        evaluationId: EV,
        supplierId: uid('supplier:summit'),
        criterionId: uid('criterion:0'),
        evaluatorId: uid('user:evaluator-comm'),
        score: '1.00',
      }),
    ).then(
      () => null,
      (e) => e,
    );
    expect(cause(err)).toMatch(/row-level security/);
    await db.close();
  });

  it('an evaluator cannot change a score after scoring has closed', async () => {
    const db = await seeded();
    const updated = await withContext(db, ctxFor('evaluator-tech', 'EVALUATOR'), (tx) =>
      tx
        .update(s.score)
        .set({ score: '10.00' })
        .where(and(eq(s.score.evaluationId, EV), eq(s.score.evaluatorId, uid('user:evaluator-tech'))))
        .returning({ id: s.score.id }),
    );
    expect(updated).toEqual([]); // evaluation is in CONSENSUS => policy hides the rows from UPDATE
    await db.close();
  });

  it("an evaluator cannot read another tenant's scores even with a valid evaluator id", async () => {
    const db = await seeded();
    const other = {
      tenantId: crypto.randomUUID(),
      userId: uid('user:evaluator-tech'),
      role: 'EVALUATOR' as const,
    };
    expect(await scoreRows(db, other)).toEqual([]);
    await db.close();
  });
});
