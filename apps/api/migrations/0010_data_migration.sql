-- B1: data migration. Legacy contract records are uploaded as a batch, validated, reviewed and then loaded with a
-- source-system flag so they stay distinguishable from records created here.
ALTER TABLE request ADD COLUMN source_system text;
--> statement-breakpoint
ALTER TABLE contract ADD COLUMN source_system text;
--> statement-breakpoint
CREATE TABLE migration_batch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  filename text NOT NULL,
  source_system text NOT NULL,
  status text NOT NULL DEFAULT 'VALIDATED' CHECK (status IN ('VALIDATED', 'CUTOVER', 'CANCELLED')),
  total integer NOT NULL DEFAULT 0,
  uploaded_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  cutover_at timestamptz,
  cutover_by uuid REFERENCES app_user(id)
);
--> statement-breakpoint
CREATE TABLE migration_record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  batch_id uuid NOT NULL REFERENCES migration_batch(id),
  row_no integer NOT NULL,
  raw jsonb NOT NULL,
  status text NOT NULL DEFAULT 'VALID' CHECK (status IN ('VALID', 'EXCEPTION', 'SKIPPED', 'LOADED')),
  issues jsonb NOT NULL DEFAULT '[]',
  warnings jsonb NOT NULL DEFAULT '[]',
  reviewed_by uuid REFERENCES app_user(id),
  reviewed_at timestamptz,
  review_note text,
  request_id uuid,
  contract_id uuid,
  CONSTRAINT migration_row_uq UNIQUE (batch_id, row_no)
);
--> statement-breakpoint
CREATE INDEX migration_record_batch_idx ON migration_record(batch_id, status);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON migration_batch, migration_record TO app_user;
