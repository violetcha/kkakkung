import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyVisionAssetNotices } from '../../scripts/lib/vision-asset-notices.mjs';

const publicRoot = fileURLToPath(new URL('../../apps/web/public/', import.meta.url));
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    const target = resolve(dir);
    if (
      dirname(target) !== resolve(tmpdir()) ||
      !basename(target).startsWith('vision-asset-notices-')
    )
      throw new Error('UNSAFE_FIXTURE_DIRECTORY');
    rmSync(target, { recursive: true, force: true });
  }
});

type Entry = { publicPath?: string; file?: string; bytes: number; sha256: string };
// Synthetic bytes/review declarations for rejection tests, never model or legal evidence.
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'vision-asset-notices-'));
  dirs.push(dir);
  const manifest = JSON.parse(readFileSync(join(publicRoot, 'models/manifest.json'), 'utf8'));
  const write = (entry: Entry, path = entry.publicPath!) => {
    const target = join(dir, path.slice(1));
    mkdirSync(dirname(target), { recursive: true });
    const bytes = Buffer.from('synthetic-fixture:' + path);
    writeFileSync(target, bytes);
    entry.bytes = bytes.length;
    entry.sha256 = createHash('sha256').update(bytes).digest('hex');
  };
  for (const entry of manifest.notices.files) write(entry);
  for (const entry of Object.values(manifest.models)) write(entry as Entry);
  for (const entry of manifest.sdk.files)
    write(entry, manifest.sdk.wasmBasePath + '/' + entry.file);
  const save = () => writeFileSync(join(dir, 'models/manifest.json'), JSON.stringify(manifest));
  save();
  return { dir, manifest, save };
}

describe('shipped vision asset notices and declared review boundary', () => {
  it('verifies real shipped files and keeps the actual outstanding reviews visible', async () => {
    await expect(verifyVisionAssetNotices(publicRoot)).resolves.toEqual({
      noticeFilesVerified: true,
      assetFilesVerified: 9,
      visionRightsReviewed: false,
      pendingRights: ['model:gesture', 'sdk:bundled-notices'],
    });
    await expect(
      verifyVisionAssetNotices(publicRoot, { requireReviewedRights: true }),
    ).rejects.toThrow('VISION_ASSET_RIGHTS_PENDING');
  });

  it('requires every declared component and the SDK notices review before accepting the strict flag', async () => {
    const f = fixture();
    f.manifest.models.gesture.license = 'Apache-2.0';
    for (const entry of f.manifest.models.gesture.licenseEvidence) entry.license = 'Apache-2.0';
    f.save();
    await expect(verifyVisionAssetNotices(f.dir, { requireReviewedRights: true })).rejects.toThrow(
      'VISION_ASSET_RIGHTS_PENDING',
    );
    f.manifest.sdk.bundledNoticesReview = 'verified';
    f.save();
    await expect(
      verifyVisionAssetNotices(f.dir, { requireReviewedRights: true }),
    ).resolves.toMatchObject({ visionRightsReviewed: true, pendingRights: [] });
  });

  it.each([
    'licenses/index.html',
    'licenses/notices.css',
    'licenses/Apache-2.0.txt',
    'models/face/face_landmarker.task',
    'models/mediapipe/1.0.1/wasm/vision_wasm_internal.wasm',
  ])('rejects changed shipped bytes: %s', async (path) => {
    const f = fixture();
    writeFileSync(join(f.dir, path), 'changed');
    await expect(verifyVisionAssetNotices(f.dir)).rejects.toThrow();
  });

  it('rejects a missing license instead of substituting the SPA or skipping notices', async () => {
    const f = fixture();
    rmSync(join(f.dir, 'licenses/Apache-2.0.txt'));
    await expect(verifyVisionAssetNotices(f.dir)).rejects.toThrow();
  });

  it.each([
    '/licenses/../../private.txt',
    '/licenses/../models/manifest.json',
    '/licenses//index.html',
    'https://example.invalid/license.txt',
  ])('rejects an uncontained notice path: %s', async (path) => {
    const f = fixture();
    f.manifest.notices.files[0].publicPath = path;
    f.save();
    await expect(verifyVisionAssetNotices(f.dir)).rejects.toThrow('VISION_ASSET_NOTICES_INVALID');
  });

  it('rejects deleting the unlicensed classifiers from the review inventory', async () => {
    const f = fixture();
    f.manifest.models.gesture.license = 'Apache-2.0';
    f.manifest.models.gesture.licenseEvidence = f.manifest.models.gesture.licenseEvidence.filter(
      (entry: { license: string }) => entry.license !== 'pending',
    );
    f.save();
    await expect(verifyVisionAssetNotices(f.dir)).rejects.toThrow('VISION_ASSET_NOTICES_INVALID');
  });

  it('rejects a complete bundle claim while one component still lacks reviewed rights', async () => {
    const f = fixture();
    f.manifest.models.gesture.license = 'Apache-2.0';
    f.save();
    await expect(verifyVisionAssetNotices(f.dir)).rejects.toThrow('VISION_ASSET_NOTICES_INVALID');
  });
});
