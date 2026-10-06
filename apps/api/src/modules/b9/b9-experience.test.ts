import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import * as s from '../../db/schema.js';
import { TENANT_ID, uid } from '../../db/seed.js';
import { BRIGHT, createEnv, type Json } from '../contract/test-env.js';
import { milestonesOf } from './progress.js';

let env: Awaited<ReturnType<typeof createEnv>>;
const call = (...a: Parameters<typeof env.call>) => env.call(...a);
const sys = <T>(fn: Parameters<typeof env.withSystem>[1]) => env.withSystem(env.database, fn) as Promise<T>;
beforeAll(async () => {
  env = await createEnv();
}, 120_000);
const setting = async (name: string, value: unknown) => {
  const r = await call('admin', 'PUT', '/admin/settings', { [name]: value });
  expect(r.statusCode, r.body).toBe(200);
};

describe('FR-0835 progress to completion', () => {
  const base = {
    requestStatus: 'DRAFT',
    requestPhase: 'INTAKE',
    planStatus: null,
    tenderStatus: null,
    evaluationStatus: null,
    contractStatus: null,
  };
  it('works the milestones out from the records, in order, and never claims more than is true', () => {
    const none = milestonesOf(base);
    expect(none).toMatchObject({ doneCount: 0, percent: 0, complete: false });
    expect(none.milestones[0]).toMatchObject({ key: 'raised', done: false, current: true });
    const mid = milestonesOf({
      ...base,
      requestStatus: 'IN_PROGRESS',
      requestPhase: 'TENDER',
      planStatus: 'APPROVED_LOCKED',
      tenderStatus: 'PUBLISHED',
    });
    expect(mid.milestones.filter((m) => m.done).map((m) => m.key)).toEqual(['raised', 'plan', 'published']);
    expect(mid.milestones.find((m) => m.current)!.key).toBe('bids');
    expect(mid.percent).toBe(43);
    const done = milestonesOf({ ...base, requestStatus: 'COMPLETE', requestPhase: 'CLOSED' });
    expect(done).toMatchObject({ doneCount: 7, percent: 100, complete: true });
    expect(done.milestones.some((m) => m.current)).toBe(false);
    // a plan that is only awaiting approval is not an approved plan
    expect(
      milestonesOf({ ...base, requestStatus: 'SUBMITTED', planStatus: 'AWAITING_APPROVAL' }).milestones.find(
        (m) => m.key === 'plan',
      )!.done,
    ).toBe(false);
  });

  it('is available for a procurement the person can see, moves as the work does, and is closed to others', async () => {
    const c = await call('requester', 'POST', '/requests', {
      title: 'Progress fixture',
      category: 'Building cleaning (UNSPSC 76111500)',
      estimatedValue: 90_000,
      termMonths: 24,
      businessUnit: 'Facilities',
      fields: { contractOwner: 'Sofia Rossi', background: 'Existing arrangements end in six months.' },
    });
    const id = c.json().id as string;
    let p = (await call('requester', 'GET', `/requests/${id}/progress`)).json() as Json;
    expect(p).toMatchObject({ doneCount: 0, phase: 'INTAKE' });
    await call('requester', 'POST', `/requests/${id}/submit`);
    p = (await call('requester', 'GET', `/requests/${id}/progress`)).json() as Json;
    expect(p.milestones.find((m: Json) => m.key === 'raised').done).toBe(true);
    const plan = (await call('procurement', 'GET', `/requests/${id}/plan`)).json() as Json;
    await call('procurement', 'POST', `/plans/${plan.id}/submit-for-approval`);
    await call('delegate', 'POST', `/plans/${plan.id}/decision`, { decision: 'APPROVE' });
    p = (await call('procurement', 'GET', `/requests/${id}/progress`)).json() as Json;
    expect(p.doneCount).toBe(2);
    expect(p.milestones.find((m: Json) => m.current).label).toBe('Tender published');
    // someone else's request is not theirs to see; a supplier has no such page
    const other = await env.extraUser('other-requester', 'REQUESTER');
    expect((await call(other.email, 'GET', `/requests/${id}/progress`)).statusCode).toBe(404);
    expect((await call('supplier', 'GET', `/requests/${id}/progress`)).statusCode).toBe(403);
  });
});

describe("FR-0850 a person's own dashboard", () => {
  it('starts from sensible defaults for the role, saves what the person chooses, and refuses what the role cannot use', async () => {
    const exec = (await call('exec', 'GET', '/me/dashboard')).json() as Json;
    expect(exec.custom).toBe(false);
    expect(exec.widgets.map((w: Json) => w.key)).toEqual(['kpis', 'phases', 'spend', 'commitment']);
    expect(exec.catalogue.map((w: Json) => w.key)).toEqual(
      expect.arrayContaining(['esg', 'risk', 'optimisation']),
    );
    const req = (await call('requester', 'GET', '/me/dashboard')).json() as Json;
    expect(req.widgets.map((w: Json) => w.key)).toEqual(['kpis', 'phases']);
    expect(req.catalogue.map((w: Json) => w.key)).toEqual(['kpis', 'phases']);
    expect((await call('supplier', 'GET', '/me/dashboard')).statusCode).toBe(403);

    // a person's choice: order, size and style
    const mine = [
      { key: 'commitment', size: 'L', style: 'LINE' },
      { key: 'spend', size: 'M', style: 'BAR3D' },
      { key: 'esg', size: 'S', style: 'DONUT' },
    ];
    const saved = await call('exec', 'PUT', '/me/dashboard', { widgets: mine });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({ custom: true });
    expect((await call('exec', 'GET', '/me/dashboard')).json().widgets).toEqual(mine);
    // it is theirs alone
    expect((await call('finance', 'GET', '/me/dashboard')).json().custom).toBe(false);

    const bad = await call('requester', 'PUT', '/me/dashboard', {
      widgets: [{ key: 'spend', size: 'M', style: 'BAR' }],
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().errors[0].message).toMatch(/not a widget you can use/);
    const wrongStyle = await call('exec', 'PUT', '/me/dashboard', {
      widgets: [{ key: 'kpis', size: 'M', style: 'LINE' }],
    });
    expect(wrongStyle.statusCode).toBe(422);
    expect(wrongStyle.json().errors[0].message).toMatch(/can be shown as: cards, table/);
    expect(
      (
        await call('exec', 'PUT', '/me/dashboard', {
          widgets: [
            { key: 'kpis', size: 'M', style: 'CARDS' },
            { key: 'kpis', size: 'S', style: 'TABLE' },
          ],
        })
      ).statusCode,
    ).toBe(422);
    expect((await call('exec', 'PUT', '/me/dashboard', { widgets: [] })).statusCode).toBe(400);
    expect(
      (await call('exec', 'PUT', '/me/dashboard', { widgets: [{ key: 'kpis', size: 'XL', style: 'CARDS' }] }))
        .statusCode,
    ).toBe(400);

    const reset = (await call('exec', 'DELETE', '/me/dashboard')).json() as Json;
    expect(reset.custom).toBe(false);
    expect(reset.widgets.map((w: Json) => w.key)).toEqual(['kpis', 'phases', 'spend', 'commitment']);
  });

  it('a saved widget the person can no longer open is left out, not shown broken', async () => {
    const u = await env.extraUser('dash-finance', 'FINANCE');
    expect(
      (
        await call(u.email, 'PUT', '/me/dashboard', {
          widgets: [
            { key: 'spend', size: 'M', style: 'BAR' },
            { key: 'kpis', size: 'S', style: 'CARDS' },
          ],
        })
      ).statusCode,
    ).toBe(200);
    await sys((tx) =>
      tx.update(s.roleAssignment).set({ role: 'REQUESTER' }).where(eq(s.roleAssignment.userId, u.id)),
    );
    const after = (await call(u.email, 'GET', '/me/dashboard')).json() as Json;
    expect(after.widgets.map((w: Json) => w.key)).toEqual(['kpis']);
  });
});

describe('NFR-U04 layouts for every phase of the lifecycle', () => {
  it('covers the request page and the contract page as well as the plan, the tender pack and the report', async () => {
    const list = (await call('procurement', 'GET', '/layouts')).json() as Json[];
    expect(list.map((l) => l.kind)).toEqual(['PLAN', 'RFX', 'REPORT', 'INTAKE', 'CONTRACT']);
    const intake = list.find((l) => l.kind === 'INTAKE')!;
    expect(intake.sections.map((x: Json) => x.key)).toEqual([
      'progress',
      'actions',
      'advance',
      'risk',
      'lessons',
      'extras',
    ]);
    // anyone who can open the page can ask what it shows and in what order
    expect((await call('requester', 'GET', '/layouts/INTAKE/applied')).json()).toEqual({
      kind: 'INTAKE',
      custom: false,
      keys: ['progress', 'actions', 'advance', 'risk', 'lessons', 'extras'],
    });
    expect((await call('supplier', 'GET', '/layouts/INTAKE/applied')).statusCode).toBe(403);
    expect((await call('requester', 'GET', '/layouts/NOPE/applied')).statusCode).toBe(400);

    const order = ['actions', 'extras', 'lessons', 'risk', 'advance', 'progress'];
    const keep = await call('procurement', 'PUT', '/layouts/INTAKE', {
      name: 'Actions first',
      sections: order.map((key) => ({ key, enabled: key !== 'advance' })),
    });
    expect(keep.statusCode, keep.body).toBe(200);
    expect((await call('requester', 'GET', '/layouts/INTAKE/applied')).json()).toEqual({
      kind: 'INTAKE',
      custom: true,
      keys: ['actions', 'extras', 'lessons', 'risk', 'progress'],
    });
    // a mandatory panel cannot be left out
    const bad = await call('procurement', 'PUT', '/layouts/INTAKE', {
      name: 'No actions',
      sections: order.map((key) => ({ key, enabled: key !== 'actions' })),
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().errors[0].message).toMatch(/required/);

    const contract = list.find((l) => l.kind === 'CONTRACT')!;
    expect(contract.sections.filter((x: Json) => x.mandatory).map((x: Json) => x.key)).toEqual([
      'clauses',
      'terms',
      'signature',
    ]);
    const c = await call('admin', 'PUT', '/layouts/CONTRACT', {
      name: 'Checks first',
      sections: [
        'checks',
        ...contract.sections.map((x: Json) => x.key).filter((k: string) => k !== 'checks'),
      ].map((key: string) => ({ key, enabled: true })),
    });
    expect(c.statusCode, c.body).toBe(200);
    expect((await call('legal', 'GET', '/layouts/CONTRACT/applied')).json().keys[0]).toBe('checks');
    expect(
      (await call('requester', 'PUT', '/layouts/CONTRACT', { name: 'x', sections: [] })).statusCode,
    ).toBe(403);
    // reset
    for (const k of ['INTAKE', 'CONTRACT'])
      expect((await call('procurement', 'DELETE', `/layouts/${k}`)).statusCode).toBe(200);
    expect((await call('requester', 'GET', '/layouts/INTAKE/applied')).json().custom).toBe(false);
  });
});

describe('FR-0825 notes taken during a supplier review', () => {
  it('a note is private to its author unless shared; panel members may write only about the bidders they assess', async () => {
    const targets = (await call('procurement', 'GET', '/notes/targets')).json() as Json[];
    expect(targets.length).toBeGreaterThanOrEqual(4);
    // the seeded evaluation has four bidders and an evaluator on its panel
    const mine = (await call('evaluator-tech', 'GET', '/notes/targets')).json() as Json[];
    expect(mine.map((t) => t.company)).toEqual(
      expect.arrayContaining(['Brightwave Cleaning Pty Ltd', 'Northstar Property Care Pty Ltd']),
    );
    expect((await call('evaluator-extra', 'GET', '/notes/targets')).json()).toEqual([]);
    expect((await call('requester', 'GET', '/notes/targets')).statusCode).toBe(403);
    expect((await call('admin', 'GET', '/notes/targets')).statusCode).toBe(403);

    const n = await call('evaluator-tech', 'POST', '/notes', {
      supplierId: BRIGHT,
      text: 'Strong transition plan; weak on after-hours cover.',
    });
    expect(n.statusCode, n.body).toBe(201);
    expect(n.json()).toMatchObject({ visibility: 'PRIVATE', mine: true });
    const shared = await call('evaluator-tech', 'POST', '/notes', {
      supplierId: BRIGHT,
      text: 'Reference check done by phone: positive.',
      visibility: 'TEAM',
    });
    expect(shared.statusCode).toBe(201);
    // another evaluator cannot write about, or read, what is not theirs
    expect(
      (
        await call('evaluator-extra', 'POST', '/notes', {
          supplierId: BRIGHT,
          text: 'I should not be able to write this.',
        })
      ).statusCode,
    ).toBe(404);
    expect((await call('evaluator-comm', 'GET', `/notes?supplierId=${BRIGHT}`)).json() as Json[]).toEqual([]);
    // the author sees both, procurement only the shared one
    expect(
      ((await call('evaluator-tech', 'GET', `/notes?supplierId=${BRIGHT}`)).json() as Json[])
        .map((x) => x.visibility)
        .sort(),
    ).toEqual(['PRIVATE', 'TEAM']);
    const seen = (await call('procurement', 'GET', `/notes?supplierId=${BRIGHT}`)).json() as Json[];
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ visibility: 'TEAM', mine: false, by: 'Tomas Silva' });
    expect(
      JSON.stringify(
        await sys<Json[]>((tx) =>
          tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'note.create')),
        ),
      ),
    ).not.toContain('after-hours');
    // only the author can delete
    expect((await call('procurement', 'DELETE', `/notes/${n.json().id}`)).statusCode).toBe(404);
    expect((await call('evaluator-tech', 'DELETE', `/notes/${n.json().id}`)).statusCode).toBe(204);
    expect(
      (await call('evaluator-tech', 'POST', '/notes', { supplierId: BRIGHT, text: 'x' })).statusCode,
    ).toBe(400);
  });
});

describe('FR-0855 the audit, risk and compliance register', () => {
  it('records risks with a rating, findings and obligations, with actions, and the people who may use it', async () => {
    expect((await call('requester', 'GET', '/grc/items')).statusCode).toBe(403);
    expect((await call('admin', 'GET', '/grc/items')).statusCode).toBe(403);
    const noRating = await call('probity', 'POST', '/grc/items', {
      kind: 'RISK',
      title: 'Single supplier for cleaning',
    });
    expect(noRating.statusCode).toBe(422);
    const r = await call('probity', 'POST', '/grc/items', {
      kind: 'RISK',
      title: 'Single supplier for cleaning',
      likelihood: 4,
      impact: 4,
      dueOn: '2026-09-30',
      reviewOn: '2026-10-01',
    });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json()).toMatchObject({
      rating: 16,
      band: 'HIGH',
      status: 'OPEN',
      overdue: true,
      reviewDue: true,
    });
    const f = (
      await call('legal', 'POST', '/grc/items', {
        kind: 'AUDIT_FINDING',
        title: 'Approvals recorded without a comment',
      })
    ).json() as Json;
    expect(f).toMatchObject({ rating: null, band: null });
    // add an action: the item moves on, the owner is told
    const act = await call('probity', 'POST', `/grc/items/${r.json().id}/actions`, {
      text: 'Qualify a second supplier',
      ownerId: uid('user:procurement'),
      dueOn: '2026-12-01',
    });
    expect(act.statusCode).toBe(201);
    expect(act.json()).toMatchObject({ status: 'IN_PROGRESS' });
    expect(act.json().actions).toHaveLength(1);
    const actionId = act.json().actions[0].id as string;
    expect(
      JSON.stringify(
        await sys<Json[]>((tx) =>
          tx
            .select()
            .from(s.notification)
            .where(eq(s.notification.userId, uid('user:procurement'))),
        ),
      ),
    ).toContain('An action was assigned to you');
    const done = (
      await call('probity', 'POST', `/grc/items/${r.json().id}/actions/${actionId}/complete`)
    ).json() as Json;
    expect(done.actions[0].doneAt).not.toBeNull();
    // rating follows the likelihood and impact; accepting needs a reason; closing records when
    expect(
      (await call('probity', 'PATCH', `/grc/items/${r.json().id}`, { likelihood: 2 })).json(),
    ).toMatchObject({ rating: 8, band: 'MEDIUM' });
    const noReason = await call('probity', 'PATCH', `/grc/items/${r.json().id}`, { status: 'ACCEPTED' });
    expect(noReason.statusCode).toBe(422);
    expect(
      (
        await call('probity', 'PATCH', `/grc/items/${r.json().id}`, {
          status: 'ACCEPTED',
          treatment: 'Accepted by the executive while a second supplier is qualified',
        })
      ).json(),
    ).toMatchObject({ status: 'ACCEPTED', overdue: false });
    const closed = (
      await call('probity', 'PATCH', `/grc/items/${f.id}`, { status: 'CLOSED' })
    ).json() as Json;
    expect(closed.status).toBe('CLOSED');
    expect((await call('probity', 'PATCH', `/grc/items/${f.id}`, {})).statusCode).toBe(400);
    const sum = (await call('exec', 'GET', '/grc/summary')).json() as Json;
    expect(sum.heatmap.cells).toHaveLength(5);
    expect(sum.byKind.map((k: Json) => k.kind)).toEqual(['RISK', 'AUDIT_FINDING', 'OBLIGATION']);
    expect(
      (await call('exec', 'GET', '/grc/items?kind=RISK')).json().every((x: Json) => x.kind === 'RISK'),
    ).toBe(true);
    expect((await call('procurement', 'PATCH', `/grc/items/${f.id}`, { status: 'OPEN' })).statusCode).toBe(
      200,
    );
    expect((await call('contract-mgr', 'PATCH', `/grc/items/${f.id}`, { status: 'OPEN' })).statusCode).toBe(
      403,
    );
  });

  it('pulls in what the platform already knows once each, and closes what is no longer true', async () => {
    await sys((tx) =>
      tx.update(s.supplier).set({ sanctionsStatus: 'MATCH' }).where(eq(s.supplier.id, BRIGHT)),
    );
    expect((await call('procurement', 'POST', '/grc/sync')).statusCode).toBe(403);
    const first = (await call('probity', 'POST', '/grc/sync')).json() as Json;
    expect(first.created).toBeGreaterThanOrEqual(1);
    const second = (await call('probity', 'POST', '/grc/sync')).json() as Json;
    expect(second).toMatchObject({ created: 0, closed: 0 });
    const items = (await call('probity', 'GET', '/grc/items')).json() as Json[];
    const sanction = items.find((x) => x.source === 'PLATFORM' && /Sanctions screening match/.test(x.title))!;
    expect(sanction).toMatchObject({
      kind: 'RISK',
      rating: 20,
      band: 'HIGH',
      linkedType: 'supplier',
      linkedId: BRIGHT,
    });
    await sys((tx) =>
      tx.update(s.supplier).set({ sanctionsStatus: 'CLEAR' }).where(eq(s.supplier.id, BRIGHT)),
    );
    const after = (await call('probity', 'POST', '/grc/sync')).json() as Json;
    expect(after.closed).toBeGreaterThanOrEqual(1);
    expect(
      ((await call('probity', 'GET', '/grc/items')).json() as Json[]).find((x) => x.id === sanction.id),
    ).toMatchObject({ status: 'CLOSED' });
  });
});

describe('FR-0855 white labelling', () => {
  it('the name and colours come from the settings, are public (they are on the login page), and only a known palette is accepted', async () => {
    const before = await env.app.inject({ method: 'GET', url: '/api/v1/branding' });
    expect(before.json()).toEqual({
      productName: 'Intuitive Fusion',
      tagline: '',
      palette: 'INDIGO',
      supportEmail: '',
    });
    await setting('branding', {
      productName: 'Meridian Procure',
      tagline: 'Buying, made clear',
      palette: 'TEAL',
      supportEmail: 'help@meridian-demo.example',
    });
    expect((await env.app.inject({ method: 'GET', url: '/api/v1/branding' })).json()).toEqual({
      productName: 'Meridian Procure',
      tagline: 'Buying, made clear',
      palette: 'TEAL',
      supportEmail: 'help@meridian-demo.example',
    });
    const bad = await call('admin', 'PUT', '/admin/settings', {
      branding: { productName: 'X', tagline: '', palette: 'NEON', supportEmail: '' },
    });
    expect(bad.statusCode).toBe(400);
    expect(
      (
        await call('requester', 'PUT', '/admin/settings', {
          branding: { productName: 'Hijack', tagline: '', palette: 'INDIGO', supportEmail: '' },
        })
      ).statusCode,
    ).toBe(403);
    await setting('branding', {
      productName: 'Intuitive Fusion',
      tagline: '',
      palette: 'INDIGO',
      supportEmail: '',
    });
    expect(TENANT_ID).toBeTruthy();
  });
});

describe('Waiting for you: the action list behind the dashboard card', () => {
  it('lists what each role must act on, with links, and the card count matches the list', async () => {
    const del = (await call('delegate', 'GET', '/action-items')).json() as Json;
    const kpi = (await call('delegate', 'GET', '/dashboard/kpis')).json() as Json;
    expect(kpi.pendingMyAction).toBe(del.count);
    expect(del.items.every((i: Json) => i.link.startsWith('/app/') && i.title && i.detail)).toBe(true);
    // a requester's drafts, and only theirs
    const c = await call('requester', 'POST', '/requests', { title: 'Action item fixture' });
    const mine = (await call('requester', 'GET', '/action-items')).json() as Json;
    expect(mine.items.find((i: Json) => i.link === `/app/requests/${c.json().id}`)).toMatchObject({
      kind: 'Draft request',
    });
    const other = await env.extraUser('other-requester-2', 'REQUESTER');
    expect(((await call(other.email, 'GET', '/action-items')).json() as Json).count).toBe(0);
    expect((await call('supplier', 'GET', '/action-items')).statusCode).toBe(403);
  });
});

describe('FR-0810 awards are routed on ordinary authority, not on the international grant', () => {
  it('a delegate who holds both is the only one reached for a domestic value', async () => {
    const { routeApproval } = await import('../evaluation/b3-service.js');
    const r = await env.withSystem(env.database, (tx) => routeApproval(tx, TENANT_ID, 50_000));
    // the seed gives the international delegations to the same people; they must not widen or change the route
    const names = await env.withSystem(env.database, (tx) => tx.select().from(s.appUser));
    const routed = names.filter((u) => r.userIds.includes(u.id)).map((u) => u.name);
    expect(routed).toEqual(['Dana Okafor']);
  });
});
