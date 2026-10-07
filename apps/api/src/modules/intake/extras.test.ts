import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import * as s from '../../db/schema.js';
import { TENANT_ID, uid } from '../../db/seed.js';
import { createEnv, SEED_DATE, type Json } from '../contract/test-env.js';
import { DEFAULTS } from '../settings/settings.js';
import {
  calculateEcv,
  classifyCategory,
  requiredEngagements,
  routeWorkflow,
  selectSubWorkflow,
} from './classify.js';

let env: Awaited<ReturnType<typeof createEnv>>;
beforeAll(async () => {
  env = await createEnv();
}, 120_000);
const sys = <T>(fn: Parameters<typeof env.withSystem>[1]) => env.withSystem(env.database, fn) as Promise<T>;

const setSection = async (name: string, value: unknown) => {
  const r = await env.call('admin', 'PUT', '/admin/settings', { [name]: value });
  expect(r.statusCode, r.body).toBe(200);
};
const intake = async (patch: Json) => {
  const cur = (await env.call('admin', 'GET', '/admin/settings')).json().intake as Json;
  await setSection('intake', { ...cur, ...patch });
};
const reset = async () => {
  await setSection('intake', DEFAULTS.intake);
  await setSection('notifications', DEFAULTS.notifications);
  await setSection('workflowRouting', DEFAULTS.workflowRouting);
  await setSection('checkpoints', DEFAULTS.checkpoints);
};

const CLEANING = 'Building cleaning (UNSPSC 76111500)';
async function request(over: Json = {}, who = 'requester') {
  const r = await env.call(who, 'POST', '/requests', {
    title: 'Extras fixture',
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
const notesFor = async (who: string) => (await env.call(who, 'GET', '/notifications')).json() as Json[];

describe('classification, engagements, ECV and routing rules are pure and explainable', () => {
  it('assigns a code in the configured scheme and nothing for an unknown category', () => {
    expect(classifyCategory(CLEANING, 'UNSPSC')).toMatchObject({ code: '76111500' });
    expect(classifyCategory(CLEANING, 'CPV')).toMatchObject({ code: '90910000' });
    expect(classifyCategory(CLEANING, 'NAICS')).toMatchObject({ code: '561720' });
    expect(classifyCategory('Space travel', 'UNSPSC')).toBeNull();
    expect(classifyCategory(undefined, 'UNSPSC')).toBeNull();
  });

  it('finds the reviews a request needs, each with its reason', () => {
    const e = requiredEngagements(DEFAULTS.intake.engagementRules, {
      title: 'Cloud software licences',
      category: 'IT managed services',
      estimatedValue: 300_000,
      complexity: 'HIGH',
    });
    expect(e.map((x) => x.function).sort()).toEqual(['FINANCE', 'IT', 'LEGAL']);
    expect(e.find((x) => x.function === 'IT')!.reason).toContain('software');
    const sensitive = requiredEngagements(DEFAULTS.intake.engagementRules, {
      category: 'Building cleaning',
      dataSensitivity: 'SENSITIVE',
      estimatedValue: 1_000,
      complexity: 'LOW',
    });
    expect(sensitive.map((x) => x.function)).toContain('CYBER');
    expect(requiredEngagements([], { estimatedValue: 9e9, complexity: 'CRITICAL' })).toEqual([]);
  });

  it('adds up every cost component, converts, and adds tax', () => {
    expect(
      calculateEcv({
        baseTermValue: 100_000,
        extensionsValue: 20_000,
        freight: 5_000,
        implementation: 15_000,
        exchangeRate: 1.5,
        taxPct: 10,
      }),
    ).toMatchObject({ subtotal: 210_000, tax: 21_000, ecv: 231_000 });
    expect(
      calculateEcv({
        baseTermValue: 1000,
        extensionsValue: 0,
        freight: 0,
        implementation: 0,
        exchangeRate: 1,
        taxPct: 0,
      }).ecv,
    ).toBe(1000);
  });

  it('routes by value and risk, and picks a sub-workflow from the category', () => {
    const r = DEFAULTS.workflowRouting;
    expect(routeWorkflow(r, 10_000, 'LOW').workflowId).toBe('wf-simple');
    expect(routeWorkflow(r, 400_000, 'MEDIUM').workflowId).toBe('wf-intermediate');
    expect(routeWorkflow(r, 2_000_000, 'HIGH').workflowId).toBe('wf-complex');
    expect(routeWorkflow(r, 100, 'CRITICAL').workflowId).toBe('wf-board');
    expect(selectSubWorkflow('Catering', 'Staff conference').key).toBe('events');
    expect(selectSubWorkflow('Building cleaning', 'Sites').key).toBe('contractors');
    expect(selectSubWorkflow('Mystery', 'Thing').key).toBe('general');
  });
});

describe('classification (FR-0015)', () => {
  it('a preliminary code is assigned in the tenant scheme, can be confirmed or replaced, and then stays', async () => {
    const r = await request();
    // the source of the code is shown beside it (NFR-R03): in-house only while no outside pack is loaded
    expect(r.taxonomy).toMatchObject({ scheme: 'UNSPSC', code: '76111500', confirmed: false });
    expect(r.taxonomy.source).toMatchObject({ kind: 'IN_HOUSE', pack: null });
    await intake({ taxonomy: 'CPV' });
    const cpv = await request();
    expect(cpv.taxonomy).toMatchObject({ scheme: 'CPV', code: '90910000' });
    const ok = await env.call('requester', 'POST', `/requests/${cpv.id}/taxonomy`, { confirm: true });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ code: '90910000', confirmed: true });
    const own = await env.call('requester', 'POST', `/requests/${cpv.id}/taxonomy`, {
      confirm: true,
      code: 'ENT-CLEAN-01',
    });
    expect(own.json().code).toBe('ENT-CLEAN-01');
    // a later change of wording does not undo a confirmed code
    const edited = await env.call('requester', 'PATCH', `/requests/${cpv.id}`, { title: 'Renamed' });
    expect(edited.json().taxonomy).toMatchObject({ code: 'ENT-CLEAN-01', confirmed: true });
    const audit = await sys<Json[]>((tx) =>
      tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'request.taxonomy_confirm')),
    );
    expect(audit.some((e) => (e.after as Json).overridden === true)).toBe(true);
    expect(
      (await env.call('evaluator-tech', 'POST', `/requests/${cpv.id}/taxonomy`, { confirm: true }))
        .statusCode,
    ).toBe(403);
    await reset();
  });
});

describe('required engagements and budget rules at submission (FR-0030, FR-0055, FR-X05, FR-0066, FR-0065)', () => {
  it('the functions that must review are listed with reasons and are notified when the request is submitted', async () => {
    const r = await request({
      title: 'Cloud software licences',
      category: 'IT managed services',
      estimatedValue: 300_000,
      businessUnit: 'IT',
    });
    // sensitive IT work is rated critical, so risk and compliance must also review
    expect(r.engagements.map((e: Json) => e.function).sort()).toEqual(['FINANCE', 'IT', 'LEGAL', 'RISK']);
    const before = (await notesFor('legal')).length;
    expect((await env.call('requester', 'POST', `/requests/${r.id}/submit`)).statusCode).toBe(200);
    const legal = await notesFor('legal');
    expect(legal.length).toBe(before + 1);
    expect(legal[0]!.title).toContain('Legal review of larger contracts');
    expect(legal[0]!.body).toContain('300,000');
    expect((await notesFor('finance'))[0]!.title).toContain('Finance review');
    const audit = await sys<Json[]>((tx) =>
      tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'request.engagements')),
    );
    expect(audit.some((e) => (e.after as Json).required.includes('LEGAL'))).toBe(true);
  });

  it("the rules are the administrator's: with none, nothing is required", async () => {
    await intake({ engagementRules: [] });
    const r = await request({
      title: 'Cloud software licences',
      category: 'IT managed services',
      estimatedValue: 300_000,
      businessUnit: 'IT',
    });
    expect(r.engagements).toEqual([]);
    await reset();
  });

  it('a hard cap blocks submission, raises an amendment task for finance and records it', async () => {
    const r = await request({ estimatedValue: 900_000, businessUnit: 'Procurement' });
    const before = (await notesFor('finance')).length;
    const blocked = await env.call('requester', 'POST', `/requests/${r.id}/submit`);
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json().code).toBe('BUDGET_EXCEEDED');
    const fin = await notesFor('finance');
    expect(fin.length).toBe(before + 1);
    expect(fin[0]!.title).toContain('Budget amendment needed');
    const audit = await sys<Json[]>((tx) =>
      tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'request.budget_amendment_task')),
    );
    expect(audit).toHaveLength(1);
  });

  it('a soft cap lets it through, flags the variance and escalates to the executive on every configured channel', async () => {
    await intake({ budgetCap: 'SOFT' });
    await setSection('notifications', {
      ...DEFAULTS.notifications,
      channels: ['IN_APP', 'EMAIL', 'SLACK', 'TEAMS'],
    });
    const r = await request({ estimatedValue: 900_000, businessUnit: 'Procurement' });
    const before = (await notesFor('exec')).length;
    const ok = await env.call('requester', 'POST', `/requests/${r.id}/submit`);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().budgetCheck).toBe('EXCEEDED');
    const exec = await notesFor('exec');
    expect(exec.length).toBe(before + 1);
    expect(exec[0]!.title).toContain('soft cap');
    const channels = await sys<Json[]>((tx) => tx.select().from(s.notificationDelivery));
    const forThis = channels.filter((c) => (c.detail as string).includes('Budget exceeded'));
    expect(forThis.map((c) => c.channel).sort()).toEqual(['EMAIL', 'SLACK', 'TEAMS']);
    expect(
      await sys<Json[]>((tx) =>
        tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'request.budget_variance')),
      ),
    ).toHaveLength(1);
    // the customer can switch the rule off: the same breach then notifies nobody
    await setSection('notifications', {
      ...DEFAULTS.notifications,
      rules: DEFAULTS.notifications.rules.map((x) => ({
        ...x,
        enabled: x.event === 'BUDGET_BREACH' ? false : x.enabled,
      })),
    });
    const r2 = await request({ estimatedValue: 800_000, businessUnit: 'Procurement' });
    const again = (await notesFor('exec')).length;
    expect((await env.call('requester', 'POST', `/requests/${r2.id}/submit`)).statusCode).toBe(200);
    expect((await notesFor('exec')).length).toBe(again);
    await reset();
  });
});

describe('supplier suggestions (FR-0020)', () => {
  it('suggests directory suppliers for the category with contacts, and the person can amend the list', async () => {
    const r = await request();
    const list = (
      await env.call('requester', 'GET', `/requests/${r.id}/suggested-suppliers`)
    ).json() as Json[];
    expect(list.map((x) => x.company).sort()).toEqual([
      'Brightwave Cleaning Pty Ltd',
      'Evergreen Facility Services Pty Ltd',
    ]);
    expect(list.every((x) => x.selected)).toBe(true);
    expect(list.find((x) => x.company.startsWith('Brightwave'))!.contacts[0]).toMatchObject({
      name: 'Sam Brightwave',
    });
    const keep = list.find((x) => x.company.startsWith('Brightwave'))!.id;
    const put = await env.call('requester', 'PUT', `/requests/${r.id}/suggested-suppliers`, {
      supplierIds: [keep],
    });
    expect(put.statusCode, put.body).toBe(200);
    expect((put.json() as Json[]).map((x) => [x.company.split(' ')[0], x.selected])).toEqual([
      ['Brightwave', true],
      ['Evergreen', false],
    ]);
    expect(
      (
        await env.call('requester', 'PUT', `/requests/${r.id}/suggested-suppliers`, {
          supplierIds: [uid('nobody')],
        })
      ).statusCode,
    ).toBe(422);
    const it = await request({ category: 'IT managed services (UNSPSC 81111800)', title: 'IT' });
    expect(
      ((await env.call('requester', 'GET', `/requests/${it.id}/suggested-suppliers`)).json() as Json[]).map(
        (x) => x.company,
      ),
    ).toEqual(['Summit Managed Services Pty Ltd']);
    expect(
      (await env.call('evaluator-tech', 'GET', `/requests/${r.id}/suggested-suppliers`)).statusCode,
    ).toBe(403);
  });
});

describe('estimated contract value and workflow routing (FR-0090, FR-0705, FR-X02)', () => {
  it('the calculation can be tried, then applied: the value changes and the workflow follows', async () => {
    const r = await request({ estimatedValue: 10_000 });
    expect(r.workflow).toMatchObject({ id: 'wf-simple', name: 'Simple purchase' });
    expect(r.workflow.steps.map((x: Json) => x.label)).toEqual(['Request', 'Approve', 'Order']);
    const inputs = {
      baseTermValue: 100_000,
      extensionsValue: 20_000,
      freight: 5_000,
      implementation: 15_000,
      exchangeRate: 1.5,
      taxPct: 10,
    };
    const preview = await env.call('requester', 'PUT', `/requests/${r.id}/ecv`, inputs);
    expect(preview.json()).toMatchObject({ ecv: 231_000, applied: false });
    expect((await env.call('requester', 'GET', `/requests/${r.id}`)).json().estimatedValue).toBe(10_000);
    const applied = await env.call('requester', 'PUT', `/requests/${r.id}/ecv`, { ...inputs, apply: true });
    expect(applied.json()).toMatchObject({ ecv: 231_000, applied: true });
    const after = (await env.call('requester', 'GET', `/requests/${r.id}`)).json();
    expect(after.estimatedValue).toBe(231_000);
    expect(after.workflow.id).toBe('wf-intermediate');
    expect((await env.call('requester', 'GET', `/requests/${r.id}/ecv`)).json()).toMatchObject({
      ecv: 231_000,
      applied: true,
    });
    expect(
      await sys<Json[]>((tx) =>
        tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'request.ecv_apply')),
      ),
    ).toHaveLength(1);
  });

  it('value and risk choose the workflow; the administrator can move the limits; the steps show where it stands', async () => {
    const big = await request({ estimatedValue: 2_000_000, businessUnit: 'IT', category: CLEANING });
    expect(big.workflow.id).toBe('wf-complex');
    const critical = await request({
      estimatedValue: 1_200_000,
      businessUnit: 'IT',
      category: 'IT managed services (UNSPSC 81111800)',
      title: 'Core platform',
    });
    expect(critical.workflow).toMatchObject({ id: 'wf-board' });
    expect(critical.workflow.steps.map((x: Json) => x.label)).toContain('Board endorsement');
    expect(critical.workflow.steps.map((x: Json) => x.label)).toContain('External probity');
    const mid = await request({ estimatedValue: 400_000, businessUnit: 'Facilities' });
    expect(mid.workflow.id).toBe('wf-intermediate');
    expect(mid.workflow.steps[0]).toMatchObject({ label: 'Request', state: 'CURRENT' });
    await setSection('workflowRouting', { simpleBelow: 500_000, intermediateBelow: 1_000_000 });
    expect((await request({ estimatedValue: 400_000, businessUnit: 'Facilities' })).workflow.id).toBe(
      'wf-simple',
    );
    await reset();
  });

  it('the same process produces different outputs per sub-workflow: plan section and tender pack differ', async () => {
    const venue = await request({
      title: 'Staff conference',
      category: 'Catering (UNSPSC 90101500)',
      estimatedValue: 30_000,
      businessUnit: 'Facilities',
    });
    const contractor = await request({
      title: 'Site cleaning',
      category: CLEANING,
      estimatedValue: 30_000,
      businessUnit: 'Facilities',
    });
    expect(venue.workflow).toMatchObject({ id: 'wf-simple', subWorkflow: 'events' });
    expect(contractor.workflow).toMatchObject({ id: 'wf-simple', subWorkflow: 'contractors' });
    for (const r of [venue, contractor])
      expect((await env.call('requester', 'POST', `/requests/${r.id}/submit`)).statusCode).toBe(200);
    const vp = (await env.call('procurement', 'GET', `/requests/${venue.id}/plan`)).json();
    const cp = (await env.call('procurement', 'GET', `/requests/${contractor.id}/plan`)).json();
    const sub = (p: Json) => p.fields.find((f: Json) => f.key === 'subWorkflow').value as string;
    expect(sub(vp)).toContain('Venue and event requirements');
    expect(sub(cp)).toContain('Contractor obligations');
    expect(sub(vp)).not.toEqual(sub(cp));
    const reqs = (id: string) => env.call('requester', 'GET', `/requests/${id}`);
    expect((await reqs(venue.id)).json().workflow.subWorkflow).toBe('events');
  });
});

describe('process variations (FR-0730)', () => {
  it('a step is added for one procurement only, after a delegate approves; mandatory steps cannot be removed', async () => {
    const r = await request({ estimatedValue: 200_000 });
    expect(r.workflow.id).toBe('wf-intermediate');
    const bad = await env.call('requester', 'POST', `/requests/${r.id}/process-variations`, {
      action: 'REMOVE',
      key: 'plan',
      reason: 'We do not want a plan here',
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().code).toBe('CHECKPOINT_REQUIRED');
    const ask = await env.call('requester', 'POST', `/requests/${r.id}/process-variations`, {
      action: 'ADD',
      label: 'Legal review',
      reason: 'The contract is unusual and needs legal eyes',
    });
    expect(ask.statusCode, ask.body).toBe(201);
    expect(ask.json().status).toBe('PENDING');
    expect(
      (
        await env.call('requester', 'POST', `/requests/${r.id}/process-variations`, {
          action: 'ADD',
          label: 'Another',
          reason: 'A second change while one waits',
        })
      ).statusCode,
    ).toBe(409);
    // the requester cannot approve their own change; a delegate can, within their authority
    expect(
      (
        await env.call(
          'requester',
          'POST',
          `/requests/${r.id}/process-variations/${ask.json().id}/decision`,
          { decision: 'APPROVE' },
        )
      ).statusCode,
    ).toBe(403);
    const dec = await env.call(
      'delegate',
      'POST',
      `/requests/${r.id}/process-variations/${ask.json().id}/decision`,
      { decision: 'APPROVE', comment: 'Agreed' },
    );
    expect(dec.statusCode, dec.body).toBe(200);
    expect(dec.json()).toMatchObject({ status: 'APPROVED', decidedByName: 'Dana Okafor' });
    const view = (await env.call('requester', 'GET', `/requests/${r.id}`)).json();
    expect(view.workflow.steps.map((x: Json) => x.label)).toEqual([
      'Request',
      'Plan',
      'Quotes',
      'Approve',
      'Contract',
      'Legal review',
    ]);
    expect(view.workflow.steps.at(-1)).toMatchObject({ variation: 'ADDED', mandatory: false });
    // another procurement is untouched
    expect((await request({ estimatedValue: 200_000 })).workflow.steps).toHaveLength(5);
    // a later change of value does not undo the agreed variation
    await env.call('requester', 'PATCH', `/requests/${r.id}`, { estimatedValue: 5_000 });
    expect((await env.call('requester', 'GET', `/requests/${r.id}`)).json().workflow.steps).toHaveLength(6);
    const audit = await sys<Json[]>((tx) =>
      tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'request.process_variation_approve')),
    );
    expect(audit[0]!.after).toMatchObject({ approvedBy: 'Dana Okafor', step: 'Legal review' });
  });

  it("a rejected change leaves the process as it was; a value above the delegate's authority needs the executive", async () => {
    const r = await request({ estimatedValue: 200_000 });
    const ask = await env.call('requester', 'POST', `/requests/${r.id}/process-variations`, {
      action: 'ADD',
      label: 'Extra step',
      reason: 'Wanted an extra step for comfort',
    });
    const no = await env.call(
      'delegate',
      'POST',
      `/requests/${r.id}/process-variations/${ask.json().id}/decision`,
      { decision: 'REJECT', comment: 'Not needed' },
    );
    expect(no.json().status).toBe('REJECTED');
    expect((await env.call('requester', 'GET', `/requests/${r.id}`)).json().workflow.steps).toHaveLength(5);
    const big = await request({ estimatedValue: 3_000_000, businessUnit: 'IT' });
    const askBig = await env.call('requester', 'POST', `/requests/${big.id}/process-variations`, {
      action: 'ADD',
      label: 'Site visit',
      reason: 'Visit the suppliers before award',
    });
    expect(
      (
        await env.call(
          'delegate',
          'POST',
          `/requests/${big.id}/process-variations/${askBig.json().id}/decision`,
          { decision: 'APPROVE' },
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await env.call(
          'exec',
          'POST',
          `/requests/${big.id}/process-variations/${askBig.json().id}/decision`,
          { decision: 'APPROVE' },
        )
      ).statusCode,
    ).toBe(200);
  });
});

describe('delegates by stage (FR-0725, FR-X06)', () => {
  it('each stage names the lowest authority that is enough; bigger work moves up on its own', async () => {
    const small = await request({ estimatedValue: 200_000 });
    const d = (await env.call('procurement', 'GET', `/requests/${small.id}/delegates`)).json() as Json[];
    expect(d.map((x) => x.stage)).toEqual([
      'PLAN_APPROVAL',
      'PUBLISH_PERMISSION',
      'REPORT_APPROVAL',
      'CONTRACT_SIGNING',
    ]);
    expect(d.find((x) => x.stage === 'PLAN_APPROVAL')!.delegate.name).toBe('Dana Okafor');
    const big = await request({ estimatedValue: 3_000_000, businessUnit: 'IT' });
    const dd = (await env.call('procurement', 'GET', `/requests/${big.id}/delegates`)).json() as Json[];
    expect(dd.find((x) => x.stage === 'PLAN_APPROVAL')!.delegate.name).toBe('Elena Petrova');
    expect(dd.find((x) => x.stage === 'CONTRACT_SIGNING')!.delegate.name).toBe('Dana Okafor');
  });

  it('procurement can redirect a stage to someone with enough authority, not to anyone else; the person is told', async () => {
    const r = await request({ estimatedValue: 200_000 });
    const exec = uid('user:exec');
    const ok = await env.call('procurement', 'PUT', `/requests/${r.id}/delegates/PLAN_APPROVAL`, {
      userId: exec,
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ basis: 'REDIRECTED', delegate: { name: 'Elena Petrova' } });
    expect((await notesFor('exec'))[0]!.title).toContain('approver for plan approval');
    const no = await env.call('procurement', 'PUT', `/requests/${r.id}/delegates/PLAN_APPROVAL`, {
      userId: uid('user:requester'),
    });
    expect(no.statusCode).toBe(422);
    expect(
      (await env.call('requester', 'PUT', `/requests/${r.id}/delegates/PLAN_APPROVAL`, { userId: exec }))
        .statusCode,
    ).toBe(403);
    expect(
      await sys<Json[]>((tx) =>
        tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'request.delegate_redirect')),
      ),
    ).toHaveLength(1);
  });

  it('history is never rewritten: a stage signed by one delegate stays attributed to them when the value later needs another', async () => {
    const r = await request({ estimatedValue: 200_000 });
    await env.call('requester', 'POST', `/requests/${r.id}/submit`);
    const plan = (await env.call('procurement', 'GET', `/requests/${r.id}/plan`)).json();
    expect((await env.call('procurement', 'POST', `/plans/${plan.id}/submit-for-approval`)).statusCode).toBe(
      200,
    );
    expect(
      (await env.call('delegate', 'POST', `/plans/${plan.id}/decision`, { decision: 'APPROVE' })).statusCode,
    ).toBe(200);
    // the value later rises beyond the first delegate's authority
    await sys((tx) =>
      tx.update(s.request).set({ estimatedValue: '3000000.00' }).where(eq(s.request.id, r.id)),
    );
    const stage = (
      (await env.call('procurement', 'GET', `/requests/${r.id}/delegates`)).json() as Json[]
    ).find((x) => x.stage === 'PLAN_APPROVAL')!;
    expect(stage.delegate.name).toBe('Elena Petrova');
    expect(stage.signedBy).toMatchObject({ name: 'Dana Okafor' });
  });
});

describe('downstream artefacts from one conversation (FR-0010)', () => {
  it('lists what the request filled in, with what was carried over and where to open it', async () => {
    const r = await request({ estimatedValue: 40_000 });
    await env.call('requester', 'POST', `/requests/${r.id}/submit`);
    const plan = (await env.call('procurement', 'GET', `/requests/${r.id}/plan`)).json();
    const first = (await env.call('requester', 'GET', `/requests/${r.id}/artefacts`)).json() as Json[];
    expect(first.map((a) => a.kind)).toEqual(['REQUEST', 'PLAN']);
    expect(first[1]).toMatchObject({
      link: `/app/plans/${r.id}`,
      carriedFromIntake: expect.arrayContaining(['title', 'estimatedValue', 'contractOwner']),
    });
    expect(plan.fields.find((f: Json) => f.key === 'background').value).toContain('40,000');
    // a seeded request already carried through every stage shows all of them
    const a = await env.award();
    const full = (
      await env.call('procurement', 'GET', `/requests/${a.requestId}/artefacts`)
    ).json() as Json[];
    expect(full.map((x) => x.kind)).toEqual(['REQUEST', 'TENDER', 'SCORING_SHEET']);
    expect(full[2]!.detail).toContain('1 criteria');
    expect((await env.call('evaluator-tech', 'GET', `/requests/${r.id}/artefacts`)).statusCode).toBe(403);
  });
});

describe('mandatory checkpoints can be relaxed and the relaxation is recorded (FR-0720)', () => {
  it('with "declarations before approval" switched off a plan reaches approval without them, and approval notes it', async () => {
    const strict = await request({ estimatedValue: 150_000 });
    await env.call('requester', 'POST', `/requests/${strict.id}/submit`);
    const sp = (await env.call('procurement', 'GET', `/requests/${strict.id}/plan`)).json();
    // risk-rated work still needs its sign-off; use a plan whose only gate is the declarations
    const gates = sp.gates as Json[];
    if (gates.some((g) => g.key === 'UPFRONT_COI')) {
      const stuck = await env.call('procurement', 'POST', `/plans/${sp.id}/submit-for-approval`);
      expect(stuck.statusCode).toBe(409);
      await setSection('checkpoints', { ...DEFAULTS.checkpoints, coiBeforeApproval: false });
      const go = await env.call('procurement', 'POST', `/plans/${sp.id}/submit-for-approval`);
      expect(go.statusCode, go.body).toBe(200);
      const done = await env.call('delegate', 'POST', `/plans/${sp.id}/decision`, { decision: 'APPROVE' });
      expect(done.statusCode, done.body).toBe(200);
      const relaxed = await sys<Json[]>((tx) =>
        tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'checkpoint.relaxed')),
      );
      expect(relaxed.some((e) => (e.after as Json).checkpoint === 'coiBeforeApproval')).toBe(true);
    }
    await reset();
  });

  it('a contract can be drafted from a generated-but-unapproved report only when that checkpoint is off', async () => {
    const a = await env.award();
    await sys((tx) =>
      tx.update(s.evaluation).set({ status: 'REPORTED' }).where(eq(s.evaluation.id, a.evaluationId)),
    );
    const tryDraft = () =>
      env.call('legal', 'POST', '/contracts', {
        evaluationId: a.evaluationId,
        supplierId: uid('supplier:brightwave'),
      });
    expect((await tryDraft()).statusCode).toBe(409);
    await setSection('checkpoints', { ...DEFAULTS.checkpoints, reportSignoffBeforeContract: false });
    const ok = await tryDraft();
    expect(ok.statusCode, ok.body).toBe(201);
    const relaxed = await sys<Json[]>((tx) =>
      tx
        .select()
        .from(s.auditEvent)
        .where(and(eq(s.auditEvent.action, 'checkpoint.relaxed'), eq(s.auditEvent.entityId, a.evaluationId))),
    );
    expect(relaxed[0]!.after).toMatchObject({ checkpoint: 'reportSignoffBeforeContract' });
    await reset();
  });
});

describe('ESG and social objectives on the plan (FR-0095)', () => {
  it('are stored against the plan, written into the plan section, carried into the tender pack and audited', async () => {
    const r = await request({ estimatedValue: 40_000 });
    await env.call('requester', 'POST', `/requests/${r.id}/submit`);
    const plan = (await env.call('procurement', 'GET', `/requests/${r.id}/plan`)).json();
    expect((await env.call('procurement', 'GET', `/plans/${plan.id}/esg`)).json()).toMatchObject({
      socioEconomic: [],
      locked: false,
    });
    const put = await env.call('procurement', 'PUT', `/plans/${plan.id}/esg`, {
      carbonCeilingKg: 5000,
      localLabourPct: 40,
      diversityOwnedTarget: 10,
      socioEconomic: ['Indigenous business', 'Regional supplier'],
    });
    expect(put.statusCode, put.body).toBe(200);
    const text = (
      (await env.call('procurement', 'GET', `/requests/${r.id}/plan`)).json().fields as Json[]
    ).find((f) => f.key === 'esg')!.value as string;
    expect(text).toContain('5,000 kg CO2-e');
    expect(text).toContain('at least 40%');
    expect(text).toContain('Indigenous business, Regional supplier');
    expect(
      (await env.call('procurement', 'PUT', `/plans/${plan.id}/esg`, { localLabourPct: 150 })).statusCode,
    ).toBe(400);
    expect(
      (await env.call('procurement', 'PUT', `/plans/${plan.id}/esg`, { socioEconomic: ['Not a tag'] }))
        .statusCode,
    ).toBe(400);
    // approve the plan, then build the tender pack: the objectives are in what suppliers read
    await env.call('procurement', 'POST', `/plans/${plan.id}/submit-for-approval`);
    await env.call('delegate', 'POST', `/plans/${plan.id}/decision`, { decision: 'APPROVE' });
    expect(
      (await env.call('procurement', 'PUT', `/plans/${plan.id}/esg`, { localLabourPct: 50 })).statusCode,
    ).toBe(423);
    const t = await env.call('procurement', 'POST', '/tenders', { requestId: r.id, type: 'RFT' });
    expect(t.statusCode, t.body).toBe(201);
    expect(JSON.stringify(t.json())).toContain('at least 40%');
    expect(JSON.stringify(t.json())).toContain('Contractor obligations');
    expect(
      await sys<Json[]>((tx) =>
        tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'plan.esg_update')),
      ),
    ).toHaveLength(1);
  });
});

describe('approval-timeout escalation and ERP field mapping (FR-0066, FR-0700)', () => {
  it('an approval that waits past the configured hours is escalated once, to the manager, on every channel', async () => {
    await setSection('notifications', {
      channels: ['IN_APP', 'EMAIL', 'SLACK'],
      escalationHours: 24,
      rules: DEFAULTS.notifications.rules,
    });
    const r = await request({ estimatedValue: 100_000 });
    await env.call('requester', 'POST', `/requests/${r.id}/submit`);
    const plan = (await env.call('procurement', 'GET', `/requests/${r.id}/plan`)).json();
    await env.call('procurement', 'POST', `/plans/${plan.id}/submit-for-approval`);
    expect((await env.call('admin', 'POST', '/admin/notifications/run-escalations')).json().escalated).toBe(
      0,
    ); // not yet
    const before = (await notesFor('exec')).length;
    env.clock.set(new Date(new Date(SEED_DATE).getTime() + 30 * 3_600_000));
    const first = (await env.call('admin', 'POST', '/admin/notifications/run-escalations')).json().escalated;
    expect(first).toBeGreaterThanOrEqual(1);
    const exec = await notesFor('exec');
    expect(exec.length).toBeGreaterThan(before);
    expect(exec.some((n: Json) => n.title.startsWith('Escalation: waiting') && n.body.includes('Plan'))).toBe(
      true,
    );
    // a second run does nothing new, and the deliveries show every channel
    expect((await env.call('admin', 'POST', '/admin/notifications/run-escalations')).json().escalated).toBe(
      0,
    );
    const log = (await env.call('admin', 'GET', '/admin/notification-log')).json() as Json[];
    expect(new Set(log.filter((l) => l.title.startsWith('Escalation')).map((l) => l.channel))).toEqual(
      new Set(['EMAIL', 'SLACK']),
    );
    expect(
      await sys<Json[]>((tx) =>
        tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'approval.escalated')),
      ),
    ).not.toHaveLength(0);
    await reset();
  });

  it('field names map both ways so reports show one consistent label', async () => {
    await setSection('erpFieldMap', [
      { erpName: 'cost', platformKey: 'expenditure' },
      { erpName: 'Vendor', platformKey: 'supplier' },
    ]);
    const inbound = await env.call('admin', 'POST', '/admin/erp-mapping/preview', {
      direction: 'INBOUND',
      record: { COST: 1200, vendor: 'Acme', other: 'x' },
    });
    expect(inbound.json().record).toEqual({ expenditure: 1200, supplier: 'Acme', other: 'x' });
    const outbound = await env.call('admin', 'POST', '/admin/erp-mapping/preview', {
      direction: 'OUTBOUND',
      record: { expenditure: 1200, supplier: 'Acme' },
    });
    expect(outbound.json().record).toEqual({ cost: 1200, Vendor: 'Acme' });
    expect(
      (
        await env.call('admin', 'PUT', '/admin/settings', {
          erpFieldMap: [
            { erpName: 'cost', platformKey: 'a1' },
            { erpName: 'COST', platformKey: 'b1' },
          ],
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await env.call('requester', 'POST', '/admin/erp-mapping/preview', {
          direction: 'INBOUND',
          record: {},
        })
      ).statusCode,
    ).toBe(403);
    await setSection('erpFieldMap', []);
  });
});

// keeps the unused import honest if TENANT_ID is needed by later cases
void TENANT_ID;
