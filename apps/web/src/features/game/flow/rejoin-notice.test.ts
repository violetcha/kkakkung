import { expect, it } from 'vitest';
import { rejoinNotice } from './rejoin-notice';

const players = [
  { playerId: 'self', nickname: '나', connected: true },
  { playerId: 'a', nickname: '하나', connected: false },
  { playerId: 'b', nickname: '둘', connected: true },
];

// S15P21C204-391. 끊긴 사람은 재접속 중임을, 남은 사람은 누구를 기다리는지 본다.
it('tells a dropped player that it is reconnecting', () => {
  expect(rejoinNotice({ reconnecting: true, phase: 'PLAYING', selfId: 'self', players })).toContain(
    '다시 연결하는 중',
  );
});

it('names who the match is waiting for, only while it runs', () => {
  expect(rejoinNotice({ phase: 'PLAYING', selfId: 'self', players })).toContain('하나님의 연결이');
  expect(rejoinNotice({ phase: 'RESULT', selfId: 'self', players })).toBeNull();
  expect(
    rejoinNotice({
      phase: 'PLAYING',
      selfId: 'self',
      players: players.map((player) => ({ ...player, connected: true })),
    }),
  ).toBeNull();
});
