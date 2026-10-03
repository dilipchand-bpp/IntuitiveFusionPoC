/* eslint-disable no-console */
import { mkdirSync } from 'node:fs';
import { loadConfig, systemClock } from '@if/shared';
import { AuditService } from '../audit/audit-service.js';
import { openDatabase } from './client.js';
import { migrateDownLast, migrateUp, resetDatabase } from './migrate.js';
import { SealedStore } from '../modules/tender/files.js';
import { TENANT_ID, seedDatabase } from './seed.js';

const dataDir = (process.env.DATABASE_URL ?? 'pglite://./var/db').replace(/^pglite:\/\//, '');
if (dataDir && !dataDir.startsWith('memory:')) mkdirSync(dataDir, { recursive: true });

const cmd = process.argv[2];
const database = await openDatabase(dataDir.startsWith('memory:') ? undefined : dataDir);
try {
  switch (cmd) {
    case 'migrate':
      console.log('applied:', await migrateUp(database));
      break;
    case 'rollback':
      console.log('rolled back:', await migrateDownLast(database));
      break;
    case 'reset':
      await resetDatabase(database);
      console.log('database reset and migrated');
      break;
    case 'seed':
      await migrateUp(database);
      {
        // demo bid files are written sealed to the same storage the API reads from
        const config = loadConfig(process.env);
        const store = new SealedStore(config.STORAGE_DIR, config.SESSION_SECRET);
        console.log(await seedDatabase(database, { clock: systemClock, store }));
      }
      break;
    case 'verify-audit': {
      const r = await new AuditService(systemClock).verifyChain(database, TENANT_ID);
      console.log(r);
      if (!r.ok) process.exitCode = 1;
      break;
    }
    default:
      console.error('usage: cli.ts <migrate|rollback|reset|seed|verify-audit>');
      process.exitCode = 2;
  }
} finally {
  await database.close();
}
