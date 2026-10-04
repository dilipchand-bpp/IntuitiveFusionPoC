import { expect, request as pwRequest, type APIRequestContext, type Page } from '@playwright/test';
import { API_URL } from '../playwright.config';

/** Shared set-up for browser tests that need a tender with bids, an evaluation, and signed-in people (copied from evaluation.spec.ts). */
export const PASSWORD = 'E2e-Only-Passw0rd!2026';
export const SUPPLIER_PASSWORD = 'Supplier-E2e-Passw0rd-1';
export const email = (u: string) => `${u}@meridian-demo.example`;
export const rand = () => Math.random().toString(36).slice(2, 8);
export const PDF = Buffer.from('%PDF-1.7\nTECHNICAL-CONTENT-MARKER');
export const ZIP = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from('COMMERCIAL-PRICING-MARKER'),
]);

export async function signIn(page: Page, user: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel(/Email/).fill(user.includes('@') ? user : email(user));
  await page.getByLabel(/Password/).fill(user.includes('@') ? SUPPLIER_PASSWORD : PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId(user.includes('@') ? 'supplier-shell' : 'shell')).toBeVisible();
}

/** A checksum-valid ABN that is different on every call (the registration check is the real ABN algorithm). */
let abnSeq = 1000 + Math.floor(Math.random() * 8_000_000); // random start: parallel workers must never reuse an ABN
export function newAbn(): string {
  const w = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  for (;;) {
    abnSeq += 1;
    const body = String(abnSeq).padStart(9, '0');
    for (let c = 10; c < 100; c++) {
      const abn = `${c}${body}`;
      const sum = [...abn].reduce((acc, ch, i) => acc + (i === 0 ? Number(ch) - 1 : Number(ch)) * w[i]!, 0);
      if (sum % 89 === 0) return abn;
    }
  }
}

export async function login(api: APIRequestContext, mail: string, password = PASSWORD) {
  const r = await api.post('/api/v1/auth/login', { data: { email: mail, password } });
  expect(r.ok(), await r.text()).toBeTruthy();
  return { 'x-csrf-token': (await r.json()).csrfToken as string };
}

/**
 * Builds, through the API (fast set-up), a tender that has closed with two submitted bids; everything under test then
 * happens in the browser. The closing time is backdated by the test-only API entry point (apps/api/src/e2e-main.ts).
 */
export async function closedTender(
  title: string,
  bidders = 2,
): Promise<{ tenderId: string; companies: string[]; emails: string[] }> {
  const api = await pwRequest.newContext({ baseURL: API_URL });
  const requester = await login(api, email('requester'));
  const c = await api.post('/api/v1/requests', {
    headers: requester,
    data: {
      title,
      category: 'Building cleaning (UNSPSC 76111500)',
      estimatedValue: 90_000,
      termMonths: 24,
      businessUnit: 'Facilities',
      fields: { contractOwner: 'Sofia Rossi', background: 'Existing arrangements end in six months.' },
    },
  });
  const requestId = (await c.json()).id as string;
  expect((await api.post(`/api/v1/requests/${requestId}/submit`, { headers: requester })).ok()).toBeTruthy();
  const proc = await login(api, email('procurement'));
  const plan = await (await api.get(`/api/v1/requests/${requestId}/plan`)).json();
  expect(
    (await api.post(`/api/v1/plans/${plan.id}/submit-for-approval`, { headers: proc })).ok(),
  ).toBeTruthy();
  const del = await login(api, email('delegate'));
  expect(
    (
      await api.post(`/api/v1/plans/${plan.id}/decision`, { headers: del, data: { decision: 'APPROVE' } })
    ).ok(),
  ).toBeTruthy();
  const procAgain = await login(api, email('procurement'));
  const t = await (
    await api.post('/api/v1/tenders', { headers: procAgain, data: { requestId, type: 'RFT' } })
  ).json();
  const delAgain = await login(api, email('delegate'));
  expect(
    (await api.post(`/api/v1/tenders/${t.id}/publish-permission`, { headers: delAgain, data: {} })).ok(),
  ).toBeTruthy();
  const closesAt = new Date(Date.now() + 26 * 86_400_000).toISOString();
  const procPublish = await login(api, email('procurement')); // one cookie jar, one session at a time: log in again right before use
  const pub = await api.post(`/api/v1/tenders/${t.id}/publish`, { headers: procPublish, data: { closesAt } });
  expect(pub.ok(), await pub.text()).toBeTruthy();

  const companies: string[] = [];
  const emails: string[] = [];
  for (let i = 0; i < bidders; i++) {
    const company = `Eval Bidder ${['Alpha', 'Bravo', 'Charlie'][i]} ${rand()} Pty Ltd`;
    companies.push(company);
    const mail = `bids-${rand()}@eval-bidder.example`;
    emails.push(mail);
    const inv = await (
      await api.post(`/api/v1/tenders/${t.id}/invitations`, {
        headers: procPublish,
        data: { invitees: [{ email: mail, company }] },
      })
    ).json();
    const token = new URL(inv.invitations[0].registerPath, 'http://x').searchParams.get('token')!;
    const anon = await pwRequest.newContext({ baseURL: API_URL });
    const reg = await anon.post('/api/v1/supplier/register', {
      data: { token, name: 'Bea Bidder', email: mail, company, abn: newAbn(), password: SUPPLIER_PASSWORD },
    });
    expect(reg.ok(), await reg.text()).toBeTruthy();
    const sup = await pwRequest.newContext({ baseURL: API_URL });
    const sh = await login(sup, mail, SUPPLIER_PASSWORD);
    for (const [name, section, bytes] of [
      ['technical.pdf', 'TECHNICAL', PDF],
      ['pricing.xlsx', 'COMMERCIAL', ZIP],
    ] as const) {
      const up = await sup.post(`/api/v1/supplier/tenders/${t.id}/submission/files`, {
        headers: sh,
        data: { name, section, dataBase64: bytes.toString('base64') },
      });
      expect(up.ok(), await up.text()).toBeTruthy();
    }
    expect(
      (await sup.post(`/api/v1/supplier/tenders/${t.id}/submission`, { headers: sh })).ok(),
    ).toBeTruthy();
    await sup.dispose();
    await anon.dispose();
  }
  expect((await api.post(`${API_URL}/__e2e/expire-tender/${t.id}`)).status()).toBe(204);
  // any read closes it (automatic close at the closing time)
  const after = await (await api.get(`/api/v1/tenders/${t.id}`, { headers: {} })).json();
  expect(after.status).toBe('CLOSED');
  await api.dispose();
  return { tenderId: t.id as string, companies, emails };
}

export async function apiAs(user: string) {
  const api = await pwRequest.newContext({ baseURL: API_URL });
  const headers = await login(api, email(user));
  return { api, headers };
}
/** Opens an evaluation by API (Tomas = technical, Mei = commercial, chair added automatically) and returns its id. */
export async function openEvaluationApi(tenderId: string): Promise<string> {
  const { api, headers } = await apiAs('procurement');
  const people = await (await api.get('/api/v1/evaluators')).json();
  const id = (n: string) => people.evaluators.find((p: { name: string }) => p.name === n).id as string;
  const r = await api.post(`/api/v1/tenders/${tenderId}/evaluation`, {
    headers,
    data: {
      panel: [
        { userId: id('Tomas Silva'), stream: 'TECHNICAL' },
        { userId: id('Mei Tanaka'), stream: 'COMMERCIAL' },
      ],
    },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  const body = await r.json();
  await api.dispose();
  return body.id as string;
}
export async function apiDeclareNone(user: string, evalId: string) {
  const { api, headers } = await apiAs(user);
  expect(
    (await api.post(`/api/v1/evaluations/${evalId}/coi`, { headers, data: { none: true } })).ok(),
  ).toBeTruthy();
  await api.dispose();
}
export async function apiScoreAndSubmit(user: string, evalId: string) {
  const { api, headers } = await apiAs(user);
  const mine = await (await api.get(`/api/v1/evaluations/${evalId}/scores/mine`)).json();
  for (const s of mine.suppliers)
    expect(
      (
        await api.put(`/api/v1/evaluations/${evalId}/scores`, {
          headers,
          data: {
            supplierId: s.supplierId,
            scores: mine.criteria.map((c: { id: string; passFail: boolean }) => ({
              criterionId: c.id,
              score: c.passFail ? 10 : 7,
            })),
          },
        })
      ).ok(),
    ).toBeTruthy();
  expect((await api.post(`/api/v1/evaluations/${evalId}/scores/submit`, { headers })).ok()).toBeTruthy();
  await api.dispose();
}
export async function apiConsensusAndLock(evalId: string) {
  const { api, headers } = await apiAs('chair');
  const open = await (await api.post(`/api/v1/evaluations/${evalId}/consensus/open`, { headers })).json();
  for (const s of open.suppliers)
    expect(
      (
        await api.put(`/api/v1/evaluations/${evalId}/consensus/${s.supplierId}`, {
          headers,
          data: {
            items: open.criteria.map((c: { id: string }) => ({ criterionId: c.id, consensusScore: 7 })),
          },
        })
      ).ok(),
    ).toBeTruthy();
  expect((await api.post(`/api/v1/evaluations/${evalId}/consensus/lock`, { headers })).ok()).toBeTruthy();
  await api.dispose();
}
