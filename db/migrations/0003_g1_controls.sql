-- M0 control fixes for G1-01–G1-09. Additive to 0001/0002.
-- Does not publish scores and does not add ResumeAfterSettlement.

SET ROLE zhixue_owner;

ALTER TABLE zhixue.memberships
  ADD COLUMN revoked_at timestamptz;

ALTER TABLE zhixue.data_scope_grants
  ADD COLUMN action text NOT NULL DEFAULT 'read'
  CHECK (action IN ('read', 'finalize', 'cancel', 'manual'));

ALTER TABLE zhixue.model_invocations
  ADD COLUMN send_permit_epoch integer NOT NULL DEFAULT 0 CHECK (send_permit_epoch >= 0),
  ADD COLUMN config_hash text NOT NULL DEFAULT '',
  ADD COLUMN binding_id uuid,
  ADD COLUMN provider_status integer;

ALTER TABLE zhixue.job_admissions
  ADD COLUMN admitted_at timestamptz NOT NULL DEFAULT pg_catalog.now();

ALTER TABLE zhixue.execution_attempts
  ADD CONSTRAINT uq_attempt_job_id UNIQUE (tenant_id, job_id, id);

ALTER TABLE zhixue.execution_attempts
  ADD CONSTRAINT fk_attempt_job
  FOREIGN KEY (tenant_id, job_id)
  REFERENCES zhixue.processing_jobs (tenant_id, id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE zhixue.processing_jobs
  ADD CONSTRAINT fk_job_current_attempt
  FOREIGN KEY (tenant_id, id, current_attempt_id)
  REFERENCES zhixue.execution_attempts (tenant_id, job_id, id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE zhixue.model_invocations
  ADD CONSTRAINT fk_invocation_attempt
  FOREIGN KEY (tenant_id, job_id, attempt_id)
  REFERENCES zhixue.execution_attempts (tenant_id, job_id, id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE zhixue.usage_ledger_entries
  ADD CONSTRAINT fk_ledger_invocation
  FOREIGN KEY (tenant_id, invocation_id)
  REFERENCES zhixue.model_invocations (tenant_id, id);

ALTER TABLE zhixue.grade_proposals
  ADD CONSTRAINT fk_proposal_job
  FOREIGN KEY (tenant_id, job_id)
  REFERENCES zhixue.processing_jobs (tenant_id, id);

ALTER TABLE zhixue.answer_revisions
  ADD CONSTRAINT uq_revision_job_id UNIQUE (tenant_id, job_id, id);

ALTER TABLE zhixue.answer_revisions
  ADD CONSTRAINT fk_revision_job
  FOREIGN KEY (tenant_id, job_id)
  REFERENCES zhixue.processing_jobs (tenant_id, id);

ALTER TABLE zhixue.score_drafts
  ADD CONSTRAINT fk_draft_revision
  FOREIGN KEY (tenant_id, job_id, revision_id)
  REFERENCES zhixue.answer_revisions (tenant_id, job_id, id);

ALTER TABLE zhixue.score_drafts
  ADD CONSTRAINT uq_draft_job UNIQUE (tenant_id, job_id);

CREATE OR REPLACE FUNCTION zhixue.require_manual_revision()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM zhixue.answer_revisions r
    WHERE r.tenant_id = NEW.tenant_id
      AND r.job_id = NEW.job_id
      AND r.id = NEW.revision_id
      AND r.origin = 'manual'
  ) THEN
    RAISE EXCEPTION 'manual revision required first' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE TABLE zhixue.upload_sessions (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  membership_id uuid NOT NULL,
  class_id text NOT NULL,
  subject_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('uploading', 'committing', 'finalized', 'expired')),
  temp_key text NOT NULL,
  final_key text,
  lease_until timestamptz NOT NULL,
  byte_size integer,
  sha256 text,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE zhixue.asset_notices (
  event_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  submission_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

CREATE TABLE zhixue.invocation_budgets (
  tenant_id uuid PRIMARY KEY REFERENCES zhixue.tenants (id),
  remaining integer NOT NULL CHECK (remaining >= 0)
);

CREATE TABLE zhixue.rubric_points (
  tenant_id uuid NOT NULL,
  paper_version_id uuid NOT NULL,
  question_id uuid NOT NULL,
  criterion_id uuid NOT NULL,
  max_points numeric NOT NULL,
  PRIMARY KEY (tenant_id, paper_version_id, question_id, criterion_id)
);

CREATE TABLE zhixue.admit_cursor (
  id integer PRIMARY KEY CHECK (id = 1),
  last_tenant_id uuid
);

INSERT INTO zhixue.admit_cursor (id, last_tenant_id) VALUES (1, NULL);

ALTER TABLE zhixue.upload_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE zhixue.upload_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE zhixue.asset_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE zhixue.asset_notices FORCE ROW LEVEL SECURITY;
ALTER TABLE zhixue.invocation_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE zhixue.invocation_budgets FORCE ROW LEVEL SECURITY;
ALTER TABLE zhixue.rubric_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE zhixue.rubric_points FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
  r text;
  tables text[] := ARRAY['upload_sessions', 'asset_notices', 'invocation_budgets', 'rubric_points'];
  roles text[] := ARRAY['zhixue_app', 'zhixue_ai_ingress', 'zhixue_reconciler', 'zhixue_scheduler', 'zhixue_relay'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    FOREACH r IN ARRAY roles LOOP
      EXECUTE format(
        'CREATE POLICY %I ON zhixue.%I FOR ALL TO %I USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
        'p_' || t || '_' || replace(r, 'zhixue_', ''),
        t,
        r
      );
    END LOOP;
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON zhixue.upload_sessions TO zhixue_app;
GRANT SELECT, INSERT ON zhixue.asset_notices TO zhixue_relay;
GRANT SELECT ON zhixue.asset_notices TO zhixue_app;
GRANT SELECT, UPDATE ON zhixue.invocation_budgets TO zhixue_ai_ingress, zhixue_reconciler, zhixue_scheduler;
GRANT SELECT ON zhixue.rubric_points TO zhixue_ai_ingress, zhixue_app;
GRANT SELECT, UPDATE ON zhixue.submissions TO zhixue_ai_ingress, zhixue_reconciler, zhixue_scheduler;
GRANT SELECT ON zhixue.submission_page_sets TO zhixue_ai_ingress;
GRANT SELECT, UPDATE ON zhixue.admit_cursor TO zhixue_scheduler, zhixue_reconciler, zhixue_ai_ingress;
GRANT ALL ON ALL TABLES IN SCHEMA zhixue TO zhixue_migrator;

RESET ROLE;

SET ROLE zhixue_router;

CREATE TABLE zhixue_ctl.used_jti (
  jti text PRIMARY KEY,
  subject text NOT NULL,
  used_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

GRANT INSERT, SELECT ON zhixue_ctl.used_jti TO
  zhixue_app, zhixue_ai_ingress, zhixue_reconciler, zhixue_scheduler, zhixue_relay;
GRANT ALL ON zhixue_ctl.used_jti TO zhixue_migrator;

CREATE OR REPLACE FUNCTION zhixue_ctl.list_memberships(p_user_id uuid)
RETURNS TABLE (membership_id uuid, tenant_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT m.id, m.tenant_id
  FROM zhixue.memberships m
  WHERE m.user_id = p_user_id
    AND m.revoked_at IS NULL
$$;

RESET ROLE;

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
    WHERE (s.temp_key = p_key OR s.final_key = p_key)
      AND (
        s.state IN ('committing', 'finalized')
        OR (s.state = 'uploading' AND s.lease_until > pg_catalog.clock_timestamp())
      )
  )
$$;

REVOKE ALL ON FUNCTION zhixue_ctl.object_is_live(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION zhixue_ctl.object_is_live(text) TO zhixue_reconciler;

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
    AND a.admitted_at + make_interval(secs => p_seconds) < pg_catalog.clock_timestamp()
$$;

REVOKE ALL ON FUNCTION zhixue_ctl.list_unknown_running(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION zhixue_ctl.list_expired_admissions(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION zhixue_ctl.list_unknown_running(integer) TO zhixue_reconciler;

SET ROLE zhixue_owner;
GRANT EXECUTE ON FUNCTION zhixue_ctl.list_queued_for_admit() TO zhixue_reconciler;
RESET ROLE;
GRANT EXECUTE ON FUNCTION zhixue_ctl.list_expired_admissions(integer) TO zhixue_reconciler;
