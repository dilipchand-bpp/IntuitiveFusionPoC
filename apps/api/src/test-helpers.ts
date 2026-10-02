import { ManualClock } from '@if/shared';
import { openDatabase, type Database } from './db/client.js';
import { migrateUp } from './db/migrate.js';
import { seedDatabase } from './db/seed.js';

/** Fixed "today" for all seeded data so date rules are reproducible. */
export const SEED_NOW = '2026-10-02T00:00:00.000Z';
export const newClock = () => new ManualClock(SEED_NOW);

export async function freshDb(): Promise<Database> {
  const database = await openDatabase();
  await migrateUp(database);
  return database;
}

let seededTemplate: Database | null = null;
/** Seeding hashes 13 passwords, so tests that need data share one seeded in-memory database (read-mostly tests only). */
export async function sharedSeededDb(): Promise<Database> {
  if (!seededTemplate) {
    seededTemplate = await freshDb();
    await seedDatabase(seededTemplate, { clock: newClock(), password: 'unit-test-password-123' });
  }
  return seededTemplate;
}
