DROP TABLE IF EXISTS migration_record;
DROP TABLE IF EXISTS migration_batch;
ALTER TABLE contract DROP COLUMN IF EXISTS source_system;
ALTER TABLE request DROP COLUMN IF EXISTS source_system;
