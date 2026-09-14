// 추적 디버그 오버레이 피드. 제품 판정과 무관한 진단용이며 언제든 제거할 수 있다.
// 제거 방법: 이 폴더 삭제 → solo-session.ts 의 debugFeed 두 줄, SoloPracticeScreen.tsx 의
// <DebugOverlay>·토글·단축키 마운트, styles.css 의 .debug-overlay 규칙,
// InteractionDeps.onMotionDebug 와 features/input/motion-debug.ts 를 지운다.
import { useSyncExternalStore } from 'react';
import type { SensorSnapshot } from '../vision/sensor-types';
import type { MotionDebugState } from '../input/motion-debug';

export type DebugFeedState = Readonly<{
  sensors: SensorSnapshot | null;
  motion: MotionDebugState | null;
  updatedAtMs: number;
}>;

export const DEBUG_OVERLAY_STORAGE_KEY = 'kkakkung.debug-overlay';

let state: DebugFeedState = { sensors: null, motion: null, updatedAtMs: 0 };
let enabled = readStoredEnabled();
const listeners = new Set<() => void>();

function readStoredEnabled(): boolean {
  try {
    return (
      typeof localStorage !== 'undefined' && localStorage.getItem(DEBUG_OVERLAY_STORAGE_KEY) === '1'
    );
  } catch {
    return false;
  }
}

function notify() {
  for (const listener of listeners) listener();
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export const debugFeed = {
  publishSensors(sensors: SensorSnapshot | null) {
    state = { ...state, sensors, updatedAtMs: now() };
  },
  publishMotion(motion: MotionDebugState | null) {
    state = { ...state, motion, updatedAtMs: now() };
  },
  clear() {
    state = { sensors: null, motion: null, updatedAtMs: 0 };
  },
  read(): DebugFeedState {
    return state;
  },
  isEnabled(): boolean {
    return enabled;
  },
  setEnabled(next: boolean) {
    if (next === enabled) return;
    enabled = next;
    try {
      localStorage.setItem(DEBUG_OVERLAY_STORAGE_KEY, next ? '1' : '0');
    } catch {
      // 저장 실패는 무시한다. 이번 세션 안에서만 켜진다.
    }
    notify();
  },
  toggle() {
    debugFeed.setEnabled(!enabled);
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** React 에서 토글 상태를 읽는다. 서버 렌더에서는 항상 꺼져 있다. */
export function useDebugOverlayEnabled(): boolean {
  return useSyncExternalStore(debugFeed.subscribe, debugFeed.isEnabled, () => false);
}

/** Ctrl+Shift+D 로 켜고 끈다. 입력창 안에서는 동작하지 않는다. 해제 함수를 돌려준다. */
export function installDebugShortcut(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>,
) {
  const handler = (event: KeyboardEvent) => {
    if (!event.ctrlKey || !event.shiftKey || event.code !== 'KeyD') return;
    const element = event.target as HTMLElement | null;
    if (element && ['INPUT', 'TEXTAREA'].includes(element.tagName)) return;
    event.preventDefault();
    debugFeed.toggle();
  };
  target.addEventListener('keydown', handler as EventListener);
  return () => target.removeEventListener('keydown', handler as EventListener);
}
