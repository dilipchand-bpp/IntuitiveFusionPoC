/**
 * SEC-D11: hosting topology choice. DESIGN ONLY: not built. This is the structured content behind the page
 * /app/hosting-topology and docs/design/hosting-topology.md. Nothing here deploys anything.
 */
export const TOPOLOGY_LABEL = 'DESIGN ONLY: not built';

export interface TopologyOption {
  id: 'PLATFORM_SAAS' | 'CUSTOMER_CLOUD' | 'HYBRID';
  name: string;
  summary: string;
  /** Plain-language description of the data flows, in order, for the text alternative of the diagram. */
  flows: string[];
  platformResponsible: string[];
  customerResponsible: string[];
  residency: string;
  keyManagement: string;
  suits: string;
  tradeOffs: string[];
}

export const TOPOLOGY: readonly TopologyOption[] = [
  {
    id: 'PLATFORM_SAAS',
    name: 'Platform-hosted SaaS',
    summary:
      'Intuitive Fusion runs the application, database and storage in one of its regions; each customer is a separate tenant.',
    flows: [
      'Users reach the application over the internet through the platform edge.',
      'The application reads and writes the tenant data in the platform database and object storage, in the region the customer elected.',
      'Connectors reach the customer systems (ERP, HR, legal platform) across the internet through the middleware, signed in both directions.',
      'Logs and audit exports stay in the elected region.',
    ],
    platformResponsible: [
      'Application, database, storage, backups and patching',
      'Tenant isolation and per-tenant keys (envelope encryption)',
      'Availability, monitoring and incident response',
    ],
    customerResponsible: [
      'Choosing the hosting country',
      'Users, roles and delegations',
      'Connector credentials held in the platform secret store',
    ],
    residency:
      'Data stays in the elected country because the platform runs a region there. The customer relies on the platform to enforce it; the residency page shows the evidence.',
    keyManagement:
      'Platform key service with a customer-managed key per tenant (rotation and revoke by the customer). The platform operator cannot read bids before close.',
    suits: 'Fastest to adopt, lowest operating effort for the customer.',
    tradeOffs: [
      'Shared operations team with access under strict audit',
      'Region choice limited to regions the platform runs',
    ],
  },
  {
    id: 'CUSTOMER_CLOUD',
    name: 'Customer cloud',
    summary:
      'The whole application runs in the customer’s own cloud account, deployed from the platform’s infrastructure definitions.',
    flows: [
      'Users reach the application through the customer’s own edge and identity provider.',
      'The application, database and storage all sit in the customer’s account and region; nothing is held by the platform.',
      'Connectors reach the customer systems over the customer’s private network.',
      'The platform vendor receives only agreed support telemetry that carries no tenant data.',
    ],
    platformResponsible: [
      'Application releases and infrastructure definitions',
      'Support, advice and security patches as versions',
    ],
    customerResponsible: [
      'Running the account: networking, database, storage, backups, patching of the platform layer',
      'Keys in the customer’s own key service',
      'Availability, monitoring and incident response',
    ],
    residency:
      'The customer picks the region of its own account and fully controls it. Cross-border risk is the customer’s to manage; the same egress and region checks run inside the deployment.',
    keyManagement: 'Customer-owned keys in the customer’s key service; the platform vendor never holds them.',
    suits: 'Strict sovereignty or classified-adjacent requirements.',
    tradeOffs: [
      'Highest operating effort and slower upgrades',
      'The customer carries availability and recovery',
    ],
  },
  {
    id: 'HYBRID',
    name: 'Hybrid',
    summary:
      'The application runs on the platform; the most sensitive data (bids, personal records, keys) stays in the customer’s own store.',
    flows: [
      'Users reach the platform-hosted application.',
      'Workflow data stays on the platform; bid files and personal records are written through a gateway to storage in the customer’s account.',
      'The customer key service wraps the keys for that storage; the platform requests a short-lived key for each use.',
      'Connectors reach the customer systems through the customer’s side of the gateway.',
    ],
    platformResponsible: [
      'Application, workflow data and operations on the platform side',
      'The gateway that writes to the customer store',
    ],
    customerResponsible: [
      'The storage account and region for the sensitive data',
      'Keys and who may use them, including revoking access',
    ],
    residency:
      'Workflow data follows the platform region; the sensitive data is in the customer’s country by construction. Two places to evidence instead of one.',
    keyManagement:
      'Customer-owned keys for the sensitive store; platform keys for the rest. Revoking the customer key makes the sensitive data unreadable at once.',
    suits: 'Customers who want a managed service but cannot let bids and personal data leave their account.',
    tradeOffs: [
      'Most moving parts: the gateway is a new thing to secure and keep available',
      'Latency on the sensitive-data path',
    ],
  },
];

export const TOPOLOGY_NOTE =
  'This is a design for a decision. It is not built and nothing in this proof of concept deploys to a customer cloud. ' +
  'What exists today is a single simulated platform-hosted tenancy with the residency, egress and key controls shown elsewhere.';
