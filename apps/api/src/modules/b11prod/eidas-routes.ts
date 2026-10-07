/**
 * Signature level endpoints (NFR-L03): the level a contract needs, Legal's override with a reason, the level each signature
 * achieved, and the non-repudiation evidence for the contract (signer, method, level, time, document hash, IP and browser
 * class), with a check that what was signed has not been changed since.
 */
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RoleName } from '@if/shared';
import { guard, type GuardDeps } from '../../auth/guard.js';
import { withContext, type Tx } from '../../db/client.js';
import {
  appUser,
  approval,
  connector,
  contract,
  contractSignaturePolicy,
  signatureEvidence,
  userMfa,
  SIGNATURE_LEVELS,
} from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { isQualifiedProvider } from '../b10x/esign-adapters.js';
import { requiredSigners } from '../contract/clauses.js';
import { canSee } from '../contract/b5-service.js';
import { loadSettings } from '../settings/settings.js';
import {
  LEVEL_EXPLAINER,
  LEVEL_LABEL,
  METHOD_LABEL,
  contentDigest,
  loadPolicy,
  meetsLevel,
  requiredLevelFor,
} from './eidas.js';

const READERS: RoleName[] = [
  'PROCUREMENT',
  'LEGAL',
  'CONTRACT_MGR',
  'DELEGATE',
  'EXEC',
  'FINANCE',
  'PROBITY',
  'ADMIN',
];
const idParam = z.object({ id: z.string().uuid() });
const overrideBody = z
  .object({
    level: z.enum(SIGNATURE_LEVELS).nullable(),
    reason: z.string().trim().min(10, 'Say why in at least 10 characters').max(500),
  })
  .strict();

type ContractRow = typeof contract.$inferSelect;

/** What counts for signing authority (a copy of the contract route's rule, so the level and the chain agree). */
async function authorityValueOf(tx: Tx, c: ContractRow): Promise<number> {
  if (!c.parentId) return Number(c.value);
  if ((await loadSettings(tx, c.tenantId)).contractManagement.variationModel === 'INCREMENTAL')
    return Number(c.value);
  const [parent] = await tx.select().from(contract).where(eq(contract.id, c.parentId));
  if (!parent) return Number(c.value);
  const variations = await tx
    .select()
    .from(contract)
    .where(and(eq(contract.parentId, parent.id), isNull(contract.deletedAt)));
  const done = variations.filter((v) => v.status === 'EXECUTED' && v.id !== c.id);
  return Number(parent.value) + done.reduce((s, v) => s + Number(v.value), 0) + Number(c.value);
}

export function registerEidasRoutes(app: FastifyInstance, p: string, d: GuardDeps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);

  /** Everything the card and the export need, built once. */
  async function build(
    tx: Tx,
    a: { user: { id: string; tenantId: string; roles: string[] } },
    c: ContractRow,
    blind: boolean,
  ) {
    const settings = await loadSettings(tx, c.tenantId);
    const policy = await loadPolicy(tx, c.tenantId, c.id);
    const value = await authorityValueOf(tx, c);
    const required = requiredLevelFor(settings.signatures, value, policy);
    const digest = await contentDigest(tx, c);
    const rows = await tx
      .select({ e: signatureEvidence, ap: approval, name: appUser.name })
      .from(signatureEvidence)
      .innerJoin(approval, eq(approval.id, signatureEvidence.approvalId))
      .innerJoin(appUser, eq(appUser.id, signatureEvidence.signerId))
      .where(and(eq(signatureEvidence.tenantId, c.tenantId), eq(signatureEvidence.contractId, c.id)))
      .orderBy(asc(signatureEvidence.signedAt));
    const live = rows.filter((r) => r.ap.decision === 'APPROVED');
    const signers = requiredSigners(value);
    const chain = signers.map((s) => {
      const r = live.find((x) => x.e.signerRole === s.role);
      const hidden = blind && r && r.e.signerId !== a.user.id;
      if (!r || hidden)
        return {
          role: s.role,
          label: s.label,
          signed: Boolean(r),
          level: null,
          signedBy: null,
          evidence: null,
        };
      const matches = r.e.docHash === digest;
      return {
        role: s.role,
        label: s.label,
        signed: true,
        level: r.e.level,
        signedBy: r.name,
        evidence: {
          signer: r.name,
          signerId: r.e.signerId,
          role: r.e.signerRole,
          method: r.e.method,
          methodLabel: METHOD_LABEL[r.e.method],
          level: r.e.level,
          levelLabel: LEVEL_LABEL[r.e.level],
          requiredLevel: r.e.requiredLevel,
          meetsCurrentRequirement: meetsLevel(r.e.level, required.level),
          provider: r.e.provider,
          signedAt: r.e.signedAt.toISOString(),
          documentDigest: r.e.docHash,
          algorithm: 'SHA-256',
          ip: r.e.ip,
          userAgentClass: r.e.userAgentClass,
          integrity: matches ? ('INTACT' as const) : ('MODIFIED_AFTER_SIGNING' as const),
        },
      };
    });
    const anyModified = chain.some((x) => x.evidence?.integrity === 'MODIFIED_AFTER_SIGNING');
    const [esign] = await tx
      .select()
      .from(connector)
      .where(and(eq(connector.tenantId, c.tenantId), eq(connector.kind, 'ESIGN')));
    const [mfa] = await tx.select().from(userMfa).where(eq(userMfa.userId, a.user.id));
    const [setter] = policy
      ? await tx.select({ name: appUser.name }).from(appUser).where(eq(appUser.id, policy.setBy))
      : [];
    return {
      contractId: c.id,
      number: c.number,
      status: c.status,
      value,
      required,
      override: policy
        ? {
            level: policy.level,
            reason: policy.reason,
            setBy: setter?.name ?? null,
            setAt: policy.setAt.toISOString(),
          }
        : null,
      tiers: [...settings.signatures.requiredLevelByValue].sort((x, y) => x.fromAud - y.fromAud),
      defaultLevel: settings.signatures.defaultLevel,
      explainer: LEVEL_EXPLAINER,
      chain,
      currentDigest: digest,
      integrity: anyModified ? ('MODIFIED_AFTER_SIGNING' as const) : ('INTACT' as const),
      qualifiedProviderReady: Boolean(
        esign?.enabled && esign.provider && isQualifiedProvider(esign.provider) && esign.mode === 'UP',
      ),
      esignProvider: esign?.provider ?? null,
      mfaEnrolled: Boolean(mfa?.confirmed),
      simulated: true as const,
    };
  }

  async function fetchContract(tx: Tx, tenantId: string, id: string) {
    const [c] = await tx
      .select()
      .from(contract)
      .where(and(eq(contract.id, id), eq(contract.tenantId, tenantId), isNull(contract.deletedAt)));
    return c;
  }

  reg('GET', '/contracts/{id}/signature-level');
  app.get(`${p}/contracts/:id/signature-level`, { preHandler: guard(d, READERS) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(idParam, req.params);
    return withContext(d.database, a.ctx, async (tx) => {
      const c = await fetchContract(tx, a.user.tenantId, id);
      if (!c || !(await canSee(tx, a, c))) throw new AppError(404, 'NOT_FOUND', 'Contract not found');
      const blind =
        c.signingMode === 'BLIND' &&
        c.status !== 'EXECUTED' &&
        !a.user.roles.some((r) => ['LEGAL', 'PROCUREMENT', 'PROBITY'].includes(r));
      return {
        ...(await build(tx, a, c, blind)),
        canOverride: a.user.roles.includes('LEGAL') && !c.locked,
      };
    });
  });

  reg('PUT', '/contracts/{id}/signature-level');
  app.put(`${p}/contracts/:id/signature-level`, { preHandler: guard(d, ['LEGAL']) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(idParam, req.params);
    const body = parse(overrideBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const c = await fetchContract(tx, a.user.tenantId, id);
      if (!c || !(await canSee(tx, a, c))) throw new AppError(404, 'NOT_FOUND', 'Contract not found');
      if (c.locked) throw new AppError(423, 'CONTRACT_LOCKED', 'This contract is executed and locked');
      const before = await loadPolicy(tx, a.user.tenantId, id);
      const now = d.clock.now();
      if (body.level === null) {
        await tx.delete(contractSignaturePolicy).where(eq(contractSignaturePolicy.contractId, id));
      } else {
        await tx
          .insert(contractSignaturePolicy)
          .values({
            tenantId: a.user.tenantId,
            contractId: id,
            level: body.level,
            reason: body.reason,
            setBy: a.user.id,
            setAt: now,
          })
          .onConflictDoUpdate({
            target: contractSignaturePolicy.contractId,
            set: { level: body.level, reason: body.reason, setBy: a.user.id, setAt: now },
          });
      }
      await d.audit.record(tx, a.ctx, {
        action: 'contract.signature_level_set',
        entityType: 'contract',
        entityId: id,
        before: { level: before?.level ?? null },
        after: { level: body.level, reason: body.reason },
      });
      return { ...(await build(tx, a, c, false)), canOverride: true };
    });
  });

  reg('GET', '/contracts/{id}/signature-evidence');
  app.get(`${p}/contracts/:id/signature-evidence`, { preHandler: guard(d, READERS) }, async (req, reply) => {
    const a = req.auth!;
    const { id } = parse(idParam, req.params);
    const out = await withContext(d.database, a.ctx, async (tx) => {
      const c = await fetchContract(tx, a.user.tenantId, id);
      if (!c || !(await canSee(tx, a, c))) throw new AppError(404, 'NOT_FOUND', 'Contract not found');
      const blind =
        c.signingMode === 'BLIND' &&
        c.status !== 'EXECUTED' &&
        !a.user.roles.some((r) => ['LEGAL', 'PROCUREMENT', 'PROBITY'].includes(r));
      const v = await build(tx, a, c, blind);
      await d.audit.record(tx, a.ctx, {
        action: 'contract.signature_evidence_export',
        entityType: 'contract',
        entityId: id,
        after: { signatures: v.chain.filter((x) => x.signed).length, integrity: v.integrity },
      });
      return {
        export: 'SIGNATURE_EVIDENCE',
        generatedAt: d.clock.now().toISOString(),
        contract: { id: c.id, number: c.number, status: c.status, value: v.value },
        requiredLevel: v.required,
        currentDocumentDigest: v.currentDigest,
        integrity: v.integrity,
        integrityNote:
          v.integrity === 'INTACT'
            ? 'The contract wording and terms are the same as when each signature was made.'
            : 'The contract wording or terms have changed since at least one signature was made.',
        signatures: v.chain.flatMap((x) => (x.evidence ? [x.evidence] : [])),
        simulated: true,
      };
    });
    void reply.header(
      'content-disposition',
      `attachment; filename="signature-evidence-${out.contract.number}.json"`,
    );
    return out;
  });

  return done;
}
