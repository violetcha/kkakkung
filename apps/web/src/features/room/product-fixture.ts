import type { PrivateView, PublicRoundState } from '@kkakkung/protocol/game-schema';
/** Tiny synthetic public contract fixture for C tests; never a master maze. */
export function viewFixture(overrides: Partial<PrivateView> = {}): PrivateView {
  return {
    matchId: 'm',
    stateVersion: 10,
    mapVersion: 1,
    gameScope: { gameInstanceId: 'game', kind: 'game', revision: 3 },
    self: {
      playerId: 'self',
      role: 'runner',
      status: 'ACTIVE',
      cell: { x: 1, y: 1 },
      dir: 0,
      action: null,
      equipment: { sensor: 0, trap: 0 },
      ownedEquipment: [],
      restraintUntilTick: null,
      restraintImmuneUntilTick: null,
      installation: null,
      exchange: null,
      challenge: null,
      loading: null,
    },
    knownTerrain: [
      { x: 1, y: 1, kind: 'floor' },
      { x: 1, y: 1, side: 0, kind: 'wall' },
    ],
    knownActiveExits: [
      { exitId: 'exit', ownerId: 'self', approach: { x: 1, y: 1 }, wall: { x: 1, y: 1, side: 0 } },
    ],
    visibleCells: [{ x: 1, y: 1 }],
    visibleWallFaces: [{ x: 1, y: 1, side: 0 }],
    visibleEntities: [],
    ...overrides,
  };
}
export function roundFixture(overrides: Partial<PublicRoundState> = {}): PublicRoundState {
  return {
    matchId: 'm',
    phase: 'PLAYING',
    stateVersion: 10,
    serverTick: 100,
    startAt: 0,
    startTick: 0,
    deadlineTick: 3600,
    counts: { escaped: 0, captured: 0 },
    result: null,
    abortReason: null,
    ...overrides,
  };
}
