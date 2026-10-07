/**
 * NFR-L03: signature capability aligned to eIDAS levels (SES, AES, QES) in the contract signing flow.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { codeAt, newSecret, sealSecret, stepOf } from '../../auth/totp.js';
import * as s from '../../db/schema.js';
import { TENANT_ID, uid } from '../../db/seed.js';
import { PASSWORD, createEnv, type Json } from '../contract/test-env.js';
import { qtsp, isQualifiedProvider, ADAPTERS } from '../b10x/esign-adapters.js';
import {
  contentDigest,
  levelOf,
  meetsLevel,
  requiredLevelFor,
  tooLowMessage,
  userAgentClass,
} from './eidas.js';

let env: Awaited<ReturnType<typeof createEnv>>;
const call = (...a: Parameters<typeof env.call>) => env.call(...a);
const sys = <T>(fn: Parameters<typeof env.withSystem>[1]) => env.withSystem(env.database, fn) as Promise<T>;
const SESSION_SECRET = 'e'.repeat(40);
const mfaSecret = newSecret();

beforeAll(async () => {
  env = await createEnv();
  // the delegate signs in first, then gets an authenticator app (a password sign-in would now ask for a code)
  expect((await call('delegate', 'GET', '/auth/me')).statusCode).toBe(200);
  await sys((tx) =>
    tx.insert(s.userMfa).values({
      userId: uid('user:delegate'),
      tenantId: TENANT_ID,
      secret: sealSecret(mfaSecret, SESSION_SECRET),
      confirmed: true,
    }),
  );
}, 120_000);

async function setSignatures(cfg: Json) {
  const r = await call('admin', 'PUT', '/admin/settings', { signatures: cfg });
  expect(r.statusCode, r.body).toBe(200);
}
async function released(value = 120_000) {
  const d = await env.draft({ value });
  await call('legal', 'PUT', `/contracts/${d.id}/clauses/IP`, { text: 'Legal reviewed wording for IP.' });
  const r = await call('legal', 'POST', `/contracts/${d.id}/release-for-signing`);
  expect(r.statusCode, r.body).toBe(200);
  return d;
}
const level = async (id: string) =>
  (await call('legal', 'GET', `/contracts/${id}/signature-level`)).json() as Json;
const evidence = async (id: string) =>
  (await call('legal', 'GET', `/contracts/${id}/signature-evidence`)).json() as Json;
// each code can be used once, so the clock moves on a step for every new one (sessions survive half a minute)
const code = () => {
  env.clock.advanceMs(31_000);
  return codeAt(mfaSecret, stepOf(env.clock.now()));
};

describe('NFR-L03 the level rules (pure)', () => {
  it('ranks SES below AES below QES and rates each method', () => {
    expect(meetsLevel('QES', 'AES')).toBe(true);
    expect(meetsLevel('AES', 'AES')).toBe(true);
    expect(meetsLevel('SES', 'AES')).toBe(false);
    expect(levelOf('SESSION')).toBe('SES');
    expect(levelOf('PASSWORD')).toBe('SES');
    expect(levelOf('PROVIDER')).toBe('SES');
    expect(levelOf('PASSWORD_MFA')).toBe('AES');
    expect(levelOf('QTSP')).toBe('QES');
  });
  it('takes the required level from Legal on the contract, else the highest value tier reached, else the default', () => {
    const cfg = {
      defaultLevel: 'SES' as const,
      requiredLevelByValue: [
        { fromAud: 100_000, level: 'AES' as const },
        { fromAud: 1_000_000, level: 'QES' as const },
      ],
    };
    expect(requiredLevelFor(cfg, 50_000, null)).toMatchObject({ level: 'SES', basis: 'DEFAULT' });
    expect(requiredLevelFor(cfg, 100_000, null)).toMatchObject({ level: 'AES', basis: 'VALUE_TIER' });
    expect(requiredLevelFor(cfg, 2_000_000, null)).toMatchObject({ level: 'QES', basis: 'VALUE_TIER' });
    expect(requiredLevelFor(cfg, 2_000_000, { level: 'SES', reason: 'Low-risk renewal' })).toMatchObject({
      level: 'SES',
      basis: 'CONTRACT_OVERRIDE',
    });
  });
  it('explains what to do when a signature is below the required level', () => {
    const msg = tooLowMessage(
      { level: 'AES', basis: 'VALUE_TIER', detail: 'Contracts of $100,000 or more need AES' },
      'SES',
    );
    expect(msg).toMatch(/authenticator/);
    expect(msg).toMatch(/AES/);
    expect(tooLowMessage({ level: 'QES', basis: 'DEFAULT', detail: 'x' }, 'AES')).toMatch(
      /qualified trust service provider/,
    );
  });
  it('classes the browser, not the person', () => {
    expect(userAgentClass('Mozilla/5.0 (Windows NT 10.0) Chrome/120')).toBe('BROWSER_DESKTOP');
    expect(userAgentClass('Mozilla/5.0 (iPhone) Mobile Safari')).toBe('BROWSER_MOBILE');
    expect(userAgentClass('esign-provider-callback')).toBe('SERVICE');
    expect(userAgentClass(undefined)).toBe('UNKNOWN');
  });
  it('the simulated qualified provider is the only qualified one', () => {
    expect(qtsp.qualified).toBe(true);
    expect(isQualifiedProvider('SIMULATED_QTSP')).toBe(true);
    expect(isQualifiedProvider('DOCUSIGN')).toBe(false);
    expect(isQualifiedProvider('ADOBE')).toBe(false);
    expect(ADAPTERS.SIMULATED_QTSP.id).toBe('SIMULATED_QTSP');
  });
});

describe('NFR-L03 SES: the existing signing flow is a simple electronic signature', () => {
  it('signing as before reaches SES, and the stamp, chain and evidence say so, with the document hash', async () => {
    await setSignatures({ defaultLevel: 'SES', requiredLevelByValue: [] });
    const d = await released();
    const r = await call('delegate', 'POST', `/contracts/${d.id}/sign`, { decision: 'APPROVE' });
    expect(r.statusCode, r.body).toBe(200);
    const view = r.json() as Json;
    expect(view.signatures[0].stamp).toMatch(
      /^SIGNED · Dana Okafor · DELEGATE · .* UTC · SES · hash [0-9a-f]{12}$/,
    );
    const l = await level(d.id);
    expect(l.required).toMatchObject({ level: 'SES', basis: 'DEFAULT' });
    expect(l.chain[0]).toMatchObject({ role: 'DELEGATE', signed: true, level: 'SES' });
    const ev = l.chain[0].evidence as Json;
    expect(ev).toMatchObject({
      signer: 'Dana Okafor',
      method: 'SESSION',
      level: 'SES',
      requiredLevel: 'SES',
      algorithm: 'SHA-256',
      integrity: 'INTACT',
    });
    expect(ev.documentDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(ev.signedAt).toMatch(/^2026-/);
    expect(ev.userAgentClass).toBeTruthy();
    expect(view.signatures[0].stamp).toContain(ev.documentDigest.slice(0, 12));
  });

  it('entering the password again is still SES; a wrong password is refused and nothing is signed', async () => {
    const d = await released();
    const bad = await call('delegate', 'POST', `/contracts/${d.id}/sign`, {
      decision: 'APPROVE',
      method: 'PASSWORD',
      password: 'not-the-password-123',
    });
    expect(bad.statusCode).toBe(403);
    expect(bad.json().code).toBe('SIGNATURE_REAUTH_FAILED');
    expect((await level(d.id)).chain[0].signed).toBe(false);
    const ok = await call('delegate', 'POST', `/contracts/${d.id}/sign`, {
      decision: 'APPROVE',
      method: 'PASSWORD',
      password: PASSWORD,
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await level(d.id)).chain[0].evidence).toMatchObject({ method: 'PASSWORD', level: 'SES' });
  });
});

describe('NFR-L03 refusal below the required level', () => {
  it('a value tier of AES refuses a simple signature with 422 SIGNATURE_LEVEL_TOO_LOW and says what to do', async () => {
    await setSignatures({ defaultLevel: 'SES', requiredLevelByValue: [{ fromAud: 100_000, level: 'AES' }] });
    const d = await released(150_000);
    expect((await level(d.id)).required).toMatchObject({ level: 'AES', basis: 'VALUE_TIER' });
    for (const body of [
      { decision: 'APPROVE' },
      { decision: 'APPROVE', method: 'PASSWORD', password: PASSWORD },
    ]) {
      const r = await call('delegate', 'POST', `/contracts/${d.id}/sign`, body);
      expect(r.statusCode, r.body).toBe(422);
      expect(r.json().code).toBe('SIGNATURE_LEVEL_TOO_LOW');
      expect(r.json().title).toMatch(/authenticator app/);
    }
    // nothing was signed, and the refusal is in the audit log
    expect((await call('legal', 'GET', `/contracts/${d.id}`)).json().status).toBe('AWAITING_SIGNATURE');
    const audit = await sys<Json[]>((tx) =>
      tx.select().from(s.auditEvent).where(eq(s.auditEvent.entityId, d.id)),
    );
    expect(
      audit.some(
        (a) =>
          a.action === 'contract.sign' &&
          a.result === 'DENIED' &&
          (a.after as Json).reason === 'SIGNATURE_LEVEL_TOO_LOW',
      ),
    ).toBe(true);
    // a contract under the tier is unaffected
    const small = await released(50_000);
    expect(
      (await call('delegate', 'POST', `/contracts/${small.id}/sign`, { decision: 'APPROVE' })).statusCode,
    ).toBe(200);
  });
});

describe('NFR-L03 AES: password and an authenticator code, hash kept, tampering detected', () => {
  it('signs at AES with password and code; a code cannot be used twice; a missing authenticator is explained', async () => {
    await setSignatures({ defaultLevel: 'SES', requiredLevelByValue: [{ fromAud: 100_000, level: 'AES' }] });
    const d = await released(150_000);
    const c1 = code();
    // wrong code
    const wrong = await call('delegate', 'POST', `/contracts/${d.id}/sign`, {
      decision: 'APPROVE',
      method: 'PASSWORD_MFA',
      password: PASSWORD,
      mfaCode: '000000',
    });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json().code).toBe('SIGNATURE_REAUTH_FAILED');
    const r = await call('delegate', 'POST', `/contracts/${d.id}/sign`, {
      decision: 'APPROVE',
      method: 'PASSWORD_MFA',
      password: PASSWORD,
      mfaCode: c1,
    });
    expect(r.statusCode, r.body).toBe(200);
    expect((r.json() as Json).signatures[0].stamp).toMatch(/ · AES · hash /);
    expect((await level(d.id)).chain[0].evidence).toMatchObject({
      method: 'PASSWORD_MFA',
      level: 'AES',
      requiredLevel: 'AES',
      meetsCurrentRequirement: true,
    });
    // the same code on another contract is refused (used once)
    const d2 = await released(150_000);
    const replay = await call('delegate', 'POST', `/contracts/${d2.id}/sign`, {
      decision: 'APPROVE',
      method: 'PASSWORD_MFA',
      password: PASSWORD,
      mfaCode: c1,
    });
    expect(replay.statusCode).toBe(403);
    expect(replay.json().title).toMatch(/already been used|not right/);
    // a person with no authenticator app is told to set one up
    const noMfa = await env.extraUser('delegate-nomfa', 'DELEGATE', [
      { scope: 'CONTRACT_SIGNING', max: '20000000.00' },
    ]);
    const d3 = await released(150_000);
    const refused = await call(noMfa.email, 'POST', `/contracts/${d3.id}/sign`, {
      decision: 'APPROVE',
      method: 'PASSWORD_MFA',
      password: PASSWORD,
      mfaCode: '123456',
    });
    expect(refused.statusCode, refused.body).toBe(403);
    expect(refused.json().title).toMatch(/authenticator app/);
  });

  it('records the hash of the signed content and detects a later change to it', async () => {
    await setSignatures({ defaultLevel: 'SES', requiredLevelByValue: [] });
    // two signatures are needed (value above the executive co-sign line), so the contract stays open after the first
    const d = await released(5_000_000);
    const first = await call('delegate', 'POST', `/contracts/${d.id}/sign`, { decision: 'APPROVE' });
    expect(first.statusCode, first.body).toBe(200);
    expect((first.json() as Json).status).toBe('PARTIALLY_SIGNED');
    const before = (await level(d.id)) as Json;
    expect(before.integrity).toBe('INTACT');
    const digest = before.chain[0].evidence.documentDigest as string;
    expect(digest).toBe(before.currentDigest);
    // someone changes a clause underneath the signature (directly in the database)
    await sys((tx) =>
      tx
        .update(s.clause)
        .set({ text: 'Quietly changed wording after the first signature.' })
        .where(eq(s.clause.contractId, d.id)),
    );
    const after = await level(d.id);
    expect(after.integrity).toBe('MODIFIED_AFTER_SIGNING');
    expect(after.currentDigest).not.toBe(digest);
    expect(after.chain[0].evidence).toMatchObject({
      integrity: 'MODIFIED_AFTER_SIGNING',
      documentDigest: digest,
    });
    const ex = await evidence(d.id);
    expect(ex.integrity).toBe('MODIFIED_AFTER_SIGNING');
    expect(ex.integrityNote).toMatch(/changed since/);
  });
});

describe('NFR-L03 QES: a qualified trust service provider on the e-signature connector', () => {
  it('catalogues SIMULATED_QTSP as qualified, and a signature through it is QES with the provider on the evidence', async () => {
    const cat = (await call('admin', 'GET', '/connectors')).json() as Json;
    const esign = cat.catalogue.find((k: Json) => k.kind === 'ESIGN') as Json;
    const q = esign.providers.find((p: Json) => p.id === 'SIMULATED_QTSP');
    expect(q).toMatchObject({ qualified: true, simulated: true });
    expect(esign.providers.find((p: Json) => p.id === 'DOCUSIGN').qualified).toBeUndefined();

    const set = await call('admin', 'PUT', '/connectors/ESIGN', {
      provider: 'SIMULATED_QTSP',
      enabled: true,
      mode: 'UP',
    });
    expect(set.statusCode, set.body).toBe(200);
    await setSignatures({ defaultLevel: 'SES', requiredLevelByValue: [{ fromAud: 100_000, level: 'QES' }] });
    const d = await released(150_000);
    const l = await level(d.id);
    expect(l.required).toMatchObject({ level: 'QES' });
    expect(l.qualifiedProviderReady).toBe(true);
    const env1 = (await call('legal', 'GET', `/contracts/${d.id}/envelope`)).json() as Json;
    expect(env1.envelope).toMatchObject({ provider: 'SIMULATED_QTSP', status: 'SENT' });
    expect(env1.envelope.externalId).toMatch(/^QT-/);
    expect(env1.envelope.providerPayload).toMatchObject({ signatureType: 'QUALIFIED' });

    // signing in the platform is only SES or AES: refused
    const plain = await call('delegate', 'POST', `/contracts/${d.id}/sign`, { decision: 'APPROVE' });
    expect(plain.statusCode).toBe(422);
    expect(plain.json().code).toBe('SIGNATURE_LEVEL_TOO_LOW');
    expect(plain.json().title).toMatch(/qualified trust service provider/);
    const aes = await call('delegate', 'POST', `/contracts/${d.id}/sign`, {
      decision: 'APPROVE',
      method: 'PASSWORD_MFA',
      password: PASSWORD,
      mfaCode: code(),
    });
    expect(aes.statusCode).toBe(422);
    // a caller cannot claim a provider ceremony by adding headers
    const forged = await env.app.inject({
      method: 'POST',
      url: `/api/v1/contracts/${d.id}/sign`,
      headers: { 'x-if-esign-provider': 'SIMULATED_QTSP', 'x-if-esign-proof': 'a'.repeat(64) },
      payload: { decision: 'APPROVE' },
    });
    expect(forged.statusCode).toBe(401);
    // through the provider's ceremony it is QES
    const sim = await call('legal', 'POST', `/contracts/${d.id}/envelope/simulate-event`, { type: 'signed' });
    expect(sim.statusCode, sim.body).toBe(200);
    expect(sim.json()).toMatchObject({ accepted: true, outcome: 'APPLIED' });
    const done = await level(d.id);
    expect(done.status).toBe('EXECUTED');
    expect(done.chain[0].evidence).toMatchObject({
      method: 'QTSP',
      level: 'QES',
      provider: 'SIMULATED_QTSP',
      requiredLevel: 'QES',
      meetsCurrentRequirement: true,
    });
    const stamp = ((await call('legal', 'GET', `/contracts/${d.id}`)).json() as Json).signatures[0].stamp;
    expect(stamp).toMatch(/ · QES · hash /);
    // a plain provider ceremony (DocuSign) is not qualified: SES
    await setSignatures({ defaultLevel: 'SES', requiredLevelByValue: [] });
    await call('admin', 'PUT', '/connectors/ESIGN', { provider: 'DOCUSIGN', enabled: true, mode: 'UP' });
    const d2 = await released(150_000);
    await call('legal', 'POST', `/contracts/${d2.id}/envelope/simulate-event`, { type: 'signed' });
    expect((await level(d2.id)).chain[0].evidence).toMatchObject({
      method: 'PROVIDER',
      level: 'SES',
      provider: 'DOCUSIGN',
    });
    await call('admin', 'PUT', '/connectors/ESIGN', {
      provider: 'SIMULATED_ESIGN',
      enabled: true,
      mode: 'UP',
    });
  });
});

describe('NFR-L03 Legal can set the level on a contract, with a reason', () => {
  it('overrides the value tier either way, needs a reason, is for Legal only, and is audited', async () => {
    await setSignatures({ defaultLevel: 'SES', requiredLevelByValue: [{ fromAud: 100_000, level: 'AES' }] });
    const d = await released(150_000);
    expect(
      (
        await call('delegate', 'PUT', `/contracts/${d.id}/signature-level`, {
          level: 'SES',
          reason: 'Routine renewal of an existing service',
        })
      ).statusCode,
    ).toBe(403);
    const noReason = await call('legal', 'PUT', `/contracts/${d.id}/signature-level`, {
      level: 'SES',
      reason: 'short',
    });
    expect(noReason.statusCode).toBe(400);
    const set = await call('legal', 'PUT', `/contracts/${d.id}/signature-level`, {
      level: 'SES',
      reason: 'Routine renewal of an existing service',
    });
    expect(set.statusCode, set.body).toBe(200);
    expect(set.json().required).toMatchObject({ level: 'SES', basis: 'CONTRACT_OVERRIDE' });
    expect(set.json().override).toMatchObject({
      level: 'SES',
      reason: 'Routine renewal of an existing service',
    });
    // now a plain signature is enough
    expect(
      (await call('delegate', 'POST', `/contracts/${d.id}/sign`, { decision: 'APPROVE' })).statusCode,
    ).toBe(200);
    // an override cannot be changed once the contract is executed and locked
    const late = await call('legal', 'PUT', `/contracts/${d.id}/signature-level`, {
      level: 'QES',
      reason: 'Changing our minds late',
    });
    expect(late.statusCode).toBe(423);
    // raising it is just as possible
    const d2 = await released(50_000);
    const up = await call('legal', 'PUT', `/contracts/${d2.id}/signature-level`, {
      level: 'AES',
      reason: 'Sensitive supplier relationship',
    });
    expect(up.json().required).toMatchObject({ level: 'AES', basis: 'CONTRACT_OVERRIDE' });
    expect(
      (await call('delegate', 'POST', `/contracts/${d2.id}/sign`, { decision: 'APPROVE' })).statusCode,
    ).toBe(422);
    const audit = await sys<Json[]>((tx) =>
      tx.select().from(s.auditEvent).where(eq(s.auditEvent.entityId, d2.id)),
    );
    expect(audit.some((a) => a.action === 'contract.signature_level_set')).toBe(true);
  });
});

describe('NFR-L03 non-repudiation evidence export', () => {
  it('lists signer, method, level, time, document hash and browser class for each signature, and is audited', async () => {
    await setSignatures({ defaultLevel: 'SES', requiredLevelByValue: [] });
    const d = await env.executed();
    const ex = await evidence(d.id);
    expect(ex.export).toBe('SIGNATURE_EVIDENCE');
    expect(ex.integrity).toBe('INTACT');
    expect(ex.signatures).toHaveLength(1);
    expect(ex.signatures[0]).toMatchObject({
      signer: 'Dana Okafor',
      role: 'DELEGATE',
      method: 'SESSION',
      level: 'SES',
      methodLabel: expect.any(String),
      algorithm: 'SHA-256',
    });
    expect(ex.signatures[0].documentDigest).toBe(ex.currentDocumentDigest);
    expect(Object.keys(ex.signatures[0])).toEqual(
      expect.arrayContaining(['ip', 'userAgentClass', 'signedAt']),
    );
    const audit = await sys<Json[]>((tx) =>
      tx.select().from(s.auditEvent).where(eq(s.auditEvent.entityId, d.id)),
    );
    expect(audit.some((a) => a.action === 'contract.signature_evidence_export')).toBe(true);
    // the digest the signature kept is the digest of the contract as it stands
    const [c] = await sys<Json[]>((tx) => tx.select().from(s.contract).where(eq(s.contract.id, d.id)));
    const now = await sys<string>((tx) => contentDigest(tx, c as never));
    expect(now).toBe(ex.currentDocumentDigest);
    // not available to people with no contract role
    expect((await call('requester', 'GET', `/contracts/${d.id}/signature-evidence`)).statusCode).toBe(403);
  });
});
