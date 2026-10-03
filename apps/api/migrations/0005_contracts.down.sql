DROP INDEX IF EXISTS contract_tender_live_uq;
--> statement-breakpoint
DROP TRIGGER IF EXISTS clause_lock ON clause;
--> statement-breakpoint
DROP FUNCTION IF EXISTS clause_lock_guard();
