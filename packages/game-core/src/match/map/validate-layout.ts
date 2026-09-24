import type {
  Cell,
  LayoutConstraints,
  LayoutTemplate,
  MatchLayout,
  RosterEntry,
  SpawnRegion,
} from '../types.js';
import { bfsDistances, nodeIndex, UNREACHABLE } from './graph.js';
import {
  POSE_KINDS,
  isValidStart,
  prepareSelection,
  type SelectionContext,
} from './select-layout.js';
import { analyzeTemplate, type TemplateAnalysis } from './validate-connectivity.js';
import {
  approachOf,
  compareCells,
  isDir,
  isWalkable,
  sameCell,
  sameFace,
} from './validate-template.js';

export type LayoutIssueCode =
  | 'TOPOLOGY_MISMATCH'
  | 'ROSTER_INVALID'
  | 'PLAYER_MISMATCH'
  | 'TERRITORY_MISMATCH'
  | 'SPAWN_INVALID'
  | 'SPAWN_OUTSIDE_REGION'
  | 'FACING_INVALID'
  | 'RUNNER_DISTANCE'
  | 'RUNNER_TAGGER_DISTANCE'
  | 'EXIT_INVALID'
  | 'EXIT_DISTANCE'
  | 'EXIT_RATIO';

export type LayoutIssue = Readonly<{ code: LayoutIssueCode; detail: string }>;

export type LayoutValidation =
  Readonly<{ ok: true }> | Readonly<{ ok: false; issues: readonly LayoutIssue[] }>;

function sameCells(a: readonly Cell[], b: readonly Cell[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort(compareCells);
  const sb = [...b].sort(compareCells);
  return sa.every((cell, i) => sameCell(cell, sb[i]!));
}

/**
 * Re-checks a complete MatchLayout against a template with the full rule set:
 * identical topology, 3+3 roster, territory/region identity, start validity,
 * distances, and exit constraints. Used only for fallback certification; an
 * online selection result is returned without a re-validation pass here.
 * Nothing is inferred from hashes or versions.
 */
export function validateLayout(
  template: LayoutTemplate,
  layout: MatchLayout,
  players: readonly RosterEntry[],
  constraints: LayoutConstraints,
  analysis: TemplateAnalysis = analyzeTemplate(template),
): LayoutValidation {
  const issues: LayoutIssue[] = [];
  const add = (code: LayoutIssueCode, detail: string) => issues.push({ code, detail });

  const t = template.topology;
  const l = layout.topology;
  if (
    l.topologyVersion !== t.topologyVersion ||
    l.width !== t.width ||
    l.height !== t.height ||
    l.walkable.length !== t.walkable.length ||
    l.walkable.some((value, index) => value !== t.walkable[index])
  ) {
    add('TOPOLOGY_MISMATCH', 'layout topology differs from the template variant');
    return { ok: false, issues };
  }

  const ctx: SelectionContext | null = prepareSelection(template, players, constraints, analysis);
  if (!ctx) {
    add('ROSTER_INVALID', 'need exactly 3 taggers and 3 runners with unique ids');
    return { ok: false, issues };
  }

  const expected = new Map(players.map((p) => [p.playerId, p.role]));
  const seen = new Set<string>();
  for (const player of layout.players) {
    if (expected.get(player.playerId) !== player.role || seen.has(player.playerId)) {
      add('PLAYER_MISMATCH', `player ${player.playerId}`);
    }
    seen.add(player.playerId);
    if (!isDir(player.dir)) add('FACING_INVALID', `player ${player.playerId} dir`);
  }
  if (layout.players.length !== 6 || seen.size !== 6)
    add('PLAYER_MISMATCH', 'six players required');
  if (issues.length > 0) return { ok: false, issues };

  const taggers = layout.players.filter((p) => p.role === 'tagger');
  const runners = layout.players.filter((p) => p.role === 'runner');

  const regionOf = (regions: readonly SpawnRegion[], cell: Cell): SpawnRegion | null =>
    regions.find((r) => r.spawnCandidates.some((c) => sameCell(c, cell))) ?? null;

  const usedTaggerRegions = new Set<string>();
  for (const tagger of taggers) {
    const region = regionOf(template.taggerRegions, tagger.cell);
    if (!region) {
      add('SPAWN_OUTSIDE_REGION', `tagger ${tagger.playerId} not on a tagger spawn candidate`);
      continue;
    }
    if (usedTaggerRegions.has(region.regionId))
      add('TERRITORY_MISMATCH', `region ${region.regionId} reused`);
    usedTaggerRegions.add(region.regionId);
    const territory = layout.territories.find((x) => x.playerId === tagger.playerId);
    if (!territory || !sameCells(territory.cells, region.cells)) {
      add(
        'TERRITORY_MISMATCH',
        `tagger ${tagger.playerId} territory differs from ${region.regionId}`,
      );
    }
  }
  if (layout.territories.length !== 3) add('TERRITORY_MISMATCH', 'three territories required');

  const usedRunnerRegions = new Set<string>();
  for (const runner of runners) {
    const region = regionOf(template.runnerSpawnRegions, runner.cell);
    if (!region) {
      add('SPAWN_OUTSIDE_REGION', `runner ${runner.playerId} not on a runner spawn candidate`);
      continue;
    }
    if (usedRunnerRegions.has(region.regionId))
      add('SPAWN_OUTSIDE_REGION', `region ${region.regionId} reused`);
    usedRunnerRegions.add(region.regionId);
  }

  for (const player of layout.players) {
    if (!isValidStart(ctx, player.cell)) add('SPAWN_INVALID', `player ${player.playerId}`);
    const ahead = approachOf({ ...player.cell, side: player.dir });
    if (!isWalkable(t, ahead)) {
      add('FACING_INVALID', `player ${player.playerId} faces a wall`);
    }
  }
  if (issues.length > 0) return { ok: false, issues };

  const graph = analysis.graph;
  const tables = new Map(runners.map((r) => [r.playerId, bfsDistances(graph, r.cell)]));
  const dist = (from: string, to: Cell): number =>
    tables.get(from)!.get(nodeIndex(t, to)) ?? UNREACHABLE;
  for (let i = 0; i < runners.length; i += 1) {
    for (let j = i + 1; j < runners.length; j += 1) {
      const d = dist(runners[i]!.playerId, runners[j]!.cell);
      if (d === UNREACHABLE || d < constraints.minRunnerDistance) add('RUNNER_DISTANCE', `${d}`);
    }
    for (const tagger of taggers) {
      const d = dist(runners[i]!.playerId, tagger.cell);
      if (d === UNREACHABLE || d < constraints.minRunnerTaggerDistance) {
        add('RUNNER_TAGGER_DISTANCE', `${runners[i]!.playerId}:${d}`);
      }
    }
  }

  if (layout.exits.length !== 3) add('EXIT_INVALID', 'three exits required');
  const owners = new Set<string>();
  const ownerDistances: number[] = [];
  for (const exit of layout.exits) {
    if (!runners.some((r) => r.playerId === exit.ownerId) || owners.has(exit.ownerId)) {
      add('EXIT_INVALID', `owner ${exit.ownerId}`);
      continue;
    }
    owners.add(exit.ownerId);
    if (!template.exitCandidates.some((face) => sameFace(face, exit.wall))) {
      add('EXIT_INVALID', `wall ${exit.wall.x},${exit.wall.y},${exit.wall.side} not a candidate`);
      continue;
    }
    if (!sameCell(exit.approach, approachOf(exit.wall)))
      add('EXIT_INVALID', `approach of ${exit.exitId}`);
    if (!POSE_KINDS.includes(exit.poseKind)) add('EXIT_INVALID', `poseKind of ${exit.exitId}`);
    if (typeof exit.exitId !== 'string' || exit.exitId.length === 0) add('EXIT_INVALID', 'exitId');
    const d = dist(exit.ownerId, exit.approach);
    if (
      d === UNREACHABLE ||
      d < constraints.minExitPathLength ||
      d > constraints.maxExitPathLength
    ) {
      add('EXIT_DISTANCE', `${exit.exitId}:${d}`);
    } else ownerDistances.push(d);
  }
  const ids = new Set(layout.exits.map((e) => e.exitId));
  if (ids.size !== layout.exits.length) add('EXIT_INVALID', 'duplicate exitId');
  for (let i = 0; i < layout.exits.length; i += 1) {
    for (let j = i + 1; j < layout.exits.length; j += 1) {
      const a = layout.exits[i]!;
      const b = layout.exits[j]!;
      if (sameFace(a.wall, b.wall) || sameCell(a.approach, b.approach)) {
        add('EXIT_INVALID', 'exits share a face or approach');
        continue;
      }
      const d = bfsDistances(graph, a.approach).get(nodeIndex(t, b.approach)) ?? UNREACHABLE;
      if (d === UNREACHABLE || d < constraints.minExitDistance)
        add('EXIT_DISTANCE', `between exits:${d}`);
    }
  }
  if (ownerDistances.length === 3) {
    const ratio = Math.max(...ownerDistances) / Math.min(...ownerDistances);
    if (ratio > constraints.maxExitRatio + 1e-9) add('EXIT_RATIO', ratio.toFixed(3));
  }
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}
