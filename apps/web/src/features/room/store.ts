import { create } from 'zustand';

export type PlayerView = {
  playerId: string;
  nickname: string;
  x: number;
  z: number;
  role?: string;
  ready?: boolean;
};

type AppState = {
  connection: 'idle' | 'joining' | 'connected' | 'error';
  error?: string;
  feedback?: string;
  tick: number;
  sessionId?: string;
  players: PlayerView[];
  phase?: string;
  timeLeft?: number;
  setConnection(connection: AppState['connection'], error?: string): void;
  setFeedback(feedback?: string): void;
  setWorld(tick: number, sessionId: string, players: PlayerView[]): void;
  setTeamWorld(
    tick: number,
    timeLeft: number,
    phase: string,
    sessionId: string,
    players: PlayerView[],
  ): void;
  resetWorld(): void;
};

export const useAppStore = create<AppState>((set) => ({
  connection: 'idle',
  tick: 0,
  players: [],
  setConnection: (connection, error) => set({ connection, error }),
  setFeedback: (feedback) => set({ feedback }),
  setWorld: (tick, sessionId, players) => set({ tick, sessionId, players }),
  setTeamWorld: (tick, timeLeft, phase, sessionId, players) =>
    set({ tick, timeLeft, phase, sessionId, players }),
  resetWorld: () =>
    set({
      tick: 0,
      timeLeft: undefined,
      phase: undefined,
      sessionId: undefined,
      players: [],
      feedback: undefined,
    }),
}));
