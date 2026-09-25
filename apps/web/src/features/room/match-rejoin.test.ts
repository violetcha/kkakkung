/**
 * S15P21C204-396. 경기 중 새로고침한 탭이 같은 자리로 돌아갈 기록. 떠날 때 적고, 다음 페이지가 읽자마자
 * 지우며, 서버가 자리를 비워 두는 25초가 지났거나 형식이 틀리면 아무 데도 가지 않는다.
 */
import { expect, it } from 'vitest';
import {
  MATCH_REJOIN_WINDOW_MS,
  consumeMatchRejoin,
  forgetMatchRejoin,
  rememberMatchRejoin,
} from './product-session';

const memory = () => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
};
const session = {
  sessionToken: 'session-token',
  playerId: 'player-1',
  roomCode: 'ABCDEF',
  expiresAt: 1_000_000,
  protocolVersion: '0.2.0',
} as const;
const scope = { matchId: 'match-1', mediaInstanceId: 'media-1', receiverGeneration: 3 };

it('hands the seat back once and forgets it', () => {
  const storage = memory();
  rememberMatchRejoin(
    { session, reconnectionToken: 'room:token', mediaScope: scope },
    10_000,
    storage,
  );
  const rejoin = consumeMatchRejoin(10_000 + MATCH_REJOIN_WINDOW_MS - 1, storage);
  expect(rejoin).toMatchObject({
    session: { sessionToken: 'session-token', playerId: 'player-1', roomCode: 'ABCDEF' },
    reconnectionToken: 'room:token',
    mediaScope: scope,
  });
  expect(storage.values.size).toBe(0);
  expect(consumeMatchRejoin(10_001, storage)).toBeNull();
});

it('goes nowhere once the server grace has passed', () => {
  const storage = memory();
  rememberMatchRejoin({ session, reconnectionToken: 'room:token', mediaScope: null }, 0, storage);
  expect(consumeMatchRejoin(MATCH_REJOIN_WINDOW_MS, storage)).toBeNull();
  expect(storage.values.size).toBe(0);
});

it.each([
  ['not JSON', '{'],
  ['no token', JSON.stringify({ session, reconnectionToken: '', mediaScope: null, savedAt: 0 })],
  [
    'a malformed room',
    JSON.stringify({
      session: { ...session, roomCode: 'abc' },
      reconnectionToken: 'room:token',
      mediaScope: null,
      savedAt: 0,
    }),
  ],
  ['no session', JSON.stringify({ reconnectionToken: 'room:token', savedAt: 0 })],
])('ignores a record with %s', (_case, stored) => {
  const storage = memory();
  storage.setItem('kkakkung.match-rejoin', stored);
  expect(consumeMatchRejoin(1, storage)).toBeNull();
  expect(storage.values.size).toBe(0);
});

it('keeps the seat without media when the stored generation is malformed', () => {
  const storage = memory();
  storage.setItem(
    'kkakkung.match-rejoin',
    JSON.stringify({
      session,
      reconnectionToken: 'room:token',
      mediaScope: { matchId: 'match-1' },
      savedAt: 0,
    }),
  );
  expect(consumeMatchRejoin(1, storage)?.mediaScope).toBeNull();
});

it('forgets a record the player chose to leave', () => {
  const storage = memory();
  rememberMatchRejoin({ session, reconnectionToken: 'room:token', mediaScope: null }, 0, storage);
  forgetMatchRejoin(storage);
  expect(consumeMatchRejoin(1, storage)).toBeNull();
});
