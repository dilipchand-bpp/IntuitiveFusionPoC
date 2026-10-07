/**
 * Field-level encryption for sensitive columns (SEC-D01): supplier bank details with the tenant DATA key, and the move of
 * the legal platform's shared secret from the tenant settings into the secret store. MFA secrets were already sealed by the
 * sign-in module and the secret store already encrypts every value; the evidence page reports all of them (evidence.ts).
 */
import { and, eq, isNotNull, like } from 'drizzle-orm';
import type { AuditService } from '../../audit/audit-service.js';
import type { RequestContext, Tx } from '../../db/client.js';
import { contractFile, probityDocument, quarantineItem, supplier, tenant } from '../../db/schema.js';
import { connectorSecretName, setSecret } from '../b10conn/secrets.js';
import type { SealedStore } from '../tender/files.js';
import {
  ENVELOPE_PREFIX,
  blobEnvelope,
  isEnvelopeBlob,
  isEnvelopeText,
  openText,
  rewrapBlob,
  rewrapText,
  sealText,
  type Rewrapper,
} from './keys.js';

export interface Bank {
  bsb?: string;
  account?: string;
  accountName?: string;
  recordedAt?: string;
  [k: string]: unknown;
}

const bankContext = (supplierId: string) => `bank|${supplierId}`;

/** What goes in the `bank` column: `{ __enc: <envelope> }`, never the numbers. */
export async function sealBank(
  tx: Tx,
  tenantId: string,
  supplierId: string,
  bank: Bank,
  now: Date,
): Promise<{ __enc: string }> {
  return {
    __enc: await sealText(tx, tenantId, 'DATA', JSON.stringify(bank), {
      context: bankContext(supplierId),
      now,
    }),
  };
}

/** The bank details of a supplier, decrypted. A record saved before encryption existed is returned as it is. */
export async function openBank(
  tx: Tx,
  tenantId: string,
  supplierId: string,
  value: unknown,
): Promise<Bank | null> {
  if (value === null || value === undefined) return null;
  const enc = (value as { __enc?: unknown }).__enc;
  if (typeof enc === 'string' && isEnvelopeText(enc))
    return JSON.parse(await openText(tx, tenantId, enc, bankContext(supplierId))) as Bank;
  return value as Bank;
}

export interface EncryptFieldsResult {
  bankEncrypted: number;
  bankAlready: number;
  legalSecretMoved: number;
}

/** One-off, safe to repeat: encrypts existing plaintext bank details and moves a legal platform secret out of the settings. */
export async function encryptExistingFields(
  tx: Tx,
  d: { audit: AuditService; now: Date },
  ctx: RequestContext,
): Promise<EncryptFieldsResult> {
  const out: EncryptFieldsResult = { bankEncrypted: 0, bankAlready: 0, legalSecretMoved: 0 };
  const rows = await tx
    .select({ id: supplier.id, bank: supplier.bank })
    .from(supplier)
    .where(and(eq(supplier.tenantId, ctx.tenantId), isNotNull(supplier.bank)));
  for (const r of rows) {
    if (typeof (r.bank as { __enc?: unknown } | null)?.__enc === 'string') {
      out.bankAlready += 1;
      continue;
    }
    await tx
      .update(supplier)
      .set({ bank: await sealBank(tx, ctx.tenantId, r.id, r.bank as Bank, d.now) })
      .where(eq(supplier.id, r.id));
    out.bankEncrypted += 1;
  }
  const [t] = await tx.select().from(tenant).where(eq(tenant.id, ctx.tenantId));
  const cfg = (t?.config ?? {}) as {
    settings?: { legalPlatform?: { webhookSecret?: string } & Record<string, unknown> };
  };
  const legal = cfg.settings?.legalPlatform;
  if (legal?.webhookSecret && legal.webhookSecret.length >= 8) {
    await setSecret(tx, d, ctx, connectorSecretName('LEGAL'), legal.webhookSecret);
    await tx
      .update(tenant)
      .set({
        config: { ...cfg, settings: { ...cfg.settings, legalPlatform: { ...legal, webhookSecret: '' } } },
      })
      .where(eq(tenant.id, ctx.tenantId));
    out.legalSecretMoved = 1;
  }
  return out;
}

/** DATA re-wrap families: bank details, held uploads and (below) the contract and probity files on disk. */
export const dataRewrappers = (store: SealedStore): Rewrapper[] => [
  fileRewrapper(store, 'DATA'),
  async (tx, tenantId, now) => {
    const r = { family: 'supplier bank details', rewrapped: 0, alreadyCurrent: 0, skipped: 0 };
    const rows = await tx
      .select()
      .from(supplier)
      .where(and(eq(supplier.tenantId, tenantId), isNotNull(supplier.bank)));
    for (const row of rows) {
      const enc = (row.bank as { __enc?: string } | null)?.__enc;
      if (!enc) continue;
      const n = await rewrapText(tx, tenantId, enc, now);
      if (n === 'same') r.alreadyCurrent += 1;
      else if (n === 'skipped') r.skipped += 1;
      else {
        await tx
          .update(supplier)
          .set({ bank: { __enc: n } })
          .where(eq(supplier.id, row.id));
        r.rewrapped += 1;
      }
    }
    return r;
  },
  async (tx, tenantId, now) => {
    const r = { family: 'held uploads', rewrapped: 0, alreadyCurrent: 0, skipped: 0 };
    const rows = await tx
      .select()
      .from(quarantineItem)
      .where(
        and(eq(quarantineItem.tenantId, tenantId), like(quarantineItem.heldContent, `${ENVELOPE_PREFIX}%`)),
      );
    for (const row of rows) {
      const n = await rewrapText(tx, tenantId, row.heldContent!, now);
      if (n === 'same') r.alreadyCurrent += 1;
      else if (n === 'skipped') r.skipped += 1;
      else {
        await tx.update(quarantineItem).set({ heldContent: n }).where(eq(quarantineItem.id, row.id));
        r.rewrapped += 1;
      }
    }
    return r;
  },
];

/** Contract and probity files on disk whose envelope was sealed with `purpose` (DATA normally, PROJECT once a project is restricted). */
export const fileRewrapper =
  (store: SealedStore, purpose: 'DATA' | 'PROJECT'): Rewrapper =>
  async (tx, tenantId, now) => {
    const r = {
      family: `contract and probity files (${purpose})`,
      rewrapped: 0,
      alreadyCurrent: 0,
      skipped: 0,
    };
    const keys = [
      ...(
        await tx
          .select({ k: contractFile.storageKey })
          .from(contractFile)
          .where(eq(contractFile.tenantId, tenantId))
      ).map((x) => x.k),
      ...(
        await tx
          .select({ k: probityDocument.fileKey })
          .from(probityDocument)
          .where(and(eq(probityDocument.tenantId, tenantId), isNotNull(probityDocument.fileKey)))
      ).map((x) => x.k!),
    ];
    for (const key of keys) {
      let raw: Buffer;
      try {
        raw = await store.rawBytes(key);
      } catch {
        r.skipped += 1;
        continue;
      }
      if (!isEnvelopeBlob(raw) || blobEnvelope(raw).p !== purpose) continue;
      const n = await rewrapBlob(tx, tenantId, raw, now);
      if (n === 'same') r.alreadyCurrent += 1;
      else if (n === 'skipped') r.skipped += 1;
      else {
        await store.putRaw(key, n);
        r.rewrapped += 1;
      }
    }
    return r;
  };
