import type { PrivateView } from '@kkakkung/protocol/game-schema';
import { restraintPresenter } from './restraint-presenter';

export function RestraintHud({ view, tick }: { view: PrivateView; tick: number }) {
  const state = restraintPresenter(view, tick);
  if (!state) return null;
  return (
    <aside className="restraint-hud" aria-label="구속 상태">
      {state.restraintSeconds !== null && (
        <p data-state="restrained">
          ⛓ {state.restraintSeconds > 0 ? `구속 ${state.restraintSeconds}초` : '서버 해제 확인 중'}
          {' · '}새로 이동할 수 없습니다. 회전은 가능합니다.
        </p>
      )}
      {state.immuneSeconds !== null && (
        <p data-state="immune">
          ◈ {state.immuneSeconds > 0 ? `구속 면역 ${state.immuneSeconds}초` : '면역 종료 확인 중'}
        </p>
      )}
    </aside>
  );
}
