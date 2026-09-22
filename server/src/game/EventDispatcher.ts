/**
 * Recipient-scoped delivery of private views, private events, command outcomes and request
 * status. Views are full replacements sent on first delivery, allowed content change, scope
 * change, public phase change and explicit resync (rate limited, re-serialized at the current
 * authoritative version). Events are stamped with the recipient's scope as it was at delivery
 * and are never re-labelled to a newer instance.
 */
import {
  VIEW_RESYNC_LIMIT_PER_SECOND,
  viewResyncSchema,
  type CommandOutcome,
  type PrivateEvent,
  type RequestStatusResult,
} from '@kkakkung/protocol/game-messages';
import type {
  GameViewScope,
  Phase,
  PrivateView,
  PrivateViewWire,
} from '@kkakkung/protocol/game-schema';
import type { MatchContext } from './MatchContext.js';
import type { AudienceEvent } from './ports.js';

/** Everything in a PrivateView except matchId/gameScope/stateVersion, which B stamps here. */
export type PrivateViewBody = Omit<PrivateView, 'matchId' | 'gameScope' | 'stateVersion'>;

export const EMPTY_VIEW_BODY: PrivateViewBody = {
  mapVersion: 0,
  knownTerrain: [],
  knownActiveExits: [],
  self: null,
  visibleCells: [],
  visibleWallFaces: [],
  visibleEntities: [],
};

export type ViewSender = Readonly<{
  sendView: (playerId: string, view: PrivateViewWire) => void;
  sendEvent: (playerId: string, event: PrivateEvent) => void;
  sendOutcome: (playerId: string, outcome: CommandOutcome) => void;
  sendStatus: (playerId: string, status: RequestStatusResult) => void;
}>;

export type ViewReason = 'initial' | 'change' | 'scope' | 'phase' | 'resync';

type Delivered = {
  stateVersion: number;
  scope: GameViewScope;
  phase: Phase;
  body: PrivateViewBody;
  /** S15P21C204-326. Rises with each change to the two accumulated-knowledge arrays. */
  knowledgeRevision: number;
};

/**
 * Structural equality for the JSON-shaped values a view is made of. The projection rebuilds the
 * body on every tick, so identity comparison would report a change every time; serializing both
 * sides just to compare them walks the whole body and allocates a string per recipient per tick.
 * This walks once and stops at the first difference.
 */
function sameContent(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  const isArray = Array.isArray(a);
  if (isArray !== Array.isArray(b)) return false;
  if (isArray) {
    const left = a as readonly unknown[];
    const right = b as readonly unknown[];
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) if (!sameContent(left[i], right[i])) return false;
    return true;
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  for (const key of keys) {
    if (!Object.hasOwn(right, key) || !sameContent(left[key], right[key])) return false;
  }
  return true;
}

export class EventDispatcher {
  private readonly delivered = new Map<string, Delivered>();
  private readonly resyncAt = new Map<string, number>();

  constructor(
    private readonly deps: Readonly<{
      context: MatchContext;
      now: () => number;
      sender: ViewSender;
      /** Allowlisted body for the recipient's current logical scope; null when not attached. */
      viewBody: (playerId: string) => PrivateViewBody | null;
    }>,
  ) {}

  /** The last private view version delivered to an actor, or the public version before any. */
  applicableVersion(playerId: string): number {
    return this.delivered.get(playerId)?.stateVersion ?? this.deps.context.stateVersion;
  }

  /**
   * Publishes a full view when required. Content changes bump the shared stateVersion so the
   * new version is strictly newer; phase/scope/resync re-serialize at the current version.
   *
   * S15P21C204-326. The two accumulated-knowledge arrays are left off a view that would repeat
   * them, which on a measured round is 97.5% of the views that go out and 87% of their bytes.
   * Only a `change` view may omit them: every other reason is a moment the recipient may have
   * just dropped what it held — a new phase, a new scope, a resync it asked for — so those carry
   * the pair in full and nothing has to be reassembled across one.
   */
  publishView(playerId: string, reason: ViewReason, publicPhase: Phase): PrivateViewWire | null {
    const { context } = this.deps;
    const scope = context.scopeOf(playerId);
    const body =
      scope.kind === 'none' ? EMPTY_VIEW_BODY : (this.deps.viewBody(playerId) ?? EMPTY_VIEW_BODY);
    const previous = this.delivered.get(playerId);
    const contentChanged =
      !previous || !sameContent(previous.scope, scope) || !sameContent(previous.body, body);
    const forced = reason !== 'change' || !previous;
    if (!contentChanged && !forced) return null;
    if (contentChanged && reason === 'change') context.bumpVersion();
    let stateVersion = context.stateVersion;
    if (
      previous &&
      stateVersion <= previous.stateVersion &&
      reason !== 'resync' &&
      reason !== 'phase'
    )
      stateVersion = context.bumpVersion();
    // Only a change to the knowledge itself moves the revision, so a recipient that reuses what
    // it holds is reusing the very arrays this revision was minted for.
    const knowledgeChanged =
      !previous ||
      !sameContent(previous.body.knownTerrain, body.knownTerrain) ||
      !sameContent(previous.body.knownActiveExits, body.knownActiveExits);
    const knowledgeRevision = knowledgeChanged
      ? (previous?.knowledgeRevision ?? 0) + 1
      : previous.knowledgeRevision;
    const { knownTerrain, knownActiveExits, ...rest } = body;
    const view: PrivateViewWire = {
      ...rest,
      matchId: context.matchId,
      gameScope: scope,
      stateVersion,
      knowledgeRevision,
      ...(knowledgeChanged || forced ? { knownTerrain, knownActiveExits } : {}),
    };
    this.delivered.set(playerId, {
      stateVersion,
      scope,
      phase: publicPhase,
      body,
      knowledgeRevision,
    });
    this.deps.sender.sendView(playerId, view);
    return view;
  }

  /** Delivers an audience event only to recipients currently scoped to the producing instance. */
  dispatchEvent(event: AudienceEvent, gameInstanceId: string): number {
    const { context } = this.deps;
    let delivered = 0;
    for (const playerId of event.audience) {
      const scope = context.scopeOf(playerId);
      if (scope.kind === 'none' || scope.gameInstanceId !== gameInstanceId) continue;
      const message = {
        matchId: context.matchId,
        gameScope: scope,
        eventId: event.eventId,
        tick: event.tick,
        stateVersion: this.applicableVersion(playerId),
        type: event.type,
        payload: event.payload,
      } as PrivateEvent;
      this.deps.sender.sendEvent(playerId, message);
      delivered++;
    }
    return delivered;
  }

  sendOutcome(playerId: string, outcome: CommandOutcome) {
    this.deps.sender.sendOutcome(playerId, outcome);
  }

  sendStatus(playerId: string, status: RequestStatusResult) {
    this.deps.sender.sendStatus(playerId, status);
  }

  /** Resync: strict input, current match only, one per second per recipient, full re-serialize. */
  handleResync(
    playerId: string,
    payload: unknown,
    publicPhase: Phase,
  ): 'sent' | 'rejected' | 'limited' {
    const parsed = viewResyncSchema.safeParse(payload);
    if (!parsed.success || parsed.data.matchId !== this.deps.context.matchId) return 'rejected';
    const now = this.deps.now();
    const last = this.resyncAt.get(playerId);
    if (last !== undefined && now - last < 1000 / VIEW_RESYNC_LIMIT_PER_SECOND) return 'limited';
    this.resyncAt.set(playerId, now);
    this.publishView(playerId, 'resync', publicPhase);
    return 'sent';
  }

  forget(playerId: string) {
    this.delivered.delete(playerId);
    this.resyncAt.delete(playerId);
  }

  resetForMatch() {
    this.delivered.clear();
    this.resyncAt.clear();
  }
}
