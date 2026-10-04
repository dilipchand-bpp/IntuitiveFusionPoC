-- B4: contract award and legal. Other signing documents, signing modes, tender and vendor checks, endorsements,
-- signing invitations and questions, clause comments, amended drafts, the legal knowledge base, legal matters with
-- review hours, risk summaries and time-bound access grants.
ALTER TABLE contract
  ADD COLUMN doc_type text NOT NULL DEFAULT 'CONTRACT' CHECK (doc_type IN ('CONTRACT', 'NDA', 'CONFIDENTIALITY', 'MASTER')),
  ADD COLUMN signing_mode text NOT NULL DEFAULT 'STANDARD' CHECK (signing_mode IN ('STANDARD', 'BLIND', 'STAGED')),
  ADD COLUMN title text,
  ADD COLUMN released_at timestamptz;
--> statement-breakpoint
ALTER TABLE clause
  ADD COLUMN edited_by uuid REFERENCES app_user(id),
  ADD COLUMN edited_at timestamptz;
--> statement-breakpoint
ALTER TABLE supplier ADD COLUMN bank jsonb;
--> statement-breakpoint
CREATE TABLE contract_check (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  contract_id uuid NOT NULL REFERENCES contract(id),
  kind text NOT NULL CHECK (kind IN ('TENDER_CONSISTENCY', 'VENDOR_PREFLIGHT', 'RECHECK')),
  check_key text NOT NULL,
  result text NOT NULL CHECK (result IN ('PASS', 'WARN', 'FAIL', 'REVIEWED')),
  detail text NOT NULL,
  reviewed_by uuid REFERENCES app_user(id),
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_check_uq UNIQUE (contract_id, kind, check_key)
);
--> statement-breakpoint
CREATE TABLE contract_endorsement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  contract_id uuid NOT NULL REFERENCES contract(id),
  role text NOT NULL,
  user_id uuid NOT NULL REFERENCES app_user(id),
  comment text,
  decided_at timestamptz NOT NULL,
  CONSTRAINT contract_endorsement_uq UNIQUE (contract_id, role)
);
--> statement-breakpoint
CREATE TABLE signing_invitation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  contract_id uuid NOT NULL REFERENCES contract(id),
  user_id uuid REFERENCES app_user(id),
  supplier_id uuid REFERENCES supplier(id),
  email text NOT NULL,
  name text NOT NULL,
  role_label text NOT NULL,
  invited_at timestamptz NOT NULL,
  reminded_at timestamptz,
  reminder_count integer NOT NULL DEFAULT 0,
  viewed_at timestamptz
);
--> statement-breakpoint
CREATE INDEX signing_invitation_contract_idx ON signing_invitation(contract_id);
--> statement-breakpoint
CREATE TABLE contract_question (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  contract_id uuid NOT NULL REFERENCES contract(id),
  asked_by uuid NOT NULL REFERENCES app_user(id),
  side text NOT NULL CHECK (side IN ('INTERNAL', 'SUPPLIER')),
  clause_id text,
  question text NOT NULL,
  answer text,
  answered_by uuid REFERENCES app_user(id),
  answered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE contract_comment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  contract_id uuid NOT NULL REFERENCES contract(id),
  clause_id text,
  user_id uuid NOT NULL REFERENCES app_user(id),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE contract_file (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  contract_id uuid NOT NULL REFERENCES contract(id),
  kind text NOT NULL CHECK (kind IN ('AMENDED_DRAFT')),
  name text NOT NULL,
  size_bytes integer NOT NULL,
  content_type text NOT NULL,
  storage_key text NOT NULL,
  sha256 text NOT NULL,
  version integer NOT NULL,
  note text,
  uploaded_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE legal_knowledge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  kind text NOT NULL CHECK (kind IN ('POLICY', 'ADVICE', 'FALLBACK', 'BOILERPLATE')),
  title text NOT NULL,
  body text NOT NULL,
  clause_id text,
  tags text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE legal_matter (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  title text NOT NULL,
  contract_id uuid REFERENCES contract(id),
  lane text NOT NULL DEFAULT 'NEW' CHECK (lane IN ('NEW', 'IN_REVIEW', 'WAITING', 'DONE')),
  priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH')),
  assignee_id uuid REFERENCES app_user(id),
  due_on date,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE legal_time_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  matter_id uuid NOT NULL REFERENCES legal_matter(id),
  user_id uuid NOT NULL REFERENCES app_user(id),
  hours numeric(5, 2) NOT NULL CHECK (hours > 0 AND hours <= 24),
  work_date date NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE contract_risk_summary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  contract_id uuid NOT NULL REFERENCES contract(id),
  generated jsonb NOT NULL,
  edited text,
  generated_at timestamptz NOT NULL,
  reviewed_by uuid REFERENCES app_user(id),
  reviewed_at timestamptz,
  CONSTRAINT contract_risk_summary_uq UNIQUE (contract_id)
);
--> statement-breakpoint
CREATE TABLE access_grant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  user_id uuid NOT NULL REFERENCES app_user(id),
  tender_id uuid NOT NULL REFERENCES tender(id),
  label text NOT NULL CHECK (label IN ('COMMITTEE', 'AUDITOR', 'ADVISOR')),
  expires_on date,
  event text CHECK (event IN ('CONTRACT_SIGNED', 'REPORT_APPROVED')),
  event_days integer NOT NULL DEFAULT 0 CHECK (event_days BETWEEN 0 AND 3650),
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_reason text,
  CONSTRAINT access_grant_ends CHECK (expires_on IS NOT NULL OR event IS NOT NULL)
);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON contract_check, contract_endorsement, signing_invitation, contract_question, contract_comment, contract_file, legal_knowledge, legal_matter, legal_time_entry, contract_risk_summary, access_grant TO app_user;
