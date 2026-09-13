import { describe, expect, it, vi } from 'vitest';
import {
  MediaLifecycle,
  type LifecycleInspection,
  type LifecycleReport,
  type MediaLifecycleOptions,
} from '../../src/media/MediaLifecycle.js';
import { MediaGenerationRegistry } from '../../src/media/MediaGenerationRegistry.js';
import type { RetireGenerationRequest } from '../../src/media/types.js';
import { practiceFrame, prepareRequest } from './generation-fixtures.js';

function setup(extra: Partial<MediaLifecycleOptions> = {}, split = false) {
  let now = 100;
  const timers = new Set<{ callback: () => void; at: number }>();
  const registry = new MediaGenerationRegistry('e-fixture', false, split ? 'split' : 'single');
  registry.observe(practiceFrame);
  const generation = registry.allocate(prepareRequest, 1_800_000_000_000);
  let inspection: LifecycleInspection | null = {
    participantSid: 'PA_FIRST',
    ...(split ? { faceParticipantSid: 'PA_FACE' } : {}),
    dirty: false,
    terminal: false,
    lastVerifiedAt: 90,
    bindings: [
      {
        matchId: 'm',
        mediaInstanceId: 'practice',
        mediaRoomName: generation.roomName,
        playerId: 'p',
        mediaIdentity: generation.splitOwnership?.faceIdentity ?? generation.identity,
        publisherGeneration: 1,
        participantSid: split ? 'PA_FACE' : 'PA_FIRST',
        source: 'camera',
        trackSid: 'TR_CAMERA',
        verifiedAt: 90,
      },
    ],
  };
  const options: MediaLifecycleOptions = {
    registry,
    inspect: () => inspection,
    monotonicNow: () => now,
    timer: (callback, delay) => {
      const entry = { callback, at: now + delay };
      timers.add(entry);
      return () => {
        timers.delete(entry);
      };
    },
    onFailure: vi.fn(),
    onGameDisconnected: vi.fn(),
    onRecoveryStarted: vi.fn(),
    ...extra,
  };
  const lifecycle = new MediaLifecycle(options);
  const report: LifecycleReport = {
    matchId: 'm',
    playerId: 'p',
    mediaInstanceId: 'practice',
    receiverGeneration: 1,
    status: 'recovering',
  };
  const retirement: RetireGenerationRequest = {
    ...report,
    requestId: 'retire-one',
    reason: 'reconnect',
  };
  const updateInspection = (patch: Partial<LifecycleInspection>) => {
    inspection = { ...inspection!, ...patch };
  };
  return {
    lifecycle,
    registry,
    generation,
    options,
    report,
    retirement,
    timers,
    connect: () => lifecycle.setGameConnection({ matchId: 'm', playerId: 'p', connected: true }),
    inspect: () => inspection!,
    updateInspection,
    clearInspection: () => {
      inspection = null;
    },
    time: (value: number, fire = false) => {
      now = value;
      if (fire) {
        for (const entry of [...timers]) {
          if (entry.at <= now) {
            timers.delete(entry);
            entry.callback();
          }
        }
      }
    },
    refreshCamera: (verifiedAt: number) => {
      updateInspection({
        lastVerifiedAt: verifiedAt,
        bindings: inspection!.bindings.map((b) => ({ ...b, verifiedAt })),
      });
    },
  };
}

describe('authenticated lifecycle side port; scoped reports are not Cloud proof', () => {
  it.each(['face-changed', 'receiver-changed', 'half-connected', 'both-fresh'])(
    'requires both split identities and a fresh combined inspection: %s',
    (mode) => {
      const s = setup({}, true);
      s.connect();
      s.lifecycle.report(s.report);
      s.time(200);
      s.refreshCamera(200);
      if (mode === 'face-changed') s.updateInspection({ faceParticipantSid: 'PA_FACE_NEW' });
      if (mode === 'receiver-changed') s.updateInspection({ participantSid: 'PA_RECEIVER_NEW' });
      if (mode === 'half-connected') s.updateInspection({ faceParticipantSid: null });
      s.lifecycle.reconcile();
      expect(s.lifecycle.recoveryStartedAt(s.generation)).toBe(mode === 'both-fresh' ? null : 100);
      s.time(10101, true);
      expect(s.options.onFailure).toHaveBeenCalledTimes(mode === 'both-fresh' ? 0 : 1);
      s.lifecycle.close();
    },
  );

  it('stops the ordinary window after a fatal policy end already handled by the coordinator', () => {
    let allowed = true;
    const s = setup({ isRecoveryAllowed: () => allowed });
    s.connect();
    s.lifecycle.report(s.report);
    allowed = false;
    s.generation.terminal = true;
    s.lifecycle.reconcile();
    expect(s.timers.size).toBe(0);
    expect(s.lifecycle.recoveryStartedAt(s.generation)).toBeNull();
    s.time(10101, true);
    expect(s.options.onFailure).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'preserves the first deadline after local closed, remote terminal=%s',
    (terminal) => {
      const s = setup();
      s.connect();
      s.lifecycle.report(s.report);
      s.time(9000);
      s.lifecycle.report({ ...s.report, status: 'closed' });
      s.generation.terminal = terminal;
      if (terminal) s.generation.state = 'REVOKED';
      s.refreshCamera(9500);
      s.time(9500);
      s.lifecycle.reconcile();
      expect(s.lifecycle.recoveryStartedAt(s.generation)).toBe(100);
      s.time(10101, true);
      expect(s.options.onFailure).toHaveBeenCalledExactlyOnceWith(s.generation, 'TIMEOUT');
    },
  );

  it('requires B to establish a live game connection before accepting recovery or ready', () => {
    const s = setup();
    expect(s.lifecycle.isGameConnected('m', 'p')).toBe(false);
    expect(s.lifecycle.report(s.report)).toBe(false);
    expect(s.lifecycle.report({ ...s.report, status: 'ready' })).toBe(false);
    s.connect();
    expect(s.lifecycle.isGameConnected('m', 'p')).toBe(true);
    expect(s.lifecycle.report(s.report)).toBe(true);
    expect(s.options.onRecoveryStarted).toHaveBeenCalledWith(s.generation);
  });

  it('keeps the first recovery deadline despite repeated failed/recovering/ready reports', () => {
    const s = setup();
    s.connect();
    s.lifecycle.report(s.report);
    expect(s.lifecycle.recoveryStartedAt(s.generation)).toBe(100);
    s.time(9000);
    s.lifecycle.report({ ...s.report, status: 'failed' });
    s.lifecycle.report({ ...s.report, status: 'ready' });
    expect(s.options.onRecoveryStarted).toHaveBeenCalledOnce();
    expect(s.lifecycle.recoveryStartedAt(s.generation)).toBe(100);
    s.time(10_101, true);
    expect(s.options.onFailure).toHaveBeenCalledExactlyOnceWith(s.generation, 'TIMEOUT');
    expect(s.lifecycle.report(s.report)).toBe(false);
    expect(s.timers.size).toBe(0);
    expect(s.lifecycle.recoveryStartedAt(s.generation)).toBeNull();
  });

  it('does not let a ready report or unchanged pre-recovery query clear the window', () => {
    const s = setup();
    s.connect();
    s.lifecycle.report(s.report);
    s.time(500);
    s.lifecycle.report({ ...s.report, status: 'ready' });
    s.lifecycle.reconcile();
    expect(s.timers.size).toBe(1);
    s.time(10_101, true);
    expect(s.options.onFailure).toHaveBeenCalledWith(s.generation, 'TIMEOUT');
  });

  it('clears ordinary recovery only for a fresh verified camera with the original participant SID', () => {
    const s = setup();
    s.connect();
    s.lifecycle.report(s.report);
    s.time(500);
    s.refreshCamera(500);
    s.lifecycle.reconcile();
    expect(s.timers.size).toBe(0);
    s.time(10_101, true);
    expect(s.options.onFailure).not.toHaveBeenCalled();
    expect(s.generation.generation).toBe(1);
    expect(s.generation.state).toBe('PREPARED');
  });

  it.each([
    'participant',
    'track-participant',
    'microphone-only',
    'dirty',
    'terminal',
    'identity',
    'generation',
    'future',
    'stale-track',
    'wrong-instance',
  ])('does not treat a %s inspection as healed', (fault) => {
    const s = setup();
    s.connect();
    s.lifecycle.report(s.report);
    s.time(500);
    s.refreshCamera(500);
    const binding = s.inspect().bindings[0]!;
    if (fault === 'participant') s.updateInspection({ participantSid: 'PA_NEW' });
    if (fault === 'track-participant')
      s.updateInspection({ bindings: [{ ...binding, participantSid: 'PA_NEW' }] });
    if (fault === 'microphone-only')
      s.updateInspection({ bindings: [{ ...binding, source: 'microphone' }] });
    if (fault === 'dirty') s.updateInspection({ dirty: true });
    if (fault === 'terminal') s.updateInspection({ terminal: true });
    if (fault === 'identity')
      s.updateInspection({ bindings: [{ ...binding, mediaIdentity: 'old-identity' }] });
    if (fault === 'generation')
      s.updateInspection({ bindings: [{ ...binding, publisherGeneration: 2 }] });
    if (fault === 'future') s.updateInspection({ lastVerifiedAt: 1000 });
    if (fault === 'stale-track') s.updateInspection({ bindings: [{ ...binding, verifiedAt: 90 }] });
    if (fault === 'wrong-instance')
      s.updateInspection({ bindings: [{ ...binding, mediaInstanceId: 'other' }] });
    s.lifecycle.reconcile();
    expect(s.timers.size).toBe(1);
    s.time(10_101, true);
    expect(s.options.onFailure).toHaveBeenCalledWith(s.generation, 'TIMEOUT');
  });

  it('does not manufacture a same-SDK recovery when no baseline SID was ever verified', () => {
    const s = setup();
    s.connect();
    s.updateInspection({ participantSid: null });
    s.lifecycle.report(s.report);
    s.time(500);
    s.updateInspection({ participantSid: 'PA_NEW' });
    s.refreshCamera(500);
    s.lifecycle.reconcile();
    expect(s.timers.size).toBe(1);
    s.time(10_101, true);
    expect(s.options.onFailure).toHaveBeenCalledOnce();
  });

  it('checks elapsed time before accepting a fresh query that arrives after the deadline', () => {
    const s = setup();
    s.connect();
    s.lifecycle.report(s.report);
    s.time(10_101);
    s.refreshCamera(10_101);
    s.lifecycle.reconcile();
    expect(s.options.onFailure).toHaveBeenCalledWith(s.generation, 'TIMEOUT');
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 99])(
    'fails a corrupt/backward monotonic clock: %s',
    (clock) => {
      const s = setup();
      s.connect();
      s.lifecycle.report(s.report);
      s.time(clock);
      s.lifecycle.reconcile();
      expect(s.options.onFailure).toHaveBeenCalledOnce();
    },
  );

  it('immediately reports game disconnection, cancels recovery, and keeps unrelated connections', () => {
    const s = setup();
    s.connect();
    s.lifecycle.setGameConnection({ matchId: 'm', playerId: 'q', connected: true });
    s.lifecycle.report(s.report);
    s.lifecycle.setGameConnection({ matchId: 'm', playerId: 'p', connected: false });
    s.lifecycle.setGameConnection({ matchId: 'm', playerId: 'p', connected: false });
    expect(s.options.onGameDisconnected).toHaveBeenCalledExactlyOnceWith({
      matchId: 'm',
      playerId: 'p',
    });
    expect(s.timers.size).toBe(0);
    expect(s.lifecycle.isGameConnected('m', 'q')).toBe(true);
    expect(s.lifecycle.report(s.report)).toBe(false);
  });

  it('accepts exact closed as local evidence without changing remote state or game connectivity', async () => {
    const s = setup();
    s.connect();
    const abort = new AbortController();
    const pending = s.lifecycle.awaitLocalRetirement(s.retirement, abort.signal);
    expect(s.lifecycle.report({ ...s.report, status: 'closed' })).toBe(true);
    expect(await pending).toBe(true);
    expect(s.lifecycle.hasLocalRetirement(s.generation)).toBe(true);
    expect(s.generation.state).toBe('PREPARED');
    expect(s.generation.terminal).toBe(false);
    expect(s.lifecycle.isGameConnected('m', 'p')).toBe(true);
    expect(s.options.onFailure).not.toHaveBeenCalled();
  });

  it('observes an old closed acknowledgment without clearing a newer generation recovery', async () => {
    const s = setup();
    s.connect();
    const old = s.generation;
    old.terminal = true;
    old.state = 'REVOKED';
    const current = s.registry.allocate(
      { ...prepareRequest, requestId: 'new', expectedPreviousGeneration: 1 },
      1_800_000_000_010,
    );
    const newReport = { ...s.report, receiverGeneration: 2 };
    s.lifecycle.report(newReport);
    expect(s.lifecycle.report({ ...s.report, status: 'ready' })).toBe(false);
    expect(s.lifecycle.report({ ...s.report, status: 'closed' })).toBe(true);
    expect(s.lifecycle.hasLocalRetirement(old)).toBe(true);
    expect(s.lifecycle.hasLocalRetirement(current)).toBe(false);
    expect(s.timers.size).toBe(1);
    s.time(10_101, true);
    expect(s.options.onFailure).toHaveBeenCalledWith(current, 'TIMEOUT');
  });

  it.each(['matchId', 'playerId', 'mediaInstanceId', 'receiverGeneration'])(
    'ignores a closed acknowledgment with the wrong %s',
    async (field) => {
      const s = setup();
      const wrong = {
        ...s.report,
        status: 'closed',
        [field]: field === 'receiverGeneration' ? 2 : 'other',
      } as LifecycleReport;
      expect(s.lifecycle.report(wrong)).toBe(false);
      expect(s.lifecycle.hasLocalRetirement(s.generation)).toBe(false);
    },
  );

  it('accepts a previously received exact local acknowledgment idempotently', async () => {
    const s = setup();
    s.lifecycle.report({ ...s.report, status: 'closed' });
    s.lifecycle.report({ ...s.report, status: 'closed' });
    const abort = new AbortController();
    expect(await s.lifecycle.awaitLocalRetirement(s.retirement, abort.signal)).toBe(true);
    expect(s.timers.size).toBe(0);
  });

  it('bounds phase retirement acknowledgment independently and never treats absence as success', async () => {
    const s = setup();
    const abort = new AbortController();
    const pending = s.lifecycle.awaitLocalRetirement(
      { ...s.retirement, reason: 'phase-change' },
      abort.signal,
    );
    s.time(10_101, true);
    expect(await pending).toBe(false);
    expect(s.lifecycle.hasLocalRetirement(s.generation)).toBe(false);
    expect(s.options.onFailure).not.toHaveBeenCalled();
  });

  it('rejects an acknowledgment arriving after its deadline before the timer was scheduled', async () => {
    const s = setup();
    const abort = new AbortController();
    const pending = s.lifecycle.awaitLocalRetirement(s.retirement, abort.signal);
    s.time(10_101);
    s.lifecycle.report({ ...s.report, status: 'closed' });
    expect(await pending).toBe(false);
  });

  it('cancels just the aborted waiter and closes all remaining waiters without cleanup proof', async () => {
    const s = setup();
    const firstAbort = new AbortController();
    const secondAbort = new AbortController();
    const first = s.lifecycle.awaitLocalRetirement(s.retirement, firstAbort.signal);
    const second = s.lifecycle.awaitLocalRetirement(s.retirement, secondAbort.signal);
    firstAbort.abort();
    expect(await first).toBe(false);
    expect(s.timers.size).toBe(1);
    s.lifecycle.close();
    expect(await second).toBe(false);
    expect(s.timers.size).toBe(0);
    expect(s.lifecycle.isGameConnected('m', 'p')).toBe(false);
    expect(s.lifecycle.report({ ...s.report, status: 'closed' })).toBe(false);
    expect(await s.lifecycle.awaitLocalRetirement(s.retirement, new AbortController().signal)).toBe(
      false,
    );
  });

  it('keeps an existing deadline through retirement without accepting new recovery reports', () => {
    const s = setup();
    s.connect();
    s.clearInspection();
    s.lifecycle.report(s.report);
    expect(s.timers.size).toBe(1);
    s.generation.terminal = true;
    s.lifecycle.reconcile();
    expect(s.timers.size).toBe(1);
    expect(s.lifecycle.recoveryStartedAt(s.generation)).toBe(100);
    expect(s.lifecycle.report(s.report)).toBe(false);
    expect(s.options.onFailure).not.toHaveBeenCalled();
  });
});
