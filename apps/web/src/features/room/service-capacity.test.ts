// S15P21C204-372. 방을 만들기 전에 여유를 알리고, 대기방이 다 찼거나 점검 중이면 만들기만 막는다.
import { expect, it } from 'vitest';
import { capacityNotice, requestServiceCapacity } from './service-capacity';

const base = {
  matchesInUse: 3,
  matchLimit: 10,
  lobbyRoomsInUse: 12,
  lobbyRoomLimit: 30,
  admissionOpen: true,
  mediaBlocked: false,
};

const respond = (make: () => Response) => (async () => make()) as unknown as typeof fetch;

it('shows free match slots and lets people create a room', () => {
  expect(capacityNotice(base)).toEqual({ text: '지금 경기 가능 7/10', createBlocked: false });
});

it('blocks creating, not joining, when every lobby room is taken or the service is draining', () => {
  const full = capacityNotice({ ...base, lobbyRoomsInUse: 30 })!;
  expect(full.createBlocked).toBe(true);
  expect(full.text).toContain('방 코드로 참가');
  const draining = capacityNotice({ ...base, admissionOpen: false })!;
  expect(draining.createBlocked).toBe(true);
  expect(draining.text).toContain('점검 중');
});

it('still lets a room be made when only match slots are full, and says the start will wait', () => {
  const busy = capacityNotice({ ...base, matchesInUse: 10 })!;
  expect(busy.createBlocked).toBe(false);
  expect(busy.text).toContain('지금 경기 가능 0/10');
  expect(busy.text).toContain('자리가 날 때까지');
  expect(capacityNotice({ ...base, mediaBlocked: true })!.text).toContain('사용량');
});

it('shows nothing when the server cannot say, so an old or failing server never blocks entry', async () => {
  expect(capacityNotice(null)).toBeNull();
  expect(await requestServiceCapacity(respond(() => new Response('', { status: 404 })))).toBeNull();
  expect(await requestServiceCapacity(respond(() => new Response(JSON.stringify({ x: 1 }))))).toBe(
    null,
  );
  const offline = (async () => {
    throw new Error('offline');
  }) as unknown as typeof fetch;
  expect(await requestServiceCapacity(offline)).toBeNull();
  expect(await requestServiceCapacity(respond(() => new Response(JSON.stringify(base))))).toEqual(
    base,
  );
});
