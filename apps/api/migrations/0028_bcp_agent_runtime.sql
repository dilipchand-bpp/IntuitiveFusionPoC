-- BCP agent runtime (CP-01, CP-02, CP-03, CP-06): runs of the Procurement Copilot, the steps and events it records, the gates where it
-- waits for a person, the problems it found and the repairs it tried, and the hand-offs between its specialist agents.
-- Everything the agent does is simulated and rules-based (engine rules-simulated-v1). Tenant scoped with row level security.

CREATE TABLE cp_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  user_id uuid NOT NULL REFERENCES app_user(id),
  user_name text NOT NULL,
  user_role text NOT NULL,
  title text NOT NULL,
  source_text text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('FULL', 'ASSISTED')),
  auto_advance boolean NOT NULL DEFAULT true,
  status text NOT NULL CHECK (status IN ('RUNNING', 'WAITING_GATE', 'NEEDS_HUMAN', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED')),
  paused_from text,
  stage text NOT NULL DEFAULT 'REQUEST' CHECK (stage IN ('REQUEST', 'PLAN', 'TENDER', 'EVALUATION', 'AWARD', 'CONTRACT', 'DONE')),
  request_id uuid REFERENCES request(id),
  current_agent text NOT NULL DEFAULT 'ORCHESTRATOR',
  current_action text,
  waiting_for jsonb NOT NULL DEFAULT '[]'::jsonb,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  tick_count integer NOT NULL DEFAULT 0,
  ticking_since timestamptz,
  last_tick_at timestamptz,
  next_tick_at timestamptz,
  engine text NOT NULL DEFAULT 'rules-simulated-v1',
  simulated boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz
);
--> statement-breakpoint
CREATE INDEX cp_run_tenant_idx ON cp_run (tenant_id, updated_at);
--> statement-breakpoint
CREATE INDEX cp_run_user_idx ON cp_run (tenant_id, user_id);
--> statement-breakpoint
CREATE TABLE cp_step (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  run_id uuid NOT NULL REFERENCES cp_run(id),
  seq integer NOT NULL,
  step_key text NOT NULL,
  idem_key text NOT NULL,
  agent text NOT NULL,
  tool text,
  stage text NOT NULL,
  status text NOT NULL CHECK (status IN ('DONE', 'FAILED', 'REPAIRED', 'SKIPPED', 'NOT_AVAILABLE')),
  title text NOT NULL,
  reason text NOT NULL,
  rule text NOT NULL,
  request jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  http_status integer,
  attempt integer NOT NULL DEFAULT 1,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  duration_ms integer NOT NULL DEFAULT 0,
  actor_label text NOT NULL DEFAULT 'Procurement Copilot'
);
--> statement-breakpoint
CREATE UNIQUE INDEX cp_step_idem_uq ON cp_step (run_id, idem_key);
--> statement-breakpoint
CREATE INDEX cp_step_run_idx ON cp_step (run_id, seq);
--> statement-breakpoint
CREATE TABLE cp_event (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  run_id uuid NOT NULL REFERENCES cp_run(id),
  at timestamptz NOT NULL,
  kind text NOT NULL CHECK (kind IN ('STEP', 'GATE', 'PROBLEM', 'REPAIR', 'HANDOFF', 'STATUS', 'NOTE')),
  agent text NOT NULL,
  title text NOT NULL,
  detail text NOT NULL DEFAULT '',
  data jsonb NOT NULL DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE INDEX cp_event_run_idx ON cp_event (run_id, seq);
--> statement-breakpoint
CREATE TABLE cp_gate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  run_id uuid NOT NULL REFERENCES cp_run(id),
  gate_key text NOT NULL,
  kind text NOT NULL,
  stage text NOT NULL,
  title text NOT NULL,
  reason text NOT NULL,
  rule text NOT NULL,
  link text NOT NULL,
  assignee_roles jsonb NOT NULL DEFAULT '[]'::jsonb,
  assignee_user_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  assignee_names jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL CHECK (status IN ('OPEN', 'RESOLVED', 'CANCELLED')),
  created_at timestamptz NOT NULL,
  resolved_at timestamptz,
  resolution text
);
--> statement-breakpoint
CREATE UNIQUE INDEX cp_gate_open_uq ON cp_gate (run_id, gate_key) WHERE status = 'OPEN';
--> statement-breakpoint
CREATE INDEX cp_gate_tenant_idx ON cp_gate (tenant_id, status);
--> statement-breakpoint
CREATE TABLE cp_problem (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  run_id uuid NOT NULL REFERENCES cp_run(id),
  step_key text NOT NULL,
  code text NOT NULL,
  title text NOT NULL,
  detail text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('OPEN', 'REPAIRED', 'ESCALATED', 'RESOLVED')),
  attempts jsonb NOT NULL DEFAULT '[]'::jsonb,
  attempt_count integer NOT NULL DEFAULT 0,
  fingerprint text NOT NULL DEFAULT '',
  escalated_to jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  resolved_at timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX cp_problem_active_uq ON cp_problem (run_id, step_key) WHERE status IN ('OPEN', 'ESCALATED');
--> statement-breakpoint
CREATE INDEX cp_problem_run_idx ON cp_problem (run_id, created_at);
--> statement-breakpoint
CREATE TABLE cp_handoff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  run_id uuid NOT NULL REFERENCES cp_run(id),
  at timestamptz NOT NULL,
  from_agent text NOT NULL,
  to_agent text NOT NULL,
  reason text NOT NULL,
  step_key text NOT NULL
);
--> statement-breakpoint
CREATE INDEX cp_handoff_run_idx ON cp_handoff (run_id, at);
--> statement-breakpoint
ALTER TABLE cp_run ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE cp_step ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE cp_event ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE cp_gate ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE cp_problem ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE cp_handoff ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- A run that belongs to a restricted project is hidden from anyone outside that project's sourcing group (FR-0865); every table is
-- also kept to its own tenant in the database itself.
CREATE POLICY cp_run_scope ON cp_run FOR ALL TO app_user
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND b11_can_see_request(request_id))
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY cp_step_tenant ON cp_step FOR ALL TO app_user
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY cp_event_tenant ON cp_event FOR ALL TO app_user
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY cp_gate_tenant ON cp_gate FOR ALL TO app_user
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY cp_problem_tenant ON cp_problem FOR ALL TO app_user
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY cp_handoff_tenant ON cp_handoff FOR ALL TO app_user
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON cp_run, cp_step, cp_event, cp_gate, cp_problem, cp_handoff TO app_user;
