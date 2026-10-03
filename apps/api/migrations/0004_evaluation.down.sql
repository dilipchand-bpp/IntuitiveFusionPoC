DROP POLICY IF EXISTS file_select ON file_object;
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
ALTER TABLE panel_member DROP COLUMN scored_at;
