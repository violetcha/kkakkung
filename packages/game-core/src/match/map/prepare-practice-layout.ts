import type {
  Cell,
  Dir,
  LayoutPlayer,
  MatchLayout,
  PracticeLayoutResult,
  Role,
  RosterEntry,
  Topology,
} from '../types.js';
import { MAX_TEMPLATE_SIZE, isDir, isWalkable, sameCell } from './validate-template.js';

type Path = readonly (string | number)[];

const SLOTS: Readonly<Record<Role, readonly string[]>> = {
  tagger: ['tagger-1', 'tagger-2', 'tagger-3'],
  runner: ['runner-1', 'runner-2', 'runner-3'],
};

function invalid(path: Path): PracticeLayoutResult {
  return { status: 'invalid', code: 'INVALID_PRACTICE_LAYOUT', path: Object.freeze([...path]) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readCell(value: unknown): Cell | null {
  if (!isRecord(value) || !Number.isInteger(value.x) || !Number.isInteger(value.y)) return null;
  return { x: value.x as number, y: value.y as number };
}

function readTopology(value: unknown, path: Path): Topology | PracticeLayoutResult {
  if (!isRecord(value)) return invalid(path);
  const { topologyVersion, width, height, walkable } = value;
  if (typeof topologyVersion !== 'string' || topologyVersion.length === 0) {
    return invalid([...path, 'topologyVersion']);
  }
  if (!Number.isInteger(width) || (width as number) < 3 || (width as number) > MAX_TEMPLATE_SIZE) {
    return invalid([...path, 'width']);
  }
  if (
    !Number.isInteger(height) ||
    (height as number) < 3 ||
    (height as number) > MAX_TEMPLATE_SIZE
  ) {
    return invalid([...path, 'height']);
  }
  const w = width as number;
  const h = height as number;
  if (!Array.isArray(walkable) || walkable.length !== w * h) return invalid([...path, 'walkable']);
  const cells: boolean[] = [];
  for (let i = 0; i < walkable.length; i += 1) {
    const v = walkable[i];
    if (typeof v !== 'boolean') return invalid([...path, 'walkable', i]);
    const x = i % w;
    const y = Math.floor(i / w);
    const outer = x === 0 || y === 0 || x === w - 1 || y === h - 1;
    if (outer && v) return invalid([...path, 'walkable', i]);
    cells.push(v);
  }
  const topology: Topology = { topologyVersion, width: w, height: h, walkable: cells };
  if (!allPassagesConnected(topology)) return invalid([...path, 'walkable']);
  return topology;
}

/** Every passage cell must be reachable from the first one (orthogonal moves only). */
function allPassagesConnected(topology: Topology): boolean {
  const start = topology.walkable.indexOf(true);
  if (start < 0) return false;
  const seen = new Set<number>([start]);
  const queue = [start];
  for (let head = 0; head < queue.length; head += 1) {
    const node = queue[head]!;
    const x = node % topology.width;
    const y = Math.floor(node / topology.width);
    for (const [dx, dy] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ] as const) {
      const next = { x: x + dx, y: y + dy };
      if (!isWalkable(topology, next)) continue;
      const key = next.y * topology.width + next.x;
      if (!seen.has(key)) {
        seen.add(key);
        queue.push(key);
      }
    }
  }
  return seen.size === topology.walkable.filter(Boolean).length;
}

function ahead(cell: Cell, dir: Dir): Cell {
  const v = [
    { dx: 0, dy: -1 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
  ][dir]!;
  return { x: cell.x + v.dx, y: cell.y + v.dy };
}

/**
 * PracticeLayoutPort.preparePracticeLayout: validates the static
 * `{practiceVersion, layouts:{runner,tagger}}` JSON for one role, binds the
 * role's stable slots to the current 1..3 player ids (default string order),
 * and returns a new MatchLayout holding only those players. Match-only rules
 * (6 players, 3 exits, distances, 3 territories) are not applied, and the
 * input JSON and roster are never modified.
 */
export function preparePracticeLayout(
  raw: unknown,
  players: readonly RosterEntry[],
  role: Role,
): PracticeLayoutResult {
  if (role !== 'runner' && role !== 'tagger') return invalid(['role']);
  if (players.length < 1 || players.length > 3) return invalid(['players']);
  const ids = new Set<string>();
  for (let i = 0; i < players.length; i += 1) {
    const p = players[i]!;
    if (typeof p.playerId !== 'string' || p.playerId.length === 0 || ids.has(p.playerId)) {
      return invalid(['players', i, 'playerId']);
    }
    if (p.role !== role) return invalid(['players', i, 'role']);
    ids.add(p.playerId);
  }
  if (!isRecord(raw)) return invalid([]);
  if (typeof raw.practiceVersion !== 'string' || raw.practiceVersion.length === 0) {
    return invalid(['practiceVersion']);
  }
  if (!isRecord(raw.layouts)) return invalid(['layouts']);
  const layout = raw.layouts[role];
  const base: Path = ['layouts', role];
  if (!isRecord(layout)) return invalid(base);
  if (typeof layout.layoutId !== 'string' || layout.layoutId.length === 0) {
    return invalid([...base, 'layoutId']);
  }
  const topology = readTopology(layout.topology, [...base, 'topology']);
  if ('status' in topology) return topology;
  if (!Array.isArray(layout.players) || layout.players.length !== 3) {
    return invalid([...base, 'players']);
  }
  if (!Array.isArray(layout.exits) || layout.exits.length !== 0) return invalid([...base, 'exits']);
  if (!Array.isArray(layout.territories)) return invalid([...base, 'territories']);

  const slots = SLOTS[role];
  const seenSlots = new Set<string>();
  const slotPlayers = new Map<string, LayoutPlayer>();
  for (let i = 0; i < layout.players.length; i += 1) {
    const entry = layout.players[i];
    const path: Path = [...base, 'players', i];
    if (!isRecord(entry)) return invalid(path);
    const slot = entry.playerId;
    if (typeof slot !== 'string' || !slots.includes(slot) || seenSlots.has(slot)) {
      return invalid([...path, 'playerId']);
    }
    if (entry.role !== role) return invalid([...path, 'role']);
    const cell = readCell(entry.cell);
    if (!cell || !isWalkable(topology, cell)) return invalid([...path, 'cell']);
    if (!isDir(entry.dir) || !isWalkable(topology, ahead(cell, entry.dir))) {
      return invalid([...path, 'dir']);
    }
    for (const other of slotPlayers.values()) {
      if (sameCell(other.cell, cell)) return invalid([...path, 'cell']);
    }
    seenSlots.add(slot);
    slotPlayers.set(slot, { playerId: slot, role, cell, dir: entry.dir });
  }

  const territories = new Map<string, readonly Cell[]>();
  for (let i = 0; i < layout.territories.length; i += 1) {
    const entry = layout.territories[i];
    const path: Path = [...base, 'territories', i];
    if (!isRecord(entry) || typeof entry.playerId !== 'string' || !slots.includes(entry.playerId)) {
      return invalid([...path, 'playerId']);
    }
    if (!Array.isArray(entry.cells)) return invalid([...path, 'cells']);
    const cells: Cell[] = [];
    for (let j = 0; j < entry.cells.length; j += 1) {
      const cell = readCell(entry.cells[j]);
      if (!cell || !isWalkable(topology, cell)) return invalid([...path, 'cells', j]);
      cells.push(cell);
    }
    if (territories.has(entry.playerId)) return invalid([...path, 'playerId']);
    territories.set(entry.playerId, cells);
  }

  const sorted = [...players].sort((a, b) => (a.playerId < b.playerId ? -1 : 1));
  const boundPlayers: LayoutPlayer[] = [];
  const boundTerritories: { playerId: string; cells: readonly Cell[] }[] = [];
  sorted.forEach((player, index) => {
    const slot = slots[index]!;
    const placed = slotPlayers.get(slot)!;
    boundPlayers.push({ ...placed, playerId: player.playerId });
    const cells = territories.get(slot);
    if (cells) boundTerritories.push({ playerId: player.playerId, cells });
  });
  const result: MatchLayout = {
    layoutId: `${layout.layoutId}:${raw.practiceVersion}`,
    topology,
    players: boundPlayers,
    exits: [],
    territories: boundTerritories,
  };
  return { status: 'ready', layout: result };
}
