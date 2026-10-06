DROP TABLE IF EXISTS approval_link;
DROP TABLE IF EXISTS lesson;
DROP TABLE IF EXISTS duplicate_dismissal;
DROP TABLE IF EXISTS supplier_rating;
ALTER TABLE clause DROP COLUMN IF EXISTS after_clause_id;
ALTER TABLE clause DROP COLUMN IF EXISTS redacted;
DROP TABLE IF EXISTS legal_redline;
ALTER TABLE legal_matter DROP COLUMN IF EXISTS external_stage;
ALTER TABLE legal_matter DROP COLUMN IF EXISTS external_ref;
DROP TABLE IF EXISTS integration_event;
--> statement-breakpoint
DROP POLICY file_select ON file_object;
--> statement-breakpoint
CREATE POLICY file_select ON file_object FOR SELECT TO app_user USING (
  tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND (
    EXISTS (
      SELECT 1 FROM submission sb JOIN app_user u ON u.supplier_id = sb.supplier_id
      WHERE sb.id = file_object.submission_id AND u.id = NULLIF(current_setting('app.user_id', true), '')::uuid
    )
    OR (
      current_setting('app.role', true) IN ('PROCUREMENT', 'PROBITY', 'LEGAL')
      AND EXISTS (
        SELECT 1 FROM submission sb JOIN tender t ON t.id = sb.tender_id
        WHERE sb.id = file_object.submission_id AND sb.status = 'SUBMITTED'
          AND t.status IN ('CLOSED', 'EVALUATING', 'AWARDED')
      )
    )
    OR (
      current_setting('app.role', true) IN ('EVALUATOR', 'CHAIR')
      AND EXISTS (
        SELECT 1
        FROM submission sb
        JOIN tender t ON t.id = sb.tender_id
        JOIN evaluation ev ON ev.tender_id = t.id
        JOIN panel_member pm ON pm.evaluation_id = ev.id
        WHERE sb.id = file_object.submission_id AND sb.status = 'SUBMITTED'
          AND t.status IN ('CLOSED', 'EVALUATING', 'AWARDED')
          AND pm.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
          AND pm.coi_state = 'DECLARED_NONE'
          AND (
            pm.stream = 'OTHER'
            OR (pm.stream = 'TECHNICAL' AND file_object.section = 'TECHNICAL')
            OR (pm.stream = 'COMMERCIAL' AND file_object.section = 'COMMERCIAL')
          )
      )
    )
  )
);

--> statement-breakpoint
ALTER TABLE supplier DROP COLUMN IF EXISTS insurance_certificate;
DROP TABLE IF EXISTS bid_witness;
ALTER TABLE tender DROP COLUMN IF EXISTS required_cover;
ALTER TABLE tender DROP COLUMN IF EXISTS opened_at;
ALTER TABLE tender DROP COLUMN IF EXISTS dual_witness;
DROP TABLE IF EXISTS response_answer;
DROP TABLE IF EXISTS response_item;
