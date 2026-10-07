import { eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import * as s from '../../db/schema.js';
import { TENANT_ID, uid } from '../../db/seed.js';
import { createEnv, type Json } from '../contract/test-env.js';
import { SECTION_NAMES } from '../settings/settings.js';
import { SECTION_EDITORS } from './config-inventory.js';
import { MODELS } from './models.js';
import { PERF_RETENTION, nowMs, percentile, recordSample, summarise } from './perf.js';

let env: Awaited<ReturnType<typeof createEnv>>;
const call = (...a: Parameters<typeof env.call>) => env.call(...a);
const sys = <T>(fn: Parameters<typeof env.withSystem>[1]) => env.withSystem(env.database, fn) as Promise<T>;
beforeAll(async () => {
  env = await createEnv();
}, 120_000);

const ask = async (who: string, message: string) => {
  const r = await call(who, 'POST', '/assistant/chat', { message });
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as Json;
};
const propose = async () => {
  const r = await call('requester', 'POST', '/buying/auto-source', {
    need: 'copy paper for the office',
    quantity: 200,
  });
  expect(r.statusCode, r.body).toBe(201);
  return r.json() as Json;
};
const auditActions = (action: string) =>
  sys<Json[]>((tx) => tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, action)));
/** Walks a model through request and approval by two different people. */
async function approve(modelId: string) {
  const req = await call('admin', 'POST', `/ai/models/${modelId}/request-approval`, {
    reason: 'Pilot for plan summaries',
  });
  expect(req.statusCode, req.body).toBe(201);
  const dec = await call('probity', 'POST', `/ai/approvals/${req.json().id}/decision`, {
    decision: 'APPROVE',
    reason: 'Data handling reviewed and acceptable',
  });
  expect(dec.statusCode, dec.body).toBe(200);
}
const activate = (activeModel: string, taskOverrides?: Record<string, string>) =>
  call('admin', 'PUT', '/ai/active-model', { activeModel, ...(taskOverrides ? { taskOverrides } : {}) });

describe('NFR-C01 pluggable AI models per tenant: the registry', () => {
  it('lists the built-in model and two third-party style models, each with its data-handling profile', async () => {
    const r = (await call('admin', 'GET', '/ai/models')).json() as Json;
    expect(r.activeModel).toBe('rules-simulated-v1');
    expect(r.models.map((m: Json) => m.id)).toEqual([
      'rules-simulated-v1',
      'sim-llm-fast-v1',
      'sim-llm-careful-v1',
    ]);
    const rules = r.models[0];
    expect(rules).toMatchObject({ builtIn: true, simulated: true, active: true, canActivate: true });
    expect(rules.approval.state).toBe('BUILT_IN');
    for (const m of r.models.slice(1)) {
      expect(m).toMatchObject({ builtIn: false, simulated: true, canActivate: false, active: false });
      expect(m.approval.state).toBe('NOT_REQUESTED');
      expect(m.dataHandling).toEqual(
        expect.objectContaining({
          processedIn: expect.any(String),
          retention: expect.any(String),
          retained: expect.any(Boolean),
          usedForTraining: expect.any(Boolean),
        }),
      );
    }
    // a different deterministic behaviour per model
    const fast = MODELS.find((m) => m.id === 'sim-llm-fast-v1')!;
    const careful = MODELS.find((m) => m.id === 'sim-llm-careful-v1')!;
    const input = {
      candidates: [
        { name: 'Paper A4', supplier: 'Northstar', total: 900, score: 90 },
        { name: 'Paper A4 eco', supplier: 'Evergreen', total: 1000, score: 80 },
      ],
    };
    const a = await fast.complete('recommendation-summary', input);
    const b = await careful.complete('recommendation-summary', input);
    expect(a.text.length).toBeLessThan(b.text.length);
    expect(b.note).toMatch(/Confidence: high/);
    expect(await careful.complete('recommendation-summary', input)).toEqual(b); // deterministic
  });

  it('the default tenant setting names the built-in model', async () => {
    const r = (await call('requester', 'GET', '/ai/active-model')).json() as Json;
    expect(r).toMatchObject({ activeModel: 'rules-simulated-v1', simulated: true, builtIn: true });
    expect((await call('supplier', 'GET', '/ai/active-model')).statusCode).toBe(403);
    expect((await call('requester', 'GET', '/ai/models')).statusCode).toBe(403);
  });
});

describe('SEC-TP07 third-party AI providers approved per tenant before they can be switched on', () => {
  it('refuses to switch on a model that has not been approved, by either route', async () => {
    const r = await activate('sim-llm-fast-v1');
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('MODEL_NOT_APPROVED');
    const viaSettings = await call('admin', 'PUT', '/admin/settings', {
      ai: { activeModel: 'sim-llm-fast-v1' },
    });
    expect(viaSettings.statusCode).toBe(409);
    expect((await activate('no-such-model')).statusCode).toBe(422);
    expect(((await call('admin', 'GET', '/ai/active-model')).json() as Json).activeModel).toBe(
      'rules-simulated-v1',
    );
  });

  it('only administrators and procurement ask; only probity or an executive decides; the built-in model needs neither', async () => {
    expect(
      (await call('requester', 'POST', '/ai/models/sim-llm-fast-v1/request-approval', { reason: 'please' }))
        .statusCode,
    ).toBe(403);
    expect(
      (await call('probity', 'POST', '/ai/models/sim-llm-fast-v1/request-approval', { reason: 'please' }))
        .statusCode,
    ).toBe(403);
    expect(
      (await call('admin', 'POST', '/ai/models/rules-simulated-v1/request-approval', { reason: 'please' }))
        .statusCode,
    ).toBe(409);
    expect(
      (await call('admin', 'POST', '/ai/models/nope/request-approval', { reason: 'please' })).statusCode,
    ).toBe(404);
    const req = await call('procurement', 'POST', '/ai/models/sim-llm-fast-v1/request-approval', {
      reason: 'Faster drafts for buyers',
    });
    expect(req.statusCode, req.body).toBe(201);
    // one open request at a time
    expect(
      (await call('admin', 'POST', '/ai/models/sim-llm-fast-v1/request-approval', { reason: 'again' }))
        .statusCode,
    ).toBe(409);
    // the people who ask cannot decide, and a requester cannot activate
    for (const who of ['admin', 'procurement'])
      expect(
        (
          await call(who, 'POST', `/ai/approvals/${req.json().id}/decision`, {
            decision: 'APPROVE',
            reason: 'ok then',
          })
        ).statusCode,
      ).toBe(403);
    expect((await activate('sim-llm-fast-v1')).statusCode).toBe(409); // still only requested
    const view = (await call('exec', 'GET', '/ai/models')).json() as Json;
    expect(view.models[1].approval).toMatchObject({ state: 'REQUESTED', requestedBy: 'Priya Nair' });
    // reject: the model stays off and a fresh request is allowed afterwards
    const rej = await call('exec', 'POST', `/ai/approvals/${req.json().id}/decision`, {
      decision: 'REJECT',
      reason: 'Offshore processing is not acceptable',
    });
    expect(rej.json().status).toBe('REJECTED');
    expect((await activate('sim-llm-fast-v1')).statusCode).toBe(409);
    expect(
      (
        await call('exec', 'POST', `/ai/approvals/${req.json().id}/decision`, {
          decision: 'APPROVE',
          reason: 'changed my mind',
        })
      ).statusCode,
    ).toBe(409);
  });

  it('refuses self-approval: the person who asked cannot be the person who approves, even holding both roles', async () => {
    const dual = await env.extraUser('dual', 'ADMIN');
    await sys((tx) =>
      tx.insert(s.roleAssignment).values({ tenantId: TENANT_ID, userId: dual.id, role: 'PROBITY' }),
    );
    const req = await call(dual.email, 'POST', '/ai/models/sim-llm-careful-v1/request-approval', {
      reason: 'Careful drafts',
    });
    expect(req.statusCode, req.body).toBe(201);
    const self = await call(dual.email, 'POST', `/ai/approvals/${req.json().id}/decision`, {
      decision: 'APPROVE',
      reason: 'I approve my own request',
    });
    expect(self.statusCode).toBe(403);
    expect(self.json().code).toBe('SELF_APPROVAL');
    expect((await auditActions('ai.approval_self_decision_refused')).length).toBeGreaterThan(0);
    // the database also refuses it, whatever the application does
    await expect(
      sys((tx) =>
        tx
          .update(s.aiProviderApproval)
          .set({ status: 'APPROVED', decidedBy: dual.id })
          .where(eq(s.aiProviderApproval.id, req.json().id)),
      ),
    ).rejects.toThrow();
    // a second person can
    const ok = await call('probity', 'POST', `/ai/approvals/${req.json().id}/decision`, {
      decision: 'APPROVE',
      reason: 'Reviewed',
    });
    expect(ok.statusCode, ok.body).toBe(200);
    // and the approval row records both people
    const [row] = await sys<Json[]>((tx) =>
      tx.select().from(s.aiProviderApproval).where(eq(s.aiProviderApproval.id, req.json().id)),
    );
    expect(row!.requestedBy).toBe(dual.id);
    expect(row!.decidedBy).toBe(uid('user:probity'));
    expect(row!.dataHandling.processedIn).toContain('ap-southeast-2');
  });
});

describe('NFR-M06 approved AI model changed through configuration, no restart', () => {
  it('after approval the administrator switches model by configuration; the next answer and recommendation use it at once, with old and new value audited', async () => {
    const beforeAsk = await ask('requester', 'How does the workflow work?');
    expect(beforeAsk).toMatchObject({ model: 'rules-simulated-v1', modelSimulated: true });
    expect(beforeAsk.footer).toMatch(/fixed rules/);
    const beforeProp = await propose();
    expect(beforeProp).toMatchObject({ model: 'rules-simulated-v1' });

    expect((await activate('sim-llm-careful-v1')).statusCode).toBe(200); // approved in the earlier test
    expect(
      (await call('procurement', 'PUT', '/ai/active-model', { activeModel: 'sim-llm-careful-v1' }))
        .statusCode,
    ).toBe(403);

    const a = await ask('requester', 'How does the workflow work?');
    expect(a).toMatchObject({
      model: 'sim-llm-careful-v1',
      modelLabel: 'CarefulAI (simulated)',
      modelSimulated: true,
      modelSource: 'ACTIVE',
    });
    expect(a.footer).toMatch(/sim-llm-careful-v1/);
    expect(a.footerNote).toMatch(/Confidence/);
    expect(a.answer).toBe(beforeAsk.answer); // the answer is the same fixed rules; only the model's wording around it changes

    const prop = await propose();
    expect(prop).toMatchObject({ model: 'sim-llm-careful-v1', modelSimulated: true });
    expect(prop.summary).toMatch(/weighing 3 candidates/);
    expect(prop.summaryNote).toMatch(/Confidence/);
    expect(prop.summary).not.toBe(beforeProp.summary);
    const listed = (await call('requester', 'GET', '/buying/proposals')).json() as Json[];
    expect(listed.every((p) => p.model === 'sim-llm-careful-v1')).toBe(true);

    const changes = await auditActions('ai.active_model_changed');
    const last = changes.at(-1)!;
    expect(last.before).toMatchObject({ activeModel: 'rules-simulated-v1' });
    expect(last.after).toMatchObject({ activeModel: 'sim-llm-careful-v1' });
    expect((await auditActions('settings.ai')).length).toBeGreaterThan(0);
  });

  it('a different model can be chosen for one task only', async () => {
    await approve('sim-llm-fast-v1');
    // sim-llm-fast-v1 processes in the US: it can be named only once the US is explicitly allowed (SEC-D09)
    await sys((tx) =>
      tx.execute(
        sql`update tenant set config = jsonb_set(config, '{settings}', coalesce(config->'settings', '{}'::jsonb) || '{"residency":{"country":"AU","allowedRegions":["US"],"aiRegion":"AU","logRegion":"AU"}}'::jsonb, true) where id = ${TENANT_ID}`,
      ),
    );
    expect((await activate('sim-llm-careful-v1', { 'assistant-footer': 'sim-llm-fast-v1' })).statusCode).toBe(
      200,
    );
    const a = await ask('requester', 'How does the workflow work?');
    expect(a).toMatchObject({ model: 'sim-llm-fast-v1', modelSource: 'OVERRIDE' });
    expect((await propose()).model).toBe('sim-llm-careful-v1');
    expect(
      (
        await call('admin', 'PUT', '/ai/active-model', {
          activeModel: 'sim-llm-careful-v1',
          taskOverrides: { nonsense: 'x' },
        })
      ).statusCode,
    ).toBe(400);
    expect((await activate('sim-llm-careful-v1')).statusCode).toBe(200);
    await sys((tx) =>
      tx.execute(
        sql`update tenant set config = jsonb_set(config, '{settings}', (config->'settings') - 'residency', true) where id = ${TENANT_ID}`,
      ),
    );
  });

  it('revoking an approval falls the tenant back to the built-in model immediately, and audits it', async () => {
    expect(((await call('admin', 'GET', '/ai/active-model')).json() as Json).activeModel).toBe(
      'sim-llm-careful-v1',
    );
    expect(
      (
        await call('requester', 'POST', '/ai/models/sim-llm-careful-v1/revoke', {
          reason: 'no longer trusted',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call('procurement', 'POST', '/ai/models/sim-llm-careful-v1/revoke', {
          reason: 'no longer trusted',
        })
      ).statusCode,
    ).toBe(403);
    const r = await call('probity', 'POST', '/ai/models/sim-llm-careful-v1/revoke', {
      reason: 'Vendor changed its terms',
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ status: 'REVOKED', activeModel: 'rules-simulated-v1', fellBack: true });
    // the very next answer and recommendation are the built-in model's
    expect(await ask('requester', 'How does the workflow work?')).toMatchObject({
      model: 'rules-simulated-v1',
    });
    expect(await propose()).toMatchObject({ model: 'rules-simulated-v1' });
    const events = await auditActions('ai.approval_revoked');
    expect(events.at(-1)!.after).toMatchObject({
      status: 'REVOKED',
      model: 'sim-llm-careful-v1',
      reason: 'Vendor changed its terms',
    });
    const fallback = (await auditActions('settings.ai')).at(-1)!;
    expect(fallback.before).toMatchObject({ ai: { activeModel: 'sim-llm-careful-v1' } });
    expect(fallback.after).toMatchObject({ ai: { activeModel: 'rules-simulated-v1' } });
    // it cannot be switched back on without a new approval
    expect((await activate('sim-llm-careful-v1')).statusCode).toBe(409);
    expect(
      (await call('probity', 'POST', '/ai/models/sim-llm-careful-v1/revoke', { reason: 'again please' }))
        .statusCode,
    ).toBe(409);
    await approve('sim-llm-careful-v1');
    expect((await activate('sim-llm-careful-v1')).statusCode).toBe(200);
    expect((await activate('rules-simulated-v1')).statusCode).toBe(200);
  });

  it('even if a revoked name were left in the setting, it is not used (defence in depth)', async () => {
    await approve('sim-llm-careful-v1').catch(() => undefined);
    await activate('rules-simulated-v1');
    await sys((tx) =>
      tx.execute(
        sql`update tenant set config = jsonb_set(config, '{settings,ai}', '{"activeModel":"sim-llm-fast-v1"}'::jsonb, true) where id = ${TENANT_ID}`,
      ),
    );
    await call('probity', 'POST', '/ai/models/sim-llm-fast-v1/revoke', { reason: 'testing the fall-back' });
    await sys((tx) =>
      tx.execute(
        sql`update tenant set config = jsonb_set(config, '{settings,ai}', '{"activeModel":"sim-llm-fast-v1"}'::jsonb, true) where id = ${TENANT_ID}`,
      ),
    );
    expect(await ask('requester', 'How does the workflow work?')).toMatchObject({
      model: 'rules-simulated-v1',
      modelSource: 'FALLBACK',
    });
    await activate('rules-simulated-v1');
  });
});

describe('NFR-M05 all tenant configuration changeable by an authorised person without a release', () => {
  it('the inventory lists every settings section with its editor screen; a section with no editor entry fails here', async () => {
    const inv = (await call('admin', 'GET', '/admin/config/inventory')).json() as Json;
    expect(inv.sections.map((x: Json) => x.section)).toEqual(SECTION_NAMES);
    // a new section in settings.ts without an entry in SECTION_EDITORS fails this test (and does not compile)
    expect(Object.keys(SECTION_EDITORS).sort()).toEqual([...SECTION_NAMES].sort());
    for (const sec of inv.sections) {
      expect(sec.editor.screen, sec.section).toMatch(/^\/(admin|app)\//);
      expect(sec.editor.panel, sec.section).toBeTruthy();
      expect(sec.fields.length, sec.section).toBeGreaterThan(0);
      expect(sec).toHaveProperty('default');
      expect(sec).toHaveProperty('current');
    }
    const links = inv.sections.find((x: Json) => x.section === 'approvalLinks');
    expect(links.fields.map((f: Json) => f.name)).toEqual(['enabled', 'validHours', 'showCommercial']);
    expect(links.editor).toMatchObject({ screen: '/admin/settings', panel: 'Approve from a link' });
    expect((await call('procurement', 'GET', '/admin/config/inventory')).statusCode).toBe(403);
  });

  it('says who changed a section last, from the audit log', async () => {
    await call('admin', 'PUT', '/admin/settings', {
      ratings: { supplierSeesRatings: true, staffSeeSupplierRatings: true },
    });
    const inv = (await call('admin', 'GET', '/admin/config/inventory')).json() as Json;
    const ratings = inv.sections.find((x: Json) => x.section === 'ratings');
    expect(ratings).toMatchObject({ lastChangedBy: 'Noah Kim', isDefault: false });
    expect(ratings.lastChangedAt).toBeTruthy();
    expect(inv.sections.find((x: Json) => x.section === 'numbering').lastChangedBy).toBeNull();
    await call('admin', 'PUT', '/admin/settings', {
      ratings: { supplierSeesRatings: false, staffSeeSupplierRatings: true },
    });
  });

  it('exports all configuration as JSON without secrets or user data', async () => {
    await call('admin', 'PUT', '/admin/settings', {
      legalPlatform: {
        enabled: true,
        name: 'LegalCo',
        webhookSecret: 'whsec-super-secret-value',
        simulateOutage: false,
      },
    });
    const r = await call('admin', 'GET', '/admin/config/export');
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-disposition']).toContain('attachment');
    const out = r.json() as Json;
    expect(out).toMatchObject({ format: 'if-tenant-config', version: 1 });
    expect(Object.keys(out.sections)).toEqual(SECTION_NAMES);
    const text = r.body;
    expect(text).not.toContain('whsec-super-secret-value');
    expect(out.sections.legalPlatform).toMatchObject({ name: 'LegalCo', webhookSecret: '' });
    for (const email of ['@meridian-demo.example', 'Riley Chen', 'password'])
      expect(text).not.toContain(email);
    expect((await auditActions('config.export')).length).toBeGreaterThan(0);
    expect((await call('requester', 'GET', '/admin/config/export')).statusCode).toBe(403);
  });

  it('import with dryRun validates with the same schemas and shows the difference without applying anything', async () => {
    const exp = (await call('admin', 'GET', '/admin/config/export')).json() as Json;
    const file = {
      ...exp,
      sections: {
        approvalLinks: { enabled: true, validHours: 6, showCommercial: false },
        numbering: exp.sections.numbering,
      },
    };
    const dry = (
      await call('admin', 'POST', '/admin/config/import', { dryRun: true, config: file })
    ).json() as Json;
    expect(dry).toMatchObject({ dryRun: true, valid: true, applied: false, unchanged: 1 });
    expect(dry.changes).toEqual([
      { section: 'approvalLinks', fields: [{ field: 'validHours', before: 48, after: 6 }] },
    ]);
    // default is a dry run
    const dflt = (await call('admin', 'POST', '/admin/config/import', { config: file })).json() as Json;
    expect(dflt.dryRun).toBe(true);
    const cur = (await call('admin', 'GET', '/admin/settings')).json() as Json;
    expect(cur.approvalLinks.validHours).toBe(48);
    // the secret in the file is empty, and "empty" keeps the stored one
    const keep = (
      await call('admin', 'POST', '/admin/config/import', {
        dryRun: true,
        config: { ...exp, sections: { legalPlatform: exp.sections.legalPlatform } },
      })
    ).json() as Json;
    expect(keep.changes).toEqual([]);
  });

  it('refuses a file with an invalid value, an unknown section, a wrong format, or an unapproved AI model', async () => {
    const exp = (await call('admin', 'GET', '/admin/config/export')).json() as Json;
    const bad = {
      ...exp,
      sections: { approvalLinks: { enabled: true, validHours: 100000, showCommercial: false }, madeUp: {} },
    };
    const dry = (
      await call('admin', 'POST', '/admin/config/import', { dryRun: true, config: bad })
    ).json() as Json;
    expect(dry.valid).toBe(false);
    expect(dry.errors.map((e: Json) => e.field)).toEqual(
      expect.arrayContaining(['sections.approvalLinks.validHours', 'sections.madeUp']),
    );
    const applied = await call('admin', 'POST', '/admin/config/import', { dryRun: false, config: bad });
    expect(applied.statusCode).toBe(422);
    expect(
      (
        await call('admin', 'POST', '/admin/config/import', {
          dryRun: false,
          config: { ...exp, format: 'other' },
        })
      ).statusCode,
    ).toBe(400);
    const unapproved = { ...exp, sections: { ai: { activeModel: 'sim-llm-fast-v1' } } };
    const ai = (
      await call('admin', 'POST', '/admin/config/import', { dryRun: true, config: unapproved })
    ).json() as Json;
    expect(ai.valid).toBe(false);
    expect((await call('procurement', 'POST', '/admin/config/import', { config: exp })).statusCode).toBe(403);
  });

  it('applies only when dryRun is false, audits it, and the change takes effect at once without a restart', async () => {
    const exp = (await call('admin', 'GET', '/admin/config/export')).json() as Json;
    const links = async (hours: number) => {
      const r = await call('admin', 'POST', '/admin/config/import', {
        dryRun: false,
        config: {
          ...exp,
          sections: { approvalLinks: { enabled: true, validHours: hours, showCommercial: false } },
        },
      });
      expect(r.statusCode, r.body).toBe(200);
      return r.json() as Json;
    };
    // a plan goes to approval; the link its approver is given is read straight back
    const newLink = async (value: number) => {
      const before = (
        await sys<Json[]>((tx) =>
          tx
            .select()
            .from(s.notification)
            .where(eq(s.notification.userId, uid('user:delegate'))),
        )
      ).length;
      const c = await call('requester', 'POST', '/requests', {
        title: `Config fixture ${value}`,
        category: 'Building cleaning (UNSPSC 76111500)',
        estimatedValue: value,
        termMonths: 24,
        businessUnit: 'Facilities',
        fields: { contractOwner: 'Sofia Rossi', background: 'Existing arrangements end in six months.' },
      });
      const rid = c.json().id as string;
      await call('requester', 'POST', `/requests/${rid}/submit`);
      const plan = (await call('procurement', 'GET', `/requests/${rid}/plan`)).json() as Json;
      expect((await call('procurement', 'POST', `/plans/${plan.id}/submit-for-approval`)).statusCode).toBe(
        200,
      );
      const rows = (
        await sys<Json[]>((tx) =>
          tx
            .select()
            .from(s.notification)
            .where(eq(s.notification.userId, uid('user:delegate'))),
        )
      ).filter((n) => n.title === 'Approve without signing in');
      expect(rows.length).toBeGreaterThan(0);
      expect(
        (
          await sys<Json[]>((tx) =>
            tx
              .select()
              .from(s.notification)
              .where(eq(s.notification.userId, uid('user:delegate'))),
          )
        ).length,
      ).toBeGreaterThan(before);
      return rows.at(-1)!;
    };
    const applied = await links(6);
    expect(applied).toMatchObject({ applied: true, valid: true });
    const short = await newLink(80_000);
    expect(short.body).toContain('expires in 6 hours');
    const token = (short.link as string).replace('/approve/', '');
    expect((await env.app.inject({ method: 'GET', url: `/api/v1/approval-links/${token}` })).statusCode).toBe(
      200,
    );
    env.clock.advanceDays(1); // seven hours would do; a day is more than the new six-hour validity
    expect((await env.app.inject({ method: 'GET', url: `/api/v1/approval-links/${token}` })).statusCode).toBe(
      404,
    );
    // widen the validity by configuration: the next link is good for two days, with no restart in between
    await links(72);
    const long = await newLink(81_000);
    expect(long.body).toContain('expires in 72 hours');
    const t2 = (long.link as string).replace('/approve/', '');
    env.clock.advanceDays(1);
    expect((await env.app.inject({ method: 'GET', url: `/api/v1/approval-links/${t2}` })).statusCode).toBe(
      200,
    );
    // audited, per section and as an import
    const imp = await auditActions('config.import');
    expect(imp.length).toBeGreaterThanOrEqual(2);
    const sect = (await auditActions('settings.approvalLinks')).at(-1)!;
    expect(sect.before).toMatchObject({ approvalLinks: { validHours: 6 } });
    expect(sect.after).toMatchObject({ approvalLinks: { validHours: 72 } });
    await links(48);
  });
});

describe('NFR-C08 browser and operating-system baseline checked at sign-in', () => {
  const CHROME =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  const OLD =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36';
  it('judges the browser on the server, counts it, and stores nothing about the person', async () => {
    const ok = (await call('requester', 'POST', '/auth/client-check', { userAgent: CHROME })).json() as Json;
    expect(ok).toMatchObject({ browser: 'Chrome', major: 124, status: 'SUPPORTED', supported: true });
    const old = (
      await call('requester', 'POST', '/auth/client-check', { userAgent: OLD, features: { fetch: true } })
    ).json() as Json;
    expect(old).toMatchObject({
      browser: 'Chrome',
      major: 96,
      status: 'BELOW_BASELINE',
      supported: false,
      minimum: 'Chrome 120',
    });
    await call('finance', 'POST', '/auth/client-check', { userAgent: CHROME });
    // a browser cannot claim to be supported: the verdict is not accepted from the client
    expect(
      (await call('requester', 'POST', '/auth/client-check', { userAgent: OLD, supported: true })).statusCode,
    ).toBe(400);
    expect((await call('requester', 'POST', '/auth/client-check', {})).statusCode).toBe(400);
    const rows = await sys<Json[]>((tx) => tx.select().from(s.clientCheck));
    expect(Object.keys(rows[0]!).sort()).toEqual([
      'browser',
      'count',
      'id',
      'lastSeenAt',
      'major',
      'supported',
      'tenantId',
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/Mozilla|Riley|Priya|@/);
    expect(rows.find((r) => r.major === 124 && r.supported)!.count).toBe(2);
  });

  it('gives administrators the counts by browser and whether the baseline was met', async () => {
    const r = (await call('admin', 'GET', '/admin/client-baseline')).json() as Json;
    expect(r).toMatchObject({ total: 3, supported: 2, belowBaseline: 1 });
    expect(r.byBrowser).toEqual([{ browser: 'Chrome', supported: 2, below: 1 }]);
    expect(r.baseline.browsers.map((b: Json) => `${b.family} ${b.min}`)).toEqual([
      'Chrome 120',
      'Edge 120',
      'Firefox 120',
      'Safari 17',
    ]);
    expect((await call('requester', 'GET', '/admin/client-baseline')).statusCode).toBe(403);
    expect(
      (
        await env.app.inject({
          method: 'POST',
          url: '/api/v1/auth/client-check',
          payload: { userAgent: CHROME },
        })
      ).statusCode,
    ).toBe(401);
  });
});

describe('NFR-P04 budget check returns within the intake conversation, measured', () => {
  async function converse(text: string, unit?: string) {
    const c = await call('requester', 'POST', '/assistant/conversations', { purpose: 'INTAKE' });
    const conv = c.json().id as string;
    const m = await call('requester', 'POST', `/assistant/conversations/${conv}/messages`, { text });
    expect(m.statusCode, m.body).toBe(201);
    if (!unit) return m.json() as Json;
    const m2 = await call('requester', 'POST', `/assistant/conversations/${conv}/messages`, { text: unit });
    return m2.json() as Json;
  }
  it('stating a value in the conversation brings the budget outcome back in the same reply', async () => {
    const ok = await converse('Cleaning services for Facilities, 36 months, about $80k');
    expect(ok.budgetCheck).toMatchObject({
      status: 'CLEARED',
      businessUnit: 'Facilities',
      requested: 80_000,
      available: 2_000_000,
    });
    expect(ok.text).toContain('Budget check: within budget');
    expect(ok.budgetCheck.ms).toBeGreaterThan(0);
    const over = await converse('Building works for Facilities, 36 months, $3M');
    expect(over.budgetCheck).toMatchObject({ status: 'EXCEEDED', cap: 'HARD' });
    expect(over.text).toContain('hard cap exceeded');
    // the unit given after the value is also checked in the reply that learns it
    const late = await converse('Cleaning services for 12 months, about $60k', 'Facilities');
    expect(late.budgetCheck).toMatchObject({ status: 'CLEARED', businessUnit: 'Facilities' });
    // a message that says nothing about money gets no budget text
    const none = await converse('Hello there');
    expect(none.budgetCheck).toBeUndefined();
    const intake = ((await call('admin', 'GET', '/admin/settings')).json() as Json).intake;
    const soft = await call('admin', 'PUT', '/admin/settings', { intake: { ...intake, budgetCap: 'SOFT' } });
    expect(soft.statusCode, soft.body).toBe(200);
    const s2 = await converse('Building works for Facilities, 36 months, $3M');
    expect(s2.text).toContain('escalated for an executive decision');
    await call('admin', 'PUT', '/admin/settings', { intake });
  });

  it('records every budget check and every intake message with a monotonic timer, capped per tenant', async () => {
    for (let i = 0; i < 12; i += 1)
      await converse(`Cleaning services for Facilities, 24 months, $${50 + i}k`);
    const rows = await sys<Json[]>((tx) => tx.select().from(s.perfSample));
    const budget = rows.filter((r) => r.kind === 'BUDGET_CHECK');
    const messages = rows.filter((r) => r.kind === 'INTAKE_MESSAGE');
    expect(budget.length).toBeGreaterThanOrEqual(12);
    expect(messages.length).toBeGreaterThanOrEqual(budget.length);
    for (const r of rows) expect(Number(r.ms)).toBeGreaterThan(0);
    // an intake message includes its budget check, so it cannot be quicker (checked per kind on the medians)
    expect(summarise(messages.map((r) => Number(r.ms))).p50!).toBeGreaterThan(
      summarise(budget.map((r) => Number(r.ms))).p50!,
    );
    // the timer is not the injectable clock: moving the clock a year does not change a measurement
    const t0 = nowMs();
    env.clock.advanceDays(365);
    expect(nowMs() - t0).toBeLessThan(1000);
    // submission's budget check is measured too
    const n = budget.length;
    const c = await converse('Cleaning services for Facilities, 24 months, $70k', 'Sofia Rossi');
    const sub = await call('requester', 'POST', `/requests/${c.requestId}/submit`);
    expect([200, 409]).toContain(sub.statusCode);
    if (sub.statusCode === 200)
      expect(
        (await sys<Json[]>((tx) => tx.select().from(s.perfSample))).filter((r) => r.kind === 'BUDGET_CHECK')
          .length,
      ).toBeGreaterThan(n + 1);
  });

  it('reports count, p50, p95 and max against the target, and passes on real measurements', async () => {
    const r = (await call('admin', 'GET', '/admin/performance/budget-check?last=500')).json() as Json;
    expect(r.targetMs).toBe(2000);
    expect(r.count).toBeGreaterThanOrEqual(12);
    expect(r.p50).toBeLessThanOrEqual(r.p95);
    expect(r.p95).toBeLessThanOrEqual(r.max);
    expect(r.p95, JSON.stringify(r)).toBeLessThan(r.targetMs);
    expect(r.pass).toBe(true);
    expect(r.intakeMessage.count).toBeGreaterThanOrEqual(12);
    expect(r.timer).toMatch(/monotonic/);
    // the target is configuration: a target below the measured p95 flips the verdict, immediately
    const tight = await call('admin', 'PUT', '/admin/settings', { performance: { budgetCheckMs: 50 } });
    expect(tight.statusCode).toBe(200);
    await sys((tx) => recordSample(tx, TENANT_ID, 'BUDGET_CHECK', 400, new Date()));
    await sys((tx) => tx.execute(sql`update perf_sample set ms = 400 where kind = 'BUDGET_CHECK'`));
    const slow = (await call('admin', 'GET', '/admin/performance/budget-check')).json() as Json;
    expect(slow).toMatchObject({ targetMs: 50, pass: false });
    await call('admin', 'PUT', '/admin/settings', { performance: { budgetCheckMs: 2000 } });
    expect((await call('procurement', 'GET', '/admin/performance/budget-check')).statusCode).toBe(403);
    expect(
      (await call('admin', 'PUT', '/admin/settings', { performance: { budgetCheckMs: 5 } })).statusCode,
    ).toBe(400);
  });

  it('computes percentiles by nearest rank and keeps only the newest samples', async () => {
    expect(percentile([], 95)).toBeNull();
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    await sys((tx) =>
      tx.execute(
        sql`insert into perf_sample (tenant_id, kind, ms, at) select ${TENANT_ID}, 'INTAKE_MESSAGE', 1, now() from generate_series(1, ${PERF_RETENTION + 50})`,
      ),
    );
    await sys((tx) => recordSample(tx, TENANT_ID, 'INTAKE_MESSAGE', 2, new Date()));
    const [row] = await sys<Array<{ n: number }>>((tx) =>
      tx
        .select({ n: sql<number>`count(*)::int` })
        .from(s.perfSample)
        .where(eq(s.perfSample.kind, 'INTAKE_MESSAGE')),
    );
    expect(row!.n).toBe(PERF_RETENTION);
  });
});
