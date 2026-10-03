-- M12b: deviation risk rating on clauses; the user's own wording and author on custom alerts.
ALTER TABLE clause ADD COLUMN risk text CHECK (risk IN ('LOW', 'MEDIUM', 'HIGH'));
--> statement-breakpoint
ALTER TABLE alert ADD COLUMN note text;
--> statement-breakpoint
ALTER TABLE alert ADD COLUMN created_by uuid REFERENCES app_user(id);
