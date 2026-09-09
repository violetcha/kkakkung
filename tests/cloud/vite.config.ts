import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Builds the MC-01 probe page only. Output stays under .local (ignored); nothing is deployed.
export default defineConfig({
  root: fileURLToPath(new URL('./', import.meta.url)),
  build: {
    outDir: fileURLToPath(new URL('../../.local/qa/probe-dist', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: { input: fileURLToPath(new URL('./probe.html', import.meta.url)) },
  },
  server: { port: 5175, strictPort: true },
});
