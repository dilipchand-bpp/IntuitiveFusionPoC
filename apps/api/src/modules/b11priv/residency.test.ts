import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import * as s from '../../db/schema.js';
import { TENANT_ID } from '../../db/seed.js';
import { createEnv, type Json } from '../contract/test-env.js';
import { sendEmail } from '../notify/email.js';
import { loadSettings } from '../settings/settings.js';
import { assertEgress, hostMatches, patternProblem } from './egress.js';
import { assertRegion, regionDecision } from './region.js';

let env: Awaited<ReturnType<typeof createEnv>>;
const call = (...a: Parameters<typeof env.call>) => env.call(...a);
const sys = <T>(fn: Parameters<typeof env.withSystem>[1]) => env.withSystem(env.database, fn) as Promise<T>;
beforeAll(async () => {
  env = await createEnv();
}, 120_000);

const HOME: { country: string; allowedRegions: string[]; aiRegion: string; logRegion: string } = {
  country: 'AU',
  allowedRegions: [],
  aiRegion: 'AU',
  logRegion: 'AU',
};
const setResidency = (over: Partial<typeof HOME> = {}, reason = 'Test of the residency controls') =>
  call('admin', 'PUT', '/admin/residency', { ...HOME, ...over, reason });
const reset = () => setResidency({}, 'Back to the default for the next test');
const auditActions = (action: string) =>
  sys<Json[]>((tx) => tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, action)));
const view = async () => (await call('admin', 'GET', '/admin/residency')).json() as Json;

describe('NFR-R02 the customer elects a hosting country, and it is enforced', () => {
  it('shows the elected country (AU by default) and every outbound path with its region and whether it is allowed', async () => {
    const r = await view();
    expect(r).toMatchObject({
      country: 'AU',
      allowedRegions: [],
      aiRegion: 'AU',
      logRegion: 'AU',
      simulated: true,
    });
    const ids = r.paths.map((p: Json) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'connector:ESIGN',
        'connector:MESSAGING',
        'model:sim-llm-fast-v1',
        'search',
        'log-export',
        'ai-conversations',
      ]),
    );
    const fast = r.paths.find((p: Json) => p.id === 'model:sim-llm-fast-v1');
    expect(fast).toMatchObject({ region: 'US', regionAllowed: false, allowed: false });
    const careful = r.paths.find((p: Json) => p.id === 'model:sim-llm-careful-v1');
    expect(careful).toMatchObject({ region: 'AU', regionAllowed: true, egressAllowed: true, allowed: true });
  });

  it('administrators, probity and executives read it; nobody else does; only an administrator changes it', async () => {
    for (const who of ['admin', 'probity', 'exec'])
      expect((await call(who, 'GET', '/admin/residency')).statusCode).toBe(200);
    for (const who of ['requester', 'legal', 'supplier'])
      expect((await call(who, 'GET', '/admin/residency')).statusCode).toBe(403);
    expect(
      (
        await call('probity', 'PUT', '/admin/residency', {
          ...HOME,
          country: 'NZ',
          reason: 'Not allowed to do this',
        })
      ).statusCode,
    ).toBe(403);
  });

  it('changing the country needs a reason, and is audited with the old and new value', async () => {
    const noReason = await call('admin', 'PUT', '/admin/residency', { ...HOME, country: 'NZ' });
    expect(noReason.statusCode).toBe(400);
    const short = await call('admin', 'PUT', '/admin/residency', { ...HOME, country: 'NZ', reason: 'short' });
    expect(short.statusCode).toBe(400);
    const ok = await setResidency(
      { country: 'NZ', allowedRegions: ['AU'] },
      'Customer moved its headquarters to New Zealand',
    );
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ country: 'NZ', allowedRegions: ['AU'], changedCountry: true });
    const ev = (await auditActions('residency.country_changed')).at(-1)!;
    expect(ev.before).toMatchObject({ country: 'AU' });
    expect(ev.after).toMatchObject({
      country: 'NZ',
      reason: 'Customer moved its headquarters to New Zealand',
    });
    expect(
      (await call('admin', 'PUT', '/admin/settings', { residency: { ...HOME, country: 'US' } })).statusCode,
    ).toBe(422);
    expect(
      (
        await call('admin', 'PUT', '/admin/residency', {
          ...HOME,
          country: 'NZ',
          allowedRegions: ['AU'],
          reason: 'The same again please',
        })
      ).statusCode,
    ).toBe(409);
    await reset();
  });

  it('cannot silently re-enable a connector the country change switched off', async () => {
    await call('admin', 'PUT', '/connectors/ESIGN', { enabled: true });
    const out = await setResidency({ country: 'NZ' }, 'Move hosting to New Zealand for the pilot');
    expect(out.statusCode, out.body).toBe(200);
    expect(out.json().disabledConnectors.map((c: Json) => c.kind)).toEqual(
      expect.arrayContaining(['ESIGN', 'MESSAGING']),
    );
    expect((await auditActions('connector.disabled_by_residency')).length).toBeGreaterThanOrEqual(2);
    const row = async () =>
      (
        await sys<Json[]>((tx) =>
          tx
            .select()
            .from(s.connector)
            .where(and(eq(s.connector.tenantId, TENANT_ID), eq(s.connector.kind, 'ESIGN'))),
        )
      )[0]!;
    expect((await row()).enabled).toBe(false);
    // back to AU: the connector stays off until a person switches it on
    await reset();
    expect((await row()).enabled).toBe(false);
    expect((await call('admin', 'PUT', '/connectors/ESIGN', { enabled: true })).statusCode).toBe(200);
  });
});

describe('SEC-D09 cross-border controls: a nominated region is enforced on every path that leaves the application', () => {
  it('a US-hosted simulated connector is blocked under AU, refused with 422 RESIDENCY_VIOLATION naming the purpose and region, audited and counted', async () => {
    const before = (await view()).refusals.residency;
    const r = await call('admin', 'PUT', '/connectors/LEGAL', { provider: 'ICERTIS', enabled: true });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe('RESIDENCY_VIOLATION');
    expect(r.json().title).toMatch(/legal platform/);
    expect(r.json().title).toMatch(/US/);
    const v = await view();
    expect(v.refusals.residency).toBe(before + 1);
    expect(v.recentRefusals[0]).toMatchObject({
      kind: 'RESIDENCY',
      purpose: 'LEGAL_WEBHOOK',
      region: 'US',
      electedCountry: 'AU',
    });
    const ev = (await auditActions('residency.refused')).at(-1)!;
    expect(ev.result).toBe('DENIED');
    expect(ev.after).toMatchObject({ purpose: 'LEGAL_WEBHOOK', region: 'US' });
    const row = (
      await sys<Json[]>((tx) =>
        tx
          .select()
          .from(s.connector)
          .where(and(eq(s.connector.tenantId, TENANT_ID), eq(s.connector.kind, 'LEGAL'))),
      )
    )[0]!;
    expect(row.provider).toBe('SIMULATED_LEGAL');
  });

  it('is allowed once the US is explicitly allow-listed, and the connector then works', async () => {
    expect(
      (await setResidency({ allowedRegions: ['US'] }, 'Pilot of a US-hosted legal platform')).statusCode,
    ).toBe(200);
    const put = await call('admin', 'PUT', '/connectors/LEGAL', { provider: 'ICERTIS', enabled: true });
    expect(put.statusCode, put.body).toBe(200);
    const test = await call('admin', 'POST', '/connectors/LEGAL/test');
    expect(test.json()).toMatchObject({ ok: true, simulated: true });
    // removing the US allow-listing switches it off again and the call is refused if it is somehow made
    await setResidency({ allowedRegions: [] }, 'The pilot has ended, remove the US');
    const row = (
      await sys<Json[]>((tx) =>
        tx
          .select()
          .from(s.connector)
          .where(and(eq(s.connector.tenantId, TENANT_ID), eq(s.connector.kind, 'LEGAL'))),
      )
    )[0]!;
    expect(row.enabled).toBe(false);
    await call('admin', 'PUT', '/connectors/LEGAL', { provider: 'SIMULATED_LEGAL', enabled: true });
  });

  it('refuses an unsafe call made directly through the resilient layer (a connector already in place)', async () => {
    await setResidency({ allowedRegions: ['US'] }, 'Allow the US to put a connector in place');
    await call('admin', 'PUT', '/connectors/SANCTIONS', { provider: 'WORLDCHECK', enabled: true }); // UK: refused at once
    await call('admin', 'PUT', '/connectors/DOCREPO', { provider: 'SHAREPOINT', enabled: true });
    // simulate a row that slipped through: write the provider straight into the table
    await sys((tx) =>
      tx
        .update(s.connector)
        .set({ provider: 'WORKDAY', enabled: true })
        .where(and(eq(s.connector.tenantId, TENANT_ID), eq(s.connector.kind, 'HR'))),
    );
    expect((await call('admin', 'POST', '/connectors/HR/test')).json()).toMatchObject({ ok: true });
    await reset(); // US no longer allowed: the HR connector is switched off by the change
    const t = await call('admin', 'POST', '/connectors/HR/test');
    expect(t.json()).toMatchObject({ ok: false, reason: 'DISABLED' });
    await sys((tx) =>
      tx
        .update(s.connector)
        .set({ enabled: true })
        .where(and(eq(s.connector.tenantId, TENANT_ID), eq(s.connector.kind, 'HR'))),
    );
    const blocked = await call('admin', 'POST', '/connectors/HR/test');
    expect(blocked.json()).toMatchObject({ ok: false, reason: 'RESIDENCY_VIOLATION' });
    expect(blocked.json().error).toMatch(/connector to US/);
    await sys((tx) =>
      tx
        .update(s.connector)
        .set({ provider: 'SIMULATED_HR', enabled: false })
        .where(and(eq(s.connector.tenantId, TENANT_ID), eq(s.connector.kind, 'HR'))),
    );
  });

  it('AI models: the US-hosted model cannot be named, and a model that falls out of region is withdrawn at once', async () => {
    const approve = async (id: string) => {
      const q = await call('admin', 'POST', `/ai/models/${id}/request-approval`, {
        reason: 'Residency test',
      });
      expect(q.statusCode, q.body).toBe(201);
      expect(
        (
          await call('probity', 'POST', `/ai/approvals/${q.json().id}/decision`, {
            decision: 'APPROVE',
            reason: 'Approved for the test',
          })
        ).statusCode,
      ).toBe(200);
    };
    await approve('sim-llm-fast-v1');
    const refused = await call('admin', 'PUT', '/ai/active-model', { activeModel: 'sim-llm-fast-v1' });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().code).toBe('RESIDENCY_VIOLATION');
    expect(refused.json().title).toMatch(/AI model to US/);
    expect(
      (await call('admin', 'PUT', '/admin/settings', { ai: { activeModel: 'sim-llm-fast-v1' } })).statusCode,
    ).toBe(422);
    expect(((await call('admin', 'GET', '/ai/active-model')).json() as Json).activeModel).toBe(
      'rules-simulated-v1',
    );
    // allow the US, switch it on, then take the US away again
    await setResidency({ allowedRegions: ['US'] }, 'Allow the US to try the fast model');
    expect(
      (await call('admin', 'PUT', '/ai/active-model', { activeModel: 'sim-llm-fast-v1' })).statusCode,
    ).toBe(200);
    const chat = await call('requester', 'POST', '/assistant/chat', {
      message: 'How does the workflow work?',
    });
    expect(chat.json()).toMatchObject({ model: 'sim-llm-fast-v1' });
    const out = await setResidency({ allowedRegions: [] }, 'The US is no longer allowed');
    expect(out.json().aiModelsWithdrawn).toContain('sim-llm-fast-v1');
    expect(((await call('admin', 'GET', '/ai/active-model')).json() as Json).activeModel).toBe(
      'rules-simulated-v1',
    );
    expect((await auditActions('ai.withdrawn_by_residency')).length).toBe(1);
  });

  it('email and SMS: with the gateway outside the allowed regions a message is kept as blocked, not sent', async () => {
    const mail = (to: string) =>
      sys<string>((tx) =>
        sendEmail(tx, { tenantId: TENANT_ID, to, subject: 'Hello', body: 'Body', kind: 'WELCOME' }),
      );
    const statusOf = async (id: string) =>
      (await sys<Json[]>((tx) => tx.select().from(s.outboundEmail).where(eq(s.outboundEmail.id, id))))[0]!
        .status;
    expect(await statusOf(await mail('a@example.test'))).toBe('SIMULATED');
    await setResidency({ country: 'NZ' }, 'Host in New Zealand with no other region');
    expect(await statusOf(await mail('b@example.test'))).toBe('BLOCKED_RESIDENCY');
    const v = await view();
    expect(v.recentRefusals.some((r: Json) => r.purpose === 'EMAIL_SMS' && r.region === 'AU')).toBe(true);
    await reset();
    await call('admin', 'PUT', '/connectors/MESSAGING', { enabled: true });
    await call('admin', 'PUT', '/connectors/ESIGN', { enabled: true });
  });

  it('outside search: refused when the provider region is outside the country; allowed in the country', async () => {
    expect(
      (await call('admin', 'PUT', '/admin/settings', { externalSearch: { enabled: true } })).statusCode,
    ).toBe(200);
    const ok = await call('procurement', 'POST', '/search', {
      query: 'insurance liability cover',
      includeExternal: true,
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().external.asked).toBe(true);
    await setResidency({ country: 'NZ' }, 'Host in New Zealand with no other region');
    const no = await call('procurement', 'POST', '/search', {
      query: 'insurance liability cover',
      includeExternal: true,
    });
    expect(no.statusCode).toBe(422);
    expect(no.json()).toMatchObject({ code: 'RESIDENCY_VIOLATION' });
    expect(no.json().title).toMatch(/outside search to AU/);
    await reset();
    expect(
      (await call('admin', 'PUT', '/admin/settings', { externalSearch: { enabled: false } })).statusCode,
    ).toBe(200);
  });

  it('log and audit export: goes only to the nominated log region', async () => {
    expect((await call('probity', 'GET', '/audit-events/export')).statusCode).toBe(200);
    await setResidency({ logRegion: 'US' }, 'Send logs to a US log service for a trial');
    const r = await call('probity', 'GET', '/audit-events/export');
    expect(r.statusCode).toBe(422);
    expect(r.json().title).toMatch(/log and audit export to US/);
    await reset();
  });

  it('AI conversation storage is refused when the AI region is not allowed', async () => {
    expect(
      (await call('requester', 'POST', '/assistant/conversations', { purpose: 'INTAKE' })).statusCode,
    ).toBe(201);
    await setResidency({ aiRegion: 'US' }, 'Try the AI in the US');
    const r = await call('requester', 'POST', '/assistant/conversations', { purpose: 'INTAKE' });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe('RESIDENCY_VIOLATION');
    expect(r.json().title).toMatch(/AI conversation storage to US/);
    await reset();
  });

  it('the pure rule: the elected country and the allow-list pass, anything else is refused', () => {
    const r = { country: 'AU', allowedRegions: ['NZ'], aiRegion: 'AU', logRegion: 'AU' } as const;
    expect(regionDecision(r as never, 'CONNECTOR', 'AU').allowed).toBe(true);
    expect(regionDecision(r as never, 'CONNECTOR', 'nz').allowed).toBe(true);
    const d = regionDecision(r as never, 'ESIGNATURE', 'US');
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/e-signature to US/);
    expect(() => assertRegion(r as never, 'REPOSITORY', 'EU')).toThrow(/document repository to EU/);
  });

  it('the settings sections exist with their defaults', async () => {
    const st = await sys<Awaited<ReturnType<typeof loadSettings>>>((tx) => loadSettings(tx, TENANT_ID));
    expect(st.residency).toEqual(HOME);
    expect(st.egress.allowedHosts).toEqual(['*.simulated.test']);
  });
});

describe('SEC-D05 egress allow-list: only simulated hosts by default, everything else refused', () => {
  it('matches exact names and wildcards, and refuses an over-broad wildcard', () => {
    expect(hostMatches('*.simulated.test', 'icertis.simulated.test')).toBe(true);
    expect(hostMatches('*.simulated.test', 'simulated.test')).toBe(false);
    expect(hostMatches('*.simulated.test', 'api.openai.com')).toBe(false);
    expect(hostMatches('api.vendor.example', 'API.VENDOR.EXAMPLE:443')).toBe(true);
    expect(patternProblem('*.com')).toMatch(/too broad/);
    expect(patternProblem('*')).toMatch(/not a host name/);
    expect(patternProblem('10.0.0.1')).toMatch(/address/);
    expect(patternProblem('*.simulated.test')).toBeNull();
    expect(() => assertEgress(['*.simulated.test'], 'api.openai.com', 'AI model')).toThrow(
      /not on the egress allow-list/,
    );
  });

  it('the probe is refused, audited and counted for a public host, and passes for a simulated one', async () => {
    const before = (await view()).egress.blocked;
    const no = await call('admin', 'POST', '/admin/egress/probe', { host: 'api.openai.com' });
    expect(no.statusCode).toBe(422);
    expect(no.json().code).toBe('EGRESS_BLOCKED');
    const yes = await call('admin', 'POST', '/admin/egress/probe', { host: 'fast.llm.simulated.test' });
    expect(yes.statusCode).toBe(200);
    const e = (await call('probity', 'GET', '/admin/egress')).json() as Json;
    expect(e.blocked).toBe(before + 1);
    expect(e.allowedHosts).toEqual(['*.simulated.test']);
    expect(e.evidence).toMatch(/allow-list/);
    expect(e.recent[0]).toMatchObject({ kind: 'EGRESS', target: 'api.openai.com' });
    expect((await auditActions('egress.blocked')).at(-1)!.result).toBe('DENIED');
  });

  it('changing the allow-list needs a reason and a valid host, and is audited', async () => {
    expect(
      (await call('admin', 'PUT', '/admin/egress', { allowedHosts: ['*.simulated.test'] })).statusCode,
    ).toBe(400);
    const broad = await call('admin', 'PUT', '/admin/egress', {
      allowedHosts: ['*.com'],
      reason: 'Allow everything please',
    });
    expect(broad.statusCode).toBe(422);
    const ok = await call('admin', 'PUT', '/admin/egress', {
      allowedHosts: ['*.simulated.test', 'llm.in-region.example'],
      reason: 'Approved in-region model endpoint',
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().allowedHosts).toEqual(['*.simulated.test', 'llm.in-region.example']);
    expect(
      (await call('admin', 'POST', '/admin/egress/probe', { host: 'llm.in-region.example' })).statusCode,
    ).toBe(200);
    const ev = (await auditActions('settings.egress')).at(-1)!;
    expect(ev.after).toMatchObject({ reason: 'Approved in-region model endpoint' });
    await call('admin', 'PUT', '/admin/egress', {
      allowedHosts: ['*.simulated.test'],
      reason: 'Back to the simulated hosts only',
    });
    expect(
      (await call('supplier', 'PUT', '/admin/egress', { allowedHosts: [], reason: 'Not allowed to do this' }))
        .statusCode,
    ).toBe(403);
  });

  it('a connector host that is not on the list is refused (EGRESS_BLOCKED), even in an allowed region', async () => {
    await call('admin', 'PUT', '/connectors/ESIGN', { enabled: true });
    await call('admin', 'PUT', '/admin/egress', {
      allowedHosts: ['esign.other.example'],
      reason: 'Test: nothing simulated allowed',
    });
    const t = await call('admin', 'POST', '/connectors/ESIGN/test');
    expect(t.json()).toMatchObject({ ok: false, reason: 'EGRESS_BLOCKED' });
    const put = await call('admin', 'PUT', '/connectors/SANCTIONS', {
      enabled: true,
      provider: 'SIMULATED_SANCTIONS',
    });
    expect(put.statusCode).toBe(422);
    expect(put.json().code).toBe('EGRESS_BLOCKED');
    await call('admin', 'PUT', '/admin/egress', {
      allowedHosts: ['*.simulated.test'],
      reason: 'Restore the default list',
    });
    expect((await call('admin', 'POST', '/connectors/ESIGN/test')).json()).toMatchObject({ ok: true });
  });
});
