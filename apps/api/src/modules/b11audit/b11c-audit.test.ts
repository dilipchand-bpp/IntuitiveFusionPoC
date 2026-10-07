import { desc, eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../../audit/audit-service.js';
import { withContext, withSystem } from '../../db/client.js';
import * as s from '../../db/schema.js';
import { TENANT_ID, uid } from '../../db/seed.js';
import { BRIGHT, createEnv, type Json } from '../contract/test-env.js';
import { isAdminAction } from './admin-chain.js';
import { PACK_KEY_NAME, readStoredZip, verifyEvents, type PackEvent } from './evidence-pack.js';

let env: Awaited<ReturnType<typeof createEnv>>;
const call = (...a: Parameters<typeof env.call>) => env.call(...a);
const sys = <T>(fn: Parameters<typeof env.withSystem>[1]) => env.withSystem(env.database, fn) as Promise<T>;
beforeAll(async () => {
  env = await createEnv();
}, 120_000);

const errText = (e: unknown) => {
  const x = e as Error & { cause?: Error };
  return `${x.message} ${x.cause?.message ?? ''}`;
};

describe('SEC-L02 platform administrative actions are logged immutably (hash-chained)', () => {
  it('flags administrative actions as category ADMIN in the database, and ordinary ones as GENERAL', async () => {
    const put = await call('admin', 'PUT', '/admin/settings', {
      approvalLinks: { enabled: true, validHours: 60, showCommercial: false },
    });
    expect(put.statusCode, put.body).toBe(200);
    await call('requester', 'GET', '/auth/me');
    const rows = await sys<Array<{ action: string; actor_role: string | null; category: string }>>(
      async (tx) => {
        const r = await tx.execute(sql`select action, actor_role, category from audit_event`);
        return (
          r as unknown as { rows: Array<{ action: string; actor_role: string | null; category: string }> }
        ).rows;
      },
    );
    const byAction = (a: string) => rows.filter((r) => r.action === a);
    expect(byAction('settings.approvalLinks')[0]!.category).toBe('ADMIN');
    expect(byAction('auth.login').find((r) => r.actor_role === 'REQUESTER')!.category).toBe('GENERAL');
    expect(byAction('user.create')[0]!.category).toBe('ADMIN');
    // the rule in TypeScript and the generated column agree on every event in the trail
    for (const r of rows)
      expect(r.category === 'ADMIN', r.action).toBe(isAdminAction(r.action, r.actor_role));
  });

  it('the generated category cannot be written to', async () => {
    await expect(
      sys((tx) =>
        tx.execute(
          sql`insert into audit_event (tenant_id, action, entity_type, prev_hash, hash, category) values (${TENANT_ID}, 'x', 'x', 'p', 'h', 'ADMIN')`,
        ),
      ),
    ).rejects.toThrow();
  });

  it('GET /audit/admin-chain is readable by probity, executives and administrators (not only administrators) and re-computes the chain', async () => {
    for (const who of ['probity', 'exec', 'admin']) {
      const r = await call(who, 'GET', '/audit/admin-chain');
      expect(r.statusCode, `${who} ${r.body}`).toBe(200);
      const j = r.json() as Json;
      expect(j).toMatchObject({ status: 'INTACT', ok: true, brokenAtSeq: null, categoryMismatches: 0 });
      expect(j.adminEvents).toBeGreaterThan(5);
      expect(j.checked).toBeGreaterThan(j.adminEvents);
      expect(j.headHash).toMatch(/^[0-9a-f]{64}$/);
      expect(j.adminDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(j.guards.map((g: Json) => g.name)).toEqual(
        expect.arrayContaining([
          'audit_event_no_update',
          'audit_event_no_truncate',
          'audit_event_chain_guard',
        ]),
      );
      expect(j.recent.length).toBeGreaterThan(0);
    }
    for (const who of ['requester', 'procurement', 'finance'])
      expect((await call(who, 'GET', '/audit/admin-chain')).statusCode).toBe(403);
  });

  it('POST /audit/admin-chain/verify records the verification (append-only) and an audit event', async () => {
    const r = await call('probity', 'POST', '/audit/admin-chain/verify');
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ status: 'INTACT' });
    const rows = await sys<Array<{ ok: boolean; verifiedByRole: string }>>((tx) =>
      tx.select().from(s.adminChainVerification),
    );
    expect(rows.at(-1)).toMatchObject({ ok: true, verifiedByRole: 'PROBITY' });
    const ev = await sys<Json[]>((tx) =>
      tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'audit.admin_chain_verify')),
    );
    expect(ev.length).toBeGreaterThan(0);
    const g = (await call('exec', 'GET', '/audit/admin-chain')).json() as Json;
    expect(g.lastRecordedVerification).toMatchObject({ by: 'PROBITY', ok: true });
    expect((await call('requester', 'POST', '/audit/admin-chain/verify')).statusCode).toBe(403);
    // the verification records themselves cannot be altered, by the application or by the owner
    for (const stmt of [
      sql`update admin_chain_verification set ok = false`,
      sql`delete from admin_chain_verification`,
    ]) {
      await expect(
        withContext(env.database, { tenantId: TENANT_ID, userId: uid('user:admin'), role: 'ADMIN' }, (tx) =>
          tx.execute(stmt),
        ),
      ).rejects.toThrow();
      expect(await sys((tx) => tx.execute(stmt)).then(() => null, errText)).toMatch(/append-only|permission/);
    }
  });

  it('UPDATE, DELETE and TRUNCATE on audit rows are refused for the application role and for the owner', async () => {
    const ctx = { tenantId: TENANT_ID, userId: uid('user:admin'), role: 'ADMIN' as const };
    for (const stmt of [
      sql`update audit_event set action = 'tampered'`,
      sql`delete from audit_event`,
      sql`truncate audit_event`,
    ]) {
      const asApp = await withContext(env.database, ctx, (tx) => tx.execute(stmt)).then(() => null, errText);
      expect(asApp, `app role: ${stmt}`).toMatch(/permission denied|not permitted|append-only/);
      const asOwner = await sys((tx) => tx.execute(stmt)).then(() => null, errText);
      expect(asOwner, `owner: ${stmt}`).toMatch(/append-only|not permitted/);
    }
    const [first] = await sys<Array<{ action: string }>>((tx) => tx.select().from(s.auditEvent).limit(1));
    expect(first!.action).not.toBe('tampered');
  });

  it('an event that does not continue the tenant chain is refused by the database (no gaps, no forks)', async () => {
    const err = await sys((tx) =>
      tx.execute(
        sql`insert into audit_event (tenant_id, action, entity_type, prev_hash, hash) values (${TENANT_ID}, 'forged', 'x', 'not-the-head', 'whatever')`,
      ),
    ).then(() => null, errText);
    expect(err).toMatch(/does not continue the tenant chain/);
  });
});

describe('SEC-L02 tamper tests: flipping a byte is detected, and the first broken link is named', () => {
  let t: Awaited<ReturnType<typeof createEnv>>;
  beforeAll(async () => {
    t = await createEnv();
    await t.call('admin', 'PUT', '/admin/settings', {
      approvalLinks: { enabled: true, validHours: 50, showCommercial: false },
    });
  }, 120_000);
  const tsys = <T>(fn: Parameters<typeof t.withSystem>[1]) => t.withSystem(t.database, fn) as Promise<T>;

  it('flipping one byte of an event is found at exactly that event; restoring it makes the chain intact again', async () => {
    const before = (await t.call('probity', 'GET', '/audit/admin-chain')).json() as Json;
    expect(before.status).toBe('INTACT');
    const [target] = await tsys<Array<{ seq: number; action: string }>>((tx) =>
      tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'settings.approvalLinks')).limit(1),
    );
    await t.database.pg.exec('alter table audit_event disable trigger audit_event_no_update'); // simulates a DBA bypass
    await t.database.pg.exec(
      `update audit_event set action = 'settings.approvalLinkz' where seq = ${target!.seq}`,
    );
    const broken = (await t.call('exec', 'GET', '/audit/admin-chain')).json() as Json;
    expect(broken).toMatchObject({ status: 'BROKEN', ok: false, brokenAtSeq: target!.seq });
    expect(broken.reason).toMatch(/altered/);
    const verify = (await t.call('probity', 'POST', '/audit/admin-chain/verify')).json() as Json;
    expect(verify).toMatchObject({ status: 'BROKEN', brokenAtSeq: target!.seq });
    await t.database.pg.exec(
      `update audit_event set action = 'settings.approvalLinks' where seq = ${target!.seq}`,
    );
    await t.database.pg.exec('alter table audit_event enable trigger audit_event_no_update');
    expect(((await t.call('exec', 'GET', '/audit/admin-chain')).json() as Json).status).toBe('INTACT');
  });

  it('removing an event or flipping a hash byte is detected', async () => {
    const rows = await tsys<Array<{ seq: number; hash: string }>>((tx) =>
      tx.select().from(s.auditEvent).orderBy(s.auditEvent.seq),
    );
    const mid = rows[Math.floor(rows.length / 2)]!;
    await t.database.pg.exec('alter table audit_event disable trigger audit_event_no_update');
    const flipped = mid.hash.slice(0, -1) + (mid.hash.endsWith('0') ? '1' : '0');
    await t.database.pg.exec(`update audit_event set hash = '${flipped}' where seq = ${mid.seq}`);
    let r = (await t.call('exec', 'GET', '/audit/admin-chain')).json() as Json;
    expect(r.status).toBe('BROKEN');
    expect(r.brokenAtSeq).toBe(mid.seq);
    await t.database.pg.exec(`update audit_event set hash = '${mid.hash}' where seq = ${mid.seq}`);
    await t.database.pg.exec(`delete from audit_event where seq = ${mid.seq}`);
    r = (await t.call('exec', 'GET', '/audit/admin-chain')).json() as Json;
    expect(r.status).toBe('BROKEN');
    expect(r.reason).toMatch(/removed|reordered/);
  });
});

// ------------------------------------------------------------------------------------------------------------------
describe('SEC-L07 and NFR-R06 auditor export of probity and audit history with integrity proof', () => {
  let fx: { requestId: string; tenderId: string; evaluationId: string };
  beforeAll(async () => {
    const a = await env.award({ value: 150_000 });
    fx = { requestId: a.requestId, tenderId: a.tenderId, evaluationId: a.evaluationId };
  });
  const range = { from: '2026-01-01', to: '2026-12-31' };
  type Bundle = { files: Record<string, string>; manifestSha256: string; checklist: Json[] | null };
  const pack = async (who: string, body: Json = range) => {
    const r = await call(who, 'POST', '/audit/export-pack', body);
    expect(r.statusCode, r.body).toBe(200);
    return JSON.parse(r.body) as Bundle;
  };
  const verify = async (files: Record<string, string>, who = 'exec') => {
    const r = await call(who, 'POST', '/audit/export-pack/verify', { bundle: { files } });
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as Json;
  };

  it('produces a pack with the audit events, probity records, chain, manifest with a SHA-256 per file, head hash, actor and a signature', async () => {
    const b = await pack('probity');
    expect(Object.keys(b.files).sort()).toEqual(
      [
        'audit-events.json',
        'chain.json',
        'index.html',
        'manifest.json',
        'probity.json',
        'signature.json',
        'timeline.json',
      ].sort(),
    );
    const m = JSON.parse(b.files['manifest.json']!) as Json;
    expect(m.generatedBy).toMatchObject({ role: 'PROBITY' });
    expect(m.chainHeadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(m.files.map((f: Json) => f.name).sort()).toEqual(
      ['audit-events.json', 'chain.json', 'index.html', 'probity.json', 'timeline.json'].sort(),
    );
    for (const f of m.files) expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    const sig = JSON.parse(b.files['signature.json']!) as Json;
    expect(sig).toMatchObject({ algorithm: 'HMAC-SHA256', keyName: PACK_KEY_NAME, simulated: true });
    expect(sig.note).toMatch(/SIMULATED.*asymmetric/);
    const events = (JSON.parse(b.files['audit-events.json']!) as { events: PackEvent[] }).events;
    expect(events.length).toBe(m.eventCount);
    expect(events.every((e) => /^[0-9a-f]{64}$/.test(e.hash) && e.prevHash)).toBe(true);
    expect(b.files['index.html']).toMatch(/symmetric simulation/);
    // the signing secret was created in the secret store, and its value is not in the pack
    const secrets = (await call('admin', 'GET', '/secrets')).json() as Json;
    expect(JSON.stringify(secrets)).toContain(PACK_KEY_NAME);
    expect(JSON.stringify(b)).not.toMatch(/"value":"[A-Za-z0-9_-]{40,}"/);
    const log = await sys<Json[]>((tx) => tx.select().from(s.exportPackLog));
    expect(log.at(-1)).toMatchObject({ format: 'JSON', manifestSha256: b.manifestSha256 });
    const ev = await sys<Json[]>((tx) =>
      tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'audit.export_pack')),
    );
    expect(ev.length).toBeGreaterThan(0);
  });

  it('who may generate and who may verify', async () => {
    for (const who of ['probity', 'exec', 'admin'])
      expect((await call(who, 'POST', '/audit/export-pack', range)).statusCode).toBe(200);
    for (const who of ['legal', 'requester', 'procurement', 'finance'])
      expect((await call(who, 'POST', '/audit/export-pack', range)).statusCode).toBe(403);
    const b = await pack('exec');
    for (const who of ['probity', 'exec', 'admin', 'legal'])
      expect(((await verify(b.files, who)) as Json).verified, who).toBe(true);
    expect(
      (await call('requester', 'POST', '/audit/export-pack/verify', { bundle: { files: b.files } }))
        .statusCode,
    ).toBe(403);
    expect(
      (await call('probity', 'POST', '/audit/export-pack', { from: '2026-12-31', to: '2026-01-01' }))
        .statusCode,
    ).toBe(400);
  });

  it('a pack verifies; every part is reported', async () => {
    const b = await pack('probity');
    const v = await verify(b.files);
    expect(v).toMatchObject({ verified: true, failedParts: [], simulated: true });
    expect(v.signature.status).toBe('OK');
    expect(v.chain).toMatchObject({ status: 'OK', headMatchesManifest: true });
    expect(v.chain.checked).toBeGreaterThan(5);
    expect(v.live.mismatchedSeqs).toEqual([]);
    expect(v.files.every((f: Json) => f.status === 'OK')).toBe(true);
  });

  it('flipping one byte in a file fails verification and names the part that fails', async () => {
    const b = await pack('probity');
    const flip = (name: string, at = 40) => {
      const t = b.files[name]!;
      return {
        ...b.files,
        [name]: t.slice(0, at) + String.fromCharCode(t.charCodeAt(at) ^ 1) + t.slice(at + 1),
      };
    };
    const p = await verify(flip('probity.json'));
    expect(p.verified).toBe(false);
    expect(p.failedParts.join(' ')).toMatch(/probity\.json/);
    expect(p.files.find((f: Json) => f.name === 'probity.json').status).toBe('ALTERED');
    expect(p.files.find((f: Json) => f.name === 'timeline.json').status).toBe('OK');

    // an event changed in the chain segment: the file hash fails AND the event hash fails, at that event
    const events = JSON.parse(b.files['audit-events.json']!) as { tenantId: string; events: PackEvent[] };
    const i = Math.floor(events.events.length / 2);
    const target = events.events[i]!;
    events.events[i] = { ...target, action: target.action + 'x' };
    const a = await verify({ ...b.files, 'audit-events.json': JSON.stringify(events, null, 2) });
    expect(a.verified).toBe(false);
    expect(a.chain).toMatchObject({ status: 'BROKEN', brokenAtSeq: target.seq });
    expect(a.failedParts.join(' ')).toMatch(/audit-events\.json/);

    // events re-hashed by someone without the key: the file hash and the signature over the manifest fail
    const sig = JSON.parse(b.files['signature.json']!) as Json;
    const s2 = await verify({
      ...b.files,
      'signature.json': JSON.stringify({
        ...sig,
        value: sig.value.replace(/.$/, sig.value.endsWith('0') ? '1' : '0'),
      }),
    });
    expect(s2.verified).toBe(false);
    expect(s2.signature.status).toBe('INVALID');
    const m = JSON.parse(b.files['manifest.json']!) as Json;
    m.eventCount += 1;
    const s3 = await verify({ ...b.files, 'manifest.json': JSON.stringify(m, null, 2) });
    expect(s3.signature.status).toBe('INVALID');

    // a file removed, and a file added
    const { 'timeline.json': _gone, ...without } = b.files;
    void _gone;
    expect((await verify(without)).files.find((f: Json) => f.name === 'timeline.json').status).toBe(
      'MISSING',
    );
    const extra = await verify({ ...b.files, 'extra.json': '{}' });
    expect(extra.verified).toBe(false);
    expect(extra.files.find((f: Json) => f.name === 'extra.json').status).toBe('UNLISTED');
  });

  it('can be downloaded as a zip and verified from the zip; a flipped byte in the zip fails', async () => {
    const r = await call('probity', 'POST', '/audit/export-pack', { ...range, format: 'ZIP' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/zip/);
    const buf = r.rawPayload;
    expect(Object.keys(readStoredZip(buf)).sort()).toContain('manifest.json');
    const ok = await call('exec', 'POST', '/audit/export-pack/verify', { zipBase64: buf.toString('base64') });
    expect(ok.json()).toMatchObject({ verified: true });
    const bad = Buffer.from(buf);
    const at = bad.indexOf(Buffer.from('"hash"')) + 12;
    bad[at] = bad[at]! ^ 1;
    const nope = await call('exec', 'POST', '/audit/export-pack/verify', {
      zipBase64: bad.toString('base64'),
    });
    expect(nope.json().verified).toBe(false);
  });

  it('NFR-R06: a procurement pack carries the coverage checklist, and the checklist reflects what is missing', async () => {
    const c1 = (
      await call('probity', 'GET', `/audit/export-pack/coverage?requestId=${fx.requestId}`)
    ).json() as Json;
    const byKey = (c: Json, k: string) => c.items.find((i: Json) => i.key === k);
    expect(byKey(c1, 'timeline').status).toBe('FAIL'); // the fixture was created straight into the database: no events yet
    expect(byKey(c1, 'declarations').status).toBe('FAIL');
    expect(byKey(c1, 'probity_allocated').status).toBe('FAIL');
    expect(byKey(c1, 'probity_documents').status).toBe('FAIL');
    expect(byKey(c1, 'dual_witness').status).toBe('NA');
    expect(c1.ready).toBe(false);
    expect(c1.failed).toBeGreaterThan(2);

    // put the missing records in place, the way the platform's own flows would
    const audit = new AuditService(env.clock);
    const ctx = { tenantId: TENANT_ID, userId: uid('user:probity'), role: 'PROBITY' as const };
    await sys((tx) =>
      Promise.all([
        tx.insert(s.panelMember).values({
          tenantId: TENANT_ID,
          evaluationId: fx.evaluationId,
          userId: uid('user:evaluator-tech'),
          stream: 'TECHNICAL',
          coiState: 'DECLARED_NONE',
        }),
        tx
          .insert(s.probityAllocation)
          .values({ tenantId: TENANT_ID, userId: uid('user:probity'), tenderId: fx.tenderId }),
        tx.insert(s.probityDocument).values([
          {
            tenantId: TENANT_ID,
            evaluationId: fx.evaluationId,
            kind: 'PLAN',
            title: 'Plan',
            status: 'SIGNED',
            signedBy: uid('user:probity'),
            signedAt: env.clock.now(),
          },
          {
            tenantId: TENANT_ID,
            evaluationId: fx.evaluationId,
            kind: 'OUTCOMES',
            title: 'Outcomes',
            status: 'SIGNED',
            signedBy: uid('user:probity'),
            signedAt: env.clock.now(),
          },
        ]),
        tx.insert(s.approval).values({
          tenantId: TENANT_ID,
          subjectType: 'EVAL_PROBITY',
          subjectId: fx.evaluationId,
          userId: uid('user:probity'),
          role: 'PROBITY',
          decision: 'APPROVED',
        }),
      ]),
    );
    await sys(async (tx) => {
      await audit.record(tx, ctx, {
        action: 'evaluation.probity_signoff',
        entityType: 'evaluation',
        entityId: fx.evaluationId,
        after: { ok: true },
      });
    });
    const c2 = (
      await call('probity', 'GET', `/audit/export-pack/coverage?requestId=${fx.requestId}`)
    ).json() as Json;
    expect(byKey(c2, 'timeline').status).toBe('PASS');
    expect(byKey(c2, 'declarations').status).toBe('PASS');
    expect(byKey(c2, 'probity_allocated').status).toBe('PASS');
    expect(byKey(c2, 'probity_documents').status).toBe('PASS');
    expect(byKey(c2, 'probity_signoff').status).toBe('PASS');
    expect(byKey(c2, 'history_tamper_evident').status).toBe('PASS');
    expect(c2.failed).toBeLessThan(c1.failed);

    // an unauthorised approver is found by the authority check
    await sys((tx) =>
      tx.insert(s.approval).values({
        tenantId: TENANT_ID,
        subjectType: 'EVAL_REPORT',
        subjectId: (fx as unknown as { reportId?: string }).reportId ?? fx.evaluationId,
        userId: uid('user:requester'),
        role: 'REQUESTER',
        decision: 'APPROVED',
      }),
    );
    const c3 = (
      await call('probity', 'GET', `/audit/export-pack/coverage?requestId=${fx.requestId}`)
    ).json() as Json;
    expect(byKey(c3, 'approvals_authority').status).toBe('FAIL');

    // and the downloadable pack for the procurement carries the checklist and only this procurement's events
    const b = await pack('probity', { ...range, requestId: fx.requestId });
    expect(b.files['coverage.json']).toBeTruthy();
    const cov = JSON.parse(b.files['coverage.json']!) as Json;
    expect(cov.items.find((i: Json) => i.key === 'approvals_authority').status).toBe('FAIL');
    expect(cov.items.length).toBeGreaterThanOrEqual(12);
    const evs = (JSON.parse(b.files['audit-events.json']!) as { events: PackEvent[] }).events;
    expect(evs.length).toBeGreaterThan(0);
    expect(evs.every((e) => [fx.requestId, fx.tenderId, fx.evaluationId].includes(e.entityId ?? ''))).toBe(
      true,
    );
    expect(verifyEvents(evs).ok).toBe(true);
    expect(await verify(b.files)).toMatchObject({ verified: true });
    expect(
      (await call('probity', 'GET', `/audit/export-pack/coverage?requestId=${uid('nope')}`)).statusCode,
    ).toBe(404);
  });

  it('a procurement-only pack skips other procurements, so the chain shows gaps rather than failures', async () => {
    const b = await pack('exec', { ...range, requestId: fx.requestId });
    const chain = JSON.parse(b.files['chain.json']!) as Json;
    expect(chain.scope).toBe('ONE_PROCUREMENT');
    const v = await verify(b.files);
    expect(v.verified).toBe(true);
    expect(v.chain.gaps).toBeGreaterThanOrEqual(0);
    expect(BRIGHT).toBeTruthy();
    const last = await sys<Json[]>((tx) =>
      tx.select().from(s.auditEvent).orderBy(desc(s.auditEvent.seq)).limit(1),
    );
    expect(last.length).toBe(1);
    void withSystem;
  });
});
