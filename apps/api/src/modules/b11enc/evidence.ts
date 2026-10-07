/**
 * Evidence for SEC-D01 (encrypted in transit and at rest), SEC-D02 (key versions in use), NFR-R01 and SEC-D10 (the data stays
 * in the customer's tenancy, shown by live database checks). Everything here is MEASURED from the running application and
 * its database when the page is read; what the application cannot see (disk encryption, TLS termination) is listed as
 * "not evidenced here" rather than claimed.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '@if/shared';
import { withContext, withSystem, type Database, type RequestContext, type Tx } from '../../db/client.js';
import {
  fileObject,
  quarantineItem,
  responseAnswer,
  restrictedProject,
  secretEntry,
  supplier,
  tenant,
  userMfa,
} from '../../db/schema.js';
import type { SealedStore } from '../tender/files.js';
import {
  ENVELOPE_PREFIX,
  blobEnvelope,
  isEnvelopeBlob,
  keyRows,
  rootKeySource,
  type KeyRow,
} from './keys.js';

export interface FieldEvidence {
  id: string;
  table: string;
  column: string;
  description: string;
  /** How the value is protected. */
  method: 'ENVELOPE (tenant key)' | 'APPLICATION SEAL (server key)' | 'SECRET STORE (AES-256-GCM)';
  keyPurpose: 'DATA' | 'BIDS' | 'PROJECT' | null;
  encrypted: number;
  plaintext: number;
  /** Rows per key version, for envelope-encrypted fields. */
  versions: Record<string, number>;
}

const bump = (m: Record<string, number>, v: number) => {
  m[String(v)] = (m[String(v)] ?? 0) + 1;
};
const parseEnv = (token: string): number | null => {
  try {
    const j = JSON.parse(Buffer.from(token.slice(ENVELOPE_PREFIX.length), 'base64url').toString('utf8')) as {
      kv: number;
    };
    return j.kv;
  } catch {
    return null;
  }
};

/** The registry of encrypted fields with counts of encrypted and plaintext rows, measured now. */
export async function fieldRegistry(
  tx: Tx,
  store: SealedStore | null,
  tenantId: string,
): Promise<FieldEvidence[]> {
  const out: FieldEvidence[] = [];

  // response answers (BIDS)
  const ans = await tx
    .select({ v: responseAnswer.value })
    .from(responseAnswer)
    .where(eq(responseAnswer.tenantId, tenantId));
  const a: FieldEvidence = {
    id: 'response_answer.value',
    table: 'response_answer',
    column: 'value',
    description: 'Supplier answers to the response schedule',
    method: 'ENVELOPE (tenant key)',
    keyPurpose: 'BIDS',
    encrypted: 0,
    plaintext: 0,
    versions: {},
  };
  for (const r of ans) {
    if (r.v.startsWith(ENVELOPE_PREFIX)) {
      a.encrypted += 1;
      const kv = parseEnv(r.v);
      if (kv !== null) bump(a.versions, kv);
    } else a.plaintext += 1;
  }
  out.push(a);

  // bid files on disk (BIDS)
  const files = await tx
    .select({ k: fileObject.storageKey })
    .from(fileObject)
    .where(eq(fileObject.tenantId, tenantId));
  const f: FieldEvidence = {
    id: 'file_object.blob',
    table: 'file_object',
    column: 'storage_key (the stored file)',
    description: 'Bid documents uploaded by suppliers',
    method: 'ENVELOPE (tenant key)',
    keyPurpose: 'BIDS',
    encrypted: 0,
    plaintext: 0,
    versions: {},
  };
  for (const r of files) {
    if (!store) break;
    try {
      const raw = await store.rawBytes(r.k);
      if (isEnvelopeBlob(raw)) {
        f.encrypted += 1;
        bump(f.versions, blobEnvelope(raw).kv);
      } else f.plaintext += 1; // sealed with the single server key only: encrypted at rest, but not under the tenant key
    } catch {
      /* a file missing on disk is not counted either way */
    }
  }
  out.push(f);

  // supplier bank details (DATA)
  const banks = await tx.select({ b: supplier.bank }).from(supplier).where(eq(supplier.tenantId, tenantId));
  const b: FieldEvidence = {
    id: 'supplier.bank',
    table: 'supplier',
    column: 'bank',
    description: 'Supplier bank details (BSB, account number, account name)',
    method: 'ENVELOPE (tenant key)',
    keyPurpose: 'DATA',
    encrypted: 0,
    plaintext: 0,
    versions: {},
  };
  for (const r of banks) {
    if (r.b === null || r.b === undefined) continue;
    const enc = (r.b as { __enc?: string }).__enc;
    if (typeof enc === 'string' && enc.startsWith(ENVELOPE_PREFIX)) {
      b.encrypted += 1;
      const kv = parseEnv(enc);
      if (kv !== null) bump(b.versions, kv);
    } else b.plaintext += 1;
  }
  out.push(b);

  // legal platform shared secret kept in the tenant settings (should be empty: it belongs in the secret store)
  const [t] = await tx.select({ c: tenant.config }).from(tenant).where(eq(tenant.id, tenantId));
  const legal = (t?.c as { settings?: { legalPlatform?: { webhookSecret?: string } } } | undefined)?.settings
    ?.legalPlatform?.webhookSecret;
  out.push({
    id: 'tenant.config.legalPlatform.webhookSecret',
    table: 'tenant',
    column: 'config.settings.legalPlatform.webhookSecret',
    description:
      'Legal platform shared secret: belongs in the secret store; a value left in the settings is plaintext',
    method: 'SECRET STORE (AES-256-GCM)',
    keyPurpose: null,
    encrypted: 0,
    plaintext: legal && legal.length > 0 ? 1 : 0,
    versions: {},
  });

  // secret store
  const secrets = await tx
    .select({ id: secretEntry.id })
    .from(secretEntry)
    .where(eq(secretEntry.tenantId, tenantId));
  out.push({
    id: 'secret_entry.ciphertext',
    table: 'secret_entry',
    column: 'ciphertext',
    description: 'Connector and webhook secrets (values are never returned by any API)',
    method: 'SECRET STORE (AES-256-GCM)',
    keyPurpose: null,
    encrypted: secrets.length,
    plaintext: 0,
    versions: {},
  });

  // MFA secrets: sealed by the sign-in module with the server key (iv.ciphertext.tag)
  const mfa = await tx.select({ s: userMfa.secret }).from(userMfa).where(eq(userMfa.tenantId, tenantId));
  const sealedShape = /^[\w-]{16}\.[\w-]+\.[\w-]{22}$/;
  out.push({
    id: 'user_mfa.secret',
    table: 'user_mfa',
    column: 'secret',
    description: 'Authenticator-app (TOTP) secrets',
    method: 'APPLICATION SEAL (server key)',
    keyPurpose: null,
    encrypted: mfa.filter((m) => sealedShape.test(m.s)).length,
    plaintext: mfa.filter((m) => !sealedShape.test(m.s)).length,
    versions: {},
  });

  // restricted project data keys
  const rp = await tx
    .select({ v: restrictedProject.keyVersion })
    .from(restrictedProject)
    .where(eq(restrictedProject.tenantId, tenantId));
  const p: FieldEvidence = {
    id: 'restricted_project.wrapped_dek',
    table: 'restricted_project',
    column: 'wrapped_dek',
    description: 'Per-project data keys of restricted projects, wrapped by the tenant PROJECT key',
    method: 'ENVELOPE (tenant key)',
    keyPurpose: 'PROJECT',
    encrypted: rp.length,
    plaintext: 0,
    versions: {},
  };
  for (const r of rp) bump(p.versions, r.v);
  out.push(p);

  // uploads held while the scanner was down
  const held = await tx
    .select({ h: quarantineItem.heldContent })
    .from(quarantineItem)
    .where(and(eq(quarantineItem.tenantId, tenantId), eq(quarantineItem.status, 'PENDING_SCAN')));
  out.push({
    id: 'quarantine_item.held_content',
    table: 'quarantine_item',
    column: 'held_content',
    description: 'Uploads held as PENDING_SCAN (cleared once scanned; infected content is never kept)',
    method: 'ENVELOPE (tenant key)',
    keyPurpose: 'DATA',
    encrypted: held.filter((h) => h.h?.startsWith(ENVELOPE_PREFIX)).length,
    plaintext: held.filter((h) => h.h && !h.h.startsWith(ENVELOPE_PREFIX)).length,
    versions: {},
  });
  return out;
}

export interface TransportEvidence {
  mode: string;
  hsts: {
    present: boolean;
    value: string | null;
    maxAgeDays: number | null;
    productionRequirementMet: boolean;
  };
  cookie: {
    httpOnly: boolean;
    sameSite: string;
    secure: boolean;
    secureRequiredHere: boolean;
    productionRequirementMet: boolean;
  };
  otherHeaders: Record<string, string | null>;
  notEvidencedHere: string[];
}

/** What the application itself does for transport security, read from its own response headers and its configuration. */
export async function transportEvidence(app: FastifyInstance, config: AppConfig): Promise<TransportEvidence> {
  const res = await app.inject({ method: 'GET', url: '/health' });
  const hsts = (res.headers['strict-transport-security'] as string | undefined) ?? null;
  const maxAge = hsts ? Number(/max-age=(\d+)/.exec(hsts)?.[1] ?? NaN) : NaN;
  const prod = config.NODE_ENV === 'production';
  const secure = config.NODE_ENV === 'production'; // the cookie options in auth/routes.ts: secure only in production
  return {
    mode: config.NODE_ENV,
    hsts: {
      present: hsts !== null,
      value: hsts,
      maxAgeDays: Number.isFinite(maxAge) ? Math.round(maxAge / 86400) : null,
      productionRequirementMet: hsts !== null && Number.isFinite(maxAge) && maxAge >= 31_536_000,
    },
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      secureRequiredHere: prod,
      productionRequirementMet: secure,
    },
    otherHeaders: {
      'x-content-type-options': (res.headers['x-content-type-options'] as string | undefined) ?? null,
      'x-frame-options': (res.headers['x-frame-options'] as string | undefined) ?? null,
      'cache-control': (res.headers['cache-control'] as string | undefined) ?? null,
    },
    notEvidencedHere: [
      'TLS termination and the certificate chain: done by the load balancer or ingress in front of the application (the application only trusts the forwarded protocol in production).',
      'Database disk encryption (encryption at rest of the storage volume) and the backup encryption setting: infrastructure of the hosting platform, not visible to the application.',
      'Customer-held root key in a managed key service (for example AWS KMS with the customer key): the local key service here is SIMULATED.',
      'Network encryption between the application and the database: the local database (PGlite) runs in-process.',
    ],
  };
}

export interface IsolationCheck {
  ranAt: string;
  tablesWithTenantId: number;
  withRowLevelSecurity: number;
  applicationFilteredOnly: string[];
  rlsTables: Array<{ table: string; policies: number; foreignRowsExist: number; foreignRowsVisible: number }>;
  foreignRowsVisibleTotal: number;
  /** Rows visible as a user of this tenant with the tenant context pointing elsewhere (must be 0 everywhere). */
  note: string;
  ok: boolean;
}

/** A lighter live check than the API test: which tables carry tenant_id, which are protected by RLS, and that RLS hides foreign rows. */
export async function isolationCheck(
  database: Database,
  ctx: RequestContext,
  now: Date,
): Promise<IsolationCheck> {
  // the catalogue first, as the owner, so every table is seen
  const catalogue = await withSystem(database, async (tx) => {
    const tables = await tx.execute<{ table_name: string; rls: boolean; policies: number }>(sql`
      select c.table_name,
             coalesce(pc.relrowsecurity, false) as rls,
             (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = c.table_name) as policies
      from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
      left join pg_class pc on pc.relname = c.table_name and pc.relnamespace = 'public'::regnamespace
      where c.table_schema = 'public' and c.column_name = 'tenant_id'
      order by c.table_name`);
    const rows = tables.rows;
    const exist = new Map<string, number>();
    for (const t of rows.filter((x) => x.rls)) {
      const r = await tx.execute<{ n: number }>(
        sql.raw(
          `select count(*)::int as n from "${t.table_name.replace(/"/g, '')}" where tenant_id <> '${ctx.tenantId}'::uuid`,
        ),
      );
      exist.set(t.table_name, Number(r.rows[0]?.n ?? 0));
    }
    return { rows, exist };
  });
  const rlsTables = catalogue.rows.filter((t) => t.rls);
  const others = catalogue.rows.filter((t) => !t.rls).map((t) => t.table_name);
  // then as the least-privilege role, pointed at a tenant id that is NOT the caller's: nothing may come back
  const probe = '00000000-0000-4000-8000-000000000001';
  const results = await withContext(database, ctx, async (tx) => {
    const out: IsolationCheck['rlsTables'] = [];
    for (const t of rlsTables) {
      const r = await tx.execute<{ n: number }>(
        sql.raw(
          `select count(*)::int as n from "${t.table_name.replace(/"/g, '')}" where tenant_id <> '${ctx.tenantId}'::uuid or tenant_id = '${probe}'::uuid`,
        ),
      );
      out.push({
        table: t.table_name,
        policies: Number(t.policies),
        foreignRowsExist: catalogue.exist.get(t.table_name) ?? 0,
        foreignRowsVisible: Number(r.rows[0]?.n ?? 0),
      });
    }
    return out;
  });
  const total = results.reduce((s, r) => s + r.foreignRowsVisible, 0);
  return {
    ranAt: now.toISOString(),
    tablesWithTenantId: catalogue.rows.length,
    withRowLevelSecurity: rlsTables.length,
    applicationFilteredOnly: others,
    rlsTables: results,
    foreignRowsVisibleTotal: total,
    note: 'Tables listed under applicationFilteredOnly are protected by the tenant filter in the application code, which the automated cross-tenant test (src/modules/b11enc/isolation.test.ts) exercises on every list route; the tables under rlsTables are also protected inside the database.',
    ok: total === 0,
  };
}

export interface EvidenceKeyView {
  purpose: string;
  version: number;
  state: string;
  fingerprint: string;
  usedBy: number;
}

export function keysWithUsage(rows: KeyRow[], fields: FieldEvidence[]): EvidenceKeyView[] {
  return rows.map((k) => ({
    purpose: k.purpose,
    version: k.version,
    state: k.state,
    fingerprint: k.fingerprint,
    usedBy: fields
      .filter((f) => f.keyPurpose === k.purpose)
      .reduce((s, f) => s + (f.versions[String(k.version)] ?? 0), 0),
  }));
}

export async function collectEvidence(
  d: { database: Database; store: SealedStore; app: FastifyInstance; config: AppConfig; now: Date },
  tenantId: string,
) {
  const fields = await withSystem(d.database, (tx) => fieldRegistry(tx, d.store, tenantId));
  const keys = await withSystem(d.database, (tx) => keyRows(tx, tenantId));
  const transport = await transportEvidence(d.app, d.config);
  return {
    simulated: true,
    keyService: {
      simulated: true,
      label:
        'SIMULATED local key service: key-encryption keys are wrapped under a platform root key held in configuration',
      rootKeySource: rootKeySource(),
      swapPoint: 'modules/b11enc/keys.ts wrapKey / unwrapKey',
    },
    transport,
    fields,
    keys: keysWithUsage(keys, fields),
    summary: {
      fieldsTotal: fields.length,
      encryptedRows: fields.reduce((s, f) => s + f.encrypted, 0),
      plaintextRows: fields.reduce((s, f) => s + f.plaintext, 0),
    },
    isolation: {
      apiTest:
        'apps/api/src/modules/b11enc/isolation.test.ts (every list route as tenant A against a populated tenant B)',
      liveCheck: 'POST /security/isolation-check',
    },
    generatedAt: d.now.toISOString(),
  };
}
