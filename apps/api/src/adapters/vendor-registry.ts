/**
 * SWAP POINT (docs/swap-points.md): the vendor register used by the pre-flight check before signature (FR-0415) and the
 * counterparty re-check after a long negotiation (FR-0440). The simulated register answers from the platform's own
 * synthetic data: every supplier with an ABN is "registered" under the name it gave, with a few synthetic exceptions
 * so the failure paths can be shown. A real adapter calls the business register, the tax authority and a financial
 * risk provider.
 */
export interface RegistryRecord {
  abn: string;
  registeredName: string;
  gstRegistered: boolean;
}
export interface RiskReading {
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  reason: string;
}
export interface VendorRegistry {
  lookup(abn: string, claimedName: string): Promise<RegistryRecord | null>;
  /** A financial risk reading for the counterparty (simulated). */
  financialRisk(abn: string, name: string): Promise<RiskReading>;
}

/** Names containing these words are "deregistered" in the simulation; an ABN of all zeros is "not found". */
const DEREGISTERED = /\b(dissolved|deregistered|insolvent)\b/i;
const DISTRESSED = /\b(distressed|administration|liquidation)\b/i;

export class MockVendorRegistry implements VendorRegistry {
  async lookup(abn: string, claimedName: string): Promise<RegistryRecord | null> {
    const digits = abn.replace(/\s/g, '');
    if (!/^\d{11}$/.test(digits) || /^0+$/.test(digits)) return null;
    if (DEREGISTERED.test(claimedName)) return null;
    return { abn: digits, registeredName: claimedName, gstRegistered: !digits.endsWith('9') };
  }
  async financialRisk(_abn: string, name: string): Promise<RiskReading> {
    if (DISTRESSED.test(name))
      return { level: 'HIGH', reason: 'The register shows the company in administration' };
    return { level: 'LOW', reason: 'No adverse financial indicators in the register' };
  }
}
