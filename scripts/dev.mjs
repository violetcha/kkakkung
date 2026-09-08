import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const target = process.argv[2] ?? 'all';
if (!['all', 'web', 'server'].includes(target)) throw new Error('Usage: pnpm dev [web|server]');
const children = new Set();
let closing = false;
function launch(entry, args, cwd = root) {
  const child = spawn(process.execPath, [resolve(root, entry), ...args], { cwd, stdio: 'inherit' });
  children.add(child);
  child.on('error', (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on('exit', (code) => {
    children.delete(child);
    if (!closing) stop(code ?? 1);
  });
  return child;
}
function stop(code = 0) {
  if (closing) return;
  closing = true;
  process.exitCode = code;
  for (const child of children) {
    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } else child.kill('SIGTERM');
  }
}
process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());
const built = spawn(
  process.execPath,
  [resolve(root, 'node_modules/typescript/bin/tsc'), '-b', 'tsconfig.packages.json'],
  { cwd: root, stdio: 'inherit' },
);
children.add(built);
const result = await new Promise((done, reject) => {
  built.once('exit', done);
  built.once('error', reject);
});
children.delete(built);
if (result !== 0 || closing) process.exitCode = result ?? 1;
else {
  launch('node_modules/typescript/bin/tsc', [
    '-b',
    'tsconfig.packages.json',
    '--watch',
    '--preserveWatchOutput',
  ]);
  if (target !== 'web')
    launch(
      'node_modules/tsx/dist/cli.mjs',
      ['watch', '--include', '../packages/**/dist/**', 'src/index.ts'],
      resolve(root, 'server'),
    );
  if (target !== 'server')
    launch(
      'apps/web/node_modules/vite/bin/vite.js',
      ['--host', '127.0.0.1'],
      resolve(root, 'apps/web'),
    );
}
