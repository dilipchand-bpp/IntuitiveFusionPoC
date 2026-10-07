import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { withContext } from '../../db/client.js';
import * as s from '../../db/schema.js';
import { TENANT_ID, uid } from '../../db/seed.js';
import { BRIGHT, createEnv, type Json } from '../contract/test-env.js';
import { storeReport } from '../evaluation/report-compose.js';
import { REPORT_SECTIONS } from '../evaluation/report.js';
import { openFieldRows } from './projects.js';
import { blobEnvelope } from './keys.js';
import { b64, EICAR, kit, type Env } from './test-kit.js';
import { SealedStore } from '../tender/files.js';

let env: Env;
let k: ReturnType<typeof kit>;
const call = (...a: Parameters<Env['call']>) => env.call(...a);
const sys = <T>(fn: Parameters<Env['withSystem']>[1]) => env.withSystem(env.database, fn) as Promise<T>;
beforeAll(async () => {
  env = await createEnv();
  k = kit(env);
}, 120_000);

const ids = new Map<string, string>();
async function who(tag: string, role: s.Role) {
  if (!ids.has(tag)) ids.set(tag, (await env.extraUser(tag, role)).email);
  return ids.get(tag)!;
}
const REASON = 'Commercially sensitive reorganisation of the facilities function';

/** A request with a plan and a tender, restricted by the procurement manager. Returns what the tests need. */
async function restrictedProject() {
  const t = await k.stagedTender();
  const planBefore = (await call('procurement', 'GET', `/requests/${t.requestId}/plan`)).json() as Json;
  const r = await call('procurement', 'POST', `/requests/${t.requestId}/restrict`, { reason: REASON });
  expect(r.statusCode, r.body).toBe(201);
  return { t, planBefore, restrict: r.json() as Json };
}

describe('FR-0865 project-level encryption invisible outside the assigned sourcing group', () => {
  it('FR-0865 only procurement or an executive can restrict a procurement, with a reason, once', async () => {
    const t = await k.stagedTender();
    expect(
      (await call('requester', 'POST', `/requests/${t.requestId}/restrict`, { reason: REASON })).statusCode,
    ).toBe(403);
    expect(
      (await call('procurement', 'POST', `/requests/${t.requestId}/restrict`, { reason: 'short' }))
        .statusCode,
    ).toBe(400);
    const ok = await call('procurement', 'POST', `/requests/${t.requestId}/restrict`, { reason: REASON });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json().encrypted.planFields).toBeGreaterThan(0);
    expect(
      (await call('procurement', 'POST', `/requests/${t.requestId}/restrict`, { reason: REASON })).statusCode,
    ).toBe(409);
    const audit = await sys<Array<{ action: string }>>((tx) =>
      tx
        .select({ action: s.auditEvent.action })
        .from(s.auditEvent)
        .where(eq(s.auditEvent.entityId, t.requestId)),
    );
    expect(audit.map((a) => a.action)).toContain('project.restrict');
  });

  it('FR-0865 outside the group the project answers 404, never 403, on every route that reaches it, and the answer is the same as for an id that does not exist', async () => {
    const { t } = await restrictedProject();
    const other = await who('other-proc', 'PROCUREMENT');
    const urls = (id: string, planId: string, tenderId: string) => [
      `/requests/${id}`,
      `/requests/${id}/plan`,
      `/requests/${id}/progress`,
      `/requests/${id}/restriction`,
      `/tenders/${tenderId}`,
      `/tenders/${tenderId}/bid-box`,
      `/plans/${planId}/esg`,
    ];
    const real = urls(t.requestId, t.planId, t.id);
    const none = urls(randomUUID(), randomUUID(), randomUUID());
    for (const user of ['admin', 'exec', other, 'delegate', 'legal', 'finance']) {
      for (let i = 0; i < real.length; i++) {
        const r = await call(user, 'GET', real[i]!);
        const n = await call(user, 'GET', none[i]!);
        // outside the group the answer is exactly the answer for an id that does not exist
        expect(r.statusCode, `${user} ${real[i]}: ${r.body}`).toBe(n.statusCode);
        expect(r.json().code, `${user} ${real[i]}`).toBe(n.json().code);
        expect(r.statusCode, `${user} ${real[i]}`).not.toBe(200);
        // and where the person's role may use the route at all, that answer is 404 (never 403 "it exists but not for you")
        if (user === 'exec' || user === other)
          if (!real[i]!.includes('/esg')) expect(r.statusCode, `${user} ${real[i]}`).toBe(404);
      }
      expect(
        (await call(user, 'PUT', `/plans/${t.planId}/fields/overview`, { value: 'x', expectedVersion: 1 }))
          .statusCode,
      ).not.toBe(200);
    }
    // inside the group: the requester, the procurement manager who restricted it
    for (const user of ['requester', 'procurement'])
      for (const url of [
        `/requests/${t.requestId}`,
        `/requests/${t.requestId}/plan`,
        ...(user === 'procurement' ? [`/tenders/${t.id}`] : []),
      ]) {
        const r = await call(user, 'GET', url);
        expect(r.statusCode, `${user} ${url}: ${r.body}`).toBe(200);
      }
    const view = (await call('requester', 'GET', `/requests/${t.requestId}/restriction`)).json() as Json;
    expect(view).toMatchObject({ reason: REASON, requestId: t.requestId });
  });

  it('FR-0865 database level: row level security shows the rows only to the group, and another tenant context sees nothing', async () => {
    const { t } = await restrictedProject();
    const seen = (
      userKey: string,
      role: s.Role,
      q: (tx: Parameters<Parameters<typeof withContext>[2]>[0]) => Promise<unknown[]>,
    ) =>
      withContext(
        env.database,
        { tenantId: TENANT_ID, userId: uid(`user:${userKey}`), role },
        async (tx) => (await q(tx)).length,
      );
    const rq = (tx: Parameters<Parameters<typeof withContext>[2]>[0]) =>
      tx.select().from(s.request).where(eq(s.request.id, t.requestId));
    const pl = (tx: Parameters<Parameters<typeof withContext>[2]>[0]) =>
      tx.select().from(s.plan).where(eq(s.plan.requestId, t.requestId));
    const tn = (tx: Parameters<Parameters<typeof withContext>[2]>[0]) =>
      tx.select().from(s.tender).where(eq(s.tender.requestId, t.requestId));
    expect(await seen('admin', 'ADMIN', rq)).toBe(0);
    expect(await seen('requester', 'REQUESTER', rq)).toBe(1);
    expect(await seen('admin', 'ADMIN', pl)).toBe(0);
    expect(await seen('admin', 'ADMIN', tn)).toBe(0);
    expect(await seen('procurement', 'PROCUREMENT', tn)).toBe(1);
    // a context pointed at another tenant sees nothing at all
    const other = await withContext(
      env.database,
      { tenantId: randomUUID(), userId: uid('user:requester'), role: 'REQUESTER' },
      async (tx) => (await tx.select().from(s.request)).length,
    );
    expect(other).toBe(0);
  });

  it('FR-0865 lists, search, reports, dashboard counts and the assistant leave it out for everyone outside the group', async () => {
    const other = await who('other-proc', 'PROCUREMENT');
    const t0 = await k.stagedTender();
    const unique = `Zebra${randomUUID().slice(0, 6)}`;
    expect(
      (
        await call('requester', 'PATCH', `/requests/${t0.requestId}`, {
          title: `Restructure ${unique} programme`,
          version: 1,
        })
      ).statusCode,
    ).toBeLessThan(500);
    const title = ((await call('requester', 'GET', `/requests/${t0.requestId}`)).json() as Json)
      .title as string;
    const kpisBefore = (await call('admin', 'GET', '/dashboard/kpis')).json();
    const memberKpisBefore = (await call('procurement', 'GET', '/dashboard/kpis')).json();
    const searchBefore = (
      await call(other, 'POST', '/search', { query: title.split(' ')[1] })
    ).json() as Json;
    expect(JSON.stringify(searchBefore)).toContain(t0.requestId);
    expect(
      (await call('procurement', 'POST', `/requests/${t0.requestId}/restrict`, { reason: REASON }))
        .statusCode,
    ).toBe(201);

    for (const user of ['admin', 'exec', other]) {
      const list = (await call(user, 'GET', '/requests?limit=100')).json() as Json;
      expect(JSON.stringify(list), `${user} /requests`).not.toContain(t0.requestId);
      const plans = (await call(user, 'GET', '/plans')).json();
      expect(JSON.stringify(plans), `${user} /plans`).not.toContain(t0.requestId);
      const rep = (await call(user, 'GET', '/reports/procurements')).json();
      expect(JSON.stringify(rep), `${user} /reports/procurements`).not.toContain(t0.requestId);
      const spend = await call(user, 'GET', '/reports/spend');
      if (spend.statusCode === 200) expect(spend.body).not.toContain(t0.requestId);
      const found = await call(user, 'POST', '/search', { query: title.split(' ')[1] });
      if (found.statusCode === 200) expect(found.body, `${user} /search`).not.toContain(t0.requestId);
      const chat = await call(user, 'POST', '/assistant/chat', { message: `show me ${title}` });
      expect(chat.body, `${user} /assistant/chat`).not.toContain(unique);
    }
    // the dashboard counts follow the same rule: the numbers fall for someone outside the group and stay for the group
    const kpisAfter = (await call('admin', 'GET', '/dashboard/kpis')).json();
    expect(JSON.stringify(kpisAfter)).not.toEqual(JSON.stringify(kpisBefore));
    expect(JSON.stringify((await call('procurement', 'GET', '/dashboard/kpis')).json())).toEqual(
      JSON.stringify(memberKpisBefore),
    );
    // the group still finds it everywhere
    for (const user of ['requester', 'procurement']) {
      expect(JSON.stringify((await call(user, 'GET', '/requests?limit=100')).json())).toContain(t0.requestId);
      expect(JSON.stringify((await call(user, 'GET', '/reports/procurements')).json())).toContain(
        t0.requestId,
      );
    }
    expect(
      JSON.stringify((await call('procurement', 'POST', '/search', { query: title.split(' ')[1] })).json()),
    ).toContain(t0.requestId);
  });

  it('FR-0865 notifications that name the project are hidden from people outside the group and shown inside it', async () => {
    const { t } = await restrictedProject();
    const [req] = await sys<Array<typeof s.request.$inferSelect>>((tx) =>
      tx.select().from(s.request).where(eq(s.request.id, t.requestId)),
    );
    await sys(async (tx) => {
      for (const u of ['admin', 'requester'])
        await tx.insert(s.notification).values({
          tenantId: TENANT_ID,
          userId: uid(`user:${u}`),
          title: `Request ${req!.number} needs attention`,
          body: 'Open it to continue',
          link: `/app/requests/${t.requestId}`,
          event: 'TEST',
        });
      await tx.insert(s.notification).values({
        tenantId: TENANT_ID,
        userId: uid('user:admin'),
        title: 'An ordinary notice',
        link: '/app/dashboard',
        event: 'TEST',
      });
    });
    const admin = (await call('admin', 'GET', '/notifications')).json() as Json[];
    expect(admin.some((n) => n.title.includes(req!.number))).toBe(false);
    expect(admin.some((n) => n.title === 'An ordinary notice')).toBe(true);
    const mine = (await call('requester', 'GET', '/notifications')).json() as Json[];
    expect(mine.some((n) => n.title.includes(req!.number))).toBe(true);
  });

  it('FR-0865 the audit trail leaves its events out for people outside the group, shows them to the group, and to the probity adviser once allocated', async () => {
    const { t } = await restrictedProject();
    const trail = async (user: string, q: string) =>
      (await call(user, 'GET', `/audit-events?${q}`)).json() as Json;
    for (const user of ['admin', 'exec', 'probity']) {
      expect((await trail(user, `entityId=${t.requestId}`)).items, user).toEqual([]);
      expect((await trail(user, `requestId=${t.requestId}`)).items, user).toEqual([]);
      expect(JSON.stringify(await trail(user, 'limit=200'))).not.toContain(t.requestId);
    }
    expect((await trail('procurement', `entityId=${t.requestId}`)).items.length).toBeGreaterThan(0);
    // the probity adviser allocated to the tender joins the group
    await sys((tx) =>
      tx
        .insert(s.probityAllocation)
        .values({ tenantId: TENANT_ID, userId: uid('user:probity'), tenderId: t.id }),
    );
    expect((await trail('probity', `requestId=${t.requestId}`)).items.length).toBeGreaterThan(0);
    expect((await call('probity', 'GET', `/tenders/${t.id}`)).statusCode).toBe(200);
    // an administrator still cannot
    expect((await trail('admin', `requestId=${t.requestId}`)).items).toEqual([]);
  });

  it('FR-0865 plan text is ciphertext in the database, readable to the group, and stays encrypted when it is edited', async () => {
    const { t, planBefore } = await restrictedProject();
    const plain = (planBefore.fields as Json[]).filter((f) => f.value && String(f.value).length > 20);
    expect(plain.length).toBeGreaterThan(0);
    const raw = await sys<Array<{ key: string; value: string | null; previousValue: string | null }>>((tx) =>
      tx
        .select({
          key: s.fieldValue.key,
          value: s.fieldValue.value,
          previousValue: s.fieldValue.previousValue,
        })
        .from(s.fieldValue)
        .where(and(eq(s.fieldValue.ownerType, 'PLAN'), eq(s.fieldValue.ownerId, t.planId))),
    );
    for (const f of plain) {
      const row = raw.find((r) => r.key === f.key)!;
      expect(row.value!.startsWith('ifp1.'), f.key).toBe(true);
      expect(row.value).not.toContain(String(f.value).slice(0, 20));
    }
    const after = (await call('procurement', 'GET', `/requests/${t.requestId}/plan`)).json() as Json;
    for (const f of plain) expect((after.fields as Json[]).find((x) => x.key === f.key)!.value).toBe(f.value);
    // an edit after restriction is written encrypted and read back plain
    const marker = `Edited after restriction ${randomUUID()}`;
    // (the plan was approved and locked, so it is reopened first, which a restricted project allows its manager)
    expect(
      (
        await call('procurement', 'POST', `/plans/${t.planId}/reopen`, {
          reason: 'Edit after the restriction was set',
        })
      ).statusCode,
    ).toBe(200);
    const reopened = (await call('procurement', 'GET', `/requests/${t.requestId}/plan`)).json() as Json;
    const put = await call('procurement', 'PUT', `/plans/${t.planId}/fields/${plain[0]!.key}`, {
      value: marker,
      expectedVersion: reopened.version,
    });
    expect(put.statusCode, put.body).toBe(200);
    const row = (
      await sys<Array<{ value: string | null }>>((tx) =>
        tx
          .select({ value: s.fieldValue.value })
          .from(s.fieldValue)
          .where(and(eq(s.fieldValue.ownerId, t.planId), eq(s.fieldValue.key, plain[0]!.key))),
      )
    )[0]!;
    expect(row.value!.startsWith('ifp1.')).toBe(true);
    expect(row.value).not.toContain('Edited after');
    expect(
      ((await call('requester', 'GET', `/requests/${t.requestId}/plan`)).json().fields as Json[]).find(
        (x) => x.key === plain[0]!.key,
      )!.value,
    ).toBe(marker);
    // the document history keeps it encrypted too, and shows it plain to the group
    const v = await call('procurement', 'POST', `/documents/plan/${t.planId}/versions`, {
      label: 'After restriction',
    });
    expect(v.statusCode, v.body).toBe(201);
    {
      const stored = await sys<Array<{ snapshot: unknown }>>((tx) =>
        tx
          .select({ snapshot: s.documentVersion.snapshot })
          .from(s.documentVersion)
          .where(eq(s.documentVersion.ownerId, t.planId)),
      );
      expect(JSON.stringify(stored)).not.toContain(marker);
      const read = await call('procurement', 'GET', `/documents/plan/${t.planId}/versions/1`);
      expect(read.statusCode, read.body).toBe(200);
      expect(read.body).toContain(marker);
    }
  });

  it('FR-0865 the evaluation report narrative of a restricted project is stored encrypted and decrypts for the group', async () => {
    const a = await env.award();
    expect(
      (await call('procurement', 'POST', `/requests/${a.requestId}/restrict`, { reason: REASON })).statusCode,
    ).toBe(201);
    const text: Record<string, string> = Object.fromEntries(
      REPORT_SECTIONS.map((x) => [x.key, `Narrative for ${x.key} ${randomUUID()}`]),
    );
    await sys((tx) => storeReport(tx, TENANT_ID, a.evaluationId, text, 'DRAFT', env.clock.now()));
    const [rep] = await sys<Array<typeof s.evalReport.$inferSelect>>((tx) =>
      tx.select().from(s.evalReport).where(eq(s.evalReport.evaluationId, a.evaluationId)),
    );
    const rows = await sys<Array<typeof s.fieldValue.$inferSelect>>((tx) =>
      tx
        .select()
        .from(s.fieldValue)
        .where(and(eq(s.fieldValue.ownerType, 'EVAL_REPORT'), eq(s.fieldValue.ownerId, rep!.id))),
    );
    expect(rows.length).toBe(REPORT_SECTIONS.length);
    for (const r of rows) {
      expect(r.value!.startsWith('ifp1.')).toBe(true);
      expect(r.value).not.toContain('Narrative for');
    }
    const opened = await sys<Array<{ key: string; value: string | null }>>((tx) =>
      openFieldRows(tx, TENANT_ID, a.requestId, rows),
    );
    for (const o of opened) expect(o.value).toBe(text[o.key]);
    // and the evaluation itself is hidden outside the group
    const hiddenEv = await call('exec', 'GET', `/evaluations/${a.evaluationId}`);
    const noEv = await call('exec', 'GET', `/evaluations/${randomUUID()}`);
    expect(hiddenEv.statusCode).toBe(noEv.statusCode);
  });

  it('FR-0865 documents of a restricted project are sealed with the PROJECT key and open for named delegates only', async () => {
    const c = await env.draft();
    expect(
      (await call('procurement', 'POST', `/requests/${c.requestId}/restrict`, { reason: REASON })).statusCode,
    ).toBe(201);
    // legal is outside the group, so the contract is not theirs to open
    const hidden = await call('legal', 'GET', `/contracts/${c.id}`);
    expect(hidden.statusCode).toBe(404);
    // the manager names legal as a delegate, and the same request now works
    const del = await call('procurement', 'POST', `/requests/${c.requestId}/restriction/delegates`, {
      userId: uid('user:legal'),
    });
    expect(del.statusCode, del.body).toBe(201);
    expect((await call('legal', 'GET', `/contracts/${c.id}`)).statusCode).toBe(200);
    const up = await call('legal', 'POST', `/contracts/${c.id}/drafts`, {
      fileName: 'amended.txt',
      contentBase64: b64(Buffer.from('Restricted amendment text 5521')),
    });
    expect(up.statusCode, up.body).toBe(201);
    const [f] = await sys<Array<typeof s.contractFile.$inferSelect>>((tx) =>
      tx.select().from(s.contractFile).where(eq(s.contractFile.id, up.json().id)),
    );
    const store = new SealedStore(env.dir, 'e'.repeat(40));
    const raw = await store.rawBytes(f!.storageKey);
    expect(raw.includes('Restricted amendment text')).toBe(false);
    expect(blobEnvelope(raw).p).toBe('PROJECT');
    const dl = await call('legal', 'GET', `/contracts/${c.id}/drafts/${up.json().id}`);
    if (dl.statusCode === 200) expect(dl.body).toContain('Restricted amendment text 5521');
    // only the group can add delegates
    expect(
      (
        await call('requester', 'POST', `/requests/${c.requestId}/restriction/delegates`, {
          userId: uid('user:legal'),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call('exec', 'POST', `/requests/${c.requestId}/restriction/delegates`, {
          userId: uid('user:legal'),
        })
      ).statusCode,
    ).toBe(404);
  });

  it('FR-0865 the list of restricted projects shows each person only the ones they belong to, and rotating the PROJECT key keeps everything readable', async () => {
    const { t, planBefore } = await restrictedProject();
    const mine = (await call('procurement', 'GET', '/security/restricted-projects')).json() as Json[];
    expect(mine.map((x) => x.requestId)).toContain(t.requestId);
    expect(
      JSON.stringify((await call('admin', 'GET', '/security/restricted-projects')).json()),
    ).not.toContain(t.requestId);
    expect((await call('requester', 'GET', '/security/restricted-projects')).statusCode).toBe(403);
    expect((await call('admin', 'POST', '/security/keys/PROJECT/rotate')).statusCode).toBe(201);
    const rewrap = await call('admin', 'POST', '/security/keys/PROJECT/rewrap');
    expect(rewrap.statusCode, rewrap.body).toBe(200);
    expect(rewrap.json().rewrapped).toBeGreaterThan(0);
    const [rp] = await sys<Array<typeof s.restrictedProject.$inferSelect>>((tx) =>
      tx.select().from(s.restrictedProject).where(eq(s.restrictedProject.requestId, t.requestId)),
    );
    expect(rp!.keyVersion).toBe(2);
    const after = (await call('procurement', 'GET', `/requests/${t.requestId}/plan`)).json() as Json;
    expect((after.fields as Json[]).map((f) => f.value)).toEqual(
      (planBefore.fields as Json[]).map((f) => f.value),
    );
    // the infected-upload gate does not care about restriction
    expect(
      (
        await call('procurement', 'PUT', `/repository/projects/${t.requestId}/files/General/virus.txt`, {
          contentBase64: b64(Buffer.from(EICAR)),
        })
      ).statusCode,
    ).toBe(422);
    void BRIGHT;
  });
});
