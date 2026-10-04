-- B3: evaluation and report. Ranking mode and price weighting, a probity system hold, re-declaration of conflicts,
-- minor-conflict exclusions, the compliance gate, clarifications and best-and-final-offer rounds, bid pricing,
-- evaluator substitution, probity advisor allocation and documents, and report routing.
ALTER TABLE evaluation
  ADD COLUMN mode text NOT NULL DEFAULT 'SCORING' CHECK (mode IN ('SCORING', 'RANKING')),
  ADD COLUMN price_weight_pct integer NOT NULL DEFAULT 30 CHECK (price_weight_pct BETWEEN 0 AND 80),
  ADD COLUMN held boolean NOT NULL DEFAULT false,
  ADD COLUMN hold_reason text,
  ADD COLUMN held_by uuid REFERENCES app_user(id),
  ADD COLUMN held_at timestamptz;
--> statement-breakpoint
ALTER TABLE panel_member
  ADD COLUMN redeclared_at timestamptz,
  ADD COLUMN redeclaration text CHECK (redeclaration IN ('NONE', 'CONFLICT')),
  ADD COLUMN reminded_at timestamptz;
--> statement-breakpoint
ALTER TABLE coi_declaration
  ADD COLUMN excluded_supplier_id uuid REFERENCES supplier(id),
  ADD COLUMN decided_by uuid REFERENCES app_user(id),
  ADD COLUMN decided_by_role text,
  ADD COLUMN decision_note text;
--> statement-breakpoint
ALTER TABLE eval_report
  ADD COLUMN routed_to uuid REFERENCES app_user(id),
  ADD COLUMN required_authority numeric(14, 2);
--> statement-breakpoint
ALTER TABLE app_user ADD COLUMN external boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE TABLE compliance_check (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  evaluation_id uuid NOT NULL REFERENCES evaluation(id),
  supplier_id uuid NOT NULL REFERENCES supplier(id),
  check_key text NOT NULL,
  result text NOT NULL CHECK (result IN ('PASS', 'FAIL', 'WAIVED')),
  detail text NOT NULL,
  decided_by uuid REFERENCES app_user(id),
  decided_note text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT compliance_check_uq UNIQUE (evaluation_id, supplier_id, check_key)
);
--> statement-breakpoint
CREATE TABLE clarification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  evaluation_id uuid NOT NULL REFERENCES evaluation(id),
  supplier_id uuid NOT NULL REFERENCES supplier(id),
  kind text NOT NULL CHECK (kind IN ('COMPLIANCE', 'CLARIFICATION', 'NEGOTIATION')),
  subject text NOT NULL,
  question text NOT NULL,
  check_key text,
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ANSWERED', 'CLOSED')),
  response text,
  responded_by uuid REFERENCES app_user(id),
  responded_at timestamptz,
  created_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX clarification_eval_idx ON clarification(evaluation_id);
--> statement-breakpoint
CREATE TABLE bid_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  submission_id uuid NOT NULL REFERENCES submission(id),
  base_price numeric(14, 2) NOT NULL,
  implementation numeric(14, 2) NOT NULL DEFAULT 0,
  annual_running numeric(14, 2) NOT NULL DEFAULT 0,
  years integer NOT NULL DEFAULT 1 CHECK (years BETWEEN 1 AND 30),
  tco numeric(14, 2) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bid_pricing_uq UNIQUE (submission_id)
);
--> statement-breakpoint
CREATE TABLE bafo_round (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  evaluation_id uuid NOT NULL REFERENCES evaluation(id),
  round integer NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  note text NOT NULL,
  closes_at timestamptz NOT NULL,
  invited jsonb NOT NULL DEFAULT '[]',
  created_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  CONSTRAINT bafo_round_uq UNIQUE (evaluation_id, round)
);
--> statement-breakpoint
CREATE TABLE bafo_offer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  round_id uuid NOT NULL REFERENCES bafo_round(id),
  supplier_id uuid NOT NULL REFERENCES supplier(id),
  revision integer NOT NULL,
  base_price numeric(14, 2) NOT NULL,
  implementation numeric(14, 2) NOT NULL DEFAULT 0,
  annual_running numeric(14, 2) NOT NULL DEFAULT 0,
  years integer NOT NULL DEFAULT 1,
  tco numeric(14, 2) NOT NULL,
  note text,
  submitted_at timestamptz NOT NULL,
  accepted boolean NOT NULL DEFAULT false,
  accepted_by uuid REFERENCES app_user(id),
  accepted_at timestamptz,
  CONSTRAINT bafo_offer_uq UNIQUE (round_id, supplier_id, revision)
);
--> statement-breakpoint
CREATE TABLE panel_substitution (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  evaluation_id uuid NOT NULL REFERENCES evaluation(id),
  departing_user_id uuid NOT NULL REFERENCES app_user(id),
  incoming_user_id uuid NOT NULL REFERENCES app_user(id),
  stream text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('CONFLICT', 'OTHER')),
  note text,
  by_user_id uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE probity_allocation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  user_id uuid NOT NULL REFERENCES app_user(id),
  tender_id uuid NOT NULL REFERENCES tender(id),
  created_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT probity_allocation_uq UNIQUE (user_id, tender_id)
);
--> statement-breakpoint
CREATE TABLE probity_document (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  evaluation_id uuid NOT NULL REFERENCES evaluation(id),
  kind text NOT NULL CHECK (kind IN ('PLAN', 'OUTCOMES')),
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  file_name text,
  file_key text,
  file_sha256 text,
  content_type text,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SIGNED')),
  version integer NOT NULL DEFAULT 1,
  signed_by uuid REFERENCES app_user(id),
  signed_at timestamptz,
  stamp text,
  created_by uuid REFERENCES app_user(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT probity_document_uq UNIQUE (evaluation_id, kind)
);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance_check, clarification, bid_pricing, bafo_round, bafo_offer, panel_substitution, probity_allocation, probity_document TO app_user;
