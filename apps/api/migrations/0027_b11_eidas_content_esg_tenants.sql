-- B11d: eIDAS signature levels (NFR-L03), refreshed outside content (NFR-R03), ESG and socio-economic plan targets (NFR-R05),
-- tenants, usage plans, throttling and metering (NFR-SC01).

-- NFR-L03: what each signature achieved, and the proof kept with it (document hash, method, level, IP and browser class).
CREATE TABLE signature_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  contract_id uuid NOT NULL REFERENCES contract(id),
  approval_id uuid REFERENCES approval(id),
  signer_id uuid NOT NULL REFERENCES app_user(id),
  signer_role text NOT NULL,
  method text NOT NULL CHECK (method IN ('SESSION', 'PASSWORD', 'PASSWORD_MFA', 'PROVIDER', 'QTSP')),
  level text NOT NULL CHECK (level IN ('SES', 'AES', 'QES')),
  required_level text NOT NULL CHECK (required_level IN ('SES', 'AES', 'QES')),
  provider text,
  doc_hash text NOT NULL,
  ip text,
  user_agent_class text,
  signed_at timestamptz NOT NULL,
  superseded boolean NOT NULL DEFAULT false
);
--> statement-breakpoint
CREATE INDEX signature_evidence_contract_idx ON signature_evidence (tenant_id, contract_id, signed_at);
--> statement-breakpoint
-- A contract's own required level, set by Legal with a reason (it overrides the value tiers in settings).
CREATE TABLE contract_signature_policy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  contract_id uuid NOT NULL REFERENCES contract(id),
  level text NOT NULL CHECK (level IN ('SES', 'AES', 'QES')),
  reason text NOT NULL,
  set_by uuid NOT NULL REFERENCES app_user(id),
  set_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX contract_signature_policy_uq ON contract_signature_policy (contract_id);
--> statement-breakpoint
-- The simulated qualified trust service provider is a third e-signature provider.
ALTER TABLE esign_envelope DROP CONSTRAINT esign_envelope_provider_check;
--> statement-breakpoint
ALTER TABLE esign_envelope ADD CONSTRAINT esign_envelope_provider_check CHECK (provider IN ('DOCUSIGN', 'ADOBE', 'SIMULATED_QTSP'));
--> statement-breakpoint

-- NFR-R03: outside content packs and their items. One current pack per kind per tenant; a refresh replaces the items and
-- keeps what changed in last_diff.
CREATE TABLE content_pack (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  kind text NOT NULL CHECK (kind IN ('UNSPSC_TAXONOMY', 'MARKET_BENCHMARKS', 'RISK_LIBRARY', 'CLAUSE_REFERENCE', 'ESG_REFERENCE')),
  version integer NOT NULL CHECK (version >= 0),
  source_name text NOT NULL,
  source_url text NOT NULL,
  refreshed_at timestamptz,
  valid_until timestamptz,
  status text NOT NULL CHECK (status IN ('CURRENT', 'STALE', 'FAILED')),
  item_count integer NOT NULL DEFAULT 0,
  checksum text,
  last_diff jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  last_attempt_at timestamptz,
  refreshed_by uuid REFERENCES app_user(id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX content_pack_uq ON content_pack (tenant_id, kind);
--> statement-breakpoint
CREATE TABLE content_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  pack_id uuid NOT NULL REFERENCES content_pack(id) ON DELETE CASCADE,
  kind text NOT NULL,
  item_key text NOT NULL,
  label text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE UNIQUE INDEX content_item_uq ON content_item (pack_id, item_key);
--> statement-breakpoint
CREATE INDEX content_item_kind_idx ON content_item (tenant_id, kind);
--> statement-breakpoint

-- NFR-R05: the ESG and socio-economic metrics of a plan: target or ceiling, forecast, and any exception.
CREATE TABLE plan_esg_target (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  plan_id uuid NOT NULL REFERENCES plan(id),
  metric_key text NOT NULL,
  target numeric(14, 4) NOT NULL CHECK (target >= 0),
  is_override boolean NOT NULL DEFAULT false,
  override_reason text,
  approver_note text,
  forecast numeric(14, 4) CHECK (forecast IS NULL OR forecast >= 0),
  actual numeric(14, 4),
  source text NOT NULL DEFAULT 'DEFAULT' CHECK (source IN ('DEFAULT', 'PLAN', 'OVERRIDE')),
  exception_reason text,
  exception_by uuid REFERENCES app_user(id),
  exception_at timestamptz,
  acknowledged_by uuid REFERENCES app_user(id),
  acknowledged_at timestamptz,
  updated_by uuid REFERENCES app_user(id),
  updated_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX plan_esg_target_uq ON plan_esg_target (plan_id, metric_key);
--> statement-breakpoint

-- NFR-SC01: usage plans. A null tenant_id is a platform plan; a tenant_id makes a plan only that tenant can use.
CREATE TABLE usage_plan (
  key text PRIMARY KEY,
  tenant_id uuid REFERENCES tenant(id),
  name text NOT NULL,
  requests_per_minute integer NOT NULL CHECK (requests_per_minute >= 1),
  burst integer NOT NULL CHECK (burst >= 1),
  daily_requests integer NOT NULL CHECK (daily_requests >= 1),
  monthly_ai_calls integer NOT NULL CHECK (monthly_ai_calls >= 0),
  storage_mb integer NOT NULL CHECK (storage_mb >= 1),
  max_users integer NOT NULL CHECK (max_users >= 1)
);
--> statement-breakpoint
INSERT INTO usage_plan (key, name, requests_per_minute, burst, daily_requests, monthly_ai_calls, storage_mb, max_users) VALUES
  ('STARTER', 'Starter', 120, 60, 20000, 500, 1024, 25),
  ('STANDARD', 'Standard', 1200, 2400, 500000, 20000, 20480, 250),
  ('ENTERPRISE', 'Enterprise', 12000, 60000, 5000000, 500000, 512000, 5000);
--> statement-breakpoint
CREATE TABLE tenant_usage_plan (
  tenant_id uuid PRIMARY KEY REFERENCES tenant(id),
  plan_key text NOT NULL REFERENCES usage_plan(key),
  assigned_at timestamptz NOT NULL,
  assigned_by text NOT NULL DEFAULT 'operator'
);
--> statement-breakpoint
CREATE TABLE usage_counter (
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  day date NOT NULL,
  requests integer NOT NULL DEFAULT 0,
  throttled integer NOT NULL DEFAULT 0,
  ai_calls integer NOT NULL DEFAULT 0,
  storage_bytes bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, day)
);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON signature_evidence, contract_signature_policy, content_pack, content_item, plan_esg_target, usage_plan, tenant_usage_plan, usage_counter TO app_user;
