/**
 * Deterministic plan drafting for the SIMULATED assistant (FR-0075). Everything is derived from what the requester
 * already said; nothing is invented that the request does not support. A real model replaces this behind AiProvider.
 */
import { CATEGORIES } from '../intake/extract.js';
import type { FieldMap } from '../intake/fields.js';
import { joinParagraphs } from './fields.js';

export interface PlanDraftInput {
  values: FieldMap;
  complexity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  gateKeys: readonly string[];
  /** Plan creation date; milestones are laid out from here. */
  today: Date;
}

const aud = (v: string | undefined) =>
  v ? `AUD ${Number(v).toLocaleString('en-AU')}` : 'an amount to be confirmed';
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const fmt = (d: Date) =>
  d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

const REQUIREMENTS: Record<string, string[]> = {
  'Building cleaning': [
    'Cleaning of all nominated sites to the agreed schedule and standard, including washrooms, kitchens and common areas.',
    'Compliance with work health and safety obligations, including induction, equipment and chemical safety.',
    'Use of environmentally responsible products and waste practices.',
  ],
  'IT managed services': [
    'Service desk, infrastructure and application support to defined availability and response targets.',
    'Information security controls aligned to the organisation’s policy, with incident notification and audit rights.',
    'Data to remain within approved Australian regions; transition-in and transition-out assistance.',
  ],
  'Security services': [
    'Provision of licensed guards to the agreed roster, with patrol and incident reporting.',
    'Compliance with licensing, training and work health and safety requirements.',
  ],
  Landscaping: [
    'Regular maintenance of grounds, gardens and hard landscaping at the nominated sites.',
    'Seasonal programme, waste removal and safe use of equipment.',
  ],
  Catering: [
    'Supply of catering to agreed menus and quantities, meeting dietary and food-safety requirements.',
  ],
};

export function draftPlan(i: PlanDraftInput): Record<string, string> {
  const v = i.values;
  const rule = CATEGORIES.find((c) => v.category?.startsWith(c.category));
  const what = (rule?.category ?? v.category ?? 'the requested goods or services').toLowerCase();
  const term = v.termMonths ? `${v.termMonths} months` : 'a term to be confirmed';
  const t0 = i.today;
  const high = i.complexity === 'HIGH' || i.complexity === 'CRITICAL';
  const approver =
    Number(v.estimatedValue ?? 0) >= 250_000
      ? 'Executive (sourcing authority above AUD 250,000)'
      : 'Delegate (sourcing authority up to AUD 250,000)';

  const risks = [
    `Supplier concentration. Level: ${high ? 'High' : 'Medium'}. Mitigation: invite several qualified suppliers and test market depth before release.`,
    `Transition and service continuity. Level: ${high ? 'High' : 'Medium'}. Mitigation: require a transition plan and run overlap with the incumbent.`,
    ...(i.gateKeys.includes('IT_ENDORSEMENT') || v.dataSensitivity === 'SENSITIVE'
      ? [
          'Information security and data handling. Level: High. Mitigation: security questionnaire, contractual controls and audit rights.',
        ]
      : []),
    ...(v.supplyLocation === 'OFFSHORE'
      ? [
          'Offshore supply and data residency. Level: High. Mitigation: restrict data to approved regions and require onshore support.',
        ]
      : []),
    ...(v.risk ? [v.risk] : []),
  ];

  return {
    background: joinParagraphs([
      v.background ?? `A compliant market approach is required for ${what}.`,
      `The estimated value is ${aud(v.estimatedValue)} over ${term}, owned by ${v.businessUnit ?? 'the requesting business unit'} (contract owner: ${v.contractOwner ?? 'to be confirmed'}).`,
      `Complexity has been assessed as ${i.complexity.toLowerCase()}, which determines the governance steps in this plan.`,
    ]),
    objectives: joinParagraphs([
      `Secure ${what} that meets the requirements below at best value for money over the full term.`,
      'Run a fair, transparent and auditable process with conflicts of interest declared before evaluation begins.',
      'Reach a contract that can be managed from day one, with obligations, milestones and renewal dates captured.',
    ]),
    requirements: joinParagraphs(
      REQUIREMENTS[rule?.category ?? ''] ?? [
        `Delivery of ${what} to agreed service levels across all sites.`,
        'Compliance with applicable legislation, policy and probity requirements.',
      ],
    ),
    deliverables: joinParagraphs([
      v.deliverables ?? `Delivery of ${what} to agreed service levels, with monthly performance reporting.`,
      'Transition-in plan, named account manager and a continuous-improvement report each quarter.',
    ]),
    milestones: joinParagraphs([
      `Plan approved: ${fmt(addDays(t0, 7))}`,
      `Tender released to market: ${fmt(addDays(t0, 14))}`,
      `Tender closes: ${fmt(addDays(t0, 42))}`,
      `Evaluation complete and report approved: ${fmt(addDays(t0, 63))}`,
      `Contract signed: ${fmt(addDays(t0, 90))}`,
    ]),
    risks: joinParagraphs(risks),
    evaluationCommittee: joinParagraphs([
      'Chair: procurement team lead (to be nominated).',
      'Technical evaluator and commercial evaluator, each from outside the procurement team; the technical evaluator does not see pricing.',
      'A probity advisor observes and has read-only access. Every member declares any conflict of interest before seeing supplier identities.',
    ]),
    steeringCommittee: high
      ? joinParagraphs([
          'Executive sponsor (chair), contract owner, procurement lead and risk and compliance representative.',
          'Meets at plan approval, shortlist and award.',
        ])
      : 'Not required for a procurement at this complexity.',
    approvalDelegate: `${approver}. Approval is recorded with a stamp and locks the plan.`,
    consultations: joinParagraphs([
      ...(i.gateKeys.includes('IT_ENDORSEMENT')
        ? ['IT department endorsement of the technical approach.']
        : []),
      ...(i.gateKeys.includes('LEGAL_REVIEW')
        ? ['Legal review of the contract approach and template selection.']
        : []),
      ...(i.gateKeys.includes('RISK_SIGNOFF')
        ? ['Independent risk-officer sign-off before the plan can be approved.']
        : []),
      ...(i.gateKeys.length === 0 ? ['No additional consultation is required.'] : []),
    ]),
    dueDiligence: joinParagraphs([
      'Financial viability assessment of shortlisted suppliers.',
      'Reference checks with at least two comparable clients.',
      'Sanctions screening and verification of current insurance certificates.',
    ]),
    timeline: `Approval ${fmt(addDays(t0, 7))}; market release ${fmt(addDays(t0, 14))}; award ${fmt(addDays(t0, 63))}; contract start ${fmt(addDays(t0, 90))}. Dates move together if any one changes.`,
  };
}
