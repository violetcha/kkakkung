import { randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Preserve each controlled DP-06 report before a rollback reuses the preflight directory. */
export function archiveDeploymentSmoke({
  sourceDir,
  evidenceDir,
  startedAt,
  code,
  now = Date.now(),
}) {
  let report = null;
  let failure = null;
  try {
    const source = resolve(sourceDir, 'deployment-smoke.json');
    const stat = lstatSync(source);
    if (!stat.isFile() || stat.size > 256 * 1024) throw new Error();
    const value = JSON.parse(readFileSync(source, 'utf8'));
    const generatedAt = Date.parse(value.generatedAt);
    if (
      value.case !== 'DP-06' ||
      !['PASS', 'FAIL'].includes(value.status) ||
      !Number.isFinite(generatedAt) ||
      generatedAt < startedAt ||
      generatedAt > now
    )
      throw new Error();
    report = value;
  } catch {
    failure = 'DP06_ATTEMPT_REPORT_UNCONFIRMED';
  }
  const exitCode = code === 0 && report?.status === 'PASS' ? 0 : 1;
  try {
    const archive = `deployment-smoke-${startedAt}-${randomUUID()}.json`;
    writeFileSync(
      resolve(evidenceDir, archive),
      JSON.stringify({ startedAt, exitCode, failure, report }, null, 2) + '\n',
      { flag: 'wx' },
    );
    return { code: exitCode, archive };
  } catch {
    return { code: 1, archive: null };
  }
}
