import type { PrivateView, PublicRoundState } from '@kkakkung/protocol/game-schema';
import type { CueKind } from '../../media/cue-buffer';
import type { AudioEffect } from '../../media/audio-policy';

/**
 * S15P21C204-261. 안내음·화면 피드백 판정에 필요한 만큼만 추린 상태. 전부 내 화면에 이미 있는
 * 값(공개 라운드·자기 개인 뷰)이며 다른 참가자의 비공개 정보는 들어오지 않는다.
 */
export type CueState = Readonly<{
  matchId: string | null;
  phase: PublicRoundState['phase'] | null;
  role: 'runner' | 'tagger' | null;
  status: 'ACTIVE' | 'ESCAPED' | 'CAPTURED' | null;
  restrained: boolean;
  escaped: number;
  captured: number;
  winner: 'runners' | 'taggers' | null;
  /** COUNTDOWN 에서 화면에 보이는 남은 초. 그 외에는 null. */
  countdown: number | null;
}>;

export function cueState(input: {
  round: PublicRoundState | null;
  self: PrivateView['self'] | null;
  /** 개인 종료 뒤 view 가 비워진 상태에서도 역할·결과를 읽기 위한 마지막 self. */
  endedSelf: PrivateView['self'] | null;
  tick: number;
  countdown: number | null;
}): CueState {
  const self = input.self ?? input.endedSelf;
  const active = self?.status === 'ACTIVE' ? self : null;
  return {
    matchId: input.round?.matchId ?? null,
    phase: input.round?.phase ?? null,
    role: self?.role ?? null,
    status: self?.status ?? null,
    restrained:
      active !== null &&
      active.restraintUntilTick !== null &&
      input.tick < active.restraintUntilTick,
    escaped: input.round?.counts.escaped ?? 0,
    captured: input.round?.counts.captured ?? 0,
    winner: input.round?.result?.winner ?? null,
    countdown: input.round?.phase === 'COUNTDOWN' ? input.countdown : null,
  };
}

const ENDED: readonly (PublicRoundState['phase'] | null)[] = ['RESULT', 'ABORTED'];
const teamOf = (role: CueState['role']) =>
  role === 'runner' ? 'runners' : role === 'tagger' ? 'taggers' : null;

/**
 * 이전 상태와 비교해 이번에 울릴 안내음을 고른다. 같은 전이에서 자기 종료와 누계 변화, 승패와
 * 누계 변화가 겹치면 더 구체적인 것(자기 종료·승패) 하나만 낸다. 경기가 바뀌면 비교하지 않는다.
 */
export function detectCues(prev: CueState | null, next: CueState): CueKind[] {
  if (!prev || prev.matchId !== next.matchId) return [];
  const cues: CueKind[] = [];
  if (
    next.phase === 'COUNTDOWN' &&
    next.countdown !== null &&
    next.countdown > 0 &&
    next.countdown !== prev.countdown
  )
    cues.push('countdown');
  if (prev.phase === 'COUNTDOWN' && next.phase === 'PLAYING') cues.push('start');
  if (!prev.restrained && next.restrained) cues.push('restrained');

  let ownEnd = false;
  if (prev.status === 'ACTIVE' && next.status === 'CAPTURED') {
    cues.push('captured');
    ownEnd = true;
  } else if (prev.status === 'ACTIVE' && next.status === 'ESCAPED') {
    cues.push('escaped');
    ownEnd = true;
  }

  let decided = false;
  if (!ENDED.includes(prev.phase) && next.phase === 'RESULT' && next.winner) {
    const team = teamOf(next.role);
    cues.push(team === null ? 'aborted' : team === next.winner ? 'victory' : 'defeat');
    decided = true;
  } else if (!ENDED.includes(prev.phase) && next.phase === 'ABORTED') {
    cues.push('aborted');
    decided = true;
  }

  // 누계는 내가 아직 경기 중일 때만 알린다. 내 종료로 오른 누계는 자기 종료 안내음이 대신한다.
  // 라운드와 개인 뷰가 따로 도착하므로 호출 측이 이 둘을 잠시 미뤄 자기 종료와 겹치면 버린다.
  if (!ownEnd && !decided && next.phase === 'PLAYING' && next.status === 'ACTIVE') {
    if (next.escaped > prev.escaped)
      cues.push(next.role === 'runner' ? 'ally-progress' : 'enemy-progress');
    if (next.captured > prev.captured)
      cues.push(next.role === 'tagger' ? 'ally-progress' : 'enemy-progress');
  }
  return cues;
}

/** 누계 안내음은 자기 종료 안내음과 겹칠 수 있어 이 시간만큼 미뤄 낸다. */
export const PROGRESS_CUE_DELAY_MS = 300;
export const PROGRESS_CUES: readonly CueKind[] = ['ally-progress', 'enemy-progress'];
export const isProgressCue = (kind: CueKind) => PROGRESS_CUES.includes(kind);

/** 술래 팀의 공개 포획 누계가 오른 순간에만 내는 서버 확정 화면 피드백. */
export const CAPTURE_PROGRESS_FLASHES = ['capture-success'] as const;
export type CaptureProgressFlash = (typeof CAPTURE_PROGRESS_FLASHES)[number];
export function captureProgressFlash(
  prev: CueState | null,
  next: CueState,
): CaptureProgressFlash | null {
  if (!prev || prev.matchId !== next.matchId) return null;
  if (next.phase !== 'PLAYING' || next.role !== 'tagger' || next.status !== 'ACTIVE') return null;
  return next.captured > prev.captured ? 'capture-success' : null;
}

/** 화면 플래시를 함께 내는 안내음. 나머지는 소리만 낸다. */
export const FLASH_CUES = [
  'captured',
  'escaped',
  'exit-failed',
  'restrained',
  'victory',
  'defeat',
] as const satisfies readonly CueKind[];
export type FlashCue = (typeof FLASH_CUES)[number];
export const isFlashCue = (kind: CueKind): kind is FlashCue =>
  (FLASH_CUES as readonly CueKind[]).includes(kind);

/** 플래시 한 번의 길이. CSS 애니메이션(styles.css)과 같은 값이다. */
export const CUE_FLASH_MS = 900;

/**
 * S15P21C204-307. 서버가 승인해 이미 소리로 도착한 위치 효과음 중 화면 플래시까지 내는 종류.
 * 발소리는 한 칸마다 울려 화면이 번쩍이면 안 되므로 소리만 낸다. 로컬에서 거리를 새로 재지 않고
 * 서버가 들려주기로 한 사건만 그대로 옮기므로 소리보다 더 많은 것을 알리지 않는다.
 */
export const EFFECT_FLASHES = ['sensor', 'trap'] as const satisfies readonly AudioEffect['kind'][];
export type EffectFlash = (typeof EFFECT_FLASHES)[number];
export const isEffectFlash = (kind: AudioEffect['kind']): kind is EffectFlash =>
  (EFFECT_FLASHES as readonly AudioEffect['kind'][]).includes(kind);

/** 화면 플래시 한 칸에 들어가는 종류. 자기 상태 안내음과 서버 효과음이 같은 자리를 쓴다. */
export type FlashKind = FlashCue | EffectFlash | CaptureProgressFlash;

/**
 * 이번 정책에서 아직 화면에 내지 않은 효과음을 고른다. 중복은 서버 eventId 로만 거른다(소리와
 * 같은 기준). 정책은 같은 효과음을 여러 번 실어 보낼 수 있으므로 한 묶음 안에서도 한 번만 낸다.
 */
export function detectEffectFlashes(
  effects: readonly Pick<AudioEffect, 'eventId' | 'kind'>[],
  shown: ReadonlySet<string>,
): readonly Readonly<{ eventId: string; kind: EffectFlash }>[] {
  const picked: { eventId: string; kind: EffectFlash }[] = [];
  for (const effect of effects) {
    if (!isEffectFlash(effect.kind)) continue;
    if (shown.has(effect.eventId) || picked.some((p) => p.eventId === effect.eventId)) continue;
    picked.push({ eventId: effect.eventId, kind: effect.kind });
  }
  return picked;
}
