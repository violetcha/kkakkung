import { expect, it } from 'vitest';
import { SESSION_ERROR_CODES } from '@kkakkung/protocol/game-messages';
import { sessionErrorLabel } from './session-error-labels';

const plain = { ssoWithoutInvitation: false };

// S15P21C204-365. 서버가 보내는 모든 오류 코드에는 할 일을 말하는 문구가 있다.
it('has a label for every session error the server can send', () => {
  for (const code of SESSION_ERROR_CODES)
    expect(sessionErrorLabel(code, plain), code).toMatch(/\S/);
  expect(sessionErrorLabel('INVALID_SESSION', plain)).toContain('다시 입장');
  expect(sessionErrorLabel('SOMETHING_ELSE', plain)).toBeNull();
});

it('tells a full service apart from a full room', () => {
  const service = sessionErrorLabel('CAPACITY', plain)!;
  const room = sessionErrorLabel('ROOM_FULL', plain)!;
  expect(service).not.toBe(room);
  // 서비스가 찼으면 기다리고, 그 방이 찼으면 다른 방을 찾는다.
  expect(service).toContain('잠시 뒤');
  expect(room).toContain('방 코드');
  expect(room).toContain('새 방');
  // "방이 가득 찼습니다"를 서비스 만석에 쓰지 않는다. 방을 만들려던 사람에게는 틀린 말이다.
  expect(service).not.toContain('방이 가득');
});

it('blames the login, not the invitation, when a signed-in user arrives without one', () => {
  expect(sessionErrorLabel('INVALID_INVITATION', plain)).toContain('초대');
  expect(sessionErrorLabel('INVALID_INVITATION', { ssoWithoutInvitation: true })).toContain(
    '로그인',
  );
});
