// S15P21C204-276. 경기 화면 좌하단 사건 로그.
// 이미 울린 안내음(261)을 같은 순간의 글줄로 바꾼다. 새 판정을 만들지 않는다.
import type { CueKind } from '../../media/cue-buffer';

export type MatchEvent = Readonly<{ id: number; text: string; atMs: number }>;

/** 한 번에 보이는 줄 수와 한 줄이 남아 있는 시간. */
export const EVENT_LINES = 4;
export const EVENT_TTL_MS = 6000;

/** 카운트다운은 매 초 울려 다른 줄을 밀어내므로 로그에 남기지 않는다. */
const TEXT: Partial<Record<CueKind, string>> = {
  start: '경기 시작',
  restrained: '덫을 밟았습니다! 3초 동안 움직일 수 없습니다!',
  captured: '포획되었습니다',
  escaped: '탈출했습니다',
  'exit-failed': '탈출에 실패했습니다',
  'exchange-offer': '지도 교환 요청이 왔습니다',
  'exchange-completed': '지도 교환 완료',
  'ally-progress': '우리 팀이 한 걸음 앞섰습니다',
  'enemy-progress': '상대 팀이 한 걸음 앞섰습니다',
  victory: '승리',
  defeat: '패배',
  aborted: '경기 무효',
};

export const eventTextForCue = (kind: CueKind): string | null => TEXT[kind] ?? null;

/** 최근 줄만 들고 있는다. 화면에 안 보이는 줄까지 쌓아 두지 않는다. */
export function appendEvent(
  events: readonly MatchEvent[],
  event: MatchEvent,
): readonly MatchEvent[] {
  return [...events, event].slice(-EVENT_LINES);
}

/** 지금 그릴 줄. 시간이 지난 줄은 스스로 사라진다. */
export function visibleEvents(
  events: readonly MatchEvent[],
  nowMs: number,
  { ttlMs = EVENT_TTL_MS, lines = EVENT_LINES }: { ttlMs?: number; lines?: number } = {},
): readonly MatchEvent[] {
  return events.filter((event) => nowMs - event.atMs < ttlMs).slice(-lines);
}
