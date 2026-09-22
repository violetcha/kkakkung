import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseConfig } from './config/env.js';
import { createApplication } from './bootstrap.js';
import { loadProductProfile } from './game/ProductProfileLoader.js';
import { installProcessGuard } from './process-guard.js';

// The same URL resolves to the package .env from both src/main.ts and dist/main.js.
const envPath = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);
const config = parseConfig(process.env);
const application = createApplication(
  config,
  config.serverProfile === 'product' ? await loadProductProfile(config) : undefined,
);
await application.listen();
let closing: Promise<void> | null = null;
const close = () => (closing ??= application.close());
const shutdown = () => {
  void close().catch(() => {
    process.exitCode = 1;
  });
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
installProcessGuard({
  on: (event, listener) => process.on(event, listener),
  report: (kind, error) => application.reportProcessFault(kind, error),
  close,
  exit: (code) => process.exit(code),
  schedule: (callback, ms) => setTimeout(callback, ms).unref(),
});
