-- B8: tender, contract and supplier intelligence.
-- FR-0130 interactive response schedules: the form a supplier fills in, and the answers.
CREATE TABLE response_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  tender_id uuid NOT NULL REFERENCES tender(id),
  key text NOT NULL,
  label text NOT NULL,
  section text NOT NULL,
  kind text NOT NULL,
  required boolean NOT NULL DEFAULT true,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  unit text,
  max_length integer,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX response_item_uq ON response_item (tender_id, key);
--> statement-breakpoint
CREATE TABLE response_answer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  submission_id uuid NOT NULL REFERENCES submission(id),
  item_key text NOT NULL,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX response_answer_uq ON response_answer (submission_id, item_key);
--> statement-breakpoint
-- FR-0175 dual-witness opening, FR-0185 required insurance cover.
ALTER TABLE tender ADD COLUMN dual_witness boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE tender ADD COLUMN opened_at timestamptz;
--> statement-breakpoint
ALTER TABLE tender ADD COLUMN required_cover numeric(14, 2);
--> statement-breakpoint
CREATE TABLE bid_witness (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  tender_id uuid NOT NULL REFERENCES tender(id),
  user_id uuid NOT NULL REFERENCES app_user(id),
  witnessed_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX bid_witness_uq ON bid_witness (tender_id, user_id);
--> statement-breakpoint
ALTER TABLE supplier ADD COLUMN insurance_certificate jsonb;
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
          AND (t.dual_witness = false OR t.opened_at IS NOT NULL)
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
          AND (t.dual_witness = false OR t.opened_at IS NOT NULL)
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
-- FR-0390 integration events leaving the platform (outbox), and what a legal platform sends back.
CREATE TABLE integration_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  kind text NOT NULL,
  target text NOT NULL,
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'PENDING',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL,
  delivered_at timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX integration_event_uq ON integration_event (tenant_id, idempotency_key);
--> statement-breakpoint
ALTER TABLE legal_matter ADD COLUMN external_ref text;
--> statement-breakpoint
ALTER TABLE legal_matter ADD COLUMN external_stage text;
--> statement-breakpoint
CREATE TABLE legal_redline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  contract_id uuid NOT NULL REFERENCES contract(id),
  clause_id text NOT NULL,
  proposed_text text NOT NULL,
  source text NOT NULL,
  author text NOT NULL,
  status text NOT NULL DEFAULT 'PROPOSED',
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL
);
--> statement-breakpoint
-- FR-0830 redaction and insertion of clauses.
ALTER TABLE clause ADD COLUMN redacted boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE clause ADD COLUMN after_clause_id text;
--> statement-breakpoint
-- FR-0790 ratings both ways.
CREATE TABLE supplier_rating (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  supplier_id uuid NOT NULL REFERENCES supplier(id),
  contract_id uuid NOT NULL REFERENCES contract(id),
  direction text NOT NULL,
  rater_id uuid NOT NULL REFERENCES app_user(id),
  scores jsonb NOT NULL,
  overall numeric(3, 2) NOT NULL,
  comment text,
  created_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX supplier_rating_uq ON supplier_rating (contract_id, direction, rater_id);
--> statement-breakpoint
-- FR-0795 pairs a person has said are not duplicates.
CREATE TABLE duplicate_dismissal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  supplier_a uuid NOT NULL REFERENCES supplier(id),
  supplier_b uuid NOT NULL REFERENCES supplier(id),
  user_id uuid NOT NULL REFERENCES app_user(id),
  reason text NOT NULL,
  created_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX duplicate_dismissal_uq ON duplicate_dismissal (supplier_a, supplier_b);
--> statement-breakpoint
-- FR-0805 lessons learned.
CREATE TABLE lesson (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  request_id uuid NOT NULL REFERENCES request(id),
  author_id uuid NOT NULL REFERENCES app_user(id),
  phase text NOT NULL,
  kind text NOT NULL,
  text text NOT NULL,
  category text,
  value numeric(14, 2),
  created_at timestamptz NOT NULL
);
--> statement-breakpoint
-- NFR-U05 one-time approval links.
CREATE TABLE approval_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  token_hash text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES app_user(id),
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL
);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON response_item, response_answer, bid_witness, integration_event, legal_redline, supplier_rating, duplicate_dismissal, lesson, approval_link TO app_user;
