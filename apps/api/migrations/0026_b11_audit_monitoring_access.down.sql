DROP TABLE IF EXISTS bank_detail_change;
--> statement-breakpoint
DROP TABLE IF EXISTS access_tag;
--> statement-breakpoint
DROP TABLE IF EXISTS access_policy;
--> statement-breakpoint
DROP TABLE IF EXISTS compliance_check_result;
--> statement-breakpoint
DROP TABLE IF EXISTS security_alert;
--> statement-breakpoint
DROP TABLE IF EXISTS access_event;
--> statement-breakpoint
DROP TABLE IF EXISTS export_pack_log;
--> statement-breakpoint
DROP TABLE IF EXISTS admin_chain_verification;
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_event_chain_guard ON audit_event;
--> statement-breakpoint
DROP FUNCTION IF EXISTS audit_chain_guard();
--> statement-breakpoint
DROP INDEX IF EXISTS audit_category_idx;
--> statement-breakpoint
ALTER TABLE audit_event DROP COLUMN IF EXISTS category;
