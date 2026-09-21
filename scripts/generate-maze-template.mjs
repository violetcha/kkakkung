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
  scaleLayoutConstraints,
  validateTemplate,
  validateTuning,
} from '@kkakkung/game-core/match';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TUNING_PATH = resolve(root, 'server/config/tuning/mvp-v1.json');
const mapPath = (id) => resolve(root, `server/content/maps/${id}.json`);
const fallbackPath = (id) => resolve(root, `server/content/placements/${id}-fallback.json`);

export const TEMPLATE_VERSION = '1';
/** The size every scaled value is written against. maze-v1 keeps its committed geometry. */
export const BASE_SIZE = 31;

/**
 * S15P21C204-321. One certified template per room map size. Sizes are odd because the maze lives
 * on an odd lattice; the lobby shows 16x16 / 24x24 / 32x32 and these are the real grids.
 * Seeds differ so the three mazes are not scaled copies of one another.
 */
export const MAPS = Object.freeze([
  Object.freeze({ id: 'maze-s-v1', size: 15, seed: 321 }),
  Object.freeze({ id: 'maze-m-v1', size: 23, seed: 322 }),
  Object.freeze({ id: 'maze-v1', size: BASE_SIZE, seed: 267 }),
]);
/** Seed of the maze itself. Changing it is a new template version, not a regeneration. */
export const MAZE_SEED = 267;
/** Fallback placements are searched from this seed upward per variant. */
const FALLBACK_SEED_START = 1;

/**
 * Regions in cell coordinates (inclusive), derived from the grid size. Taggers hold the middle
 * band, runners start in the two upper corners and the lower middle, mirroring master-v1 so the
 * D4 variants stay comparable. At size 31 this reproduces the committed maze-v1 rectangles
 * exactly, so that template regenerates byte for byte.
 */
export function regionRects(size) {
  const inner = size - 2;
  // Three tagger rectangles side by side with a one-cell wall between them.
  const band = Math.floor((inner - 2) / 3);
  const bandHeight = Math.max(5, band);
  const midY = (size - 1) / 2;
  const y0 = midY - Math.floor(bandHeight / 2);
  const taggerRects = ['west', 'center', 'east'].map((name, index) => ({
    regionId: `tagger-${name}`,
    x0: 1 + index * (band + 1),
    y0,
    x1: index * (band + 1) + band,
    y1: y0 + bandHeight - 1,
  }));
  // Runner areas sit clear of the band: two top corners and one bottom middle.
  const corner = Math.max(3, band - 2);
  const depth = Math.max(3, Math.round((5 * size) / BASE_SIZE));
  const southX0 = midY - Math.floor(band / 2);
  const runnerRects = [
    { regionId: 'runner-northwest', x0: 1, y0: 1, x1: corner, y1: depth },
    { regionId: 'runner-northeast', x0: size - 1 - corner, y0: 1, x1: size - 2, y1: depth },
    {
      regionId: 'runner-south',
      x0: southX0,
      y0: size - 1 - depth,
      x1: southX0 + band - 1,
      y1: size - 2,
    },
  ];
  return { taggerRects, runnerRects };
}

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

export function generateMaze(map) {
  const { id, size, seed } = map;
  const { taggerRects, runnerRects } = regionRects(size);
  const random = rng(seed);
  const grid = new Grid(size);
  carvePerfectMaze(grid, random);
  const junctions = nodesOf(size).length;
  const deadEndsBefore = nodesOf(size).filter((n) => degree(grid, n) === 1).length;
  const braided = braidDeadEnds(grid, random);
  let bypasses = 0;
  while (bypassOneArticulation(grid, random)) bypasses += 1;
  const connectors = grid.open.reduce((sum, v) => sum + v, 0) - junctions;
  const template = {
    templateId: id,
    templateVersion: TEMPLATE_VERSION,
    width: size,
    height: size,
    rows: grid.rows(),
    taggerRegions: taggerRects.map((rect) => regionOf(grid, rect)),
    runnerSpawnRegions: runnerRects.map((rect) => regionOf(grid, rect)),
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
export function certify(rawTemplate, templateHash, constraints, selection) {
  const source = {
    templateId: rawTemplate.templateId,
    templateVersion: rawTemplate.templateVersion,
    templateHash,
    variantId: 'r0',
  };
  const validated = validateTemplate(rawTemplate, source, {
    minSpawnNeighbors: constraints.minSpawnNeighbors,
  });
  if (validated.status !== 'valid') throw new Error(JSON.stringify(validated, null, 2));
  const variants = createTemplateVariants(validated.template);
  if (variants.status !== 'valid') throw new Error(JSON.stringify(variants, null, 2));
  const fallbacks = [];
  for (const variant of variants.variants) {
    const report = validateConnectivity(variant, {
      minSpawnNeighbors: constraints.minSpawnNeighbors,
    });
    if (!report.ok) throw new Error(`${variant.variantId}: ${JSON.stringify(report.issues)}`);
    let layout = null;
    for (let seed = FALLBACK_SEED_START; seed < FALLBACK_SEED_START + 64 && !layout; seed += 1) {
      const result = selectLayout(variant, slotRoster, seed, selection.maxAttempts, constraints);
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

async function buildMap(map, tuning) {
  const layout = scaleLayoutConstraints(tuning.layout, map.size);
  const { template, stats } = generateMaze(map);
  const mapText = await pretty(JSON.stringify(template, null, 2), mapPath(map.id));
  const mapBytes = Buffer.from(mapText, 'utf8');
  const templateHash = sha256(mapBytes);
  const certified = certify(template, templateHash, layout, tuning.selection);
  const fallbackText = await pretty(
    JSON.stringify(
      {
        templateId: map.id,
        templateVersion: TEMPLATE_VERSION,
        templateHash,
        fallbacks: certified.fallbacks,
      },
      null,
      2,
    ),
    fallbackPath(map.id),
  );
  return {
    map,
    mapText,
    mapBytes,
    fallbackText,
    summary: {
      templateId: map.id,
      size: map.size,
      ...stats,
      layout,
      variants: certified.variants.map((v) => v.variantId),
      templateHash,
      runnerTaggerPairsAtOrAboveFloor: pairOdds(certified.template, layout).toFixed(3),
    },
  };
}

async function main() {
  const check = process.argv.includes('--check');
  const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice('--only='.length);
  const tuningResult = validateTuning(JSON.parse(readFileSync(TUNING_PATH, 'utf8')));
  if (!tuningResult.ok) throw new Error('tuning invalid');
  const tuning = tuningResult.template;

  const maps = only ? MAPS.filter((m) => m.id === only) : MAPS;
  if (maps.length === 0) throw new Error('no such map: ' + only);
  const built = [];
  for (const map of maps) built.push(await buildMap(map, tuning));

  if (check) {
    const report = built.map((b) => ({
      ...b.summary,
      committedMatches:
        existsSync(mapPath(b.map.id)) &&
        existsSync(fallbackPath(b.map.id)) &&
        readFileSync(mapPath(b.map.id), 'utf8') === b.mapText &&
        readFileSync(fallbackPath(b.map.id), 'utf8') === b.fallbackText,
    }));
    console.log(JSON.stringify(report, null, 2));
    if (report.some((entry) => !entry.committedMatches)) process.exit(1);
    return;
  }
  for (const b of built) {
    writeFileSync(mapPath(b.map.id), b.mapBytes);
    writeFileSync(fallbackPath(b.map.id), b.fallbackText, 'utf8');
  }
  console.log(
    JSON.stringify(
      built.map((b) => b.summary),
      null,
      2,
    ),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
