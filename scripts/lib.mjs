import { readFileSync } from 'node:fs';
import { createHash, randomBytes, scryptSync } from 'node:crypto';

export function applyEnvFile(file) {
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

export function loadDevEnv() {
  applyEnvFile(process.env.ENV_FILE || 'config/dev.env.example');
}

export function roleUrl(user, passwordEnv) {
  const password = process.env[passwordEnv];
  if (!password) throw new Error(`missing ${passwordEnv}`);
  const userName = encodeURIComponent(user);
  const pass = encodeURIComponent(password);
  return `postgres://${userName}:${pass}@${process.env.PGHOST}:${process.env.PGPORT}/${process.env.PGDATABASE}`;
}

export function hashPassword(password) {
  const salt = '0123456789abcdef0123456789abcdef';
  const hash = scryptSync(password, salt, 32).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function newSecret() {
  return randomBytes(32).toString('base64url');
}
