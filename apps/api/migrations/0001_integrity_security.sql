-- Hand-written migration: referential integrity, value checks, least-privilege role, append-only guards, RLS.
-- Rollback: 0001_integrity_security.down.sql

-- ---------- application role (least privilege; the API connects as / switches to this role) ----------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
--> statement-breakpoint
-- The audit trail is INSERT/SELECT only for the application (SEC-L01).
REVOKE UPDATE, DELETE, TRUNCATE ON audit_event FROM app_user;
--> statement-breakpoint
-- Migration bookkeeping is not the application's business.
REVOKE ALL ON __migrations FROM app_user;
--> statement-breakpoint

-- ---------- foreign keys ----------
ALTER TABLE org_unit ADD CONSTRAINT fk_org_unit_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
--> statement-breakpoint
ALTER TABLE app_user ADD CONSTRAINT fk_user_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
--> statement-breakpoint
ALTER TABLE app_user ADD CONSTRAINT fk_user_org FOREIGN KEY (org_unit_id) REFERENCES org_unit(id);
--> statement-breakpoint
ALTER TABLE app_user ADD CONSTRAINT fk_user_supplier FOREIGN KEY (supplier_id) REFERENCES supplier(id);
--> statement-breakpoint
ALTER TABLE role_assignment ADD CONSTRAINT fk_role_user FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE delegation ADD CONSTRAINT fk_delegation_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
--> statement-breakpoint
ALTER TABLE supplier ADD CONSTRAINT fk_supplier_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
--> statement-breakpoint
ALTER TABLE request ADD CONSTRAINT fk_request_requester FOREIGN KEY (requester_id) REFERENCES app_user(id);
--> statement-breakpoint
ALTER TABLE conversation ADD CONSTRAINT fk_conv_user FOREIGN KEY (user_id) REFERENCES app_user(id);
--> statement-breakpoint
ALTER TABLE chat_message ADD CONSTRAINT fk_msg_conv FOREIGN KEY (conversation_id) REFERENCES conversation(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE plan ADD CONSTRAINT fk_plan_request FOREIGN KEY (request_id) REFERENCES request(id);
--> statement-breakpoint
ALTER TABLE approval ADD CONSTRAINT fk_approval_user FOREIGN KEY (user_id) REFERENCES app_user(id);
--> statement-breakpoint
ALTER TABLE coi_declaration ADD CONSTRAINT fk_coi_user FOREIGN KEY (user_id) REFERENCES app_user(id);
--> statement-breakpoint
ALTER TABLE tender ADD CONSTRAINT fk_tender_request FOREIGN KEY (request_id) REFERENCES request(id);
--> statement-breakpoint
ALTER TABLE invitation ADD CONSTRAINT fk_inv_tender FOREIGN KEY (tender_id) REFERENCES tender(id);
--> statement-breakpoint
ALTER TABLE question ADD CONSTRAINT fk_q_tender FOREIGN KEY (tender_id) REFERENCES tender(id);
--> statement-breakpoint
ALTER TABLE question ADD CONSTRAINT fk_q_supplier FOREIGN KEY (asked_by_supplier_id) REFERENCES supplier(id);
--> statement-breakpoint
ALTER TABLE addendum ADD CONSTRAINT fk_add_tender FOREIGN KEY (tender_id) REFERENCES tender(id);
--> statement-breakpoint
ALTER TABLE submission ADD CONSTRAINT fk_sub_tender FOREIGN KEY (tender_id) REFERENCES tender(id);
--> statement-breakpoint
ALTER TABLE submission ADD CONSTRAINT fk_sub_supplier FOREIGN KEY (supplier_id) REFERENCES supplier(id);
--> statement-breakpoint
ALTER TABLE file_object ADD CONSTRAINT fk_file_sub FOREIGN KEY (submission_id) REFERENCES submission(id);
--> statement-breakpoint
ALTER TABLE evaluation ADD CONSTRAINT fk_eval_tender FOREIGN KEY (tender_id) REFERENCES tender(id);
--> statement-breakpoint
ALTER TABLE criterion ADD CONSTRAINT fk_crit_eval FOREIGN KEY (evaluation_id) REFERENCES evaluation(id);
--> statement-breakpoint
ALTER TABLE panel_member ADD CONSTRAINT fk_panel_eval FOREIGN KEY (evaluation_id) REFERENCES evaluation(id);
--> statement-breakpoint
ALTER TABLE panel_member ADD CONSTRAINT fk_panel_user FOREIGN KEY (user_id) REFERENCES app_user(id);
--> statement-breakpoint
ALTER TABLE score ADD CONSTRAINT fk_score_eval FOREIGN KEY (evaluation_id) REFERENCES evaluation(id);
--> statement-breakpoint
ALTER TABLE score ADD CONSTRAINT fk_score_supplier FOREIGN KEY (supplier_id) REFERENCES supplier(id);
--> statement-breakpoint
ALTER TABLE score ADD CONSTRAINT fk_score_crit FOREIGN KEY (criterion_id) REFERENCES criterion(id);
--> statement-breakpoint
ALTER TABLE score ADD CONSTRAINT fk_score_evaluator FOREIGN KEY (evaluator_id) REFERENCES app_user(id);
--> statement-breakpoint
ALTER TABLE consensus_item ADD CONSTRAINT fk_cons_eval FOREIGN KEY (evaluation_id) REFERENCES evaluation(id);
--> statement-breakpoint
ALTER TABLE eval_report ADD CONSTRAINT fk_report_eval FOREIGN KEY (evaluation_id) REFERENCES evaluation(id);
--> statement-breakpoint
ALTER TABLE contract ADD CONSTRAINT fk_contract_supplier FOREIGN KEY (supplier_id) REFERENCES supplier(id);
--> statement-breakpoint
ALTER TABLE contract ADD CONSTRAINT fk_contract_parent FOREIGN KEY (parent_id) REFERENCES contract(id);
--> statement-breakpoint
ALTER TABLE contract ADD CONSTRAINT fk_contract_tender FOREIGN KEY (tender_id) REFERENCES tender(id);
--> statement-breakpoint
ALTER TABLE clause ADD CONSTRAINT fk_clause_contract FOREIGN KEY (contract_id) REFERENCES contract(id);
--> statement-breakpoint
ALTER TABLE alert ADD CONSTRAINT fk_alert_contract FOREIGN KEY (contract_id) REFERENCES contract(id);
--> statement-breakpoint
ALTER TABLE notification ADD CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES app_user(id);
--> statement-breakpoint
ALTER TABLE audit_event ADD CONSTRAINT fk_audit_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
--> statement-breakpoint

-- ---------- value checks ----------
ALTER TABLE score ADD CONSTRAINT ck_score_range CHECK (score >= 0 AND score <= 10);
--> statement-breakpoint
ALTER TABLE criterion ADD CONSTRAINT ck_weight_range CHECK (weight >= 0 AND weight <= 100);
--> statement-breakpoint
ALTER TABLE supplier ADD CONSTRAINT ck_abn CHECK (abn ~ '^[0-9]{11}$');
--> statement-breakpoint
ALTER TABLE request ADD CONSTRAINT ck_request_value CHECK (estimated_value IS NULL OR estimated_value >= 0);
--> statement-breakpoint
ALTER TABLE delegation ADD CONSTRAINT ck_delegation_value CHECK (max_value >= 0);
--> statement-breakpoint
ALTER TABLE contract ADD CONSTRAINT ck_contract_dates CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date);
--> statement-breakpoint
ALTER TABLE contract ADD CONSTRAINT ck_notice_days CHECK (notice_days >= 0);
--> statement-breakpoint

-- ---------- append-only / immutability guards (defence in depth beyond GRANTs) ----------
CREATE FUNCTION forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not permitted (append-only)', TG_OP, TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_event_no_update BEFORE UPDATE OR DELETE ON audit_event FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
CREATE TRIGGER audit_event_no_truncate BEFORE TRUNCATE ON audit_event FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
CREATE TRIGGER approval_no_delete BEFORE DELETE ON approval FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
CREATE TRIGGER contract_no_delete BEFORE DELETE ON contract FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
CREATE FUNCTION approval_only_supersede() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.decision = 'SUPERSEDED' AND OLD.decision <> 'SUPERSEDED'
     AND NEW.user_id = OLD.user_id AND NEW.subject_id = OLD.subject_id AND NEW.decided_at = OLD.decided_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'approvals are immutable except being superseded' USING ERRCODE = 'insufficient_privilege';
END $$;
--> statement-breakpoint
CREATE TRIGGER approval_update_guard BEFORE UPDATE ON approval FOR EACH ROW EXECUTE FUNCTION approval_only_supersede();
--> statement-breakpoint
-- Executed (locked) contracts: commercial terms cannot change (FR-0455). Logical delete and bookkeeping remain possible.
CREATE FUNCTION contract_lock_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.locked AND (NEW.value IS DISTINCT FROM OLD.value OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
     OR NEW.number IS DISTINCT FROM OLD.number OR NEW.start_date IS DISTINCT FROM OLD.start_date
     OR NEW.end_date IS DISTINCT FROM OLD.end_date OR NEW.notice_days IS DISTINCT FROM OLD.notice_days
     OR NEW.template_id IS DISTINCT FROM OLD.template_id OR NEW.locked IS DISTINCT FROM OLD.locked) THEN
    RAISE EXCEPTION 'contract % is executed and locked', OLD.number USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER contract_lock BEFORE UPDATE ON contract FOR EACH ROW EXECUTE FUNCTION contract_lock_guard();
--> statement-breakpoint

-- ---------- row level security: evaluator scores (ADR-0007; Spike A) ----------
-- Settings are read with current_setting(..., true) so an unset value yields NULL => no rows (fail closed).
ALTER TABLE score ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE score FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY score_select ON score FOR SELECT TO app_user USING (
  tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND (
    evaluator_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR (
      current_setting('app.role', true) IN ('CHAIR', 'PROBITY')
      AND EXISTS (SELECT 1 FROM evaluation e WHERE e.id = score.evaluation_id AND e.status <> 'SCORING' AND e.status <> 'COI_PENDING')
    )
  )
);
--> statement-breakpoint
CREATE POLICY score_insert ON score FOR INSERT TO app_user WITH CHECK (
  tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND evaluator_id = NULLIF(current_setting('app.user_id', true), '')::uuid
);
--> statement-breakpoint
CREATE POLICY score_update ON score FOR UPDATE TO app_user
  USING (evaluator_id = NULLIF(current_setting('app.user_id', true), '')::uuid
         AND EXISTS (SELECT 1 FROM evaluation e WHERE e.id = score.evaluation_id AND e.status = 'SCORING'))
  WITH CHECK (evaluator_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
