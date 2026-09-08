import type {
  LayoutConstraints,
  MatchTuning,
  MatchTuningConfig,
  SelectionBudget,
} from './types.js';
import type { TemplateIssue, TemplateValidation } from './map/types.js';

/** Fixed first-implementation rule constants. The JSON must match these exactly. */
export const MATCH_TUNING_CONSTANTS = Object.freeze({
  tickMs: 50,
  moveTicks: 9,
  turnTicks: 6,
  roundTicks: 3600,
  installationTicks: 10,
  armTicks: 20,
  restraintTicks: 30,
  restraintImmunityTicks: 40,
  exchangeExpiryTicks: 40,
  exitMinimumTicks: 40,
  exitExpiryTicks: 160,
  exitRetryTicks: 10,
} as const);

const LAYOUT_FIELDS: readonly (keyof LayoutConstraints)[] = [
  'minRunnerDistance',
  'minRunnerTaggerDistance',
  'minExitDistance',
  'minExitPathLength',
  'maxExitPathLength',
  'maxExitRatio',
  'minSpawnNeighbors',
];

const SELECTION_FIELDS: readonly (keyof SelectionBudget)[] = [
  'maxAttempts',
  'onlineMapBudgetMs',
  'attemptsPerBatch',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates parsed tuning JSON (server/config/tuning/*.json) into a frozen
 * MatchTuningConfig. Core only ever reads the injected result; it never loads
 * files itself.
 */
export function validateTuning(raw: unknown): TemplateValidation<MatchTuningConfig> {
  const issues: TemplateIssue[] = [];
  const add = (code: TemplateIssue['code'], path: string, message: string) =>
    issues.push(Object.freeze({ code, path: Object.freeze([path]), message }));
  if (!isRecord(raw)) {
    add('INVALID_TYPE', '', 'tuning must be an object');
    return { ok: false, issues: Object.freeze(issues) };
  }
  const { tuningVersion, match, layout, selection } = raw;
  if (typeof tuningVersion !== 'string' || tuningVersion.length === 0) {
    add('MISSING_FIELD', 'tuningVersion', 'tuningVersion must be a non-empty string');
  }
  if (!isRecord(match)) add('INVALID_TYPE', 'match', 'match must be an object');
  else {
    for (const [key, expected] of Object.entries(MATCH_TUNING_CONSTANTS)) {
      if (match[key] !== expected) {
        add('OUT_OF_RANGE', `match.${key}`, `must equal ${expected}`);
      }
    }
  }
  if (!isRecord(layout)) add('INVALID_TYPE', 'layout', 'layout must be an object');
  else {
    for (const key of LAYOUT_FIELDS) {
      const value = layout[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        add('OUT_OF_RANGE', `layout.${key}`, 'must be a positive finite number');
      }
    }
    if (
      typeof layout.minExitPathLength === 'number' &&
      typeof layout.maxExitPathLength === 'number' &&
      layout.minExitPathLength > layout.maxExitPathLength
    ) {
      add('OUT_OF_RANGE', 'layout.minExitPathLength', 'must not exceed maxExitPathLength');
    }
  }
  if (!isRecord(selection)) add('INVALID_TYPE', 'selection', 'selection must be an object');
  else {
    for (const key of SELECTION_FIELDS) {
      const value = selection[key];
      if (!Number.isInteger(value) || (value as number) < 0) {
        add('OUT_OF_RANGE', `selection.${key}`, 'must be a nonnegative integer');
      }
    }
    if (selection.attemptsPerBatch === 0) {
      add('OUT_OF_RANGE', 'selection.attemptsPerBatch', 'must be at least 1');
    }
  }
  if (issues.length > 0) return { ok: false, issues: Object.freeze(issues) };
  const m = match as Record<string, number>;
  const l = layout as Record<string, number>;
  const s = selection as Record<string, number>;
  const matchTuning: MatchTuning = Object.freeze({
    tuningVersion: tuningVersion as string,
    tickMs: m.tickMs as 50,
    moveTicks: m.moveTicks as 9,
    turnTicks: m.turnTicks as 6,
    roundTicks: m.roundTicks as 3600,
    installationTicks: m.installationTicks as 10,
    armTicks: m.armTicks as 20,
    restraintTicks: m.restraintTicks as 30,
    restraintImmunityTicks: m.restraintImmunityTicks as 40,
    exchangeExpiryTicks: m.exchangeExpiryTicks as 40,
    exitMinimumTicks: m.exitMinimumTicks as 40,
    exitExpiryTicks: m.exitExpiryTicks as 160,
    exitRetryTicks: m.exitRetryTicks as 10,
  });
  return {
    ok: true,
    template: Object.freeze({
      tuningVersion: tuningVersion as string,
      match: matchTuning,
      layout: Object.freeze({
        minRunnerDistance: l.minRunnerDistance as number,
        minRunnerTaggerDistance: l.minRunnerTaggerDistance as number,
        minExitDistance: l.minExitDistance as number,
        minExitPathLength: l.minExitPathLength as number,
        maxExitPathLength: l.maxExitPathLength as number,
        maxExitRatio: l.maxExitRatio as number,
        minSpawnNeighbors: l.minSpawnNeighbors as number,
      }),
      selection: Object.freeze({
        maxAttempts: s.maxAttempts as number,
        onlineMapBudgetMs: s.onlineMapBudgetMs as number,
        attemptsPerBatch: s.attemptsPerBatch as number,
      }),
    }),
  };
}
