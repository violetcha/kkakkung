// D-06 / IN-06. One Euro Filter.
// 순서: 샘플 dt로 미분 저역필터 -> 적응 cutoff -> 값 저역필터.
// dt<=0, 긴 공백, 비유한 입력은 안전 초기화하고 Infinity/NaN을 다음 단계로 흘리지 않는다.

export type OneEuroConfig = Readonly<{
  minCutoffHz: number;
  beta: number;
  derivativeCutoffHz: number;
  /** 이 간격을 넘는 공백은 새 구간으로 보고 초기화한다. */
  maxGapMs: number;
}>;

export interface OneEuroFilter {
  /** 비유한 입력이나 초기화 직후에는 원값을 그대로 돌려준다. */
  filter(value: number, timestampMs: number): number;
  reset(): void;
  readonly initialized: boolean;
}

/** cutoff와 dt로 저역필터 계수를 만든다. */
export function smoothingAlpha(cutoffHz: number, dtSeconds: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtSeconds);
}

function lowPass(alpha: number, value: number, previous: number): number {
  return alpha * value + (1 - alpha) * previous;
}

export function createOneEuroFilter(config: OneEuroConfig): OneEuroFilter {
  let lastValue = 0;
  let lastDerivative = 0;
  let lastTimestampMs = 0;
  let initialized = false;

  const reset = () => {
    lastValue = 0;
    lastDerivative = 0;
    lastTimestampMs = 0;
    initialized = false;
  };

  return {
    filter(value, timestampMs) {
      if (!Number.isFinite(value) || !Number.isFinite(timestampMs)) {
        // 비유한 입력은 상태를 오염시키지 않고 버린다.
        reset();
        return value;
      }
      const dtMs = timestampMs - lastTimestampMs;
      if (!initialized || dtMs <= 0 || dtMs > config.maxGapMs) {
        lastValue = value;
        lastDerivative = 0;
        lastTimestampMs = timestampMs;
        initialized = true;
        return value;
      }
      const dtSeconds = dtMs / 1000;
      const rawDerivative = (value - lastValue) / dtSeconds;
      const derivative = lowPass(
        smoothingAlpha(config.derivativeCutoffHz, dtSeconds),
        rawDerivative,
        lastDerivative,
      );
      const cutoff = config.minCutoffHz + config.beta * Math.abs(derivative);
      const filtered = lowPass(smoothingAlpha(cutoff, dtSeconds), value, lastValue);
      if (!Number.isFinite(filtered) || !Number.isFinite(derivative)) {
        reset();
        return value;
      }
      lastValue = filtered;
      lastDerivative = derivative;
      lastTimestampMs = timestampMs;
      return filtered;
    },

    reset,

    get initialized() {
      return initialized;
    },
  };
}

export type HysteresisConfig = Readonly<{ enterRad: number; exitRad: number }>;

/**
 * 발동/해제 임계값을 분리한 판정.
 * 경계 주변의 반복 노이즈에서 상태가 계속 뒤집히지 않는다.
 */
export function applyHysteresis(
  active: boolean,
  magnitude: number,
  config: HysteresisConfig,
): boolean {
  if (!Number.isFinite(magnitude)) return false;
  return active ? magnitude >= config.exitRad : magnitude >= config.enterRad;
}
