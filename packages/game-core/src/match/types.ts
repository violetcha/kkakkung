export const MAZE_SIZE = 32;

/** 0=north, 1=east, 2=south, 3=west. */
export type Dir = 0 | 1 | 2 | 3;

export type Role = 'runner' | 'tagger';
export type PlayerStatus = 'alive' | 'escaped' | 'captured';
export type Phase = 'waiting' | 'prep' | 'countdown' | 'playing' | 'result';
export type MoveDir = 'forward' | 'back';
export type TurnDir = 'left' | 'right';

export interface PlayerState {
  id: string;
  role: Role;
  x: number;
  y: number;
  dir: Dir;
  status: PlayerStatus;
  trapped: boolean;
  /** Server time of the last accepted move, reserved for movement cooldown rules. */
  lastMoveAt: number;
}

export interface GameSnapshot {
  phase: Phase;
  tick: number;
  timeLeft: number;
  /** 32*32 grid, where 0 is open and 1 is a wall. */
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
