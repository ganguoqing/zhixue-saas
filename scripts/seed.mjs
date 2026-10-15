import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import pg from 'pg';
import { hashPassword, loadDevEnv, roleUrl, sha256 } from './lib.mjs';

loadDevEnv();
const { Client } = pg;
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const teacherA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10';
const teacherB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb10';
const ops = 'cccccccc-cccc-4ccc-8ccc-cccccccccc10';
const membershipA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11';
const membershipB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb11';
const submissionA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const submissionB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const assetA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const assetB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const paperVersion = '018f0a3e-7c21-7b2a-8c11-999999999999';
const questionId = '018f0a3e-7c21-7b2a-8c11-111111111111';
const bytes = Buffer.from('%PDF-1.4\nsynthetic-page\n');
const passwordHash = hashPassword('dev-password');

function writeObject(tenantId, assetId) {
  const storageKey = `${tenantId}/${assetId}`;
  const full = join(process.env.FILE_ROOT, storageKey);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, bytes);
  return storageKey;
}

const client = new Client({ connectionString: roleUrl('zhixue_migrator', 'ZHIXUE_MIGRATOR_PASSWORD') });
await client.connect();
try {
  await client.query('BEGIN');
  await client.query(
    `INSERT INTO zhixue.tenants (id, name) VALUES ($1, 'synthetic-school-a'), ($2, 'synthetic-school-b')`,
    [A, B],
  );
  await client.query(
    `INSERT INTO zhixue.tenant_execution_occupancy (tenant_id, occupied) VALUES ($1, 0), ($2, 0)`,
    [A, B],
  );
  await client.query(
    `INSERT INTO zhixue.users (id, email, password_hash, display_name, kind) VALUES
      ($1, 'synthetic-teacher-a@example.test', $4, 'synthetic-teacher-a', 'member'),
      ($2, 'synthetic-teacher-b@example.test', $4, 'synthetic-teacher-b', 'member'),
      ($3, 'synthetic-ops@example.test', $4, 'synthetic-ops', 'platform')`,
    [teacherA, teacherB, ops, passwordHash],
  );
  await client.query(
    `INSERT INTO zhixue.memberships (id, tenant_id, user_id) VALUES ($1, $2, $3), ($4, $5, $6)`,
    [membershipA, A, teacherA, membershipB, B, teacherB],
  );
  await client.query(
    `INSERT INTO zhixue.data_scope_grants (id, tenant_id, membership_id, class_id, subject_id, action)
     SELECT gen_random_uuid(), tenant_id, membership_id, class_id, subject_id, action
     FROM (VALUES
       ($1::uuid, $2::uuid, 'c1', 'math'),
       ($3::uuid, $4::uuid, 'c1', 'math')
     ) AS members(tenant_id, membership_id, class_id, subject_id)
     CROSS JOIN (VALUES ('read'), ('finalize'), ('cancel'), ('manual')) AS actions(action)`,
    [A, membershipA, B, membershipB],
  );
  const keyA = writeObject(A, assetA);
  const keyB = writeObject(B, assetB);
  const digest = sha256(bytes);
  await client.query(
    `INSERT INTO zhixue.source_assets (tenant_id, id, sha256, byte_size, storage_key, media_type, status) VALUES
      ($1, $2, $3, $4, $5, 'application/pdf', 'final'),
      ($6, $7, $3, $4, $8, 'application/pdf', 'final')`,
    [A, assetA, digest, bytes.length, keyA, B, assetB, keyB],
  );
  await client.query(
    `INSERT INTO zhixue.submissions
      (tenant_id, id, class_id, subject_id, status, asset_id, correlation_id) VALUES
      ($1, $2, 'c2', 'math', 'seeded', $3, $2),
      ($4, $5, 'c1', 'math', 'seeded', $6, $5)`,
    [A, submissionA, assetA, B, submissionB, assetB],
  );
  await client.query(
    `INSERT INTO zhixue.paper_questions (tenant_id, paper_version_id, id) VALUES ($1, $2, $3), ($1, $2, $4)`,
    [A, paperVersion, questionId, '018f0a3e-7c21-7b2a-8c11-111111111112'],
  );
  await client.query(
    `INSERT INTO zhixue.rubric_points (tenant_id, paper_version_id, question_id, criterion_id, max_points)
     VALUES ($1, $2, $3, $5, 1.00), ($1, $2, $4, $5, 1.00)`,
    [A, paperVersion, questionId, '018f0a3e-7c21-7b2a-8c11-111111111112', '018f0a3e-7c21-7b2a-8c11-222222222222'],
  );
  await client.query(
    `INSERT INTO zhixue.invocation_budgets (tenant_id, remaining) VALUES ($1, 1000), ($2, 1000)`,
    [A, B],
  );
  const jobOk = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
  const attemptOk = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
  const invocationOk = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5';
  const jobUnknown = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6';
  const attemptUnknown = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7';
  const invocationUnknown = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8';
  await client.query(
    `INSERT INTO zhixue.processing_jobs (
      tenant_id, id, submission_id, stage, status, result_status, current_attempt_id,
      current_fencing_epoch, claimed_at, input_generation, input_hash, logical_key, billable
    ) VALUES
      ($1, $2, $3, 'validate_asset', 'succeeded', 'accepted', $4, 1, now(), 1, $5, 'seed-confirmed', false),
      ($1, $6, $3, 'validate_asset', 'exception_review', 'missing_result', $7, 1, now(), 1, $5, 'seed-unknown', true)`,
    [A, jobOk, submissionA, attemptOk, digest, jobUnknown, attemptUnknown],
  );
  await client.query(
    `INSERT INTO zhixue.execution_attempts
      (tenant_id, id, job_id, fencing_epoch, lease_token_hash, lease_until) VALUES
      ($1, $2, $3, 1, $4, now()),
      ($1, $5, $6, 1, $4, now())`,
    [A, attemptOk, jobOk, digest, attemptUnknown, jobUnknown],
  );
  await client.query(
    `INSERT INTO zhixue.model_invocations
      (tenant_id, id, job_id, attempt_id, send_state, cost_status, amount, include_in_total, input_hash) VALUES
      ($1, $2, $3, $4, 'observed', 'confirmed', 1.50, true, $5),
      ($1, $6, $7, $8, 'send_unknown', 'unknown', NULL, false, $5)`,
    [A, invocationOk, jobOk, attemptOk, digest, invocationUnknown, jobUnknown, attemptUnknown],
  );
  await client.query(
    `INSERT INTO zhixue.usage_ledger_entries
      (tenant_id, id, invocation_id, settlement_kind, settlement_key, body_hash, amount_delta, include_in_total) VALUES
      ($1, $2, $3, 'confirmed', 'seed', $4, 1.50, true),
      ($1, $5, $6, 'unknown_marker', 'seed', $4, NULL, false)`,
    [A, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9', invocationOk, digest, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa19', invocationUnknown],
  );
  await client.query('COMMIT');
  console.log('seed complete');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
