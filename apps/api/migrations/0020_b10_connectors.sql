-- B10a: connector foundation.
-- NFR-C07 connector catalogue per tenant, NFR-C05 breaker state kept on the connector, SEC-N03 local secret store with rotation,
-- NFR-AV03 retried delivery and reconciliation, SEC-TP04 rejected-attempt evidence, NFR-AV04 manual fallback tasks.
CREATE TABLE connector (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  kind text NOT NULL CHECK (kind IN ('HR', 'ERP', 'LEGAL', 'ESIGN', 'SANCTIONS', 'INSURANCE', 'DOCREPO', 'MESSAGING', 'PAYMENTS', 'MIDDLEWARE', 'AI')),
  provider text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  mode text NOT NULL DEFAULT 'UP' CHECK (mode IN ('UP', 'DOWN')),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  breaker_state text NOT NULL DEFAULT 'CLOSED' CHECK (breaker_state IN ('CLOSED', 'OPEN', 'HALF_OPEN')),
  consecutive_failures integer NOT NULL DEFAULT 0,
  breaker_opened_at timestamptz,
  last_ok_at timestamptz,
  last_error text,
  rejected_count integer NOT NULL DEFAULT 0,
  last_rejected_at timestamptz,
  last_rejected_reason text,
  updated_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX connector_uq ON connector (tenant_id, kind);
--> statement-breakpoint
CREATE TABLE secret_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  name text NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  ciphertext text NOT NULL,
  iv text NOT NULL,
  fingerprint text NOT NULL,
  created_at timestamptz NOT NULL,
  retired_at timestamptz,
  rotated_by uuid REFERENCES app_user(id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX secret_entry_uq ON secret_entry (tenant_id, name, version);
--> statement-breakpoint
CREATE TABLE sync_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  connector_kind text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('OUT', 'IN')),
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('RUNNING', 'OK', 'REPAIRED', 'PARTIAL', 'FAILED')),
  expected_count integer NOT NULL DEFAULT 0,
  received_count integer NOT NULL DEFAULT 0,
  missing jsonb NOT NULL DEFAULT '[]'::jsonb,
  repaired integer NOT NULL DEFAULT 0,
  triggered_by uuid REFERENCES app_user(id)
);
--> statement-breakpoint
CREATE INDEX sync_run_idx ON sync_run (tenant_id, started_at);
--> statement-breakpoint
CREATE TABLE manual_task (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  connector_kind text NOT NULL,
  title text NOT NULL,
  instructions text NOT NULL,
  payload_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  event_id uuid,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'DONE', 'SUPERSEDED')),
  reference text,
  created_at timestamptz NOT NULL,
  completed_by uuid REFERENCES app_user(id),
  completed_at timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX manual_task_event_uq ON manual_task (tenant_id, event_id);
--> statement-breakpoint
ALTER TABLE integration_event ADD COLUMN connector_kind text;
--> statement-breakpoint
ALTER TABLE integration_event ADD COLUMN direction text NOT NULL DEFAULT 'OUT';
--> statement-breakpoint
ALTER TABLE integration_event ADD COLUMN next_attempt_at timestamptz;
--> statement-breakpoint
ALTER TABLE integration_event ADD COLUMN remote_ack_at timestamptz;
--> statement-breakpoint
UPDATE integration_event SET connector_kind = 'LEGAL';
--> statement-breakpoint
UPDATE integration_event SET direction = 'IN' WHERE kind = 'LEGAL_WEBHOOK';
--> statement-breakpoint
UPDATE integration_event SET remote_ack_at = delivered_at WHERE status = 'DELIVERED' AND direction = 'OUT';
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON connector, secret_entry, sync_run, manual_task TO app_user;
