-- B5: contract management. Rate cards and price escalation, purchase orders and invoices (the simulated ERP feed) with
-- the three-way match, rebates, holds, spend alerts, contract management and risk plans with their activities, work
-- orders under master agreements, funding envelopes, public register disclosure tasks, alert preferences and channels.
ALTER TABLE alert
  ADD COLUMN channels jsonb NOT NULL DEFAULT '["IN_APP","EMAIL"]'::jsonb,
  ADD COLUMN owner_id uuid REFERENCES app_user(id);
--> statement-breakpoint
ALTER TABLE alert_delivery DROP CONSTRAINT alert_delivery_channel_check;
--> statement-breakpoint
ALTER TABLE alert_delivery ADD CONSTRAINT alert_delivery_channel_check CHECK (channel IN ('IN_APP', 'EMAIL', 'SMS', 'SLACK'));
--> statement-breakpoint
ALTER TABLE contract
  ADD COLUMN business_case text,
  ADD COLUMN variance_pct numeric(9, 2),
  ADD COLUMN variance_model text CHECK (variance_model IN ('CUMULATIVE', 'INCREMENTAL')),
  ADD COLUMN linked_request_id uuid;
--> statement-breakpoint
ALTER TABLE contract_extension
  ADD COLUMN exercised_at timestamptz,
  ADD COLUMN exercised_request_id uuid;
--> statement-breakpoint
ALTER TABLE request
  ADD COLUMN linked_contract_id uuid REFERENCES contract(id),
  ADD COLUMN link_kind text CHECK (link_kind IN ('RENEW', 'VARY', 'EXTEND'));
--> statement-breakpoint
CREATE TABLE alert_preference (
  user_id uuid PRIMARY KEY REFERENCES app_user(id),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  muted jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE contract_rate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  contract_id uuid NOT NULL REFERENCES contract(id),
  item text NOT NULL,
  unit text NOT NULL DEFAULT 'each',
  unit_price numeric(14, 4) NOT NULL CHECK (unit_price >= 0),
  CONSTRAINT contract_rate_uq UNIQUE (contract_id, item)
);
--> statement-breakpoint
CREATE TABLE contract_escalation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  contract_id uuid NOT NULL REFERENCES contract(id),
  kind text NOT NULL CHECK (kind IN ('CPI', 'SCHEDULED')),
  effective_on date NOT NULL,
  pct numeric(7, 3) NOT NULL CHECK (pct >= 0 AND pct <= 100),
  cap_pct numeric(7, 3) CHECK (cap_pct >= 0 AND cap_pct <= 100),
  note text,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE contract_rebate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  contract_id uuid NOT NULL REFERENCES contract(id),
  title text NOT NULL,
  threshold numeric(14, 2) NOT NULL CHECK (threshold >= 0),
  rate_pct numeric(7, 3) NOT NULL CHECK (rate_pct > 0 AND rate_pct <= 100),
  period_start date NOT NULL,
  period_end date NOT NULL,
  claimed numeric(14, 2) NOT NULL DEFAULT 0,
  claimed_on date,
  followed_up_at timestamptz,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_rebate_period CHECK (period_end >= period_start)
);
--> statement-breakpoint
CREATE TABLE work_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  master_id uuid NOT NULL REFERENCES contract(id),
  number text NOT NULL,
  title text NOT NULL,
  value numeric(14, 2) NOT NULL CHECK (value >= 0),
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'COMPLETE', 'CANCELLED')),
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_order_uq UNIQUE (tenant_id, number)
);
--> statement-breakpoint
CREATE TABLE purchase_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  contract_id uuid NOT NULL REFERENCES contract(id),
  work_order_id uuid REFERENCES work_order(id),
  number text NOT NULL,
  description text NOT NULL,
  amount numeric(14, 2) NOT NULL CHECK (amount >= 0),
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL CHECK (status IN ('APPROVED', 'BLOCKED')),
  blocked_reason text,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL,
  CONSTRAINT purchase_order_uq UNIQUE (tenant_id, number)
);
--> statement-breakpoint
CREATE TABLE invoice (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  contract_id uuid NOT NULL REFERENCES contract(id),
  work_order_id uuid REFERENCES work_order(id),
  po_id uuid REFERENCES purchase_order(id),
  number text NOT NULL,
  invoice_date date NOT NULL,
  amount numeric(14, 2) NOT NULL CHECK (amount >= 0),
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL CHECK (status IN ('MATCHED', 'BLOCKED', 'EXCEPTION', 'PAID')),
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  override_by uuid REFERENCES app_user(id),
  override_reason text,
  paid_amount numeric(14, 2) NOT NULL DEFAULT 0,
  paid_on date,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL,
  CONSTRAINT invoice_uq UNIQUE (tenant_id, number)
);
--> statement-breakpoint
CREATE TABLE contract_hold (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  contract_id uuid NOT NULL REFERENCES contract(id),
  kind text NOT NULL CHECK (kind IN ('INSURANCE')),
  reason text NOT NULL,
  placed_at timestamptz NOT NULL,
  released_at timestamptz,
  release_note text
);
--> statement-breakpoint
CREATE UNIQUE INDEX contract_hold_active_uq ON contract_hold (contract_id, kind) WHERE released_at IS NULL;
--> statement-breakpoint
CREATE TABLE spend_alert (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  contract_id uuid NOT NULL REFERENCES contract(id),
  kind text NOT NULL CHECK (kind IN ('MANDATORY', 'CONFIGURED')),
  threshold integer NOT NULL,
  spent_pct numeric(9, 2) NOT NULL,
  raised_at timestamptz NOT NULL,
  CONSTRAINT spend_alert_uq UNIQUE (contract_id, kind, threshold)
);
--> statement-breakpoint
CREATE TABLE contract_plan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  contract_id uuid NOT NULL REFERENCES contract(id),
  kind text NOT NULL CHECK (kind IN ('CMP', 'RMP')),
  tier text NOT NULL CHECK (tier IN ('STANDARD', 'ELEVATED', 'HIGH')),
  template text NOT NULL,
  sections jsonb NOT NULL,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  generated_at timestamptz NOT NULL,
  generated_by uuid REFERENCES app_user(id),
  CONSTRAINT contract_plan_uq UNIQUE (contract_id, kind)
);
--> statement-breakpoint
CREATE TABLE contract_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  contract_id uuid NOT NULL REFERENCES contract(id),
  plan_kind text NOT NULL CHECK (plan_kind IN ('CMP', 'RMP')),
  title text NOT NULL,
  due_date date NOT NULL,
  owner_id uuid REFERENCES app_user(id),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'DONE')),
  done_at timestamptz,
  done_by uuid REFERENCES app_user(id),
  note text
);
--> statement-breakpoint
CREATE TABLE funding_envelope (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  name text NOT NULL,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  holder_id uuid NOT NULL REFERENCES app_user(id),
  nominees jsonb NOT NULL DEFAULT '[]'::jsonb,
  warn_pct integer NOT NULL DEFAULT 80 CHECK (warn_pct BETWEEN 1 AND 99),
  warned_at timestamptz,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CLOSED')),
  approved_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE TABLE envelope_commitment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  envelope_id uuid NOT NULL REFERENCES funding_envelope(id),
  contract_id uuid REFERENCES contract(id),
  description text NOT NULL,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  approved_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE TABLE disclosure_task (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  contract_id uuid NOT NULL REFERENCES contract(id),
  register text NOT NULL,
  variance_pct numeric(9, 2) NOT NULL,
  due_on date NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'DONE')),
  reference text,
  done_by uuid REFERENCES app_user(id),
  done_at timestamptz,
  created_at timestamptz NOT NULL,
  CONSTRAINT disclosure_task_uq UNIQUE (contract_id)
);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON alert_preference, contract_rate, contract_escalation, contract_rebate, work_order, purchase_order, invoice, contract_hold, spend_alert, contract_plan, contract_activity, funding_envelope, envelope_commitment, disclosure_task TO app_user;
