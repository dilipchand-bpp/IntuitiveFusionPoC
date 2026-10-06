ALTER TABLE integration_event DROP COLUMN IF EXISTS remote_ack_at;
--> statement-breakpoint
ALTER TABLE integration_event DROP COLUMN IF EXISTS next_attempt_at;
--> statement-breakpoint
ALTER TABLE integration_event DROP COLUMN IF EXISTS direction;
--> statement-breakpoint
ALTER TABLE integration_event DROP COLUMN IF EXISTS connector_kind;
--> statement-breakpoint
DROP TABLE IF EXISTS manual_task;
--> statement-breakpoint
DROP TABLE IF EXISTS sync_run;
--> statement-breakpoint
DROP TABLE IF EXISTS secret_entry;
--> statement-breakpoint
DROP TABLE IF EXISTS connector;
