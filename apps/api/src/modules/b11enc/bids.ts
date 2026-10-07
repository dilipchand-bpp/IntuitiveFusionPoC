/**
 * Sealed bids (SEC-D03, SEC-D04). Every bid file and every response answer is encrypted the moment it is uploaded, with the
 * tenant's BIDS key, using envelope encryption (keys.ts). No internal route can return plaintext before the tender closes
 * (and, for a dual-witness tender, before two witnesses have opened it); after that it is decrypted on read for the roles
 * entitled to read bids, and every decryption is written to the audit trail.
 */
import { and, eq, like } from 'drizzle-orm';
import type { AuditService } from '../../audit/audit-service.js';
import type { RequestContext, Tx } from '../../db/client.js';
import { fileObject, responseAnswer } from '../../db/schema.js';
import { AppError } from '../../http/errors.js';
import type { SealedStore } from '../tender/files.js';
import {
  ENVELOPE_PREFIX,
  isEnvelopeBlob,
  isEnvelopeText,
  openText,
  rewrapBlob,
  rewrapText,
  sealText,
  type Rewrapper,
} from './keys.js';

const answerContext = (submissionId: string, itemKey: string) => `answer|${submissionId}|${itemKey}`;

/** An answer ready to store: ciphertext only. */
export const sealAnswer = (
  tx: Tx,
  tenantId: string,
  submissionId: string,
  itemKey: string,
  value: string,
  now: Date,
): Promise<string> =>
  sealText(tx, tenantId, 'BIDS', value, { context: answerContext(submissionId, itemKey), now });

/** The plaintext of a stored answer. A value written before encryption existed is returned as it is (and migrated by `encryptExistingBids`). */
export async function openAnswer(
  tx: Tx,
  tenantId: string,
  row: { submissionId: string; itemKey: string; value: string },
): Promise<string> {
  return isEnvelopeText(row.value)
    ? openText(tx, tenantId, row.value, answerContext(row.submissionId, row.itemKey))
    : row.value;
}

/** itemKey -> plaintext, for one submission's rows. */
export async function answersOf(
  tx: Tx,
  tenantId: string,
  rows: Array<{ submissionId: string; itemKey: string; value: string }>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const r of rows) out.set(`${r.submissionId}|${r.itemKey}`, await openAnswer(tx, tenantId, r));
  return out;
}

export type BidSeal =
  { readable: true } | { readable: false; code: 'BIDS_SEALED' | 'BIDS_NOT_OPENED'; reason: string };

/** Whether bids may be decrypted for internal readers right now. `status` is the tender's current status (service.status). */
export function bidSeal(status: string, t: { dualWitness: boolean; openedAt: Date | null }): BidSeal {
  if (status === 'DRAFT' || status === 'STAGED' || status === 'PUBLISHED')
    return {
      readable: false,
      code: 'BIDS_SEALED',
      reason:
        'Bids are encrypted and stay unreadable to everyone inside the organisation until the tender closes',
    };
  if (t.dualWitness && t.openedAt === null)
    return {
      readable: false,
      code: 'BIDS_NOT_OPENED',
      reason:
        'The tender has closed, but this high-value tender needs two witnesses to open the bids before they can be decrypted',
    };
  return { readable: true };
}

export const sealedError = (s: Extract<BidSeal, { readable: false }>) => new AppError(423, s.code, s.reason);

/** Every decryption of bid content is recorded: who, which tender, what. Never the content. */
export function auditDecrypt(
  audit: AuditService,
  tx: Tx,
  ctx: RequestContext,
  tenderId: string,
  what: { kind: 'FILE' | 'ANSWERS'; fileId?: string; count?: number },
) {
  return audit.record(tx, ctx, {
    action: 'bid.decrypt',
    entityType: 'tender',
    entityId: tenderId,
    after: { ...what },
  });
}

// ---------------------------------------------------------------------------------------------------- migration and re-wrap
export interface EncryptExistingResult {
  filesEncrypted: number;
  filesAlready: number;
  filesMissing: number;
  answersEncrypted: number;
  answersAlready: number;
}

/**
 * One-off, safe to repeat: encrypts bid files and answers that were stored before envelope encryption existed (the seeded
 * demonstration bids, or anything uploaded by an older build). Run by the seed and by POST /security/encrypt-existing.
 * `tx` must be a system transaction (row level security hides bid files from everyone else before close).
 */
export async function encryptExistingBids(
  tx: Tx,
  store: SealedStore | null,
  now: Date,
  tenantId?: string,
): Promise<EncryptExistingResult> {
  const out: EncryptExistingResult = {
    filesEncrypted: 0,
    filesAlready: 0,
    filesMissing: 0,
    answersEncrypted: 0,
    answersAlready: 0,
  };
  const files = store
    ? await tx
        .select()
        .from(fileObject)
        .where(tenantId ? eq(fileObject.tenantId, tenantId) : undefined)
    : [];
  for (const f of files) {
    if (!store) break;
    let raw: Buffer;
    try {
      raw = await store.rawBytes(f.storageKey);
    } catch {
      out.filesMissing += 1;
      continue;
    }
    if (isEnvelopeBlob(raw)) {
      out.filesAlready += 1;
      continue;
    }
    const bytes = await store.get(f.storageKey, { tx });
    await store.put(f.storageKey, bytes, { tx, purpose: 'BIDS' });
    out.filesEncrypted += 1;
  }
  const answers = await tx
    .select()
    .from(responseAnswer)
    .where(tenantId ? eq(responseAnswer.tenantId, tenantId) : undefined);
  for (const a of answers) {
    if (isEnvelopeText(a.value)) {
      out.answersAlready += 1;
      continue;
    }
    await tx
      .update(responseAnswer)
      .set({ value: await sealAnswer(tx, a.tenantId, a.submissionId, a.itemKey, a.value, now) })
      .where(eq(responseAnswer.id, a.id));
    out.answersEncrypted += 1;
  }
  return out;
}

/** The BIDS re-wrap families: response answers and the bid files on disk. */
export const bidRewrappers = (store: SealedStore): Rewrapper[] => [
  async (tx, tenantId, now) => {
    const r = { family: 'response answers', rewrapped: 0, alreadyCurrent: 0, skipped: 0 };
    const rows = await tx
      .select()
      .from(responseAnswer)
      .where(and(eq(responseAnswer.tenantId, tenantId), like(responseAnswer.value, `${ENVELOPE_PREFIX}%`)));
    for (const row of rows) {
      const n = await rewrapText(tx, tenantId, row.value, now);
      if (n === 'same') r.alreadyCurrent += 1;
      else if (n === 'skipped') r.skipped += 1;
      else {
        await tx.update(responseAnswer).set({ value: n }).where(eq(responseAnswer.id, row.id));
        r.rewrapped += 1;
      }
    }
    return r;
  },
  async (tx, tenantId, now) => {
    const r = { family: 'bid files', rewrapped: 0, alreadyCurrent: 0, skipped: 0 };
    const files = await tx.select().from(fileObject).where(eq(fileObject.tenantId, tenantId));
    for (const f of files) {
      let raw: Buffer;
      try {
        raw = await store.rawBytes(f.storageKey);
      } catch {
        r.skipped += 1;
        continue;
      }
      if (!isEnvelopeBlob(raw)) {
        r.skipped += 1;
        continue;
      }
      const n = await rewrapBlob(tx, tenantId, raw, now);
      if (n === 'same') r.alreadyCurrent += 1;
      else if (n === 'skipped') r.skipped += 1;
      else {
        await store.putRaw(f.storageKey, n);
        r.rewrapped += 1;
      }
    }
    return r;
  },
];
