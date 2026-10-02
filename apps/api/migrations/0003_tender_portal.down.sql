DROP POLICY IF EXISTS file_delete ON file_object;
--> statement-breakpoint
DROP POLICY IF EXISTS file_update ON file_object;
--> statement-breakpoint
DROP POLICY IF EXISTS file_insert ON file_object;
--> statement-breakpoint
DROP POLICY IF EXISTS file_select ON file_object;
--> statement-breakpoint
ALTER TABLE file_object NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE file_object DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE file_object DROP COLUMN sha256;
--> statement-breakpoint
DROP INDEX IF EXISTS invitation_tender_supplier_idx;
--> statement-breakpoint
ALTER TABLE invitation DROP COLUMN supplier_id;
