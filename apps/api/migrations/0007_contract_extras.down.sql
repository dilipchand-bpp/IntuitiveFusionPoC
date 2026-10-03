ALTER TABLE alert DROP COLUMN IF EXISTS created_by;
--> statement-breakpoint
ALTER TABLE alert DROP COLUMN IF EXISTS note;
--> statement-breakpoint
ALTER TABLE clause DROP COLUMN IF EXISTS risk;
