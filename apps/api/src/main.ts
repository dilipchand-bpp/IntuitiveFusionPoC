import { mkdirSync } from 'node:fs';
import { ConfigError, loadConfig, systemClock } from '@if/shared';
import { buildApp } from './app.js';
import { openDatabase } from './db/client.js';
import { migrateUp, schemaDrift } from './db/migrate.js';

try {
  const config = loadConfig(process.env);
  const dataDir = config.DATABASE_URL.replace(/^pglite:\/\//, '');
  mkdirSync(dataDir, { recursive: true });
  const database = await openDatabase(dataDir);
  await migrateUp(database);
  const drift = await schemaDrift(database);
  if (drift.length) {
    console.error(
      `The database is out of step with the code (missing: ${drift.slice(0, 8).join(', ')}${drift.length > 8 ? ', ...' : ''}).
` +
        'It was created before a migration changed. Stop the servers, then run:  npm run db:reset && npm run db:seed',
    );
    process.exit(78);
  }
  const app = await buildApp(config, {
    database,
    clock: systemClock,
    loginRateLimitMax: config.LOGIN_RATE_LIMIT_MAX,
    alertSchedulerMinutes: 15,
  });
  await app.listen({ port: config.API_PORT, host: '0.0.0.0' });
} catch (e) {
  if (e instanceof ConfigError) {
    console.error(e.message);
    process.exit(78); // EX_CONFIG
  }
  throw e;
}
