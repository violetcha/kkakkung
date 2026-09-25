/**
 * S15P21C204-394. 미디어 HTTP 요청이 거절된 이유. 전에는 2xx 가 아니면 모두 `MEDIA_UNAVAILABLE`로
 * 던져 서버 거절 코드 8개(media.md 5.2)가 화면에 닿지 않았다. 코드는 서버 응답 `{ error }`에서 읽는다.
 */
export class MediaRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(code ?? `HTTP_${status}`);
    this.name = 'MediaRequestError';
  }
}

/** 응답 본문에서 서버 거절 코드를 읽는다. 본문이 없거나 모양이 다르면 null. */
export async function mediaRequestError(response: {
  status: number;
  json(): Promise<unknown>;
}): Promise<MediaRequestError> {
  const body: unknown =
    typeof response.json === 'function' ? await response.json().catch(() => null) : null;
  const code =
    typeof body === 'object' &&
    body !== null &&
    typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : null;
  return new MediaRequestError(response.status, code);
}

const LABELS: Readonly<Record<string, string>> = {
  NOT_READY: '서버가 아직 영상·음성을 연결할 준비가 되지 않았습니다.',
  WRONG_SCOPE: '경기 정보가 바뀌어 연결을 다시 시도해야 합니다.',
  STALE_GENERATION: '이전 영상·음성 연결을 정리하는 중입니다.',
  RETIREMENT_UNCONFIRMED: '이전 영상·음성 연결을 정리하는 중입니다.',
  BUDGET_EXHAUSTED: '이번 달 영상·음성 사용량이 한도에 가까워 연결하지 않았습니다.',
  REMOTE_UNAVAILABLE: '영상·음성 서버에 닿지 못했습니다.',
  TIMEOUT: '연결 요청 시간이 지났습니다.',
  POLICY_UNKNOWN: '서버가 연결 결과를 확인하지 못했습니다.',
  INVALID_SESSION: '세션이 끝났습니다. 방에 다시 들어와 주세요.',
  MEDIA_UNAVAILABLE: '이 서버는 영상·음성을 쓰지 않습니다.',
};

/** 화면에 띄울 준비 실패 문구. 어느 단계에서, 서버가 어떤 코드로 거절했는지 함께 적는다. */
export function mediaFailureText(stage: string, error: unknown): string {
  const code = error instanceof MediaRequestError ? error.code : null;
  const label = code ? LABELS[code] : undefined;
  return `미디어 준비에 실패했습니다.${label ? ` ${label}` : ''} (${stage}${code ? ` · ${code}` : ''})`;
}
