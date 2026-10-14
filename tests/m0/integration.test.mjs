import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { loadDevEnv, roleUrl } from '../../scripts/lib.mjs';

loadDevEnv();
const API = `http://127.0.0.1:${process.env.API_PORT}`;
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const submissionA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const submissionB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const assetB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const question = '018f0a3e-7c21-7b2a-8c11-111111111111';
const pdf = Buffer.from('%PDF-1.4\nsynthetic-page\n').toString('base64');
const python = existsSync('.venv/bin/python') ? '.venv/bin/python' : 'python3';
const results = [];
const redis = new Redis({ host: process.env.REDIS_HOST, port: Number(process.env.REDIS_PORT), maxRetriesPerRequest: null });
const queue = new Queue('zhixue-jobs', { connection: { host: process.env.REDIS_HOST, port: Number(process.env.REDIS_PORT), maxRetriesPerRequest: null } });

let api;
let inference;
let worker;
const clients = {};

function record(name, detail) {
  results.push({ name, ...detail });
}

function service(scope) {
  return jwt.sign({ scope }, process.env.SERVICE_JWT_SECRET, { audience: 'zhixue-internal', expiresIn: '10m' });
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

function bearer(token, extra = {}) {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...extra };
}

async function finalize(token, key, extra = {}) {
  const response = await fetch(`${API}/api/uploads/finalize`, {
    method: 'POST',
    headers: bearer(token, { 'idempotency-key': key, ...extra }),
    body: JSON.stringify({ contentBase64: pdf, classId: 'c1', subjectId: 'math' }),
  });
  return { status: response.status, body: await response.json() };
}

async function poll(token, jobId) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await fetch(`${API}/api/jobs/${jobId}`, { headers: bearer(token) });
    const body = await response.json();
    if (['succeeded', 'failed_final', 'exception_review', 'awaiting_settlement', 'cancelled'].includes(body.status)) {
      return body;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`job ${jobId} did not finish`);
}

function startWorker() {
  worker = spawn(python, ['apps/worker/worker.py'], {
    env: { ...process.env, API_BASE: API },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.stdout.pipe(createWriteStream('var/log/worker.log', { flags: 'a' }));
  worker.stderr.pipe(createWriteStream('var/log/worker.err', { flags: 'a' }));
}

async function stopWorker() {
  if (!worker || worker.killed) return;
  worker.kill('SIGTERM');
  await once(worker, 'exit').catch(() => undefined);
  worker = null;
}

async function waitHealth(url) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      // process still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`health timeout ${url}`);
}

async function withTenant(client, tenantId, fn) {
  await client.query('BEGIN');
  try {
    if (tenantId) await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    const value = await fn(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

before(async () => {
  mkdirSync('var/log', { recursive: true });
  rmSync(process.env.LOG_PATH, { force: true });
  api = spawn(process.execPath, ['apps/api/dist/main.js'], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  api.stdout.pipe(createWriteStream('var/log/api.stdout', { flags: 'a' }));
  api.stderr.pipe(createWriteStream('var/log/api.stderr', { flags: 'a' }));
  inference = spawn(python, ['-m', 'uvicorn', 'apps.inference.main:app', '--host', '127.0.0.1', '--port', process.env.INFERENCE_PORT], {
    env: process.env,
    stdio: 'ignore',
  });
  await waitHealth(`${API}/health`);
  await waitHealth(`${process.env.INFERENCE_URL}/health`);
  for (const [name, user, password] of [
    ['app', 'zhixue_app', 'ZHIXUE_APP_PASSWORD'],
    ['ingress', 'zhixue_ai_ingress', 'ZHIXUE_INGRESS_PASSWORD'],
    ['platform', 'zhixue_platform_ops', 'ZHIXUE_PLATFORM_PASSWORD'],
    ['relay', 'zhixue_relay', 'ZHIXUE_RELAY_PASSWORD'],
    ['migrator', 'zhixue_migrator', 'ZHIXUE_MIGRATOR_PASSWORD'],
  ]) {
    clients[name] = new pg.Client({ connectionString: roleUrl(user, password) });
    await clients[name].connect();
  }
});

after(async () => {
  await stopWorker();
  inference?.kill('SIGTERM');
  api?.kill('SIGTERM');
  await Promise.all(Object.values(clients).map((client) => client.end()));
  await queue.close();
  await redis.quit();
  writeFileSync('var/m0-g1-raw.json', JSON.stringify(results, null, 2));
});

test('M0 narrow slice', async () => {
  const health = await (await fetch(`${API}/health`)).json();
  assert.equal(health.dbRole, 'zhixue_app');
  assert.equal(health.studentData, 'forbidden');
  assert.equal(health.autoRetryUnknown, false);
  record('health', health);

  const who = await clients.app.query('SELECT current_user, session_user, rolbypassrls FROM pg_roles WHERE rolname = current_user');
  assert.equal(who.rows[0].current_user, 'zhixue_app');
  assert.equal(who.rows[0].session_user, 'zhixue_app');
  assert.equal(who.rows[0].rolbypassrls, false);
  const identity = await (await fetch(`${API}/internal/identity`, {
    headers: bearer(service('ai.job.claim')),
  })).json();
  assert.equal(identity.session_user_name, 'zhixue_ai_ingress');
  assert.equal(identity.current_user_name, 'zhixue_router');
  await assert.rejects(
    clients.app.query(`SELECT * FROM zhixue_ctl.resolve_work_route($1, $2)`, [randomUUID(), 'nope']),
    (error) => error.code === '42501',
  );
  const config = await clients.migrator.query(
    `SELECT proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'zhixue_ctl' AND p.proname = 'resolve_work_route'`,
  );
  assert.ok(config.rows[0].proconfig.includes('search_path=pg_catalog, pg_temp'));
  record('identity', { app: who.rows[0], ingressFunction: identity, searchPath: config.rows[0].proconfig });

  const tokenA = await login('synthetic-teacher-a@example.test');
  const tokenB = await login('synthetic-teacher-b@example.test');
  const tokenOps = await login('synthetic-ops@example.test');
  assert.equal((await fetch(`${API}/api/submissions/${submissionB}`, { headers: bearer(tokenA) })).status, 404);
  assert.equal((await fetch(`${API}/api/submissions/${submissionA}`, { headers: bearer(tokenA) })).status, 403);
  assert.equal((await fetch(`${API}/api/assets/${assetB}/content`, { headers: bearer(tokenA) })).status, 404);
  assert.equal((await fetch(`${API}/api/submissions/${submissionB}`, { headers: bearer(tokenOps) })).status, 403);
  const usage = await (await fetch(`${API}/ops/usage`, { headers: bearer(tokenOps) })).json();
  assert.equal(usage[0].total_amount, '1.50');
  assert.equal(JSON.stringify(usage).includes('synthetic-student'), false);
  await assert.rejects(clients.platform.query('SELECT id FROM zhixue.submissions'), (error) => error.code === '42501');
  record('isolation_http', { usage });

  const seen = [];
  for (const tenant of [A, B]) {
    seen.push(await withTenant(clients.app, tenant, (client) => client.query('SELECT id FROM zhixue.submissions')));
  }
  assert.ok(seen[0].rows.every((row) => row.id !== submissionB));
  assert.ok(seen[1].rows.every((row) => row.id !== submissionA));
  const none = await clients.app.query('SELECT id FROM zhixue.submissions');
  assert.equal(none.rowCount, 0);
  await assert.rejects(
    withTenant(clients.app, A, (client) => client.query(
      `INSERT INTO zhixue.submission_generations (tenant_id, id, submission_id, page_set_id, generation)
       VALUES ($1, $2, $3, $4, 1)`,
      [B, randomUUID(), submissionB, randomUUID()],
    )),
    (error) => error.code === '42501' || error.code === '23514',
  );
  record('rls_pool', { tenantA: seen[0].rowCount, tenantB: seen[1].rowCount, noContext: none.rowCount });

  const student1 = randomUUID();
  const student2 = randomUUID();
  const exam = randomUUID();
  const participation = randomUUID();
  const rosterVersion = randomUUID();
  const entry = randomUUID();
  const paper = randomUUID();
  await withTenant(clients.app, A, async (client) => {
    await client.query(`INSERT INTO zhixue.students (tenant_id, id, label) VALUES ($1, $2, 'synthetic-student-1'), ($1, $3, 'synthetic-student-2')`, [A, student1, student2]);
    await client.query(`INSERT INTO zhixue.exams (tenant_id, id) VALUES ($1, $2)`, [A, exam]);
    await client.query(
      `INSERT INTO zhixue.exam_participations (tenant_id, id, exam_id, student_id, paper_version_id) VALUES ($1, $2, $3, $4, $5)`,
      [A, participation, exam, student1, paper],
    );
    await client.query(
      `INSERT INTO zhixue.exam_roster_entries (tenant_id, roster_version_id, id, exam_id, student_id) VALUES ($1, $2, $3, $4, $5)`,
      [A, rosterVersion, entry, exam, student2],
    );
  });
  await assert.rejects(
    withTenant(clients.app, A, (client) => client.query(
      `INSERT INTO zhixue.participation_roster_links
        (tenant_id, participation_id, roster_version_id, roster_entry_id, exam_id, student_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [A, participation, rosterVersion, entry, exam, student1],
    )),
    (error) => error.code === '23503',
  );
  record('roster_fk', { rejected: true });

  startWorker();
  const started = Date.now();
  const happy = await finalize(tokenA, `happy-${randomUUID()}`);
  const returned = Date.now();
  assert.equal(happy.status, 200);
  assert.equal(happy.body.enqueued, true);
  assert.equal(happy.body.status, undefined);
  const happyJob = await poll(tokenA, happy.body.jobId);
  assert.equal(happyJob.status, 'succeeded');
  const bullJobs = await queue.getJobs(['completed', 'waiting', 'active', 'failed']);
  const match = bullJobs.find((job) => job.data.jobId === happy.body.jobId);
  assert.ok(match);
  assert.notEqual(String(match.id), happy.body.jobId);
  record('browser_closed', { returned: returned - started, workerPid: worker.pid, bullJobId: match.id, businessJobId: happy.body.jobId, status: happyJob.status });

  await stopWorker();
  const beforeCommit = await finalize(tokenA, `crash-commit-${randomUUID()}`, { 'x-test-crash': 'before-commit' });
  assert.equal(beforeCommit.status, 500);
  const missing = await clients.migrator.query(`SELECT 1 FROM zhixue.processing_jobs WHERE logical_key LIKE 'crash-commit-%'`);
  assert.equal(missing.rowCount, 0);

  const beforeEnqueueKey = `crash-enqueue-${randomUUID()}`;
  const beforeEnqueue = await finalize(tokenA, beforeEnqueueKey, { 'x-test-crash': 'before-enqueue' });
  assert.equal(beforeEnqueue.status, 500);
  const queuedOnly = await clients.migrator.query(`SELECT id, status FROM zhixue.processing_jobs WHERE logical_key = $1`, [beforeEnqueueKey]);
  assert.equal(queuedOnly.rows[0].status, 'queued');
  assert.equal((await queue.getJobs(['waiting', 'active'])).some((job) => job.data.jobId === queuedOnly.rows[0].id), false);
  await (await fetch(`${API}/internal/reconcile`, { method: 'POST', headers: bearer(service('reconciler.repair')) })).json();
  startWorker();
  assert.equal((await poll(tokenA, queuedOnly.rows[0].id)).status, 'succeeded');
  record('crash_before_enqueue', { recovered: queuedOnly.rows[0].id });

  await stopWorker();
  const beforeAckKey = `crash-ack-${randomUUID()}`;
  const beforeAck = await finalize(tokenA, beforeAckKey, { 'x-test-crash': 'before-ack' });
  assert.equal(beforeAck.status, 500);
  await (await fetch(`${API}/internal/reconcile`, { method: 'POST', headers: bearer(service('reconciler.repair')) })).json();
  startWorker();
  const ackRow = await clients.migrator.query(`SELECT id FROM zhixue.processing_jobs WHERE logical_key = $1`, [beforeAckKey]);
  assert.equal((await poll(tokenA, ackRow.rows[0].id)).status, 'succeeded');
  const ackCount = await clients.migrator.query(`SELECT COUNT(*)::int AS n FROM zhixue.processing_jobs WHERE logical_key = $1 AND status = 'succeeded'`, [beforeAckKey]);
  assert.equal(ackCount.rows[0].n, 1);
  record('crash_before_ack', { jobId: ackRow.rows[0].id });

  await stopWorker();
  const lossKey = `loss-${randomUUID()}`;
  const loss = await finalize(tokenA, lossKey);
  assert.equal(loss.body.enqueued, true);
  await redis.flushdb();
  await (await fetch(`${API}/internal/reconcile`, { method: 'POST', headers: bearer(service('reconciler.repair')) })).json();
  startWorker();
  assert.equal((await poll(tokenA, loss.body.jobId)).status, 'succeeded');
  record('redis_loss', { jobId: loss.body.jobId });

  await stopWorker();
  const dup = await finalize(tokenA, `dup-${randomUUID()}`);
  const waiting = (await queue.getJobs(['waiting'])).find((job) => job.data.jobId === dup.body.jobId);
  const claim = await (await fetch(`${API}/internal/jobs/claim`, {
    method: 'POST',
    headers: bearer(service('ai.job.claim')),
    body: JSON.stringify({ jobId: dup.body.jobId, capability: waiting.data.capability, tenantId: B }),
  })).json();
  const acceptBody = {
    jobId: dup.body.jobId,
    attemptId: claim.attemptId,
    fencingEpoch: claim.fencingEpoch,
    leaseToken: claim.leaseToken,
    generation: claim.generation,
    inputHash: claim.inputHash,
    ok: true,
  };
  const first = await fetch(`${API}/internal/jobs/accept`, {
    method: 'POST',
    headers: bearer(service('ai.result.accept'), { 'idempotency-key': `accept:${claim.attemptId}` }),
    body: JSON.stringify(acceptBody),
  });
  const firstBody = await first.json();
  const second = await fetch(`${API}/internal/jobs/accept`, {
    method: 'POST',
    headers: bearer(service('ai.result.accept'), { 'idempotency-key': `accept:${claim.attemptId}` }),
    body: JSON.stringify(acceptBody),
  });
  const secondBody = await second.json();
  assert.equal(second.status, 200);
  assert.equal(secondBody.stateVersion, firstBody.stateVersion);
  const forged = await fetch(`${API}/internal/jobs/accept`, {
    method: 'POST',
    headers: bearer(service('ai.result.accept'), { 'idempotency-key': `forged-${randomUUID()}` }),
    body: JSON.stringify({ ...acceptBody, tenantId: B }),
  });
  assert.equal(forged.status, 403);
  record('duplicate_and_forged', { stateVersion: firstBody.stateVersion, forged: forged.status });

  const cancelJob = await finalize(tokenA, `cancel-${randomUUID()}`);
  const cancelWaiting = (await queue.getJobs(['waiting'])).find((job) => job.data.jobId === cancelJob.body.jobId);
  const cancelClaim = await (await fetch(`${API}/internal/jobs/claim`, {
    method: 'POST',
    headers: bearer(service('ai.job.claim')),
    body: JSON.stringify({ jobId: cancelJob.body.jobId, capability: cancelWaiting.data.capability }),
  })).json();
  assert.equal((await fetch(`${API}/api/jobs/${cancelJob.body.jobId}/cancel`, { method: 'POST', headers: bearer(tokenA) })).status, 201 || 200);
  const cancelAccept = await fetch(`${API}/internal/jobs/accept`, {
    method: 'POST',
    headers: bearer(service('ai.result.accept'), { 'idempotency-key': `cancel-${randomUUID()}` }),
    body: JSON.stringify({
      jobId: cancelJob.body.jobId,
      attemptId: cancelClaim.attemptId,
      fencingEpoch: cancelClaim.fencingEpoch,
      leaseToken: cancelClaim.leaseToken,
      generation: cancelClaim.generation,
      inputHash: cancelClaim.inputHash,
      ok: true,
    }),
  });
  assert.equal(cancelAccept.status, 409);
  assert.equal((await (await fetch(`${API}/api/jobs/${cancelJob.body.jobId}`, { headers: bearer(tokenA) })).json()).status, 'cancelled');

  const stale = await finalize(tokenA, `stale-${randomUUID()}`);
  const staleWaiting = (await queue.getJobs(['waiting'])).find((job) => job.data.jobId === stale.body.jobId);
  const staleClaim = await (await fetch(`${API}/internal/jobs/claim`, {
    method: 'POST',
    headers: bearer(service('ai.job.claim')),
    body: JSON.stringify({ jobId: stale.body.jobId, capability: staleWaiting.data.capability }),
  })).json();
  await withTenant(clients.ingress, A, (client) => client.query(
    `UPDATE zhixue.processing_jobs SET input_generation = 2 WHERE id = $1`,
    [stale.body.jobId],
  ));
  const staleAccept = await fetch(`${API}/internal/jobs/accept`, {
    method: 'POST',
    headers: bearer(service('ai.result.accept'), { 'idempotency-key': `stale-${randomUUID()}` }),
    body: JSON.stringify({
      jobId: stale.body.jobId,
      attemptId: staleClaim.attemptId,
      fencingEpoch: staleClaim.fencingEpoch,
      leaseToken: staleClaim.leaseToken,
      generation: staleClaim.generation,
      inputHash: staleClaim.inputHash,
      ok: true,
    }),
  });
  assert.equal(staleAccept.status, 409);
  record('cancel_and_stale_input', { cancel: cancelAccept.status, stale: staleAccept.status });
  await fetch(`${API}/api/jobs/${stale.body.jobId}/cancel`, { method: 'POST', headers: bearer(tokenA) });

  await stopWorker();
  const held = [];
  for (let index = 0; index < 3; index += 1) held.push(await finalize(tokenA, `cap-${index}-${randomUUID()}`));
  assert.equal(held[0].body.enqueued, true);
  assert.equal(held[1].body.enqueued, true);
  assert.equal(held[2].body.enqueued, false);
  const occupied = await (await fetch(`${API}/internal/occupancy`, { headers: bearer(service('scheduler.admit')) })).json();
  assert.equal(occupied, 2);
  for (const job of held) {
    await fetch(`${API}/api/jobs/${job.body.jobId}/cancel`, { method: 'POST', headers: bearer(tokenA) });
  }
  record('admission_cap', { occupied, thirdEnqueued: held[2].body.enqueued });

  await redis.flushdb();
  const takeoverJob = await finalize(tokenA, `takeover-${randomUUID()}`);
  const takeoverWaiting = (await queue.getJobs(['waiting'])).find((job) => job.data.jobId === takeoverJob.body.jobId);
  await (await fetch(`${API}/internal/jobs/claim`, {
    method: 'POST',
    headers: bearer(service('ai.job.claim')),
    body: JSON.stringify({ jobId: takeoverJob.body.jobId, capability: takeoverWaiting.data.capability }),
  })).json();
  await withTenant(clients.ingress, A, (client) => client.query(
    `UPDATE zhixue.processing_jobs SET current_lease_until = clock_timestamp() - interval '1 second' WHERE id = $1`,
    [takeoverJob.body.jobId],
  ));
  const beforeOcc = await (await fetch(`${API}/internal/occupancy`, { headers: bearer(service('scheduler.admit')) })).json();
  const taken = await (await fetch(`${API}/internal/jobs/takeover`, {
    method: 'POST',
    headers: bearer(service('reconciler.repair')),
    body: JSON.stringify({ jobId: takeoverJob.body.jobId }),
  })).json();
  assert.equal(taken.fencingEpoch, 2);
  assert.equal(taken.occupiedBefore, taken.occupiedAfter);
  assert.equal(taken.occupiedBefore, beforeOcc);
  const oldAccept = await fetch(`${API}/internal/jobs/accept`, {
    method: 'POST',
    headers: bearer(service('ai.result.accept'), { 'idempotency-key': `old-epoch-${randomUUID()}` }),
    body: JSON.stringify({
      jobId: takeoverJob.body.jobId,
      attemptId: taken.previousAttemptId,
      fencingEpoch: 1,
      leaseToken: 'not-the-new-token',
      generation: taken.generation,
      inputHash: taken.inputHash,
      ok: true,
    }),
  });
  assert.equal(oldAccept.status, 409);
  const newAccept = await fetch(`${API}/internal/jobs/accept`, {
    method: 'POST',
    headers: bearer(service('ai.result.accept'), { 'idempotency-key': `new-epoch-${randomUUID()}` }),
    body: JSON.stringify({
      jobId: takeoverJob.body.jobId,
      attemptId: taken.attemptId,
      fencingEpoch: taken.fencingEpoch,
      leaseToken: taken.leaseToken,
      generation: taken.generation,
      inputHash: taken.inputHash,
      ok: true,
    }),
  });
  assert.equal(newAccept.status, 201 || 200);
  record('takeover', { epoch: taken.fencingEpoch, occupied: taken.occupiedAfter, oldAccept: oldAccept.status });

  const resume = await fetch(`${API}/internal/jobs/resume-after-settlement`, { method: 'POST', headers: bearer(service('reconciler.repair')) });
  assert.equal(resume.status, 404);
  const seededSettle = await (await fetch(`${API}/internal/jobs/record-settlement`, {
    method: 'POST',
    headers: bearer(service('ai.billing.settle')),
    body: JSON.stringify({
      jobId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6',
      invocationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8',
      amount: '2.00',
      key: 'm0-settle-once',
    }),
  })).json();
  assert.equal(seededSettle.jobStatusBefore, seededSettle.jobStatusAfter);
  assert.equal(seededSettle.proposals, 0);
  const settleAgain = await (await fetch(`${API}/internal/jobs/record-settlement`, {
    method: 'POST',
    headers: bearer(service('ai.billing.settle')),
    body: JSON.stringify({
      jobId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6',
      invocationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8',
      amount: '2.00',
      key: 'm0-settle-once',
    }),
  })).json();
  assert.deepEqual(settleAgain, seededSettle);

  startWorker();
  const billable = await (await fetch(`${API}/internal/test/billable-job`, {
    method: 'POST',
    headers: bearer(tokenA, { 'idempotency-key': `bill-${randomUUID()}` }),
  })).json();
  const parked = await poll(tokenA, billable.jobId);
  assert.equal(parked.status, 'awaiting_settlement');
  const invocation = await withTenant(clients.app, A, (client) => client.query(
    `SELECT id, send_state, cost_status, amount FROM zhixue.model_invocations WHERE job_id = $1`,
    [billable.jobId],
  ));
  const blocked = await fetch(`${API}/internal/jobs/takeover`, {
    method: 'POST',
    headers: bearer(service('reconciler.repair')),
    body: JSON.stringify({ jobId: billable.jobId }),
  });
  assert.equal(blocked.status, 409);
  const abandoned = await (await fetch(`${API}/internal/jobs/abandon-unknown`, {
    method: 'POST',
    headers: bearer(service('ai.billing.settle')),
    body: JSON.stringify({ jobId: billable.jobId, invocationId: invocation.rows[0].id, reason: 'synthetic unknown' }),
  })).json();
  assert.equal(abandoned.costStatus, 'abandoned_unknown');
  assert.equal(abandoned.sendState, 'send_unknown');
  assert.equal(abandoned.amount, null);
  assert.equal(abandoned.display, '未知');
  assert.equal(abandoned.jobStatusBefore, abandoned.jobStatusAfter);
  const closed = await (await fetch(`${API}/internal/jobs/close-unproven`, {
    method: 'POST',
    headers: bearer(service('reconciler.repair')),
    body: JSON.stringify({ jobId: billable.jobId, expectedGeneration: 1 }),
  })).json();
  assert.equal(closed.status, 'exception_review');
  const manual = await (await fetch(`${API}/api/jobs/${billable.jobId}/manual-score`, {
    method: 'POST',
    headers: bearer(tokenA),
  })).json();
  assert.equal(manual.officialScores, 0);
  const proposals = await withTenant(clients.app, A, (client) => client.query(
    'SELECT COUNT(*)::int AS n FROM zhixue.grade_proposals WHERE job_id = $1',
    [billable.jobId],
  ));
  assert.equal(proposals.rows[0].n, 0);
  record('unknown_recovery', { abandoned, closed, manual });
  await stopWorker();

  async function claimedGrade() {
    const created = await (await fetch(`${API}/internal/test/billable-job`, {
      method: 'POST',
      headers: bearer(tokenA, { 'idempotency-key': `grade-${randomUUID()}` }),
    })).json();
    return (await fetch(`${API}/internal/jobs/claim`, {
      method: 'POST',
      headers: bearer(service('ai.job.claim')),
      body: JSON.stringify({ jobId: created.jobId, capability: created.capability }),
    })).json();
  }
  function envelope(claim, item) {
    return {
      schema_version: 'acceptance-envelope/1.0.0',
      job_id: claim.jobId,
      attempt_id: claim.attemptId,
      generation: claim.generation,
      fencing_epoch: claim.fencingEpoch,
      lease_token: claim.leaseToken,
      input_hash: claim.inputHash,
      invocation_id: '018f0a3e-7c21-7b2a-8c11-444444444444',
      payload: {
        schema_version: 'model-grade-payload/1.0.0',
        items: [{
          paper_question_id: question,
          recognized_answer: 'SENTINEL_ANSWER_TEXT',
          suggested_score: '1.00',
          criterion_awards: [{ criterion_id: '018f0a3e-7c21-7b2a-8c11-222222222222', awarded_points: '1.00' }],
          evidence: [{ source_asset_id: '018f0a3e-7c21-7b2a-8c11-333333333333', page_index: 1, bbox: [0, 0, 1, 1] }],
          ...item,
        }],
      },
    };
  }
  async function postEnvelope(claim, item) {
    return fetch(`${API}/internal/jobs/accept`, {
      method: 'POST',
      headers: bearer(service('ai.result.accept'), { 'idempotency-key': `env-${randomUUID()}` }),
      body: JSON.stringify({
        jobId: claim.jobId,
        attemptId: claim.attemptId,
        fencingEpoch: claim.fencingEpoch,
        leaseToken: claim.leaseToken,
        generation: claim.generation,
        inputHash: claim.inputHash,
        envelope: envelope(claim, item),
      }),
    });
  }
  rmSync(process.env.LOG_PATH, { force: true });
  const badUuid = await postEnvelope(await claimedGrade(), { paper_question_id: 'not-a-uuid' });
  const extra = await postEnvelope(await claimedGrade(), { lease_token: 'control' });
  const outOfRange = await postEnvelope(await claimedGrade(), { evidence: [{ source_asset_id: '018f0a3e-7c21-7b2a-8c11-333333333333', page_index: 1, bbox: [0, 0, 1, 2] }] });
  const unknown = await postEnvelope(await claimedGrade(), { paper_question_id: '018f0a3e-7c21-7b2a-8c11-555555555555' });
  assert.equal(badUuid.status, 422);
  assert.equal(extra.status, 422);
  assert.equal(outOfRange.status, 422);
  assert.equal(unknown.status, 422);
  const logText = existsSync(process.env.LOG_PATH) ? readFileSync(process.env.LOG_PATH, 'utf8') : '';
  assert.equal(logText.includes('SENTINEL_ANSWER_TEXT'), false);
  const validClaim = await claimedGrade();
  const valid = await postEnvelope(validClaim, {});
  assert.equal(valid.status, 201 || 200);
  const proposalCount = await withTenant(clients.app, A, (client) => client.query(
    'SELECT COUNT(*)::int AS n FROM zhixue.grade_proposals WHERE job_id = $1',
    [validClaim.jobId],
  ));
  const scoreCount = await withTenant(clients.app, A, (client) => client.query('SELECT COUNT(*)::int AS n FROM zhixue.score_versions'));
  assert.equal(proposalCount.rows[0].n, 1);
  assert.equal(scoreCount.rows[0].n, 0);
  record('schema', { badUuid: badUuid.status, extra: extra.status, outOfRange: outOfRange.status, unknown: unknown.status, valid: valid.status, scores: scoreCount.rows[0].n });

  await assert.rejects(
    withTenant(clients.app, A, (client) => client.query(
      `INSERT INTO zhixue.score_versions (tenant_id, id) VALUES ($1, $2)`,
      [A, randomUUID()],
    )),
    (error) => error.code === '42501',
  );
  const ingressPublish = await clients.ingress.query(
    `SELECT has_function_privilege('zhixue_ai_ingress', 'zhixue_ctl.publish_score_version(uuid)', 'EXECUTE') AS allowed`,
  );
  assert.equal(ingressPublish.rows[0].allowed, false);
  await assert.rejects(
    clients.app.query(`SELECT zhixue_ctl.publish_score_version($1)`, [randomUUID()]),
    (error) => String(error.message).includes('official publish is outside M0'),
  );
  record('publish_denied', { ingressExecute: false });

  const metrics = await (await fetch(`${API}/internal/metrics`, { headers: bearer(service('reconciler.repair')) })).json();
  assert.ok('outbox_oldest_pending_seconds' in metrics);
  assert.ok('job_oldest_running_seconds' in metrics);
  assert.ok('invocation_unknown_count' in metrics);
  assert.equal(JSON.stringify(metrics).includes('SENTINEL_ANSWER_TEXT'), false);
  writeFileSync('var/objects/stray.bin', Buffer.from('orphan'));
  const removed = await (await fetch(`${API}/internal/orphans/sweep`, { method: 'POST', headers: bearer(service('reconciler.repair')) })).json();
  assert.equal(existsSync('var/objects/stray.bin'), false);
  assert.ok(removed >= 1);
  record('metrics_and_orphans', { metrics, removed });

  await redis.flushdb();
  startWorker();
  const batch = [];
  for (let index = 0; index < 300; index += 1) {
    const headers = { 'x-test-tenant-cap': '400', 'x-test-global-cap': '400' };
    if (index % 60 === 0) headers['x-test-fail'] = '1';
    batch.push(finalize(tokenA, `batch-${index}`, headers).then((result) => ({ index, ...result })));
    if (batch.length % 20 === 0) await Promise.all(batch.slice(-20));
  }
  const created = await Promise.all(batch);
  assert.equal(created.filter((item) => item.status === 200).length, 300);
  const terminals = [];
  for (const item of created) terminals.push({ index: item.index, job: await poll(tokenA, item.body.jobId) });
  const failed = terminals.filter((item) => item.job.status === 'failed_final');
  const succeeded = terminals.filter((item) => item.job.status === 'succeeded');
  assert.equal(failed.length, 5);
  assert.equal(succeeded.length, 295);
  const rerun = [];
  for (const item of failed) {
    rerun.push(await finalize(tokenA, `batch-${item.index}:rerun`, {
      'x-test-tenant-cap': '400',
      'x-test-global-cap': '400',
    }));
  }
  const rerunStates = [];
  for (const item of rerun) rerunStates.push(await poll(tokenA, item.body.jobId));
  assert.ok(rerunStates.every((item) => item.status === 'succeeded'));
  record('batch_300', { succeeded: succeeded.length, failed: failed.length, rerun: rerunStates.length });
  await stopWorker();

  const bootstrap = new pg.Client({ connectionString: roleUrl('zhixue_bootstrap', 'BOOTSTRAP_PASSWORD') });
  await bootstrap.connect();
  await bootstrap.query('DROP DATABASE IF EXISTS zhixue_m0_upgrade WITH (FORCE)');
  await bootstrap.query('CREATE DATABASE zhixue_m0_upgrade');
  await bootstrap.query('DROP DATABASE IF EXISTS zhixue_m0_restore WITH (FORCE)');
  await bootstrap.end();
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/migrate.mjs', '--database', 'zhixue_m0_upgrade', '--only', '0001'], { stdio: 'inherit', env: process.env });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`upgrade migrate ${code}`))));
  });
  mkdirSync('var', { recursive: true });
  await new Promise((resolve, reject) => {
    const child = spawn('pg_dump', ['-Fc', '-f', 'var/m0-upgrade.dump', roleUrl('zhixue_bootstrap', 'BOOTSTRAP_PASSWORD').replace(process.env.PGDATABASE, 'zhixue_m0_upgrade')], { stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`pg_dump ${code}`))));
  });
  const restoreBootstrap = new pg.Client({ connectionString: roleUrl('zhixue_bootstrap', 'BOOTSTRAP_PASSWORD') });
  await restoreBootstrap.connect();
  await restoreBootstrap.query('CREATE DATABASE zhixue_m0_restore');
  await restoreBootstrap.end();
  await new Promise((resolve, reject) => {
    const child = spawn('pg_restore', ['-d', roleUrl('zhixue_bootstrap', 'BOOTSTRAP_PASSWORD').replace(process.env.PGDATABASE, 'zhixue_m0_restore'), 'var/m0-upgrade.dump'], { stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`pg_restore ${code}`))));
  });
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/migrate.mjs', '--database', 'zhixue_m0_restore', '--only', '0002'], { stdio: 'inherit', env: process.env });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`restore migrate ${code}`))));
  });
  const restored = new pg.Client({
    connectionString: roleUrl('zhixue_migrator', 'ZHIXUE_MIGRATOR_PASSWORD').replace(process.env.PGDATABASE, 'zhixue_m0_restore'),
  });
  await restored.connect();
  const column = await restored.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'zhixue' AND table_name = 'submissions' AND column_name = 'correlation_note'`,
  );
  await restored.end();
  assert.equal(column.rowCount, 1);
  record('migration_upgrade', { column: column.rows[0].column_name });

  const missingCap = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['apps/api/dist/config-check.js'], {
      env: {
        PATH: process.env.PATH,
        ZHIXUE_ENV: 'production',
        STUDENT_DATA: 'forbidden',
        MODEL_ENDPOINT: 'https://example.test/model',
        MODEL_ENDPOINT_ALLOWLIST: 'https://example.test/model',
        AUTO_RETRY_UNKNOWN: 'false',
        EXECUTION_GLOBAL_CAP: '10',
        EXECUTION_MAX_ATTEMPTS: '3',
        EXECUTION_DEADLINE_SECONDS: '900',
        EXECUTION_LEASE_SECONDS: '30',
        EXECUTION_GRACE_SECONDS: '0',
        CAPABILITY_TTL_SECONDS: '60',
        UNKNOWN_ESCALATE_AFTER_SECONDS: '3600',
        FILE_MAX_BYTES: '1000',
        ZHIXUE_TEST_HOOKS: '0',
        FILE_ROOT: 'var/objects',
        LOG_PATH: 'var/log/api.log',
        API_PORT: '3400',
        REDIS_HOST: '127.0.0.1',
        REDIS_PORT: '6379',
        SERVICE_JWT_SECRET: 'prod-secret',
        USER_JWT_SECRET: 'prod-user',
        PGHOST: '127.0.0.1',
        PGPORT: '5432',
        PGDATABASE: 'zhixue',
        BOOTSTRAP_PASSWORD: 'x',
        ZHIXUE_MIGRATOR_PASSWORD: 'x',
        ZHIXUE_APP_PASSWORD: 'x',
        ZHIXUE_RELAY_PASSWORD: 'x',
        ZHIXUE_INGRESS_PASSWORD: 'x',
        ZHIXUE_RECONCILER_PASSWORD: 'x',
        ZHIXUE_SCHEDULER_PASSWORD: 'x',
        ZHIXUE_PLATFORM_PASSWORD: 'x',
      },
    });
    let text = '';
    child.stderr.on('data', (chunk) => { text += chunk; });
    child.on('exit', (code) => resolve({ code, text }));
  });
  assert.equal(missingCap.code, 1);
  assert.match(missingCap.text, /EXECUTION_TENANT_CAP/);
  record('production_config', { missingCap: missingCap.code });

  const versions = {
    node: process.version,
    postgres: (await clients.migrator.query('SELECT version()')).rows[0].version,
    redis: await redis.info('server'),
  };
  record('versions', versions);
});
