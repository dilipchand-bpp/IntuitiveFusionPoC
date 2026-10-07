-- B11c: audit integrity and auditor evidence, access monitoring, configuration compliance, access policies, bank details.
-- SEC-L02 (administrative actions flagged and chained), SEC-L07 + NFR-R06 (evidence pack), SEC-L06 (anomalous access),
-- SEC-L08 (configuration compliance), SEC-AC09 (access policies), SEC-AC10 (bank details for finance only).
-- Rollback: 0026_b11_audit_monitoring_access.down.sql

-- ---------- SEC-L02: administrative actions are flagged on the audit trail itself ----------
-- The column is generated from the action name and the actor's role, so it cannot be set or edited by anyone, and the
-- trail's append-only guards (grants and triggers from 0001) already cover the row it belongs to.
ALTER TABLE audit_event ADD COLUMN category text GENERATED ALWAYS AS (
  CASE
    WHEN action ~ '^(admin|settings|connector|secret|ai|config|security|user|grant|delegation|role|workflow|key|kms|retention|residency|privacy|encryption|compliance|bank_change|tenant)\.'
      OR action ~ '^policy\.(create|disable|delete)$'
      OR action ~ '^access\.(grant|revoke)$'
      OR actor_role = 'ADMIN'
    THEN 'ADMIN'
    ELSE 'GENERAL'
  END
) STORED;
--> statement-breakpoint
CREATE INDEX audit_category_idx ON audit_event (tenant_id, category, seq);
--> statement-breakpoint
-- The chain is also enforced where the row is written: an event whose prev_hash is not the hash of the tenant's latest event
-- is refused, so a gap or a fork cannot be written even by a connection that skips the application code.
CREATE FUNCTION audit_chain_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE last_hash text;
BEGIN
  SELECT hash INTO last_hash FROM audit_event WHERE tenant_id = NEW.tenant_id ORDER BY seq DESC LIMIT 1;
  IF NEW.prev_hash IS DISTINCT FROM COALESCE(last_hash, 'GENESIS') THEN
    RAISE EXCEPTION 'audit chain: prev_hash does not continue the tenant chain' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_event_chain_guard BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION audit_chain_guard();
--> statement-breakpoint
-- Each verification of the chain is itself kept, append-only: who checked, when, and what they found.
CREATE TABLE admin_chain_verification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  verified_by uuid REFERENCES app_user(id),
  verified_by_role text,
  verified_at timestamptz NOT NULL,
  ok boolean NOT NULL,
  checked integer NOT NULL,
  admin_events integer NOT NULL,
  head_seq bigint,
  head_hash text,
  broken_at_seq bigint,
  reason text
);
--> statement-breakpoint
CREATE INDEX admin_chain_verification_idx ON admin_chain_verification (tenant_id, verified_at);
--> statement-breakpoint
-- SEC-L07: every evidence pack that was produced, append-only.
CREATE TABLE export_pack_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  generated_by uuid REFERENCES app_user(id),
  generated_at timestamptz NOT NULL,
  from_date date NOT NULL,
  to_date date NOT NULL,
  request_id uuid REFERENCES request(id),
  event_count integer NOT NULL,
  chain_head_hash text,
  manifest_sha256 text NOT NULL,
  signature_fingerprint text NOT NULL,
  format text NOT NULL CHECK (format IN ('JSON', 'ZIP'))
);
--> statement-breakpoint
CREATE INDEX export_pack_log_idx ON export_pack_log (tenant_id, generated_at);
--> statement-breakpoint
CREATE TRIGGER admin_chain_verification_append_only BEFORE UPDATE OR DELETE ON admin_chain_verification FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
CREATE TRIGGER export_pack_log_append_only BEFORE UPDATE OR DELETE ON export_pack_log FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint

-- ---------- SEC-L06: access events and security alerts ----------
-- One row per classified request (a detail view, a refused access, an export): the route pattern and the record id, no content.
CREATE TABLE access_event (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  user_id uuid NOT NULL REFERENCES app_user(id),
  kind text NOT NULL CHECK (kind IN ('VIEW', 'DENIED', 'EXPORT')),
  route text NOT NULL,
  entity_id text,
  status integer NOT NULL,
  at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX access_event_user_idx ON access_event (tenant_id, user_id, at);
--> statement-breakpoint
CREATE INDEX access_event_at_idx ON access_event (tenant_id, at);
--> statement-breakpoint
CREATE TABLE security_alert (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  rule text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH')),
  subject_user_id uuid REFERENCES app_user(id),
  summary text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'ACKNOWLEDGED', 'ESCALATED', 'CLOSED')),
  owner_user_id uuid REFERENCES app_user(id),
  dedupe_key text,
  model text NOT NULL DEFAULT 'rules-simulated-v1',
  created_at timestamptz NOT NULL,
  acknowledged_by uuid REFERENCES app_user(id),
  acknowledged_at timestamptz,
  escalated_at timestamptz,
  escalated_to jsonb NOT NULL DEFAULT '[]'::jsonb,
  closed_by uuid REFERENCES app_user(id),
  closed_at timestamptz,
  close_note text,
  sessions_ended_by uuid REFERENCES app_user(id),
  sessions_ended_at timestamptz
);
--> statement-breakpoint
CREATE INDEX security_alert_status_idx ON security_alert (tenant_id, status, created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX security_alert_dedupe_uq ON security_alert (tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
--> statement-breakpoint

-- ---------- SEC-L08: configuration compliance ----------
CREATE TABLE compliance_check_result (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  check_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('PASS', 'FAIL', 'WARN')),
  detail text NOT NULL,
  last_checked_at timestamptz NOT NULL,
  first_failed_at timestamptz,
  last_passed_at timestamptz,
  previous_status text CHECK (previous_status IN ('PASS', 'FAIL', 'WARN'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX compliance_check_result_uq ON compliance_check_result (tenant_id, check_key);
--> statement-breakpoint

-- ---------- SEC-AC09: access policies ----------
CREATE TABLE access_policy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  name text NOT NULL,
  effect text NOT NULL CHECK (effect IN ('DENY', 'ALLOW')),
  subject_type text NOT NULL CHECK (subject_type IN ('ROLE', 'USER')),
  subject text NOT NULL,
  action text NOT NULL CHECK (action IN ('view', 'edit', 'approve', 'export')),
  selector jsonb NOT NULL DEFAULT '{}'::jsonb,
  conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 100,
  expires_at timestamptz,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL,
  disabled_by uuid REFERENCES app_user(id),
  disabled_at timestamptz,
  disabled_reason text,
  deleted_by uuid REFERENCES app_user(id),
  deleted_at timestamptz,
  deleted_reason text
);
--> statement-breakpoint
CREATE INDEX access_policy_idx ON access_policy (tenant_id, active);
--> statement-breakpoint
-- A label on a procurement that policies can select on (for example HR-sensitive).
CREATE TABLE access_tag (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  request_id uuid NOT NULL REFERENCES request(id),
  tag text NOT NULL CHECK (tag ~ '^[a-z0-9][a-z0-9-]{1,38}$'),
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX access_tag_uq ON access_tag (request_id, tag);
--> statement-breakpoint

-- ---------- SEC-AC10: bank detail changes need a finance confirmation ----------
CREATE TABLE bank_detail_change (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  supplier_id uuid NOT NULL REFERENCES supplier(id),
  requested_by uuid NOT NULL REFERENCES app_user(id),
  requested_by_role text NOT NULL,
  requested_at timestamptz NOT NULL,
  new_bank jsonb NOT NULL,
  -- what was in force before this change, so a change applied provisionally can be put back if finance rejects it
  previous_bank jsonb,
  -- PENDING: not in force until a finance person confirms. UNCONFIRMED: a first record, in force but not yet confirmed.
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'UNCONFIRMED', 'CONFIRMED', 'REJECTED', 'WITHDRAWN', 'SUPERSEDED')),
  decided_by uuid REFERENCES app_user(id),
  decided_at timestamptz,
  decision_note text,
  -- the person who asks for a change is never the person who confirms it
  CONSTRAINT bank_detail_change_two_people CHECK (decided_by IS NULL OR decided_by <> requested_by)
);
--> statement-breakpoint
CREATE INDEX bank_detail_change_idx ON bank_detail_change (tenant_id, supplier_id, status);
--> statement-breakpoint
CREATE UNIQUE INDEX bank_detail_change_open_uq ON bank_detail_change (supplier_id) WHERE status IN ('PENDING', 'UNCONFIRMED');
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON security_alert, compliance_check_result, access_policy, access_tag, bank_detail_change, access_event TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON admin_chain_verification, export_pack_log TO app_user;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE access_event_id_seq TO app_user;
