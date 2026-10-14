import { spawn } from 'node:child_process';
import { loadDevEnv } from './lib.mjs';

loadDevEnv();

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env: process.env });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited ${code}`));
    });
  });
}

await run('docker', ['compose', 'up', '-d', '--wait']);
await run('npm', ['run', 'build']);
await run('node', ['scripts/migrate.mjs', '--reset']);
await run('node', ['scripts/seed.mjs']);
await run(process.execPath, [
  '--test',
  '--test-concurrency=1',
  '--test-timeout=300000',
  'tests/m0/integration.test.mjs',
]);
