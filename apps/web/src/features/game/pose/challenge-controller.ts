import type { PrivateView } from '@kkakkung/protocol/game-schema';
import type { SensorSnapshot } from '../../input/InteractionRuntime';
import type { CommandInput, RequestDisplay } from '../../room/command-lifecycle';
import { createPoseHold } from './pose-evaluator';

export function exitCandidate(view: PrivateView | null) {
  const self = view?.self;
  if (!view || self?.status !== 'ACTIVE' || self.role !== 'runner') return null;
  return (
    view.knownActiveExits.find(
      (exit) =>
        exit.ownerId === self.playerId &&
        exit.approach.x === self.cell.x &&
        exit.approach.y === self.cell.y &&
        view.visibleWallFaces.some(
          (wall) =>
            wall.x === exit.wall.x && wall.y === exit.wall.y && wall.side === exit.wall.side,
        ),
    ) ?? null
  );
}

export function createChallengeController(send: (command: CommandInput) => string) {
  const hold = createPoseHold();
  let challengeId: string | null = null;
  let requestId: string | null = null;
  let retryAt = 0;
  let attempts = 0;
  let blocked = false;
  let progress = 0;
  return {
    update(
      view: PrivateView | null,
      tick: number,
      now: number,
      sensors: SensorSnapshot | null,
      generation: number,
      request?: RequestDisplay,
      enabled = true,
    ) {
      const self = view?.self;
      const challenge = self?.status === 'ACTIVE' && self.role === 'runner' ? self.challenge : null;
      if (challenge?.challengeId !== challengeId) {
        challengeId = challenge?.challengeId ?? null;
        requestId = null;
        attempts = 0;
        retryAt = 0;
        blocked = false;
        hold.reset();
      }
      if (!challenge || !enabled || tick >= challenge.expiresAtTick) {
        hold.reset();
        progress = 0;
        return progress;
      }
      if (
        requestId &&
        request?.requestId === requestId &&
        ['rejected', 'canceled', 'unconfirmed', 'applied'].includes(request.status)
      ) {
        if (request.status === 'rejected' && request.code === 'NOT_READY' && attempts < 2) {
          requestId = null;
          retryAt = now + 500;
        } else blocked = true;
      }
      const result = hold.observe(sensors, generation, challenge.poseKind, now);
      progress = Math.min(1, result.heldMs / 1200);
      if (
        !blocked &&
        !requestId &&
        attempts < 2 &&
        result.freshFrame &&
        result.heldMs >= 1200 &&
        tick >= challenge.minSuccessTick &&
        now >= retryAt
      ) {
        attempts++;
        requestId =
          send({
            type: 'EXIT_PROGRESS',
            payload: { challengeId: challenge.challengeId, method: 'pose', completed: true },
          }) || null;
        if (!requestId) blocked = true;
      }
      return progress;
    },
    suspend() {
      blocked = true;
      hold.reset();
      progress = 0;
    },
    clear() {
      challengeId = null;
      requestId = null;
      hold.reset();
      progress = 0;
    },
  };
}
