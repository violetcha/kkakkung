import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// MediaPipe dynamically imports its pinned public loader from a module Worker. Serve that
// loader unchanged, as production nginx does, before Vite's source-module transformation.
const wasmLoaders = new Set(['vision_wasm_module_internal.js']);

export default defineConfig({
  optimizeDeps: { include: ['@mediapipe/tasks-vision'] },
  plugins: [
    react(),
    {
      name: 'pinned-vision-loaders',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
          const prefix = '/models/mediapipe/1.0.1/wasm/';
          if (!pathname.startsWith(prefix) || !wasmLoaders.has(pathname.slice(prefix.length)))
            return next();
          void readFile(fileURLToPath(new URL('./public' + pathname, import.meta.url)))
            .then((bytes) => {
              res.setHeader('Content-Type', 'text/javascript');
              res.end(bytes);
            })
            .catch(() => {
              res.statusCode = 404;
              res.end();
            });
        });
      },
    },
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:2567', changeOrigin: true },
    },
  },
});
