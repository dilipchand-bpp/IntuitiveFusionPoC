/**
 * NFR-R05: ESG and socio-economic plan data with ceilings and ratios checked, on a real plan: limits and overrides, figures
 * from awards and declared ESG data, and the plan gate 'ESG ceilings'.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import * as s from '../../db/schema.js';
import { TENANT_ID } from '../../db/seed.js';
import { BRIGHT, createEnv, type Json } from '../contract/test-env.js';

let env: Awaited<ReturnType<typeof createEnv>>;
const call = (...a: Parameters<typeof env.call>) => env.call(...a);
const sys = <T>(fn: Parameters<typeof env.withSystem>[1]) => env.withSystem(env.database, fn) as Promise<T>;
beforeAll(async () => {
  env = await createEnv();
}, 120_000);

async function submittedRequest(value = 90_000): Promise<string> {
  const c = await call('requester', 'POST', '/requests', {
    title: `ESG plan ${value}`,
    category: 'Building cleaning (UNSPSC 76111500)',
    estimatedValue: value,
    termMonths: 24,
    businessUnit: 'Facilities',
    fields: { contractOwner: 'Sofia Rossi', background: 'Existing arrangements end in six months.' },
  });
  expect(c.statusCode, c.body).toBe(201);
  const id = c.json().id as string;
  expect((await call('requester', 'POST', `/requests/${id}/submit`)).statusCode).toBe(200);
  return id;
}
const openPlan = async (rid: string, who = 'procurement') =>
  (await call(who, 'GET', `/requests/${rid}/plan`)).json() as Json;
const targets = async (planId: string, who = 'procurement') => {
  const r = await call(who, 'GET', `/plans/${planId}/esg-targets`);
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as Json;
};
const metric = (t: Json, key: string) => (t.metrics as Json[]).find((m) => m.key === key)!;
const put = (planId: string, key: string, body: Json, who = 'procurement') =>
  call(who, 'PUT', `/plans/${planId}/esg-targets/${key}`, body);

describe('NFR-R05 the ESG limits: organisation defaults, plan values, bounds', () => {
  it('shows nine metrics with the organisation limit, no figures yet and no gate', async () => {
    const rid = await submittedRequest();
    const p = await openPlan(rid);
    const t = await targets(p.id);
    expect(t.metrics).toHaveLength(9);
    expect(t.valueBasis).toBe('ESTIMATE');
    expect(t.contractValue).toBe(90_000);
    expect(t.atRiskBandPct).toBe(10);
    expect(metric(t, 'INDIGENOUS_SPEND_PCT')).toMatchObject({
      kind: 'FLOOR',
      limit: 3,
      orgLimit: 3,
      source: 'DEFAULT',
      status: 'NO_DATA',
      value: null,
    });
    expect(metric(t, 'CARBON_INTENSITY_T_PER_M')).toMatchObject({ kind: 'CEILING', limit: 120 });
    expect(t.gate).toEqual({ status: null, breaches: 0 });
    expect(p.gates).toEqual([]); // no breach, so no ESG gate on the plan
  });

  it('a stricter plan value needs no reason; a looser one needs a reason and an approver note and stays inside the bounds', async () => {
    const rid = await submittedRequest();
    const p = await openPlan(rid);
    const stricter = await put(p.id, 'CARBON_INTENSITY_T_PER_M', { target: 100 });
    expect(stricter.statusCode, stricter.body).toBe(200);
    expect(metric(stricter.json(), 'CARBON_INTENSITY_T_PER_M')).toMatchObject({
      limit: 100,
      orgLimit: 120,
      source: 'PLAN',
    });
    const loose = await put(p.id, 'CARBON_INTENSITY_T_PER_M', { target: 150 });
    expect(loose.statusCode).toBe(422);
    expect(loose.json().code).toBe('ESG_OVERRIDE_NEEDS_REASON');
    expect(
      loose
        .json()
        .errors.map((e: Json) => e.field)
        .sort(),
    ).toEqual(['approverNote', 'overrideReason']);
    const half = await put(p.id, 'CARBON_INTENSITY_T_PER_M', {
      target: 150,
      overrideReason: 'Heavy plant is unavoidable on this site',
    });
    expect(half.statusCode).toBe(422);
    const ok = await put(p.id, 'CARBON_INTENSITY_T_PER_M', {
      target: 150,
      overrideReason: 'Heavy plant is unavoidable on this site',
      approverNote: 'Agreed by the Head of Procurement, 2 Oct',
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(metric(ok.json(), 'CARBON_INTENSITY_T_PER_M')).toMatchObject({
      limit: 150,
      orgLimit: 120,
      source: 'OVERRIDE',
      overrideReason: 'Heavy plant is unavoidable on this site',
      approverNote: 'Agreed by the Head of Procurement, 2 Oct',
    });
    // past the allowed relaxation (50 percent of 120 is 180) it is refused, reason or not
    const far = await put(p.id, 'CARBON_INTENSITY_T_PER_M', {
      target: 181,
      overrideReason: 'Heavy plant is unavoidable on this site',
      approverNote: 'Agreed by the Head of Procurement, 2 Oct',
    });
    expect(far.statusCode).toBe(422);
    expect(far.json().code).toBe('ESG_OVERRIDE_OUT_OF_BOUNDS');
    expect(far.json().title).toMatch(/180 at most/);
    // a target can be lowered inside its bound (3 percent down to 1.5), not below, and not outside 0 to 100
    expect(
      (
        await put(p.id, 'INDIGENOUS_SPEND_PCT', {
          target: 2,
          overrideReason: 'Few local suppliers in this region',
          approverNote: 'Agreed by the Head of Procurement',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await put(p.id, 'INDIGENOUS_SPEND_PCT', {
          target: 1,
          overrideReason: 'Few local suppliers in this region',
          approverNote: 'Agreed by the Head of Procurement',
        })
      ).json().code,
    ).toBe('ESG_OVERRIDE_OUT_OF_BOUNDS');
    expect((await put(p.id, 'LOCAL_CONTENT_PCT', { target: 101 })).statusCode).toBe(422);
    // back to the organisation default
    const reset = await put(p.id, 'CARBON_INTENSITY_T_PER_M', { resetTarget: true });
    expect(metric(reset.json(), 'CARBON_INTENSITY_T_PER_M')).toMatchObject({
      limit: 120,
      source: 'DEFAULT',
      overrideReason: null,
    });
    // validation and ownership
    expect((await put(p.id, 'CARBON_INTENSITY_T_PER_M', {})).statusCode).toBe(400);
    expect((await put(p.id, 'NOT_A_METRIC', { target: 1 })).statusCode).toBe(400);
    expect((await put(p.id, 'LOCAL_CONTENT_PCT', { forecast: 30 }, 'legal')).statusCode).toBe(403);
    expect((await put(p.id, 'LOCAL_CONTENT_PCT', { forecast: 30 }, 'requester')).statusCode).toBe(200); // the request owner
    // the audit log holds each change with old and new value
    const audit = await sys<Json[]>((tx) =>
      tx.select().from(s.auditEvent).where(eq(s.auditEvent.entityId, p.id)),
    );
    const updates = audit.filter((a) => a.action === 'plan.esg_target_update');
    expect(updates.length).toBeGreaterThanOrEqual(5);
    expect(JSON.stringify(updates.find((a) => (a.after as Json).source === 'OVERRIDE')!.after)).toContain(
      'Agreed by the Head of Procurement',
    );
  });

  it('follows the organisation setting for a plan that has not set its own limit', async () => {
    const rid = await submittedRequest();
    const p = await openPlan(rid);
    expect((await put(p.id, 'LOCAL_CONTENT_PCT', { forecast: 25 })).statusCode).toBe(200); // a row exists, still on the default
    const before = metric(await targets(p.id), 'LOCAL_CONTENT_PCT');
    expect(before).toMatchObject({ limit: 20, status: 'PASS' });
    const cfg = {
      atRiskBandPct: 10,
      maxRelaxationPct: 50,
      limits: {
        INDIGENOUS_SPEND_PCT: 3,
        SOCIAL_ENTERPRISE_SPEND_PCT: 2,
        DISABILITY_EMPLOYMENT_SPEND_PCT: 1,
        LOCAL_CONTENT_PCT: 30,
        SUPPLIER_DIVERSITY_PCT: 5,
        SME_PANEL_PCT: 30,
        CARBON_INTENSITY_T_PER_M: 120,
        MODERN_SLAVERY_RISK: 2,
        SINGLE_SUPPLIER_SHARE_PCT: 60,
      },
    };
    expect((await call('admin', 'PUT', '/admin/settings', { esgPlan: cfg })).statusCode).toBe(200);
    expect(metric(await targets(p.id), 'LOCAL_CONTENT_PCT')).toMatchObject({
      limit: 30,
      orgLimit: 30,
      status: 'BREACH',
    }); // 25 is under the 27 line
    cfg.limits.LOCAL_CONTENT_PCT = 20;
    expect((await call('admin', 'PUT', '/admin/settings', { esgPlan: cfg })).statusCode).toBe(200);
  });
});

describe('NFR-R05 PASS, AT RISK and BREACH on a plan, with the arithmetic', () => {
  it('judges a forecast against the target and says what it compared', async () => {
    const rid = await submittedRequest();
    const p = await openPlan(rid);
    const at = async (v: number) =>
      metric((await put(p.id, 'INDIGENOUS_SPEND_PCT', { forecast: v })).json(), 'INDIGENOUS_SPEND_PCT');
    expect(await at(3)).toMatchObject({
      status: 'PASS',
      valueSource: 'FORECAST',
      summary: 'Indigenous-owned spend 3% of contract value vs target 3%',
    });
    expect(await at(2.8)).toMatchObject({ status: 'AT_RISK', shortfall: 0.2 });
    const breach = await at(2);
    expect(breach).toMatchObject({ status: 'BREACH', shortfall: 1, value: 2 });
    expect(breach.summary).toBe('Indigenous-owned spend 2% of contract value vs target 3%');
    expect(breach.arithmetic).toMatch(/Forecast entered by the plan owner: 2%/);
    // a ceiling
    const carbon = metric(
      (await put(p.id, 'CARBON_INTENSITY_T_PER_M', { forecast: 130 })).json(),
      'CARBON_INTENSITY_T_PER_M',
    );
    expect(carbon).toMatchObject({
      status: 'BREACH',
      summary: 'Carbon intensity 130 t per $m vs ceiling 120 t per $m',
    });
    expect((await targets(p.id)).gate).toMatchObject({ status: 'REQUIRED', breaches: 2 });
  });

  it('works the figures out from the awarded contract and the supplier declared ESG data, with the sums', async () => {
    await sys((tx) =>
      tx
        .update(s.supplier)
        .set({
          onboarding: {
            esg: {
              diversityOwned: 'INDIGENOUS',
              carbonTonnesCo2e: 18,
              modernSlaveryStatement: true,
            },
          },
        })
        .where(eq(s.supplier.id, BRIGHT)),
    );
    const d = await env.draft({ value: 120_000 });
    const rid = (await sys<Json[]>((tx) => tx.select().from(s.contract).where(eq(s.contract.id, d.id))))[0]!
      .tenderId;
    const [td] = await sys<Json[]>((tx) => tx.select().from(s.tender).where(eq(s.tender.id, rid)));
    const p = await openPlan(td!.requestId);
    const t = await targets(p.id);
    expect(t.valueBasis).toBe('AWARDED');
    expect(t.contractValue).toBe(120_000);
    const ind = metric(t, 'INDIGENOUS_SPEND_PCT');
    expect(ind).toMatchObject({ status: 'PASS', value: 100, valueSource: 'ACTUAL' });
    expect(ind.arithmetic).toBe('Indigenous-owned spend $120,000 of $120,000 contract value = 100%');
    const carbon = metric(t, 'CARBON_INTENSITY_T_PER_M');
    expect(carbon.value).toBe(150); // 18 t over $0.12m
    expect(carbon).toMatchObject({ status: 'BREACH', valueSource: 'ACTUAL' });
    expect(carbon.arithmetic).toBe(
      'Reported emissions 18 t CO2e over $120,000 contract value = 150 t per $m',
    );
    expect(metric(t, 'MODERN_SLAVERY_RISK')).toMatchObject({ status: 'PASS', value: 1 });
    expect(metric(t, 'SINGLE_SUPPLIER_SHARE_PCT').actualArithmetic).toMatch(
      /Brightwave Cleaning Pty Ltd holds \$[\d,]+ of \$[\d,]+ contract spend = [\d.]+%/,
    );
    // an actual beats a forecast
    await put(p.id, 'CARBON_INTENSITY_T_PER_M', { forecast: 10 });
    expect(metric(await targets(p.id), 'CARBON_INTENSITY_T_PER_M')).toMatchObject({
      valueSource: 'ACTUAL',
      value: 150,
    });
    // the figure worked out is kept with the row
    const rows = await sys<Json[]>((tx) =>
      tx.select().from(s.planEsgTarget).where(eq(s.planEsgTarget.planId, p.id)),
    );
    expect(Number(rows.find((r) => r.metricKey === 'CARBON_INTENSITY_T_PER_M')!.actual)).toBe(150);
    // the gate is on the plan and holds it
    const view = await openPlan(td!.requestId);
    expect(view.gates.find((g: Json) => g.key === 'ESG_CEILINGS')).toMatchObject({
      status: 'REQUIRED',
      label: 'ESG ceilings',
    });
    await sys((tx) => tx.update(s.supplier).set({ onboarding: {} }).where(eq(s.supplier.id, BRIGHT)));
  });

  it('shows what the bidders declared and offers a starting forecast from the lowest-priced bid', async () => {
    await sys((tx) =>
      tx
        .update(s.supplier)
        .set({
          onboarding: {
            esg: { diversityOwned: 'SOCIAL_ENTERPRISE', carbonTonnesCo2e: 5, modernSlaveryResult: 'REVIEW' },
          },
        })
        .where(eq(s.supplier.id, BRIGHT)),
    );
    const a = await env.award({ value: 200_000 });
    const [sub] = await sys<Json[]>((tx) =>
      tx.select().from(s.submission).where(eq(s.submission.tenderId, a.tenderId)),
    );
    await sys((tx) =>
      tx.insert(s.bidPricing).values({
        tenantId: TENANT_ID,
        submissionId: sub!.id,
        basePrice: '190000',
        implementation: '10000',
        annualRunning: '0',
        years: 1,
        tco: '200000',
      }),
    );
    const p = await openPlan(a.requestId);
    const before = await targets(p.id);
    expect(before.bids).toHaveLength(1);
    expect(before.bids[0]).toMatchObject({
      company: 'Brightwave Cleaning Pty Ltd',
      tco: 200_000,
      declared: { diversityOwned: 'SOCIAL_ENTERPRISE', modernSlaveryRating: 3 },
    });
    expect(before.bidSuggestion.SOCIAL_ENTERPRISE_SPEND_PCT.value).toBe(100);
    expect(metric(before, 'SOCIAL_ENTERPRISE_SPEND_PCT').status).toBe('NO_DATA'); // a suggestion is not a figure until applied
    expect((await call('legal', 'POST', `/plans/${p.id}/esg-targets/apply-bids`)).statusCode).toBe(403);
    const applied = await call('procurement', 'POST', `/plans/${p.id}/esg-targets/apply-bids`);
    expect(applied.statusCode, applied.body).toBe(200);
    expect(metric(applied.json(), 'SOCIAL_ENTERPRISE_SPEND_PCT')).toMatchObject({
      valueSource: 'FORECAST',
      value: 100,
      status: 'PASS',
    });
    expect(metric(applied.json(), 'MODERN_SLAVERY_RISK')).toMatchObject({ value: 3, status: 'BREACH' });
    // no bids, nothing to apply
    const rid = await submittedRequest();
    const none = await call(
      'procurement',
      'POST',
      `/plans/${(await openPlan(rid)).id}/esg-targets/apply-bids`,
    );
    expect(none.statusCode).toBe(409);
    expect(none.json().code).toBe('NO_BIDS');
    await sys((tx) => tx.update(s.supplier).set({ onboarding: {} }).where(eq(s.supplier.id, BRIGHT)));
  });
});

describe("NFR-R05 the plan gate 'ESG ceilings'", () => {
  it('a breach holds the plan until procurement records an exception and the delegate acknowledges it', async () => {
    const rid = await submittedRequest(90_000);
    const p = await openPlan(rid);
    expect((await put(p.id, 'INDIGENOUS_SPEND_PCT', { forecast: 1 })).statusCode).toBe(200); // breach: 1 vs 3
    const gated = await openPlan(rid);
    expect(gated.gates).toHaveLength(1);
    expect(gated.gates[0]).toMatchObject({ key: 'ESG_CEILINGS', status: 'REQUIRED' });
    expect(gated.gates[0].reason).toMatch(/Indigenous-owned spend 1% of contract value vs target 3%/);

    // submitted, the plan waits at the sign-off stage instead of going to the delegate
    const sub = await call('procurement', 'POST', `/plans/${p.id}/submit-for-approval`);
    expect(sub.statusCode, sub.body).toBe(200);
    expect(sub.json().status).toBe('AWAITING_SIGNOFF');
    const early = await call('delegate', 'POST', `/plans/${p.id}/decision`, { decision: 'APPROVE' });
    expect(early.statusCode).toBe(409);
    expect(early.json().code).toBe('INVALID_STATE');

    // the exception: procurement only, with a reason, and only for a metric in breach
    expect(
      (
        await call('delegate', 'POST', `/plans/${p.id}/esg-targets/INDIGENOUS_SPEND_PCT/acknowledge`, {})
      ).json().code,
    ).toBe('NO_EXCEPTION');
    expect(
      (
        await call('delegate', 'POST', `/plans/${p.id}/esg-targets/INDIGENOUS_SPEND_PCT/exception`, {
          reason: 'We would like to go ahead',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call('procurement', 'POST', `/plans/${p.id}/esg-targets/INDIGENOUS_SPEND_PCT/exception`, {
          reason: 'short',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call('procurement', 'POST', `/plans/${p.id}/esg-targets/LOCAL_CONTENT_PCT/exception`, {
          reason: 'Nothing is wrong with this one',
        })
      ).json().code,
    ).toBe('NOT_IN_BREACH');
    const exc = await call(
      'procurement',
      'POST',
      `/plans/${p.id}/esg-targets/INDIGENOUS_SPEND_PCT/exception`,
      {
        reason: 'No Indigenous supplier operates in this region; a mentoring commitment is in the contract',
      },
    );
    expect(exc.statusCode, exc.body).toBe(200);
    expect(metric(exc.json(), 'INDIGENOUS_SPEND_PCT').exception).toMatchObject({
      state: 'RECORDED',
      acknowledgedBy: null,
    });
    expect((await openPlan(rid)).status).toBe('AWAITING_SIGNOFF'); // recorded is not enough
    expect((await openPlan(rid)).gates[0].status).toBe('REQUIRED');
    // the delegate is told, can acknowledge, and nobody else can
    const notes = await sys<Json[]>((tx) =>
      tx.select().from(s.notification).where(eq(s.notification.title, 'ESG exception to acknowledge')),
    );
    expect(notes.length).toBeGreaterThan(0);
    expect(
      (await call('procurement', 'POST', `/plans/${p.id}/esg-targets/INDIGENOUS_SPEND_PCT/acknowledge`, {}))
        .statusCode,
    ).toBe(403);
    const ack = await call(
      'delegate',
      'POST',
      `/plans/${p.id}/esg-targets/INDIGENOUS_SPEND_PCT/acknowledge`,
      {},
    );
    expect(ack.statusCode, ack.body).toBe(200);
    expect(metric(ack.json(), 'INDIGENOUS_SPEND_PCT').exception.state).toBe('ACKNOWLEDGED');
    expect(
      (
        await call('delegate', 'POST', `/plans/${p.id}/esg-targets/INDIGENOUS_SPEND_PCT/acknowledge`, {})
      ).json().code,
    ).toBe('ALREADY_ACKNOWLEDGED');
    const moved = await openPlan(rid);
    expect(moved.status).toBe('AWAITING_APPROVAL');
    expect(moved.gates[0]).toMatchObject({ key: 'ESG_CEILINGS', status: 'SATISFIED' });
    expect(moved.gates[0].reason).toMatch(/accepted by exception and acknowledged/);
    const done = await call('delegate', 'POST', `/plans/${p.id}/decision`, {
      decision: 'APPROVE',
      comment: 'Exception accepted',
    });
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json()).toMatchObject({ status: 'APPROVED_LOCKED', locked: true });
    // everything is in the audit log
    const audit = await sys<Json[]>((tx) =>
      tx.select().from(s.auditEvent).where(eq(s.auditEvent.entityId, p.id)),
    );
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['plan.esg_exception', 'plan.esg_exception_ack', 'plan.approve']),
    );
  });

  it('changing the figures withdraws an exception that was granted for the old ones', async () => {
    const rid = await submittedRequest(90_000);
    const p = await openPlan(rid);
    await put(p.id, 'LOCAL_CONTENT_PCT', { forecast: 5 }); // breach: 5 vs 20
    await call('procurement', 'POST', `/plans/${p.id}/esg-targets/LOCAL_CONTENT_PCT/exception`, {
      reason: 'Remote site with a small local workforce',
    });
    const ack = await call(
      'delegate',
      'POST',
      `/plans/${p.id}/esg-targets/LOCAL_CONTENT_PCT/acknowledge`,
      {},
    );
    expect(metric(ack.json(), 'LOCAL_CONTENT_PCT').exception.state).toBe('ACKNOWLEDGED');
    expect((await openPlan(rid)).gates[0].status).toBe('SATISFIED');
    const worse = await put(p.id, 'LOCAL_CONTENT_PCT', { forecast: 3 });
    expect(metric(worse.json(), 'LOCAL_CONTENT_PCT').exception.state).toBe('NONE');
    expect((await openPlan(rid)).gates[0].status).toBe('REQUIRED');
    // fixing the figure removes the gate altogether
    await put(p.id, 'LOCAL_CONTENT_PCT', { forecast: 40 });
    expect((await openPlan(rid)).gates).toEqual([]);
  });

  it('a breach found after the plan reached the delegate still blocks approval (409 ESG_CEILINGS_BREACHED)', async () => {
    const rid = await submittedRequest(90_000);
    const p = await openPlan(rid);
    expect((await call('procurement', 'POST', `/plans/${p.id}/submit-for-approval`)).json().status).toBe(
      'AWAITING_APPROVAL',
    );
    await put(p.id, 'SME_PANEL_PCT', { forecast: 10 }); // 10 vs 30: breach
    const refused = await call('delegate', 'POST', `/plans/${p.id}/decision`, { decision: 'APPROVE' });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe('ESG_CEILINGS_BREACHED');
    expect(refused.json().title).toMatch(
      /Small and medium suppliers on the panel 10% of the panel vs target 30%/,
    );
    // an AT RISK result does not block
    await put(p.id, 'SME_PANEL_PCT', { forecast: 28 });
    expect(
      (await call('delegate', 'POST', `/plans/${p.id}/decision`, { decision: 'APPROVE' })).statusCode,
    ).toBe(200);
  });

  it('is visible to the roles that read plans, and a requester sees only their own', async () => {
    const rid = await submittedRequest();
    const p = await openPlan(rid);
    for (const who of ['requester', 'procurement', 'delegate', 'legal', 'probity', 'exec', 'finance'])
      expect((await call(who, 'GET', `/plans/${p.id}/esg-targets`)).statusCode, who).toBe(200);
    for (const who of ['admin', 'evaluator-tech', 'contract-mgr', 'supplier'])
      expect((await call(who, 'GET', `/plans/${p.id}/esg-targets`)).statusCode, who).toBe(403);
    const mine = await env.extraUser('other-requester', 'REQUESTER');
    expect((await call(mine.email, 'GET', `/plans/${p.id}/esg-targets`)).statusCode).toBe(404);
  });
});
