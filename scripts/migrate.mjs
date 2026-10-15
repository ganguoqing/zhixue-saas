import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { loadDevEnv, roleUrl } from './lib.mjs';

loadDevEnv();
const { Client } = pg;
const args = new Set(process.argv.slice(2));
const only = process.argv.includes('--only')
  ? process.argv[process.argv.indexOf('--only') + 1]
  : null;
if (process.argv.includes('--database')) {
  process.env.PGDATABASE = process.argv[process.argv.indexOf('--database') + 1];
}

function ident(name) {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`unsafe role ${name}`);
  return name;
}

async function ensureRole(client, name, attrs, password) {
  const safe = ident(name);
  const existing = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [name]);
  const passSql = password ? ` PASSWORD '${password.replaceAll("'", "''")}'` : '';
  if (existing.rowCount === 0) {
    await client.query(`CREATE ROLE ${safe} ${attrs}${passSql}`);
  } else if (password && process.env.ZHIXUE_PRESERVE_ROLE_PASSWORDS !== '1') {
    await client.query(`ALTER ROLE ${safe} ${attrs}${passSql}`);
  }
}

async function bootstrap() {
  const client = new Client({
    connectionString: roleUrl('zhixue_bootstrap', 'BOOTSTRAP_PASSWORD'),
  });
  await client.connect();
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await ensureRole(client, 'zhixue_owner', 'NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT');
    await ensureRole(client, 'zhixue_router', 'NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT');
    await ensureRole(client, 'zhixue_migrator', 'LOGIN BYPASSRLS NOSUPERUSER NOINHERIT', process.env.ZHIXUE_MIGRATOR_PASSWORD);
    const logins = [
      ['zhixue_app', 'ZHIXUE_APP_PASSWORD'],
      ['zhixue_relay', 'ZHIXUE_RELAY_PASSWORD'],
      ['zhixue_ai_ingress', 'ZHIXUE_INGRESS_PASSWORD'],
      ['zhixue_reconciler', 'ZHIXUE_RECONCILER_PASSWORD'],
      ['zhixue_scheduler', 'ZHIXUE_SCHEDULER_PASSWORD'],
      ['zhixue_platform_ops', 'ZHIXUE_PLATFORM_PASSWORD'],
    ];
    for (const [name, envName] of logins) {
      await ensureRole(client, name, 'LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT', process.env[envName]);
    }
    await client.query('GRANT zhixue_owner TO zhixue_migrator');
    await client.query('GRANT zhixue_router TO zhixue_migrator');
    await client.query(`GRANT CREATE ON DATABASE ${ident(process.env.PGDATABASE)} TO zhixue_migrator`);
    if (args.has('--reset')) {
      await client.query('DROP SCHEMA IF EXISTS zhixue CASCADE');
      await client.query('DROP SCHEMA IF EXISTS zhixue_ctl CASCADE');
    }
  } finally {
    await client.end();
  }
}

function assertResetAllowed() {
  if (!args.has('--reset')) return;
  const db = process.env.PGDATABASE || '';
  const isolated = db.startsWith('zhixue_m0_g1');
  if (!isolated && process.env.ZHIXUE_ALLOW_SHARED_RESET !== '1') {
    throw new Error(`refusing schema reset on ${db}; use an isolated zhixue_m0_g1* database`);
  }
}

async function apply() {
  const client = new Client({ connectionString: roleUrl('zhixue_migrator', 'ZHIXUE_MIGRATOR_PASSWORD') });
  await client.connect();
  try {
    const dir = 'db/migrations';
    const files = readdirSync(dir).filter((name) => name.endsWith('.sql')).sort();
    for (const file of files) {
      const version = file.slice(0, 4);
      if (only && version !== only) continue;
      const sql = readFileSync(join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(`SELECT pg_advisory_xact_lock(hashtext('zhixue_migrate'))`);
        const applied = await client.query(
          `SELECT to_regclass('zhixue_ctl.schema_migrations') AS rel`,
        );
        if (applied.rows[0].rel) {
          const row = await client.query(
            'SELECT 1 FROM zhixue_ctl.schema_migrations WHERE version = $1',
            [version],
          );
          if (row.rowCount > 0) {
            await client.query('COMMIT');
            continue;
          }
        }
        await client.query(sql);
        await client.query('INSERT INTO zhixue_ctl.schema_migrations (version) VALUES ($1)', [version]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        await client.query('RESET ROLE');
      }
      console.log(`applied ${file}`);
    }
  } finally {
    await client.end();
  }
}

assertResetAllowed();
await bootstrap();
await apply();
console.log('migrate complete');
