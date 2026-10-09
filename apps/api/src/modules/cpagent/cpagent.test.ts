import { and, eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { withContext, withSystem } from '../../db/client.js';
import * as s from '../../db/schema.js';
import { TENANT_ID, uid } from '../../db/seed.js';
import { createEnv, type Json } from '../contract/test-env.js';
import { loadSpec } from '../../spec-routes.js';
import { AGENTS } from './agents.js';
import { parseRequestText } from './parse.js';
import { stageOf } from './stages.js';
import { ToolClient } from './tools.js';

let env: Awaited<ReturnType<typeof createEnv>>;
const call = (...a: Parameters<typeof env.call>) => env.call(...a);
beforeAll(async () => {
  env = await createEnv();
}, 120_000);

const TEXT =
  'We need commercial cleaning services for our head office, about $90,000 over 24 months, business unit Facilities.';
const start = async (who: string, body: Json) => {
  const r = await call(who, 'POST', '/copilot/runs', body);
  expect(r.statusCode, r.body).toBe(201);
  return r.json() as Json;
};
const view = async (who: string, id: string) =>
  (await call(who, 'GET', `/copilot/runs/${id}`)).json() as Json;
const advance = async (who: string, id: string) => {
  const r = await call(who, 'POST', `/copilot/runs/${id}/advance`);
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as Json;
};
const open = (v: Json) => (v.gates as Json[]).filter((g) => g.status === 'OPEN');
const actions = async (who: string) =>
  ((await call(who, 'GET', '/action-items')).json() as Json).items as Json[];

describe('request text rules (CP-01)', () => {
  it('CP-01 reads value, term, category and title with fixed rules and never invents a value', () => {
    const p = parseRequestText('Run an RFx for facilities cleaning, three-year term, about $1.2M');
    expect(p).toMatchObject({ estimatedValue: 1_200_000, termMonths: 36 });
    expect(p.category).toMatch(/cleaning/i);
    expect(parseRequestText('We need some stationery for 5 years').estimatedValue).toBeNull();
    expect(parseRequestText('Laptops for the team, budget 450k, 18 months')).toMatchObject({
      estimatedValue: 450_000,
      termMonths: 18,
    });
  });
  it('CP-03 the stage comes from the state alone', () => {
    const base = {
      now: new Date(),
      request: null,
      plan: null,
      tender: null,
      evaluation: null,
      contract: null,
      fingerprint: '',
    };
    expect(stageOf(base)).toBe('REQUEST');
    expect(
      stageOf({ ...base, request: { status: 'SUBMITTED' } as never, plan: { locked: false } as never }),
    ).toBe('PLAN');
  });
});

describe('tool adapter and registry (CP-06)', () => {
  it('CP-06 six specialists, each with its own tools and a list of what it may not do', async () => {
    expect(AGENTS.map((a) => a.key)).toEqual([
      'ORCHESTRATOR',
      'INTAKE',
      'COMPLIANCE',
      'WORKFLOW',
      'DOCFILL',
      'CONTRACT_DATA',
    ]);
    for (const a of AGENTS) expect(a.mayNot.length).toBeGreaterThan(0);
    const r = await call('requester', 'GET', '/copilot/agents');
    expect(r.statusCode).toBe(200);
    expect(r.json().simulated).toBe(true);
    expect(r.json().agents).toHaveLength(6);
  });
  it('CP-06 the roles shown for a tool match the OpenAPI contract of the route it calls', () => {
    const spec = loadSpec();
    const bad: string[] = [];
    for (const a of AGENTS)
      for (const t of a.tools) {
        if (t.method === 'LOCAL' || t.optionalCapability || t.roles === 'any') continue;
        const path = t.path.replace(/:(\w+)/g, '{$1}');
        const op = (spec.paths as Json)[path]?.[t.method.toLowerCase()];
        if (!op) continue;
        const x = op['x-roles'];
        if (Array.isArray(x))
          for (const r of t.roles)
            if (!x.includes(r)) bad.push(`${a.key}.${t.name}: ${r} not allowed by ${t.method} ${path}`);
      }
    expect(bad).toEqual([]);
  });
  it('CP-06 a call outside the calling agent tool list is refused; a missing drafting or OCR route is "capability not available"', async () => {
    const fake = {
      inject: async () => ({
        statusCode: 404,
        body: JSON.stringify({ code: 'NOT_FOUND', title: 'Not found' }),
      }),
    };
    const d = {
      sessions: {
        createFor: async () => ({ id: 's', cookieValue: 'c', csrf: 'x' }),
        revoke: async () => undefined,
      },
      audit: { recordOutsideTx: async () => 1 },
      database: {},
    };
    const t = new ToolClient(fake as never, d as never, {
      tenantId: 't',
      userId: 'u',
      role: 'PROCUREMENT',
      runId: 'r',
    });
    const r = await t.call('INTAKE', 'draft_request', { body: {}, stepKey: 'k' });
    expect(r.notAvailable).toBe(true);
    const g = await t.call('INTAKE', 'get_request', { params: { id: 'x' }, stepKey: 'k' });
    expect(g.notAvailable).toBe(false);
    await expect(t.call('COMPLIANCE', 'submit_request', { stepKey: 'k' })).rejects.toThrow(/no tool/);
  });
});

describe('role limits (CP-01, principle 1 and 2)', () => {
  it('CP-01 a person who cannot raise requests cannot start a run from text; a requester run stops where the requester role ends and never approves', async () => {
    const no = await call('delegate', 'POST', '/copilot/runs', { text: TEXT });
    expect(no.statusCode).toBe(403);
    const v = await start('requester', { text: TEXT });
    expect(v.run.status).toBe('WAITING_GATE');
    const gates = open(v);
    expect(gates).toHaveLength(1);
    expect(gates[0]!.kind).toBe('PLAN_SUBMIT');
    expect(gates[0]!.roles).toContain('PROCUREMENT');
    // nothing was approved by or for the agent
    const planRows = await withSystem(env.database, (tx) =>
      tx.select().from(s.plan).where(eq(s.plan.requestId, v.run.requestId)),
    );
    expect(planRows[0]!.status).toBe('DRAFT');
    const ap = await withSystem(env.database, (tx) =>
      tx.select().from(s.approval).where(eq(s.approval.subjectId, planRows[0]!.id)),
    );
    expect(ap).toHaveLength(0);
    // the procurement officer is told, through the normal action list
    expect(
      (await actions('procurement')).some(
        (i) => i.kind === 'Copilot is waiting' || i.link === `/app/plans/${v.run.requestId}`,
      ),
    ).toBe(true);
  });
  it('CP-01 a delegate who owns a run still gets a gate for the approval: the agent never approves, even when its user could', async () => {
    const p = await start('procurement', { text: TEXT });
    expect(open(p)[0]!.kind).toBe('PLAN_APPROVAL');
    const d = await start('delegate', { text: 'Follow this procurement', procurementId: p.run.requestId });
    expect(d.run.status).toBe('WAITING_GATE');
    expect(open(d)[0]!.kind).toBe('PLAN_APPROVAL');
    const planRows = await withSystem(env.database, (tx) =>
      tx.select().from(s.plan).where(eq(s.plan.requestId, p.run.requestId)),
    );
    expect(planRows[0]!.status).toBe('AWAITING_APPROVAL');
  });
  it('CP-01 every change the agent makes is audited as the user with the actor label "Procurement Copilot"', async () => {
    const v = await start('procurement', { text: TEXT });
    const rows = await withSystem(env.database, (tx) =>
      tx
        .select()
        .from(s.auditEvent)
        .where(and(eq(s.auditEvent.entityType, 'cp_run'), eq(s.auditEvent.entityId, v.run.id))),
    );
    expect(rows.length).toBeGreaterThan(3);
    for (const r of rows) {
      expect(r.actorId).toBe(uid('user:procurement'));
      expect((r.after as Json).actorLabel).toBe('Procurement Copilot');
    }
    const routeAudit = await withSystem(env.database, (tx) =>
      tx
        .select()
        .from(s.auditEvent)
        .where(sql`${s.auditEvent.correlationId} like ${`copilot:${v.run.id}:%`}`),
    );
    expect(routeAudit.some((r) => r.action === 'request.submit')).toBe(true);
  });
});

describe('self-repair (CP-02)', () => {
  it('CP-02 an unrepairable gap goes to a named person with what was tried (at most 3 attempts), and the run resumes once the person fixes it', async () => {
    // a draft that has no value and whose text gives none (made by hand, so the test does not depend on the drafting module)
    const draft = await call('procurement', 'POST', '/requests', {
      title: 'Stationery for the office',
      category: 'Office supplies',
    });
    expect(draft.statusCode).toBe(201);
    const v = await start('procurement', {
      text: 'We need some stationery for the office.',
      procurementId: draft.json().id,
    });
    expect(v.run.status).toBe('NEEDS_HUMAN');
    const prob = (v.problems as Json[]).find((p) => p.status === 'ESCALATED')!;
    expect(prob.attemptCount).toBeLessThanOrEqual(3);
    expect(prob.attemptCount).toBeGreaterThan(0);
    const g = open(v)[0]!;
    expect(g.kind).toBe('NEEDS_HUMAN');
    expect(g.reason).toMatch(/What the Copilot tried/);
    expect(g.names).toContain('Priya Nair');
    const items = await actions('procurement');
    expect(items.some((i) => i.kind === 'Copilot needs you')).toBe(true);
    // a tick without a change does nothing more (no new attempts)
    const steps = (v.steps as Json[]).length;
    await env.app.copilotEngine.tick(v.run.id, { source: 'timer' });
    expect(((await view('procurement', v.run.id)).steps as Json[]).length).toBe(steps);
    // the person supplies the value; the run moves on by itself
    expect(
      (await call('procurement', 'PATCH', `/requests/${v.run.requestId}`, { estimatedValue: 40000 }))
        .statusCode,
    ).toBe(200);
    await env.app.copilotEngine.tick(v.run.id, { source: 'timer' });
    const after = await view('procurement', v.run.id);
    expect(after.run.status).toBe('WAITING_GATE');
    expect(open(after)[0]!.kind).toBe('PLAN_APPROVAL');
    expect((after.problems as Json[]).find((p) => p.id === prob.id)!.status).toBe('RESOLVED');
  });
  it('CP-02 a missing contract owner is repaired from the profile, in order, and the repair is shown', async () => {
    const v = await start('procurement', { text: TEXT });
    const p = (v.problems as Json[]).find((x) => x.status === 'REPAIRED')!;
    expect(p.attempts[p.attempts.length - 1]).toMatchObject({
      repair: 'FILL_FROM_PROFILE',
      outcome: 'FIXED',
    });
    const r = await call('procurement', 'GET', `/copilot/runs/${v.run.id}/problems`);
    expect(r.json().maxAttempts).toBe(3);
  });
  it('CP-02 a tender with no bids is handed to procurement, not retried', async () => {
    const ids = await withSystem(env.database, async (tx) => {
      const [req] = await tx
        .insert(s.request)
        .values({
          tenantId: TENANT_ID,
          number: 'PR-CP-0001',
          title: 'No bids fixture',
          estimatedValue: '50000',
          termMonths: 12,
          requesterId: uid('user:requester'),
          phase: 'TENDER',
          status: 'IN_PROGRESS',
        })
        .returning();
      await tx
        .insert(s.plan)
        .values({ tenantId: TENANT_ID, requestId: req!.id, status: 'APPROVED_LOCKED', locked: true });
      await tx.insert(s.tender).values({
        tenantId: TENANT_ID,
        requestId: req!.id,
        type: 'RFP',
        status: 'CLOSED',
        closesAt: new Date('2026-09-01T00:00:00Z'),
      });
      return req!.id;
    });
    const v = await start('procurement', { text: 'Carry on with this procurement', procurementId: ids });
    expect(v.run.status).toBe('NEEDS_HUMAN');
    expect(open(v)[0]!.title).toMatch(/No bids/);
  });
});

describe('controls and live feed (CP-03)', () => {
  it('CP-03 events come after a cursor; pause, resume and cancel work and only for the run owner', async () => {
    const v = await start('procurement', { text: TEXT });
    const ev = (await call('procurement', 'GET', `/copilot/runs/${v.run.id}/events?after=0`)).json();
    expect(ev.events.length).toBeGreaterThan(5);
    const again = (
      await call('procurement', 'GET', `/copilot/runs/${v.run.id}/events?after=${ev.cursor}`)
    ).json();
    expect(again.events).toEqual([]);
    expect(v.stages.find((x: Json) => x.state === 'CURRENT').key).toBe('PLAN');
    expect(v.steps.every((x: Json) => x.reason && x.rule && x.actor === 'Procurement Copilot')).toBe(true);
    expect((await call('requester', 'POST', `/copilot/runs/${v.run.id}/pause`)).statusCode).toBe(404);
    expect((await call('admin', 'POST', `/copilot/runs/${v.run.id}/pause`)).json().run.status).toBe('PAUSED');
    expect((await call('procurement', 'POST', `/copilot/runs/${v.run.id}/advance`)).statusCode).toBe(409);
    expect((await call('procurement', 'POST', `/copilot/runs/${v.run.id}/resume`)).json().run.status).toBe(
      'WAITING_GATE',
    );
    const c = await call('procurement', 'POST', `/copilot/runs/${v.run.id}/cancel`);
    expect(c.json().run.status).toBe('CANCELLED');
    expect(open(c.json())).toHaveLength(0);
    const sum = (await call('procurement', 'GET', '/copilot/summary')).json();
    expect(sum.total).toBeGreaterThan(0);
    expect(sum.simulated).toBe(true);
  });
  it('CP-03 ticks are idempotent: repeating a tick and two at once add no step, gate or duplicate', async () => {
    const v = await start('procurement', { text: TEXT });
    const before = { steps: v.steps.length, gates: v.gates.length };
    await Promise.all([advance('procurement', v.run.id), advance('procurement', v.run.id)]);
    await env.app.copilotEngine.tick(v.run.id, { source: 'timer' });
    const after = await view('procurement', v.run.id);
    expect({ steps: after.steps.length, gates: after.gates.length }).toEqual(before);
    expect(new Set(after.steps.map((x: Json) => `${x.key}#${x.attempt}`)).size).toBe(after.steps.length);
  });
  it('CP-03 the timer moves a run on by itself when a person has acted', async () => {
    const v = await start('procurement', { text: TEXT });
    const plan = (await call('procurement', 'GET', `/requests/${v.run.requestId}/plan`)).json();
    expect(
      (await call('delegate', 'POST', `/plans/${plan.id}/decision`, { decision: 'APPROVE' })).statusCode,
    ).toBe(200);
    expect(await env.app.copilotEngine.tickDue()).toBeGreaterThan(0);
    const after = await view('procurement', v.run.id);
    expect(open(after)[0]!.kind).toBe('TENDER_PUBLISH_PERMISSION');
  });
});

describe('isolation (tenants and row level security)', () => {
  it('CP-01 another organisation sees nothing of a run, by route or by the database', async () => {
    const v = await start('procurement', { text: TEXT });
    const other = await withSystem(env.database, async (tx) => {
      const [t] = await tx
        .insert(s.tenant)
        .values({ slug: 'other-org', name: 'Other Org', sector: 'PRIVATE' })
        .returning();
      const [u] = await tx
        .insert(s.appUser)
        .values({ tenantId: t!.id, email: 'x@other.example', name: 'Other', passwordHash: 'x' })
        .returning();
      await tx.insert(s.cpRun).values({
        tenantId: t!.id,
        userId: u!.id,
        userName: 'Other',
        userRole: 'PROCUREMENT',
        title: 'Theirs',
        sourceText: 'x',
        mode: 'FULL',
        status: 'RUNNING',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      return { tenant: t!.id, user: u!.id };
    });
    const mine = await withContext(
      env.database,
      { tenantId: TENANT_ID, userId: uid('user:procurement'), role: 'PROCUREMENT' },
      (tx) => tx.select().from(s.cpRun),
    );
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => r.tenantId === TENANT_ID)).toBe(true);
    const theirs = await withContext(
      env.database,
      { tenantId: other.tenant, userId: other.user, role: 'PROCUREMENT' },
      (tx) => tx.select().from(s.cpRun),
    );
    expect(theirs.map((r) => r.title)).toEqual(['Theirs']);
    await expect(
      withContext(env.database, { tenantId: other.tenant, userId: other.user, role: 'PROCUREMENT' }, (tx) =>
        tx.insert(s.cpRun).values({
          tenantId: TENANT_ID,
          userId: other.user,
          userName: 'x',
          userRole: 'PROCUREMENT',
          title: 'x',
          sourceText: 'x',
          mode: 'FULL',
          status: 'RUNNING',
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ),
    ).rejects.toThrow();
    const none = await env.database.db.transaction(async (tx) => {
      await tx.execute(sql`set local role app_user`);
      return tx.select().from(s.cpRun);
    });
    expect(none).toEqual([]);
    // a run is its owner's: another requester gets a 404, a manager can read it
    expect((await call('requester', 'GET', `/copilot/runs/${v.run.id}`)).statusCode).toBe(404);
    expect((await call('exec', 'GET', `/copilot/runs/${v.run.id}`)).statusCode).toBe(200);
  });
});

describe('the whole procurement, with people at the gates (CP-01, CP-02, CP-03, CP-06)', () => {
  it('CP-01 CP-02 CP-03 CP-06 a run from short text reaches an executed contract; people act only at gates', async () => {
    const v0 = await start('procurement', { text: TEXT });
    const id = v0.run.id as string;
    const reqId = v0.run.requestId as string;
    // request done, plan prepared, stopped at the plan approval with an action item for the delegate
    expect(v0.run.status).toBe('WAITING_GATE');
    expect(open(v0)[0]!).toMatchObject({ kind: 'PLAN_APPROVAL' });
    expect((await actions('delegate')).some((i) => i.link === `/app/plans/${reqId}`)).toBe(true);
    const kpiBefore = (await call('delegate', 'GET', '/dashboard/kpis')).json().pendingMyAction;
    expect(kpiBefore).toBeGreaterThan(0);
    expect(v0.handoffs.length).toBeGreaterThan(1);
    expect(v0.agents.filter((a: Json) => a.steps > 0).length).toBeGreaterThan(2);

    const plan = (await call('procurement', 'GET', `/requests/${reqId}/plan`)).json();
    expect(
      (await call('delegate', 'POST', `/plans/${plan.id}/decision`, { decision: 'APPROVE' })).statusCode,
    ).toBe(200);
    let v = await advance('procurement', id);
    expect(open(v)[0]!.kind).toBe('TENDER_PUBLISH_PERMISSION');
    const tender = (await call('procurement', 'GET', '/tenders'))
      .json()
      .find((t: Json) => t.requestId === reqId);
    expect((await call('delegate', 'POST', `/tenders/${tender.id}/publish-permission`, {})).statusCode).toBe(
      200,
    );
    v = await advance('procurement', id);
    // a statutory window check refused the first closing time; the compliance repair moved it out
    const win = (v.problems as Json[]).find((p) => p.code === 'STATUTORY_WINDOW')!;
    expect(win.status).toBe('REPAIRED');
    expect(v.run.status).toBe('RUNNING');
    expect(v.handoffs.some((h: Json) => h.to === 'COMPLIANCE')).toBe(true);
    // suppliers are never simulated by the agent itself
    expect(
      (await call('procurement', 'GET', '/tenders')).json().find((t: Json) => t.requestId === reqId).bids,
    ).toBe(0);
    const sim = await call('procurement', 'POST', `/copilot/runs/${id}/simulate-suppliers`);
    expect(sim.statusCode, sim.body).toBe(200);
    expect(sim.json().result.label).toBe('SIMULATED');
    expect(sim.json().result.bids[0].outcome).toBe('SUBMITTED');
    expect((await call('requester', 'POST', `/copilot/runs/${id}/simulate-suppliers`)).statusCode).toBe(404);

    // demonstration button: bring the closing time forward (CP-01); only the run's owner, once there is a bid, never in production
    expect((await call('requester', 'POST', `/copilot/runs/${id}/simulate-close`)).statusCode).toBe(404);
    const close = await call('procurement', 'POST', `/copilot/runs/${id}/simulate-close`);
    expect(close.statusCode, close.body).toBe(200);
    expect(close.json().result.label).toBe('SIMULATED');
    expect((await call('procurement', 'POST', `/copilot/runs/${id}/simulate-close`)).json().code).toBe(
      'TENDER_NOT_OPEN',
    );
    v = await advance('procurement', id);
    expect(v.run.stage).toBe('EVALUATION');
    expect(open(v)[0]!.kind).toBe('PANEL_COI');
    const ev = (await call('procurement', 'GET', '/evaluations'))
      .json()
      .evaluations.find((e: Json) => e.requestNumber === v.procurement.number);
    for (const k of ['evaluator-tech', 'evaluator-comm', 'chair'])
      expect((await call(k, 'POST', `/evaluations/${ev.id}/coi`, { none: true })).statusCode).toBe(201);
    v = await advance('procurement', id);
    expect(open(v)[0]!.kind).toBe('PANEL_SCORING');
    for (const key of ['evaluator-tech', 'evaluator-comm', 'chair']) {
      const mine = (await call(key, 'GET', `/evaluations/${ev.id}/scores/mine`)).json();
      for (const sup of mine.suppliers)
        expect(
          (
            await call(key, 'PUT', `/evaluations/${ev.id}/scores`, {
              supplierId: sup.supplierId,
              scores: mine.criteria.map((c: Json) => ({ criterionId: c.id, score: c.passFail ? 10 : 8 })),
            })
          ).statusCode,
        ).toBe(200);
      expect((await call(key, 'POST', `/evaluations/${ev.id}/scores/submit`)).statusCode).toBe(200);
    }
    v = await advance('procurement', id);
    expect(open(v)[0]!.kind).toBe('CHAIR_OPEN_CONSENSUS');
    const co = (await call('chair', 'POST', `/evaluations/${ev.id}/consensus/open`)).json();
    for (const sup of co.suppliers)
      await call('chair', 'PUT', `/evaluations/${ev.id}/consensus/${sup.supplierId}`, {
        items: co.criteria.map((c: Json) => ({ criterionId: c.id, consensusScore: 8 })),
      });
    expect((await call('chair', 'POST', `/evaluations/${ev.id}/consensus/lock`)).statusCode).toBe(200);
    v = await advance('procurement', id);
    expect(v.run.stage).toBe('AWARD');
    expect(open(v)[0]!.kind).toBe('AWARD_APPROVAL');
    const evv = (await call('procurement', 'GET', `/evaluations/${ev.id}`)).json();
    expect(
      (
        await call('delegate', 'POST', `/evaluation-reports/${evv.report.id}/decision`, {
          decision: 'APPROVE',
        })
      ).statusCode,
    ).toBe(200);
    v = await advance('procurement', id);
    expect(open(v)[0]!.kind).toBe('CONTRACT_LEGAL_REVIEW');
    expect((await actions('legal')).some((i) => i.title.includes('Legal review'))).toBe(true);
    const c = (await call('legal', 'GET', '/contracts'))
      .json()
      .find((x: Json) => x.requestNumber === v.procurement.number);
    expect((await call('legal', 'POST', `/contracts/${c.id}/release-for-signing`)).statusCode).toBe(200);
    v = await advance('procurement', id);
    expect(open(v)[0]!.kind).toBe('CONTRACT_SIGN');
    expect(
      (await call('delegate', 'POST', `/contracts/${c.id}/sign`, { decision: 'APPROVE' })).statusCode,
    ).toBe(200);
    v = await advance('procurement', id);
    expect(v.run.status).toBe('COMPLETED');
    expect(v.stages.every((x: Json) => x.state === 'DONE')).toBe(true);
    expect(v.steps.some((x: Json) => x.agent === 'CONTRACT_DATA')).toBe(true);
    expect(open(v)).toHaveLength(0);
    // every gate the agent raised was for a person, and the agent approved nothing itself
    const approvals = await withSystem(env.database, (tx) =>
      tx
        .select()
        .from(s.approval)
        .where(sql`${s.approval.userId} = ${uid('user:procurement')}`),
    );
    expect(approvals).toHaveLength(0);
  }, 240_000);
});
