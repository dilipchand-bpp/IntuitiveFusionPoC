-- B10b: ERP sync (NFR-C02), legal system status sync (NFR-C03), HR feed (FR-0815), payment execution (FR-0875).
-- NFR-C02 imported cost centres, organisation units, budget lines and ledger postings, upserted by external id.
CREATE TABLE cost_centre (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  external_id text NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  org_unit_external_id text,
  owner_name text,
  active boolean NOT NULL DEFAULT true,
  provider text NOT NULL,
  hash text NOT NULL,
  first_seen_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  removed_at timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX cost_centre_uq ON cost_centre (tenant_id, external_id);
--> statement-breakpoint
CREATE TABLE erp_org_unit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  external_id text NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  parent_external_id text,
  active boolean NOT NULL DEFAULT true,
  provider text NOT NULL,
  hash text NOT NULL,
  first_seen_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  removed_at timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX erp_org_unit_uq ON erp_org_unit (tenant_id, external_id);
--> statement-breakpoint
CREATE TABLE erp_budget_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  external_id text NOT NULL,
  cost_centre_external_id text NOT NULL,
  financial_year text NOT NULL,
  category text,
  amount numeric(16, 2) NOT NULL,
  currency text NOT NULL DEFAULT 'AUD',
  provider text NOT NULL,
  hash text NOT NULL,
  first_seen_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  removed_at timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX erp_budget_line_uq ON erp_budget_line (tenant_id, external_id);
--> statement-breakpoint
CREATE INDEX erp_budget_line_cc_idx ON erp_budget_line (tenant_id, cost_centre_external_id, financial_year);
--> statement-breakpoint
CREATE TABLE ledger_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  external_id text NOT NULL,
  cost_centre_external_id text NOT NULL,
  posting_date date NOT NULL,
  financial_year text NOT NULL,
  account text NOT NULL,
  description text NOT NULL DEFAULT '',
  amount numeric(16, 2) NOT NULL,
  kind text NOT NULL DEFAULT 'ACTUAL' CHECK (kind IN ('ACTUAL', 'COMMITMENT')),
  currency text NOT NULL DEFAULT 'AUD',
  provider text NOT NULL,
  hash text NOT NULL,
  first_seen_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  removed_at timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX ledger_entry_uq ON ledger_entry (tenant_id, external_id);
--> statement-breakpoint
CREATE INDEX ledger_entry_cc_idx ON ledger_entry (tenant_id, cost_centre_external_id, financial_year);
--> statement-breakpoint
-- one row per ERP import: what changed, beside the generic sync_run row
CREATE TABLE erp_sync (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  sync_run_id uuid REFERENCES sync_run(id),
  provider text NOT NULL,
  source_revision integer NOT NULL DEFAULT 1,
  financial_year text NOT NULL,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('OK', 'FAILED')),
  error text,
  triggered_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX erp_sync_idx ON erp_sync (tenant_id, created_at);
--> statement-breakpoint
-- NFR-C03 where the customer's legal system says a matter stands, beside the board lane
CREATE TABLE legal_matter_sync (
  matter_id uuid PRIMARY KEY REFERENCES legal_matter(id),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  stage text,
  closed_at timestamptz,
  outcome text,
  last_event_id text,
  updated_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE TABLE legal_matter_document (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  matter_id uuid NOT NULL REFERENCES legal_matter(id),
  external_id text NOT NULL,
  name text NOT NULL,
  doc_kind text,
  event_id text NOT NULL,
  attached_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX legal_matter_document_uq ON legal_matter_document (tenant_id, external_id);
--> statement-breakpoint
-- FR-0815 HR feed batches, every event with its outcome, time-bound delegate changes, and work handed to a named backup
CREATE TABLE hr_feed_batch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  batch_ref text NOT NULL,
  provider text NOT NULL,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  triggered_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX hr_feed_batch_uq ON hr_feed_batch (tenant_id, batch_ref);
--> statement-breakpoint
CREATE TABLE hr_feed_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  batch_id uuid NOT NULL REFERENCES hr_feed_batch(id),
  event_id text NOT NULL,
  type text NOT NULL CHECK (type IN ('STARTER', 'LEAVER', 'ROLE_CHANGE', 'DELEGATE_CHANGE')),
  subject_email text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  outcome text NOT NULL CHECK (outcome IN ('APPLIED', 'NO_CHANGE', 'CAPPED', 'REFUSED', 'NEEDS_HUMAN')),
  detail text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX hr_feed_event_uq ON hr_feed_event (tenant_id, event_id);
--> statement-breakpoint
CREATE TABLE hr_delegate_change (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  event_id text NOT NULL,
  delegator_id uuid NOT NULL REFERENCES app_user(id),
  delegate_id uuid NOT NULL REFERENCES app_user(id),
  scope text NOT NULL,
  requested_limit numeric(14, 2) NOT NULL,
  applied_limit numeric(14, 2) NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  status text NOT NULL CHECK (status IN ('SCHEDULED', 'ACTIVE', 'EXPIRED')),
  delegation_id uuid,
  created_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX hr_delegate_change_uq ON hr_delegate_change (tenant_id, event_id);
--> statement-breakpoint
CREATE TABLE hr_reassignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  leaver_id uuid NOT NULL REFERENCES app_user(id),
  backup_id uuid REFERENCES app_user(id),
  kind text NOT NULL CHECK (kind IN ('DELEGATION', 'REQUEST', 'CONTRACT')),
  ref_id uuid NOT NULL,
  label text NOT NULL,
  event_id text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'DONE')),
  created_at timestamptz NOT NULL,
  done_by uuid REFERENCES app_user(id),
  done_at timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX hr_reassignment_uq ON hr_reassignment (tenant_id, kind, ref_id, leaver_id);
--> statement-breakpoint
-- FR-0875 payments for matched invoices, sent to the finance system through the PAYMENTS connector
CREATE TABLE payment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  invoice_id uuid NOT NULL REFERENCES invoice(id),
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'AUD',
  status text NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED', 'APPROVED', 'SENT', 'CONFIRMED', 'FAILED', 'CANCELLED')),
  finance_ref text,
  idempotency_key text NOT NULL,
  created_by uuid NOT NULL REFERENCES app_user(id),
  approved_by uuid REFERENCES app_user(id),
  approved_at timestamptz,
  sent_at timestamptz,
  confirmed_at timestamptz,
  failure_reason text,
  simulate_failure boolean NOT NULL DEFAULT false,
  attempts integer NOT NULL DEFAULT 0,
  event_id uuid,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX payment_idem_uq ON payment (tenant_id, idempotency_key);
--> statement-breakpoint
CREATE INDEX payment_invoice_idx ON payment (invoice_id);
--> statement-breakpoint
CREATE TABLE payment_trail (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  payment_id uuid NOT NULL REFERENCES payment(id),
  at timestamptz NOT NULL,
  status text NOT NULL,
  actor_id uuid REFERENCES app_user(id),
  note text NOT NULL DEFAULT ''
);
--> statement-breakpoint
CREATE INDEX payment_trail_idx ON payment_trail (payment_id, at);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON cost_centre, erp_org_unit, erp_budget_line, ledger_entry, erp_sync, legal_matter_sync, legal_matter_document, hr_feed_batch, hr_feed_event, hr_delegate_change, hr_reassignment, payment, payment_trail TO app_user;
