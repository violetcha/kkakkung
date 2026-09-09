import type {
  FallbackLayout,
  LayoutConstraints,
  LayoutSelectionInput,
  LayoutSelectionResult,
  MatchLayout,
  RosterEntry,
  SelectionBudget,
  SelectionProgress,
} from '../types.js';
import { createRng } from '../random.js';
import { attemptLayout, prepareSelection, sortRoster } from './select-layout.js';
import { validateLayout } from './validate-layout.js';

export const UNAVAILABLE: LayoutSelectionResult = Object.freeze({
  status: 'unavailable',
  code: 'LAYOUT_UNAVAILABLE',
});

export const TAGGER_SLOTS = Object.freeze(['tagger-1', 'tagger-2', 'tagger-3'] as const);
export const RUNNER_SLOTS = Object.freeze(['runner-1', 'runner-2', 'runner-3'] as const);

export type LayoutSelectionPort = Readonly<{
  certifyFallback(input: LayoutSelectionInput): LayoutSelectionResult;
  selectWithFallback(
    input: LayoutSelectionInput,
  ): Generator<SelectionProgress, LayoutSelectionResult, void>;
}>;

/**
 * Rebinds the stable slots tagger-1..3 / runner-1..3 of a stored layout to the
 * current roster. Players are sorted per role by default string order (no
 * locale). Returns null on a roster/slot mismatch or any leftover slot reference.
 * The stored layout and the roster are never modified.
 */
export function bindFallbackPlayers(
  stored: MatchLayout,
  players: readonly RosterEntry[],
): MatchLayout | null {
  const roster = sortRoster(players);
  if (!roster) return null;
  const mapping = new Map<string, string>();
  TAGGER_SLOTS.forEach((slot, i) => mapping.set(slot, roster.taggers[i]!));
  RUNNER_SLOTS.forEach((slot, i) => mapping.set(slot, roster.runners[i]!));

  const slotsSeen = new Set<string>();
  const boundPlayers = [];
  for (const player of stored.players) {
    const bound = mapping.get(player.playerId);
    if (!bound || slotsSeen.has(player.playerId)) return null;
    const expectedRole = player.playerId.startsWith('tagger') ? 'tagger' : 'runner';
    if (player.role !== expectedRole) return null;
    slotsSeen.add(player.playerId);
    boundPlayers.push({ ...player, playerId: bound });
  }
  if (slotsSeen.size !== 6) return null;

  const boundExits = [];
  for (const exit of stored.exits) {
    const owner = mapping.get(exit.ownerId);
    if (!owner || !exit.ownerId.startsWith('runner')) return null;
    boundExits.push({ ...exit, ownerId: owner });
  }
  const boundTerritories = [];
  for (const territory of stored.territories) {
    const owner = mapping.get(territory.playerId);
    if (!owner || !territory.playerId.startsWith('tagger')) return null;
    boundTerritories.push({ ...territory, playerId: owner });
  }
  return {
    layoutId: stored.layoutId,
    topology: stored.topology,
    players: boundPlayers,
    exits: boundExits,
    territories: boundTerritories,
  };
}

function sameSource(input: LayoutSelectionInput, fallback: FallbackLayout): boolean {
  const t = input.template;
  return (
    typeof fallback.templateHash === 'string' &&
    fallback.templateHash.length > 0 &&
    fallback.templateId === t.templateId &&
    fallback.templateVersion === t.templateVersion &&
    fallback.templateHash === t.templateHash &&
    fallback.variantId === t.variantId
  );
}

/**
 * Finite certification of the stored fallback: source fields, topology, slot
 * binding, and every placement constraint are re-checked. No online search is
 * mixed in. A hash match alone never certifies.
 */
export function certifyFallback(
  input: LayoutSelectionInput,
  constraints: LayoutConstraints,
): LayoutSelectionResult {
  if (!input.fallback || !sameSource(input, input.fallback)) return UNAVAILABLE;
  const bound = bindFallbackPlayers(input.fallback.layout, input.players);
  if (!bound) return UNAVAILABLE;
  const check = validateLayout(input.template, bound, input.players, constraints);
  if (!check.ok) return UNAVAILABLE;
  return { status: 'selected', layout: bound, source: 'fallback' };
}

/**
 * Pure online selection. Each next() examines at most `attemptsPerBatch`
 * candidates and yields progress; the server checks its monotonic deadline
 * between calls and may close the iterator with `return(certifiedResult)`.
 * When attempts are exhausted the certified fallback is returned, or
 * LAYOUT_UNAVAILABLE if it fails certification. No clock or IO is used here.
 */
export function* selectWithFallback(
  input: LayoutSelectionInput,
  constraints: LayoutConstraints,
  attemptsPerBatch: number,
): Generator<SelectionProgress, LayoutSelectionResult, void> {
  if (!Number.isInteger(attemptsPerBatch) || attemptsPerBatch < 1) {
    throw new RangeError('attemptsPerBatch must be a positive integer');
  }
  const maxAttempts =
    Number.isInteger(input.maxAttempts) && input.maxAttempts > 0 ? input.maxAttempts : 0;
  const ctx = prepareSelection(input.template, input.players, constraints);
  if (ctx && maxAttempts > 0) {
    let rng = createRng(input.seed);
    let attempted = 0;
    while (attempted < maxAttempts) {
      const batch = Math.min(attemptsPerBatch, maxAttempts - attempted);
      for (let i = 0; i < batch; i += 1) {
        const attempt = attemptLayout(ctx, rng);
        rng = attempt.rng;
        attempted += 1;
        if (attempt.result.ok) {
          return { status: 'selected', layout: attempt.result.layout, source: 'online' };
        }
      }
      if (attempted < maxAttempts) yield { attempted, batchAttempts: batch };
    }
  }
  return certifyFallback(input, constraints);
}

/** Binds tuning to the EXEC-CONTRACT-3 LayoutSelectionPort signatures. */
export function createLayoutSelector(
  config: Readonly<{ layout: LayoutConstraints; selection: SelectionBudget }>,
): LayoutSelectionPort {
  return Object.freeze({
    certifyFallback: (input: LayoutSelectionInput) => certifyFallback(input, config.layout),
    selectWithFallback: (input: LayoutSelectionInput) =>
      selectWithFallback(input, config.layout, config.selection.attemptsPerBatch),
  });
}
