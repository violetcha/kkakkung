import { privateViewSchema } from '@kkakkung/protocol/game-messages';
import { restorePrivateView } from '@kkakkung/protocol/game-schema';
import type {
  GameViewScope,
  Phase,
  PrivateView,
  PublicRoundState,
  ViewKnowledge,
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
  /**
   * S15P21C204-326. 누적 지식은 바뀐 판에만 실려 온다. 실려 온 쌍을 그 revision 과 함께 들고
   * 있다가 생략된 판에 도로 끼워 넣는다. **서버가 보낸 그대로여야 한다** — 화면에 보여 줄 때
   * 하는 절단(경기 끝난 도망자의 빈 지도)을 여기 섞으면 다음 판이 그 빈 것을 물려받는다.
   */
  let knowledge: ViewKnowledge | null = null;
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
        // 새 경기의 revision 은 1부터 다시 세므로 이전 경기의 지식을 들고 있으면 안 된다.
        knowledge = null;
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
      const restored = restorePrivateView(parsed.data, knowledge);
      if (!restored) {
        resync();
        return false;
      }
      // revision 은 한 경기 안에서 단조 증가한다. 그러니 더 낮은 것은 이미 지난 판이고, 아래
      // `accept` 가 어차피 버린다. 들고 있는 것을 그것으로 덮으면 **다음 생략 판이 복원되지
      // 않아** 공연히 resync 를 부른다.
      if (restored.knowledge.revision >= (knowledge?.revision ?? 0)) knowledge = restored.knowledge;
      return accept(restored.view);
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
      knowledge = null;
    },
    get view() {
      return current;
    },
  };
}
