/**
 * The settings sections an administrator can add items to (Settings > "Add ..." buttons): each list is validated,
 * limited, audited in plain words, kept per tenant, and, above all, consumed by the behaviour it names.
 */
import { hash as argon2Hash } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import * as s from '../../db/schema.js';
import { uid } from '../../db/seed.js';
import { routeWorkflow, requiredEngagements } from '../intake/classify.js';
import { spendCrossings } from '../contract/b5-rules.js';
import { createEnv, PASSWORD, type Json } from '../contract/test-env.js';
import { changeSummary, DEFAULTS, settingsFrom } from './settings.js';

let env: Awaited<ReturnType<typeof createEnv>>;
beforeAll(async () => {
  env = await createEnv();
}, 120_000);
const sys = <T>(fn: Parameters<typeof env.withSystem>[1]) => env.withSystem(env.database, fn) as Promise<T>;
const put = (body: Json, who = 'admin') => env.call(who, 'PUT', '/admin/settings', body);
const ok = async (body: Json) => {
  const r = await put(body);
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as Json;
};
const problems = (r: { json(): unknown }) =>
  (((r.json() as Json).errors ?? []) as Array<{ field: string; message: string }>)
    .map((e) => `${e.field}: ${e.message}`)
    .join(' | ');
const auditFor = (name: string) =>
  sys<Json[]>((tx) =>
    tx
      .select()
      .from(s.auditEvent)
      .where(eq(s.auditEvent.action, `settings.${name}`)),
  );
const notesFor = async (who: string) => (await env.call(who, 'GET', '/notifications')).json() as Json[];

const workflowOf = async (id: string) =>
  (await sys<Json[]>((tx) => tx.select().from(s.request).where(eq(s.request.id, id))))[0]!
    .workflowId as string;

const CLEANING = 'Building cleaning (UNSPSC 76111500)';
let seq = 0;
async function request(over: Json = {}) {
  const r = await env.call('requester', 'POST', '/requests', {
    title: `Lists fixture ${(seq += 1)}`,
    category: CLEANING,
    estimatedValue: 40_000,
    termMonths: 12,
    businessUnit: 'Facilities',
    fields: { contractOwner: 'Sofia Rossi' },
    ...over,
  });
  expect(r.statusCode, r.body).toBe(201);
  return r.json() as Json;
}

describe('review rules (Intake rules, Add a review rule)', () => {
  const rule = {
    id: 'droneLegal',
    label: 'Legal review of drone work',
    function: 'LEGAL',
    keywords: ['drone'],
  };

  it('an added rule is saved, audited in words, and the next request that mentions its word needs that review', async () => {
    const before = (await env.call('admin', 'GET', '/admin/settings')).json() as Json;
    const saved = await ok({
      intake: { ...before.intake, engagementRules: [...before.intake.engagementRules, rule] },
    });
    expect(saved.intake.engagementRules.at(-1)).toMatchObject(rule);
    const r = await request({ title: 'Drone survey of depots', estimatedValue: 20_000 });
    expect(r.engagements.map((e: Json) => e.ruleId)).toContain('droneLegal');
    const plain = await request({ title: 'Stationery', estimatedValue: 20_000 });
    expect(plain.engagements.map((e: Json) => e.ruleId)).not.toContain('droneLegal');
    const submitted = await env.call('requester', 'POST', `/requests/${r.id}/submit`);
    expect(submitted.statusCode, submitted.body).toBe(200);
    expect((await notesFor('legal'))[0]!.title).toContain('Legal review of drone work');
    const log = (await auditFor('intake')).at(-1)!;
    expect((log.after as Json).changes).toEqual(['Added review rule: Legal review of drone work (LEGAL)']);
    // removing it puts things back, and the log says so
    await ok({ intake: before.intake });
    expect(((await auditFor('intake')).at(-1)!.after as Json).changes).toEqual([
      'Removed review rule: Legal review of drone work (LEGAL)',
    ]);
    expect((await request({ title: 'Drone survey again', estimatedValue: 20_000 })).engagements).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ ruleId: 'droneLegal' })]),
    );
  });

  it('rejects an empty name, a bad key, a duplicate key, an unknown function and more than 30 rules', async () => {
    const cur = (await env.call('admin', 'GET', '/admin/settings')).json().intake as Json;
    const tryRules = (engagementRules: Json[]) => put({ intake: { ...cur, engagementRules } });
    expect((await tryRules([{ ...rule, label: '' }])).statusCode).toBe(400);
    expect((await tryRules([{ ...rule, id: '1bad' }])).statusCode).toBe(400);
    expect((await tryRules([{ ...rule, function: 'MAGIC' }])).statusCode).toBe(400);
    const dup = await tryRules([rule, rule]);
    expect(dup.statusCode).toBe(400);
    expect(dup.body).toContain('Review rule ids must be unique');
    const many = Array.from({ length: 31 }, (_, i) => ({ ...rule, id: `rule${i}` }));
    expect((await tryRules(many)).statusCode).toBe(400);
    expect((await tryRules(many.slice(0, 30))).statusCode).toBe(200);
    await ok({ intake: cur });
  });

  it('is pure and explainable: a value-only rule and a word-and-value rule', () => {
    const rules = [
      { id: 'a', label: 'A', function: 'FINANCE' as const, keywords: [], minValue: 10 },
      { id: 'b', label: 'B', function: 'IT' as const, keywords: ['robot'], minValue: 1000 },
    ];
    const base = { estimatedValue: 500, complexity: 'LOW' as const, title: 'robot arm' };
    expect(requiredEngagements(rules, base).map((e) => e.ruleId)).toEqual(['a']);
    expect(requiredEngagements(rules, { ...base, estimatedValue: 5000 }).map((e) => e.ruleId)).toEqual([
      'a',
      'b',
    ]);
  });
});

describe('protected clauses (Contract rules, Add a protected clause)', () => {
  it('a clause added to the list is treated as non-negotiable on the next contract change, and removing it frees it', async () => {
    const cur = (await env.call('admin', 'GET', '/admin/settings')).json().contractRules as Json;
    await ok({ contractRules: { ...cur, protectedClauses: ['LIABILITY', 'IP'] } });
    const d = await env.draft();
    const edit = await env.call('legal', 'PUT', `/contracts/${d.id}/clauses/IP`, {
      text: 'The Supplier owns all intellectual property created under this contract, entirely.',
    });
    expect(edit.statusCode, edit.body).toBe(200);
    const exec = (await notesFor('exec')).map((n) => n.title);
    expect(exec).toContain('A non-negotiable clause was changed');
    expect(((await auditFor('contractRules')).at(-1)!.after as Json).changes).toEqual([
      'Added protected clause: LIABILITY',
      'Added protected clause: IP',
    ]);
    await ok({ contractRules: { ...cur, protectedClauses: ['LIABILITY'] } });
    expect(((await auditFor('contractRules')).at(-1)!.after as Json).changes).toEqual([
      'Removed protected clause: IP',
    ]);
    await ok({ contractRules: cur });
  });

  it('limits and validation: at most 20 clauses, none empty or longer than 60 characters', async () => {
    const cur = (await env.call('admin', 'GET', '/admin/settings')).json().contractRules as Json;
    const tryClauses = (protectedClauses: string[]) => put({ contractRules: { ...cur, protectedClauses } });
    expect((await tryClauses(Array.from({ length: 21 }, (_, i) => `C${i}`))).statusCode).toBe(400);
    expect((await tryClauses([''])).statusCode).toBe(400);
    expect((await tryClauses(['X'.repeat(61)])).statusCode).toBe(400);
    expect((await tryClauses(Array.from({ length: 20 }, (_, i) => `C${i}`))).statusCode).toBe(200);
    await ok({ contractRules: cur });
  });
});

describe('routing rules (Workflow routing, Add a routing rule)', () => {
  const rule = {
    id: 'droneRoute',
    label: 'Drone work is complex',
    words: ['drone'],
    minValue: 10_000,
    workflow: 'wf-complex',
  };

  it('is pure: the first matching rule decides, critical work still goes to governance, and a miss falls back to value', () => {
    const r = { ...DEFAULTS.workflowRouting, rules: [rule as never] };
    expect(routeWorkflow(r, 20_000, 'LOW', 'Drone survey').workflowId).toBe('wf-complex');
    expect(routeWorkflow(r, 20_000, 'LOW', 'Drone survey').reason).toContain('Drone work is complex');
    expect(routeWorkflow(r, 5_000, 'LOW', 'Drone survey').workflowId).toBe('wf-simple'); // under its own value
    expect(routeWorkflow(r, 20_000, 'LOW', 'Cleaning').workflowId).toBe('wf-simple');
    expect(routeWorkflow(r, 20_000, 'LOW').workflowId).toBe('wf-simple');
    expect(routeWorkflow(r, 20_000, 'CRITICAL', 'Drone survey').workflowId).toBe('wf-board');
  });

  it('an added rule changes the workflow of the next request, is audited in words, and removing it restores routing', async () => {
    const cur = (await env.call('admin', 'GET', '/admin/settings')).json().workflowRouting as Json;
    expect(await workflowOf((await request({ title: 'Drone survey', estimatedValue: 20_000 })).id)).toBe(
      'wf-simple',
    );
    const saved = await ok({ workflowRouting: { ...cur, rules: [rule] } });
    expect(saved.workflowRouting.rules).toEqual([rule]);
    const routed = await request({ title: 'Drone survey', estimatedValue: 20_000 });
    expect(await workflowOf(routed.id)).toBe('wf-complex');
    expect(((await auditFor('workflowRouting')).at(-1)!.after as Json).changes).toEqual([
      'Added routing rule: Drone work is complex to wf-complex',
    ]);
    await ok({ workflowRouting: cur });
    expect(await workflowOf((await request({ title: 'Drone survey', estimatedValue: 20_000 })).id)).toBe(
      'wf-simple',
    );
  });

  it('rejects an unknown workflow, no words, a word that is too short, a duplicate key, more than 10 rules and bad limits', async () => {
    const cur = (await env.call('admin', 'GET', '/admin/settings')).json().workflowRouting as Json;
    const tryRules = (rules: Json[], more: Json = {}) => put({ workflowRouting: { ...cur, rules, ...more } });
    expect((await tryRules([{ ...rule, workflow: 'wf-nope' }])).statusCode).toBe(400);
    expect((await tryRules([{ ...rule, words: [] }])).statusCode).toBe(400);
    expect((await tryRules([{ ...rule, words: ['x'] }])).statusCode).toBe(400);
    expect((await tryRules([{ ...rule, label: '' }])).statusCode).toBe(400);
    expect((await tryRules([rule, rule])).body).toContain('Rule ids must be unique');
    expect(
      (await tryRules(Array.from({ length: 11 }, (_, i) => ({ ...rule, id: `r${i}x` })))).statusCode,
    ).toBe(400);
    expect((await tryRules([], { simpleBelow: 9_000_000 })).body).toContain('simple limit cannot exceed');
    await ok({ workflowRouting: cur });
  });
});

describe('extra recipients (Notifications, Add a recipient)', () => {
  it('a role added for an event is told when it happens, and only while the event rule is on', async () => {
    const cur = (await env.call('admin', 'GET', '/admin/settings')).json().notifications as Json;
    await ok({ intake: { ...DEFAULTS.intake, budgetCap: 'SOFT' } });
    const breach = async (value: number) => {
      const r = await request({ estimatedValue: value, businessUnit: 'Procurement' });
      expect((await env.call('requester', 'POST', `/requests/${r.id}/submit`)).statusCode).toBe(200);
    };
    const before = (await notesFor('probity')).filter((n) => n.title.includes('soft cap')).length;
    await breach(900_000);
    expect((await notesFor('probity')).filter((n) => n.title.includes('soft cap'))).toHaveLength(before);
    await ok({ notifications: { ...cur, extraRecipients: [{ event: 'BUDGET_BREACH', role: 'PROBITY' }] } });
    await breach(910_000);
    expect((await notesFor('probity')).filter((n) => n.title.includes('soft cap'))).toHaveLength(before + 1);
    expect(((await auditFor('notifications')).at(-1)!.after as Json).changes).toEqual([
      'Added extra recipient: PROBITY for BUDGET_BREACH',
    ]);
    // a role is not told twice when it is already a recipient, and a rule switched off silences everyone
    await ok({
      notifications: {
        ...cur,
        extraRecipients: [{ event: 'BUDGET_BREACH', role: 'EXEC' }],
      },
    });
    const execBefore = (await notesFor('exec')).filter((n) => n.title.includes('soft cap')).length;
    await breach(920_000);
    expect((await notesFor('exec')).filter((n) => n.title.includes('soft cap'))).toHaveLength(execBefore + 1);
    await ok({
      notifications: {
        ...cur,
        extraRecipients: [{ event: 'BUDGET_BREACH', role: 'PROBITY' }],
        rules: cur.rules.map((x: Json) => (x.event === 'BUDGET_BREACH' ? { ...x, enabled: false } : x)),
      },
    });
    const probityNow = (await notesFor('probity')).length;
    await breach(930_000);
    expect(await notesFor('probity')).toHaveLength(probityNow);
    await ok({ notifications: cur });
    await ok({ intake: DEFAULTS.intake });
  });

  it('rejects the supplier role, an unknown event, a repeat and more than 20 entries', async () => {
    const cur = (await env.call('admin', 'GET', '/admin/settings')).json().notifications as Json;
    const tryExtra = (extraRecipients: Json[]) => put({ notifications: { ...cur, extraRecipients } });
    expect((await tryExtra([{ event: 'BUDGET_BREACH', role: 'SUPPLIER' }])).statusCode).toBe(400);
    expect((await tryExtra([{ event: 'NOPE', role: 'EXEC' }])).statusCode).toBe(400);
    const same = { event: 'BUDGET_BREACH', role: 'EXEC' };
    expect((await tryExtra([same, same])).body).toContain('Each role can be added once for an event');
    const all = ['BUDGET_BREACH', 'DELEGATE_ACTION', 'APPROVAL_TIMEOUT'].flatMap((event) =>
      ['REQUESTER', 'PROCUREMENT', 'DELEGATE', 'EVALUATOR', 'CHAIR', 'LEGAL', 'CONTRACT_MGR'].map((role) => ({
        event,
        role,
      })),
    ); // 21 distinct pairs
    expect((await tryExtra(all)).statusCode).toBe(400);
    expect((await tryExtra(all.slice(0, 20))).statusCode).toBe(200);
    await ok({ notifications: cur });
  });
});

describe('public registers (Public registers, Add a register)', () => {
  const closeIn = (days: number) => new Date(env.clock.now().getTime() + days * 86_400_000).toISOString();
  async function publishedTender(value: number): Promise<Json> {
    const r = await request({
      title: `Register fixture ${(seq += 1)}`,
      estimatedValue: value,
      termMonths: 24,
      fields: { contractOwner: 'Sofia Rossi', background: 'Existing arrangements end in six months.' },
    });
    expect((await env.call('requester', 'POST', `/requests/${r.id}/submit`)).statusCode).toBe(200);
    const plan = (await env.call('procurement', 'GET', `/requests/${r.id}/plan`)).json();
    await env.call('procurement', 'POST', `/plans/${plan.id}/submit-for-approval`);
    await env.call('delegate', 'POST', `/plans/${plan.id}/decision`, { decision: 'APPROVE' });
    const t = (
      await env.call('procurement', 'POST', '/tenders', { requestId: r.id, type: 'RFT', access: 'CLOSED' })
    ).json();
    await env.call('delegate', 'POST', `/tenders/${t.id}/publish-permission`, {});
    const p = await env.call('procurement', 'POST', `/tenders/${t.id}/publish`, { closesAt: closeIn(30) });
    expect(p.statusCode, p.body).toBe(200);
    return p.json();
  }
  const added = {
    register: 'Buy NZ GETS',
    jurisdiction: 'New Zealand',
    minValueAud: 50_000,
    enabled: true,
  };

  it('an added register receives a public tender at or above its value, with a reference and an audit entry', async () => {
    await ok({ publicRegisters: [...DEFAULTS.publicRegisters, added] });
    const t = await publishedTender(60_000);
    const notices = (await env.call('procurement', 'GET', `/tenders/${t.id}/notices`)).json() as Json[];
    expect(notices.map((n) => n.register)).toEqual(['Buy NZ GETS']);
    expect(notices[0]!.reference).toMatch(/^BUYNZGETS-\d{4}-PR-/);
    expect(((await auditFor('publicRegisters')).at(-1)!.after as Json).changes).toEqual([
      'Added public register: Buy NZ GETS (New Zealand, from AUD 50000)',
    ]);
    const small = await publishedTender(40_000);
    expect((await env.call('procurement', 'GET', `/tenders/${small.id}/notices`)).json() as Json[]).toEqual(
      [],
    );
    await ok({ publicRegisters: DEFAULTS.publicRegisters });
  });

  it('keeps the three built-in registers valid, and rejects a repeat (any case), a short name and more than 8', async () => {
    expect(settingsFrom({ settings: { publicRegisters: DEFAULTS.publicRegisters } }).publicRegisters).toEqual(
      DEFAULTS.publicRegisters,
    );
    const dup = await put({ publicRegisters: [...DEFAULTS.publicRegisters, { ...added, register: 'tED' }] });
    expect(dup.statusCode).toBe(400);
    expect(dup.body).toContain('Each register can appear once');
    expect((await put({ publicRegisters: [{ ...added, register: 'X' }] })).statusCode).toBe(400);
    expect((await put({ publicRegisters: [{ ...added, jurisdiction: '' }] })).statusCode).toBe(400);
    const many = Array.from({ length: 9 }, (_, i) => ({ ...added, register: `Register ${i}` }));
    expect((await put({ publicRegisters: many })).statusCode).toBe(400);
    expect((await put({ publicRegisters: many.slice(0, 8) })).statusCode).toBe(200);
    await ok({ publicRegisters: DEFAULTS.publicRegisters });
  });
});

describe('extra spend alerts (Contract management, Add a spend alert)', () => {
  it('is pure: every configured point is crossed once, in order, and the fixed ones stay', () => {
    expect(spendCrossings(75, [70, 50], new Set()).map((c) => `${c.kind}:${c.threshold}`)).toEqual([
      'CONFIGURED:50',
      'CONFIGURED:70',
    ]);
    expect(spendCrossings(60, [70, 50, 50], new Set(['CONFIGURED:50']))).toEqual([]);
    expect(spendCrossings(85, 70, new Set()).map((c) => c.threshold)).toEqual([80, 70]);
  });

  it('a point added in settings raises a notice when invoices cross it, once, and shows on the spend view', async () => {
    const cur = (await env.call('admin', 'GET', '/admin/settings')).json().contractManagement as Json;
    await ok({ contractManagement: { ...cur, extraSpendAlertPcts: [40] } });
    const { id } = await env.executed({ value: 120_000 });
    const rates = await env.call('contract-mgr', 'PUT', `/contracts/${id}/rates`, {
      rates: [{ item: 'Unit', unitPrice: 1000 }],
    });
    expect(rates.statusCode, rates.body).toBe(200);
    const po = await env.call('finance', 'POST', `/contracts/${id}/purchase-orders`, {
      description: 'Supply of services',
      lines: [{ item: 'Unit', qty: 120, unitPrice: 1000 }],
    });
    expect(po.statusCode, po.body).toBe(201);
    const bill = (qty: number, n: number) =>
      env.call('finance', 'POST', `/contracts/${id}/invoices`, {
        number: `XS-${id.slice(0, 6)}-${n}`,
        invoiceDate: '2026-11-01',
        poId: po.json().id,
        lines: [{ item: 'Unit', qty, unitPrice: 1000 }],
      });
    const first = await bill(50, 1); // 41.7%
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json().spendAlerts).toEqual([
      expect.objectContaining({ kind: 'CONFIGURED', threshold: 40 }),
    ]);
    const second = await bill(5, 2); // 45.8%, nothing new
    expect(second.json().spendAlerts).toEqual([]);
    const spend = (await env.call('contract-mgr', 'GET', `/contracts/${id}/spend`)).json() as Json;
    expect(spend.extraPcts).toEqual([40]);
    expect(spend.raised.map((r: Json) => `${r.kind}:${r.threshold}`)).toEqual(['CONFIGURED:40']);
    expect(((await auditFor('contractManagement')).at(-1)!.after as Json).changes).toEqual([
      'Added spend alert point: 40%',
    ]);
    await ok({ contractManagement: cur });
  });

  it('rejects the fixed 80, 90 and 100, 0, a repeat, a fraction and more than five', async () => {
    const cur = (await env.call('admin', 'GET', '/admin/settings')).json().contractManagement as Json;
    const tryPcts = (extraSpendAlertPcts: number[]) =>
      put({ contractManagement: { ...cur, extraSpendAlertPcts } });
    expect((await tryPcts([80])).body).toContain('fixed notices at 80, 90 and 100');
    expect((await tryPcts([90])).statusCode).toBe(400);
    expect((await tryPcts([100])).statusCode).toBe(400);
    expect((await tryPcts([0])).statusCode).toBe(400);
    expect((await tryPcts([12.5])).statusCode).toBe(400);
    expect((await tryPcts([30, 30])).body).toContain('Each alert point can appear once');
    expect((await tryPcts([10, 20, 30, 40, 50, 60])).statusCode).toBe(400);
    expect((await tryPcts([10, 20, 30, 40, 50])).statusCode).toBe(200);
    await ok({ contractManagement: cur });
  });
});

describe('capacity overrides (Dashboards and workload, Add a capacity override)', () => {
  it('a manager with an override is measured against it on the capacity report, and the others still use the shared limit', async () => {
    const cur = (await env.call('admin', 'GET', '/admin/settings')).json().dashboards as Json;
    const part = await env.extraUser('part-timer', 'PROCUREMENT');
    await ok({ dashboards: { ...cur, capacityPerManager: 10, capacityOverrides: [] } });
    const base = (await env.call('exec', 'GET', '/reports/capacity')).json() as Json;
    expect(base.managers.find((m: Json) => m.managerId === part.id)).toMatchObject({
      capacity: 10,
      overloaded: false,
    });
    const r = await request({ title: 'Part time load' });
    expect(
      (await env.call('procurement', 'PUT', `/requests/${r.id}/manager`, { managerId: part.id })).statusCode,
    ).toBe(200);
    expect(
      ((await env.call('exec', 'GET', '/reports/capacity')).json() as Json).managers.find(
        (m: Json) => m.managerId === part.id,
      ).overloaded,
    ).toBe(false);
    await ok({
      dashboards: { ...cur, capacityPerManager: 10, capacityOverrides: [{ userId: part.id, capacity: 1 }] },
    });
    // 1 of 1 is full but not over; a second one tips it
    const r2 = await request({ title: 'Part time load two' });
    await env.call('procurement', 'PUT', `/requests/${r2.id}/manager`, { managerId: part.id });
    const rep = (await env.call('exec', 'GET', '/reports/capacity')).json() as Json;
    expect(rep.managers.find((m: Json) => m.managerId === part.id)).toMatchObject({
      capacity: 1,
      overloaded: true,
      utilisation: 200,
    });
    expect(rep.managers.find((m: Json) => m.managerId === uid('user:procurement'))!.capacity).toBe(10);
    expect(((await auditFor('dashboards')).at(-1)!.after as Json).changes).toEqual([
      `Added capacity override: ${part.id} at 1`,
    ]);
    await ok({ dashboards: cur });
  });

  it('refuses a person who is not a procurement manager here, a repeat, 0, 201 and more than 30', async () => {
    const cur = (await env.call('admin', 'GET', '/admin/settings')).json().dashboards as Json;
    const tryOver = (capacityOverrides: Json[]) => put({ dashboards: { ...cur, capacityOverrides } });
    const mgr = uid('user:procurement');
    const notMgr = await tryOver([{ userId: uid('user:requester'), capacity: 3 }]);
    expect(notMgr.statusCode).toBe(422);
    expect(problems(notMgr)).toContain('Choose a procurement manager of this organisation');
    expect(
      (await tryOver([{ userId: '3f2b8c1e-0000-4000-8000-000000000001', capacity: 3 }])).statusCode,
    ).toBe(422);
    expect((await tryOver([{ userId: 'nobody', capacity: 3 }])).statusCode).toBe(400);
    expect((await tryOver([{ userId: mgr, capacity: 0 }])).statusCode).toBe(400);
    expect((await tryOver([{ userId: mgr, capacity: 201 }])).statusCode).toBe(400);
    expect(
      (
        await tryOver([
          { userId: mgr, capacity: 3 },
          { userId: mgr, capacity: 4 },
        ])
      ).body,
    ).toContain('Each manager can appear once');
    expect(
      (await tryOver(Array.from({ length: 31 }, (_, i) => ({ userId: uid(`user:x${i}`), capacity: 2 }))))
        .statusCode,
    ).toBe(400);
    expect((await tryOver([{ userId: mgr, capacity: 3 }])).statusCode).toBe(200);
    await ok({ dashboards: cur });
  });
});

describe('every list section', () => {
  it('only an administrator can change any of them (403 for everyone else)', async () => {
    const bodies: Json[] = [
      { intake: DEFAULTS.intake },
      { contractRules: DEFAULTS.contractRules },
      { workflowRouting: DEFAULTS.workflowRouting },
      { notifications: DEFAULTS.notifications },
      { publicRegisters: DEFAULTS.publicRegisters },
      { contractManagement: DEFAULTS.contractManagement },
      { dashboards: DEFAULTS.dashboards },
    ];
    for (const who of ['requester', 'procurement', 'delegate', 'legal', 'finance', 'exec', 'probity'])
      for (const b of bodies) expect((await put(b, who)).statusCode, `${who} ${Object.keys(b)[0]}`).toBe(403);
  });

  it('settings stored before these lists existed still load, with an empty list and unchanged defaults', () => {
    const old = {
      settings: {
        notifications: { channels: ['IN_APP'], escalationHours: 12, rules: DEFAULTS.notifications.rules },
        workflowRouting: { simpleBelow: 1000, intermediateBelow: 2000 },
        dashboards: { visibility: 'BROAD', capacityPerManager: 3, referenceRefreshDays: 30 },
        contractManagement: { ...DEFAULTS.contractManagement, extraSpendAlertPcts: undefined },
        publicRegisters: [{ register: 'TED', jurisdiction: 'European Union', minValueAud: 1, enabled: true }],
      },
    };
    const s2 = settingsFrom(old);
    expect(s2.notifications).toMatchObject({ escalationHours: 12, extraRecipients: [] });
    expect(s2.workflowRouting).toEqual({ simpleBelow: 1000, intermediateBelow: 2000, rules: [] });
    expect(s2.dashboards).toMatchObject({ capacityPerManager: 3, capacityOverrides: [] });
    expect(s2.contractManagement.extraSpendAlertPcts).toEqual([]);
    expect(s2.publicRegisters).toHaveLength(1);
    const fresh = settingsFrom({});
    expect(fresh.workflowRouting).toEqual({ simpleBelow: 50_000, intermediateBelow: 1_000_000, rules: [] });
    expect(fresh.notifications.extraRecipients).toEqual([]);
    expect(fresh.intake.engagementRules).toHaveLength(5);
  });

  it('an older client that sends a section without the new list still saves, and the list stays empty', async () => {
    const r = await put({
      workflowRouting: { simpleBelow: 50_000, intermediateBelow: 1_000_000 },
      notifications: {
        channels: ['IN_APP', 'EMAIL'],
        escalationHours: 48,
        rules: DEFAULTS.notifications.rules,
      },
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().workflowRouting.rules).toEqual([]);
    expect(r.json().notifications.extraRecipients).toEqual([]);
  });

  it('describes additions, removals and edits in plain words, and says nothing for a section without a list', () => {
    expect(
      changeSummary(
        'customFields',
        [{ key: 'a', label: 'A', type: 'TEXT', mandatory: false }],
        [
          { key: 'a', label: 'A2', type: 'TEXT', mandatory: false },
          { key: 'b', label: 'B', type: 'FLAG', mandatory: true },
        ],
      ),
    ).toEqual(['Changed custom field: A2 (a)', 'Added custom field: B (b)']);
    expect(changeSummary('numbering', DEFAULTS.numbering, DEFAULTS.numbering)).toEqual([]);
  });

  it('is kept per organisation: another tenant sees defaults, and its own change does not touch ours', async () => {
    const cur = (await env.call('admin', 'GET', '/admin/settings')).json() as Json;
    await ok({
      workflowRouting: {
        ...cur.workflowRouting,
        rules: [{ id: 'mineOnly', label: 'Mine', words: ['drone'], workflow: 'wf-complex' }],
      },
      notifications: { ...cur.notifications, extraRecipients: [{ event: 'BUDGET_BREACH', role: 'PROBITY' }] },
    });
    const hash = await argon2Hash(PASSWORD);
    const email = 'admin@other-org.example';
    await sys((tx) =>
      tx
        .insert(s.tenant)
        .values({ slug: 'other-org', name: 'Other organisation', sector: 'PRIVATE' })
        .returning(),
    ).then(async (rows) => {
      const t = (rows as Json[])[0]!;
      await sys(async (tx) => {
        const [u] = await tx
          .insert(s.appUser)
          .values({ tenantId: t.id, email, name: 'Other admin', passwordHash: hash })
          .returning();
        await tx.insert(s.roleAssignment).values({ tenantId: t.id, userId: u!.id, role: 'ADMIN' });
      });
    });
    const theirs = (await env.call(email, 'GET', '/admin/settings')).json() as Json;
    expect(theirs.workflowRouting.rules).toEqual([]);
    expect(theirs.notifications.extraRecipients).toEqual([]);
    const mine = await env.call(email, 'PUT', '/admin/settings', {
      publicRegisters: [
        { register: 'Own Register', jurisdiction: 'Elsewhere', minValueAud: 5, enabled: true },
      ],
    });
    expect(mine.statusCode, mine.body).toBe(200);
    const ours = (await env.call('admin', 'GET', '/admin/settings')).json() as Json;
    expect(ours.publicRegisters).toEqual(DEFAULTS.publicRegisters);
    expect(ours.workflowRouting.rules).toHaveLength(1);
    await ok({ workflowRouting: cur.workflowRouting, notifications: cur.notifications });
  });
});
