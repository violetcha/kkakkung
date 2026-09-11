import { expect, it, vi } from 'vitest';
import { buildReleaseImages } from '../../scripts/build-release-images.mjs';
const sha = 'a'.repeat(40);
it('reuses existing verified images without rebuilding a mutable tag', () => {
  const build = vi.fn();
  buildReleaseImages(sha, () => ({ id: 'existing', revision: sha }), build);
  expect(build).not.toHaveBeenCalled();
});
it('builds only missing images and verifies their revision', () => {
  const images = new Map([['kkakkung-game:aaaaaaaa', { id: 'game', revision: sha }]]);
  const build = vi.fn((_file: string, ref: string) => {
    images.set(ref, { id: 'web', revision: sha });
    return 0;
  });
  buildReleaseImages(sha, (ref) => images.get(ref) ?? null, build);
  expect(build).toHaveBeenCalledExactlyOnceWith(
    'infra/docker/Dockerfile.web',
    'kkakkung-web:aaaaaaaa',
    sha,
  );
});
it('refuses mismatched existing tags, failed builds and missing build results', () => {
  const build = vi.fn(() => 0);
  expect(() =>
    buildReleaseImages(sha, () => ({ id: 'old', revision: 'b'.repeat(40) }), build),
  ).toThrow('EXISTING_IMAGE_REVISION_MISMATCH');
  expect(build).not.toHaveBeenCalled();
  expect(() =>
    buildReleaseImages(
      sha,
      () => null,
      () => 1,
    ),
  ).toThrow('IMAGE_BUILD_FAILED');
  expect(() => buildReleaseImages(sha, () => null, build)).toThrow('BUILT_IMAGE_REVISION_MISMATCH');
});
