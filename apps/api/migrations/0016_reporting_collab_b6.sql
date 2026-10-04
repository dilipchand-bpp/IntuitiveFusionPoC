-- B6: reporting and collaboration. Layout templates, procurement schedule, assigned managers, supplier locations, saved
-- report views, risk assessments, field history with versions and presence, and the reference content corpus.
CREATE TABLE layout_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  kind text NOT NULL CHECK (kind IN ('PLAN', 'RFX', 'REPORT')),
  name text NOT NULL,
  sections jsonb NOT NULL,
  updated_by uuid NOT NULL REFERENCES app_user(id),
  updated_at timestamptz NOT NULL,
  CONSTRAINT layout_template_uq UNIQUE (tenant_id, kind)
);
--> statement-breakpoint
CREATE TABLE schedule_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  request_id uuid NOT NULL REFERENCES request(id),
  phase text NOT NULL CHECK (phase IN ('INTAKE', 'PLAN', 'TENDER', 'EVALUATION', 'CONTRACT_AWARD')),
  start_date date NOT NULL,
  end_date date NOT NULL,
  CONSTRAINT schedule_item_uq UNIQUE (request_id, phase),
  CONSTRAINT schedule_item_order CHECK (end_date >= start_date)
);
--> statement-breakpoint
ALTER TABLE request ADD COLUMN manager_id uuid REFERENCES app_user(id);
--> statement-breakpoint
ALTER TABLE supplier ADD COLUMN location jsonb;
--> statement-breakpoint
CREATE TABLE saved_view (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  user_id uuid NOT NULL REFERENCES app_user(id),
  name text NOT NULL,
  report text NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  shared boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE TABLE risk_assessment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  request_id uuid NOT NULL REFERENCES request(id),
  basis text NOT NULL,
  generated_at timestamptz NOT NULL,
  generated_by uuid NOT NULL REFERENCES app_user(id),
  completed_at timestamptz,
  CONSTRAINT risk_assessment_uq UNIQUE (request_id)
);
--> statement-breakpoint
CREATE TABLE risk_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  assessment_id uuid NOT NULL REFERENCES risk_assessment(id),
  key text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  applicable boolean,
  likelihood integer CHECK (likelihood BETWEEN 1 AND 5),
  impact integer CHECK (impact BETWEEN 1 AND 5),
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  mitigation text,
  CONSTRAINT risk_item_uq UNIQUE (assessment_id, key)
);
--> statement-breakpoint
ALTER TABLE field_value ADD COLUMN rev integer NOT NULL DEFAULT 1;
--> statement-breakpoint
CREATE TABLE field_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  owner_type text NOT NULL,
  owner_id uuid NOT NULL,
  key text NOT NULL,
  value text,
  changed_by uuid,
  source text,
  rev integer NOT NULL,
  at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX field_history_doc_idx ON field_history (owner_type, owner_id, at);
--> statement-breakpoint
CREATE FUNCTION field_value_track() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.value IS NOT DISTINCT FROM OLD.value THEN
      RETURN NEW;
    END IF;
    NEW.rev := OLD.rev + 1;
  END IF;
  INSERT INTO field_history (tenant_id, owner_type, owner_id, key, value, changed_by, source, rev, at)
  VALUES (NEW.tenant_id, NEW.owner_type, NEW.owner_id, NEW.key, NEW.value, NEW.updated_by, NEW.source, NEW.rev, NEW.updated_at);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER field_value_track BEFORE INSERT OR UPDATE ON field_value FOR EACH ROW EXECUTE FUNCTION field_value_track();
--> statement-breakpoint
INSERT INTO field_history (tenant_id, owner_type, owner_id, key, value, changed_by, source, rev, at)
  SELECT tenant_id, owner_type, owner_id, key, value, updated_by, source, rev, updated_at FROM field_value;
--> statement-breakpoint
CREATE TABLE document_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  owner_type text NOT NULL,
  owner_id uuid NOT NULL,
  number integer NOT NULL,
  label text NOT NULL,
  snapshot jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL,
  CONSTRAINT document_version_uq UNIQUE (owner_type, owner_id, number)
);
--> statement-breakpoint
CREATE TABLE document_view (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  user_id uuid NOT NULL REFERENCES app_user(id),
  owner_type text NOT NULL,
  owner_id uuid NOT NULL,
  viewed_at timestamptz NOT NULL,
  CONSTRAINT document_view_uq UNIQUE (user_id, owner_type, owner_id)
);
--> statement-breakpoint
CREATE TABLE edit_presence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  user_id uuid NOT NULL REFERENCES app_user(id),
  owner_type text NOT NULL,
  owner_id uuid NOT NULL,
  field_key text,
  at timestamptz NOT NULL,
  CONSTRAINT edit_presence_uq UNIQUE (user_id, owner_type, owner_id)
);
--> statement-breakpoint
CREATE TABLE reference_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  kind text NOT NULL,
  title text NOT NULL,
  category text NOT NULL,
  sector text NOT NULL,
  level text NOT NULL,
  body text NOT NULL,
  generation integer NOT NULL,
  generated_at timestamptz NOT NULL
);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON layout_template, schedule_item, saved_view, risk_assessment, risk_item, field_history, document_version, document_view, edit_presence, reference_content TO app_user;
