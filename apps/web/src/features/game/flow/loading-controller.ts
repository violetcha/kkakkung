import type { LoadingView, PrivateView, PublicRoundState } from '@kkakkung/protocol/game-schema';
import type { MediaBindings, MediaStatus } from '../../input/InteractionRuntime';
import type { ReadinessCause, ReadinessStage, ReadinessTrace } from '../../devices/readiness-trace';
export const SCENE_ASSET_VERSION = 'c-primitives-1';
export function createLoadingController(
  send: (payload: { loadId: string; mediaInstanceId: string; receiverGeneration: number }) => void,
) {
  let key = '';
  let current: LoadingView | null = null;
  let sent = false;
  let assetReady = false;
  return {
    update(round: PublicRoundState, view: PrivateView | null) {
      const loading =
        round.phase === 'GAME_LOADING' &&
        view?.gameScope.kind === 'game' &&
        view.self?.status === 'ACTIVE'
          ? view.self.loading
          : null;
      const nextKey = loading
        ? `${round.matchId}:${view!.gameScope.revision}:${view!.gameScope.gameInstanceId}:${loading.loadId}:${loading.mediaInstanceId}:${loading.receiverGeneration}:${loading.assetVersion}`
        : '';
      if (nextKey !== key) {
        key = nextKey;
        current = loading;
        sent = false;
        assetReady = false;
      }
      return key;
    },
    assetsLoaded(loadKey: string, version: string) {
      if (loadKey === key && current?.assetVersion === version) assetReady = true;
    },
    /**
     * `mediaRequired`가 false 이면(관리자 데모 방, S15P21C204-260) 카메라 연결·얼굴 게시 없이
     * 자산과 초기 화면만 확인하고 보고한다. 서버도 그 방에서는 얼굴 확인을 기다리지 않는다.
     */
    check(
      view: PrivateView | null,
      bindings: MediaBindings | null,
      media: MediaStatus | null,
      { mediaRequired = true }: { mediaRequired?: boolean } = {},
    ) {
      if (
        !current ||
        sent ||
        !assetReady ||
        view?.self?.status !== 'ACTIVE' ||
        view.stateVersion < current.initialViewVersion
      )
        return false;
      if (mediaRequired) {
        if (media?.state !== 'connected') return false;
        if (
          media.matchId !== view.matchId ||
          media.mediaInstanceId !== current.mediaInstanceId ||
          media.receiverGeneration !== current.receiverGeneration
        )
          return false;
        if (
          !bindings ||
          bindings.matchId !== view.matchId ||
          bindings.mediaInstanceId !== current.mediaInstanceId ||
          bindings.receiverGeneration !== current.receiverGeneration
        )
          return false;
        const self = bindings.participants.find((p) => p.playerId === view.self?.playerId);
        if (!self?.faceTrackSid || self.publisherGeneration !== current.receiverGeneration)
          return false;
      }
      sent = true;
      send({
        loadId: current.loadId,
        mediaInstanceId: current.mediaInstanceId,
        receiverGeneration: current.receiverGeneration,
      });
      return true;
    },
    /**
     * 사용자에게 보여 줄 "아직 기다리는 것" 목록. check() 와 같은 조건을 읽기 전용으로 본다.
     * 이미 보고를 보냈으면 다른 참가자를 기다리는 중이므로 빈 배열이다.
     */
    pending(
      view: PrivateView | null,
      bindings: MediaBindings | null,
      media: MediaStatus | null,
      { mediaRequired = true }: { mediaRequired?: boolean } = {},
    ): string[] {
      if (!current || sent) return [];
      const waiting: string[] = [];
      if (!assetReady) waiting.push('경기장 자산');
      if (view?.self?.status !== 'ACTIVE' || view.stateVersion < current.initialViewVersion)
        waiting.push('초기 화면');
      if (!mediaRequired) return waiting;
      if (
        media?.state !== 'connected' ||
        media.matchId !== view?.matchId ||
        media.mediaInstanceId !== current.mediaInstanceId ||
        media.receiverGeneration !== current.receiverGeneration
      )
        waiting.push('카메라 연결');
      const self = bindings?.participants.find((p) => p.playerId === view?.self?.playerId);
      if (
        !bindings ||
        bindings.mediaInstanceId !== current.mediaInstanceId ||
        bindings.receiverGeneration !== current.receiverGeneration ||
        !self?.faceTrackSid ||
        self.publisherGeneration !== current.receiverGeneration
      )
        waiting.push('내 얼굴 게시 확인');
      return waiting;
    },
    clear() {
      current = null;
      key = '';
      sent = false;
      assetReady = false;
    },
  };
}
const STAGE_LABELS: Record<ReadinessStage, string> = {
  permission: '권한 확인',
  'device-open': '카메라 열기',
  'model-load': '인식 모델 준비',
  'first-publish': '얼굴 전송',
};
const CAUSE_LABELS: Record<Exclude<ReadinessCause, null>, string> = {
  'permission-denied': '카메라 권한이 거부됨',
  'device-in-use': '다른 앱이 카메라를 사용 중',
  'device-missing': '카메라를 찾지 못함',
  'model-load': '인식 모델을 불러오지 못함',
  'publish-failed': '얼굴 전송 실패',
  'client-slow': '기기 응답이 늦음',
};
/** 대기 항목이 기다리는 클라이언트 단계. 서버 응답 대기는 어느 단계에도 들어 있지 않다. */
const PENDING_STAGES: Readonly<Record<string, readonly ReadinessStage[]>> = {
  '카메라 연결': ['permission', 'device-open'],
  '내 얼굴 게시 확인': ['model-load', 'first-publish'],
};

/**
 * S15P21C204-254. 대기 항목에 막힌 클라이언트 단계와 원인·경과 시간을 붙인다.
 * 원인이 없으면 시간만 붙이며 "문제 없음"으로 표시하지 않는다. 해당 단계가 모두 끝났으면
 * 서버나 연결 쪽을 기다리는 것이므로 항목을 그대로 둔다.
 */
export function describePending(
  pending: readonly string[],
  trace: ReadinessTrace | null,
): string[] {
  return pending.map((item) => {
    const stages = PENDING_STAGES[item];
    if (!trace || !stages) return item;
    const blocked = trace.stages.find(
      (record) =>
        stages.includes(record.stage) && (record.state === 'failed' || record.state === 'running'),
    );
    if (!blocked) return item;
    // 진행 중 단계의 원인은 예산 초과 판정뿐이므로 실패 원인처럼 쓰지 않는다.
    const cause =
      trace.blockedStage !== blocked.stage || !trace.cause
        ? ''
        : blocked.state === 'running'
          ? ' · 예상보다 오래 걸림'
          : ` · ${CAUSE_LABELS[trace.cause]}`;
    const seconds =
      blocked.durationMs === null ? '' : ` ${Math.floor(blocked.durationMs / 1000)}초`;
    const state = blocked.state === 'failed' ? '실패' : '중';
    return `${item}(${STAGE_LABELS[blocked.stage]} ${state}${seconds}${cause})`;
  });
}

export function loadingDisplay(round: PublicRoundState, serverNow: number | null) {
  return {
    covered: round.phase !== 'PLAYING' && round.phase !== 'TEAM_PRACTICE',
    countdown:
      round.phase === 'COUNTDOWN' && round.startAt !== null && serverNow !== null
        ? Math.max(0, Math.ceil((round.startAt - serverNow) / 1000))
        : null,
    remaining:
      round.deadlineTick === null
        ? null
        : Math.max(0, Math.ceil((round.deadlineTick - round.serverTick) / 20)),
  };
}
