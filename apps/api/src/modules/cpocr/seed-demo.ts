/**
 * Demo data for contract ingestion (CP-07): one batch with two synthetic samples left uncommitted, so the review queue is not
 * empty on a fresh demo. Run by the seed command (db:seed), not by the test seed. Reads the samples through the same pipeline
 * as an upload, as the demo legal officer.
 */
import type { Clock } from '@if/shared';
import { AuditService } from '../../audit/audit-service.js';
import type { AuthContext } from '../../auth/guard.js';
import type { Database } from '../../db/client.js';
import { TENANT_ID, uid } from '../../db/seed.js';
import { buildSample } from './samples.js';
import { ingest, prepareInputs } from './service.js';

export async function seedDemoIngest(database: Database, clock: Clock): Promise<number> {
  const userId = uid('user:legal');
  const a = {
    user: { id: userId, tenantId: TENANT_ID },
    ctx: { tenantId: TENANT_ID, userId, role: 'LEGAL' },
  } as unknown as AuthContext;
  const d = { database, clock, audit: new AuditService(clock) };
  const built = ['services-agreement', 'scanned-security'].map((k) => buildSample(k)!);
  const prepared = await prepareInputs(
    d,
    a,
    built.map((b) => ({ name: b.fileName, bytes: b.bytes })),
  );
  const batch = await ingest(d, a, prepared, 'SAMPLE', 'Demonstration batch (synthetic)');
  return batch.documents.length;
}
