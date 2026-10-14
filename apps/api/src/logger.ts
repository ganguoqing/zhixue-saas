import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const hidden = new Set([
  'recognized_answer',
  'contentBase64',
  'capability',
  'password',
  'leaseToken',
  'secret',
  'payload',
]);

export function log(event: string, fields: Record<string, unknown> = {}): void {
  const safe: Record<string, unknown> = { time: new Date().toISOString(), event };
  for (const [key, value] of Object.entries(fields)) {
    if (hidden.has(key)) continue;
    if (typeof value === 'string' && value.includes('SENTINEL_ANSWER_TEXT')) continue;
    safe[key] = value;
  }
  const line = JSON.stringify(safe);
  console.log(line);
  const path = process.env.LOG_PATH;
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${line}\n`);
}
