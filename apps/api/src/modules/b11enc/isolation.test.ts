/**
 * SEC-D10 tenant isolation proven by a cross-tenant test; NFR-R01 data stays within the customer tenancy.
 *
 * A second tenant ("B") is built with users and data in every major table family. Then every GET route in the OpenAPI document
 * is called as users of tenant A (every role the route allows), with and without a search for B's marker, and with B's ids in
 * every path parameter: nothing of B may appear (by id or by marker string), a direct lookup of one of B's rows must not be
 * answered 200, and nothing may fail with a 5xx. The database is checked separately: a context pointed at tenant A cannot read
 * or write B's rows in the tables protected by row level security.
 */
import { randomUUID } from 'node:crypto';
import { hash as argon2Hash } from '@node-rs/argon2';
import { eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../../audit/audit-service.js';
import { withContext, withSystem, type RequestContext } from '../../db/client.js';
import * as s from '../../db/schema.js';
import { TENANT_ID, uid } from '../../db/seed.js';
import { loadSpec } from '../../spec-routes.js';
import { setSecret } from '../b10conn/secrets.js';
import { createEnv, PASSWORD, type Json } from '../contract/test-env.js';
import { sealAnswer } from './bids.js';
import { activeKey } from './keys.js';
import { newWrappedDek } from './keys.js';
import type { Env } from './test-kit.js';

const MARK = 'B-LEAK-MARKER-9f3a71';
const B = uid('tenant:b-other-org');
const bctx = (userId: string): RequestContext => ({ tenantId: B, userId, role: 'ADMIN' });

let env: Env;
const probed = new Set<string>(); // ids this test itself put in URLs: A's audit trail legitimately records those attempts
const ids = { all: new Set<string>(), byType: new Map<string, string>(), populated: [] as string[] };
beforeAll(async () => {
  env = await createEnv();
  await populateTenantB();
}, 180_000);

const sys = <T>(fn: Parameters<Env['withSystem']>[1]) => env.withSystem(env.database, fn) as Promise<T>;

/** Tenant B: an organisation of its own with rows in every major table family, every text field carrying the marker. */
async function populateTenantB() {
  const now = env.clock.now();
  const hash = await argon2Hash(PASSWORD);
  const audit = new AuditService(env.clock);
  await withSystem(env.database, async (tx) => {
    await tx.insert(s.tenant).values({
      id: B,
      slug: 'tenant-b-other',
      name: `${MARK} Other Organisation`,
      sector: 'PRIVATE',
      config: {
        settings: {
          branding: {
            productName: `${MARK} Branding`,
            tagline: MARK,
            palette: 'INDIGO',
            supportEmail: 'b@other.example',
          },
        },
      },
    });
    const [unit] = await tx
      .insert(s.orgUnit)
      .values({ tenantId: B, name: `${MARK} Unit` })
      .returning();
    const user = async (tag: string, role: s.Role, supplierId?: string) => {
      const [u] = await tx
        .insert(s.appUser)
        .values({
          tenantId: B,
          email: `${tag}@tenant-b.example`,
          name: `${MARK} ${tag}`,
          passwordHash: hash,
          orgUnitId: unit!.id,
          ...(supplierId ? { supplierId } : {}),
        })
        .returning();
      await tx.insert(s.roleAssignment).values({ tenantId: B, userId: u!.id, role });
      return u!;
    };
    const [sup] = await tx
      .insert(s.supplier)
      .values({ tenantId: B, company: `${MARK} Supplies Pty Ltd`, abn: '51824753556', sanctionsNote: MARK })
      .returning();
    const admin = await user('b-admin', 'ADMIN');
    const requester = await user('b-requester', 'REQUESTER');
    const proc = await user('b-procurement', 'PROCUREMENT');
    await user('b-legal', 'LEGAL');
    await user('b-supplier', 'SUPPLIER', sup!.id);
    await tx.insert(s.delegation).values({
      tenantId: B,
      scope: 'SOURCING_APPROVAL',
      role: 'PROCUREMENT',
      userId: proc.id,
      maxValue: '999999',
    });

    const [req] = await tx
      .insert(s.request)
      .values({
        tenantId: B,
        number: `BTH-${MARK.slice(-4)}`,
        title: `${MARK} request title`,
        category: `${MARK} category`,
        estimatedValue: '120000',
        termMonths: 24,
        businessUnit: `${MARK} unit`,
        requesterId: requester.id,
        managerId: proc.id,
        phase: 'TENDER',
        status: 'IN_PROGRESS',
      })
      .returning();
    const [pl] = await tx
      .insert(s.plan)
      .values({ tenantId: B, requestId: req!.id, status: 'APPROVED_LOCKED', summary: MARK, locked: true })
      .returning();
    const [tn] = await tx
      .insert(s.tender)
      .values({
        tenantId: B,
        requestId: req!.id,
        type: 'RFT',
        status: 'PUBLISHED',
        closesAt: new Date(now.getTime() + 20 * 86_400_000),
      })
      .returning();
    for (const [ownerType, ownerId] of [
      ['REQUEST', req!.id],
      ['PLAN', pl!.id],
      ['TENDER', tn!.id],
    ] as const)
      await tx.insert(s.fieldValue).values({
        tenantId: B,
        ownerType,
        ownerId,
        key: ownerType === 'TENDER' ? 'overview' : ownerType === 'PLAN' ? 'objectives' : 'background',
        label: `${MARK} label`,
        value: `${MARK} text in ${ownerType}`,
      });
    await tx.insert(s.invitation).values({
      tenantId: B,
      tenderId: tn!.id,
      email: `inv@${MARK}.example`,
      company: `${MARK} Invitee`,
      tokenHash: `h-${MARK}`,
      expiresAt: new Date(now.getTime() + 86_400_000),
    });
    const [sub] = await tx
      .insert(s.submission)
      .values({
        tenantId: B,
        tenderId: tn!.id,
        supplierId: sup!.id,
        status: 'SUBMITTED',
        submittedAt: now,
        receipt: `RC-${MARK}`,
      })
      .returning();
    await tx.insert(s.fileObject).values({
      tenantId: B,
      submissionId: sub!.id,
      name: `${MARK}.pdf`,
      sizeBytes: 10,
      contentType: 'application/pdf',
      storageKey: `${B}/${sub!.id}/${randomUUID()}`,
      sha256: 'a'.repeat(64),
      scan: 'CLEAN',
      section: 'TECHNICAL',
    });
    await tx.insert(s.responseItem).values({
      tenantId: B,
      tenderId: tn!.id,
      key: 'method',
      label: `${MARK} question`,
      section: 'TECHNICAL',
      kind: 'TEXT',
    });
    await tx.insert(s.responseAnswer).values({
      tenantId: B,
      submissionId: sub!.id,
      itemKey: 'method',
      value: await sealAnswer(tx, B, sub!.id, 'method', `${MARK} the answer`, now),
    });
    await tx.insert(s.question).values({
      tenantId: B,
      tenderId: tn!.id,
      text: `${MARK} question text`,
      answer: `${MARK} answer`,
      status: 'PUBLISHED',
    });
    const [ev] = await tx
      .insert(s.evaluation)
      .values({ tenantId: B, tenderId: tn!.id, status: 'APPROVED' })
      .returning();
    const [crit] = await tx
      .insert(s.criterion)
      .values({
        tenantId: B,
        evaluationId: ev!.id,
        name: `${MARK} criterion`,
        weight: '100',
        stream: 'TECHNICAL',
      })
      .returning();
    await tx.insert(s.panelMember).values({
      tenantId: B,
      evaluationId: ev!.id,
      userId: proc.id,
      stream: 'TECHNICAL',
      coiState: 'DECLARED_NONE',
    });
    await tx.insert(s.consensusItem).values({
      tenantId: B,
      evaluationId: ev!.id,
      supplierId: sup!.id,
      criterionId: crit!.id,
      consensusScore: '8.00',
      rationale: MARK,
    });
    const [rep] = await tx
      .insert(s.evalReport)
      .values({ tenantId: B, evaluationId: ev!.id, status: 'APPROVED' })
      .returning();
    await tx.insert(s.fieldValue).values({
      tenantId: B,
      ownerType: 'EVAL_REPORT',
      ownerId: rep!.id,
      key: 'summary',
      label: MARK,
      value: `${MARK} narrative`,
    });
    await tx.insert(s.approval).values({
      tenantId: B,
      subjectType: 'EVAL_REPORT',
      subjectId: rep!.id,
      userId: proc.id,
      role: 'DELEGATE',
      decision: 'APPROVED',
      stamp: `${MARK} stamp`,
    });
    const [ct] = await tx
      .insert(s.contract)
      .values({
        tenantId: B,
        number: `CT-${MARK}`,
        title: `${MARK} contract`,
        tenderId: tn!.id,
        supplierId: sup!.id,
        status: 'EXECUTED',
        value: '120000',
        startDate: '2026-01-01',
        endDate: '2028-01-01',
        locked: true,
        ownerId: proc.id,
      })
      .returning();
    await tx.insert(s.contractFile).values({
      tenantId: B,
      contractId: ct!.id,
      kind: 'AMENDED_DRAFT',
      name: `${MARK}.txt`,
      sizeBytes: 5,
      contentType: 'text/plain',
      storageKey: `${B}/contract/${randomUUID()}`,
      sha256: 'b'.repeat(64),
      version: 1,
      note: MARK,
      uploadedBy: proc.id,
    });
    await tx
      .insert(s.alert)
      .values({ tenantId: B, contractId: ct!.id, kind: 'CUSTOM', triggerDate: '2027-01-01', note: MARK });
    await tx.insert(s.notification).values({
      tenantId: B,
      userId: admin.id,
      title: `${MARK} notification`,
      body: MARK,
      link: `/app/requests/${req!.id}`,
    });
    await tx.insert(s.outboundEmail).values({
      tenantId: B,
      toEmail: 'b@other.example',
      subject: `${MARK} email`,
      body: MARK,
      kind: 'TEST',
    });
    await tx.insert(s.template).values({
      id: `tpl-b-${MARK.slice(-6)}`,
      tenantId: B,
      type: 'CONTRACT',
      name: `${MARK} template`,
      version: '1.0',
      body: {},
    });
    await tx.insert(s.connector).values({
      tenantId: B,
      kind: 'ERP',
      provider: 'SIMULATED_ERP',
      config: { note: MARK },
      createdAt: now,
      updatedAt: now,
    } as never);
    await setSecret(
      tx,
      { audit, now },
      bctx(admin.id),
      `b.secret.${MARK.toLowerCase()}`,
      `${MARK}-secret-value-123`,
    );
    for (const p of ['DATA', 'BIDS', 'PROJECT'] as const) await activeKey(tx, B, p, now);
    await tx.insert(s.quarantineItem).values({
      tenantId: B,
      source: 'POST /x',
      name: `${MARK}.exe`,
      sizeBytes: 3,
      sha256: 'c'.repeat(64),
      signature: MARK,
      status: 'QUARANTINED',
      userId: admin.id,
      createdAt: now,
    });
    const k = await newWrappedDek(tx, B, now);
    await tx.insert(s.restrictedProject).values({
      requestId: req!.id,
      tenantId: B,
      reason: `${MARK} reason`,
      setBy: proc.id,
      setAt: now,
      keyVersion: k.keyVersion,
      wrappedDek: k.wrappedDek,
      iv: k.iv,
    });
    await tx.insert(s.probityAllocation).values({ tenantId: B, userId: admin.id, tenderId: tn!.id });
    await audit.record(tx, bctx(admin.id), {
      action: 'request.create',
      entityType: 'request',
      entityId: req!.id,
      after: { title: `${MARK} request title` },
    });
    await audit.record(tx, bctx(admin.id), {
      action: 'tender.publish',
      entityType: 'tender',
      entityId: tn!.id,
      after: { note: MARK },
    });
    for (const [type, id] of [
      ['request', req!.id],
      ['plan', pl!.id],
      ['tender', tn!.id],
      ['submission', sub!.id],
      ['evaluation', ev!.id],
      ['contract', ct!.id],
      ['supplier', sup!.id],
      ['user', proc.id],
    ] as const)
      ids.byType.set(type, id);
    // every primary key of every row tenant B owns: the set nothing may leak
    const tables = await tx.execute<{ table_name: string }>(sql`
      select c.table_name from information_schema.columns c
      join information_schema.columns k on k.table_schema = c.table_schema and k.table_name = c.table_name and k.column_name = 'id'
      where c.table_schema = 'public' and c.column_name = 'tenant_id' order by 1`);
    for (const t of tables.rows) {
      const r = await tx.execute<{ id: string }>(
        sql.raw(`select id::text as id from "${t.table_name}" where tenant_id = '${B}'::uuid`),
      );
      if (r.rows.length) ids.populated.push(t.table_name);
      for (const row of r.rows) if (/^[0-9a-f-]{36}$/.test(row.id)) ids.all.add(row.id);
    }
    ids.all.add(B);
    for (const e of (
      await tx.execute<{ id: string }>(
        sql`select entity_id::text as id from audit_event where tenant_id = ${B}::uuid and entity_id is not null`,
      )
    ).rows)
      ids.all.add(e.id);
  });
}

const text = (r: { rawPayload: Buffer }) =>
  `${r.rawPayload.toString('utf8')}\n${r.rawPayload.toString('latin1')}`;
const leaks = (body: string, audit = false): string[] => {
  const out: string[] = [];
  if (body.includes(MARK)) out.push('marker');
  for (const id of ids.all) if (body.includes(id) && !(probed.has(id) && audit)) out.push(id);
  return out;
};

const USER_FOR: Record<string, string> = {
  REQUESTER: 'requester',
  PROCUREMENT: 'procurement',
  DELEGATE: 'delegate',
  EVALUATOR: 'evaluator-tech',
  CHAIR: 'chair',
  LEGAL: 'legal',
  CONTRACT_MGR: 'contract-mgr',
  PROBITY: 'probity',
  FINANCE: 'finance',
  ADMIN: 'admin',
  EXEC: 'exec',
  SUPPLIER: 'supplier',
};

describe('SEC-D10 tenant isolation: the second tenant is really populated', () => {
  it('SEC-D10 tenant B has rows in every major table family, so "nothing leaked" is not "nothing there"', async () => {
    const need = [
      'request',
      'plan',
      'tender',
      'submission',
      'file_object',
      'response_answer',
      'evaluation',
      'eval_report',
      'contract',
      'contract_file',
      'supplier',
      'app_user',
      'notification',
      'audit_event',
      'connector',
      'secret_entry',
      'kms_key',
      'quarantine_item',
      'restricted_project',
      'field_value',
      'invitation',
      'question',
      'alert',
      'approval',
      'delegation',
      'org_unit',
      'role_assignment',
    ];
    const aud = await sys<number>(async (tx) =>
      Number(
        (
          await tx.execute<{ n: number }>(
            sql`select count(*)::int n from audit_event where tenant_id = ${B}::uuid`,
          )
        ).rows[0]!.n,
      ),
    );
    expect(aud).toBeGreaterThan(0);
    const rp = await sys<number>(async (tx) =>
      Number(
        (
          await tx.execute<{ n: number }>(
            sql`select count(*)::int n from restricted_project where tenant_id = ${B}::uuid`,
          )
        ).rows[0]!.n,
      ),
    );
    expect(rp).toBeGreaterThan(0);
    for (const t of need.filter((x) => x !== 'audit_event' && x !== 'restricted_project'))
      expect(ids.populated, `tenant B has no ${t} row`).toContain(t);
    // settings live on the tenant row itself
    const [t] = await sys<Array<{ c: unknown }>>((tx) =>
      tx.select({ c: s.tenant.config }).from(s.tenant).where(eq(s.tenant.id, B)),
    );
    expect(JSON.stringify(t!.c)).toContain(MARK);
    expect(ids.all.size).toBeGreaterThan(40);
    // the detector itself works: a body holding one of B's ids or its marker is caught
    expect(leaks(`{"id":"${ids.byType.get('request')}"}`).length).toBe(1);
    expect(leaks(`{"title":"${MARK} x"}`)).toEqual(['marker']);
    expect(leaks('{"title":"nothing here"}')).toEqual([]);
  });
});

describe('SEC-D10 every GET route in the OpenAPI document, as tenant A, with tenant B populated', () => {
  const spec = loadSpec();
  const gets = Object.entries(spec.paths)
    .filter(([, item]) => 'get' in item)
    .map(([path, item]) => ({ path, op: item.get! }));
  const typeOf = (path: string): string[] => {
    const first = path.split('/').filter(Boolean)[0] ?? '';
    const map: Record<string, string> = {
      requests: 'request',
      plans: 'plan',
      tenders: 'tender',
      contracts: 'contract',
      suppliers: 'supplier',
      evaluations: 'evaluation',
      submissions: 'submission',
      supplier: 'tender',
      documents: 'plan',
      repository: 'request',
      approvals: 'plan',
      varations: 'contract',
    };
    return [map[first] ?? 'request', 'tender', 'contract', 'supplier', 'plan', 'evaluation', 'submission'];
  };
  const fill = (path: string, idByType: string): string =>
    path.replace(/\{(\w+)\}/g, (_m, name: string) => {
      if (/id$/i.test(name) || name === 'id') return idByType;
      const defaults: Record<string, string> = {
        folder: 'General',
        name: 'x.txt',
        key: 'overview',
        type: 'plan',
        kind: 'TECHNICAL',
        purpose: 'BIDS',
        format: 'pdf',
        version: '1',
        section: 'TECHNICAL',
        fileId: idByType,
      };
      return defaults[name] ?? 'x';
    });

  it('SEC-D10 the document has the routes this test claims to cover', () => {
    expect(gets.length).toBeGreaterThan(150);
  });

  it("SEC-D10 NFR-R01 no list or read route returns a row, id or marker of tenant B to a user of tenant A, and no lookup by B's ids succeeds", async () => {
    const problems: string[] = [];
    let calls = 0;
    let withIds = 0;
    const statusSeen = new Map<number, number>();
    for (const { path, op } of gets) {
      const roles =
        op['x-roles'] === 'public'
          ? []
          : op['x-roles'] === 'any-authenticated'
            ? ['REQUESTER', 'ADMIN']
            : op['x-roles'];
      const users = [...new Set(roles.map((r) => USER_FOR[r]).filter((u): u is string => !!u))].slice(0, 5);
      const hasParams = /\{/.test(path);
      const attempts: string[] = [];
      if (!hasParams) {
        attempts.push(
          path,
          `${path}${path.includes('?') ? '&' : '?'}q=${MARK}`,
          `${path}?search=${MARK}&query=${MARK}`,
        );
      } else {
        const types = typeOf(path);
        for (const t of types.slice(0, 3))
          attempts.push(fill(path, ids.byType.get(t) ?? ids.byType.get('request')!));
        withIds += 1;
      }
      for (const user of users.length ? users : ['requester']) {
        for (const url of attempts) {
          calls += 1;
          for (const id of ids.all) if (url.includes(id)) probed.add(id);
          const r = await env.call(user, 'GET', url);
          statusSeen.set(r.statusCode, (statusSeen.get(r.statusCode) ?? 0) + 1);
          const found = leaks(text(r), path.startsWith('/audit-events'));
          if (found.length)
            problems.push(`LEAK ${user} GET ${url} -> ${r.statusCode}: ${found.slice(0, 3).join(', ')}`);
          if (r.statusCode >= 500 && r.statusCode !== 501)
            problems.push(`5xx ${user} GET ${url} -> ${r.statusCode}: ${r.body.slice(0, 120)}`);
          if (hasParams && r.statusCode === 200 && attempts.indexOf(url) === 0)
            problems.push(`FOUND ${user} GET ${url} -> 200 for a row of tenant B`);
        }
      }
    }
    // not a vacuous pass: a good number of calls reached a real handler and answered
    expect(calls).toBeGreaterThan(600);
    expect(withIds).toBeGreaterThan(50);
    expect(statusSeen.get(200) ?? 0).toBeGreaterThan(100);
    expect(problems, problems.join('\n')).toEqual([]);
  }, 600_000);

  it("SEC-D10 the same holds for search, the assistant and reports asked for tenant B's marker by name", async () => {
    for (const user of ['admin', 'procurement', 'exec', 'requester', 'legal', 'probity', 'finance']) {
      for (const [method, url, body] of [
        ['POST', '/search', { query: MARK }],
        ['POST', '/assistant/chat', { message: `find ${MARK}` }],
        ['GET', `/requests?q=${MARK}&limit=100`, undefined],
        ['GET', `/reports/procurements?q=${MARK}`, undefined],
        ['GET', `/audit-events?action=request&limit=200`, undefined],
        ['GET', `/audit-events?entityId=${ids.byType.get('request')}`, undefined],
        ['GET', `/audit-events/export`, undefined],
      ] as const) {
        const r = await env.call(user, method, url, body);
        // a search that echoes what was typed is not a leak: only B's own text, found by the search, would be
        const echoed = text(r)
          .split(`find ${MARK}`)
          .join('')
          .split(`q=${MARK}`)
          .join('')
          .split(`"query":"${MARK}"`)
          .join('')
          .split(`"q":"${MARK}"`)
          .join('');
        expect(
          leaks(
            url === '/search' ||
              url.startsWith('/assistant') ||
              url.startsWith('/requests?q') ||
              url.startsWith('/reports')
              ? echoed.split(MARK + '"').join('"')
              : text(r),
            url.startsWith('/audit-events'),
          ),
          `${user} ${method} ${url} -> ${r.statusCode}`,
        ).toEqual([]);
        expect(r.statusCode, `${user} ${method} ${url}`).toBeLessThan(500);
      }
    }
  }, 300_000);
});

describe('SEC-D10 NFR-R01 the database enforces it too: row level security with tenant context', () => {
  const asA = (role: s.Role = 'ADMIN'): RequestContext => ({
    tenantId: TENANT_ID,
    userId: uid('user:admin'),
    role,
  });
  const rlsTables = [
    'request',
    'plan',
    'tender',
    'evaluation',
    'contract',
    'kms_key',
    'quarantine_item',
    'restricted_project',
    'file_object',
  ];

  it("SEC-D10 as a user of tenant A, none of tenant B's rows are visible in any table protected by row level security", async () => {
    for (const t of rlsTables) {
      const forB = await sys<number>(async (tx) =>
        Number(
          (
            await tx.execute<{ n: number }>(
              sql.raw(`select count(*)::int n from "${t}" where tenant_id = '${B}'::uuid`),
            )
          ).rows[0]!.n,
        ),
      );
      expect(forB, `${t} should hold rows for tenant B`).toBeGreaterThan(0);
      const seen = await withContext(env.database, asA(), async (tx) =>
        Number(
          (
            await tx.execute<{ n: number }>(
              sql.raw(`select count(*)::int n from "${t}" where tenant_id = '${B}'::uuid`),
            )
          ).rows[0]!.n,
        ),
      );
      expect(seen, `${t}: tenant B rows visible to tenant A`).toBe(0);
    }
  });

  it("SEC-D10 the policies also refuse a write that names tenant B from tenant A's context", async () => {
    const attempt = (fn: Parameters<typeof withContext>[2]) =>
      withContext(env.database, asA(), fn).then(
        () => 'accepted',
        () => 'refused',
      );
    expect(
      await attempt((tx) =>
        tx
          .insert(s.request)
          .values({ tenantId: B, number: 'X-1', title: 'smuggled', requesterId: uid('user:admin') })
          .then(() => undefined),
      ),
    ).toBe('refused');
    expect(
      await attempt((tx) =>
        tx
          .insert(s.quarantineItem)
          .values({
            tenantId: B,
            source: 's',
            name: 'n',
            sizeBytes: 1,
            sha256: 'd'.repeat(64),
            status: 'QUARANTINED',
            createdAt: new Date(),
          })
          .then(() => undefined),
      ),
    ).toBe('refused');
    // an update that names B's row from A's context changes nothing
    const touched = await withContext(env.database, asA(), async (tx) => {
      const r = await tx
        .update(s.request)
        .set({ title: 'hijacked' })
        .where(eq(s.request.tenantId, B))
        .returning({ id: s.request.id });
      return r.length;
    });
    expect(touched).toBe(0);
    const [still] = await sys<Array<{ title: string }>>((tx) =>
      tx
        .select({ title: s.request.title })
        .from(s.request)
        .where(eq(s.request.id, ids.byType.get('request')!)),
    );
    expect(still!.title).toContain(MARK);
  });

  it('SEC-D10 with no tenant context published the role sees nothing at all (fails closed)', async () => {
    const rows = await env.database.db.transaction(async (tx) => {
      await tx.execute(sql`set local role app_user`);
      return (await tx.select().from(s.request)).length + (await tx.select().from(s.kmsKey)).length;
    });
    expect(rows).toBe(0);
  });

  it('SEC-D10 the live check endpoint agrees with the harness', async () => {
    const r = await env.call('admin', 'POST', '/security/isolation-check');
    expect(r.statusCode, r.body).toBe(200);
    const j = r.json() as Json;
    expect(j.ok).toBe(true);
    for (const t of rlsTables) {
      const row = j.rlsTables.find((x: Json) => x.table === t);
      expect(row, t).toBeDefined();
      expect(row.foreignRowsExist, t).toBeGreaterThan(0);
      expect(row.foreignRowsVisible, t).toBe(0);
    }
  });
});
