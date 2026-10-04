/**
 * Tenant settings (FR-0690 and the configuration requirements that hang off it): one typed, validated, audited place
 * for the rules an administrator can change without a release - procurement numbering, field labels, custom fields,
 * mandatory checkpoints, intake rules, notification rules and workflow routing.
 *
 * Storage: `tenant.config.settings` for the new sections; three older keys stay where earlier milestones put them
 * (`selfServiceThresholdAud`, `budgetCap`, `statutoryMinDays`) so nothing already built has to move. `loadSettings`
 * merges both views and fills defaults; every reader goes through it.
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Tx } from '../../db/client.js';
import { tenant } from '../../db/schema.js';

export const LAYOUTS = ['LIST', 'KANBAN', 'CALENDAR', 'DENSE'] as const;
export type Layout = (typeof LAYOUTS)[number];
export const FUNCTIONS = ['IT', 'LEGAL', 'CYBER', 'FINANCE', 'RISK'] as const;
export const CHANNELS = ['IN_APP', 'EMAIL', 'SLACK', 'TEAMS'] as const;
export const EVENTS = ['BUDGET_BREACH', 'DELEGATE_ACTION', 'APPROVAL_TIMEOUT'] as const;
export const TAXONOMIES = ['UNSPSC', 'CPV', 'NAICS'] as const;

const label = z.string().trim().min(1).max(60);
const keyName = z
  .string()
  .regex(/^[a-z][a-zA-Z0-9]{1,30}$/, 'Start with a lower-case letter; letters and digits only');

export const numberingSchema = z
  .object({
    scheme: z.enum(['YEAR_SEQ', 'FY_SEQ', 'SEQ']),
    prefix: z
      .string()
      .regex(/^[A-Z][A-Z0-9]{0,7}$/, 'One to eight capitals or digits, starting with a capital'),
    digits: z.number().int().min(3).max(8),
  })
  .strict();

export const customFieldSchema = z
  .object({
    key: keyName,
    label,
    type: z.enum(['TEXT', 'FLAG', 'NUMBER']),
    mandatory: z.boolean(),
  })
  .strict();

export const engagementRuleSchema = z
  .object({
    id: keyName,
    label,
    function: z.enum(FUNCTIONS),
    keywords: z.array(z.string().trim().toLowerCase().min(2).max(40)).max(20),
    minValue: z.number().min(0).max(1e10).optional(),
  })
  .strict();

export const SECTIONS = {
  numbering: numberingSchema,
  fieldLabels: z.record(keyName, label).refine((o) => Object.keys(o).length <= 60, 'At most 60 labels'),
  customFields: z
    .array(customFieldSchema)
    .max(20)
    .refine((a) => new Set(a.map((f) => f.key)).size === a.length, 'Field keys must be unique'),
  checkpoints: z
    .object({
      coiBeforeApproval: z.boolean(),
      evaluationBeforeReport: z.boolean(),
      reportSignoffBeforeContract: z.boolean(),
    })
    .strict(),
  intake: z
    .object({
      selfServiceThresholdAud: z.number().min(0).max(1e9),
      budgetCap: z.enum(['HARD', 'SOFT']),
      taxonomy: z.enum(TAXONOMIES),
      layouts: z.record(z.string(), z.enum(LAYOUTS)),
      engagementRules: z.array(engagementRuleSchema).max(30),
    })
    .strict(),
  notifications: z
    .object({
      channels: z.array(z.enum(CHANNELS)).min(1).max(4),
      escalationHours: z.number().int().min(1).max(720),
      rules: z.array(z.object({ event: z.enum(EVENTS), enabled: z.boolean() }).strict()).max(10),
    })
    .strict(),
  onboardingQuestions: z
    .array(
      z
        .object({
          id: keyName,
          label: z.string().trim().min(3).max(200),
          type: z.enum(['YESNO', 'TEXT']),
          mandatory: z.boolean(),
          /** For a yes/no question: the answer that flags the supplier for review (for example No to a modern slavery policy). */
          flagIf: z.enum(['YES', 'NO']).optional(),
        })
        .strict(),
    )
    .max(15)
    .refine((a) => new Set(a.map((q) => q.id)).size === a.length, 'Question keys must be unique'),
  publicRegisters: z
    .array(
      z
        .object({
          register: z.enum(['AusTender', 'SAM.gov', 'TED']),
          jurisdiction: z.string().trim().min(2).max(60),
          minValueAud: z.number().min(0).max(1e10),
          enabled: z.boolean(),
        })
        .strict(),
    )
    .max(6),
  criteriaLibrary: z
    .array(
      z
        .object({
          name: z.string().trim().min(3).max(120),
          stream: z.enum(['TECHNICAL', 'COMMERCIAL', 'OTHER']),
          weight: z.number().min(0).max(100),
          passFail: z.boolean(),
        })
        .strict(),
    )
    .max(60)
    .refine(
      (a) => new Set(a.map((c) => c.name.toLowerCase())).size === a.length,
      'Each criterion can appear once',
    ),
  evaluationRules: z
    .object({
      /** An unrecorded insurance certificate fails the compliance gate (an expired one always does). */
      requireInsurance: z.boolean(),
      /** Ranking instead of numeric scoring is allowed only up to this estimated value. */
      rankingMaxValueAud: z.number().min(0).max(1e10),
      /** Hours before an outstanding conflict re-declaration is reminded again. */
      redeclarationReminderHours: z.number().int().min(1).max(720),
      /** Days a supplier has to answer a clarification unless the buyer sets another. */
      clarificationDays: z.number().int().min(1).max(60),
    })
    .strict(),
  contractRules: z
    .object({
      /** Bank details must be on record and match the company name before signature options unlock. */
      requireBankDetails: z.boolean(),
      /** Legal must review the risk summary before a contract is released for signing. */
      requireRiskSummaryReview: z.boolean(),
      /** Endorsements needed before release: legal and any other business unit. */
      endorsements: z.array(z.enum(['LEGAL', 'FINANCE'])).max(2),
      /** Clauses that are non-negotiable: a change needs General Counsel or the risk delegate. */
      protectedClauses: z.array(z.string().trim().min(1).max(60)).max(20),
      /** After this many days of negotiation, signature blocks lock until the checks are run again. */
      negotiationLockDays: z.number().int().min(1).max(365),
      /** Hours before an unsigned signing invitation is reminded again. */
      signingReminderHours: z.number().int().min(1).max(720),
    })
    .strict(),
  contractManagement: z
    .object({
      /** Where the customer's ERP is integrated, a requisition above the contract limit is blocked (FR-0495). */
      erpIntegrated: z.boolean(),
      /** How a variation is measured: against the whole contract so far, or on its own (FR-0540). */
      variationModel: z.enum(['CUMULATIVE', 'INCREMENTAL']),
      /** A variation keeps the contract number with a suffix, or also gets a new procurement number (FR-0565). */
      variationNumbering: z.enum(['SUFFIX', 'NEW_PROCUREMENT']),
      /** Public-sector customers disclose a contract change over the threshold on a register (FR-0545). */
      publicSectorDisclosure: z.boolean(),
      disclosureThresholdPct: z.number().min(0).max(1000),
      disclosureDays: z.number().int().min(1).max(365),
      /** Contracts at or above this value, or judged high risk, get management and risk plans (FR-0555). */
      highValueAud: z.number().min(0).max(1e10),
      /** Alert when this share of the contract value has been spent, besides the fixed 80, 90 and 100 (FR-0580). */
      spendAlertPct: z.number().int().min(1).max(100),
      /** Plan templates the customer uploaded; the standard ones are used where there is none (FR-0555). */
      planTemplates: z
        .array(
          z
            .object({
              kind: z.enum(['CMP', 'RMP']),
              name: z.string().trim().min(2).max(120),
              sections: z
                .array(
                  z
                    .object({
                      title: z.string().trim().min(1).max(120),
                      text: z.string().trim().min(1).max(4000),
                    })
                    .strict(),
                )
                .min(1)
                .max(30),
            })
            .strict(),
        )
        .max(2)
        .refine((a) => new Set(a.map((t) => t.kind)).size === a.length, 'One template of each kind'),
    })
    .strict(),
  dashboards: z
    .object({
      /** HIERARCHY scopes a dashboard to the person's own unit and the units beneath; BROAD shows the whole organisation. */
      visibility: z.enum(['HIERARCHY', 'BROAD']),
      /** Active procurements one manager can carry before the workload view flags them (FR-0620). */
      capacityPerManager: z.number().int().min(1).max(200),
      /** Days between refreshes of the reference content corpus (FR-0765). */
      referenceRefreshDays: z.number().int().min(1).max(365),
    })
    .strict(),
  security: z
    .object({
      requireMfa: z.boolean(),
      enforceSso: z.boolean(),
      stepUpApprovals: z.boolean(),
    })
    .strict(),
  erpFieldMap: z
    .array(z.object({ erpName: z.string().trim().min(1).max(60), platformKey: keyName }).strict())
    .max(50)
    .refine(
      (a) => new Set(a.map((m) => m.erpName.toLowerCase())).size === a.length,
      'Each ERP field can be mapped once',
    ),
  workflowRouting: z
    .object({
      simpleBelow: z.number().min(0).max(1e10),
      intermediateBelow: z.number().min(0).max(1e10),
    })
    .strict()
    .refine(
      (r) => r.simpleBelow <= r.intermediateBelow,
      'The simple limit cannot exceed the intermediate limit',
    ),
} as const;

export type SectionName = keyof typeof SECTIONS;
export const SECTION_NAMES = Object.keys(SECTIONS) as SectionName[];

export type Settings = { [K in SectionName]: z.infer<(typeof SECTIONS)[K]> };

export const DEFAULTS: Settings = {
  numbering: { scheme: 'YEAR_SEQ', prefix: 'PR', digits: 4 },
  fieldLabels: {},
  customFields: [],
  checkpoints: { coiBeforeApproval: true, evaluationBeforeReport: true, reportSignoffBeforeContract: true },
  intake: {
    selfServiceThresholdAud: 50_000,
    budgetCap: 'HARD',
    taxonomy: 'UNSPSC',
    layouts: {},
    engagementRules: [
      {
        id: 'itSoftware',
        label: 'IT review for software and cloud',
        function: 'IT',
        keywords: ['software', 'cloud', 'saas', 'licence', 'license', 'it services', 'managed it', 'hosting'],
      },
      {
        id: 'cyberData',
        label: 'Cyber assessment where data is sensitive',
        function: 'CYBER',
        keywords: ['personal information', 'health record', 'payment data', 'confidential data'],
      },
      {
        id: 'legalLarge',
        label: 'Legal review of larger contracts',
        function: 'LEGAL',
        keywords: [],
        minValue: 250_000,
      },
      {
        id: 'financeLarge',
        label: 'Finance review of larger spend',
        function: 'FINANCE',
        keywords: [],
        minValue: 100_000,
      },
      {
        id: 'riskCritical',
        label: 'Risk and compliance for high-risk work',
        function: 'RISK',
        keywords: ['security guard', 'security services', 'hazardous', 'chemical', 'construction', 'works'],
        minValue: 0,
      },
    ],
  },
  notifications: {
    channels: ['IN_APP', 'EMAIL'],
    escalationHours: 48,
    rules: [
      { event: 'BUDGET_BREACH', enabled: true },
      { event: 'DELEGATE_ACTION', enabled: true },
      { event: 'APPROVAL_TIMEOUT', enabled: true },
    ],
  },
  // none by default, so registration asks nothing extra until an organisation adds its own questions (FR-0215)
  onboardingQuestions: [],
  // public-sector tenders at or above the value go to the register for their jurisdiction (FR-0140)
  publicRegisters: [
    { register: 'AusTender', jurisdiction: 'Australia (Commonwealth)', minValueAud: 80_000, enabled: true },
    { register: 'SAM.gov', jurisdiction: 'United States (federal)', minValueAud: 250_000, enabled: false },
    { register: 'TED', jurisdiction: 'European Union', minValueAud: 215_000, enabled: false },
  ],
  // a starting library of criteria to pick from when setting up an evaluation (FR-0320)
  criteriaLibrary: [
    { name: 'Technical capability and approach', stream: 'TECHNICAL', weight: 40, passFail: false },
    { name: 'Delivery, transition and risk management', stream: 'TECHNICAL', weight: 20, passFail: false },
    { name: 'Quality of proposed solution', stream: 'TECHNICAL', weight: 40, passFail: false },
    { name: 'Delivery approach and team', stream: 'TECHNICAL', weight: 20, passFail: false },
    { name: 'Security and data protection', stream: 'TECHNICAL', weight: 15, passFail: false },
    { name: 'Sustainability and social value', stream: 'OTHER', weight: 10, passFail: false },
    { name: 'Price and commercial terms', stream: 'COMMERCIAL', weight: 30, passFail: false },
    { name: 'Price and value for money', stream: 'COMMERCIAL', weight: 30, passFail: false },
    { name: 'Experience and references', stream: 'OTHER', weight: 10, passFail: false },
    {
      name: 'Compliance with the specification (pass or fail)',
      stream: 'TECHNICAL',
      weight: 0,
      passFail: true,
    },
    {
      name: 'Meets mandatory insurance and licensing (pass or fail)',
      stream: 'OTHER',
      weight: 0,
      passFail: true,
    },
  ],
  evaluationRules: {
    requireInsurance: false,
    rankingMaxValueAud: 100_000,
    redeclarationReminderHours: 24,
    clarificationDays: 5,
  },
  contractRules: {
    requireBankDetails: false,
    requireRiskSummaryReview: false,
    endorsements: [],
    protectedClauses: [],
    negotiationLockDays: 30,
    signingReminderHours: 48,
  },
  contractManagement: {
    erpIntegrated: true,
    variationModel: 'CUMULATIVE',
    variationNumbering: 'SUFFIX',
    publicSectorDisclosure: false,
    disclosureThresholdPct: 10,
    disclosureDays: 42,
    highValueAud: 1_000_000,
    spendAlertPct: 70,
    planTemplates: [],
  },
  dashboards: { visibility: 'BROAD', capacityPerManager: 6, referenceRefreshDays: 90 },
  security: { requireMfa: false, enforceSso: false, stepUpApprovals: false },
  erpFieldMap: [],
  workflowRouting: { simpleBelow: 50_000, intermediateBelow: 1_000_000 },
};

interface RawConfig {
  settings?: Partial<Record<SectionName, unknown>>;
  selfServiceThresholdAud?: number;
  budgetCap?: 'HARD' | 'SOFT';
}

/** Merges stored values over defaults; a stored section that no longer validates falls back to its default. */
export function settingsFrom(config: unknown): Settings {
  const raw = (config ?? {}) as RawConfig;
  const out = { ...DEFAULTS } as Record<string, unknown>;
  for (const name of SECTION_NAMES) {
    const stored = raw.settings?.[name];
    if (stored !== undefined) {
      const ok = SECTIONS[name].safeParse(stored);
      if (ok.success) out[name] = ok.data;
    }
  }
  const intake = { ...(out.intake as Settings['intake']) };
  if (typeof raw.selfServiceThresholdAud === 'number' && raw.settings?.intake === undefined)
    intake.selfServiceThresholdAud = raw.selfServiceThresholdAud;
  if (raw.budgetCap && raw.settings?.intake === undefined) intake.budgetCap = raw.budgetCap;
  out.intake = intake;
  return out as Settings;
}

export async function loadSettings(tx: Tx, tenantId: string): Promise<Settings> {
  const [t] = await tx.select({ config: tenant.config }).from(tenant).where(eq(tenant.id, tenantId));
  return settingsFrom(t?.config);
}

/** Replaces the named sections; the three legacy top-level keys are kept in step so older readers agree. */
export async function saveSettings(
  tx: Tx,
  tenantId: string,
  patch: Partial<Settings>,
): Promise<{ before: Settings; after: Settings }> {
  const [t] = await tx.select().from(tenant).where(eq(tenant.id, tenantId));
  const config = (t?.config ?? {}) as Record<string, unknown>;
  const before = settingsFrom(config);
  const stored = { ...((config.settings as Record<string, unknown> | undefined) ?? {}) };
  for (const name of SECTION_NAMES) if (patch[name] !== undefined) stored[name] = patch[name];
  const next = { ...config, settings: stored } as Record<string, unknown>;
  const after = settingsFrom(next);
  next.selfServiceThresholdAud = after.intake.selfServiceThresholdAud;
  next.budgetCap = after.intake.budgetCap;
  await tx.update(tenant).set({ config: next }).where(eq(tenant.id, tenantId));
  return { before, after };
}

/** Label for a field: the administrator's wording if set, else the built-in one (FR-0700). */
export const labelFor = (s: Pick<Settings, 'fieldLabels'>, key: string, fallback: string): string =>
  s.fieldLabels[key] ?? fallback;

/** The next procurement number after `last` for the configured format (FR-0695). */
export function formatNumber(n: Settings['numbering'], now: Date, seq: number): string {
  const y = now.getUTCFullYear();
  // Australian financial year: 1 July to 30 June, named by the year it ends
  const fy = now.getUTCMonth() >= 6 ? y + 1 : y;
  const num = String(seq).padStart(n.digits, '0');
  if (n.scheme === 'FY_SEQ') return `${n.prefix}-FY${String(fy).slice(-2)}-${num}`;
  if (n.scheme === 'SEQ') return `${n.prefix}-${num}`;
  return `${n.prefix}-${y}-${num}`;
}

/** The stem that every number of the current period starts with, and how to read the sequence back from one. */
export function numberStem(n: Settings['numbering'], now: Date): string {
  return formatNumber(n, now, 0).replace(/0+$/, '');
}
export const sequenceOf = (number: string): number => Number(number.split('-').pop());

/** "ABC001.v1" style: a variation's number is its parent's plus a version suffix, so the relationship is explicit. */
export const variationNumber = (parentNumber: string, version: number): string =>
  `${parentNumber}.v${version}`;

/**
 * Field-name mapping with an ERP (FR-0700), in both directions. Inbound: the ERP's names become the platform's, so
 * reports show one consistent label. Outbound: the platform's names become the ERP's. Unmapped fields pass through.
 */
export function mapRecord(
  map: Settings['erpFieldMap'],
  record: Record<string, unknown>,
  direction: 'INBOUND' | 'OUTBOUND',
): Record<string, unknown> {
  const rename = new Map(
    map.map((m) =>
      direction === 'INBOUND' ? [m.erpName.toLowerCase(), m.platformKey] : [m.platformKey, m.erpName],
    ),
  );
  return Object.fromEntries(
    Object.entries(record).map(([k, v]) => [
      rename.get(direction === 'INBOUND' ? k.toLowerCase() : k) ?? k,
      v,
    ]),
  );
}
