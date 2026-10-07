-- B11a: encryption, key management, upload scanning and restricted projects.
-- SEC-D02 customer-managed keys with rotation (local key service), SEC-D04 per-tenant envelope encryption, SEC-D03 sealed bids,
-- SEC-AP04 malware scanning with quarantine, FR-0865 project-level encryption, SEC-D01 evidence, SEC-D10 tenant isolation.
-- Every table here is protected by row level security on tenant_id as well as by the application's own filters.
CREATE TABLE kms_key (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  purpose text NOT NULL CHECK (purpose IN ('DATA', 'BIDS', 'PROJECT')),
  version integer NOT NULL CHECK (version >= 1),
  wrapped_key text NOT NULL,
  iv text NOT NULL,
  fingerprint text NOT NULL,
  state text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'RETIRED', 'DISABLED')),
  created_at timestamptz NOT NULL,
  created_by uuid REFERENCES app_user(id),
  retired_at timestamptz,
  disabled_at timestamptz,
  disabled_by uuid REFERENCES app_user(id),
  rewrapped_at timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX kms_key_uq ON kms_key (tenant_id, purpose, version);
--> statement-breakpoint
CREATE TABLE quarantine_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  source text NOT NULL,
  name text NOT NULL,
  size_bytes integer NOT NULL,
  sha256 text NOT NULL,
  signature text,
  status text NOT NULL CHECK (status IN ('QUARANTINED', 'PENDING_SCAN', 'CLEARED')),
  user_id uuid REFERENCES app_user(id),
  held_content text,
  created_at timestamptz NOT NULL,
  scanned_at timestamptz,
  scanned_by uuid REFERENCES app_user(id)
);
--> statement-breakpoint
CREATE INDEX quarantine_item_idx ON quarantine_item (tenant_id, created_at);
--> statement-breakpoint
CREATE INDEX quarantine_item_hash_idx ON quarantine_item (tenant_id, sha256);
--> statement-breakpoint
CREATE TABLE restricted_project (
  request_id uuid PRIMARY KEY REFERENCES request(id),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  reason text NOT NULL,
  set_by uuid NOT NULL REFERENCES app_user(id),
  set_at timestamptz NOT NULL,
  key_version integer NOT NULL,
  wrapped_dek text NOT NULL,
  iv text NOT NULL,
  rewrapped_at timestamptz
);
--> statement-breakpoint
CREATE INDEX restricted_project_tenant_idx ON restricted_project (tenant_id);
--> statement-breakpoint
CREATE TABLE restricted_delegate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  request_id uuid NOT NULL REFERENCES restricted_project(request_id),
  user_id uuid NOT NULL REFERENCES app_user(id),
  added_by uuid NOT NULL REFERENCES app_user(id),
  added_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX restricted_delegate_uq ON restricted_delegate (request_id, user_id);
--> statement-breakpoint
ALTER TABLE kms_key ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE quarantine_item ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE restricted_project ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE restricted_delegate ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY kms_key_tenant ON kms_key FOR ALL TO app_user
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY quarantine_item_tenant ON quarantine_item FOR ALL TO app_user
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
-- FR-0865 restricted projects. Who belongs to the sourcing group of a restricted procurement: the person who restricted it, the
-- requester, the assigned procurement manager, the evaluation panel (not removed, no declared conflict), the probity
-- adviser allocated to its tender and the named delegates. SECURITY DEFINER so the membership test is not itself hidden by row
-- level security; a procurement that is not restricted is visible exactly as before.
CREATE FUNCTION b11_can_see_request(rid uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
BEGIN
  IF rid IS NULL OR NOT EXISTS (SELECT 1 FROM restricted_project rp WHERE rp.request_id = rid) THEN RETURN true; END IF;
  IF current_setting('app.role', true) = 'SYSTEM' THEN RETURN true; END IF;
  IF u IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM restricted_project rp WHERE rp.request_id = rid AND rp.set_by = u)
    OR EXISTS (SELECT 1 FROM request r WHERE r.id = rid AND (r.requester_id = u OR r.manager_id = u))
    OR EXISTS (SELECT 1 FROM restricted_delegate d WHERE d.request_id = rid AND d.user_id = u)
    OR EXISTS (SELECT 1 FROM tender t JOIN evaluation e ON e.tender_id = t.id JOIN panel_member pm ON pm.evaluation_id = e.id
               WHERE t.request_id = rid AND pm.user_id = u AND pm.coi_state NOT IN ('REMOVED', 'DECLARED_CONFLICT'))
    OR EXISTS (SELECT 1 FROM tender t JOIN probity_allocation pa ON pa.tender_id = t.id WHERE t.request_id = rid AND pa.user_id = u);
END $$;
--> statement-breakpoint
CREATE FUNCTION b11_can_see_tender(tid uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE rid uuid;
BEGIN
  IF tid IS NULL THEN RETURN true; END IF;
  SELECT t.request_id INTO rid FROM tender t WHERE t.id = tid;
  RETURN b11_can_see_request(rid);
END $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION b11_can_see_request(uuid), b11_can_see_tender(uuid) TO app_user;
--> statement-breakpoint
-- What a person must not see because it belongs to a restricted project they are not part of: the project's records (so their audit
-- events are left out of the audit trail) and any notification that names the project by id or number.
CREATE FUNCTION b11_hidden_request_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT rp.request_id FROM restricted_project rp
  WHERE rp.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND NOT b11_can_see_request(rp.request_id)
$$;
--> statement-breakpoint
CREATE FUNCTION b11_hidden_entity_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT h FROM b11_hidden_request_ids() h
  UNION SELECT p.id FROM plan p WHERE p.request_id IN (SELECT b11_hidden_request_ids())
  UNION SELECT t.id FROM tender t WHERE t.request_id IN (SELECT b11_hidden_request_ids())
  UNION SELECT s.id FROM submission s JOIN tender t ON t.id = s.tender_id WHERE t.request_id IN (SELECT b11_hidden_request_ids())
  UNION SELECT e.id FROM evaluation e JOIN tender t ON t.id = e.tender_id WHERE t.request_id IN (SELECT b11_hidden_request_ids())
  UNION SELECT r.id FROM eval_report r JOIN evaluation e ON e.id = r.evaluation_id JOIN tender t ON t.id = e.tender_id
    WHERE t.request_id IN (SELECT b11_hidden_request_ids())
  UNION SELECT c.id FROM contract c JOIN tender t ON t.id = c.tender_id WHERE t.request_id IN (SELECT b11_hidden_request_ids())
$$;
--> statement-breakpoint
CREATE FUNCTION b11_notification_hidden(p_link text, p_title text, p_body text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM b11_hidden_entity_ids() h WHERE coalesce(p_link, '') LIKE '%' || h::text || '%')
      OR EXISTS (SELECT 1 FROM request r WHERE r.id IN (SELECT b11_hidden_request_ids())
                 AND (coalesce(p_title, '') LIKE '%' || r.number || '%' OR coalesce(p_body, '') LIKE '%' || r.number || '%'
                      OR coalesce(p_title, '') LIKE '%' || r.title || '%' OR coalesce(p_body, '') LIKE '%' || r.title || '%'))
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION b11_hidden_request_ids(), b11_hidden_entity_ids(), b11_notification_hidden(text, text, text) TO app_user;
--> statement-breakpoint
CREATE POLICY restricted_project_scope ON restricted_project FOR ALL TO app_user
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND b11_can_see_request(request_id))
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY restricted_delegate_scope ON restricted_delegate FOR ALL TO app_user
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND b11_can_see_request(request_id))
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
-- The same two conditions (own tenant; not a restricted project of someone else's group) now guard the core procurement tables
-- in the database itself, so a route that forgot an application check still cannot read a restricted project or another tenant's row.
ALTER TABLE request ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE plan ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tender ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE evaluation ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE contract ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY request_scope ON request FOR ALL TO app_user
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND b11_can_see_request(id))
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY plan_scope ON plan FOR ALL TO app_user
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND b11_can_see_request(request_id))
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY tender_scope ON tender FOR ALL TO app_user
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND b11_can_see_request(request_id))
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY evaluation_scope ON evaluation FOR ALL TO app_user
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND b11_can_see_tender(tender_id))
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY contract_scope ON contract FOR ALL TO app_user
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND b11_can_see_tender(tender_id))
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON kms_key, quarantine_item, restricted_project, restricted_delegate TO app_user;
