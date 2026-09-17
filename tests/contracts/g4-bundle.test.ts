// F-13 / QA-08 web bundle boundary: the scanner derives its sentinels from the real server-only
// files and detects them in a synthetic bundle, while a clean bundle with public model assets
// passes. The real apps/web/dist is scanned by scripts/inspect-public-bundle.mjs after pnpm build
// (the default verify runs test before build, so no dist is assumed here).
import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SCANNED_EXTENSIONS,
  deriveSentinels,
  scanBundle,
} from '../../scripts/inspect-public-bundle.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sentinels = deriveSentinels(root);
const temp = mkdtempSync(join(tmpdir(), 'g4-bundle-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

function bundle(name: string, files: Record<string, string>) {
  const dir = join(temp, name);
  mkdirSync(join(dir, 'assets'), { recursive: true });
  mkdirSync(join(dir, 'models'), { recursive: true });
  for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, file), text);
  return dir;
}

describe('sentinels come from the server files, not from a hand-written list', () => {
  it('covers the two map templates, the fallback hash, the tuning version and secret names', () => {
    const ids = sentinels.map((s) => s.id);
    expect(ids).toContain('map:master-v1:templateId');
    expect(ids).toContain('map:practice-v1:templateId');
    expect(ids).toContain('fallback:master-v1:templateHash');
    expect(ids).toContain('map:maze-v1:templateId');
    expect(ids).toContain('fallback:maze-v1:templateHash');
    expect(ids).toContain('tuning:version');
    expect(ids).toContain('secret-name:OPS_TOKEN');
    expect(ids.filter((id) => id.startsWith('map:master-v1:row')).length).toBeGreaterThan(10);
    const master = JSON.parse(
      readFileSync(resolve(root, 'server/content/maps/master-v1.json'), 'utf8'),
    );
    expect(sentinels.some((s) => s.literal === master.rows[3])).toBe(true);
    // Every literal is long enough not to match generic bundle text by accident.
    for (const s of sentinels) expect(s.literal.length).toBeGreaterThanOrEqual(9);
  });
});

describe('bundle scan', () => {
  it('passes a clean bundle that only carries public model assets and generic geometry', () => {
    const dir = bundle('clean', {
      'index.html': '<!doctype html><script type="module" src="/assets/index.js"></script>',
      'assets/index.js': 'const grid=Array.from({length:32},()=>Array(32).fill(0));export{grid};',
      'assets/index.js.map': '{"version":3,"sources":["src/main.ts"],"mappings":"AAAA"}',
      'models/manifest.json': '{"face":"face_landmarker.task","pose":"pose_landmarker_lite.task"}',
      'assets/style.css': 'body{margin:0}',
    });
    const result = scanBundle(dir, sentinels);
    expect(result.findings).toEqual([]);
    expect(result.files).toEqual([
      'assets/index.js',
      'assets/index.js.map',
      'assets/style.css',
      'index.html',
      'models/manifest.json',
    ]);
  });

  it('finds a maze row, the template id and the tuning version wherever they hide, and names the file only', () => {
    const master = JSON.parse(
      readFileSync(resolve(root, 'server/content/maps/master-v1.json'), 'utf8'),
    );
    // The tuning version comes from the shipped profile, so a version bump (270: mvp-v2) keeps
    // this leak fixture describing the real sentinel instead of a stale literal.
    const { tuningVersion } = JSON.parse(
      readFileSync(resolve(root, 'server/config/tuning/mvp-v1.json'), 'utf8'),
    ) as { tuningVersion: string };
    const dir = bundle('leaking', {
      'index.html': '<!doctype html>',
      'assets/index.js': `const t={"templateId":"master-v1","rows":["${master.rows[5]}"]};`,
      'assets/index.js.map': `{"sourcesContent":["{\\"tuningVersion\\": \\"${tuningVersion}\\"}"]}`,
      'assets/config.json': '{"OPS_TOKEN":"x"}',
    });
    const result = scanBundle(dir, sentinels);
    const ids = result.findings.map((f) => `${f.file}:${f.sentinel}`);
    expect(ids).toContain('assets/index.js:map:master-v1:templateId');
    expect(ids).toContain('assets/index.js:map:master-v1:row5');
    expect(ids).toContain('assets/index.js.map:tuning:version-spaced');
    expect(ids).toContain('assets/config.json:secret-name:OPS_TOKEN');
    for (const f of result.findings) {
      expect(f.line).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(f)).not.toContain(master.rows[5]);
    }
  });

  it('skips binary assets and scans only text bundle types', () => {
    expect(SCANNED_EXTENSIONS).toContain('.js');
    expect(SCANNED_EXTENSIONS).toContain('.map');
    expect(SCANNED_EXTENSIONS).not.toContain('.wasm');
    expect(SCANNED_EXTENSIONS).not.toContain('.task');
  });
});
