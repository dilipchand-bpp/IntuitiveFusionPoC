import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import * as s from '../../db/schema.js';
import { uid } from '../../db/seed.js';
import { BRIGHT, createEnv, type Json } from '../contract/test-env.js';
import {
  checkSmsNote,
  maskPhone,
  simulatedGateway,
  smsFor,
  syntheticPhone,
  SMS_LIMIT,
} from './continuity.js';

let env: Awaited<ReturnType<typeof createEnv>>;
const call = (...a: Parameters<typeof env.call>) => env.call(...a);
const sys = <T>(fn: Parameters<typeof env.withSystem>[1]) => env.withSystem(env.database, fn) as Promise<T>;
beforeAll(async () => {
  env = await createEnv();
}, 120_000);

const minutes = (n: number) => env.clock.advanceMs(n * 60_000);
const anon = (method: 'GET' | 'POST', path: string, payload?: unknown) =>
  env.app.inject({ method, url: `/api/v1${path}`, ...(payload ? { payload: payload as object } : {}) });
const tokenOf = (path: string) => path.replace('/respond/', '');

async function raise(over: Json = {}, who = 'procurement'): Promise<Json> {
  const x = over.contractIds ? null : await env.executed();
  const r = await call(who, 'POST', '/continuity/events', {
    title: 'Brightwave depot outage',
    kind: 'SUPPLIER_OUTAGE',
    severity: 'HIGH',
    message: 'The supplier depot lost power. Cleaning visits are suspended until further notice.',
    supplierIds: [BRIGHT],
    contractIds: x ? [x.id] : [],
    groups: ['CONTRACT_OWNER', 'SUPPLIER_CONTACT', 'EXECUTIVE'],
    ...over,
  });
  expect(r.statusCode, r.body).toBe(201);
  return { ...(r.json() as Json), contractNumber: x ? ((x.view as Json).number as string) : null };
}
const tracker = async (id: string, who = 'procurement') => {
  const r = await call(who, 'GET', `/continuity/events/${id}`);
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as Json;
};
const linkFor = (ev: Json, name: string) => (ev.simulatedLinks as Json[]).find((l) => l.name === name)!;

describe('FR-0860 the text of an alert', () => {
  it('builds a plain SMS that fits one message and never carries commercial detail', () => {
    const t = smsFor({
      kind: 'SUPPLIER_OUTAGE',
      severity: 'CRITICAL',
      number: 'BC-0001',
      note: 'Stay clear of the depot',
    });
    expect(t.length).toBeLessThanOrEqual(SMS_LIMIT);
    expect(t).toContain('BC-0001');
    expect(checkSmsNote('Stay clear of the depot', ['Brightwave Cleaning Pty Ltd'])).toBeNull();
    expect(checkSmsNote('Brightwave Cleaning is down', ['Brightwave Cleaning Pty Ltd'])).toMatch(
      /must not name a supplier/,
    );
    expect(checkSmsNote('See CON-0007 now', [])).toMatch(/numbers, amounts or identifiers/);
    expect(checkSmsNote('Loss of $250,000', [])).toBeTruthy();
    expect(checkSmsNote('ABN 12345678901', [])).toBeTruthy();
    expect(checkSmsNote('x'.repeat(41), [])).toMatch(/40 characters/);
    expect(checkSmsNote('<script>', [])).toMatch(/plain/);
  });
  it('simulated gateway ids are stable; an unreachable number and a bounce mailbox fail', () => {
    const a = simulatedGateway('e1', [
      { id: 'm1', channel: 'SMS', to: '+61 400 111 222', attempt: 1 },
      { id: 'm2', channel: 'SMS', to: '+61 400 000 0000', attempt: 1 },
      { id: 'm3', channel: 'EMAIL', to: 'someone@bounce.example', attempt: 1 },
      { id: 'm4', channel: 'EMAIL', to: 'ok@x.example', attempt: 1 },
    ]);
    expect(a.map((x) => x.ok)).toEqual([true, false, false, true]);
    expect(a[0]!.gatewayId).toMatch(/^SMS-[0-9A-F]{10}$/);
    expect(a[3]!.gatewayId).toMatch(/^EML-[0-9A-F]{10}$/);
    expect(
      simulatedGateway('e1', [{ id: 'm1', channel: 'SMS', to: '+61 400 111 222', attempt: 1 }])[0]!.gatewayId,
    ).toBe(a[0]!.gatewayId);
    expect(
      simulatedGateway('e1', [{ id: 'm1', channel: 'SMS', to: '+61 400 111 222', attempt: 2 }])[0]!.gatewayId,
    ).not.toBe(a[0]!.gatewayId);
    expect(syntheticPhone('a@x.example')).toMatch(/^\+61 4\d\d \d{3} \d{3}$/);
    expect(syntheticPhone('a@x.example')).toBe(syntheticPhone('A@x.example'));
    expect(maskPhone('+61 412 345 678')).toBe('+61 41•• •••678');
  });
});

describe('FR-0860 raising an event and reaching people by SMS and email', () => {
  it('works out the recipients from the data and sends an SMS and an email to each through the simulated gateway', async () => {
    const ev = await raise();
    expect(ev.simulated).toBe(true);
    expect(ev.event).toMatchObject({
      number: expect.stringMatching(/^BC-\d{4}$/),
      severity: 'HIGH',
      status: 'OPEN',
      kindLabel: 'Supplier outage',
    });
    const names = ev.recipients.map((r: Json) => r.name);
    expect(names).toContain('Sam Brightwave'); // a contact of the affected supplier
    expect(names).toContain('Elena Petrova'); // an executive
    const groups = new Set(ev.recipients.map((r: Json) => r.group));
    expect(groups).toEqual(expect.objectContaining(new Set(['SUPPLIER_CONTACT', 'EXECUTIVE'])));
    for (const r of ev.recipients) {
      expect(r.channels.map((c: Json) => c.channel)).toEqual(['SMS', 'EMAIL']);
      expect(r.channels[0].gatewayId).toMatch(/^SMS-/);
      expect(r.channels[1].gatewayId).toMatch(/^EML-/);
      expect(r.channels.every((c: Json) => c.status === 'SENT')).toBe(true);
      expect(r.reached).toBe(true);
      expect(r.phone).toMatch(/^\+61 4\d•• •••\d{3}$/);
      expect(r.response).toBe('NONE');
    }
    expect(ev.counts).toMatchObject({
      recipients: ev.recipients.length,
      noResponse: ev.recipients.length,
      reached: ev.recipients.length,
      notReached: 0,
      failed: 0,
      queued: 0,
    });
    expect(ev.simulatedLinks).toHaveLength(ev.recipients.length);
    expect(ev.simulatedLinks[0].path).toMatch(/^\/respond\/[\w-]{22}$/);
    expect(ev.event.affectedContracts).toEqual([ev.contractNumber]);
    expect(ev.event.affectedSuppliers).toEqual(['Brightwave Cleaning Pty Ltd']);
  });

  it('keeps supplier-confidential detail out of every SMS and out of supplier emails, and never logs a one-time link', async () => {
    const ev = await raise({ smsNote: 'Stay clear of the depot' });
    const sms = ev.log.filter((m: Json) => m.channel === 'SMS');
    expect(sms.length).toBeGreaterThan(0);
    for (const m of sms) {
      expect(m.body.length).toBeLessThanOrEqual(SMS_LIMIT);
      expect(m.body).not.toMatch(/Brightwave/i);
      expect(m.body).not.toContain(ev.contractNumber);
      expect(m.body).not.toMatch(/\$|ABN/);
      expect(m.body).toContain(ev.event.number);
      expect(m.body).toContain('[one-time link]');
      expect(m.to).toMatch(/^\+61 4\d•• •••\d{3}$/);
    }
    // emails: staff are told which suppliers and contracts, a supplier contact only about their own organisation
    const exec = ev.log.find((m: Json) => m.channel === 'EMAIL' && m.toName === 'Elena Petrova');
    expect(exec.body).toContain('Brightwave Cleaning Pty Ltd');
    expect(exec.body).toContain(ev.contractNumber);
    const sup = ev.log.find((m: Json) => m.channel === 'EMAIL' && m.toName === 'Sam Brightwave');
    expect(sup.body).toContain('Brightwave Cleaning Pty Ltd');
    expect(sup.body).not.toContain(ev.contractNumber);
    // no stored message or response row holds a token
    const tokens = (ev.simulatedLinks as Json[]).map((l) => tokenOf(l.path));
    const rows = await sys<Json[]>((tx) => tx.select().from(s.continuityMessage));
    const resp = await sys<Json[]>((tx) => tx.select().from(s.continuityResponse));
    const blob = JSON.stringify([rows, resp]);
    for (const t of tokens) expect(blob).not.toContain(t);
    const audit = JSON.stringify(await sys<Json[]>((tx) => tx.select().from(s.auditEvent)));
    for (const t of tokens) expect(audit).not.toContain(t);
    // people with an account also get the link in their notifications
    const notes = await sys<Json[]>((tx) =>
      tx
        .select()
        .from(s.notification)
        .where(eq(s.notification.userId, uid('user:exec'))),
    );
    expect(
      notes.some(
        (n) =>
          n.link ===
          `/respond/${tokenOf(ev.simulatedLinks.find((l: Json) => l.name === 'Elena Petrova').path)}`,
      ),
    ).toBe(true);
  });

  it('refuses a text message note that names a supplier or a contract, and a raise nobody would receive', async () => {
    const x = await env.executed();
    const base = {
      title: 'Depot outage',
      kind: 'SUPPLIER_OUTAGE',
      severity: 'LOW',
      message: 'The depot is closed for the day.',
      supplierIds: [BRIGHT],
      contractIds: [x.id],
      groups: ['EXECUTIVE'],
    };
    const name = await call('procurement', 'POST', '/continuity/events', {
      ...base,
      smsNote: 'Brightwave is down',
    });
    expect(name.statusCode).toBe(422);
    expect(name.json().code).toBe('SMS_NOT_PLAIN');
    const num = await call('procurement', 'POST', '/continuity/events', {
      ...base,
      smsNote: `See ${(x.view as Json).number}`,
    });
    expect(num.statusCode).toBe(422);
    const long = await call('procurement', 'POST', '/continuity/events', {
      ...base,
      smsNote: 'x'.repeat(41),
    });
    expect(long.statusCode).toBe(400);
    const none = await call('procurement', 'POST', '/continuity/events', {
      ...base,
      groups: ['CONTRACT_OWNER'],
      contractIds: [],
      supplierIds: [BRIGHT],
    });
    expect(none.statusCode).toBe(422);
    expect(none.json().code).toBe('NO_RECIPIENTS');
    const noAffected = await call('procurement', 'POST', '/continuity/events', {
      ...base,
      supplierIds: [],
      contractIds: [],
    });
    expect(noAffected.statusCode).toBe(422);
    const named = await call('procurement', 'POST', '/continuity/events', { ...base, groups: ['NAMED'] });
    expect(named.statusCode).toBe(400);
    expect(
      (await call('procurement', 'POST', '/continuity/events', { ...base, contractIds: [uid('nope')] }))
        .statusCode,
    ).toBe(422);
  });

  it('PROCUREMENT, CONTRACT_MGR and EXEC raise; LEGAL may only look; nobody else may do either', async () => {
    const body = {
      title: 'Site closed',
      kind: 'SITE_CLOSURE',
      severity: 'MEDIUM',
      message: 'The head office is closed today.',
      groups: ['EXECUTIVE'],
    };
    for (const who of ['procurement', 'contract-mgr', 'exec'])
      expect((await call(who, 'POST', '/continuity/events', body)).statusCode, who).toBe(201);
    for (const who of ['legal', 'requester', 'finance', 'delegate', 'admin', 'probity', 'supplier'])
      expect((await call(who, 'POST', '/continuity/events', body)).statusCode, who).toBe(403);
    for (const who of ['procurement', 'contract-mgr', 'exec', 'legal'])
      expect((await call(who, 'GET', '/continuity/events')).statusCode, who).toBe(200);
    for (const who of ['requester', 'finance', 'delegate', 'admin', 'probity', 'supplier'])
      expect((await call(who, 'GET', '/continuity/events')).statusCode, who).toBe(403);
    expect((await call('legal', 'GET', '/continuity/options')).statusCode).toBe(403);
    const o = (await call('procurement', 'GET', '/continuity/options')).json() as Json;
    expect(o.kinds.map((k: Json) => k.key)).toEqual([
      'SUPPLIER_OUTAGE',
      'SITE_CLOSURE',
      'CYBER_INCIDENT',
      'OTHER',
    ]);
    expect(o.suppliers.some((x: Json) => x.id === BRIGHT)).toBe(true);
    expect(o.contracts.length).toBeGreaterThan(0);
    expect(o.defaults).toEqual({ escalateAfterMinutes: 30, responseValidHours: 48 });
  });

  it('reaches named contacts, and shows a failed channel and who was not reached', async () => {
    const ev = await raise({
      kind: 'SITE_CLOSURE',
      supplierIds: [],
      contractIds: [uid('none')].slice(0, 0),
      title: 'Warehouse closed',
      message: 'The warehouse is closed because of flooding.',
      groups: ['NAMED'],
      namedContacts: [
        { name: 'Bounce Person', email: 'gone@bounce.example', phone: '+61 400 000 0000' },
        { name: 'Fine Person', email: 'fine@x.example', phone: '+61 400 123 456' },
        { name: 'Half Person', email: 'half@x.example', phone: '+61 400 000 0000' },
      ],
    });
    const by = (n: string) => ev.recipients.find((r: Json) => r.name === n);
    expect(by('Fine Person').reached).toBe(true);
    expect(by('Bounce Person').reached).toBe(false);
    expect(by('Bounce Person').channels.map((c: Json) => c.status)).toEqual(['FAILED', 'FAILED']);
    expect(by('Bounce Person').channels[0].failure).toMatch(/cannot be reached/);
    expect(by('Half Person').reached).toBe(true); // the email got through
    expect(ev.counts).toMatchObject({ recipients: 3, reached: 2, notReached: 1, failed: 3 });
  });
});

describe('FR-0860 response tracker, one-time links and answers by phone', () => {
  it('answers from the link without signing in, once per person, changeable until the event is closed', async () => {
    const ev = await raise();
    const link = linkFor(ev, 'Elena Petrova');
    const t = tokenOf(link.path);
    const view = await anon('GET', `/respond-links/${t}`);
    expect(view.statusCode, view.body).toBe(200);
    expect(view.json()).toMatchObject({
      number: ev.event.number,
      recipient: 'Elena Petrova',
      closed: false,
      response: null,
      options: ['SAFE', 'AFFECTED', 'NEED_HELP'],
    });
    // the page shows what the sender wrote, never other people or commercial detail
    expect(JSON.stringify(view.json())).not.toContain(ev.contractNumber);
    expect((await anon('POST', `/respond-links/${t}`, { response: 'MAYBE' })).statusCode).toBe(400);
    const first = await anon('POST', `/respond-links/${t}`, { response: 'SAFE', note: 'At home' });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toMatchObject({ response: 'SAFE', note: 'At home', changeCount: 0 });
    const changed = await anon('POST', `/respond-links/${t}`, { response: 'AFFECTED' });
    expect(changed.json()).toMatchObject({ response: 'AFFECTED', changeCount: 1 });
    const after = await tracker(ev.event.id);
    const row = after.recipients.find((r: Json) => r.name === 'Elena Petrova');
    expect(row).toMatchObject({ response: 'AFFECTED', via: 'WEB_LINK', changeCount: 1 });
    expect(after.counts).toMatchObject({ affected: 1, noResponse: ev.recipients.length - 1 });
    // one row per person: answering again never adds a second answer
    const rows = await sys<Json[]>((tx) =>
      tx.select().from(s.continuityResponse).where(eq(s.continuityResponse.eventId, ev.event.id)),
    );
    expect(rows).toHaveLength(ev.recipients.length);
    expect((rows.find((r) => r.name === 'Elena Petrova')!.history as Json[]).map((h) => h.response)).toEqual([
      'SAFE',
      'AFFECTED',
    ]);
    // need help tells the person who raised the event
    const sam = tokenOf(linkFor(ev, 'Sam Brightwave').path);
    await anon('POST', `/respond-links/${sam}`, { response: 'NEED_HELP' });
    const notes = await sys<Json[]>((tx) =>
      tx
        .select()
        .from(s.notification)
        .where(eq(s.notification.userId, uid('user:procurement'))),
    );
    expect(
      notes.some((n) => /needs help/.test(n.title as string) && /Sam Brightwave/.test(n.title as string)),
    ).toBe(true);
    expect((await anon('GET', `/respond-links/not-a-real-token-at-all-12345`)).statusCode).toBe(404);
  });

  it('a link expires, and a closed event no longer takes answers', async () => {
    const short = await raise({
      responseValidHours: 1,
      groups: ['EXECUTIVE'],
      supplierIds: [],
      contractIds: [uid('none')].slice(0, 0),
      kind: 'OTHER',
      title: 'Brief disruption',
      message: 'A brief disruption to the network is expected.',
    });
    const t = tokenOf(short.simulatedLinks[0].path);
    expect((await anon('GET', `/respond-links/${t}`)).statusCode).toBe(200);
    minutes(61);
    const gone = await anon('GET', `/respond-links/${t}`);
    expect(gone.statusCode).toBe(410);
    expect(gone.json().code).toBe('LINK_EXPIRED');
    expect((await anon('POST', `/respond-links/${t}`, { response: 'SAFE' })).statusCode).toBe(410);

    const ev = await raise({ groups: ['EXECUTIVE'] });
    const link = tokenOf(ev.simulatedLinks[0].path);
    await anon('POST', `/respond-links/${link}`, { response: 'SAFE' });
    const closed = await call('procurement', 'POST', `/continuity/events/${ev.event.id}/close`, {
      note: 'All clear.',
    });
    expect(closed.statusCode, closed.body).toBe(200);
    expect((await anon('GET', `/respond-links/${link}`)).json()).toMatchObject({
      closed: true,
      response: 'SAFE',
    });
    const late = await anon('POST', `/respond-links/${link}`, { response: 'AFFECTED' });
    expect(late.statusCode).toBe(409);
    expect(late.json().code).toBe('EVENT_CLOSED');
    expect((await call('procurement', 'POST', `/continuity/events/${ev.event.id}/close`)).statusCode).toBe(
      409,
    );
    expect((await call('procurement', 'POST', `/continuity/events/${ev.event.id}/resend`)).statusCode).toBe(
      409,
    );
  });

  it('staff record an answer taken by phone, who recorded it is kept, and a closed event refuses it', async () => {
    const ev = await raise();
    const sam = ev.recipients.find((r: Json) => r.name === 'Sam Brightwave');
    const r = await call('contract-mgr', 'POST', `/continuity/events/${ev.event.id}/responses/${sam.id}`, {
      response: 'NEED_HELP',
      note: 'Spoke by phone, no power at the depot',
    });
    expect(r.statusCode, r.body).toBe(200);
    const row = r.json().recipients.find((x: Json) => x.name === 'Sam Brightwave');
    expect(row).toMatchObject({
      response: 'NEED_HELP',
      via: 'STAFF_PHONE',
      note: 'Spoke by phone, no power at the depot',
    });
    const db = await sys<Json[]>((tx) =>
      tx.select().from(s.continuityResponse).where(eq(s.continuityResponse.id, sam.id)),
    );
    expect(db[0]!.recordedBy).toBe(uid('user:contract-mgr'));
    for (const who of ['legal', 'requester', 'supplier'])
      expect(
        (
          await call(who, 'POST', `/continuity/events/${ev.event.id}/responses/${sam.id}`, {
            response: 'SAFE',
          })
        ).statusCode,
        who,
      ).toBe(403);
    expect(
      (
        await call('procurement', 'POST', `/continuity/events/${ev.event.id}/responses/${uid('nobody')}`, {
          response: 'SAFE',
        })
      ).statusCode,
    ).toBe(404);
    await call('procurement', 'POST', `/continuity/events/${ev.event.id}/close`);
    expect(
      (
        await call('procurement', 'POST', `/continuity/events/${ev.event.id}/responses/${sam.id}`, {
          response: 'SAFE',
        })
      ).statusCode,
    ).toBe(409);
  });

  it('shows who has been reached and who has not answered, and resends to the non-responders only, with new links', async () => {
    const ev = await raise();
    const elena = linkFor(ev, 'Elena Petrova');
    await anon('POST', `/respond-links/${tokenOf(elena.path)}`, { response: 'SAFE' });
    const before = await tracker(ev.event.id);
    const silent = before.recipients.filter((r: Json) => r.response === 'NONE').map((r: Json) => r.name);
    expect(silent).not.toContain('Elena Petrova');
    expect(before.counts.noResponse).toBe(silent.length);
    const sentBefore = before.log.length;
    const res = await call('procurement', 'POST', `/continuity/events/${ev.event.id}/resend`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().resent).toBe(silent.length);
    expect(
      res
        .json()
        .simulatedLinks.map((l: Json) => l.name)
        .sort(),
    ).toEqual([...silent].sort());
    expect(res.json().log.length).toBe(sentBefore + silent.length * 2);
    expect(res.json().log.filter((m: Json) => m.kind === 'REMINDER')).toHaveLength(silent.length * 2);
    expect(
      res.json().log.filter((m: Json) => m.kind === 'REMINDER' && m.toName === 'Elena Petrova'),
    ).toHaveLength(0);
    expect(res.json().log.find((m: Json) => m.kind === 'REMINDER' && m.channel === 'EMAIL').body).toMatch(
      /^Hello .*\n\nReminder:/,
    );
    // the old link of someone who had not answered stops working; the new one works
    const sam = linkFor(ev, 'Sam Brightwave');
    expect((await anon('GET', `/respond-links/${tokenOf(sam.path)}`)).statusCode).toBe(404);
    const fresh = res.json().simulatedLinks.find((l: Json) => l.name === 'Sam Brightwave');
    expect((await anon('GET', `/respond-links/${tokenOf(fresh.path)}`)).statusCode).toBe(200);
    // a person who answered keeps their link, and their answer
    expect((await anon('GET', `/respond-links/${tokenOf(elena.path)}`)).json().response).toBe('SAFE');
    expect((await call('requester', 'POST', `/continuity/events/${ev.event.id}/resend`)).statusCode).toBe(
      403,
    );
  });

  it('records delivery receipts as time passes (SENT, then DELIVERED)', async () => {
    const ev = await raise({ groups: ['EXECUTIVE'] });
    expect(ev.recipients[0].channels.map((c: Json) => c.status)).toEqual(['SENT', 'SENT']);
    minutes(1);
    const one = await tracker(ev.event.id);
    expect(one.recipients[0].channels.map((c: Json) => c.status)).toEqual(['DELIVERED', 'SENT']); // SMS receipts come first
    minutes(2);
    const two = await tracker(ev.event.id);
    expect(two.recipients[0].channels.map((c: Json) => c.status)).toEqual(['DELIVERED', 'DELIVERED']);
    expect(two.recipients[0].channels[0].deliveredAt).toBeTruthy();
  });
});

describe('FR-0860 escalation and closing', () => {
  it('tells the named person, once, when people have still not answered after the set minutes (injected clock)', async () => {
    const proc = uid('user:procurement');
    const ev = await raise({
      escalateAfterMinutes: 5,
      escalateToUserId: proc,
      groups: ['EXECUTIVE', 'SUPPLIER_CONTACT'],
    });
    expect(ev.event.escalateTo).toBe('Priya Nair');
    minutes(4);
    expect((await tracker(ev.event.id)).event.escalatedAt).toBeNull();
    minutes(2);
    const t = await tracker(ev.event.id);
    expect(t.event.escalatedAt).toBeTruthy();
    const esc = t.log.filter((m: Json) => m.kind === 'ESCALATION');
    expect(esc.map((m: Json) => m.channel).sort()).toEqual(['EMAIL', 'SMS']);
    expect(esc.every((m: Json) => m.toName === 'Priya Nair')).toBe(true);
    const sms = esc.find((m: Json) => m.channel === 'SMS');
    expect(sms.body.length).toBeLessThanOrEqual(SMS_LIMIT);
    expect(sms.body).not.toMatch(/Brightwave|Sam |Elena/);
    expect(esc.find((m: Json) => m.channel === 'EMAIL').body).toContain('Sam Brightwave');
    const notes = await sys<Json[]>((tx) =>
      tx
        .select()
        .from(s.notification)
        .where(and(eq(s.notification.userId, proc))),
    );
    expect(notes.filter((n) => /Escalation/.test(n.title as string))).toHaveLength(1);
    // never twice
    minutes(30);
    expect((await tracker(ev.event.id)).log.filter((m: Json) => m.kind === 'ESCALATION')).toHaveLength(2);
    // the escalation contact is not added to the people who must answer
    expect(t.recipients.some((r: Json) => r.name === 'Priya Nair')).toBe(false);
  });

  it('does not escalate when everybody has answered, or after the event is closed', async () => {
    const ev = await raise({
      escalateAfterMinutes: 5,
      escalateToUserId: uid('user:procurement'),
      groups: ['EXECUTIVE'],
    });
    for (const l of ev.simulatedLinks)
      await anon('POST', `/respond-links/${tokenOf(l.path)}`, { response: 'SAFE' });
    minutes(10);
    expect((await tracker(ev.event.id)).event.escalatedAt).toBeNull();
    const ev2 = await raise({
      escalateAfterMinutes: 5,
      escalateToUserId: uid('user:procurement'),
      groups: ['EXECUTIVE'],
    });
    await call('procurement', 'POST', `/continuity/events/${ev2.event.id}/close`);
    minutes(10);
    expect((await tracker(ev2.event.id, 'legal')).event.escalatedAt).toBeNull();
  });

  it('closes with a summary of who answered what and how many messages got through', async () => {
    const ev = await raise({ groups: ['EXECUTIVE', 'SUPPLIER_CONTACT'] });
    await anon('POST', `/respond-links/${tokenOf(linkFor(ev, 'Elena Petrova').path)}`, { response: 'SAFE' });
    await anon('POST', `/respond-links/${tokenOf(linkFor(ev, 'Sam Brightwave').path)}`, {
      response: 'NEED_HELP',
    });
    minutes(3);
    const out = await call('exec', 'POST', `/continuity/events/${ev.event.id}/close`, {
      note: 'Depot power restored.',
    });
    expect(out.statusCode, out.body).toBe(200);
    const v = out.json() as Json;
    expect(v.event).toMatchObject({ status: 'CLOSED', closedAt: expect.any(String) });
    expect(v.event.summary).toMatch(/closed after 3 minute/);
    expect(v.event.summary).toMatch(/1 safe, 0 affected, 1 need help, \d+ did not answer/);
    expect(v.event.summary).toMatch(/Asked for help: Sam Brightwave/);
    expect(v.event.summary).toMatch(/delivered/);
    expect(v.event.summary).toMatch(/Note: Depot power restored\./);
    const list = (await call('legal', 'GET', '/continuity/events')).json().events as Json[];
    expect(list.find((e) => e.id === ev.event.id)).toMatchObject({ status: 'CLOSED', needHelp: 1 });
    const audit = await sys<Json[]>((tx) =>
      tx.select().from(s.auditEvent).where(eq(s.auditEvent.entityId, ev.event.id)),
    );
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['continuity.raise', 'continuity.respond', 'continuity.close']),
    );
  });
});

describe('FR-0860 when the messaging gateway is down (NFR-AV04)', () => {
  it('keeps the messages queued, asks a person to phone, lets staff record answers, and sends once the gateway is back', async () => {
    expect((await call('admin', 'PUT', '/connectors/MESSAGING', { mode: 'DOWN' })).statusCode).toBe(200);
    const ev = await raise({ groups: ['EXECUTIVE', 'SUPPLIER_CONTACT'] });
    expect(ev.counts.queued).toBe(ev.recipients.length * 2);
    expect(ev.counts.reached).toBe(0);
    expect(ev.recipients.every((r: Json) => r.channels.every((c: Json) => c.status === 'QUEUED'))).toBe(true);
    const tasks = (await call('admin', 'GET', '/manual-tasks?status=OPEN')).json() as Json[];
    const t = tasks.find((x) => x.connector === 'MESSAGING' && x.summary.eventId === ev.event.id)!;
    expect(t.title).toMatch(/Phone the people for continuity event BC-/);
    // answers can still be recorded by phone
    const elena = ev.recipients.find((r: Json) => r.name === 'Elena Petrova');
    expect(
      (
        await call('procurement', 'POST', `/continuity/events/${ev.event.id}/responses/${elena.id}`, {
          response: 'SAFE',
        })
      ).statusCode,
    ).toBe(200);
    expect((await call('admin', 'PUT', '/connectors/MESSAGING', { mode: 'UP' })).statusCode).toBe(200);
    const back = await tracker(ev.event.id);
    expect(back.counts.queued).toBe(0);
    expect(back.recipients.every((r: Json) => r.reached)).toBe(true);
    const after = (await call('admin', 'GET', '/manual-tasks')).json() as Json[];
    expect(after.find((x) => x.id === t.id)!.status).toBe('SUPERSEDED');
  });

  it('a switched-off messaging connector behaves the same way', async () => {
    expect((await call('admin', 'PUT', '/connectors/MESSAGING', { enabled: false })).statusCode).toBe(200);
    const ev = await raise({ groups: ['EXECUTIVE'] });
    expect(ev.counts.queued).toBe(ev.recipients.length * 2);
    expect((await call('admin', 'PUT', '/connectors/MESSAGING', { enabled: true })).statusCode).toBe(200);
    expect((await tracker(ev.event.id)).counts.queued).toBe(0);
  });
});
