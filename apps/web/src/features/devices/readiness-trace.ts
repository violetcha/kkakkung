// S15P21C204-240. 준비 대기 항목의 클라이언트 단계 기록.
// S15P21C204-217이 서버 로그와 대기 항목 표시를 붙였지만, "카메라 연결"과 "내 얼굴 게시
// 확인"이 30초를 넘겨도 원인이 클라이언트인지 서버인지 가릴 수 없었다. 여기서는 클라이언트가
// 실제로 한 일만 단계별로 재고, 서버 응답 대기 구간은 기록하지 않는다.

/** 준비 실패로 보는 경계. S15P21C204-217이 쓰는 대기 한도와 같다. */
export const READINESS_BUDGET_MS = 30_000;

export type ReadinessStage =
  /** getUserMedia 호출부터 해결까지. 권한 프롬프트 대기가 여기 포함된다. */
  | 'permission'
  /** 스트림 획득부터 카메라 트랙 live·미리보기 부착까지. */
  | 'device-open'
  /** 비전 Worker 기동부터 세 모델 적재 완료까지. */
  | 'model-load'
  /** 게시 요청부터 얼굴 트랙 SID 확보까지. */
  | 'first-publish';

export const READINESS_STAGES: readonly ReadinessStage[] = Object.freeze([
  'permission',
  'device-open',
  'model-load',
  'first-publish',
]);

export type StageState = 'pending' | 'running' | 'done' | 'failed';

export type StageRecord = Readonly<{
  stage: ReadinessStage;
  state: StageState;
  startedAtMs: number | null;
  endedAtMs: number | null;
  /** 진행 중이면 지금까지 걸린 시간이다. 시작 전이면 null. */
  durationMs: number | null;
  errorCode: string | null;
}>;

/**
 * 지연·실패의 1차 원인. 준비 화면 대기 항목과 증거에 같은 값을 쓴다.
 * null 은 아직 원인을 말할 수 없다는 뜻이며 "문제 없음"이 아니다.
 */
export type ReadinessCause =
  | 'permission-denied'
  | 'device-in-use'
  | 'device-missing'
  | 'model-load'
  | 'publish-failed'
  | 'client-slow'
  | null;

/**
 * 30초 초과 표본을 장치/브라우저 조합으로 되찾기 위한 최소 정보.
 * DeviceStatus 에는 넣지 않는다. 그쪽은 안전 code 만 담기로 한 자리다.
 */
export type ClientEnvironment = Readonly<{
  browser: string;
  browserVersion: string;
  platform: string;
  /** 카메라 제품명. 권한 전에는 빈 문자열이라 null 로 둔다. */
  cameraLabel: string | null;
  cameraWidth: number | null;
  cameraHeight: number | null;
  cameraFrameRate: number | null;
}>;

export type ReadinessTrace = Readonly<{
  stages: readonly StageRecord[];
  startedAtMs: number | null;
  /** 첫 단계 시작부터 지금까지. 아직 시작 전이면 0. */
  elapsedMs: number;
  overBudget: boolean;
  /** 지금 막혀 있는 단계. 전부 끝났으면 null. */
  blockedStage: ReadinessStage | null;
  cause: ReadinessCause;
  environment: ClientEnvironment | null;
}>;

/**
 * 오류 code 를 원인으로 옮긴다. code 는 device-status.deviceErrorCode 와
 * 비전/게시 경로가 내는 값이다.
 */
export function causeForErrorCode(code: string | null): ReadinessCause {
  switch (code) {
    case 'PERMISSION_DENIED':
      return 'permission-denied';
    case 'DEVICE_IN_USE':
      return 'device-in-use';
    case 'DEVICE_NOT_FOUND':
    case 'DEVICE_UNAVAILABLE':
      return 'device-missing';
    case 'MODEL_LOAD_TIMEOUT':
    case 'MODEL_LOAD_FAILED':
    case 'MODEL_HASH_MISMATCH':
    case 'VISION_START_FAILED':
      return 'model-load';
    case 'PUBLISH_FAILED':
    case 'RAW_TRACK_REJECTED':
      return 'publish-failed';
    default:
      return code === null ? null : 'client-slow';
  }
}

/** 단계가 막혔을 때 오류 없이도 말할 수 있는 원인. */
function causeForStage(stage: ReadinessStage): ReadinessCause {
  return stage === 'model-load' ? 'model-load' : 'client-slow';
}

export interface ReadinessRecorder {
  begin(stage: ReadinessStage, nowMs: number): void;
  succeed(stage: ReadinessStage, nowMs: number): void;
  fail(stage: ReadinessStage, nowMs: number, errorCode: string): void;
  setEnvironment(environment: ClientEnvironment | null): void;
  snapshot(nowMs: number): ReadinessTrace;
  reset(): void;
}

type MutableRecord = {
  state: StageState;
  startedAtMs: number | null;
  endedAtMs: number | null;
  errorCode: string | null;
};

function emptyRecord(): MutableRecord {
  return { state: 'pending', startedAtMs: null, endedAtMs: null, errorCode: null };
}

export function createReadinessRecorder(): ReadinessRecorder {
  let records = new Map<ReadinessStage, MutableRecord>(
    READINESS_STAGES.map((stage) => [stage, emptyRecord()]),
  );
  let environment: ClientEnvironment | null = null;

  const get = (stage: ReadinessStage): MutableRecord => records.get(stage)!;

  return {
    begin(stage, nowMs) {
      const record = get(stage);
      // 재시도는 같은 단계를 다시 연다. 이전 실패 code 는 지운다.
      record.state = 'running';
      record.startedAtMs = nowMs;
      record.endedAtMs = null;
      record.errorCode = null;
    },

    succeed(stage, nowMs) {
      const record = get(stage);
      // 시작을 못 본 단계는 완료로 올리지 않는다. 길이를 지어내지 않기 위해서다.
      if (record.startedAtMs === null) return;
      record.state = 'done';
      record.endedAtMs = nowMs;
      record.errorCode = null;
    },

    fail(stage, nowMs, errorCode) {
      const record = get(stage);
      record.state = 'failed';
      record.endedAtMs = nowMs;
      record.errorCode = errorCode;
      if (record.startedAtMs === null) record.startedAtMs = nowMs;
    },

    setEnvironment(value) {
      environment = value;
    },

    snapshot(nowMs) {
      const stages: StageRecord[] = READINESS_STAGES.map((stage) => {
        const record = get(stage);
        const end = record.endedAtMs ?? (record.state === 'running' ? nowMs : null);
        return Object.freeze({
          stage,
          state: record.state,
          startedAtMs: record.startedAtMs,
          endedAtMs: record.endedAtMs,
          durationMs:
            record.startedAtMs === null || end === null
              ? null
              : Math.max(0, end - record.startedAtMs),
          errorCode: record.errorCode,
        });
      });

      const started = stages
        .map((record) => record.startedAtMs)
        .filter((value): value is number => value !== null);
      const startedAtMs = started.length > 0 ? Math.min(...started) : null;
      const elapsedMs = startedAtMs === null ? 0 : Math.max(0, nowMs - startedAtMs);

      const failed = stages.find((record) => record.state === 'failed') ?? null;
      const running = stages.find((record) => record.state === 'running') ?? null;
      const blockedStage = failed?.stage ?? running?.stage ?? null;
      const cause = failed
        ? causeForErrorCode(failed.errorCode)
        : running && elapsedMs > READINESS_BUDGET_MS
          ? causeForStage(running.stage)
          : null;

      return Object.freeze({
        stages: Object.freeze(stages),
        startedAtMs,
        elapsedMs,
        overBudget: elapsedMs > READINESS_BUDGET_MS,
        blockedStage,
        cause,
        environment,
      });
    },

    reset() {
      records = new Map(READINESS_STAGES.map((stage) => [stage, emptyRecord()]));
      environment = null;
    },
  };
}

type UserAgentLike = Readonly<{ userAgent?: string; platform?: string }>;

/** userAgent 에서 브라우저 이름과 major 버전만 뽑는다. 전체 문자열을 증거에 싣지 않는다. */
export function describeBrowser(userAgent: string): { browser: string; browserVersion: string } {
  // 순서가 중요하다. Edge/Opera 는 Chrome 을 함께 적고 Chrome 은 Safari 를 함께 적는다.
  const patterns: readonly (readonly [string, RegExp])[] = [
    ['Edge', /Edg\/(\d+)/],
    ['Opera', /OPR\/(\d+)/],
    ['Samsung Internet', /SamsungBrowser\/(\d+)/],
    ['Firefox', /Firefox\/(\d+)/],
    ['Chrome', /Chrome\/(\d+)/],
    ['Safari', /Version\/(\d+).*Safari/],
  ];
  for (const [browser, pattern] of patterns) {
    const matched = pattern.exec(userAgent);
    if (matched) return { browser, browserVersion: matched[1] ?? 'unknown' };
  }
  return { browser: 'unknown', browserVersion: 'unknown' };
}

/**
 * 30초 초과 표본을 장치 조합으로 되찾기 위한 기술. 카메라 라벨은 제품명이며
 * 이 값은 DeviceStatus 가 아니라 진단 증거에만 들어간다.
 */
export function describeClientEnvironment(
  agent: UserAgentLike | null,
  track: MediaStreamTrack | null,
): ClientEnvironment {
  const { browser, browserVersion } = describeBrowser(agent?.userAgent ?? '');
  const settings = track?.getSettings?.() ?? null;
  const label = track?.label ?? '';
  return Object.freeze({
    browser,
    browserVersion,
    platform: agent?.platform ?? 'unknown',
    cameraLabel: label.length > 0 ? label : null,
    cameraWidth: settings?.width ?? null,
    cameraHeight: settings?.height ?? null,
    cameraFrameRate: settings?.frameRate ?? null,
  });
}
