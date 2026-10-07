import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import * as s from '../../db/schema.js';
import { TENANT_ID } from '../../db/seed.js';
import { createEnv, type Json } from '../contract/test-env.js';
import { QUESTIONS, assess, merge, NOTIFIABLE, NOT_NOTIFIABLE } from './breach.js';

const base = {
  personalInfo: true,
  unauthorised: true,
  remediated: false,
  sensitive: false,
  financial: false,
  credentials: false,
  malicious: false,
  vulnerable: false,
  protected: false,
};

describe('SEC-IR05 the assessment rules (rules-simulated-v1, decision support following the NDB scheme)', () => {
  it('has a question for every part of the likelihood-of-serious-harm test', () => {
    expect(QUESTIONS.map((q) => q.id)).toEqual(Object.keys(base));
    expect(QUESTIONS.filter((q) => q.gate).map((q) => q.id)).toEqual([
      'personalInfo',
      'unauthorised',
      'remediated',
    ]);
  });

  it('a gate ends the assessment as not notifiable: no personal information, no unauthorised access, remedial action taken', () => {
    expect(assess({ ...base, personalInfo: false, sensitive: true }, 5000).recommendation).toBe(
      NOT_NOTIFIABLE,
    );
    expect(assess({ ...base, unauthorised: false, sensitive: true }, 5000).recommendation).toBe(
      NOT_NOTIFIABLE,
    );
    const r = assess({ ...base, remediated: true, sensitive: true, financial: true, malicious: true }, 5000);
    expect(r.recommendation).toBe(NOT_NOTIFIABLE);
    expect(r.because[0]).toMatch(/section 26WF/);
  });

  it('weights add up: sensitive, financial and malicious access across many people is notifiable; encrypted data is not', () => {
    const hot = assess({ ...base, sensitive: true, financial: true, malicious: true }, 150);
    expect(hot).toMatchObject({ score: 11, recommendation: NOTIFIABLE });
    expect(assess({ ...base, sensitive: true, malicious: true }, 5).score).toBe(6); // 3 + 3, no individuals points under 10
    expect(assess({ ...base, sensitive: true, malicious: true }, 5).recommendation).toBe(NOTIFIABLE);
    expect(assess({ ...base, sensitive: true }, 5).recommendation).toBe(NOT_NOTIFIABLE); // 3 < 5
    expect(assess({ ...base, sensitive: true, malicious: true, protected: true }, 5)).toMatchObject({
      score: 3,
      recommendation: NOT_NOTIFIABLE,
    });
    expect(assess({ ...base, sensitive: true }, 1000).individualsPoints).toBe(3);
    expect(assess({ ...base, sensitive: true }, 100).individualsPoints).toBe(2);
    expect(assess({ ...base, sensitive: true }, 10).individualsPoints).toBe(1);
  });

  it('merges fields into a template and lists the ones left open', () => {
    expect(merge('Dear {{name}}, ref {{ref}} {{other}}', { name: 'Pat', ref: 'INC-1' })).toEqual({
      text: 'Dear Pat, ref INC-1 {{other}}',
      unfilled: ['other'],
    });
  });
});

describe('SEC-IR05 the workflow: report, assess, contain, draft, notify (simulated), close', () => {
  let env: Awaited<ReturnType<typeof createEnv>>;
  const call = (...a: Parameters<typeof env.call>) => env.call(...a);
  const sys = <T>(fn: Parameters<typeof env.withSystem>[1]) => env.withSystem(env.database, fn) as Promise<T>;
  beforeAll(async () => {
    env = await createEnv();
  }, 120_000);
  const plusDays = (iso: string, n: number) =>
    new Date(new Date(iso).getTime() + n * 86_400_000).toISOString().slice(0, 10);
  const report = async (who = 'requester', over: Json = {}) => {
    const r = await call(who, 'POST', '/incidents/report', {
      title: 'Spreadsheet sent to the wrong supplier',
      description: 'A spreadsheet with staff bank details was emailed to a supplier contact by mistake.',
      dataKinds: ['FINANCIAL', 'SENSITIVE_PERSONAL'],
      individuals: 150,
      ...over,
    });
    expect(r.statusCode, r.body).toBe(201);
    return r.json() as Json;
  };
  const all = { ...base, sensitive: true, financial: true, malicious: true };

  it('any staff member can report; a supplier cannot; only the managers see the register', async () => {
    const discovered = new Date(env.clock.now().getTime() - 10 * 86_400_000).toISOString();
    const inc = await report('requester', { discoveredAt: discovered });
    expect(inc).toMatchObject({
      number: 'INC-0001',
      status: 'OPEN',
      assessmentDue: plusDays(discovered, 30),
    });
    expect(
      (
        await call('supplier', 'POST', '/incidents/report', {
          title: 'A supplier report',
          description: 'This should not be accepted here',
          individuals: 1,
        })
      ).statusCode,
    ).toBe(403);
    for (const who of ['requester', 'finance', 'evaluator-tech'])
      expect((await call(who, 'GET', '/incidents')).statusCode).toBe(403);
    for (const who of ['admin', 'probity', 'legal', 'exec'])
      expect((await call(who, 'GET', '/incidents')).statusCode).toBe(200);
    const mine = ((await call('requester', 'GET', '/incidents/mine')).json() as Json).items;
    expect(mine.map((x: Json) => x.number)).toEqual(['INC-0001']);
    expect(((await call('finance', 'GET', '/incidents/mine')).json() as Json).items).toEqual([]);
    const list = (await call('legal', 'GET', '/incidents')).json() as Json;
    expect(list.items[0]).toMatchObject({
      number: 'INC-0001',
      daysLeft: 20,
      overdue: false,
      assessed: false,
    });
    expect(list.disclaimer).toMatch(/not legal advice/);
    const notes = await sys<Json[]>((tx) =>
      tx.select().from(s.notification).where(eq(s.notification.event, 'BREACH_DEADLINE')),
    );
    expect(notes.length).toBeGreaterThanOrEqual(4);
    const bad = await call('requester', 'POST', '/incidents/report', {
      title: 'In the future',
      description: 'Reported with a date in the future',
      discoveredAt: new Date(env.clock.now().getTime() + 5 * 86_400_000).toISOString(),
    });
    expect(bad.statusCode).toBe(422);
  });

  it('the questions and the rule set are served; a manager answers every one and gets a score and a recommendation', async () => {
    const q = (await call('legal', 'GET', '/incidents/questions')).json() as Json;
    expect(q).toMatchObject({ model: 'rules-simulated-v1', simulated: true, threshold: 5 });
    expect(q.questions).toHaveLength(9);
    const list = (await call('legal', 'GET', '/incidents')).json() as Json;
    const id = list.items[0].id as string;
    const partial = await call('legal', 'POST', `/incidents/${id}/assess`, {
      answers: { personalInfo: true },
    });
    expect(partial.statusCode).toBe(422);
    const unknown = await call('legal', 'POST', `/incidents/${id}/assess`, {
      answers: { ...all, bogus: true },
    });
    expect(unknown.statusCode).toBe(422);
    const r = await call('legal', 'POST', `/incidents/${id}/assess`, { answers: all });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({
      status: 'ASSESSING',
      assessment: { score: 11, recommendation: NOTIFIABLE, model: 'rules-simulated-v1', reason: null },
    });
    expect(r.json().assessment.because.at(-1)).toMatch(/Score 11 against a threshold of 5/);
    expect((await call('requester', 'GET', `/incidents/${id}`)).statusCode).toBe(403);
  });

  it('containment steps are a checklist with who and when', async () => {
    const id = ((await call('legal', 'GET', '/incidents')).json() as Json).items[0].id as string;
    const v = (
      await call('legal', 'POST', `/incidents/${id}/containment`, { key: 'stop', done: true })
    ).json() as Json;
    expect(v.containment).toHaveLength(6);
    expect(v.containment.find((c: Json) => c.key === 'stop')).toMatchObject({
      done: true,
      doneBy: expect.any(String),
    });
    expect(
      (await call('legal', 'POST', `/incidents/${id}/containment`, { key: 'nope', done: true })).statusCode,
    ).toBe(404);
    await call('legal', 'POST', `/incidents/${id}/containment`, { key: 'recover', done: true });
  });

  it('drafts the regulator and individual notices from templates with merge fields; sending is simulated and recorded; both sent means NOTIFIED', async () => {
    const id = ((await call('legal', 'GET', '/incidents')).json() as Json).items[0].id as string;
    expect(
      (await call('legal', 'POST', `/incidents/${id}/close`, { lessons: 'Closing too early to see' })).json(),
    ).toMatchObject({ code: 'NOTIFICATION_PENDING' });
    expect(
      (await call('legal', 'POST', `/incidents/${id}/notifications/REGULATOR/send`)).json(),
    ).toMatchObject({ code: 'NO_DRAFT' });
    const reg = (
      await call('legal', 'POST', `/incidents/${id}/notifications/REGULATOR/draft`)
    ).json() as Json;
    const dr = reg.notifications.find((n: Json) => n.audience === 'REGULATOR');
    expect(dr).toMatchObject({ status: 'DRAFT', unfilled: [] });
    expect(dr.subject).toContain('INC-0001');
    expect(dr.body).toMatch(/Office of the Australian Information Commissioner/);
    expect(dr.body).toContain('Number of individuals at risk of serious harm: 150');
    expect(dr.body).toContain('financial, sensitive personal');
    expect(dr.body).toContain('stop the unauthorised access or disclosure');
    expect(dr.body).not.toMatch(/\{\{/);
    const ind = (
      await call('legal', 'POST', `/incidents/${id}/notifications/INDIVIDUALS/draft`)
    ).json() as Json;
    const di = ind.notifications.find((n: Json) => n.audience === 'INDIVIDUALS');
    expect(di.body).toContain('Dear {{individualName}}'); // merged per person when sent
    expect(di.unfilled).toEqual([]);

    const sent = (
      await call('legal', 'POST', `/incidents/${id}/notifications/REGULATOR/send`)
    ).json() as Json;
    expect(sent.status).toBe('ASSESSING');
    expect(sent.notifications.find((n: Json) => n.audience === 'REGULATOR')).toMatchObject({
      status: 'SENT_SIMULATED',
      record: {
        connector: 'MESSAGING (simulated)',
        recipients: 1,
        simulated: true,
        reference: expect.stringMatching(/^SIM-MSG-/),
      },
    });
    expect(
      (await call('legal', 'POST', `/incidents/${id}/notifications/REGULATOR/send`)).json(),
    ).toMatchObject({ code: 'ALREADY_SENT' });
    expect(
      (await call('legal', 'POST', `/incidents/${id}/notifications/REGULATOR/draft`)).json(),
    ).toMatchObject({ code: 'ALREADY_SENT' });
    const done = (
      await call('legal', 'POST', `/incidents/${id}/notifications/INDIVIDUALS/send`)
    ).json() as Json;
    expect(done.status).toBe('NOTIFIED');
    expect(done.notifications.find((n: Json) => n.audience === 'INDIVIDUALS').record.recipients).toBe(150);

    expect((await call('legal', 'POST', `/incidents/${id}/close`, { lessons: 'short' })).statusCode).toBe(
      400,
    );
    const closed = await call('legal', 'POST', `/incidents/${id}/close`, {
      lessons: 'Check the recipient before sending any attachment; use the secure file share.',
    });
    expect(closed.json()).toMatchObject({
      status: 'CLOSED',
      lessons: expect.stringContaining('secure file share'),
    });
    expect(
      (await call('legal', 'POST', `/incidents/${id}/containment`, { key: 'stop', done: false })).json(),
    ).toMatchObject({ code: 'INCIDENT_CLOSED' });
    for (const action of [
      'breach.reported',
      'breach.assessed',
      'breach.notice_drafted',
      'breach.notice_sent',
      'breach.closed',
    ])
      expect(
        (await sys<Json[]>((tx) => tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, action))))
          .length,
        action,
      ).toBeGreaterThanOrEqual(1);
  });

  it('a not-notifiable outcome has no drafts, and cannot be closed until the reason is recorded', async () => {
    const inc = await report('procurement', {
      title: 'Laptop recovered unread',
      description: 'A laptop with synced files was lost and found the next day, still locked.',
      individuals: 3,
    });
    const clean = { ...base, remediated: true };
    const a1 = (
      await call('admin', 'POST', `/incidents/${inc.id}/assess`, { answers: clean })
    ).json() as Json;
    expect(a1.assessment).toMatchObject({ recommendation: NOT_NOTIFIABLE, reason: null });
    expect(
      (await call('admin', 'POST', `/incidents/${inc.id}/notifications/REGULATOR/draft`)).json(),
    ).toMatchObject({ code: 'NOT_NOTIFIABLE' });
    expect(
      (
        await call('admin', 'POST', `/incidents/${inc.id}/close`, {
          lessons: 'Encrypt every laptop disk by default.',
        })
      ).json(),
    ).toMatchObject({ code: 'REASON_REQUIRED' });
    const a2 = (
      await call('admin', 'POST', `/incidents/${inc.id}/assess`, {
        answers: clean,
        reason: 'Recovered unread and the disk is encrypted; no access occurred',
      })
    ).json() as Json;
    expect(a2.assessment.reason).toMatch(/Recovered unread/);
    const closed = await call('admin', 'POST', `/incidents/${inc.id}/close`, {
      lessons: 'Encrypt every laptop disk by default.',
    });
    expect(closed.json()).toMatchObject({ status: 'CLOSED' });
  });

  it('reminds before the deadline and escalates to the executive after it, each once (injected clock)', async () => {
    const inc = await report('finance', {
      title: 'Phishing mailbox access',
      description: 'A mailbox was accessed after a phishing email; unclear what was read.',
      individuals: 20,
    });
    expect((await call('admin', 'POST', '/incidents/run-reminders')).json()).toEqual({
      reminded: 0,
      escalated: 0,
    });
    env.clock.advanceDays(24);
    const first = (await call('admin', 'POST', '/incidents/run-reminders')).json() as Json;
    expect(first.reminded).toBeGreaterThanOrEqual(1);
    expect((await call('admin', 'POST', '/incidents/run-reminders')).json()).toMatchObject({
      reminded: 0,
      escalated: 0,
    });
    env.clock.advanceDays(8);
    const late = (await call('exec', 'GET', `/incidents/${inc.id}`)).json() as Json;
    expect(late).toMatchObject({ overdue: true, assessed: false });
    const esc = (await call('admin', 'POST', '/incidents/run-reminders')).json() as Json;
    expect(esc.escalated).toBeGreaterThanOrEqual(1);
    expect((await call('admin', 'POST', '/incidents/run-reminders')).json()).toMatchObject({ escalated: 0 });
    const kinds = ((await call('exec', 'GET', `/incidents/${inc.id}`)).json() as Json).reminders.map(
      (r: Json) => r.kind,
    );
    expect(kinds).toEqual(['REMINDER', 'ESCALATION']);
    const execNotes = await sys<Json[]>((tx) =>
      tx
        .select()
        .from(s.notification)
        .where(and(eq(s.notification.event, 'BREACH_DEADLINE'), eq(s.notification.tenantId, TENANT_ID))),
    );
    expect(execNotes.some((n) => /missed its assessment deadline/.test(n.title))).toBe(true);
    // assessing it (late) stops further reminders and records that it was late
    await call('legal', 'POST', `/incidents/${inc.id}/assess`, { answers: base });
    const ev = (
      await sys<Json[]>((tx) =>
        tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'breach.assessed')),
      )
    ).at(-1)!;
    expect(ev.after).toMatchObject({ late: true });
  });

  it('a notice cannot go through a gateway outside the allowed regions: 422, audited and counted', async () => {
    const inc = await report('requester', {
      title: 'Records emailed externally',
      description: 'Employee records were emailed to a personal address by a departing employee.',
      individuals: 300,
    });
    await call('legal', 'POST', `/incidents/${inc.id}/assess`, { answers: all });
    await call('legal', 'POST', `/incidents/${inc.id}/notifications/REGULATOR/draft`);
    const put = await call('admin', 'PUT', '/admin/residency', {
      country: 'NZ',
      allowedRegions: [],
      aiRegion: 'NZ',
      logRegion: 'NZ',
      reason: 'Move hosting to New Zealand for this test',
    });
    expect(put.statusCode, put.body).toBe(200);
    await sys((tx) =>
      tx
        .update(s.connector)
        .set({ enabled: true })
        .where(and(eq(s.connector.tenantId, TENANT_ID), eq(s.connector.kind, 'MESSAGING'))),
    );
    const r = await call('legal', 'POST', `/incidents/${inc.id}/notifications/REGULATOR/send`);
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe('RESIDENCY_VIOLATION');
    const v = (await call('admin', 'GET', '/admin/residency')).json() as Json;
    expect(v.recentRefusals.some((x: Json) => x.purpose === 'EMAIL_SMS')).toBe(true);
    const after = ((await call('legal', 'GET', `/incidents/${inc.id}`)).json() as Json).notifications[0];
    expect(after.status).toBe('DRAFT');
  });
});
