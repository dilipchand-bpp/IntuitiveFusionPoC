-- Reverses 0001_integrity_security.sql (roles are cluster-level and intentionally left in place).
DROP POLICY IF EXISTS score_update ON score;
--> statement-breakpoint
DROP POLICY IF EXISTS score_insert ON score;
--> statement-breakpoint
DROP POLICY IF EXISTS score_select ON score;
--> statement-breakpoint
ALTER TABLE score NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE score DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP TRIGGER IF EXISTS contract_lock ON contract;
--> statement-breakpoint
DROP FUNCTION IF EXISTS contract_lock_guard();
--> statement-breakpoint
DROP TRIGGER IF EXISTS approval_update_guard ON approval;
--> statement-breakpoint
DROP FUNCTION IF EXISTS approval_only_supersede();
--> statement-breakpoint
DROP TRIGGER IF EXISTS contract_no_delete ON contract;
--> statement-breakpoint
DROP TRIGGER IF EXISTS approval_no_delete ON approval;
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_event_no_truncate ON audit_event;
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_event_no_update ON audit_event;
--> statement-breakpoint
DROP FUNCTION IF EXISTS forbid_change();
--> statement-breakpoint
ALTER TABLE contract DROP CONSTRAINT IF EXISTS ck_notice_days, DROP CONSTRAINT IF EXISTS ck_contract_dates;
--> statement-breakpoint
ALTER TABLE delegation DROP CONSTRAINT IF EXISTS ck_delegation_value;
--> statement-breakpoint
ALTER TABLE request DROP CONSTRAINT IF EXISTS ck_request_value;
--> statement-breakpoint
ALTER TABLE supplier DROP CONSTRAINT IF EXISTS ck_abn;
--> statement-breakpoint
ALTER TABLE criterion DROP CONSTRAINT IF EXISTS ck_weight_range;
--> statement-breakpoint
ALTER TABLE score DROP CONSTRAINT IF EXISTS ck_score_range;
--> statement-breakpoint
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conrelid::regclass AS t, conname FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.t, r.conname);
  END LOOP;
END $$;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app_user;
--> statement-breakpoint
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM app_user;
--> statement-breakpoint
REVOKE USAGE ON SCHEMA public FROM app_user;
