/**
 * TEST-ONLY entry point used by the Playwright browser tests (see playwright.config.ts). It starts the same API as
 * main.ts and adds one route that backdates a tender's closing time, because the 25-day minimum between publication and
 * close means a real tender cannot close during a test run.
 *
 * It refuses to start unless NODE_ENV is "test" and the database path says e2e, so it can never run against real data.
 * Production uses main.ts only (`npm start`).
 */
import { mkdirSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { ConfigError, loadConfig, systemClock } from '@if/shared';
import { buildApp } from './app.js';
import { openDatabase, withSystem } from './db/client.js';
import { migrateUp } from './db/migrate.js';
import { tender } from './db/schema.js';

try {
  const config = loadConfig(process.env);
  if (config.NODE_ENV !== 'test' || !config.DATABASE_URL.includes('e2e'))
    throw new Error('e2e-main.ts only runs with NODE_ENV=test and an e2e database');
  const dataDir = config.DATABASE_URL.replace(/^pglite:\/\//, '');
  mkdirSync(dataDir, { recursive: true });
  const database = await openDatabase(dataDir);
  await migrateUp(database);
  const app = await buildApp(config, {
    database,
    clock: systemClock,
    loginRateLimitMax: config.LOGIN_RATE_LIMIT_MAX,
  });
  app.post<{ Params: { id: string } }>('/__e2e/expire-tender/:id', async (req, reply) => {
    await withSystem(database, (tx) =>
      tx
        .update(tender)
        .set({ closesAt: new Date(Date.now() - 60_000) })
        .where(eq(tender.id, req.params.id)),
    );
    return reply.status(204).send();
  });
  await app.listen({ port: config.API_PORT, host: '0.0.0.0' });
} catch (e) {
  if (e instanceof ConfigError) {
    console.error(e.message);
    process.exit(78); // EX_CONFIG
  }
  throw e;
}
