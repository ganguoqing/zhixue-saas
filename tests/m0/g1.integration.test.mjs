import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import { loadDevEnv, roleUrl } from '../../scripts/lib.mjs';
import { runV4 } from './g1-v4-flows.mjs';

loadDevEnv();
const database = process.env.PGDATABASE;
const redisDb = process.env.REDIS_DB;
const fileRoot = process.env.FILE_ROOT;
const prefix = process.env.QUEUE_PREFIX;
if (!database?.startsWith('zhixue_m0_g1') || database === 'zhixue_m0') {
  throw new Error(`refusing G1 test on database ${database}`);
}
const isolatedRoot = fileRoot?.includes('g1-objects') || fileRoot?.includes(`${'var'}/runs/`);
if ((!redisDb || redisDb === '0') && process.env.ZHIXUE_PROFILE !== 'compose') {
  throw new Error('refusing G1 test on shared Redis DB 0');
}
if (!prefix?.startsWith('zhixue-g1') || !isolatedRoot) {
  throw new Error('refusing G1 test without an isolated queue prefix and object root');
}

const API = `http://127.0.0.1:${process.env.API_PORT}`;
const A = '11111111-1111-4111-8111-111111111111';
const question = '018f0a3e-7c21-7b2a-8c11-111111111111';
const question2 = '018f0a3e-7c21-7b2a-8c11-111111111112';
const criterion = '018f0a3e-7c21-7b2a-8c11-222222222222';
const python = '.venv/bin/python';
const runDir = process.env.ZHIXUE_RUN_DIR || 'var/g1-logs';
mkdirSync(runDir, { recursive: true });
const records = [];
let api;
let inference;
let worker;
let supervisor;

function token(kind, scope, extra = {}) {
  const spec = {
    worker: ['WORKER_JWT_SECRET', 'zhixue-worker', 'svc:worker'],
    reconciler: ['RECONCILER_JWT_SECRET', 'zhixue-reconciler', 'svc:reconciler'],
    scheduler: ['SCHEDULER_JWT_SECRET', 'zhixue-scheduler', 'svc:scheduler'],
    relay: ['RELAY_JWT_SECRET', 'zhixue-relay', 'svc:relay'],
    billing: ['BILLING_JWT_SECRET', 'zhixue-billing', 'svc:billing'],
  }[kind];
  return jwt.sign({
    scope, iss: spec[1], sub: spec[2], jti: randomUUID(), ...extra,
  }, process.env[spec[0]], { audience: 'zhixue-internal', expiresIn: '2m' });
}

function auth(kind, scope, extra) {
  return { authorization: `Bearer ${token(kind, scope, extra)}`, 'content-type': 'application/json' };
}

async function login(email) {
  const response = await fetch(`${API}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'dev-password' }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body.token;
}

async function waitHealth(url) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // starting
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`health timeout ${url}`);
}

function workerEnv() {
  const allow = [
    'PATH', 'HOME', 'LANG', 'TMPDIR', 'PYTHONPATH',
    'WORKER_JWT_SECRET', 'REDIS_HOST', 'REDIS_PORT', 'REDIS_DB', 'QUEUE_PREFIX',
    'API_BASE', 'INFERENCE_URL', 'WORKER_ENV_REPORT',
  ];
  const env = {};
  for (const key of allow) if (process.env[key] !== undefined) env[key] = process.env[key];
  return env;
}

function start(name, command, args, logName, env = process.env, append = false) {
  const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const flags = append ? 'a' : 'w';
  child.stdout.pipe(createWriteStream(`${runDir}/${logName}.log`, { flags }));
  child.stderr.pipe(createWriteStream(`${runDir}/${logName}.err`, { flags }));
  child.on('exit', (code) => records.push({ name: `${name}_exit`, code }));
  return child;
}

async function poll(userToken, jobId) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const response = await fetch(`${API}/api/jobs/${jobId}`, { headers: { authorization: `Bearer ${userToken}` } });
    const body = await response.json();
    if (['succeeded', 'failed_final', 'exception_review', 'awaiting_settlement', 'cancelled'].includes(body.status)) return body;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`job ${jobId} did not finish`);
}

let app;
let ingress;
let migrator;

test('G1 isolated controls', async () => {
  mkdirSync(runDir, { recursive: true });
  api = start('api', process.execPath, ['apps/api/dist/main.js'], 'api');
  inference = start('inference', python, ['-m', 'uvicorn', 'apps.inference.main:app', '--host', '127.0.0.1', '--port', process.env.INFERENCE_PORT], 'inference');
  supervisor = start('supervisor', process.execPath, ['apps/api/dist/supervisor.js'], 'supervisor');
  process.env.API_BASE = API;
  process.env.WORKER_ENV_REPORT = `${runDir}/worker-env.txt`;
  worker = start('worker', python, ['apps/worker/worker.py'], 'worker', workerEnv());
  await waitHealth(`${API}/health`);
  await waitHealth(`${process.env.INFERENCE_URL}/health`);

  const tokenA = await login('synthetic-teacher-a@example.test');
  app = new pg.Client({ connectionString: roleUrl('zhixue_app', 'ZHIXUE_APP_PASSWORD') });
  ingress = new pg.Client({ connectionString: roleUrl('zhixue_ai_ingress', 'ZHIXUE_INGRESS_PASSWORD') });
  await app.connect();
  await ingress.connect();
  try {

  const seeded = await fetch(`${API}/api/jobs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3`, {
    headers: { authorization: `Bearer ${tokenA}` },
  });
  assert.equal(seeded.status, 403);
  const cancelSeed = await fetch(`${API}/api/jobs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3/cancel`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tokenA}` },
  });
  assert.equal(cancelSeed.status, 403);
  records.push({ name: 'out_of_scope', read: seeded.status, cancel: cancelSeed.status });

  const pdf = Buffer.from('%PDF-1.4\nsynthetic-page\n').toString('base64');
  const created = await fetch(`${API}/api/uploads/finalize`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json', 'idempotency-key': `g1-${randomUUID()}` },
    body: JSON.stringify({ contentBase64: pdf, classId: 'c1', subjectId: 'math' }),
  });
  const createdBody = await created.json();
  assert.equal(created.status, 200, JSON.stringify(createdBody));
  const finished = await poll(tokenA, createdBody.jobId);
  assert.equal(finished.status, 'succeeded');
  const lateCancel = await fetch(`${API}/api/jobs/${createdBody.jobId}/cancel`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tokenA}` },
  });
  const lateBody = await lateCancel.json();
  assert.equal(lateCancel.status, 409);
  assert.equal(lateBody.error, 'succeeded');
  records.push({ name: 'terminal_cancel', status: lateCancel.status, error: lateBody.error });

  const forged = await fetch(`${API}/internal/jobs/accept`, {
    method: 'POST',
    headers: { ...auth('worker', 'ai.result.accept', { job_id: createdBody.jobId, attempt_id: randomUUID() }), 'idempotency-key': randomUUID() },
    body: JSON.stringify({
      jobId: createdBody.jobId,
      attemptId: randomUUID(),
      fencingEpoch: 1,
      leaseToken: 'not-a-real-lease-token',
      generation: 1,
      inputHash: 'ab'.repeat(32),
      ok: true,
      envelope: { invocation_id: randomUUID() },
    }),
  });
  assert.equal(forged.status, 403);
  records.push({ name: 'forged_accept_without_attempt', status: forged.status });

  const reused = token('worker', 'ai.job.claim', { job_id: createdBody.jobId });
  const firstJti = await fetch(`${API}/internal/jobs/claim`, {
    method: 'POST',
    headers: { authorization: `Bearer ${reused}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jobId: createdBody.jobId, capability: 'missing' }),
  });
  const secondJti = await fetch(`${API}/internal/jobs/claim`, {
    method: 'POST',
    headers: { authorization: `Bearer ${reused}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jobId: createdBody.jobId, capability: 'missing' }),
  });
  assert.equal(secondJti.status, 401);
  records.push({ name: 'jti_reuse', first: firstJti.status, second: secondJti.status });

  const widened = jwt.sign({
    scope: 'ai.billing.settle', iss: 'zhixue-worker', sub: 'svc:worker', jti: randomUUID(),
  }, process.env.WORKER_JWT_SECRET, { audience: 'zhixue-internal', expiresIn: '2m' });
  const denied = await fetch(`${API}/internal/jobs/record-settlement`, {
    method: 'POST',
    headers: { authorization: `Bearer ${widened}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jobId: createdBody.jobId, invocationId: randomUUID(), amount: '1.00', key: 'nope' }),
  });
  assert.equal(denied.status, 403);
  records.push({ name: 'worker_cannot_bill', status: denied.status });
  const workerKeys = readFileSync(`${runDir}/worker-env.txt`, 'utf8');
  assert.equal(workerKeys.includes('BILLING_JWT_SECRET'), false);
  assert.equal(workerKeys.includes('ZHIXUE_MIGRATOR_PASSWORD'), false);
  assert.equal(workerKeys.includes('BOOTSTRAP_PASSWORD'), false);
  assert.equal(workerKeys.includes('WORKER_JWT_SECRET'), true);
  records.push({ name: 'worker_env_whitelist', billing: false, migrator: false });

  await assert.rejects(
    (async () => {
      await ingress.query('BEGIN');
      await ingress.query(`SELECT set_config('app.tenant_id', $1, true)`, [A]);
      await ingress.query(
        `INSERT INTO zhixue.execution_attempts (tenant_id, id, job_id, fencing_epoch, lease_token_hash, lease_until)
         VALUES ($1, $2, $3, 9, 'hash', now())`,
        [A, randomUUID(), randomUUID()],
      );
      await ingress.query('COMMIT');
    })(),
    (error) => error.code === '23503',
  );
  await ingress.query('ROLLBACK');
  records.push({ name: 'fk_missing_job', rejected: true });

  const billable = await fetch(`${API}/internal/test/billable-job`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tokenA}`, 'idempotency-key': `bill-${randomUUID()}` },
  });
  const billBody = await billable.json();
  assert.equal(billable.status, 201, JSON.stringify(billBody));
  const parked = await poll(tokenA, billBody.jobId);
  assert.equal(parked.status, 'awaiting_settlement');
  records.push({ name: 'unknown_auto_park', status: parked.status });

  migrator = new pg.Client({ connectionString: roleUrl('zhixue_migrator', 'ZHIXUE_MIGRATOR_PASSWORD') });
  await migrator.connect();
  const owners = await migrator.query(
    `SELECT p.proname, r.rolname AS owner, r.rolbypassrls
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     JOIN pg_roles r ON r.oid = p.proowner
     WHERE n.nspname = 'zhixue_ctl' AND p.proname IN ('object_is_live', 'list_unknown_running', 'list_past_deadline')`,
  );
  assert.ok(owners.rows.every((row) => row.owner === 'zhixue_owner' && row.rolbypassrls === false));
  records.push({ name: 'definer_owner', rows: owners.rows });
  const lease = 'lease-token-0123456789';
  const leaseHash = createHash('sha256').update(lease).digest('hex');
  const configHash = createHash('sha256').update('mock://local|mock-1').digest('hex');
  const inputHash = 'ab'.repeat(32);
  async function gradeJob() {
    const jobId = randomUUID();
    const attemptId = randomUUID();
    const bindingId = randomUUID();
    const invocationId = randomUUID();
    await migrator.query('BEGIN');
    await migrator.query(`INSERT INTO zhixue.matching_bindings (tenant_id, id) VALUES ($1, $2)`, [A, bindingId]);
    await migrator.query(
      `INSERT INTO zhixue.processing_jobs (
         tenant_id, id, submission_id, stage, status, result_status, binding_id, paper_version_id,
         current_attempt_id, current_fencing_epoch, claimed_at, current_lease_until,
         input_generation, input_hash, logical_key, billable, occupancy_held
       ) VALUES (
         $1, $2, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'model_grade', 'running', 'pending', $3,
         '018f0a3e-7c21-7b2a-8c11-999999999999', $4, 1, now(), now() + interval '1 hour',
         1, $5, $6, true, true
       )`,
      [A, jobId, bindingId, attemptId, inputHash, `grade-${jobId}`],
    );
    await migrator.query(
      `INSERT INTO zhixue.execution_attempts (tenant_id, id, job_id, fencing_epoch, lease_token_hash, lease_until)
       VALUES ($1, $2, $3, 1, $4, now() + interval '1 hour')`,
      [A, attemptId, jobId, leaseHash],
    );
    await migrator.query(
      `INSERT INTO zhixue.model_invocations (
         tenant_id, id, job_id, attempt_id, send_state, cost_status, amount, include_in_total,
         input_hash, send_permit_epoch, config_hash, binding_id
       ) VALUES ($1, $2, $3, $4, 'send_unknown', 'unknown', NULL, false, $5, 1, $6, $7)`,
      [A, invocationId, jobId, attemptId, inputHash, configHash, bindingId],
    );
    await migrator.query('COMMIT');
    return { jobId, attemptId, invocationId };
  }
  function envelope(job, items) {
    return {
      schema_version: 'acceptance-envelope/1.0.0',
      job_id: job.jobId,
      attempt_id: job.attemptId,
      generation: 1,
      fencing_epoch: 1,
      lease_token: lease,
      input_hash: inputHash,
      invocation_id: job.invocationId,
      payload: { schema_version: 'model-grade-payload/1.0.0', items },
    };
  }
  function item(questionId, awards, score, extra = {}) {
    return {
      paper_question_id: questionId,
      recognized_answer: 'synthetic',
      suggested_score: score,
      criterion_awards: awards,
      evidence: [{ source_asset_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', page_index: 1, bbox: [0, 0, 1, 1], ...extra }],
    };
  }
  const duplicate = await gradeJob();
  const duplicateResponse = await fetch(`${API}/internal/jobs/accept`, {
    method: 'POST',
    headers: { ...auth('worker', 'ai.result.accept', { job_id: duplicate.jobId, attempt_id: duplicate.attemptId }), 'idempotency-key': randomUUID() },
    body: JSON.stringify({
      jobId: duplicate.jobId, attemptId: duplicate.attemptId, fencingEpoch: 1, leaseToken: lease,
      generation: 1, inputHash, ok: true,
      envelope: envelope(duplicate, [
        item(question, [{ criterion_id: criterion, awarded_points: '1.00' }, { criterion_id: criterion, awarded_points: '1.00' }], '2.00'),
        item(question2, [{ criterion_id: criterion, awarded_points: '1.00' }], '1.00'),
      ]),
    }),
  });
  const duplicateBody = await duplicateResponse.json();
  assert.equal(duplicateBody.error, 'rubric_duplicate');
  await migrator.query(
    `INSERT INTO zhixue.rubric_points (tenant_id, paper_version_id, question_id, criterion_id, max_points)
     VALUES ($1, '018f0a3e-7c21-7b2a-8c11-999999999999', $2, '018f0a3e-7c21-7b2a-8c11-222222222223', 1.00),
            ($1, '018f0a3e-7c21-7b2a-8c11-999999999999', $3, '018f0a3e-7c21-7b2a-8c11-222222222223', 1.00)`,
    [A, question, question2],
  );
  const precise = await gradeJob();
  const preciseResponse = await fetch(`${API}/internal/jobs/accept`, {
    method: 'POST',
    headers: { ...auth('worker', 'ai.result.accept', { job_id: precise.jobId, attempt_id: precise.attemptId }), 'idempotency-key': randomUUID() },
    body: JSON.stringify({
      jobId: precise.jobId, attemptId: precise.attemptId, fencingEpoch: 1, leaseToken: lease,
      generation: 1, inputHash, ok: true,
      envelope: envelope(precise, [
        item(question, [
          { criterion_id: criterion, awarded_points: '0.10' },
          { criterion_id: '018f0a3e-7c21-7b2a-8c11-222222222223', awarded_points: '0.20' },
        ], '0.30'),
        item(question2, [{ criterion_id: criterion, awarded_points: '1.00' }], '1.00'),
      ]),
    }),
  });
  const preciseBody = await preciseResponse.json();
  assert.equal(preciseBody.status, 'succeeded', JSON.stringify(preciseBody));
  const scores = await migrator.query('SELECT COUNT(*)::int AS n FROM zhixue.score_versions');
  assert.equal(scores.rows[0].n, 0);
  records.push({ name: 'rubric_decimal', duplicate: duplicateBody.error, precise: preciseBody.status, scores: scores.rows[0].n });

  const budgetBefore = await migrator.query('SELECT remaining FROM zhixue.invocation_budgets WHERE tenant_id = $1', [A]);
  const positive = await fetch(`${API}/internal/test/billable-job`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tokenA}`, 'idempotency-key': `grade-ok-${randomUUID()}`, 'x-test-delay': '0' },
  });
  const positiveBody = await positive.json();
  assert.equal(positive.status, 201, JSON.stringify(positiveBody));
  const graded = await poll(tokenA, positiveBody.jobId);
  assert.equal(graded.status, 'succeeded', JSON.stringify(graded));
  const proposals = await migrator.query(
    'SELECT COUNT(*)::int AS n FROM zhixue.grade_proposals WHERE job_id = $1',
    [positiveBody.jobId],
  );
  assert.equal(proposals.rows[0].n, 1);
  const budgetAfter = await migrator.query('SELECT remaining FROM zhixue.invocation_budgets WHERE tenant_id = $1', [A]);
  assert.equal(budgetAfter.rows[0].remaining, budgetBefore.rows[0].remaining - 1);
  const scoreRows = await migrator.query('SELECT COUNT(*)::int AS n FROM zhixue.score_versions');
  assert.equal(scoreRows.rows[0].n, 0);
  records.push({ name: 'worker_model_grade', status: graded.status, proposals: proposals.rows[0].n, budget: budgetAfter.rows[0].remaining });

  const assetRow = await migrator.query(
    `SELECT a.id, a.sha256, a.storage_key FROM zhixue.source_assets a
     JOIN zhixue.submissions s ON s.asset_id = a.id AND s.tenant_id = a.tenant_id
     WHERE s.id = $1`,
    [createdBody.submissionId],
  );
  const downloaded = await fetch(`${API}/api/assets/${assetRow.rows[0].id}/content`, {
    headers: { authorization: `Bearer ${tokenA}` },
  });
  const bytes = Buffer.from(await downloaded.arrayBuffer());
  const digest = createHash('sha256').update(bytes).digest('hex');
  assert.equal(downloaded.status, 200);
  assert.equal(digest, assetRow.rows[0].sha256);
  assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
  records.push({ name: 'binary_download', match: digest === assetRow.rows[0].sha256 });
  await runV4({
    API, tokenA, migrator, app, ingress, records, poll, auth, token, login,
    A, question, question2, criterion, lease, inputHash, configHash,
    gradeJob, envelope, item,
    fileRoot: process.env.FILE_ROOT,
    stopWorker() { worker.kill('SIGKILL'); },
    async restartWorker() {
      worker = start('worker', python, ['apps/worker/worker.py'], 'worker', workerEnv(), true);
    },
    stopSupervisor() { supervisor.kill('SIGKILL'); },
    startSupervisor() {
      supervisor = start('supervisor', process.execPath, ['apps/api/dist/supervisor.js'], 'supervisor', process.env, true);
    },
    workerChild: () => worker,
  });
  await migrator.end();

  writeFileSync(`${runDir}/g1-results.json`, JSON.stringify(records, null, 2));
  } finally {
    await migrator?.end().catch(() => undefined);
    await app.end().catch(() => undefined);
    await ingress.end().catch(() => undefined);
  }
});

test.after(async () => {
  for (const child of [supervisor, worker, inference, api]) child?.kill('SIGKILL');
});
