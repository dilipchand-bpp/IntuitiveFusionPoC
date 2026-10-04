-- B2: tender and supplier portal. Emails that are only simulated, who a question is answered to, late-submission
-- permissions, supplier onboarding answers, privacy and insurance, tender stages, public notices, tender-stage deviations.
CREATE TABLE outbound_email (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  kind text NOT NULL,
  ref_type text,
  ref_id uuid,
  status text NOT NULL DEFAULT 'SIMULATED',
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX outbound_email_tenant_idx ON outbound_email(tenant_id, created_at DESC);
--> statement-breakpoint
ALTER TABLE question
  ADD COLUMN audience text NOT NULL DEFAULT 'ALL' CHECK (audience IN ('ALL', 'SINGLE')),
  ADD COLUMN target_supplier_id uuid;
--> statement-breakpoint
CREATE TABLE late_permission (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  tender_id uuid NOT NULL REFERENCES tender(id),
  supplier_id uuid NOT NULL REFERENCES supplier(id),
  reason text NOT NULL,
  expires_at timestamptz NOT NULL,
  granted_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
--> statement-breakpoint
ALTER TABLE supplier
  ADD COLUMN onboarding jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN privacy jsonb NOT NULL DEFAULT '{"shareProfile": true, "productUpdates": false}',
  ADD COLUMN insurance jsonb,
  ADD COLUMN insurance_expires_on date,
  ADD COLUMN sanctions_note text;
--> statement-breakpoint
ALTER TABLE tender
  ADD COLUMN stage integer NOT NULL DEFAULT 1,
  ADD COLUMN parent_tender_id uuid REFERENCES tender(id),
  ADD COLUMN shortlist jsonb,
  ADD COLUMN shortlisted_at timestamptz;
--> statement-breakpoint
ALTER TABLE file_object ADD COLUMN carried_from uuid;
--> statement-breakpoint
CREATE TABLE public_notice (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  tender_id uuid NOT NULL REFERENCES tender(id),
  register text NOT NULL,
  reference text NOT NULL,
  status text NOT NULL DEFAULT 'SIMULATED',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT public_notice_once UNIQUE (tender_id, register)
);
--> statement-breakpoint
CREATE TABLE tender_deviation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  tender_id uuid NOT NULL REFERENCES tender(id),
  supplier_id uuid NOT NULL REFERENCES supplier(id),
  clause_ref text NOT NULL,
  proposal text NOT NULL,
  reason text,
  risk text CHECK (risk IN ('LOW', 'MEDIUM', 'HIGH')),
  legal_comment text,
  status text NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED', 'ACCEPTABLE', 'NEGOTIATE', 'REJECTED')),
  decided_by uuid REFERENCES app_user(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX tender_deviation_tender_idx ON tender_deviation(tender_id);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON outbound_email, late_permission, public_notice, tender_deviation TO app_user;
