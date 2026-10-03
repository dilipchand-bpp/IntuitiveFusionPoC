DROP INDEX IF EXISTS alert_system_uq;
--> statement-breakpoint
DROP TABLE IF EXISTS alert_delivery;
--> statement-breakpoint
DROP TABLE IF EXISTS contract_extension;
--> statement-breakpoint
DROP TABLE IF EXISTS contract_milestone;
--> statement-breakpoint
ALTER TABLE contract DROP COLUMN IF EXISTS owner_id;
