import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import * as schema from './schema.js';
import type { Role } from './schema.js';

export type Db = PgliteDatabase<typeof schema>;
/** Handle usable both at top level and inside a transaction. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface Database {
  db: Db;
  pg: PGlite;
  close(): Promise<void>;
}

/** Opens a database. `dataDir` undefined => in-memory (tests). Production-like envs swap this for node-postgres (ADR-0003). */
export async function openDatabase(dataDir?: string): Promise<Database> {
  const pg = new PGlite(dataDir);
  await pg.waitReady;
  const db = drizzle(pg, { schema });
  return { db, pg, close: () => pg.close() };
}

export interface RequestContext {
  tenantId: string;
  userId: string | null;
  role: Role | 'SYSTEM' | null;
  correlationId?: string;
}

/**
 * Runs `fn` in a transaction as the least-privilege `app_user` role with the caller's identity published as
 * transaction-local settings (`set_config(..., true)`), which row level security reads. Because the settings are
 * LOCAL they vanish at COMMIT/ROLLBACK, so a pooled connection can never leak one caller's identity to the next
 * (ADR-0007, Spike A caveat).
 */
export async function withContext<T>(
  database: Database,
  ctx: RequestContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return database.db.transaction(async (tx) => {
    await tx.execute(sql`set local role app_user`);
    await tx.execute(
      sql`select set_config('app.tenant_id', ${ctx.tenantId}, true),
                 set_config('app.user_id', ${ctx.userId ?? ''}, true),
                 set_config('app.role', ${ctx.role ?? ''}, true)`,
    );
    return fn(tx);
  });
}

/** Privileged transaction for migrations, seeding and background jobs that act as the system (still audited). */
export async function withSystem<T>(database: Database, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return database.db.transaction(fn);
}
