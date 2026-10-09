-- BCP / CP-07 (historical import): spreadsheet imports of contracts, suppliers, historical spend and catalogue prices with
-- saved column mappings, a dry run, a commit and an exact per-batch rollback. Extends (does not replace) the CSV migration
-- of 0010. A batch of historical contract FILES is handed to the OCR module's route; its batch id is only remembered here.

CREATE TABLE hist_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  entity text NOT NULL CHECK (entity IN ('CONTRACTS', 'SUPPLIERS', 'SPEND', 'CATALOGUE')),
  source_system text NOT NULL,
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  duplicate_rule text NOT NULL DEFAULT 'SKIP' CHECK (duplicate_rule IN ('SKIP', 'MERGE')),
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX hist_mapping_uq ON hist_mapping (tenant_id, entity, source_system);
--> statement-breakpoint
CREATE TABLE hist_batch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  entity text NOT NULL CHECK (entity IN ('CONTRACTS', 'SUPPLIERS', 'SPEND', 'CATALOGUE', 'CONTRACT_FILES')),
  filename text NOT NULL,
  source_system text NOT NULL,
  file_kind text NOT NULL CHECK (file_kind IN ('XLSX', 'CSV', 'ZIP')),
  sheet_name text,
  sha256 text NOT NULL,
  size_bytes integer NOT NULL,
  status text NOT NULL DEFAULT 'UPLOADED' CHECK (status IN ('UPLOADED', 'MAPPED', 'DRY_RUN', 'COMMITTED', 'ROLLED_BACK')),
  headers jsonb NOT NULL DEFAULT '[]'::jsonb,
  row_count integer NOT NULL DEFAULT 0,
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  suggestion jsonb NOT NULL DEFAULT '{}'::jsonb,
  duplicate_rule text NOT NULL DEFAULT 'SKIP' CHECK (duplicate_rule IN ('SKIP', 'MERGE')),
  parse_warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary jsonb,
  commit_summary jsonb,
  ocr_batch_id uuid,
  ocr_result jsonb,
  uploaded_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL,
  dry_run_at timestamptz,
  committed_at timestamptz,
  committed_by uuid REFERENCES app_user(id),
  rolled_back_at timestamptz,
  rolled_back_by uuid REFERENCES app_user(id),
  rollback_note text
);
--> statement-breakpoint
CREATE INDEX hist_batch_tenant_idx ON hist_batch (tenant_id, created_at);
--> statement-breakpoint
CREATE TABLE hist_row (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  batch_id uuid NOT NULL REFERENCES hist_batch(id),
  row_no integer NOT NULL,
  raw jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'VALID', 'ERROR', 'DUPLICATE', 'LOADED', 'MERGED', 'SKIPPED')),
  normalised jsonb,
  issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  duplicate jsonb,
  created_ref uuid
);
--> statement-breakpoint
CREATE UNIQUE INDEX hist_row_uq ON hist_row (batch_id, row_no);
--> statement-breakpoint
-- The ledger of everything a committed batch made or changed: what a rollback removes, and what a merge changed (before).
CREATE TABLE hist_created (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  batch_id uuid NOT NULL REFERENCES hist_batch(id),
  entity_type text NOT NULL CHECK (entity_type IN ('CONTRACT', 'SUPPLIER', 'CATALOGUE_ITEM', 'SPEND_LINE')),
  entity_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('CREATED', 'MERGED')),
  before jsonb,
  after jsonb
);
--> statement-breakpoint
CREATE INDEX hist_created_batch_idx ON hist_created (batch_id, entity_type);
--> statement-breakpoint
-- Historical spend (what was bought, from whom, when) loaded from an extract; read by the analytics store and the spend reports.
CREATE TABLE hist_spend_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  batch_id uuid NOT NULL REFERENCES hist_batch(id),
  supplier_id uuid,
  supplier_name text NOT NULL,
  category text NOT NULL DEFAULT 'Uncategorised',
  amount numeric(14, 2) NOT NULL,
  currency text NOT NULL DEFAULT 'AUD',
  spend_date date NOT NULL,
  business_unit text NOT NULL DEFAULT 'Not recorded',
  cost_centre text NOT NULL DEFAULT 'Not recorded',
  reference text,
  description text,
  created_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX hist_spend_line_idx ON hist_spend_line (tenant_id, spend_date);
--> statement-breakpoint
CREATE INDEX hist_spend_line_batch_idx ON hist_spend_line (batch_id);
--> statement-breakpoint
ALTER TABLE hist_mapping ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE hist_batch ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE hist_row ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE hist_created ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE hist_spend_line ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY hist_mapping_tenant ON hist_mapping FOR ALL TO app_user
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY hist_batch_tenant ON hist_batch FOR ALL TO app_user
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY hist_row_tenant ON hist_row FOR ALL TO app_user
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY hist_created_tenant ON hist_created FOR ALL TO app_user
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY hist_spend_line_tenant ON hist_spend_line FOR ALL TO app_user
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON hist_mapping, hist_batch, hist_row, hist_created, hist_spend_line TO app_user;
