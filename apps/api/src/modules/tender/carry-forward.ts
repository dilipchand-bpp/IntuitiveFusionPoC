/**
 * Multi-stage submissions (FR-0230): the latest submission is the one that counts, but material from the supplier's
 * earlier stage that the new submission does not replace is kept. For each section (technical, commercial, other) in
 * which the supplier has uploaded nothing at this stage, the clean files of their earlier stage are copied across, marked
 * as carried forward, so the evaluators of the later stage see a complete response and can tell what is new.
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Tx } from '../../db/client.js';
import type { tender } from '../../db/schema.js';
import { fileObject, submission } from '../../db/schema.js';
import type { SealedStore } from './files.js';

export async function carryForward(
  tx: Tx,
  store: SealedStore,
  t: typeof tender.$inferSelect,
  supplierId: string,
  submissionId: string,
): Promise<number> {
  if (t.stage <= 1 || !t.parentTenderId) return 0;
  const [earlier] = await tx
    .select()
    .from(submission)
    .where(
      and(
        eq(submission.tenderId, t.parentTenderId),
        eq(submission.supplierId, supplierId),
        eq(submission.status, 'SUBMITTED'),
      ),
    );
  if (!earlier) return 0;
  const mine = await tx.select().from(fileObject).where(eq(fileObject.submissionId, submissionId));
  const covered = new Set(mine.filter((f) => f.scan === 'CLEAN' && !f.carriedFrom).map((f) => f.section));
  const already = new Set(mine.map((f) => f.carriedFrom).filter((x): x is string => Boolean(x)));
  const before = await tx.select().from(fileObject).where(eq(fileObject.submissionId, earlier.id));
  let n = 0;
  for (const f of before) {
    if (f.scan !== 'CLEAN' || covered.has(f.section) || already.has(f.id)) continue;
    const key = `${t.tenantId}/${submissionId}/${randomUUID()}`;
    await store.put(key, await store.get(f.storageKey, { tx }), { tx, purpose: 'BIDS' });
    await tx.insert(fileObject).values({
      tenantId: f.tenantId,
      submissionId,
      name: f.name,
      sizeBytes: f.sizeBytes,
      contentType: f.contentType,
      storageKey: key,
      sha256: f.sha256,
      scan: 'CLEAN',
      section: f.section,
      carriedFrom: f.id,
    });
    n += 1;
  }
  // a section the supplier did replace drops any copy carried forward earlier
  for (const f of mine.filter((x) => x.carriedFrom && covered.has(x.section))) {
    await tx.delete(fileObject).where(eq(fileObject.id, f.id));
    await store.remove(f.storageKey);
  }
  return n;
}
