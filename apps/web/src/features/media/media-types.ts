// D-13 / ME-03. 미디어 계약의 소비자 사본과 SDK 주입 port.
// EXEC-CONTRACT-3 contracts/types.ts의 MediaScope/MediaGrant/MediaStatus와 같은 모양이다.
// MediaScope는 게임 지식의 PrivateView.gameScope와 독립이다.
// gameInstanceId를 mediaInstanceId로 복사하거나 receiverGeneration에서 논리 revision을 만들지 않는다.

export type MediaScope = Readonly<{
  matchId: string;
  mediaInstanceId: string;
  /** 이 메시지를 받는 플레이어 자신의 연결 세대. 원격 publisherGeneration과 섞지 않는다. */
  receiverGeneration: number;
}>;

export type MediaGrant = MediaScope &
  Readonly<{
    url: string;
    token: string;
    roomName: string;
    mediaIdentity: string;
    /** epoch 초. 서버 monotonic ms와 다른 시간축이다. */
    expiresAt: number;
  }>;

export type MediaGrantRequest = Readonly<{
  matchId: string;
  purpose: 'practice' | 'game';
  previousReceiverGeneration?: number;
}>;

export type MediaConnectionState =
  'idle' | 'connecting' | 'connected' | 'recovering' | 'closed' | 'failed';

export type MediaStatus = Readonly<{
  matchId: string | null;
  mediaInstanceId: string | null;
  receiverGeneration: number | null;
  state: MediaConnectionState;
  code: string | null;
}>;

export type MediaStatusReport = MediaScope &
  Readonly<{ status: 'ready' | 'recovering' | 'failed' | 'closed' }>;

export type MediaRefreshRequest = MediaScope & Readonly<{ lastBindingRevision: number }>;

export const IDLE_MEDIA_STATUS: MediaStatus = Object.freeze({
  matchId: null,
  mediaInstanceId: null,
  receiverGeneration: null,
  state: 'idle',
  code: null,
});

export type MediaFailureCode =
  | 'GRANT_SCOPE_MISMATCH'
  | 'GRANT_EXPIRED'
  | 'GRANT_INCOMPLETE'
  | 'PHASE_NOT_ALLOWED'
  | 'CONNECT_FAILED'
  | 'DISPOSED';

/** 연결을 허용하는 phase. LOBBY/DEVICE_CHECK에서는 연결하지 않는다. */
export const MEDIA_CONNECT_PHASES = Object.freeze([
  'TEAM_PRACTICE',
  'MAP_FINALIZING',
  'GAME_LOADING',
  'COUNTDOWN',
  'PLAYING',
]);

export function isMediaConnectPhase(phase: string): boolean {
  return MEDIA_CONNECT_PHASES.includes(phase);
}

export function isSameScope(left: MediaScope, right: MediaScope): boolean {
  return (
    left.matchId === right.matchId &&
    left.mediaInstanceId === right.mediaInstanceId &&
    left.receiverGeneration === right.receiverGeneration
  );
}

/** 실제 SDK Room의 최소 인터페이스. Node 시험에서 주입한다. */
export interface MediaRoomPort {
  connect(url: string, token: string, options: { autoSubscribe: false }): Promise<void>;
  disconnect(): Promise<void>;
  on(event: string, listener: (...args: unknown[]) => void): void;
  removeAllListeners(): void;
}

export type MediaRoomFactory = () => MediaRoomPort;

/** livekit-client 2.22.2의 RoomEvent 이름. D의 RoomEvent와 서버 Webhook 이름을 섞지 않는다. */
export const ROOM_EVENTS = Object.freeze({
  connected: 'connected',
  reconnecting: 'reconnecting',
  signalReconnecting: 'signalReconnecting',
  reconnected: 'reconnected',
  disconnected: 'disconnected',
});
