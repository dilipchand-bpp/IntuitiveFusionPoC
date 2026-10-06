/**
 * Simulated verification providers (NFR-C05). SWAP POINT (docs/swap-points.md): each class is what a real adapter replaces
 * (a watchlist screening service, an insurer verification service). They are deterministic from the supplier's name and
 * ABN, so a demonstration and a test always give the same answer. Whether the provider is "up" is not decided here: that is
 * the connector's mode and the circuit breaker, applied by `callProvider`.
 */
import { createHash } from 'node:crypto';
import { MockSanctionsScreening, type ScreeningResult } from '../../adapters/sanctions.js';

export const UNVERIFIED_LABEL = 'UNVERIFIED (provider unavailable)';

export class SimulatedSanctionsProvider extends MockSanctionsScreening {
  override async screen(input: { company: string; abn: string }): Promise<ScreeningResult> {
    const base = await super.screen(input);
    if (base.status === 'MATCH') return base;
    if (/\bsanctioned\b/i.test(input.company))
      return {
        status: 'MATCH',
        list: 'SYNTHETIC-WATCHLIST-S',
        reason: 'The company name matches an entry on SYNTHETIC-WATCHLIST-S',
      };
    return { status: 'CLEAR' };
  }
}

export interface InsuranceReading {
  status: 'VERIFIED' | 'EXPIRED' | 'NOT_FOUND';
  coverAud: number | null;
  reason: string;
}
export interface InsuranceVerification {
  readonly simulated: boolean;
  verify(input: { company: string; abn: string }): Promise<InsuranceReading>;
}

export class SimulatedInsuranceProvider implements InsuranceVerification {
  readonly simulated = true;
  async verify(input: { company: string; abn: string }): Promise<InsuranceReading> {
    if (/\buninsured\b/i.test(input.company))
      return { status: 'NOT_FOUND', coverAud: null, reason: 'The insurer holds no policy for this company' };
    if (/\b(lapsed|expired)\b/i.test(input.company))
      return { status: 'EXPIRED', coverAud: null, reason: 'The insurer shows the policy has lapsed' };
    // cover is a repeatable number from the ABN: 5, 10, 15 or 20 million
    const n = parseInt(createHash('sha256').update(input.abn).digest('hex').slice(0, 4), 16) % 4;
    const cover = (n + 1) * 5_000_000;
    return {
      status: 'VERIFIED',
      coverAud: cover,
      reason: `The insurer confirms a current policy with cover of ${cover}`,
    };
  }
}
