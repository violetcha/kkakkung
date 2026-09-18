// S15P21C204-275. 경기 시작 전 대기를 한 진행표시로 합친다.
// 미로 준비·화면 연결 확인·시작 카운트다운이 서로 다른 화면이 아니라 한 줄의 세 단계다.
// 여기서는 이미 있는 값(phase·startAt·대기 항목·준비 실패 사유)을 읽어 배치만 정한다.
import type { PublicRoundState } from '@kkakkung/protocol/game-schema';
import { loadingDisplay } from './loading-controller';
import { preparationFeedback } from './preparation-feedback';

export type LoadingStepId = 'map' | 'connect' | 'start';
export type LoadingStepState = 'waiting' | 'busy' | 'done';

export type LoadingStep = Readonly<{
  id: LoadingStepId;
  index: number;
  label: string;
  state: LoadingStepState;
}>;

export const LOADING_STEP_LABELS: Readonly<Record<LoadingStepId, string>> = Object.freeze({
  map: '미로 준비',
  connect: '화면·연결 확인',
  start: '시작',
});

const ORDER: readonly LoadingStepId[] = ['map', 'connect', 'start'];

/** 어느 단계에 와 있는지. 대기 화면을 쓰지 않는 phase 는 null 이다. */
function stepOfPhase(phase: PublicRoundState['phase']): LoadingStepId | null {
  if (phase === 'MAP_FINALIZING') return 'map';
  if (phase === 'GAME_LOADING') return 'connect';
  if (phase === 'COUNTDOWN') return 'start';
  return null;
}

export type LoadingProgress = Readonly<{
  steps: readonly LoadingStep[];
  active: number;
  /** 남은 초. 카운트다운 단계가 아니면 null, 0 이면 서버의 시작 확인을 기다리는 중이다. */
  countdown: number | null;
  /** 내 쪽에서 아직 못 낸 준비 항목. 확인 단계에서만 보여 준다. */
  pending: readonly string[];
  /** 준비가 제한 시간을 넘겨 실패했을 때의 복귀 안내. 없으면 null 이다. */
  notice: string | null;
}>;

export function loadingProgress(input: {
  round: PublicRoundState;
  serverNow: number | null;
  pending?: readonly string[];
}): LoadingProgress | null {
  const current = stepOfPhase(input.round.phase);
  if (!current) return null;
  const active = ORDER.indexOf(current);
  const steps = ORDER.map((id, index) =>
    Object.freeze({
      id,
      index,
      label: LOADING_STEP_LABELS[id],
      state: (index < active ? 'done' : index === active ? 'busy' : 'waiting') as LoadingStepState,
    }),
  );
  return {
    steps,
    active,
    countdown: loadingDisplay(input.round, input.serverNow).countdown,
    pending: current === 'connect' ? (input.pending ?? []) : [],
    notice: preparationFeedback(input.round.preparationIssue),
  };
}
