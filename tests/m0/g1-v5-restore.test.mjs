import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, openSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { loadDevEnv, roleUrl } from '../../scripts/lib.mjs';
import { classifyRestore } from '../../scripts/restore-isolated.mjs';

loadDevEnv();
process.env.ZHIXUE_PRESERVE_ROLE_PASSWORDS = '1';

function adminUrl(database) {
  return roleUrl('zhixue_bootstrap', 'BOOTSTRAP_PASSWORD').replace(`/${process.env.PGDATABASE}`, `/${database}`);
}

function migratorUrl(database) {
  return roleUrl('zhixue_migrator', 'ZHIXUE_MIGRATOR_PASSWORD').replace(process.env.PGDATABASE, database);
}

function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited ${code}`))));
  });
}

async function createDatabase(name) {
  const admin = new pg.Client({ connectionString: adminUrl('postgres') });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.query(`GRANT CREATE ON DATABASE ${name} TO zhixue_migrator`);
  await admin.end();
  const setup = new pg.Client({ connectionString: adminUrl(name) });
  await setup.connect();
  await setup.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await setup.end();
}

async function migrate(database, only) {
  const args = ['scripts/migrate.mjs', '--database', database];
  if (only) args.push('--only', only);
  await run(process.execPath, args, { ...process.env, PGDATABASE: database, ZHIXUE_PRESERVE_ROLE_PASSWORDS: '1' });
}

async function insertSynthetic(database) {
  const tenant = '33333333-3333-4333-8333-333333333333';
  const asset = randomUUID();
  const submission = randomUUID();
  const job = randomUUID();
  const digest = createHash('sha256').update(`synthetic-${asset}`).digest('hex');
  const client = new pg.Client({ connectionString: migratorUrl(database) });
  await client.connect();
  await client.query(`INSERT INTO zhixue.tenants (id, name) VALUES ($1, 'synthetic-upgrade')`, [tenant]);
  await client.query(`INSERT INTO zhixue.tenant_execution_occupancy (tenant_id, occupied) VALUES ($1, 0)`, [tenant]);
  await client.query(
    `INSERT INTO zhixue.source_assets (tenant_id, id, sha256, byte_size, storage_key, media_type, status)
     VALUES ($1, $2, $3, 4, $4, 'application/pdf', 'final')`,
    [tenant, asset, digest, `${tenant}/${asset}`],
  );
  await client.query(
    `INSERT INTO zhixue.submissions (tenant_id, id, class_id, subject_id, status, asset_id, correlation_id)
     VALUES ($1, $2, 'c1', 'math', 'awaiting_validation', $3, $4)`,
    [tenant, submission, asset, randomUUID()],
  );
  await client.query(
    `INSERT INTO zhixue.processing_jobs (
       tenant_id, id, submission_id, stage, status, result_status, input_generation, input_hash, logical_key
     ) VALUES ($1, $2, $3, 'validate_asset', 'queued', 'pending', 1, $4, 'upgrade-job')`,
    [tenant, job, submission, digest],
  );
  await client.end();
  return { tenant, asset, submission, job, digest };
}

async function readMarker(database, asset) {
  const client = new pg.Client({ connectionString: migratorUrl(database) });
  await client.connect();
  const row = await client.query(
    `SELECT a.sha256, j.status, j.result_status,
            (SELECT count(*)::int FROM zhixue.source_assets) AS assets,
            (SELECT count(*)::int FROM zhixue.processing_jobs) AS jobs
     FROM zhixue.source_assets a
     JOIN zhixue.processing_jobs j ON j.tenant_id = a.tenant_id
     WHERE a.id = $1`,
    [asset],
  );
  await client.end();
  return row.rows[0];
}

test('restore classifier rejects a non-comment error', () => {
  assert.throws(() => classifyRestore(
    'pg_restore: error: could not execute query: ERROR:  permission denied for schema zhixue\npg_restore: warning: errors ignored on restore: 1\n',
    1,
  ));
  const allowed = classifyRestore(
    'pg_restore: error: could not execute query: ERROR:  must be owner of extension pgcrypto\nCommand was: COMMENT ON EXTENSION pgcrypto IS \'cryptographic functions\';\npg_restore: warning: errors ignored on restore: 1\n',
    1,
  );
  assert.equal(allowed.allowed, 1);
});

test('0004 data upgrades in place and restores with original migrations', async () => {
  const upgradeDb = 'zhixue_m0_g1v5up';
  const sourceDb = 'zhixue_m0_g1v5src';
  const restoreDb = 'zhixue_m0_g1v5re';
  const badDb = 'zhixue_m0_g1v5bad';
  const dump = join(mkdtempSync(join(tmpdir(), 'zhixue-restore-')), 'source.dump');
  try {
    await createDatabase(upgradeDb);
    for (const version of ['0001', '0002', '0003', '0004']) await migrate(upgradeDb, version);
    const marker = await insertSynthetic(upgradeDb);
    for (const version of ['0005', '0006', '0007']) await migrate(upgradeDb, version);
    const upgraded = await readMarker(upgradeDb, marker.asset);
    assert.equal(upgraded.sha256, marker.digest);
    assert.equal(upgraded.assets, 1);
    assert.equal(upgraded.jobs, 1);
    const upgradedFlags = new pg.Client({ connectionString: migratorUrl(upgradeDb) });
    await upgradedFlags.connect();
    const flags = await upgradedFlags.query(
      `SELECT c.relrowsecurity, c.relforcerowsecurity FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'zhixue' AND c.relname = 'delivery_intents'`,
    );
    assert.equal(flags.rows[0].relrowsecurity, true);
    assert.equal(flags.rows[0].relforcerowsecurity, true);
    await upgradedFlags.end();

    await createDatabase(badDb);
    for (const version of ['0001', '0002', '0003', '0004', '0005', '0006']) await migrate(badDb, version);
    const bad = new pg.Client({ connectionString: migratorUrl(badDb) });
    await bad.connect();
    try {
    const tenant = '33333333-3333-4333-8333-333333333334';
    const asset = randomUUID();
    const submission = randomUUID();
    const job = randomUUID();
    const attempt = randomUUID();
    await bad.query(`INSERT INTO zhixue.tenants (id, name) VALUES ($1, 'synthetic-bad')`, [tenant]);
    await bad.query(
      `INSERT INTO zhixue.source_assets (tenant_id, id, sha256, byte_size, storage_key, media_type, status)
       VALUES ($1, $2, $3, 4, $4, 'application/pdf', 'final')`,
      [tenant, asset, 'ab'.repeat(32), `${tenant}/${asset}`],
    );
    await bad.query(
      `INSERT INTO zhixue.submissions (tenant_id, id, class_id, subject_id, status, asset_id, correlation_id)
       VALUES ($1, $2, 'c1', 'math', 'awaiting_validation', $3, $4)`,
      [tenant, submission, asset, randomUUID()],
    );
    await bad.query('BEGIN');
    await bad.query(
      `INSERT INTO zhixue.processing_jobs (
         tenant_id, id, submission_id, stage, status, result_status, input_generation, input_hash, logical_key
       ) VALUES ($1, $2, $3, 'validate_asset', 'queued', 'pending', 1, $4, 'bad-job')`,
      [tenant, job, submission, 'cd'.repeat(32)],
    );
    await bad.query(
      `INSERT INTO zhixue.execution_attempts (tenant_id, id, job_id, fencing_epoch, lease_token_hash, lease_until)
       VALUES ($1, $2, $3, 1, 'hash', clock_timestamp())`,
      [tenant, attempt, job],
    );
    await bad.query(
      `UPDATE zhixue.processing_jobs
       SET status = 'running', claimed_at = clock_timestamp(), current_attempt_id = $2, current_fencing_epoch = 1
       WHERE id = $1`,
      [job, attempt],
    );
    await bad.query(
      `INSERT INTO zhixue.delivery_intents (
         tenant_id, id, job_id, attempt_id, fencing_epoch, stage, billable, lease_token, generation, input_hash, state
       ) VALUES ($1, $2, $3, $4, 1, 'validate_asset', false, 'keep-me', 0, $5, 'executing')`,
      [tenant, randomUUID(), job, attempt, 'cd'.repeat(32)],
    );
    await bad.query('COMMIT');
    } finally {
      await bad.end().catch(() => undefined);
    }
    await assert.rejects(migrate(badDb, '0007'));
    const still = new pg.Client({ connectionString: migratorUrl(badDb) });
    await still.connect();
    const kept = await still.query('SELECT count(*)::int AS n FROM zhixue.delivery_intents WHERE lease_token = $1', ['keep-me']);
    assert.equal(kept.rows[0].n, 1);
    await still.end();

    await createDatabase(sourceDb);
    for (const version of ['0001', '0002', '0003', '0004']) await migrate(sourceDb, version);
    const source = await insertSynthetic(sourceDb);
    await run('pg_dump', ['-Fc', '-f', dump, migratorUrl(sourceDb)]);
    await assert.rejects(run(process.execPath, ['scripts/restore-isolated.mjs', dump + '.missing', 'zhixue_m0_g1v5miss', `${process.env.ZHIXUE_RUN_DIR}/bad-restore.log`]));
    await run(process.execPath, ['scripts/restore-isolated.mjs', dump, restoreDb, `${process.env.ZHIXUE_RUN_DIR}/restore.log`]);
    for (const version of ['0005', '0006', '0007']) await migrate(restoreDb, version);
    const restored = await readMarker(restoreDb, source.asset);
    assert.equal(restored.sha256, source.digest);
    assert.equal(restored.assets, 1);
    assert.equal(restored.jobs, 1);
    const check = new pg.Client({ connectionString: migratorUrl(restoreDb) });
    await check.connect();
    const catalog = await check.query(
      `SELECT c.relname, r.rolname AS owner, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_roles r ON r.oid = c.relowner
       WHERE n.nspname = 'zhixue' AND c.relname IN ('delivery_intents', 'source_assets', 'processing_jobs')
       ORDER BY c.relname`,
    );
    assert.ok(catalog.rows.every((row) => row.owner === 'zhixue_owner'));
    const delivery = catalog.rows.find((row) => row.relname === 'delivery_intents');
    assert.equal(delivery.relrowsecurity, true);
    assert.equal(delivery.relforcerowsecurity, true);
    const functions = await check.query(
      `SELECT p.proname, r.rolname AS owner, r.rolbypassrls
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       JOIN pg_roles r ON r.oid = p.proowner
       WHERE n.nspname = 'zhixue_ctl' AND p.prosecdef`,
    );
    assert.ok(functions.rows.every((row) => row.owner !== 'zhixue_migrator' && row.rolbypassrls === false));
    for (const name of ['object_is_live', 'list_unknown_running', 'list_past_deadline', 'list_open_deliveries']) {
      const row = functions.rows.find((item) => item.proname === name);
      assert.equal(row.owner, 'zhixue_owner', name);
    }
    const versions = await check.query('SELECT version FROM zhixue_ctl.schema_migrations ORDER BY version');
    assert.deepEqual(versions.rows.map((row) => row.version), ['0001', '0002', '0003', '0004', '0005', '0006', '0007']);
    const ingress = new pg.Client({ connectionString: roleUrl('zhixue_ai_ingress', 'ZHIXUE_INGRESS_PASSWORD').replace(process.env.PGDATABASE, restoreDb) });
    await ingress.connect();
    await ingress.query('BEGIN');
    await ingress.query(`SELECT set_config('app.tenant_id', '', true)`);
    const hidden = await ingress.query('SELECT count(*)::int AS n FROM zhixue.submissions');
    await ingress.query('ROLLBACK');
    assert.equal(hidden.rows[0].n, 0);
    await ingress.end();
    await check.end();
    await run(process.execPath, ['scripts/seed.mjs'], { ...process.env, PGDATABASE: restoreDb, ZHIXUE_PRESERVE_ROLE_PASSWORDS: '1' });
    const chainEnv = {
      ...process.env,
      PGDATABASE: restoreDb,
      API_PORT: '3412',
      INFERENCE_PORT: '3413',
      INFERENCE_URL: 'http://127.0.0.1:3413',
      QUEUE_PREFIX: `zhixue-g1-restore-${Date.now()}`,
      FILE_ROOT: `${process.env.ZHIXUE_RUN_DIR}/restore-objects`,
      LOG_PATH: `${process.env.ZHIXUE_RUN_DIR}/restore-api.log`,
      ZHIXUE_PRESERVE_ROLE_PASSWORDS: '1',
    };
    mkdirSync(chainEnv.FILE_ROOT, { recursive: true });
    const api = spawn(process.execPath, ['apps/api/dist/main.js'], {
      env: chainEnv,
      stdio: ['ignore', 'ignore', openSync(`${process.env.ZHIXUE_RUN_DIR}/restore-api.err`, 'w')],
    });
    const inference = spawn('.venv/bin/python', ['-m', 'uvicorn', 'apps.inference.main:app', '--host', '127.0.0.1', '--port', '3413'], { env: chainEnv, stdio: 'ignore' });
    const workerEnv = {
      PATH: chainEnv.PATH, HOME: chainEnv.HOME, LANG: chainEnv.LANG || 'C', TMPDIR: chainEnv.TMPDIR || '/tmp',
      WORKER_JWT_SECRET: chainEnv.WORKER_JWT_SECRET,
      REDIS_HOST: chainEnv.REDIS_HOST, REDIS_PORT: chainEnv.REDIS_PORT, REDIS_DB: chainEnv.REDIS_DB,
      QUEUE_PREFIX: chainEnv.QUEUE_PREFIX, API_BASE: 'http://127.0.0.1:3412', INFERENCE_URL: chainEnv.INFERENCE_URL,
    };
    const worker = spawn('.venv/bin/python', ['apps/worker/worker.py'], { env: workerEnv, stdio: 'ignore' });
    try {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        try {
          if ((await fetch('http://127.0.0.1:3412/health')).ok && (await fetch('http://127.0.0.1:3413/health')).ok) break;
        } catch { /* starting */ }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      const login = await fetch('http://127.0.0.1:3412/api/session', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'synthetic-teacher-a@example.test', password: 'dev-password' }),
      });
      const token = (await login.json()).token;
      const created = await fetch('http://127.0.0.1:3412/internal/test/billable-job', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'idempotency-key': randomUUID(), 'x-test-delay': '0' },
      });
      const body = await created.json();
      assert.equal(created.status, 201, JSON.stringify(body));
      let graded;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const response = await fetch(`http://127.0.0.1:3412/api/jobs/${body.jobId}`, { headers: { authorization: `Bearer ${token}` } });
        graded = await response.json();
        if (graded.status === 'succeeded') break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      assert.equal(graded.status, 'succeeded', JSON.stringify(graded));
      const scores = new pg.Client({ connectionString: migratorUrl(restoreDb) });
      await scores.connect();
      const count = await scores.query('SELECT COUNT(*)::int AS n FROM zhixue.score_versions');
      const proposals = await scores.query('SELECT COUNT(*)::int AS n FROM zhixue.grade_proposals WHERE job_id = $1', [body.jobId]);
      await scores.end();
      assert.equal(count.rows[0].n, 0);
      assert.equal(proposals.rows[0].n, 1);
    } finally {
      api.kill('SIGKILL');
      inference.kill('SIGKILL');
      worker.kill('SIGKILL');
    }
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const admin = new pg.Client({ connectionString: adminUrl('postgres') });
    await admin.connect();
    for (const name of [upgradeDb, sourceDb, restoreDb, badDb, 'zhixue_m0_g1v5miss']) {
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    }
    await admin.end();
  }
});
