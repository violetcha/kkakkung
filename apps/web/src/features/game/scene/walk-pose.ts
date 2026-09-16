/**
 * S15P21C204-262. 상대 캐릭터의 걷기 자세. 서버 이동 행동의 보간 진행도(0~1)만 입력으로 받아
 * 팔다리 회전과 몸 높이를 돌려준다. 위치·방향은 건드리지 않고 미래를 예측하지 않는다.
 * 한 칸(9 Tick·450ms)이 두 걸음(왼발·오른발) 한 사이클이다.
 */
export const WALK = Object.freeze({
  /** 다리 앞뒤 스윙 최대각(rad). */
  legSwingRad: 0.55,
  /** 팔 앞뒤 스윙 최대각(rad). 다리와 반대 위상이다. */
  armSwingRad: 0.4,
  /** 걸음마다 몸이 오르는 높이. 두 걸음이므로 사이클에 두 번 오른다. */
  bobHeight: 0.018,
});

export type WalkPose = Readonly<{
  /** 왼쪽(side=-1)·오른쪽(side=+1) 다리의 X축 회전. 앞으로 나가는 다리가 양수다. */
  leg: readonly [number, number];
  arm: readonly [number, number];
  bob: number;
}>;

export const IDLE_POSE: WalkPose = Object.freeze({
  leg: Object.freeze([0, 0] as const),
  arm: Object.freeze([0, 0] as const),
  bob: 0,
});

export function walkPose(stride: number | null): WalkPose {
  if (stride === null || !Number.isFinite(stride)) return IDLE_POSE;
  const phase = Math.min(1, Math.max(0, stride)) * 2 * Math.PI;
  const swing = Math.sin(phase);
  // 이동 시작·끝에서는 기본 자세로 돌아와 다음 행동(정지·회전)과 이어진다.
  return {
    leg: [WALK.legSwingRad * swing, -WALK.legSwingRad * swing],
    arm: [-WALK.armSwingRad * swing, WALK.armSwingRad * swing],
    bob: (WALK.bobHeight * (1 - Math.cos(2 * phase))) / 2,
  };
}
