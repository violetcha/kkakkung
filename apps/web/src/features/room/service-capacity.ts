// S15P21C204-372. 방을 만들기 전에 서비스에 여유가 있는지 보여 준다. 서버는 개수만 알려 준다.
import { useEffect, useState } from 'react';
import {
  SERVICE_CAPACITY_ROUTE,
  serviceCapacitySchema,
  type ServiceCapacity,
} from '@kkakkung/protocol/game-messages';

/** 옛 서버(404)·네트워크 실패·모르는 형식은 모두 null. 표시만 빠지고 입장은 막지 않는다. */
export async function requestServiceCapacity(
  fetcher: typeof fetch = fetch,
): Promise<ServiceCapacity | null> {
  try {
    const response = await fetcher(SERVICE_CAPACITY_ROUTE, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
    });
    if (!response.ok) return null;
    const parsed = serviceCapacitySchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export type CapacityNotice = Readonly<{
  text: string;
  /** 새 방을 만들 수 없다. 참가는 막지 않는다(그 방에 자리가 있을 수 있다). */
  createBlocked: boolean;
}>;

export function capacityNotice(capacity: ServiceCapacity | null): CapacityNotice | null {
  if (!capacity) return null;
  if (!capacity.admissionOpen)
    return {
      text: '지금은 점검 중이라 입장을 받지 않습니다. 잠시 뒤 다시 시도해 주세요.',
      createBlocked: true,
    };
  const matches = `지금 경기 가능 ${Math.max(0, capacity.matchLimit - capacity.matchesInUse)}/${capacity.matchLimit}`;
  if (capacity.lobbyRoomsInUse >= capacity.lobbyRoomLimit)
    return {
      text: `${matches} · 열 수 있는 방이 모두 사용 중입니다. 방 코드로 참가하거나 잠시 뒤 다시 시도해 주세요.`,
      createBlocked: true,
    };
  if (capacity.mediaBlocked)
    return {
      text: '이번 달 영상·음성 사용량이 한도에 가까워 새 경기를 시작할 수 없습니다.',
      createBlocked: false,
    };
  if (capacity.matchesInUse >= capacity.matchLimit)
    return {
      text: `${matches} · 방은 만들 수 있지만 경기를 시작하려면 자리가 날 때까지 기다려야 합니다.`,
      createBlocked: false,
    };
  return { text: matches, createBlocked: false };
}

const REFRESH_MS = 15_000;

/** 홈 화면이 보이는 동안만 불러오고 15초마다 새로 고친다. */
export function useServiceCapacity(enabled: boolean): ServiceCapacity | null {
  const [capacity, setCapacity] = useState<ServiceCapacity | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () =>
      void requestServiceCapacity().then((next) => {
        if (alive) setCapacity(next);
      });
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [enabled]);
  return capacity;
}
