-- M10 contracts: clauses of an executed (locked) contract are frozen at the database as well as in the API.
-- Contract-level terms were already guarded by contract_lock (migration 0001); this closes the clause table.
CREATE FUNCTION clause_lock_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cid uuid;
BEGIN
  cid := COALESCE(NEW.contract_id, OLD.contract_id);
  IF EXISTS (SELECT 1 FROM contract c WHERE c.id = cid AND c.locked) THEN
    RAISE EXCEPTION 'the clauses of an executed contract cannot be changed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER clause_lock BEFORE INSERT OR UPDATE OR DELETE ON clause FOR EACH ROW EXECUTE FUNCTION clause_lock_guard();
--> statement-breakpoint
-- One live contract per tender award.
CREATE UNIQUE INDEX contract_tender_live_uq ON contract (tender_id) WHERE tender_id IS NOT NULL AND deleted_at IS NULL AND parent_id IS NULL;
