-- Extend result_status for stage failures and deadlines. Does not rewrite 0001-0004.

SET ROLE zhixue_owner;

DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'zhixue.processing_jobs'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%result_status%'
  LOOP
    EXECUTE format('ALTER TABLE zhixue.processing_jobs DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;
ALTER TABLE zhixue.processing_jobs ADD CONSTRAINT chk_result_status CHECK (result_status IN (
  'pending', 'accepted', 'missing_result', 'input_changed',
  'rejected_schema', 'rejected_semantic',
  'provider_http', 'bad_json', 'missing_persisted_result', 'schema_rejected', 'deadline'
));

ALTER TABLE zhixue.upload_sessions DROP CONSTRAINT IF EXISTS upload_sessions_state_check;
ALTER TABLE zhixue.upload_sessions ADD CONSTRAINT chk_upload_state CHECK (
  state IN ('uploading', 'committing', 'finalized', 'expired', 'reclaimed')
);

CREATE FUNCTION zhixue_ctl.claim_object_reclaim(p_key text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_state text;
  v_lease timestamptz;
  v_temp text;
  v_final text;
  v_released timestamptz;
  v_changed integer;
BEGIN
  SELECT id, state, lease_until, temp_key, final_key, temp_released_at
    INTO v_id, v_state, v_lease, v_temp, v_final, v_released
  FROM zhixue.upload_sessions
  WHERE temp_key = p_key OR final_key = p_key
  FOR UPDATE;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM zhixue.source_assets a WHERE a.storage_key = p_key) THEN
      RETURN false;
    END IF;
    RETURN true;
  END IF;
  IF p_key = v_final AND EXISTS (SELECT 1 FROM zhixue.source_assets a WHERE a.storage_key = p_key) THEN
    RETURN false;
  END IF;
  IF v_state = 'finalized' AND p_key = v_final THEN
    RETURN false;
  END IF;
  IF v_state IN ('uploading', 'committing') AND v_lease > pg_catalog.clock_timestamp() THEN
    RETURN false;
  END IF;
  IF v_state = 'committing' AND v_lease <= pg_catalog.clock_timestamp() THEN
    UPDATE zhixue.upload_sessions
    SET state = 'reclaimed', temp_released_at = pg_catalog.clock_timestamp()
    WHERE id = v_id AND state = 'committing' AND lease_until <= pg_catalog.clock_timestamp();
    GET DIAGNOSTICS v_changed = ROW_COUNT;
    RETURN v_changed = 1;
  END IF;
  IF v_state = 'finalized' AND p_key = v_temp AND v_released IS NOT NULL THEN
    RETURN true;
  END IF;
  IF v_state IN ('expired', 'reclaimed') THEN
    RETURN true;
  END IF;
  RETURN false;
END
$$;

REVOKE ALL ON FUNCTION zhixue_ctl.claim_object_reclaim(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION zhixue_ctl.claim_object_reclaim(text) TO zhixue_reconciler;

RESET ROLE;
