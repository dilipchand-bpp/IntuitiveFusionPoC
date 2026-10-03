-- M9 evaluation: remember when a panel member finished scoring, and make the database itself enforce stream isolation
-- on bid files (a technical evaluator can never read pricing, even through a direct query).
ALTER TABLE panel_member ADD COLUMN scored_at timestamptz;
--> statement-breakpoint

DROP POLICY file_select ON file_object;
--> statement-breakpoint
-- Readable by (a) the supplier who owns the submission; (b) after close, procurement, probity and legal for submitted bids;
-- (c) after close, a panel member who has declared "no conflict": a technical member only technical files, a commercial
-- member only commercial files, the chair (stream OTHER) everything. Administrators and executives are in no group.
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
