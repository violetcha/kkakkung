/**
 * 도메인 타입 — Colyseus를 모르는 순수 타입.
 * 담당: 손주연 (E1 게임 도메인 모델 분리)
 *
 * rooms/schema 의 Schema 클래스는 "전송용 모양"이고,
 * 여기 타입은 "규칙 계산용 모양"이다. 필드 이름은 둘을 맞춘다.
 */

export const MAZE_SIZE = 32;

/** 0=북 1=동 2=남 3=서 */
export type Dir = 0 | 1 | 2 | 3;

export type Role = "runner" | "tagger";
export type PlayerStatus = "alive" | "escaped" | "captured";
export type Phase = "waiting" | "prep" | "countdown" | "playing" | "result";

export type MoveDir = "forward" | "back";
export type TurnDir = "left" | "right";

export interface PlayerState {
  id: string;
  role: Role;
  x: number;
  y: number;
  dir: Dir;
  status: PlayerStatus;
  trapped: boolean;
  /** 마지막 이동이 수락된 서버 시각(ms). 쿨다운 계산용 */
  lastMoveAt: number;
}

export interface GameSnapshot {
  phase: Phase;
  tick: number;
  timeLeft: number;
  /** 32*32, 0=통로 1=벽. index = y * MAZE_SIZE + x */
  maze: Uint8Array | number[];
  players: Map<string, PlayerState>;
}

export interface RuleResult {
  ok: boolean;
  reason?: string;
}

export interface CaptureEvent {
  taggerId: string;
  runnerId: string;
  x: number;
  y: number;
}
