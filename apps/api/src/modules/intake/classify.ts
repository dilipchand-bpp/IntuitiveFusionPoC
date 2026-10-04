/**
 * Pure rules that classify and route a request (FR-0015, FR-0030, FR-0090, FR-0705, FR-X02). Same inputs, same answer;
 * every result carries the reason so nothing is a black box.
 */
import type { Settings } from '../settings/settings.js';
import type { Complexity } from './complexity.js';

// ---------------------------------------------------------------- taxonomy (FR-0015)
export type Taxonomy = 'UNSPSC' | 'CPV' | 'NAICS';
interface TaxonomyRow {
  category: string;
  codes: Record<Taxonomy, { code: string; label: string }>;
}
/** A small built-in crosswalk; an organisation's own classification replaces a code at confirmation. */
export const TAXONOMY_TABLE: readonly TaxonomyRow[] = [
  {
    category: 'Building cleaning',
    codes: {
      UNSPSC: { code: '76111500', label: 'Building cleaning services' },
      CPV: { code: '90910000', label: 'Cleaning services' },
      NAICS: { code: '561720', label: 'Janitorial services' },
    },
  },
  {
    category: 'IT managed services',
    codes: {
      UNSPSC: { code: '81111800', label: 'System and network maintenance' },
      CPV: { code: '72500000', label: 'Computer-related services' },
      NAICS: { code: '541513', label: 'Computer facilities management services' },
    },
  },
  {
    category: 'Health services',
    codes: {
      UNSPSC: { code: '85100000', label: 'Comprehensive health services' },
      CPV: { code: '85100000', label: 'Health services' },
      NAICS: { code: '621999', label: 'Miscellaneous ambulatory health care' },
    },
  },
  {
    category: 'Security services',
    codes: {
      UNSPSC: { code: '92121500', label: 'Guard services' },
      CPV: { code: '79710000', label: 'Security services' },
      NAICS: { code: '561612', label: 'Security guards and patrol services' },
    },
  },
  {
    category: 'Landscaping',
    codes: {
      UNSPSC: { code: '70171700', label: 'Landscape maintenance' },
      CPV: { code: '77300000', label: 'Horticultural services' },
      NAICS: { code: '561730', label: 'Landscaping services' },
    },
  },
  {
    category: 'Paper products',
    codes: {
      UNSPSC: { code: '14111500', label: 'Printing and writing paper' },
      CPV: { code: '30197630', label: 'Printing paper' },
      NAICS: { code: '424110', label: 'Printing and writing paper wholesalers' },
    },
  },
  {
    category: 'Apparel',
    codes: {
      UNSPSC: { code: '53100000', label: 'Clothing' },
      CPV: { code: '18000000', label: 'Clothing and accessories' },
      NAICS: { code: '315990', label: 'Apparel accessories and other apparel' },
    },
  },
  {
    category: 'Catering',
    codes: {
      UNSPSC: { code: '90101500', label: 'Catering services' },
      CPV: { code: '55520000', label: 'Catering services' },
      NAICS: { code: '722320', label: 'Caterers' },
    },
  },
  {
    category: 'Professional services',
    codes: {
      UNSPSC: { code: '80101500', label: 'Business and corporate management consultation' },
      CPV: { code: '79400000', label: 'Business and management consultancy' },
      NAICS: { code: '541611', label: 'Administrative management consulting' },
    },
  },
  {
    category: 'Construction',
    codes: {
      UNSPSC: { code: '72101500', label: 'Building construction and support' },
      CPV: { code: '45000000', label: 'Construction work' },
      NAICS: { code: '236220', label: 'Commercial building construction' },
    },
  },
];

export interface TaxonomyResult {
  scheme: Taxonomy;
  code: string;
  label: string;
  category: string;
}

/** The preliminary code for a category in the tenant's scheme, or null when the category is not recognised. */
export function classifyCategory(
  category: string | null | undefined,
  scheme: Taxonomy,
): TaxonomyResult | null {
  if (!category) return null;
  const row = TAXONOMY_TABLE.find((r) => category.toLowerCase().startsWith(r.category.toLowerCase()));
  if (!row) return null;
  return { scheme, category: row.category, ...row.codes[scheme] };
}

// ---------------------------------------------------------------- required engagements (FR-0030)
export interface Engagement {
  function: 'IT' | 'LEGAL' | 'CYBER' | 'FINANCE' | 'RISK';
  ruleId: string;
  label: string;
  reason: string;
}

export interface EngagementInput {
  title?: string | undefined;
  category?: string | undefined;
  background?: string | undefined;
  dataSensitivity?: string | undefined;
  estimatedValue: number;
  complexity: Complexity;
}

/** Which secondary reviews a request needs, from the tenant's configurable rules. */
export function requiredEngagements(
  rules: Settings['intake']['engagementRules'],
  i: EngagementInput,
): Engagement[] {
  const text = `${i.title ?? ''} ${i.category ?? ''} ${i.background ?? ''}`.toLowerCase();
  const out: Engagement[] = [];
  for (const r of rules) {
    const valueOk = r.minValue === undefined || i.estimatedValue >= r.minValue;
    const hit = r.keywords.find((k) => text.includes(k));
    const sensitive =
      r.function === 'CYBER' && (i.dataSensitivity === 'SENSITIVE' || i.dataSensitivity === 'PERSONAL');
    let reason: string | null = null;
    if (r.keywords.length === 0) {
      if (r.minValue !== undefined && valueOk)
        reason = `The value is AUD ${i.estimatedValue.toLocaleString('en-AU')}, at or above AUD ${r.minValue.toLocaleString('en-AU')}.`;
    } else if (hit && valueOk) reason = `The request mentions "${hit}".`;
    else if (sensitive) reason = 'The request involves sensitive or personal data.';
    if (r.function === 'RISK' && i.complexity === 'CRITICAL' && !reason)
      reason = 'The request is rated critical.';
    if (reason) out.push({ function: r.function, ruleId: r.id, label: r.label, reason });
  }
  return out;
}

/** Who is asked to act for each function. There is no IT or cyber reviewer role yet, so those go to the named stand-ins. */
export const FUNCTION_ROLES: Record<
  Engagement['function'],
  Array<'LEGAL' | 'FINANCE' | 'PROBITY' | 'PROCUREMENT'>
> = {
  LEGAL: ['LEGAL'],
  FINANCE: ['FINANCE'],
  RISK: ['PROBITY'],
  CYBER: ['PROBITY'],
  IT: ['PROCUREMENT'],
};

// ---------------------------------------------------------------- estimated contract value (FR-0090)
export interface EcvInput {
  baseTermValue: number;
  extensionsValue: number;
  freight: number;
  implementation: number;
  /** Multiplier from the quoted currency to AUD (1 for AUD). */
  exchangeRate: number;
  /** Tax as a percentage of the subtotal. */
  taxPct: number;
}
export interface EcvResult extends EcvInput {
  subtotal: number;
  tax: number;
  ecv: number;
}

/** The whole-of-life value that drives delegate routing: every cost component, converted, plus tax. */
export function calculateEcv(i: EcvInput): EcvResult {
  const subtotal = (i.baseTermValue + i.extensionsValue + i.freight + i.implementation) * i.exchangeRate;
  const tax = (subtotal * i.taxPct) / 100;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return { ...i, subtotal: r2(subtotal), tax: r2(tax), ecv: r2(subtotal + tax) };
}

// ---------------------------------------------------------------- workflow routing (FR-0705, FR-X02)
export interface RoutedWorkflow {
  workflowId: 'wf-simple' | 'wf-intermediate' | 'wf-complex' | 'wf-board';
  reason: string;
}

/** Picks the workflow from value (tenant limits) and risk: critical work gets the governance workflow. */
export function routeWorkflow(
  routing: Settings['workflowRouting'],
  value: number,
  complexity: Complexity,
): RoutedWorkflow {
  if (complexity === 'CRITICAL')
    return {
      workflowId: 'wf-board',
      reason:
        'Critical-rated work follows the governance workflow with board endorsement and external probity.',
    };
  if (value < routing.simpleBelow)
    return {
      workflowId: 'wf-simple',
      reason: `Value is under AUD ${routing.simpleBelow.toLocaleString('en-AU')}.`,
    };
  if (value < routing.intermediateBelow)
    return {
      workflowId: 'wf-intermediate',
      reason: `Value is under AUD ${routing.intermediateBelow.toLocaleString('en-AU')}.`,
    };
  return {
    workflowId: 'wf-complex',
    reason: `Value is AUD ${routing.intermediateBelow.toLocaleString('en-AU')} or more.`,
  };
}

// ---------------------------------------------------------------- sub-workflows (FR-0705)
export interface SubWorkflow {
  key: string;
  label: string;
  /** Words in the category or title that select it. */
  keywords: string[];
  /** Sections added to the plan, the tender pack and the report: the same process, different outputs. */
  planSections: Array<{ title: string; text: string }>;
}

export const SUB_WORKFLOWS: readonly SubWorkflow[] = [
  {
    key: 'it',
    label: 'IT',
    keywords: ['it ', 'software', 'cloud', 'cyber', 'network', 'managed it', 'saas'],
    planSections: [
      {
        title: 'Technology requirements',
        text: 'Architecture fit, integration points, hosting region, security controls and exit and data-return arrangements.',
      },
    ],
  },
  {
    key: 'events',
    label: 'Events and venues',
    keywords: ['venue', 'event', 'conference', 'catering', 'hire'],
    planSections: [
      {
        title: 'Venue and event requirements',
        text: 'Capacity, accessibility, dates and set-up times, catering and dietary requirements, cancellation terms.',
      },
    ],
  },
  {
    key: 'consultants',
    label: 'Consultants',
    keywords: ['consult', 'advisory', 'professional services', 'audit services'],
    planSections: [
      {
        title: 'Consultant requirements',
        text: 'Named key personnel, deliverable acceptance, intellectual property, conflicts of interest and fee structure.',
      },
    ],
  },
  {
    key: 'contractors',
    label: 'Contractors',
    keywords: ['contractor', 'labour hire', 'trades', 'security', 'cleaning', 'landscap'],
    planSections: [
      {
        title: 'Contractor obligations',
        text: 'Licences and insurance, work health and safety induction, site access, subcontracting and supervision.',
      },
    ],
  },
  {
    key: 'legal',
    label: 'Legal services',
    keywords: ['legal'],
    planSections: [
      {
        title: 'Legal services requirements',
        text: 'Panel conflicts, rates and billing basis, privilege and confidentiality, matter reporting.',
      },
    ],
  },
  {
    key: 'finance',
    label: 'Finance',
    keywords: ['finance', 'banking', 'accounting', 'treasury'],
    planSections: [
      {
        title: 'Finance requirements',
        text: 'Regulatory licences, segregation of duties, audit rights and reconciliation arrangements.',
      },
    ],
  },
  {
    key: 'property',
    label: 'Property',
    keywords: ['property', 'lease', 'facility', 'refurbish', 'fit-out', 'fitout'],
    planSections: [
      {
        title: 'Property requirements',
        text: 'Site details, tenure, make-good and condition reporting, access and compliance with building codes.',
      },
    ],
  },
  {
    key: 'manufacturing',
    label: 'Manufacturing and supply',
    keywords: ['paper', 'apparel', 'uniform', 'manufactur', 'supply of', 'goods'],
    planSections: [
      {
        title: 'Supply requirements',
        text: 'Specifications and samples, minimum order quantities, lead times, delivery and returns, supply-chain assurance.',
      },
    ],
  },
];
export const GENERAL_SUB_WORKFLOW: SubWorkflow = {
  key: 'general',
  label: 'General',
  keywords: [],
  planSections: [],
};

export function selectSubWorkflow(
  category: string | null | undefined,
  title: string | null | undefined,
): SubWorkflow {
  const text = ` ${category ?? ''} ${title ?? ''} `.toLowerCase();
  return SUB_WORKFLOWS.find((s) => s.keywords.some((k) => text.includes(k))) ?? GENERAL_SUB_WORKFLOW;
}

// ---------------------------------------------------------------- the process a request follows
export const WORKFLOW_NAMES: Record<string, string> = {
  'wf-simple': 'Simple purchase',
  'wf-intermediate': 'Intermediate sourcing',
  'wf-complex': 'Complex tender',
  'wf-board': 'High-value or high-risk governance',
};

export interface ProcessStep {
  key: string;
  label: string;
  mandatory: boolean;
}
export interface ProcessStepView extends ProcessStep {
  state: 'DONE' | 'CURRENT' | 'UPCOMING';
  /** Added or removed for this procurement only, with the approval basis. */
  variation?: 'ADDED';
}

const PHASE_KEYS: Record<string, string[]> = {
  INTAKE: ['request'],
  PLAN: ['plan', 'approve', 'board-endorsement'],
  TENDER: ['tender', 'quotes'],
  EVALUATION: ['evaluate', 'external-probity'],
  CONTRACT: ['award', 'contract', 'order'],
};

/** Where a request stands on its workflow, from its phase. Steps before the current one are done. */
export function stepStates(
  steps: readonly (ProcessStep & { variation?: 'ADDED' })[],
  phase: string,
  complete: boolean,
): ProcessStepView[] {
  const keys = PHASE_KEYS[phase] ?? [];
  let current = steps.findIndex((s) => keys.includes(s.key));
  if (current < 0) current = 0;
  return steps.map((s, i) => ({
    ...s,
    state: complete || i < current ? 'DONE' : i === current ? 'CURRENT' : 'UPCOMING',
  }));
}
