import { spawn } from 'node:child_process';
import { mkdirSync, createWriteStream } from 'node:fs';
import pg from 'pg';
import Redis from 'ioredis';
import { loadDevEnv, roleUrl } from './lib.mjs';

process.env.PGHOST = '127.0.0.1';
process.env.PGPORT = '5432';
process.env.PGDATABASE = 'zhixue_m0_g1v2';
process.env.REDIS_HOST = '127.0.0.1';
process.env.REDIS_PORT = '6379';
process.env.REDIS_DB = '2';
process.env.QUEUE_PREFIX = 'zhixue-g1v2';
process.env.FILE_ROOT = 'var/g1-objects';
process.env.LOG_PATH = 'var/g1-logs/api.log';
process.env.API_PORT = '3410';
process.env.INFERENCE_PORT = '3411';
process.env.INFERENCE_URL = 'http://127.0.0.1:3411';
process.env.SWEEP_MIN_AGE_SECONDS = '0';
process.env.UPLOAD_LEASE_SECONDS = '60';
process.env.UNKNOWN_ESCALATE_AFTER_SECONDS = '1';
process.env.EXECUTION_LEASE_SECONDS = '2';
loadDevEnv();

if (process.env.PGDATABASE === 'zhixue_m0' || process.env.REDIS_DB === '0') {
  throw new Error('refusing to point the G1 run at the shared database or Redis DB 0');
}

mkdirSync('var/g1-logs', { recursive: true });
mkdirSync('var/g1-objects', { recursive: true });

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env: process.env });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
  });
}

const log = createWriteStream('var/g1-logs/commands.log', { flags: 'a' });
log.write(`\n# start ${new Date().toISOString()}\n`);
log.end();

const admin = new pg.Client({
  connectionString: roleUrl('zhixue_bootstrap', 'BOOTSTRAP_PASSWORD').replace('/zhixue_m0_g1v2', '/postgres'),
});
await admin.connect();
const existing = await admin.query(`SELECT 1 FROM pg_database WHERE datname = 'zhixue_m0_g1v2'`);
if (existing.rowCount === 0) await admin.query('CREATE DATABASE zhixue_m0_g1v2');
await admin.end();

await run('node', ['scripts/migrate.mjs', '--reset']);
await run('node', ['scripts/seed.mjs']);
const redis = new Redis({ host: '127.0.0.1', port: 6379, db: 2, maxRetriesPerRequest: null });
const keys = await redis.keys('zhixue-g1v2:*');
if (keys.length > 0) await redis.del(keys);
await redis.quit();

await run('npm', ['run', 'build', '-w', '@zhixue/api']);
await run(process.execPath, ['--test', '--test-concurrency=1', '--test-timeout=300000', 'tests/m0/g1.integration.test.mjs']);
