/**
 * Local secret store with rotation (SEC-N03). SWAP POINT (docs/swap-points.md): a real deployment keeps these in AWS Secrets
 * Manager (or HashiCorp Vault) and `readSecret` becomes a call to it; callers only ever use `readSecret`.
 *
 * Values are encrypted with AES-256-GCM. The key is derived from SECRET_STORE_KEY, or from SESSION_SECRET in development and
 * test. The tenant, name and version are bound into the ciphertext as additional authenticated data, so a row copied to
 * another name or version does not decrypt. A value is never returned by any API once set: only its name, version, when it
 * was last rotated and a fingerprint (the first 8 hex characters of its SHA-256).
 */
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { AuditService } from '../../audit/audit-service.js';
import type { RequestContext, Tx } from '../../db/client.js';
import { secretEntry } from '../../db/schema.js';
import { AppError } from '../../http/errors.js';

let material: string | null = null;
/** Called once when the app is built, with SECRET_STORE_KEY or, failing that, SESSION_SECRET. */
export function configureSecretStore(keyMaterial: string): void {
  material = keyMaterial;
}
function key(): Buffer {
  const m = material ?? process.env.SECRET_STORE_KEY ?? process.env.SESSION_SECRET;
  if (!m) throw new AppError(500, 'SECRET_STORE_UNAVAILABLE', 'The secret store has no key configured');
  return Buffer.from(hkdfSync('sha256', m, 'if-secret-store-v1', 'aes-256-gcm', 32));
}

export const SECRET_NAME = /^[a-z0-9][a-z0-9._-]{1,79}$/i;
export const fingerprintOf = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 8);
const aad = (tenantId: string, name: string, version: number) =>
  Buffer.from(`${tenantId}|${name}|${version}`, 'utf8');

export function encryptValue(
  value: string,
  tenantId: string,
  name: string,
  version: number,
): { ciphertext: string; iv: string } {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  c.setAAD(aad(tenantId, name, version));
  const ct = Buffer.concat([c.update(value, 'utf8'), c.final()]);
  return { ciphertext: Buffer.concat([ct, c.getAuthTag()]).toString('base64'), iv: iv.toString('base64') };
}
export function decryptValue(
  row: { ciphertext: string; iv: string },
  tenantId: string,
  name: string,
  version: number,
): string {
  const raw = Buffer.from(row.ciphertext, 'base64');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(row.iv, 'base64'));
  d.setAAD(aad(tenantId, name, version));
  d.setAuthTag(raw.subarray(raw.length - 16));
  return Buffer.concat([d.update(raw.subarray(0, raw.length - 16)), d.final()]).toString('utf8');
}

export interface SecretMeta {
  name: string;
  version: number;
  fingerprint: string;
  lastRotatedAt: string;
  versions: number;
}

/** The current value of a secret, for server-side use by a connector. Never passed to a response. */
export async function readSecret(tx: Tx, tenantId: string, name: string): Promise<string | null> {
  const [row] = await tx
    .select()
    .from(secretEntry)
    .where(and(eq(secretEntry.tenantId, tenantId), eq(secretEntry.name, name), isNull(secretEntry.retiredAt)))
    .orderBy(desc(secretEntry.version))
    .limit(1);
  return row ? decryptValue(row, tenantId, name, row.version) : null;
}

/** Sets a secret, or rotates it: a new version is written and the previous one is retired. */
export async function setSecret(
  tx: Tx,
  d: { audit: AuditService; now: Date },
  ctx: RequestContext,
  name: string,
  value: string,
): Promise<SecretMeta> {
  const rows = await tx
    .select()
    .from(secretEntry)
    .where(and(eq(secretEntry.tenantId, ctx.tenantId), eq(secretEntry.name, name)));
  const version = rows.reduce((m, r) => Math.max(m, r.version), 0) + 1;
  const enc = encryptValue(value, ctx.tenantId, name, version);
  await tx
    .update(secretEntry)
    .set({ retiredAt: d.now })
    .where(
      and(eq(secretEntry.tenantId, ctx.tenantId), eq(secretEntry.name, name), isNull(secretEntry.retiredAt)),
    );
  const fingerprint = fingerprintOf(value);
  const [row] = await tx
    .insert(secretEntry)
    .values({
      tenantId: ctx.tenantId,
      name,
      version,
      ...enc,
      fingerprint,
      createdAt: d.now,
      rotatedBy: ctx.userId,
    })
    .returning({ id: secretEntry.id });
  // the value is never written to the audit trail: only that it changed, and its fingerprint
  await d.audit.record(tx, ctx, {
    action: version === 1 ? 'secret.set' : 'secret.rotate',
    entityType: 'secret',
    entityId: row!.id,
    after: { name, version, fingerprint },
  });
  return { name, version, fingerprint, lastRotatedAt: d.now.toISOString(), versions: version };
}

export async function listSecrets(tx: Tx, tenantId: string): Promise<SecretMeta[]> {
  const rows = await tx
    .select({
      name: secretEntry.name,
      version: secretEntry.version,
      fingerprint: secretEntry.fingerprint,
      createdAt: secretEntry.createdAt,
      retiredAt: secretEntry.retiredAt,
    })
    .from(secretEntry)
    .where(eq(secretEntry.tenantId, tenantId))
    .orderBy(secretEntry.name, desc(secretEntry.version));
  const out = new Map<string, SecretMeta>();
  for (const r of rows) {
    if (!out.has(r.name))
      out.set(r.name, {
        name: r.name,
        version: r.version,
        fingerprint: r.fingerprint,
        lastRotatedAt: r.createdAt.toISOString(),
        versions: r.version,
      });
  }
  return [...out.values()];
}

/** The name under which a connector keeps the secret that signs its messages. */
export const connectorSecretName = (kind: string) => `connector.${kind.toLowerCase()}.webhook`;

/**
 * The secret for a connector. The legal platform's shared secret used to live in the tenant settings; the store wins when
 * it has one and the setting is the fallback, so nothing already configured stops working.
 */
export async function connectorSecret(
  tx: Tx,
  tenantId: string,
  kind: string,
  fallback?: string,
): Promise<string | null> {
  const v = await readSecret(tx, tenantId, connectorSecretName(kind));
  if (v) return v;
  return fallback ? fallback : null;
}
