/**
 * The wording the drafting module draws on (CP-04, CP-05): standard requirements, risks, contract clauses and evaluation
 * criteria, per-category profiles, and the phrase list used to change tone. It is all fixed, reviewable text. A real language
 * model would replace the choosing and the phrasing; the lists below stay as the organisation's approved wording.
 */
import { sentenceCase, type FlagCode } from './lang.js';

export interface LibRequirement {
  code: string;
  /** What people call it: used to find it in "add a data sovereignty requirement". */
  aliases: RegExp;
  label: string;
  text: string;
  /** The text that raises it on its own. */
  flag?: FlagCode;
  /** A clause for the contract when a clause is asked for by the same name. */
  clause?: { title: string; text: string };
  risk?: string;
  criterion?: { name: string; description: string };
}

export const REQUIREMENTS: readonly LibRequirement[] = [
  {
    code: 'DATA_RESIDENCY',
    aliases:
      /data[- ]?(?:sovereignty|residency)|hosted? in australia|australian hosting|onshore (?:hosting|data)|data (?:stays|must stay|stored) (?:in|within) australia/i,
    label: 'data sovereignty',
    text: 'All services and data, including backups and support access, must be hosted and stored in Australia, with no transfer offshore without the written approval of the organisation.',
    flag: 'DATA_RESIDENCY',
    clause: {
      title: 'Data sovereignty',
      text: 'The Supplier must host, store and process all Customer data in Australia, including backups, and must not transfer or give access to that data from outside Australia without the Customer’s prior written approval.',
    },
    risk: 'data-sovereignty',
    criterion: {
      name: 'Data sovereignty and hosting',
      description: 'Where data is hosted, stored and supported from, and how that is assured.',
    },
  },
  {
    code: 'SECURITY_CERT',
    aliases:
      /iso\s?27001|security (?:certification|accreditation|standard)s?|soc\s?2|irap|essential eight|information security/i,
    label: 'information security certification',
    text: 'The supplier must hold a current information security certification (ISO/IEC 27001 or equivalent), provide the certificate and most recent audit summary, and notify the organisation of any security incident without delay.',
    flag: 'SECURITY_CERT',
    clause: {
      title: 'Information security',
      text: 'The Supplier maintains a current ISO/IEC 27001 (or equivalent) certification for the whole term, notifies the Customer of any security incident without delay, and allows the Customer to audit its security controls on reasonable notice.',
    },
    risk: 'data-breach',
    criterion: {
      name: 'Information security',
      description: 'Certifications held, controls, incident response and audit rights.',
    },
  },
  {
    code: 'CLEARANCE',
    aliases:
      /security clearance|vetting|police checks?|background checks?|working with children|personnel (?:screening|clearance)/i,
    label: 'personnel clearance',
    text: 'All personnel with access to the organisation’s sites or information must hold the checks required for the role (police check, and any security clearance named in the scope) before they start.',
    flag: 'CLEARANCE',
    clause: {
      title: 'Personnel checks',
      text: 'The Supplier ensures every person engaged on the services holds a current police check and any security clearance required by the Customer, and removes any person who no longer holds one.',
    },
  },
  {
    code: 'PRIVACY',
    aliases: /privacy|personal (?:data|information)|pii/i,
    label: 'privacy and personal information',
    text: 'The supplier must handle personal information in line with the Privacy Act 1988 and the organisation’s privacy policy, limit use to the services, and report any eligible data breach to the organisation immediately.',
    flag: 'PRIVACY',
    clause: {
      title: 'Privacy',
      text: 'The Supplier complies with the Privacy Act 1988 and the Customer’s privacy policy, uses personal information only to provide the services, and notifies the Customer immediately of any actual or suspected eligible data breach.',
    },
    risk: 'data-breach',
  },
  {
    code: 'CLOUD',
    aliases: /cloud(?: security)?|hosting security|saas security/i,
    label: 'cloud hosting security',
    text: 'Hosted services must follow recognised cloud security controls, encrypt data at rest and in transit, and provide logging the organisation can review.',
    flag: 'CLOUD',
  },
  {
    code: 'AFTER_HOURS',
    aliases:
      /24\s?[x/]\s?7|after[- ]hours|round the clock|around the clock|out of hours|support hours|on[- ]call|extended support/i,
    label: '24x7 support',
    text: 'The supplier must provide support at all hours, every day, with a named escalation contact and a response time for critical faults.',
    flag: 'AFTER_HOURS',
    clause: {
      title: 'Support hours',
      text: 'The Supplier provides support at all hours on every day of the year, with a named escalation contact and the response times set out in the service levels.',
    },
  },
  {
    code: 'SUSTAINABILITY',
    aliases: /sustainab\w*|environment\w*|carbon|net[- ]zero|emissions|green/i,
    label: 'sustainability',
    text: 'The supplier must describe how the services reduce environmental impact (energy, waste, recycled content) and report the agreed measures each year.',
    flag: 'SUSTAINABILITY',
    criterion: {
      name: 'Sustainability and social value',
      description: 'Environmental and social outcomes the respondent will deliver, with measures.',
    },
  },
  {
    code: 'LOCAL_SME',
    aliases:
      /local (?:content|business|supplier|jobs?)|\bsmes?\b|small business|indigenous|first nations|social (?:value|procurement)/i,
    label: 'local and small business participation',
    text: 'The supplier must state how local suppliers, small businesses and Aboriginal and Torres Strait Islander businesses will take part in delivering the services, with targets that can be reported.',
    flag: 'LOCAL_SME',
    criterion: {
      name: 'Local and small business participation',
      description: 'Commitments to local jobs, small business and Indigenous business participation.',
    },
  },
  {
    code: 'WHS',
    aliases: /\bwhs\b|work health(?: and safety)?|safety/i,
    label: 'work health and safety',
    text: 'The supplier must comply with work health and safety law, induct all personnel, and report every notifiable incident to the organisation at once.',
    flag: 'WHS',
    clause: {
      title: 'Work health and safety',
      text: 'The Supplier complies with all work health and safety law, inducts everyone it engages, and reports every notifiable incident to the Customer at once.',
    },
  },
  {
    code: 'ACCESSIBILITY',
    aliases: /accessib\w*|wcag/i,
    label: 'accessibility',
    text: 'Anything the public or staff will use must meet WCAG 2.1 level AA, with evidence provided before acceptance.',
    flag: 'ACCESSIBILITY',
  },
  {
    code: 'INSURANCE',
    aliases: /insurance|indemnity/i,
    label: 'insurance',
    text: 'The supplier must hold public liability and professional indemnity insurance appropriate to the services for the whole term and give a current certificate on request.',
    flag: 'INSURANCE',
    clause: {
      title: 'Insurance',
      text: 'The Supplier holds public liability, professional indemnity and workers compensation insurance appropriate to the services for the whole term and provides current certificates on request.',
    },
  },
  {
    code: 'MODERN_SLAVERY',
    aliases: /modern slavery/i,
    label: 'modern slavery',
    text: 'The supplier must assess and report modern slavery risks in its supply chain under the Modern Slavery Act 2018 (Cth).',
    flag: 'MODERN_SLAVERY',
    clause: {
      title: 'Modern slavery',
      text: 'The Supplier takes reasonable steps to identify and address modern slavery risks in its operations and supply chain, and reports them to the Customer on request.',
    },
  },
  {
    code: 'CONTINUITY',
    aliases: /business continuity|disaster recovery|\bdr\b|backup|failover|resilience/i,
    label: 'business continuity and disaster recovery',
    text: 'The supplier must keep a tested business continuity and disaster recovery plan, with recovery time and recovery point targets agreed in the service levels.',
    flag: 'CONTINUITY',
    clause: {
      title: 'Business continuity',
      text: 'The Supplier maintains and tests a business continuity and disaster recovery plan at least once a year, meets the recovery targets in the service levels, and shares the test results with the Customer.',
    },
    risk: 'service-failure',
  },
  {
    code: 'INTEGRATION',
    aliases: /integrat\w*|\bapis?\b|single sign[- ]on|\bsso\b/i,
    label: 'integration',
    text: 'The solution must integrate with the organisation’s identity (single sign-on) and finance systems through documented interfaces.',
    flag: 'INTEGRATION',
  },
  {
    code: 'TRAINING',
    aliases: /training|handover|knowledge transfer/i,
    label: 'training and handover',
    text: 'The supplier must train the organisation’s staff and hand over documentation and knowledge at the start and again at the end of the term.',
    flag: 'TRAINING',
  },
  {
    code: 'TRANSITION',
    aliases: /transition(?:[- ](?:in|out))?|exit plan|handback/i,
    label: 'transition in and out',
    text: 'The supplier must provide a transition-in plan, run overlap with any incumbent, and give reasonable help to move to a new supplier at the end of the term.',
    flag: 'INCUMBENT',
    clause: {
      title: 'Transition and exit',
      text: 'The Supplier provides a transition-in plan and, on expiry or termination, reasonable assistance, data and documentation so the Customer or a replacement supplier can take over without a break in service.',
    },
    risk: 'transition',
  },
];

export interface LibRisk {
  key: string;
  aliases: RegExp;
  title: string;
  level: 'Low' | 'Medium' | 'High';
  mitigation: string;
}
export const RISKS: readonly LibRisk[] = [
  {
    key: 'supplier-insolvency',
    aliases: /insolven\w*|supplier fail\w*|financial (?:viability|failure)|going (?:out of business|bust)/i,
    title: 'Supplier insolvency',
    level: 'Medium',
    mitigation:
      'Check financial viability before award, ask for financial statements each year, and include step-in and exit assistance rights.',
  },
  {
    key: 'data-breach',
    aliases: /data (?:breach|leak|loss)|cyber\w*|security (?:incident|breach)|privacy breach/i,
    title: 'Data breach',
    level: 'High',
    mitigation:
      'Require security certification, encryption and incident notification, and keep audit rights over the supplier’s controls.',
  },
  {
    key: 'data-sovereignty',
    aliases: /data[- ]?(?:sovereignty|residency)|offshore data/i,
    title: 'Data held outside Australia',
    level: 'High',
    mitigation:
      'Require onshore hosting and support in the contract, and verify hosting locations before award and each year.',
  },
  {
    key: 'key-person',
    aliases: /key[- ]?(?:person|people|personnel)|single point of failure|staff turnover/i,
    title: 'Dependence on key people',
    level: 'Medium',
    mitigation:
      'Name key personnel in the contract, require notice of changes, and require handover for any replacement.',
  },
  {
    key: 'cost-overrun',
    aliases:
      /cost (?:overrun|blow[- ]?out)|budget (?:overrun|blow[- ]?out)|price (?:increase|escalation)|overspend/i,
    title: 'Cost overrun',
    level: 'Medium',
    mitigation:
      'Use a fixed or capped price, control variations through change approval, and report spend against budget each month.',
  },
  {
    key: 'delivery-delay',
    aliases: /(?:delivery |schedule |project )?delay\w*|late delivery|miss(?:ed)? (?:the )?deadline/i,
    title: 'Delivery delay',
    level: 'Medium',
    mitigation:
      'Agree milestones with consequences for lateness, track progress fortnightly, and keep a fallback arrangement for critical dates.',
  },
  {
    key: 'regulatory-change',
    aliases: /regulat\w+ change|legislat\w+ change|compliance change|law change/i,
    title: 'Regulatory change',
    level: 'Low',
    mitigation: 'Include a change-in-law clause and review compliance obligations at each contract review.',
  },
  {
    key: 'vendor-lock-in',
    aliases: /lock[- ]?in|vendor dependence|proprietary/i,
    title: 'Vendor lock-in',
    level: 'Medium',
    mitigation:
      'Require open formats and data export, a documented exit plan, and avoid terms that make switching costly.',
  },
  {
    key: 'transition',
    aliases: /transition\w*|service continuity|changeover|cut[- ]?over/i,
    title: 'Transition and service continuity',
    level: 'Medium',
    mitigation:
      'Require a transition plan and run overlap with the incumbent until the new service is stable.',
  },
  {
    key: 'service-failure',
    aliases: /service (?:failure|outage|interruption)|outage|downtime|availability/i,
    title: 'Service failure or outage',
    level: 'Medium',
    mitigation:
      'Set availability targets with service credits, and require a tested continuity and recovery plan.',
  },
  {
    key: 'whs-incident',
    aliases: /whs|safety (?:incident|risk)|injur\w*|workplace accident/i,
    title: 'Work health and safety incident',
    level: 'Medium',
    mitigation: 'Require inductions, safe work method statements and immediate reporting of incidents.',
  },
  {
    key: 'fraud',
    aliases: /fraud|corruption|collusion|bribery/i,
    title: 'Fraud or collusion',
    level: 'Medium',
    mitigation:
      'Declare conflicts of interest, separate duties for approval and payment, and use the probity adviser for the process.',
  },
  {
    key: 'reputation',
    aliases: /reputation\w*|public criticism|media/i,
    title: 'Reputational damage',
    level: 'Low',
    mitigation: 'Check supplier references and conduct, and agree how public statements are approved.',
  },
  {
    key: 'subcontractor',
    aliases: /subcontract\w*|supply chain/i,
    title: 'Reliance on subcontractors',
    level: 'Medium',
    mitigation:
      'Require approval of subcontractors, flow the contract terms down, and keep the supplier responsible for their work.',
  },
  {
    key: 'urgency',
    aliases: /urgen\w*|time pressure|compressed timeline|tight timeline/i,
    title: 'Compressed timeline',
    level: 'Medium',
    mitigation:
      'Confirm the shortest compliant tender period, fix the scope early, and avoid shortcuts that weaken probity.',
  },
  {
    key: 'sole-source',
    aliases: /sole[- ]source|single[- ]source|direct (?:award|negotiation)/i,
    title: 'Limited competition',
    level: 'High',
    mitigation:
      'Record the reason for limited competition, get delegate approval, and test the price against market benchmarks.',
  },
];

export const riskLine = (r: Pick<LibRisk, 'title' | 'level' | 'mitigation'>) =>
  `${r.title}. Level: ${r.level}. Mitigation: ${r.mitigation}`;

export interface LibClause {
  key: string;
  aliases: RegExp;
  title: string;
  text: string;
}
const reqClauses: LibClause[] = REQUIREMENTS.filter((r) => r.clause).map((r) => ({
  key: r.code.toLowerCase(),
  aliases: r.aliases,
  title: r.clause!.title,
  text: r.clause!.text,
}));
export const CLAUSES: readonly LibClause[] = [
  ...reqClauses,
  {
    key: 'ip-indemnity',
    aliases:
      /ip indemnity|intellectual property indemnity|indemnity for (?:ip|intellectual property)|ip infringement/i,
    title: 'Intellectual property indemnity',
    text: 'The Supplier indemnifies the Customer against any claim that the services or materials infringe a third party’s intellectual property rights, and will at its own cost obtain the right to continue use or replace the infringing item.',
  },
  {
    key: 'price-review',
    aliases: /price review|price adjustment|indexation|cpi|price escalation/i,
    title: 'Price review',
    text: 'Prices are fixed for the first twelve months. After that they may be reviewed once a year, and any increase must not exceed the change in the Consumer Price Index for the preceding twelve months.',
  },
  {
    key: 'step-in',
    aliases: /step[- ]in/i,
    title: 'Step-in rights',
    text: 'If the Supplier fails to provide a critical service, the Customer may step in, or appoint a third party, to provide it at the Supplier’s cost until the failure is remedied.',
  },
  {
    key: 'escrow',
    aliases: /escrow|source code/i,
    title: 'Source code escrow',
    text: 'The Supplier deposits the source code and build instructions for the solution with an escrow agent, to be released to the Customer if the Supplier becomes insolvent or stops supporting the solution.',
  },
  {
    key: 'service-credits',
    aliases: /service credits?|sla credits?|performance (?:credits?|regime)/i,
    title: 'Service credits',
    text: 'If the Supplier misses a service level, it gives the Customer a credit against the next invoice as set out in the service levels schedule. Credits are not the Customer’s only remedy.',
  },
  {
    key: 'key-personnel',
    aliases: /key (?:personnel|people|person)/i,
    title: 'Key personnel',
    text: 'The Supplier assigns the key personnel named in the schedule, does not remove them without the Customer’s consent (except for illness, resignation or misconduct), and provides a suitably qualified replacement.',
  },
  {
    key: 'subcontracting',
    aliases: /subcontract\w*/i,
    title: 'Subcontracting',
    text: 'The Supplier must not subcontract any part of the services without the Customer’s prior written consent and remains responsible for the acts and omissions of its subcontractors.',
  },
  {
    key: 'audit-rights',
    aliases: /audit(?: rights?)?|inspection/i,
    title: 'Audit rights',
    text: 'The Customer, or an auditor it appoints, may audit the Supplier’s records and controls relating to the services on reasonable notice, and the Supplier gives all reasonable help.',
  },
  {
    key: 'force-majeure',
    aliases: /force majeure/i,
    title: 'Force majeure',
    text: 'Neither party is liable for a delay caused by an event beyond its reasonable control, provided it tells the other party promptly and takes reasonable steps to limit the effect. Payment obligations are not suspended.',
  },
  {
    key: 'dispute-resolution',
    aliases: /dispute(?: resolution)?|escalation clause/i,
    title: 'Dispute resolution',
    text: 'The parties must first try to resolve a dispute by escalating it to senior representatives, then by mediation, before starting court proceedings (other than for urgent relief).',
  },
  {
    key: 'liability-cap',
    aliases: /liability cap|limitation of liability|cap on liability/i,
    title: 'Limitation of liability',
    text: 'Each party’s total liability under this agreement is limited to the greater of the total contract value and the insurance cover the Supplier is required to hold, except for liability that cannot lawfully be limited.',
  },
];

export interface LibCriterion {
  key: string;
  aliases: RegExp;
  name: string;
  description: string;
  stream: 'TECHNICAL' | 'COMMERCIAL' | 'OTHER';
}
export const CRITERIA: readonly LibCriterion[] = [
  {
    key: 'sustainability',
    aliases: /sustainab\w*|environment\w*|green|carbon/i,
    name: 'Sustainability and social value',
    description: 'Environmental and social outcomes the respondent will deliver, with measures.',
    stream: 'OTHER',
  },
  {
    key: 'innovation',
    aliases: /innovat\w*/i,
    name: 'Innovation',
    description: 'New or better ways of delivering the services that add value without adding risk.',
    stream: 'TECHNICAL',
  },
  {
    key: 'local',
    aliases: /local (?:content|business|jobs?|participation)|\bsme\b|small business/i,
    name: 'Local and small business participation',
    description: 'Commitments to local jobs, small business and Indigenous business participation.',
    stream: 'OTHER',
  },
  {
    key: 'security',
    aliases: /security|cyber/i,
    name: 'Information security',
    description: 'Certifications held, controls, incident response and audit rights.',
    stream: 'TECHNICAL',
  },
  {
    key: 'risk',
    aliases: /risk/i,
    name: 'Risk management',
    description: 'How the respondent identifies, reports and manages delivery and operational risk.',
    stream: 'TECHNICAL',
  },
  {
    key: 'support',
    aliases: /support|service desk|after[- ]hours/i,
    name: 'Support model',
    description: 'Support hours, escalation, response times and the team behind them.',
    stream: 'TECHNICAL',
  },
  {
    key: 'sovereignty',
    aliases: /data[- ]?(?:sovereignty|residency)|hosting/i,
    name: 'Data sovereignty and hosting',
    description: 'Where data is hosted, stored and supported from, and how that is assured.',
    stream: 'TECHNICAL',
  },
  {
    key: 'financial',
    aliases: /financial (?:viability|capacity|stability)/i,
    name: 'Financial viability',
    description: 'Financial capacity to deliver for the whole term.',
    stream: 'COMMERCIAL',
  },
  {
    key: 'whs',
    aliases: /\bwhs\b|work health|safety/i,
    name: 'Work health and safety',
    description: 'Safety systems, record and the approach for this work.',
    stream: 'TECHNICAL',
  },
  {
    key: 'transition',
    aliases: /transition\w*|implementation/i,
    name: 'Transition and implementation',
    description: 'How the service will be taken over and brought into operation without a break.',
    stream: 'TECHNICAL',
  },
];

/** What "price", "quality" and the like refer to in an existing list of criteria, by words in the criterion name. */
export const CRITERION_SYNONYMS: Record<string, readonly string[]> = {
  price: ['price', 'cost', 'commercial', 'value for money', 'pricing'],
  cost: ['price', 'cost', 'commercial', 'value for money'],
  quality: ['quality', 'technical', 'capability', 'solution', 'approach'],
  technical: ['technical', 'capability', 'quality', 'solution'],
  delivery: ['delivery', 'transition', 'implementation', 'team'],
  experience: ['experience', 'references', 'track record'],
  references: ['references', 'experience'],
  risk: ['risk'],
  sustainability: ['sustainab', 'environment', 'social value'],
  security: ['security'],
  innovation: ['innovat'],
  support: ['support'],
  local: ['local'],
};

// ------------------------------------------------------------------------------------------------ category profiles
export interface Profile {
  scope: string[];
  deliverables: string[];
  serviceLevels: string[];
  personnel: string[];
  requirements: string[];
}
const GENERIC: Profile = {
  scope: [
    'Provide the services described in this document to the nominated sites or users for the whole term.',
    'Manage delivery, reporting and any change to the scope through the agreed contract management process.',
  ],
  deliverables: [
    'Delivery of the services to the agreed service levels, with a monthly performance report.',
    'A transition-in plan, a named account manager and a quarterly improvement report.',
  ],
  serviceLevels: [
    'Services are available and delivered as scheduled, with at least 98% of scheduled work completed on time each month.',
    'Critical faults are acknowledged within one hour and resolved within one business day.',
  ],
  personnel: [
    'A named account manager with authority to make decisions for the supplier.',
    'Personnel with the training, licences and checks needed for the work, and a plan to cover absences.',
  ],
  requirements: [
    'Compliance with applicable legislation, policy and probity requirements.',
    'Reporting each month on delivery against the service levels.',
  ],
};
export const PROFILES: Record<string, Partial<Profile>> = {
  'Print and imaging services': {
    scope: [
      'Supply, install, maintain and support multifunction printers and the print management software at each site.',
      'Supply of consumables (toner, parts) and proactive replacement, so sites do not run out.',
      'Secure print release, usage reporting by site and cost centre, and removal of old devices with data wiped.',
    ],
    deliverables: [
      'Fleet assessment, site-by-site deployment plan and installation of devices.',
      'Monthly usage and cost report by site, with recommendations to reduce volume and cost.',
      'Secure disposal certificates for the devices that are retired.',
    ],
    serviceLevels: [
      'Device availability of at least 98% each month, measured per site.',
      'Fault response within four business hours and repair or replacement within one business day for a site’s only device.',
      'Consumables delivered before they run out, with no more than one stock-out per site each quarter.',
    ],
    personnel: [
      'Field technicians within reasonable travel of each site, with current police checks.',
      'A service desk for fault logging and a named account manager for the contract.',
    ],
    requirements: [
      'Devices must support secure print release and encrypt stored data.',
      'Pricing must be per page with no minimum volume.',
    ],
  },
  'IT managed services': {
    scope: [
      'Service desk, infrastructure and application support to the availability and response targets in the service levels.',
      'Patching, monitoring and backup of the environment, with change control and a service catalogue.',
      'Transition-in from the current arrangement and transition-out assistance at the end of the term.',
    ],
    deliverables: [
      'Service catalogue, run books and a monthly service report.',
      'Security and availability reporting, and an annual improvement roadmap.',
    ],
    serviceLevels: [
      'Availability of at least 99.5% for production services each month.',
      'Priority 1 incidents responded to within 15 minutes and resolved within four hours.',
    ],
    personnel: [
      'A service delivery manager and named technical leads for infrastructure, security and applications.',
      'Staff holding current police checks and, where the scope requires, security clearances.',
    ],
    requirements: [
      'Information security controls aligned to the organisation’s policy, with incident notification and audit rights.',
      'Data to remain within approved Australian regions.',
    ],
  },
  'Building cleaning': {
    scope: [
      'Cleaning of all nominated sites to the agreed schedule and standard, including washrooms, kitchens and common areas.',
      'Supply of consumables and equipment, waste removal and periodic deep cleans.',
    ],
    deliverables: [
      'A cleaning schedule for each site and a monthly audit report.',
      'Induction records for all cleaning staff.',
    ],
    serviceLevels: [
      'At least 95% of site inspections pass each month.',
      'Complaints responded to within two hours and corrected within one business day.',
    ],
    personnel: [
      'Site supervisors and trained cleaners with current police checks.',
      'Cover for absences so every site is attended each scheduled day.',
    ],
    requirements: [
      'Use of environmentally responsible products and waste practices.',
      'Compliance with work health and safety obligations, including chemical safety.',
    ],
  },
  'Security services': {
    scope: [
      'Provision of licensed guards to the agreed roster, with patrols, access control and incident reporting.',
      'Alarm response and key-holding for the nominated sites.',
    ],
    serviceLevels: [
      'Posts filled for at least 99% of rostered hours.',
      'Incidents reported to the organisation within 30 minutes.',
    ],
    personnel: [
      'Guards holding the licences required by law and current police checks.',
      'A site supervisor and a 24-hour control room contact.',
    ],
  },
  Landscaping: {
    scope: [
      'Regular maintenance of grounds, gardens and hard landscaping at the nominated sites.',
      'Seasonal programme, irrigation checks, waste removal and safe use of equipment.',
    ],
    serviceLevels: [
      'Scheduled visits completed at least 95% of the time.',
      'Hazards (fallen limbs, spills) made safe within four hours.',
    ],
  },
  Catering: {
    scope: [
      'Supply of catering to agreed menus and quantities for the nominated events and sites.',
      'Dietary and allergen management, food-safety compliance and waste reduction.',
    ],
    serviceLevels: [
      'Orders delivered within the agreed window at least 98% of the time.',
      'Allergen information provided for every item.',
    ],
  },
  'Professional services': {
    scope: [
      'Provide the advisory services described in the brief, to the agreed milestones and quality standard.',
      'Share working papers and findings with the organisation as they are produced.',
    ],
    personnel: [
      'A lead adviser with relevant experience and a named team with the skills for the work.',
      'Key personnel not changed without the organisation’s consent.',
    ],
  },
  Construction: {
    scope: [
      'Carry out the building works described in the specification, including design coordination where required.',
      'Site management, safety, quality assurance and handover with as-built documentation.',
    ],
    serviceLevels: [
      'Practical completion by the agreed date, with defects rectified within the defects period.',
    ],
    personnel: ['A site manager and supervisors with the licences and safety training the works require.'],
  },
  'Health services': {
    scope: [
      'Provide the clinical or health services described in the brief to recognised standards and the organisation’s clinical governance.',
    ],
    personnel: ['Practitioners registered with the relevant professional body, with current checks.'],
  },
};
export const profileFor = (category: string | undefined): Profile => ({
  ...GENERIC,
  ...(PROFILES[(category ?? '').replace(/\s*\(UNSPSC[^)]*\)/, '')] ?? {}),
});

// ------------------------------------------------------------------------------------------------ expand
export const EXPANSIONS: Record<string, readonly string[]> = {
  background: [
    'This document records what the organisation needs and why, so that suppliers, evaluators and approvers work from the same understanding.',
    'The need has been checked against existing arrangements and panels before going to market; any overlap will be confirmed during planning.',
  ],
  scope: [
    'Anything not listed in this scope is out of scope unless the organisation agrees to it in writing through the change process.',
    'The supplier is expected to keep the organisation informed of any issue that could affect delivery as soon as it is known.',
  ],
  objectives: [
    'Success will be judged against the objectives above at each contract review, using the reports the supplier provides.',
  ],
  requirements: [
    'Respondents must say, for each requirement, whether they meet it fully, partly or not at all, and show how.',
  ],
  deliverables: [
    'Each deliverable is accepted by the contract owner in writing; payment follows acceptance.',
  ],
  serviceLevels: [
    'Service levels are measured each month and reported by the supplier. Repeated failure to meet a service level is a ground for remedy under the contract.',
  ],
  personnel: [
    'The supplier must tell the organisation about any change to key personnel in advance and show that a replacement has the same skills.',
  ],
  timeline: [
    'Dates move together if any one date changes; the contract owner confirms revised dates in writing.',
  ],
  evaluationHints: [
    'Evaluators should score only what the response says, not what they know about the supplier, and record the reason for each score.',
  ],
  assumptions: [
    'Assumptions will be tested during planning; any that prove wrong are reported to the delegate before the tender is released.',
  ],
  risks: [
    'Risks are reviewed at each stage gate and again at each contract review, and the owner of each risk is named.',
  ],
  overview: [
    'Responses must address every section of this document; a response that leaves a section out may be treated as non-compliant.',
  ],
  conditions: [
    'The organisation may extend the closing date for all respondents by addendum, and will tell every respondent at the same time.',
  ],
  submission: [
    'Allow time to upload large files; the portal locks automatically at the closing time and no late response is accepted.',
  ],
  background_contract: [],
};

// ------------------------------------------------------------------------------------------------ tone
/**
 * [formal, plain, reversible]. Plain mode changes the first to the second. Formal mode changes the second back to the first only
 * where that is safe in any sentence (the third value): "start" or "under" would be wrong to turn into "commence" or "in
 * accordance with" everywhere, but "don't" is always "do not".
 */
export const TONE_PAIRS: ReadonlyArray<readonly [string, string, boolean]> = [
  ['commence', 'start', false],
  ['commences', 'starts', false],
  ['commencing', 'starting', false],
  ['prior to', 'before', true],
  ['in accordance with', 'under', false],
  ['utilise', 'use', false],
  ['utilises', 'uses', false],
  ['utilising', 'using', false],
  ['endeavour to', 'try to', false],
  ['ensure that', 'make sure that', false],
  ['is required to', 'must', false],
  ['are required to', 'must', false],
  ['shall', 'must', false],
  ['in the event that', 'if', false],
  ['with respect to', 'about', false],
  ['pursuant to', 'under', false],
  ['subsequent to', 'after', false],
  ['sufficient', 'enough', true],
  ['terminate', 'end', false],
  ['purchase', 'buy', true],
  ['assist', 'help', false],
  ['obtain', 'get', false],
  ['approximately', 'about', false],
  ['additional', 'more', false],
  ['demonstrate', 'show', false],
  ['facilitate', 'help with', false],
  ['remuneration', 'payment', false],
  ['notwithstanding', 'despite', false],
  ['therefore', 'so', false],
  ['do not', "don't", true],
  ['cannot', "can't", true],
  ['will not', "won't", true],
  ['it is', "it's", true],
  ['does not', "doesn't", true],
  ['is not', "isn't", true],
  ['are not', "aren't", true],
];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const caseLike = (from: string, to: string) => (/^[A-Z]/.test(from) ? sentenceCase(to) : to);
export function toned(text: string, tone: 'FORMAL' | 'PLAIN'): string {
  let out = text;
  for (const [formal, plain, reversible] of TONE_PAIRS) {
    if (tone === 'PLAIN') {
      const re = new RegExp(`\\b${esc(formal)}\\b(?!\\s+(?:order|agreement))`, 'gi');
      out = out.replace(re, (m) => caseLike(m, plain));
    } else if (reversible) {
      const re = new RegExp(`(?<![\\w'])${esc(plain)}(?![\\w'])`, 'gi');
      out = out.replace(re, (m) => caseLike(m, formal));
    }
  }
  return out;
}
