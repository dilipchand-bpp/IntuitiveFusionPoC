-- B10c: e-signature envelopes (NFR-C04), simulated document repository (NFR-C06), business-continuity alerts (FR-0860).
CREATE TABLE esign_envelope (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  contract_id uuid NOT NULL REFERENCES contract(id),
  provider text NOT NULL CHECK (provider IN ('DOCUSIGN', 'ADOBE')),
  external_id text NOT NULL,
  status text NOT NULL DEFAULT 'SENT' CHECK (status IN ('SENT', 'COMPLETED', 'DECLINED', 'VOIDED', 'EXPIRED')),
  signing_mode text NOT NULL CHECK (signing_mode IN ('STANDARD', 'BLIND', 'STAGED')),
  provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  closed_reason text,
  created_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX esign_envelope_contract_idx ON esign_envelope (tenant_id, contract_id);
--> statement-breakpoint
CREATE UNIQUE INDEX esign_envelope_external_uq ON esign_envelope (tenant_id, external_id);
--> statement-breakpoint
CREATE TABLE esign_signatory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  envelope_id uuid NOT NULL REFERENCES esign_envelope(id),
  user_id uuid NOT NULL REFERENCES app_user(id),
  role text NOT NULL,
  role_label text NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  routing_order integer NOT NULL DEFAULT 1,
  recipient_ref text NOT NULL,
  status text NOT NULL DEFAULT 'SENT' CHECK (status IN ('CREATED', 'SENT', 'DELIVERED', 'VIEWED', 'SIGNED', 'DECLINED', 'VOIDED', 'EXPIRED')),
  token_hash text NOT NULL,
  token_expires_at timestamptz NOT NULL,
  decline_reason text,
  signed_at timestamptz,
  updated_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX esign_signatory_token_uq ON esign_signatory (token_hash);
--> statement-breakpoint
CREATE INDEX esign_signatory_env_idx ON esign_signatory (envelope_id);
--> statement-breakpoint
CREATE TABLE esign_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  envelope_id uuid NOT NULL REFERENCES esign_envelope(id),
  signatory_id uuid REFERENCES esign_signatory(id),
  event_id text NOT NULL,
  type text NOT NULL,
  provider_type text,
  source text NOT NULL CHECK (source IN ('PLATFORM', 'PROVIDER')),
  outcome text NOT NULL CHECK (outcome IN ('APPLIED', 'DUPLICATE', 'IGNORED', 'REFUSED')),
  detail text,
  created_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX esign_event_uq ON esign_event (tenant_id, event_id);
--> statement-breakpoint
CREATE INDEX esign_event_env_idx ON esign_event (envelope_id, created_at);
--> statement-breakpoint
CREATE TABLE repo_document (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  request_id uuid NOT NULL REFERENCES request(id),
  folder text NOT NULL,
  name text NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  checksum text NOT NULL,
  size_bytes integer NOT NULL,
  content_type text NOT NULL,
  content_base64 text NOT NULL,
  comment text,
  source text NOT NULL DEFAULT 'UPLOAD' CHECK (source IN ('UPLOAD', 'PLATFORM')),
  source_ref text,
  created_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX repo_document_version_uq ON repo_document (tenant_id, request_id, folder, name, version);
--> statement-breakpoint
CREATE INDEX repo_document_project_idx ON repo_document (tenant_id, request_id);
--> statement-breakpoint
CREATE TABLE continuity_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  number text NOT NULL,
  title text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('SUPPLIER_OUTAGE', 'SITE_CLOSURE', 'CYBER_INCIDENT', 'OTHER')),
  severity text NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  message text NOT NULL,
  sms_text text NOT NULL,
  email_subject text NOT NULL,
  affected_supplier_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  affected_contract_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  groups jsonb NOT NULL DEFAULT '[]'::jsonb,
  escalate_after_minutes integer NOT NULL DEFAULT 30,
  escalate_to_user_id uuid REFERENCES app_user(id),
  escalated_at timestamptz,
  response_valid_hours integer NOT NULL DEFAULT 48,
  raised_by uuid NOT NULL REFERENCES app_user(id),
  raised_at timestamptz NOT NULL,
  closed_by uuid REFERENCES app_user(id),
  closed_at timestamptz,
  summary text
);
--> statement-breakpoint
CREATE UNIQUE INDEX continuity_event_number_uq ON continuity_event (tenant_id, number);
--> statement-breakpoint
CREATE TABLE continuity_response (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  event_id uuid NOT NULL REFERENCES continuity_event(id),
  user_id uuid REFERENCES app_user(id),
  name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  group_key text NOT NULL CHECK (group_key IN ('CONTRACT_OWNER', 'SUPPLIER_CONTACT', 'EXECUTIVE', 'NAMED')),
  organisation text,
  token_hash text NOT NULL,
  token_expires_at timestamptz NOT NULL,
  response text NOT NULL DEFAULT 'NONE' CHECK (response IN ('NONE', 'SAFE', 'AFFECTED', 'NEED_HELP')),
  note text,
  via text CHECK (via IN ('WEB_LINK', 'STAFF_PHONE')),
  responded_at timestamptz,
  recorded_by uuid REFERENCES app_user(id),
  change_count integer NOT NULL DEFAULT 0,
  history jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX continuity_response_token_uq ON continuity_response (token_hash);
--> statement-breakpoint
CREATE INDEX continuity_response_event_idx ON continuity_response (tenant_id, event_id);
--> statement-breakpoint
CREATE TABLE continuity_message (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  event_id uuid NOT NULL REFERENCES continuity_event(id),
  response_id uuid REFERENCES continuity_response(id),
  to_name text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('SMS', 'EMAIL')),
  to_address text NOT NULL,
  subject text,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'SENT', 'DELIVERED', 'FAILED')),
  gateway_id text,
  failure text,
  kind text NOT NULL DEFAULT 'ALERT' CHECK (kind IN ('ALERT', 'REMINDER', 'ESCALATION')),
  attempt integer NOT NULL DEFAULT 1,
  queued_at timestamptz NOT NULL,
  sent_at timestamptz,
  delivered_at timestamptz
);
--> statement-breakpoint
CREATE INDEX continuity_message_event_idx ON continuity_message (tenant_id, event_id);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON esign_envelope, esign_signatory, esign_event, repo_document, continuity_event, continuity_response, continuity_message TO app_user;
