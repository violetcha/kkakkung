import { expect, it } from 'vitest';
import { viewFixture } from '../../room/product-fixture';
import { interactPrompt } from './interact-prompt';

const self = viewFixture().self!;
const at = (patch: Partial<typeof self>) =>
  interactPrompt({ view: viewFixture({ self: { ...self, ...patch } }), tick: 100 });

// S15P21C204-388. 내 출구 앞에서 E 가 먹지 않을 때는 무엇을 하면 되는지 말한다.
it('offers the exit challenge facing my own exit wall', () => {
  expect(at({})).toEqual({ key: 'E', label: '탈출 도전' });
});

it('explains why E does nothing at my exit', () => {
  expect(at({ dir: 1 })).toEqual({
    key: 'E',
    label: '출구 벽을 마주 보면 탈출 도전',
    blocked: true,
  });
  expect(at({ restraintUntilTick: 140 })).toEqual({
    key: 'E',
    label: '구속이 풀리면 탈출 도전',
    blocked: true,
  });
  expect(
    at({
      exchange: { exchangeId: 'x', direction: 'outgoing', peerId: 'ally', expiresAtTick: 140 },
    } as Partial<typeof self>),
  ).toMatchObject({ label: '지도 교환을 끝내면 탈출 도전', blocked: true });
});

it('says nothing away from my exit and during a challenge', () => {
  expect(interactPrompt({ view: viewFixture({ knownActiveExits: [] }), tick: 100 })).toBeNull();
  expect(
    at({
      challenge: {
        challengeId: 'c',
        exitId: 'exit',
        poseKind: 'left',
        minSuccessTick: 140,
        expiresAtTick: 260,
      },
    } as Partial<typeof self>),
  ).toBeNull();
});
