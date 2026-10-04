DROP TABLE IF EXISTS tender_deviation;
DROP TABLE IF EXISTS public_notice;
ALTER TABLE file_object DROP COLUMN IF EXISTS carried_from;
ALTER TABLE tender DROP COLUMN IF EXISTS shortlisted_at, DROP COLUMN IF EXISTS shortlist, DROP COLUMN IF EXISTS parent_tender_id, DROP COLUMN IF EXISTS stage;
ALTER TABLE supplier DROP COLUMN IF EXISTS sanctions_note, DROP COLUMN IF EXISTS insurance_expires_on, DROP COLUMN IF EXISTS insurance, DROP COLUMN IF EXISTS privacy, DROP COLUMN IF EXISTS onboarding;
DROP TABLE IF EXISTS late_permission;
ALTER TABLE question DROP COLUMN IF EXISTS target_supplier_id, DROP COLUMN IF EXISTS audience;
DROP TABLE IF EXISTS outbound_email;
