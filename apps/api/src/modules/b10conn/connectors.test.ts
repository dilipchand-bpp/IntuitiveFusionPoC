import { createHmac } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import * as s from '../../db/schema.js';
import { TENANT_ID } from '../../db/seed.js';
import { createEnv, type Json } from '../contract/test-env.js';
import { canonical } from '../b8/contract-b8.js';
import { CATALOGUE } from './catalogue.js';
import { callProvider, BREAKER } from './resilience.js';
import { decryptValue, encryptValue, readSecret } from './secrets.js';

let env: Awaited<ReturnType<typeof createEnv>>;
const call = (...a: Parameters<typeof env.call>) => env.call(...a);
const sys = <T>(fn: Parameters<typeof env.withSystem>[1]) => env.withSystem(env.database, fn) as Promise<T>;
beforeAll(async () => {
  env = await createEnv();
}, 120_000);

const put = async (kind: string, body: Json) => {
  const r = await call('admin', 'PUT', `/connectors/${kind}`, body);
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as Json;
};
const connector = async (kind: string) =>
  (
    await sys<Json[]>((tx) =>
      tx
        .select()
        .from(s.connector)
        .where(and(eq(s.connector.tenantId, TENANT_ID), eq(s.connector.kind, kind as never))),
    )
  )[0]!;
const addSupplier = (company: string, status: 'PENDING' | 'CLEAR' = 'PENDING') =>
  sys<Json>(async (tx) => {
    const n = Math.floor(Math.random() * 1e8);
    const [r] = await tx
      .insert(s.supplier)
      .values({
        tenantId: TENANT_ID,
        company,
        abn: `7${String(n).padStart(10, '0')}`,
        sanctionsStatus: status,
        insuranceStatus: 'CURRENT',
      })
      .returning();
    return r!;
  });
const supplierRow = (id: string) =>
  sys<Json>(async (tx) => (await tx.select().from(s.supplier).where(eq(s.supplier.id, id)))[0]!);

describe('NFR-C07 connector catalogue and health', () => {
  it("lists every supported provider per kind, all simulated, with this tenant's connectors and their health", async () => {
    const r = await call('procurement', 'GET', '/connectors');
    expect(r.statusCode, r.body).toBe(200);
    const v = r.json() as Json;
    expect(v.simulated).toBe(true);
    const ids = (kind: string) =>
      (v.catalogue as Json[]).find((k) => k.kind === kind)!.providers.map((x: Json) => x.id) as string[];
    expect(ids('ERP')).toEqual(expect.arrayContaining(['SAP', 'ORACLE', 'DYNAMICS']));
    expect(ids('ESIGN')).toEqual(expect.arrayContaining(['DOCUSIGN', 'ADOBE']));
    expect(ids('DOCREPO')).toContain('SHAREPOINT');
    expect(ids('MIDDLEWARE')).toEqual(expect.arrayContaining(['MULESOFT', 'BOOMI']));
    expect(CATALOGUE.flatMap((k) => k.providers).every((p) => p.simulated)).toBe(true);
    const by = (kind: string) => (v.connectors as Json[]).find((c) => c.kind === kind)!;
    // enabled where the application already simulates the system
    expect(by('LEGAL')).toMatchObject({ enabled: true, mode: 'UP', provider: 'SIMULATED_LEGAL' });
    expect(by('SANCTIONS')).toMatchObject({ enabled: true });
    expect(by('HR').enabled).toBe(false);
    expect(by('SANCTIONS').health).toMatchObject({ state: 'HEALTHY', breaker: { state: 'CLOSED' } });
    expect(by('SANCTIONS').secret).toMatchObject({ set: false });
    for (const who of ['admin', 'finance', 'legal', 'exec'])
      expect((await call(who, 'GET', '/connectors')).statusCode, who).toBe(200);
    for (const who of ['requester', 'evaluator-tech', 'contract-mgr', 'supplier'])
      expect((await call(who, 'GET', '/connectors')).statusCode, who).toBe(403);
  });

  it('only an administrator changes a connector; the provider must be in the catalogue; the config holds no secrets; every change is audited', async () => {
    expect((await call('procurement', 'PUT', '/connectors/ERP', { provider: 'SAP' })).statusCode).toBe(403);
    const bad = await call('admin', 'PUT', '/connectors/ERP', { provider: 'NOT_A_SYSTEM' });
    expect(bad.statusCode).toBe(422);
    const leaky = await call('admin', 'PUT', '/connectors/ERP', { config: { apiKey: 'abc123abc123abc123' } });
    expect(leaky.statusCode).toBe(400);
    expect(JSON.stringify(leaky.json())).toMatch(/secret store/);
    expect((await call('admin', 'PUT', '/connectors/ERP', { config: { password: 'x' } })).statusCode).toBe(
      400,
    );
    const ok = await put('ERP', {
      provider: 'SAP',
      config: { baseUrl: 'https://sap.example.invalid', secretName: 'connector.erp.api' },
    });
    expect(ok).toMatchObject({ kind: 'ERP', provider: 'SAP', providerLabel: 'SAP S/4HANA', simulated: true });
    expect(ok.config.secretName).toBe('connector.erp.api');
    await put('ERP', { enabled: false });
    expect((await connector('ERP')).enabled).toBe(false);
    await put('ERP', { enabled: true, provider: 'ORACLE' });
    const erp = await connector('ERP');
    const trail = await sys<Json[]>((tx) =>
      tx.select().from(s.auditEvent).where(eq(s.auditEvent.entityId, erp.id)),
    );
    expect(trail.filter((e) => e.action === 'connector.update').length).toBeGreaterThanOrEqual(3);
  });
});

describe('SEC-N03 secret store with rotation', () => {
  const NAME = 'connector.middleware.webhook';
  it('encrypts a value, rotates it to a new version, retires the old one, and never returns or audits the value', async () => {
    const v1 = 'first-shared-secret-value-0001';
    const r1 = await call('admin', 'PUT', `/secrets/${NAME}`, { value: v1 });
    expect(r1.statusCode, r1.body).toBe(200);
    expect(r1.json()).toMatchObject({ name: NAME, version: 1 });
    expect(r1.json().fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(r1.body).not.toContain(v1);
    const v2 = 'second-shared-secret-value-02';
    const r2 = await call('admin', 'PUT', `/secrets/${NAME}`, { value: v2 });
    expect(r2.json()).toMatchObject({ version: 2 });
    expect(r2.json().fingerprint).not.toBe(r1.json().fingerprint);
    const list = await call('admin', 'GET', '/secrets');
    expect(list.statusCode).toBe(200);
    expect(list.body).not.toContain(v1);
    expect(list.body).not.toContain(v2);
    const meta = (list.json().secrets as Json[]).find((x) => x.name === NAME)!;
    expect(meta).toMatchObject({ version: 2, versions: 2 });
    expect(Object.keys(meta).sort()).toEqual(['fingerprint', 'lastRotatedAt', 'name', 'version', 'versions']);
    // stored encrypted, the old version retired, the current one readable only on the server
    const rows = await sys<Json[]>((tx) =>
      tx.select().from(s.secretEntry).where(eq(s.secretEntry.name, NAME)),
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((x) => !x.ciphertext.includes(v1) && !x.ciphertext.includes(v2))).toBe(true);
    expect(rows.find((x) => x.version === 1)!.retiredAt).not.toBeNull();
    expect(rows.find((x) => x.version === 2)!.retiredAt).toBeNull();
    expect(await sys((tx) => readSecret(tx, TENANT_ID, NAME))).toBe(v2);
    // audited without the value
    const trail = JSON.stringify(
      await sys<Json[]>((tx) => tx.select().from(s.auditEvent).where(eq(s.auditEvent.entityType, 'secret'))),
    );
    expect(trail).toContain('secret.rotate');
    expect(trail).not.toContain(v1);
    expect(trail).not.toContain(v2);
    // a connector shows the secret's name and fingerprint, not its value
    const conn = (await call('admin', 'GET', '/connectors'))
      .json()
      .connectors.find((c: Json) => c.kind === 'MIDDLEWARE');
    expect(conn.secret).toMatchObject({ set: true, version: 2 });
    // administrators only, and a bad name or a too-short value is refused
    expect((await call('procurement', 'GET', '/secrets')).statusCode).toBe(403);
    expect((await call('procurement', 'PUT', `/secrets/${NAME}`, { value: v2 })).statusCode).toBe(403);
    expect((await call('admin', 'PUT', `/secrets/${NAME}`, { value: 'short' })).statusCode).toBe(400);
    expect(
      (await call('admin', 'PUT', '/secrets/-bad name', { value: v2 })).statusCode,
    ).toBeGreaterThanOrEqual(400);
  });

  it('binds a ciphertext to its tenant, name and version, so a copied row does not decrypt', () => {
    const enc = encryptValue('a-value-to-protect', TENANT_ID, 'one', 1);
    expect(decryptValue(enc, TENANT_ID, 'one', 1)).toBe('a-value-to-protect');
    expect(() => decryptValue(enc, TENANT_ID, 'two', 1)).toThrow();
    expect(() => decryptValue(enc, TENANT_ID, 'one', 2)).toThrow();
  });

  it('is where the legal platform shared secret is read from, with the old setting as the fallback', async () => {
    const oldSecret = 'legacy-setting-secret-0001';
    const newSecret = 'store-secret-for-legal-0001';
    const r = await call('admin', 'PUT', '/admin/settings', {
      legalPlatform: { enabled: true, name: 'HighQ', webhookSecret: oldSecret, simulateOutage: false },
    });
    expect(r.statusCode, r.body).toBe(200);
    const m = await call('legal', 'POST', '/legal/matters', {
      title: 'Secret store matter',
      priority: 'NORMAL',
    });
    expect(m.json().externalRef).toMatch(/^HIGH-/);
    const send = (key: string, eventId: string) => {
      const payload = {
        eventId,
        matterRef: m.json().externalRef as string,
        stage: 'In review',
        redlines: [],
      };
      return env.app.inject({
        method: 'POST',
        url: '/api/v1/integrations/legal/webhook',
        headers: { 'x-signature': createHmac('sha256', key).update(canonical(payload)).digest('hex') },
        payload,
      });
    };
    expect((await send(oldSecret, 'evt-store-01')).statusCode).toBe(200); // fallback to the setting
    await call('admin', 'PUT', '/secrets/connector.legal.webhook', { value: newSecret });
    expect((await send(oldSecret, 'evt-store-02')).statusCode).toBe(401); // the store now wins
    expect((await send(newSecret, 'evt-store-03')).statusCode).toBe(200);
  });
});

describe('NFR-C05 resilient API layer for sanctions and insurance verification', () => {
  it('matches a synthetic watchlist name, and a company that is not on it is clear, with the insurer confirming cover', async () => {
    const bad = await addSupplier('Sanctioned Holdings Pty Ltd');
    const good = await addSupplier('Friendly Cleaning Pty Ltd');
    const a = (await call('procurement', 'POST', `/suppliers/${bad.id}/verification`)).json() as Json;
    expect(a.sanctions).toMatchObject({ state: 'MATCH', label: 'MATCH' });
    expect((await supplierRow(bad.id)).sanctionsStatus).toBe('MATCH');
    const b = (await call('procurement', 'POST', `/suppliers/${good.id}/verification`)).json() as Json;
    expect(b.sanctions.state).toBe('CLEAR');
    expect(b.insurance).toMatchObject({ state: 'VERIFIED' });
    expect(b.insurance.coverAud).toBeGreaterThan(0);
    expect((await supplierRow(good.id)).sanctionsStatus).toBe('CLEAR');
    const lapsed = await addSupplier('Lapsed Cover Pty Ltd');
    expect(
      (await call('procurement', 'POST', `/suppliers/${lapsed.id}/verification`)).json().insurance.state,
    ).toBe('EXPIRED');
    expect((await call('requester', 'POST', `/suppliers/${good.id}/verification`)).statusCode).toBe(403);
  });

  it('answers UNVERIFIED (provider unavailable), never CLEAR, when the connector is DOWN, and opens the breaker after repeated failures', async () => {
    const sup = await addSupplier('Patient Pty Ltd', 'PENDING');
    await put('SANCTIONS', { mode: 'DOWN' });
    await put('INSURANCE', { mode: 'DOWN' });
    const r = (await call('procurement', 'POST', `/suppliers/${sup.id}/verification`)).json() as Json;
    expect(r.sanctions).toMatchObject({ state: 'UNVERIFIED', label: 'UNVERIFIED (provider unavailable)' });
    expect(r.insurance).toMatchObject({ state: 'UNVERIFIED', label: 'UNVERIFIED (provider unavailable)' });
    const row = await supplierRow(sup.id);
    expect(row.sanctionsStatus).toBe('PENDING');
    expect(row.sanctionsStatus).not.toBe('CLEAR');
    expect(row.sanctionsNote).toMatch(/UNVERIFIED/);
    // each verification is one failure; the third opens the breaker and the next call is not even tried
    await call('procurement', 'POST', `/suppliers/${sup.id}/verification`);
    const third = (await call('procurement', 'POST', `/suppliers/${sup.id}/verification`)).json() as Json;
    expect(third.sanctions.breaker).toBe('OPEN');
    const fourth = (await call('procurement', 'POST', `/suppliers/${sup.id}/verification`)).json() as Json;
    expect(fourth.sanctions.state).toBe('UNVERIFIED');
    expect(fourth.sanctions.note).toMatch(/circuit breaker/);
    const view = (await call('admin', 'GET', '/connectors'))
      .json()
      .connectors.find((c: Json) => c.kind === 'SANCTIONS');
    expect(view.health).toMatchObject({ state: 'DOWN', breaker: { state: 'OPEN' } });
    expect(view.health.lastError).toBeTruthy();
  });

  it('runs a health check that shows the breaker state, half-opens after the cool-down and closes on success', async () => {
    const t1 = (await call('procurement', 'POST', '/connectors/SANCTIONS/test')).json() as Json;
    expect(t1).toMatchObject({ ok: false, breaker: 'OPEN', reason: 'BREAKER_OPEN' });
    // the person puts it back up and closes the breaker
    await put('SANCTIONS', { mode: 'UP' });
    const t2 = (await call('procurement', 'POST', '/connectors/SANCTIONS/test')).json() as Json;
    expect(t2).toMatchObject({ ok: true, breaker: 'CLOSED', simulated: true });
    expect(t2.health.state).toBe('HEALTHY');
    // fail it three times, then it recovers by itself: OPEN, then after the cool-down one trial call (HALF_OPEN) closes it
    await put('SANCTIONS', { mode: 'DOWN' });
    for (let i = 0; i < BREAKER.failureThreshold; i += 1)
      await call('admin', 'POST', '/connectors/SANCTIONS/test');
    expect((await connector('SANCTIONS')).breakerState).toBe('OPEN');
    await sys((tx) =>
      tx
        .update(s.connector)
        .set({ mode: 'UP' })
        .where(and(eq(s.connector.tenantId, TENANT_ID), eq(s.connector.kind, 'SANCTIONS'))),
    );
    expect((await call('admin', 'POST', '/connectors/SANCTIONS/test')).json().breaker).toBe('OPEN');
    env.clock.advanceMs(BREAKER.cooldownMs + 1000);
    const t3 = (await call('admin', 'POST', '/connectors/SANCTIONS/test')).json() as Json;
    expect(t3).toMatchObject({ ok: true, breaker: 'CLOSED' });
    expect((await call('requester', 'POST', '/connectors/SANCTIONS/test')).statusCode).toBe(403);
    await put('INSURANCE', { mode: 'UP' });
  });

  it('retries with backoff on the injected clock, gives up after the bound, times out, and falls back', async () => {
    const waits: number[] = [];
    const sleep = async (ms: number) => void waits.push(ms);
    await put('ESIGN', { mode: 'UP' });
    const outcome = await sys<Awaited<ReturnType<typeof callProvider<string>>>>((tx) => {
      let n = 0;
      return callProvider(
        tx,
        { clock: env.clock, sleep },
        TENANT_ID,
        'ESIGN',
        async () => {
          n += 1;
          if (n < 3) throw new Error('flaky');
          return 'signed';
        },
        { fallback: () => 'fallback' },
      );
    });
    expect(outcome).toMatchObject({ ok: true, value: 'signed', attempts: 3 });
    expect(waits).toEqual([100, 200]);
    const gone = await sys<Awaited<ReturnType<typeof callProvider<string>>>>((tx) =>
      callProvider(
        tx,
        { clock: env.clock, sleep },
        TENANT_ID,
        'ESIGN',
        async () => {
          throw new Error('always down');
        },
        { fallback: () => 'fallback', retries: 1 },
      ),
    );
    expect(gone).toMatchObject({ ok: false, value: 'fallback', attempts: 2, reason: 'ERROR' });
    const slow = await sys<Awaited<ReturnType<typeof callProvider<string>>>>((tx) =>
      callProvider(
        tx,
        { clock: env.clock, sleep },
        TENANT_ID,
        'ESIGN',
        () => new Promise<string>(() => undefined),
        {
          fallback: () => 'fallback',
          retries: 0,
          timeoutMs: 20,
        },
      ),
    );
    expect(slow).toMatchObject({ ok: false, reason: 'TIMEOUT', value: 'fallback' });
    await sys((tx) =>
      tx
        .update(s.connector)
        .set({ consecutiveFailures: 0, breakerState: 'CLOSED' })
        .where(and(eq(s.connector.tenantId, TENANT_ID), eq(s.connector.kind, 'ESIGN'))),
    ); // clear what the failures left on the breaker
  });

  it('turns a contract re-check warning, not a pass, when sanctions cannot be checked', async () => {
    await put('SANCTIONS', { mode: 'DOWN' });
    const d = await env.draft();
    const re = (await call('legal', 'POST', `/contracts/${d.id}/recheck`)).json() as Json;
    const sanctions = re.checks.recheck.find((x: Json) => x.key === 'SANCTIONS');
    expect(sanctions.result).toBe('WARN');
    expect(sanctions.detail).toMatch(/UNVERIFIED \(provider unavailable\)/);
    await put('SANCTIONS', { mode: 'UP' });
    const again = (await call('legal', 'POST', `/contracts/${d.id}/recheck`)).json() as Json;
    expect(again.checks.recheck.find((x: Json) => x.key === 'SANCTIONS').result).toBe('PASS');
  });

  it('keeps a self-registering supplier pending, not clear, while the screening provider is down', async () => {
    await put('SANCTIONS', { mode: 'DOWN' });
    const abn = (() => {
      for (let n = 41_000_000; ; n += 1) {
        for (let c = 10; c < 100; c += 1) {
          const abn = `${c}${String(n).padStart(9, '0')}`;
          const w = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
          const sum = [...abn].reduce((a, ch, i) => a + (i === 0 ? Number(ch) - 1 : Number(ch)) * w[i]!, 0);
          if (sum % 89 === 0) return abn;
        }
      }
    })();
    const res = await env.app.inject({
      method: 'POST',
      url: '/api/v1/supplier/register',
      payload: {
        name: 'Pat Contact',
        email: 'pat@unverified-reg.example',
        company: 'Unverified Registration Pty Ltd',
        abn,
        password: 'a-long-enough-password-1',
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const row = await supplierRow(res.json().supplierId);
    expect(row.sanctionsStatus).toBe('PENDING');
    expect(row.sanctionsNote).toMatch(/UNVERIFIED/);
    await put('SANCTIONS', { mode: 'UP' });
  });
});
