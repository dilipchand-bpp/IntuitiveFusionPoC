import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import * as s from '../../db/schema.js';
import { TENANT_ID, uid } from '../../db/seed.js';
import { createEnv, type Json } from '../contract/test-env.js';
import { abnValid, classifyText, detect, luhnValid, mask, tfnValid } from './classify.js';

describe('SEC-D07 the classifier: deterministic rules that find sensitive data and never keep the value', () => {
  const ids = (t: string) => detect(t).map((h) => h.detector);

  it('masks a value to its shape and last three characters', () => {
    expect(mask('123 456 782')).toBe('XXX XXX 782');
    expect(mask('4111 1111 1111 1111')).toBe('XXXX XXXX XXXX X111');
    expect(mask('a@b.test')).toBe('X@X.Xest');
  });

  it('checksums: TFN, ABN and the Luhn check for a card', () => {
    expect(tfnValid('123 456 782')).toBe(true);
    expect(tfnValid('123 456 789')).toBe(false);
    expect(abnValid('51 824 753 556')).toBe(true);
    expect(abnValid('51 824 753 557')).toBe(false);
    expect(luhnValid('4111 1111 1111 1111')).toBe(true);
    expect(luhnValid('4111 1111 1111 1112')).toBe(false);
  });

  it('finds a TFN, an ABN, a card, a bank account, an email, a phone number, a licence, a passport, health words and a CIC marker', () => {
    expect(ids('My TFN is 123 456 782')).toContain('TFN');
    expect(ids('Tax file number 123456782')).toContain('TFN');
    expect(ids('ABN 51 824 753 556 applies')).toContain('ABN');
    expect(ids('Card 4111 1111 1111 1111 expires 09/29')).toEqual(['CREDIT_CARD']);
    expect(ids('Pay to BSB 062-000 account number 12345678')).toContain('BANK_ACCOUNT');
    expect(ids('Contact jo.citizen@example.test')).toContain('EMAIL');
    expect(ids('Call 0412 345 678 or +61 2 9999 1234')).toEqual(['PHONE', 'PHONE']);
    expect(ids("Driver's licence number: DL1234567")).toContain('DRIVER_LICENCE');
    expect(ids('Passport no. PA1234567')).toContain('PASSPORT');
    expect(ids('The patient has a medical condition and takes medication')).toContain('MEDICAL');
    expect(ids('This document is Commercial-in-Confidence')).toContain('COMMERCIAL_IN_CONFIDENCE');
  });

  it('does not flag look-alikes: a bad checksum, an order number, plain prose', () => {
    expect(ids('Order 123456789 and invoice 4111111111111112')).toEqual([]);
    expect(ids('We will clean the offices twice a week for two years.')).toEqual([]);
    expect(classifyText('We will clean the offices.')).toBeNull();
  });

  it('the class is the most sensitive detector that fired, and samples are masked', () => {
    const c = classifyText('TFN 123 456 782 and card 4111 1111 1111 1111 and jo@example.test')!;
    expect(c.class).toBe('FINANCIAL');
    expect(c.detectors).toEqual(expect.arrayContaining(['TFN', 'CREDIT_CARD', 'EMAIL']));
    expect(JSON.stringify(c.samples)).not.toContain('4111 1111 1111 1111');
    expect(JSON.stringify(c.samples)).not.toContain('123 456 782');
    expect(classifyText('Email jo@example.test')!.class).toBe('CONFIDENTIAL');
    expect(classifyText('TFN 123 456 782')!.class).toBe('SENSITIVE_PERSONAL');
    expect(classifyText('ABN 51 824 753 556')!.class).toBe('INTERNAL');
  });
});

describe('SEC-D07 the scan: populated by a run, idempotent, reviewed, warns about unexpected places', () => {
  let env: Awaited<ReturnType<typeof createEnv>>;
  const call = (...a: Parameters<typeof env.call>) => env.call(...a);
  const sys = <T>(fn: Parameters<typeof env.withSystem>[1]) => env.withSystem(env.database, fn) as Promise<T>;
  let requestId: string;
  beforeAll(async () => {
    env = await createEnv();
    const r = await call('requester', 'POST', '/requests', { title: 'Cleaning services for head office' });
    expect(r.statusCode, r.body).toBe(201);
    requestId = r.json().id;
    const p = await call('requester', 'PATCH', `/requests/${requestId}`, {
      fields: {
        background:
          'The cleaner asked us to pay by card 4111 1111 1111 1111 and gave TFN 123 456 782. This is Commercial-in-Confidence.',
        deliverables: 'Daily cleaning of the offices. Supplier ABN 51 824 753 556.',
      },
    });
    expect(p.statusCode, p.body).toBe(200);
  }, 120_000);

  const findings = async (q = '') =>
    (await call('probity', 'GET', `/privacy/classification${q}`)).json() as Json;

  it('a run finds a card number in a request background and warns that it is in an unexpected place', async () => {
    const run = await call('probity', 'POST', '/privacy/classification/run');
    expect(run.statusCode, run.body).toBe(200);
    expect(run.json()).toMatchObject({ model: 'rules-simulated-v1' });
    expect(run.json().created).toBeGreaterThanOrEqual(1);
    const v = await findings();
    const bg = v.findings.find((f: Json) => f.location.field.endsWith('Background'));
    expect(bg).toMatchObject({ class: 'FINANCIAL', status: 'OPEN', location: { type: 'Record field' } });
    expect(bg.detectors.map((d: Json) => d.id)).toEqual(
      expect.arrayContaining(['CREDIT_CARD', 'TFN', 'COMMERCIAL_IN_CONFIDENCE']),
    );
    expect(bg.warning).toMatch(/Credit card number/);
    expect(bg.warning).toMatch(/not expected there/);
    expect(bg.link).toBe(`/app/requests/${requestId}`);
    // an ABN in a deliverables field is expected, so no warning
    const del = v.findings.find((f: Json) => f.location.field.endsWith('Deliverables'));
    expect(del).toMatchObject({ class: 'INTERNAL', warning: null });
    expect(v.summary.warnings).toBeGreaterThanOrEqual(1);
    expect(v.summary.byClass.find((c: Json) => c.class === 'FINANCIAL').count).toBeGreaterThanOrEqual(1);
    expect(v.summary.byLocation.map((l: Json) => l.entityType)).toContain('field_value');
  });

  it('never stores the sensitive value: only detector names and a masked sample', async () => {
    const rows = await sys<Json[]>((tx) => tx.select().from(s.dataClassification));
    const all = JSON.stringify(rows);
    expect(all).not.toContain('4111 1111 1111 1111');
    expect(all).not.toContain('123 456 782');
    expect(all).not.toContain('51 824 753 556');
    expect(all).toContain('XXXX XXXX XXXX X111');
    const audit = JSON.stringify(
      await sys<Json[]>((tx) =>
        tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'classification.scan')),
      ),
    );
    expect(audit).not.toContain('4111');
  });

  it('a second run changes nothing (idempotent) and a reviewed finding keeps its review', async () => {
    const f = (await findings()).findings.find((x: Json) => x.location.field.endsWith('Background'));
    const rev = await call('legal', 'POST', `/privacy/classification/${f.id}/review`, {
      decision: 'CONFIRM',
      reason: 'Card number is real, remove it',
    });
    expect(rev.statusCode, rev.body).toBe(200);
    expect(rev.json()).toMatchObject({ status: 'CONFIRMED' });
    const before = (await findings()).summary.total;
    const run = (await call('probity', 'POST', '/privacy/classification/run')).json() as Json;
    expect(run).toMatchObject({ created: 0, updated: 0, removed: 0 });
    expect(run.unchanged).toBe(before);
    const again = (await findings()).findings.find((x: Json) => x.id === f.id);
    expect(again).toMatchObject({ status: 'CONFIRMED', reviewReason: 'Card number is real, remove it' });
    expect(again.reviewedBy).toEqual(expect.any(String));
  });

  it('review needs a reason, is audited, and dismiss works; the run is for administrators and probity only', async () => {
    const f = (await findings()).findings.find((x: Json) => x.location.field.endsWith('Deliverables'));
    expect(
      (await call('legal', 'POST', `/privacy/classification/${f.id}/review`, { decision: 'DISMISS' }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await call('legal', 'POST', `/privacy/classification/${f.id}/review`, {
          decision: 'DISMISS',
          reason: 'A public business number',
        })
      ).json(),
    ).toMatchObject({ status: 'DISMISSED' });
    const ev = await sys<Json[]>((tx) =>
      tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'classification.dismiss')),
    );
    expect(ev.at(-1)!.after).toMatchObject({ status: 'DISMISSED', reason: 'A public business number' });
    expect((await call('legal', 'POST', '/privacy/classification/run')).statusCode).toBe(403);
    expect((await call('requester', 'GET', '/privacy/classification')).statusCode).toBe(403);
    for (const who of ['admin', 'exec', 'legal', 'probity'])
      expect((await call(who, 'GET', '/privacy/classification')).statusCode).toBe(200);
  });

  it('filters by status and class; an edit that removes the data removes the finding; changed text resets the review', async () => {
    const open = await findings('?status=OPEN');
    expect(open.findings.every((f: Json) => f.status === 'OPEN')).toBe(true);
    expect((await findings('?class=FINANCIAL')).findings.every((f: Json) => f.class === 'FINANCIAL')).toBe(
      true,
    );
    expect((await findings('?warningsOnly=true')).findings.every((f: Json) => f.warning)).toBe(true);
    // change the background to something clean
    const cur = (await call('requester', 'GET', `/requests/${requestId}`)).json() as Json;
    const p = await call('requester', 'PATCH', `/requests/${requestId}`, {
      fields: { background: 'Offices need regular cleaning.' },
      expectedVersion: cur.version,
    });
    expect(p.statusCode, p.body).toBe(200);
    const run = (await call('probity', 'POST', '/privacy/classification/run')).json() as Json;
    expect(run.removed).toBe(1);
    expect((await findings()).findings.some((f: Json) => f.location.field.endsWith('Background'))).toBe(
      false,
    );
  });

  it('also reads lessons, notes, clauses, messages and chat: bank details in a lesson are found', async () => {
    await sys((tx) =>
      tx.insert(s.lesson).values({
        tenantId: TENANT_ID,
        requestId,
        authorId: uid('user:requester'),
        phase: 'INTAKE',
        kind: 'TIP',
        text: 'Bank details BSB 062-000 account number 12345678 were emailed to jo@example.test',
        createdAt: env.clock.now(),
      }),
    );
    const run = (await call('admin', 'POST', '/privacy/classification/run')).json() as Json;
    expect(run.created).toBeGreaterThanOrEqual(1);
    const l = (await findings()).findings.find((f: Json) => f.location.type === 'Lesson');
    expect(l).toMatchObject({ class: 'FINANCIAL' });
    expect(l.warning).toMatch(/Bank account/);
  });
});
