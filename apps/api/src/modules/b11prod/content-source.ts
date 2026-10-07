/**
 * The simulated outside content source (NFR-R03). It stands in for the registries and publishers that supply reference
 * content: a classification registry (UNSPSC), a market price survey, a risk library, a legal clause reference and an ESG
 * reference. Everything is synthetic and deterministic, and it changes by version number: version 1 is the first release,
 * and each later release adds, changes or removes items, so a refresh visibly does something.
 *
 * SWAP POINT (docs/swap-points.md): `fetchContentRelease(kind, version)` is what a real feed replaces (an HTTPS call to the
 * publisher through the organisation's gateway). The caller reads the answer as `{ version, items }` and diffs it against
 * what it holds, so a real feed only has to return the same shape. The host names below are synthetic (*.simulated.test).
 */
import type { ContentKind } from '../../db/schema.js';

export const LATEST_VERSION = 6;

export interface ContentItemData {
  key: string;
  label: string;
  data: Record<string, unknown>;
}
export interface ContentRelease {
  kind: ContentKind;
  version: number;
  latest: number;
  sourceName: string;
  sourceUrl: string;
  items: ContentItemData[];
}

interface Spec {
  key: string;
  label: string;
  data: Record<string, unknown>;
  /** First release that has the item. */
  since: number;
  /** The release that no longer has it. */
  until?: number;
  /** From this release, the label or data differs. */
  revisions?: Array<{ from: number; label?: string; data?: Record<string, unknown> }>;
}

export const SOURCES: Record<ContentKind, { name: string; url: string }> = {
  UNSPSC_TAXONOMY: {
    name: 'Simulated UNSPSC registry',
    url: 'https://registry.unspsc.simulated.test/v1/taxonomy',
  },
  MARKET_BENCHMARKS: {
    name: 'Simulated market price survey',
    url: 'https://prices.market-survey.simulated.test/v1/benchmarks',
  },
  RISK_LIBRARY: {
    name: 'Simulated standard risk library',
    url: 'https://risk.library.simulated.test/v1/statements',
  },
  CLAUSE_REFERENCE: {
    name: 'Simulated legal clause reference',
    url: 'https://clauses.legal-reference.simulated.test/v1/references',
  },
  ESG_REFERENCE: {
    name: 'Simulated ESG reference service',
    url: 'https://esg.reference.simulated.test/v1/content',
  },
};

const tax = (
  key: string,
  category: string,
  code: string,
  label: string,
  since: number,
  extra: Partial<Spec> = {},
): Spec => ({ key, label, data: { category, code, scheme: 'UNSPSC' }, since, ...extra });

const TAXONOMY: Spec[] = [
  tax('building-cleaning', 'Building cleaning', '76111501', 'Building cleaning services', 1, {
    revisions: [{ from: 3, label: 'Commercial building cleaning services', data: { code: '76111501' } }],
  }),
  tax('it-managed-services', 'IT managed services', '81111812', 'Computer help desk and managed services', 1),
  tax('health-services', 'Health services', '85100000', 'Comprehensive health services', 1),
  tax('security-services', 'Security services', '92121504', 'Guard services', 1, {
    revisions: [{ from: 4, label: 'Security guard and patrol services', data: { code: '92121500' } }],
  }),
  tax('landscaping', 'Landscaping', '70171700', 'Landscape maintenance', 1),
  tax('paper-products', 'Paper products', '14111507', 'Printer or copier paper', 1),
  tax('apparel', 'Apparel', '53100000', 'Clothing', 1, { until: 5 }),
  tax('catering', 'Catering', '90101501', 'Catering services', 1),
  tax('professional-services', 'Professional services', '80101505', 'Business consulting services', 1),
  tax('construction', 'Construction', '72101507', 'Building construction services', 1),
  tax('software-licences', 'Software licences', '43232300', 'Data management and query software', 2),
  tax('cloud-hosting', 'Cloud hosting', '81112006', 'Cloud-based hosting services', 2),
  tax('legal-services', 'Legal services', '80121600', 'Legal services', 3),
  tax('training-services', 'Training services', '86101700', 'Vocational training services', 4),
  tax('vehicle-fleet', 'Vehicle fleet', '25101900', 'Motor vehicles for the fleet', 5),
  tax('workwear-and-uniforms', 'Workwear and uniforms', '53102500', 'Uniforms and workwear', 5),
  tax('cyber-security-services', 'Cyber security services', '81111801', 'Information security services', 6),
];

const bench = (
  key: string,
  category: string,
  unit: string,
  low: number,
  median: number,
  high: number,
  since: number,
  extra: Partial<Spec> = {},
): Spec => ({
  key,
  label: `${category}: ${unit}`,
  data: { category, unit, low, median, high, basis: 'Synthetic survey of comparable contracts' },
  since,
  ...extra,
});

const BENCHMARKS: Spec[] = [
  bench('building-cleaning', 'Building cleaning', 'AUD per year', 80_000, 150_000, 240_000, 1, {
    revisions: [
      { from: 3, data: { low: 85_000, median: 158_000, high: 252_000 } },
      { from: 5, data: { low: 88_000, median: 166_000, high: 262_000 } },
    ],
  }),
  bench('it-managed-services', 'IT managed services', 'AUD per year', 150_000, 480_000, 1_200_000, 1, {
    revisions: [{ from: 4, data: { low: 160_000, median: 510_000, high: 1_260_000 } }],
  }),
  bench('security-services', 'Security services', 'AUD per year', 60_000, 140_000, 300_000, 1),
  bench('landscaping', 'Landscaping', 'AUD per year', 30_000, 75_000, 160_000, 1),
  bench('catering', 'Catering', 'AUD per year', 25_000, 90_000, 220_000, 1, { until: 6 }),
  bench('professional-services', 'Professional services', 'AUD per year', 100_000, 320_000, 900_000, 1),
  bench('construction', 'Construction', 'AUD per project', 400_000, 1_800_000, 9_000_000, 1),
  bench('software-licences', 'Software licences', 'AUD per year', 20_000, 120_000, 600_000, 2),
  bench('cloud-hosting', 'Cloud hosting', 'AUD per year', 40_000, 210_000, 900_000, 3),
  bench('training-services', 'Training services', 'AUD per year', 15_000, 60_000, 180_000, 4),
  bench('cyber-security-services', 'Cyber security services', 'AUD per year', 50_000, 190_000, 650_000, 6),
];

const risk = (
  key: string,
  title: string,
  description: string,
  options: string[],
  appliesTo: string,
  since: number,
  extra: Partial<Spec> = {},
): Spec => ({
  key,
  label: title,
  data: { title, description, options, appliesTo },
  since,
  ...extra,
});

const RISKS: Spec[] = [
  risk(
    'modern-slavery',
    'Modern slavery in the supply chain',
    'Workers in the supplier or its sub-suppliers are exploited.',
    ['Modern slavery statement required with the bid', 'Supply chain audit rights', 'Termination for breach'],
    'clean|security|construction|garment|apparel|uniform|catering|labour|agricultur',
    1,
  ),
  risk(
    'supplier-concentration',
    'Over-reliance on one supplier',
    'Too much of the organisation’s spend in this category sits with a single supplier.',
    ['Panel of at least two suppliers', 'Cap on share of spend', 'Transition-out plan'],
    '.*',
    1,
    {
      revisions: [
        {
          from: 4,
          data: {
            options: [
              'Panel of at least two suppliers',
              'Cap on share of spend in the contract',
              'Transition-out plan tested yearly',
            ],
          },
        },
      ],
    },
  ),
  risk(
    'data-sovereignty',
    'Data held outside the nominated country',
    'Personal or sensitive data is stored or processed in another country.',
    [
      'Hosting country named in the contract',
      'Sub-processor list with notice of change',
      'Audit of data locations',
    ],
    'software|cloud|saas|hosting|data|digital',
    2,
  ),
  risk(
    'key-person',
    'Dependence on key people',
    'Delivery depends on a few named individuals who may leave.',
    ['Named key personnel clause', 'Handover period', 'Knowledge capture in the plan'],
    'consult|professional|advisory|legal|training',
    2,
  ),
  risk(
    'price-indexation',
    'Unplanned price indexation',
    'Annual price rises outpace the budget.',
    ['Indexation tied to a published index with a cap', 'Price review at the half-way point'],
    'managed|licence|license|subscription|hosting|cleaning',
    3,
  ),
  risk(
    'environmental-harm',
    'Environmental harm',
    'The work causes pollution or breaches environmental approvals.',
    ['Environmental management plan', 'Waste and chemical handling evidence', 'Right to stop work'],
    'construction|works|landscap|chemical|clean',
    3,
  ),
  risk(
    'ai-use',
    'Unapproved use of AI by the supplier',
    'The supplier feeds the organisation’s information into AI tools that were not approved.',
    ['Prohibit unapproved AI tools in the contract', 'Disclosure of AI used in delivery'],
    'software|digital|consult|professional|managed|cyber',
    4,
  ),
  risk(
    'subcontractor',
    'Unvetted subcontractors',
    'Work is passed to subcontractors who were never assessed.',
    ['Prior approval of subcontractors', 'Flow-down of key clauses'],
    'construction|works|clean|security|maintenance',
    4,
    { until: 6 },
  ),
  risk(
    'resilience',
    'Supplier cannot continue during a disruption',
    'A cyber event or outage stops the service for days.',
    ['Business continuity evidence', 'Recovery time commitments', 'Right to step in'],
    'software|cloud|hosting|managed|cyber|security',
    5,
  ),
];

const ref = (
  key: string,
  topic: string,
  reference: string,
  note: string,
  since: number,
  extra: Partial<Spec> = {},
): Spec => ({ key, label: `${topic}: ${reference}`, data: { topic, reference, note }, since, ...extra });

const CLAUSES: Spec[] = [
  ref(
    'consumer-law',
    'Consumer guarantees',
    'Competition and Consumer Act 2010 (Cth), Schedule 2',
    'Guarantees about services and goods that a contract cannot exclude.',
    1,
  ),
  ref(
    'privacy',
    'Privacy',
    'Privacy Act 1988 (Cth), Australian Privacy Principles',
    'Handling of personal information by the supplier.',
    1,
  ),
  ref(
    'modern-slavery',
    'Modern slavery',
    'Modern Slavery Act 2018 (Cth)',
    'Reporting entities and supply chain due diligence.',
    1,
  ),
  ref(
    'security-of-payment',
    'Security of payment',
    'Building and Construction Industry Security of Payment Act (state)',
    'Payment claims and adjudication for construction work.',
    2,
  ),
  ref(
    'electronic-transactions',
    'Electronic signatures',
    'Electronic Transactions Act 1999 (Cth)',
    'When an electronic signature meets a signing requirement.',
    2,
  ),
  ref(
    'limitation-of-liability',
    'Limitation of liability',
    'Civil Liability Act (state), proportionate liability',
    'Caps and proportionate liability in services contracts.',
    3,
    {
      revisions: [
        { from: 5, data: { note: 'Caps, proportionate liability and the carve-outs usually negotiated.' } },
      ],
    },
  ),
  ref(
    'ip-ownership',
    'Intellectual property',
    'Copyright Act 1968 (Cth), moral rights',
    'Ownership of deliverables and moral rights consents.',
    4,
  ),
  ref(
    'data-breach',
    'Data breach notification',
    'Privacy Act 1988 (Cth), Part IIIC',
    'Notifiable data breaches and the supplier’s duty to tell the customer.',
    5,
  ),
];

const esg = (
  key: string,
  topic: string,
  measure: string,
  benchmark: string,
  since: number,
  extra: Partial<Spec> = {},
): Spec => ({ key, label: `${topic}: ${measure}`, data: { topic, measure, benchmark }, since, ...extra });

const ESG: Spec[] = [
  esg(
    'indigenous',
    'Indigenous procurement',
    'Share of addressable spend with Indigenous businesses',
    '3 percent of contract value (synthetic policy benchmark)',
    1,
    {
      revisions: [
        { from: 4, data: { benchmark: '4 percent of contract value (synthetic policy benchmark)' } },
      ],
    },
  ),
  esg(
    'carbon-intensity',
    'Carbon intensity',
    'Tonnes CO2e per million dollars of contract value',
    'Facilities services: 90 to 140 t per $m',
    1,
  ),
  esg(
    'social-enterprise',
    'Social enterprise',
    'Share of spend with social enterprises',
    '2 percent of contract value',
    2,
  ),
  esg(
    'modern-slavery-risk',
    'Modern slavery',
    'Supplier risk rating, low to high',
    'Rating at or below medium for awarded suppliers',
    2,
  ),
  esg(
    'local-content',
    'Local content',
    'Share of labour hours delivered locally',
    '20 percent of labour hours',
    3,
  ),
  esg(
    'sme-participation',
    'SME participation',
    'Small and medium suppliers on the panel',
    '30 percent of panel suppliers',
    3,
    { until: 6 },
  ),
  esg(
    'disability-employment',
    'Disability employment',
    'Share of spend with disability enterprises',
    '1 percent of contract value',
    4,
  ),
];

const SPECS: Record<ContentKind, Spec[]> = {
  UNSPSC_TAXONOMY: TAXONOMY,
  MARKET_BENCHMARKS: BENCHMARKS,
  RISK_LIBRARY: RISKS,
  CLAUSE_REFERENCE: CLAUSES,
  ESG_REFERENCE: ESG,
};

/** The items a release holds: what is present at that version, with every revision up to it applied. */
export function itemsAt(kind: ContentKind, version: number): ContentItemData[] {
  return SPECS[kind]
    .filter((s) => s.since <= version && (s.until === undefined || version < s.until))
    .map((s) => {
      let label = s.label;
      let data = { ...s.data };
      for (const r of (s.revisions ?? []).filter((x) => x.from <= version).sort((a, b) => a.from - b.from)) {
        if (r.label) label = r.label;
        if (r.data) data = { ...data, ...r.data };
      }
      return { key: s.key, label, data };
    });
}

/** The simulated publisher's answer for a release. Version is clamped to what exists. */
export async function fetchContentRelease(kind: ContentKind, version: number): Promise<ContentRelease> {
  const v = Math.max(1, Math.min(LATEST_VERSION, Math.floor(version)));
  return {
    kind,
    version: v,
    latest: LATEST_VERSION,
    sourceName: SOURCES[kind].name,
    sourceUrl: SOURCES[kind].url,
    items: itemsAt(kind, v),
  };
}
