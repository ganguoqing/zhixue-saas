import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { Queue } from 'bullmq';
import { Pool, type PoolClient } from 'pg';
import type { AppConfig } from './config';
import { log } from './logger';
import { schemaErrors, validateEnvelope } from './schemas';

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

interface Actor {
  userId: string;
  tenantId: string;
  membershipId: string;
}

interface Caps {
  tenant: number;
  global: number;
}

interface WorkerHints {
  fail?: boolean;
  stopAfterClaim?: boolean;
  billable?: boolean;
  delaySeconds?: number;
  action?: string;
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stable(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function mediaType(bytes: Buffer): string | null {
  if (bytes.subarray(0, 4).toString('utf8') === '%PDF') return 'application/pdf';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

function verifyPassword(password: string, stored: string): boolean {
  const [kind, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const actual = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export class M0Store {
  readonly app: Pool;
  readonly ingress: Pool;
  readonly relay: Pool;
  readonly reconciler: Pool;
  readonly scheduler: Pool;
  readonly platform: Pool;
  readonly queue: Queue;

  constructor(private readonly config: AppConfig) {
    const make = (user: string, passwordEnv: string) => new Pool({
      connectionString: config.databaseUrl(user, passwordEnv),
      max: 8,
      application_name: user,
    });
    this.app = make('zhixue_app', 'ZHIXUE_APP_PASSWORD');
    this.ingress = make('zhixue_ai_ingress', 'ZHIXUE_INGRESS_PASSWORD');
    this.relay = make('zhixue_relay', 'ZHIXUE_RELAY_PASSWORD');
    this.reconciler = make('zhixue_reconciler', 'ZHIXUE_RECONCILER_PASSWORD');
    this.scheduler = make('zhixue_scheduler', 'ZHIXUE_SCHEDULER_PASSWORD');
    this.platform = make('zhixue_platform_ops', 'ZHIXUE_PLATFORM_PASSWORD');
    this.queue = new Queue('zhixue-jobs', {
      connection: { host: config.redisHost, port: config.redisPort, maxRetriesPerRequest: null },
    });
  }

  async close(): Promise<void> {
    await this.queue.close();
    await Promise.all([
      this.app.end(), this.ingress.end(), this.relay.end(),
      this.reconciler.end(), this.scheduler.end(), this.platform.end(),
    ]);
  }

  async health(): Promise<Record<string, unknown>> {
    const db = await this.app.query('SELECT current_user');
    const redis = await this.queue.client;
    const pong = await redis.ping();
    return {
      status: pong === 'PONG' ? 'ok' : 'degraded',
      dbRole: db.rows[0].current_user,
      env: this.config.env,
      studentData: this.config.studentData,
      autoRetryUnknown: this.config.autoRetryUnknown,
      modelEndpoint: this.config.modelEndpoint,
    };
  }

  async login(email: string, password: string): Promise<{ tokenInput: Record<string, unknown> }> {
    const found = await this.app.query(
      'SELECT id, password_hash, kind FROM zhixue.users WHERE email = $1',
      [email],
    );
    const user = found.rows[0] as { id: string; password_hash: string; kind: string } | undefined;
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw new ApiError(401, 'invalid_credentials');
    }
    if (user.kind === 'platform') {
      return { tokenInput: { sub: user.id, role: 'platform' } };
    }
    const memberships = await this.app.query(
      'SELECT membership_id, tenant_id FROM zhixue_ctl.list_memberships($1)',
      [user.id],
    );
    const membership = memberships.rows[0] as { membership_id: string; tenant_id: string } | undefined;
    if (!membership) throw new ApiError(403, 'no_membership');
    return {
      tokenInput: {
        sub: user.id,
        role: 'member',
        tenantId: membership.tenant_id,
        membershipId: membership.membership_id,
      },
    };
  }

  async submission(actor: Actor, id: string): Promise<Record<string, unknown>> {
    return this.withTenant(this.app, actor.tenantId, 'member', async (client) => {
      const row = await client.query(
        `SELECT id, class_id, subject_id, status FROM zhixue.submissions WHERE id = $1`,
        [id],
      );
      if (row.rowCount === 0) throw new ApiError(404, 'not_found');
      const submission = row.rows[0] as { id: string; class_id: string; subject_id: string; status: string };
      await this.assertScope(client, actor, submission.class_id, submission.subject_id);
      return {
        id: submission.id,
        classId: submission.class_id,
        subjectId: submission.subject_id,
        status: submission.status,
      };
    });
  }

  async assetBytes(actor: Actor, id: string): Promise<{ bytes: Buffer; mediaType: string }> {
    return this.withTenant(this.app, actor.tenantId, 'member', async (client) => {
      const row = await client.query(
        `SELECT a.storage_key, a.media_type, s.class_id, s.subject_id
         FROM zhixue.source_assets a
         JOIN zhixue.submissions s ON s.tenant_id = a.tenant_id AND s.asset_id = a.id
         WHERE a.id = $1`,
        [id],
      );
      if (row.rowCount === 0) throw new ApiError(404, 'not_found');
      const asset = row.rows[0] as { storage_key: string; media_type: string; class_id: string; subject_id: string };
      await this.assertScope(client, actor, asset.class_id, asset.subject_id);
      const full = this.safePath(asset.storage_key);
      return { bytes: readFileSync(full), mediaType: asset.media_type };
    });
  }

  async jobView(actor: Actor, id: string): Promise<Record<string, unknown>> {
    return this.withTenant(this.app, actor.tenantId, 'member', async (client) => {
      const row = await client.query(
        `SELECT j.id, j.status, j.result_status, j.current_fencing_epoch, j.occupancy_held, j.stage, j.billable,
                s.class_id, s.subject_id
         FROM zhixue.processing_jobs j
         JOIN zhixue.submissions s ON s.tenant_id = j.tenant_id AND s.id = j.submission_id
         WHERE j.id = $1`,
        [id],
      );
      if (row.rowCount === 0) throw new ApiError(404, 'not_found');
      const job = row.rows[0] as {
        id: string; status: string; result_status: string; current_fencing_epoch: number;
        occupancy_held: boolean; stage: string; billable: boolean; class_id: string; subject_id: string;
      };
      await this.assertScope(client, actor, job.class_id, job.subject_id);
      return {
        id: job.id,
        status: job.status,
        resultStatus: job.result_status,
        fencingEpoch: job.current_fencing_epoch,
        occupancyHeld: job.occupancy_held,
        stage: job.stage,
        billable: job.billable,
      };
    });
  }

  async finalize(actor: Actor, input: {
    contentBase64: string;
    classId: string;
    subjectId: string;
    idempotencyKey: string;
    correlationId: string;
    crash?: string;
    caps?: Caps;
    hints?: WorkerHints;
  }): Promise<Record<string, unknown>> {
    const bytes = Buffer.from(input.contentBase64, 'base64');
    const kind = mediaType(bytes);
    if (!kind) throw new ApiError(400, 'unsupported_format');
    if (bytes.length > this.config.fileMaxBytes) throw new ApiError(400, 'file_too_large');
    const bodyHash = sha256(stable({
      content: input.contentBase64,
      classId: input.classId,
      subjectId: input.subjectId,
    }));
    const prior = await this.readReceipt(actor.tenantId, 'finalize', input.idempotencyKey);
    if (prior) {
      if (prior.body_hash !== bodyHash) throw new ApiError(409, 'idempotency_conflict');
      return prior.response as Record<string, unknown>;
    }
    const assetId = randomUUID();
    const submissionId = randomUUID();
    const jobId = randomUUID();
    const pageSetId = randomUUID();
    const generationId = randomUUID();
    const dispatchId = randomUUID();
    const eventId = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    const storageKey = `${actor.tenantId}/${assetId}`;
    const full = this.safePath(storageKey);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, bytes);
    const digest = sha256(bytes);
    const logicalKey = input.hints?.fail ? `${input.idempotencyKey}:fail` : input.idempotencyKey;
    try {
      await this.withTenant(this.app, actor.tenantId, 'member', async (client) => {
        await this.assertScope(client, actor, input.classId, input.subjectId);
        await client.query(
          `INSERT INTO zhixue.source_assets
            (tenant_id, id, sha256, byte_size, storage_key, media_type, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'final')`,
          [actor.tenantId, assetId, digest, bytes.length, storageKey, kind],
        );
        await client.query(
          `INSERT INTO zhixue.submissions
            (tenant_id, id, class_id, subject_id, status, asset_id, correlation_id)
           VALUES ($1, $2, $3, $4, 'awaiting_validation', $5, $6)`,
          [actor.tenantId, submissionId, input.classId, input.subjectId, assetId, input.correlationId],
        );
        await client.query(
          `INSERT INTO zhixue.submission_page_sets (tenant_id, submission_id, id) VALUES ($1, $2, $3)`,
          [actor.tenantId, submissionId, pageSetId],
        );
        await client.query(
          `INSERT INTO zhixue.submission_generations
            (tenant_id, id, submission_id, page_set_id, generation) VALUES ($1, $2, $3, $4, 1)`,
          [actor.tenantId, generationId, submissionId, pageSetId],
        );
        await client.query(
          `INSERT INTO zhixue.processing_jobs (
            tenant_id, id, submission_id, stage, status, result_status, input_generation,
            input_hash, logical_key, billable
          ) VALUES ($1, $2, $3, 'validate_asset', 'queued', 'pending', 1, $4, $5, false)`,
          [actor.tenantId, jobId, submissionId, digest, logicalKey],
        );
        const notAfter = new Date(Date.now() + this.config.capabilityTtlSeconds * 1000);
        await client.query(
          `SELECT zhixue_ctl.register_capability($1, $2, $3, $4, $5, $6)`,
          [jobId, actor.tenantId, this.config.env, secret, notAfter, dispatchId],
        );
        await client.query(
          `INSERT INTO zhixue.outbox_events (
            event_id, tenant_id, schema_version, name, aggregate_type, aggregate_id,
            aggregate_version, payload, occurred_at, correlation_id, causation_id
          ) VALUES (
            $1, $2, 'zhixue.event/2', 'AssetFinalized', 'submission', $3, 1, $4::jsonb, clock_timestamp(), $5, NULL
          )`,
          [eventId, actor.tenantId, submissionId, JSON.stringify({
            event_id: eventId,
            occurred_at: new Date().toISOString(),
            correlation_id: input.correlationId,
            causation_id: null,
            job_id: jobId,
          }), input.correlationId],
        );
        await client.query(
          `INSERT INTO zhixue_ctl.outbox_dispatch_index (event_id, tenant_id, status) VALUES ($1, $2, 'pending')`,
          [eventId, actor.tenantId],
        );
        await client.query(
          `INSERT INTO zhixue.audit_events (tenant_id, id, action, object_id, correlation_id)
           VALUES ($1, $2, 'finalize_asset', $3, $4)`,
          [actor.tenantId, randomUUID(), submissionId, input.correlationId],
        );
        const response = { submissionId, jobId, enqueued: false };
        await client.query(
          `INSERT INTO zhixue.command_receipts
            (tenant_id, command_name, idempotency_key, body_hash, response)
           VALUES ($1, 'finalize', $2, $3, $4::jsonb)`,
          [actor.tenantId, input.idempotencyKey, bodyHash, JSON.stringify(response)],
        );
        if (input.crash === 'before-commit') throw new ApiError(500, 'test_crash_before_commit');
      });
    } catch (error) {
      rmSync(full, { force: true });
      throw error;
    }
    if (input.crash === 'before-enqueue') throw new ApiError(500, 'test_crash_before_enqueue');
    await this.admitAll(input.caps);
    const admitted = await this.hasAdmission(actor.tenantId, jobId);
    const enqueued = admitted ? await this.publishCapability(dispatchId, {
      jobId,
      env: this.config.env,
      stage: 'validate_asset',
      fail: Boolean(input.hints?.fail) || (this.config.testHooks && logicalKey.endsWith(':fail')),
      stopAfterClaim: Boolean(input.hints?.stopAfterClaim),
      billable: false,
      delaySeconds: input.hints?.delaySeconds,
      action: 'execute',
    }, secret, input.crash) : false;
    await this.relayOnce();
    log('finalize_returned', { jobId, correlationId: input.correlationId, enqueued });
    return { submissionId, jobId, enqueued };
  }

  async createBillable(actor: Actor, idempotencyKey: string): Promise<Record<string, unknown>> {
    const bindingId = randomUUID();
    const submissionId = randomUUID();
    const assetId = randomUUID();
    const jobId = randomUUID();
    const dispatchId = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    const bytes = Buffer.from('%PDF-1.4\nsynthetic-billable\n');
    const storageKey = `${actor.tenantId}/${assetId}`;
    const full = this.safePath(storageKey);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, bytes);
    await this.withTenant(this.app, actor.tenantId, 'member', async (client) => {
      await client.query(
        `INSERT INTO zhixue.source_assets
          (tenant_id, id, sha256, byte_size, storage_key, media_type, status)
         VALUES ($1, $2, $3, $4, $5, 'application/pdf', 'final')`,
        [actor.tenantId, assetId, sha256(bytes), bytes.length, storageKey],
      );
      await client.query(
        `INSERT INTO zhixue.submissions
          (tenant_id, id, class_id, subject_id, status, asset_id, correlation_id)
         VALUES ($1, $2, 'c1', 'math', 'awaiting_validation', $3, $4)`,
        [actor.tenantId, submissionId, assetId, randomUUID()],
      );
      await client.query(
        `INSERT INTO zhixue.matching_bindings (tenant_id, id) VALUES ($1, $2)`,
        [actor.tenantId, bindingId],
      );
      await client.query(
        `INSERT INTO zhixue.processing_jobs (
          tenant_id, id, submission_id, stage, status, binding_id, paper_version_id,
          input_generation, input_hash, logical_key, billable
        ) VALUES (
          $1, $2, $3, 'model_grade', 'queued', $4, $5, 1, $6, $7, true
        )`,
        [
          actor.tenantId, jobId, submissionId, bindingId,
          '018f0a3e-7c21-7b2a-8c11-999999999999', sha256(bytes), idempotencyKey,
        ],
      );
      await client.query(
        `SELECT zhixue_ctl.register_capability($1, $2, $3, $4, $5, $6)`,
        [jobId, actor.tenantId, this.config.env, secret, new Date(Date.now() + 3600_000), dispatchId],
      );
    });
    await this.admitAll({ tenant: 400, global: 400 });
    await this.publishCapability(dispatchId, {
      jobId,
      env: this.config.env,
      stage: 'model_grade',
      billable: true,
      delaySeconds: 3,
      action: 'execute',
    }, secret);
    return { jobId, submissionId, capability: secret };
  }

  async cancel(actor: Actor, jobId: string): Promise<Record<string, unknown>> {
    return this.withTenant(this.app, actor.tenantId, 'member', async (client) => {
      const job = await this.lockJob(client, actor.tenantId, jobId);
      if (job.status === 'cancelled') return { status: 'cancelled' };
      if (job.status === 'queued') {
        await this.releaseAdmission(client, actor.tenantId, jobId, job.occupancy_held);
        await client.query(
          `UPDATE zhixue.processing_jobs
           SET status = 'cancelled', cancel_requested = true, state_version = state_version + 1
           WHERE id = $1`,
          [jobId],
        );
        return { status: 'cancelled' };
      }
      if (job.occupancy_held) await this.releaseHeld(client, actor.tenantId, jobId);
      await client.query(
        `UPDATE zhixue.processing_jobs
         SET status = 'cancelled', cancel_requested = true, occupancy_held = false, state_version = state_version + 1
         WHERE id = $1 AND status = 'running'`,
        [jobId],
      );
      return { status: 'cancelled' };
    });
  }

  async manualScore(actor: Actor, jobId: string): Promise<Record<string, unknown>> {
    return this.withTenant(this.app, actor.tenantId, 'member', async (client) => {
      const job = await this.lockJob(client, actor.tenantId, jobId);
      if (!['exception_review', 'failed_final'].includes(job.status)) {
        throw new ApiError(409, 'manual_not_allowed');
      }
      const proposal = await client.query(
        'SELECT 1 FROM zhixue.grade_proposals WHERE job_id = $1',
        [jobId],
      );
      if ((proposal.rowCount ?? 0) > 0) throw new ApiError(409, 'proposal_exists');
      const revisionId = randomUUID();
      await client.query(
        `INSERT INTO zhixue.answer_revisions (tenant_id, id, job_id, origin) VALUES ($1, $2, $3, 'manual')`,
        [actor.tenantId, revisionId, jobId],
      );
      const draftId = randomUUID();
      await client.query(
        `INSERT INTO zhixue.score_drafts (tenant_id, id, job_id, revision_id, status)
         VALUES ($1, $2, $3, $4, 'building')`,
        [actor.tenantId, draftId, jobId, revisionId],
      );
      const scores = await client.query('SELECT COUNT(*)::int AS n FROM zhixue.score_versions');
      return { draftId, revisionId, officialScores: scores.rows[0].n };
    });
  }

  async claim(jobId: string, capability: string): Promise<Record<string, unknown>> {
    const client = await this.ingress.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.env', $1, true)`, [this.config.env]);
      const route = await client.query(
        'SELECT tenant_id FROM zhixue_ctl.resolve_work_route($1, $2)',
        [jobId, capability],
      );
      if (route.rowCount === 0) throw new ApiError(404, 'not_found');
      const tenantId = route.rows[0].tenant_id as string;
      await this.setContext(client, tenantId, 'service');
      const job = await this.lockJob(client, tenantId, jobId);
      if (job.status !== 'queued' || job.current_fencing_epoch !== 0) {
        throw new ApiError(409, 'not_claimable');
      }
      const deadline = this.config.deadlineSeconds + this.config.graceSeconds;
      const expired = await client.query(
        `SELECT created_at + make_interval(secs => $2) < clock_timestamp() AS expired
         FROM zhixue.processing_jobs WHERE id = $1`,
        [jobId, deadline],
      );
      if (expired.rows[0].expired) {
        await this.releaseAdmission(client, tenantId, jobId, false);
        await client.query(
          `UPDATE zhixue.processing_jobs
           SET status = 'failed_final', result_status = 'missing_result', state_version = state_version + 1
           WHERE id = $1`,
          [jobId],
        );
        await client.query('COMMIT');
        return { status: 'failed_final' };
      }
      const consumed = await client.query(
        `UPDATE zhixue.job_admissions SET state = 'consumed'
         WHERE tenant_id = $1 AND job_id = $2 AND state = 'admitted'`,
        [tenantId, jobId],
      );
      if (consumed.rowCount !== 1) throw new ApiError(409, 'not_admitted');
      const attemptId = randomUUID();
      const leaseToken = randomBytes(32).toString('base64url');
      const leaseSeconds = this.config.leaseSeconds + this.config.graceSeconds;
      await client.query(
        `INSERT INTO zhixue.execution_attempts
          (tenant_id, id, job_id, fencing_epoch, lease_token_hash, lease_until)
         VALUES ($1, $2, $3, 1, $4, clock_timestamp() + make_interval(secs => $5))`,
        [tenantId, attemptId, jobId, sha256(leaseToken), leaseSeconds],
      );
      await client.query(
        `UPDATE zhixue.processing_jobs
         SET status = 'running', current_attempt_id = $2, current_fencing_epoch = 1,
             claimed_at = clock_timestamp(), occupancy_held = true,
             current_lease_until = clock_timestamp() + make_interval(secs => $3),
             state_version = state_version + 1
         WHERE id = $1`,
        [jobId, attemptId, leaseSeconds],
      );
      await client.query('COMMIT');
      log('job_claimed', { jobId, attemptId });
      return {
        jobId,
        attemptId,
        fencingEpoch: 1,
        leaseToken,
        generation: job.input_generation,
        inputHash: job.input_hash,
        stage: job.stage,
        billable: job.billable,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async accept(input: {
    jobId: string;
    attemptId: string;
    fencingEpoch: number;
    leaseToken: string;
    generation: number;
    inputHash: string;
    ok?: boolean;
    tenantId?: string;
    idempotencyKey: string;
    envelope?: unknown;
  }): Promise<Record<string, unknown>> {
    const tenantId = await this.lookupTenant(input.jobId);
    if (!tenantId) throw new ApiError(404, 'not_found');
    if (input.tenantId && input.tenantId !== tenantId) throw new ApiError(403, 'forged_tenant');
    const bodyHash = sha256(stable({
      jobId: input.jobId,
      attemptId: input.attemptId,
      fencingEpoch: input.fencingEpoch,
      generation: input.generation,
      inputHash: input.inputHash,
      ok: input.ok ?? null,
      envelope: input.envelope ?? null,
    }));
    return this.withTenant(this.ingress, tenantId, 'service', async (client) => {
      const job = await this.lockJob(client, tenantId, input.jobId);
      const receipt = await client.query(
        `SELECT body_hash, response FROM zhixue.command_receipts
         WHERE tenant_id = $1 AND command_name = 'accept' AND idempotency_key = $2`,
        [tenantId, input.idempotencyKey],
      );
      if ((receipt.rowCount ?? 0) > 0) {
        if (receipt.rows[0].body_hash !== bodyHash) throw new ApiError(409, 'idempotency_conflict');
        return { ...(receipt.rows[0].response as Record<string, unknown>), replay: true };
      }
      if (job.status !== 'running' || job.cancel_requested) throw new ApiError(409, 'not_running');
      if (job.current_fencing_epoch !== input.fencingEpoch || job.current_attempt_id !== input.attemptId) {
        throw new ApiError(409, 'stale_lease');
      }
      if (job.input_generation !== input.generation || job.input_hash !== input.inputHash) {
        throw new ApiError(409, 'stale_input');
      }
      const attempt = await client.query(
        `SELECT lease_token_hash, lease_until FROM zhixue.execution_attempts WHERE id = $1 AND fencing_epoch = $2`,
        [input.attemptId, input.fencingEpoch],
      );
      if (attempt.rowCount !== 1 || attempt.rows[0].lease_token_hash !== sha256(input.leaseToken)) {
        throw new ApiError(409, 'stale_lease');
      }
      if (new Date(attempt.rows[0].lease_until).getTime() < Date.now()) {
        throw new ApiError(409, 'lease_expired');
      }
      if (job.stage === 'model_grade') {
        if (!validateEnvelope(input.envelope)) {
          await this.finishWithoutEffect(client, tenantId, input.jobId, 'rejected_schema');
          log('schema_rejected', { jobId: input.jobId });
          return { status: 'exception_review', error: 'schema_rejected' };
        }
        const envelope = input.envelope as { payload: { items: Array<{ paper_question_id: string }> } };
        const known = await client.query(
          `SELECT 1 FROM zhixue.paper_questions
           WHERE paper_version_id = $1 AND id = $2`,
          [job.paper_version_id, envelope.payload.items[0].paper_question_id],
        );
        if (known.rowCount !== 1) {
          await this.finishWithoutEffect(client, tenantId, input.jobId, 'rejected_semantic');
          return { status: 'exception_review', error: 'unknown_question' };
        }
        await client.query(
          `INSERT INTO zhixue.grade_proposals (tenant_id, id, job_id, status, payload)
           VALUES ($1, $2, $3, 'review_required', $4::jsonb)`,
          [tenantId, randomUUID(), input.jobId, JSON.stringify(envelope.payload)],
        );
      }
      if (job.stage === 'validate_asset' && input.ok === false) {
        await this.finishWithoutEffect(client, tenantId, input.jobId, 'missing_result', 'failed_final');
        return { status: 'failed_final' };
      }
      await this.releaseHeld(client, tenantId, input.jobId);
      const updated = await client.query(
        `UPDATE zhixue.processing_jobs
         SET status = 'succeeded', result_status = 'accepted', occupancy_held = false,
             state_version = state_version + 1
         WHERE id = $1
         RETURNING state_version`,
        [input.jobId],
      );
      const response = { status: 'succeeded', stateVersion: updated.rows[0].state_version };
      await client.query(
        `INSERT INTO zhixue.command_receipts
          (tenant_id, command_name, idempotency_key, body_hash, response)
         VALUES ($1, 'accept', $2, $3, $4::jsonb)`,
        [tenantId, input.idempotencyKey, bodyHash, JSON.stringify(response)],
      );
      log('accept_committed', { jobId: input.jobId, stateVersion: response.stateVersion });
      return response;
    });
  }

  async prepareInvocation(jobId: string, attemptId: string): Promise<Record<string, unknown>> {
    const tenantId = await this.lookupTenant(jobId);
    if (!tenantId) throw new ApiError(404, 'not_found');
    return this.withTenant(this.ingress, tenantId, 'service', async (client) => {
      const job = await this.lockJob(client, tenantId, jobId);
      if (!job.billable || job.current_attempt_id !== attemptId) throw new ApiError(409, 'not_billable');
      const existing = await client.query(
        `SELECT id, send_state, cost_status, amount FROM zhixue.model_invocations
         WHERE job_id = $1 AND attempt_id = $2`,
        [jobId, attemptId],
      );
      if ((existing.rowCount ?? 0) > 0) return existing.rows[0];
      const id = randomUUID();
      await client.query(
        `INSERT INTO zhixue.model_invocations
          (tenant_id, id, job_id, attempt_id, send_state, cost_status, amount, include_in_total, input_hash)
         VALUES ($1, $2, $3, $4, 'not_sent', 'unknown', NULL, false, $5)`,
        [tenantId, id, jobId, attemptId, job.input_hash],
      );
      return { id, send_state: 'not_sent', cost_status: 'unknown', amount: null };
    });
  }

  async markSendUnknown(jobId: string, invocationId: string): Promise<Record<string, unknown>> {
    const tenantId = await this.lookupTenant(jobId);
    if (!tenantId) throw new ApiError(404, 'not_found');
    return this.withTenant(this.ingress, tenantId, 'service', async (client) => {
      const updated = await client.query(
        `UPDATE zhixue.model_invocations
         SET send_state = 'send_unknown'
         WHERE id = $1 AND send_state = 'not_sent' AND cost_status = 'unknown' AND amount IS NULL
         RETURNING id, send_state, cost_status, amount, include_in_total, job_id`,
        [invocationId],
      );
      if (updated.rowCount !== 1) throw new ApiError(409, 'send_not_unknownable');
      const job = await client.query('SELECT status FROM zhixue.processing_jobs WHERE id = $1', [updated.rows[0].job_id]);
      return { invocation: updated.rows[0], jobStatus: job.rows[0].status };
    });
  }

  async park(jobId: string): Promise<Record<string, unknown>> {
    const tenantId = await this.lookupTenant(jobId);
    if (!tenantId) throw new ApiError(404, 'not_found');
    return this.withTenant(this.reconciler, tenantId, 'service', async (client) => {
      const before = await client.query('SELECT occupied FROM zhixue.global_execution_occupancy WHERE id = 1');
      const job = await this.lockJob(client, tenantId, jobId);
      const unknown = await client.query(
        `SELECT 1 FROM zhixue.model_invocations WHERE job_id = $1 AND send_state = 'send_unknown'`,
        [jobId],
      );
      if (unknown.rowCount !== 1) throw new ApiError(409, 'no_send_unknown');
      if (job.status === 'awaiting_settlement') {
        const after = await client.query('SELECT occupied FROM zhixue.global_execution_occupancy WHERE id = 1');
        return { status: job.status, occupiedBefore: before.rows[0].occupied, occupiedAfter: after.rows[0].occupied };
      }
      if (job.status !== 'running') throw new ApiError(409, 'not_running');
      if (job.occupancy_held) await this.releaseHeld(client, tenantId, jobId);
      await client.query(
        `UPDATE zhixue.processing_jobs
         SET status = 'awaiting_settlement', occupancy_held = false, state_version = state_version + 1
         WHERE id = $1`,
        [jobId],
      );
      const after = await client.query('SELECT occupied FROM zhixue.global_execution_occupancy WHERE id = 1');
      const status = await client.query('SELECT status FROM zhixue.processing_jobs WHERE id = $1', [jobId]);
      return {
        status: status.rows[0].status,
        occupiedBefore: before.rows[0].occupied,
        occupiedAfter: after.rows[0].occupied,
      };
    });
  }

  async abandon(jobId: string, invocationId: string, reason: string): Promise<Record<string, unknown>> {
    if (!reason.trim()) throw new ApiError(400, 'reason_required');
    const tenantId = await this.lookupTenant(jobId);
    if (!tenantId) throw new ApiError(404, 'not_found');
    return this.withTenant(this.reconciler, tenantId, 'service', async (client) => {
      const jobBefore = await client.query(
        `SELECT j.status FROM zhixue.processing_jobs j
         JOIN zhixue.model_invocations i ON i.job_id = j.id
         WHERE i.id = $1`,
        [invocationId],
      );
      const updated = await client.query(
        `UPDATE zhixue.model_invocations
         SET cost_status = 'abandoned_unknown'
         WHERE id = $1 AND cost_status = 'unknown' AND send_state = 'send_unknown' AND amount IS NULL
         RETURNING send_state, cost_status, amount, include_in_total, job_id`,
        [invocationId],
      );
      if (updated.rowCount !== 1) throw new ApiError(409, 'cannot_abandon');
      const jobAfter = await client.query(
        'SELECT status FROM zhixue.processing_jobs WHERE id = $1',
        [updated.rows[0].job_id],
      );
      return {
        sendState: updated.rows[0].send_state,
        costStatus: updated.rows[0].cost_status,
        amount: updated.rows[0].amount,
        includeInTotal: updated.rows[0].include_in_total,
        display: '未知',
        jobStatusBefore: jobBefore.rows[0].status,
        jobStatusAfter: jobAfter.rows[0].status,
      };
    });
  }

  async recordSettlement(jobId: string, invocationId: string, amount: string, key: string): Promise<Record<string, unknown>> {
    const tenantId = await this.lookupTenant(jobId);
    if (!tenantId) throw new ApiError(404, 'not_found');
    const bodyHash = sha256(stable({ invocationId, amount, key }));
    return this.withTenant(this.reconciler, tenantId, 'service', async (client) => {
      const prior = await client.query(
        `SELECT body_hash, response FROM zhixue.command_receipts
         WHERE tenant_id = $1 AND command_name = 'settle' AND idempotency_key = $2`,
        [tenantId, key],
      );
      if ((prior.rowCount ?? 0) > 0) {
        if (prior.rows[0].body_hash !== bodyHash) throw new ApiError(409, 'idempotency_conflict');
        return prior.rows[0].response as Record<string, unknown>;
      }
      const jobBefore = await client.query(
        `SELECT j.status, j.id FROM zhixue.processing_jobs j
         JOIN zhixue.model_invocations i ON i.job_id = j.id WHERE i.id = $1`,
        [invocationId],
      );
      const updated = await client.query(
        `UPDATE zhixue.model_invocations
         SET cost_status = 'confirmed', amount = $2, include_in_total = true
         WHERE id = $1 AND cost_status = 'unknown' AND amount IS NULL
         RETURNING id`,
        [invocationId, amount],
      );
      if (updated.rowCount !== 1) throw new ApiError(409, 'cannot_settle');
      await client.query(
        `INSERT INTO zhixue.usage_ledger_entries
          (tenant_id, id, invocation_id, settlement_kind, settlement_key, body_hash, amount_delta, include_in_total)
         VALUES ($1, $2, $3, 'confirmed', $4, $5, $6, true)`,
        [tenantId, randomUUID(), invocationId, key, bodyHash, amount],
      );
      const jobAfter = await client.query(
        'SELECT status FROM zhixue.processing_jobs WHERE id = $1',
        [jobBefore.rows[0].id],
      );
      const proposals = await client.query(
        'SELECT COUNT(*)::int AS n FROM zhixue.grade_proposals WHERE job_id = $1',
        [jobBefore.rows[0].id],
      );
      const response = {
        jobStatusBefore: jobBefore.rows[0].status,
        jobStatusAfter: jobAfter.rows[0].status,
        proposals: proposals.rows[0].n,
      };
      await client.query(
        `INSERT INTO zhixue.command_receipts
          (tenant_id, command_name, idempotency_key, body_hash, response)
         VALUES ($1, 'settle', $2, $3, $4::jsonb)`,
        [tenantId, key, bodyHash, JSON.stringify(response)],
      );
      return response;
    });
  }

  async closeUnproven(jobId: string, expectedGeneration?: number): Promise<Record<string, unknown>> {
    const tenantId = await this.lookupTenant(jobId);
    if (!tenantId) throw new ApiError(404, 'not_found');
    return this.withTenant(this.reconciler, tenantId, 'service', async (client) => {
      const job = await this.lockJob(client, tenantId, jobId);
      if (job.status !== 'awaiting_settlement' || job.result_status !== 'pending') {
        throw new ApiError(409, 'not_unproven');
      }
      const resultStatus = expectedGeneration !== undefined && expectedGeneration !== job.input_generation
        ? 'input_changed'
        : 'missing_result';
      await client.query(
        `UPDATE zhixue.processing_jobs
         SET status = 'exception_review', result_status = $2, state_version = state_version + 1
         WHERE id = $1`,
        [jobId, resultStatus],
      );
      return { status: 'exception_review', resultStatus };
    });
  }

  async takeover(jobId: string): Promise<Record<string, unknown>> {
    const tenantId = await this.lookupTenant(jobId);
    if (!tenantId) throw new ApiError(404, 'not_found');
    return this.withTenant(this.reconciler, tenantId, 'service', async (client) => {
      const before = await client.query('SELECT occupied FROM zhixue.global_execution_occupancy WHERE id = 1');
      const job = await this.lockJob(client, tenantId, jobId);
      const unknown = await client.query(
        `SELECT 1 FROM zhixue.model_invocations WHERE job_id = $1 AND send_state = 'send_unknown'`,
        [jobId],
      );
      if ((unknown.rowCount ?? 0) > 0) throw new ApiError(409, 'send_unknown_blocks_takeover');
      if (job.status !== 'running' || !job.current_lease_until || new Date(job.current_lease_until).getTime() > Date.now()) {
        throw new ApiError(409, 'lease_active');
      }
      if (job.current_fencing_epoch >= this.config.maxAttempts) {
        await this.releaseHeld(client, tenantId, jobId);
        await client.query(
          `UPDATE zhixue.processing_jobs
           SET status = 'failed_final', result_status = 'missing_result', occupancy_held = false,
               state_version = state_version + 1
           WHERE id = $1`,
          [jobId],
        );
        return { status: 'failed_final' };
      }
      const nextEpoch = job.current_fencing_epoch + 1;
      const attemptId = randomUUID();
      const leaseToken = randomBytes(32).toString('base64url');
      const leaseSeconds = this.config.leaseSeconds + this.config.graceSeconds;
      await client.query(
        `INSERT INTO zhixue.execution_attempts
          (tenant_id, id, job_id, fencing_epoch, lease_token_hash, lease_until)
         VALUES ($1, $2, $3, $4, $5, clock_timestamp() + make_interval(secs => $6))`,
        [tenantId, attemptId, jobId, nextEpoch, sha256(leaseToken), leaseSeconds],
      );
      await client.query(
        `UPDATE zhixue.processing_jobs
         SET current_attempt_id = $2, current_fencing_epoch = $3,
             current_lease_until = clock_timestamp() + make_interval(secs => $4),
             state_version = state_version + 1
         WHERE id = $1`,
        [jobId, attemptId, nextEpoch, leaseSeconds],
      );
      const after = await client.query('SELECT occupied FROM zhixue.global_execution_occupancy WHERE id = 1');
      const oldAttempt = await client.query(
        'SELECT id FROM zhixue.execution_attempts WHERE job_id = $1 AND fencing_epoch = $2',
        [jobId, job.current_fencing_epoch],
      );
      return {
        status: 'running',
        attemptId,
        fencingEpoch: nextEpoch,
        leaseToken,
        generation: job.input_generation,
        inputHash: job.input_hash,
        stage: job.stage,
        occupiedBefore: before.rows[0].occupied,
        occupiedAfter: after.rows[0].occupied,
        previousAttemptId: oldAttempt.rows[0]?.id ?? null,
      };
    });
  }

  async admitAll(caps?: Caps): Promise<number> {
    const tenantCap = caps?.tenant ?? this.config.tenantCap;
    const globalCap = caps?.global ?? this.config.globalCap;
    if (caps) log('test_cap_override', { tenantCap, globalCap });
    return this.withTenant(this.scheduler, null, 'service', async (client) => {
      await client.query('SELECT id FROM zhixue.global_execution_occupancy WHERE id = 1 FOR UPDATE');
      const queued = await client.query('SELECT job_id, tenant_id FROM zhixue_ctl.list_queued_for_admit()');
      let admitted = 0;
      for (const row of queued.rows as Array<{ job_id: string; tenant_id: string }>) {
        const global = await client.query('SELECT occupied FROM zhixue.global_execution_occupancy WHERE id = 1');
        if (global.rows[0].occupied >= globalCap) break;
        await this.setContext(client, row.tenant_id, 'service');
        await client.query(
          'SELECT tenant_id FROM zhixue.tenant_execution_occupancy WHERE tenant_id = $1 FOR UPDATE',
          [row.tenant_id],
        );
        const tenant = await client.query(
          'SELECT occupied FROM zhixue.tenant_execution_occupancy WHERE tenant_id = $1',
          [row.tenant_id],
        );
        if (tenant.rows[0].occupied >= tenantCap) continue;
        await client.query(
          `INSERT INTO zhixue.job_admissions (tenant_id, id, job_id, state) VALUES ($1, $2, $3, 'admitted')`,
          [row.tenant_id, randomUUID(), row.job_id],
        );
        await client.query(
          'UPDATE zhixue.tenant_execution_occupancy SET occupied = occupied + 1 WHERE tenant_id = $1',
          [row.tenant_id],
        );
        await client.query('UPDATE zhixue.global_execution_occupancy SET occupied = occupied + 1 WHERE id = 1');
        admitted += 1;
      }
      return admitted;
    });
  }

  async reconcile(caps?: Caps): Promise<Record<string, unknown>> {
    await this.admitAll(caps);
    const client = await this.reconciler.connect();
    let reissued = 0;
    try {
      await client.query(`SELECT pg_advisory_lock(hashtext('zhixue_capability'))`);
      const dispatches = await client.query('SELECT * FROM zhixue_ctl.list_capability_dispatches()');
      for (const row of dispatches.rows as Array<{
        dispatch_id: string; job_id: string; state: string; bull_job_id: string | null; tenant_id: string;
      }>) {
        await client.query('BEGIN');
        await this.setContext(client, row.tenant_id, 'service');
        const job = await client.query(
          `SELECT id, status, stage, logical_key, billable FROM zhixue.processing_jobs WHERE id = $1`,
          [row.job_id],
        );
        const admission = await client.query(
          `SELECT state FROM zhixue.job_admissions WHERE job_id = $1`,
          [row.job_id],
        );
        await client.query('COMMIT');
        if (job.rowCount !== 1 || job.rows[0].status !== 'queued') continue;
        if (admission.rowCount !== 1 || admission.rows[0].state !== 'admitted') continue;
        if (row.state === 'acked' && row.bull_job_id && await this.queue.getJob(row.bull_job_id)) continue;
        const secret = randomBytes(32).toString('base64url');
        const dispatchId = randomUUID();
        await client.query(
          'SELECT zhixue_ctl.replace_capability($1, $2, $3, $4, $5)',
          [row.job_id, secret, new Date(Date.now() + this.config.capabilityTtlSeconds * 1000), dispatchId, row.dispatch_id],
        );
        const bullJobId = `cap-${dispatchId}`;
        await this.queue.add(job.rows[0].stage, {
          jobId: row.job_id,
          env: this.config.env,
          capability: secret,
          stage: job.rows[0].stage,
          fail: this.config.testHooks && String(job.rows[0].logical_key).endsWith(':fail'),
          billable: job.rows[0].billable,
          action: 'execute',
        }, { jobId: bullJobId, attempts: 1, removeOnComplete: false, removeOnFail: false });
        await client.query('SELECT zhixue_ctl.ack_dispatch($1, $2)', [dispatchId, bullJobId]);
        reissued += 1;
      }
      const expired = await client.query('SELECT * FROM zhixue_ctl.list_expired_without_unknown()');
      for (const row of expired.rows as Array<{ job_id: string; fencing_epoch: number }>) {
        const bullJobId = `takeover-${row.job_id}-${row.fencing_epoch}`;
        await this.queue.add('takeover', {
          jobId: row.job_id,
          action: 'takeover',
          env: this.config.env,
        }, { jobId: bullJobId, attempts: 1, removeOnComplete: false, removeOnFail: false });
      }
      return { reissued, takeovers: expired.rowCount };
    } finally {
      await client.query(`SELECT pg_advisory_unlock(hashtext('zhixue_capability'))`).catch(() => undefined);
      client.release();
    }
  }

  async relayOnce(): Promise<number> {
    const client = await this.relay.connect();
    try {
      await client.query('BEGIN');
      const claimed = await client.query(
        `UPDATE zhixue_ctl.outbox_dispatch_index
         SET status = 'leased', lease_until = clock_timestamp() + interval '30 seconds'
         WHERE event_id IN (
           SELECT event_id FROM zhixue_ctl.outbox_dispatch_index
           WHERE status = 'pending' ORDER BY created_at LIMIT 50
           FOR UPDATE SKIP LOCKED
         )
         RETURNING event_id, tenant_id`,
      );
      for (const row of claimed.rows as Array<{ event_id: string; tenant_id: string }>) {
        await this.setContext(client, row.tenant_id, 'service');
        await client.query('SELECT payload FROM zhixue.outbox_events WHERE event_id = $1', [row.event_id]);
        await client.query(
          `INSERT INTO zhixue.consumer_inbox (consumer_name, event_id, tenant_id)
           VALUES ('m0-relay', $1, $2)
           ON CONFLICT DO NOTHING`,
          [row.event_id, row.tenant_id],
        );
        await client.query(
          `UPDATE zhixue_ctl.outbox_dispatch_index SET status = 'delivered' WHERE event_id = $1`,
          [row.event_id],
        );
      }
      await client.query('COMMIT');
      return claimed.rowCount ?? 0;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async sweepOrphans(): Promise<number> {
    const known = await this.reconciler.query('SELECT storage_key FROM zhixue_ctl.list_storage_keys()');
    const keys = new Set((known.rows as Array<{ storage_key: string }>).map((row) => row.storage_key));
    const root = resolve(this.config.fileRoot);
    let removed = 0;
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        const key = relative(root, full);
        if (!keys.has(key)) {
          rmSync(full, { force: true });
          removed += 1;
        }
      }
    };
    mkdirSync(root, { recursive: true });
    walk(root);
    return removed;
  }

  async metrics(): Promise<Record<string, unknown>> {
    const row = await this.reconciler.query('SELECT * FROM zhixue_ctl.metrics_snapshot()');
    return {
      outbox_oldest_pending_seconds: row.rows[0].outbox_oldest_pending_seconds,
      job_oldest_running_seconds: row.rows[0].job_oldest_running_seconds,
      invocation_unknown_count: row.rows[0].invocation_unknown_count,
    };
  }

  async opsUsage(): Promise<unknown[]> {
    const client = await this.platform.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.access_mode', 'platform_aggregate', true)`);
      const rows = await client.query('SELECT * FROM zhixue_ctl.ops_usage_totals()');
      await client.query('COMMIT');
      return rows.rows;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async ingressIdentity(): Promise<Record<string, unknown>> {
    const row = await this.ingress.query('SELECT * FROM zhixue_ctl.session_identity()');
    return row.rows[0];
  }

  async occupancy(): Promise<number> {
    const row = await this.scheduler.query('SELECT occupied FROM zhixue.global_execution_occupancy WHERE id = 1');
    return row.rows[0].occupied as number;
  }

  private async publishCapability(
    dispatchId: string,
    payload: Record<string, unknown>,
    secret: string,
    crash?: string,
  ): Promise<boolean> {
    const client = await this.reconciler.connect();
    try {
      await client.query(`SELECT pg_advisory_lock(hashtext('zhixue_capability'))`);
      const found = await client.query(
        'SELECT state FROM zhixue_ctl.list_capability_dispatches() WHERE dispatch_id = $1',
        [dispatchId],
      );
      if (found.rowCount !== 1 || found.rows[0].state !== 'pending_enqueue') return false;
      const bullJobId = `cap-${dispatchId}`;
      await this.queue.add(String(payload.stage), { ...payload, capability: secret }, {
        jobId: bullJobId,
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
      });
      if (crash === 'before-ack') throw new ApiError(500, 'test_crash_before_ack');
      await client.query('SELECT zhixue_ctl.ack_dispatch($1, $2)', [dispatchId, bullJobId]);
      return true;
    } finally {
      await client.query(`SELECT pg_advisory_unlock(hashtext('zhixue_capability'))`).catch(() => undefined);
      client.release();
    }
  }

  private async finishWithoutEffect(
    client: PoolClient,
    tenantId: string,
    jobId: string,
    resultStatus: string,
    status = 'exception_review',
  ): Promise<void> {
    await this.releaseHeld(client, tenantId, jobId);
    await client.query(
      `UPDATE zhixue.processing_jobs
       SET status = $2, result_status = $3, occupancy_held = false, state_version = state_version + 1
       WHERE id = $1`,
      [jobId, status, resultStatus],
    );
  }

  private async releaseHeld(client: PoolClient, tenantId: string, jobId: string): Promise<void> {
    const held = await client.query(
      'SELECT occupancy_held FROM zhixue.processing_jobs WHERE id = $1',
      [jobId],
    );
    if (!held.rows[0]?.occupancy_held) return;
    await client.query(
      'UPDATE zhixue.global_execution_occupancy SET occupied = occupied - 1 WHERE id = 1 AND occupied > 0',
    );
    await client.query(
      `UPDATE zhixue.tenant_execution_occupancy
       SET occupied = occupied - 1 WHERE tenant_id = $1 AND occupied > 0`,
      [tenantId],
    );
  }

  private async releaseAdmission(
    client: PoolClient,
    tenantId: string,
    jobId: string,
    held: boolean,
  ): Promise<void> {
    const removed = await client.query(
      `DELETE FROM zhixue.job_admissions WHERE tenant_id = $1 AND job_id = $2 AND state = 'admitted'`,
      [tenantId, jobId],
    );
    if ((removed.rowCount ?? 0) > 0 || held) {
      await client.query(
        'UPDATE zhixue.global_execution_occupancy SET occupied = occupied - 1 WHERE id = 1 AND occupied > 0',
      );
      await client.query(
        `UPDATE zhixue.tenant_execution_occupancy
         SET occupied = occupied - 1 WHERE tenant_id = $1 AND occupied > 0`,
        [tenantId],
      );
    }
  }

  private async lockJob(client: PoolClient, tenantId: string, jobId: string): Promise<{
    id: string; status: string; result_status: string; stage: string; billable: boolean;
    current_fencing_epoch: number; current_attempt_id: string | null; input_generation: number;
    input_hash: string; occupancy_held: boolean; cancel_requested: boolean;
    current_lease_until: string | null; paper_version_id: string | null; submission_id: string;
    logical_key: string;
  }> {
    await client.query('SELECT id FROM zhixue.global_execution_occupancy WHERE id = 1 FOR UPDATE');
    await client.query(
      'SELECT tenant_id FROM zhixue.tenant_execution_occupancy WHERE tenant_id = $1 FOR UPDATE',
      [tenantId],
    );
    const row = await client.query(
      `SELECT id, status, result_status, stage, billable, current_fencing_epoch, current_attempt_id,
              input_generation, input_hash, occupancy_held, cancel_requested, current_lease_until,
              paper_version_id, submission_id, logical_key
       FROM zhixue.processing_jobs WHERE id = $1 FOR UPDATE`,
      [jobId],
    );
    if (row.rowCount !== 1) throw new ApiError(404, 'not_found');
    return row.rows[0];
  }

  private async lookupTenant(jobId: string): Promise<string | null> {
    const row = await this.ingress.query('SELECT zhixue_ctl.job_tenant($1) AS tenant_id', [jobId]);
    return (row.rows[0]?.tenant_id as string | null) ?? null;
  }

  private async hasAdmission(tenantId: string, jobId: string): Promise<boolean> {
    return this.withTenant(this.app, tenantId, 'member', async (client) => {
      const row = await client.query(
        `SELECT 1 FROM zhixue.job_admissions WHERE job_id = $1 AND state = 'admitted'`,
        [jobId],
      );
      return (row.rowCount ?? 0) === 1;
    });
  }

  private async readReceipt(tenantId: string, command: string, key: string): Promise<{
    body_hash: string; response: unknown;
  } | null> {
    return this.withTenant(this.app, tenantId, 'member', async (client) => {
      const row = await client.query(
        `SELECT body_hash, response FROM zhixue.command_receipts
         WHERE command_name = $1 AND idempotency_key = $2`,
        [command, key],
      );
      return row.rows[0] ?? null;
    });
  }

  private async assertScope(client: PoolClient, actor: Actor, classId: string, subjectId: string): Promise<void> {
    const row = await client.query(
      `SELECT 1 FROM zhixue.data_scope_grants g
       JOIN zhixue.memberships m ON m.tenant_id = g.tenant_id AND m.id = g.membership_id
       WHERE m.user_id = $1 AND m.id = $2 AND g.class_id = $3 AND g.subject_id = $4`,
      [actor.userId, actor.membershipId, classId, subjectId],
    );
    if (row.rowCount !== 1) throw new ApiError(403, 'scope_denied');
  }

  private safePath(storageKey: string): string {
    const root = resolve(this.config.fileRoot);
    const full = resolve(root, storageKey);
    if (!full.startsWith(`${root}/`)) throw new ApiError(400, 'bad_storage_key');
    return full;
  }

  private async setContext(client: PoolClient, tenantId: string, mode: string): Promise<void> {
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    await client.query(`SELECT set_config('app.access_mode', $1, true)`, [mode]);
    await client.query(`SELECT set_config('app.env', $1, true)`, [this.config.env]);
  }

  private async withTenant<T>(
    pool: Pool,
    tenantId: string | null,
    mode: string,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (tenantId) await this.setContext(client, tenantId, mode);
      else await client.query(`SELECT set_config('app.env', $1, true)`, [this.config.env]);
      const value = await fn(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

export function schemaErrorText(): string {
  return schemaErrors(validateEnvelope);
}
