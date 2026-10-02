-- M8 tender and supplier portal: link an invitation to the supplier who accepted it, keep a file checksum for the
-- receipt manifest, and seal bid files at the database level (row level security, ADR-0007 pattern).
ALTER TABLE invitation ADD COLUMN supplier_id uuid;
--> statement-breakpoint
CREATE INDEX invitation_tender_supplier_idx ON invitation (tender_id, supplier_id);
--> statement-breakpoint
ALTER TABLE file_object ADD COLUMN sha256 text;
--> statement-breakpoint

-- A bid file is readable by (a) the supplier who owns the submission, and (b) only after the tender has closed, by the
-- evaluating roles. Administrators are deliberately not in either group: no one can read bid content before close.
ALTER TABLE file_object ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE file_object FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY file_select ON file_object FOR SELECT TO app_user USING (
  tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND (
    EXISTS (
      SELECT 1 FROM submission sb JOIN app_user u ON u.supplier_id = sb.supplier_id
      WHERE sb.id = file_object.submission_id AND u.id = NULLIF(current_setting('app.user_id', true), '')::uuid
    )
    OR (
      current_setting('app.role', true) IN ('PROCUREMENT', 'EVALUATOR', 'CHAIR', 'PROBITY', 'LEGAL')
      AND EXISTS (
        SELECT 1 FROM submission sb JOIN tender t ON t.id = sb.tender_id
        WHERE sb.id = file_object.submission_id AND sb.status = 'SUBMITTED'
          AND t.status IN ('CLOSED', 'EVALUATING', 'AWARDED')
      )
    )
  )
);
--> statement-breakpoint
CREATE POLICY file_insert ON file_object FOR INSERT TO app_user WITH CHECK (
  tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND EXISTS (
    SELECT 1 FROM submission sb JOIN app_user u ON u.supplier_id = sb.supplier_id
    WHERE sb.id = file_object.submission_id AND u.id = NULLIF(current_setting('app.user_id', true), '')::uuid
  )
);
--> statement-breakpoint
CREATE POLICY file_update ON file_object FOR UPDATE TO app_user
  USING (EXISTS (
    SELECT 1 FROM submission sb JOIN app_user u ON u.supplier_id = sb.supplier_id
    WHERE sb.id = file_object.submission_id AND u.id = NULLIF(current_setting('app.user_id', true), '')::uuid
  ))
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY file_delete ON file_object FOR DELETE TO app_user USING (
  EXISTS (
    SELECT 1 FROM submission sb JOIN app_user u ON u.supplier_id = sb.supplier_id
    WHERE sb.id = file_object.submission_id AND u.id = NULLIF(current_setting('app.user_id', true), '')::uuid
  )
);
