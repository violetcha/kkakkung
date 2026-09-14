// D-06 / IN-06. 입력 인식의 첫 수치. 한 판 실행 중에는 바뀌지 않는다.
// 서버 행동 시간(move 9 Tick=450ms, turn 6 Tick=300ms)과 다른 값이며 섞지 않는다.

/** 이 버전은 검사 증거에 남긴다. sensorTuningVersion은 D, poseTuningVersion은 C가 소유한다. */
export const SENSOR_TUNING_VERSION = 'D-input-4-shoulder-span';

export type InputTuning = Readonly<{
  tuningVersion: string;
  /**
   * 발동·해제 임계를 분리해 경계 노이즈에서 반복 명령이 나오지 않게 한다.
   * 전후 값은 라디안이 아니라 어깨 거리 신호 ln(현재/중립) 이다(pose-sensor leanSignal).
   */
  forwardEnterRad: number;
  forwardExitRad: number;
  backEnterRad: number;
  backExitRad: number;
  turnEnterRad: number;
  turnExitRad: number;
  /** 각 의도가 발동으로 인정되기까지 유지해야 하는 시간. */
  forwardHoldMs: number;
  backHoldMs: number;
  turnHoldMs: number;
  /** 중립 복귀로 인정하는 안정 구간. */
  neutralHoldMs: number;
  /** 보정에 필요한 신선한 서로 다른 표본 수와 허용 산포. */
  calibrationMinSamples: number;
  calibrationMaxSpreadRad: number;
  /** One Euro Filter 설정. */
  filterMinCutoffHz: number;
  filterBeta: number;
  filterDerivativeCutoffHz: number;
  /** 이 간격을 넘으면 필터와 hold를 안전 초기화한다. */
  filterMaxGapMs: number;
}>;

export const INPUT_TUNING: InputTuning = Object.freeze({
  tuningVersion: SENSOR_TUNING_VERSION,
  forwardEnterRad: 0.12, // 어깨 거리 +13% (55cm 거리에서 약 6cm 앞). 실기기 1차: 0.15 는 둔함
  forwardExitRad: 0.06, // +6%
  backEnterRad: 0.09, // -9% (약 5cm 뒤; 의자 등받이 때문에 앞보다 낮게)
  backExitRad: 0.045, // -4.4%
  turnEnterRad: 0.3491, // 20도
  turnExitRad: 0.2094, // 12도
  forwardHoldMs: 180,
  backHoldMs: 320,
  turnHoldMs: 150,
  neutralHoldMs: 150,
  calibrationMinSamples: 8,
  calibrationMaxSpreadRad: 0.1745, // 10도
  filterMinCutoffHz: 1,
  filterBeta: 0.01,
  filterDerivativeCutoffHz: 1,
  filterMaxGapMs: 500,
});

/** 서버 권위 행동 시간. 로컬 인식 지연 상수와 구분하기 위해 함께 적어 둔다. */
export const SERVER_ACTION_MS = Object.freeze({ move: 450, turn: 300 });

/**
 * 고개가 이만큼 돌아가 있으면 전후 이동 판정을 만들지 않는다(회전 해제 임계와 같은 값).
 * 고개를 돌리면 어깨 x 거리가 줄고 모델 추정도 흔들려 앞뒤로 오인식된다. 회전은 별도 행동이다.
 */
export function headTurnedForMove(
  relativeYawRad: number | null,
  tuning: InputTuning = INPUT_TUNING,
): boolean {
  return relativeYawRad !== null && Number.isFinite(relativeYawRad)
    ? Math.abs(relativeYawRad) > tuning.turnExitRad
    : false;
}
