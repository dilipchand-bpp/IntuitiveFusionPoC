-- B9: planning, spend and experience.
-- FR-0810 currencies: rates by date, the original amount and the rate used on a request, and delegations for international spend.
CREATE TABLE fx_rate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  currency text NOT NULL,
  rate numeric(18, 8) NOT NULL CHECK (rate > 0),
  as_of date NOT NULL,
  source text NOT NULL CHECK (source IN ('ANNUAL', 'LIVE', 'MANUAL')),
  created_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX fx_rate_uq ON fx_rate (tenant_id, currency, as_of);
--> statement-breakpoint
ALTER TABLE request ADD COLUMN original_amount numeric(14, 2);
--> statement-breakpoint
ALTER TABLE request ADD COLUMN fx_rate numeric(18, 8);
--> statement-breakpoint
ALTER TABLE delegation ADD COLUMN international boolean NOT NULL DEFAULT false;
--> statement-breakpoint
-- FR-0820 guided buying: approved items, and a recommendation made for a person to approve.
CREATE TABLE catalogue_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  supplier_id uuid NOT NULL REFERENCES supplier(id),
  contract_id uuid REFERENCES contract(id),
  sku text NOT NULL,
  name text NOT NULL,
  category text NOT NULL,
  unit text NOT NULL DEFAULT 'each',
  unit_price numeric(14, 4) NOT NULL CHECK (unit_price >= 0),
  lead_days integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX catalogue_item_uq ON catalogue_item (tenant_id, supplier_id, sku);
--> statement-breakpoint
CREATE TABLE sourcing_proposal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  requester_id uuid NOT NULL REFERENCES app_user(id),
  need text NOT NULL,
  category text,
  quantity numeric(14, 2) NOT NULL,
  status text NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED', 'APPROVED', 'REJECTED', 'ORDERED', 'NO_MATCH')),
  shortlist jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommended_item_id uuid REFERENCES catalogue_item(id),
  total numeric(14, 2),
  request_id uuid REFERENCES request(id),
  decided_by uuid REFERENCES app_user(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL
);
--> statement-breakpoint
-- FR-0825 notes taken during a supplier review: private to the author unless shared with the team.
CREATE TABLE review_note (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  author_id uuid NOT NULL REFERENCES app_user(id),
  supplier_id uuid NOT NULL REFERENCES supplier(id),
  tender_id uuid REFERENCES tender(id),
  text text NOT NULL,
  visibility text NOT NULL DEFAULT 'PRIVATE' CHECK (visibility IN ('PRIVATE', 'TEAM')),
  created_at timestamptz NOT NULL
);
--> statement-breakpoint
-- FR-0850 a person's own dashboard: which widgets, where, and in what style.
CREATE TABLE user_dashboard (
  user_id uuid PRIMARY KEY REFERENCES app_user(id),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  widgets jsonb NOT NULL,
  updated_at timestamptz NOT NULL
);
--> statement-breakpoint
-- FR-0855 an audit, risk and compliance register.
CREATE TABLE grc_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  kind text NOT NULL CHECK (kind IN ('RISK', 'AUDIT_FINDING', 'OBLIGATION')),
  title text NOT NULL,
  description text,
  owner_id uuid REFERENCES app_user(id),
  likelihood integer CHECK (likelihood BETWEEN 1 AND 5),
  impact integer CHECK (impact BETWEEN 1 AND 5),
  rating integer,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_PROGRESS', 'MITIGATED', 'ACCEPTED', 'CLOSED')),
  due_on date,
  review_on date,
  source text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL', 'PLATFORM')),
  source_key text,
  linked_type text,
  linked_id uuid,
  treatment text,
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  closed_at timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX grc_item_source_uq ON grc_item (tenant_id, source_key) WHERE source_key IS NOT NULL;
--> statement-breakpoint
-- FR-0870, NFR-P02 when a later-stage artefact is out of date, and when it was last brought up to date.
CREATE TABLE artefact_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  kind text NOT NULL CHECK (kind IN ('EVAL_REPORT', 'CONTRACT_PLANS')),
  subject_id uuid NOT NULL,
  stale boolean NOT NULL DEFAULT true,
  reason text,
  changed_at timestamptz NOT NULL,
  refreshed_at timestamptz,
  refresh_count integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE UNIQUE INDEX artefact_state_uq ON artefact_state (kind, subject_id);
--> statement-breakpoint
-- FR-0880 what was sent to the outside search provider.
CREATE TABLE external_search_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  user_id uuid NOT NULL REFERENCES app_user(id),
  query_sent text NOT NULL,
  provider text NOT NULL,
  withheld jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL
);
--> statement-breakpoint
-- NFR-U04 layouts for the request page and the contract page, beside the plan, tender pack and report.
ALTER TABLE layout_template DROP CONSTRAINT layout_template_kind_check;
--> statement-breakpoint
ALTER TABLE layout_template ADD CONSTRAINT layout_template_kind_check CHECK (kind IN ('PLAN', 'RFX', 'REPORT', 'INTAKE', 'CONTRACT'));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON fx_rate, catalogue_item, sourcing_proposal, review_note, user_dashboard, grc_item, artefact_state, external_search_log TO app_user;
