// F-04 / DP-04: a develop build may skip Verify only for a tree an MR build already verified.
// The marker is keyed by git tree hash; a merge that changed the tree never matches.
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_MARKERS,
  VERIFIED_TREES_DIR,
  findVerifiedTree,
  recordVerifiedTree,
} from '../../scripts/verified-tree.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const script = resolve(root, 'scripts/verified-tree.mjs');
const tree = (n: number) => n.toString(16).padStart(40, '0');

describe('verified tree markers', () => {
  it('records a verified tree and finds it again; another tree or a bad hash finds nothing', () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'kkakkung-verified-'));
    const path = recordVerifiedTree({
      stateDir,
      tree: tree(1),
      commit: 'a'.repeat(40),
      build: 'kkakkung-mr#131',
      nowMs: Date.UTC(2026, 8, 14, 3, 0, 0),
    });
    expect(path).toContain(VERIFIED_TREES_DIR);
    expect(findVerifiedTree(stateDir, tree(1))).toMatchObject({
      tree: tree(1),
      commit: 'a'.repeat(40),
      build: 'kkakkung-mr#131',
      verifiedAt: '2026-09-14T03:00:00.000Z',
    });
    expect(findVerifiedTree(stateDir, tree(2))).toBeNull();
    expect(findVerifiedTree(stateDir, 'not-a-tree')).toBeNull();
    // A tampered or truncated marker is treated as absent, never as verified.
    writeFileSync(path, '{"tree":"other"}');
    expect(findVerifiedTree(stateDir, tree(1))).toBeNull();
  });

  it('keeps only the newest markers', () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'kkakkung-verified-'));
    for (let i = 0; i < MAX_MARKERS + 5; i++)
      recordVerifiedTree({ stateDir, tree: tree(i), commit: 'b'.repeat(40), build: `mr#${i}` });
    expect(readdirSync(join(stateDir, VERIFIED_TREES_DIR))).toHaveLength(MAX_MARKERS);
  });

  it('CLI: check prints the recorder only after record, and exits 2 on bad usage', () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'kkakkung-verified-'));
    const run = (args: string[]) =>
      spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 20_000 });
    const before = run(['check', '--state-dir', stateDir, '--tree', tree(7)]);
    expect(before.status).toBe(0);
    expect(before.stdout.trim()).toBe('');
    const recorded = run([
      'record',
      '--state-dir',
      stateDir,
      '--tree',
      tree(7),
      '--commit',
      'c'.repeat(40),
      '--build',
      'kkakkung-mr#7',
    ]);
    expect(recorded.status).toBe(0);
    const after = run(['check', '--state-dir', stateDir, '--tree', tree(7)]);
    expect(after.stdout.trim()).toMatch(/^kkakkung-mr#7 \(cccccccc, /);
    expect(run(['record', '--state-dir', stateDir, '--tree', tree(8)]).status).toBe(2);
    expect(run(['bogus']).status).toBe(2);
    expect(readFileSync(join(stateDir, VERIFIED_TREES_DIR, `${tree(7)}.json`), 'utf8')).toContain(
      '"build": "kkakkung-mr#7"',
    );
  });
});
