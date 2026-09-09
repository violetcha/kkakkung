// Owned by F. Spawn a CLI tool with literal arguments in a way that works on Linux CI and on
// Windows, where pnpm/npm are `.cmd` shims that Node refuses to spawn without a shell (EINVAL).
// Only ever pass fixed, trusted argument lists here; never user or repository content.
import { spawnSync } from 'node:child_process';

export function runTool(command, args, options = {}) {
  if (process.platform === 'win32') {
    const quoted = [command, ...args].map((a) =>
      /[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a,
    );
    return spawnSync(quoted.join(' '), { ...options, shell: true });
  }
  return spawnSync(command, args, options);
}
