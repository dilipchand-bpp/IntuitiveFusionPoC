/**
 * Signature levels aligned to eIDAS (NFR-L03). Three levels:
 *  - SES, a simple electronic signature: the signer is signed in to the platform (and may re-enter the password);
 *  - AES, an advanced electronic signature: uniquely linked to the signer, under the signer's sole control (password and a
 *    code from the signer's own authenticator app), and any later change to what was signed is detectable (the signed
 *    content is hashed and the hash is kept with the signature);
 *  - QES, a qualified electronic signature: made through a qualified trust service provider. Here that is the simulated
 *    provider SIMULATED_QTSP behind the e-signature connector.
 *
 * SWAP POINT (docs/swap-points.md): `SIMULATED_QTSP` in modules/b10x/esign-adapters.ts is the stand-in. A real qualified
 * trust service provider (a QTSP on the EU trusted list, or an Australian equivalent) replaces the adapter and returns its
 * signature container and certificate, which `signature_evidence` would also hold. The level rules below stay as they are.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { verify as argon2Verify } from '@node-rs/argon2';
import { and, asc, eq } from 'drizzle-orm';
import type { Clock } from '@if/shared';
import { withSystem, type Database, type Tx } from '../../db/client.js';
import {
  appUser,
  clause,
  contractSignaturePolicy,
  signatureEvidence,
  userMfa,
  type SignatureLevel,
  type SignatureMethod,
} from '../../db/schema.js';
import type { contract } from '../../db/schema.js';
import { openSecret, verifyTotp } from '../../auth/totp.js';
import { AppError } from '../../http/errors.js';
import type { Settings } from '../settings/settings.js';

export const LEVEL_RANK: Record<SignatureLevel, number> = { SES: 1, AES: 2, QES: 3 };
export const LEVEL_LABEL: Record<SignatureLevel, string> = {
  SES: 'Simple electronic signature',
  AES: 'Advanced electronic signature',
  QES: 'Qualified electronic signature',
};
export const meetsLevel = (achieved: SignatureLevel, required: SignatureLevel): boolean =>
  LEVEL_RANK[achieved] >= LEVEL_RANK[required];

/** What each signing method achieves. The provider is passed in because only a qualified one reaches QES. */
export function levelOf(method: SignatureMethod): SignatureLevel {
  switch (method) {
    case 'QTSP':
      return 'QES';
    case 'PASSWORD_MFA':
      return 'AES';
    default:
      return 'SES'; // SESSION, PASSWORD and a non-qualified provider's ceremony
  }
}

export const METHOD_LABEL: Record<SignatureMethod, string> = {
  SESSION: 'Signed in to the platform',
  PASSWORD: 'Password entered again',
  PASSWORD_MFA: 'Password and authenticator code',
  PROVIDER: 'Provider signing ceremony (not qualified)',
  QTSP: 'Qualified trust service provider',
};

/** The explainer shown beside the signature chain. */
export const LEVEL_EXPLAINER: Array<{
  level: SignatureLevel;
  label: string;
  how: string;
  properties: string[];
  suits: string;
}> = [
  {
    level: 'SES',
    label: LEVEL_LABEL.SES,
    how: 'Sign in the platform. You can also enter your password again to confirm it is you.',
    properties: ['Linked to your account', 'Time-stamped', 'Document hash recorded'],
    suits: 'Everyday contracts where a signed-in decision is enough.',
  },
  {
    level: 'AES',
    label: LEVEL_LABEL.AES,
    how: 'Sign with your password and a code from your authenticator app (set it up under Security).',
    properties: [
      'Uniquely linked to the signer',
      'Under the signer’s sole control (two factors)',
      'Any later change to the signed content is detected (document hash)',
    ],
    suits: 'Higher-value contracts, or where the organisation wants stronger proof of who signed.',
  },
  {
    level: 'QES',
    label: LEVEL_LABEL.QES,
    how: 'Sign through the qualified trust service provider on the e-signature connector (SIMULATED here).',
    properties: [
      'Everything an advanced signature has',
      'Made with a qualified certificate by a qualified provider',
      'Legally equivalent to a handwritten signature in the EU',
    ],
    suits: 'Contracts that must stand as a handwritten signature would.',
  },
];

export interface RequiredLevel {
  level: SignatureLevel;
  basis: 'CONTRACT_OVERRIDE' | 'VALUE_TIER' | 'DEFAULT';
  detail: string;
}

const aud = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });

/** The level a contract needs: Legal's override on the contract, else the highest value tier it reaches, else the default. */
export function requiredLevelFor(
  cfg: Settings['signatures'],
  value: number,
  override: { level: SignatureLevel; reason: string } | null,
): RequiredLevel {
  if (override)
    return {
      level: override.level,
      basis: 'CONTRACT_OVERRIDE',
      detail: `Legal set ${override.level} on this contract: ${override.reason}`,
    };
  const reached = [...cfg.requiredLevelByValue]
    .filter((t) => value >= t.fromAud)
    .sort((a, b) => b.fromAud - a.fromAud)[0];
  if (reached)
    return {
      level: reached.level,
      basis: 'VALUE_TIER',
      detail: `Contracts of ${aud.format(reached.fromAud)} or more need ${reached.level} (this one is ${aud.format(value)})`,
    };
  return {
    level: cfg.defaultLevel,
    basis: 'DEFAULT',
    detail: `The organisation's default is ${cfg.defaultLevel}`,
  };
}

/** What to tell the signer who signed below the required level. */
export function tooLowMessage(required: RequiredLevel, achieved: SignatureLevel): string {
  const how =
    required.level === 'QES'
      ? 'This contract needs a qualified signature: open the signing envelope with the qualified trust service provider and sign there.'
      : 'This contract needs an advanced signature: sign with your password and a code from your authenticator app (set up the app under Security first).';
  return `This contract needs a ${LEVEL_LABEL[required.level].toLowerCase()} (${required.level}) but this signature is ${achieved}. ${how} ${required.detail}.`;
}

// ------------------------------------------------------------------ what was signed
/** The text and terms a signature covers, in a fixed order, so the same contract always gives the same hash. */
export async function contentDigest(tx: Tx, c: typeof contract.$inferSelect): Promise<string> {
  const clauses = await tx
    .select()
    .from(clause)
    .where(and(eq(clause.tenantId, c.tenantId), eq(clause.contractId, c.id)))
    .orderBy(asc(clause.clauseId));
  const body = {
    number: c.number,
    supplierId: c.supplierId,
    value: Number(c.value).toFixed(2),
    startDate: c.startDate,
    endDate: c.endDate,
    noticeDays: c.noticeDays,
    templateId: c.templateId,
    clauses: clauses.map((x) => ({ id: x.clauseId, title: x.title, text: x.text })),
  };
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

export function userAgentClass(ua: string | undefined): string {
  if (!ua) return 'UNKNOWN';
  if (/esign-provider-callback|node|undici|curl|python|postman/i.test(ua)) return 'SERVICE';
  if (/mobile|android|iphone|ipad/i.test(ua)) return 'BROWSER_MOBILE';
  if (/mozilla|chrome|safari|firefox|edg/i.test(ua)) return 'BROWSER_DESKTOP';
  return 'OTHER';
}

// ------------------------------------------------------------------ proof that a provider ceremony really happened
// The sign route accepts "this came from a provider ceremony" only with a proof only this process can make. Both server-side
// paths that sign for a provider (the ceremony page and the callback processor) add it; a caller cannot.
const PROCESS_KEY = randomBytes(32);
export const PROOF_HEADER = 'x-if-esign-proof';
export const PROVIDER_HEADER = 'x-if-esign-provider';
export const proofFor = (contractId: string, userId: string, provider: string): string =>
  createHmac('sha256', PROCESS_KEY).update(`${contractId}|${userId}|${provider}`).digest('hex');
export function proofValid(contractId: string, userId: string, provider: string, given: unknown): boolean {
  if (typeof given !== 'string') return false;
  const want = Buffer.from(proofFor(contractId, userId, provider));
  const got = Buffer.from(given);
  return want.length === got.length && timingSafeEqual(want, got);
}

// ------------------------------------------------------------------ re-entering the password and the authenticator code
export async function verifyReauth(
  database: Database,
  sessionSecret: string,
  clock: Clock,
  userId: string,
  input: { method: 'PASSWORD' | 'PASSWORD_MFA'; password?: string | undefined; mfaCode?: string | undefined },
): Promise<void> {
  const fail = (message: string) => new AppError(403, 'SIGNATURE_REAUTH_FAILED', message);
  if (!input.password) throw fail('Enter your password to sign at this level');
  const found = await withSystem(database, async (tx) => {
    const [u] = await tx.select().from(appUser).where(eq(appUser.id, userId));
    const [m] = await tx.select().from(userMfa).where(eq(userMfa.userId, userId));
    return { u, m };
  });
  const ok = found.u ? await argon2Verify(found.u.passwordHash, input.password).catch(() => false) : false;
  if (!ok) throw fail('The password is not right');
  if (input.method === 'PASSWORD') return;
  if (!found.m?.confirmed)
    throw fail(
      'An advanced signature needs an authenticator app. Set one up under Security, then sign again with its code.',
    );
  if (!input.mfaCode) throw fail('Enter the 6-digit code from your authenticator app');
  const step = verifyTotp(
    openSecret(found.m.secret, sessionSecret),
    input.mfaCode,
    clock.now(),
    found.m.lastStep,
  );
  if (step === null) throw fail('That code is not right, or it has already been used');
  await withSystem(database, (tx) =>
    tx.update(userMfa).set({ lastStep: step }).where(eq(userMfa.userId, userId)),
  );
}

// ------------------------------------------------------------------ storage
export async function loadPolicy(tx: Tx, tenantId: string, contractId: string) {
  const [p] = await tx
    .select()
    .from(contractSignaturePolicy)
    .where(
      and(eq(contractSignaturePolicy.tenantId, tenantId), eq(contractSignaturePolicy.contractId, contractId)),
    );
  return p ?? null;
}

export interface EvidenceInput {
  tenantId: string;
  contractId: string;
  approvalId: string;
  signerId: string;
  signerRole: string;
  method: SignatureMethod;
  level: SignatureLevel;
  requiredLevel: SignatureLevel;
  provider: string | null;
  docHash: string;
  ip: string | undefined;
  userAgent: string | undefined;
  at: Date;
}

export async function recordEvidence(tx: Tx, i: EvidenceInput): Promise<void> {
  await tx.insert(signatureEvidence).values({
    tenantId: i.tenantId,
    contractId: i.contractId,
    approvalId: i.approvalId,
    signerId: i.signerId,
    signerRole: i.signerRole,
    method: i.method,
    level: i.level,
    requiredLevel: i.requiredLevel,
    provider: i.provider,
    docHash: i.docHash,
    ip: i.ip ?? null,
    userAgentClass: userAgentClass(i.userAgent),
    signedAt: i.at,
  });
}

/** A short form of the hash for the printed stamp. */
export const shortHash = (h: string) => h.slice(0, 12);
