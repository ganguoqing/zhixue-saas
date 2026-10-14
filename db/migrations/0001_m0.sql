-- M0 runnable subset. Not the full product DDL.
-- Illustrative design remains docs/architecture/sql/core-chain-v3.sql.
-- No queued_after_claim. No ResumeAfterSettlement. No score publish event.

CREATE SCHEMA IF NOT EXISTS zhixue AUTHORIZATION zhixue_owner;
CREATE SCHEMA IF NOT EXISTS zhixue_ctl AUTHORIZATION zhixue_router;

SET ROLE zhixue_owner;
GRANT USAGE, CREATE ON SCHEMA zhixue TO zhixue_migrator;
RESET ROLE;

SET ROLE zhixue_router;
GRANT USAGE, CREATE ON SCHEMA zhixue_ctl TO zhixue_migrator;
RESET ROLE;

SET ROLE zhixue_owner;

CREATE TABLE zhixue.tenants (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (name LIKE 'synthetic-%')
);

CREATE TABLE zhixue.users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text NOT NULL CHECK (display_name LIKE 'synthetic-%'),
  kind text NOT NULL CHECK (kind IN ('member', 'platform'))
);

CREATE TABLE zhixue.memberships (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES zhixue.tenants (id),
  user_id uuid NOT NULL REFERENCES zhixue.users (id),
  UNIQUE (tenant_id, user_id),
  UNIQUE (tenant_id, id)
);

CREATE TABLE zhixue.data_scope_grants (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  class_id text NOT NULL,
  subject_id text NOT NULL,
  FOREIGN KEY (tenant_id, membership_id)
    REFERENCES zhixue.memberships (tenant_id, id) MATCH FULL
);

CREATE TABLE zhixue.source_assets (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  sha256 text NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size > 0),
  storage_key text NOT NULL UNIQUE,
  media_type text NOT NULL,
  status text NOT NULL CHECK (status = 'final'),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (id)
);

CREATE TABLE zhixue.submissions (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  class_id text NOT NULL,
  subject_id text NOT NULL,
  status text NOT NULL,
  state_version bigint NOT NULL DEFAULT 0,
  asset_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (id),
  FOREIGN KEY (tenant_id, asset_id)
    REFERENCES zhixue.source_assets (tenant_id, id) MATCH FULL
);

CREATE TABLE zhixue.submission_page_sets (
  tenant_id uuid NOT NULL,
  submission_id uuid NOT NULL,
  id uuid NOT NULL,
  PRIMARY KEY (tenant_id, submission_id, id),
  FOREIGN KEY (tenant_id, submission_id)
    REFERENCES zhixue.submissions (tenant_id, id) MATCH FULL
);

CREATE TABLE zhixue.submission_generations (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  submission_id uuid NOT NULL,
  page_set_id uuid NOT NULL,
  generation integer NOT NULL CHECK (generation >= 1),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, id, submission_id),
  FOREIGN KEY (tenant_id, submission_id, page_set_id)
    REFERENCES zhixue.submission_page_sets (tenant_id, submission_id, id)
    MATCH FULL
);

CREATE TABLE zhixue.students (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  label text NOT NULL CHECK (label LIKE 'synthetic-%'),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE zhixue.exams (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE zhixue.exam_participations (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  exam_id uuid NOT NULL,
  student_id uuid NOT NULL,
  paper_version_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, exam_id, student_id),
  UNIQUE (tenant_id, id, exam_id, paper_version_id),
  UNIQUE (tenant_id, id, exam_id, student_id),
  FOREIGN KEY (tenant_id, exam_id) REFERENCES zhixue.exams (tenant_id, id) MATCH FULL,
  FOREIGN KEY (tenant_id, student_id) REFERENCES zhixue.students (tenant_id, id) MATCH FULL
);

CREATE TABLE zhixue.exam_roster_entries (
  tenant_id uuid NOT NULL,
  roster_version_id uuid NOT NULL,
  id uuid NOT NULL,
  exam_id uuid NOT NULL,
  student_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, roster_version_id, id),
  UNIQUE (tenant_id, roster_version_id, id, exam_id, student_id),
  FOREIGN KEY (tenant_id, student_id) REFERENCES zhixue.students (tenant_id, id) MATCH FULL
);

CREATE TABLE zhixue.participation_roster_links (
  tenant_id uuid NOT NULL,
  participation_id uuid NOT NULL,
  roster_version_id uuid NOT NULL,
  roster_entry_id uuid NOT NULL,
  exam_id uuid NOT NULL,
  student_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, participation_id, roster_entry_id),
  FOREIGN KEY (tenant_id, participation_id, exam_id, student_id)
    REFERENCES zhixue.exam_participations (tenant_id, id, exam_id, student_id)
    MATCH FULL,
  FOREIGN KEY (tenant_id, roster_version_id, roster_entry_id, exam_id, student_id)
    REFERENCES zhixue.exam_roster_entries (tenant_id, roster_version_id, id, exam_id, student_id)
    MATCH FULL
);

CREATE TABLE zhixue.paper_questions (
  tenant_id uuid NOT NULL,
  paper_version_id uuid NOT NULL,
  id uuid NOT NULL,
  PRIMARY KEY (tenant_id, paper_version_id, id)
);

CREATE TABLE zhixue.matching_bindings (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE zhixue.processing_jobs (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  submission_id uuid NOT NULL,
  stage text NOT NULL CHECK (stage IN ('validate_asset', 'model_grade')),
  status text NOT NULL CHECK (status IN (
    'queued', 'running', 'succeeded', 'failed_final', 'cancelled',
    'awaiting_settlement', 'exception_review'
  )),
  result_status text NOT NULL DEFAULT 'pending' CHECK (result_status IN (
    'pending', 'accepted', 'missing_result', 'input_changed',
    'rejected_schema', 'rejected_semantic'
  )),
  binding_id uuid,
  paper_version_id uuid,
  current_attempt_id uuid,
  current_fencing_epoch integer NOT NULL DEFAULT 0,
  claimed_at timestamptz,
  current_lease_until timestamptz,
  input_generation integer NOT NULL CHECK (input_generation >= 1),
  input_hash text NOT NULL,
  logical_key text NOT NULL,
  state_version bigint NOT NULL DEFAULT 0,
  occupancy_held boolean NOT NULL DEFAULT false,
  billable boolean NOT NULL DEFAULT false,
  cancel_requested boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (id),
  UNIQUE (tenant_id, logical_key),
  FOREIGN KEY (tenant_id, submission_id)
    REFERENCES zhixue.submissions (tenant_id, id) MATCH FULL,
  FOREIGN KEY (tenant_id, binding_id)
    REFERENCES zhixue.matching_bindings (tenant_id, id) MATCH SIMPLE,
  CONSTRAINT chk_binding_by_stage CHECK (
    (stage = 'validate_asset' AND binding_id IS NULL)
    OR (stage = 'model_grade' AND binding_id IS NOT NULL)
  ),
  CONSTRAINT chk_attempt_until_claim CHECK (
    (
      status IN ('queued', 'cancelled', 'failed_final')
      AND claimed_at IS NULL
      AND current_attempt_id IS NULL
      AND current_fencing_epoch = 0
    )
    OR (
      claimed_at IS NOT NULL
      AND current_attempt_id IS NOT NULL
      AND current_fencing_epoch >= 1
      AND status <> 'queued'
    )
  )
);

CREATE TABLE zhixue.execution_attempts (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  job_id uuid NOT NULL,
  fencing_epoch integer NOT NULL CHECK (fencing_epoch >= 1),
  lease_token_hash text NOT NULL,
  lease_until timestamptz NOT NULL,
  started_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, job_id, fencing_epoch)
);

CREATE TABLE zhixue.job_admissions (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  job_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('admitted', 'consumed')),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, job_id)
);

CREATE TABLE zhixue.tenant_execution_occupancy (
  tenant_id uuid PRIMARY KEY REFERENCES zhixue.tenants (id),
  occupied integer NOT NULL DEFAULT 0 CHECK (occupied >= 0)
);

CREATE TABLE zhixue.global_execution_occupancy (
  id integer PRIMARY KEY CHECK (id = 1),
  occupied integer NOT NULL DEFAULT 0 CHECK (occupied >= 0)
);

INSERT INTO zhixue.global_execution_occupancy (id, occupied) VALUES (1, 0);

CREATE TABLE zhixue.model_invocations (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  job_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  send_state text NOT NULL CHECK (send_state IN ('not_sent', 'send_unknown', 'observed')),
  cost_status text NOT NULL CHECK (cost_status IN ('unknown', 'confirmed', 'abandoned_unknown')),
  amount numeric,
  include_in_total boolean NOT NULL DEFAULT false,
  input_hash text NOT NULL,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT chk_unknown_amount CHECK (
    (
      cost_status IN ('unknown', 'abandoned_unknown')
      AND amount IS NULL
      AND include_in_total = false
    )
    OR (
      cost_status = 'confirmed'
      AND amount IS NOT NULL
      AND include_in_total = true
    )
  )
);

CREATE TABLE zhixue.usage_ledger_entries (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  invocation_id uuid NOT NULL,
  settlement_kind text NOT NULL CHECK (settlement_kind IN ('unknown_marker', 'confirmed', 'adjustment')),
  settlement_key text NOT NULL,
  body_hash text NOT NULL,
  amount_delta numeric,
  include_in_total boolean NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, invocation_id, settlement_kind, settlement_key),
  CONSTRAINT chk_ledger_unknown CHECK (
    (include_in_total = false AND amount_delta IS NULL)
    OR (include_in_total = true AND amount_delta IS NOT NULL)
  )
);

CREATE TABLE zhixue.outbox_events (
  event_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  schema_version text NOT NULL,
  name text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  aggregate_version bigint NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  correlation_id uuid NOT NULL,
  causation_id uuid,
  CONSTRAINT m0_event_name CHECK (
    schema_version = 'zhixue.event/2'
    AND name = 'AssetFinalized'
    AND payload ? 'event_id'
    AND payload ? 'occurred_at'
    AND payload ? 'correlation_id'
    AND payload ? 'causation_id'
  )
);

CREATE TABLE zhixue.audit_events (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  action text NOT NULL,
  object_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE zhixue.command_receipts (
  tenant_id uuid NOT NULL,
  command_name text NOT NULL,
  idempotency_key text NOT NULL,
  body_hash text NOT NULL,
  response jsonb NOT NULL,
  PRIMARY KEY (tenant_id, command_name, idempotency_key)
);

CREATE TABLE zhixue.grade_proposals (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  job_id uuid NOT NULL,
  status text NOT NULL CHECK (status = 'review_required'),
  payload jsonb NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE zhixue.answer_revisions (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  job_id uuid NOT NULL,
  origin text NOT NULL CHECK (origin = 'manual'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE zhixue.score_drafts (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  job_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  status text NOT NULL CHECK (status = 'building'),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE zhixue.score_versions (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE zhixue.consumer_inbox (
  consumer_name text NOT NULL,
  event_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  PRIMARY KEY (consumer_name, event_id)
);

CREATE FUNCTION zhixue.require_manual_revision()
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
      AND r.origin = 'manual'
  ) THEN
    RAISE EXCEPTION 'manual revision required first' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER score_drafts_need_manual
BEFORE INSERT ON zhixue.score_drafts
FOR EACH ROW EXECUTE FUNCTION zhixue.require_manual_revision();

DO $$
DECLARE
  t text;
  r text;
  tables text[] := ARRAY[
    'memberships', 'data_scope_grants', 'source_assets', 'submissions',
    'submission_page_sets', 'submission_generations', 'students', 'exams',
    'exam_participations', 'exam_roster_entries', 'participation_roster_links',
    'paper_questions', 'matching_bindings', 'processing_jobs', 'execution_attempts',
    'job_admissions', 'tenant_execution_occupancy', 'model_invocations',
    'usage_ledger_entries', 'outbox_events', 'audit_events', 'command_receipts',
    'grade_proposals', 'answer_revisions', 'score_drafts', 'score_versions',
    'consumer_inbox'
  ];
  roles text[] := ARRAY[
    'zhixue_app', 'zhixue_ai_ingress', 'zhixue_reconciler', 'zhixue_scheduler', 'zhixue_relay'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE zhixue.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE zhixue.%I FORCE ROW LEVEL SECURITY', t);
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

CREATE POLICY p_memberships_router ON zhixue.memberships
  FOR SELECT TO zhixue_router USING (true);
CREATE POLICY p_jobs_owner_read ON zhixue.processing_jobs
  FOR SELECT TO zhixue_owner USING (true);
CREATE POLICY p_invocations_owner_read ON zhixue.model_invocations
  FOR SELECT TO zhixue_owner USING (true);
CREATE POLICY p_ledger_owner_read ON zhixue.usage_ledger_entries
  FOR SELECT TO zhixue_owner USING (true);
CREATE POLICY p_assets_owner_read ON zhixue.source_assets
  FOR SELECT TO zhixue_owner USING (true);
CREATE POLICY p_admissions_owner_read ON zhixue.job_admissions
  FOR SELECT TO zhixue_owner USING (true);

GRANT USAGE ON SCHEMA zhixue TO
  zhixue_app, zhixue_ai_ingress, zhixue_reconciler, zhixue_scheduler,
  zhixue_relay, zhixue_platform_ops, zhixue_migrator;

GRANT SELECT ON zhixue.users TO zhixue_app;
GRANT SELECT, INSERT, UPDATE ON
  zhixue.submissions, zhixue.source_assets, zhixue.submission_page_sets,
  zhixue.submission_generations, zhixue.students, zhixue.exams,
  zhixue.exam_participations, zhixue.exam_roster_entries,
  zhixue.participation_roster_links, zhixue.audit_events, zhixue.command_receipts,
  zhixue.answer_revisions, zhixue.score_drafts, zhixue.outbox_events
TO zhixue_app;
GRANT SELECT ON zhixue.memberships, zhixue.data_scope_grants, zhixue.paper_questions TO zhixue_app;
GRANT SELECT, INSERT, UPDATE ON zhixue.processing_jobs TO zhixue_app;
GRANT SELECT, UPDATE, DELETE ON zhixue.job_admissions TO zhixue_app;
GRANT SELECT, UPDATE ON zhixue.tenant_execution_occupancy TO zhixue_app;
GRANT SELECT ON zhixue.score_versions TO zhixue_app;
GRANT SELECT, UPDATE ON zhixue.global_execution_occupancy TO zhixue_app;

GRANT SELECT, UPDATE ON zhixue.processing_jobs TO zhixue_ai_ingress, zhixue_reconciler;
GRANT SELECT ON zhixue.processing_jobs TO zhixue_scheduler;
GRANT INSERT, SELECT ON zhixue.execution_attempts TO zhixue_ai_ingress, zhixue_reconciler;
GRANT SELECT, INSERT, UPDATE, DELETE ON zhixue.job_admissions TO zhixue_scheduler, zhixue_ai_ingress, zhixue_reconciler;
GRANT SELECT, UPDATE ON zhixue.tenant_execution_occupancy TO
  zhixue_scheduler, zhixue_ai_ingress, zhixue_reconciler, zhixue_app;
GRANT SELECT, UPDATE ON zhixue.global_execution_occupancy TO
  zhixue_scheduler, zhixue_ai_ingress, zhixue_reconciler;
GRANT SELECT, INSERT, UPDATE ON zhixue.model_invocations TO zhixue_ai_ingress, zhixue_reconciler;
GRANT SELECT ON zhixue.model_invocations TO zhixue_app;
GRANT SELECT, INSERT ON zhixue.usage_ledger_entries TO zhixue_ai_ingress, zhixue_reconciler;
GRANT SELECT, INSERT ON zhixue.grade_proposals TO zhixue_ai_ingress;
GRANT SELECT ON zhixue.grade_proposals TO zhixue_reconciler, zhixue_app;
GRANT SELECT ON zhixue.paper_questions, zhixue.matching_bindings TO zhixue_ai_ingress;
GRANT SELECT, INSERT, UPDATE ON zhixue.command_receipts TO zhixue_ai_ingress, zhixue_reconciler;
GRANT INSERT ON zhixue.matching_bindings TO zhixue_ai_ingress;
GRANT SELECT, INSERT ON zhixue.matching_bindings TO zhixue_app;

GRANT SELECT (
  event_id, tenant_id, schema_version, name, aggregate_type, aggregate_id,
  aggregate_version, payload, occurred_at, correlation_id, causation_id
) ON zhixue.outbox_events TO zhixue_relay;
GRANT SELECT, INSERT ON zhixue.consumer_inbox TO zhixue_relay;

GRANT ALL ON ALL TABLES IN SCHEMA zhixue TO zhixue_migrator;
GRANT USAGE ON SCHEMA zhixue TO zhixue_router;
GRANT SELECT ON zhixue.memberships TO zhixue_router;

RESET ROLE;

SET ROLE zhixue_router;

CREATE TABLE zhixue_ctl.schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

CREATE TABLE zhixue_ctl.work_route_index (
  job_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  env text NOT NULL,
  capability_hash text NOT NULL,
  not_after timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE TABLE zhixue_ctl.capability_dispatches (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL,
  capability_hash text NOT NULL,
  state text NOT NULL CHECK (state IN ('pending_enqueue', 'acked', 'superseded')),
  bull_job_id text,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

CREATE TABLE zhixue_ctl.outbox_dispatch_index (
  event_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'leased', 'delivered')),
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

CREATE FUNCTION zhixue_ctl.capability_hash(p_env text, p_job_id uuid, p_secret text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT encode(
    public.digest(convert_to(p_env || p_job_id::text || p_secret, 'UTF8'), 'sha256'),
    'hex'
  )
$$;

CREATE FUNCTION zhixue_ctl.list_memberships(p_user_id uuid)
RETURNS TABLE (membership_id uuid, tenant_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT m.id, m.tenant_id
  FROM zhixue.memberships m
  WHERE m.user_id = p_user_id
$$;

CREATE FUNCTION zhixue_ctl.register_capability(
  p_job_id uuid,
  p_tenant uuid,
  p_env text,
  p_secret text,
  p_not_after timestamptz,
  p_dispatch uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_hash text;
BEGIN
  IF current_setting('app.tenant_id', true)::uuid IS DISTINCT FROM p_tenant THEN
    RAISE EXCEPTION 'tenant mismatch' USING ERRCODE = '42501';
  END IF;
  v_hash := zhixue_ctl.capability_hash(p_env, p_job_id, p_secret);
  INSERT INTO zhixue_ctl.work_route_index (job_id, tenant_id, env, capability_hash, not_after)
  VALUES (p_job_id, p_tenant, p_env, v_hash, p_not_after);
  INSERT INTO zhixue_ctl.capability_dispatches (id, job_id, capability_hash, state)
  VALUES (p_dispatch, p_job_id, v_hash, 'pending_enqueue');
END
$$;

CREATE FUNCTION zhixue_ctl.resolve_work_route(p_job_id uuid, p_capability text)
RETURNS TABLE (tenant_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT w.tenant_id
  FROM zhixue_ctl.work_route_index w
  WHERE w.job_id = p_job_id
    AND w.revoked_at IS NULL
    AND w.not_after > pg_catalog.clock_timestamp()
    AND w.env = current_setting('app.env', true)
    AND w.capability_hash = zhixue_ctl.capability_hash(w.env, w.job_id, p_capability);
END
$$;

CREATE FUNCTION zhixue_ctl.replace_capability(
  p_job_id uuid,
  p_secret text,
  p_not_after timestamptz,
  p_new_dispatch uuid,
  p_old_dispatch uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_env text;
  v_hash text;
BEGIN
  SELECT w.env INTO v_env
  FROM zhixue_ctl.work_route_index w
  WHERE w.job_id = p_job_id
  FOR UPDATE;
  IF v_env IS NULL THEN
    RAISE EXCEPTION 'missing route' USING ERRCODE = 'P0002';
  END IF;
  v_hash := zhixue_ctl.capability_hash(v_env, p_job_id, p_secret);
  UPDATE zhixue_ctl.work_route_index
  SET capability_hash = v_hash,
      revoked_at = NULL,
      not_after = p_not_after
  WHERE job_id = p_job_id;
  UPDATE zhixue_ctl.capability_dispatches
  SET state = 'superseded'
  WHERE id = p_old_dispatch;
  INSERT INTO zhixue_ctl.capability_dispatches (id, job_id, capability_hash, state)
  VALUES (p_new_dispatch, p_job_id, v_hash, 'pending_enqueue');
END
$$;

CREATE FUNCTION zhixue_ctl.ack_dispatch(p_id uuid, p_bull_job_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  UPDATE zhixue_ctl.capability_dispatches
  SET state = 'acked', bull_job_id = p_bull_job_id
  WHERE id = p_id AND state = 'pending_enqueue';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'dispatch not pending' USING ERRCODE = 'P0002';
  END IF;
END
$$;

CREATE FUNCTION zhixue_ctl.list_capability_dispatches()
RETURNS TABLE (
  dispatch_id uuid,
  job_id uuid,
  state text,
  bull_job_id text,
  tenant_id uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT d.id, d.job_id, d.state, d.bull_job_id, w.tenant_id
  FROM zhixue_ctl.capability_dispatches d
  JOIN zhixue_ctl.work_route_index w ON w.job_id = d.job_id
  WHERE d.state IN ('pending_enqueue', 'acked')
$$;

CREATE FUNCTION zhixue_ctl.session_identity()
RETURNS TABLE (session_user_name text, current_user_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT session_user::text, current_user::text
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA zhixue_ctl FROM PUBLIC;
GRANT EXECUTE ON FUNCTION zhixue_ctl.list_memberships(uuid) TO zhixue_app;
GRANT EXECUTE ON FUNCTION zhixue_ctl.register_capability(uuid, uuid, text, text, timestamptz, uuid) TO zhixue_app;
GRANT EXECUTE ON FUNCTION zhixue_ctl.resolve_work_route(uuid, text) TO zhixue_ai_ingress, zhixue_reconciler;
GRANT EXECUTE ON FUNCTION zhixue_ctl.replace_capability(uuid, text, timestamptz, uuid, uuid) TO zhixue_reconciler;
GRANT EXECUTE ON FUNCTION zhixue_ctl.ack_dispatch(uuid, text) TO zhixue_relay, zhixue_reconciler;
GRANT EXECUTE ON FUNCTION zhixue_ctl.list_capability_dispatches() TO zhixue_reconciler;
GRANT EXECUTE ON FUNCTION zhixue_ctl.session_identity() TO zhixue_ai_ingress;
GRANT SELECT, UPDATE ON zhixue_ctl.outbox_dispatch_index TO zhixue_relay;
GRANT SELECT ON zhixue_ctl.outbox_dispatch_index TO zhixue_owner;
GRANT INSERT ON zhixue_ctl.outbox_dispatch_index TO zhixue_app;
GRANT ALL ON ALL TABLES IN SCHEMA zhixue_ctl TO zhixue_migrator;
GRANT USAGE ON SCHEMA zhixue_ctl TO
  zhixue_app, zhixue_ai_ingress, zhixue_reconciler, zhixue_scheduler,
  zhixue_relay, zhixue_platform_ops, zhixue_migrator;
GRANT USAGE, CREATE ON SCHEMA zhixue_ctl TO zhixue_owner;

RESET ROLE;

SET ROLE zhixue_owner;

CREATE FUNCTION zhixue_ctl.job_tenant(p_job_id uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT j.tenant_id FROM zhixue.processing_jobs j WHERE j.id = p_job_id
$$;

CREATE FUNCTION zhixue_ctl.ops_usage_totals()
RETURNS TABLE (
  tenant_id uuid,
  period text,
  resource_type text,
  total_amount numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT l.tenant_id,
         'all'::text,
         'invocation'::text,
         COALESCE(SUM(l.amount_delta) FILTER (WHERE l.include_in_total), 0)
  FROM zhixue.usage_ledger_entries l
  WHERE current_setting('app.access_mode', true) = 'platform_aggregate'
  GROUP BY l.tenant_id
$$;

CREATE FUNCTION zhixue_ctl.metrics_snapshot()
RETURNS TABLE (
  outbox_oldest_pending_seconds numeric,
  job_oldest_running_seconds numeric,
  invocation_unknown_count bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT
    (
      SELECT EXTRACT(EPOCH FROM (pg_catalog.clock_timestamp() - MIN(i.created_at)))
      FROM zhixue_ctl.outbox_dispatch_index i
      WHERE i.status = 'pending'
    ),
    (
      SELECT EXTRACT(EPOCH FROM (pg_catalog.clock_timestamp() - MIN(j.claimed_at)))
      FROM zhixue.processing_jobs j
      WHERE j.status = 'running'
    ),
    (
      SELECT COUNT(*)
      FROM zhixue.model_invocations n
      WHERE n.cost_status = 'unknown'
    )
$$;

CREATE FUNCTION zhixue_ctl.list_storage_keys()
RETURNS TABLE (storage_key text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT a.storage_key FROM zhixue.source_assets a
$$;

CREATE FUNCTION zhixue_ctl.list_expired_without_unknown()
RETURNS TABLE (job_id uuid, tenant_id uuid, fencing_epoch integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT j.id, j.tenant_id, j.current_fencing_epoch
  FROM zhixue.processing_jobs j
  WHERE j.status = 'running'
    AND j.current_lease_until IS NOT NULL
    AND j.current_lease_until < pg_catalog.clock_timestamp()
    AND NOT EXISTS (
      SELECT 1
      FROM zhixue.model_invocations i
      WHERE i.tenant_id = j.tenant_id
        AND i.job_id = j.id
        AND i.send_state = 'send_unknown'
    )
$$;

CREATE FUNCTION zhixue_ctl.list_queued_for_admit()
RETURNS TABLE (job_id uuid, tenant_id uuid, created_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT j.id, j.tenant_id, j.created_at
  FROM zhixue.processing_jobs j
  WHERE j.status = 'queued'
    AND j.current_fencing_epoch = 0
    AND j.current_attempt_id IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM zhixue.job_admissions a
      WHERE a.tenant_id = j.tenant_id
        AND a.job_id = j.id
    )
  ORDER BY j.created_at
$$;

CREATE FUNCTION zhixue_ctl.publish_score_version(p_draft uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'official publish is outside M0' USING ERRCODE = '42501';
END
$$;

REVOKE ALL ON FUNCTION zhixue_ctl.job_tenant(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION zhixue_ctl.ops_usage_totals() FROM PUBLIC;
REVOKE ALL ON FUNCTION zhixue_ctl.metrics_snapshot() FROM PUBLIC;
REVOKE ALL ON FUNCTION zhixue_ctl.list_storage_keys() FROM PUBLIC;
REVOKE ALL ON FUNCTION zhixue_ctl.list_expired_without_unknown() FROM PUBLIC;
REVOKE ALL ON FUNCTION zhixue_ctl.list_queued_for_admit() FROM PUBLIC;
REVOKE ALL ON FUNCTION zhixue_ctl.publish_score_version(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION zhixue_ctl.job_tenant(uuid) TO zhixue_ai_ingress, zhixue_reconciler, zhixue_app;
GRANT EXECUTE ON FUNCTION zhixue_ctl.ops_usage_totals() TO zhixue_platform_ops;
GRANT EXECUTE ON FUNCTION zhixue_ctl.metrics_snapshot() TO zhixue_reconciler;
GRANT EXECUTE ON FUNCTION zhixue_ctl.list_storage_keys() TO zhixue_reconciler;
GRANT EXECUTE ON FUNCTION zhixue_ctl.list_expired_without_unknown() TO zhixue_reconciler;
GRANT EXECUTE ON FUNCTION zhixue_ctl.list_queued_for_admit() TO zhixue_scheduler;
GRANT EXECUTE ON FUNCTION zhixue_ctl.publish_score_version(uuid) TO zhixue_app;

RESET ROLE;
