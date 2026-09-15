import { describe, expect, it, vi } from 'vitest';
import { mediaGrantSchema, mediaBindingsSchema } from '@kkakkung/protocol/game-messages';
import { splitMediaGrantFixture, splitMediaBindingsFixture } from './shared/fixtures';
import { createMediaSession } from '../../apps/web/src/features/media/media-session';
import type { MediaGrant as WebGrant } from '../../apps/web/src/features/media/media-types';
import type { MediaGrant as ServerGrant } from '../../server/src/media/types';
import type { MediaGrant as RoomGrant } from '../../server/src/game/ports';

const grant: WebGrant & ServerGrant & RoomGrant = splitMediaGrantFixture;
describe('split grant and binding producer-consumer contract', () => {
  it('preserves two source credentials and a separate face publisher through the actual wire parser', () => {
    expect(mediaGrantSchema.parse(grant)).toEqual(grant);
    expect(mediaBindingsSchema.parse(splitMediaBindingsFixture)).toEqual(splitMediaBindingsFixture);
    const single = { ...grant };
    delete single.facePublication;
    delete single.subscriptionMode;
    expect(mediaGrantSchema.parse(single)).toEqual(single);
    expect(
      mediaGrantSchema.parse({ ...single, subscriptionMode: 'publisher-permissions' }),
    ).toMatchObject({ subscriptionMode: 'publisher-permissions' });
  });
  it.each([
    { facePublication: undefined },
    { subscriptionMode: undefined },
    { subscriptionMode: 'publisher-permissions' },
    { facePublication: { ...grant.facePublication, roomName: grant.roomName } },
    { facePublication: { ...grant.facePublication, mediaIdentity: grant.mediaIdentity } },
    { facePublication: { ...grant.facePublication, token: grant.token } },
    { facePublication: { ...grant.facePublication, token: '' } },
    { facePublication: { ...grant.facePublication, url: 'wss://other.invalid' } },
  ])(
    'rejects a contradictory transport in the parser and before creating an SDK room: %j',
    async (overrides) => {
      const invalid = { ...grant, ...overrides };
      expect(mediaGrantSchema.safeParse(invalid).success).toBe(false);
      const factory = vi.fn(() => {
        throw new Error('must not create');
      });
      const session = createMediaSession({
        createRoom: factory,
        onStatus: vi.fn(),
        epochNowSeconds: () => 1,
        getPhase: () => 'GAME_LOADING',
      });
      await expect(session.connect(invalid as WebGrant)).rejects.toMatchObject({
        code: 'GRANT_INCOMPLETE',
      });
      expect(factory).not.toHaveBeenCalled();
    },
  );
  it('rejects a malformed face publisher instead of silently using the audio identity', () => {
    expect(
      mediaBindingsSchema.safeParse({
        ...splitMediaBindingsFixture,
        participants: [
          {
            ...splitMediaBindingsFixture.participants[0],
            facePublisher: { participantSid: 'PA_face' },
          },
        ],
      }).success,
    ).toBe(false);
  });
});
