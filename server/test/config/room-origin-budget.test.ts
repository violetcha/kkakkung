/**
 * S15P21C204-300. 출처별 방 상한은 운영이 조정할 수 있어야 하고, 조정 실수로 조용히 꺼지면
 * 안 된다. 여기서는 설정 파싱만 본다.
 */
import { describe, expect, it } from 'vitest';

import { parseConfig } from '../../src/config/env.js';

const base = {
  MEDIA_MODE: 'disabled',
  SERVICE_NAMESPACE: 'kkakkung-test',
};

describe('출처별 방 예산 설정', () => {
  it('기본값은 두 개다', () => {
    expect(parseConfig({ ...base }).maxRoomsPerOrigin).toBe(2);
  });

  it('운영이 값을 올리거나 내릴 수 있다', () => {
    const config = parseConfig({
      ...base,
      MAX_ROOMS: '10',
      MAX_SLOTS: '60',
      MAX_ROOMS_PER_ORIGIN: '3',
    });
    expect(config.maxRooms).toBe(10);
    expect(config.maxRoomsPerOrigin).toBe(3);
  });

  it('전역 방 수 이상으로 두면 부팅을 거절한다', () => {
    // 상한이 전역 예산과 같거나 크면 한 출처가 서비스를 통째로 가져갈 수 있다. 값만 보고는
    // 꺼진 줄 모르므로 부팅에서 막는다.
    expect(() =>
      parseConfig({ ...base, MAX_ROOMS: '4', MAX_SLOTS: '24', MAX_ROOMS_PER_ORIGIN: '4' }),
    ).toThrow('MAX_ROOMS_PER_ORIGIN must be below MAX_ROOMS');
    expect(() =>
      parseConfig({ ...base, MAX_ROOMS: '4', MAX_SLOTS: '24', MAX_ROOMS_PER_ORIGIN: '9' }),
    ).toThrow('MAX_ROOMS_PER_ORIGIN must be below MAX_ROOMS');
  });

  it('한 방 운영에서는 기본값을 그대로 둬도 뜬다', () => {
    // 방이 하나뿐이면 출처 상한은 아무 일도 하지 않는다. 기본값 때문에 1방 배포가 막히면
    // 안 된다.
    expect(parseConfig({ ...base, MAX_ROOMS: '1', MAX_SLOTS: '6' }).maxRoomsPerOrigin).toBe(2);
  });

  it('0 이하와 범위를 벗어난 값은 거절한다', () => {
    expect(() => parseConfig({ ...base, MAX_ROOMS_PER_ORIGIN: '0' })).toThrow();
    expect(() => parseConfig({ ...base, MAX_ROOMS_PER_ORIGIN: '11' })).toThrow();
    expect(() => parseConfig({ ...base, MAX_ROOMS_PER_ORIGIN: 'two' })).toThrow();
  });
});

// S15P21C204-366. 팀 SSO 는 IP 가 아니라 계정으로 센다.
describe('계정별 방 예산 설정', () => {
  it('기본값은 한 방이고 운영이 바꿀 수 있다', () => {
    expect(parseConfig({ ...base }).maxRoomsPerAccount).toBe(1);
    expect(
      parseConfig({ ...base, MAX_ROOMS: '10', MAX_SLOTS: '60', MAX_ROOMS_PER_ACCOUNT: '2' })
        .maxRoomsPerAccount,
    ).toBe(2);
  });

  it('전역 방 수 이상이거나 범위를 벗어나면 부팅을 거절한다', () => {
    expect(() =>
      parseConfig({ ...base, MAX_ROOMS: '4', MAX_SLOTS: '24', MAX_ROOMS_PER_ACCOUNT: '4' }),
    ).toThrow('MAX_ROOMS_PER_ACCOUNT must be below MAX_ROOMS');
    expect(() => parseConfig({ ...base, MAX_ROOMS_PER_ACCOUNT: '0' })).toThrow();
    expect(() => parseConfig({ ...base, MAX_ROOMS_PER_ACCOUNT: 'one' })).toThrow();
  });
});

// S15P21C204-372. 방 만들기(대기방)와 경기는 예산이 다르다.
describe('대기방 예산 설정', () => {
  it('생략하면 경기 방 수와 같고, 운영은 더 크게 둘 수 있다', () => {
    expect(parseConfig({ ...base, MAX_ROOMS: '1', MAX_SLOTS: '6' }).lobbyMaxRooms).toBe(1);
    expect(
      parseConfig({ ...base, MAX_ROOMS: '10', MAX_SLOTS: '60', LOBBY_MAX_ROOMS: '30' })
        .lobbyMaxRooms,
    ).toBe(30);
  });

  it('경기 방 수보다 작거나 범위를 벗어나면 부팅을 거절한다', () => {
    expect(() =>
      parseConfig({ ...base, MAX_ROOMS: '4', MAX_SLOTS: '24', LOBBY_MAX_ROOMS: '3' }),
    ).toThrow('LOBBY_MAX_ROOMS must not be below MAX_ROOMS');
    expect(() => parseConfig({ ...base, LOBBY_MAX_ROOMS: '51' })).toThrow();
  });
});
