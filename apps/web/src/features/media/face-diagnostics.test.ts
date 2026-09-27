/** S15P21C204-407. 얼굴 진단 기록은 ID 앞 8자만 남기고, 같은 줄은 한 번만 찍는다. */
import { expect, it, vi } from 'vitest';
import { createFaceDiagnostics } from './face-diagnostics';

it('logs each stage once per change with shortened ids', () => {
  const log = vi.fn();
  const d = createFaceDiagnostics(log);
  d.visible('PLAYING', ['anon-1234567890ab', 'player-abcdefgh-1234']);
  d.visible('PLAYING', ['anon-1234567890ab', 'player-abcdefgh-1234']);
  d.bindings({
    phase: 'PLAYING',
    revision: 3,
    outcome: 'stale',
    remote: [{ playerId: 'anon-1234567890ab', face: false }],
  });
  d.track({ playerId: 'anon-1234567890ab', attached: true, accepted: false });
  d.bound([]);
  expect(log.mock.calls.map((c) => c[0])).toEqual([
    '[kkakkung] 얼굴 진단 보이는 사람: phase=PLAYING [anon-123, player-a]',
    '[kkakkung] 얼굴 진단 바인딩: phase=PLAYING rev=3 stale [anon-123-얼굴없음]',
    '[kkakkung] 얼굴 진단 트랙 anon-123: 붙음 버림(범위 불일치 등)',
    '[kkakkung] 얼굴 진단 얼굴 텍스처: []',
  ]);
});
