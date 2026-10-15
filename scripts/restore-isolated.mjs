import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { loadDevEnv, roleUrl } from './lib.mjs';

loadDevEnv();
process.env.ZHIXUE_PRESERVE_ROLE_PASSWORDS = '1';

const allowedError = 'must be owner of extension pgcrypto';

export function classifyRestore(log, exitCode) {
  const errors = [...log.matchAll(/^pg_restore: error:.*$/gm)].map((match) => match[0]);
  const allowed = (log.match(/must be owner of extension pgcrypto/g) || []).length;
  const commentCommands = (log.match(/COMMENT ON EXTENSION pgcrypto/g) || []).length;
  const ignored = log.match(/errors ignored on restore: (\d+)/);
  const ignoredCount = ignored ? Number(ignored[1]) : 0;
  const disallowed = errors.filter((line) => !line.includes(allowedError) && !line.includes('errors ignored on restore'));
  if (disallowed.length > 0 || allowed !== commentCommands || (ignored && ignoredCount !== allowed)) {
    const error = new Error(`restore rejected: disallowed=${disallowed.length} allowed=${allowed} ignored=${ignoredCount}`);
    error.log = log;
    throw error;
  }
  if (exitCode !== 0 && allowed === 0) {
    const error = new Error(`pg_restore exited ${exitCode}`);
    error.log = log;
    throw error;
  }
  return { allowed, exitCode };
}

function adminUrl(databaseName) {
  return roleUrl('zhixue_bootstrap', 'BOOTSTRAP_PASSWORD').replace(`/${process.env.PGDATABASE}`, `/${databaseName}`);
}

function runRestore(database, dumpPath) {
  return new Promise((resolve) => {
    const child = spawn('pg_restore', [
      '--no-password',
      '-d', adminUrl(database),
      dumpPath,
    ], { env: process.env });
    let log = '';
    child.stdout.on('data', (chunk) => { log += chunk; });
    child.stderr.on('data', (chunk) => { log += chunk; });
    child.on('exit', (code) => resolve({ code: code ?? 1, log }));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dumpPath = process.argv[2];
  const database = process.argv[3];
  const logPath = process.argv[4];
  if (!dumpPath || !/^[a-z0-9_]+$/.test(database || '') || !database.startsWith('zhixue_m0_g1')) {
    throw new Error('usage: node scripts/restore-isolated.mjs <dump> <zhixue_m0_g1_database> [log]');
  }
  const admin = new pg.Client({ connectionString: adminUrl('postgres') });
  await admin.connect();
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE ${database}`);
  await admin.end();
  const setup = new pg.Client({ connectionString: adminUrl(database) });
  await setup.connect();
  await setup.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await setup.query('GRANT CREATE ON DATABASE ' + database + ' TO zhixue_migrator');
  await setup.end();
  const restored = await runRestore(database, dumpPath);
  if (logPath) {
    mkdirSync(logPath.slice(0, logPath.lastIndexOf('/')), { recursive: true });
    writeFileSync(logPath, restored.log);
  } else {
    process.stderr.write(restored.log);
  }
  classifyRestore(restored.log, restored.code);
  console.log(`restore accepted database=${database} exit=${restored.code}`);
}
