import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import * as s from '../../db/schema.js';
import { TENANT_ID } from '../../db/seed.js';
import { createEnv, type Json } from '../contract/test-env.js';
import { signedHeaders } from '../b10conn/signing.js';
import { ADAPTERS, adobe, docusign, externalIdOfAny, type EnvelopeSpec } from './esign-adapters.js';

let env: Awaited<ReturnType<typeof createEnv>>;
const call = (...a: Parameters<typeof env.call>) => env.call(...a);
const sys = <T>(fn: Parameters<typeof env.withSystem>[1]) => env.withSystem(env.database, fn) as Promise<T>;
beforeAll(async () => {
  env = await createEnv();
}, 120_000);

const spec = (mode: EnvelopeSpec['mode']): EnvelopeSpec => ({
  contractId: '3f2b8c1e-0000-4000-8000-000000000001',
  contractNumber: 'CON-0001',
  title: 'Cleaning services',
  mode,
  expiresAt: new Date('2026-11-01T00:00:00Z'),
  sequence: 1,
  tenantId: TENANT_ID,
  signatories: [
    {
      signatoryId: 'sig-a',
      name: 'Dana Okafor',
      email: 'delegate@x.example',
      role: 'DELEGATE',
      roleLabel: 'Authorised delegate',
      order: 1,
      signUrl: '/esign/aaa',
    },
    {
      signatoryId: 'sig-b',
      name: 'Elena Petrova',
      email: 'exec@x.example',
      role: 'EXEC',
      roleLabel: 'Executive',
      order: mode === 'STAGED' ? 2 : 1,
      signUrl: '/esign/bbb',
    },
  ],
});

async function useProvider(provider: 'DOCUSIGN' | 'ADOBE' | 'SIMULATED_ESIGN', mode: 'UP' | 'DOWN' = 'UP') {
  const r = await call('admin', 'PUT', '/connectors/ESIGN', { provider, enabled: true, mode });
  expect(r.statusCode, r.body).toBe(200);
}
async function execSigner() {
  return env.extraUser('exec-signer', 'EXEC', [{ scope: 'CONTRACT_SIGNING', max: '20000000.00' }]);
}
async function released(opts: { value?: number; mode?: 'STANDARD' | 'BLIND' | 'STAGED' } = {}) {
  const d = await env.draft(opts.value ? { value: opts.value } : {});
  await call('legal', 'PUT', `/contracts/${d.id}/clauses/IP`, { text: 'Legal reviewed wording for IP.' });
  if (opts.mode)
    expect(
      (await call('legal', 'PUT', `/contracts/${d.id}/signing-mode`, { signingMode: opts.mode })).statusCode,
    ).toBe(200);
  const r = await call('legal', 'POST', `/contracts/${d.id}/release-for-signing`);
  expect(r.statusCode, r.body).toBe(200);
  return d;
}
const card = async (who: string, id: string) => {
  const r = await call(who, 'GET', `/contracts/${id}/envelope`);
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as Json;
};
const simulate = async (id: string, body: Json) => {
  const r = await call('legal', 'POST', `/contracts/${id}/envelope/simulate-event`, body);
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as Json;
};
const contractStatus = async (id: string) =>
  ((await call('legal', 'GET', `/contracts/${id}`)).json() as Json).status as string;

describe('NFR-C04 the two simulated e-signature providers and their mapper', () => {
  it('builds each provider own request shape from one specification, with signatories pre-filled', () => {
    const ds = docusign.buildCreate(spec('STANDARD')) as Json;
    expect(ds.recipients.signers).toHaveLength(2);
    expect(ds.recipients.signers[0]).toMatchObject({
      name: 'Dana Okafor',
      email: 'delegate@x.example',
      roleName: 'Authorised delegate',
      routingOrder: '1',
    });
    expect(ds.status).toBe('sent');
    const ad = adobe.buildCreate(spec('STANDARD')) as Json;
    expect(ad.participantSetsInfo).toHaveLength(2);
    expect(ad.participantSetsInfo[0]).toMatchObject({ order: 1, role: 'SIGNER' });
    expect(ad.participantSetsInfo[0].memberInfos[0]).toMatchObject({
      email: 'delegate@x.example',
      name: 'Dana Okafor',
    });
    expect(ad.recipients).toBeUndefined();
    expect(ds.participantSetsInfo).toBeUndefined();
  });
  it('sets signing order for STAGED and hides other signatories for BLIND, in each provider own terms', () => {
    const staged = docusign.buildCreate(spec('STAGED')) as Json;
    expect(staged.recipients.signers.map((x: Json) => x.routingOrder)).toEqual(['1', '2']);
    expect((adobe.buildCreate(spec('STAGED')) as Json).participantSetsInfo.map((x: Json) => x.order)).toEqual(
      [1, 2],
    );
    expect((docusign.buildCreate(spec('BLIND')) as Json).enforceSignerVisibility).toBe('true');
    expect((docusign.buildCreate(spec('STANDARD')) as Json).enforceSignerVisibility).toBe('false');
    expect((adobe.buildCreate(spec('BLIND')) as Json).participantSetsInfo[0].privateMessage).toBe(
      'HIDE_OTHER_PARTICIPANTS',
    );
  });
  it('answers the create call with a deterministic id and one recipient reference per signatory', () => {
    const a = docusign.createEnvelope(spec('STANDARD'));
    expect(a.externalId).toMatch(/^DS-[0-9a-f]{12}$/);
    expect(docusign.createEnvelope(spec('STANDARD')).externalId).toBe(a.externalId);
    expect(a.recipients.map((r) => r.ref)).toEqual(['1', '2']);
    const b = adobe.createEnvelope(spec('STANDARD'));
    expect(b.externalId).toMatch(/^AG-[0-9A-F]{14}$/);
    expect(b.recipients).toHaveLength(2);
    expect(docusign.createEnvelope({ ...spec('STANDARD'), sequence: 2 }).externalId).not.toBe(a.externalId);
  });
  it('maps every provider callback into the one canonical vocabulary and back', () => {
    for (const kind of ['sent', 'delivered', 'viewed', 'signed', 'declined', 'voided', 'expired'] as const)
      for (const ad of Object.values(ADAPTERS)) {
        const cb = ad.toCallback({
          externalId: 'EXT-1',
          kind,
          email: 'a@x.example',
          recipientRef: 'R1',
          reason: 'why',
        });
        const back = ad.parseCallback(cb.type, cb.data)!;
        expect(back, `${ad.id} ${kind}`).toMatchObject({
          externalId: 'EXT-1',
          kind,
          email: 'a@x.example',
          recipientRef: 'R1',
        });
        expect(externalIdOfAny(cb.data)).toBe('EXT-1');
      }
    expect(docusign.toCallback({ externalId: 'x', kind: 'signed' }).type).toBe('recipient-completed');
    expect(adobe.toCallback({ externalId: 'x', kind: 'signed' }).type).toBe('AGREEMENT_ACTION_COMPLETED');
    // a provider does not understand the other provider's words
    expect(
      docusign.parseCallback(
        'AGREEMENT_ACTION_COMPLETED',
        adobe.toCallback({ externalId: 'x', kind: 'signed' }).data,
      ),
    ).toBeNull();
    expect(adobe.parseCallback('nonsense', {})).toBeNull();
  });
});

describe('NFR-C04 envelope on release for signing (DocuSign)', () => {
  it('does nothing when the connector is the in-platform simulated signer', async () => {
    await useProvider('SIMULATED_ESIGN');
    const d = await released();
    const c = await card('legal', d.id);
    expect(c.envelope).toBeNull();
    expect(c.connector).toMatchObject({ inUse: false, provider: 'SIMULATED_ESIGN' });
    expect(c.manualTasks).toEqual([]);
  });

  it('creates an envelope with the signatory pre-filled, then follows the whole ceremony to an executed, locked contract', async () => {
    await useProvider('DOCUSIGN');
    const d = await released();
    const c = await card('legal', d.id);
    expect(c.simulated).toBe(true);
    expect(c.envelope).toMatchObject({ provider: 'DOCUSIGN', status: 'SENT', signingMode: 'STANDARD' });
    expect(c.envelope.externalId).toMatch(/^DS-/);
    expect(c.envelope.signatories).toHaveLength(1);
    expect(c.envelope.signatories[0]).toMatchObject({
      role: 'DELEGATE',
      name: 'Dana Okafor',
      email: 'delegate@meridian-demo.example',
      status: 'SENT',
      order: 1,
    });
    expect(c.envelope.providerPayload.recipients.signers[0].email).toBe('delegate@meridian-demo.example');
    expect(c.envelope.events[0]).toMatchObject({ type: 'sent', source: 'PLATFORM', outcome: 'APPLIED' });
    // the signatory is given a link in the portal, and no link is written to the email log
    const note = await sys<Json[]>((tx) =>
      tx
        .select()
        .from(s.notification)
        .where(eq(s.notification.title, `DocuSign: ${(d.view as Json).number} is ready for your signature`)),
    );
    expect(note).toHaveLength(1);
    expect(note[0]!.link).toMatch(/^\/esign\/[\w-]{30,}$/);
    const mails = await sys<Json[]>((tx) =>
      tx.select().from(s.outboundEmail).where(eq(s.outboundEmail.refType, 'esign_envelope')),
    );
    expect(mails.length).toBeGreaterThan(0);
    expect(mails.every((m) => !String(m.body).includes('/esign/'))).toBe(true);

    // the delegate opens the signing page from the link in their notification
    const token = (note[0]!.link as string).replace('/esign/', '');
    const page = await call('delegate', 'GET', `/esign/${token}`);
    expect(page.statusCode, page.body).toBe(200);
    expect(page.json()).toMatchObject({
      providerLabel: 'DocuSign',
      canSign: true,
      me: { name: 'Dana Okafor' },
      contract: { number: (d.view as Json).number },
    });
    // another signed-in person cannot use the link
    expect((await call('exec', 'GET', `/esign/${token}`)).statusCode).toBe(404);
    expect((await call('legal', 'GET', `/esign/${token}`)).statusCode).toBe(403);
    const opened = await card('legal', d.id);
    expect(opened.envelope.signatories[0].status).toBe('VIEWED');
    expect(opened.envelope.events.map((e: Json) => e.type)).toEqual(
      expect.arrayContaining(['sent', 'delivered', 'viewed']),
    );

    // confirming is the signatory's own authenticated sign decision
    const done = await call('delegate', 'POST', `/esign/${token}/confirm`, { decision: 'SIGN' });
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json()).toMatchObject({ signatory: 'SIGNED', envelope: 'COMPLETED', contract: 'EXECUTED' });
    const end = await card('legal', d.id);
    expect(end.envelope.status).toBe('COMPLETED');
    expect(end.envelope.events.map((e: Json) => e.type)).toEqual(
      expect.arrayContaining(['signed', 'completed']),
    );
    const v = (await call('legal', 'GET', `/contracts/${d.id}`)).json() as Json;
    expect(v).toMatchObject({ status: 'EXECUTED', locked: true });
    expect(v.signatures[0].stamp).toMatch(/^SIGNED/);
    // a closed envelope cannot be confirmed again
    expect((await call('delegate', 'POST', `/esign/${token}/confirm`, { decision: 'SIGN' })).statusCode).toBe(
      409,
    );
  });

  it('signing in the platform (no ceremony) is reflected in the envelope through the provider callback', async () => {
    await useProvider('DOCUSIGN');
    const d = await released();
    expect(
      (await call('delegate', 'POST', `/contracts/${d.id}/sign`, { decision: 'APPROVE' })).statusCode,
    ).toBe(200);
    const c = await card('legal', d.id);
    expect(c.envelope).toMatchObject({ status: 'COMPLETED' });
    expect(c.envelope.signatories[0].status).toBe('SIGNED');
    const signed = c.envelope.events.find((e: Json) => e.type === 'signed');
    expect(signed).toMatchObject({
      source: 'PROVIDER',
      outcome: 'APPLIED',
      providerType: 'recipient-completed',
    });
    expect(signed.detail).toMatch(/already holds/);
  });

  it('a signature reported by the provider reaches the chain only through the normal sign decision', async () => {
    await useProvider('DOCUSIGN');
    const d = await released();
    const out = await simulate(d.id, { type: 'signed' });
    expect(out).toMatchObject({ accepted: true, outcome: 'APPLIED' });
    expect(out.detail).toMatch(/normal signing decision/);
    const v = (await call('legal', 'GET', `/contracts/${d.id}`)).json() as Json;
    expect(v.status).toBe('EXECUTED');
    expect(v.signatures).toHaveLength(1);
    expect(v.signatures[0]).toMatchObject({
      role: 'DELEGATE',
      decision: 'APPROVED',
      userName: 'Dana Okafor',
    });
    const audit = await sys<Json[]>((tx) =>
      tx
        .select()
        .from(s.auditEvent)
        .where(and(eq(s.auditEvent.entityId, d.id), eq(s.auditEvent.action, 'contract.sign'))),
    );
    expect(audit.length).toBe(1);
    expect((await card('legal', d.id)).envelope).toMatchObject({ status: 'COMPLETED' });
  });

  it('a provider callback is applied once: a repeated event id is refused, a new id for the same fact changes nothing', async () => {
    await useProvider('DOCUSIGN');
    const d = await released();
    const first = await simulate(d.id, { type: 'viewed', eventId: 'evt-view-0001' });
    expect(first).toMatchObject({ accepted: true, outcome: 'APPLIED' });
    const again = await simulate(d.id, { type: 'viewed', eventId: 'evt-view-0001' });
    expect(again).toMatchObject({ accepted: false, replayed: true });
    expect(again.detail).toMatch(/already received/);
    const other = await simulate(d.id, { type: 'viewed', eventId: 'evt-view-0002' });
    expect(other.outcome).toBe('IGNORED');
    const c = await card('legal', d.id);
    expect(c.envelope.events.filter((e: Json) => e.type === 'viewed')).toHaveLength(2);
    // signing twice: the second signed callback is a duplicate
    await simulate(d.id, { type: 'signed' });
    const dup = await simulate(d.id, { type: 'signed' });
    expect(dup.outcome === 'DUPLICATE' || dup.outcome === 'REFUSED').toBe(true);
    expect(
      await sys<Json[]>((tx) =>
        tx
          .select()
          .from(s.approval)
          .where(and(eq(s.approval.subjectId, d.id), eq(s.approval.decision, 'APPROVED'))),
      ),
    ).toHaveLength(1);
  });

  it('a callback that is not signed, is stale, or names an unknown envelope is refused or ignored', async () => {
    await useProvider('DOCUSIGN');
    const d = await released();
    const c = await card('legal', d.id);
    const body = {
      eventId: 'evt-forged-0001',
      type: 'recipient-completed',
      data: { envelopeId: c.envelope.externalId, recipientId: '1' },
    };
    const unsigned = await env.app.inject({
      method: 'POST',
      url: '/api/v1/integrations/ESIGN/webhook',
      payload: body,
    });
    expect(unsigned.statusCode).toBe(401);
    const forged = await env.app.inject({
      method: 'POST',
      url: '/api/v1/integrations/ESIGN/webhook',
      headers: {
        'x-if-timestamp': String(Math.floor(env.clock.now().getTime() / 1000)),
        'x-if-signature': 'f'.repeat(64),
      },
      payload: body,
    });
    expect(forged.statusCode).toBe(401);
    expect(await contractStatus(d.id)).toBe('AWAITING_SIGNATURE');
    // correctly signed but for an envelope that does not exist: accepted by the middleware leg, applied to nothing
    const secret = await sys<string>(
      async (tx) =>
        (await import('../b10conn/secrets.js')).readSecret(tx, TENANT_ID, 'connector.esign.webhook') as never,
    );
    const ghost = {
      eventId: 'evt-ghost-0001',
      type: 'recipient-completed',
      data: { envelopeId: 'DS-000000000000', recipientId: '1' },
    };
    const ok = await env.app.inject({
      method: 'POST',
      url: '/api/v1/integrations/ESIGN/webhook',
      headers: { ...signedHeaders(secret, env.clock, ghost) },
      payload: ghost,
    });
    expect(ok.statusCode).toBe(200);
    expect(await contractStatus(d.id)).toBe('AWAITING_SIGNATURE');
    expect(((await card('legal', d.id)).envelope.signatories[0] as Json).status).toBe('SENT');
  });

  it('a decline returns the contract to legal with the reason, as the platform reject does', async () => {
    await useProvider('DOCUSIGN');
    const d = await released();
    const out = await simulate(d.id, { type: 'declined', reason: 'The liability cap is too low' });
    expect(out).toMatchObject({ accepted: true, outcome: 'APPLIED' });
    expect(out.detail).toMatch(/returned to legal/);
    const v = (await call('legal', 'GET', `/contracts/${d.id}`)).json() as Json;
    expect(v.status).toBe('LEGAL_REVIEW');
    const rej = await sys<Json[]>((tx) =>
      tx
        .select()
        .from(s.approval)
        .where(and(eq(s.approval.subjectId, d.id), eq(s.approval.decision, 'REJECTED'))),
    );
    expect(rej).toHaveLength(1);
    expect(rej[0]!.comment).toBe('The liability cap is too low');
    const c = await card('legal', d.id);
    expect(c.envelope).toMatchObject({ status: 'DECLINED', closedReason: 'The liability cap is too low' });
    expect(c.envelope.signatories[0]).toMatchObject({
      status: 'DECLINED',
      declineReason: 'The liability cap is too low',
    });
    // released again after a fix: a new envelope replaces the declined one
    await call('legal', 'PUT', `/contracts/${d.id}/clauses/IP`, {
      text: 'Legal reviewed wording for IP, second pass.',
    });
    expect((await call('legal', 'POST', `/contracts/${d.id}/release-for-signing`)).statusCode).toBe(200);
    const again = await card('legal', d.id);
    expect(again.envelope.status).toBe('SENT');
    expect(again.envelope.id).not.toBe(c.envelope.id);
    expect(again.envelope.externalId).not.toBe(c.envelope.externalId);
  });

  it('a decline made in the platform is mirrored to the envelope', async () => {
    await useProvider('DOCUSIGN');
    const d = await released();
    const r = await call('delegate', 'POST', `/contracts/${d.id}/sign`, {
      decision: 'REJECT',
      comment: 'Needs another look at schedule 2',
    });
    expect(r.statusCode, r.body).toBe(200);
    const c = await card('legal', d.id);
    expect(c.envelope).toMatchObject({ status: 'DECLINED' });
    expect(c.envelope.signatories[0].declineReason).toBe('Needs another look at schedule 2');
  });

  it('a voided or expired envelope never changes the contract: signing carries on in the platform', async () => {
    await useProvider('DOCUSIGN');
    const d = await released();
    const out = await simulate(d.id, { type: 'voided', reason: 'Withdrawn by the provider' });
    expect(out.outcome).toBe('APPLIED');
    expect((await card('legal', d.id)).envelope).toMatchObject({ status: 'VOIDED' });
    expect(await contractStatus(d.id)).toBe('AWAITING_SIGNATURE');
    expect(
      (await call('delegate', 'POST', `/contracts/${d.id}/sign`, { decision: 'APPROVE' })).json().status,
    ).toBe('EXECUTED');
    expect((await card('legal', d.id)).envelope.status).toBe('VOIDED');
    const e = await released();
    expect((await simulate(e.id, { type: 'expired' })).outcome).toBe('APPLIED');
    expect((await card('legal', e.id)).envelope).toMatchObject({ status: 'EXPIRED' });
    expect((await card('legal', e.id)).envelope.signatories[0].status).toBe('EXPIRED');
    expect(await contractStatus(e.id)).toBe('AWAITING_SIGNATURE');
  });

  it('signing authority still applies: a provider signature above the signatory authority is refused and the chain is unchanged', async () => {
    await useProvider('DOCUSIGN');
    const d = await released({ value: 7_000_000 });
    await execSigner();
    const out = await simulate(d.id, { type: 'signed' });
    expect(out.outcome).toBe('REFUSED');
    expect(out.detail).toMatch(/above your signing authority|SIGNING_AUTHORITY_INSUFFICIENT/);
    const c = await card('legal', d.id);
    expect(c.envelope.signatories[0].status).not.toBe('SIGNED');
    expect(
      await sys<Json[]>((tx) =>
        tx
          .select()
          .from(s.approval)
          .where(and(eq(s.approval.subjectId, d.id), eq(s.approval.decision, 'APPROVED'))),
      ),
    ).toHaveLength(0);
    // the refusal is also on the audit trail of the sign decision
    const denied = await sys<Json[]>((tx) =>
      tx
        .select()
        .from(s.auditEvent)
        .where(and(eq(s.auditEvent.entityId, d.id), eq(s.auditEvent.result, 'DENIED'))),
    );
    expect(denied.length).toBeGreaterThan(0);
  });
});

describe('NFR-C04 signing modes: staged order and blind visibility', () => {
  it('STAGED: signatories carry an order and the executive cannot sign before the delegate, even from the provider', async () => {
    await useProvider('DOCUSIGN');
    const exec = await execSigner();
    const d = await released({ value: 2_000_000, mode: 'STAGED' });
    const c = await card('legal', d.id);
    expect(c.envelope.signatories.map((x: Json) => [x.role, x.order])).toEqual([
      ['DELEGATE', 1],
      ['EXEC', 2],
    ]);
    expect(c.envelope.signatories[1].email).toMatch(/^exec-signer-\d+@/); // an executive who holds signing authority is picked
    void exec;
    expect((c.envelope.providerPayload as Json).recipients.signers.map((x: Json) => x.routingOrder)).toEqual([
      '1',
      '2',
    ]);
    const execSig = c.envelope.signatories[1];
    const early = await simulate(d.id, { type: 'signed', signatoryId: execSig.id });
    expect(early.outcome).toBe('REFUSED');
    expect(early.detail).toMatch(/SIGNING_ORDER|collected in order/);
    const first = await simulate(d.id, { type: 'signed', signatoryId: c.envelope.signatories[0].id });
    expect(first.outcome).toBe('APPLIED');
    expect(await contractStatus(d.id)).toBe('PARTIALLY_SIGNED');
    const last = await simulate(d.id, { type: 'signed', signatoryId: execSig.id });
    expect(last.outcome).toBe('APPLIED');
    expect(await contractStatus(d.id)).toBe('EXECUTED');
    expect((await card('legal', d.id)).envelope).toMatchObject({ status: 'COMPLETED' });
  });

  it('BLIND: a signatory sees only their own line and events; the people who run the process see everyone', async () => {
    await useProvider('ADOBE');
    await execSigner();
    const d = await released({ value: 2_000_000, mode: 'BLIND' });
    const all = await card('legal', d.id);
    expect(all.envelope.signatories).toHaveLength(2);
    const exec = { email: all.envelope.signatories[1].email as string };
    expect(all.envelope.blind).toBe(false);
    const mine = await card('delegate', d.id);
    expect(mine.envelope.blind).toBe(true);
    expect(mine.envelope.signatories).toHaveLength(1);
    expect(mine.envelope.signatories[0]).toMatchObject({ role: 'DELEGATE', isMe: true });
    expect(mine.envelope.providerPayload).toBeNull();
    expect(JSON.stringify(mine)).not.toContain(exec.email);
    const execView = await card(exec.email, d.id);
    expect(execView.envelope.signatories).toHaveLength(1);
    expect(execView.envelope.signatories[0].role).toBe('EXEC');
    // the delegate's own ceremony page never lists the other signatory
    const link = await call('delegate', 'POST', `/contracts/${d.id}/envelope/signing-link`);
    expect(link.statusCode, link.body).toBe(200);
    const page = (await call('delegate', 'GET', link.json().path)).json() as Json;
    expect(page.others).toEqual([]);
    expect(JSON.stringify(page)).not.toContain(all.envelope.signatories[1].name);
    // Adobe's own shape
    expect(all.envelope.providerPayload.participantSetsInfo).toHaveLength(2);
    expect(all.envelope.externalId).toMatch(/^AG-/);
  });
});

describe('NFR-C04 Adobe Sign through the same flow', () => {
  it('uses Adobe words for the callbacks and completes through the platform decision', async () => {
    await useProvider('ADOBE');
    const d = await released();
    const c = await card('legal', d.id);
    expect(c.envelope).toMatchObject({ provider: 'ADOBE', providerLabel: 'Adobe Acrobat Sign' });
    expect(c.envelope.providerPayload.state).toBe('IN_PROCESS');
    const out = await simulate(d.id, { type: 'signed' });
    expect(out.outcome).toBe('APPLIED');
    const end = await card('legal', d.id);
    expect(end.envelope.status).toBe('COMPLETED');
    expect(end.envelope.events.find((e: Json) => e.type === 'signed').providerType).toBe(
      'AGREEMENT_ACTION_COMPLETED',
    );
  });
});

describe('NFR-C04 fallback when the provider is down (NFR-AV04)', () => {
  it('records a manual task that no envelope was created, and the contract is still signed in the platform', async () => {
    await useProvider('DOCUSIGN', 'DOWN');
    const d = await released();
    const c = await card('legal', d.id);
    expect(c.envelope).toBeNull();
    expect(c.manualTasks).toHaveLength(1);
    expect(c.manualTasks[0].title).toMatch(/No e-signature envelope/);
    const tasks = (await call('admin', 'GET', '/manual-tasks?status=OPEN')).json() as Json[];
    expect(tasks.some((t) => t.connector === 'ESIGN' && t.summary.contractId === d.id)).toBe(true);
    expect(
      await sys<Json[]>((tx) =>
        tx
          .select()
          .from(s.auditEvent)
          .where(and(eq(s.auditEvent.entityId, d.id), eq(s.auditEvent.action, 'esign.envelope_not_created'))),
      ),
    ).toHaveLength(1);
    // the normal in-platform signing still works
    expect(
      (await call('delegate', 'POST', `/contracts/${d.id}/sign`, { decision: 'APPROVE' })).json().status,
    ).toBe('EXECUTED');
    expect((await card('legal', d.id)).envelope).toBeNull();
  });

  it('opens the breaker after repeated failures, and a later retry creates the envelope and clears the task', async () => {
    await useProvider('DOCUSIGN', 'DOWN');
    const a = await released();
    const b = await released();
    const c = await released();
    const conn = (await call('admin', 'GET', '/connectors'))
      .json()
      .connectors.find((x: Json) => x.kind === 'ESIGN');
    expect(conn.health.state).toBe('DOWN');
    expect((await card('legal', a.id)).manualTasks).toHaveLength(1);
    expect((await card('legal', b.id)).manualTasks).toHaveLength(1);
    expect((await card('legal', c.id)).manualTasks).toHaveLength(1);
    // the provider comes back
    await useProvider('DOCUSIGN', 'UP');
    expect((await call('delegate', 'POST', `/contracts/${a.id}/envelope`)).statusCode).toBe(403);
    const retry = await call('legal', 'POST', `/contracts/${a.id}/envelope`);
    expect(retry.statusCode, retry.body).toBe(201);
    expect(retry.json()).toMatchObject({ result: 'CREATED' });
    const after = await card('legal', a.id);
    expect(after.envelope.status).toBe('SENT');
    expect(after.manualTasks).toEqual([]);
  });
});

describe('NFR-C04 who may do what', () => {
  it('the demonstration action is for ADMIN, LEGAL and PROCUREMENT only; the signing page for the two signing roles', async () => {
    await useProvider('DOCUSIGN');
    const d = await released();
    const body = { type: 'viewed' };
    for (const who of [
      'delegate',
      'exec',
      'requester',
      'finance',
      'contract-mgr',
      'probity',
      'evaluator-tech',
      'supplier',
    ])
      expect(
        (await call(who, 'POST', `/contracts/${d.id}/envelope/simulate-event`, body)).statusCode,
        who,
      ).toBe(403);
    for (const who of ['admin', 'procurement', 'legal'])
      expect(
        (await call(who, 'POST', `/contracts/${d.id}/envelope/simulate-event`, { type: 'delivered' }))
          .statusCode,
        who,
      ).toBe(200);
    for (const who of ['requester', 'evaluator-tech', 'supplier'])
      expect((await call(who, 'GET', `/contracts/${d.id}/envelope`)).statusCode, who).toBe(403);
    expect((await call('legal', 'POST', `/contracts/${d.id}/envelope/signing-link`)).statusCode).toBe(403);
    expect((await call('exec', 'POST', `/contracts/${d.id}/envelope/signing-link`)).statusCode).toBe(403); // not a signatory here
    const bad = await call('legal', 'POST', `/contracts/${d.id}/envelope/simulate-event`, {
      type: 'exploded',
    });
    expect(bad.statusCode).toBe(400);
    const link = await call('delegate', 'POST', `/contracts/${d.id}/envelope/signing-link`);
    expect(link.statusCode).toBe(200);
    // a link is replaced by the next one
    const next = await call('delegate', 'POST', `/contracts/${d.id}/envelope/signing-link`);
    expect((await call('delegate', 'GET', link.json().path)).statusCode).toBe(404);
    expect((await call('delegate', 'GET', next.json().path)).statusCode).toBe(200);
    expect(
      (await call('delegate', 'POST', `${next.json().path}/confirm`, { decision: 'DECLINE' })).statusCode,
    ).toBe(400);
  });
});
