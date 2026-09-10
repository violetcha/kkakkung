// F-14 / QA-10. One synthetic game client as a pure state machine. The runner owns the socket,
// the clock and the timer: it feeds public state, roster, views, receipts and outcomes in, and
// calls `advance(nowMs)` on its own schedule. Importing this file connects to nothing.
import type {
  CommandEnvelope,
  CommandOutcome,
  CommandReceipt,
} from '@kkakkung/protocol/game-messages';
import type { ClientStageStats } from './GameLoadScenario.ts';

export type Transport = Readonly<{
  send: (envelope: CommandEnvelope) => void;
}>;

export type PublicSnapshot = Readonly<{
  phase: string;
  matchId: string | null;
  abortReason?: string | null;
}>;

export type LoadingInfo = Readonly<{
  loadId: string;
  mediaInstanceId: string;
  receiverGeneration: number;
}>;

export type ViewSnapshot = Readonly<{
  self:
    | Readonly<{
        status: 'ACTIVE';
        loading: LoadingInfo | null;
      }>
    | Readonly<{ status: 'ESCAPED' | 'CAPTURED' }>
    | null;
}>;

export type ClientOptions = Readonly<{
  playerId: string;
  roomIndex: number;
  transport: Transport;
  createRequestId: () => string;
  /** Held-move refresh period; the queue expires holds 500 ms after the last refresh. */
  moveIntervalMs?: number;
  turnIntervalMs?: number;
  /** How often the held direction flips so the character actually travels. */
  directionFlipMs?: number;
  practiceReadyDelayMs?: number;
  rematchDelayMs?: number;
}>;

type Pending = { type: CommandEnvelope['type']; sentAtMs: number };

export class GameLoadClient {
  private phase = 'LOBBY';
  private matchId: string | null = null;
  private hostId: string | null = null;
  private loading: LoadingInfo | null = null;
  private sequence = 0;
  private readonly pending = new Map<string, Pending>();
  private readonly ackLatenciesMs: number[] = [];
  private readonly matchStartsMs: number[] = [];
  private readonly phasesSeen = new Set<string>();
  private readonly readySent = new Set<string>();
  private readonly practiceReadySent = new Set<string>();
  private readonly loadReadySent = new Set<string>();
  private readonly rematchSent = new Set<string>();
  private practiceEnteredAt: number | null = null;
  private resultEnteredAt: number | null = null;
  private lastMoveAt = -Infinity;
  private lastTurnAt = -Infinity;
  private lastFlipAt = 0;
  private forward = true;
  private commandsSent = 0;
  private receiptsRejected = 0;
  private outcomesApplied = 0;
  private outcomesRejected = 0;
  private outcomesCanceled = 0;
  private abortsSeen = 0;
  private readonly abortReasons: string[] = [];
  private readonly moveIntervalMs: number;
  private readonly turnIntervalMs: number;
  private readonly directionFlipMs: number;
  private readonly practiceReadyDelayMs: number;
  private readonly rematchDelayMs: number;

  constructor(private readonly options: ClientOptions) {
    this.moveIntervalMs = options.moveIntervalMs ?? 100;
    this.turnIntervalMs = options.turnIntervalMs ?? 2000;
    this.directionFlipMs = options.directionFlipMs ?? 3000;
    this.practiceReadyDelayMs = options.practiceReadyDelayMs ?? 1000;
    this.rematchDelayMs = options.rematchDelayMs ?? 500;
  }

  get playerId() {
    return this.options.playerId;
  }

  get isHost() {
    return this.hostId !== null && this.hostId === this.options.playerId;
  }

  /** Public room state as seen on the socket (phase, matchId). */
  observe(snapshot: PublicSnapshot, nowMs: number): void {
    if (snapshot.matchId && snapshot.matchId !== this.matchId) {
      this.matchId = snapshot.matchId;
      this.matchStartsMs.push(nowMs);
    }
    if (snapshot.phase !== this.phase) {
      if (snapshot.phase === 'ABORTED') {
        this.abortsSeen += 1;
        this.abortReasons.push(snapshot.abortReason ?? 'UNKNOWN');
      }
      if (snapshot.phase === 'TEAM_PRACTICE') this.practiceEnteredAt = nowMs;
      // RESULT and ABORTED are both terminal; the host restarts from either (RematchCoordinator).
      if (snapshot.phase === 'RESULT' || snapshot.phase === 'ABORTED') this.resultEnteredAt = nowMs;
      this.phase = snapshot.phase;
      this.phasesSeen.add(snapshot.phase);
    }
  }

  onRoster(roster: Readonly<{ hostId: string }>): void {
    this.hostId = roster.hostId;
  }

  onView(view: ViewSnapshot): void {
    this.loading = view.self && view.self.status === 'ACTIVE' ? view.self.loading : null;
  }

  onReceipt(receipt: CommandReceipt, nowMs: number): void {
    const pending = this.pending.get(receipt.requestId);
    if (!pending) return;
    this.pending.delete(receipt.requestId);
    this.ackLatenciesMs.push(nowMs - pending.sentAtMs);
    if (receipt.status === 'rejected') this.receiptsRejected += 1;
  }

  onOutcome(outcome: CommandOutcome): void {
    if (outcome.result === 'applied') this.outcomesApplied += 1;
    else if (outcome.result === 'rejected') this.outcomesRejected += 1;
    else this.outcomesCanceled += 1;
  }

  /** Emits whatever this phase calls for at `nowMs`. Never sends without a matchId. */
  advance(nowMs: number): void {
    if (!this.matchId) return;
    switch (this.phase) {
      case 'DEVICE_CHECK':
        if (!this.readySent.has(this.matchId)) {
          this.readySent.add(this.matchId);
          this.send('READY', { ready: true }, nowMs);
        }
        return;
      case 'TEAM_PRACTICE':
        this.drive(nowMs);
        if (
          !this.practiceReadySent.has(this.matchId) &&
          this.practiceEnteredAt !== null &&
          nowMs - this.practiceEnteredAt >= this.practiceReadyDelayMs
        ) {
          this.practiceReadySent.add(this.matchId);
          this.send('PRACTICE_READY', { ready: true }, nowMs);
        }
        return;
      case 'GAME_LOADING':
        if (this.loading && !this.loadReadySent.has(this.loading.loadId)) {
          this.loadReadySent.add(this.loading.loadId);
          this.send(
            'LOAD_READY',
            {
              loadId: this.loading.loadId,
              mediaInstanceId: this.loading.mediaInstanceId,
              receiverGeneration: this.loading.receiverGeneration,
            },
            nowMs,
          );
        }
        return;
      case 'PLAYING':
        this.drive(nowMs);
        return;
      case 'RESULT':
      case 'ABORTED':
        if (
          this.isHost &&
          !this.rematchSent.has(this.matchId) &&
          this.resultEnteredAt !== null &&
          nowMs - this.resultEnteredAt >= this.rematchDelayMs
        ) {
          this.rematchSent.add(this.matchId);
          this.send('REMATCH', { mode: 'swap' }, nowMs);
        }
        return;
      default:
        return;
    }
  }

  private drive(nowMs: number): void {
    if (nowMs - this.lastFlipAt >= this.directionFlipMs) {
      this.forward = !this.forward;
      this.lastFlipAt = nowMs;
    }
    if (nowMs - this.lastMoveAt >= this.moveIntervalMs) {
      this.lastMoveAt = nowMs;
      this.send('MOVE_INTENT', { direction: this.forward ? 'forward' : 'back' }, nowMs);
    }
    if (nowMs - this.lastTurnAt >= this.turnIntervalMs) {
      this.lastTurnAt = nowMs;
      this.send('TURN', { direction: 'right' }, nowMs);
    }
  }

  private send<T extends CommandEnvelope['type']>(
    type: T,
    payload: Extract<CommandEnvelope, { type: T }>['payload'],
    nowMs: number,
  ): void {
    const requestId = this.options.createRequestId();
    this.sequence += 1;
    const envelope = {
      matchId: this.matchId!,
      requestId,
      sequence: this.sequence,
      type,
      payload,
    } as CommandEnvelope;
    this.pending.set(requestId, { type, sentAtMs: nowMs });
    this.commandsSent += 1;
    this.options.transport.send(envelope);
  }

  stats(): ClientStageStats {
    return {
      playerId: this.options.playerId,
      roomIndex: this.options.roomIndex,
      commandsSent: this.commandsSent,
      ackLatenciesMs: [...this.ackLatenciesMs],
      receiptsRejected: this.receiptsRejected,
      outcomesApplied: this.outcomesApplied,
      outcomesRejected: this.outcomesRejected,
      outcomesCanceled: this.outcomesCanceled,
      matchStartsMs: [...this.matchStartsMs],
      abortsSeen: this.abortsSeen,
      abortReasons: [...this.abortReasons],
      phasesSeen: [...this.phasesSeen],
    };
  }

  /** Clears per-stage counters while keeping phase/match tracking for the next stage window. */
  resetStage(): void {
    this.ackLatenciesMs.length = 0;
    this.commandsSent = 0;
    this.receiptsRejected = 0;
    this.outcomesApplied = 0;
    this.outcomesRejected = 0;
    this.outcomesCanceled = 0;
    this.abortsSeen = 0;
    this.abortReasons.length = 0;
    const lastStart = this.matchStartsMs.at(-1);
    this.matchStartsMs.length = 0;
    if (lastStart !== undefined) this.matchStartsMs.push(lastStart);
  }

  pendingCount() {
    return this.pending.size;
  }
}
