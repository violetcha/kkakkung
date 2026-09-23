// Owned by F. Spawn a CLI tool with literal arguments in a way that works on Linux CI and on
// Windows, where pnpm/npm are `.cmd` shims that Node refuses to spawn without a shell (EINVAL).
// Only ever pass fixed, trusted argument lists here; never user or repository content.
import { spawn, spawnSync } from 'node:child_process';

export function runTool(command, args, options = {}) {
  if (process.platform === 'win32') {
    const quoted = [command, ...args].map((a) =>
      /[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a,
    );
    return spawnSync(quoted.join(' '), { ...options, shell: true });
  }
  return spawnSync(command, args, options);
}

/**
 * Same argument rules as `runTool`, without blocking: output is collected and handed back so
 * several tools can run at once and still print one readable block each (S15P21C204-368).
 */
export function runToolCollected(command, args, options = {}) {
  const child =
    process.platform === 'win32'
      ? spawn(
          [command, ...args]
            .map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a))
            .join(' '),
          { ...options, shell: true },
        )
      : spawn(command, args, options);
  let output = '';
  child.stdout?.on('data', (chunk) => (output += chunk));
  child.stderr?.on('data', (chunk) => (output += chunk));
  return new Promise((resolveRun) => {
    child.on('error', (error) => resolveRun({ status: 127, output: output + String(error) }));
    child.on('close', (status) => resolveRun({ status: status ?? 1, output }));
  });
}
