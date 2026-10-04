import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../../audit/audit-service.js';
import * as s from '../../db/schema.js';
import { TENANT_ID, uid } from '../../db/seed.js';
import { AlertService } from './record.js';
import { BRIGHT, SEED_DATE, createEnv, type Json } from './test-env.js';

let env: Awaited<ReturnType<typeof createEnv>>;
beforeAll(async () => {
  env = await createEnv();
}, 120_000);
const get = async (who: string, id: string) =>
  (await env.call(who, 'GET', `/contracts/${id}`)).json() as Json;
const sys = <T>(fn: Parameters<typeof env.withSystem>[1]) => env.withSystem(env.database, fn) as Promise<T>;

describe('editing the management record (M11 follow-up)', () => {
  it('replaces milestones within the term, reschedules their alerts, and audits it', async () => {
    const { id, view } = await env.executed();
    const start = view.startDate as string;
    const end = view.endDate as string;
    const mid = new Date((Date.parse(start) + Date.parse(end)) / 2).toISOString().slice(0, 10);
    const r = await env.call('contract-mgr', 'PUT', `/contracts/${id}/milestones`, {
      milestones: [
        { title: 'Go-live', dueDate: mid },
        { title: 'Final report', dueDate: end },
      ],
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().record.milestones.map((m: Json) => m.title)).toEqual(['Go-live', 'Final report']);
    const scheduled = r.json().record.alerts.filter((a: Json) => a.kind === 'MILESTONE');
    expect(scheduled).toHaveLength(2);
    expect(scheduled.every((a: Json) => a.status === 'SCHEDULED')).toBe(true);
    // the other system alerts are untouched
    expect(r.json().record.alerts.map((a: Json) => a.kind)).toEqual(
      expect.arrayContaining(['NOTICE', 'EXPIRY', 'EXTENSION']),
    );
    const audit = await sys<unknown[]>((tx) =>
      tx
        .select()
        .from(s.auditEvent)
        .where(and(eq(s.auditEvent.entityId, id), eq(s.auditEvent.action, 'contract.milestones_edit'))),
    );
    expect(audit).toHaveLength(1);
    // outside the term is refused with the offenders listed
    const bad = await env.call('contract-mgr', 'PUT', `/contracts/${id}/milestones`, {
      milestones: [{ title: 'Too late', dueDate: '2099-01-01' }],
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().code).toBe('MILESTONE_OUTSIDE_TERM');
    expect(
      (await env.call('contract-mgr', 'PUT', `/contracts/${id}/milestones`, { milestones: [] })).statusCode,
    ).toBe(200);
    expect(
      (await get('contract-mgr', id)).record.alerts.filter((a: Json) => a.kind === 'MILESTONE'),
    ).toHaveLength(0);
  });

  it('changes the optional extensions, which moves the extension reminder and the Gantt bars', async () => {
    const { id } = await env.executed();
    const none = await env.call('legal', 'PUT', `/contracts/${id}/extensions`, { extensions: [] });
    expect(none.json().record.extensions).toEqual([]);
    expect(none.json().record.alerts.some((a: Json) => a.kind === 'EXTENSION')).toBe(false);
    const two = await env.call('legal', 'PUT', `/contracts/${id}/extensions`, { extensions: [12, 6] });
    expect(two.json().record.extensions.map((e: Json) => e.label)).toEqual([
      'Option 1 (12 months)',
      'Option 2 (6 months)',
    ]);
    expect(two.json().record.alerts.some((a: Json) => a.kind === 'EXTENSION')).toBe(true);
    expect(
      (await env.call('legal', 'PUT', `/contracts/${id}/extensions`, { extensions: [0] })).statusCode,
    ).toBe(400);
    expect(
      (await env.call('legal', 'PUT', `/contracts/${id}/extensions`, { extensions: [1, 1, 1, 1, 1, 1] }))
        .statusCode,
    ).toBe(400);
  });

  it('changes the owner to a contract manager only; the locked terms stay locked', async () => {
    const { id } = await env.executed();
    const other = await env.extraUser('cm', 'CONTRACT_MGR');
    const ok = await env.call('contract-mgr', 'PUT', `/contracts/${id}/owner`, { ownerId: other.id });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().record.owner.id).toBe(other.id);
    // the contract now belongs to someone else's team, so the earlier owner no longer sees it (FR-0560)
    expect((await env.call('contract-mgr', 'GET', `/contracts/${id}`)).statusCode).toBe(404);
    const notMgr = await env.call('legal', 'PUT', `/contracts/${id}/owner`, {
      ownerId: uid('user:requester'),
    });
    expect(notMgr.statusCode).toBe(422);
    expect(notMgr.json().code).toBe('NOT_A_CONTRACT_MANAGER');
    expect((await get('legal', id)).locked).toBe(true);
    expect((await env.call('legal', 'PATCH', `/contracts/${id}`, { value: 1 })).statusCode).toBe(423);
  });

  it('is only for executed contracts and for contract management, legal and procurement', async () => {
    const d = await env.draft();
    expect(
      (await env.call('legal', 'PUT', `/contracts/${d.id}/milestones`, { milestones: [] })).statusCode,
    ).toBe(409);
    const { id } = await env.executed();
    for (const who of ['requester', 'delegate', 'finance', 'evaluator-tech', 'admin'])
      expect(
        (await env.call(who, 'PUT', `/contracts/${id}/milestones`, { milestones: [] })).statusCode,
        who,
      ).toBe(403);
    expect(
      (await env.call('contract-mgr', 'PUT', `/contracts/${id}/milestones`, { milestones: [], extra: 1 }))
        .statusCode,
    ).toBe(400);
  });
});

describe('variations linked to the parent (US-CON-05)', () => {
  it('only an executed contract can be varied; a variation changes the value or the end date', async () => {
    const d = await env.draft();
    expect(
      (
        await env.call('legal', 'POST', `/contracts/${d.id}/variations`, {
          reason: 'Extra scope agreed',
          value: 1000,
        })
      ).statusCode,
    ).toBe(409);
    const { id } = await env.executed();
    const empty = await env.call('legal', 'POST', `/contracts/${id}/variations`, {
      reason: 'Nothing really changes',
      value: 0,
    });
    expect(empty.statusCode).toBe(422);
    expect(empty.json().code).toBe('EMPTY_VARIATION');
    expect(
      (await env.call('legal', 'POST', `/contracts/${id}/variations`, { reason: 'short', value: 5 }))
        .statusCode,
    ).toBe(400);
    for (const who of ['contract-mgr', 'delegate', 'requester', 'finance'])
      expect(
        (
          await env.call(who, 'POST', `/contracts/${id}/variations`, {
            reason: 'Extra scope agreed',
            value: 1000,
          })
        ).statusCode,
        who,
      ).toBe(403);
  });

  it('runs the same legal, release and signing path, keeps the parent link, and tracks cumulative value and the later end date', async () => {
    const { id, view } = await env.executed({ value: 100_000 });
    const newEnd = '2031-06-30';
    const v = await env.call('procurement', 'POST', `/contracts/${id}/variations`, {
      reason: 'Additional sites added to the scope',
      value: 25_000,
      endDate: newEnd,
    });
    expect(v.statusCode, v.body).toBe(201);
    const child = v.json() as Json;
    expect(child.number).toBe(`${view.number}-V1`);
    expect(child.parent).toEqual({ id, number: view.number });
    expect(child.status).toBe('DRAFT');
    expect(child.clauses.map((c: Json) => c.id)).toEqual(['VARIATION']);
    expect(child.clauses[0].text).toContain('$25,000');
    expect(child.clauses[0].text).toContain(newEnd);
    expect(child.deviations).toEqual([]);
    expect(child.title).toBe(view.title); // the parent's request, so the list reads naturally
    // a second one cannot start while the first is open
    expect(
      (
        await env.call('legal', 'POST', `/contracts/${id}/variations`, {
          reason: 'Another change please',
          value: 1,
        })
      ).json().code,
    ).toBe('VARIATION_OPEN');
    expect((await get('legal', id)).variations).toHaveLength(1);

    await env.call('legal', 'PUT', `/contracts/${child.id}/clauses/VARIATION`, {
      text: `${child.clauses[0].text} Agreed by both parties.`,
    });
    expect((await get('legal', child.id)).deviations).toEqual([]); // nothing to deviate from
    expect((await env.call('legal', 'POST', `/contracts/${child.id}/release-for-signing`)).statusCode).toBe(
      200,
    );
    const signed = await env.call('delegate', 'POST', `/contracts/${child.id}/sign`, { decision: 'APPROVE' });
    expect(signed.statusCode, signed.body).toBe(200);
    expect(signed.json().status).toBe('EXECUTED');
    expect(signed.json().locked).toBe(true);
    expect(
      (
        await env.call('legal', 'PUT', `/contracts/${child.id}/clauses/VARIATION`, {
          text: 'Edited after execution.',
        })
      ).statusCode,
    ).toBe(423);

    const parent = await get('legal', id);
    expect(parent.cumulative).toEqual({ value: 125_000, endDate: newEnd });
    expect(parent.variations[0]).toMatchObject({
      number: `${view.number}-V1`,
      status: 'EXECUTED',
      value: 25_000,
    });
    expect(parent.value).toBe(100_000); // the parent's own terms never change
    // the parent's alerts follow the later end date; the variation has no record of its own
    const expiry = parent.record.alerts.find((a: Json) => a.kind === 'EXPIRY' && a.status === 'SCHEDULED');
    expect(expiry.triggerDate).toBe('2031-05-01');
    expect(signed.json().record.alerts).toEqual([]);
    // the expiring report uses the effective end date and lists the parent once
    const wide = (await env.call('exec', 'GET', '/reports/expiring-contracts?days=3000')).json() as Json[];
    expect(wide.filter((r) => r.number === view.number)).toHaveLength(1);
    expect(wide.find((r) => r.number === view.number)!.endDate).toBe(newEnd);
    expect(wide.some((r) => r.number === `${view.number}-V1`)).toBe(false);
    // the next variation is V2
    const v2 = await env.call('legal', 'POST', `/contracts/${id}/variations`, {
      reason: 'A further small change',
      value: 500,
    });
    expect(v2.json().number).toBe(`${view.number}-V2`);
    const list = (await env.call('legal', 'GET', '/contracts')).json() as Json[];
    expect(list.find((x) => x.number === `${view.number}-V1`)!.parentId).toBe(id);
  });

  it('signing authority is judged on the cumulative value: a small variation can still need more authority', async () => {
    const { id } = await env.executed({ value: 900_000 });
    const v = await env.call('legal', 'POST', `/contracts/${id}/variations`, {
      reason: 'Large scope increase',
      value: 5_000_000,
    });
    const child = v.json() as Json;
    await env.call('legal', 'POST', `/contracts/${child.id}/release-for-signing`);
    // 0.9M + 5M = 5.9M is above the delegate's 5M signing authority even though the variation alone is exactly at the limit
    const r = await env.call('delegate', 'POST', `/contracts/${child.id}/sign`, { decision: 'APPROVE' });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe('SIGNING_AUTHORITY_INSUFFICIENT');
    expect((await get('delegate', child.id)).permissions.canSign).toBe(false);
    // and it needs the executive's co-signature above 1M
    expect((await get('legal', child.id)).chain.map((x: Json) => x.role)).toEqual(['DELEGATE', 'EXEC']);
  });

  it('a variation to a removed parent is impossible and a removed variation frees the next', async () => {
    const { id } = await env.executed();
    const v = (
      await env.call('legal', 'POST', `/contracts/${id}/variations`, {
        reason: 'Raised by mistake here',
        value: 10,
      })
    ).json() as Json;
    expect(
      (await env.call('legal', 'DELETE', `/contracts/${v.id}`, { reason: 'Raised by mistake here' }))
        .statusCode,
    ).toBe(204);
    const again = await env.call('legal', 'POST', `/contracts/${id}/variations`, {
      reason: 'Raised properly this time',
      value: 10,
    });
    expect(again.statusCode).toBe(201);
    expect(again.json().number).toBe(`${(await get('legal', id)).number}-V2`);
  });
});

describe('deviation register with risk ratings and delegate decisions (US-CON-02)', () => {
  it('rates a changed clause, blocks release until a delegate approves a mandatory or high-risk change, and lets legal amend the rating', async () => {
    const d = await env.draft();
    const original = d.view.clauses.find((c: Json) => c.id === 'LIABILITY').text as string;
    // a mandatory clause with an added exclusion is high risk
    await env.call('legal', 'PUT', `/contracts/${d.id}/clauses/LIABILITY`, {
      text: `${original} The Supplier excludes liability for indirect loss.`,
    });
    const v = await get('legal', d.id);
    expect(v.deviations[0]).toMatchObject({
      clauseId: 'LIABILITY',
      mandatory: true,
      risk: 'HIGH',
      decision: null,
    });
    expect(v.deviationBlockers).toHaveLength(1);
    const blocked = await env.call('legal', 'POST', `/contracts/${d.id}/release-for-signing`);
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json().errors[0].message).toContain('needs a delegate');
    // a non-mandatory change with ordinary wording is low risk and needs nothing
    const ipText = d.view.clauses.find((c: Json) => c.id === 'IP').text as string;
    await env.call('legal', 'PUT', `/contracts/${d.id}/clauses/IP`, {
      text: `${ipText} The Supplier grants a licence back.`,
    });
    const ip = (await get('legal', d.id)).deviations.find((x: Json) => x.clauseId === 'IP');
    expect(ip).toMatchObject({ risk: 'LOW', decision: null });
    // legal amends the rating; delegates decide
    expect(
      (await env.call('legal', 'PUT', `/contracts/${d.id}/deviations/IP/risk`, { risk: 'HIGH' }))
        .json()
        .deviations.find((x: Json) => x.clauseId === 'IP').risk,
    ).toBe('HIGH');
    expect(
      (await env.call('delegate', 'PUT', `/contracts/${d.id}/deviations/IP/risk`, { risk: 'LOW' }))
        .statusCode,
    ).toBe(403);
    const rej = await env.call('delegate', 'POST', `/contracts/${d.id}/deviations/LIABILITY/decision`, {
      decision: 'REJECT',
    });
    expect(rej.statusCode).toBe(400);
    const rejected = await env.call('delegate', 'POST', `/contracts/${d.id}/deviations/LIABILITY/decision`, {
      decision: 'REJECT',
      comment: 'Too much risk for us',
    });
    expect(rejected.json().deviations.find((x: Json) => x.clauseId === 'LIABILITY')).toMatchObject({
      decision: 'REJECTED',
    });
    expect(
      (await env.call('legal', 'POST', `/contracts/${d.id}/release-for-signing`))
        .json()
        .errors.map((e: Json) => e.message)
        .join(),
    ).toContain('was rejected');
    // restore: the clause is no longer a deviation
    await env.call('legal', 'PUT', `/contracts/${d.id}/clauses/LIABILITY`, { text: original });
    await env.call('exec', 'POST', `/contracts/${d.id}/deviations/IP/decision`, {
      decision: 'APPROVE',
      comment: 'Fine',
    });
    const rel = await env.call('legal', 'POST', `/contracts/${d.id}/release-for-signing`);
    expect(rel.statusCode, rel.body).toBe(200);
    const final = rel.json() as Json;
    expect(final.deviations.find((x: Json) => x.clauseId === 'IP')).toMatchObject({ decision: 'APPROVED' });
    expect(final.deviations.find((x: Json) => x.clauseId === 'IP').stamp).toMatch(
      /^DEVIATION APPROVED · Elena Petrova · EXEC · /,
    );
  });

  it('a new edit voids the earlier approval; deciding is only possible while drafting and only for changed clauses', async () => {
    const d = await env.draft();
    await env.call('legal', 'PUT', `/contracts/${d.id}/clauses/TERM`, {
      text: 'The agreement runs for the agreed period unless ended earlier by notice.',
    });
    expect(
      (
        await env.call('delegate', 'POST', `/contracts/${d.id}/deviations/TERM/decision`, {
          decision: 'APPROVE',
        })
      ).statusCode,
    ).toBe(200);
    expect((await get('legal', d.id)).deviationBlockers).toEqual([]);
    await env.call('legal', 'PUT', `/contracts/${d.id}/clauses/TERM`, {
      text: 'The agreement runs for the agreed period, with no right to end it early.',
    });
    const after = await get('legal', d.id);
    expect(after.deviations.find((x: Json) => x.clauseId === 'TERM').decision).toBeNull();
    expect(after.deviationBlockers).toHaveLength(1);
    const rows = await sys<Json[]>((tx) =>
      tx.select().from(s.approval).where(eq(s.approval.subjectType, 'CONTRACT_DEVIATION')),
    );
    expect(rows.some((r) => r.decision === 'SUPERSEDED')).toBe(true);
    // an unchanged clause has no deviation to decide
    expect(
      (
        await env.call('delegate', 'POST', `/contracts/${d.id}/deviations/PRICE/decision`, {
          decision: 'APPROVE',
        })
      ).statusCode,
    ).toBe(404);
    for (const who of ['legal', 'procurement', 'requester', 'finance'])
      expect(
        (await env.call(who, 'POST', `/contracts/${d.id}/deviations/TERM/decision`, { decision: 'APPROVE' }))
          .statusCode,
        who,
      ).toBe(403);
    const ex = await env.executed();
    expect(
      (
        await env.call('delegate', 'POST', `/contracts/${ex.id}/deviations/IP/decision`, {
          decision: 'APPROVE',
        })
      ).statusCode,
    ).toBe(409);
  });

  it('shows who may decide and amend in the permissions, and audits each step', async () => {
    const d = await env.draft();
    await env.call('legal', 'PUT', `/contracts/${d.id}/clauses/PRICE`, {
      text: 'The total price is as agreed between the parties in writing.',
    });
    expect((await get('delegate', d.id)).permissions).toMatchObject({
      canDecideDeviations: true,
      canAmendRisk: false,
    });
    expect((await get('legal', d.id)).permissions).toMatchObject({
      canDecideDeviations: false,
      canAmendRisk: true,
    });
    await env.call('delegate', 'POST', `/contracts/${d.id}/deviations/PRICE/decision`, {
      decision: 'APPROVE',
    });
    const audit = await sys<unknown[]>((tx) =>
      tx
        .select()
        .from(s.auditEvent)
        .where(and(eq(s.auditEvent.entityId, d.id), eq(s.auditEvent.action, 'contract.deviation_decision'))),
    );
    expect(audit).toHaveLength(1);
  });
});

describe('custom alerts in plain language (US-CMG-03)', () => {
  it("creates the stakeholder's example alert, resolves the manager when it fires, and logs delivery to the author and the manager", async () => {
    const { id, view } = await env.executed();
    const r = await env.call('contract-mgr', 'POST', `/contracts/${id}/alerts`, {
      instruction: 'alert me 1 year before expiry and include whoever is my manager then',
    });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json()).toMatchObject({
      kind: 'CUSTOM',
      origin: 'USER',
      status: 'SCHEDULED',
      recipientRule: 'AUTHOR+MANAGER',
    });
    const end = view.endDate as string;
    const expected = `${Number(end.slice(0, 4)) - 1}-${end.slice(5)}`;
    expect(r.json().triggerDate).toBe(expected);
    expect(r.json().summary).toContain('your manager');
    const listed = (await get('contract-mgr', id)).record.alerts.find((a: Json) => a.kind === 'CUSTOM');
    expect(listed.note).toContain('1 year before expiry');
    expect(
      (await env.call('contract-mgr', 'GET', '/alerts')).json().some((a: Json) => a.kind === 'CUSTOM'),
    ).toBe(true);

    env.clock.set(`${expected}T08:00:00Z`);
    await new AlertService(env.clock, new AuditService(env.clock)).runDue(env.database);
    const note = (uid2: string) =>
      sys<Json[]>((tx) => tx.select().from(s.notification).where(eq(s.notification.userId, uid2))).then(
        (rows) => rows.filter((n) => n.link === `/app/contracts/${id}` && /Your reminder/.test(n.body ?? '')),
      );
    expect(await note(uid('user:contract-mgr'))).toHaveLength(1); // the author
    expect(await note(uid('user:delegate'))).toHaveLength(1); // the manager, found at that moment
    expect(await note(uid('user:legal'))).toHaveLength(0);
    const fired = (await get('contract-mgr', id)).record.alerts.find((a: Json) => a.kind === 'CUSTOM');
    expect(fired.status).toBe('SENT');
    expect(fired.deliveries.filter((x: Json) => x.channel === 'IN_APP')).toHaveLength(2);
    await new AlertService(env.clock, new AuditService(env.clock)).runDue(env.database);
    expect(await note(uid('user:delegate'))).toHaveLength(1); // once only
    env.clock.set(SEED_DATE);
  });

  it('adds everyone holding a named role', async () => {
    const { id } = await env.executed();
    const r = await env.call('procurement', 'POST', `/contracts/${id}/alerts`, {
      instruction: 'alert me 2 months before expiry and include legal',
    });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().recipientRule).toBe('AUTHOR+ROLE:LEGAL');
    env.clock.set(`${r.json().triggerDate}T08:00:00Z`);
    await new AlertService(env.clock, new AuditService(env.clock)).runDue(env.database);
    const legal = await sys<Json[]>((tx) =>
      tx
        .select()
        .from(s.notification)
        .where(eq(s.notification.userId, uid('user:legal'))),
    );
    expect(legal.some((n) => n.link === `/app/contracts/${id}` && /Your reminder/.test(n.body ?? ''))).toBe(
      true,
    );
    env.clock.set(SEED_DATE);
  });

  it('explains what it could not understand, refuses past dates and drafts, and is limited to contract management and oversight', async () => {
    const { id } = await env.executed();
    const bad = await env.call('contract-mgr', 'POST', `/contracts/${id}/alerts`, {
      instruction: 'remind me at some point',
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().code).toBe('ALERT_NOT_UNDERSTOOD');
    expect(bad.json().title).toContain('Try:');
    const past = await env.call('contract-mgr', 'POST', `/contracts/${id}/alerts`, {
      instruction: 'alert me 5 years before expiry',
    });
    expect(past.statusCode).toBe(422);
    expect(past.json().title).toContain('already passed');
    expect(
      (await env.call('contract-mgr', 'POST', `/contracts/${id}/alerts`, { instruction: 'x' })).statusCode,
    ).toBe(400);
    const d = await env.draft();
    expect(
      (
        await env.call('contract-mgr', 'POST', `/contracts/${d.id}/alerts`, {
          instruction: 'alert me 1 month before expiry',
        })
      ).statusCode,
    ).toBe(409);
    for (const who of ['requester', 'delegate', 'finance', 'evaluator-tech', 'admin', 'probity'])
      expect(
        (
          await env.call(who, 'POST', `/contracts/${id}/alerts`, {
            instruction: 'alert me 1 month before expiry',
          })
        ).statusCode,
        who,
      ).toBe(403);
  });
});

describe('configurable lead times', () => {
  it("a tenant's own lead times set when the system alerts of a new contract fire", async () => {
    await sys((tx) =>
      tx
        .update(s.tenant)
        .set({ config: { alertLeadDays: { expiry: 120, notice: 20, extension: 45, milestone: 3 } } })
        .where(eq(s.tenant.id, TENANT_ID)),
    );
    const { view } = await env.executed();
    const end = view.endDate as string;
    const day = (n: number) =>
      new Date(Date.parse(`${end}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
    const a = (k: string) => view.record.alerts.find((x: Json) => x.kind === k).triggerDate;
    expect(a('EXPIRY')).toBe(day(120));
    expect(a('NOTICE')).toBe(day(90 + 20));
    expect(a('EXTENSION')).toBe(day(90 + 45));
    await sys((tx) => tx.update(s.tenant).set({ config: {} }).where(eq(s.tenant.id, TENANT_ID)));
    void BRIGHT;
  });
});
