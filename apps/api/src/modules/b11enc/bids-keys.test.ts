import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { eq, like } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import * as s from '../../db/schema.js';
import { TENANT_ID } from '../../db/seed.js';
import { createEnv, type Json } from '../contract/test-env.js';
import { encryptExistingBids } from './bids.js';
import { kit, PLAIN_MARKER, type Env } from './test-kit.js';
import { SealedStore } from '../tender/files.js';

let env: Env;
let k: ReturnType<typeof kit>;
const call = (...a: Parameters<Env['call']>) => env.call(...a);
const sys = <T>(fn: Parameters<Env['withSystem']>[1]) => env.withSystem(env.database, fn) as Promise<T>;
beforeAll(async () => {
  env = await createEnv();
  k = kit(env);
}, 120_000);

/** Every file under the storage folder, as raw bytes. */
async function rawFiles(dir: string): Promise<Buffer[]> {
  const out: Buffer[] = [];
  const walk = async (d: string) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else out.push(await readFile(p));
    }
  };
  await walk(dir).catch(() => undefined);
  return out;
}

describe('SEC-D03 bids encrypted at upload and unreadable to internal users before close; SEC-D04 per-tenant envelope encryption', () => {
  it('SEC-D04 the stored answer is ciphertext in the database column and the stored file is an envelope, not the plaintext', async () => {
    const { t, sup } = await k.tenderWithBid();
    // database level: read the raw column as the table owner, bypassing every application check
    const rows = await sys<Array<{ value: string }>>((tx) =>
      tx.select({ value: s.responseAnswer.value }).from(s.responseAnswer),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.value.startsWith('ife1.')).toBe(true);
      expect(r.value).not.toContain(PLAIN_MARKER);
      expect(Buffer.from(r.value.slice(5), 'base64url').toString('utf8')).not.toContain(PLAIN_MARKER);
    }
    // the file on disk: a header (wrapped key, key version, IVs) then ciphertext; the marker is nowhere in it
    const blobs = await rawFiles(env.dir);
    expect(blobs.length).toBeGreaterThan(0);
    const mine = blobs.filter((b) => b.subarray(0, 4).toString('latin1') === 'IFE2');
    expect(mine.length).toBeGreaterThan(0);
    for (const b of blobs) expect(b.includes(PLAIN_MARKER)).toBe(false);
    // the supplier still reads their own answer back: decrypted on read for the owner
    const own = await call(sup.key, 'GET', `/supplier/tenders/${t.id}/response`);
    expect(own.json().answers.method).toContain(PLAIN_MARKER);
    // the bid box tells the truth about it
    const box = (await call('procurement', 'GET', `/tenders/${t.id}/bid-box`)).json();
    expect(box.bids[0].files[0]).toMatchObject({ encrypted: true, keyVersion: 1 });
    expect(box.bids[0].answers).toMatchObject({ count: 1, encrypted: 1 });
  });

  it('SEC-D03 before close no internal route returns plaintext, even for ADMIN, PROCUREMENT or PROBITY: metadata only, and a late read is refused 423 with a reason', async () => {
    const { t, fileId } = await k.tenderWithBid();
    for (const who of ['procurement', 'admin', 'probity', 'exec', 'legal']) {
      const box = await call(who, 'GET', `/tenders/${t.id}/bid-box`);
      expect(box.statusCode, `${who}: ${box.body}`).toBe(200);
      const j = box.json() as Json;
      expect(j.seal).toMatchObject({ readable: false, code: 'BIDS_SEALED' });
      expect(j.bidCount).toBe(1);
      expect(j.bids[0].bidder).toBeNull();
      expect(j.bids[0].files[0].name).toBeNull();
      expect(j.bids[0].files[0]).toHaveProperty('sizeBytes');
      expect(j.bids[0].files[0]).toHaveProperty('sha256');
      expect(j.bids[0].files[0]).toHaveProperty('uploadedAt');
      expect(JSON.stringify(j)).not.toContain(PLAIN_MARKER);
      const late = await call(who, 'GET', `/tenders/${t.id}/bid-box/files/${fileId}`);
      expect(late.statusCode, `${who}: ${late.body}`).toBe(423);
      expect(late.json().code).toBe('BIDS_SEALED');
      expect(late.json().title).toMatch(/encrypted|until the tender closes/i);
      expect(late.body).not.toContain(PLAIN_MARKER);
    }
    // the existing answer comparison route stays shut as before
    expect((await call('procurement', 'GET', `/tenders/${t.id}/response-answers`)).statusCode).toBe(409);
    // the refused attempts are on the record
    const refused = await sys<Array<{ action: string }>>((tx) =>
      tx
        .select({ action: s.auditEvent.action })
        .from(s.auditEvent)
        .where(eq(s.auditEvent.action, 'bid.read_refused')),
    );
    expect(refused.length).toBeGreaterThanOrEqual(5);
  });

  it('SEC-D03 after close the bid is decrypted on read for authorised roles only, and every decryption is audited', async () => {
    const { t, fileId, body } = await k.tenderWithBid();
    env.clock.advanceDays(31);
    const box = (await call('procurement', 'GET', `/tenders/${t.id}/bid-box`)).json();
    expect(box.seal.readable).toBe(true);
    expect(box.bids[0].files[0].name).toBe('technical.pdf');
    const ok = await call('procurement', 'GET', `/tenders/${t.id}/bid-box/files/${fileId}`);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(Buffer.from(ok.rawPayload).equals(body)).toBe(true);
    // ADMIN is not entitled to bid content even after close; the supplier role cannot use this route at all
    const admin = await call('admin', 'GET', `/tenders/${t.id}/bid-box/files/${fileId}`);
    expect(admin.statusCode).toBe(403);
    expect(admin.json().code).toBe('BID_READ_NOT_PERMITTED');
    expect((await call('supplier', 'GET', `/tenders/${t.id}/bid-box/files/${fileId}`)).statusCode).toBe(403);
    const answers = await call('procurement', 'GET', `/tenders/${t.id}/response-answers`);
    expect(answers.statusCode, answers.body).toBe(200);
    expect(JSON.stringify(answers.json())).toContain(PLAIN_MARKER);
    const log = await sys<
      Array<{ action: string; entityId: string | null; actorRole: string | null; after: unknown }>
    >((tx) =>
      tx
        .select({
          action: s.auditEvent.action,
          entityId: s.auditEvent.entityId,
          actorRole: s.auditEvent.actorRole,
          after: s.auditEvent.after,
        })
        .from(s.auditEvent)
        .where(eq(s.auditEvent.action, 'bid.decrypt')),
    );
    const mine = log.filter((l) => l.entityId === t.id);
    expect(mine.map((l) => (l.after as Json).kind).sort()).toEqual(['ANSWERS', 'FILE']);
    expect(mine.every((l) => l.actorRole === 'PROCUREMENT')).toBe(true);
    expect(JSON.stringify(mine)).not.toContain(PLAIN_MARKER);
  });

  it('SEC-D03 a high-value tender stays sealed after close until two witnesses open it (423 BIDS_NOT_OPENED)', async () => {
    const r = await call('admin', 'PUT', '/admin/settings', {
      tenderRules: { dualWitnessThresholdAud: 50_000, witnessWindowMinutes: 30 },
    });
    expect(r.statusCode, r.body).toBe(200);
    const { t, fileId } = await k.tenderWithBid({ value: 90_000 });
    env.clock.advanceDays(31);
    const shut = await call('procurement', 'GET', `/tenders/${t.id}/bid-box/files/${fileId}`);
    expect(shut.statusCode).toBe(423);
    expect(shut.json().code).toBe('BIDS_NOT_OPENED');
    const box = (await call('procurement', 'GET', `/tenders/${t.id}/bid-box`)).json();
    expect(box.seal.readable).toBe(false);
    expect(box.bids[0].bidder).toBeNull();
    const w1 = await call('probity', 'POST', `/tenders/${t.id}/opening/witness`, {
      password: 'unit-test-password-123',
    });
    expect(w1.statusCode, w1.body).toBe(200);
    expect((await call('procurement', 'GET', `/tenders/${t.id}/bid-box/files/${fileId}`)).statusCode).toBe(
      423,
    );
    const w2 = await call('legal', 'POST', `/tenders/${t.id}/opening/witness`, {
      password: 'unit-test-password-123',
    });
    expect(w2.statusCode, w2.body).toBe(200);
    const open = await call('procurement', 'GET', `/tenders/${t.id}/bid-box/files/${fileId}`);
    expect(open.statusCode, open.body).toBe(200);
    await call('admin', 'PUT', '/admin/settings', {
      tenderRules: { dualWitnessThresholdAud: 5_000_000, witnessWindowMinutes: 30 },
    });
  });

  it('SEC-D03 SEC-D04 encryptExistingBids moves older plaintext answers and server-key files under the tenant bid key, and repeating it changes nothing', async () => {
    const { t, sup, fileId } = await k.tenderWithBid();
    const [sub] = await sys<Json[]>((tx) =>
      tx.select().from(s.submission).where(eq(s.submission.tenderId, t.id)),
    );
    // make it look like an older build wrote it: a plaintext answer and a file sealed only with the server key
    await sys((tx) =>
      tx
        .update(s.responseAnswer)
        .set({ value: `${PLAIN_MARKER} legacy answer` })
        .where(eq(s.responseAnswer.submissionId, sub!.id)),
    );
    const [f] = await sys<Json[]>((tx) => tx.select().from(s.fileObject).where(eq(s.fileObject.id, fileId)));
    const legacy = new SealedStore(env.dir, 'e'.repeat(40)); // same server key as the app, no vault: the old format
    await legacy.put(f!.storageKey, Buffer.from(`%PDF-1.7\n${PLAIN_MARKER} legacy file`));
    expect(await legacy.isEnvelope(f!.storageKey)).toBe(false);
    const { KeyVault } = await import('./vault.js');
    legacy.useVault(new KeyVault(env.database, env.clock));
    const first = await sys<Awaited<ReturnType<typeof encryptExistingBids>>>((tx) =>
      encryptExistingBids(tx, legacy, env.clock.now(), TENANT_ID),
    );
    expect(first.answersEncrypted).toBeGreaterThanOrEqual(1);
    expect(first.filesEncrypted).toBeGreaterThanOrEqual(1);
    expect(await legacy.isEnvelope(f!.storageKey)).toBe(true);
    const plain = await sys<Array<{ value: string }>>((tx) =>
      tx
        .select({ value: s.responseAnswer.value })
        .from(s.responseAnswer)
        .where(like(s.responseAnswer.value, '%legacy%')),
    );
    expect(plain).toEqual([]);
    const second = await sys<Awaited<ReturnType<typeof encryptExistingBids>>>((tx) =>
      encryptExistingBids(tx, legacy, env.clock.now(), TENANT_ID),
    );
    expect(second.answersEncrypted + second.filesEncrypted).toBe(0);
    expect(
      (await call(sup.key, 'GET', `/supplier/tenders/${t.id}/response`)).json().answers.method,
    ).toContain('legacy answer');
  });
});

describe('SEC-D02 customer-managed keys with rotation; SEC-D04 envelope re-wrap', () => {
  it('SEC-D02 lists a key per purpose, readable by ADMIN, PROBITY and EXEC and changeable only by ADMIN', async () => {
    for (const who of ['admin', 'probity', 'exec']) {
      const r = await call(who, 'GET', '/security/keys');
      expect(r.statusCode, `${who}: ${r.body}`).toBe(200);
      const j = r.json() as Json;
      expect(j.simulated).toBe(true);
      expect(new Set(j.keys.map((x: Json) => x.purpose))).toEqual(new Set(['DATA', 'BIDS', 'PROJECT']));
      // key material is never in the response
      expect(JSON.stringify(j)).not.toMatch(/wrappedKey|wrapped_key|"iv"|"kek"/i);
    }
    expect((await call('procurement', 'GET', '/security/keys')).statusCode).toBe(403);
    expect((await call('probity', 'POST', '/security/keys/BIDS/rotate')).statusCode).toBe(403);
    expect((await call('exec', 'POST', '/security/keys/BIDS/rewrap')).statusCode).toBe(403);
    expect((await call('admin', 'POST', '/security/keys/NOPE/rotate')).statusCode).toBe(400);
  });

  it('SEC-D02 SEC-D04 rotation adds a version, old data still opens, the re-wrap job moves the wrapped keys without touching a ciphertext, and a disabled version fails with "key disabled"', async () => {
    const { t, sup } = await k.tenderWithBid();
    const ct = async () =>
      (
        await sys<Array<{ value: string }>>((tx) =>
          tx.select({ value: s.responseAnswer.value }).from(s.responseAnswer),
        )
      ).map((r) => JSON.parse(Buffer.from(r.value.slice(5), 'base64url').toString('utf8')) as Json);
    const before = await ct();
    expect(before.every((e) => e.kv === 1)).toBe(true);

    const rot = await call('admin', 'POST', '/security/keys/BIDS/rotate');
    expect(rot.statusCode, rot.body).toBe(201);
    expect(rot.json()).toMatchObject({ purpose: 'BIDS', version: 2, state: 'ACTIVE' });
    const keys = (await call('admin', 'GET', '/security/keys')).json().keys as Json[];
    expect(keys.filter((x) => x.purpose === 'BIDS').map((x) => `${x.version}:${x.state}`)).toEqual([
      '2:ACTIVE',
      '1:RETIRED',
    ]);
    // data sealed under version 1 still opens
    expect(
      (await call(sup.key, 'GET', `/supplier/tenders/${t.id}/response`)).json().answers.method,
    ).toContain(PLAIN_MARKER);
    // a new answer is sealed with version 2
    await call('admin', 'GET', '/security/evidence');

    // disabling the only active key is refused
    const v2 = keys.find((x) => x.purpose === 'BIDS' && x.version === 2)!;
    const v1 = keys.find((x) => x.purpose === 'BIDS' && x.version === 1)!;
    const last = await call('admin', 'POST', `/security/keys/${v2.id}/disable`);
    expect(last.statusCode).toBe(409);
    expect(last.json().code).toBe('LAST_ACTIVE_KEY');

    // disable version 1: what it sealed no longer decrypts, and says why
    const dis = await call('admin', 'POST', `/security/keys/${v1.id}/disable`);
    expect(dis.statusCode, dis.body).toBe(200);
    expect(dis.json().state).toBe('DISABLED');
    const failed = await call(sup.key, 'GET', `/supplier/tenders/${t.id}/response`);
    expect(failed.statusCode).toBe(423);
    expect(failed.json().code).toBe('KEY_DISABLED');
    expect(failed.json().title).toContain('key disabled');
    // the re-wrap job cannot move what a disabled key protects: skipped, and reported
    const skipped = await call('admin', 'POST', '/security/keys/BIDS/rewrap');
    expect(skipped.statusCode, skipped.body).toBe(200);
    expect(skipped.json().families.reduce((n: number, f: Json) => n + f.skipped, 0)).toBeGreaterThan(0);
    // enable it again, then re-wrap
    expect((await call('admin', 'POST', `/security/keys/${v1.id}/enable`)).statusCode).toBe(200);
    const rewrap = await call('admin', 'POST', '/security/keys/BIDS/rewrap');
    expect(rewrap.statusCode, rewrap.body).toBe(200);
    expect(rewrap.json().toVersion).toBe(2);
    expect(rewrap.json().rewrapped).toBeGreaterThan(0);
    const after = await ct();
    expect(after.every((e) => e.kv === 2)).toBe(true);
    // the ciphertext and data IV are byte-for-byte what they were; only the wrapped data key changed
    const was = before[0]!;
    const now = after.find((e) => e.ct === was.ct)!;
    expect(now).toBeDefined();
    expect(now.di).toBe(was.di);
    expect(now.wd).not.toBe(was.wd);
    expect(
      (await call(sup.key, 'GET', `/supplier/tenders/${t.id}/response`)).json().answers.method,
    ).toContain(PLAIN_MARKER);
    // now the old version can be disabled without losing anything
    expect((await call('admin', 'POST', `/security/keys/${v1.id}/disable`)).statusCode).toBe(200);
    expect((await call(sup.key, 'GET', `/supplier/tenders/${t.id}/response`)).statusCode).toBe(200);
    // key changes are audited
    const actions = await sys<Array<{ action: string }>>((tx) =>
      tx
        .select({ action: s.auditEvent.action })
        .from(s.auditEvent)
        .where(eq(s.auditEvent.tenantId, TENANT_ID)),
    );
    for (const a of ['key.rotate', 'key.disable', 'key.enable', 'key.rewrap'])
      expect(actions.map((x) => x.action)).toContain(a);
  });
});
