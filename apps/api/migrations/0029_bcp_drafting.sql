-- BCP (Procurement Copilot), module cpdraft: drafting from voice or text and adjusting by plain-language instruction
-- (CP-04, CP-05). A draft belongs to the person who made it; every revision is kept whole so a before/after view and undo
-- never depend on re-running anything. All tables are tenant-scoped with row level security like the other modules.
CREATE TABLE cp_draft (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  user_id uuid NOT NULL REFERENCES app_user(id),
  kind text NOT NULL CHECK (kind IN ('REQUEST', 'PLAN', 'JOB_SPEC', 'TENDER_DOC', 'CONTRACT_DRAFT', 'EVAL_CRITERIA')),
  source text NOT NULL CHECK (source IN ('TEXT', 'VOICE')),
  procurement_id uuid REFERENCES request(id),
  input_text text NOT NULL,
  engine text NOT NULL DEFAULT 'rules-simulated-v1',
  current_revision integer NOT NULL DEFAULT 1 CHECK (current_revision >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX cp_draft_user_idx ON cp_draft (tenant_id, user_id, updated_at);
--> statement-breakpoint
CREATE TABLE cp_draft_revision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  draft_id uuid NOT NULL REFERENCES cp_draft(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision >= 1),
  parent_revision integer,
  action text NOT NULL CHECK (action IN ('GENERATE', 'ADJUST', 'UNDO')),
  instruction text,
  summary text NOT NULL DEFAULT '',
  doc jsonb NOT NULL,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  diff jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX cp_draft_revision_uq ON cp_draft_revision (draft_id, revision);
--> statement-breakpoint
CREATE TABLE cp_draft_apply (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  draft_id uuid NOT NULL REFERENCES cp_draft(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  target text NOT NULL CHECK (target IN ('REQUEST', 'PLAN', 'TENDER', 'REPOSITORY')),
  target_id uuid,
  changes jsonb NOT NULL DEFAULT '[]'::jsonb,
  applied_by uuid NOT NULL REFERENCES app_user(id),
  applied_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX cp_draft_apply_idx ON cp_draft_apply (tenant_id, draft_id);
--> statement-breakpoint
ALTER TABLE cp_draft ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE cp_draft_revision ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE cp_draft_apply ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY cp_draft_tenant ON cp_draft FOR ALL TO app_user
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY cp_draft_revision_tenant ON cp_draft_revision FOR ALL TO app_user
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY cp_draft_apply_tenant ON cp_draft_apply FOR ALL TO app_user
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON cp_draft, cp_draft_revision, cp_draft_apply TO app_user;
