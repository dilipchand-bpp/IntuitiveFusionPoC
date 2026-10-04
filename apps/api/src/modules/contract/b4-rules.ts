/**
 * Pure rules for roadmap batch B4 (contract award and legal): the tender cross-check, the vendor pre-flight, the
 * negotiation lock, signing order, protected clauses, time-bound access, and the (simulated) risk summary, deviation
 * explanation and negotiation strategy. No database in here.
 */
import type { RegistryRecord } from '../../adapters/vendor-registry.js';

const aud = (v: number) => `AUD ${Math.round(v).toLocaleString('en-AU')}`;
const DAY = 86_400_000;

export interface CheckResult {
  key: string;
  label: string;
  result: 'PASS' | 'WARN' | 'FAIL';
  detail: string;
}

// ---------------------------------------------------------------- tender cross-check (FR-0405)
export interface TenderFacts {
  contractValue: number;
  contractMonths: number | null;
  tenderedTco: number | null;
  estimatedValue: number | null;
  requestMonths: number | null;
  openNegotiations: string[]; // clauses the supplier proposed to change that are still to be negotiated
}
export function tenderConsistency(f: TenderFacts): CheckResult[] {
  const out: CheckResult[] = [];
  if (f.tenderedTco === null)
    out.push({
      key: 'PRICE',
      label: 'Price against the tender',
      result: 'WARN',
      detail:
        'No total cost was recorded with the winning response, so the contract value cannot be checked against it',
    });
  else {
    const gap = Math.abs(f.contractValue - f.tenderedTco) / Math.max(f.tenderedTco, 1);
    out.push({
      key: 'PRICE',
      label: 'Price against the tender',
      result: gap > 0.1 ? 'FAIL' : gap > 0.02 ? 'WARN' : 'PASS',
      detail:
        gap > 0.02
          ? `The contract value ${aud(f.contractValue)} differs from the tendered total cost ${aud(f.tenderedTco)} by ${(gap * 100).toFixed(1)}%`
          : `The contract value matches the tendered total cost ${aud(f.tenderedTco)}`,
    });
  }
  if (f.estimatedValue !== null && f.estimatedValue > 0) {
    const over = (f.contractValue - f.estimatedValue) / f.estimatedValue;
    out.push({
      key: 'ESTIMATE',
      label: 'Value against the approved estimate',
      result: over > 0.1 ? 'WARN' : 'PASS',
      detail:
        over > 0.1
          ? `The contract value is ${(over * 100).toFixed(0)}% above the approved estimate of ${aud(f.estimatedValue)}`
          : `The contract value is within the approved estimate of ${aud(f.estimatedValue)}`,
    });
  }
  if (f.contractMonths !== null && f.requestMonths !== null) {
    const diff = Math.abs(f.contractMonths - f.requestMonths);
    out.push({
      key: 'TERM',
      label: 'Term against the tender',
      result: diff > 1 ? 'WARN' : 'PASS',
      detail:
        diff > 1
          ? `The contract runs ${f.contractMonths} months; the tender asked for ${f.requestMonths}`
          : `The contract term of ${f.contractMonths} months matches the tender`,
    });
  }
  out.push({
    key: 'TERMS',
    label: 'Terms the supplier proposed',
    result: f.openNegotiations.length ? 'WARN' : 'PASS',
    detail: f.openNegotiations.length
      ? `The supplier proposed changes to ${f.openNegotiations.join(', ')} that legal marked for negotiation: check the draft reflects the outcome`
      : 'No proposed change from the tender is waiting to be negotiated',
  });
  return out;
}

// ---------------------------------------------------------------- vendor pre-flight (FR-0415)
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b(pty|ltd|limited|proprietary|inc|llc)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export function vendorPreflight(i: {
  company: string;
  abn: string;
  registry: RegistryRecord | null;
  bank: { bsb?: string; account?: string; accountName?: string } | null;
  requireBank: boolean;
}): CheckResult[] {
  const out: CheckResult[] = [];
  out.push(
    !i.registry
      ? {
          key: 'LEGAL_NAME',
          label: 'Legal name and registration',
          result: 'FAIL',
          detail: `No current registration was found for ABN ${i.abn}`,
        }
      : norm(i.registry.registeredName) !== norm(i.company)
        ? {
            key: 'LEGAL_NAME',
            label: 'Legal name and registration',
            result: 'FAIL',
            detail: `The register names "${i.registry.registeredName}", not "${i.company}"`,
          }
        : {
            key: 'LEGAL_NAME',
            label: 'Legal name and registration',
            result: 'PASS',
            detail: `Registered as "${i.registry.registeredName}"`,
          },
  );
  out.push(
    !i.registry
      ? {
          key: 'TAX',
          label: 'Tax registration',
          result: 'FAIL',
          detail: 'Tax registration cannot be confirmed without a registration',
        }
      : i.registry.gstRegistered
        ? { key: 'TAX', label: 'Tax registration', result: 'PASS', detail: 'Registered for GST' }
        : {
            key: 'TAX',
            label: 'Tax registration',
            result: 'WARN',
            detail: 'Not registered for GST: confirm how tax is handled on invoices',
          },
  );
  const b = i.bank;
  if (!b || !b.bsb)
    out.push({
      key: 'BANK',
      label: 'Banking details',
      result: i.requireBank ? 'FAIL' : 'WARN',
      detail: 'No banking details are recorded for this supplier',
    });
  else if (!/^\d{3}-?\d{3}$/.test(b.bsb) || !/^\d{6,10}$/.test(b.account ?? ''))
    out.push({
      key: 'BANK',
      label: 'Banking details',
      result: 'FAIL',
      detail: 'The BSB or account number is not in a valid format',
    });
  else if (norm(b.accountName ?? '') !== norm(i.company))
    out.push({
      key: 'BANK',
      label: 'Banking details',
      result: 'FAIL',
      detail: `The account is in the name of "${b.accountName}", not "${i.company}"`,
    });
  else
    out.push({
      key: 'BANK',
      label: 'Banking details',
      result: 'PASS',
      detail: 'The account name matches the legal name',
    });
  return out;
}

// ---------------------------------------------------------------- negotiation beyond the limit (FR-0440)
/** Signature blocks lock when a negotiation has run past the limit, until the counterparty checks have been run again. */
export function negotiationLock(i: { startedAt: Date; recheckedAt: Date | null; now: Date; days: number }) {
  const since = i.recheckedAt && i.recheckedAt > i.startedAt ? i.recheckedAt : i.startedAt;
  const lockAt = new Date(since.getTime() + i.days * DAY);
  return {
    locked: i.now >= lockAt,
    lockAt,
    daysOpen: Math.floor((i.now.getTime() - i.startedAt.getTime()) / DAY),
  };
}

// ---------------------------------------------------------------- signing order (FR-0425)
export interface ChainSlot {
  role: string;
  signedBy: string | null;
}
/** In staged signing a slot opens only when every earlier slot is signed. */
export function stagedBlocker(chain: ChainSlot[], role: string): string | null {
  const i = chain.findIndex((s) => s.role === role);
  const earlier = chain.slice(0, Math.max(i, 0)).find((s) => !s.signedBy);
  return earlier ? `Signatures are collected in order: the ${earlier.role.toLowerCase()} signs first` : null;
}

// ---------------------------------------------------------------- time-bound access (FR-0435)
export interface GrantLike {
  expiresOn: string | null;
  event: 'CONTRACT_SIGNED' | 'REPORT_APPROVED' | null;
  eventDays: number;
  revokedAt: Date | null;
}
/** A grant ends at its date, or the given number of days after its event, whichever comes first. */
export function grantStatus(
  g: GrantLike,
  now: Date,
  eventAt: Date | null,
): { live: boolean; endsAt: Date | null; reason: string | null } {
  if (g.revokedAt) return { live: false, endsAt: g.revokedAt, reason: 'REVOKED' };
  const ends: Date[] = [];
  if (g.expiresOn) ends.push(new Date(`${g.expiresOn}T23:59:59Z`));
  if (g.event && eventAt) ends.push(new Date(eventAt.getTime() + g.eventDays * DAY));
  const endsAt = ends.length ? new Date(Math.min(...ends.map((d) => d.getTime()))) : null;
  if (endsAt && now > endsAt)
    return {
      live: false,
      endsAt,
      reason:
        g.event && eventAt && endsAt.getTime() === eventAt.getTime() + g.eventDays * DAY ? 'EVENT' : 'DATE',
    };
  return { live: true, endsAt, reason: null };
}

// ---------------------------------------------------------------- protected clauses (FR-0400)
export const isProtected = (clauseId: string, list: readonly string[]) =>
  list.some((p) => p.toLowerCase() === clauseId.toLowerCase());

// ---------------------------------------------------------------- simulated advisers (FR-0450, FR-0475, FR-0485)
export interface RiskInputs {
  title: string;
  value: number;
  months: number | null;
  signingLimit: number | null;
  deviations: Array<{ title: string; risk: string; decision: string | null; protected: boolean }>;
  checks: Array<{ label: string; result: string; detail: string }>;
  supplier: { insuranceStatus: string; sanctionsStatus: string };
  openQuestions: number;
}
export interface RiskSummary {
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  headline: string;
  points: string[];
  model: 'rules-simulated-v1';
}
export function buildRiskSummary(i: RiskInputs): RiskSummary {
  const points: string[] = [];
  let score = 0;
  const open = i.deviations.filter((d) => d.decision !== 'APPROVED');
  for (const d of i.deviations)
    points.push(
      `${d.title}: changed from the template (${d.risk.toLowerCase()} risk${d.protected ? ', non-negotiable clause' : ''}), ${d.decision === 'APPROVED' ? 'approved' : d.decision === 'REJECTED' ? 'rejected' : 'not yet decided'}.`,
    );
  score += open.filter((d) => d.risk === 'HIGH' || d.protected).length * 2 + open.length;
  for (const c of i.checks.filter((x) => x.result === 'FAIL' || x.result === 'WARN')) {
    points.push(`${c.label}: ${c.detail}.`);
    score += c.result === 'FAIL' ? 2 : 1;
  }
  if (i.supplier.insuranceStatus !== 'CURRENT' && i.supplier.insuranceStatus !== 'EXPIRING') {
    points.push(`The supplier's insurance is ${i.supplier.insuranceStatus.toLowerCase()}.`);
    score += 1;
  }
  if (i.supplier.sanctionsStatus !== 'CLEAR') {
    points.push(`Sanctions screening is ${i.supplier.sanctionsStatus.toLowerCase()}.`);
    score += 2;
  }
  if (i.openQuestions > 0)
    points.push(`${i.openQuestions} question(s) about the contract are still unanswered.`);
  if (i.signingLimit !== null && i.value > i.signingLimit * 0.9)
    points.push(`The value ${aud(i.value)} is close to the signing limit of ${aud(i.signingLimit)}.`);
  if (points.length === 0)
    points.push(
      'No risk stands out: no clause was changed, every check passed and the supplier is in good standing.',
    );
  const level = score >= 5 ? 'HIGH' : score >= 2 ? 'MEDIUM' : 'LOW';
  return {
    level,
    headline: `${level === 'HIGH' ? 'High' : level === 'MEDIUM' ? 'Moderate' : 'Low'} risk to sign ${i.title}${i.months ? ` (${i.months} months, ${aud(i.value)})` : ` (${aud(i.value)})`}`,
    points,
    model: 'rules-simulated-v1',
  };
}

export interface KnowledgeHit {
  kind: string;
  title: string;
  body: string;
}
export function explainDeviation(i: {
  title: string;
  mandatory: boolean;
  protectedClause: boolean;
  risk: string;
  templateText: string;
  currentText: string;
  knowledge: KnowledgeHit[];
}): {
  summary: string;
  whatChanged: string;
  whyItMatters: string[];
  suggestion: string;
  basedOn: string[];
  model: 'rules-simulated-v1';
} {
  const t = i.templateText.trim();
  const c = i.currentText.trim();
  const shorter = t.length > 0 && c.length < t.length * 0.7;
  const longer = c.length > t.length * 1.3;
  const whatChanged = shorter
    ? `The clause is about ${Math.round((1 - c.length / Math.max(t.length, 1)) * 100)}% shorter than the standard wording, so protections may have been dropped.`
    : longer
      ? 'The clause adds wording beyond the standard text.'
      : 'The wording was changed but its length is about the same as the standard text.';
  const why: string[] = [];
  if (i.protectedClause)
    why.push('This is a non-negotiable clause: any change needs General Counsel or the risk delegate.');
  else if (i.mandatory) why.push('This is a mandatory clause, so a change needs a delegate’s decision.');
  if (/\b(unlimited|uncapped)\b/i.test(c))
    why.push('The wording removes a limit, which exposes the organisation to open-ended cost.');
  if (/\b(waive[sd]?|waiver|disclaim\w*|no liability|not liable)\b/i.test(c))
    why.push('The wording gives up a right or limits the supplier’s responsibility.');
  if (/\bindemnif\w+/i.test(c))
    why.push('The wording touches indemnities, which move financial risk between the parties.');
  if (why.length === 0)
    why.push(
      'Nothing in the wording looks unusual, so the risk is mainly that it differs from the template.',
    );
  const fallback = i.knowledge.find((k) => k.kind === 'FALLBACK');
  return {
    summary: `${i.title}: rated ${i.risk.toLowerCase()} risk.`,
    whatChanged,
    whyItMatters: why,
    suggestion: fallback
      ? `The corporate fallback position is: ${fallback.body}`
      : i.risk === 'LOW'
        ? 'Acceptable if the business is comfortable; record the decision.'
        : 'Ask for the standard wording, or a fallback that keeps the protection, before accepting.',
    basedOn: i.knowledge.map((k) => `${k.kind.toLowerCase()}: ${k.title}`),
    model: 'rules-simulated-v1',
  };
}

export interface StrategyInputs {
  category: string | null;
  tenderType: string;
  value: number;
  tenderedTco: number | null;
  estimate: number | null;
  competitorTcos: number[];
  deviations: string[];
  knowledge: KnowledgeHit[];
}
export function buildStrategy(i: StrategyInputs) {
  const best = i.tenderedTco ?? i.value;
  const lowestRival = i.competitorTcos.length ? Math.min(...i.competitorTcos) : null;
  const round = (v: number) => Math.round(v / 100) * 100;
  const frame =
    i.tenderType === 'RFT'
      ? 'Frame this as confirming a competitive, fixed-scope offer: the price and scope are tendered, so the discussion is about delivery risk and terms, not reopening the scope.'
      : 'Frame this as a partnership discussion: the supplier won on quality, so open with shared outcomes before price and terms.';
  const techniques = [
    'Anchor on the tendered total cost and the value-for-money case from the evaluation report.',
    lowestRival !== null && lowestRival < best
      ? `Use the competitive tension: a rival bid was ${aud(lowestRival)} total cost.`
      : 'Trade, do not concede: give a concession only against one in return.',
    i.deviations.length
      ? `Resolve the supplier’s proposed changes (${i.deviations.slice(0, 3).join(', ')}) as a package rather than clause by clause.`
      : 'Hold the standard wording and invite the supplier to name any clause they cannot accept.',
  ];
  return {
    model: 'rules-simulated-v1' as const,
    category: i.category,
    framing: frame,
    techniques,
    positions: [
      {
        level: 'Minimum expected result',
        price: round(best),
        note: 'The tendered price and the standard terms, with no deterioration.',
      },
      {
        level: 'Expected outcome',
        price: round(best * 0.97),
        note: 'About 3% off through payment terms or a volume commitment.',
      },
      {
        level: 'Very good outcome',
        price: round(best * 0.93),
        note: 'About 7% off, or the same price with a longer warranty and stronger service credits.',
      },
      {
        level: 'Stretch target',
        price: round(lowestRival !== null ? Math.min(best * 0.88, lowestRival) : best * 0.88),
        note: 'About 12% off, matching the best rival bid, in return for a longer term.',
      },
    ],
    levers: [
      {
        lever: 'Price',
        suggestion:
          'Ask for a discount for early payment (for example 2% at 14 days) before asking for a lower headline price.',
      },
      {
        lever: 'Payment terms',
        suggestion: 'Keep 30-day terms, and tie 10% to acceptance of the transition.',
      },
      {
        lever: 'Limitation of liability',
        suggestion: 'Hold the cap at the higher of the annual fee and the required insurance cover.',
      },
      {
        lever: 'Indemnities',
        suggestion:
          'Keep indemnities for personal injury, property damage and intellectual property infringement uncapped.',
      },
    ],
    basedOn: i.knowledge.map((k) => `${k.kind.toLowerCase()}: ${k.title}`),
    estimate: i.estimate,
  };
}

/** The knowledge entries that share a word with the text, most relevant first. */
export function relevantKnowledge<
  T extends { title: string; body: string; tags: string; clauseId: string | null },
>(items: readonly T[], text: string, clauseId?: string): T[] {
  const words = new Set(
    text
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length >= 5),
  );
  return items
    .map((k) => {
      const hay = `${k.title} ${k.tags}`
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter((w) => w.length >= 4);
      const n = hay.filter((w) => words.has(w)).length + (clauseId && k.clauseId === clauseId ? 3 : 0);
      return { k, n };
    })
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .map((x) => x.k);
}
