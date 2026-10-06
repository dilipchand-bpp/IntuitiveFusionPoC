-- FR-0830 a one-time link for an outside law firm or a supplier's legal team, scoped to one contract.
CREATE TABLE counsel_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  contract_id uuid NOT NULL REFERENCES contract(id),
  token_hash text NOT NULL UNIQUE,
  name text NOT NULL,
  email text NOT NULL,
  party text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL
);
--> statement-breakpoint
-- NFR-L02 an overdue disclosure is escalated once.
ALTER TABLE disclosure_task ADD COLUMN escalated_at timestamptz;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON counsel_link TO app_user;
