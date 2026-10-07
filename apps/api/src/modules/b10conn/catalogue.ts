/**
 * The connector catalogue (NFR-C07): every system the platform can be connected to, by kind. In this proof of concept every
 * provider is SIMULATED: choosing SAP, Oracle, DocuSign and so on selects a deterministic stand-in with the same shape as the
 * real integration, so the flow can be shown and tested without any outside system (docs/swap-points.md).
 */
import { CONNECTOR_KINDS, type ConnectorKind } from '../../db/schema-b10a.js';

export { CONNECTOR_KINDS, type ConnectorKind };
export const CONNECTOR_MODEL = 'connectors-simulated-v1';

export interface ProviderEntry {
  id: string;
  label: string;
  /** The family of platform it belongs to, for the catalogue view. */
  family:
    | 'PROCUREMENT'
    | 'LEGAL'
    | 'ERP'
    | 'MIDDLEWARE'
    | 'HR'
    | 'SIGNATURE'
    | 'RISK'
    | 'CONTENT'
    | 'COMMS'
    | 'FINANCE'
    | 'AI';
  description: string;
  /** Always true here: nothing in this build talks to the real product. */
  simulated: true;
  /** Where the simulated vendor hosts the service: a country or region code, checked against the elected hosting country (NFR-R02, SEC-D09). */
  region: string;
  /** The simulated endpoint host, checked against the egress allow-list (SEC-D05). */
  host: string;
  /** An e-signature provider whose signatures reach the qualified level of eIDAS (NFR-L03). */
  qualified?: boolean;
}
export interface KindEntry {
  kind: ConnectorKind;
  label: string;
  description: string;
  providers: ProviderEntry[];
}

/**
 * Where each simulated vendor "hosts" its service. Most are in Australia so the demonstration works under the default
 * hosting country; a few sit overseas so that blocking and explicit allow-listing can be shown and tested (SEC-D09).
 */
export const PROVIDER_REGION: Record<string, string> = {
  ICERTIS: 'US',
  HIGHQ: 'UK',
  WORKDAY: 'US',
  SAP_SUCCESSFACTORS: 'EU',
  WORLDCHECK: 'UK',
  ARIBA: 'EU',
};
/** Simulated hosts only: every endpoint name ends in .simulated.test, which never resolves on the public internet. */
export const providerHost = (id: string) => `${id.toLowerCase().replace(/_/g, '-')}.simulated.test`;

const p = (
  id: string,
  label: string,
  family: ProviderEntry['family'],
  description: string,
): ProviderEntry => ({
  id,
  label,
  family,
  description,
  simulated: true,
  region: PROVIDER_REGION[id] ?? 'AU',
  host: providerHost(id),
});

export const CATALOGUE: KindEntry[] = [
  {
    kind: 'HR',
    label: 'HR system',
    description: 'Starters, leavers and delegate changes applied automatically (FR-0815).',
    providers: [
      p(
        'WORKDAY',
        'Workday',
        'HR',
        'Worker feed: joiners, movers and leavers, with their manager and cost centre.',
      ),
      p(
        'SAP_SUCCESSFACTORS',
        'SAP SuccessFactors',
        'HR',
        'Employee central feed and organisation structure.',
      ),
      p('SIMULATED_HR', 'Simulated HR feed', 'HR', 'A synthetic worker feed used for the demonstration.'),
    ],
  },
  {
    kind: 'ERP',
    label: 'ERP and finance',
    description:
      'Budget, ledger, cost centre and organisation data (NFR-C02), and procurement platforms alongside it.',
    providers: [
      p(
        'SAP',
        'SAP S/4HANA',
        'ERP',
        'Budget, ledger, cost centre and organisation sync, and purchase order creation.',
      ),
      p('ORACLE', 'Oracle Fusion Cloud ERP', 'ERP', 'Budget, ledger, cost centre and organisation sync.'),
      p(
        'DYNAMICS',
        'Microsoft Dynamics 365 Finance',
        'ERP',
        'Budget, ledger, cost centre and organisation sync.',
      ),
      p(
        'COUPA',
        'Coupa',
        'PROCUREMENT',
        'Procurement platform: requisitions, orders and catalogues kept in step.',
      ),
      p(
        'ARIBA',
        'SAP Ariba',
        'PROCUREMENT',
        'Procurement network: supplier records and sourcing events kept in step.',
      ),
      p(
        'SIMULATED_ERP',
        'Simulated ERP',
        'ERP',
        'Synthetic budgets and cost centres used for the demonstration.',
      ),
    ],
  },
  {
    kind: 'LEGAL',
    label: 'Legal platform',
    description:
      'Matters raised on the customer legal platform and stage updates and redlines returned by webhook (NFR-C03).',
    providers: [
      p(
        'HIGHQ',
        'HighQ',
        'LEGAL',
        'Opens a matter for each legal matter and returns stage changes and redlines.',
      ),
      p(
        'ICERTIS',
        'Icertis',
        'LEGAL',
        'Contract lifecycle platform: matters, clause libraries and redlines.',
      ),
      p(
        'SIMULATED_LEGAL',
        'Simulated legal platform',
        'LEGAL',
        'A deterministic stand-in that returns a matter reference.',
      ),
    ],
  },
  {
    kind: 'ESIGN',
    label: 'Electronic signature',
    description: 'Signature requests with the signatories already filled in (NFR-C04).',
    providers: [
      p('DOCUSIGN', 'DocuSign', 'SIGNATURE', 'Envelopes with signatories pre-filled from the contract.'),
      p(
        'ADOBE',
        'Adobe Acrobat Sign',
        'SIGNATURE',
        'Agreements with signatories pre-filled from the contract.',
      ),
      p(
        'SIMULATED_ESIGN',
        'Simulated e-signature',
        'SIGNATURE',
        'In-platform signing used for the demonstration.',
      ),
      {
        ...p(
          'SIMULATED_QTSP',
          'Simulated qualified trust service provider',
          'SIGNATURE',
          'A stand-in for a qualified provider: its signatures reach the qualified level (QES) of eIDAS.',
        ),
        qualified: true,
      },
    ],
  },
  {
    kind: 'SANCTIONS',
    label: 'Sanctions screening',
    description: 'Watchlist screening of suppliers, behind the resilient API layer (NFR-C05).',
    providers: [
      p('WORLDCHECK', 'World-Check style list service', 'RISK', 'Commercial watchlist screening service.'),
      p(
        'SIMULATED_SANCTIONS',
        'Simulated sanctions list',
        'RISK',
        'A small synthetic watchlist; a name containing "Sanctioned" matches.',
      ),
    ],
  },
  {
    kind: 'INSURANCE',
    label: 'Insurance verification',
    description:
      'Confirms a supplier insurance policy with the insurer, behind the resilient API layer (NFR-C05).',
    providers: [
      p(
        'INSURER_REGISTRY',
        'Insurer verification service',
        'RISK',
        'Policy and cover confirmation from the insurer.',
      ),
      p(
        'SIMULATED_INSURANCE',
        'Simulated insurance check',
        'RISK',
        'Deterministic: a name containing "Lapsed" or "Uninsured" fails.',
      ),
    ],
  },
  {
    kind: 'DOCREPO',
    label: 'Document repository',
    description: 'Read and write to the enterprise document repository (NFR-C06).',
    providers: [
      p('SHAREPOINT', 'Microsoft SharePoint', 'CONTENT', 'Libraries for contract documents, read and write.'),
      p(
        'SIMULATED_DOCREPO',
        'Simulated repository',
        'CONTENT',
        'An in-memory library used for the demonstration.',
      ),
    ],
  },
  {
    kind: 'MESSAGING',
    label: 'Messaging gateway',
    description: 'Business-continuity alerts by SMS and email with response tracking (FR-0860).',
    providers: [
      p(
        'SIMULATED_MESSAGING',
        'Simulated SMS and email gateway',
        'COMMS',
        'Messages are recorded, never sent.',
      ),
    ],
  },
  {
    kind: 'PAYMENTS',
    label: 'Payments',
    description: 'Payment execution through a finance system (FR-0875).',
    providers: [
      p('SIMULATED_PAYMENTS', 'Simulated payment run', 'FINANCE', 'Payments are recorded, no money moves.'),
    ],
  },
  {
    kind: 'MIDDLEWARE',
    label: 'Integration middleware',
    description:
      'The integration platform between this system and the customer systems; every leg is signed (SEC-TP04).',
    providers: [
      p(
        'MULESOFT',
        'MuleSoft Anypoint',
        'MIDDLEWARE',
        'API-led integration platform; signed webhooks both ways.',
      ),
      p('BOOMI', 'Boomi', 'MIDDLEWARE', 'iPaaS: process orchestration; signed webhooks both ways.'),
      p(
        'AZURE_INTEGRATION',
        'Azure Integration Services',
        'MIDDLEWARE',
        'Logic Apps and Service Bus; signed webhooks both ways.',
      ),
      p(
        'SIMULATED_MIDDLEWARE',
        'Simulated middleware',
        'MIDDLEWARE',
        'An in-process stand-in that signs and verifies messages.',
      ),
      p(
        'SIMULATED_CONTENT',
        'Simulated outside content source',
        'CONTENT',
        'Delivers the refreshed outside content packs (taxonomy, benchmarks, risk library) through the resilient call layer.',
      ),
    ],
  },
  {
    kind: 'AI',
    label: 'AI models',
    description: 'The language models the assistant may use; managed on the AI model registry.',
    providers: [
      p('SIMULATED_AI', 'Simulated AI (rules-simulated-v1)', 'AI', 'Deterministic rules, no model call.'),
    ],
  },
];

export const kindEntry = (kind: string): KindEntry | undefined => CATALOGUE.find((k) => k.kind === kind);
export const providerEntry = (kind: string, id: string): ProviderEntry | undefined =>
  kindEntry(kind)?.providers.find((x) => x.id === id);

/** What a new tenant gets: everything simulated, switched on where the application already simulates it. */
export const DEFAULT_CONNECTORS: Array<{ kind: ConnectorKind; provider: string; enabled: boolean }> = [
  { kind: 'HR', provider: 'SIMULATED_HR', enabled: false },
  { kind: 'ERP', provider: 'SIMULATED_ERP', enabled: true },
  { kind: 'LEGAL', provider: 'SIMULATED_LEGAL', enabled: true },
  { kind: 'ESIGN', provider: 'SIMULATED_ESIGN', enabled: true },
  { kind: 'SANCTIONS', provider: 'SIMULATED_SANCTIONS', enabled: true },
  { kind: 'INSURANCE', provider: 'SIMULATED_INSURANCE', enabled: true },
  { kind: 'DOCREPO', provider: 'SIMULATED_DOCREPO', enabled: false },
  { kind: 'MESSAGING', provider: 'SIMULATED_MESSAGING', enabled: true },
  { kind: 'PAYMENTS', provider: 'SIMULATED_PAYMENTS', enabled: false },
  { kind: 'MIDDLEWARE', provider: 'SIMULATED_MIDDLEWARE', enabled: true },
  { kind: 'AI', provider: 'SIMULATED_AI', enabled: true },
];
