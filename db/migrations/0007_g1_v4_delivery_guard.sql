-- Enable RLS and parent/epoch guards for delivery_intents. Does not rewrite 0001-0006.
-- Inconsistent existing rows fail this migration. They are not deleted.

SET ROLE zhixue_owner;

DO $$
DECLARE
  inconsistent integer;
BEGIN
  SELECT count(*) INTO inconsistent
  FROM zhixue.delivery_intents d
  WHERE d.fencing_epoch < 1
     OR d.generation < 1
     OR NOT EXISTS (
       SELECT 1 FROM zhixue.processing_jobs j
       WHERE j.tenant_id = d.tenant_id AND j.id = d.job_id
     )
     OR NOT EXISTS (
       SELECT 1 FROM zhixue.execution_attempts a
       WHERE a.tenant_id = d.tenant_id AND a.job_id = d.job_id AND a.id = d.attempt_id
         AND a.fencing_epoch = d.fencing_epoch
     )
     OR EXISTS (
       SELECT 1 FROM zhixue.processing_jobs j
       WHERE j.tenant_id = d.tenant_id AND j.id = d.job_id
         AND (
           j.input_generation <> d.generation
           OR j.input_hash <> d.input_hash
           OR j.stage <> d.stage
           OR j.billable IS DISTINCT FROM d.billable
         )
     );
  IF inconsistent > 0 THEN
    RAISE EXCEPTION
      'delivery_intents has % inconsistent rows; migration 0007 refuses to discard in-progress data',
      inconsistent;
  END IF;
END $$;

ALTER TABLE zhixue.delivery_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE zhixue.delivery_intents FORCE ROW LEVEL SECURITY;

ALTER TABLE zhixue.delivery_intents
  ADD CONSTRAINT chk_delivery_epoch CHECK (fencing_epoch >= 1),
  ADD CONSTRAINT chk_delivery_generation CHECK (generation >= 1);

ALTER TABLE zhixue.execution_attempts
  ADD CONSTRAINT uq_attempt_identity_epoch UNIQUE (tenant_id, job_id, id, fencing_epoch);

ALTER TABLE zhixue.delivery_intents
  ADD CONSTRAINT fk_delivery_job
  FOREIGN KEY (tenant_id, job_id)
  REFERENCES zhixue.processing_jobs (tenant_id, id);

ALTER TABLE zhixue.delivery_intents
  ADD CONSTRAINT fk_delivery_attempt
  FOREIGN KEY (tenant_id, job_id, attempt_id)
  REFERENCES zhixue.execution_attempts (tenant_id, job_id, id);

ALTER TABLE zhixue.delivery_intents
  ADD CONSTRAINT fk_delivery_attempt_epoch
  FOREIGN KEY (tenant_id, job_id, attempt_id, fencing_epoch)
  REFERENCES zhixue.execution_attempts (tenant_id, job_id, id, fencing_epoch);

CREATE FUNCTION zhixue.delivery_intent_matches_authority()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM zhixue.execution_attempts a
    WHERE a.tenant_id = NEW.tenant_id AND a.job_id = NEW.job_id AND a.id = NEW.attempt_id
  ) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM zhixue.execution_attempts a
    JOIN zhixue.processing_jobs j
      ON j.tenant_id = a.tenant_id AND j.id = a.job_id
    WHERE a.tenant_id = NEW.tenant_id
      AND a.job_id = NEW.job_id
      AND a.id = NEW.attempt_id
      AND a.fencing_epoch = NEW.fencing_epoch
      AND j.input_generation = NEW.generation
      AND j.input_hash = NEW.input_hash
      AND j.stage = NEW.stage
      AND j.billable IS NOT DISTINCT FROM NEW.billable
  ) THEN
    RAISE EXCEPTION 'delivery intent does not match the current job and attempt'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION zhixue.delivery_intent_matches_authority() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION zhixue.delivery_intent_matches_authority() TO zhixue_ai_ingress, zhixue_reconciler;

CREATE TRIGGER trg_delivery_authority
  BEFORE INSERT OR UPDATE ON zhixue.delivery_intents
  FOR EACH ROW EXECUTE FUNCTION zhixue.delivery_intent_matches_authority();

RESET ROLE;
