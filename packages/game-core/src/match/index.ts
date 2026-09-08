import {
  MAZE_SIZE,
  type CaptureEvent,
  type Dir,
  type GameSnapshot,
  type MoveDir,
  type Role,
  type RuleResult,
  type TurnDir,
} from './types.js';

export * from './types.js';

/** Direction vectors for north (0), east (1), south (2), and west (3). */
export const DIR_VECTORS: Record<Dir, { dx: number; dy: number }> = {
  0: { dx: 0, dy: -1 },
  1: { dx: 1, dy: 0 },
  2: { dx: 0, dy: 1 },
  3: { dx: -1, dy: 0 },
};

export function turn(dir: Dir, to: TurnDir): Dir {
  return ((dir + (to === 'right' ? 1 : 3)) % 4) as Dir;
}

/**
 * Development stub for cell movement. It currently enforces player state and
 * map bounds only; collision, occupancy, and cooldown rules remain TODO.
 */
export function tryMove(
  state: GameSnapshot,
  playerId: string,
  move: MoveDir,
  _now: number,
): RuleResult {
  const player = state.players.get(playerId);
  if (!player) return { ok: false, reason: 'no-player' };
  if (player.status !== 'alive') return { ok: false, reason: 'not-alive' };
  if (player.trapped) return { ok: false, reason: 'trapped' };

  const vector = DIR_VECTORS[player.dir];
  const sign = move === 'forward' ? 1 : -1;
  const nextX = player.x + vector.dx * sign;
  const nextY = player.y + vector.dy * sign;
  if (nextX < 0 || nextY < 0 || nextX >= MAZE_SIZE || nextY >= MAZE_SIZE) {
    return { ok: false, reason: 'out-of-bounds' };
  }
  return { ok: true };
}

/** TODO: implement contact capture rules. */
export function checkCapture(_state: GameSnapshot): CaptureEvent[] {
  return [];
}

/** TODO: implement match win conditions. */
export function checkWinCondition(_state: GameSnapshot): Role | null {
  return null;
}

/** Development-only fixed map; randomized, validated generation remains TODO. */
export function generateMaze(_seed: number): Uint8Array {
  const maze = new Uint8Array(MAZE_SIZE * MAZE_SIZE);
  for (let y = 0; y < MAZE_SIZE; y += 1) {
    for (let x = 0; x < MAZE_SIZE; x += 1) {
      const edge = x === 0 || y === 0 || x === MAZE_SIZE - 1 || y === MAZE_SIZE - 1;
      const pillar = x % 4 === 0 && y % 4 === 0;
      maze[y * MAZE_SIZE + x] = edge || pillar ? 1 : 0;
    }
  }
  return maze;
}

/** Development spawn placement; distributed encounter-safe placement remains TODO. */
export function pickSpawn(
  _maze: Uint8Array,
  role: Role,
  index: number,
): { x: number; y: number; dir: Dir } {
  const x = 2 + index * 10;
  return role === 'runner' ? { x, y: 2, dir: 2 } : { x, y: MAZE_SIZE - 3, dir: 0 };
}
