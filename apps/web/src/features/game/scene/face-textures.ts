import { SRGBColorSpace, VideoTexture } from 'three';
import type { FaceTrackEvent, MediaScope } from '../../input/InteractionRuntime';

type Disposable = { dispose(): void };
const scopeKey = (scope: MediaScope) =>
  `${scope.matchId}:${scope.mediaInstanceId}:${scope.receiverGeneration}`;
const trackKey = (event: FaceTrackEvent) =>
  `${scopeKey(event)}:${event.playerId}:${event.publisherGeneration}:${event.trackSid}`;
/** D owns videos/tracks. C owns only textures for the currently visible set. */
export function videoFaceTexture(video: HTMLVideoElement) {
  const texture = new VideoTexture(video);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
export function createFaceTextures<T extends Disposable>(factory: (video: HTMLVideoElement) => T) {
  let scope: string | null = null;
  let visible = new Set<string>();
  const tracks = new Map<string, FaceTrackEvent>();
  const textures = new Map<string, T>();
  const drop = (id: string) => {
    textures.get(id)?.dispose();
    textures.delete(id);
  };
  const clear = () => {
    for (const id of textures.keys()) drop(id);
    tracks.clear();
  };
  function reconcile() {
    for (const id of textures.keys()) if (!visible.has(id) || !tracks.get(id)?.element) drop(id);
    for (const id of visible) {
      const element = tracks.get(id)?.element;
      if (element && !textures.has(id)) textures.set(id, factory(element));
    }
  }
  return {
    setScope(next: MediaScope | null) {
      const key = next ? scopeKey(next) : null;
      if (key !== scope) {
        clear();
        scope = key;
      }
    },
    receive(event: FaceTrackEvent) {
      if (scopeKey(event) !== scope) return false;
      const old = tracks.get(event.playerId);
      if (!event.element) {
        if (!old || trackKey(old) !== trackKey(event)) return false;
        drop(event.playerId);
        tracks.delete(event.playerId);
      } else {
        if (old && old.publisherGeneration > event.publisherGeneration) return false;
        if (old && trackKey(old) === trackKey(event) && old.element === event.element) return false;
        drop(event.playerId);
        tracks.set(event.playerId, event);
      }
      reconcile();
      return true;
    },
    visible(ids: readonly string[]) {
      visible = new Set(ids);
      reconcile();
    },
    get(id: string) {
      return textures.get(id) ?? null;
    },
    clear() {
      clear();
      visible.clear();
      scope = null;
    },
    get count() {
      return textures.size;
    },
    /** S15P21C204-407. 지금 텍스처가 붙은 참가자 ID(진단용). */
    boundIds(): string[] {
      return [...textures.keys()];
    },
  };
}
export type FaceTextures = ReturnType<typeof createFaceTextures<VideoTexture>>;
