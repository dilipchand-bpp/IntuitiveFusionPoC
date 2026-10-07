# Hosting topology choice (SEC-D11)

**DESIGN ONLY: not built.** This page records a design for a decision. Nothing in this proof of concept deploys to a
customer cloud. What exists today is one simulated platform-hosted tenancy with the residency, egress and key controls
described in B11 (`/admin/residency`, `/app/hosting-topology`). The same content is served by
`GET /api/v1/design/hosting-topology` and drawn, with a text alternative, on `/app/hosting-topology`.

A customer chooses where the platform runs. There are three options.

## 1. Platform-hosted SaaS

Intuitive Fusion runs the application, database and object storage in one of its regions; each customer is a tenant.

```
Users --HTTPS--> [ Platform region: Application -> Database (per-tenant keys)
                                                -> Object storage (bids, documents) ]
                                    \--signed connectors--> Customer systems (ERP, HR, legal)
```

| | |
|---|---|
| Platform is responsible for | Application, database, storage, backups and patching; tenant isolation and per-tenant keys; availability, monitoring and incident response |
| Customer is responsible for | Choosing the hosting country; users, roles and delegations; connector credentials held in the platform secret store |
| Residency | Data stays in the elected country because the platform runs a region there. The customer relies on the platform to enforce it; the residency page is the evidence |
| Key management | Platform key service with a customer-managed key per tenant (rotation and revoke by the customer). The operator cannot read bids before close |
| Suits | Fastest to adopt, lowest operating effort |
| Trade-offs | Shared operations team (access under strict audit); region choice limited to regions the platform runs |

## 2. Customer cloud

The whole application runs in the customer's own cloud account from the platform's infrastructure definitions.

```
Users --HTTPS (customer edge)--> [ Customer account: Application -> Database (customer keys)
                                                                 -> Object storage (customer keys)
                                                                 -> Key service (customer-owned)
                                                    \--private network--> Customer systems ]
```

| | |
|---|---|
| Platform is responsible for | Application releases and infrastructure definitions; support, advice and security patches as versions |
| Customer is responsible for | Running the account (network, database, storage, backups, patching of the platform layer); keys in the customer's key service; availability, monitoring and incident response |
| Residency | The customer picks the region of its own account and controls it fully. The same egress and region checks run inside the deployment |
| Key management | Customer-owned keys; the vendor never holds them |
| Suits | Strict sovereignty requirements |
| Trade-offs | Highest operating effort, slower upgrades, the customer carries availability and recovery |

## 3. Hybrid

The application runs on the platform; bids, personal records and keys stay in the customer's own account.

```
Users --HTTPS--> [ Platform region: Application (workflow data) -> Gateway ]
                                                        \--writes--> [ Customer account: Sensitive store <- Key service (customer-owned) ]
```

| | |
|---|---|
| Platform is responsible for | Application, workflow data and operations on the platform side; the gateway that writes to the customer store |
| Customer is responsible for | The storage account and region for the sensitive data; keys and who may use them, including revoking access |
| Residency | Workflow data follows the platform region; the sensitive data is in the customer's country by construction. Two places to evidence instead of one |
| Key management | Customer-owned keys for the sensitive store, platform keys for the rest. Revoking the customer key makes the sensitive data unreadable at once |
| Suits | A managed service where bids and personal data cannot leave the customer's account |
| Trade-offs | Most moving parts: the gateway is a new thing to secure and keep available; latency on the sensitive-data path |

## What the controls already built mean for each option

* The `residency` setting, the outbound-path list, the egress allow-list and the cross-border refusals (NFR-R02,
  SEC-D09, SEC-D05) are application-level and apply in all three. In options 2 and 3 the customer's network adds the
  second line.
* Envelope encryption with a customer-managed key (SEC-D02 to SEC-D04) is what makes options 1 and 3 safe to offer.
* Nothing here decides the choice. The decision belongs to the customer's security and procurement leads.

## Open questions for the decision

1. Which regions will the platform operate in, and how is a region added for a customer?
2. For the hybrid option, which data classes must stay in the customer's account (the classification classes of
   SEC-D07 are a starting point)?
3. Who operates the gateway, and what is its availability objective?
