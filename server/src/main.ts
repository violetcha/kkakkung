import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseConfig } from './config/env.js';
import { createApplication } from './bootstrap.js';
import { loadProductProfile } from './game/ProductProfileLoader.js';

// The same URL resolves to the package .env from both src/main.ts and dist/main.js.
const envPath = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);
const config = parseConfig(process.env);
const application = createApplication(
  config,
  config.serverProfile === 'product' ? await loadProductProfile(config) : undefined,
);
await application.listen();
let closing = false;
const shutdown = () => {
  if (closing) return;
  closing = true;
  void application.close().catch(() => {
    process.exitCode = 1;
  });
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
