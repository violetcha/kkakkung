import type { PrivateView, PublicRoundState } from '@kkakkung/protocol/game-schema';
import type { DeviceStatus } from '../../input/InteractionRuntime';
import { deviceReady } from './device-readiness';
export function practicePresenter(
  round: PublicRoundState | null,
  view: PrivateView | null,
  devices: DeviceStatus,
) {
  if (
    round?.phase !== 'TEAM_PRACTICE' ||
    view?.matchId !== round.matchId ||
    view.gameScope.kind !== 'practice' ||
    view.self?.status !== 'ACTIVE'
  )
    return null;
  return {
    role: view.self.role,
    canReady: deviceReady(devices),
    scope: `${view.matchId}:${view.gameScope.revision}:${view.gameScope.gameInstanceId}`,
  };
}
