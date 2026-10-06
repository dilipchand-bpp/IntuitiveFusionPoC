-- B10 (AI layer, configuration, client baseline, performance).
-- SEC-TP07, NFR-C01, NFR-M06: a third-party AI model must be approved for the tenant before it can be switched on.
-- The latest row for a model is its current state; a model has at most one open request at a time.
CREATE TABLE ai_provider_approval (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  model_id text NOT NULL,
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'APPROVED', 'REJECTED', 'REVOKED')),
  requested_by uuid NOT NULL REFERENCES app_user(id),
  request_reason text,
  decided_by uuid REFERENCES app_user(id),
  reason text,
  decided_at timestamptz,
  revoked_by uuid REFERENCES app_user(id),
  revoke_reason text,
  revoked_at timestamptz,
  data_handling jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  -- two different people: the person who asks is never the person who approves
  CONSTRAINT ai_provider_approval_two_people CHECK (decided_by IS NULL OR decided_by <> requested_by)
);
--> statement-breakpoint
CREATE INDEX ai_provider_approval_model_idx ON ai_provider_approval (tenant_id, model_id, created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX ai_provider_approval_open_uq ON ai_provider_approval (tenant_id, model_id) WHERE status = 'REQUESTED';
--> statement-breakpoint
-- NFR-C08: which browsers sign in, counted. Browser family, major version and whether it met the baseline; nothing about the person.
CREATE TABLE client_check (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  browser text NOT NULL,
  major integer NOT NULL,
  supported boolean NOT NULL,
  count integer NOT NULL DEFAULT 1,
  last_seen_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX client_check_uq ON client_check (tenant_id, browser, major, supported);
--> statement-breakpoint
-- NFR-P04: how long the budget check and an intake message took (monotonic timer), kept to a fixed number per tenant and kind.
CREATE TABLE perf_sample (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  kind text NOT NULL CHECK (kind IN ('BUDGET_CHECK', 'INTAKE_MESSAGE')),
  ms numeric(10, 3) NOT NULL CHECK (ms >= 0),
  at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX perf_sample_idx ON perf_sample (tenant_id, kind, id);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_provider_approval, client_check, perf_sample TO app_user;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE perf_sample_id_seq TO app_user;
