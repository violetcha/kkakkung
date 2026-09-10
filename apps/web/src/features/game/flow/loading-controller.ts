import type { LoadingView, PrivateView, PublicRoundState } from '@kkakkung/protocol/game-schema';
import type { MediaBindings, MediaStatus } from '../../input/InteractionRuntime';
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
    check(view: PrivateView | null, bindings: MediaBindings | null, media: MediaStatus | null) {
      if (
        !current ||
        sent ||
        !assetReady ||
        view?.self?.status !== 'ACTIVE' ||
        view.stateVersion < current.initialViewVersion ||
        media?.state !== 'connected'
      )
        return false;
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
      sent = true;
      send({
        loadId: current.loadId,
        mediaInstanceId: current.mediaInstanceId,
        receiverGeneration: current.receiverGeneration,
      });
      return true;
    },
    clear() {
      current = null;
      key = '';
      sent = false;
      assetReady = false;
    },
  };
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
