import type { AudioPolicy, Cell, GameSubject, Topology, TrustedMediaFrame } from './types.js';

export type AcousticValues = Readonly<{ gain: number; azimuthRad: number; lowpassHz: number }>;
export type AudibilityFrame = Readonly<{
  matchId: string;
  mediaInstanceId: string;
  stateVersion: number;
  receivers: readonly Readonly<{
    playerId: string;
    voices: readonly (AcousticValues & { playerId: string })[];
    effects: AudioPolicy['effects'];
  }>[];
}>;
export type AudibilityTuning = Readonly<{
  distanceGain: (distance: number) => number;
  cornerGain: number;
  clearLowpassHz: number;
  cornerLowpassFactor: number;
}>;

// Initial tuning, not measured Cloud/acoustic performance or a product constant.
export const INITIAL_AUDIBILITY_TUNING: AudibilityTuning = {
  distanceGain: (distance) => 1 / (1 + distance),
  cornerGain: 0.7,
  clearLowpassHz: 20_000,
  cornerLowpassFactor: 0.65,
};
const directions = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;
const cellKey = (cell: Cell) => `${cell.x},${cell.y}`;
const scopeKey = (matchId: string, instance: string) => JSON.stringify([matchId, instance]);
const clamp = (value: number, min: number, max: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;

/** At equal shortest distance choose the path with the fewest corners, deterministically. */
export function shortestAcousticPaths(topology: Topology, from: Cell) {
  const paths = new Map<string, { distance: number; corners: number }>();
  const walkable = (x: number, y: number) =>
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    y >= 0 &&
    x < topology.width &&
    y < topology.height &&
    topology.walkable[y * topology.width + x] === true;
  if (!walkable(from.x, from.y)) return paths;
  const queue = [{ ...from, direction: -1, distance: 0, corners: 0 }];
  const best = new Map<string, { distance: number; corners: number }>();
  paths.set(cellKey(from), { distance: 0, corners: 0 });
  for (let index = 0; index < queue.length; index++) {
    const point = queue[index]!;
    if (point.distance >= 6) continue;
    for (const [direction, [dx, dy]] of directions.entries()) {
      const x = point.x + dx;
      const y = point.y + dy;
      if (!walkable(x, y)) continue;
      const next = {
        x,
        y,
        direction,
        distance: point.distance + 1,
        corners: point.corners + (point.direction !== -1 && point.direction !== direction ? 1 : 0),
      };
      const headingKey = `${x},${y},${direction}`;
      const oldHeading = best.get(headingKey);
      if (
        oldHeading &&
        (oldHeading.distance < next.distance ||
          (oldHeading.distance === next.distance && oldHeading.corners <= next.corners))
      )
        continue;
      best.set(headingKey, next);
      queue.push(next);
      const oldCell = paths.get(cellKey(next));
      if (
        !oldCell ||
        oldCell.distance > next.distance ||
        (oldCell.distance === next.distance && oldCell.corners > next.corners)
      ) {
        paths.set(cellKey(next), { distance: next.distance, corners: next.corners });
      }
    }
  }
  return paths;
}

export class AudibilityPolicy {
  private readonly scopes = new Map<string, { revision: number; pairs: Set<string> }>();
  constructor(private readonly tuning: AudibilityTuning = INITIAL_AUDIBILITY_TUNING) {}

  observe(frame: TrustedMediaFrame): AudibilityFrame | null {
    const key = scopeKey(frame.matchId, frame.mediaInstanceId);
    const previous = this.scopes.get(key);
    if (previous && frame.frameRevision <= previous.revision) return null;
    const pairs = new Set<string>();
    const open = ['TEAM_PRACTICE', 'GAME_LOADING', 'COUNTDOWN', 'PLAYING'].includes(frame.phase);
    const active = open ? frame.participants.filter((p) => p.status === 'ACTIVE') : [];
    const receivers = frame.participants.map((receiver) => {
      const voices: (AcousticValues & { playerId: string })[] = [];
      const effects: AudioPolicy['effects'][number][] = [];
      if (open && receiver.status === 'ACTIVE') {
        const paths = shortestAcousticPaths(frame.topology, receiver.cell);
        for (const sender of active) {
          if (
            sender.playerId === receiver.playerId ||
            (frame.instancePurpose === 'practice' && sender.role !== receiver.role)
          )
            continue;
          const path = paths.get(cellKey(sender.cell));
          const pair = JSON.stringify([receiver.playerId, sender.playerId]);
          if (!path || (path.distance > 5 && !previous?.pairs.has(pair))) continue;
          pairs.add(pair);
          voices.push({
            playerId: sender.playerId,
            ...this.acoustics(receiver, sender.cell, path),
          });
        }
        for (const event of frame.events) {
          if (!['footstep', 'sensor', 'trap'].includes(event.kind) || event.tick !== frame.tick)
            continue;
          const sender = event.sourcePlayerId
            ? active.find((p) => p.playerId === event.sourcePlayerId)
            : null;
          if (event.sourcePlayerId && !sender) continue;
          if (frame.instancePurpose === 'practice' && sender && sender.role !== receiver.role)
            continue;
          // Footsteps require B's completed movement event, never a turn or ongoing move.
          if (
            event.kind === 'footstep' &&
            (!sender ||
              sender.action?.kind === 'turn' ||
              (sender.action && sender.action.endTick > frame.tick))
          )
            continue;
          const path = paths.get(cellKey(event.cell));
          if (!path || path.distance > (event.kind === 'footstep' ? 4 : 6)) continue;
          effects.push({
            eventId: event.eventId,
            kind: event.kind,
            tick: event.tick,
            ...this.acoustics(receiver, event.cell, path),
          });
        }
      }
      return { playerId: receiver.playerId, voices, effects };
    });
    this.scopes.set(key, { revision: frame.frameRevision, pairs });
    return {
      matchId: frame.matchId,
      mediaInstanceId: frame.mediaInstanceId,
      stateVersion: frame.frameRevision,
      receivers,
    };
  }

  forget(matchId: string, mediaInstanceId: string): void {
    this.scopes.delete(scopeKey(matchId, mediaInstanceId));
  }

  private acoustics(
    receiver: GameSubject,
    source: Cell,
    path: { distance: number; corners: number },
  ): AcousticValues {
    const absolute = Math.atan2(source.x - receiver.cell.x, -(source.y - receiver.cell.y));
    const relative = absolute - (receiver.dir * Math.PI) / 2;
    return {
      gain: clamp(
        this.tuning.distanceGain(path.distance) * this.tuning.cornerGain ** path.corners,
        0,
        1,
      ),
      azimuthRad: Math.atan2(Math.sin(relative), Math.cos(relative)),
      lowpassHz: clamp(
        this.tuning.clearLowpassHz * this.tuning.cornerLowpassFactor ** path.corners,
        20,
        20_000,
      ),
    };
  }
}
