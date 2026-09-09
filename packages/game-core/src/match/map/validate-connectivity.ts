import type { Cell, LayoutTemplate, WallFace } from '../types.js';
import {
  biconnectedComponents,
  buildGraph,
  hasMinPassageNeighbors,
  isConnected,
  isInCore,
  type BiconnectedAnalysis,
  type PassageGraph,
} from './graph.js';
import { approachOf } from './validate-template.js';

export type ConnectivityIssueCode =
  'DISCONNECTED' | 'NO_CORE' | 'SPAWN_NOT_CORE' | 'SPAWN_NEIGHBORS' | 'EXIT_APPROACH_NOT_CORE';

export type ConnectivityIssue = Readonly<{
  code: ConnectivityIssueCode;
  regionId?: string;
  cell?: Cell;
  face?: WallFace;
}>;

/** Server-internal report. Never forwarded to clients. */
export type ConnectivityReport = Readonly<{
  ok: boolean;
  passageCount: number;
  connected: boolean;
  coreSize: number;
  articulationCount: number;
  issues: readonly ConnectivityIssue[];
}>;

export type TemplateAnalysis = Readonly<{
  graph: PassageGraph;
  biconnected: BiconnectedAnalysis;
}>;

export function analyzeTemplate(template: LayoutTemplate): TemplateAnalysis {
  const graph = buildGraph(template.topology);
  return Object.freeze({ graph, biconnected: biconnectedComponents(graph) });
}

/**
 * Checks that all passages form one component, that every spawn candidate and
 * exit approach cell belongs to the core biconnected component, and that spawn
 * candidates keep at least `minSpawnNeighbors` passage neighbors. A connected
 * grid alone does not pass: dead-end approaches fail the core check.
 */
export function validateConnectivity(
  template: LayoutTemplate,
  options: Readonly<{ minSpawnNeighbors?: number; analysis?: TemplateAnalysis }> = {},
): ConnectivityReport {
  const analysis = options.analysis ?? analyzeTemplate(template);
  const minNeighbors = options.minSpawnNeighbors ?? 2;
  const { graph, biconnected } = analysis;
  const issues: ConnectivityIssue[] = [];
  const connected = isConnected(graph);
  if (!connected) issues.push({ code: 'DISCONNECTED' });
  if (biconnected.coreIndex < 0) issues.push({ code: 'NO_CORE' });
  for (const region of [...template.taggerRegions, ...template.runnerSpawnRegions]) {
    for (const cell of region.spawnCandidates) {
      if (!hasMinPassageNeighbors(template.topology, cell, minNeighbors)) {
        issues.push({ code: 'SPAWN_NEIGHBORS', regionId: region.regionId, cell });
      }
      if (!isInCore(graph, biconnected, cell)) {
        issues.push({ code: 'SPAWN_NOT_CORE', regionId: region.regionId, cell });
      }
    }
  }
  for (const face of template.exitCandidates) {
    if (!isInCore(graph, biconnected, approachOf(face))) {
      issues.push({ code: 'EXIT_APPROACH_NOT_CORE', face });
    }
  }
  const coreSize =
    biconnected.coreIndex >= 0 ? biconnected.components[biconnected.coreIndex]!.size : 0;
  return Object.freeze({
    ok: issues.length === 0,
    passageCount: graph.nodes.length,
    connected,
    coreSize,
    articulationCount: biconnected.articulationPoints.size,
    issues: Object.freeze(issues),
  });
}
