import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, type ManualClock } from '@if/shared';
import { buildApp } from '../../app.js';
import { withSystem, type Database } from '../../db/client.js';
import * as s from '../../db/schema.js';
import { emailFor, seedDatabase, TENANT_ID, uid } from '../../db/seed.js';
import { freshDb, newClock } from '../../test-helpers.js';
import { cell, toCsv } from './csv.js';

const PASSWORD = 'unit-test-password-123';
let app: FastifyInstance;
let database: Database;
let clock: ManualClock;

type Sess = { cookies: Record<string, string>; csrf: string };
const sessions = new Map<string, Sess>();
async function call(key: string, method: 'GET' | 'POST', url: string, payload?: unknown) {
  if (!sessions.has(key)) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: emailFor(key), password: PASSWORD },
    });
    expect(res.statusCode, `${key}: ${res.body}`).toBe(200);
    sessions.set(key, {
      cookies: Object.fromEntries(res.cookies.map((c) => [c.name, c.value])),
      csrf: res.json().csrfToken as string,
    });
  }
  const sess = sessions.get(key)!;
  return app.inject({
    method,
    url: `/api/v1${url}`,
    cookies: sess.cookies,
    headers: method === 'GET' ? {} : { 'x-csrf-token': sess.csrf },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
}

beforeAll(async () => {
  database = await freshDb();
  clock = newClock();
  await seedDatabase(database, { clock, password: PASSWORD });
  const dir = await mkdtemp(join(tmpdir(), 'if-report-'));
  app = await buildApp(loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 'r'.repeat(40), STORAGE_DIR: dir }), {
    database,
    clock,
    loginRateLimitMax: 10_000,
  });
}, 120_000);

interface Row {
  id: string;
  number: string;
  phase: string;
  status: string;
  estimatedValue: number;
  steps: Record<'intake' | 'plan' | 'tender' | 'evaluation' | 'contract', boolean>;
}
const table = async (who: string, qs = '') =>
  (await call(who, 'GET', `/reports/procurements${qs}`)).json() as { scope: string; items: Row[] };
const kpis = async (who: string) => (await call(who, 'GET', '/dashboard/kpis')).json();
const allRequests = () =>
  withSystem(database, (tx) => tx.select().from(s.request).where(eq(s.request.tenantId, TENANT_ID)));

describe('US-RPT-01 role-scoped figures: executives see the portfolio, requesters their own', () => {
  it('portfolio roles see every request; the KPIs agree with the table', async () => {
    const all = await allRequests();
    const active = all.filter((r) => r.status !== 'COMPLETE');
    for (const who of [
      'exec',
      'finance',
      'procurement',
      'delegate',
      'legal',
      'contract-mgr',
      'probity',
      'admin',
    ]) {
      const t = await table(who);
      expect(t.scope, who).toBe('PORTFOLIO');
      expect(t.items.map((x) => x.id).sort(), who).toEqual(all.map((r) => r.id).sort());
      const k = await kpis(who);
      expect(k.scope).toBe('PORTFOLIO');
      expect(k.activeProcurements, who).toBe(active.length);
      expect(k.valueInFlight, who).toBe(active.reduce((n, r) => n + Number(r.estimatedValue ?? 0), 0));
    }
  });

  it('a requester sees only the requests they raised, in the table and in every figure', async () => {
    // another person raises a request; the requester must not see it
    const theirs = await call('procurement', 'POST', '/requests', {
      title: 'Raised by someone else',
      estimatedValue: 9000,
    });
    expect(theirs.statusCode, theirs.body).toBe(201);
    const mine = (await allRequests()).filter((r) => r.requesterId === uid('user:requester'));
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.length).toBeLessThan((await allRequests()).length);
    const t = await table('requester');
    expect(t.scope).toBe('OWN');
    expect(t.items.map((x) => x.id).sort()).toEqual(mine.map((r) => r.id).sort());
    const k = await kpis('requester');
    expect(k.scope).toBe('OWN');
    expect(k.activeProcurements).toBe(mine.filter((r) => r.status !== 'COMPLETE').length);
    expect(k.recent.every((r: { id: string }) => mine.some((m) => m.id === r.id))).toBe(true);
    expect(k.alertsDue).toBeNull();
    // a requester who raised nothing sees nothing
    const other = await call('supplier', 'GET', '/reports/procurements');
    expect(other.statusCode).toBe(403);
  });

  it('evaluators and the chair see only the procurement they evaluate, and lose it when removed', async () => {
    const t = await table('evaluator-tech');
    expect(t.scope).toBe('PANEL');
    expect(t.items).toHaveLength(1);
    expect(t.items[0]!.number).toMatch(/^PR-/);
    const k = await kpis('evaluator-tech');
    expect(k.activeProcurements).toBe(1);
    expect(k.pendingMyAction).toBe(1);
    expect((await table('chair')).items).toHaveLength(1);
    // suspended from the panel: the procurement disappears from their reports
    await withSystem(database, (tx) =>
      tx
        .update(s.panelMember)
        .set({ coiState: 'REMOVED' })
        .where(eq(s.panelMember.userId, uid('user:evaluator-tech'))),
    );
    expect((await table('evaluator-tech')).items).toHaveLength(0);
    expect((await kpis('evaluator-tech')).pendingMyAction).toBe(0);
    await withSystem(database, (tx) =>
      tx
        .update(s.panelMember)
        .set({ coiState: 'DECLARED_NONE' })
        .where(eq(s.panelMember.userId, uid('user:evaluator-tech'))),
    );
  });

  it('alerts due are shown only to contract management and oversight', async () => {
    expect(typeof (await kpis('contract-mgr')).alertsDue).toBe('number');
    expect(typeof (await kpis('exec')).alertsDue).toBe('number');
    for (const who of ['requester', 'evaluator-tech', 'finance', 'delegate', 'probity'])
      expect((await kpis(who)).alertsDue, who).toBeNull();
  });

  it('filters the table by phase, status and text', async () => {
    const all = (await table('exec')).items;
    const phase = all[0]!.phase;
    const byPhase = (await table('exec', `?phase=${phase}`)).items;
    expect(byPhase.length).toBeGreaterThan(0);
    expect(byPhase.every((x) => x.phase === phase)).toBe(true);
    const one = (await table('exec', `?q=${all[0]!.number}`)).items;
    expect(one.map((x) => x.id)).toEqual([all[0]!.id]);
    expect((await table('exec', '?q=zzzzzz-nothing')).items).toEqual([]);
  });
});

describe('completion indicators follow the real records', () => {
  it('a step is ticked only when its record reached the end state', async () => {
    const t = (await table('exec')).items;
    const cleaning = t.find((x) => x.number === 'PR-2026-0001')!;
    expect(cleaning.steps).toMatchObject({ intake: true, tender: true, evaluation: false, contract: false });
    // approving the evaluation ticks it
    await withSystem(database, async (tx) => {
      const [tn] = await tx.select().from(s.tender).where(eq(s.tender.requestId, cleaning.id));
      await tx.update(s.evaluation).set({ status: 'APPROVED' }).where(eq(s.evaluation.tenderId, tn!.id));
    });
    const after = (await table('exec')).items.find((x) => x.number === 'PR-2026-0001')!;
    expect(after.steps.evaluation).toBe(true);
    expect(after.steps.contract).toBe(false);
    await withSystem(database, async (tx) => {
      const [tn] = await tx.select().from(s.tender).where(eq(s.tender.requestId, cleaning.id));
      await tx.update(s.evaluation).set({ status: 'CONSENSUS' }).where(eq(s.evaluation.tenderId, tn!.id));
    });
    // a draft request has nothing ticked
    const created = await call('requester', 'POST', '/requests', {
      title: 'Draft for ticks',
      estimatedValue: 5000,
    });
    const draft = (await table('requester')).items.find((x) => x.id === created.json().id)!;
    expect(Object.values(draft.steps)).toEqual([false, false, false, false, false]);
  });
});

describe('spend by category', () => {
  it('sums the pipeline and the executed contracts, with unlinked contracts shown honestly', async () => {
    const r = (await call('finance', 'GET', '/reports/spend')).json() as {
      byCategory: Array<{ category: string; pipeline: number; committed: number }>;
      totalPipeline: number;
      totalCommitted: number;
    };
    const all = await allRequests();
    expect(r.totalPipeline).toBe(
      all.filter((x) => x.status !== 'COMPLETE').reduce((n, x) => n + Number(x.estimatedValue ?? 0), 0),
    );
    expect(r.totalCommitted).toBe(210_000 + 95_000);
    expect(r.byCategory.find((c) => c.category === 'Contracts not linked to a request')?.committed).toBe(
      305_000,
    );
    expect(r.byCategory.reduce((n, c) => n + c.pipeline, 0)).toBe(r.totalPipeline);
    for (const who of ['exec', 'procurement'])
      expect((await call(who, 'GET', '/reports/spend')).statusCode, who).toBe(200);
    for (const who of ['requester', 'evaluator-tech', 'delegate', 'probity', 'admin', 'legal'])
      expect((await call(who, 'GET', '/reports/spend')).statusCode, who).toBe(403);
  });
});

describe('US-RPT-02 audit trail search and export', () => {
  it('who may read and who may export', async () => {
    for (const who of ['probity', 'admin', 'exec', 'procurement'])
      expect((await call(who, 'GET', '/audit-events')).statusCode, who).toBe(200);
    for (const who of ['requester', 'evaluator-tech', 'finance', 'delegate', 'supplier'])
      expect((await call(who, 'GET', '/audit-events')).statusCode, who).toBe(403);
    for (const who of ['probity', 'admin'])
      expect((await call(who, 'GET', '/audit-events/export')).statusCode, who).toBe(200);
    for (const who of ['exec', 'procurement', 'requester', 'finance'])
      expect((await call(who, 'GET', '/audit-events/export')).statusCode, who).toBe(403);
  });

  it('lists who did what and when, newest first, with field-level before and after, paged and filterable', async () => {
    const created = await call('requester', 'POST', '/requests', {
      title: 'Audit trail fixture',
      category: 'Building cleaning (UNSPSC 76111500)',
      estimatedValue: 7000,
      termMonths: 12,
      businessUnit: 'Facilities',
      fields: { contractOwner: 'Sofia Rossi' },
    });
    const requestId = created.json().id as string;
    expect((await call('requester', 'POST', `/requests/${requestId}/submit`)).statusCode).toBe(200);

    const page = (await call('probity', 'GET', '/audit-events?limit=5')).json();
    expect(page.items).toHaveLength(5);
    expect(page.page.total).toBeGreaterThan(5);
    expect(page.page.limit).toBe(5);
    expect(page.items[0].seq).toBeGreaterThan(page.items[1].seq);
    const next = (await call('probity', 'GET', '/audit-events?limit=5&offset=5')).json();
    expect(next.items[0].seq).toBeLessThan(page.items[4].seq);

    const trail = (await call('probity', 'GET', `/audit-events?requestId=${requestId}`)).json();
    const actions = trail.items.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['request.create', 'request.submit']));
    const submit = trail.items.find((e: { action: string }) => e.action === 'request.submit');
    expect(submit.actorName).toBe('Riley Chen');
    expect(submit.actorRole).toBe('REQUESTER');
    expect(submit.before).toMatchObject({ status: 'DRAFT' });
    expect(submit.after).toMatchObject({ status: 'SUBMITTED' });
    expect(submit.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(trail.items.every((e: { entityId: string }) => e.entityId === requestId)).toBe(true);

    const byAction = (await call('probity', 'GET', '/audit-events?action=request.')).json();
    expect(byAction.items.every((e: { action: string }) => e.action.startsWith('request.'))).toBe(true);
    const byActor = (
      await call('probity', 'GET', `/audit-events?actorId=${uid('user:requester')}&limit=200`)
    ).json();
    expect(byActor.items.length).toBeGreaterThan(0);
    expect(byActor.items.every((e: { actorId: string }) => e.actorId === uid('user:requester'))).toBe(true);
    const future = (await call('probity', 'GET', '/audit-events?from=2099-01-01')).json();
    expect(future.items).toEqual([]);
  });

  it('a procurement trail follows the request through its plan, tender and evaluation', async () => {
    const [cleaning] = (await allRequests()).filter((r) => r.number === 'PR-2026-0001');
    const trail = (await call('probity', 'GET', `/audit-events?requestId=${cleaning!.id}&limit=200`)).json();
    const types = new Set(trail.items.map((e: { entityType: string }) => e.entityType));
    expect(types.has('evaluation')).toBe(true);
    expect(types.size).toBeGreaterThan(2);
  });

  it('rejects bad filters', async () => {
    for (const qs of [
      '?limit=0',
      '?limit=1000',
      '?from=yesterday',
      '?actorId=nope',
      '?bogus=1',
      '?result=MAYBE',
    ])
      expect((await call('probity', 'GET', `/audit-events${qs}`)).statusCode, qs).toBe(400);
  });

  it('the export is a CSV with the same rows, and the export itself is audited (and not in its own file)', async () => {
    const before = (await call('probity', 'GET', '/audit-events?action=audit.export')).json().page
      .total as number;
    const res = await call('probity', 'GET', '/audit-events/export?action=request.');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="audit-trail-\d{8}\.csv"/);
    expect(res.body.charCodeAt(0)).toBe(0xfeff);
    const lines = res.body.slice(1).trim().split('\r\n');
    expect(lines[0]).toBe('Seq,Time (UTC),Actor,Role,Action,Entity type,Entity id,Result,Before,After,Hash');
    const listed = (await call('probity', 'GET', '/audit-events?action=request.&limit=200')).json().page
      .total as number;
    expect(lines.length - 1).toBe(listed);
    expect(res.body).not.toContain('audit.export');
    const after = (await call('probity', 'GET', '/audit-events?action=audit.export')).json();
    expect(after.page.total).toBe(before + 1);
    expect(after.items[0]).toMatchObject({ actorRole: 'PROBITY', entityType: 'audit' });
    expect(after.items[0].after).toMatchObject({ rows: listed, filters: { action: 'request.' } });
    // exporting is a recorded action even when it fails validation
    expect((await call('probity', 'GET', '/audit-events/export?limit=5')).statusCode).toBe(400);
  });

  it('the exported rows verify against the hash chain: the log itself is unaltered', async () => {
    const { AuditService } = await import('../../audit/audit-service.js');
    const v = await new AuditService(clock).verifyChain(database, TENANT_ID);
    expect(v.ok).toBe(true);
    expect(v.checked).toBeGreaterThan(50);
    const [row] = await withSystem(database, (tx) =>
      tx
        .select()
        .from(s.auditEvent)
        .where(and(eq(s.auditEvent.tenantId, TENANT_ID), eq(s.auditEvent.action, 'audit.export'))),
    );
    expect(row).toBeTruthy();
  });
});

describe('CSV writing', () => {
  it('quotes commas, quotes and newlines, and defuses spreadsheet formulas', () => {
    expect(cell('a,b')).toBe('"a,b"');
    expect(cell('say "hi"')).toBe('"say ""hi"""');
    expect(cell('two\nlines')).toBe('"two\nlines"');
    expect(cell('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(cell('+1')).toBe("'+1");
    expect(cell('@cmd')).toBe("'@cmd");
    expect(cell('-1+1')).toBe("'-1+1");
    expect(cell(-5)).toBe('-5');
    expect(cell(null)).toBe('');
    expect(toCsv(['a'], [['x'], [1]])).toBe(`${String.fromCharCode(0xfeff)}a\r\nx\r\n1\r\n`);
  });
});
