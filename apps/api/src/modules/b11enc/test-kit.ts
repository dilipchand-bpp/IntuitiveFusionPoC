/** Shared helpers for the B11a tests: a tender that suppliers can bid on, registered suppliers, uploads. Not a test file. */
import { expect } from 'vitest';
import { PASSWORD, type createEnv, type Json } from '../contract/test-env.js';

export type Env = Awaited<ReturnType<typeof createEnv>>;
export const DAY = 86_400_000;
export const PDF = Buffer.from('%PDF-1.7\nsample technical response');
export const PLAIN_MARKER = 'CONFIDENTIAL-BID-MARKER-7731';
export const b64 = (b: Buffer) => b.toString('base64');
export const EICAR = 'X5O!P%@AP EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

let abnCounter = 0;
export function newAbn(): string {
  for (;;) {
    abnCounter += 1;
    const body = String(60_000_000 + abnCounter).padStart(9, '0');
    for (let c = 10; c < 100; c++) {
      const abn = `${c}${body}`;
      const w = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
      const sum = [...abn].reduce((acc, ch, i) => acc + (i === 0 ? Number(ch) - 1 : Number(ch)) * w[i]!, 0);
      if (sum % 89 === 0) return abn;
    }
  }
}

let seq = 0;
export function kit(env: Env) {
  const { call } = env;
  const closeIn = (days: number) => new Date(env.clock.now().getTime() + days * DAY).toISOString();

  async function stagedTender(value = 90_000): Promise<Json> {
    const c = await call('requester', 'POST', '/requests', {
      title: `B11a fixture ${(seq += 1)}`,
      category: 'Building cleaning (UNSPSC 76111500)',
      estimatedValue: value,
      termMonths: 24,
      businessUnit: 'Facilities',
      fields: { contractOwner: 'Sofia Rossi', background: 'Existing arrangements end in six months.' },
    });
    expect(c.statusCode, c.body).toBe(201);
    const rid = c.json().id as string;
    expect((await call('requester', 'POST', `/requests/${rid}/submit`)).statusCode).toBe(200);
    const plan = (await call('procurement', 'GET', `/requests/${rid}/plan`)).json();
    expect((await call('procurement', 'POST', `/plans/${plan.id}/submit-for-approval`)).statusCode).toBe(200);
    expect(
      (await call('delegate', 'POST', `/plans/${plan.id}/decision`, { decision: 'APPROVE' })).statusCode,
    ).toBe(200);
    const t = await call('procurement', 'POST', '/tenders', {
      requestId: rid,
      type: 'RFT',
      access: 'CLOSED',
    });
    expect(t.statusCode, t.body).toBe(201);
    return { ...t.json(), requestId: rid, planId: plan.id as string };
  }
  async function publish(t: Json, days = 30) {
    expect((await call('delegate', 'POST', `/tenders/${t.id}/publish-permission`, {})).statusCode).toBe(200);
    const p = await call('procurement', 'POST', `/tenders/${t.id}/publish`, { closesAt: closeIn(days) });
    expect(p.statusCode, p.body).toBe(200);
    return p.json();
  }
  async function register(tenderId: string, name: string) {
    const email = `${name.toLowerCase().replace(/\W+/g, '')}@b11a-bidder.example`;
    const inv = await call('procurement', 'POST', `/tenders/${tenderId}/invitations`, {
      invitees: [{ email, company: `${name} Pty Ltd` }],
    });
    expect(inv.statusCode, inv.body).toBe(201);
    const token = new URL(inv.json().invitations[0].registerPath, 'http://x').searchParams.get('token')!;
    const res = await env.app.inject({
      method: 'POST',
      url: '/api/v1/supplier/register',
      payload: {
        token,
        name: `${name} Contact`,
        email,
        company: `${name} Pty Ltd`,
        abn: newAbn(),
        password: PASSWORD,
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    return { key: email, supplierId: res.json().supplierId as string };
  }
  const upload = (key: string, tenderId: string, name: string, bytes: Buffer, section = 'TECHNICAL') =>
    call(key, 'POST', `/supplier/tenders/${tenderId}/submission/files`, {
      name,
      section,
      dataBase64: b64(bytes),
    });

  /** A published tender with one submitted bid: a PDF containing a marker, and (when asked) a response schedule answer. */
  async function tenderWithBid(opts: { value?: number; answer?: boolean } = {}) {
    const t = await stagedTender(opts.value ?? 90_000);
    if (opts.answer !== false) {
      const r = await call('procurement', 'PUT', `/tenders/${t.id}/response-schedule`, {
        items: [
          {
            key: 'method',
            label: 'Delivery method',
            section: 'TECHNICAL',
            kind: 'TEXT',
            required: true,
            maxLength: 500,
          },
        ],
      });
      expect(r.statusCode, r.body).toBe(200);
    }
    await publish(t);
    const sup = await register(t.id, `Bidder${(seq += 1)}`);
    const body = Buffer.from(`%PDF-1.7\n${PLAIN_MARKER} our price is confidential`);
    const up = await upload(sup.key, t.id, 'technical.pdf', body);
    expect(up.statusCode, up.body).toBe(201);
    const up2 = await upload(
      sup.key,
      t.id,
      'pricing.xlsx',
      Buffer.from([0x50, 0x4b, 0x03, 0x04, 9, 9, 9, 9]),
      'COMMERCIAL',
    );
    expect(up2.statusCode, up2.body).toBe(201);
    if (opts.answer !== false) {
      const a = await call(sup.key, 'PUT', `/supplier/tenders/${t.id}/response`, {
        answers: { method: `${PLAIN_MARKER} day teams with a supervisor` },
      });
      expect(a.statusCode, a.body).toBe(200);
    }
    const sub = await call(sup.key, 'POST', `/supplier/tenders/${t.id}/submission`);
    expect(sub.statusCode, sub.body).toBe(201);
    return { t, sup, fileId: up.json().id as string, body };
  }
  return { stagedTender, publish, register, upload, tenderWithBid, closeIn };
}
