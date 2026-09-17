#!/usr/bin/env node
/**
 * S15P21C204-267. Generates the corridor-width-1 maze template `maze-v1` and its certified
 * placement fallbacks from a fixed seed, so the committed JSON can be reproduced byte for byte.
 *
 *   pnpm build:packages && node scripts/generate-maze-template.mjs [--check]
 *
 * The maze lives on the odd lattice of a 31×31 grid: junction cells at odd coordinates, one-cell
 * connectors between them, walls everywhere else. That makes every corridor exactly one cell wide
 * and rules out 2×2 open blocks by construction. A perfect maze (a tree) is carved first, then
 * braided: every dead end is opened toward a neighbour and every articulation point is bypassed,
 * until the whole passage graph is one biconnected component. The rules' placement validators
 * require spawn candidates and exit approaches to lie in that core, so a tree would never certify.
 *
 * With --check the script regenerates in memory and fails if the committed files differ.
 */
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
import {
  RUNNER_SLOTS,
  TAGGER_SLOTS,
  UNREACHABLE,
  bfsDistances,
  biconnectedComponents,
  buildGraph,
  createTemplateVariants,
  nodeIndex,
  selectLayout,
  validateConnectivity,
  validateTemplate,
  validateTuning,
} from '@kkakkung/game-core/match';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAP_PATH = resolve(root, 'server/content/maps/maze-v1.json');
const FALLBACK_PATH = resolve(root, 'server/content/placements/maze-v1-fallback.json');
const TUNING_PATH = resolve(root, 'server/config/tuning/mvp-v1.json');

export const TEMPLATE_ID = 'maze-v1';
export const TEMPLATE_VERSION = '1';
export const SIZE = 31;
/** Seed of the maze itself. Changing it is a new template version, not a regeneration. */
export const MAZE_SEED = 267;
/** Fallback placements are searched from this seed upward per variant. */
const FALLBACK_SEED_START = 1;

/**
 * Regions in cell coordinates (inclusive). Taggers hold the middle band, runners start in the two
 * upper corners and the lower middle, mirroring master-v1 so the D4 variants stay comparable.
 */
const TAGGER_RECTS = [
  { regionId: 'tagger-west', x0: 1, y0: 11, x1: 9, y1: 19 },
  { regionId: 'tagger-center', x0: 11, y0: 11, x1: 19, y1: 19 },
  { regionId: 'tagger-east', x0: 21, y0: 11, x1: 29, y1: 19 },
];
const RUNNER_RECTS = [
  { regionId: 'runner-northwest', x0: 1, y0: 1, x1: 7, y1: 5 },
  { regionId: 'runner-northeast', x0: 23, y0: 1, x1: 29, y1: 5 },
  { regionId: 'runner-south', x0: 11, y0: 25, x1: 19, y1: 29 },
];

const DIRS = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
];

/** mulberry32, mutable form for the generator only (the rules keep their own pure RNG). */
function rng(seed) {
  let state = seed >>> 0;
  return {
    next() {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    int(bound) {
      return Math.floor(this.next() * bound);
    },
    shuffle(items) {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = this.int(i + 1);
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    },
  };
}

class Grid {
  constructor(size) {
    this.size = size;
    this.open = new Uint8Array(size * size);
  }
  key(x, y) {
    return y * this.size + x;
  }
  isOpen(x, y) {
    return x >= 0 && y >= 0 && x < this.size && y < this.size && this.open[this.key(x, y)] === 1;
  }
  carve(x, y) {
    this.open[this.key(x, y)] = 1;
  }
  rows() {
    const rows = [];
    for (let y = 0; y < this.size; y += 1) {
      let row = '';
      for (let x = 0; x < this.size; x += 1) row += this.isOpen(x, y) ? '.' : '#';
      rows.push(row);
    }
    return rows;
  }
  topology() {
    return {
      topologyVersion: 'generator',
      width: this.size,
      height: this.size,
      walkable: Array.from(this.open, (v) => v === 1),
    };
  }
}

const isNode = (x, y) => x % 2 === 1 && y % 2 === 1;

function nodesOf(size) {
  const nodes = [];
  for (let y = 1; y < size - 1; y += 2) for (let x = 1; x < size - 1; x += 2) nodes.push({ x, y });
  return nodes;
}

/** Junction neighbours two cells away, with the connector cell between. */
function lattice(grid, node) {
  const out = [];
  for (const d of DIRS) {
    const nx = node.x + 2 * d.dx;
    const ny = node.y + 2 * d.dy;
    if (nx < 1 || ny < 1 || nx > grid.size - 2 || ny > grid.size - 2) continue;
    out.push({ node: { x: nx, y: ny }, between: { x: node.x + d.dx, y: node.y + d.dy } });
  }
  return out;
}

function carvePerfectMaze(grid, random) {
  for (const node of nodesOf(grid.size)) grid.carve(node.x, node.y);
  const visited = new Set();
  const start = { x: 1, y: 1 };
  visited.add(grid.key(start.x, start.y));
  const stack = [start];
  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    const options = lattice(grid, current).filter(
      ({ node }) => !visited.has(grid.key(node.x, node.y)),
    );
    if (options.length === 0) {
      stack.pop();
      continue;
    }
    const chosen = options[random.int(options.length)];
    grid.carve(chosen.between.x, chosen.between.y);
    visited.add(grid.key(chosen.node.x, chosen.node.y));
    stack.push(chosen.node);
  }
}

function degree(grid, node) {
  return DIRS.filter((d) => grid.isOpen(node.x + d.dx, node.y + d.dy)).length;
}

/** Opens every dead end toward one closed neighbour. Returns how many were opened. */
function braidDeadEnds(grid, random) {
  let opened = 0;
  for (const node of random.shuffle(nodesOf(grid.size))) {
    if (degree(grid, node) !== 1) continue;
    const closed = lattice(grid, node).filter(({ between }) => !grid.isOpen(between.x, between.y));
    if (closed.length === 0) continue;
    const chosen = closed[random.int(closed.length)];
    grid.carve(chosen.between.x, chosen.between.y);
    opened += 1;
  }
  return opened;
}

function componentsWithout(grid, graph, removed) {
  const topology = graph.topology;
  const removedIndex = nodeIndex(topology, removed);
  const label = new Map();
  let count = 0;
  for (const node of graph.nodes) {
    if (node === removedIndex || label.has(node)) continue;
    const queue = [node];
    label.set(node, count);
    for (let head = 0; head < queue.length; head += 1) {
      for (const next of graph.adjacency.get(queue[head]) ?? []) {
        if (next === removedIndex || label.has(next)) continue;
        label.set(next, count);
        queue.push(next);
      }
    }
    count += 1;
  }
  return label;
}

/**
 * Adds one bypass around one articulation point: a closed connector whose two junctions fall on
 * different sides of the cut. Returns false when the graph is already biconnected.
 */
function bypassOneArticulation(grid, random) {
  const graph = buildGraph(grid.topology());
  const analysis = biconnectedComponents(graph);
  if (analysis.articulationPoints.size === 0) return false;
  const points = random.shuffle([...analysis.articulationPoints]);
  for (const point of points) {
    const cell = { x: point % grid.size, y: Math.floor(point / grid.size) };
    const label = componentsWithout(grid, graph, cell);
    const candidates = [];
    for (const node of nodesOf(grid.size)) {
      const a = label.get(grid.key(node.x, node.y));
      if (a === undefined) continue;
      for (const { node: other, between } of lattice(grid, node)) {
        if (grid.isOpen(between.x, between.y)) continue;
        if (other.x < node.x || other.y < node.y) continue;
        const b = label.get(grid.key(other.x, other.y));
        if (b !== undefined && b !== a) candidates.push(between);
      }
    }
    if (candidates.length === 0) continue;
    const chosen = candidates[random.int(candidates.length)];
    grid.carve(chosen.x, chosen.y);
    return true;
  }
  throw new Error('articulation point without a bypass candidate');
}

function cellsInRect(grid, rect, predicate) {
  const cells = [];
  for (let y = rect.y0; y <= rect.y1; y += 1) {
    for (let x = rect.x0; x <= rect.x1; x += 1) {
      if (grid.isOpen(x, y) && predicate(x, y)) cells.push({ x, y });
    }
  }
  return cells;
}

function regionOf(grid, rect) {
  return {
    regionId: rect.regionId,
    cells: cellsInRect(grid, rect, () => true),
    spawnCandidates: cellsInRect(grid, rect, (x, y) => isNode(x, y) && degree(grid, { x, y }) >= 2),
  };
}

/** Inner wall faces whose approach cell is a junction, so an exit never plugs a plain corridor. */
function exitCandidatesOf(grid) {
  const faces = [];
  for (const node of nodesOf(grid.size)) {
    DIRS.forEach((d, side) => {
      const wx = node.x + d.dx;
      const wy = node.y + d.dy;
      if (grid.isOpen(wx, wy)) return;
      if (wx === 0 || wy === 0 || wx === grid.size - 1 || wy === grid.size - 1) return;
      // The face belongs to the wall cell and points back toward the approach (the node).
      faces.push({ x: wx, y: wy, side: (side + 2) % 4 });
    });
  }
  return faces;
}

export function generateMaze(seed = MAZE_SEED) {
  const random = rng(seed);
  const grid = new Grid(SIZE);
  carvePerfectMaze(grid, random);
  const junctions = nodesOf(SIZE).length;
  const deadEndsBefore = nodesOf(SIZE).filter((n) => degree(grid, n) === 1).length;
  const braided = braidDeadEnds(grid, random);
  let bypasses = 0;
  while (bypassOneArticulation(grid, random)) bypasses += 1;
  const connectors = grid.open.reduce((sum, v) => sum + v, 0) - junctions;
  const template = {
    templateId: TEMPLATE_ID,
    templateVersion: TEMPLATE_VERSION,
    width: SIZE,
    height: SIZE,
    rows: grid.rows(),
    taggerRegions: TAGGER_RECTS.map((rect) => regionOf(grid, rect)),
    runnerSpawnRegions: RUNNER_RECTS.map((rect) => regionOf(grid, rect)),
    exitCandidates: exitCandidatesOf(grid),
  };
  const stats = {
    junctions,
    connectors,
    cycles: connectors - junctions + 1,
    deadEndsBefore,
    deadEndRatioBefore: deadEndsBefore / junctions,
    braided,
    bypasses,
    exitCandidates: template.exitCandidates.length,
  };
  return { template, stats };
}

async function pretty(text, filepath) {
  const options = (await prettier.resolveConfig(filepath)) ?? {};
  return prettier.format(text, { ...options, filepath });
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

const slotRoster = [
  ...TAGGER_SLOTS.map((playerId) => ({ playerId, role: 'tagger' })),
  ...RUNNER_SLOTS.map((playerId) => ({ playerId, role: 'runner' })),
];

/** Validates, transforms, connectivity-checks, and searches a certified fallback per variant. */
export function certify(rawTemplate, templateHash, tuning) {
  const source = {
    templateId: rawTemplate.templateId,
    templateVersion: rawTemplate.templateVersion,
    templateHash,
    variantId: 'r0',
  };
  const validated = validateTemplate(rawTemplate, source, {
    minSpawnNeighbors: tuning.layout.minSpawnNeighbors,
  });
  if (validated.status !== 'valid') throw new Error(JSON.stringify(validated, null, 2));
  const variants = createTemplateVariants(validated.template);
  if (variants.status !== 'valid') throw new Error(JSON.stringify(variants, null, 2));
  const fallbacks = [];
  for (const variant of variants.variants) {
    const report = validateConnectivity(variant, {
      minSpawnNeighbors: tuning.layout.minSpawnNeighbors,
    });
    if (!report.ok) throw new Error(`${variant.variantId}: ${JSON.stringify(report.issues)}`);
    let layout = null;
    for (let seed = FALLBACK_SEED_START; seed < FALLBACK_SEED_START + 64 && !layout; seed += 1) {
      const result = selectLayout(
        variant,
        slotRoster,
        seed,
        tuning.selection.maxAttempts,
        tuning.layout,
      );
      if (result.ok) layout = result.layout;
    }
    if (!layout) throw new Error(`${variant.variantId}: no fallback within the seed budget`);
    fallbacks.push({
      templateId: variant.templateId,
      templateVersion: variant.templateVersion,
      templateHash,
      variantId: variant.variantId,
      layout,
    });
  }
  return { template: validated.template, variants: variants.variants, fallbacks };
}

/** Rough placement odds: how many spawn pairs already satisfy the distance floors. */
function pairOdds(template, constraints) {
  const graph = buildGraph(template.topology);
  const taggers = template.taggerRegions.flatMap((r) => r.spawnCandidates);
  const runners = template.runnerSpawnRegions.flatMap((r) => r.spawnCandidates);
  let ok = 0;
  let total = 0;
  for (const runner of runners) {
    const table = bfsDistances(graph, runner);
    for (const tagger of taggers) {
      const d = table.get(nodeIndex(template.topology, tagger)) ?? UNREACHABLE;
      total += 1;
      if (d >= constraints.minRunnerTaggerDistance) ok += 1;
    }
  }
  return ok / total;
}

async function main() {
  const check = process.argv.includes('--check');
  const tuningResult = validateTuning(JSON.parse(readFileSync(TUNING_PATH, 'utf8')));
  if (!tuningResult.ok) throw new Error('tuning invalid');
  const tuning = tuningResult.template;

  const { template, stats } = generateMaze();
  const mapText = await pretty(JSON.stringify(template, null, 2), MAP_PATH);
  const mapBytes = Buffer.from(mapText, 'utf8');
  const templateHash = sha256(mapBytes);
  const certified = certify(template, templateHash, tuning);
  const fallbackFile = {
    templateId: TEMPLATE_ID,
    templateVersion: TEMPLATE_VERSION,
    templateHash,
    fallbacks: certified.fallbacks,
  };
  const fallbackText = await pretty(JSON.stringify(fallbackFile, null, 2), FALLBACK_PATH);

  const summary = {
    ...stats,
    variants: certified.variants.map((v) => v.variantId),
    templateHash,
    runnerTaggerPairsAtOrAboveFloor: pairOdds(certified.template, tuning.layout).toFixed(3),
  };
  if (check) {
    const same =
      existsSync(MAP_PATH) &&
      existsSync(FALLBACK_PATH) &&
      readFileSync(MAP_PATH, 'utf8') === mapText &&
      readFileSync(FALLBACK_PATH, 'utf8') === fallbackText;
    console.log(JSON.stringify({ ...summary, committedMatches: same }, null, 2));
    if (!same) process.exit(1);
    return;
  }
  writeFileSync(MAP_PATH, mapBytes);
  writeFileSync(FALLBACK_PATH, fallbackText, 'utf8');
  console.log(JSON.stringify({ ...summary, wrote: [MAP_PATH, FALLBACK_PATH] }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
