-- G1-V2 fixes. Does not rewrite 0003. Replaces definer functions with an owner that has no BYPASSRLS.

SET ROLE zhixue_owner;

ALTER TABLE zhixue.submissions
  ADD COLUMN page_count integer NOT NULL DEFAULT 1 CHECK (page_count >= 1),
  ADD COLUMN ocr_char_count integer NOT NULL DEFAULT 64 CHECK (ocr_char_count >= 0);

ALTER TABLE zhixue.model_invocations
  ADD COLUMN response_body jsonb,
  ADD COLUMN response_sha256 text;

ALTER TABLE zhixue.upload_sessions
  ADD COLUMN temp_released_at timestamptz;

CREATE POLICY p_upload_sessions_owner_read ON zhixue.upload_sessions
  FOR SELECT TO zhixue_owner USING (true);
CREATE POLICY p_upload_sessions_owner_write ON zhixue.upload_sessions
  FOR UPDATE TO zhixue_owner USING (true) WITH CHECK (true);
CREATE POLICY p_submissions_owner_read ON zhixue.submissions
  FOR SELECT TO zhixue_owner USING (true);

RESET ROLE;

DROP FUNCTION IF EXISTS zhixue_ctl.object_is_live(text);
DROP FUNCTION IF EXISTS zhixue_ctl.list_unknown_running(integer);
DROP FUNCTION IF EXISTS zhixue_ctl.list_expired_admissions(integer);

SET ROLE zhixue_owner;

CREATE FUNCTION zhixue_ctl.object_is_live(p_key text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM zhixue.source_assets a WHERE a.storage_key = p_key
  ) OR EXISTS (
    SELECT 1 FROM zhixue.upload_sessions s
    WHERE s.temp_key = p_key
      AND s.temp_released_at IS NULL
      AND s.lease_until > pg_catalog.clock_timestamp()
      AND s.state IN ('uploading', 'committing')
  ) OR EXISTS (
    SELECT 1 FROM zhixue.upload_sessions s
    WHERE s.final_key = p_key
      AND s.state = 'committing'
      AND s.lease_until > pg_catalog.clock_timestamp()
  )
$$;

CREATE FUNCTION zhixue_ctl.list_unknown_running(p_seconds integer)
RETURNS TABLE (job_id uuid, tenant_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT j.id, j.tenant_id
  FROM zhixue.processing_jobs j
  JOIN zhixue.model_invocations i ON i.tenant_id = j.tenant_id AND i.job_id = j.id
  WHERE j.status = 'running'
    AND i.send_state = 'send_unknown'
    AND j.claimed_at IS NOT NULL
    AND j.claimed_at + make_interval(secs => p_seconds) < pg_catalog.clock_timestamp()
$$;

CREATE FUNCTION zhixue_ctl.list_expired_admissions(p_seconds integer)
RETURNS TABLE (job_id uuid, tenant_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT a.job_id, a.tenant_id
  FROM zhixue.job_admissions a
  JOIN zhixue.processing_jobs j ON j.tenant_id = a.tenant_id AND j.id = a.job_id
  WHERE a.state = 'admitted'
    AND j.status = 'queued'
    AND j.created_at + make_interval(secs => p_seconds) < pg_catalog.clock_timestamp()
$$;

CREATE FUNCTION zhixue_ctl.list_past_deadline(p_seconds integer)
RETURNS TABLE (job_id uuid, tenant_id uuid, status text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT j.id, j.tenant_id, j.status
  FROM zhixue.processing_jobs j
  WHERE j.status IN ('queued', 'running')
    AND j.created_at + make_interval(secs => p_seconds) < pg_catalog.clock_timestamp()
    AND NOT EXISTS (
      SELECT 1 FROM zhixue.model_invocations i
      WHERE i.tenant_id = j.tenant_id AND i.job_id = j.id AND i.send_state = 'send_unknown'
    )
$$;

REVOKE ALL ON FUNCTION zhixue_ctl.object_is_live(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION zhixue_ctl.list_unknown_running(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION zhixue_ctl.list_expired_admissions(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION zhixue_ctl.list_past_deadline(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION zhixue_ctl.object_is_live(text) TO zhixue_reconciler;
GRANT EXECUTE ON FUNCTION zhixue_ctl.list_unknown_running(integer) TO zhixue_reconciler;
GRANT EXECUTE ON FUNCTION zhixue_ctl.list_expired_admissions(integer) TO zhixue_reconciler;
GRANT EXECUTE ON FUNCTION zhixue_ctl.list_past_deadline(integer) TO zhixue_reconciler;

CREATE FUNCTION zhixue_ctl.expire_committing_uploads()
RETURNS TABLE (temp_key text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  UPDATE zhixue.upload_sessions
  SET state = 'expired', temp_released_at = pg_catalog.clock_timestamp()
  WHERE state = 'committing'
    AND lease_until < pg_catalog.clock_timestamp()
    AND temp_released_at IS NULL
  RETURNING temp_key
$$;

REVOKE ALL ON FUNCTION zhixue_ctl.expire_committing_uploads() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION zhixue_ctl.expire_committing_uploads() TO zhixue_reconciler;

RESET ROLE;
