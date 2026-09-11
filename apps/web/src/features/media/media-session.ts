// D-13 / ME-03. 승인된 미디어 세대의 클라이언트 연결.
// 서버가 승인한 Room·Identity·generation만 쓰고 autoSubscribe=false로 연결한다.
// autoSubscribe=false는 SFU 접근 통제 완료가 아니다. 강제 권한은 E가 서버에서 확인한다.
import {
  IDLE_MEDIA_STATUS,
  isMediaConnectPhase,
  isSameScope,
  ROOM_EVENTS,
  type MediaFailureCode,
  type MediaGrant,
  type MediaRoomFactory,
  type MediaRoomPort,
  type MediaScope,
  type MediaStatus,
} from './media-types';

export type MediaSessionDeps = Readonly<{
  createRoom: MediaRoomFactory;
  onStatus(status: MediaStatus): void;
  /** epoch 초. grant 만료 확인에만 쓴다. */
  epochNowSeconds(): number;
  /** 현재 권위 phase. C가 준 문맥에서 읽는다. */
  getPhase(): string | null;
}>;

export interface MediaSession {
  /** 승인된 grant로 연결한다. 세대별 Promise 하나로 직렬화한다. */
  connect(grant: MediaGrant): Promise<void>;
  /** 현재 세대를 끊는다. 논리 참가 종료와 다르다. */
  retire(): Promise<void>;
  getStatus(): MediaStatus;
  getScope(): MediaScope | null;
  getRoom(): MediaRoomPort | null;
  dispose(): Promise<void>;
}

export class MediaConnectionError extends Error {
  constructor(readonly code: MediaFailureCode) {
    super(code);
    this.name = 'MediaConnectionError';
  }
}

function scopeOf(grant: MediaGrant): MediaScope {
  return {
    matchId: grant.matchId,
    mediaInstanceId: grant.mediaInstanceId,
    receiverGeneration: grant.receiverGeneration,
  };
}

function isCompleteGrant(grant: MediaGrant): boolean {
  return (
    (grant.subscriptionMode === undefined || grant.subscriptionMode === 'publisher-permissions') &&
    typeof grant.url === 'string' &&
    grant.url.length > 0 &&
    typeof grant.token === 'string' &&
    grant.token.length > 0 &&
    typeof grant.roomName === 'string' &&
    grant.roomName.length > 0 &&
    typeof grant.mediaIdentity === 'string' &&
    grant.mediaIdentity.length > 0 &&
    Number.isFinite(grant.receiverGeneration)
  );
}

export function createMediaSession(deps: MediaSessionDeps): MediaSession {
  let status: MediaStatus = IDLE_MEDIA_STATUS;
  let scope: MediaScope | null = null;
  let room: MediaRoomPort | null = null;
  let pending: Promise<void> | null = null;
  let pendingScope: MediaScope | null = null;
  // 회수/폐기가 이 값을 올려 늦게 도착한 연결 성공을 무효로 만든다.
  let connectionEpoch = 0;
  let disposed = false;
  const teardowns = new WeakMap<MediaRoomPort, Promise<void>>();

  const publish = (next: MediaStatus) => {
    if (
      status.matchId === next.matchId &&
      status.mediaInstanceId === next.mediaInstanceId &&
      status.receiverGeneration === next.receiverGeneration &&
      status.state === next.state &&
      status.code === next.code
    )
      return;
    status = next;
    if (!disposed) deps.onStatus(next);
  };

  const publishScoped = (current: MediaScope, state: MediaStatus['state'], code: string | null) => {
    publish({ ...current, state, code });
  };

  const teardown = async (target: MediaRoomPort | null) => {
    if (!target) return;
    let running = teardowns.get(target);
    if (!running) {
      target.removeAllListeners();
      running = target.disconnect();
      teardowns.set(target, running);
    }
    await running;
  };

  const bindEvents = (target: MediaRoomPort, current: MediaScope) => {
    const guard = (handler: () => void) => () => {
      // 구 세대 이벤트는 현재 상태를 바꾸지 않는다.
      if (disposed || !scope || !isSameScope(scope, current)) return;
      handler();
    };
    // connected는 SDK 연결 성공일 뿐 서버 권한·바인딩 준비 완료가 아니다.
    target.on(
      ROOM_EVENTS.connected,
      guard(() => publishScoped(current, 'connected', null)),
    );
    target.on(
      ROOM_EVENTS.reconnecting,
      guard(() => publishScoped(current, 'recovering', 'RECONNECTING')),
    );
    target.on(
      ROOM_EVENTS.signalReconnecting,
      guard(() => publishScoped(current, 'recovering', 'SIGNAL_RECONNECTING')),
    );
    target.on(
      ROOM_EVENTS.reconnected,
      guard(() => publishScoped(current, 'connected', null)),
    );
    target.on(
      ROOM_EVENTS.disconnected,
      guard(() => publishScoped(current, 'closed', 'DISCONNECTED')),
    );
  };

  const start = async (grant: MediaGrant, epoch: number): Promise<void> => {
    const current = scopeOf(grant);
    const target = deps.createRoom();
    room = target;
    scope = current;
    publishScoped(current, 'connecting', null);
    bindEvents(target, current);
    try {
      // 승인 URL/token을 그대로 쓴다. 토큰은 메모리에만 둔다.
      await target.connect(grant.url, grant.token, {
        autoSubscribe: false,
        ...(grant.subscriptionMode ? { subscriptionMode: grant.subscriptionMode } : {}),
      });
    } catch {
      await teardown(target);
      if (epoch !== connectionEpoch || disposed) return;
      pendingScope = null;
      room = null;
      scope = null;
      publishScoped(current, 'failed', 'CONNECT_FAILED');
      throw new MediaConnectionError('CONNECT_FAILED');
    }
    // 연결 중 회수/폐기가 있었으면 늦은 성공을 즉시 정리한다. ready도 게시도 없다.
    if (disposed || epoch !== connectionEpoch) {
      await teardown(target);
      return;
    }
    pendingScope = null;
    room = target;
    scope = current;
    publishScoped(current, 'connected', null);
  };

  return {
    async connect(grant) {
      if (disposed) throw new MediaConnectionError('DISPOSED');
      if (!isCompleteGrant(grant)) throw new MediaConnectionError('GRANT_INCOMPLETE');
      const phase = deps.getPhase();
      // LOBBY/DEVICE_CHECK에서는 연결하지 않는다.
      if (!phase || !isMediaConnectPhase(phase))
        throw new MediaConnectionError('PHASE_NOT_ALLOWED');
      if (grant.expiresAt <= deps.epochNowSeconds())
        throw new MediaConnectionError('GRANT_EXPIRED');

      const current = scopeOf(grant);
      // 같은 세대의 중복 요청은 진행 중 Promise를 재사용한다. 동기 구간에서 판정한다.
      if (pending && pendingScope && isSameScope(pendingScope, current)) return pending;
      if (room && scope && isSameScope(scope, current)) return;

      const epoch = ++connectionEpoch;
      pendingScope = current;
      const previous = room;
      const previousPending = pending;
      room = null;
      scope = null;
      // 같은 참가자의 전체 Room 연결이 둘 이상 살아 있지 않게 한다.
      const running = teardown(previous)
        .then(() => previousPending?.catch(() => undefined))
        .then(() => {
          if (disposed || epoch !== connectionEpoch) return;
          return start(grant, epoch);
        })
        .finally(() => {
          if (pending === running) pending = null;
        });
      pending = running;
      return running;
    },

    async retire() {
      const current = scope ?? pendingScope;
      const target = room;
      const connecting = pending;
      connectionEpoch += 1;
      room = null;
      scope = null;
      pendingScope = null;
      await teardown(target);
      await connecting?.catch(() => undefined);
      if (current) publishScoped(current, 'closed', 'RETIRED');
      else publish(IDLE_MEDIA_STATUS);
    },

    getStatus: () => status,
    getScope: () => scope,
    getRoom: () => room,

    async dispose() {
      if (disposed) return;
      disposed = true;
      connectionEpoch += 1;
      const target = room;
      const connecting = pending;
      room = null;
      scope = null;
      pendingScope = null;
      await teardown(target);
      await connecting?.catch(() => undefined);
    },
  };
}
