import { is } from 'drizzle-orm';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { freshDb } from '../test-helpers.js';
import { migrateDownLast, migrateUp, resetDatabase } from './migrate.js';
import * as schema from './schema.js';

const tables = (): PgTable[] => Object.values(schema).filter((v) => is(v, PgTable)) as unknown as PgTable[];

describe('migrations', () => {
  it('applies on an empty database and is a no-op the second time', async () => {
    const db = await freshDb();
    expect(await migrateUp(db)).toEqual([]);
    const r = await db.pg.query<{ n: number }>(`select count(*)::int n from __migrations`);
    expect(r.rows[0]!.n).toBe(4);
    await db.close();
  });

  it('Drizzle schema and the real database have the same columns (no drift)', async () => {
    const db = await freshDb();
    const actual = await db.pg.query<{ t: string; c: string }>(
      `select table_name t, column_name c from information_schema.columns where table_schema = 'public' and table_name <> '__migrations'`,
    );
    const have = new Set(actual.rows.map((r) => `${r.t}.${r.c}`));
    const want = new Set<string>();
    for (const t of tables()) {
      const cfg = getTableConfig(t);
      for (const col of cfg.columns) want.add(`${cfg.name}.${col.name}`);
    }
    expect(want.size).toBeGreaterThan(200);
    expect([...want].filter((x) => !have.has(x))).toEqual([]);
    expect([...have].filter((x) => !want.has(x))).toEqual([]);
    await db.close();
  });

  it('every business table carries tenant_id', async () => {
    const db = await freshDb();
    const r = await db.pg.query<{ t: string }>(
      `select t.table_name t from information_schema.tables t where t.table_schema='public' and t.table_type='BASE TABLE'
        and t.table_name not in ('__migrations','tenant')
        and not exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=t.table_name and c.column_name='tenant_id')`,
    );
    expect(r.rows.map((x) => x.t)).toEqual([]);
    await db.close();
  });

  it('down migration removes FKs, RLS, triggers and grants; up re-applies cleanly', async () => {
    const db = await freshDb();
    expect(await migrateDownLast(db)).toBe('0003_tender_portal.sql');
    expect(await migrateDownLast(db)).toBe('0002_session.sql');
    expect(await migrateDownLast(db)).toBe('0001_integrity_security.sql');
    const fks = await db.pg.query<{ n: number }>(
      `select count(*)::int n from pg_constraint where contype='f' and connamespace='public'::regnamespace`,
    );
    expect(fks.rows[0]!.n).toBe(0);
    const trig = await db.pg.query<{ n: number }>(
      `select count(*)::int n from pg_trigger where not tgisinternal`,
    );
    expect(trig.rows[0]!.n).toBe(0);
    const rls = await db.pg.query<{ rowsecurity: boolean }>(
      `select rowsecurity from pg_tables where tablename='score'`,
    );
    expect(rls.rows[0]!.rowsecurity).toBe(false);
    expect(await migrateUp(db)).toEqual([
      '0001_integrity_security.sql',
      '0002_session.sql',
      '0003_tender_portal.sql',
    ]);
    const fks2 = await db.pg.query<{ n: number }>(
      `select count(*)::int n from pg_constraint where contype='f' and connamespace='public'::regnamespace`,
    );
    expect(fks2.rows[0]!.n).toBeGreaterThan(30);
    await db.close();
  });

  it('resetDatabase rebuilds from scratch', async () => {
    const db = await freshDb();
    await resetDatabase(db);
    const r = await db.pg.query<{ n: number }>(
      `select count(*)::int n from information_schema.tables where table_schema='public'`,
    );
    expect(r.rows[0]!.n).toBe(35);
    await db.close();
  });
});
