import {
  privateEventSchema,
  FUTURE_EVENT_QUEUE_LIMIT,
  FUTURE_EVENT_WAIT_MS,
  type PrivateEvent,
} from '@kkakkung/protocol/game-messages';
import type { PrivateView } from '@kkakkung/protocol/game-schema';

export function createPrivateEvents(deps: {
  now(): number;
  apply(event: PrivateEvent): void;
  resync(): void;
}) {
  let matchId = '';
  let view: PrivateView | null = null;
  let scope: PrivateView['gameScope'] | null = null;
  let ended = false;
  let lastResync = -Infinity;
  const pending = new Map<string, { event: PrivateEvent; until: number }>();
  const seen = new Set<string>();
  const key = (event: PrivateEvent) =>
    `${event.gameScope.revision}:${event.gameScope.kind}:${event.gameScope.gameInstanceId}:${event.eventId}`;
  function resync() {
    if (deps.now() - lastResync >= 1000) {
      lastResync = deps.now();
      deps.resync();
    }
  }
  function apply(event: PrivateEvent): 'wait' | 'done' {
    if (ended || event.matchId !== matchId) return 'done';
    if (scope && event.gameScope.revision < scope.revision) return 'done';
    if (
      scope &&
      event.gameScope.revision === scope.revision &&
      (event.gameScope.kind !== scope.kind ||
        event.gameScope.gameInstanceId !== scope.gameInstanceId)
    ) {
      resync();
      return 'done';
    }
    if (
      !view ||
      view.gameScope.kind === 'none' ||
      event.gameScope.revision > view.gameScope.revision ||
      event.stateVersion > view.stateVersion
    )
      return 'wait';
    const id = key(event);
    if (seen.has(id)) return 'done';
    seen.add(id);
    if (seen.size > 2048) seen.delete(seen.values().next().value!);
    deps.apply(event);
    return 'done';
  }
  function poll() {
    for (const [id, item] of pending) {
      if (deps.now() >= item.until) {
        pending.delete(id);
        resync();
      } else if (apply(item.event) === 'done') pending.delete(id);
    }
  }
  return {
    update(next: PrivateView | null, match: string) {
      if (match !== matchId) {
        pending.clear();
        seen.clear();
        scope = null;
        ended = false;
        matchId = match;
      }
      view = next;
      if (next) {
        if (scope?.revision !== next.gameScope.revision) seen.clear();
        scope = next.gameScope;
        if (next.self && next.self.status !== 'ACTIVE') {
          ended = true;
          pending.clear();
          seen.clear();
        }
      }
      poll();
    },
    receive(value: unknown) {
      const parsed = privateEventSchema.safeParse(value);
      if (!parsed.success) {
        resync();
        return;
      }
      const event = parsed.data;
      if (
        !event.eventId.startsWith(`${event.matchId}:${event.tick}:`) ||
        !/^\d+$/.test(event.eventId.slice(`${event.matchId}:${event.tick}:`.length))
      ) {
        resync();
        return;
      }
      const id = key(event);
      if (seen.has(id) || pending.has(id)) return;
      if (apply(event) === 'wait') {
        if (pending.size >= FUTURE_EVENT_QUEUE_LIMIT) {
          pending.clear();
          resync();
          return;
        }
        pending.set(id, { event, until: deps.now() + FUTURE_EVENT_WAIT_MS });
      }
    },
    poll,
    clear() {
      pending.clear();
      seen.clear();
      view = null;
      ended = true;
    },
    get pendingCount() {
      return pending.size;
    },
  };
}
