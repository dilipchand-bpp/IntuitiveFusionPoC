import { and, eq, isNotNull } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../../audit/audit-service.js';
import * as s from '../../db/schema.js';
import { emailFor, TENANT_ID, uid } from '../../db/seed.js';
import { PASSWORD, createEnv, type Json } from '../contract/test-env.js';
import { saveSettings } from '../settings/settings.js';
import { CHECKS } from './compliance.js';
import { ipPrefix, localParts, uaFamily } from './access-monitor.js';

let env: Awaited<ReturnType<typeof createEnv>>;
const call = (...a: Parameters<typeof env.call>) => env.call(...a);
const sys = <T>(fn: Parameters<typeof env.withSystem>[1]) => env.withSystem(env.database, fn) as Promise<T>;
const NOW = '2026-10-02T00:00:00.000Z';
let requestIds: string[] = [];
beforeAll(async () => {
  env = await createEnv();
  requestIds = (
    await sys<Array<{ id: string }>>((tx) => tx.select({ id: s.request.id }).from(s.request))
  ).map((r) => r.id);
}, 120_000);

const monitorSettings = async (patch: Json) => {
  const cur = ((await call('admin', 'GET', '/admin/settings')).json() as Json).securityMonitor;
  const r = await call('admin', 'PUT', '/admin/settings', { securityMonitor: { ...cur, ...patch } });
  expect(r.statusCode, r.body).toBe(200);
};
const run = async (who = 'admin') => {
  const r = await call(who, 'POST', '/security/monitor/run');
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as Json;
};
const alerts = async (rule?: string) => {
  const r = await call('admin', 'GET', '/security/alerts?limit=200');
  expect(r.statusCode, r.body).toBe(200);
  return (r.json() as Json).items.filter((a: Json) => !rule || a.rule === rule) as Json[];
};
const login = (email: string, password = PASSWORD, ua?: string) =>
  env.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
    ...(ua ? { headers: { 'user-agent': ua } } : {}),
  });

describe('SEC-L06 anomalous access is detected and routed to the security owner (rules-simulated-v1)', () => {
  it('pure helpers: browser family, address prefix and local hours in the organisation time zone', () => {
    expect(uaFamily('Mozilla/5.0 (X11) Chrome/120.0 Safari/537')).toBe('Chrome');
    expect(uaFamily('Mozilla/5.0 Edg/120')).toBe('Edge');
    expect(uaFamily(undefined)).toBe('unknown');
    expect(ipPrefix('203.0.113.77')).toBe('203.0.113.x');
    expect(ipPrefix('::ffff:10.1.2.3')).toBe('10.1.2.x');
    expect(localParts(new Date('2026-10-02T10:30:00Z'), 'Australia/Sydney')).toEqual({
      hour: 20,
      weekday: 5,
    });
  });

  it('does not flag ordinary use at the default (generous) thresholds', async () => {
    for (const id of requestIds.slice(0, 6)) await call('procurement', 'GET', `/requests/${id}`);
    await call('requester', 'GET', `/requests/${uid('missing-1')}`);
    await call('probity', 'GET', '/audit-events/export');
    const r = await run();
    expect(r).toMatchObject({ created: 0, escalated: 0 });
    expect(await alerts()).toEqual([]);
  });

  it('record views above the limit raise an alert for the person, routed to the security owner and notified', async () => {
    await monitorSettings({ viewBurstCount: 5, viewBurstMinutes: 10 });
    for (let i = 0; i < 6; i++) await call('procurement', 'GET', `/requests/${requestIds[0]}`);
    const r = await run('exec');
    expect(r.created).toBeGreaterThanOrEqual(1);
    const [a] = await alerts('ACCESS_VOLUME');
    expect(a).toMatchObject({
      severity: 'MEDIUM',
      status: 'NEW',
      subject: 'Priya Nair',
      owner: 'Jonas Becker',
      model: 'rules-simulated-v1',
    });
    expect(a!.summary).toMatch(/viewed \d+ records in 10 minutes \(limit 5\)/);
    expect(a!.evidence).toMatchObject({ threshold: 5, windowMinutes: 10 });
    const notes = await sys<Json[]>((tx) =>
      tx.select().from(s.notification).where(eq(s.notification.event, 'security.alert')),
    );
    expect(notes.some((n) => n.userId === uid('user:probity') && /Security alert/.test(n.title))).toBe(true);
    // the same burst does not raise a second alert while the first stands
    await run();
    expect((await alerts('ACCESS_VOLUME')).length).toBe(1);
    // the access log holds route patterns and ids only
    const log = await sys<Json[]>((tx) => tx.select().from(s.accessEvent).limit(5));
    expect(Object.keys(log[0]!).sort()).toEqual([
      'at',
      'entityId',
      'id',
      'kind',
      'route',
      'status',
      'tenantId',
      'userId',
    ]);
    expect(log.every((l) => !String(l.route).startsWith('/api/v1'))).toBe(true);
    await monitorSettings({ viewBurstCount: 300 });
  });

  it('refused attempts on many different records raise a high alert', async () => {
    await monitorSettings({ deniedBurstCount: 3, deniedBurstMinutes: 10 });
    for (let i = 0; i < 4; i++) await call('requester', 'GET', `/requests/${uid(`not-mine-${i}`)}`);
    await run();
    const [a] = await alerts('DENIED_BURST');
    expect(a).toMatchObject({ severity: 'HIGH', subject: 'Riley Chen' });
    expect(a!.evidence.distinctRecords).toBeGreaterThanOrEqual(3);
    await monitorSettings({ deniedBurstCount: 20 });
  });

  it('bulk exports raise an alert', async () => {
    await monitorSettings({ exportBurstCount: 2, exportBurstMinutes: 60 });
    for (let i = 0; i < 3; i++)
      expect((await call('probity', 'GET', '/audit-events/export')).statusCode).toBe(200);
    await run();
    const [a] = await alerts('BULK_EXPORT');
    expect(a).toMatchObject({ subject: 'Jonas Becker' });
    await monitorSettings({ exportBurstCount: 10 });
  });

  it('a sign-in from a browser and network not seen before is flagged; the same profile again is not', async () => {
    await call('exec', 'GET', '/auth/me'); // baseline: no user agent
    env.clock.advanceMs(60_000); // sessions made in the same instant cannot be told apart
    const chrome = 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0 Safari/537.36';
    expect((await login(emailFor('exec'), PASSWORD, chrome)).statusCode).toBe(200);
    await run();
    const first = await alerts('NEW_DEVICE');
    expect(first.length).toBe(1);
    expect(first[0]).toMatchObject({ subject: 'Elena Petrova', severity: 'MEDIUM' });
    expect(first[0]!.evidence).toMatchObject({ browser: 'Chrome' });
    expect(JSON.stringify(first[0])).not.toMatch(/127\.0\.0\.1/); // only the prefix is kept
    env.clock.advanceMs(60_000);
    expect((await login(emailFor('exec'), PASSWORD, chrome)).statusCode).toBe(200);
    await run();
    expect((await alerts('NEW_DEVICE')).length).toBe(1);
  });

  it('repeated failed sign-ins followed by a success are flagged, and the account is never locked by the monitor', async () => {
    await monitorSettings({ failedLoginsBeforeSuccess: 3 });
    for (let i = 0; i < 3; i++)
      expect((await login(emailFor('legal'), 'wrong-password-123')).statusCode).toBe(401);
    expect((await login(emailFor('legal'))).statusCode).toBe(200);
    await run();
    const [a] = await alerts('FAILED_THEN_SUCCESS');
    expect(a).toMatchObject({ subject: 'Henry Albright' });
    expect(a!.evidence).toMatchObject({ failedAttempts: 3 });
    const [u] = await sys<Json[]>((tx) =>
      tx
        .select()
        .from(s.appUser)
        .where(eq(s.appUser.id, uid('user:legal'))),
    );
    expect(u).toMatchObject({ active: true, lockedUntil: null });
  });

  it('many failed multi-factor codes are flagged', async () => {
    await monitorSettings({ mfaFailureCount: 3, mfaWindowMinutes: 30 });
    const audit = new AuditService(env.clock);
    const ctx = { tenantId: TENANT_ID, userId: uid('user:chair'), role: 'CHAIR' as const };
    await sys(async (tx) => {
      for (let i = 0; i < 3; i++)
        await audit.record(tx, ctx, { action: 'auth.mfa_failed', entityType: 'user_mfa', result: 'DENIED' });
    });
    await run();
    const [a] = await alerts('MFA_FAILURES');
    expect(a).toMatchObject({ subject: 'Grace Mwangi', severity: 'HIGH' });
  });

  it('out-of-hours sign-ins and privilege changes are flagged when switched on, using the organisation time zone', async () => {
    await monitorSettings({
      outOfHoursCheck: true,
      businessHoursStart: 7,
      businessHoursEnd: 19,
      timeZone: 'Australia/Sydney',
    });
    env.clock.set('2026-10-02T10:30:00Z'); // 20:30 on a Friday in Sydney (daylight saving starts on the Sunday)
    const who = await env.extraUser('night-owl', 'PROCUREMENT');
    expect((await login(who.email)).statusCode).toBe(200);
    const audit = new AuditService(env.clock);
    await sys((tx) =>
      audit.record(
        tx,
        { tenantId: TENANT_ID, userId: uid('user:admin'), role: 'ADMIN' },
        { action: 'delegation.update', entityType: 'delegation' },
      ),
    );
    await run();
    const ooh = await alerts('OUT_OF_HOURS_SIGNIN');
    expect(ooh.some((a) => a.subject === 'Extra night-owl')).toBe(true);
    const priv = await alerts('PRIVILEGE_CHANGE_OFF_HOURS');
    expect(priv[0]).toMatchObject({ subject: 'Noah Kim' });
    // the same actions in business hours are not flagged
    env.clock.set('2026-10-05T01:30:00Z'); // 12:30 on the Monday
    const day = await env.extraUser('day-worker', 'PROCUREMENT');
    expect((await login(day.email)).statusCode).toBe(200);
    await sys((tx) =>
      audit.record(
        tx,
        { tenantId: TENANT_ID, userId: uid('user:admin'), role: 'ADMIN' },
        { action: 'delegation.update', entityType: 'delegation' },
      ),
    );
    await run();
    expect((await alerts('OUT_OF_HOURS_SIGNIN')).some((a) => a.subject === 'Extra day-worker')).toBe(false);
    expect((await alerts('PRIVILEGE_CHANGE_OFF_HOURS')).length).toBe(priv.length);
    await monitorSettings({ outOfHoursCheck: false });
    env.clock.set(NOW);
  });

  it('acknowledge and close need a note to close; ending sessions is audited and never locks the account', async () => {
    const [a] = await alerts('ACCESS_VOLUME');
    for (const who of ['requester', 'procurement', 'finance'])
      expect((await call(who, 'POST', `/security/alerts/${a!.id}/acknowledge`, {})).statusCode).toBe(403);
    const ack = await call('probity', 'POST', `/security/alerts/${a!.id}/acknowledge`, { note: 'looking' });
    expect(ack.statusCode, ack.body).toBe(200);
    expect(ack.json()).toMatchObject({ status: 'ACKNOWLEDGED', acknowledgedBy: 'Jonas Becker' });
    await call('procurement', 'GET', '/auth/me');
    const ended = await call('probity', 'POST', `/security/alerts/${a!.id}/end-sessions`, {
      note: 'precaution',
    });
    expect(ended.statusCode, ended.body).toBe(200);
    expect(ended.json().sessionsEnded).toBeGreaterThanOrEqual(1);
    const live = await sys<Json[]>((tx) =>
      tx
        .select()
        .from(s.session)
        .where(and(eq(s.session.userId, uid('user:procurement')), eq(s.session.tenantId, TENANT_ID))),
    );
    expect(live.every((x) => x.revokedAt)).toBe(true);
    const [u] = await sys<Json[]>((tx) =>
      tx
        .select()
        .from(s.appUser)
        .where(eq(s.appUser.id, uid('user:procurement'))),
    );
    expect(u).toMatchObject({ active: true, lockedUntil: null });
    const ev = await sys<Json[]>((tx) =>
      tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'security.sessions_ended')),
    );
    expect(ev[0]!.after).toMatchObject({ accountLocked: false });
    expect((await call('exec', 'POST', `/security/alerts/${a!.id}/end-sessions`, {})).statusCode).toBe(403); // owners only (probity, admin)
    expect(
      (await call('probity', 'POST', `/security/alerts/${a!.id}/close`, { note: 'no' })).statusCode,
    ).toBe(400);
    const closed = await call('probity', 'POST', `/security/alerts/${a!.id}/close`, {
      note: 'A bulk review, expected.',
    });
    expect(closed.json()).toMatchObject({ status: 'CLOSED', closeNote: 'A bulk review, expected.' });
    expect(
      (await call('probity', 'POST', `/security/alerts/${a!.id}/close`, { note: 'again please' })).statusCode,
    ).toBe(409);
  });

  it('an alert nobody acknowledges within the setting goes to the executives; an acknowledged one does not', async () => {
    await monitorSettings({ escalateAfterMinutes: 60, viewBurstCount: 2, viewBurstMinutes: 10 });
    for (let i = 0; i < 3; i++) await call('legal', 'GET', `/requests/${requestIds[1]}`);
    await call('contract-mgr', 'GET', `/requests/${requestIds[1]}`);
    await call('contract-mgr', 'GET', `/requests/${requestIds[1]}`);
    await run();
    const open = (await alerts('ACCESS_VOLUME')).filter((x) => x.status === 'NEW');
    expect(open.length).toBeGreaterThanOrEqual(2);
    await call('probity', 'POST', `/security/alerts/${open[0]!.id}/acknowledge`, {});
    env.clock.advanceMs(30 * 60_000);
    expect((await run()).escalated).toBe(0);
    env.clock.advanceMs(31 * 60_000);
    const r = await run();
    expect(r.escalated).toBeGreaterThanOrEqual(1);
    const after = await alerts('ACCESS_VOLUME');
    expect(after.find((x) => x.id === open[0]!.id)!.status).toBe('ACKNOWLEDGED');
    const esc = after.filter((x) => x.status === 'ESCALATED');
    expect(esc.length).toBeGreaterThanOrEqual(1);
    const notes = await sys<Json[]>((tx) =>
      tx.select().from(s.notification).where(isNotNull(s.notification.event)),
    );
    expect(notes.some((n) => n.userId === uid('user:exec') && /Escalated security alert/.test(n.title))).toBe(
      true,
    );
    env.clock.set(NOW);
    await monitorSettings({ viewBurstCount: 300 });
  });

  it('the status endpoint lists the rules, the owner and the last run; the settings section is listed with an editor', async () => {
    const st = (await call('exec', 'GET', '/security/monitor/status')).json() as Json;
    expect(st).toMatchObject({ model: 'rules-simulated-v1', simulated: true, enabled: true });
    expect(st.owner).toMatchObject({ name: 'Jonas Becker', configured: false });
    expect(st.rules.map((x: Json) => x.rule)).toContain('BULK_EXPORT');
    expect(st.lastRun).toBeTruthy();
    expect((await call('requester', 'GET', '/security/monitor/status')).statusCode).toBe(403);
    // a named owner overrides the fallback
    await monitorSettings({ ownerUserId: uid('user:admin') });
    expect(((await call('exec', 'GET', '/security/monitor/status')).json() as Json).owner).toMatchObject({
      name: 'Noah Kim',
      configured: true,
    });
    await monitorSettings({ ownerUserId: null });
    const inv = (await call('admin', 'GET', '/admin/config/inventory')).json() as Json;
    expect(inv.sections.find((x: Json) => x.section === 'securityMonitor').editor).toMatchObject({
      screen: '/app/security-alerts',
    });
  });
});

// ------------------------------------------------------------------------------------------------------------------
describe('SEC-L08 configuration compliance is checked continuously, with remediation', () => {
  const runCompliance = async (who = 'admin') => {
    const r = await call(who, 'POST', '/compliance/run');
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as Json;
  };
  const check = (j: Json, key: string) => j.checks.find((c: Json) => c.key === key) as Json;

  it('runs every check and records pass, fail or warn with the reason; roles', async () => {
    const j = await runCompliance();
    expect(j.checks.length).toBe(CHECKS.length);
    expect(check(j, 'MFA_PRIVILEGED')).toMatchObject({ status: 'FAIL', remediation: null });
    expect(check(j, 'MFA_PRIVILEGED').guidance).toMatch(/Require multi-factor/);
    expect(check(j, 'APPROVAL_LINK_VALIDITY').status).toBe('PASS');
    expect(check(j, 'ADMIN_SEPARATION').status).toBe('PASS');
    expect(check(j, 'LOCKOUT').status).toBe('PASS');
    expect(check(j, 'SESSION_LENGTH').status).toBe('PASS');
    expect(check(j, 'PASSWORD_POLICY').status).toBe('WARN');
    expect(check(j, 'DEFAULT_PASSWORD').status).toBe('PASS'); // the tests use their own password
    expect(check(j, 'AUDIT_CHAIN_VERIFIED').status).toBe('WARN');
    expect(j.summary.fail + j.summary.warn + j.summary.pass).toBe(CHECKS.length);
    const rows = await sys<Json[]>((tx) => tx.select().from(s.complianceCheckResult));
    expect(rows.length).toBe(CHECKS.length);
    expect(rows.find((r) => r.checkKey === 'MFA_PRIVILEGED')!.firstFailedAt).toBeTruthy();
    for (const who of ['probity', 'exec']) {
      const g = (await call(who, 'GET', '/compliance')).json() as Json;
      expect(g.canRemediate).toBe(false);
      expect(g.checks.length).toBe(CHECKS.length);
    }
    expect((await call('requester', 'GET', '/compliance')).statusCode).toBe(403);
    expect((await call('finance', 'POST', '/compliance/run')).statusCode).toBe(403);
    await call('probity', 'POST', '/audit/admin-chain/verify');
    expect(check(await runCompliance('probity'), 'AUDIT_CHAIN_VERIFIED').status).toBe('PASS');
  });

  it('a check that passed and now fails raises an alert for the security owner (drift) and a settings change re-runs the checks', async () => {
    const put = await call('admin', 'PUT', '/admin/settings', {
      approvalLinks: { enabled: true, validHours: 200, showCommercial: false },
    });
    expect(put.statusCode, put.body).toBe(200);
    // the re-check after a settings change runs in the background
    let row: Json | undefined;
    for (let i = 0; i < 40 && row?.status !== 'FAIL'; i++) {
      await new Promise((r) => setTimeout(r, 100));
      row = (await sys<Json[]>((tx) => tx.select().from(s.complianceCheckResult))).find(
        (r) => r.checkKey === 'APPROVAL_LINK_VALIDITY',
      );
    }
    expect(row).toMatchObject({ status: 'FAIL', previousStatus: 'PASS' });
    expect(row!.firstFailedAt).toBeTruthy();
    const drift = (await sys<Json[]>((tx) => tx.select().from(s.securityAlert))).filter(
      (a) => a.rule === 'CONFIG_DRIFT:APPROVAL_LINK_VALIDITY',
    );
    expect(drift.length).toBe(1);
    expect(drift[0]).toMatchObject({ ownerUserId: uid('user:probity'), status: 'NEW', subjectUserId: null });
    const notes = await sys<Json[]>((tx) =>
      tx.select().from(s.notification).where(eq(s.notification.event, 'security.alert')),
    );
    expect(notes.some((n) => /drift/i.test(n.body ?? ''))).toBe(true);
    // the alert is visible on the alert list with a readable rule label
    expect(
      (await call('probity', 'GET', '/security/alerts'))
        .json()
        .items.some((a: Json) => /configuration check/i.test(a.ruleLabel)),
    ).toBe(true);
  });

  it('one-click remediation is administrator-only, audited with a reason, and re-checks', async () => {
    const before = check(await runCompliance(), 'APPROVAL_LINK_VALIDITY');
    expect(before.status).toBe('FAIL');
    expect(before.remediation).toMatchObject({ oneClick: true });
    expect(
      (
        await call('probity', 'POST', '/compliance/checks/APPROVAL_LINK_VALIDITY/remediate', {
          reason: 'fix it now',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await call('admin', 'POST', '/compliance/checks/APPROVAL_LINK_VALIDITY/remediate', { reason: 'no' }))
        .statusCode,
    ).toBe(400);
    const r = await call('admin', 'POST', '/compliance/checks/APPROVAL_LINK_VALIDITY/remediate', {
      reason: 'Back to the recommended validity',
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().check).toMatchObject({ status: 'PASS' });
    expect(((await call('admin', 'GET', '/admin/settings')).json() as Json).approvalLinks.validHours).toBe(
      48,
    );
    const trail = await sys<Json[]>((tx) => tx.select().from(s.auditEvent));
    expect(
      trail.some(
        (e) =>
          e.action === 'compliance.remediate' &&
          (e.after as Json).reason === 'Back to the recommended validity',
      ),
    ).toBe(true);
    expect(trail.filter((e) => e.action === 'settings.approvalLinks').length).toBeGreaterThanOrEqual(2);
    expect(
      (
        await call('admin', 'POST', '/compliance/checks/APPROVAL_LINK_VALIDITY/remediate', {
          reason: 'again, please',
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await call('admin', 'POST', '/compliance/checks/MFA_PRIVILEGED/remediate', {
          reason: 'turn it on please',
        })
      ).statusCode,
    ).toBe(409); // guidance only
    expect(
      (await call('admin', 'POST', '/compliance/checks/NOPE/remediate', { reason: 'turn it on please' }))
        .statusCode,
    ).toBe(404);
  });

  it('flags an administrator who is also an approver, outside AI search with no allow-list, and dormant privileged accounts', async () => {
    await sys((tx) =>
      tx
        .insert(s.roleAssignment)
        .values({ tenantId: TENANT_ID, userId: uid('user:admin'), role: 'DELEGATE' }),
    );
    let j = await runCompliance();
    expect(check(j, 'ADMIN_SEPARATION')).toMatchObject({ status: 'FAIL' });
    expect(check(j, 'ADMIN_SEPARATION').detail).toMatch(/Noah Kim/);
    await sys((tx) =>
      tx
        .delete(s.roleAssignment)
        .where(and(eq(s.roleAssignment.userId, uid('user:admin')), eq(s.roleAssignment.role, 'DELEGATE'))),
    );

    const hosts = ((await call('admin', 'GET', '/admin/settings')).json() as Json).egress
      .allowedHosts as string[];
    // the allow-list is changed on the residency page in the product; the test sets it directly
    await sys((tx) => saveSettings(tx, TENANT_ID, { egress: { allowedHosts: [] } }));
    expect(
      (await call('admin', 'PUT', '/admin/settings', { externalSearch: { enabled: true } })).statusCode,
    ).toBe(200);
    j = await runCompliance();
    expect(check(j, 'EXTERNAL_SEARCH_RESIDENCY').status).toBe('FAIL');
    const fix = await call('admin', 'POST', '/compliance/checks/EXTERNAL_SEARCH_RESIDENCY/remediate', {
      reason: 'Switch it off until the allow-list is agreed',
    });
    expect(fix.statusCode, fix.body).toBe(200);
    expect(((await call('admin', 'GET', '/admin/settings')).json() as Json).externalSearch.enabled).toBe(
      false,
    );
    await sys((tx) => saveSettings(tx, TENANT_ID, { egress: { allowedHosts: hosts } }));

    env.clock.advanceDays(200);
    j = await runCompliance();
    expect(check(j, 'DORMANT_PRIVILEGED').status).toBe('WARN');
    env.clock.set(NOW);
  });
});
