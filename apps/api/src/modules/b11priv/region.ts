/**
 * NFR-R02 (the customer elects a hosting country) and SEC-D09 (cross-border controls): the region policy.
 *
 * The tenant's `residency` setting holds the elected country, an explicit list of other allowed regions, and the
 * regions nominated for AI processing and for logs. A transfer to a target region that is neither the elected country
 * nor on the allow-list is refused with RESIDENCY_VIOLATION naming the purpose and the region.
 *
 * Region codes are countries or regions: AU, NZ, UK, EU, US, CA, SG, JP. Every simulated connector provider and AI model
 * declares where it is "hosted" (catalogue.ts, models.ts); nothing here knows about a real cloud region.
 */
import type { Settings } from '../settings/settings.js';
import { OutboundRefusal } from './egress.js';

export type Residency = Settings['residency'];

/** What a transfer is for. The label is what the refusal message and the page show. */
export const PURPOSES = {
  CONNECTOR: 'connector',
  AI_MODEL: 'AI model',
  AI_CONVERSATION_STORE: 'AI conversation storage',
  EXTERNAL_SEARCH: 'outside search',
  EMAIL_SMS: 'email and SMS gateway',
  REPOSITORY: 'document repository',
  ESIGNATURE: 'e-signature',
  LEGAL_WEBHOOK: 'legal platform',
  LOG_EXPORT: 'log and audit export',
  STORAGE: 'storage',
} as const;
export type Purpose = keyof typeof PURPOSES;

/** The purpose for a connector kind (b10conn catalogue kinds). */
export function purposeForKind(kind: string): Purpose {
  switch (kind) {
    case 'ESIGN':
      return 'ESIGNATURE';
    case 'DOCREPO':
      return 'REPOSITORY';
    case 'MESSAGING':
      return 'EMAIL_SMS';
    case 'LEGAL':
      return 'LEGAL_WEBHOOK';
    case 'AI':
      return 'AI_MODEL';
    default:
      return 'CONNECTOR';
  }
}

/** The regions a transfer may go to: the elected country and everything explicitly allowed. */
export const allowedRegions = (r: Residency): string[] => [
  r.country,
  ...r.allowedRegions.filter((x) => x !== r.country),
];

export const regionAllowed = (r: Residency, region: string): boolean =>
  allowedRegions(r).includes(region.toUpperCase());

export interface RegionDecision {
  allowed: boolean;
  region: string;
  reason: string | null;
}

export function regionDecision(r: Residency, purpose: Purpose, region: string): RegionDecision {
  const code = region.toUpperCase();
  if (regionAllowed(r, code)) return { allowed: true, region: code, reason: null };
  return {
    allowed: false,
    region: code,
    reason: `Transfer refused (${PURPOSES[purpose]} to ${code}): the elected hosting country is ${r.country}${
      r.allowedRegions.length
        ? ` and the allowed regions are ${r.allowedRegions.join(', ')}`
        : ' and no other region is allowed'
    }`,
  };
}

/** Throws RESIDENCY_VIOLATION unless the region is allowed. The pure form: no database, no audit (see outbound.ts for those). */
export function assertRegion(r: Residency, purpose: Purpose, region: string, target = region): void {
  const d = regionDecision(r, purpose, region);
  if (!d.allowed)
    throw new OutboundRefusal('RESIDENCY_VIOLATION', d.reason!, {
      kind: 'RESIDENCY',
      purpose,
      target,
      region: d.region,
    });
}
