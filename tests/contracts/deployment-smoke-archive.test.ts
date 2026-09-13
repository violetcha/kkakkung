import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archiveDeploymentSmoke } from '../../scripts/lib/archive-deployment-smoke.mjs';

const dirs: string[] = [];
const fixture = () => {
  const dir = mkdtempSync(join(tmpdir(), 'kkakkung-smoke-archive-'));
  dirs.push(dir);
  const file = join(dir, 'deployment-smoke.json');
  const input = { sourceDir: dir, evidenceDir: dir, startedAt: 1000, now: 3000, code: 1 };
  const write = (status: string, generatedAt = 2000) =>
    writeFileSync(
      file,
      JSON.stringify({ case: 'DP-06', status, generatedAt: new Date(generatedAt).toISOString() }),
    );
  const read = (name: string | null) => JSON.parse(readFileSync(join(dir, name!), 'utf8'));
  return { dir, file, input, write, read };
};
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

it('keeps the initial failure after rollback replaces the runner report', () => {
  const f = fixture();
  f.write('FAIL');
  const first = archiveDeploymentSmoke(f.input);
  f.write('PASS');
  const second = archiveDeploymentSmoke({ ...f.input, code: 0 });
  expect(first.code).toBe(1);
  expect(second.code).toBe(0);
  expect(first.archive).not.toBe(second.archive);
  expect(f.read(first.archive).report.status).toBe('FAIL');
  expect(f.read(second.archive).report.status).toBe('PASS');
});

it.each(['missing', 'stale', 'future', 'invalid', 'fail'])(
  'a %s report cannot turn an exit 0 into PASS',
  (kind) => {
    const f = fixture();
    if (kind !== 'missing')
      f.write(
        kind === 'fail' ? 'FAIL' : 'PASS',
        kind === 'stale' ? 500 : kind === 'future' ? 4000 : 2000,
      );
    if (kind === 'invalid') writeFileSync(f.file, 'invalid-json');
    const result = archiveDeploymentSmoke({ ...f.input, code: 0 });
    expect(result.code).toBe(1);
    if (kind !== 'fail')
      expect(f.read(result.archive).failure).toBe('DP06_ATTEMPT_REPORT_UNCONFIRMED');
  },
);

it('preserves runner failure and fails closed when the archive cannot be written', () => {
  const f = fixture();
  f.write('PASS');
  expect(archiveDeploymentSmoke(f.input).code).toBe(1);
  expect(archiveDeploymentSmoke({ ...f.input, code: 0, evidenceDir: f.file })).toEqual({
    code: 1,
    archive: null,
  });
});
