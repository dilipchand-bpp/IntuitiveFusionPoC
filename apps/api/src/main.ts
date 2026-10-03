import { mkdirSync } from 'node:fs';
import { ConfigError, loadConfig, systemClock } from '@if/shared';
import { buildApp } from './app.js';
import { openDatabase } from './db/client.js';
import { migrateUp } from './db/migrate.js';

try {
  const config = loadConfig(process.env);
  const dataDir = config.DATABASE_URL.replace(/^pglite:\/\//, '');
  mkdirSync(dataDir, { recursive: true });
  const database = await openDatabase(dataDir);
  await migrateUp(database);
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
