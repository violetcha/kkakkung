// F-13 / QA-08 fixture. Puts A's real engine behind B's real projection and dispatcher for six
// recipients and records what each one would receive on the wire: full private views (initial,
// change, resync), private events with their audience, and the public round state. The layout is
// the G3 fixture, whose exits, seed and topology act as sentinels that must never reach the wrong
// recipient. No socket, no Cloud; time is the fake clock of the G3 harness.
import { matchCore } from '@kkakkung/game-core/match';
import {
  privateEventSchema,
  privateViewSchema,
  type PrivateEvent,
} from '@kkakkung/protocol/game-messages';
import type { PrivateView } from '@kkakkung/protocol/game-schema';
import { readPublicRoundState } from '@kkakkung/protocol/game-schema';
import { EventDispatcher, type ViewReason } from '../../server/src/game/EventDispatcher.ts';
import { projectPrivateBody, projectSpectateBody } from '../../server/src/game/PlayerProjection.ts';
import { chooseSpectateTarget, spectateCandidates } from '../../server/src/game/Spectate.ts';
import {
  DEFAULT_PLACEMENTS,
  SEED,
  createG3Harness,
  g3Layout,
  type G3Harness,
  type HarnessOptions,
  type Placement,
} from './g3-scenarios.ts';

/** Identifiable server-only facts of the fixture match. None may appear in a tagger's view. */
export const SENTINELS = Object.freeze({
  seed: SEED,
  layoutId: 'g3-layout-1',
  topologyVersion: 'g3-topology-1',
  /** Runner exits: wall cell and approach cell per owner (from g3Layout). */
  exits: g3Layout(DEFAULT_PLACEMENTS).exits.map((e) => ({
    exitId: e.exitId,
    ownerId: e.ownerId,
    wall: { x: e.wall.x, y: e.wall.y },
    approach: { x: e.approach.x, y: e.approach.y },
    poseKind: e.poseKind,
  })),
});

export type Recorded = Readonly<{
  views: Map<string, PrivateView[]>;
  events: Map<string, PrivateEvent[]>;
}>;

/**
 * Harness plus B's dispatcher wired to a recording sender. `publish(reason)` pushes every
 * recipient's view exactly the way KkakkungRoom does after a tick; `deliverEvents()` fans the
 * harness's audience events out through the dispatcher's scope filter.
 */
export function createViewHarness(options: HarnessOptions = {}) {
  const h = createG3Harness(options);
  const recorded: Recorded = { views: new Map(), events: new Map() };
  const push = <T>(map: Map<string, T[]>, id: string, value: T) => {
    const list = map.get(id) ?? [];
    list.push(value);
    map.set(id, list);
  };
  // S15P21C204-269. The room's spectate choice, mirrored: an ended runner's view body is its
  // target's projection while the match is PLAYING.
  const spectateChoices = new Map<string, string>();
  const viewBody = (id: string) => {
    const state = h.state();
    if (h.frame().phase === 'PLAYING') {
      const participants = matchCore.getFrame(state).participants;
      const targetId = chooseSpectateTarget(participants, id, spectateChoices.get(id));
      if (targetId)
        return projectSpectateBody(
          matchCore,
          state,
          id,
          targetId,
          spectateCandidates(participants, id),
        );
    }
    return projectPrivateBody(matchCore, state, id, null);
  };
  const dispatcher = new EventDispatcher({
    context: h.context,
    now: h.clock.now,
    sender: {
      sendView: (id, view) => push(recorded.views, id, view),
      sendEvent: (id, event) => push(recorded.events, id, event),
      sendOutcome: () => undefined,
      sendStatus: () => undefined,
    },
    viewBody,
  });
  let delivered = 0;
  const ids = (options.placements ?? DEFAULT_PLACEMENTS).map((p) => p.playerId);
  const api = {
    h,
    dispatcher,
    recorded,
    ids,
    /** Publishes for every recipient with the given reason (KkakkungRoom: initial → change …). */
    publish(reason: ViewReason) {
      const out = new Map<string, PrivateView | null>();
      for (const id of ids) out.set(id, dispatcher.publishView(id, reason, 'PLAYING'));
      return out;
    },
    /** Fans out every audience event the harness has produced since the last call. */
    deliverEvents() {
      const pending = h.events.slice(delivered);
      delivered = h.events.length;
      let count = 0;
      for (const event of pending)
        count += dispatcher.dispatchEvent(event, h.instance.gameInstanceId);
      return count;
    },
    /** One authoritative tick followed by the room's change publish and event fan-out. */
    tickAndPublish(n = 1) {
      for (let i = 0; i < n; i++) {
        h.tick();
        api.deliverEvents();
        api.publish('change');
      }
    },
    /** The room's SPECTATE choice for an ended runner; the next publish reflects it. */
    spectate(id: string, targetId: string) {
      spectateChoices.set(id, targetId);
    },
    latestView(id: string): PrivateView {
      const list = recorded.views.get(id);
      if (!list || list.length === 0) throw new Error(`no view delivered to ${id}`);
      return list[list.length - 1]!;
    },
    viewsOf: (id: string) => recorded.views.get(id) ?? [],
    eventsOf: (id: string) => recorded.events.get(id) ?? [],
    /** Public round state exactly as the Colyseus schema reader exposes it. */
    publicState() {
      const frame = h.frame();
      return readPublicRoundState({
        phase: frame.phase,
        matchId: h.context.matchId,
        stateVersion: h.context.stateVersion,
        serverTick: h.context.serverTick,
        startTick: h.state().startTick,
        deadlineTick: h.state().deadlineTick,
        counts: frame.counts,
        result: frame.result,
        abortReason: frame.abortReason,
      });
    },
  };
  return api;
}

export type ViewHarness = ReturnType<typeof createViewHarness>;

/** Every {x, y} pair anywhere in a value (cells, wall faces, action endpoints, trace points). */
export function coordinatesIn(value: unknown, out: { x: number; y: number }[] = []) {
  if (Array.isArray(value)) {
    for (const v of value) coordinatesIn(v, out);
    return out;
  }
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (typeof o.x === 'number' && typeof o.y === 'number') out.push({ x: o.x, y: o.y });
    for (const [k, v] of Object.entries(o)) if (k !== 'x' && k !== 'y') coordinatesIn(v, out);
  }
  return out;
}

const key = (c: { x: number; y: number }) => `${c.x},${c.y}`;

/**
 * Cells a view is allowed to name: the recipient's own cell and action endpoints, everything in
 * current sight (cells and wall faces) and the terrain it has seen before (knownTerrain).
 */
export function allowedCells(view: PrivateView): Set<string> {
  const allowed = new Set<string>();
  for (const c of view.visibleCells) allowed.add(key(c));
  for (const w of view.visibleWallFaces) allowed.add(key(w));
  for (const t of view.knownTerrain) allowed.add(key(t));
  if (view.self && view.self.status === 'ACTIVE') {
    allowed.add(key(view.self.cell));
    if (view.self.action) {
      allowed.add(key(view.self.action.from));
      allowed.add(key(view.self.action.to));
    }
    for (const owned of view.self.ownedEquipment) {
      allowed.add(key(owned.cell));
      if (owned.kind === 'sensor') allowed.add(key(owned.wall));
    }
  }
  return allowed;
}

/** Coordinates of a view that are neither in sight nor previously seen nor the recipient's own. */
export function coordinatesOutsideSight(view: PrivateView) {
  const allowed = allowedCells(view);
  // Entities may be reported on their action's destination cell as well (A's visibility rule).
  return coordinatesIn(view).filter((c) => !allowed.has(key(c)));
}

export function parseView(view: PrivateView) {
  const parsed = privateViewSchema.safeParse(view);
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
  return parsed.data;
}

export function parseEvent(event: PrivateEvent) {
  const parsed = privateEventSchema.safeParse(event);
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
  return parsed.data;
}

/** Runners adjacent and facing each other for a map exchange; taggers far away, facing walls. */
export const EXCHANGE_PLACEMENTS: readonly Placement[] = Object.freeze([
  { playerId: 'r1', role: 'runner', cell: { x: 4, y: 5 }, dir: 1 },
  { playerId: 'r2', role: 'runner', cell: { x: 5, y: 5 }, dir: 3 },
  { playerId: 'r3', role: 'runner', cell: { x: 8, y: 8 }, dir: 0 },
  { playerId: 't1', role: 'tagger', cell: { x: 1, y: 10 }, dir: 2 },
  { playerId: 't2', role: 'tagger', cell: { x: 10, y: 10 }, dir: 2 },
  { playerId: 't3', role: 'tagger', cell: { x: 10, y: 1 }, dir: 0 },
]);

export type { G3Harness };
