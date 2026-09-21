export const GRAB_HAND_REACH_MS = 120;
export const GRAB_HAND_SIGNAL_MS = 300;
export const GRAB_HAND_RELEASE_MS = 180;

export type GrabHandMotion = Readonly<{ startedAtMs: number; untilMs: number }>;

/** 반복되는 잡기 명령은 뻗는 동작을 다시 시작하지 않고 유지 시간만 연장한다. */
export function refreshGrabHandMotion(
  previous: GrabHandMotion | null,
  nowMs: number,
): GrabHandMotion {
  const stillVisible = previous !== null && nowMs <= previous.untilMs + GRAB_HAND_RELEASE_MS;
  return {
    startedAtMs: stillVisible ? previous.startedAtMs : nowMs,
    untilMs: nowMs + GRAB_HAND_SIGNAL_MS,
  };
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const easeOut = (value: number) => 1 - (1 - value) ** 3;

/** 0은 화면 밖 대기 자세, 1은 완전히 뻗은 자세다. */
export function grabHandReach(motion: GrabHandMotion | null, nowMs: number): number {
  if (!motion || nowMs < motion.startedAtMs) return 0;
  if (nowMs < motion.startedAtMs + GRAB_HAND_REACH_MS)
    return easeOut(clamp01((nowMs - motion.startedAtMs) / GRAB_HAND_REACH_MS));
  if (nowMs <= motion.untilMs) return 1;
  return 1 - easeOut(clamp01((nowMs - motion.untilMs) / GRAB_HAND_RELEASE_MS));
}
