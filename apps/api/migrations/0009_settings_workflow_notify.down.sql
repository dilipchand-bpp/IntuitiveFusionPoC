ALTER TABLE supplier DROP COLUMN IF EXISTS categories;
DROP TABLE IF EXISTS escalation;
DROP TABLE IF EXISTS notification_delivery;
ALTER TABLE notification DROP COLUMN IF EXISTS event;
ALTER TABLE workflow DROP COLUMN IF EXISTS sub_workflows;
ALTER TABLE request
  DROP COLUMN IF EXISTS taxonomy_scheme,
  DROP COLUMN IF EXISTS taxonomy_code,
  DROP COLUMN IF EXISTS taxonomy_confirmed,
  DROP COLUMN IF EXISTS workflow_id,
  DROP COLUMN IF EXISTS sub_workflow,
  DROP COLUMN IF EXISTS process_steps,
  DROP COLUMN IF EXISTS process_variations,
  DROP COLUMN IF EXISTS engagements,
  DROP COLUMN IF EXISTS nominated_delegates,
  DROP COLUMN IF EXISTS ecv;
