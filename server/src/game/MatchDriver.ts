/**
 * Single authoritative tick path. Message callbacks, leave handlers and media promises only
 * enqueue; this driver freezes the tick input, steps every attached logical instance through
 * the core port, validates one outcome per processed command, commits the next state and
 * fans out outcomes, audience events, spatial sound frames and media intents.
 */
import { isPhaseCommand, type CommandOutcome } from '@kkakkung/protocol/game-messages';
import type { CommandQueue, LedgerEntry } from './CommandQueue.js';
import type { MatchContext } from './MatchContext.js';
import { toCoreCommand } from './CommandAdapter.js';
import type {
  AudienceEvent,
  ControlIntent,
  CoreCommand,
  CoreOutcome,
  CorePort,
  GameSubject,
  MediaControl,
  MediaIntent,
  OutcomeResult,
  SpatialSoundEvent,
  SpectatorLink,
  Topology,
  TrustedMediaFrame,
} from './ports.js';

export type AttachedInstance<State> = {
  gameInstanceId: string;
  kind: 'practice' | 'game';
  state: State;
  topology: Topology;
  mediaInstanceId: string | null;
  frameRevision: number;
  aborted: boolean;
  /** The round is decided: the last state stays for the result screen but never steps again. */
  settled: boolean;
};

export type PhaseCommandHandler = (entry: LedgerEntry, tick: number) => OutcomeResult;

export type MatchDriverDeps<State> = Readonly<{
  core: CorePort<State>;
  context: MatchContext;
  queue: CommandQueue;
  now: () => number;
  handlePhaseCommand: PhaseCommandHandler;
  /** Called after a step commits so the room can re-project views and bump versions. */
  onStateCommitted: (instance: AttachedInstance<State>, tick: number) => void;
  /** Applicable private view version for an actor at outcome time. */
  stateVersionFor: (actorId: string) => number;
  onOutcome: (actorId: string, outcome: CommandOutcome) => void;
  onEvent: (event: AudienceEvent, gameInstanceId: string) => void;
  onMediaFrame: (frame: TrustedMediaFrame) => void;
  onMediaIntent: (intent: MediaIntent, gameInstanceId: string) => void;
  onIntegrityFailure: (gameInstanceId: string, reason: string) => void;
  /** S15P21C204-269. Ended runners and the survivor each one listens through, per frame. */
  spectators?: (
    instance: AttachedInstance<State>,
    participants: readonly GameSubject[],
  ) => readonly SpectatorLink[];
}>;

export type TickReport = Readonly<{
  tick: number;
  processed: number;
  canceled: number;
  stepped: string[];
  integrityFailures: string[];
}>;

function outcomeMatches(outcome: CoreOutcome, command: CoreCommand) {
  return (
    outcome.actorId === command.actorId &&
    outcome.matchId === command.matchId &&
    outcome.requestId === command.requestId &&
    outcome.sequence === command.sequence
  );
}

export class MatchDriver<State> {
  private readonly instances = new Map<string, AttachedInstance<State>>();
  private readonly controls = new Map<string, ControlIntent[]>();
  private mediaControls: MediaControl[] = [];

  constructor(private readonly deps: MatchDriverDeps<State>) {}

  attach(input: {
    gameInstanceId: string;
    kind: 'practice' | 'game';
    state: State;
    topology: Topology;
    mediaInstanceId?: string | null;
  }) {
    if (this.instances.has(input.gameInstanceId)) throw new Error('INSTANCE_ALREADY_ATTACHED');
    this.instances.set(input.gameInstanceId, {
      gameInstanceId: input.gameInstanceId,
      kind: input.kind,
      state: input.state,
      topology: input.topology,
      mediaInstanceId: input.mediaInstanceId ?? null,
      frameRevision: 0,
      aborted: false,
      settled: false,
    });
  }

  instance(gameInstanceId: string) {
    return this.instances.get(gameInstanceId) ?? null;
  }

  attached(): AttachedInstance<State>[] {
    return [...this.instances.values()];
  }

  setMediaInstance(gameInstanceId: string, mediaInstanceId: string | null) {
    const instance = this.instances.get(gameInstanceId);
    if (instance) instance.mediaInstanceId = mediaInstanceId;
  }

  /**
   * Detaches a logical instance. Pending requests targeting it are canceled once; later
   * results for the id are ignored by `tick`. Returns the actors whose requests were canceled.
   */
  detach(gameInstanceId: string, code: 'CANCELED' | 'ROUND_ENDED' = 'CANCELED') {
    this.instances.delete(gameInstanceId);
    this.controls.delete(gameInstanceId);
    const canceled = this.deps.queue.cancelPending(
      code,
      this.deps.context.serverTick,
      this.deps.stateVersionFor,
      this.deps.now(),
      (entry) => entry.gameInstanceId === gameInstanceId,
    );
    for (const { actorId, outcome } of canceled) this.deps.onOutcome(actorId, outcome);
    return canceled;
  }

  /**
   * S15P21C204-335. Stops a decided instance where it is. It stays attached, so its last frame and
   * personal views still serve the result screen, but it is not stepped and emits no further media
   * frame: the one that carried RESULT was the last, and E retires the round's media once for it.
   */
  settle(gameInstanceId: string) {
    const instance = this.instances.get(gameInstanceId);
    if (!instance) return;
    instance.settled = true;
    this.controls.delete(gameInstanceId);
  }

  /** Controls are applied on the next tick only, never inside the enqueueing callback. */
  enqueueControl(gameInstanceId: string, control: ControlIntent) {
    const list = this.controls.get(gameInstanceId) ?? [];
    list.push(control);
    this.controls.set(gameInstanceId, list);
  }

  enqueueMediaControl(control: MediaControl) {
    this.mediaControls.push(control);
  }

  /** Media results wait here until the room applies them in its serial boundary. */
  drainMediaControls(): MediaControl[] {
    const drained = this.mediaControls;
    this.mediaControls = [];
    return drained;
  }

  /** Cancels every still-pending request (match end, abort) with one terminal outcome each. */
  cancelAllPending(code: 'ROUND_ENDED' | 'CANCELED') {
    const canceled = this.deps.queue.cancelPending(
      code,
      this.deps.context.serverTick,
      this.deps.stateVersionFor,
      this.deps.now(),
    );
    for (const { actorId, outcome } of canceled) this.deps.onOutcome(actorId, outcome);
    return canceled.length;
  }

  tick(): TickReport {
    const { queue, context, core } = this.deps;
    const now = this.deps.now();
    const tick = context.advanceTick();
    const stepped: string[] = [];
    const integrityFailures: string[] = [];
    let canceled = 0;

    // 1. Real-clock TTL: held moves expire into controls, stale queued moves cancel before core.
    for (const control of queue.expireHeldMoves(now)) {
      if (control.type !== 'EXPIRE_MOVE') continue;
      const instance = context.instanceOf(control.playerId);
      if (instance) this.enqueueControl(instance.gameInstanceId, control);
    }
    for (const entry of queue.expiredQueuedMoves(now)) {
      const done = queue.complete(
        entry.command.requestId,
        { result: 'canceled', code: 'EXPIRED', tick },
        this.deps.stateVersionFor(entry.actorId),
        now,
      );
      if (done) {
        canceled++;
        this.deps.onOutcome(done.actorId, done.outcome);
      }
    }

    // 2. Freeze this tick's input.
    const batch = queue.freeze();
    const perInstance = new Map<string, { entries: LedgerEntry[]; commands: CoreCommand[] }>();
    for (const entry of batch) {
      const command = entry.command;
      if (isPhaseCommand(command)) {
        const result = this.deps.handlePhaseCommand(entry, tick);
        const done = queue.complete(
          command.requestId,
          { ...result, tick },
          this.deps.stateVersionFor(entry.actorId),
          now,
        );
        if (done) this.deps.onOutcome(done.actorId, done.outcome);
        continue;
      }
      const current = context.instanceOf(entry.actorId);
      const target =
        entry.gameInstanceId && current && current.gameInstanceId === entry.gameInstanceId
          ? this.instances.get(entry.gameInstanceId)
          : undefined;
      if (!target || target.aborted || target.settled) {
        const done = queue.complete(
          command.requestId,
          { result: 'canceled', code: target?.settled ? 'ROUND_ENDED' : 'CANCELED', tick },
          this.deps.stateVersionFor(entry.actorId),
          now,
        );
        if (done) {
          canceled++;
          this.deps.onOutcome(done.actorId, done.outcome);
        }
        continue;
      }
      const group = perInstance.get(target.gameInstanceId) ?? { entries: [], commands: [] };
      group.entries.push(entry);
      group.commands.push(toCoreCommand(entry.actorId, command));
      perInstance.set(target.gameInstanceId, group);
    }

    // 3. Step every attached instance exactly once with its frozen commands and controls.
    for (const instance of this.instances.values()) {
      if (instance.aborted) continue;
      if (instance.settled) {
        this.controls.delete(instance.gameInstanceId);
        continue;
      }
      const group = perInstance.get(instance.gameInstanceId) ?? { entries: [], commands: [] };
      const controls = this.controls.get(instance.gameInstanceId) ?? [];
      this.controls.delete(instance.gameInstanceId);
      let result;
      try {
        result = core.stepMatch(instance.state, { tick, commands: group.commands, controls });
      } catch (error) {
        this.failInstance(instance, `STEP_THREW:${(error as Error).message}`, group, now, tick);
        integrityFailures.push(instance.gameInstanceId);
        continue;
      }
      const frame = core.getFrame(result.state);
      const violation = this.validateOutcomes(
        result.outcomes,
        group.commands,
        frame.gameInstanceId,
        instance.gameInstanceId,
      );
      if (violation) {
        this.failInstance(instance, violation, group, now, tick);
        integrityFailures.push(instance.gameInstanceId);
        continue;
      }
      instance.state = result.state;
      stepped.push(instance.gameInstanceId);
      this.deps.onStateCommitted(instance, tick);
      for (const outcome of result.outcomes) {
        const done = queue.complete(
          outcome.requestId,
          outcome.result === 'applied'
            ? { result: 'applied', code: null, tick: outcome.tick }
            : { result: outcome.result, code: outcome.code, tick: outcome.tick },
          this.deps.stateVersionFor(outcome.actorId),
          now,
        );
        if (done) this.deps.onOutcome(done.actorId, done.outcome);
      }
      const sounds: SpatialSoundEvent[] = [];
      for (const event of result.events) {
        if (event.type === 'SPATIAL_SOUND') sounds.push(event.sound);
        else this.deps.onEvent(event, instance.gameInstanceId);
      }
      for (const intent of result.mediaIntents)
        this.deps.onMediaIntent(intent, instance.gameInstanceId);
      if (instance.mediaInstanceId) {
        instance.frameRevision += 1;
        this.deps.onMediaFrame({
          matchId: frame.matchId,
          mediaInstanceId: instance.mediaInstanceId,
          instancePurpose: instance.kind,
          frameRevision: instance.frameRevision,
          tick,
          phase: frame.phase,
          topology: instance.topology,
          participants: frame.participants,
          events: sounds,
          spectators: this.deps.spectators?.(instance, frame.participants) ?? [],
        });
      }
    }
    return { tick, processed: batch.length, canceled, stepped, integrityFailures };
  }

  private validateOutcomes(
    outcomes: readonly CoreOutcome[],
    commands: readonly CoreCommand[],
    frameInstanceId: string,
    expectedInstanceId: string,
  ): string | null {
    if (frameInstanceId !== expectedInstanceId) return 'FRAME_INSTANCE_MISMATCH';
    if (outcomes.length !== commands.length) return 'OUTCOME_COUNT_MISMATCH';
    const seen = new Set<string>();
    for (const outcome of outcomes) {
      if (seen.has(outcome.requestId)) return 'DUPLICATE_OUTCOME';
      seen.add(outcome.requestId);
      const command = commands.find((c) => c.requestId === outcome.requestId);
      if (!command || !outcomeMatches(outcome, command)) return 'UNKNOWN_OUTCOME';
    }
    return null;
  }

  private failInstance(
    instance: AttachedInstance<State>,
    reason: string,
    group: { entries: LedgerEntry[] },
    now: number,
    tick: number,
  ) {
    instance.aborted = true;
    void group;
    void tick;
    const canceled = this.deps.queue.cancelPending(
      'ROUND_ENDED',
      this.deps.context.serverTick,
      this.deps.stateVersionFor,
      now,
      (entry) => entry.gameInstanceId === instance.gameInstanceId,
    );
    for (const { actorId, outcome } of canceled) this.deps.onOutcome(actorId, outcome);
    this.deps.onIntegrityFailure(instance.gameInstanceId, reason);
  }
}
