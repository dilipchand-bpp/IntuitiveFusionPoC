import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import * as s from '../../db/schema.js';
import { uid } from '../../db/seed.js';
import { PASSWORD, createEnv, type Json } from '../contract/test-env.js';

let env: Awaited<ReturnType<typeof createEnv>>;
beforeAll(async () => {
  env = await createEnv();
}, 120_000);
const BRIGHT = uid('supplier:brightwave');
const sys = <T>(fn: Parameters<typeof env.withSystem>[1]) => env.withSystem(env.database, fn) as Promise<T>;

describe('supplier directory and profile (US-SUP-05)', () => {
  it('buyers and finance see the status of each supplier; others cannot', async () => {
    for (const who of ['procurement', 'legal', 'finance', 'admin']) {
      const r = await env.call(who, 'GET', '/suppliers');
      expect(r.statusCode, who).toBe(200);
      const list = r.json() as Json[];
      expect(list.length).toBeGreaterThanOrEqual(4);
      expect(list.find((x) => x.id === BRIGHT)).toMatchObject({
        company: 'Brightwave Cleaning Pty Ltd',
        contacts: 1,
      });
    }
    for (const who of ['requester', 'evaluator-tech', 'delegate', 'supplier', 'probity', 'exec'])
      expect((await env.call(who, 'GET', '/suppliers')).statusCode, who).toBe(403);
  });

  it('the profile shows status, contacts, the tenders bid on and the contracts held, and whether the viewer may add a contact', async () => {
    const r = await env.call('procurement', 'GET', `/suppliers/${BRIGHT}`);
    expect(r.statusCode).toBe(200);
    const p = r.json() as Json;
    expect(p).toMatchObject({ company: 'Brightwave Cleaning Pty Ltd', canAddContact: true });
    expect(['PENDING', 'CLEAR', 'MATCH']).toContain(p.sanctionsStatus);
    expect(p.contacts[0]).toMatchObject({
      email: 'supplier@meridian-demo.example',
      awaitingActivation: false,
    });
    expect(p.tenders.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(p)).not.toMatch(/password|hash/i);
    expect(((await env.call('finance', 'GET', `/suppliers/${BRIGHT}`)).json() as Json).canAddContact).toBe(
      false,
    );
    expect(
      (await env.call('procurement', 'GET', '/suppliers/00000000-0000-4000-8000-000000000000')).statusCode,
    ).toBe(404);
  });
});

describe('adding a contact to an existing supplier', () => {
  it('the buyer adds a contact; the contact sets a password through a one-time link and then signs in as that supplier only', async () => {
    const add = await env.call('procurement', 'POST', `/suppliers/${BRIGHT}/contacts`, {
      name: 'Casey Second',
      email: 'Casey.Second@brightwave.example',
    });
    expect(add.statusCode, add.body).toBe(201);
    expect(add.json().contact).toMatchObject({
      name: 'Casey Second',
      email: 'casey.second@brightwave.example',
      awaitingActivation: true,
    });
    const link = add.json().activationPath as string;
    expect(link).toMatch(/^\/supplier\/activate\?token=[\w-]{40,}$/);
    const token = link.split('token=')[1]!;
    // the token itself is never stored
    const rows = await sys<Json[]>((tx) => tx.select().from(s.supplierActivation));
    expect(JSON.stringify(rows)).not.toContain(token);

    // until activation nobody can sign in as them
    const early = await env.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'casey.second@brightwave.example', password: PASSWORD },
    });
    expect(early.statusCode).toBe(401);

    const info = await env.app.inject({ method: 'GET', url: `/api/v1/supplier/activate/${token}` });
    expect(info.statusCode).toBe(200);
    expect(info.json()).toMatchObject({ name: 'Casey Second', company: 'Brightwave Cleaning Pty Ltd' });
    const weak = await env.app.inject({
      method: 'POST',
      url: '/api/v1/supplier/activate',
      payload: { token, password: 'onlyletterslong' },
    });
    expect(weak.statusCode).toBe(400);
    const ok = await env.app.inject({
      method: 'POST',
      url: '/api/v1/supplier/activate',
      payload: { token, password: 'Second-Contact-Pass-1' },
    });
    expect(ok.statusCode, ok.body).toBe(200);
    // single use
    expect(
      (
        await env.app.inject({
          method: 'POST',
          url: '/api/v1/supplier/activate',
          payload: { token, password: 'Another-Pass-Word-2' },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await env.app.inject({ method: 'GET', url: `/api/v1/supplier/activate/${token}` })).statusCode,
    ).toBe(404);

    const login = await env.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'casey.second@brightwave.example', password: 'Second-Contact-Pass-1' },
    });
    expect(login.statusCode, login.body).toBe(200);
    expect(login.json().user.roles).toEqual(['SUPPLIER']);
    expect(login.cookies.some((c) => c.name === 'if_supplier_session')).toBe(true);
    // they see the same company's tenders as the first contact
    const cookies = Object.fromEntries(login.cookies.map((c) => [c.name, c.value]));
    const mine = await env.app.inject({ method: 'GET', url: '/api/v1/supplier/tenders', cookies });
    expect(mine.statusCode).toBe(200);
    const profile = (await env.call('procurement', 'GET', `/suppliers/${BRIGHT}`)).json() as Json;
    expect(profile.contacts.map((c: Json) => c.email)).toContain('casey.second@brightwave.example');
    expect(
      profile.contacts.find((c: Json) => c.email === 'casey.second@brightwave.example').awaitingActivation,
    ).toBe(false);
    const audit = await sys<Json[]>((tx) =>
      tx
        .select()
        .from(s.auditEvent)
        .where(and(eq(s.auditEvent.entityId, BRIGHT), eq(s.auditEvent.action, 'supplier.contact_add'))),
    );
    expect(audit).toHaveLength(1);
  });

  it('an expired link is refused; so are a taken email, bad input, a missing supplier and other roles', async () => {
    const add = await env.call('procurement', 'POST', `/suppliers/${BRIGHT}/contacts`, {
      name: 'Late Person',
      email: 'late@brightwave.example',
    });
    const token = (add.json().activationPath as string).split('token=')[1]!;
    env.clock.advanceDays(8);
    expect(
      (await env.app.inject({ method: 'GET', url: `/api/v1/supplier/activate/${token}` })).statusCode,
    ).toBe(404);
    expect(
      (
        await env.app.inject({
          method: 'POST',
          url: '/api/v1/supplier/activate',
          payload: { token, password: 'Late-Person-Pass-1' },
        })
      ).statusCode,
    ).toBe(404);
    env.clock.advanceDays(-8);
    expect(
      (
        await env.call('procurement', 'POST', `/suppliers/${BRIGHT}/contacts`, {
          name: 'Dup',
          email: 'supplier@meridian-demo.example',
        })
      ).json().code,
    ).toBe('EMAIL_IN_USE');
    for (const b of [
      { name: 'x', email: 'a@b.example' },
      { name: 'Valid Name', email: 'nope' },
      { name: 'Valid Name', email: 'a@b.example', extra: 1 },
    ])
      expect(
        (await env.call('procurement', 'POST', `/suppliers/${BRIGHT}/contacts`, b)).statusCode,
        JSON.stringify(b),
      ).toBe(400);
    expect(
      (
        await env.call('procurement', 'POST', '/suppliers/00000000-0000-4000-8000-000000000000/contacts', {
          name: 'Valid Name',
          email: 'zz@b.example',
        })
      ).statusCode,
    ).toBe(404);
    for (const who of ['finance', 'legal', 'admin', 'requester', 'supplier'])
      expect(
        (
          await env.call(who, 'POST', `/suppliers/${BRIGHT}/contacts`, {
            name: 'Valid Name',
            email: 'yy@b.example',
          })
        ).statusCode,
        who,
      ).toBe(403);
    expect(
      (
        await env.app.inject({
          method: 'GET',
          url: '/api/v1/supplier/activate/not-a-real-token-not-a-real-token',
        })
      ).statusCode,
    ).toBe(404);
  });
});
