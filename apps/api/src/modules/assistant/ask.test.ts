/**
 * Ask (the renamed assistant): page-aware answers, how-to steps with role refusal, record facts that respect visibility and
 * tenant, and exact guidance for a Procurement Copilot run that is waiting for a person.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { PAGE_GUIDE, guideFor, parsePageContext } from '@if/shared';
import { withSystem } from '../../db/client.js';
import * as s from '../../db/schema.js';
import { createEnv, type Json } from '../contract/test-env.js';
import { HOWTOS } from './howto.js';

let env: Awaited<ReturnType<typeof createEnv>>;
const call = (...a: Parameters<typeof env.call>) => env.call(...a);
const TEXT =
  'We need commercial cleaning services for our head office, about $90,000 over 24 months, business unit Facilities.';

const ask = async (who: string, message: string, path?: string, extra: Json = {}) => {
  const r = await call(who, 'POST', '/assistant/chat', {
    message,
    ...(path ? { page: path, context: { path, ...extra } } : {}),
  });
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as Json;
};
const start = async (who: string, body: Json) => {
  const r = await call(who, 'POST', '/copilot/runs', body);
  expect(r.statusCode, r.body).toBe(201);
  return r.json() as Json;
};
const open = (v: Json) => (v.gates as Json[]).filter((g) => g.status === 'OPEN');

let approvalRun: Json; // started by procurement, waiting for a delegate to approve the plan
let submitRun: Json; // started by the requester, waiting for procurement to submit the plan
let humanRun: Json; // a gap the agent could not repair (no value), handed to the procurement officer
let otherTenantRequest: string;

beforeAll(async () => {
  env = await createEnv();
  approvalRun = await start('procurement', { text: TEXT });
  submitRun = await start('requester', { text: TEXT });
  const draft = await call('procurement', 'POST', '/requests', {
    title: 'Stationery for the office',
    category: 'Office supplies',
  });
  humanRun = await start('procurement', {
    text: 'We need some stationery for the office.',
    procurementId: draft.json().id,
  });
  otherTenantRequest = await withSystem(env.database, async (tx) => {
    const [t] = await tx
      .insert(s.tenant)
      .values({ slug: 'other-org-ask', name: 'Other Org', sector: 'PRIVATE' })
      .returning();
    const [u] = await tx
      .insert(s.appUser)
      .values({ tenantId: t!.id, email: 'x@ask-other.example', name: 'X Other', passwordHash: 'x' })
      .returning();
    const [r] = await tx
      .insert(s.request)
      .values({
        tenantId: t!.id,
        number: 'OTH-ASK-1',
        title: 'Secret other tenant request',
        requesterId: u!.id,
      })
      .returning();
    return r!.id;
  });
}, 180_000);

describe('Ask: the page context', () => {
  it('works out the record from the path itself and ignores a claimed type', () => {
    const id = '11111111-2222-4333-8444-555555555555';
    expect(parsePageContext(`/app/requests/${id}`)).toEqual({
      path: `/app/requests/${id}`,
      entityType: 'request',
      entityId: id,
    });
    expect(parsePageContext(`/app/plans/${id}?x=1`)?.entityType).toBe('plan');
    expect(parsePageContext(`/app/copilot/${id}`)?.entityType).toBe('copilot-run');
    expect(parsePageContext('/app/requests/new')).toEqual({ path: '/app/requests/new' });
    expect(parsePageContext(null)).toBeNull();
    expect(guideFor(`/app/contracts/${id}`)?.title).toBe('Contract');
    expect(guideFor('/app/contracts/alerts')?.title).toBe('Contract alerts');
  });

  it('rejects a malformed gate id and still answers with no context at all', async () => {
    const bad = await call('procurement', 'POST', '/assistant/chat', {
      message: 'hi',
      context: { path: '/app/copilot', gateId: 'not-a-uuid' },
    });
    expect(bad.statusCode).toBe(400);
    expect((await ask('requester', 'what is this page?')).answer).toMatch(
      /do not have a guide entry|cannot tell|guide/i,
    );
  });
});

describe('Ask: what is this page, what can I do here', () => {
  it('explains a page from the page guide, naming the source, the roles and the next step', async () => {
    const r = await ask('requester', 'what is this page?', '/app/requests/new');
    expect(r.topic).toBe('page');
    expect(r.answer).toMatch(/^New request:/);
    expect(r.from).toMatch(/^From: page guide/);
    expect(r.bullets.join(' ')).toMatch(/Next step:/);
    expect(r.bullets.join(' ')).toMatch(/Submit request/);
  });

  it('says which actions on the page are not available to the signed-in role', async () => {
    const plan = await ask('requester', 'what can I do here?', `/app/plans/${approvalRun.run.requestId}`);
    const txt = plan.bullets.join('\n');
    expect(txt).toMatch(
      /Approve and lock the plan within your sourcing limit \(.*Executive only; not available to your role\)/,
    );
    const del = await ask('delegate', 'what can I do here?', `/app/plans/${approvalRun.run.requestId}`);
    expect(del.bullets.join('\n')).toMatch(
      /Approve and lock the plan within your sourcing limit \(you can\)/,
    );
  });

  it('answers for pages of several areas and for a supplier', async () => {
    expect((await ask('procurement', 'what is this page', '/app/tenders')).answer).toMatch(/^Tenders:/);
    expect((await ask('admin', 'what is this page', '/admin/delegations')).answer).toMatch(/limits/);
    expect((await ask('finance', 'explain this page', '/app/contracts/invoices')).answer).toMatch(
      /three ways/,
    );
    expect((await ask('supplier', 'what is this page', '/supplier')).answer).toMatch(/My tenders/);
  });

  it('explains what a status or a field means', async () => {
    const r = await ask('requester', 'what does AWAITING_APPROVAL mean?', '/app/plans');
    expect(r.topic).toBe('meaning');
    expect(r.answer).toMatch(/delegate/i);
    expect((await ask('requester', 'what does simulated mean')).topic).toBe('meaning');
  });
});

describe('Ask: how do I ... for the whole application', () => {
  it('gives numbered steps with links to a person who can do it', async () => {
    const r = await ask('delegate', 'How do I approve a plan?');
    expect(r.topic).toBe('howto');
    expect(r.allowed).toBe(true);
    expect(r.steps[0]).toMatch(/Open Approvals/);
    expect(r.steps.join(' ')).toMatch(/Approve and lock/);
    expect(r.actions.map((a: Json) => a.href)).toContain('/app/approvals');
    expect(r.from).toMatch(/how-to guide/);
  });

  it('refuses a role that cannot do it, says who can, and still shows the steps', async () => {
    const r = await ask('requester', 'how do I approve a plan?');
    expect(r.allowed).toBe(false);
    expect(r.answer).toMatch(/done by Delegate \(approver\), Executive/);
    expect(r.answer).toMatch(/cannot do it yourself/);
    expect(r.steps.length).toBeGreaterThan(2);
    const sign = await ask('procurement', 'how do I sign a contract?');
    expect(sign.allowed).toBe(false);
    expect(sign.answer).toMatch(/Delegate/);
  });

  it('covers the core procedures end to end, each with steps and links to real pages', async () => {
    const cases: Array<[string, string, RegExp]> = [
      ['requester', 'how do I create a request?', /New request/],
      ['procurement', 'how do I publish a tender?', /Publish tender/],
      ['evaluator-tech', 'how do I score bids?', /Mark my scoring complete/],
      ['chair', 'how do I run consensus?', /Lock consensus/],
      ['delegate', 'how do I award?', /Approve report/],
      ['exec', 'how do I sign a contract', /Sign contract/],
      ['admin', 'how do I import data?', /Data migration/],
      ['legal', 'how do I use OCR?', /Contract ingestion/],
      ['admin', 'how do I change settings?', /Settings/],
      ['supplier', 'how do I respond to a tender?', /Submit bid/],
    ];
    for (const [who, q, re] of cases) {
      const r = await ask(who, q);
      expect(r.topic, q).toBe('howto');
      expect(r.allowed, q).toBe(true);
      expect((r.steps as string[]).join(' '), q).toMatch(re);
    }
  });

  it('every link in the how-to catalogue is a page the page guide knows', () => {
    for (const h of HOWTOS)
      for (const st of h.steps) if (st.href) expect(guideFor(st.href), `${h.id}: ${st.href}`).not.toBeNull();
    expect(PAGE_GUIDE.length).toBeGreaterThan(60);
  });
});

describe('Ask: facts from the record being looked at', () => {
  it('reads a request through the normal route and says what is missing and who it is waiting for', async () => {
    const id = approvalRun.run.requestId as string;
    const r = await ask('procurement', 'what is the status of this request?', `/app/requests/${id}`);
    expect(r.topic).toBe('record');
    expect(r.from).toMatch(/this request/);
    expect(r.answer).toMatch(/is (submitted|in progress)/i);
    expect(r.bullets.join(' ')).toMatch(/Waiting for:/);
    expect(r.bullets.join(' ')).toMatch(/Missing|Nothing mandatory/);
  });

  it('reads a plan: waiting for a delegate, and tells a delegate they may approve and a procurement officer they may not', async () => {
    const id = approvalRun.run.requestId as string;
    const proc = await ask('procurement', 'what is it waiting for?', `/app/plans/${id}`);
    expect(proc.topic).toBe('record');
    expect(proc.bullets.join(' ')).toMatch(/delegate/);
    expect(proc.bullets.join(' ')).toMatch(/You cannot approve it/);
    const del = await ask('delegate', 'what is the status?', `/app/plans/${id}`);
    expect(del.bullets.join(' ')).toMatch(/You can approve it if your sourcing limit covers the value/);
  });

  it('never reveals a record the person may not see: another requester, a role the route refuses, another organisation', async () => {
    const id = approvalRun.run.requestId as string;
    // the requester did not raise this request, so the route answers 404 and Ask says nothing about it
    const hidden = await ask('requester', 'what is the status of this request?', `/app/requests/${id}`);
    expect(hidden.from).toMatch(/not visible to you/);
    expect(JSON.stringify(hidden)).not.toMatch(/cleaning|90,000|Facilities/i);
    // an evaluation page for a role that the route refuses
    const ev = await ask('requester', 'what is the status?', `/app/evaluations/${id}`);
    expect(ev.from).toMatch(/not visible to you/);
    // another organisation's request answers like one that does not exist
    const other = await ask(
      'procurement',
      'what is the status of this request?',
      `/app/requests/${otherTenantRequest}`,
    );
    expect(other.from).toMatch(/not visible to you/);
    expect(JSON.stringify(other)).not.toMatch(/OTH-ASK-1|Secret other tenant/);
  });

  it('a supplier is never given staff record facts', async () => {
    const id = approvalRun.run.requestId as string;
    const r = await ask('supplier', 'what is the status of this request?', `/app/requests/${id}`);
    expect(r.from).toMatch(/not visible to you/);
  });

  it('the requester sees the facts of their own request', async () => {
    const id = submitRun.run.requestId as string;
    const r = await ask('requester', 'what is the status of this request?', `/app/requests/${id}`);
    expect(r.from).toMatch(/this request \(read as you\)/);
    expect(r.answer).toMatch(/Facilities|cleaning/i);
  });
});

describe('Ask: the Copilot is waiting for a person', () => {
  it('a plan approval gate: where to go, numbered steps, who, and what happens next', async () => {
    const gate = open(approvalRun)[0]!;
    expect(gate.kind).toBe('PLAN_APPROVAL');
    const r = await ask('procurement', 'What do I do?', `/app/copilot/${approvalRun.run.id}`, {
      gateId: gate.id,
    });
    expect(r.topic).toBe('copilot');
    expect(r.steps[0]).toMatch(/Open the plan/);
    expect(r.steps.join(' ')).toMatch(/Approve and lock/);
    expect(r.steps.join(' ')).toMatch(/Advance now/);
    expect(r.actions[0].href).toBe(`/app/plans/${approvalRun.run.requestId}`);
    expect(r.actions.map((a: Json) => a.href)).toContain(`/app/copilot/${approvalRun.run.id}`);
    expect(r.bullets.join(' ')).toMatch(/Who must do it:.*\(not you/);
    expect(r.bullets.join(' ')).toMatch(/What happens next: The plan is locked/);
    expect(r.allowed).toBe(false);
    // the delegate named on the gate cannot open someone else's run, but is told through their own list what is theirs
    const del = await ask('delegate', 'what is the Copilot waiting for me to do?');
    expect(del.topic).toBe('copilot');
    expect(del.steps.join(' ')).toMatch(/Approve and lock/);
    expect(del.actions[0].href).toBe(`/app/plans/${approvalRun.run.requestId}`);
    // the delegate can also ask on the run page: the gate is theirs, so they are told about it (but only that gate)
    const onRun = await ask('delegate', 'what do I do?', `/app/copilot/${approvalRun.run.id}`);
    expect(onRun.steps.join(' ')).toMatch(/Approve and lock/);
    expect(onRun.actions[0].href).toBe(`/app/plans/${approvalRun.run.requestId}`);
    // an executive (a manager of runs) can read it and is told it is not theirs
    const exec = await ask('exec', 'what do I do', `/app/copilot/${approvalRun.run.id}`);
    expect(exec.allowed).toBe(false);
  });

  it('a run that belongs to someone else looks like one that does not exist', async () => {
    const r = await ask('requester', 'what do I do?', `/app/copilot/${approvalRun.run.id}`);
    expect(r.answer).toMatch(/cannot read that Copilot run/);
    expect(r.steps).toBeUndefined();
  });

  it('a step only the requester role cannot do goes to procurement, with the steps', async () => {
    const gate = open(submitRun)[0]!;
    expect(gate.kind).toBe('PLAN_SUBMIT');
    const r = await ask('requester', 'what do I do?', `/app/copilot/${submitRun.run.id}`, {
      gateId: gate.id,
    });
    expect(r.steps.join(' ')).toMatch(/Submit for approval/);
    expect(r.bullets.join(' ')).toMatch(/Who must do it: Priya Nair/);
  });

  it('a problem the agent could not repair: why it stopped, what it tried, and the fix', async () => {
    const d = (await call('procurement', 'GET', `/copilot/runs/${humanRun.run.id}`)).json() as Json;
    const gate = open(d)[0]!;
    expect(gate.kind).toBe('NEEDS_HUMAN');
    const r = await ask('procurement', 'what do I do?', `/app/copilot/${humanRun.run.id}`, {
      gateId: gate.id,
    });
    expect(r.steps.join(' ')).toMatch(/Open the request/);
    expect(r.steps.join(' ')).toMatch(/Advance now/);
    expect(r.bullets.join(' ')).toMatch(/Why it stopped:/);
    expect(r.bullets.join(' ')).toMatch(/What the Copilot tried:/);
    expect(r.actions[0].href).toBe(gate.link);
  });

  it('without being on a run, it lists what the Copilot is waiting for from the person', async () => {
    const r = await ask('procurement', 'what is the Copilot waiting for me to do?');
    expect(r.topic).toBe('copilot');
    expect(r.steps.length).toBeGreaterThan(1);
    expect(r.from).toMatch(/Copilot action items/);
    const none = await ask('chair', 'what is the Copilot waiting for me to do?');
    expect(none.answer).toMatch(/not waiting for you/);
  });
});

describe('the agent messages carry a What to do line and a link', () => {
  it('the run page data, the action items and the feed all say where and what', async () => {
    const d = (await call('procurement', 'GET', `/copilot/runs/${humanRun.run.id}`)).json() as Json;
    const g = open(d)[0]!;
    expect(g.whatToDo.line).toMatch(/^What to do: .*Open \/app\//);
    expect(g.whatToDo.steps.length).toBeGreaterThan(1);
    const prob = (d.problems as Json[]).find((p) => p.status === 'ESCALATED')!;
    expect(prob.whatToDo.line).toMatch(/What to do:/);
    const items = ((await call('procurement', 'GET', '/action-items')).json() as Json).items as Json[];
    const mine = items.find((i) => i.kind === 'Copilot needs you')!;
    expect(mine.whatToDo).toMatch(/What to do:/);
    expect(mine.runId).toBe(humanRun.run.id);
    expect(mine.gateId).toBe(g.id);
    const feed = (await call('procurement', 'GET', `/copilot/runs/${humanRun.run.id}/events`)).json() as Json;
    expect(JSON.stringify(feed)).toMatch(/What to do:/);
  });
});
