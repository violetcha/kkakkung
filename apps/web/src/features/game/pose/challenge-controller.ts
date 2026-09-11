import type { PrivateView } from '@kkakkung/protocol/game-schema';
import type { SensorSnapshot } from '../../input/InteractionRuntime';
import type { CommandInput, RequestDisplay } from '../../room/command-lifecycle';
import { createPoseHold } from './pose-evaluator';
import { advanceKey, challengeKeys, type ChallengeKey } from './key-challenge';

export function facesExit(
  self: PrivateView['self'],
  exit: PrivateView['knownActiveExits'][number],
) {
  // A wall face points toward its approach cell; the player must face back toward the wall.
  return self?.status === 'ACTIVE' && self.dir === (exit.wall.side + 2) % 4;
}

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
  let keyIndex = 0;
  let inputEnabled = false;
  let lastMethod: 'pose' | 'keys' | null = null;
  const methods = new Set<'pose' | 'keys'>();
  const metrics = { pose: { attempts: 0, successes: 0 }, keys: { attempts: 0, successes: 0 } };
  return {
    update(
      view: PrivateView | null,
      tick: number,
      now: number,
      sensors: SensorSnapshot | null,
      generation: number,
      request?: RequestDisplay,
      enabled = true,
      method: 'pose' | 'keys' = 'pose',
    ) {
      const self = view?.self;
      if (self?.status === 'ESCAPED' && challengeId && lastMethod) metrics[lastMethod].successes++;
      const challenge = self?.status === 'ACTIVE' && self.role === 'runner' ? self.challenge : null;
      if (challenge?.challengeId !== challengeId) {
        challengeId = challenge?.challengeId ?? null;
        requestId = null;
        attempts = 0;
        retryAt = 0;
        blocked = false;
        keyIndex = 0;
        methods.clear();
        lastMethod = null;
        hold.reset();
      }
      inputEnabled = !!challenge && enabled && tick < challenge.expiresAtTick;
      if (!inputEnabled || !challenge) {
        keyIndex = 0;
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
      if (!methods.has(method)) {
        methods.add(method);
        metrics[method].attempts++;
      }
      if (method === 'keys') hold.reset();
      const result =
        method === 'pose'
          ? hold.observe(sensors, generation, challenge.poseKind, now)
          : { heldMs: keyIndex >= 4 ? 1200 : 0, freshFrame: true };
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
        lastMethod = method;
        requestId =
          send({
            type: 'EXIT_PROGRESS',
            payload: { challengeId: challenge.challengeId, method, completed: true },
          }) || null;
        if (!requestId) blocked = true;
      }
      return progress;
    },
    suspend() {
      keyIndex = 0;
      inputEnabled = false;
      blocked = true;
      hold.reset();
      progress = 0;
    },
    clear() {
      keyIndex = 0;
      inputEnabled = false;
      methods.clear();
      lastMethod = null;
      challengeId = null;
      requestId = null;
      hold.reset();
      progress = 0;
    },
    key(key: ChallengeKey, repeat = false) {
      if (challengeId && inputEnabled && !blocked && !requestId)
        keyIndex = advanceKey(challengeKeys(challengeId), keyIndex, key, repeat);
    },
    get keyIndex() {
      return keyIndex;
    },
    metrics() {
      return { pose: { ...metrics.pose }, keys: { ...metrics.keys } };
    },
  };
}
