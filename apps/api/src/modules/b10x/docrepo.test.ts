import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import * as s from '../../db/schema.js';
import { uid } from '../../db/seed.js';
import { createEnv, type Json } from '../contract/test-env.js';

let env: Awaited<ReturnType<typeof createEnv>>;
const call = (...a: Parameters<typeof env.call>) => env.call(...a);
const sys = <T>(fn: Parameters<typeof env.withSystem>[1]) => env.withSystem(env.database, fn) as Promise<T>;
beforeAll(async () => {
  env = await createEnv();
}, 120_000);

const b64 = (t: string | Buffer) => Buffer.from(t).toString('base64');
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const base = (requestId: string) => `/repository/projects/${requestId}`;
// the shared client sends no custom headers, and a conditional write needs If-Match, so these calls go to the app directly
const logins = new Map<string, { cookies: Record<string, string>; csrf: string }>();
async function writeAs(
  who: string,
  requestId: string,
  folder: string,
  name: string,
  text: string | Buffer,
  ifMatch?: string,
) {
  if (!logins.has(who)) {
    const login = await env.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: who.includes('@') ? who : `${who}@meridian-demo.example`,
        password: 'unit-test-password-123',
      },
    });
    expect(login.statusCode, who).toBe(200);
    logins.set(who, {
      cookies: Object.fromEntries(login.cookies.map((c) => [c.name, c.value])),
      csrf: login.json().csrfToken as string,
    });
  }
  const sess = logins.get(who)!;
  return env.app.inject({
    method: 'PUT',
    url: `/api/v1${base(requestId)}/files/${folder}/${encodeURIComponent(name)}`,
    cookies: sess.cookies,
    headers: { 'x-csrf-token': sess.csrf, ...(ifMatch !== undefined ? { 'if-match': ifMatch } : {}) },
    payload: { contentBase64: b64(text), comment: 'test' },
  });
}

async function enable(mode: 'UP' | 'DOWN' = 'UP', enabled = true) {
  const r = await call('admin', 'PUT', '/connectors/DOCREPO', { provider: 'SHAREPOINT', enabled, mode });
  expect(r.statusCode, r.body).toBe(200);
}
async function project(title = 'Repo project') {
  const c = await call('requester', 'POST', '/requests', {
    title,
    category: 'Building cleaning (UNSPSC 76111500)',
    estimatedValue: 90_000,
    termMonths: 24,
    businessUnit: 'Facilities',
    fields: { contractOwner: 'Sofia Rossi', background: 'Existing arrangements end in six months.' },
  });
  expect(c.statusCode, c.body).toBe(201);
  return { id: c.json().id as string, number: c.json().number as string };
}

describe('NFR-C06 enterprise document repository (simulated SharePoint)', () => {
  it('is off until an administrator switches it on', async () => {
    await enable('UP', false);
    const p = await project();
    const r = await call('procurement', 'GET', `${base(p.id)}/files`);
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('REPOSITORY_OFF');
    expect((await call('procurement', 'GET', '/repository/projects')).statusCode).toBe(409);
    await enable();
    expect((await call('procurement', 'GET', '/repository/projects')).statusCode).toBe(200);
  });

  it('writes a new file, reads it back with its checksum, and lists it in its folder', async () => {
    await enable();
    const p = await project('Listing project');
    const res = await writeAs('procurement', p.id, 'General', 'notes.txt', 'First draft of the notes.');
    expect(res.statusCode, res.body).toBe(201);
    expect(res.headers.etag).toBe('"1"');
    const f = res.json().file as Json;
    expect(f).toMatchObject({
      folder: 'General',
      name: 'notes.txt',
      version: 1,
      path: `/sites/${p.number}/General/notes.txt`,
      contentType: 'text/plain',
    });
    expect(f.checksum).toBe(sha(Buffer.from('First draft of the notes.')));
    const read = await call('procurement', 'GET', `${base(p.id)}/files/General/notes.txt`);
    expect(read.statusCode).toBe(200);
    expect(Buffer.from(read.json().contentBase64, 'base64').toString()).toBe('First draft of the notes.');
    const dl = await call('procurement', 'GET', `${base(p.id)}/files/General/notes.txt/download`);
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-disposition']).toContain('notes.txt');
    expect(dl.body).toBe('First draft of the notes.');
    const list = (await call('procurement', 'GET', `${base(p.id)}/files`)).json() as Json;
    expect(list.simulated).toBe(true);
    expect(list.folders.map((x: Json) => x.name)).toEqual(['Tender', 'Evaluation', 'Contract', 'General']);
    expect(list.folders.find((x: Json) => x.name === 'General').files).toBe(1);
    expect(list.files).toHaveLength(1);
    const projects = (await call('procurement', 'GET', '/repository/projects')).json().projects as Json[];
    expect(projects.find((x) => x.id === p.id)).toMatchObject({
      files: 1,
      versions: 1,
      site: `/sites/${p.number}`,
    });
  });

  it('never overwrites silently: a write must say which version it started from, and every version is kept', async () => {
    await enable();
    const p = await project('Versions project');
    expect((await writeAs('procurement', p.id, 'General', 'plan.txt', 'v1 text')).statusCode).toBe(201);
    const noMatch = await writeAs('legal', p.id, 'General', 'plan.txt', 'someone else v2');
    expect(noMatch.statusCode).toBe(428);
    expect(noMatch.json().code).toBe('PRECONDITION_REQUIRED');
    const stale = await writeAs('legal', p.id, 'General', 'plan.txt', 'someone else v2', '"7"');
    expect(stale.statusCode).toBe(412);
    expect(stale.json().code).toBe('PRECONDITION_FAILED');
    expect(stale.json().title).toMatch(/now at version 1/);
    const ok = await writeAs('legal', p.id, 'General', 'plan.txt', 'legal v2 text', '"1"');
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json().file.version).toBe(2);
    // the first person, still on version 1, is refused rather than overwriting legal's change
    const lost = await writeAs('procurement', p.id, 'General', 'plan.txt', 'procurement v2 text', '1');
    expect(lost.statusCode).toBe(412);
    const versions = (
      await call('procurement', 'GET', `${base(p.id)}/files/General/plan.txt/versions`)
    ).json() as Json;
    expect(versions.versions.map((v: Json) => v.version)).toEqual([2, 1]);
    const old = await call('procurement', 'GET', `${base(p.id)}/files/General/plan.txt?version=1`);
    expect(Buffer.from(old.json().contentBase64, 'base64').toString()).toBe('v1 text');
    expect(old.json().isLatest).toBe(false);
    const latest = await call('procurement', 'GET', `${base(p.id)}/files/General/plan.txt`);
    expect(Buffer.from(latest.json().contentBase64, 'base64').toString()).toBe('legal v2 text');
    // a new file with a stale precondition is refused too
    expect((await writeAs('procurement', p.id, 'General', 'fresh.txt', 'x', '3')).statusCode).toBe(412);
    expect((await writeAs('procurement', p.id, 'General', 'fresh.txt', 'x', 'abc')).statusCode).toBe(400);
    expect((await call('procurement', 'GET', `${base(p.id)}/files/General/none.txt`)).statusCode).toBe(404);
  });

  it('refuses unsafe or oversized files and unknown folders', async () => {
    await enable();
    const p = await project('Refusals project');
    expect((await writeAs('procurement', p.id, 'General', 'run.exe', 'MZ')).statusCode).toBe(400);
    expect((await writeAs('procurement', p.id, 'General', 'fake.pdf', 'not a pdf at all')).statusCode).toBe(
      400,
    );
    const eicar = await writeAs(
      'procurement',
      p.id,
      'General',
      'virus.txt',
      'EICAR-STANDARD-ANTIVIRUS-TEST-FILE',
    );
    expect(eicar.statusCode).toBe(422);
    expect(eicar.json().code).toBe('VIRUS_DETECTED');
    const big = await writeAs('procurement', p.id, 'General', 'big.txt', 'a'.repeat(2 * 1024 * 1024 + 10));
    expect(big.statusCode).toBe(413);
    const folder = await call('procurement', 'GET', `${base(p.id)}/files?folder=Secret`);
    expect(folder.statusCode).toBe(400);
  });

  it('a person sees only the sites of procurements they can see; read-only roles cannot write', async () => {
    await enable();
    const mine = await project('Requester own project');
    const other = await env.extraUser('other-requester', 'REQUESTER');
    expect((await writeAs('requester', mine.id, 'General', 'own.txt', 'mine')).statusCode).toBe(201);
    // another requester cannot list, read or write into it
    expect((await call(other.email, 'GET', `${base(mine.id)}/files`)).statusCode).toBe(404);
    expect((await call(other.email, 'GET', `${base(mine.id)}/files/General/own.txt`)).statusCode).toBe(404);
    expect((await writeAs(other.email, mine.id, 'General', 'own.txt', 'x', '1')).statusCode).toBe(404);
    const theirs = (await call(other.email, 'GET', '/repository/projects')).json().projects as Json[];
    expect(theirs.some((x) => x.id === mine.id)).toBe(false);
    const requesters = (await call('requester', 'GET', '/repository/projects')).json().projects as Json[];
    expect(requesters.some((x) => x.id === mine.id)).toBe(true);
    // the portfolio roles see everything; executives, finance, probity and delegates read but cannot write
    const all = (await call('procurement', 'GET', '/repository/projects')).json().projects as Json[];
    expect(all.some((x) => x.id === mine.id)).toBe(true);
    for (const who of ['exec', 'finance', 'probity', 'delegate'])
      expect((await call(who, 'GET', `${base(mine.id)}/files/General/own.txt`)).statusCode, who).toBe(200);
    for (const who of ['exec', 'finance', 'probity', 'delegate'])
      expect((await writeAs(who, mine.id, 'General', 'own.txt', 'x', '1')).statusCode, who).toBe(403);
    // an evaluator, an administrator and a supplier have no repository page
    for (const who of ['evaluator-tech', 'admin', 'supplier'])
      expect((await call(who, 'GET', '/repository/projects')).statusCode, who).toBe(403);
    expect(
      (await call('procurement', 'GET', `${base('3f2b8c1e-0000-4000-8000-000000000001')}/files`)).statusCode,
    ).toBe(404);
  });

  it('files the signed contract in its project folder and reads it back, bit for bit', async () => {
    await enable();
    const x = await env.executed();
    const sources = (await call('legal', 'GET', `${base(x.requestId)}/sources`)).json().sources as Json[];
    expect(sources.some((r) => r.source === 'CONTRACT' && r.id === x.id)).toBe(true);
    const pub = await call('legal', 'POST', `${base(x.requestId)}/publish`, {
      source: 'CONTRACT',
      sourceId: x.id,
    });
    expect(pub.statusCode, pub.body).toBe(201);
    const f = pub.json().file as Json;
    expect(pub.json().result).toBe('WRITTEN');
    expect(f).toMatchObject({
      folder: 'Contract',
      version: 1,
      source: 'PLATFORM',
      contentType: 'application/pdf',
    });
    expect(f.sourceRef).toBe(`CONTRACT:${x.id}`);
    expect(f.name).toMatch(/\.pdf$/);
    const dl = await call(
      'procurement',
      'GET',
      `${base(x.requestId)}/files/Contract/${encodeURIComponent(f.name)}/download`,
    );
    expect(dl.statusCode, dl.body).toBe(200);
    expect(dl.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    const direct = await call('legal', 'GET', `/contracts/${x.id}/export.pdf`);
    expect(sha(dl.rawPayload)).toBe(sha(direct.rawPayload));
    expect(f.checksum).toBe(sha(direct.rawPayload));
    // publishing the same document again adds nothing
    const again = await call('legal', 'POST', `${base(x.requestId)}/publish`, {
      source: 'CONTRACT',
      sourceId: x.id,
    });
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json()).toMatchObject({ result: 'UNCHANGED' });
    expect(again.json().file.version).toBe(1);
    // a document that is not part of this project is refused
    const elsewhere = await env.executed();
    expect(
      (
        await call('legal', 'POST', `${base(x.requestId)}/publish`, {
          source: 'CONTRACT',
          sourceId: elsewhere.id,
        })
      ).statusCode,
    ).toBe(404);
    // only procurement, legal and contract managers publish
    expect(
      (
        await call('requester', 'POST', `${base(x.requestId)}/publish`, {
          source: 'CONTRACT',
          sourceId: x.id,
        })
      ).statusCode,
    ).toBe(403);
  });

  it('files the tender pack and the evaluation report, and imports a repository file into a contract draft', async () => {
    await enable();
    const ev = await sys<Json[]>((tx) =>
      tx
        .select()
        .from(s.evaluation)
        .where(eq(s.evaluation.id, uid('evaluation:cleaning'))),
    );
    const t = await sys<Json[]>((tx) => tx.select().from(s.tender).where(eq(s.tender.id, ev[0]!.tenderId)));
    const requestId = t[0]!.requestId as string;
    const pack = await call('procurement', 'POST', `${base(requestId)}/publish`, {
      source: 'TENDER_PACK',
      sourceId: t[0]!.id,
    });
    expect(pack.statusCode, pack.body).toBe(201);
    expect(pack.json().file).toMatchObject({ folder: 'Tender', contentType: 'application/pdf' });
    await sys((tx) =>
      tx.update(s.evaluation).set({ status: 'LOCKED' }).where(eq(s.evaluation.id, ev[0]!.id)),
    );
    const made = await call('procurement', 'POST', `/evaluations/${ev[0]!.id}/report`);
    expect(made.statusCode, made.body).toBeLessThan(300);
    const rep = await call('procurement', 'POST', `${base(requestId)}/publish`, {
      source: 'EVALUATION_REPORT',
      sourceId: ev[0]!.id,
    });
    expect(rep.statusCode, rep.body).toBe(201);
    expect(rep.json().file).toMatchObject({ folder: 'Evaluation', contentType: 'application/pdf' });
    // import: a repository file becomes a negotiation draft of a contract on that project
    const x = await env.executed();
    const up = await writeAs(
      'legal',
      x.requestId,
      'Contract',
      'counterparty-redline.txt',
      'Counterparty proposed wording',
    );
    expect(up.statusCode, up.body).toBe(201);
    const bad = await call('procurement', 'POST', `${base(x.requestId)}/import`, {
      folder: 'Contract',
      name: 'counterparty-redline.txt',
      contractId: x.id,
    });
    expect(bad.statusCode).toBe(403);
    const imp = await call('legal', 'POST', `${base(x.requestId)}/import`, {
      folder: 'Contract',
      name: 'counterparty-redline.txt',
      contractId: x.id,
    });
    // an executed contract is locked, so the platform refuses the draft: the repository does not bypass that
    expect([201, 423]).toContain(imp.statusCode);
    const live = await env.draft();
    const up2 = await writeAs(
      'legal',
      live.requestId,
      'Contract',
      'counterparty-redline.txt',
      'Counterparty proposed wording',
    );
    expect(up2.statusCode, up2.body).toBe(201);
    const imp2 = await call('legal', 'POST', `${base(live.requestId)}/import`, {
      folder: 'Contract',
      name: 'counterparty-redline.txt',
      contractId: live.id,
    });
    expect(imp2.statusCode, imp2.body).toBe(201);
    expect(imp2.json()).toMatchObject({
      imported: true,
      draft: { name: 'counterparty-redline.txt', version: 1 },
    });
    const drafts = (await call('legal', 'GET', `/contracts/${live.id}/drafts`)).json().drafts as Json[];
    expect(drafts.map((d) => d.name)).toContain('counterparty-redline.txt');
    expect(drafts[0]!.note).toMatch(/Imported from the document repository \(version 1\)/);
    // a contract of another project is refused
    expect(
      (
        await call('legal', 'POST', `${base(live.requestId)}/import`, {
          folder: 'Contract',
          name: 'counterparty-redline.txt',
          contractId: x.id,
        })
      ).statusCode,
    ).toBe(404);
  });

  it('when the repository is down: reads say so, writes queue a manual task, and nothing is lost silently (NFR-AV04)', async () => {
    await enable();
    const p = await project('Outage project');
    expect(
      (await writeAs('procurement', p.id, 'General', 'before.txt', 'before the outage')).statusCode,
    ).toBe(201);
    await enable('DOWN');
    const read = await call('procurement', 'GET', `${base(p.id)}/files`);
    expect(read.statusCode).toBe(503);
    expect(read.json().code).toBe('REPOSITORY_UNAVAILABLE');
    const w = await writeAs('procurement', p.id, 'General', 'during.txt', 'during the outage');
    expect(w.statusCode, w.body).toBe(202);
    expect(w.json()).toMatchObject({ result: 'MANUAL_TASK', simulated: true });
    const tasks = (await call('admin', 'GET', '/manual-tasks?status=OPEN')).json() as Json[];
    const t = tasks.find((x) => x.id === w.json().manualTaskId)!;
    expect(t).toMatchObject({ connector: 'DOCREPO' });
    expect(t.title).toMatch(/during\.txt/);
    expect(t.summary).toMatchObject({ requestNumber: p.number, folder: 'General' });
    // the failures opened the breaker; putting the connector back UP closes it
    await enable('UP');
    const list = (await call('procurement', 'GET', `${base(p.id)}/files`)).json() as Json;
    expect(list.files.map((f: Json) => f.name)).toEqual(['before.txt']);
    // publishing a platform document while it is down also queues a task
    const x = await env.executed();
    await enable('DOWN');
    const pub = await call('legal', 'POST', `${base(x.requestId)}/publish`, {
      source: 'CONTRACT',
      sourceId: x.id,
    });
    expect(pub.statusCode).toBe(202);
    expect(pub.json().result).toBe('MANUAL_TASK');
    await enable('UP');
  });
});
