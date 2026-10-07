import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '@if/shared';
import { buildApp } from '../../app.js';
import * as s from '../../db/schema.js';
import { emailFor, seedDatabase, TENANT_ID, uid } from '../../db/seed.js';
import { freshDb, newClock } from '../../test-helpers.js';
import { createEnv, PASSWORD, type Json } from '../contract/test-env.js';
import { kit, type Env } from './test-kit.js';

let env: Env;
let k: ReturnType<typeof kit>;
const call = (...a: Parameters<Env['call']>) => env.call(...a);
const sys = <T>(fn: Parameters<Env['withSystem']>[1]) => env.withSystem(env.database, fn) as Promise<T>;
beforeAll(async () => {
  env = await createEnv();
  k = kit(env);
}, 120_000);

describe('SEC-D01 encrypted at rest: field encryption', () => {
  it('SEC-D01 supplier bank details are written encrypted with the tenant DATA key and still work for the checks that need the digits', async () => {
    const t = await k.stagedTender();
    await k.publish(t);
    const sup = await k.register(t.id, 'Bank Co');
    const put = await call(sup.key, 'PUT', '/supplier/profile/bank', {
      bsb: '062-000',
      account: '12345678',
      accountName: 'Bank Co Pty Ltd',
    });
    expect(put.statusCode, put.body).toBe(200);
    const [row] = await sys<Array<{ bank: unknown }>>((tx) =>
      tx.select({ bank: s.supplier.bank }).from(s.supplier).where(eq(s.supplier.id, sup.supplierId)),
    );
    const raw = JSON.stringify(row!.bank);
    expect(raw).toContain('"__enc":"ife1.');
    expect(raw).not.toContain('12345678');
    expect(raw).not.toContain('062-000');
    expect(raw).not.toContain('Bank Co Pty');
    // the response and the audit trail carry no number either
    expect(put.body).not.toContain('12345678');
    const audit = await sys<Array<{ after: unknown }>>((tx) =>
      tx
        .select({ after: s.auditEvent.after })
        .from(s.auditEvent)
        .where(eq(s.auditEvent.action, 'supplier.bank_update')),
    );
    expect(JSON.stringify(audit)).not.toContain('12345678');
  });

  it('SEC-D01 encrypt-existing moves plaintext bank details and a legal platform secret left in the settings, and repeating it changes nothing', async () => {
    const t = await k.stagedTender();
    await k.publish(t);
    const sup = await k.register(t.id, 'Legacy Bank Co');
    await sys((tx) =>
      tx
        .update(s.supplier)
        .set({ bank: { bsb: '123-456', account: '87654321', accountName: 'Legacy Pty' } })
        .where(eq(s.supplier.id, sup.supplierId)),
    );
    const st = await call('admin', 'PUT', '/admin/settings', {
      legalPlatform: {
        enabled: false,
        name: 'Legal platform',
        webhookSecret: 'legacy-shared-secret-value',
        simulateOutage: false,
      },
    });
    expect(st.statusCode, st.body).toBe(200);
    const before = (await call('admin', 'GET', '/security/evidence')).json() as Json;
    const bankBefore = before.fields.find((f: Json) => f.id === 'supplier.bank');
    expect(bankBefore.plaintext).toBeGreaterThanOrEqual(1);
    expect(before.fields.find((f: Json) => f.id.startsWith('tenant.config')).plaintext).toBe(1);

    const first = await call('admin', 'POST', '/security/encrypt-existing');
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().fields.bankEncrypted).toBeGreaterThanOrEqual(1);
    expect(first.json().fields.legalSecretMoved).toBe(1);
    const [row] = await sys<Array<{ bank: unknown }>>((tx) =>
      tx.select({ bank: s.supplier.bank }).from(s.supplier).where(eq(s.supplier.id, sup.supplierId)),
    );
    expect(JSON.stringify(row!.bank)).not.toContain('87654321');
    const secrets = (await call('admin', 'GET', '/secrets')).json() as Json;
    expect(JSON.stringify(secrets)).toContain('connector.legal.webhook');
    expect(JSON.stringify(secrets)).not.toContain('legacy-shared-secret-value');
    const second = await call('admin', 'POST', '/security/encrypt-existing');
    expect(second.json().fields).toMatchObject({ bankEncrypted: 0, legalSecretMoved: 0 });
    const after = (await call('admin', 'GET', '/security/evidence')).json() as Json;
    expect(after.fields.find((f: Json) => f.id === 'supplier.bank').plaintext).toBe(0);
    expect(after.fields.find((f: Json) => f.id.startsWith('tenant.config')).plaintext).toBe(0);
    expect((await call('procurement', 'POST', '/security/encrypt-existing')).statusCode).toBe(403);
  });
});

describe('SEC-D01 evidence page data: what is encrypted, measured; what is not evidenced here, said so', () => {
  it('SEC-D01 reports the registry of encrypted fields with counts measured from the database, key versions in use, and the honest not-evidenced items', async () => {
    await k.tenderWithBid();
    for (const who of ['admin', 'probity', 'exec']) {
      const r = await call(who, 'GET', '/security/evidence');
      expect(r.statusCode, `${who}: ${r.body}`).toBe(200);
    }
    expect((await call('procurement', 'GET', '/security/evidence')).statusCode).toBe(403);
    expect((await call('supplier', 'GET', '/security/evidence')).statusCode).toBe(403);
    const ev = (await call('admin', 'GET', '/security/evidence')).json() as Json;
    expect(ev.simulated).toBe(true);
    expect(ev.keyService.label).toMatch(/SIMULATED/);
    const ids = ev.fields.map((f: Json) => f.id);
    for (const id of [
      'response_answer.value',
      'file_object.blob',
      'supplier.bank',
      'user_mfa.secret',
      'secret_entry.ciphertext',
      'restricted_project.wrapped_dek',
    ])
      expect(ids, id).toContain(id);
    const answers = ev.fields.find((f: Json) => f.id === 'response_answer.value');
    expect(answers.encrypted).toBeGreaterThan(0);
    expect(answers.plaintext).toBe(0);
    expect(answers.versions['1']).toBeGreaterThan(0);
    const blobs = ev.fields.find((f: Json) => f.id === 'file_object.blob');
    expect(blobs.encrypted).toBeGreaterThan(0);
    expect(blobs.plaintext).toBe(0); // the seeded demonstration bids were migrated by the seed
    const mfa = ev.fields.find((f: Json) => f.id === 'user_mfa.secret');
    expect(mfa.plaintext).toBe(0);
    expect(ev.keys.find((x: Json) => x.purpose === 'BIDS' && x.version === 1).usedBy).toBeGreaterThan(0);
    expect(ev.summary.encryptedRows).toBeGreaterThan(0);
    // honesty: what the application cannot see is listed as not evidenced
    const text = ev.transport.notEvidencedHere.join(' ');
    expect(text).toMatch(/TLS termination/);
    expect(text).toMatch(/disk encryption/i);
    expect(text).toMatch(/SIMULATED/);
    expect(JSON.stringify(ev)).not.toMatch(/wrappedKey|wrapped_key|"kek"/);
  });

  it('SEC-D01 SEC-D02 key versions in use move after a rotation and a re-wrap', async () => {
    await k.tenderWithBid();
    expect((await call('admin', 'POST', '/security/keys/BIDS/rotate')).statusCode).toBe(201);
    const mid = (await call('admin', 'GET', '/security/evidence')).json() as Json;
    expect(mid.keys.find((x: Json) => x.purpose === 'BIDS' && x.version === 1).usedBy).toBeGreaterThan(0);
    expect(mid.keys.find((x: Json) => x.purpose === 'BIDS' && x.version === 2).usedBy).toBe(0);
    expect((await call('admin', 'POST', '/security/keys/BIDS/rewrap')).statusCode).toBe(200);
    const end = (await call('admin', 'GET', '/security/evidence')).json() as Json;
    expect(end.keys.find((x: Json) => x.purpose === 'BIDS' && x.version === 1).usedBy).toBe(0);
    expect(end.keys.find((x: Json) => x.purpose === 'BIDS' && x.version === 2).usedBy).toBeGreaterThan(0);
  });
});

describe('SEC-D01 encrypted in transit: HSTS and secure cookies, checked on the real responses', () => {
  it('SEC-D01 development: HSTS is sent, the cookie is HttpOnly and SameSite, and the page says Secure is not required here', async () => {
    const h = await env.app.inject({ method: 'GET', url: '/health' });
    expect(h.headers['strict-transport-security']).toMatch(/max-age=31536000/);
    const ev = (await call('exec', 'GET', '/security/evidence')).json() as Json;
    expect(ev.transport.mode).toBe('test');
    expect(ev.transport.hsts).toMatchObject({ present: true, productionRequirementMet: true });
    expect(ev.transport.cookie).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      secureRequiredHere: false,
    });
  });

  it('SEC-D01 production mode: HSTS with a year and sub-domains, and the session cookie is Secure, HttpOnly and SameSite', async () => {
    const database = await freshDb();
    const clock = newClock();
    await seedDatabase(database, { clock, password: PASSWORD });
    const dir = await mkdtemp(join(tmpdir(), 'if-prod-'));
    const app = await buildApp(
      loadConfig({
        NODE_ENV: 'production',
        SESSION_SECRET: 'p'.repeat(40),
        SECRET_STORE_KEY: 's'.repeat(40),
        STORAGE_DIR: dir,
      }),
      { database, clock, loginRateLimitMax: 100 },
    );
    try {
      const h = await app.inject({ method: 'GET', url: '/health' });
      expect(h.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains; preload');
      expect(h.headers['x-content-type-options']).toBe('nosniff');
      const login = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: emailFor('admin'), password: PASSWORD },
      });
      expect(login.statusCode, login.body).toBe(200);
      const cookies = login.cookies as Array<{
        name: string;
        secure?: boolean;
        httpOnly?: boolean;
        sameSite?: string;
      }>;
      expect(cookies.length).toBeGreaterThan(0);
      for (const c of cookies.filter((x) => x.name.includes('session') || x.name.includes('sid'))) {
        expect(c.secure, c.name).toBe(true);
        expect(c.httpOnly, c.name).toBe(true);
        expect(String(c.sameSite).toLowerCase(), c.name).toBe('lax');
      }
      expect(String(login.headers['set-cookie'])).toMatch(/Secure/);
      const ev = await app.inject({
        method: 'GET',
        url: '/api/v1/security/evidence',
        cookies: Object.fromEntries(login.cookies.map((c) => [c.name, c.value])),
      });
      expect(ev.statusCode, ev.body).toBe(200);
      expect(ev.json().transport).toMatchObject({
        mode: 'production',
        hsts: { productionRequirementMet: true },
        cookie: { secure: true, secureRequiredHere: true, productionRequirementMet: true },
      });
    } finally {
      await app.close();
      await database.close();
    }
  });
});

describe('NFR-R01 data stays within the tenancy; SEC-D10 isolation: the live check', () => {
  it('SEC-D10 POST /security/isolation-check reports the tables with tenant_id, which have row level security, and that no foreign row is visible; ADMIN only', async () => {
    expect((await call('procurement', 'POST', '/security/isolation-check')).statusCode).toBe(403);
    // another tenant with rows in the protected tables, so "nothing visible" is not just "nothing there"
    await sys(async (tx) => {
      const [t] = await tx
        .insert(s.tenant)
        .values({ slug: 'other-org', name: 'Other Org', sector: 'PRIVATE' })
        .returning();
      const [u] = await tx
        .insert(s.appUser)
        .values({ tenantId: t!.id, email: 'x@other.example', name: 'X', passwordHash: 'x' })
        .returning();
      await tx
        .insert(s.request)
        .values({ tenantId: t!.id, number: 'OTH-1', title: 'Other tenant request', requesterId: u!.id });
    });
    const r = await call('admin', 'POST', '/security/isolation-check');
    expect(r.statusCode, r.body).toBe(200);
    const j = r.json() as Json;
    expect(j.ok).toBe(true);
    expect(j.foreignRowsVisibleTotal).toBe(0);
    expect(j.tablesWithTenantId).toBeGreaterThan(50);
    expect(j.withRowLevelSecurity).toBeGreaterThanOrEqual(8);
    const names = j.rlsTables.map((x: Json) => x.table);
    for (const t of [
      'request',
      'plan',
      'tender',
      'evaluation',
      'contract',
      'kms_key',
      'quarantine_item',
      'file_object',
      'score',
    ])
      expect(names, t).toContain(t);
    expect(j.rlsTables.find((x: Json) => x.table === 'request')).toMatchObject({
      foreignRowsExist: 1,
      foreignRowsVisible: 0,
    });
    // honest about the rest: the tables protected by the application's tenant filter only are named
    expect(j.applicationFilteredOnly.length).toBeGreaterThan(10);
    expect(j.note).toMatch(/isolation\.test/);
    const audit = await sys<Array<{ action: string }>>((tx) =>
      tx
        .select({ action: s.auditEvent.action })
        .from(s.auditEvent)
        .where(eq(s.auditEvent.tenantId, TENANT_ID)),
    );
    expect(audit.map((a) => a.action)).toContain('security.isolation_check');
    void uid;
  });
});
