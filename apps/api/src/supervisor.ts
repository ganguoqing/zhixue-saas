import 'reflect-metadata';
import { runtime } from './app.module';
import { log } from './logger';

const { store } = runtime();
let stopped = false;

async function loop(): Promise<void> {
  while (!stopped) {
    try {
      await store.maintenanceTick();
    } catch (error) {
      log('supervisor_tick_failed', { message: error instanceof Error ? error.message : 'error' });
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

function shutdown(): void {
  stopped = true;
  void store.close().finally(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
log('supervisor_started', { pid: process.pid });
void loop();
