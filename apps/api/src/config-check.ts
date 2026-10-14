import { loadConfig } from './config';

try {
  loadConfig();
  console.log('config ok');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'config failed');
  process.exit(1);
}
