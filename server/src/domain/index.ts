/**
 * 도메인 규칙 함수 — 담당: 손주연
 *
 * ⚠️ 지금은 전부 "항상 성공"하는 스텁이다.
 * 유림의 rooms/ 코드가 이 시그니처만 보고 먼저 진행할 수 있게 하기 위한 자리.
 * 주연이 실제 구현으로 바꿔 넣어도 rooms/ 는 수정하지 않아야 한다.
 *
 * 시그니처는 docs/protocol.md §3 과 동일하게 유지한다.
 */

import {
  CaptureEvent,
  Dir,
  GameSnapshot,
  MoveDir,
  Role,
  RuleResult,
  TurnDir,
  MAZE_SIZE,
} from "./types";

export * from "./types";

/** 방향 벡터: 북(0) 동(1) 남(2) 서(3) */
export const DIR_VECTORS: Record<Dir, { dx: number; dy: number }> = {
  0: { dx: 0, dy: -1 },
  1: { dx: 1, dy: 0 },
  2: { dx: 0, dy: 1 },
  3: { dx: -1, dy: 0 },
};

export function turn(dir: Dir, to: TurnDir): Dir {
  return ((dir + (to === "right" ? 1 : 3)) % 4) as Dir;
}

/**
 * 이동 가능 여부. [E1] 셀 단위 이동 판정
 * TODO(주연): 벽 충돌 · 점유 충돌 · 쿨다운 · trapped · 버퍼 1개
 */
export function tryMove(
  state: GameSnapshot,
  playerId: string,
  move: MoveDir,
  now: number
): RuleResult {
  const p = state.players.get(playerId);
  if (!p) return { ok: false, reason: "no-player" };
  if (p.status !== "alive") return { ok: false, reason: "not-alive" };
  if (p.trapped) return { ok: false, reason: "trapped" };

  // 스텁: 경계만 막고 나머지는 통과
  const v = DIR_VECTORS[p.dir];
  const sign = move === "forward" ? 1 : -1;
  const nx = p.x + v.dx * sign;
  const ny = p.y + v.dy * sign;
  if (nx < 0 || ny < 0 || nx >= MAZE_SIZE || ny >= MAZE_SIZE) {
    return { ok: false, reason: "out-of-bounds" };
  }
  return { ok: true };
}

/** [E1] 접촉 포획 판정. TODO(주연) */
export function checkCapture(_state: GameSnapshot): CaptureEvent[] {
  return [];
}

/** [E1] 승패 판정. TODO(주연) */
export function checkWinCondition(_state: GameSnapshot): Role | null {
  return null;
}

/** [E3] 미로 생성. 0단계는 고정 맵. TODO(주연): 랜덤 생성 + BFS 검증 */
export function generateMaze(_seed: number): Uint8Array {
  const m = new Uint8Array(MAZE_SIZE * MAZE_SIZE);
  for (let y = 0; y < MAZE_SIZE; y++) {
    for (let x = 0; x < MAZE_SIZE; x++) {
      const edge = x === 0 || y === 0 || x === MAZE_SIZE - 1 || y === MAZE_SIZE - 1;
      // 임시: 외곽 벽 + 4칸 간격 격자 기둥
      const pillar = x % 4 === 0 && y % 4 === 0;
      m[y * MAZE_SIZE + x] = edge || pillar ? 1 : 0;
    }
  }
  return m;
}

/** [E3] 시작점 배치. TODO(주연): 외곽 분산 · 즉시 조우 방지 */
export function pickSpawn(
  _maze: Uint8Array,
  role: Role,
  index: number
): { x: number; y: number; dir: Dir } {
  // 스텁: 도망자는 위쪽 줄, 술래는 아래쪽 줄
  const x = 2 + index * 10;
  return role === "runner"
    ? { x, y: 2, dir: 2 }
    : { x, y: MAZE_SIZE - 3, dir: 0 };
}
