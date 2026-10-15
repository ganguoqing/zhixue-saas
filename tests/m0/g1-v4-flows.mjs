import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import pg from 'pg';
import Redis from 'ioredis';
import { roleUrl } from '../../scripts/lib.mjs';

const require = createRequire(import.meta.url);
const { validateEnvelope } = require('../../apps/api/dist/schemas.js');
const B = '22222222-2222-4222-8222-222222222222';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function inferCount(jobId) {
  const path = process.env.INFERENCE_COUNT_PATH;
  if (!path || !existsSync(path)) return 0;
  return readFileSync(path, 'utf8').split('\n').filter((line) => line === jobId).length;
}

async function exited(child) {
  if (child.exitCode !== null) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('child did not exit')), 15000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function pdf(text) {
  return Buffer.from(`%PDF-1.4\n${text}\n`).toString('base64');
}

export async function runV4(ctx) {
  const {
    API, tokenA, migrator, records, poll, auth, token, login,
    A, question, question2, criterion, lease, inputHash, configHash,
    gradeJob, envelope, item, fileRoot,
    stopWorker, restartWorker, stopSupervisor, startSupervisor, workerChild,
  } = ctx;

  async function billable(headers) {
    const response = await fetch(`${API}/internal/test/billable-job`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tokenA}`, 'idempotency-key': randomUUID(), 'x-test-delay': '0', ...headers },
    });
    const body = await response.json();
    assert.equal(response.status, 201, JSON.stringify(body));
    return body;
  }

  async function finalize(userToken, key, headers, content) {
    const response = await fetch(`${API}/api/uploads/finalize`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${userToken}`,
        'idempotency-key': key,
        'content-type': 'application/json',
        'x-correlation-id': randomUUID(),
        ...headers,
      },
      body: JSON.stringify({ contentBase64: content, classId: 'c1', subjectId: 'math' }),
    });
    const body = await response.json().catch(() => ({}));
    return { status: response.status, body };
  }

  const modes = [
    ['http_500', 'provider_http'],
    ['bad_json', 'bad_json'],
    ['illegal_uuid', 'schema_rejected'],
  ];
  for (const [mode, code] of modes) {
    const created = await billable({ 'x-test-provider-mode': mode });
    const done = await poll(tokenA, created.jobId);
    assert.equal(done.status, 'exception_review', `${mode} ${JSON.stringify(done)}`);
    assert.equal(done.resultStatus, code, mode);
    const calls = inferCount(created.jobId);
    assert.equal(calls, 1, mode);
    records.push({ name: `stage_${code}`, status: done.status, calls });
  }

  const replayJob = await gradeJob();
  await migrator.query('UPDATE zhixue.processing_jobs SET occupancy_held = false WHERE id = $1', [replayJob.jobId]);
  const failBody = {
    jobId: replayJob.jobId,
    attemptId: replayJob.attemptId,
    invocationId: replayJob.invocationId,
    failureCode: 'missing_persisted_result',
    providerStatus: null,
    fencingEpoch: 1,
    generation: 1,
    inputHash,
    leaseToken: lease,
  };
  const failHeaders = () => ({
    ...auth('worker', 'ai.result.accept', { job_id: replayJob.jobId, attempt_id: replayJob.attemptId }),
    'idempotency-key': `fail-${replayJob.attemptId}`,
  });
  const firstFail = await fetch(`${API}/internal/jobs/stage-failure`, { method: 'POST', headers: failHeaders(), body: JSON.stringify(failBody) });
  const firstFailBody = await firstFail.json();
  assert.equal(firstFail.status, 201, JSON.stringify(firstFailBody));
  assert.equal(firstFailBody.resultStatus, 'missing_persisted_result');
  const replayFail = await fetch(`${API}/internal/jobs/stage-failure`, { method: 'POST', headers: failHeaders(), body: JSON.stringify(failBody) });
  const replayFailBody = await replayFail.json();
  assert.equal(replayFailBody.resultStatus, firstFailBody.resultStatus, JSON.stringify(replayFailBody));
  assert.equal(replayFailBody.replay, true);
  const conflict = await fetch(`${API}/internal/jobs/stage-failure`, {
    method: 'POST',
    headers: failHeaders(),
    body: JSON.stringify({ ...failBody, failureCode: 'bad_json' }),
  });
  assert.equal(conflict.status, 409);
  const stale = await fetch(`${API}/internal/jobs/stage-failure`, {
    method: 'POST',
    headers: { ...auth('worker', 'ai.result.accept', { job_id: replayJob.jobId, attempt_id: replayJob.attemptId }), 'idempotency-key': randomUUID() },
    body: JSON.stringify({ ...failBody, leaseToken: 'stale-token' }),
  });
  assert.equal(stale.status, 409);
  const unchanged = await migrator.query('SELECT status, result_status FROM zhixue.processing_jobs WHERE id = $1', [replayJob.jobId]);
  assert.equal(unchanged.rows[0].result_status, 'missing_persisted_result');
  records.push({ name: 'stage_failure_receipt', replay: true, conflict: conflict.status, stale: stale.status });

  const deadlineId = randomUUID();
  const deadlineAttempt = randomUUID();
  await migrator.query('UPDATE zhixue.global_execution_occupancy SET occupied = occupied + 1 WHERE id = 1');
  const occupiedBefore = await migrator.query('SELECT occupied FROM zhixue.global_execution_occupancy WHERE id = 1');
  await migrator.query('BEGIN');
  await migrator.query(
    `INSERT INTO zhixue.processing_jobs (
       tenant_id, id, submission_id, stage, status, result_status, created_at,
       current_attempt_id, current_fencing_epoch, claimed_at, current_lease_until,
       input_generation, input_hash, logical_key, billable, occupancy_held
     ) VALUES (
       $1, $2, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'validate_asset', 'running', 'pending',
       clock_timestamp() - interval '1000 seconds', $3, 1, clock_timestamp(), clock_timestamp() + interval '1 hour',
       1, $4, $5, false, true
     )`,
    [A, deadlineId, deadlineAttempt, inputHash, `deadline-${deadlineId}`],
  );
  await migrator.query(
    `INSERT INTO zhixue.execution_attempts (tenant_id, id, job_id, fencing_epoch, lease_token_hash, lease_until)
     VALUES ($1, $2, $3, 1, $4, clock_timestamp() + interval '1 hour')`,
    [A, deadlineAttempt, deadlineId, sha256(lease)],
  );
  await migrator.query('COMMIT');
  let deadlineRow;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    deadlineRow = await migrator.query('SELECT status, result_status, occupancy_held FROM zhixue.processing_jobs WHERE id = $1', [deadlineId]);
    if (deadlineRow.rows[0].status === 'failed_final') break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.equal(deadlineRow.rows[0].status, 'failed_final');
  assert.equal(deadlineRow.rows[0].result_status, 'deadline');
  assert.equal(deadlineRow.rows[0].occupancy_held, false);
  const occupiedAfter = await migrator.query('SELECT occupied FROM zhixue.global_execution_occupancy WHERE id = 1');
  assert.equal(occupiedAfter.rows[0].occupied, occupiedBefore.rows[0].occupied - 1);
  records.push({ name: 'deadline_release', status: deadlineRow.rows[0].status });

  const legalJob = await gradeJob();
  const illegalJob = await gradeJob();
  await migrator.query('UPDATE zhixue.processing_jobs SET occupancy_held = false WHERE id = ANY($1)', [[legalJob.jobId, illegalJob.jobId]]);
  const legal = envelope(legalJob, [
    item(question, [{ criterion_id: criterion, awarded_points: '1.00' }], '1.00'),
    item(question2, [{ criterion_id: criterion, awarded_points: '1.00' }], '1.00'),
  ]);
  const illegal = envelope(illegalJob, [
    item(question, [{ criterion_id: criterion, awarded_points: '1.00' }], '1.00', { paper_question_id: 'not-a-uuid' }),
  ]);
  illegal.payload.items[0].paper_question_id = 'not-a-uuid';
  const python = spawn('.venv/bin/python', ['-c', `
import json,sys
from apps.worker.worker import schema_ok
docs=json.load(sys.stdin)
print(json.dumps({"fresh": schema_ok(docs["fresh"]), "observed": schema_ok(docs["observed"]), "illegal": schema_ok(docs["illegal"])}))
`], { stdio: ['pipe', 'pipe', 'pipe'] });
  let pyOut = '';
  python.stdout.on('data', (chunk) => { pyOut += chunk; });
  python.stderr.on('data', (chunk) => { pyOut += chunk; });
  python.stdin.end(JSON.stringify({ fresh: legal, observed: legal, illegal }));
  const pyCode = await new Promise((resolve) => python.on('exit', resolve));
  assert.equal(pyCode, 0, pyOut);
  const py = JSON.parse(pyOut);
  assert.equal(py.fresh, true);
  assert.equal(py.observed, true);
  assert.equal(py.illegal, false);
  assert.equal(validateEnvelope(legal), true);
  assert.equal(validateEnvelope(illegal), false);
  records.push({ name: 'schema_corpus', python: py, ajvIllegal: false });

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  for (const [name, bytes] of [['png', png], ['jpeg', jpeg]]) {
    const uploaded = await finalize(tokenA, `${name}-${randomUUID()}`, { 'x-test-tenant-cap': '400', 'x-test-global-cap': '400' }, bytes.toString('base64'));
    assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body));
    const asset = await migrator.query(
      `SELECT a.id, a.sha256, a.media_type FROM zhixue.source_assets a
       JOIN zhixue.submissions s ON s.asset_id = a.id AND s.tenant_id = a.tenant_id
       WHERE s.id = $1`,
      [uploaded.body.submissionId],
    );
    const downloaded = await fetch(`${API}/api/assets/${asset.rows[0].id}/content`, { headers: { authorization: `Bearer ${tokenA}` } });
    const got = Buffer.from(await downloaded.arrayBuffer());
    assert.equal(downloaded.status, 200);
    assert.equal(downloaded.headers.get('content-type'), asset.rows[0].media_type);
    assert.equal(sha256(got), asset.rows[0].sha256);
    assert.equal(got.includes(Buffer.from('{"type":"Buffer"')), false);
    records.push({ name: `${name}_download`, match: true });
  }
  const tokenB = await login('synthetic-teacher-b@example.test');
  const foreign = await fetch(`${API}/api/assets/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2/content`, { headers: { authorization: `Bearer ${tokenB}` } });
  assert.equal(foreign.status, 404);
  const crossClass = await fetch(`${API}/api/assets/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2/content`, { headers: { authorization: `Bearer ${tokenA}` } });
  assert.equal(crossClass.status, 403);
  const membership = await migrator.query(
    `SELECT id FROM zhixue.memberships WHERE tenant_id = $1 AND user_id IN (SELECT id FROM zhixue.users WHERE email = 'synthetic-teacher-a@example.test')`,
    [A],
  );
  await migrator.query('UPDATE zhixue.memberships SET revoked_at = clock_timestamp() WHERE id = $1', [membership.rows[0].id]);
  const revoked = await fetch(`${API}/api/assets/${(await migrator.query(`SELECT id FROM zhixue.source_assets WHERE tenant_id = $1 AND media_type = 'image/png' LIMIT 1`, [A])).rows[0].id}/content`, {
    headers: { authorization: `Bearer ${tokenA}` },
  });
  assert.equal(revoked.status, 403);
  await migrator.query('UPDATE zhixue.memberships SET revoked_at = NULL WHERE id = $1', [membership.rows[0].id]);
  records.push({ name: 'download_auth', foreign: foreign.status, crossClass: crossClass.status, revoked: revoked.status });

  const manualJob = await billable({ 'x-test-provider-mode': 'http_500' });
  const manualDone = await poll(tokenA, manualJob.jobId);
  assert.equal(manualDone.status, 'exception_review');
  const manualHeaders = { authorization: `Bearer ${tokenA}` };
  const manualFirst = await fetch(`${API}/api/jobs/${manualJob.jobId}/manual-score`, { method: 'POST', headers: manualHeaders });
  const manualBody = await manualFirst.json();
  assert.ok([200, 201].includes(manualFirst.status), JSON.stringify(manualBody));
  const manualReplay = await fetch(`${API}/api/jobs/${manualJob.jobId}/manual-score`, { method: 'POST', headers: manualHeaders });
  const manualReplayBody = await manualReplay.json();
  assert.equal(manualReplayBody.draftId, manualBody.draftId);
  assert.equal(manualReplayBody.replay, true);
  const official = await migrator.query('SELECT COUNT(*)::int AS n FROM zhixue.score_versions');
  assert.equal(official.rows[0].n, 0);
  await migrator.query('UPDATE zhixue.memberships SET revoked_at = clock_timestamp() WHERE id = $1', [membership.rows[0].id]);
  const manualDenied = await fetch(`${API}/api/jobs/${manualJob.jobId}/manual-score`, { method: 'POST', headers: manualHeaders });
  assert.equal(manualDenied.status, 403);
  await migrator.query('UPDATE zhixue.memberships SET revoked_at = NULL WHERE id = $1', [membership.rows[0].id]);
  records.push({ name: 'manual_replay_revoke', replay: true, denied: manualDenied.status });

  const appPool = new pg.Pool({ connectionString: roleUrl('zhixue_app', 'ZHIXUE_APP_PASSWORD'), max: 1 });
  async function pooledCount(tenant) {
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      const pid = await client.query('SELECT pg_backend_pid() AS pid');
      if (tenant) await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant]);
      const seen = await client.query('SELECT COUNT(*)::int AS n FROM zhixue.submissions');
      await client.query('COMMIT');
      return { pid: pid.rows[0].pid, n: seen.rows[0].n };
    } finally {
      client.release();
    }
  }
  const poolA = await pooledCount(A);
  const poolB = await pooledCount(B);
  const poolNone = await pooledCount(null);
  assert.equal(poolA.pid, poolB.pid);
  assert.equal(poolB.pid, poolNone.pid);
  assert.ok(poolA.n > 0);
  assert.equal(poolNone.n, 0);
  const widePool = new pg.Pool({ connectionString: roleUrl('zhixue_app', 'ZHIXUE_APP_PASSWORD'), max: 8 });
  const concurrent = await Promise.all(Array.from({ length: 16 }, async (_, index) => {
    const client = await widePool.connect();
    try {
      await client.query('BEGIN');
      const tenant = index % 2 === 0 ? A : B;
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant]);
      const seen = await client.query('SELECT COUNT(*)::int AS n, current_setting(\'app.tenant_id\', true) AS tenant FROM zhixue.submissions');
      await client.query('COMMIT');
      return { tenant, n: seen.rows[0].n, seen: seen.rows[0].tenant };
    } finally {
      client.release();
    }
  }));
  assert.ok(concurrent.every((row) => row.seen === row.tenant && row.n >= 0));
  assert.ok(concurrent.filter((row) => row.tenant === A).every((row) => row.n === poolA.n));
  const released = await widePool.query('SELECT COUNT(*)::int AS n FROM zhixue.submissions');
  assert.equal(released.rows[0].n, 0);
  await appPool.end();
  await widePool.end();
  records.push({ name: 'rls_pool', pid: poolA.pid, counts: [poolA.n, poolB.n, poolNone.n], concurrent: concurrent.length });

  await migrator.query(`UPDATE zhixue.global_execution_occupancy SET occupied = (
    SELECT COUNT(*) FROM zhixue.processing_jobs WHERE occupancy_held AND status IN ('queued', 'running')
  )`);
  await migrator.query(`UPDATE zhixue.tenant_execution_occupancy t SET occupied = (
    SELECT COUNT(*) FROM zhixue.processing_jobs j
    WHERE j.tenant_id = t.tenant_id AND j.occupancy_held AND j.status IN ('queued', 'running')
  )`);
  stopWorker();
  await exited(workerChild());
  const capped = [];
  for (let index = 0; index < 3; index += 1) {
    capped.push(await finalize(tokenA, `cap-${index}-${randomUUID()}`, {}, pdf('cap')));
  }
  assert.equal(capped[0].body.enqueued, true);
  assert.equal(capped[1].body.enqueued, true);
  assert.equal(capped[2].body.enqueued, false);
  const occupied = await (await fetch(`${API}/internal/occupancy`, { headers: auth('scheduler', 'scheduler.admit') })).json();
  assert.equal(occupied, 2);
  for (const job of capped) {
    if (job.body.jobId) await fetch(`${API}/api/jobs/${job.body.jobId}/cancel`, { method: 'POST', headers: { authorization: `Bearer ${tokenA}` } });
  }
  const cursor = await migrator.query('SELECT last_tenant_id FROM zhixue.admit_cursor WHERE id = 1');
  records.push({ name: 'default_cap', occupied, third: capped[2].body.enqueued, cursor: cursor.rows[0].last_tenant_id });
  await restartWorker();

  const claimKill = await billable({ 'x-test-kill': 'after-claim' });
  await exited(workerChild());
  await restartWorker();
  const claimTaken = await poll(tokenA, claimKill.jobId);
  assert.equal(claimTaken.status, 'succeeded', JSON.stringify(claimTaken));
  assert.equal(claimTaken.stage, 'model_grade');
  const claimProposals = await migrator.query('SELECT COUNT(*)::int AS n FROM zhixue.grade_proposals WHERE job_id = $1', [claimKill.jobId]);
  assert.equal(claimProposals.rows[0].n, 1);
  assert.equal(inferCount(claimKill.jobId), 1);
  const epochs = await migrator.query('SELECT current_fencing_epoch FROM zhixue.processing_jobs WHERE id = $1', [claimKill.jobId]);
  assert.ok(epochs.rows[0].current_fencing_epoch >= 2);
  records.push({ name: 'model_grade_takeover', epoch: epochs.rows[0].current_fencing_epoch, proposals: 1 });

  const validateKill = await finalize(tokenA, `validate-kill-${randomUUID()}`, {
    'x-test-kill': 'after-claim',
    'x-test-tenant-cap': '400',
    'x-test-global-cap': '400',
  }, pdf('validate-kill'));
  assert.equal(validateKill.status, 200, JSON.stringify(validateKill.body));
  await exited(workerChild());
  await restartWorker();
  const validateDone = await poll(tokenA, validateKill.body.jobId);
  assert.equal(validateDone.status, 'succeeded', JSON.stringify(validateDone));
  assert.equal(validateDone.stage, 'validate_asset');
  records.push({ name: 'validate_takeover', status: validateDone.status });

  const permitKill = await billable({ 'x-test-kill': 'after-permit' });
  await exited(workerChild());
  await restartWorker();
  const permitDone = await poll(tokenA, permitKill.jobId);
  assert.equal(permitDone.status, 'awaiting_settlement');
  assert.equal(inferCount(permitKill.jobId), 0);
  records.push({ name: 'permit_kill_no_second_call', calls: 0 });

  const httpKill = await billable({ 'x-test-kill': 'after-http' });
  await exited(workerChild());
  await restartWorker();
  const httpDone = await poll(tokenA, httpKill.jobId);
  assert.equal(httpDone.status, 'awaiting_settlement');
  assert.equal(inferCount(httpKill.jobId), 1);
  records.push({ name: 'http_kill_no_second_call', calls: 1 });

  const observeKill = await billable({ 'x-test-kill': 'after-observe' });
  await exited(workerChild());
  const callsAfterObserve = inferCount(observeKill.jobId);
  await restartWorker();
  const observeDone = await poll(tokenA, observeKill.jobId);
  assert.equal(observeDone.status, 'succeeded', JSON.stringify(observeDone));
  assert.equal(inferCount(observeKill.jobId), callsAfterObserve);
  assert.equal(callsAfterObserve, 1);
  records.push({ name: 'observed_resume', calls: callsAfterObserve });

  stopSupervisor();
  const windowJob = await billable({ 'x-test-kill': 'after-claim' });
  await exited(workerChild());
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const crashed = await fetch(`${API}/internal/jobs/takeover`, {
    method: 'POST',
    headers: { ...auth('reconciler', 'reconciler.repair'), 'x-test-crash': 'after-commit' },
    body: JSON.stringify({ jobId: windowJob.jobId }),
  });
  const crashedText = await crashed.text();
  assert.equal(crashed.status, 500, crashedText);
  const pendingIntent = await migrator.query(
    `SELECT d.state, d.billable, d.stage FROM zhixue.delivery_intents d
     JOIN zhixue.processing_jobs j ON j.current_attempt_id = d.attempt_id
     WHERE j.id = $1`,
    [windowJob.jobId],
  );
  assert.equal(pendingIntent.rows[0].state, 'pending');
  assert.equal(pendingIntent.rows[0].billable, true);
  assert.equal(pendingIntent.rows[0].stage, 'model_grade');
  const redis = new Redis({ host: process.env.REDIS_HOST, port: Number(process.env.REDIS_PORT), db: Number(process.env.REDIS_DB), maxRetriesPerRequest: null });
  const keys = await redis.keys(`${process.env.QUEUE_PREFIX}:*`);
  if (keys.length > 0) await redis.del(keys);
  await redis.quit();
  await restartWorker();
  const rebuilt = await fetch(`${API}/internal/reconcile`, { method: 'POST', headers: auth('reconciler', 'reconciler.repair') });
  assert.ok([200, 201].includes(rebuilt.status), await rebuilt.text?.() || '');
  const windowDone = await poll(tokenA, windowJob.jobId);
  assert.equal(windowDone.status, 'succeeded', JSON.stringify(windowDone));
  assert.equal(inferCount(windowJob.jobId), 1);
  records.push({ name: 'redis_loss_rebuild', status: windowDone.status });
  startSupervisor();

  stopSupervisor();
  const relayEvent = randomUUID();
  const relaySubmission = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  await migrator.query(
    `INSERT INTO zhixue.outbox_events (
       event_id, tenant_id, schema_version, name, aggregate_type, aggregate_id,
       aggregate_version, payload, occurred_at, correlation_id, causation_id
     ) VALUES ($1, $2, 'zhixue.event/2', 'AssetFinalized', 'submission', $3, 1, $4::jsonb, clock_timestamp(), $5, NULL)`,
    [relayEvent, A, relaySubmission, JSON.stringify({
      event_id: relayEvent, occurred_at: new Date().toISOString(), correlation_id: relayEvent, causation_id: null,
    }), relayEvent],
  );
  await migrator.query(
    `INSERT INTO zhixue_ctl.outbox_dispatch_index (event_id, tenant_id, status) VALUES ($1, $2, 'pending')`,
    [relayEvent, A],
  );
  const relayCrash = await fetch(`${API}/internal/relay`, {
    method: 'POST',
    headers: { ...auth('relay', 'relay.deliver'), 'x-test-crash': 'before-commit' },
  });
  assert.equal(relayCrash.status, 500);
  const rolled = await migrator.query(
    `SELECT
       (SELECT status FROM zhixue_ctl.outbox_dispatch_index WHERE event_id = $1) AS status,
       (SELECT COUNT(*)::int FROM zhixue.asset_notices WHERE event_id = $1) AS notices,
       (SELECT COUNT(*)::int FROM zhixue.consumer_inbox WHERE event_id = $1) AS inbox`,
    [relayEvent],
  );
  assert.equal(rolled.rows[0].status, 'pending');
  assert.equal(rolled.rows[0].notices, 0);
  assert.equal(rolled.rows[0].inbox, 0);
  const relayOk = await fetch(`${API}/internal/relay`, { method: 'POST', headers: auth('relay', 'relay.deliver') });
  assert.ok([200, 201].includes(relayOk.status));
  const delivered = await migrator.query(
    `SELECT
       (SELECT status FROM zhixue_ctl.outbox_dispatch_index WHERE event_id = $1) AS status,
       (SELECT COUNT(*)::int FROM zhixue.asset_notices WHERE event_id = $1) AS notices,
       (SELECT COUNT(*)::int FROM zhixue.consumer_inbox WHERE event_id = $1) AS inbox`,
    [relayEvent],
  );
  assert.equal(delivered.rows[0].status, 'delivered');
  assert.equal(delivered.rows[0].notices, 1);
  assert.equal(delivered.rows[0].inbox, 1);
  records.push({ name: 'relay_once', crash: relayCrash.status, replayed: delivered.rows[0].status });
  startSupervisor();

  const flags = await migrator.query(
    `SELECT c.relrowsecurity, c.relforcerowsecurity
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'zhixue' AND c.relname = 'delivery_intents'`,
  );
  assert.equal(flags.rows[0].relrowsecurity, true);
  assert.equal(flags.rows[0].relforcerowsecurity, true);
  const owners = await migrator.query(
    `SELECT r.rolname, r.rolbypassrls FROM pg_roles r WHERE r.rolname IN ('zhixue_owner', 'zhixue_router')`,
  );
  assert.ok(owners.rows.every((row) => row.rolbypassrls === false));
  async function tenantQuery(role, passwordEnv, tenant, sql, params = []) {
    const client = new pg.Client({ connectionString: roleUrl(role, passwordEnv) });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant ?? '']);
      const result = await client.query(sql, params);
      await client.query('ROLLBACK');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      await client.end();
    }
  }
  for (const [role, passwordEnv] of [['zhixue_ai_ingress', 'ZHIXUE_INGRESS_PASSWORD'], ['zhixue_reconciler', 'ZHIXUE_RECONCILER_PASSWORD']]) {
    const own = await tenantQuery(role, passwordEnv, A, 'SELECT COUNT(*)::int AS n FROM zhixue.delivery_intents');
    const other = await tenantQuery(role, passwordEnv, B, 'SELECT COUNT(*)::int AS n, COUNT(lease_token)::int AS tokens FROM zhixue.delivery_intents WHERE tenant_id = $1', [A]);
    const none = await tenantQuery(role, passwordEnv, null, 'SELECT COUNT(*)::int AS n, COUNT(lease_token)::int AS tokens FROM zhixue.delivery_intents');
    assert.ok(own.rows[0].n > 0, role);
    assert.equal(other.rows[0].n, 0, role);
    assert.equal(other.rows[0].tokens, 0, role);
    assert.equal(none.rows[0].n, 0, role);
    assert.equal(none.rows[0].tokens, 0, role);
    const write = await tenantQuery(role, passwordEnv, B, 'UPDATE zhixue.delivery_intents SET state = state WHERE tenant_id = $1', [A]);
    assert.equal(write.rowCount, 0, role);
    await assert.rejects(
      tenantQuery(role, passwordEnv, B,
        `INSERT INTO zhixue.delivery_intents
          (tenant_id, id, job_id, attempt_id, fencing_epoch, stage, billable, lease_token, generation, input_hash, state)
         VALUES ($1, $2, $3, $4, 1, 'model_grade', true, 'x', 1, $5, 'pending')`,
        [A, randomUUID(), randomUUID(), randomUUID(), 'ab'.repeat(32)]),
      (error) => error.code === '42501',
    );
  }
  const parent = await migrator.query(
    `SELECT d.id, d.job_id, j2.id AS other_job
     FROM zhixue.delivery_intents d
     JOIN zhixue.processing_jobs j2 ON j2.tenant_id = d.tenant_id AND j2.id <> d.job_id
     WHERE d.tenant_id = $1 LIMIT 1`,
    [A],
  );
  await assert.rejects(
    tenantQuery('zhixue_ai_ingress', 'ZHIXUE_INGRESS_PASSWORD', A,
      `INSERT INTO zhixue.delivery_intents
        (tenant_id, id, job_id, attempt_id, fencing_epoch, stage, billable, lease_token, generation, input_hash, state)
       VALUES ($1, $2, $3, $4, 1, 'model_grade', true, 'x', 1, $5, 'pending')`,
      [A, randomUUID(), randomUUID(), randomUUID(), 'ab'.repeat(32)]),
    (error) => error.code === '23503',
  );
  await assert.rejects(
    tenantQuery('zhixue_ai_ingress', 'ZHIXUE_INGRESS_PASSWORD', A,
      'UPDATE zhixue.delivery_intents SET fencing_epoch = 0, generation = 0 WHERE id = $1',
      [parent.rows[0].id]),
    (error) => error.code === '23514',
  );
  await assert.rejects(
    tenantQuery('zhixue_ai_ingress', 'ZHIXUE_INGRESS_PASSWORD', A,
      'UPDATE zhixue.delivery_intents SET job_id = $2 WHERE id = $1',
      [parent.rows[0].id, parent.rows[0].other_job]),
    (error) => error.code === '23503' || error.code === '23514',
  );
  await assert.rejects(
    tenantQuery('zhixue_ai_ingress', 'ZHIXUE_INGRESS_PASSWORD', B,
      `INSERT INTO zhixue.delivery_intents
        (tenant_id, id, job_id, attempt_id, fencing_epoch, stage, billable, lease_token, generation, input_hash, state)
       VALUES ($1, $2, $3, $4, 1, 'model_grade', true, 'x', 1, $5, 'pending')`,
      [B, randomUUID(), parent.rows[0].job_id, randomUUID(), 'ab'.repeat(32)]),
    (error) => error.code === '23503' || error.code === '23514',
  );
  records.push({ name: 'delivery_rls_fk', enabled: true });

  stopSupervisor();
  const pair = await billable({ 'x-test-kill': 'after-claim' });
  await exited(workerChild());
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const both = await Promise.all([0, 1].map(() => fetch(`${API}/internal/jobs/takeover`, {
    method: 'POST',
    headers: auth('reconciler', 'reconciler.repair'),
    body: JSON.stringify({ jobId: pair.jobId }),
  })));
  const statuses = both.map((response) => response.status).sort();
  assert.deepEqual(statuses, [201, 409]);
  await restartWorker();
  const pairDone = await poll(tokenA, pair.jobId);
  assert.equal(pairDone.status, 'succeeded', JSON.stringify(pairDone));
  const pairCounts = await migrator.query(
    `SELECT
       (SELECT COUNT(*)::int FROM zhixue.job_admissions WHERE job_id = $1) AS admissions,
       (SELECT COUNT(*)::int FROM zhixue.model_invocations WHERE job_id = $1) AS invocations,
       (SELECT COUNT(*)::int FROM zhixue.grade_proposals WHERE job_id = $1) AS proposals`,
    [pair.jobId],
  );
  assert.equal(pairCounts.rows[0].admissions, 1);
  assert.equal(pairCounts.rows[0].invocations, 1);
  assert.equal(pairCounts.rows[0].proposals, 1);
  assert.equal(inferCount(pair.jobId), 1);
  records.push({ name: 'dual_takeover', statuses, proposals: 1 });

  const ackJob = await billable({ 'x-test-kill': 'after-claim' });
  await exited(workerChild());
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const ackCrash = await fetch(`${API}/internal/jobs/takeover`, {
    method: 'POST',
    headers: { ...auth('reconciler', 'reconciler.repair'), 'x-test-crash': 'before-ack' },
    body: JSON.stringify({ jobId: ackJob.jobId }),
  });
  assert.equal(ackCrash.status, 500);
  const beforeReconcile = await migrator.query(
    `SELECT d.state, d.dispatch_id, d.bull_job_id
     FROM zhixue.delivery_intents d
     JOIN zhixue.processing_jobs j ON j.current_attempt_id = d.attempt_id
     WHERE j.id = $1`,
    [ackJob.jobId],
  );
  assert.equal(beforeReconcile.rows[0].state, 'dispatched');
  const reconciles = await Promise.all([0, 1].map(() => fetch(`${API}/internal/reconcile`, {
    method: 'POST', headers: auth('reconciler', 'reconciler.repair'),
  })));
  assert.ok(reconciles.every((response) => response.status === 200 || response.status === 201));
  const afterReconcile = await migrator.query(
    `SELECT d.state, d.dispatch_id, d.bull_job_id
     FROM zhixue.delivery_intents d
     JOIN zhixue.processing_jobs j ON j.current_attempt_id = d.attempt_id
     WHERE j.id = $1`,
    [ackJob.jobId],
  );
  assert.equal(afterReconcile.rows[0].state, 'acked');
  assert.equal(afterReconcile.rows[0].dispatch_id, beforeReconcile.rows[0].dispatch_id);
  assert.equal(afterReconcile.rows[0].bull_job_id, beforeReconcile.rows[0].bull_job_id);
  await restartWorker();
  const ackDone = await poll(tokenA, ackJob.jobId);
  assert.equal(ackDone.status, 'succeeded', JSON.stringify(ackDone));
  assert.equal(inferCount(ackJob.jobId), 1);
  records.push({ name: 'ack_interrupt', state: afterReconcile.rows[0].state, calls: 1 });
  startSupervisor();

  const stray = `${fileRoot}/orphan-${randomUUID()}.bin`;
  writeFileSync(stray, Buffer.from('orphan'));
  const sweepA = fetch(`${API}/internal/orphans/sweep`, { method: 'POST', headers: auth('reconciler', 'reconciler.repair') });
  const sweepB = fetch(`${API}/internal/orphans/sweep`, { method: 'POST', headers: auth('reconciler', 'reconciler.repair') });
  await Promise.all([sweepA, sweepB]);
  assert.equal(existsSync(stray), false);
  records.push({ name: 'two_sweepers', removed: true });

  if (!String(process.env.PGDATABASE).startsWith('zhixue_m0_g1')) throw new Error('sweep trigger refused');
  await migrator.query('SET ROLE zhixue_owner');
  await migrator.query(`
    CREATE OR REPLACE FUNCTION zhixue_ctl.pause_finalize_test() RETURNS trigger
    LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NEW.state = 'finalized' AND OLD.state = 'committing' THEN
        PERFORM pg_catalog.pg_sleep(3);
      END IF;
      RETURN NEW;
    END
    $fn$`);
  await migrator.query('DROP TRIGGER IF EXISTS pause_finalize_test ON zhixue.upload_sessions');
  await migrator.query(`CREATE TRIGGER pause_finalize_test BEFORE UPDATE ON zhixue.upload_sessions
    FOR EACH ROW EXECUTE FUNCTION zhixue_ctl.pause_finalize_test()`);
  await migrator.query('RESET ROLE');
  try {
    const raced = finalize(tokenA, `race-${randomUUID()}`, {
      'x-test-upload-lease': '1',
      'x-test-tenant-cap': '400',
      'x-test-global-cap': '400',
    }, pdf('race-final'));
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await fetch(`${API}/internal/orphans/sweep`, { method: 'POST', headers: auth('reconciler', 'reconciler.repair') });
    const racedBody = await raced;
    assert.equal(racedBody.status, 200, JSON.stringify(racedBody.body));
    const racedAsset = await migrator.query(
      `SELECT a.id, a.sha256, a.storage_key FROM zhixue.source_assets a
       JOIN zhixue.submissions s ON s.asset_id = a.id WHERE s.id = $1`,
      [racedBody.body.submissionId],
    );
    assert.equal(existsSync(`${fileRoot}/${racedAsset.rows[0].storage_key}`), true);
    const racedDownload = await fetch(`${API}/api/assets/${racedAsset.rows[0].id}/content`, { headers: { authorization: `Bearer ${tokenA}` } });
    const racedBytes = Buffer.from(await racedDownload.arrayBuffer());
    assert.equal(sha256(racedBytes), racedAsset.rows[0].sha256);
    records.push({ name: 'sweep_finalize_race', kept: true });
  } finally {
    await migrator.query('SET ROLE zhixue_owner');
    await migrator.query('DROP TRIGGER IF EXISTS pause_finalize_test ON zhixue.upload_sessions');
    await migrator.query('DROP FUNCTION IF EXISTS zhixue_ctl.pause_finalize_test()');
    await migrator.query('RESET ROLE');
  }

  const batch = [];
  for (let index = 0; index < 300; index += 1) {
    const fault = index % 60 === 0;
    batch.push(finalize(
      tokenA,
      `batch-${index}-${randomUUID()}`,
      { 'x-test-tenant-cap': '400', 'x-test-global-cap': '400' },
      pdf(fault ? 'SYNTHETIC_PROVIDER_FAULT' : `ok-${index}`),
    ).then((result) => ({ index, fault, ...result })));
    if (batch.length % 25 === 0) await Promise.all(batch.slice(-25));
  }
  const created = await Promise.all(batch);
  assert.equal(created.filter((row) => row.status === 200).length, 300);
  const terminals = await Promise.all(created.map(async (row) => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const response = await fetch(`${API}/api/jobs/${row.body.jobId}`, { headers: { authorization: `Bearer ${tokenA}` } });
      const job = await response.json();
      if (['succeeded', 'failed_final', 'exception_review', 'awaiting_settlement', 'cancelled'].includes(job.status)) {
        return { fault: row.fault, job };
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`batch job ${row.body.jobId} did not finish`);
  }));
  const failed = terminals.filter((row) => row.job.status === 'failed_final');
  const succeeded = terminals.filter((row) => row.job.status === 'succeeded');
  assert.equal(failed.length, 5, JSON.stringify(failed.map((row) => row.job.status)));
  assert.equal(succeeded.length, 295);
  assert.ok(failed.every((row) => row.fault));
  const rerun = [];
  for (const row of failed) {
    const again = await finalize(tokenA, `rerun-${randomUUID()}`, {
      'x-test-tenant-cap': '400',
      'x-test-global-cap': '400',
    }, pdf('rerun-ok'));
    assert.equal(again.status, 200, JSON.stringify(again.body));
    rerun.push(await poll(tokenA, again.body.jobId));
  }
  assert.equal(rerun.length, 5);
  assert.ok(rerun.every((job) => job.status === 'succeeded'));
  records.push({ name: 'batch_300', failed: failed.length, succeeded: succeeded.length, rerun: rerun.length });


  records.push({ name: 'v4_flows', done: true });
}
