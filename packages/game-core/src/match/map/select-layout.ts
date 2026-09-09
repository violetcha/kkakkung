import type {
  Cell,
  Dir,
  LayoutConstraints,
  LayoutExit,
  LayoutPlayer,
  LayoutTemplate,
  MatchLayout,
  PoseKind,
  RosterEntry,
  SpawnRegion,
  WallFace,
} from '../types.js';
import { createRng, fnv1a, pick, shuffle, type RngState } from '../random.js';
import {
  bfsDistances,
  facesPassage,
  hasMinPassageNeighbors,
  isInCore,
  nodeIndex,
  UNREACHABLE,
} from './graph.js';
import { analyzeTemplate, type TemplateAnalysis } from './validate-connectivity.js';
import { approachOf, compareCells, sameCell } from './validate-template.js';

export const POSE_KINDS: readonly PoseKind[] = Object.freeze(['left', 'right', 'y']);

/** Exit candidates examined per runner in one attempt. Bounds the combination search. */
export const EXIT_CANDIDATES_PER_RUNNER = 12;

/** Number of top-scored exit triples the seeded final pick chooses from. */
export const EXIT_TOP_CHOICES = 4;

export type LayoutFailureCode =
  | 'ROSTER_INVALID'
  | 'NO_SPAWN_CANDIDATE'
  | 'RUNNER_DISTANCE'
  | 'RUNNER_TAGGER_DISTANCE'
  | 'NO_EXIT_COMBINATION';

export type LayoutAttemptResult =
  | Readonly<{ ok: true; layout: MatchLayout }>
  | Readonly<{ ok: false; code: LayoutFailureCode; detail: string }>;

/** Roster sorted by default string order per role. Never uses locale comparison. */
export type SortedRoster = Readonly<{ taggers: readonly string[]; runners: readonly string[] }>;

export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sortRoster(players: readonly RosterEntry[]): SortedRoster | null {
  const ids = new Set<string>();
  const taggers: string[] = [];
  const runners: string[] = [];
  for (const player of players) {
    if (typeof player.playerId !== 'string' || player.playerId.length === 0) return null;
    if (ids.has(player.playerId)) return null;
    ids.add(player.playerId);
    if (player.role === 'tagger') taggers.push(player.playerId);
    else if (player.role === 'runner') runners.push(player.playerId);
    else return null;
  }
  if (taggers.length !== 3 || runners.length !== 3) return null;
  return Object.freeze({
    taggers: Object.freeze([...taggers].sort(compareIds)),
    runners: Object.freeze([...runners].sort(compareIds)),
  });
}

export type SelectionContext = Readonly<{
  template: LayoutTemplate;
  analysis: TemplateAnalysis;
  constraints: LayoutConstraints;
  roster: SortedRoster;
}>;

export function prepareSelection(
  template: LayoutTemplate,
  players: readonly RosterEntry[],
  constraints: LayoutConstraints,
  analysis: TemplateAnalysis = analyzeTemplate(template),
): SelectionContext | null {
  const roster = sortRoster(players);
  if (!roster) return null;
  return Object.freeze({ template, analysis, constraints, roster });
}

/** First direction (north first, then clockwise) whose next cell is a passage. */
export function initialFacing(ctx: SelectionContext, cell: Cell): Dir | null {
  for (const dir of [0, 1, 2, 3] as const) {
    if (facesPassage(ctx.template.topology, cell, dir)) return dir;
  }
  return null;
}

export function isValidStart(ctx: SelectionContext, cell: Cell): boolean {
  return (
    hasMinPassageNeighbors(ctx.template.topology, cell, ctx.constraints.minSpawnNeighbors) &&
    isInCore(ctx.analysis.graph, ctx.analysis.biconnected, cell) &&
    initialFacing(ctx, cell) !== null
  );
}

function distanceFrom(ctx: SelectionContext, table: ReadonlyMap<number, number>, to: Cell): number {
  return table.get(nodeIndex(ctx.template.topology, to)) ?? UNREACHABLE;
}

function pickSpawn(
  ctx: SelectionContext,
  region: SpawnRegion,
  rng: RngState,
): Readonly<{ rng: RngState; cell: Cell | null }> {
  const valid = region.spawnCandidates.filter((cell) => isValidStart(ctx, cell));
  if (valid.length === 0) return { rng, cell: null };
  const chosen = pick(rng, valid);
  return { rng: chosen.state, cell: chosen.value };
}

type ExitOption = Readonly<{ face: WallFace; approach: Cell; distance: number }>;

function exitOptions(
  ctx: SelectionContext,
  table: ReadonlyMap<number, number>,
  rng: RngState,
): Readonly<{ rng: RngState; options: readonly ExitOption[] }> {
  const { minExitPathLength, maxExitPathLength } = ctx.constraints;
  const all: ExitOption[] = [];
  for (const face of ctx.template.exitCandidates) {
    const approach = approachOf(face);
    if (!isInCore(ctx.analysis.graph, ctx.analysis.biconnected, approach)) continue;
    const d = distanceFrom(ctx, table, approach);
    if (d === UNREACHABLE || d < minExitPathLength || d > maxExitPathLength) continue;
    all.push({ face, approach, distance: d });
  }
  const shuffled = shuffle(rng, all);
  return { rng: shuffled.state, options: shuffled.items.slice(0, EXIT_CANDIDATES_PER_RUNNER) };
}

type ExitTriple = Readonly<{
  options: readonly [ExitOption, ExitOption, ExitOption];
  ratio: number;
}>;

function tripleKey(triple: ExitTriple): string {
  return triple.options.map((o) => `${o.face.x},${o.face.y},${o.face.side}`).join('|');
}

function layoutIdOf(
  ctx: SelectionContext,
  players: readonly LayoutPlayer[],
  exits: readonly LayoutExit[],
): string {
  const body = JSON.stringify({
    players: players.map((p) => [p.role, p.cell.x, p.cell.y, p.dir]),
    exits: exits.map((e) => [e.wall.x, e.wall.y, e.wall.side]),
  });
  return `${ctx.template.topology.topologyVersion}:${fnv1a(body)}`;
}

/**
 * One full placement attempt inside the given template variant. Taggers get
 * distinct territories, runners distinct outer regions; then exits are searched
 * for the runners. Any violated constraint fails the attempt without relaxing
 * numbers. Randomness consumption depends only on the seeded state, never on
 * the caller's array order (roster and candidates are sorted first).
 */
export function attemptLayout(
  ctx: SelectionContext,
  rng: RngState,
): Readonly<{ rng: RngState; result: LayoutAttemptResult }> {
  const { template, constraints, roster } = ctx;
  const graph = ctx.analysis.graph;
  let state = rng;

  const taggerOrder = shuffle(state, template.taggerRegions);
  state = taggerOrder.state;
  const taggerSpawns: { playerId: string; cell: Cell; region: SpawnRegion }[] = [];
  for (let i = 0; i < 3; i += 1) {
    const region = taggerOrder.items[i]!;
    const spawn = pickSpawn(ctx, region, state);
    state = spawn.rng;
    if (!spawn.cell) {
      return {
        rng: state,
        result: {
          ok: false,
          code: 'NO_SPAWN_CANDIDATE',
          detail: `tagger region ${region.regionId}`,
        },
      };
    }
    taggerSpawns.push({ playerId: roster.taggers[i]!, cell: spawn.cell, region });
  }

  const runnerOrder = shuffle(state, template.runnerSpawnRegions);
  state = runnerOrder.state;
  const runnerSpawns: { playerId: string; cell: Cell; region: SpawnRegion }[] = [];
  for (let i = 0; i < 3; i += 1) {
    const region = runnerOrder.items[i]!;
    const spawn = pickSpawn(ctx, region, state);
    state = spawn.rng;
    if (!spawn.cell) {
      return {
        rng: state,
        result: {
          ok: false,
          code: 'NO_SPAWN_CANDIDATE',
          detail: `runner region ${region.regionId}`,
        },
      };
    }
    runnerSpawns.push({ playerId: roster.runners[i]!, cell: spawn.cell, region });
  }

  const runnerTables = runnerSpawns.map((r) => bfsDistances(graph, r.cell));
  for (let i = 0; i < 3; i += 1) {
    for (let j = i + 1; j < 3; j += 1) {
      const d = distanceFrom(ctx, runnerTables[i]!, runnerSpawns[j]!.cell);
      if (d === UNREACHABLE || d < constraints.minRunnerDistance) {
        return {
          rng: state,
          result: { ok: false, code: 'RUNNER_DISTANCE', detail: `${i}-${j}:${d}` },
        };
      }
    }
    for (const tagger of taggerSpawns) {
      const d = distanceFrom(ctx, runnerTables[i]!, tagger.cell);
      if (d === UNREACHABLE || d < constraints.minRunnerTaggerDistance) {
        return {
          rng: state,
          result: { ok: false, code: 'RUNNER_TAGGER_DISTANCE', detail: `runner ${i}:${d}` },
        };
      }
    }
  }

  const perRunner: ExitOption[][] = [];
  for (let i = 0; i < 3; i += 1) {
    const options = exitOptions(ctx, runnerTables[i]!, state);
    state = options.rng;
    if (options.options.length === 0) {
      return {
        rng: state,
        result: { ok: false, code: 'NO_EXIT_COMBINATION', detail: `runner ${i}` },
      };
    }
    perRunner.push([...options.options]);
  }

  const approachTables = new Map<number, ReadonlyMap<number, number>>();
  const approachDistance = (a: Cell, b: Cell): number => {
    const key = nodeIndex(template.topology, a);
    let table = approachTables.get(key);
    if (!table) {
      table = bfsDistances(graph, a);
      approachTables.set(key, table);
    }
    return distanceFrom(ctx, table, b);
  };
  const farEnough = (a: ExitOption, b: ExitOption): boolean => {
    if (sameCell(a.face, b.face) && a.face.side === b.face.side) return false;
    if (sameCell(a.approach, b.approach)) return false;
    const d = approachDistance(a.approach, b.approach);
    return d !== UNREACHABLE && d >= constraints.minExitDistance;
  };

  const triples: ExitTriple[] = [];
  for (const a of perRunner[0]!) {
    for (const b of perRunner[1]!) {
      if (!farEnough(a, b)) continue;
      for (const c of perRunner[2]!) {
        if (!farEnough(a, c) || !farEnough(b, c)) continue;
        const distances = [a.distance, b.distance, c.distance];
        const ratio = Math.max(...distances) / Math.min(...distances);
        if (ratio > constraints.maxExitRatio + 1e-9) continue;
        triples.push({ options: [a, b, c], ratio });
      }
    }
  }
  if (triples.length === 0) {
    return { rng: state, result: { ok: false, code: 'NO_EXIT_COMBINATION', detail: 'no triple' } };
  }
  triples.sort((x, y) => x.ratio - y.ratio || compareIds(tripleKey(x), tripleKey(y)));
  const chosen = pick(state, triples.slice(0, EXIT_TOP_CHOICES));
  state = chosen.state;

  const poses = shuffle(state, POSE_KINDS);
  state = poses.state;

  const players: LayoutPlayer[] = [
    ...taggerSpawns.map((t) => ({
      playerId: t.playerId,
      role: 'tagger' as const,
      cell: t.cell,
      dir: initialFacing(ctx, t.cell)!,
    })),
    ...runnerSpawns.map((r) => ({
      playerId: r.playerId,
      role: 'runner' as const,
      cell: r.cell,
      dir: initialFacing(ctx, r.cell)!,
    })),
  ];
  const exits: LayoutExit[] = chosen.value.options.map((option, index) => ({
    exitId: `exit-${index + 1}`,
    ownerId: runnerSpawns[index]!.playerId,
    wall: option.face,
    approach: option.approach,
    poseKind: poses.items[index]!,
  }));
  const territories = taggerSpawns.map((t) => ({
    playerId: t.playerId,
    cells: [...t.region.cells].sort(compareCells),
  }));
  const layout: MatchLayout = {
    layoutId: layoutIdOf(ctx, players, exits),
    topology: template.topology,
    players,
    exits,
    territories,
  };
  return { rng: state, result: { ok: true, layout } };
}

/**
 * Convenience wrapper: runs up to `maxAttempts` seeded attempts and returns the
 * first valid layout or the last failure. Time budgeting belongs to MP-05.
 */
export function selectLayout(
  template: LayoutTemplate,
  players: readonly RosterEntry[],
  seed: number,
  maxAttempts: number,
  constraints: LayoutConstraints,
): LayoutAttemptResult {
  const ctx = prepareSelection(template, players, constraints);
  if (!ctx)
    return {
      ok: false,
      code: 'ROSTER_INVALID',
      detail: 'need 3 taggers and 3 runners with unique ids',
    };
  let rng = createRng(seed);
  let last: LayoutAttemptResult = { ok: false, code: 'NO_EXIT_COMBINATION', detail: 'no attempts' };
  for (let i = 0; i < maxAttempts; i += 1) {
    const attempt = attemptLayout(ctx, rng);
    rng = attempt.rng;
    last = attempt.result;
    if (last.ok) return last;
  }
  return last;
}
