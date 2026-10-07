DROP POLICY IF EXISTS contract_scope ON contract;
--> statement-breakpoint
DROP POLICY IF EXISTS evaluation_scope ON evaluation;
--> statement-breakpoint
DROP POLICY IF EXISTS tender_scope ON tender;
--> statement-breakpoint
DROP POLICY IF EXISTS plan_scope ON plan;
--> statement-breakpoint
DROP POLICY IF EXISTS request_scope ON request;
--> statement-breakpoint
ALTER TABLE contract DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE evaluation DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tender DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE plan DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE request DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS restricted_delegate_scope ON restricted_delegate;
--> statement-breakpoint
DROP POLICY IF EXISTS restricted_project_scope ON restricted_project;
--> statement-breakpoint
DROP FUNCTION IF EXISTS b11_notification_hidden(text, text, text);
--> statement-breakpoint
DROP FUNCTION IF EXISTS b11_hidden_entity_ids();
--> statement-breakpoint
DROP FUNCTION IF EXISTS b11_hidden_request_ids();
--> statement-breakpoint
DROP FUNCTION IF EXISTS b11_can_see_tender(uuid);
--> statement-breakpoint
DROP FUNCTION IF EXISTS b11_can_see_request(uuid);
--> statement-breakpoint
DROP TABLE IF EXISTS restricted_delegate;
--> statement-breakpoint
DROP TABLE IF EXISTS restricted_project;
--> statement-breakpoint
DROP TABLE IF EXISTS quarantine_item;
--> statement-breakpoint
DROP TABLE IF EXISTS kms_key;
