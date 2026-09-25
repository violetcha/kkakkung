/** S15P21C204-401. 대기실 얼굴 사진은 가공 면을 작게 줄인 JPEG 한 장이고 한도를 넘지 않는다. */
import { expect, it, vi } from 'vitest';
import { LOBBY_FACE_MAX_CHARS, LOBBY_FACE_SIZE_PX } from '@kkakkung/protocol/game-messages';
import { captureLobbyFace, type SnapshotCanvas } from './lobby-face-snapshot';

const canvas = (sizes: Record<number, number>) => {
  const drawImage = vi.fn();
  const fake: SnapshotCanvas & { drawImage: typeof drawImage } = {
    width: 0,
    height: 0,
    drawImage,
    getContext: () => ({ drawImage }),
    toDataURL: (_type, quality) =>
      'data:image/jpeg;base64,' + 'A'.repeat(sizes[quality] ?? LOBBY_FACE_MAX_CHARS * 2),
  };
  return fake;
};
const surface = {} as CanvasImageSource;

it('shrinks the processed face to one small JPEG', () => {
  const fake = canvas({ 0.7: 3000 });
  const image = captureLobbyFace(surface, () => fake);
  expect(image?.startsWith('data:image/jpeg;base64,')).toBe(true);
  expect(image!.length).toBeLessThanOrEqual(LOBBY_FACE_MAX_CHARS);
  expect([fake.width, fake.height]).toEqual([LOBBY_FACE_SIZE_PX, LOBBY_FACE_SIZE_PX]);
  expect(fake.drawImage).toHaveBeenCalledWith(
    surface,
    0,
    0,
    LOBBY_FACE_SIZE_PX,
    LOBBY_FACE_SIZE_PX,
  );
});

it('lowers the quality to fit and gives up when even that is too large', () => {
  expect(captureLobbyFace(surface, () => canvas({ 0.35: 4000 }))?.length).toBe(
    'data:image/jpeg;base64,'.length + 4000,
  );
  expect(captureLobbyFace(surface, () => canvas({}))).toBeNull();
  expect(captureLobbyFace(null, () => canvas({ 0.7: 10 }))).toBeNull();
});
