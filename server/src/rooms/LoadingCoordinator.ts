/**
 * GAME_LOADING barrier. Every participant must report LOAD_READY for the current loadId,
 * mediaInstanceId and their own receiverGeneration, and (when media is enabled) the server
 * must have confirmed the participant's own face track publication in a binding for the same
 * scope. A 30 second monotonic deadline invalidates the loadId; late reports never reopen it.
 */
import type { LoadingView } from '@kkakkung/protocol/game-schema';
import type { OutcomeResult } from '../game/ports.js';

export const LOADING_TIMEOUT_MS = 30_000;

type Participant = { receiverGeneration: number | null; reported: boolean; faceConfirmed: boolean };

export type LoadingBarrier = Readonly<{
  loadId: string;
  mediaInstanceId: string;
  openedAtMs: number;
}>;

export class LoadingCoordinator {
  private barrier: LoadingBarrier | null = null;
  private readonly participants = new Map<string, Participant>();

  constructor(private readonly options: { timeoutMs?: number; requireFace: boolean }) {}

  get timeoutMs() {
    return this.options.timeoutMs ?? LOADING_TIMEOUT_MS;
  }

  get current() {
    return this.barrier;
  }

  open(input: {
    loadId: string;
    mediaInstanceId: string;
    playerIds: readonly string[];
    nowMs: number;
  }) {
    this.barrier = {
      loadId: input.loadId,
      mediaInstanceId: input.mediaInstanceId,
      openedAtMs: input.nowMs,
    };
    this.participants.clear();
    for (const playerId of input.playerIds)
      this.participants.set(playerId, {
        receiverGeneration: null,
        reported: false,
        faceConfirmed: false,
      });
  }

  /** E's prepared generation for this recipient. Only the current scope's generation counts. */
  setReceiverGeneration(playerId: string, mediaInstanceId: string, receiverGeneration: number) {
    const participant = this.participants.get(playerId);
    if (!this.barrier || !participant || this.barrier.mediaInstanceId !== mediaInstanceId)
      return false;
    participant.receiverGeneration = receiverGeneration;
    participant.reported = false;
    participant.faceConfirmed = false;
    return true;
  }

  receiverGeneration(playerId: string) {
    return this.participants.get(playerId)?.receiverGeneration ?? null;
  }

  applyLoadReady(
    actorId: string,
    payload: { loadId: string; mediaInstanceId: string; receiverGeneration: number },
  ): OutcomeResult {
    const participant = this.participants.get(actorId);
    if (!this.barrier || !participant) return { result: 'rejected', code: 'INVALID_PHASE' };
    if (payload.loadId !== this.barrier.loadId) return { result: 'rejected', code: 'EXPIRED' };
    if (payload.mediaInstanceId !== this.barrier.mediaInstanceId)
      return { result: 'rejected', code: 'NOT_ALLOWED' };
    if (
      participant.receiverGeneration === null ||
      payload.receiverGeneration !== participant.receiverGeneration
    )
      return { result: 'rejected', code: 'NOT_READY' };
    participant.reported = true;
    return { result: 'applied', code: null };
  }

  /** Server-side confirmation from E's binding self entry for the same scope and generation. */
  confirmSelfFace(
    playerId: string,
    mediaInstanceId: string,
    receiverGeneration: number,
    faceTrackSid: string | undefined,
  ) {
    const participant = this.participants.get(playerId);
    if (!this.barrier || !participant || this.barrier.mediaInstanceId !== mediaInstanceId)
      return false;
    if (participant.receiverGeneration !== receiverGeneration || !faceTrackSid) return false;
    participant.faceConfirmed = true;
    return true;
  }

  /** Counts only (no identities): what the barrier is still waiting for. Null when closed. */
  summary(): { total: number; reported: number; faceConfirmed: number } | null {
    if (!this.barrier) return null;
    let reported = 0;
    let faceConfirmed = 0;
    for (const participant of this.participants.values()) {
      if (participant.reported) reported++;
      if (participant.faceConfirmed) faceConfirmed++;
    }
    return { total: this.participants.size, reported, faceConfirmed };
  }

  evaluate(nowMs: number): 'waiting' | 'complete' | 'timeout' {
    if (!this.barrier) return 'waiting';
    if (nowMs - this.barrier.openedAtMs >= this.timeoutMs) return 'timeout';
    for (const participant of this.participants.values()) {
      if (!participant.reported) return 'waiting';
      if (this.options.requireFace && !participant.faceConfirmed) return 'waiting';
    }
    return 'complete';
  }

  /** Closes the barrier; the loadId cannot be reused by late reports. */
  invalidate() {
    this.barrier = null;
    this.participants.clear();
  }

  loadingView(
    playerId: string,
    initialViewVersion: number,
    assetVersion: string,
  ): LoadingView | null {
    const participant = this.participants.get(playerId);
    if (!this.barrier || !participant || participant.receiverGeneration === null) return null;
    return {
      loadId: this.barrier.loadId,
      initialViewVersion,
      mediaInstanceId: this.barrier.mediaInstanceId,
      receiverGeneration: participant.receiverGeneration,
      assetVersion,
    };
  }
}
