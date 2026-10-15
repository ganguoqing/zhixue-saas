import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import pg from 'pg';
import Redis from 'ioredis';
import { loadDevEnv, roleUrl } from './lib.mjs';

const profile = process.env.ZHIXUE_PROFILE || 'local';
const runId = `${Date.now()}`;
const runDir = `var/runs/${runId}`;
mkdirSync(runDir, { recursive: true });
const started = new Date().toISOString();

if (profile === 'compose') {
  process.env.PGPORT = '54329';
  process.env.PGDATABASE = 'zhixue_m0_g1compose';
  process.env.REDIS_PORT = '63799';
  process.env.REDIS_DB = '0';
} else {
  process.env.PGPORT = process.env.PGPORT || '5432';
  process.env.PGDATABASE = 'zhixue_m0_g1v3';
  process.env.REDIS_PORT = process.env.REDIS_PORT || '6379';
  process.env.REDIS_DB = '2';
}
process.env.PGHOST = '127.0.0.1';
process.env.REDIS_HOST = '127.0.0.1';
process.env.QUEUE_PREFIX = `zhixue-g1-${runId}`;
process.env.FILE_ROOT = `${runDir}/objects`;
process.env.LOG_PATH = `${runDir}/api.log`;
process.env.ZHIXUE_RUN_DIR = runDir;
process.env.API_PORT = process.env.API_PORT || '3410';
process.env.INFERENCE_PORT = process.env.INFERENCE_PORT || '3411';
process.env.INFERENCE_URL = `http://127.0.0.1:${process.env.INFERENCE_PORT}`;
process.env.INFERENCE_COUNT_PATH = `${runDir}/infer-count.txt`;
process.env.SWEEP_MIN_AGE_SECONDS = '0';
process.env.UPLOAD_LEASE_SECONDS = '60';
process.env.UNKNOWN_ESCALATE_AFTER_SECONDS = '1';
process.env.EXECUTION_LEASE_SECONDS = '2';
process.env.ZHIXUE_PRESERVE_ROLE_PASSWORDS = '1';
loadDevEnv();
if (profile === 'local') process.env.PGDATABASE = 'zhixue_m0_g1v3';

if (!String(process.env.PGDATABASE).startsWith('zhixue_m0_g1')) {
  throw new Error(`refusing isolated run on ${process.env.PGDATABASE}`);
}
mkdirSync(process.env.FILE_ROOT, { recursive: true });

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: process.env });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; process.stdout.write(chunk); });
    child.stderr.on('data', (chunk) => { output += chunk; process.stderr.write(chunk); });
    child.on('exit', (code) => {
      writeFileSync(`${runDir}/${args[args.length - 1].replace(/[^\w.]+/g, '_')}.log`, output);
      if (code === 0) resolve(code);
      else reject(new Error(`${command} ${args.join(' ')} exited ${code}`));
    });
  });
}

const head = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
const diff = execSync('git diff --stat', { encoding: 'utf8' });
writeFileSync(`${runDir}/git.txt`, `HEAD ${head}\n${diff}`);
writeFileSync(`${runDir}/command.txt`, `node scripts/run-isolated.mjs\nprofile=${profile}\nstarted=${started}\n`);

let exitCode = 0;
try {
  if (profile === 'compose') {
    await run('docker', ['compose', 'up', '-d', '--wait']);
  }
  const adminUrl = roleUrl('zhixue_bootstrap', 'BOOTSTRAP_PASSWORD').replace(`/${process.env.PGDATABASE}`, '/postgres');
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [process.env.PGDATABASE]);
  if (existing.rowCount === 0) await admin.query(`CREATE DATABASE ${process.env.PGDATABASE}`);
  await admin.end();
  await run('node', ['scripts/migrate.mjs', '--reset']);
  await run('node', ['scripts/seed.mjs']);
  await run('npm', ['run', 'build', '-w', '@zhixue/api']);
  const redis = new Redis({
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
    db: Number(process.env.REDIS_DB),
    maxRetriesPerRequest: null,
  });
  if (profile === 'local') {
    const keys = await redis.keys(`${process.env.QUEUE_PREFIX}:*`);
    if (keys.length > 0) await redis.del(keys);
  }
  await redis.quit();
  await run(process.execPath, [
    '--test', '--test-concurrency=1', '--test-timeout=600000',
    'tests/m0/g1.integration.test.mjs',
    'tests/m0/g1-v5-restore.test.mjs',
  ]);
} catch (error) {
  exitCode = 1;
  writeFileSync(`${runDir}/error.txt`, String(error));
}
const ended = new Date().toISOString();
writeFileSync(`${runDir}/command.txt`, `node scripts/run-isolated.mjs\nprofile=${profile}\nstarted=${started}\nended=${ended}\nexit=${exitCode}\n`, { flag: 'w' });
const hash = createHash('sha256').update(readFileSync('package-lock.json')).digest('hex');
writeFileSync(`${runDir}/lock.sha256`, `${hash}\n`);
process.exit(exitCode);
