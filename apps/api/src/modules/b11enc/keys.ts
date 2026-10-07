/**
 * Local key service and envelope encryption (SEC-D02, SEC-D04). SIMULATED: a real deployment keeps the key-encryption keys in
 * a managed key service (AWS KMS, with the customer's own key as the root) and `wrapKey` / `unwrapKey` become calls to it.
 * Nothing else in the code base touches key material, so that is the whole swap (docs/swap-points.md).
 *
 * Shape (envelope encryption):
 *   platform root key (from KMS_ROOT_KEY, else SECRET_STORE_KEY / SESSION_SECRET; never stored)
 *     wraps  -> per-tenant key-encryption key (KEK), one row per purpose and version in `kms_key`
 *       wraps -> a data-encryption key (DEK) generated for every object
 *         encrypts -> the object (AES-256-GCM)
 * The wrapped DEK, the key version and the IVs travel with each ciphertext, so decrypting needs only the envelope and the
 * tenant's key table. Rotation adds a KEK version; older versions stay readable until disabled; the re-wrap job re-wraps
 * every DEK to the newest version without touching a single ciphertext.
 */
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { AuditService } from '../../audit/audit-service.js';
import type { RequestContext, Tx } from '../../db/client.js';
import { kmsKey, type KeyPurpose, type KeyState } from '../../db/schema.js';
import { AppError } from '../../http/errors.js';

let material: string | null = null;
/** Called once when the app is built, with SECRET_STORE_KEY or, failing that, SESSION_SECRET. */
/** True when a root key is available (configured by the app, or from the environment). */
export const isKeyServiceConfigured = (): boolean =>
  Boolean(material ?? process.env.KMS_ROOT_KEY ?? process.env.SECRET_STORE_KEY ?? process.env.SESSION_SECRET);
export function configureKeyService(keyMaterial: string): void {
  material = keyMaterial;
  kekCache.clear();
}
function rootKey(): Buffer {
  const m =
    process.env.KMS_ROOT_KEY ?? material ?? process.env.SECRET_STORE_KEY ?? process.env.SESSION_SECRET;
  if (!m) throw new AppError(500, 'KEY_SERVICE_UNAVAILABLE', 'The key service has no root key configured');
  return Buffer.from(hkdfSync('sha256', m, 'if-kms-root-v1', 'aes-256-gcm', 32));
}
/** What the evidence page may say about where the root key comes from, without revealing it. */
export const rootKeySource = (): 'KMS_ROOT_KEY' | 'SECRET_STORE_KEY' | 'SESSION_SECRET (development only)' =>
  process.env.KMS_ROOT_KEY
    ? 'KMS_ROOT_KEY'
    : process.env.SECRET_STORE_KEY
      ? 'SECRET_STORE_KEY'
      : 'SESSION_SECRET (development only)';

const kekCache = new Map<string, Buffer>();
const b64 = (b: Buffer) => b.toString('base64');
const unb64 = (s: string) => Buffer.from(s, 'base64');
const wrapAad = (tenantId: string, purpose: string, version: number) =>
  Buffer.from(`kek|${tenantId}|${purpose}|${version}`, 'utf8');
const dekAad = (tenantId: string, purpose: string, version: number) =>
  Buffer.from(`dek|${tenantId}|${purpose}|${version}`, 'utf8');
const dataAad = (tenantId: string, purpose: string, context: string) =>
  Buffer.from(`data|${tenantId}|${purpose}|${context}`, 'utf8');

function gcm(key: Buffer, plain: Buffer, aad: Buffer): { iv: Buffer; ct: Buffer } {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(aad);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return { iv, ct: Buffer.concat([body, c.getAuthTag()]) };
}
function ungcm(key: Buffer, iv: Buffer, ct: Buffer, aad: Buffer): Buffer {
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAAD(aad);
  d.setAuthTag(ct.subarray(ct.length - 16));
  return Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
}

export type KeyRow = typeof kmsKey.$inferSelect;

/** SWAP POINT: the only code that wraps a KEK under the root key. */
function wrapKey(tenantId: string, purpose: string, version: number, kek: Buffer) {
  const { iv, ct } = gcm(rootKey(), kek, wrapAad(tenantId, purpose, version));
  return { wrappedKey: b64(ct), iv: b64(iv) };
}
/** SWAP POINT: the only code that unwraps a KEK. */
function unwrapKey(row: KeyRow): Buffer {
  const hit = kekCache.get(`${row.id}|${row.wrappedKey.slice(0, 16)}`);
  if (hit) return hit;
  const kek = ungcm(
    rootKey(),
    unb64(row.iv),
    unb64(row.wrappedKey),
    wrapAad(row.tenantId, row.purpose, row.version),
  );
  kekCache.set(`${row.id}|${row.wrappedKey.slice(0, 16)}`, kek);
  return kek;
}
const fingerprint = (kek: Buffer) => createHash('sha256').update(kek).digest('hex').slice(0, 8);

const keyDisabled = (row: Pick<KeyRow, 'purpose' | 'version'>) =>
  new AppError(
    423,
    'KEY_DISABLED',
    `Decryption refused: key disabled (${row.purpose} key version ${row.version}). An administrator must enable it again.`,
  );

// ---------------------------------------------------------------------------------------------------- key rows
export async function keyRows(tx: Tx, tenantId: string, purpose?: KeyPurpose): Promise<KeyRow[]> {
  return tx
    .select()
    .from(kmsKey)
    .where(
      purpose
        ? and(eq(kmsKey.tenantId, tenantId), eq(kmsKey.purpose, purpose))
        : eq(kmsKey.tenantId, tenantId),
    )
    .orderBy(asc(kmsKey.purpose), desc(kmsKey.version));
}

/** The ACTIVE key for a purpose, created as version 1 the first time it is needed. */
export async function activeKey(tx: Tx, tenantId: string, purpose: KeyPurpose, now: Date): Promise<KeyRow> {
  const find = async () => (await keyRows(tx, tenantId, purpose)).find((r) => r.state === 'ACTIVE');
  const hit = await find();
  if (hit) return hit;
  const all = await keyRows(tx, tenantId, purpose);
  const version = all.reduce((m, r) => Math.max(m, r.version), 0) + 1;
  const kek = randomBytes(32);
  await tx
    .insert(kmsKey)
    .values({
      tenantId,
      purpose,
      version,
      ...wrapKey(tenantId, purpose, version, kek),
      fingerprint: fingerprint(kek),
      state: 'ACTIVE',
      createdAt: now,
      createdBy: null,
    })
    .onConflictDoNothing();
  const made = await find();
  if (!made) throw new AppError(500, 'KEY_SERVICE_UNAVAILABLE', `No active ${purpose} key could be created`);
  return made;
}

async function keyAt(tx: Tx, tenantId: string, purpose: KeyPurpose, version: number): Promise<KeyRow> {
  const [row] = await tx
    .select()
    .from(kmsKey)
    .where(and(eq(kmsKey.tenantId, tenantId), eq(kmsKey.purpose, purpose), eq(kmsKey.version, version)));
  if (!row)
    throw new AppError(
      500,
      'KEY_NOT_FOUND',
      `The ${purpose} key version ${version} this data was sealed with does not exist`,
    );
  return row;
}

// ---------------------------------------------------------------------------------------------------- envelopes
export interface Envelope {
  v: 1;
  /** purpose */
  p: KeyPurpose;
  /** KEK version that wraps the DEK */
  kv: number;
  /** wrapped DEK (iv is `wi`) */
  wd: string;
  wi: string;
  /** data IV */
  di: string;
}
interface Sealed {
  env: Envelope;
  ct: Buffer;
}
export const ENVELOPE_PREFIX = 'ife1.';
export const isEnvelopeText = (s: unknown): s is string =>
  typeof s === 'string' && s.startsWith(ENVELOPE_PREFIX);

async function seal(
  tx: Tx,
  tenantId: string,
  purpose: KeyPurpose,
  plain: Buffer,
  context: string,
  now: Date,
): Promise<Sealed> {
  const row = await activeKey(tx, tenantId, purpose, now);
  const kek = unwrapKey(row);
  const dek = randomBytes(32);
  const wrapped = gcm(kek, dek, dekAad(tenantId, purpose, row.version));
  const data = gcm(dek, plain, dataAad(tenantId, purpose, context));
  return {
    env: { v: 1, p: purpose, kv: row.version, wd: b64(wrapped.ct), wi: b64(wrapped.iv), di: b64(data.iv) },
    ct: data.ct,
  };
}

async function dekOf(tx: Tx, tenantId: string, env: Envelope): Promise<Buffer> {
  const row = await keyAt(tx, tenantId, env.p, env.kv);
  if (row.state === 'DISABLED') throw keyDisabled(row);
  try {
    return ungcm(unwrapKey(row), unb64(env.wi), unb64(env.wd), dekAad(tenantId, env.p, env.kv));
  } catch {
    throw new AppError(500, 'DECRYPT_FAILED', 'The data could not be decrypted with its key');
  }
}

async function open(tx: Tx, tenantId: string, s: Sealed, context: string): Promise<Buffer> {
  const dek = await dekOf(tx, tenantId, s.env);
  try {
    return ungcm(dek, unb64(s.env.di), s.ct, dataAad(tenantId, s.env.p, context));
  } catch {
    throw new AppError(500, 'DECRYPT_FAILED', 'The data could not be decrypted: it was changed or moved');
  }
}

/** Text envelope: `ife1.` + base64url(JSON). The ciphertext is inside; nothing in it is readable. */
export async function sealText(
  tx: Tx,
  tenantId: string,
  purpose: KeyPurpose,
  text: string,
  opts: { context?: string; now?: Date } = {},
): Promise<string> {
  const s = await seal(
    tx,
    tenantId,
    purpose,
    Buffer.from(text, 'utf8'),
    opts.context ?? '',
    opts.now ?? new Date(),
  );
  return ENVELOPE_PREFIX + Buffer.from(JSON.stringify({ ...s.env, ct: b64(s.ct) })).toString('base64url');
}
function parseText(token: string): Sealed {
  const j = JSON.parse(
    Buffer.from(token.slice(ENVELOPE_PREFIX.length), 'base64url').toString('utf8'),
  ) as Envelope & {
    ct: string;
  };
  const { ct, ...env } = j;
  return { env, ct: unb64(ct) };
}
export async function openText(tx: Tx, tenantId: string, token: string, context = ''): Promise<string> {
  return (await open(tx, tenantId, parseText(token), context)).toString('utf8');
}
export const envelopeOf = (token: string): Envelope => parseText(token).env;

/** Binary blob: "IFE2" | u32 header length | header JSON | ciphertext (with tag). Used for stored files. */
const MAGIC = Buffer.from('IFE2');
export const isEnvelopeBlob = (b: Buffer): boolean => {
  if (b.length < 12 || !b.subarray(0, 4).equals(MAGIC)) return false;
  const n = b.readUInt32BE(4);
  return n > 10 && n < 4096 && b.length > 8 + n;
};
export async function sealBlob(
  tx: Tx,
  tenantId: string,
  purpose: KeyPurpose,
  bytes: Buffer,
  opts: { context?: string; now?: Date } = {},
): Promise<Buffer> {
  const s = await seal(tx, tenantId, purpose, bytes, opts.context ?? '', opts.now ?? new Date());
  const head = Buffer.from(JSON.stringify(s.env));
  const len = Buffer.alloc(4);
  len.writeUInt32BE(head.length);
  return Buffer.concat([MAGIC, len, head, s.ct]);
}
function parseBlob(blob: Buffer): Sealed {
  const n = blob.readUInt32BE(4);
  return {
    env: JSON.parse(blob.subarray(8, 8 + n).toString('utf8')) as Envelope,
    ct: blob.subarray(8 + n),
  };
}
export async function openBlob(tx: Tx, tenantId: string, blob: Buffer, context = ''): Promise<Buffer> {
  return open(tx, tenantId, parseBlob(blob), context);
}
export const blobEnvelope = (blob: Buffer): Envelope => parseBlob(blob).env;

// ---------------------------------------------------------------------------------------------------- re-wrap
/** Re-wraps one envelope's DEK to the newest key, leaving the ciphertext alone. 'same' = already on the newest version. */
async function rewrapEnvelope(
  tx: Tx,
  tenantId: string,
  env: Envelope,
  now: Date,
): Promise<Envelope | 'same' | 'skipped'> {
  const target = await activeKey(tx, tenantId, env.p, now);
  if (env.kv === target.version) return 'same';
  const old = await keyAt(tx, tenantId, env.p, env.kv);
  if (old.state === 'DISABLED') return 'skipped';
  const dek = ungcm(unwrapKey(old), unb64(env.wi), unb64(env.wd), dekAad(tenantId, env.p, env.kv));
  const w = gcm(unwrapKey(target), dek, dekAad(tenantId, env.p, target.version));
  return { ...env, kv: target.version, wd: b64(w.ct), wi: b64(w.iv) };
}
export async function rewrapText(
  tx: Tx,
  tenantId: string,
  token: string,
  now: Date,
): Promise<string | 'same' | 'skipped'> {
  const s = parseText(token);
  const r = await rewrapEnvelope(tx, tenantId, s.env, now);
  if (r === 'same' || r === 'skipped') return r;
  return ENVELOPE_PREFIX + Buffer.from(JSON.stringify({ ...r, ct: b64(s.ct) })).toString('base64url');
}
export async function rewrapBlob(
  tx: Tx,
  tenantId: string,
  blob: Buffer,
  now: Date,
): Promise<Buffer | 'same' | 'skipped'> {
  const s = parseBlob(blob);
  const r = await rewrapEnvelope(tx, tenantId, s.env, now);
  if (r === 'same' || r === 'skipped') return r;
  const head = Buffer.from(JSON.stringify(r));
  const len = Buffer.alloc(4);
  len.writeUInt32BE(head.length);
  return Buffer.concat([MAGIC, len, head, s.ct]);
}
/** Re-wraps a bare DEK-wrapping record (restricted projects keep theirs in columns, not in an envelope). */
export async function rewrapWrapped(
  tx: Tx,
  tenantId: string,
  purpose: KeyPurpose,
  rec: { keyVersion: number; wrappedDek: string; iv: string },
  now: Date,
): Promise<{ keyVersion: number; wrappedDek: string; iv: string } | 'same' | 'skipped'> {
  const r = await rewrapEnvelope(
    tx,
    tenantId,
    { v: 1, p: purpose, kv: rec.keyVersion, wd: rec.wrappedDek, wi: rec.iv, di: '' },
    now,
  );
  if (r === 'same' || r === 'skipped') return r;
  return { keyVersion: r.kv, wrappedDek: r.wd, iv: r.wi };
}
/** A per-project data key: made, wrapped under the tenant PROJECT key, and used directly to seal project content. */
export async function newWrappedDek(
  tx: Tx,
  tenantId: string,
  now: Date,
): Promise<{ keyVersion: number; wrappedDek: string; iv: string; dek: Buffer }> {
  const row = await activeKey(tx, tenantId, 'PROJECT', now);
  const dek = randomBytes(32);
  const w = gcm(unwrapKey(row), dek, dekAad(tenantId, 'PROJECT', row.version));
  return { keyVersion: row.version, wrappedDek: b64(w.ct), iv: b64(w.iv), dek };
}
export async function unwrapDek(
  tx: Tx,
  tenantId: string,
  rec: { keyVersion: number; wrappedDek: string; iv: string },
): Promise<Buffer> {
  return dekOf(tx, tenantId, {
    v: 1,
    p: 'PROJECT',
    kv: rec.keyVersion,
    wd: rec.wrappedDek,
    wi: rec.iv,
    di: '',
  });
}
export function sealWithDek(dek: Buffer, tenantId: string, context: string, text: string): string {
  const d = gcm(dek, Buffer.from(text, 'utf8'), dataAad(tenantId, 'PROJECT', context));
  return `ifp1.${b64(d.iv)}.${b64(d.ct)}`;
}
export const isProjectText = (s: unknown): s is string => typeof s === 'string' && s.startsWith('ifp1.');
export function openWithDek(dek: Buffer, tenantId: string, context: string, token: string): string {
  const [, iv, ct] = token.split('.');
  try {
    return ungcm(dek, unb64(iv ?? ''), unb64(ct ?? ''), dataAad(tenantId, 'PROJECT', context)).toString(
      'utf8',
    );
  } catch {
    throw new AppError(500, 'DECRYPT_FAILED', 'The project content could not be decrypted');
  }
}

// ---------------------------------------------------------------------------------------------------- admin operations
export interface KeyView {
  id: string;
  purpose: KeyPurpose;
  version: number;
  state: KeyState;
  fingerprint: string;
  createdAt: string;
  createdBy: string | null;
  retiredAt: string | null;
  disabledAt: string | null;
  rewrappedAt: string | null;
}
export const keyView = (r: KeyRow): KeyView => ({
  id: r.id,
  purpose: r.purpose,
  version: r.version,
  state: r.state,
  fingerprint: r.fingerprint,
  createdAt: r.createdAt.toISOString(),
  createdBy: r.createdBy,
  retiredAt: r.retiredAt?.toISOString() ?? null,
  disabledAt: r.disabledAt?.toISOString() ?? null,
  rewrappedAt: r.rewrappedAt?.toISOString() ?? null,
});

/** Makes sure every purpose has a key, then returns them all (newest first within each purpose). */
export async function listKeys(tx: Tx, tenantId: string, now: Date): Promise<KeyRow[]> {
  for (const p of ['DATA', 'BIDS', 'PROJECT'] as const) await activeKey(tx, tenantId, p, now);
  return keyRows(tx, tenantId);
}

/** A new KEK version becomes ACTIVE; the previous ACTIVE one is RETIRED and still decrypts what it sealed. */
export async function rotateKey(
  tx: Tx,
  d: { audit: AuditService; now: Date },
  ctx: RequestContext,
  purpose: KeyPurpose,
): Promise<KeyRow> {
  const current = await activeKey(tx, ctx.tenantId, purpose, d.now);
  const version = current.version + 1;
  const all = await keyRows(tx, ctx.tenantId, purpose);
  const next = Math.max(version, all.reduce((m, r) => Math.max(m, r.version), 0) + 1);
  await tx
    .update(kmsKey)
    .set({ state: 'RETIRED', retiredAt: d.now })
    .where(and(eq(kmsKey.tenantId, ctx.tenantId), eq(kmsKey.purpose, purpose), eq(kmsKey.state, 'ACTIVE')));
  const kek = randomBytes(32);
  const [row] = await tx
    .insert(kmsKey)
    .values({
      tenantId: ctx.tenantId,
      purpose,
      version: next,
      ...wrapKey(ctx.tenantId, purpose, next, kek),
      fingerprint: fingerprint(kek),
      state: 'ACTIVE',
      createdAt: d.now,
      createdBy: ctx.userId,
    })
    .returning();
  await d.audit.record(tx, ctx, {
    action: 'key.rotate',
    entityType: 'kms_key',
    entityId: row!.id,
    after: { purpose, version: next, fingerprint: row!.fingerprint },
  });
  return row!;
}

/** Disabling the only ACTIVE key for a purpose is refused: new data could not be sealed. */
export async function setKeyDisabled(
  tx: Tx,
  d: { audit: AuditService; now: Date },
  ctx: RequestContext,
  keyId: string,
  disable: boolean,
): Promise<KeyRow> {
  const [row] = await tx
    .select()
    .from(kmsKey)
    .where(and(eq(kmsKey.id, keyId), eq(kmsKey.tenantId, ctx.tenantId)));
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Key not found');
  if (disable) {
    if (row.state === 'DISABLED') throw new AppError(409, 'INVALID_STATE', 'This key is already disabled');
    if (row.state === 'ACTIVE') {
      const others = (await keyRows(tx, ctx.tenantId, row.purpose)).filter(
        (r) => r.id !== row.id && r.state === 'ACTIVE',
      );
      if (others.length === 0)
        throw new AppError(
          409,
          'LAST_ACTIVE_KEY',
          `This is the only active ${row.purpose} key. Rotate first, then disable the old version.`,
        );
    }
    const [u] = await tx
      .update(kmsKey)
      .set({ state: 'DISABLED', disabledAt: d.now, disabledBy: ctx.userId })
      .where(eq(kmsKey.id, row.id))
      .returning();
    await d.audit.record(tx, ctx, {
      action: 'key.disable',
      entityType: 'kms_key',
      entityId: row.id,
      before: { state: row.state },
      after: { state: 'DISABLED', purpose: row.purpose, version: row.version },
    });
    return u!;
  }
  if (row.state !== 'DISABLED') throw new AppError(409, 'INVALID_STATE', 'This key is not disabled');
  const [u] = await tx
    .update(kmsKey)
    .set({ state: 'RETIRED', disabledAt: null, disabledBy: null })
    .where(eq(kmsKey.id, row.id))
    .returning();
  await d.audit.record(tx, ctx, {
    action: 'key.enable',
    entityType: 'kms_key',
    entityId: row.id,
    before: { state: 'DISABLED' },
    after: { state: 'RETIRED', purpose: row.purpose, version: row.version },
  });
  // a retired key that is the newest version again becomes active only through rotation, never silently
  return u!;
}

/** A re-wrap pass over some family of stored envelopes: returns how many were moved, already current, or skipped. */
export interface RewrapResult {
  rewrapped: number;
  alreadyCurrent: number;
  skipped: number;
}
export type Rewrapper = (tx: Tx, tenantId: string, now: Date) => Promise<RewrapResult & { family: string }>;
export async function rewrapAll(
  tx: Tx,
  d: { audit: AuditService; now: Date },
  ctx: RequestContext,
  purpose: KeyPurpose,
  rewrappers: Rewrapper[],
) {
  const families: Array<RewrapResult & { family: string }> = [];
  for (const fn of rewrappers) families.push(await fn(tx, ctx.tenantId, d.now));
  const total = families.reduce((s, f) => s + f.rewrapped, 0);
  const active = await activeKey(tx, ctx.tenantId, purpose, d.now);
  await tx
    .update(kmsKey)
    .set({ rewrappedAt: d.now })
    .where(and(eq(kmsKey.id, active.id), eq(kmsKey.tenantId, ctx.tenantId)));
  await d.audit.record(tx, ctx, {
    action: 'key.rewrap',
    entityType: 'kms_key',
    entityId: active.id,
    after: { purpose, toVersion: active.version, rewrapped: total },
  });
  return { purpose, toVersion: active.version, rewrapped: total, families };
}

/** The first and last-used key versions seen in a set of envelope strings, for the evidence page. */
export function versionsIn(tokens: string[]): Record<number, number> {
  const out: Record<number, number> = {};
  for (const t of tokens) {
    try {
      const v = envelopeOf(t).kv;
      out[v] = (out[v] ?? 0) + 1;
    } catch {
      /* not an envelope */
    }
  }
  return out;
}
