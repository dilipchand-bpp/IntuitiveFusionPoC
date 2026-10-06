import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import * as s from '../../db/schema.js';
import { TENANT_ID, uid } from '../../db/seed.js';
import { addDays } from '../contract/dates.js';
import { BRIGHT, SEED_DATE, createEnv, type Json } from '../contract/test-env.js';

let env: Awaited<ReturnType<typeof createEnv>>;
const call = (...a: Parameters<typeof env.call>) => env.call(...a);
beforeAll(async () => {
  env = await createEnv();
}, 120_000);

const DASH = { visibility: 'BROAD', capacityPerManager: 6, referenceRefreshDays: 90 };
const dash = async (over: Partial<typeof DASH> = {}) => {
  const r = await call('admin', 'PUT', '/admin/settings', { dashboards: { ...DASH, ...over } });
  expect(r.statusCode, r.body).toBe(200);
};
const back = () => env.clock.set(SEED_DATE);
const audit = async (id: string) =>
  (
    await env.withSystem(env.database, (tx) =>
      tx.select().from(s.auditEvent).where(eq(s.auditEvent.entityId, id)),
    )
  ).map((e) => e.action);

let seq = 0;
async function request(over: Json = {}) {
  seq += 1;
  const c = await call('requester', 'POST', '/requests', {
    title: `B6 request ${seq}`,
    category: 'IT managed services (UNSPSC 81111800)',
    estimatedValue: 200_000,
    termMonths: 24,
    businessUnit: 'Facilities',
    fields: { contractOwner: 'Sofia Rossi', background: 'Existing arrangements end in six months.' },
    ...over,
  });
  expect(c.statusCode, c.body).toBe(201);
  const id = c.json().id as string;
  expect((await call('requester', 'POST', `/requests/${id}/submit`)).statusCode).toBe(200);
  return { id, number: c.json().number as string };
}
const planOf = async (requestId: string) =>
  (await call('procurement', 'GET', `/requests/${requestId}/plan`)).json() as Json;

describe('FR-0085 FR-0115 FR-0365 layout designers', () => {
  it('each document has a system default; an organisation orders and trims it, and the plan, the tender pack follow', async () => {
    const list = (await call('procurement', 'GET', '/layouts')).json() as Json[];
    expect(list.map((l) => l.kind)).toEqual(['PLAN', 'RFX', 'REPORT', 'INTAKE', 'CONTRACT']);
    expect(list.every((l) => l.isDefault && l.name === 'System default')).toBe(true);
    expect((await call('requester', 'GET', '/layouts')).statusCode).toBe(403);

    const plan = list.find((l) => l.kind === 'PLAN')!;
    const keys: string[] = plan.sections.map((x: Json) => x.key);
    expect(keys[0]).toBe('background');
    // drag steeringCommittee (optional) off, and the risks section to the top
    const order = ['risks', ...keys.filter((k) => k !== 'risks' && k !== 'steeringCommittee')];
    const saved = await call('procurement', 'PUT', '/layouts/PLAN', {
      name: 'Meridian plan',
      sections: [
        ...order.map((k) => ({ key: k, enabled: true })),
        { key: 'steeringCommittee', enabled: false },
      ],
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({ name: 'Meridian plan', isDefault: false });
    const r = await request();
    const p = await planOf(r.id);
    expect(p.fields[0].key).toBe('risks');
    expect(p.fields.map((f: Json) => f.key)).not.toContain('steeringCommittee');
    expect(await audit(TENANT_ID)).toContain('layout.save');

    // mandatory sections cannot be left out; unknown ones are refused
    const bad = await call('procurement', 'PUT', '/layouts/PLAN', {
      name: 'x2',
      sections: order.filter((k) => k !== 'background').map((k) => ({ key: k, enabled: true })),
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().errors[0].message).toMatch(/Background" is required/);
    expect(
      (
        await call('procurement', 'PUT', '/layouts/PLAN', {
          name: 'x2',
          sections: [{ key: 'nope', enabled: true }],
        })
      ).statusCode,
    ).toBe(422);

    // the tender pack layout (FR-0115)
    const rfx = await call('procurement', 'PUT', '/layouts/RFX', {
      name: 'Short pack',
      sections: ['overview', 'requirements', 'evaluationCriteria', 'conditions', 'submission', 'contact']
        .map((k) => ({ key: k, enabled: true }))
        .concat([{ key: 'timetable', enabled: false }]),
    });
    expect(rfx.statusCode, rfx.body).toBe(200);
    await planOf(r.id);
    const t = await call('procurement', 'POST', '/tenders', { requestId: r.id, type: 'RFP', access: 'OPEN' });
    expect(t.statusCode, t.body).toBe(201);
    const fields = (t.json().fields as Json[]).map((f) => f.key);
    expect(fields).toEqual([
      'overview',
      'requirements',
      'evaluationCriteria',
      'conditions',
      'submission',
      'contact',
    ]);

    // the evaluation report layout (FR-0365) is a design the report view honours; here it is saved and read back
    const rep = defaultKeys(list.find((l) => l.kind === 'REPORT')!);
    const reorder = ['recommendation', ...rep.filter((k) => k !== 'recommendation')];
    expect(
      (
        await call('admin', 'PUT', '/layouts/REPORT', {
          name: 'Recommendation first',
          sections: reorder.map((k) => ({ key: k, enabled: true })),
        })
      ).json().sections[0].key,
    ).toBe('recommendation');

    // back to the default
    for (const k of ['PLAN', 'RFX', 'REPORT'])
      expect((await call('procurement', 'DELETE', `/layouts/${k}`)).json().isDefault).toBe(true);
    expect(((await planOf(r.id)).fields as Json[])[0]!.key).toBe('background');
  });
});
const defaultKeys = (l: Json) => l.sections.map((x: Json) => x.key) as string[];

describe('FR-0595 the procurement schedule', () => {
  it('shows every active procurement on one chart; moving a phase recalculates what follows and the delegate calendar', async () => {
    const r = await request();
    const sch = (await call('procurement', 'GET', '/reports/schedule')).json() as Json;
    const item = sch.items.find((i: Json) => i.requestId === r.id)!;
    expect(item.slots.map((x: Json) => x.phase)).toEqual([
      'INTAKE',
      'PLAN',
      'TENDER',
      'EVALUATION',
      'CONTRACT_AWARD',
    ]);
    expect(item.custom).toBe(false);
    expect(sch.delegateCalendar.filter((c: Json) => c.requestId === r.id).length).toBeGreaterThanOrEqual(3);
    expect(sch.canMove).toBe(true);
    expect((await call('delegate', 'GET', '/reports/schedule')).json().canMove).toBe(false);
    expect((await call('requester', 'GET', '/reports/schedule')).statusCode).toBe(403);

    const before = item.slots as Json[];
    const mv = await call('procurement', 'POST', `/reports/schedule/${r.id}/move`, {
      phase: 'TENDER',
      deltaDays: 10,
    });
    expect(mv.statusCode, mv.body).toBe(200);
    const slots = mv.json().slots as Json[];
    expect(slots[0]).toEqual(before[0]);
    expect(slots[2]!.startDate).toBe(addDays(before[2]!.startDate, 10));
    expect(slots[4]!.endDate).toBe(addDays(before[4]!.endDate, 10));
    expect(mv.json().delegateCalendar.find((c: Json) => c.phase === 'CONTRACT_AWARD').date).toBe(
      slots[4]!.endDate,
    );
    const again = (await call('procurement', 'GET', '/reports/schedule')).json() as Json;
    expect(again.items.find((i: Json) => i.requestId === r.id).custom).toBe(true);
    const note = await env.withSystem(env.database, (tx) =>
      tx
        .select()
        .from(s.notification)
        .where(
          and(
            eq(s.notification.userId, uid('user:delegate')),
            eq(s.notification.title, 'Your calendar changed'),
          ),
        ),
    );
    expect(note.length).toBeGreaterThan(0);
    expect(await audit(r.id)).toContain('schedule.move');
    expect(
      (
        await call('procurement', 'POST', `/reports/schedule/${r.id}/move`, { phase: 'PLAN', deltaDays: -40 })
      ).json().code,
    ).toBe('SCHEDULE_CONFLICT');
    expect(
      (await call('delegate', 'POST', `/reports/schedule/${r.id}/move`, { phase: 'TENDER', deltaDays: 1 }))
        .statusCode,
    ).toBe(403);
  });
});

describe('FR-0600 dashboards by role and hierarchy', () => {
  it('offers each role its own view, and scopes it by the organisation hierarchy unless the organisation prefers broader visibility', async () => {
    await request({ businessUnit: 'Facilities', title: 'Dash facilities' });
    await request({ businessUnit: 'Executive', title: 'Dash executive' });
    const views = async (who: string) =>
      ((await call(who, 'GET', '/dashboards')).json() as Json).views.map((v: Json) => v.view) as string[];
    expect(await views('procurement')).toEqual(expect.arrayContaining(['procurement', 'division']));
    expect(await views('legal')).toEqual(expect.arrayContaining(['legal', 'division']));
    expect(await views('delegate')).toEqual(expect.arrayContaining(['delegate']));
    expect(await views('exec')).toEqual(expect.arrayContaining(['executive']));
    expect(await views('finance')).toEqual(expect.arrayContaining(['finance']));
    expect(await views('probity')).toEqual(expect.arrayContaining(['risk']));
    expect((await call('requester', 'GET', '/dashboards')).statusCode).toBe(403);
    expect((await call('legal', 'GET', '/dashboards/finance')).statusCode).toBe(404);
    for (const [who, view] of [
      ['procurement', 'procurement'],
      ['legal', 'legal'],
      ['delegate', 'delegate'],
      ['exec', 'executive'],
      ['finance', 'finance'],
      ['probity', 'risk'],
    ] as const) {
      const d = (await call(who, 'GET', `/dashboards/${view}`)).json() as Json;
      expect(d.kpis.length, view).toBeGreaterThanOrEqual(3);
      expect(d.tables.length, view).toBeGreaterThanOrEqual(1);
    }
    const unitRows = async (who: string) =>
      ((await call(who, 'GET', '/dashboards/division')).json() as Json).tables[0].rows.map(
        (r: Json[]) => r[0],
      ) as string[];
    // broad: the delegate sees every unit
    expect(await unitRows('delegate')).toEqual(expect.arrayContaining(['Facilities', 'Executive']));
    // hierarchy: the delegate (Executive unit) sees only their own unit and those beneath it
    await dash({ visibility: 'HIERARCHY' });
    const hd = (await call('delegate', 'GET', '/dashboards/division')).json() as Json;
    expect(hd.visibility).toBe('HIERARCHY');
    expect(hd.units).toEqual(['Executive']);
    expect(await unitRows('delegate')).toEqual(['Executive']);
    expect(await unitRows('finance')).toEqual([]);
    // procurement and executives run the whole portfolio whatever the setting
    expect(await unitRows('exec')).toEqual(expect.arrayContaining(['Facilities', 'Executive']));
    // a unit beneath another is included
    const [exec] = await env.withSystem(env.database, (tx) =>
      tx
        .select()
        .from(s.orgUnit)
        .where(eq(s.orgUnit.id, uid('unit:Executive'))),
    );
    const child = await env.withSystem(
      env.database,
      async (tx) =>
        (
          await tx
            .insert(s.orgUnit)
            .values({ tenantId: TENANT_ID, name: 'Facilities', parentId: exec!.id })
            .returning()
        )[0]!.id,
    );
    void child;
    expect(await unitRows('delegate')).toEqual(expect.arrayContaining(['Executive', 'Facilities']));
    await dash();
    expect(await audit(TENANT_ID)).toContain('settings.dashboards');
  });
});

describe('FR-0605 category spend, maverick spend, savings and velocity', () => {
  it('reports savings against the estimate, invoices released outside the contract match, and where the time goes', async () => {
    const d = await env.draft({ value: 120_000 });
    expect((await call('legal', 'PATCH', `/contracts/${d.id}`, { value: 100_000 })).statusCode).toBe(200);
    await call('legal', 'POST', `/contracts/${d.id}/release-for-signing`);
    expect(
      (await call('delegate', 'POST', `/contracts/${d.id}/sign`, { decision: 'APPROVE' })).json().status,
    ).toBe('EXECUTED');
    // an invoice with no purchase order is blocked; finance releases it as an exception: spend outside the match
    const inv = await call('finance', 'POST', `/contracts/${d.id}/invoices`, {
      invoiceDate: '2026-10-05',
      lines: [{ item: 'Unplanned work', qty: 1, unitPrice: 4000 }],
    });
    expect(inv.json().invoice.status).toBe('BLOCKED');
    expect(
      (
        await call('finance', 'POST', `/invoices/${inv.json().invoice.id}/override`, {
          reason: 'Emergency repair approved on site',
        })
      ).statusCode,
    ).toBe(200);

    const perf = (await call('exec', 'GET', '/reports/performance')).json() as Json;
    expect(perf.categorySpend.length).toBeGreaterThan(0);
    const [rq] = await env.withSystem(env.database, (tx) =>
      tx.select().from(s.request).where(eq(s.request.id, d.requestId)),
    );
    const saved = perf.savings.items.find((x: Json) => x.number === rq!.number);
    expect(saved).toMatchObject({ estimate: 120_000, awarded: 100_000, saved: 20_000 });
    expect(perf.savings.captured).toBeGreaterThanOrEqual(20_000);
    expect(
      perf.maverick.invoicesOutsideContract.some(
        (x: Json) => x.amount === 4000 && /Emergency repair/.test(x.reason),
      ),
    ).toBe(true);
    expect(perf.maverick.total).toBeGreaterThanOrEqual(4000);
    expect(perf.velocity.phases.length).toBeGreaterThan(0);
    expect(perf.velocity.phases[0]).toHaveProperty('avgDays');
    expect((await call('legal', 'GET', '/reports/performance')).statusCode).toBe(403);
  });
});

describe('FR-0610 the supplier risk map', () => {
  it('plots suppliers with simulated weather, financial and watchlist signals and flags single points of failure', async () => {
    await env.executed({ value: 90_000 });
    expect(
      (
        await call('requester', 'PUT', `/suppliers/${BRIGHT}/location`, {
          city: 'Cairns',
          state: 'QLD',
          country: 'Australia',
          lat: -16.9,
          lng: 145.8,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call('procurement', 'PUT', `/suppliers/${BRIGHT}/location`, {
          city: 'Cairns',
          state: 'QLD',
          country: 'Australia',
          lat: -16.9,
          lng: 145.8,
        })
      ).statusCode,
    ).toBe(200);
    env.clock.set('2026-12-10T09:00:00Z'); // cyclone season
    const m = (await call('exec', 'GET', '/reports/supplier-risk')).json() as Json;
    const b = m.items.find((i: Json) => i.supplierId === BRIGHT);
    expect(b.location).toMatchObject({ city: 'Cairns', state: 'QLD' });
    expect(b.signals.map((x: Json) => x.feed)).toEqual(['WEATHER', 'FINANCIAL', 'GEOPOLITICAL']);
    expect(b.signals[0]).toMatchObject({ level: 'HIGH', detail: expect.stringMatching(/Cyclone/) });
    expect(b.level).toBe('HIGH');
    expect(m.singlePoints.some((x: Json) => x.kind === 'CATEGORY' && x.supplier === b.company)).toBe(true);
    expect(m.model).toBe('rules-simulated-v1');
    await call('procurement', 'PUT', `/suppliers/${BRIGHT}/location`, {
      city: 'Yangon',
      state: 'Yangon',
      country: 'Myanmar',
      lat: 16.8,
      lng: 96.2,
    });
    expect(
      ((await call('exec', 'GET', '/reports/supplier-risk')).json() as Json).items.find(
        (i: Json) => i.supplierId === BRIGHT,
      ).signals[2].level,
    ).toBe('HIGH');
    expect((await call('legal', 'GET', '/reports/supplier-risk')).statusCode).toBe(403);
    expect(await audit(BRIGHT)).toContain('supplier.location_set');
    back();
    await env.withSystem(env.database, (tx) =>
      tx.update(s.supplier).set({ location: null }).where(eq(s.supplier.id, BRIGHT)),
    );
  });
});

describe('FR-0620 workload against capacity', () => {
  it('maps active procurements and their dollars to the assigned manager, flags anyone over capacity and suggests moving work', async () => {
    const a = await request({ title: 'Cap A', estimatedValue: 300_000 });
    const b = await request({ title: 'Cap B', estimatedValue: 100_000 });
    await dash({ capacityPerManager: 1 });
    expect(
      (await call('requester', 'PUT', `/requests/${a.id}/manager`, { managerId: uid('user:procurement') }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await call('procurement', 'PUT', `/requests/${a.id}/manager`, { managerId: uid('user:requester') })
      ).json().code,
    ).toBe('NOT_A_MANAGER');
    expect(
      (await call('procurement', 'PUT', `/requests/${a.id}/manager`, { managerId: uid('user:procurement') }))
        .statusCode,
    ).toBe(200);
    expect(
      (await call('procurement', 'PUT', `/requests/${b.id}/manager`, { managerId: uid('user:procurement') }))
        .statusCode,
    ).toBe(200);
    const spare = await env.extraUser('spare-manager', 'PROCUREMENT');
    const cap = (await call('exec', 'GET', '/reports/capacity')).json() as Json;
    const pri = cap.managers.find((m: Json) => m.managerId === uid('user:procurement'));
    expect(pri.procurements).toBeGreaterThanOrEqual(2);
    expect(pri.overloaded).toBe(true);
    expect(pri.exposure).toBeGreaterThanOrEqual(400_000);
    expect(pri.items.map((i: Json) => i.number)).toEqual(expect.arrayContaining([a.number, b.number]));
    expect(cap.managers.find((m: Json) => m.managerId === spare.id)).toMatchObject({
      procurements: 0,
      overloaded: false,
    });
    expect(cap.suggestion).toMatch(/Move work to/);
    expect(cap.unassigned.length).toBeGreaterThanOrEqual(0);
    // the existing workload view now counts by the assigned manager
    const wl = (await call('procurement', 'GET', '/reports/workload')).json() as Json;
    expect(
      wl.owners.find((o: Json) => o.ownerId === uid('user:procurement')).procurements,
    ).toBeGreaterThanOrEqual(2);
    expect((await call('legal', 'GET', '/reports/capacity')).statusCode).toBe(403);
    await dash();
  });
});

describe('FR-0645 spend by supplier, contract, master agreement, project, business unit and division', () => {
  it('reports committed and invoiced spend along each dimension', async () => {
    const c = await env.executed({ value: 80_000 });
    const m = await call('legal', 'POST', '/contracts/documents', {
      docType: 'MASTER',
      supplierId: BRIGHT,
      title: 'Master services agreement',
      text: 'The Supplier provides services under work orders issued under this master agreement.',
    });
    await call('legal', 'PATCH', `/contracts/${m.json().id}`, { value: 250_000 });
    await call('legal', 'POST', `/contracts/${m.json().id}/release-for-signing`);
    await call('delegate', 'POST', `/contracts/${m.json().id}/sign`, { decision: 'APPROVE' });
    await call('contract-mgr', 'PUT', `/contracts/${c.id}/rates`, {
      rates: [{ item: 'Unit', unitPrice: 1000 }],
    });
    const po = await call('finance', 'POST', `/contracts/${c.id}/purchase-orders`, {
      description: 'Units',
      lines: [{ item: 'Unit', qty: 10, unitPrice: 1000 }],
    });
    await call('finance', 'POST', `/contracts/${c.id}/invoices`, {
      invoiceDate: '2026-10-05',
      poId: po.json().id,
      lines: [{ item: 'Unit', qty: 5, unitPrice: 1000 }],
    });

    const by = async (dimension: string) =>
      (await call('finance', 'GET', `/reports/spend-by?dimension=${dimension}`)).json() as Json;
    const sup = await by('SUPPLIER');
    expect(sup.rows.find((r: Json) => r.key.includes('Brightwave'))).toBeTruthy();
    expect(sup.total.committed).toBeGreaterThanOrEqual(330_000);
    const con = await by('CONTRACT');
    expect(con.rows.find((r: Json) => r.key === c.view.number)).toMatchObject({
      committed: 80_000,
      invoiced: 5_000,
    });
    const mas = await by('MASTER');
    expect(mas.rows.map((r: Json) => r.key)).toEqual(
      expect.arrayContaining([
        'Not under a master agreement',
        (await call('legal', 'GET', `/contracts/${m.json().id}`)).json().number,
      ]),
    );
    expect((await by('PROJECT')).rows.length).toBeGreaterThan(0);
    expect((await by('BUSINESS_UNIT')).dimension).toBe('BUSINESS_UNIT');
    expect((await by('DIVISION')).rows.length).toBeGreaterThan(0);
    expect((await call('finance', 'GET', '/reports/spend-by?dimension=PLANET')).statusCode).toBe(400);
    expect((await call('legal', 'GET', '/reports/spend-by')).statusCode).toBe(403);
  });
});

describe('FR-0755 the draft risk assessment', () => {
  it('proposes risks, the person marks which apply, rates the rest and chooses treatments', async () => {
    const r = await request({
      title: 'Risk subject',
      estimatedValue: 2_000_000,
      termMonths: 48,
      category: 'IT managed services (UNSPSC 81111800)',
    });
    expect((await call('requester', 'GET', `/requests/${r.id}/risk-assessment`)).statusCode).toBe(404);
    expect((await call('delegate', 'POST', `/requests/${r.id}/risk-assessment/generate`)).statusCode).toBe(
      403,
    );
    const g = await call('requester', 'POST', `/requests/${r.id}/risk-assessment/generate`);
    expect(g.statusCode, g.body).toBe(201);
    const keys = (g.json().items as Json[]).map((i) => i.key);
    expect(keys).toEqual(
      expect.arrayContaining(['delivery', 'price', 'supplier', 'probity', 'exposure', 'lockin', 'cyber']),
    );
    expect(g.json().prompts.length).toBe(keys.length); // everything is still to be decided
    expect((await call('requester', 'POST', `/requests/${r.id}/risk-assessment/generate`)).json().code).toBe(
      'ASSESSMENT_EXISTS',
    );
    expect((await call('requester', 'POST', `/requests/${r.id}/risk-assessment/complete`)).json().code).toBe(
      'ASSESSMENT_INCOMPLETE',
    );

    const patch = (k: string, b: Json) =>
      call('requester', 'PATCH', `/requests/${r.id}/risk-assessment/items/${k}`, b);
    for (const k of keys) {
      if (['delivery', 'cyber'].includes(k)) continue;
      expect((await patch(k, { applicable: false })).statusCode).toBe(200);
    }
    await patch('delivery', { applicable: true, likelihood: 2, impact: 2 });
    const cy = (await patch('cyber', { applicable: true, likelihood: 4, impact: 5 })).json() as Json;
    const cyber = cy.items.find((i: Json) => i.key === 'cyber');
    expect(cyber).toMatchObject({ score: 20, level: 'HIGH' });
    expect(cy.prompts).toEqual(['Choose a treatment for "Data security and privacy" (high)']);
    expect(cyber.options.length).toBeGreaterThanOrEqual(2);
    expect((await patch('cyber', { mitigation: 'x' })).statusCode).toBe(400);
    await patch('cyber', { mitigation: cyber.options[0] });
    expect((await patch('cyber', { likelihood: 9 })).statusCode).toBe(400);
    const done = await call('requester', 'POST', `/requests/${r.id}/risk-assessment/complete`);
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json().complete).toBe(true);
    expect((await patch('delivery', { impact: 3 })).json().code).toBe('ASSESSMENT_COMPLETE');
    expect((await call('probity', 'GET', `/requests/${r.id}/risk-assessment`)).json().canEdit).toBe(false);
    expect(await audit(r.id)).toEqual(
      expect.arrayContaining(['risk.generate', 'risk.update', 'risk.complete']),
    );
  });
});

describe('FR-0625 drill-down, saved views and questions in plain language', () => {
  it('answers "all procurement risks in 2026", drills into a figure and keeps custom views for the person or for everyone', async () => {
    // the high risk recorded above is in 2026 (the platform clock)
    const ask = await call('exec', 'POST', '/reports/ask', { question: 'all procurement risks in 2026' });
    expect(ask.statusCode, ask.body).toBe(200);
    expect(ask.json()).toMatchObject({ entity: 'risks', model: 'rules-simulated-v1' });
    expect(ask.json().interpretation).toMatch(/risks, in 2026/);
    expect(
      ask.json().rows.some((r: Json) => r.risk === 'Data security and privacy' && r.rating === 'HIGH'),
    ).toBe(true);
    expect(
      ((await call('exec', 'POST', '/reports/ask', { question: 'high risks in 2026' })).json() as Json).total,
    ).toBeGreaterThanOrEqual(1);
    expect(
      ((await call('exec', 'POST', '/reports/ask', { question: 'risks in 1999' })).json() as Json).total,
    ).toBe(0);
    expect(
      (
        (
          await call('exec', 'POST', '/reports/ask', { question: 'procurements in the plan phase' })
        ).json() as Json
      ).columns.length,
    ).toBeGreaterThan(3);
    expect(
      ((await call('exec', 'POST', '/reports/ask', { question: 'contracts over 50k' })).json() as Json).rows
        .length,
    ).toBeGreaterThan(0);
    expect(
      ((await call('exec', 'POST', '/reports/ask', { question: 'blocked invoices' })).json() as Json).entity,
    ).toBe('invoices');
    const no = await call('exec', 'POST', '/reports/ask', { question: 'what is the weather today' });
    expect(no.statusCode).toBe(422);
    expect(no.json().code).toBe('QUESTION_NOT_UNDERSTOOD');
    expect((await call('requester', 'POST', '/reports/ask', { question: 'contracts' })).statusCode).toBe(403);

    const drill = (await call('exec', 'GET', '/reports/drill?by=phase&key=PLAN')).json() as Json;
    expect(drill.total).toBeGreaterThan(0);
    expect(drill.rows.every((r: Json) => r.phase === 'PLAN')).toBe(true);
    expect((await call('exec', 'GET', '/reports/drill?by=weather&key=x')).statusCode).toBe(400);

    const mine = await call('exec', 'POST', '/report-views', {
      name: 'My 2026 risks',
      report: 'ask',
      filters: { question: 'all procurement risks in 2026' },
      shared: false,
    });
    expect(mine.statusCode, mine.body).toBe(201);
    const shared = await call('exec', 'POST', '/report-views', {
      name: 'Spend by division',
      report: 'spend-by',
      filters: { dimension: 'DIVISION' },
      shared: true,
    });
    const forFinance = ((await call('finance', 'GET', '/report-views')).json() as Json[]).map((v) => v.name);
    expect(forFinance).toContain('Spend by division');
    expect(forFinance).not.toContain('My 2026 risks');
    const own = (await call('exec', 'GET', '/report-views')).json() as Json[];
    expect(own.map((v) => v.name)).toEqual(expect.arrayContaining(['My 2026 risks', 'Spend by division']));
    expect(own.find((v) => v.name === 'My 2026 risks')!.filters.question).toMatch(/risks/);
    expect((await call('finance', 'DELETE', `/report-views/${shared.json().id}`)).statusCode).toBe(404);
    expect((await call('exec', 'DELETE', `/report-views/${shared.json().id}`)).statusCode).toBe(204);
    expect(await audit(mine.json().id)).toContain('report_view.save');
  });
});

describe('FR-0735 concurrent editing', () => {
  it('lets two people edit different sections at the same moment, and refuses a stale edit of the same section with what changed', async () => {
    const r = await request();
    const p = await planOf(r.id);
    const rev = (k: string) => (p.fields as Json[]).find((f) => f.key === k)!.rev as number;
    // both load the plan, then each edits a different section from the same starting point
    const a = await call('procurement', 'PUT', `/plans/${p.id}/fields/objectives`, {
      value: 'Objectives rewritten by procurement.',
      expectedRev: rev('objectives'),
    });
    expect(a.statusCode, a.body).toBe(200);
    const b = await call('requester', 'PUT', `/plans/${p.id}/fields/deliverables`, {
      value: 'Deliverables rewritten by the requester.',
      expectedRev: rev('deliverables'),
    });
    expect(b.statusCode, b.body).toBe(200);
    const now = (await call('procurement', 'GET', `/requests/${r.id}/plan`)).json() as Json;
    expect((now.fields as Json[]).find((f) => f.key === 'objectives')!.value).toBe(
      'Objectives rewritten by procurement.',
    );
    expect((now.fields as Json[]).find((f) => f.key === 'deliverables')!.value).toBe(
      'Deliverables rewritten by the requester.',
    );
    // the same section from a stale revision is refused, saying who changed it and what it says now
    const stale = await call('requester', 'PUT', `/plans/${p.id}/fields/objectives`, {
      value: 'Overwrite attempt',
      expectedRev: rev('objectives'),
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe('FIELD_CHANGED');
    expect(stale.json().title).toMatch(/Priya Nair/);
    expect(stale.json().errors[0].message).toMatch(/Objectives rewritten by procurement/);
    expect(
      ((await call('procurement', 'GET', `/requests/${r.id}/plan`)).json() as Json).fields.find(
        (f: Json) => f.key === 'objectives',
      ).value,
    ).toBe('Objectives rewritten by procurement.');
    // the whole-plan version check still works for callers that use it, and one of the two is needed
    expect(
      (
        await call('requester', 'PUT', `/plans/${p.id}/fields/objectives`, {
          value: 'x',
          expectedVersion: 999,
        })
      ).json().code,
    ).toBe('VERSION_CONFLICT');
    expect(
      (await call('requester', 'PUT', `/plans/${p.id}/fields/objectives`, { value: 'x' })).statusCode,
    ).toBe(400);

    // who is in the document, and on which section
    expect(
      (
        await call('procurement', 'POST', `/documents/plan/${p.id}/presence`, { fieldKey: 'objectives' })
      ).json().others,
    ).toEqual([]);
    const seen = await call('requester', 'POST', `/documents/plan/${p.id}/presence`, { fieldKey: 'risks' });
    expect(seen.json().others).toEqual([
      expect.objectContaining({ name: 'Priya Nair', fieldKey: 'objectives' }),
    ]);
    env.clock.advanceDays(1);
    expect(
      ((await call('requester', 'GET', `/documents/plan/${p.id}/presence`)).json() as Json).others,
    ).toEqual([]); // stale presence ages out
    back();
  });

  it('applies to the tender pack too', async () => {
    const r = await request();
    await planOf(r.id);
    const t = await call('procurement', 'POST', '/tenders', { requestId: r.id, type: 'RFP', access: 'OPEN' });
    const tid = t.json().id as string;
    const ov = (t.json().fields as Json[]).find((f) => f.key === 'overview')!;
    const cond = (t.json().fields as Json[]).find((f) => f.key === 'conditions')!;
    expect(
      (
        await call('procurement', 'PUT', `/tenders/${tid}/fields/overview`, {
          value: 'New overview text.',
          expectedRev: ov.rev,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await call('legal', 'PUT', `/tenders/${tid}/fields/conditions`, {
          value: 'Legal conditions.',
          expectedRev: cond.rev,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await call('legal', 'PUT', `/tenders/${tid}/fields/overview`, {
          value: 'Stale.',
          expectedRev: ov.rev,
        })
      ).json().code,
    ).toBe('FIELD_CHANGED');
  });
});

describe('FR-0740 tracked changes, saved versions and what changed since you looked', () => {
  it('records every change, keeps named versions, compares them word by word and summarises what changed since the last look', async () => {
    const r = await request();
    const p = await planOf(r.id);
    const doc = `/documents/plan/${p.id}`;
    const first = (await call('requester', 'GET', `${doc}/summary?markSeen=true`)).json() as Json;
    expect(first.firstLook).toBe(true);
    const v1 = await call('requester', 'POST', `${doc}/versions`, { label: 'First draft' });
    expect(v1.statusCode, v1.body).toBe(201);
    expect(v1.json().number).toBe(1);

    env.clock.advanceDays(1);
    const cur = (key: string) => (p.fields as Json[]).find((f) => f.key === key)!.rev as number;
    await call('procurement', 'PUT', `/plans/${p.id}/fields/objectives`, {
      value: 'A completely different objective for the project.',
      expectedRev: cur('objectives'),
    });
    await call('procurement', 'PUT', `/plans/${p.id}/fields/risks`, {
      value: 'Supplier insolvency and late delivery.',
      expectedRev: cur('risks'),
    });
    const sum = (await call('requester', 'GET', `${doc}/summary`)).json() as Json;
    expect(sum.firstLook).toBe(false);
    expect(sum.changes).toBe(2);
    expect(sum.summary).toMatch(/2 change\(s\) to 2 field\(s\)/);
    expect(sum.summary).toMatch(/Priya Nair/);
    expect(sum.model).toBe('rules-simulated-v1');
    await call('requester', 'GET', `${doc}/summary?markSeen=true`);
    expect(((await call('requester', 'GET', `${doc}/summary`)).json() as Json).summary).toMatch(
      /Nothing has changed/,
    );

    const changes = (
      await call(
        'requester',
        'GET',
        `${doc}/changes?since=${new Date(env.clock.now().getTime() - 3600_000).toISOString()}`,
      )
    ).json() as Json;
    expect(changes.total).toBe(2);
    const c = changes.changes.find((x: Json) => x.key === 'objectives');
    expect(c).toMatchObject({ by: 'Priya Nair', label: 'Objectives' });
    expect(c.diff.some((d: Json) => d.t === 'add')).toBe(true);
    expect(c.diff.some((d: Json) => d.t === 'del')).toBe(true);

    expect(
      (await call('procurement', 'POST', `${doc}/versions`, { label: 'After review' })).json().number,
    ).toBe(2);
    const list = (await call('requester', 'GET', `${doc}/versions`)).json() as Json[];
    expect(list.map((v) => v.label)).toEqual(['After review', 'First draft']);
    expect(
      ((await call('requester', 'GET', `${doc}/versions/1`)).json() as Json).fields.objectives.value,
    ).not.toMatch(/completely different/);
    expect(
      ((await call('requester', 'GET', `${doc}/versions/2`)).json() as Json).fields.objectives.value,
    ).toMatch(/completely different/);
    expect((await call('requester', 'GET', `${doc}/versions/9`)).statusCode).toBe(404);
    const cmp = (await call('requester', 'GET', `${doc}/compare?from=1&to=2`)).json() as Json;
    expect(cmp.changed).toBe(2);
    expect(cmp.fields.find((f: Json) => f.key === 'objectives')).toMatchObject({ status: 'CHANGED' });
    expect(cmp.fields.find((f: Json) => f.key === 'background')).toMatchObject({ status: 'SAME' });
    expect(((await call('requester', 'GET', `${doc}/compare?from=1`)).json() as Json).to).toBe('current');
    // a requester sees only their own documents; other people's are not found
    const other = await request();
    const op = await planOf(other.id);
    const stranger = await env.extraUser('stranger', 'REQUESTER');
    expect((await call(stranger.email, 'GET', `/documents/plan/${op.id}/changes`)).statusCode).toBe(404);
    expect(await audit(p.id)).toContain('plan.field_update');
    back();
  });
});

describe('FR-0750 changing the template in plain language', () => {
  it('re-populates the newly chosen template and keeps what a person wrote', async () => {
    const r = await request();
    await planOf(r.id);
    const t = await call('procurement', 'POST', '/tenders', { requestId: r.id, type: 'RFP', access: 'OPEN' });
    const tid = t.json().id as string;
    const ov = (t.json().fields as Json[]).find((f) => f.key === 'overview')!;
    expect(ov.value).toMatch(/Request for Proposal/);
    await call('procurement', 'PUT', `/tenders/${tid}/fields/scope`, {
      value: 'Scope written by hand.',
      expectedRev: (t.json().fields as Json[]).find((f) => f.key === 'scope')!.rev,
    });
    expect(
      (
        await call('requester', 'POST', `/tenders/${tid}/template-change`, {
          instruction: 'use the quote template',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call('procurement', 'POST', `/tenders/${tid}/template-change`, {
          instruction: 'make it something',
        })
      ).json().code,
    ).toBe('INSTRUCTION_NOT_UNDERSTOOD');
    expect(
      (
        await call('procurement', 'POST', `/tenders/${tid}/template-change`, {
          instruction: 'this should be a proposal',
        })
      ).json().changed,
    ).toBe(false);
    const ch = await call('procurement', 'POST', `/tenders/${tid}/template-change`, {
      instruction: 'Please use the request for quotation template instead',
    });
    expect(ch.statusCode, ch.body).toBe(200);
    expect(ch.json()).toMatchObject({ from: 'RFP', to: 'RFQ', changed: true });
    expect(ch.json().kept).toEqual(['Scope of work']);
    expect(ch.json().repopulated).toContain('Overview');
    const after = (await call('procurement', 'GET', `/tenders/${tid}`)).json() as Json;
    expect(after.type).toBe('RFQ');
    const f = (k: string) => (after.fields as Json[]).find((x) => x.key === k)!.value as string;
    expect(f('overview')).toMatch(/Request for Quotation/);
    expect(f('scope')).toBe('Scope written by hand.');
    expect(f('evaluationCriteria')).toMatch(/Price: 100%/);
    expect(await audit(tid)).toContain('tender.template_change');
  });
});

describe('FR-0760 summaries of supplier responses', () => {
  it('summarises pricing, dates, proposed changes, and the pros and cons of each response, after the tender closes', async () => {
    const a = await env.award({ value: 150_000 });
    const other = uid('supplier:northstar');
    await env.withSystem(env.database, async (tx) => {
      const [sub] = await tx.select().from(s.submission).where(eq(s.submission.tenderId, a.tenderId));
      await tx
        .update(s.tender)
        .set({
          status: 'EVALUATING',
          opensAt: new Date('2026-09-01T00:00:00Z'),
          closesAt: new Date('2026-09-30T00:00:00Z'),
        })
        .where(eq(s.tender.id, a.tenderId));
      await tx
        .update(s.submission)
        .set({ submittedAt: new Date('2026-09-25T00:00:00Z') })
        .where(eq(s.submission.id, sub!.id));
      await tx.insert(s.bidPricing).values({
        tenantId: TENANT_ID,
        submissionId: sub!.id,
        basePrice: '100000',
        implementation: '10000',
        annualRunning: '20000',
        years: 2,
        tco: '140000',
      });
      const [sub2] = await tx
        .insert(s.submission)
        .values({
          tenantId: TENANT_ID,
          tenderId: a.tenderId,
          supplierId: other,
          status: 'SUBMITTED',
          submittedAt: new Date('2026-09-29T00:00:00Z'),
        })
        .returning();
      await tx.insert(s.bidPricing).values({
        tenantId: TENANT_ID,
        submissionId: sub2!.id,
        basePrice: '150000',
        implementation: '0',
        annualRunning: '10000',
        years: 2,
        tco: '170000',
      });
      await tx.insert(s.tenderDeviation).values({
        tenantId: TENANT_ID,
        tenderId: a.tenderId,
        supplierId: other,
        clauseRef: 'Payment terms',
        proposal: 'Payment in 14 days instead of 30',
      });
    });
    const res = await call('procurement', 'GET', `/tenders/${a.tenderId}/response-summaries`);
    expect(res.statusCode, res.body).toBe(200);
    const list = res.json().summaries as Json[];
    expect(list).toHaveLength(2);
    const bright = list.find((x) => x.supplier.includes('Brightwave'))!;
    expect(bright.pricing).toMatch(/total cost \$140,000/);
    expect(bright.dates).toMatch(/Submitted 2026-09-25 \(5 day\(s\) before closing\)/);
    expect(bright.pros).toEqual(
      expect.arrayContaining([
        'Lowest total cost of ownership',
        'Within the approved estimate',
        'Accepts the tender terms without changes',
      ]),
    );
    expect(bright.cons).toEqual([]);
    const north = list.find((x) => !x.supplier.includes('Brightwave'))!;
    expect(north.variations).toEqual(['Payment terms: Payment in 14 days instead of 30']);
    expect(north.cons).toEqual(
      expect.arrayContaining([
        'Highest total cost of ownership',
        'Above the approved estimate by $20,000',
        'Proposes 1 change(s) to the tender terms',
      ]),
    );
    expect(res.json().model).toBe('rules-simulated-v1');
    // sealed until close, and anonymous to those who are not allowed to know who bid
    await env.withSystem(env.database, (tx) =>
      tx.update(s.tender).set({ status: 'PUBLISHED' }).where(eq(s.tender.id, a.tenderId)),
    );
    expect((await call('procurement', 'GET', `/tenders/${a.tenderId}/response-summaries`)).json().code).toBe(
      'TENDER_SEALED',
    );
    await env.withSystem(env.database, (tx) =>
      tx.update(s.tender).set({ status: 'EVALUATING' }).where(eq(s.tender.id, a.tenderId)),
    );
    expect((await call('requester', 'GET', `/tenders/${a.tenderId}/response-summaries`)).statusCode).toBe(
      403,
    );
    expect(
      (await call('evaluator-tech', 'GET', `/tenders/${a.tenderId}/response-summaries`)).statusCode,
    ).toBe(404); // not on the panel
    await env.withSystem(env.database, (tx) =>
      tx.insert(s.panelMember).values({
        tenantId: TENANT_ID,
        evaluationId: a.evaluationId,
        userId: uid('user:evaluator-tech'),
        stream: 'TECHNICAL',
        coiState: 'DECLARED_NONE',
      }),
    );
    const anon = (
      await call('evaluator-tech', 'GET', `/tenders/${a.tenderId}/response-summaries`)
    ).json() as Json;
    expect(anon.named).toBe(false);
    expect(anon.summaries.map((x: Json) => x.supplier)).toEqual(['Supplier A', 'Supplier B']);
  });
});

describe('FR-0765 the reference content corpus', () => {
  it('regenerates best-practice variants into the in-house corpus on request and on its own schedule, without leaving the boundary', async () => {
    expect((await call('requester', 'POST', '/reference-content/refresh')).statusCode).toBe(403);
    const first = (await call('procurement', 'POST', '/reference-content/refresh')).json() as Json;
    expect(first.generation).toBeGreaterThan(0);
    expect(first.variants).toBeGreaterThanOrEqual(48);
    const g = first.generation as number;
    const list = (await call('requester', 'GET', '/reference-content?level=Senior')).json() as Json;
    expect(list.generation).toBe(g);
    expect(list.items.every((i: Json) => i.level === 'Senior')).toBe(true);
    expect(list.kinds).toEqual(expect.arrayContaining(['Project manager', 'Business analyst']));
    expect(list.refreshedNow).toBe(false);
    expect(
      (
        (
          await call('requester', 'GET', '/reference-content?kind=Project manager&category=General')
        ).json() as Json
      ).total,
    ).toBeGreaterThanOrEqual(0);
    // left alone for longer than the refresh period it is renewed by itself
    env.clock.advanceDays(91);
    const auto = (await call('requester', 'GET', '/reference-content')).json() as Json;
    expect(auto.refreshedNow).toBe(true);
    expect(auto.generation).toBe(g + 1);
    expect(auto.items[0].body).toContain(`generation ${g + 1}`);
    const ev = await env.withSystem(env.database, (tx) =>
      tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'reference.refresh')),
    );
    expect(ev.length).toBeGreaterThanOrEqual(2);
    expect((ev.at(-1)!.after as Json).boundary).toMatch(/in-house/);
    back();
  });
});

describe('FR-0770 advancing a procurement in plain language and by detection', () => {
  it('moves forward only when the phase before it is finished, and notices finished work by itself', async () => {
    const r = await request();
    expect(
      (await call('procurement', 'POST', `/requests/${r.id}/advance`, { instruction: 'hmm' })).json().code,
    ).toBe('INSTRUCTION_NOT_UNDERSTOOD');
    const [row] = await env.withSystem(env.database, (tx) =>
      tx.select().from(s.request).where(eq(s.request.id, r.id)),
    );
    // the plan has not been approved, so the plan phase cannot be left yet
    await env.withSystem(env.database, (tx) =>
      tx.update(s.request).set({ phase: 'PLAN' }).where(eq(s.request.id, r.id)),
    );
    const no = await call('procurement', 'POST', `/requests/${r.id}/advance`, {
      instruction: 'move to tender',
    });
    expect(no.statusCode).toBe(409);
    expect(no.json().code).toBe('PHASE_NOT_COMPLETE');
    expect(no.json().errors[0].message).toMatch(/the plan is approved and locked first/);
    expect(
      (
        await call('procurement', 'POST', `/requests/${r.id}/advance`, { instruction: 'go back to intake' })
      ).json().code,
    ).toBe('NOT_FORWARD');

    const p = await planOf(r.id);
    await env.withSystem(env.database, (tx) =>
      tx.update(s.plan).set({ status: 'APPROVED_LOCKED', locked: true }).where(eq(s.plan.id, p.id)),
    );
    const ok = await call('procurement', 'POST', `/requests/${r.id}/advance`, {
      instruction: 'Please go to the next phase',
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ from: 'PLAN', to: 'TENDER' });
    expect(await audit(r.id)).toContain('request.advance');

    // detection: the tracker is behind the records, and one call catches it up
    const lag = await request();
    const lp = await planOf(lag.id);
    await env.withSystem(env.database, (tx) =>
      tx.update(s.plan).set({ status: 'APPROVED_LOCKED', locked: true }).where(eq(s.plan.id, lp.id)),
    );
    await env.withSystem(env.database, (tx) =>
      tx.update(s.request).set({ phase: 'PLAN' }).where(eq(s.request.id, lag.id)),
    );
    const sync = (await call('procurement', 'POST', `/requests/${lag.id}/phase/sync`)).json() as Json;
    expect(sync).toMatchObject({ advanced: true, from: 'PLAN', to: 'TENDER' });
    expect((await call('procurement', 'POST', `/requests/${lag.id}/phase/sync`)).json().advanced).toBe(false);
    const behind = await request();
    const bp = await planOf(behind.id);
    await env.withSystem(env.database, async (tx) => {
      await tx.update(s.plan).set({ status: 'APPROVED_LOCKED', locked: true }).where(eq(s.plan.id, bp.id));
      await tx.update(s.request).set({ phase: 'INTAKE' }).where(eq(s.request.id, behind.id));
    });
    const all = (await call('procurement', 'POST', '/requests/phase-sync')).json() as Json;
    expect(all.advanced).toBeGreaterThanOrEqual(1);
    expect(all.moved.map((m: Json) => m.id)).toContain(behind.id);
    expect((await call('requester', 'POST', '/requests/phase-sync')).statusCode).toBe(403);
    void row;
  });
});

describe('FR-0775 the committee by instruction or by name', () => {
  it('adds and removes members from an instruction, with a picker where several people match', async () => {
    const a = await env.award();
    await env.withSystem(env.database, async (tx) => {
      await tx.update(s.evaluation).set({ status: 'COI_PENDING' }).where(eq(s.evaluation.id, a.evaluationId));
      await tx.insert(s.panelMember).values({
        tenantId: TENANT_ID,
        evaluationId: a.evaluationId,
        userId: uid('user:evaluator-tech'),
        stream: 'TECHNICAL',
      });
    });
    const twin = await env.extraUser('nia-twin', 'EVALUATOR');
    await env.withSystem(env.database, (tx) =>
      tx.update(s.appUser).set({ name: 'Nia Otieno' }).where(eq(s.appUser.id, twin.id)),
    );
    const say = (instruction: string, extra: Json = {}) =>
      call('procurement', 'POST', `/evaluations/${a.evaluationId}/committee/instruct`, {
        instruction,
        ...extra,
      });
    expect(
      (
        await call('requester', 'POST', `/evaluations/${a.evaluationId}/committee/instruct`, {
          instruction: 'add Mei',
        })
      ).statusCode,
    ).toBe(403);
    expect((await say('shuffle everyone')).json().code).toBe('INSTRUCTION_NOT_UNDERSTOOD');
    expect((await say('add Zebedee')).json().code).toBe('NO_MATCH');
    // one match: done at once
    const one = await say('add Mei Tanaka to the committee');
    expect(one.statusCode, one.body).toBe(200);
    expect(one.json()).toMatchObject({ status: 'DONE', action: 'ADD', person: { name: 'Mei Tanaka' } });
    expect(await audit(a.evaluationId)).toContain('evaluation.panel_add');
    // two Nias: the picker, then the choice
    const amb = (await say('add Nia')).json() as Json;
    expect(amb.status).toBe('AMBIGUOUS');
    expect(amb.candidates.map((c: Json) => c.name).sort()).toEqual(['Nia Okoro', 'Nia Otieno']);
    const pick = await say('add Nia', { userId: twin.id });
    expect(pick.json()).toMatchObject({ status: 'DONE', person: { name: 'Nia Otieno' } });
    expect((await say('add Nia Otieno')).json().code).toBe('NO_MATCH'); // already on it
    // remove by name
    const rm = await say('remove Mei');
    expect(rm.json()).toMatchObject({ status: 'DONE', action: 'REMOVE', person: { name: 'Mei Tanaka' } });
    const members = await env.withSystem(env.database, (tx) =>
      tx.select().from(s.panelMember).where(eq(s.panelMember.evaluationId, a.evaluationId)),
    );
    expect(members.find((m) => m.userId === uid('user:evaluator-comm'))!.coiState).toBe('REMOVED');
    expect(await audit(a.evaluationId)).toContain('evaluation.panel_remove');
    // someone who has already scored is not removed
    await env.withSystem(env.database, (tx) =>
      tx
        .update(s.panelMember)
        .set({ scoredAt: new Date() })
        .where(
          and(
            eq(s.panelMember.evaluationId, a.evaluationId),
            eq(s.panelMember.userId, uid('user:evaluator-tech')),
          ),
        ),
    );
    expect((await say('remove Tomas')).json().code).toBe('HAS_SCORES');
  });
});
