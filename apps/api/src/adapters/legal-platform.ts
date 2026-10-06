/**
 * Enterprise legal platform gateway (FR-0390). SWAP POINT (docs/swap-points.md): a real adapter calls the customer's legal
 * platform (for example HighQ or Icertis) to open a matter and returns its reference; this one is SIMULATED, so the whole
 * flow (raise, deliver, fail, retry, synchronise back) can be shown and tested without any outside system.
 */
import { createHash } from 'node:crypto';

export interface MatterRequest {
  matterId: string;
  title: string;
  contractNumber: string | null;
  priority: string;
}
export interface LegalPlatformGateway {
  readonly simulated: boolean;
  initiate(
    input: MatterRequest,
    opts: { platform: string; outage: boolean },
  ): Promise<{ externalRef: string }>;
}

export class SimulatedLegalPlatform implements LegalPlatformGateway {
  readonly simulated = true;
  async initiate(input: MatterRequest, opts: { platform: string; outage: boolean }) {
    if (opts.outage) throw new Error(`${opts.platform} did not respond (simulated outage)`);
    const code = createHash('sha256').update(input.matterId).digest('hex').slice(0, 6).toUpperCase();
    const prefix =
      opts.platform
        .replace(/[^A-Za-z]/g, '')
        .slice(0, 4)
        .toUpperCase() || 'LEGL';
    return { externalRef: `${prefix}-${code}` };
  }
}
