-- B11b (privacy, residency, egress, classification, prompt-injection flags, breach response).
-- NFR-R02, SEC-D09 (residency), SEC-D05 (egress), SEC-D06 (AI conversation retention), SEC-D07 (classification),
-- SEC-D08 (Privacy Act requests), SEC-AP08 (content flags), SEC-IR05 (breach incidents).

-- A transfer that was refused: either the target region is outside the elected country (RESIDENCY) or the host is not
-- on the egress allow-list (EGRESS). Only the target, purpose and reason are kept, never the content of the transfer.
CREATE TABLE outbound_refusal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  kind text NOT NULL CHECK (kind IN ('RESIDENCY', 'EGRESS')),
  purpose text NOT NULL,
  target text NOT NULL,
  region text,
  elected_country text,
  reason text NOT NULL,
  actor_id uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX outbound_refusal_idx ON outbound_refusal (tenant_id, created_at);
--> statement-breakpoint
-- Retention class and region stamp for an AI conversation (intake chat transcripts).
CREATE TABLE conversation_meta (
  conversation_id uuid PRIMARY KEY REFERENCES conversation(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  retention_class text NOT NULL DEFAULT 'AI_CONVERSATION',
  region text NOT NULL,
  stamped_at timestamptz NOT NULL,
  anonymised_at timestamptz
);
--> statement-breakpoint
CREATE INDEX conversation_meta_idx ON conversation_meta (tenant_id, stamped_at);
--> statement-breakpoint
-- Legal hold: a held request or conversation is never purged while the hold is open.
CREATE TABLE legal_hold (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  entity_type text NOT NULL CHECK (entity_type IN ('REQUEST', 'CONVERSATION')),
  entity_id uuid NOT NULL,
  reason text NOT NULL,
  placed_by uuid NOT NULL REFERENCES app_user(id),
  placed_at timestamptz NOT NULL,
  released_by uuid REFERENCES app_user(id),
  released_at timestamptz,
  release_reason text
);
--> statement-breakpoint
CREATE UNIQUE INDEX legal_hold_open_uq ON legal_hold (tenant_id, entity_type, entity_id) WHERE released_at IS NULL;
--> statement-breakpoint
CREATE TABLE retention_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  ran_at timestamptz NOT NULL,
  ran_by uuid REFERENCES app_user(id),
  trigger text NOT NULL CHECK (trigger IN ('MANUAL', 'SCHEDULED')),
  retention_days integer NOT NULL,
  expired integer NOT NULL DEFAULT 0,
  anonymised integer NOT NULL DEFAULT 0,
  messages_cleared integer NOT NULL DEFAULT 0,
  skipped_held integer NOT NULL DEFAULT 0,
  held jsonb NOT NULL DEFAULT '[]'::jsonb
);
--> statement-breakpoint
CREATE INDEX retention_run_idx ON retention_run (tenant_id, ran_at);
--> statement-breakpoint
-- SEC-D07: what the classifier found and where. The sensitive value itself is never stored, only a masked sample.
CREATE TABLE data_classification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  field text NOT NULL,
  class text NOT NULL CHECK (class IN ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'SENSITIVE_PERSONAL', 'FINANCIAL')),
  detectors jsonb NOT NULL DEFAULT '[]'::jsonb,
  masked_sample text,
  content_hash text NOT NULL,
  warning text,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CONFIRMED', 'DISMISSED')),
  reviewed_by uuid REFERENCES app_user(id),
  reviewed_at timestamptz,
  review_reason text,
  model text NOT NULL,
  first_seen_at timestamptz NOT NULL,
  scanned_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX data_classification_uq ON data_classification (tenant_id, entity_type, entity_id, field);
--> statement-breakpoint
CREATE INDEX data_classification_class_idx ON data_classification (tenant_id, class, status);
--> statement-breakpoint
-- SEC-D08: which collection-notice version a person acknowledged, and where.
CREATE TABLE privacy_notice_ack (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  user_id uuid NOT NULL REFERENCES app_user(id),
  context text NOT NULL CHECK (context IN ('SUPPLIER_REGISTRATION', 'USER_ACTIVATION', 'REQUEST_INTAKE', 'PRIVACY_PAGE')),
  version text NOT NULL,
  acknowledged_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX privacy_notice_ack_uq ON privacy_notice_ack (user_id, context, version);
--> statement-breakpoint
CREATE TABLE privacy_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  number text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('ACCESS', 'CORRECTION')),
  requester_user_id uuid REFERENCES app_user(id),
  requester_name text NOT NULL,
  requester_email text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('SELF', 'STAFF_LOGGED')),
  lodged_by uuid REFERENCES app_user(id),
  details text NOT NULL,
  correction_field text CHECK (correction_field IN ('name', 'email')),
  correction_value text,
  correction_applied boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED', 'IN_PROGRESS', 'COMPLETED', 'REFUSED')),
  due_date date NOT NULL,
  assigned_to uuid REFERENCES app_user(id),
  identity_verified boolean NOT NULL DEFAULT false,
  verification_method text,
  verified_by uuid REFERENCES app_user(id),
  verified_at timestamptz,
  response_summary text,
  refusal_reason text,
  export_generated_at timestamptz,
  escalated_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX privacy_request_number_uq ON privacy_request (tenant_id, number);
--> statement-breakpoint
CREATE INDEX privacy_request_status_idx ON privacy_request (tenant_id, status, due_date);
--> statement-breakpoint
-- SEC-AP08: supplier or uploaded text that contained instruction-like content when it reached an AI-labelled path.
CREATE TABLE content_flag (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  source text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  excerpt text NOT NULL,
  actor_id uuid REFERENCES app_user(id),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'REVIEWED')),
  reviewed_by uuid REFERENCES app_user(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX content_flag_idx ON content_flag (tenant_id, created_at);
--> statement-breakpoint
-- SEC-IR05: a data breach incident and its assessment, containment, notification drafts and lessons.
CREATE TABLE breach_incident (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  number text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  reported_by uuid NOT NULL REFERENCES app_user(id),
  reported_at timestamptz NOT NULL,
  discovered_at timestamptz NOT NULL,
  data_kinds jsonb NOT NULL DEFAULT '[]'::jsonb,
  individuals_count integer NOT NULL DEFAULT 0 CHECK (individuals_count >= 0),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ASSESSING', 'NOTIFIED', 'CLOSED')),
  assessment jsonb,
  containment jsonb NOT NULL DEFAULT '[]'::jsonb,
  assessment_due date NOT NULL,
  notifications jsonb NOT NULL DEFAULT '[]'::jsonb,
  reminders jsonb NOT NULL DEFAULT '[]'::jsonb,
  escalated_at timestamptz,
  lessons text,
  closed_at timestamptz,
  closed_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX breach_incident_number_uq ON breach_incident (tenant_id, number);
--> statement-breakpoint
CREATE INDEX breach_incident_status_idx ON breach_incident (tenant_id, status, assessment_due);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON outbound_refusal, conversation_meta, legal_hold, retention_run, data_classification, privacy_notice_ack, privacy_request, content_flag, breach_incident TO app_user;
