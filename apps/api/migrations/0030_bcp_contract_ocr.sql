-- BCP (Procurement Copilot), module cpocr: contract OCR and extraction (CP-07, OCR and extraction part). A batch is one upload
-- (files or a zip); each document keeps its page text, the extracted fields with confidence and source span, the clauses found
-- and the findings. Corrections keep before and after. Every table is tenant-scoped with row level security like the others.
CREATE TABLE cp_ocr_config (
  tenant_id uuid PRIMARY KEY REFERENCES tenant(id),
  review_threshold numeric(4, 3) NOT NULL DEFAULT 0.800 CHECK (review_threshold >= 0.5 AND review_threshold <= 0.99),
  updated_by uuid REFERENCES app_user(id),
  updated_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE TABLE cp_ocr_clause_type (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  key text NOT NULL CHECK (key ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  title text NOT NULL,
  mandatory boolean NOT NULL DEFAULT false,
  risk text NOT NULL DEFAULT 'MEDIUM' CHECK (risk IN ('LOW', 'MEDIUM', 'HIGH')),
  keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
  standard_text text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0,
  updated_by uuid REFERENCES app_user(id),
  updated_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX cp_ocr_clause_type_uq ON cp_ocr_clause_type (tenant_id, key);
--> statement-breakpoint
CREATE TABLE cp_ocr_batch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  created_by uuid NOT NULL REFERENCES app_user(id),
  origin text NOT NULL DEFAULT 'UPLOAD' CHECK (origin IN ('UPLOAD', 'SAMPLE')),
  file_count integer NOT NULL DEFAULT 0,
  skipped jsonb NOT NULL DEFAULT '[]'::jsonb,
  note text,
  created_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX cp_ocr_batch_idx ON cp_ocr_batch (tenant_id, created_at);
--> statement-breakpoint
CREATE TABLE cp_ocr_document (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  batch_id uuid NOT NULL REFERENCES cp_ocr_batch(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  entry_path text,
  kind text NOT NULL CHECK (kind IN ('PDF', 'PNG', 'JPG', 'TIFF')),
  size_bytes integer NOT NULL,
  sha256 text NOT NULL,
  engine text NOT NULL,
  simulated boolean NOT NULL DEFAULT false,
  page_count integer NOT NULL DEFAULT 0,
  pages jsonb NOT NULL DEFAULT '[]'::jsonb,
  ocr_confidence numeric(4, 3),
  status text NOT NULL CHECK (status IN ('NEEDS_REVIEW', 'READY', 'COMMITTED', 'REJECTED', 'FAILED')),
  failure text,
  fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  clauses jsonb NOT NULL DEFAULT '[]'::jsonb,
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  review_threshold numeric(4, 3) NOT NULL DEFAULT 0.800,
  duplicate_of uuid REFERENCES cp_ocr_document(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES app_user(id),
  reviewed_at timestamptz,
  contract_id uuid REFERENCES contract(id),
  supplier_id uuid REFERENCES supplier(id),
  committed_by uuid REFERENCES app_user(id),
  committed_at timestamptz,
  commit_summary jsonb,
  reject_reason text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1
);
--> statement-breakpoint
CREATE INDEX cp_ocr_document_batch_idx ON cp_ocr_document (tenant_id, batch_id);
--> statement-breakpoint
CREATE INDEX cp_ocr_document_hash_idx ON cp_ocr_document (tenant_id, sha256);
--> statement-breakpoint
CREATE INDEX cp_ocr_document_status_idx ON cp_ocr_document (tenant_id, status);
--> statement-breakpoint
CREATE TABLE cp_ocr_correction (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  document_id uuid NOT NULL REFERENCES cp_ocr_document(id) ON DELETE CASCADE,
  field_key text NOT NULL,
  before jsonb,
  after jsonb,
  reason text,
  corrected_by uuid NOT NULL REFERENCES app_user(id),
  corrected_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX cp_ocr_correction_idx ON cp_ocr_correction (tenant_id, document_id);
--> statement-breakpoint
ALTER TABLE cp_ocr_config ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE cp_ocr_clause_type ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE cp_ocr_batch ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE cp_ocr_document ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE cp_ocr_correction ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY cp_ocr_config_tenant ON cp_ocr_config FOR ALL TO app_user
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY cp_ocr_clause_type_tenant ON cp_ocr_clause_type FOR ALL TO app_user
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY cp_ocr_batch_tenant ON cp_ocr_batch FOR ALL TO app_user
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY cp_ocr_document_tenant ON cp_ocr_document FOR ALL TO app_user
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY cp_ocr_correction_tenant ON cp_ocr_correction FOR ALL TO app_user
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON cp_ocr_config, cp_ocr_clause_type, cp_ocr_batch, cp_ocr_document, cp_ocr_correction TO app_user;
