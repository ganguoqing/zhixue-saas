import { readFileSync } from 'node:fs';

export function applyEnvFile(file: string): void {
  const text = readFileSync(file, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 0) continue;
    const key = trimmed.slice(0, index);
    const value = trimmed.slice(index + 1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

function requiredInt(name: string, minimum: number): number {
  const raw = required(name);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}`);
  }
  return value;
}

export interface AppConfig {
  env: string;
  studentData: string;
  modelEndpoint: string;
  tenantCap: number;
  globalCap: number;
  maxAttempts: number;
  deadlineSeconds: number;
  leaseSeconds: number;
  graceSeconds: number;
  capabilityTtlSeconds: number;
  unknownEscalateAfterSeconds: number;
  autoRetryUnknown: false;
  fileMaxBytes: number;
  testHooks: boolean;
  fileRoot: string;
  logPath: string;
  apiPort: number;
  redisHost: string;
  redisPort: number;
  serviceSecret: string;
  userSecret: string;
  databaseUrl(user: string, passwordEnv: string): string;
}

export function loadConfig(): AppConfig {
  if (process.env.ENV_FILE) applyEnvFile(process.env.ENV_FILE);
  const env = required('ZHIXUE_ENV');
  const studentData = required('STUDENT_DATA');
  if (studentData !== 'forbidden') {
    throw new Error('STUDENT_DATA must stay forbidden until a separate program is approved');
  }
  const modelEndpoint = required('MODEL_ENDPOINT');
  const allow = required('MODEL_ENDPOINT_ALLOWLIST').split(',').filter(Boolean);
  if (!allow.includes(modelEndpoint)) throw new Error('MODEL_ENDPOINT is not on the allowlist');
  const tenantCap = requiredInt('EXECUTION_TENANT_CAP', 1);
  const globalCap = requiredInt('EXECUTION_GLOBAL_CAP', 1);
  const testHooks = process.env.ZHIXUE_TEST_HOOKS === '1';
  const autoRetry = required('AUTO_RETRY_UNKNOWN');
  if (autoRetry !== 'false') throw new Error('AUTO_RETRY_UNKNOWN must be false');
  if (env === 'production') {
    if (testHooks) throw new Error('test hooks are refused in production');
    if (tenantCap === 2 && globalCap === 4) {
      throw new Error('refusing M0 test caps as production caps');
    }
    if (modelEndpoint === 'mock://local') {
      throw new Error('refusing the M0 mock endpoint in production');
    }
  }
  return {
    env,
    studentData,
    modelEndpoint,
    tenantCap,
    globalCap,
    maxAttempts: requiredInt('EXECUTION_MAX_ATTEMPTS', 1),
    deadlineSeconds: requiredInt('EXECUTION_DEADLINE_SECONDS', 1),
    leaseSeconds: requiredInt('EXECUTION_LEASE_SECONDS', 1),
    graceSeconds: requiredInt('EXECUTION_GRACE_SECONDS', 0),
    capabilityTtlSeconds: requiredInt('CAPABILITY_TTL_SECONDS', 1),
    unknownEscalateAfterSeconds: requiredInt('UNKNOWN_ESCALATE_AFTER_SECONDS', 1),
    autoRetryUnknown: false,
    fileMaxBytes: requiredInt('FILE_MAX_BYTES', 1),
    testHooks,
    fileRoot: required('FILE_ROOT'),
    logPath: required('LOG_PATH'),
    apiPort: requiredInt('API_PORT', 1),
    redisHost: required('REDIS_HOST'),
    redisPort: requiredInt('REDIS_PORT', 1),
    serviceSecret: required('SERVICE_JWT_SECRET'),
    userSecret: required('USER_JWT_SECRET'),
    databaseUrl(user: string, passwordEnv: string): string {
      const password = required(passwordEnv);
      return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${required('PGHOST')}:${required('PGPORT')}/${required('PGDATABASE')}`;
    },
  };
}
