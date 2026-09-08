import type { Cell, Dir, Topology } from '../types.js';
import { DIR_VECTORS, isWalkable } from './validate-template.js';

/** Returned by distance queries when no passage path exists. */
export const UNREACHABLE = -1;

/**
 * Server-only immutable passage graph. Nodes are passage cells indexed by
 * y * width + x; edges connect orthogonal passage neighbors only. Distances are
 * path moves (edge count), so two adjacent cells are at distance 1.
 */
export type PassageGraph = Readonly<{
  topology: Topology;
  /** Passage node indices in ascending order. */
  nodes: readonly number[];
  /** Adjacent passage node indices for each node index; empty for walls. */
  adjacency: ReadonlyMap<number, readonly number[]>;
}>;

export function nodeIndex(topology: Topology, cell: Cell): number {
  return cell.y * topology.width + cell.x;
}

export function cellOfNode(topology: Topology, node: number): Cell {
  return { x: node % topology.width, y: Math.floor(node / topology.width) };
}

export function buildGraph(topology: Topology): PassageGraph {
  const nodes: number[] = [];
  const adjacency = new Map<number, readonly number[]>();
  for (let y = 0; y < topology.height; y += 1) {
    for (let x = 0; x < topology.width; x += 1) {
      const cell = { x, y };
      if (!isWalkable(topology, cell)) continue;
      const node = nodeIndex(topology, cell);
      nodes.push(node);
      const next: number[] = [];
      for (const side of [0, 1, 2, 3] as const) {
        const vector = DIR_VECTORS[side];
        const neighbor = { x: x + vector.dx, y: y + vector.dy };
        if (isWalkable(topology, neighbor)) next.push(nodeIndex(topology, neighbor));
      }
      adjacency.set(node, Object.freeze(next));
    }
  }
  return Object.freeze({ topology, nodes: Object.freeze(nodes), adjacency });
}

/** BFS distances from one cell to every node; UNREACHABLE where no path exists. */
export function bfsDistances(graph: PassageGraph, from: Cell): ReadonlyMap<number, number> {
  const distances = new Map<number, number>();
  if (!isWalkable(graph.topology, from)) return distances;
  const start = nodeIndex(graph.topology, from);
  distances.set(start, 0);
  const queue: number[] = [start];
  for (let head = 0; head < queue.length; head += 1) {
    const node = queue[head]!;
    const base = distances.get(node)!;
    for (const next of graph.adjacency.get(node) ?? []) {
      if (distances.has(next)) continue;
      distances.set(next, base + 1);
      queue.push(next);
    }
  }
  return distances;
}

export function distance(graph: PassageGraph, from: Cell, to: Cell): number {
  if (!isWalkable(graph.topology, to)) return UNREACHABLE;
  return bfsDistances(graph, from).get(nodeIndex(graph.topology, to)) ?? UNREACHABLE;
}

/** Pairwise path distances between the given cells; UNREACHABLE for missing paths. */
export function distanceMatrix(graph: PassageGraph, cells: readonly Cell[]): number[][] {
  return cells.map((from) => {
    const table = bfsDistances(graph, from);
    return cells.map((to) =>
      isWalkable(graph.topology, to)
        ? (table.get(nodeIndex(graph.topology, to)) ?? UNREACHABLE)
        : UNREACHABLE,
    );
  });
}

export function isConnected(graph: PassageGraph): boolean {
  const first = graph.nodes[0];
  if (first === undefined) return false;
  const reached = bfsDistances(graph, cellOfNode(graph.topology, first));
  return reached.size === graph.nodes.length;
}

export type BiconnectedAnalysis = Readonly<{
  /** Nodes whose removal disconnects the graph. */
  articulationPoints: ReadonlySet<number>;
  /** Node sets of every biconnected component (edge-based; articulation nodes appear in several). */
  components: readonly ReadonlySet<number>[];
  /** Index into `components` of the largest component, or -1 when the graph has no edges. */
  coreIndex: number;
}>;

/**
 * Tarjan low-link decomposition into biconnected components. The core is the
 * largest component: dead-end branches behind an articulation point form their
 * own small components and are therefore outside the core.
 */
export function biconnectedComponents(graph: PassageGraph): BiconnectedAnalysis {
  const disc = new Map<number, number>();
  const low = new Map<number, number>();
  const articulation = new Set<number>();
  const components: Set<number>[] = [];
  const edgeStack: [number, number][] = [];
  let time = 0;

  const visit = (root: number): void => {
    // Iterative DFS with explicit frames to stay safe on long corridors.
    const frames: { node: number; parent: number; next: number }[] = [
      { node: root, parent: -1, next: 0 },
    ];
    disc.set(root, time);
    low.set(root, time);
    time += 1;
    let rootChildren = 0;
    while (frames.length > 0) {
      const frame = frames[frames.length - 1]!;
      const neighbors = graph.adjacency.get(frame.node) ?? [];
      if (frame.next < neighbors.length) {
        const next = neighbors[frame.next]!;
        frame.next += 1;
        if (next === frame.parent) continue;
        if (!disc.has(next)) {
          edgeStack.push([frame.node, next]);
          disc.set(next, time);
          low.set(next, time);
          time += 1;
          if (frame.node === root) rootChildren += 1;
          frames.push({ node: next, parent: frame.node, next: 0 });
        } else if (disc.get(next)! < disc.get(frame.node)!) {
          edgeStack.push([frame.node, next]);
          low.set(frame.node, Math.min(low.get(frame.node)!, disc.get(next)!));
        }
        continue;
      }
      frames.pop();
      const parentFrame = frames[frames.length - 1];
      if (!parentFrame) continue;
      const parent = parentFrame.node;
      low.set(parent, Math.min(low.get(parent)!, low.get(frame.node)!));
      if (low.get(frame.node)! >= disc.get(parent)!) {
        if (parent !== root) articulation.add(parent);
        const component = new Set<number>();
        while (edgeStack.length > 0) {
          const [a, b] = edgeStack.pop()!;
          component.add(a);
          component.add(b);
          if (a === parent && b === frame.node) break;
        }
        components.push(component);
      }
    }
    if (rootChildren > 1) articulation.add(root);
  };

  for (const node of graph.nodes) {
    if (!disc.has(node)) visit(node);
  }
  let coreIndex = -1;
  components.forEach((component, index) => {
    if (coreIndex === -1 || component.size > components[coreIndex]!.size) coreIndex = index;
  });
  return Object.freeze({
    articulationPoints: articulation,
    components: Object.freeze(components),
    coreIndex,
  });
}

export function isInCore(graph: PassageGraph, analysis: BiconnectedAnalysis, cell: Cell): boolean {
  if (analysis.coreIndex < 0 || !isWalkable(graph.topology, cell)) return false;
  return analysis.components[analysis.coreIndex]!.has(nodeIndex(graph.topology, cell));
}

/** Start predicate: the cell has at least `min` orthogonal passage neighbors. */
export function hasMinPassageNeighbors(topology: Topology, cell: Cell, min: number): boolean {
  let count = 0;
  for (const side of [0, 1, 2, 3] as const) {
    const vector = DIR_VECTORS[side];
    if (isWalkable(topology, { x: cell.x + vector.dx, y: cell.y + vector.dy })) count += 1;
  }
  return count >= min;
}

/** Start predicate: the cell directly ahead in `dir` is a passage. */
export function facesPassage(topology: Topology, cell: Cell, dir: Dir): boolean {
  const vector = DIR_VECTORS[dir];
  return isWalkable(topology, { x: cell.x + vector.dx, y: cell.y + vector.dy });
}
