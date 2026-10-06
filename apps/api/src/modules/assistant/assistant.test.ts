import { beforeAll, describe, expect, it } from 'vitest';
import { createEnv, type Json } from '../contract/test-env.js';
import { classify } from './rules.js';

let env: Awaited<ReturnType<typeof createEnv>>;
const call = (...a: Parameters<typeof env.call>) => env.call(...a);
beforeAll(async () => {
  env = await createEnv();
}, 120_000);

const ask = async (who: string, message: string, page?: string) => {
  const r = await call(who, 'POST', '/assistant/chat', { message, page });
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as Json;
};

describe('FR-X01 conversational assistant: reading the question', () => {
  it('works out what is being asked', () => {
    expect(classify('Who can approve a plan?', false).kind).toBe('who-approves');
    expect(classify('how does the workflow work', false).kind).toBe('workflow');
    expect(classify('what is a three way match?', false).kind).toBe('glossary');
    expect(classify('what needs my attention', false).kind).toBe('attention');
    expect(classify('anything I should fix?', false).kind).toBe('review');
    expect(classify('what is my approval limit', false).kind).toBe('my-authority');
    expect(classify('what does legal do', false).kind).toBe('role-info');
    expect(classify('take me to invoices', false).kind).toBe('navigate');
    expect(classify('mark all my notifications as read', false).kind).toBe('mark-read');
    expect(classify('contracts expiring in 90 days', true).kind).toBe('data');
    expect(classify('contracts expiring in 90 days', false).kind).toBe('unknown');
    expect(classify('qwerty zxcv', true).kind).toBe('unknown');
  });
});

describe('FR-X01 conversational assistant: answers', () => {
  it('explains who approves what, from the same rules the portal enforces', async () => {
    const plan = await ask('requester', 'Who can approve a plan?');
    expect(plan.answer).toMatch(/delegate/i);
    expect(plan.answer).toMatch(/sourcing approval limit/i);
    const sign = await ask('requester', 'who signs a contract');
    expect(sign.answer).toMatch(/signing limit/i);
    const all = await ask('requester', 'who can approve things');
    expect(all.bullets.length).toBeGreaterThan(3);
    expect(all.model).toBe('rules-simulated-v1');
  });

  it('describes the workflow, a role and a term; explains the current page', async () => {
    expect((await ask('requester', 'how does the workflow work')).bullets).toHaveLength(6);
    expect((await ask('requester', 'what does the probity officer do')).answer).toMatch(
      /risk gate|oversight/i,
    );
    expect((await ask('requester', 'what is a conflict of interest?')).answer).toMatch(/panel/i);
    expect((await ask('requester', 'what is this page?', '/app/approvals')).answer).toMatch(
      /waiting for your decision/i,
    );
    expect((await ask('requester', 'what can I do?')).bullets[0]).toMatch(/Requester/);
  });

  it('only links to pages the person may open, and says so when asked for one they may not', async () => {
    const no = await ask('requester', 'take me to the audit trail');
    expect(no.actions).toEqual([]);
    expect(no.answer).toMatch(/not available to your role/i);
    const yes = await ask('procurement', 'take me to invoices');
    expect(yes.actions.map((a: Json) => a.href)).toContain('/app/contracts/invoices');
    const mine = await ask('requester', 'what can I do?');
    for (const a of mine.actions as Json[]) expect(a.href).not.toMatch(/^\/admin|\/audit/);
  });

  it('tells each person what needs attention and what to fix, from data they may see', async () => {
    const del = await ask('delegate', 'what needs my attention?');
    expect(del.answer.length).toBeGreaterThan(5);
    const rev = await ask('procurement', 'anything I should fix?');
    expect(rev.topic).toBe('review');
    const req = await ask('requester', 'anything I should fix?');
    // a requester is never told about suppliers, invoices or contracts
    expect(JSON.stringify(req)).not.toMatch(/supplier|invoice|contract/i);
    const lim = await ask('delegate', 'what is my approval limit?');
    expect(lim.topic).toBe('authority');
    expect(lim.bullets.join(' ')).toMatch(/\$/);
    expect((await ask('requester', 'what is my approval limit?')).answer).toMatch(/do not hold/i);
  });

  it('turns a report question into a link to the report, only for people who may run reports', async () => {
    const r = await ask('exec', 'contracts expiring in 90 days');
    expect(r.topic).toBe('data');
    expect(r.actions[0].href).toMatch(/^\/app\/reports\/ask\?q=/);
    expect((await ask('requester', 'contracts expiring in 90 days')).topic).toBe('unknown');
  });

  it('carries out a simple instruction and records it', async () => {
    const r = await ask('requester', 'mark all my notifications as read');
    expect(r.executed).toBe(true);
    expect(r.answer).toMatch(/Marked \d+ notification/);
  });

  it('rejects an empty message and a caller who is not signed in', async () => {
    expect((await call('requester', 'POST', '/assistant/chat', { message: '' })).statusCode).toBe(400);
    const anon = await env.app.inject({
      method: 'POST',
      url: '/api/v1/assistant/chat',
      payload: { message: 'hi' },
    });
    expect(anon.statusCode).toBe(401);
  });

  it('says plainly when it did not understand, and offers things to try', async () => {
    const r = await ask('requester', 'zzz qqq');
    expect(r.topic).toBe('unknown');
    expect(r.followUps.length).toBeGreaterThan(1);
  });
});
