import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import * as s from '../../db/schema.js';
import { createEnv, type Json } from '../contract/test-env.js';
import { DEFAULTS, formatNumber, settingsFrom, variationNumber } from './settings.js';

let env: Awaited<ReturnType<typeof createEnv>>;
beforeAll(async () => {
  env = await createEnv();
}, 120_000);
const sys = <T>(fn: Parameters<typeof env.withSystem>[1]) => env.withSystem(env.database, fn) as Promise<T>;
const put = (body: Json) => env.call('admin', 'PUT', '/admin/settings', body);

describe('procurement numbers (FR-0695)', () => {
  it('formats by year, by Australian financial year (1 July) or as a plain sequence', () => {
    const n = DEFAULTS.numbering;
    expect(formatNumber(n, new Date('2026-10-02T00:00:00Z'), 7)).toBe('PR-2026-0007');
    expect(
      formatNumber({ ...n, scheme: 'FY_SEQ', prefix: 'ABC', digits: 5 }, new Date('2026-06-30T00:00:00Z'), 1),
    ).toBe('ABC-FY26-00001');
    expect(
      formatNumber({ ...n, scheme: 'FY_SEQ', prefix: 'ABC', digits: 5 }, new Date('2026-07-01T00:00:00Z'), 1),
    ).toBe('ABC-FY27-00001');
    expect(formatNumber({ ...n, scheme: 'SEQ' }, new Date('2026-10-02T00:00:00Z'), 12)).toBe('PR-0012');
  });

  it('a variation number carries its parent number so the relationship is explicit', () => {
    expect(variationNumber('ABC001', 1)).toBe('ABC001.v1');
    expect(variationNumber('CT-2026-0003', 2)).toBe('CT-2026-0003.v2');
  });

  it('stored values are checked and fall back to defaults when invalid; the three older keys are still read', () => {
    expect(settingsFrom({ settings: { numbering: { scheme: 'NOPE' } } }).numbering).toEqual(
      DEFAULTS.numbering,
    );
    const legacy = settingsFrom({ selfServiceThresholdAud: 75_000, budgetCap: 'SOFT' });
    expect(legacy.intake.selfServiceThresholdAud).toBe(75_000);
    expect(legacy.intake.budgetCap).toBe('SOFT');
  });
});

describe('settings API (FR-0690)', () => {
  it('only administrators read or change settings; everyone signed in reads the labels and their layout', async () => {
    expect((await env.call('requester', 'GET', '/admin/settings')).statusCode).toBe(403);
    expect((await env.call('procurement', 'PUT', '/admin/settings', { fieldLabels: {} })).statusCode).toBe(
      403,
    );
    const r = await env.call('admin', 'GET', '/admin/settings');
    expect(r.statusCode).toBe(200);
    expect(r.json().numbering).toEqual(DEFAULTS.numbering);
    expect(r.json().numberingExample).toBe('PR-2026-0007');
    const pub = await env.call('requester', 'GET', '/settings');
    expect(pub.json()).toMatchObject({ fieldLabels: {}, customFields: [], layout: 'LIST' });
  });

  it('every change is audited with the administrator, the setting and the old and new value', async () => {
    const r = await put({
      notifications: {
        channels: ['IN_APP', 'EMAIL', 'SLACK'],
        escalationHours: 24,
        rules: DEFAULTS.notifications.rules,
      },
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().notifications.escalationHours).toBe(24);
    const events = await sys<Json[]>((tx) =>
      tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'settings.notifications')),
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.actorRole).toBe('ADMIN');
    expect(events[0]!.actorId).toBeTruthy();
    expect(JSON.stringify(events[0]!.before)).toContain('"escalationHours":48');
    expect(JSON.stringify(events[0]!.after)).toContain('"escalationHours":24');
    // saving the same thing again is not a change and writes nothing
    await put({ notifications: r.json().notifications });
    expect(
      await sys<Json[]>((tx) =>
        tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'settings.notifications')),
      ),
    ).toHaveLength(1);
    await put({ notifications: DEFAULTS.notifications });
  });

  it('rejects invalid values with the reason, and changes nothing', async () => {
    expect(
      (await put({ numbering: { scheme: 'YEAR_SEQ', prefix: 'bad prefix', digits: 4 } })).statusCode,
    ).toBe(400);
    expect((await put({})).statusCode).toBe(400);
    expect((await put({ unknownSection: {} })).statusCode).toBe(400);
    const clash = await put({
      customFields: [{ key: 'title', label: 'Title', type: 'TEXT', mandatory: false }],
    });
    expect(clash.statusCode).toBe(422);
    expect(JSON.stringify(clash.json())).toContain('already a built-in field');
    const label = await put({ fieldLabels: { notAField: 'Nope' } });
    expect(label.statusCode).toBe(422);
    expect(
      (await put({ workflowRouting: { simpleBelow: 900_000, intermediateBelow: 100 } })).statusCode,
    ).toBe(400);
    expect((await env.call('admin', 'GET', '/admin/settings')).json().numbering).toEqual(DEFAULTS.numbering);
  });
});

describe('configured numbering, labels and custom fields drive the requests', () => {
  it('a new request is numbered in the configured format and the sequence continues', async () => {
    expect((await put({ numbering: { scheme: 'FY_SEQ', prefix: 'ABC', digits: 5 } })).statusCode).toBe(200);
    const a = await env.call('requester', 'POST', '/requests', {});
    const b = await env.call('requester', 'POST', '/requests', {});
    expect(a.json().number).toBe('ABC-FY27-00001'); // 2 October 2026 is in the financial year ending 30 June 2027
    expect(b.json().number).toBe('ABC-FY27-00002');
    await put({ numbering: DEFAULTS.numbering });
    const c = await env.call('requester', 'POST', '/requests', {});
    expect(c.json().number).toMatch(/^PR-2026-\d{4}$/);
  });

  it('a relabelled field shows the customer wording everywhere the request is shown', async () => {
    await put({ fieldLabels: { estimatedValue: 'Expenditure (AUD)' } });
    const created = (await env.call('requester', 'POST', '/requests', { estimatedValue: 5000 })).json();
    const got = (await env.call('requester', 'GET', `/requests/${created.id}`)).json();
    const f = got.fields.find((x: Json) => x.key === 'estimatedValue');
    expect(f.label).toBe('Expenditure (AUD)');
    expect(got.fields.find((x: Json) => x.key === 'category').label).toBe('Category');
    await put({ fieldLabels: {} });
  });

  it('custom fields (FR-0710) are saved, type-checked, and a mandatory one blocks submission until filled', async () => {
    const set = await put({
      customFields: [
        { key: 'indigenousFlag', label: 'Indigenous procurement', type: 'FLAG', mandatory: false },
        { key: 'costCentre', label: 'Cost centre', type: 'TEXT', mandatory: true },
        { key: 'carbonKg', label: 'Carbon estimate (kg)', type: 'NUMBER', mandatory: false },
      ],
    });
    expect(set.statusCode, set.body).toBe(200);
    const created = (
      await env.call('requester', 'POST', '/requests', {
        title: 'Custom field check',
        category: 'Building cleaning (UNSPSC 76111500)',
        estimatedValue: 20_000,
        termMonths: 12,
        businessUnit: 'Facilities',
        fields: { contractOwner: 'Sofia Rossi' },
      })
    ).json();
    expect(created.fields.filter((f: Json) => f.custom).map((f: Json) => f.key)).toEqual([
      'indigenousFlag',
      'costCentre',
      'carbonKg',
    ]);
    const bad = await env.call('requester', 'PATCH', `/requests/${created.id}`, {
      fields: { indigenousFlag: 'maybe' },
    });
    expect(bad.statusCode).toBe(400);
    expect(
      (await env.call('requester', 'PATCH', `/requests/${created.id}`, { fields: { carbonKg: 'lots' } }))
        .statusCode,
    ).toBe(400);
    const ok = await env.call('requester', 'PATCH', `/requests/${created.id}`, {
      fields: { indigenousFlag: 'true', carbonKg: '120' },
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().fields.find((f: Json) => f.key === 'indigenousFlag').value).toBe('true');
    expect(ok.json().missingFields).toContain('costCentre');
    const blocked = await env.call('requester', 'POST', `/requests/${created.id}/submit`);
    expect(blocked.statusCode).toBe(409);
    expect(JSON.stringify(blocked.json())).toContain('Cost centre is required');
    await env.call('requester', 'PATCH', `/requests/${created.id}`, { fields: { costCentre: 'FAC-100' } });
    expect((await env.call('requester', 'POST', `/requests/${created.id}/submit`)).statusCode).toBe(200);
    await put({ customFields: [] });
  });
});

describe('layouts, forms and the self-service rule (FR-0040, FR-0045, FR-X03, FR-X04, FR-0050)', () => {
  it('each role starts with the layout the administrator chose, and anyone else still gets the default', async () => {
    const cur = (await env.call('admin', 'GET', '/admin/settings')).json().intake as Json;
    const set = await put({
      intake: { ...cur, layouts: { REQUESTER: 'KANBAN', PROCUREMENT: 'DENSE', EXEC: 'CALENDAR' } },
    });
    expect(set.statusCode, set.body).toBe(200);
    expect((await env.call('requester', 'GET', '/settings')).json().layout).toBe('KANBAN');
    expect((await env.call('procurement', 'GET', '/settings')).json().layout).toBe('DENSE');
    expect((await env.call('exec', 'GET', '/settings')).json().layout).toBe('CALENDAR');
    expect((await env.call('legal', 'GET', '/settings')).json().layout).toBe('LIST');
    // a role that does not exist, or a layout that does not exist, is refused
    expect((await put({ intake: { ...cur, layouts: { WIZARD: 'LIST' } } })).statusCode).toBe(422);
    expect((await put({ intake: { ...cur, layouts: { REQUESTER: 'HOLOGRAM' } } })).statusCode).toBe(400);
    await put({ intake: cur });
  });

  it('the self-service limit decides who handles a request, and changing it applies to the next request', async () => {
    const make = (value: number) =>
      env.call('requester', 'POST', '/requests', {
        title: 'Mode check',
        category: 'Building cleaning (UNSPSC 76111500)',
        estimatedValue: value,
        termMonths: 12,
        businessUnit: 'Facilities',
        fields: { contractOwner: 'Sofia Rossi' },
      });
    expect((await make(60_000)).json().intakeMode).toBe('TEAM_LED'); // above the default AUD 50,000
    const cur = (await env.call('admin', 'GET', '/admin/settings')).json().intake as Json;
    await put({ intake: { ...cur, selfServiceThresholdAud: 100_000 } });
    expect((await make(60_000)).json().intakeMode).toBe('SELF_SERVICE');
    expect((await make(150_000)).json().intakeMode).toBe('TEAM_LED');
    await put({ intake: cur });
  });

  it('the budget is checked against the ERP when a request is submitted and the answer is recorded on the request', async () => {
    const r = (
      await env.call('requester', 'POST', '/requests', {
        title: 'Budget check',
        category: 'Building cleaning (UNSPSC 76111500)',
        estimatedValue: 20_000,
        termMonths: 12,
        businessUnit: 'Facilities',
        fields: { contractOwner: 'Sofia Rossi' },
      })
    ).json();
    expect(r.budgetCheck).toBe('NOT_RUN');
    const sub = await env.call('requester', 'POST', `/requests/${r.id}/submit`);
    expect(sub.statusCode, sub.body).toBe(200);
    expect(sub.json().budgetCheck).toBe('CLEARED');
  });

  it('forms are configurable: a relabelled and a custom field are what the next person fills in', async () => {
    await put({
      fieldLabels: { contractOwner: 'Accountable officer' },
      customFields: [{ key: 'projectCode', label: 'Project code', type: 'TEXT', mandatory: false }],
    });
    const pub = (await env.call('requester', 'GET', '/settings')).json();
    expect(pub.fieldLabels).toEqual({ contractOwner: 'Accountable officer' });
    expect(pub.customFields).toEqual([
      { key: 'projectCode', label: 'Project code', type: 'TEXT', mandatory: false },
    ]);
    await put({ fieldLabels: {}, customFields: [] });
  });
});
