/**
 * S15P21C204-225. The asset ledger is only worth having if it cannot drift from what the build
 * actually ships. Three invariants:
 *   1. every file under apps/web/public is named in the ledger,
 *   2. every repository path the ledger cites still exists,
 *   3. the items the ledger marks as notice-bearing appear on the shipped notice page.
 * This checks bookkeeping, not legal rights: a recorded licence is a claim the ledger makes, and
 * the outstanding reviews stay outstanding (see vision-asset-notices.test.ts for shipped bytes).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const ledgerPath = resolve(root, 'docs/third-party-assets.md');
const ledger = readFileSync(ledgerPath, 'utf8');
const publicRoot = resolve(root, 'apps/web/public');
const noticePage = readFileSync(join(publicRoot, 'licenses/index.html'), 'utf8');
const avatarManifest = JSON.parse(
  readFileSync(join(publicRoot, 'models/avatars/v1/manifest.json'), 'utf8'),
) as {
  roles: Record<
    string,
    {
      model: { url: string; sha256: string; bytes: number };
      textures: Record<string, Record<string, { url: string; sha256: string; bytes: number }>>;
    }
  >;
};

function avatarAssets() {
  return Object.values(avatarManifest.roles).flatMap((role) => [
    role.model,
    ...Object.values(role.textures).flatMap((textures) => Object.values(textures)),
  ]);
}

function filesUnder(directory: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else out.push(relative(publicRoot, path).split('\\').join('/'));
  }
  return out;
}

/**
 * A shipped file is accounted for when the ledger names it, or names the directory that stands
 * for its group (the six MediaPipe WASM files are recorded per file in models/manifest.json, which
 * the ledger points at, rather than one row each).
 */
function accountedFor(file: string): boolean {
  if (ledger.includes(file)) return true;
  const segments = file.split('/');
  for (let depth = segments.length - 1; depth > 0; depth -= 1) {
    const directory = segments.slice(0, depth).join('/');
    if (ledger.includes(`\`${directory}/\``)) return true;
  }
  return false;
}

describe('asset ledger covers what the build ships', () => {
  it('names every file under apps/web/public', () => {
    const files = filesUnder(publicRoot);
    expect(files.length).toBeGreaterThan(10);
    expect(files.filter((file) => !accountedFor(file))).toEqual([]);
  });

  it('cites only repository paths that still exist', () => {
    // Markdown links into the repository: (../apps/web/... ) and (../tests/... ).
    const cited = [...ledger.matchAll(/\]\((\.\.\/[^)]+)\)/g)].map((match) => match[1]!);
    expect(cited.length).toBeGreaterThan(10);
    const missing = cited.filter((path) => {
      try {
        return !statSync(resolve(root, 'docs', path)).isFile();
      } catch {
        return true;
      }
    });
    expect(missing).toEqual([]);
  });

  it('records every scene and sound module that authors a shipped asset in code', () => {
    // The ledger's point is that these produce what a player sees and hears; a new one that is
    // never recorded would leave the "no third-party render asset" claim unverified.
    const authoring = [
      'apps/web/src/features/game/scene/block-theme.ts',
      'apps/web/src/features/game/scene/facility-theme.ts',
      'apps/web/src/features/game/scene/FaceAvatar.tsx',
      'apps/web/src/features/game/scene/EquipmentObjects.tsx',
      'apps/web/src/features/game/scene/HeldTool.tsx',
      'apps/web/src/features/media/effect-buffer.ts',
      'apps/web/src/features/media/cue-buffer.ts',
    ];
    for (const path of authoring) {
      expect(statSync(resolve(root, path)).isFile(), path).toBe(true);
      expect(ledger, path).toContain(path.split('/').pop()!);
    }
  });

  it('records every generated avatar file with the manifest bytes and sha instead of a directory wildcard', () => {
    expect(avatarAssets()).toHaveLength(8);
    for (const asset of avatarAssets()) {
      expect(ledger, asset.url).toContain(`\`${asset.url.slice(1)}\``);
      expect(ledger, `${asset.url} bytes`).toContain(asset.bytes.toLocaleString('en-US'));
      expect(ledger, `${asset.url} sha256`).toContain(asset.sha256);
    }
    expect(ledger).toContain('프로젝트 코드 생성 자산');
    expect(ledger).toContain('외부 원본 없음');
    expect(ledger).toContain('고지 의무 없음');
  });
});

describe('notice page carries the notices the ledger promises', () => {
  it('reproduces the font copyright and links the licence text it ships', () => {
    expect(noticePage).toContain('Lee Minseo');
    expect(noticePage).toContain('SIL Open Font License 1.1');
    expect(noticePage).toContain('/fonts/OFL-1.1.txt');
    // The shipped families, so a dropped weight is noticed.
    expect(noticePage).toContain('Google Inc.');
    for (const family of ['Galmuri9', 'Galmuri11', 'Galmuri14', 'Nanum Myeongjo'])
      expect(noticePage, family).toContain(family);
  });

  it('keeps the vision notices and the outstanding reviews visible', () => {
    expect(noticePage).toContain('Apache-2.0');
    expect(noticePage).toContain('/licenses/Apache-2.0.txt');
    expect(noticePage).toContain('추가 확인 중인 항목');
    // The two blockers the ledger records must not quietly disappear from the product page.
    expect(noticePage).toContain('canned gesture classifier');
    expect(noticePage).toContain('제3자 구성 요소');
    expect(ledger).toContain('공개 차단 요인');
  });
});
