-- B1: settings-driven intake and workflow features, notification channels and escalation.
ALTER TABLE request
  ADD COLUMN taxonomy_scheme text,
  ADD COLUMN taxonomy_code text,
  ADD COLUMN taxonomy_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN workflow_id text,
  ADD COLUMN sub_workflow text,
  ADD COLUMN process_steps jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN process_variations jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN engagements jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN nominated_delegates jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN ecv jsonb;
--> statement-breakpoint
ALTER TABLE supplier ADD COLUMN categories jsonb NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE workflow ADD COLUMN sub_workflows jsonb NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE notification ADD COLUMN event text;
--> statement-breakpoint
CREATE TABLE notification_delivery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  notification_id uuid NOT NULL REFERENCES notification(id),
  channel text NOT NULL,
  status text NOT NULL DEFAULT 'SENT',
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX notification_delivery_notification_idx ON notification_delivery(notification_id);
--> statement-breakpoint
CREATE TABLE escalation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  level integer NOT NULL DEFAULT 1,
  notified_user_id uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT escalation_once UNIQUE (entity_type, entity_id, level)
);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON notification_delivery, escalation TO app_user;
