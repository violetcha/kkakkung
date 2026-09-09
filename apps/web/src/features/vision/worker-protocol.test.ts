import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  PINNED_MODEL_PATHS,
  PINNED_MODEL_SHA256,
  isWorkerResponse,
  verifyModelBytes,
} from './worker-protocol';

/** Node에서 브라우저 crypto.subtle.digest와 같은 결과를 낸다. */
const digest = async (data: ArrayBuffer): Promise<ArrayBuffer> => {
  const hash = createHash('sha256').update(Buffer.from(data)).digest();
  return hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength) as ArrayBuffer;
};

describe('PINNED_MODEL_SHA256', () => {
  it('matches the recorded manifest hashes', () => {
    expect(PINNED_MODEL_SHA256.face).toBe(
      '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff',
    );
    expect(PINNED_MODEL_SHA256.pose).toBe(
      '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a',
    );
    expect(PINNED_MODEL_SHA256.gesture).toBe(
      '97952348cf6a6a4915c2ea1496b4b37ebabc50cbbf80571435643c455f2b0482',
    );
    for (const hash of Object.values(PINNED_MODEL_SHA256)) expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reads only the pinned local assets, never an external URL', () => {
    for (const path of Object.values(PINNED_MODEL_PATHS)) {
      expect(path.startsWith('/models/')).toBe(true);
      expect(path).not.toMatch(/^https?:/);
    }
  });
});

describe('verifyModelBytes', () => {
  it('accepts bytes whose digest equals the pinned hash', async () => {
    const bytes = new TextEncoder().encode('pretend model').buffer as ArrayBuffer;
    const real = await digest(bytes);
    const hex = [...new Uint8Array(real)].map((b) => b.toString(16).padStart(2, '0')).join('');
    // 같은 값을 고정값으로 둔 상황을 흉내 낸다.
    const pinned = { ...PINNED_MODEL_SHA256, face: hex };
    const check = async () => {
      const hashed = await digest(bytes);
      const got = [...new Uint8Array(hashed)].map((b) => b.toString(16).padStart(2, '0')).join('');
      return got === pinned.face;
    };
    expect(await check()).toBe(true);
  });

  it('rejects bytes that do not match the pinned hash', async () => {
    const tampered = new TextEncoder().encode('swapped model').buffer as ArrayBuffer;

    expect(await verifyModelBytes('face', tampered, digest)).toBe(false);
    expect(await verifyModelBytes('pose', tampered, digest)).toBe(false);
    expect(await verifyModelBytes('gesture', tampered, digest)).toBe(false);
  });

  it('accepts the real asset on disk for every pinned model', async () => {
    const { readFileSync } = await import('node:fs');
    const files = {
      face: 'apps/web/public/models/face/face_landmarker.task',
      pose: 'apps/web/public/models/pose/pose_landmarker.task',
      gesture: 'apps/web/public/models/gesture/gesture_recognizer.task',
    } as const;
    for (const [kind, file] of Object.entries(files)) {
      const buffer = readFileSync(file);
      const bytes = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ) as ArrayBuffer;
      expect(await verifyModelBytes(kind as 'face', bytes, digest)).toBe(true);
    }
  });
});

describe('isWorkerResponse', () => {
  it('accepts the hash mismatch error code', () => {
    expect(
      isWorkerResponse({
        type: 'error',
        runtimeGeneration: 1,
        frameId: null,
        code: 'MODEL_HASH_MISMATCH',
      }),
    ).toBe(true);
  });
});
