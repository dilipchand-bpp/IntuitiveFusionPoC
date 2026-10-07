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
/** Hosting countries and regions the residency controls know about (NFR-R02, SEC-D09). */
export const COUNTRIES = ['AU', 'NZ', 'UK', 'EU', 'US', 'CA', 'SG', 'JP'] as const;
export type Country = (typeof COUNTRIES)[number];

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
  tenderRules: z
    .object({
      /** Tenders at or above this value need two independent witnesses to open the sealed bids (FR-0175). */
      dualWitnessThresholdAud: z.number().min(0).max(1e11),
      /** Both witnesses must sign in within this many minutes of each other (FR-0175). */
      witnessWindowMinutes: z.number().int().min(1).max(240),
    })
    .strict(),
  ratings: z
    .object({
      /** Whether a supplier can see how the enterprise rated them (FR-0790). */
      supplierSeesRatings: z.boolean(),
      /** Whether the buying team can read what suppliers said about the enterprise (FR-0790). */
      staffSeeSupplierRatings: z.boolean(),
    })
    .strict(),
  legalPlatform: z
    .object({
      /** The customer runs an enterprise legal platform and wants matters raised there (FR-0390). */
      enabled: z.boolean(),
      name: z.string().trim().min(1).max(60),
      /** Shared secret that signs what the legal platform sends back. Replace with a secret store in production. */
      webhookSecret: z.string().max(200),
      /** Demonstrates the fallback: deliveries fail until this is switched off (NFR-AV03, NFR-AV04). */
      simulateOutage: z.boolean(),
    })
    .strict(),
  approvalLinks: z
    .object({
      /** Approvers are sent a one-time link that lets them decide without a full sign-in (NFR-U05). */
      enabled: z.boolean(),
      validHours: z.number().int().min(1).max(336),
      /** Show the dollar value on the link page; off by default so commercial information is withheld. */
      showCommercial: z.boolean(),
    })
    .strict(),
  currency: z
    .object({
      /** What every total is kept and shown in. Changing it later would make old figures wrong, so it is shown but not edited. */
      base: z.literal('AUD'),
      /** ANNUAL: one rate per currency for each financial year. LIVE: the latest rate from the feed (FR-0810). */
      rateMode: z.enum(['ANNUAL', 'LIVE']),
    })
    .strict(),
  artefacts: z
    .object({
      /** How fast the evaluation report and the contract management plans follow a change in the records (FR-0870, NFR-P02). */
      laterStage: z.enum(['REALTIME', 'BATCHED', 'MANUAL']),
      batchMinutes: z.number().int().min(1).max(1440),
    })
    .strict(),
  buying: z
    .object({
      enabled: z.boolean(),
      /** The most a recommended purchase can be worth for the platform to draft it without a procurement officer starting it (FR-0820). */
      autoSourceLimitAud: z.number().min(0).max(1e7),
    })
    .strict(),
  externalSearch: z
    .object({
      /** Allow a search to also ask an outside AI source. Only the words of the question go out; nothing from the organisation's records (FR-0880). */
      enabled: z.boolean(),
    })
    .strict(),
  branding: z
    .object({
      productName: z.string().trim().min(2).max(40),
      tagline: z.string().trim().max(80),
      palette: z.enum(['INDIGO', 'TEAL', 'CRIMSON', 'FOREST', 'SLATE']),
      supportEmail: z.string().trim().email().max(120).or(z.literal('')),
    })
    .strict(),
  analytics: z
    .object({
      refreshMinutes: z.number().int().min(1).max(1440),
      consolidationPct: z.number().min(0).max(50),
      varianceThresholdPct: z.number().min(0).max(100),
      driftThresholdPct: z.number().min(0).max(100),
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
  ai: z
    .object({
      /** The model that answers (NFR-C01, NFR-M06). A third-party model can be named here only after it is approved for the tenant (SEC-TP07). */
      activeModel: z.string().trim().min(1).max(60),
      /** A different model for one kind of task; anything not listed uses the active model. */
      taskOverrides: z.record(z.string().max(40), z.string().trim().min(1).max(60)).optional(),
    })
    .strict(),
  uploadScanning: z
    .object({
      /** The simulated malware scanner connector: DOWN holds every upload as PENDING_SCAN until it is back (SEC-AP04). */
      scannerMode: z.enum(['UP', 'DOWN']),
    })
    .strict(),
  performance: z
    .object({
      /** Target for the budget check inside the intake conversation, in milliseconds (NFR-P04). */
      budgetCheckMs: z.number().int().min(50).max(60_000),
    })
    .strict(),
  residency: z
    .object({
      /** The hosting country the customer elected (NFR-R02). Changed only on the residency page, with a reason. */
      country: z.enum(COUNTRIES),
      /** Other countries or regions that are allowed explicitly; anything not listed (and not the country) is refused (SEC-D09). */
      allowedRegions: z.array(z.enum(COUNTRIES)).max(10),
      /** Where AI processing and AI conversation transcripts are held. */
      aiRegion: z.enum(COUNTRIES),
      /** Where logs and audit exports go. */
      logRegion: z.enum(COUNTRIES),
    })
    .strict(),
  egress: z
    .object({
      /** Hosts the application may call. The default holds only simulated hosts; nothing public (SEC-D05). */
      allowedHosts: z.array(z.string().trim().toLowerCase().min(4).max(120)).max(50),
    })
    .strict(),
  privacy: z
    .object({
      /** Collection notice shown where personal information is collected (SEC-D08). */
      noticeVersion: z.string().trim().min(1).max(30),
      noticeText: z.string().trim().min(20).max(4000),
      /** The people who manage Privacy Act requests and receive escalations. */
      officerRole: z.enum(['ADMIN', 'LEGAL', 'PROBITY']),
      /** Calendar days to respond to an access or correction request. */
      responseDays: z.number().int().min(1).max(90),
    })
    .strict(),
  retention: z
    .object({
      /** Days an AI conversation transcript is kept before it is anonymised (SEC-D06). At least 30. */
      aiConversationDays: z.number().int().min(30).max(3650),
    })
    .strict(),
  /** Signature levels aligned to eIDAS (NFR-L03): the level a contract needs, by value, unless Legal sets one on the contract. */
  signatures: z
    .object({
      defaultLevel: z.enum(['SES', 'AES', 'QES']),
      requiredLevelByValue: z
        .array(
          z.object({ fromAud: z.number().min(0).max(1e10), level: z.enum(['SES', 'AES', 'QES']) }).strict(),
        )
        .max(6)
        .refine((a) => new Set(a.map((t) => t.fromAud)).size === a.length, 'Each value tier can appear once'),
    })
    .strict(),
  /** Outside content packs (NFR-R03): how often they refresh and how long one stays usable after a refresh. */
  content: z
    .object({
      refreshDays: z.number().int().min(1).max(365),
      validDays: z.number().int().min(1).max(730),
      /** Off: every field is populated from in-house data only. */
      useOutsideContent: z.boolean(),
    })
    .strict()
    .refine(
      (c) => c.validDays >= c.refreshDays,
      'A pack must stay valid at least as long as the refresh interval',
    ),
  /** Organisation defaults for the ESG and socio-economic metrics of a plan (NFR-R05). Percent of contract value unless stated. */
  esgPlan: z
    .object({
      /** A result this close to its limit, on the safe side, is AT RISK. */
      atRiskBandPct: z.number().min(0).max(50),
      /** The most a plan may relax an organisation limit, even with a reason and an approver note. */
      maxRelaxationPct: z.number().min(0).max(100),
      limits: z
        .object({
          INDIGENOUS_SPEND_PCT: z.number().min(0).max(100),
          SOCIAL_ENTERPRISE_SPEND_PCT: z.number().min(0).max(100),
          DISABILITY_EMPLOYMENT_SPEND_PCT: z.number().min(0).max(100),
          LOCAL_CONTENT_PCT: z.number().min(0).max(100),
          SUPPLIER_DIVERSITY_PCT: z.number().min(0).max(100),
          SME_PANEL_PCT: z.number().min(0).max(100),
          CARBON_INTENSITY_T_PER_M: z.number().min(0).max(1e6),
          MODERN_SLAVERY_RISK: z.number().min(1).max(3),
          SINGLE_SUPPLIER_SHARE_PCT: z.number().min(0).max(100),
        })
        .strict(),
    })
    .strict(),
  securityMonitor: z
    .object({
      /** The access-event monitor (SEC-L06): deterministic rules over who read, was refused, exported and signed in. */
      enabled: z.boolean(),
      /** The person alerts go to. Empty: the first probity officer, else the first administrator. */
      ownerUserId: z.string().uuid().nullable(),
      viewBurstCount: z.number().int().min(2).max(100_000),
      viewBurstMinutes: z.number().int().min(1).max(1440),
      deniedBurstCount: z.number().int().min(2).max(100_000),
      deniedBurstMinutes: z.number().int().min(1).max(1440),
      exportBurstCount: z.number().int().min(1).max(10_000),
      exportBurstMinutes: z.number().int().min(1).max(1440),
      failedLoginsBeforeSuccess: z.number().int().min(1).max(100),
      mfaFailureCount: z.number().int().min(1).max(100),
      mfaWindowMinutes: z.number().int().min(1).max(1440),
      newDeviceCheck: z.boolean(),
      /** Off by default so a demonstration at any hour is not flagged; turn on with the hours below. */
      outOfHoursCheck: z.boolean(),
      businessHoursStart: z.number().int().min(0).max(23),
      businessHoursEnd: z.number().int().min(1).max(24),
      timeZone: z
        .string()
        .trim()
        .min(3)
        .max(60)
        .refine((tz) => {
          try {
            new Intl.DateTimeFormat('en-AU', { timeZone: tz });
            return true;
          } catch {
            return false;
          }
        }, 'Use a time zone name such as Australia/Sydney'),
      /** A new or acknowledged-late alert goes to the executives after this many minutes without acknowledgement. */
      escalateAfterMinutes: z.number().int().min(1).max(10_080),
      accessLogRetentionDays: z.number().int().min(1).max(365),
    })
    .strict(),
  compliancePolicy: z
    .object({
      /** Thresholds the configuration compliance checks use (SEC-L08). */
      secretMaxAgeDays: z.number().int().min(1).max(3650),
      keyMaxAgeDays: z.number().int().min(1).max(3650),
      breakerMaxHours: z.number().int().min(1).max(8760),
      delegationReviewAud: z.number().min(0).max(1e10),
      delegationReviewDays: z.number().int().min(1).max(3650),
      approvalLinkMaxHours: z.number().int().min(1).max(336),
      dormantDays: z.number().int().min(1).max(3650),
      minPasswordLength: z.number().int().min(8).max(64),
    })
    .strict(),
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
  tenderRules: { dualWitnessThresholdAud: 5_000_000, witnessWindowMinutes: 30 },
  ratings: { supplierSeesRatings: false, staffSeeSupplierRatings: true },
  legalPlatform: { enabled: false, name: 'Legal platform', webhookSecret: '', simulateOutage: false },
  approvalLinks: { enabled: true, validHours: 48, showCommercial: false },
  currency: { base: 'AUD', rateMode: 'ANNUAL' },
  artefacts: { laterStage: 'REALTIME', batchMinutes: 15 },
  buying: { enabled: true, autoSourceLimitAud: 5_000 },
  externalSearch: { enabled: false },
  branding: { productName: 'Intuitive Fusion', tagline: '', palette: 'INDIGO', supportEmail: '' },
  analytics: { refreshMinutes: 15, consolidationPct: 8, varianceThresholdPct: 5, driftThresholdPct: 10 },
  security: { requireMfa: false, enforceSso: false, stepUpApprovals: false },
  erpFieldMap: [],
  ai: { activeModel: 'rules-simulated-v1' },
  uploadScanning: { scannerMode: 'UP' },
  performance: { budgetCheckMs: 2000 },
  residency: { country: 'AU', allowedRegions: [], aiRegion: 'AU', logRegion: 'AU' },
  egress: { allowedHosts: ['*.simulated.test'] },
  privacy: {
    noticeVersion: '2026-10',
    noticeText:
      'We collect your name, work email and the records you create so that procurement can be run and audited. ' +
      'We use them for that purpose only and disclose them only to people with a role that needs them or where the law requires. ' +
      'You can ask to see the personal information we hold about you, or to correct it, from the Privacy page. ' +
      'This is a demonstration notice with synthetic wording.',
    officerRole: 'ADMIN',
    responseDays: 30,
  },
  retention: { aiConversationDays: 365 },
  signatures: { defaultLevel: 'SES', requiredLevelByValue: [] },
  content: { refreshDays: 30, validDays: 45, useOutsideContent: true },
  esgPlan: {
    atRiskBandPct: 10,
    maxRelaxationPct: 50,
    limits: {
      INDIGENOUS_SPEND_PCT: 3,
      SOCIAL_ENTERPRISE_SPEND_PCT: 2,
      DISABILITY_EMPLOYMENT_SPEND_PCT: 1,
      LOCAL_CONTENT_PCT: 20,
      SUPPLIER_DIVERSITY_PCT: 5,
      SME_PANEL_PCT: 30,
      CARBON_INTENSITY_T_PER_M: 120,
      MODERN_SLAVERY_RISK: 2,
      SINGLE_SUPPLIER_SHARE_PCT: 60,
    },
  },
  securityMonitor: {
    enabled: true,
    ownerUserId: null,
    // generous, so ordinary use (and the end-to-end tests) is never flagged; tests set low values on purpose
    viewBurstCount: 300,
    viewBurstMinutes: 10,
    deniedBurstCount: 20,
    deniedBurstMinutes: 10,
    exportBurstCount: 10,
    exportBurstMinutes: 60,
    failedLoginsBeforeSuccess: 3,
    mfaFailureCount: 5,
    mfaWindowMinutes: 30,
    newDeviceCheck: true,
    outOfHoursCheck: false,
    businessHoursStart: 7,
    businessHoursEnd: 19,
    timeZone: 'Australia/Sydney',
    escalateAfterMinutes: 60,
    accessLogRetentionDays: 14,
  },
  compliancePolicy: {
    secretMaxAgeDays: 180,
    keyMaxAgeDays: 365,
    breakerMaxHours: 24,
    delegationReviewAud: 5_000_000,
    delegationReviewDays: 365,
    approvalLinkMaxHours: 72,
    dormantDays: 90,
    minPasswordLength: 12,
  },
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
