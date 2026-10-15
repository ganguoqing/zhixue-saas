-- Recoverable delivery intent for the current attempt. Does not rewrite 0001-0005.

SET ROLE zhixue_owner;

CREATE TABLE zhixue.delivery_intents (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  job_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  fencing_epoch integer NOT NULL,
  stage text NOT NULL,
  billable boolean NOT NULL,
  lease_token text NOT NULL,
  generation integer NOT NULL,
  input_hash text NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  dispatch_id uuid,
  bull_job_id text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, attempt_id),
  CONSTRAINT chk_delivery_state CHECK (state IN ('pending', 'dispatched', 'acked', 'executing'))
);

ALTER TABLE zhixue.delivery_intents FORCE ROW LEVEL SECURITY;
CREATE POLICY p_delivery_owner ON zhixue.delivery_intents
  FOR ALL TO zhixue_owner USING (true) WITH CHECK (true);
CREATE POLICY p_delivery_reconciler ON zhixue.delivery_intents
  FOR ALL TO zhixue_reconciler
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY p_delivery_ingress ON zhixue.delivery_intents
  FOR ALL TO zhixue_ai_ingress
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON zhixue.delivery_intents TO zhixue_reconciler, zhixue_ai_ingress;
GRANT UPDATE (lease_until) ON zhixue.execution_attempts TO zhixue_reconciler;
GRANT ALL ON zhixue.delivery_intents TO zhixue_migrator;

CREATE FUNCTION zhixue_ctl.list_open_deliveries()
RETURNS TABLE (
  tenant_id uuid,
  intent_id uuid,
  job_id uuid,
  attempt_id uuid,
  fencing_epoch integer,
  stage text,
  billable boolean,
  lease_token text,
  generation integer,
  input_hash text,
  state text,
  dispatch_id uuid,
  bull_job_id text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT d.tenant_id, d.id, d.job_id, d.attempt_id, d.fencing_epoch, d.stage, d.billable,
         d.lease_token, d.generation, d.input_hash, d.state, d.dispatch_id, d.bull_job_id
  FROM zhixue.delivery_intents d
  JOIN zhixue.processing_jobs j
    ON j.tenant_id = d.tenant_id AND j.id = d.job_id AND j.current_attempt_id = d.attempt_id
  WHERE j.status = 'running'
    AND d.state IN ('pending', 'dispatched', 'acked')
$$;

REVOKE ALL ON FUNCTION zhixue_ctl.list_open_deliveries() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION zhixue_ctl.list_open_deliveries() TO zhixue_reconciler;

RESET ROLE;

SET ROLE zhixue_router;

CREATE FUNCTION zhixue_ctl.dispatch_enqueued_recently(p_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM zhixue_ctl.capability_dispatches
    WHERE id = p_id
      AND state = 'pending_enqueue'
      AND created_at > pg_catalog.clock_timestamp() - interval '5 seconds'
  )
$$;

REVOKE ALL ON FUNCTION zhixue_ctl.dispatch_enqueued_recently(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION zhixue_ctl.dispatch_enqueued_recently(uuid) TO zhixue_reconciler;

RESET ROLE;
