import { privateViewSchema } from '@kkakkung/protocol/game-messages';
import type {
  GameViewScope,
  Phase,
  PrivateView,
  PublicRoundState,
} from '@kkakkung/protocol/game-schema';

export function phaseScope(phase: Phase): GameViewScope['kind'] {
  if (phase === 'TEAM_PRACTICE') return 'practice';
  return ['GAME_LOADING', 'COUNTDOWN', 'PLAYING', 'RESULT'].includes(phase) ? 'game' : 'none';
}
export function createProductView(deps: {
  now(): number;
  changed(view: PrivateView | null): void;
  resync(matchId: string, version: number): void;
}) {
  let round: PublicRoundState | null = null;
  let current: PrivateView | null = null;
  let scope: GameViewScope | null = null;
  let floor = 0;
  let acceptedVersion = -1;
  let pending: { view: PrivateView; until: number } | null = null;
  let deadline: number | null = null;
  let lastResync = -Infinity;
  let ended = false;
  const clear = () => {
    current = null;
    deps.changed(null);
  };
  const resync = () => {
    if (round && deps.now() - lastResync >= 1000) {
      lastResync = deps.now();
      deps.resync(round.matchId, Math.max(0, acceptedVersion, floor));
    }
  };
  const accept = (view: PrivateView): boolean => {
    if (!round || view.matchId !== round.matchId) return false;
    if (scope && view.gameScope.revision < scope.revision) return false;
    if (
      scope &&
      view.gameScope.revision === scope.revision &&
      (view.gameScope.gameInstanceId !== scope.gameInstanceId || view.gameScope.kind !== scope.kind)
    ) {
      resync();
      return false;
    }
    if (view.stateVersion < floor || view.stateVersion <= acceptedVersion) return false;
    if (
      view.gameScope.kind === 'none' &&
      (view.self !== null ||
        view.knownTerrain.length ||
        view.knownActiveExits.length ||
        view.visibleCells.length ||
        view.visibleWallFaces.length ||
        view.visibleEntities.length)
    ) {
      resync();
      return false;
    }
    if (view.stateVersion > round.stateVersion || view.gameScope.kind !== phaseScope(round.phase)) {
      if (!pending || view.stateVersion > pending.view.stateVersion)
        pending = { view, until: pending?.until ?? deps.now() + 1000 };
      return false;
    }
    if (ended && view.self?.status === 'ACTIVE') return false;
    if (view.self && view.self.status !== 'ACTIVE') ended = true;
    scope = view.gameScope;
    acceptedVersion = view.stateVersion;
    deadline = null;
    pending = null;
    current =
      ended && !view.spectating
        ? {
            ...view,
            knownTerrain: [],
            knownActiveExits: [],
            visibleCells: [],
            visibleWallFaces: [],
            visibleEntities: [],
          }
        : view;
    deps.changed(current);
    return true;
  };
  return {
    round(next: PublicRoundState) {
      if (round && next.matchId === round.matchId && next.stateVersion < round.stateVersion) return;
      if (!round || next.matchId !== round.matchId) {
        scope = null;
        acceptedVersion = -1;
        pending = null;
        ended = false;
      }
      if (!round || next.matchId !== round.matchId || next.phase !== round.phase) {
        floor = next.stateVersion;
        clear();
        deadline = deps.now() + 1000;
      }
      round = next;
      if (pending) accept(pending.view);
    },
    receive(value: unknown) {
      const parsed = privateViewSchema.safeParse(value);
      if (!parsed.success) {
        resync();
        return false;
      }
      return accept(parsed.data);
    },
    poll() {
      if (pending && deps.now() >= pending.until) {
        pending = null;
        resync();
      }
      if (deadline !== null && deps.now() >= deadline) {
        deadline = deps.now() + 1000;
        resync();
      }
    },
    clear() {
      clear();
      pending = null;
      deadline = null;
      round = null;
      scope = null;
      acceptedVersion = -1;
      ended = false;
    },
    get view() {
      return current;
    },
  };
}
