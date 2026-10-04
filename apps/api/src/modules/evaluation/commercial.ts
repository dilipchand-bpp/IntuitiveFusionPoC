/**
 * Pure commercial rules for evaluation (B3): total cost of ownership, normalisation, the ranking blend, the compliance
 * gate and the (simulated) negotiation advisor. No database in here.
 */

export interface Pricing {
  basePrice: number;
  implementation: number;
  annualRunning: number;
  years: number;
}
const cents = (v: number) => Math.round(v * 100) / 100;

/** Total cost of ownership: what the buyer pays over the whole term, not just the headline price. */
export const tcoOf = (p: Pricing): number =>
  cents(p.basePrice + p.implementation + p.annualRunning * p.years);

/** Lowest total cost scores 100; others in proportion (lowest / this x 100). Suppliers without a price get null. */
export function normaliseTco(tcos: ReadonlyMap<string, number | null>): Map<string, number | null> {
  const known = [...tcos.values()].filter((v): v is number => v !== null && v > 0);
  const lowest = known.length ? Math.min(...known) : null;
  return new Map(
    [...tcos].map(([id, v]) => [
      id,
      v === null || v <= 0 || lowest === null ? null : Math.round((lowest / v) * 10_000) / 100,
    ]),
  );
}

/** Ranking mode: quality (0-100) and normalised price (0-100) blended by the project's price weighting. */
export function blend(quality: number, priceScore: number | null, priceWeightPct: number): number {
  if (priceScore === null) return quality;
  return Math.round(quality * (100 - priceWeightPct) + priceScore * priceWeightPct) / 100;
}

/** Value for money: quality delivered per dollar relative to the cheapest compliant offer. */
export function valueForMoney(quality: number, priceScore: number | null): number | null {
  return priceScore === null ? null : Math.round(quality * priceScore) / 100;
}

// ---------------------------------------------------------------- compliance gate (FR-0265)
export interface GateInput {
  abn: string | null;
  sanctionsStatus: 'PENDING' | 'CLEAR' | 'MATCH';
  insuranceStatus: 'UNKNOWN' | 'CURRENT' | 'EXPIRING' | 'EXPIRED';
  flaggedAnswers: string[];
  fileCount: number;
  requireInsurance: boolean;
}
export interface GateResult {
  key: 'REGISTRATION' | 'DECLARATIONS' | 'INSURANCE' | 'COMPLETENESS';
  label: string;
  result: 'PASS' | 'FAIL';
  detail: string;
}
export const GATE_LABELS: Record<GateResult['key'], string> = {
  REGISTRATION: 'Entity registration and screening',
  DECLARATIONS: 'Mandatory declarations',
  INSURANCE: 'Insurance',
  COMPLETENESS: 'Response complete',
};

/** The mandatory pass or fail checks run on every bidder before scoring; each missed requirement is named. */
export function runGate(i: GateInput): GateResult[] {
  const out: GateResult[] = [];
  const add = (key: GateResult['key'], ok: boolean, pass: string, fail: string) =>
    out.push({ key, label: GATE_LABELS[key], result: ok ? 'PASS' : 'FAIL', detail: ok ? pass : fail });
  const abnOk = Boolean(i.abn && /^\d{11}$/.test(i.abn.replace(/\s/g, '')) && !/^0+$/.test(i.abn));
  add(
    'REGISTRATION',
    abnOk && i.sanctionsStatus !== 'MATCH',
    `ABN recorded and screening ${i.sanctionsStatus === 'CLEAR' ? 'clear' : 'not matched'}`,
    !abnOk ? 'No valid ABN is recorded for this supplier' : 'The supplier is on hold after a screening match',
  );
  add(
    'DECLARATIONS',
    i.flaggedAnswers.length === 0,
    'Every mandatory declaration answered acceptably',
    `Declaration(s) not satisfied: ${i.flaggedAnswers.join(', ')}`,
  );
  const insOk = i.insuranceStatus === 'CURRENT' || i.insuranceStatus === 'EXPIRING';
  add(
    'INSURANCE',
    insOk || (i.insuranceStatus === 'UNKNOWN' && !i.requireInsurance),
    insOk
      ? `Insurance ${i.insuranceStatus === 'EXPIRING' ? 'is current but expiring soon' : 'is current'}`
      : 'Insurance is not recorded (not required by this organisation)',
    i.insuranceStatus === 'EXPIRED'
      ? 'The insurance certificate has expired'
      : 'No insurance certificate is recorded',
  );
  add('COMPLETENESS', i.fileCount > 0, `${i.fileCount} file(s) submitted`, 'The response has no files');
  return out;
}

// ---------------------------------------------------------------- negotiation advisor (FR-0295)
export interface AdviceSupplier {
  supplierId: string;
  name: string;
  rank: number | null;
  score: number;
  tco: number | null;
  insuranceStatus: string;
  insuranceCover: number | null;
  deviations: Array<{ clauseRef: string; proposal: string; risk: string | null; status: string }>;
}
export interface Advice {
  supplierId: string;
  kind: 'DISCOUNT' | 'CLAUSE' | 'INSURANCE' | 'PROCESS';
  text: string;
  basis: string;
  suggestedDiscountPct?: number;
}
const aud = (v: number) => `AUD ${Math.round(v).toLocaleString('en-AU')}`;
const median = (v: number[]) => {
  const s = v.slice().sort((a, b) => a - b);
  return s.length === 0
    ? null
    : s.length % 2
      ? s[(s.length - 1) / 2]!
      : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

/**
 * Recommendations from submitted pricing and terms against the other bids and the estimate. A simulated model: fixed
 * rules, nothing leaves the server. Every recommendation says what it is based on, and a person decides.
 */
export function adviseNegotiation(suppliers: readonly AdviceSupplier[], estimate: number | null): Advice[] {
  const out: Advice[] = [];
  const live = suppliers.filter((s) => s.rank !== null).sort((a, b) => a.rank! - b.rank!);
  const priced = live.filter((s) => s.tco !== null);
  const benchmark = median(priced.map((s) => s.tco!));
  const lowest = priced.length ? Math.min(...priced.map((s) => s.tco!)) : null;
  for (const s of live) {
    if (s.tco !== null && benchmark !== null && priced.length > 1 && s.tco > benchmark * 1.02) {
      const pct = Math.min(15, Math.round(((s.tco - benchmark) / s.tco) * 200) / 2);
      out.push({
        supplierId: s.supplierId,
        kind: 'DISCOUNT',
        suggestedDiscountPct: pct,
        text: `Ask ${s.name} for a discount of about ${pct}% (to around ${aud(s.tco * (1 - pct / 100))}).`,
        basis: `Total cost ${aud(s.tco)} is above the median of the compliant bids (${aud(benchmark)}).`,
      });
    } else if (s.tco !== null && lowest !== null && s.tco === lowest && s.rank === 1) {
      out.push({
        supplierId: s.supplierId,
        kind: 'PROCESS',
        text: `${s.name} is both the highest ranked and the lowest priced: negotiate terms and service levels, not price.`,
        basis: `Total cost ${aud(s.tco)} is the lowest of ${priced.length} compliant bid(s).`,
      });
    }
    if (s.tco !== null && estimate !== null && estimate > 0 && s.tco > estimate * 1.1)
      out.push({
        supplierId: s.supplierId,
        kind: 'DISCOUNT',
        text: `${s.name} is more than 10% above the estimate: ask for a best and final offer.`,
        basis: `Total cost ${aud(s.tco)} against an estimate of ${aud(estimate)}.`,
      });
    for (const d of s.deviations.filter((x) => x.risk === 'HIGH' || x.status === 'NEGOTIATE'))
      out.push({
        supplierId: s.supplierId,
        kind: 'CLAUSE',
        text: `Negotiate clause ${d.clauseRef} with ${s.name}: they propose "${d.proposal.slice(0, 120)}".`,
        basis: `Legal rated this change ${d.risk ?? 'unrated'} risk (${d.status.toLowerCase()}).`,
      });
    if (estimate !== null && estimate > 0 && s.insuranceCover !== null && s.insuranceCover < estimate)
      out.push({
        supplierId: s.supplierId,
        kind: 'INSURANCE',
        text: `Require ${s.name} to lift liability cover to at least ${aud(estimate)}.`,
        basis: `Recorded cover ${aud(s.insuranceCover)} is below the contract value ${aud(estimate)}.`,
      });
    else if (s.insuranceStatus === 'UNKNOWN' || s.insuranceStatus === 'EXPIRED')
      out.push({
        supplierId: s.supplierId,
        kind: 'INSURANCE',
        text: `Require current evidence of insurance from ${s.name} before award.`,
        basis: `Insurance status is ${s.insuranceStatus.toLowerCase()}.`,
      });
  }
  if (live.length >= 2 && Math.abs(live[0]!.score - live[1]!.score) < 5)
    out.push({
      supplierId: live[0]!.supplierId,
      kind: 'PROCESS',
      text: `${live[0]!.name} and ${live[1]!.name} are within 5 points: run a best and final offer round between them.`,
      basis: `Scores ${live[0]!.score.toFixed(1)} and ${live[1]!.score.toFixed(1)}.`,
    });
  return out;
}
