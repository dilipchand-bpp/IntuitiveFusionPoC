/**
 * Supplier sanctions screening and insurance verification through the resilient API layer (NFR-C05). When the provider is
 * down (connector mode DOWN, a timeout, or an open circuit breaker) the answer is UNVERIFIED, shown as
 * "UNVERIFIED (provider unavailable)". A supplier is never reported CLEAR because a check could not be made.
 */
import { eq } from 'drizzle-orm';
import type { Clock } from '@if/shared';
import type { SanctionsScreening, ScreeningInput, ScreeningResult } from '../../adapters/sanctions.js';
import { withSystem, type Database, type Tx } from '../../db/client.js';
import { tenant } from '../../db/schema.js';
import {
  SimulatedInsuranceProvider,
  SimulatedSanctionsProvider,
  UNVERIFIED_LABEL,
  type InsuranceReading,
  type InsuranceVerification,
} from './providers.js';
import { callProvider, type CallOutcome } from './resilience.js';

export const sanctionsVia = async (
  tx: Tx,
  clock: Clock,
  tenantId: string,
  input: { company: string; abn: string },
  provider: SanctionsScreening,
): Promise<{ result: ScreeningResult; outcome: CallOutcome<ScreeningResult> }> => {
  const outcome = await callProvider(tx, { clock }, tenantId, 'SANCTIONS', () => provider.screen(input), {
    fallback: (): ScreeningResult => ({ status: 'UNVERIFIED', reason: UNVERIFIED_LABEL }),
  });
  const result: ScreeningResult = outcome.ok
    ? outcome.value
    : { status: 'UNVERIFIED', reason: `${UNVERIFIED_LABEL}: ${outcome.error}` };
  return { result, outcome };
};

export interface InsuranceResult {
  state: 'VERIFIED' | 'EXPIRED' | 'NOT_FOUND' | 'UNVERIFIED';
  coverAud: number | null;
  note: string;
}
export const insuranceVia = async (
  tx: Tx,
  clock: Clock,
  tenantId: string,
  input: { company: string; abn: string },
  provider: InsuranceVerification = new SimulatedInsuranceProvider(),
): Promise<{ result: InsuranceResult; outcome: CallOutcome<InsuranceReading | null> }> => {
  const outcome = await callProvider<InsuranceReading | null>(
    tx,
    { clock },
    tenantId,
    'INSURANCE',
    () => provider.verify(input),
    { fallback: () => null },
  );
  const result: InsuranceResult =
    outcome.ok && outcome.value
      ? { state: outcome.value.status, coverAud: outcome.value.coverAud, note: outcome.value.reason }
      : {
          state: 'UNVERIFIED',
          coverAud: null,
          note: `${UNVERIFIED_LABEL}${outcome.ok ? '' : `: ${outcome.error}`}`,
        };
  return { result, outcome };
};

/** The sanctions screening every caller uses by default: the simulated list behind the connector's resilience. */
export class ConnectorSanctionsScreening implements SanctionsScreening {
  readonly simulated = true;
  constructor(
    private readonly database: Database,
    private readonly clock: Clock,
    private readonly defaultTenantSlug = 'meridian-demo',
    private readonly inner: SanctionsScreening = new SimulatedSanctionsProvider(),
  ) {}

  async screen(input: ScreeningInput): Promise<ScreeningResult> {
    const run = async (tx: Tx) => {
      let tenantId = input.tenantId;
      if (!tenantId) {
        const [t] = await tx
          .select({ id: tenant.id })
          .from(tenant)
          .where(eq(tenant.slug, this.defaultTenantSlug));
        tenantId = t?.id;
      }
      // an unknown organisation has no connector to consult: the plain provider answers
      if (!tenantId) return this.inner.screen({ company: input.company, abn: input.abn });
      return (await sanctionsVia(tx, this.clock, tenantId, input, this.inner)).result;
    };
    // a caller that already has a transaction must be given the same one (the database allows one at a time)
    return input.tx ? run(input.tx) : withSystem(this.database, run);
  }
}
