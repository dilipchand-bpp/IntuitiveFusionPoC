-- M11 contract management: the contract record (owner, milestones, optional extensions) and the alert delivery log.
ALTER TABLE contract ADD COLUMN owner_id uuid REFERENCES app_user(id);
--> statement-breakpoint
CREATE TABLE contract_milestone (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  contract_id uuid NOT NULL REFERENCES contract(id),
  title text NOT NULL,
  due_date date NOT NULL
);
--> statement-breakpoint
CREATE TABLE contract_extension (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  contract_id uuid NOT NULL REFERENCES contract(id),
  months integer NOT NULL CHECK (months BETWEEN 1 AND 120),
  position integer NOT NULL DEFAULT 1
);
--> statement-breakpoint
CREATE TABLE alert_delivery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  alert_id uuid NOT NULL REFERENCES alert(id),
  user_id uuid NOT NULL REFERENCES app_user(id),
  channel text NOT NULL CHECK (channel IN ('IN_APP', 'EMAIL')),
  status text NOT NULL CHECK (status IN ('DELIVERED', 'SIMULATED')),
  delivered_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON contract_milestone, contract_extension, alert_delivery TO app_user;
--> statement-breakpoint
-- A system alert of one kind on one date exists once per contract (re-running creation or the scheduler never duplicates).
CREATE UNIQUE INDEX alert_system_uq ON alert (contract_id, kind, trigger_date) WHERE origin = 'SYSTEM';
