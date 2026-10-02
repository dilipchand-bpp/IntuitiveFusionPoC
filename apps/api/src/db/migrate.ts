import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from './client.js';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));
const BREAKPOINT = '--> statement-breakpoint';

const upFiles = () =>
  readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f) && !f.endsWith('.down.sql'))
    .sort();

const statements = (file: string) =>
  readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
    .split(BREAKPOINT)
    .map((s) => s.trim())
    .filter(Boolean);

/** Applies pending migrations in order, each in its own transaction, recording them in __migrations. */
export async function migrateUp(database: Database): Promise<string[]> {
  const { pg } = database;
  await pg.exec(
    `create table if not exists __migrations (name text primary key, applied_at timestamptz not null default now())`,
  );
  const done = new Set(
    (await pg.query<{ name: string }>('select name from __migrations')).rows.map((r) => r.name),
  );
  const applied: string[] = [];
  for (const file of upFiles()) {
    if (done.has(file)) continue;
    await pg.transaction(async (tx) => {
      for (const stmt of statements(file)) await tx.exec(stmt);
      await tx.query('insert into __migrations(name) values ($1)', [file]);
    });
    applied.push(file);
  }
  return applied;
}

/** Rolls back the most recent migration that has a .down.sql; the drizzle-generated schema migration is reversed by dropping the schema. */
export async function migrateDownLast(database: Database): Promise<string | null> {
  const { pg } = database;
  const last = (await pg.query<{ name: string }>('select name from __migrations order by name desc limit 1'))
    .rows[0]?.name;
  if (!last) return null;
  const down = last.replace(/\.sql$/, '.down.sql');
  let hasDown = true;
  try {
    readFileSync(join(MIGRATIONS_DIR, down));
  } catch {
    hasDown = false;
  }
  if (!hasDown) throw new Error(`No down migration for ${last}; use resetDatabase()`);
  await pg.transaction(async (tx) => {
    for (const stmt of statements(down)) await tx.exec(stmt);
    await tx.query('delete from __migrations where name = $1', [last]);
  });
  return last;
}

/** Drops everything in the public schema and re-applies all migrations (local/test only). */
export async function resetDatabase(database: Database): Promise<void> {
  await database.pg.exec('drop schema public cascade; create schema public;');
  await migrateUp(database);
}
