import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { withContext } from '../../db/client.js';
import * as s from '../../db/schema.js';
import { TENANT_ID, uid } from '../../db/seed.js';
import { createEnv, type Json } from '../contract/test-env.js';
import { roleSetProblem } from './directory.js';

let env: Awaited<ReturnType<typeof createEnv>>;
beforeAll(async () => {
  env = await createEnv();
}, 120_000);
const sys = <T>(fn: Parameters<typeof env.withSystem>[1]) => env.withSystem(env.database, fn) as Promise<T>;
const login = (email: string, password: string) =>
  env.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
const PW = 'New-Staff-Passw0rd-1';

describe('roles that may be held together', () => {
  it('administrator stands alone; a person needs at least one role', () => {
    expect(roleSetProblem([])).toMatch(/at least one/);
    expect(roleSetProblem(['ADMIN', 'PROCUREMENT'])).toMatch(/cannot be combined/);
    expect(roleSetProblem(['ADMIN'])).toBeNull();
    expect(roleSetProblem(['EVALUATOR', 'CHAIR'])).toBeNull();
  });
});

describe('users and roles (US-ADM-01)', () => {
  it('creates a user with roles; they activate through a one-time link, then sign in with exactly those roles', async () => {
    const units = (await env.call('admin', 'GET', '/admin/org-units')).json() as Json[];
    expect(units.length).toBeGreaterThan(3);
    const r = await env.call('admin', 'POST', '/admin/users', {
      name: 'New Starter',
      email: 'New.Starter@meridian-demo.example',
      roles: ['REQUESTER', 'EVALUATOR'],
      orgUnitId: units[0]!.id,
    });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().user).toMatchObject({
      name: 'New Starter',
      email: 'new.starter@meridian-demo.example',
      active: true,
      awaitingActivation: true,
    });
    expect(r.json().user.roles.sort()).toEqual(['EVALUATOR', 'REQUESTER']);
    const link = r.json().activationPath as string;
    expect(link).toMatch(/^\/activate\?token=[\w-]{40,}$/);
    const token = link.split('token=')[1]!;
    // nobody can sign in until they have set a password
    expect((await login('new.starter@meridian-demo.example', PW)).statusCode).toBe(401);
    const info = await env.app.inject({ method: 'GET', url: `/api/v1/supplier/activate/${token}` });
    expect(info.json()).toMatchObject({ name: 'New Starter', company: '' });
    expect(
      (
        await env.app.inject({
          method: 'POST',
          url: '/api/v1/supplier/activate',
          payload: { token, password: PW },
        })
      ).statusCode,
    ).toBe(200);
    const ok = await login('new.starter@meridian-demo.example', PW);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().user.roles.sort()).toEqual(['EVALUATOR', 'REQUESTER']);
    expect(ok.cookies.some((c) => c.name === 'if_session')).toBe(true);
    const audit = await sys<Json[]>((tx) =>
      tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'user.create')),
    );
    expect(audit.some((e) => (e.after as Json).email === 'new.starter@meridian-demo.example')).toBe(true);
    expect(JSON.stringify(audit)).not.toContain(token);
  });

  it('refuses a taken email, a combined administrator role, bad input and unknown units; only the administrator may', async () => {
    const base = { name: 'Another Person', email: 'another@meridian-demo.example', roles: ['FINANCE'] };
    expect(
      (
        await env.call('admin', 'POST', '/admin/users', { ...base, email: 'legal@meridian-demo.example' })
      ).json().code,
    ).toBe('EMAIL_IN_USE');
    const combo = await env.call('admin', 'POST', '/admin/users', { ...base, roles: ['ADMIN', 'EVALUATOR'] });
    expect(combo.statusCode).toBe(422);
    expect(combo.json().code).toBe('ROLE_COMBINATION');
    for (const b of [
      { ...base, roles: [] },
      { ...base, roles: ['SUPPLIER'] },
      { ...base, roles: ['NOPE'] },
      { ...base, name: 'x' },
      { ...base, email: 'nope' },
      { ...base, extra: 1 },
    ])
      expect((await env.call('admin', 'POST', '/admin/users', b)).statusCode, JSON.stringify(b)).toBe(400);
    expect(
      (
        await env.call('admin', 'POST', '/admin/users', {
          ...base,
          orgUnitId: '00000000-0000-4000-8000-000000000000',
        })
      ).statusCode,
    ).toBe(404);
    for (const who of ['exec', 'procurement', 'legal', 'requester'])
      expect((await env.call(who, 'POST', '/admin/users', base)).statusCode, who).toBe(403);
  });

  it('changing roles or switching a person off ends their sessions at once; they can be switched on again; it is audited', async () => {
    const person = await env.extraUser('rolechange', 'REQUESTER');
    expect((await env.call(person.email, 'GET', '/requests')).statusCode).toBe(200);
    const up = await env.call('admin', 'PUT', `/admin/users/${person.id}`, { roles: ['FINANCE'] });
    expect(up.statusCode, up.body).toBe(200);
    expect(up.json().roles).toEqual(['FINANCE']);
    const audit = await sys<Json[]>((tx) =>
      tx
        .select()
        .from(s.auditEvent)
        .where(and(eq(s.auditEvent.entityId, person.id), eq(s.auditEvent.action, 'user.update'))),
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.before).toMatchObject({ roles: ['REQUESTER'] });
    expect(audit[0]!.after).toMatchObject({ roles: ['FINANCE'], sessionsEnded: 1 });
    // the old session no longer works; a new sign-in carries the new role
    const sessions = await sys<Json[]>((tx) =>
      tx.select().from(s.session).where(eq(s.session.userId, person.id)),
    );
    expect(sessions.every((x) => x.revokedAt)).toBe(true);
    const fresh = await login(person.email, 'unit-test-password-123');
    expect(fresh.json().user.roles).toEqual(['FINANCE']);

    const off = await env.call('admin', 'PUT', `/admin/users/${person.id}`, { active: false });
    expect(off.json().active).toBe(false);
    expect((await login(person.email, 'unit-test-password-123')).statusCode).toBe(401);
    expect(
      (await env.call('admin', 'PUT', `/admin/users/${person.id}`, { active: true })).json().active,
    ).toBe(true);
    expect((await login(person.email, 'unit-test-password-123')).statusCode).toBe(200);
    const unit = ((await env.call('admin', 'GET', '/admin/org-units')).json() as Json[])[1]!;
    const moved = await env.call('admin', 'PUT', `/admin/users/${person.id}`, {
      name: 'Renamed Person',
      orgUnitId: unit.id,
    });
    expect(moved.json()).toMatchObject({ name: 'Renamed Person', orgUnit: unit.name });
  });

  it('guards against locking the administrators out: not yourself, not a combined role, only staff, only the administrator', async () => {
    const adminId = uid('user:admin');
    const self = await env.call('admin', 'PUT', `/admin/users/${adminId}`, { active: false });
    expect(self.statusCode).toBe(403);
    expect(self.json().code).toBe('ROLE_SOD_VIOLATION');
    expect((await env.call('admin', 'PUT', `/admin/users/${adminId}`, { roles: ['EXEC'] })).statusCode).toBe(
      403,
    );
    const person = await env.extraUser('plain', 'REQUESTER');
    expect(
      (
        await env.call('admin', 'PUT', `/admin/users/${person.id}`, { roles: ['ADMIN', 'PROCUREMENT'] })
      ).json().code,
    ).toBe('ROLE_COMBINATION');
    expect(
      (await env.call('admin', 'PUT', `/admin/users/${uid('user:supplier')}`, { active: false })).statusCode,
    ).toBe(404);
    expect(
      (await env.call('admin', 'PUT', '/admin/users/00000000-0000-4000-8000-000000000000', { active: false }))
        .statusCode,
    ).toBe(404);
    expect((await env.call('admin', 'PUT', `/admin/users/${person.id}`, {})).statusCode).toBe(400);
    for (const who of ['exec', 'procurement', 'delegate'])
      expect(
        (await env.call(who, 'PUT', `/admin/users/${person.id}`, { active: false })).statusCode,
        who,
      ).toBe(403);
    // a second administrator can manage the first
    const second = await env.call('admin', 'POST', '/admin/users', {
      name: 'Second Admin',
      email: 'admin2@meridian-demo.example',
      roles: ['ADMIN'],
    });
    expect(second.statusCode).toBe(201);
  });

  it('a new activation link replaces the old one', async () => {
    const created = await env.call('admin', 'POST', '/admin/users', {
      name: 'Link Person',
      email: 'link.person@meridian-demo.example',
      roles: ['LEGAL'],
    });
    const first = (created.json().activationPath as string).split('token=')[1]!;
    const id = created.json().user.id as string;
    const again = await env.call('admin', 'POST', `/admin/users/${id}/activation-link`);
    expect(again.statusCode).toBe(201);
    const second = (again.json().activationPath as string).split('token=')[1]!;
    expect(
      (await env.app.inject({ method: 'GET', url: `/api/v1/supplier/activate/${first}` })).statusCode,
    ).toBe(404);
    expect(
      (await env.app.inject({ method: 'GET', url: `/api/v1/supplier/activate/${second}` })).statusCode,
    ).toBe(200);
    expect((await env.call('procurement', 'POST', `/admin/users/${id}/activation-link`)).statusCode).toBe(
      403,
    );
    expect(
      (await env.call('admin', 'POST', '/admin/users/00000000-0000-4000-8000-000000000000/activation-link'))
        .statusCode,
    ).toBe(404);
  });
});

describe('workflow library (US-ADM-02)', () => {
  it('lists the three workflows with their steps; administrators and procurement may read', async () => {
    for (const who of ['admin', 'procurement']) {
      const r = await env.call(who, 'GET', '/admin/workflows');
      expect(r.statusCode, who).toBe(200);
      const list = r.json() as Json[];
      expect(list.map((w) => w.tier)).toEqual(expect.arrayContaining(['SIMPLE', 'INTERMEDIATE', 'COMPLEX']));
      expect(list.find((w) => w.id === 'wf-simple')).toMatchObject({
        editable: true,
        steps: [{ key: 'request', label: 'Request', mandatory: true }, { key: 'approve' }, { key: 'order' }],
      });
      expect(list.filter((w) => w.editable)).toHaveLength(1);
    }
    for (const who of ['requester', 'legal', 'exec', 'evaluator-tech'])
      expect((await env.call(who, 'GET', '/admin/workflows')).statusCode, who).toBe(403);
  });

  it('the simple workflow can be edited (add, rename, reorder, make optional) but its approval checkpoint stays; others say coming soon', async () => {
    const ok = await env.call('admin', 'PUT', '/admin/workflows/wf-simple', {
      name: 'Simple purchase (v2)',
      steps: [
        { label: 'Request', mandatory: true },
        { label: 'Quote', mandatory: false },
        { label: 'Approve', mandatory: true },
        { label: 'Order', mandatory: true },
        { label: 'Receipt', mandatory: false },
      ],
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().steps.map((x: Json) => x.key)).toEqual([
      'request',
      'quote',
      'approve',
      'order',
      'receipt',
    ]);
    expect(
      (await env.call('procurement', 'GET', '/admin/workflows'))
        .json()
        .find((w: Json) => w.id === 'wf-simple').name,
    ).toBe('Simple purchase (v2)');
    const audit = await sys<Json[]>((tx) =>
      tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'workflow.update')),
    );
    expect(audit).toHaveLength(1);
    expect((audit[0]!.after as Json).before).toEqual(['Request', 'Approve', 'Order']);

    const noApprove = await env.call('admin', 'PUT', '/admin/workflows/wf-simple', {
      steps: [
        { label: 'Request', mandatory: true },
        { label: 'Order', mandatory: true },
      ],
    });
    expect(noApprove.statusCode).toBe(422);
    expect(noApprove.json().code).toBe('CHECKPOINT_REQUIRED');
    const optional = await env.call('admin', 'PUT', '/admin/workflows/wf-simple', {
      steps: [
        { label: 'Request', mandatory: true },
        { label: 'Approve', mandatory: false },
      ],
    });
    expect(optional.json().code).toBe('CHECKPOINT_REQUIRED');
    expect(
      (
        await env.call('admin', 'PUT', '/admin/workflows/wf-simple', {
          steps: [
            { label: 'Request', mandatory: true },
            { label: 'request', mandatory: true },
            { label: 'Approve', mandatory: true },
          ],
        })
      ).json().code,
    ).toBe('DUPLICATE_STEP');
    const locked = await env.call('admin', 'PUT', '/admin/workflows/wf-intermediate', {
      steps: [
        { label: 'A', mandatory: true },
        { label: 'B', mandatory: true },
      ],
    });
    expect(locked.statusCode).toBe(409);
    expect(locked.json().code).toBe('NOT_EDITABLE');
    for (const bad of [
      { steps: [{ label: 'Only', mandatory: true }] },
      { steps: [] },
      { steps: new Array(13).fill({ label: 'x', mandatory: true }) },
      {
        steps: [
          { label: '', mandatory: true },
          { label: 'b', mandatory: true },
        ],
      },
      {
        steps: [
          { label: 'a', mandatory: 'yes' },
          { label: 'b', mandatory: true },
        ],
      },
    ])
      expect((await env.call('admin', 'PUT', '/admin/workflows/wf-simple', bad)).statusCode).toBe(400);
    expect(
      (
        await env.call('admin', 'PUT', '/admin/workflows/nope', {
          steps: [
            { label: 'a', mandatory: true },
            { label: 'b', mandatory: true },
          ],
        })
      ).statusCode,
    ).toBe(404);
    for (const who of ['procurement', 'exec', 'legal'])
      expect(
        (
          await env.call(who, 'PUT', '/admin/workflows/wf-simple', {
            steps: [
              { label: 'a', mandatory: true },
              { label: 'b', mandatory: true },
            ],
          })
        ).statusCode,
        who,
      ).toBe(403);
  });
});

describe('template library (US-ADM-03)', () => {
  it('lists templates by type and version with their clauses, for administrators, procurement and legal', async () => {
    for (const who of ['admin', 'procurement', 'legal']) {
      const r = await env.call(who, 'GET', '/admin/templates');
      expect(r.statusCode, who).toBe(200);
      const list = r.json() as Json[];
      expect(list.map((t) => t.type)).toEqual(expect.arrayContaining(['CONTRACT', 'TENDER', 'PLAN']));
      const svc = list.find((t) => t.id === 'tpl-services-std')!;
      expect(svc).toMatchObject({
        type: 'CONTRACT',
        version: '1.0',
        status: 'ACTIVE',
        appliesTo: ['RFP', 'RFQ'],
      });
      expect(svc.clauses.filter((c: Json) => c.mandatory).length).toBeGreaterThanOrEqual(5);
      expect(JSON.stringify(svc.clauses)).not.toContain('{{');
    }
    for (const who of ['requester', 'delegate', 'exec', 'evaluator-tech'])
      expect((await env.call(who, 'GET', '/admin/templates')).statusCode, who).toBe(403);
    // creating templates is not available yet
    expect((await env.call('admin', 'POST', '/admin/templates', { name: 'x' })).statusCode).toBe(404);
  });
});

describe('administrators cannot read bid content (US-ADM-04, SEC-AC13)', () => {
  it('every way to a bid file or score is refused for the administrator and the refusal is audited', async () => {
    const [ev] = await sys<Json[]>((tx) =>
      tx.select().from(s.evaluation).where(eq(s.evaluation.tenantId, TENANT_ID)),
    );
    const subs = await sys<Json[]>((tx) =>
      tx.select().from(s.submission).where(eq(s.submission.tenderId, ev!.tenderId)),
    );
    const files = await sys<Json[]>((tx) =>
      tx.select().from(s.fileObject).where(eq(s.fileObject.submissionId, subs[0]!.id)),
    );
    expect(files.length).toBeGreaterThan(0);
    const url = `/evaluations/${ev!.id}/suppliers/${subs[0]!.supplierId}/files/${files[0]!.id}`;
    const before = (
      await sys<Json[]>((tx) =>
        tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'access.denied')),
      )
    ).length;
    expect((await env.call('admin', 'GET', url)).statusCode).toBe(403);
    for (const path of [
      `/evaluations/${ev!.id}`,
      `/evaluations/${ev!.id}/scores/mine`,
      `/evaluations/${ev!.id}/report/pdf`,
      '/evaluations',
    ])
      expect((await env.call('admin', 'GET', path)).statusCode, path).toBe(403);
    const after = await sys<Json[]>((tx) =>
      tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'access.denied')),
    );
    expect(after.length).toBeGreaterThanOrEqual(before + 5);
    expect(after.some((e) => e.actorRole === 'ADMIN' && (e.after as Json).path?.includes('files'))).toBe(
      true,
    );
    // the same file is readable by the people who may read it, so the refusal is about the role, not the file
    expect((await env.call('procurement', 'GET', url)).statusCode).not.toBe(403); // (404 here: the test database has no stored copy)
  });

  it('the database itself returns nothing to an administrator: no bid files, no scores', async () => {
    const adminCtx = { tenantId: TENANT_ID, userId: uid('user:admin'), role: 'ADMIN' as const };
    const files = await withContext(env.database, adminCtx, (tx) => tx.select().from(s.fileObject));
    const scores = await withContext(env.database, adminCtx, (tx) => tx.select().from(s.score));
    expect(files).toEqual([]);
    expect(scores).toEqual([]);
    const procCtx = { tenantId: TENANT_ID, userId: uid('user:procurement'), role: 'PROCUREMENT' as const };
    expect(
      (await withContext(env.database, procCtx, (tx) => tx.select().from(s.fileObject))).length,
    ).toBeGreaterThan(0);
  });

  it('the supplier screens are closed to the administrator, and the tender view an administrator may open carries no bid content', async () => {
    expect((await env.call('admin', 'GET', '/supplier/tenders')).statusCode).toBe(403);
    const [tn] = await sys<Json[]>((tx) =>
      tx.select().from(s.tender).where(eq(s.tender.tenantId, TENANT_ID)),
    );
    const view = await env.call('admin', 'GET', `/tenders/${tn!.id}`);
    expect(view.statusCode).toBe(200);
    expect(view.body).not.toMatch(/technical-response|pricing-schedule|storageKey|sha256/);
  });
});
