import { describe, expect, it, vi } from 'vitest';

import {
  allowsRecoveryWindow,
  createMediaLifecycle,
  RECOVERY_WINDOW_MS,
  type GenerationState,
  type RetireReason,
} from './media-lifecycle';

function harness() {
  const order: string[] = [];
  const states: GenerationState[] = [];
  let clock = 1000;
  const steps = {
    closeOutput: vi.fn(() => order.push('closeOutput')),
    stopListeners: vi.fn(() => order.push('stopListeners')),
    unpublishAll: vi.fn(async () => {
      order.push('unpublishAll');
    }),
    releaseRemote: vi.fn(() => order.push('releaseRemote')),
    disconnect: vi.fn(async () => {
      order.push('disconnect');
    }),
  };
  const participation = {
    stopInput: vi.fn(() => order.push('stopInput')),
    stopVision: vi.fn(() => order.push('stopVision')),
    stopDevices: vi.fn(async () => {
      order.push('stopDevices');
    }),
  };
  const lifecycle = createMediaLifecycle({
    media: steps,
    participation,
    now: () => clock,
    onStateChange: (state) => states.push(state),
  });
  return {
    lifecycle,
    steps,
    participation,
    order,
    states,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('createMediaLifecycle', () => {
  it('marks the generation terminal before it touches any resource', async () => {
    const base = harness();

    const retiring = base.lifecycle.retireGeneration('phase-change');
    // terminal 전환은 동기적으로 먼저 일어나 새 게시·구독을 막는다.
    expect(base.lifecycle.state).toBe('terminal');
    expect(base.lifecycle.canOperate()).toBe(false);
    await retiring;

    expect(base.states[0]).toBe('terminal');
    expect(base.lifecycle.state).toBe('closed');
  });

  it('closes the output first and waits for the SDK disconnect last', async () => {
    const base = harness();

    await base.lifecycle.retireGeneration('round-ended');

    expect(base.order).toEqual([
      'closeOutput',
      'stopListeners',
      'releaseRemote',
      'unpublishAll',
      'disconnect',
    ]);
  });

  it('keeps the original devices, input and vision on a plain generation retire', async () => {
    const base = harness();

    await base.lifecycle.retireGeneration('phase-change');

    // playerId·게임 Room·원본 카메라와 센서는 이 경로에서 건드리지 않는다.
    expect(base.participation.stopDevices).not.toHaveBeenCalled();
    expect(base.participation.stopVision).not.toHaveBeenCalled();
    expect(base.participation.stopInput).not.toHaveBeenCalled();
  });

  it('separates the local closed state from a server retirement confirmation', async () => {
    const base = harness();

    await base.lifecycle.retireGeneration('reconnect');

    expect(base.lifecycle.locallyClosed).toBe(true);
    // 로컬 closed는 서버 회수 성공이 아니다. 새 세대는 확인 뒤에만 시작한다.
    expect(base.lifecycle.canOperate()).toBe(false);
  });

  it('cleans up exactly once for a concurrent close, personal end and unmount', async () => {
    const base = harness();

    await Promise.all([
      base.lifecycle.retireGeneration('connection-lost'),
      base.lifecycle.endParticipation(),
      base.lifecycle.dispose(),
    ]);

    expect(base.steps.disconnect).toHaveBeenCalledTimes(1);
    expect(base.steps.unpublishAll).toHaveBeenCalledTimes(1);
    expect(base.steps.releaseRemote).toHaveBeenCalledTimes(1);
    expect(base.participation.stopDevices).toHaveBeenCalledTimes(1);
    expect(base.participation.stopVision).toHaveBeenCalledTimes(1);
  });

  it('closes the input, the worker and the devices only on endParticipation', async () => {
    const base = harness();

    await base.lifecycle.endParticipation();

    expect(base.order).toEqual([
      'closeOutput',
      'stopListeners',
      'releaseRemote',
      'unpublishAll',
      'disconnect',
      'stopInput',
      'stopVision',
      'stopDevices',
    ]);
  });

  it('is idempotent across repeated end and dispose calls', async () => {
    const base = harness();

    await base.lifecycle.endParticipation();
    await base.lifecycle.endParticipation();
    await base.lifecycle.dispose();
    await base.lifecycle.dispose();

    expect(base.participation.stopDevices).toHaveBeenCalledTimes(1);
    expect(base.steps.disconnect).toHaveBeenCalledTimes(1);
    expect(base.lifecycle.disposed).toBe(true);
  });

  it('allows a new generation only after an explicit begin', async () => {
    const base = harness();
    await base.lifecycle.retireGeneration('phase-change');
    expect(base.lifecycle.canOperate()).toBe(false);

    base.lifecycle.beginGeneration();

    expect(base.lifecycle.state).toBe('live');
    expect(base.lifecycle.canOperate()).toBe(true);
  });

  it('never reopens the generation from a late reconnect after a retire', async () => {
    const base = harness();
    expect(base.lifecycle.allowsRecovery(1000)).toBe(true);

    await base.lifecycle.retireGeneration('phase-change');

    expect(base.lifecycle.allowsRecovery(1000)).toBe(false);
    base.advance(RECOVERY_WINDOW_MS - 1);
    expect(base.lifecycle.allowsRecovery(base.lifecycle.state === 'closed' ? 1001 : 1001)).toBe(
      false,
    );
  });

  it('refuses any operation after dispose', async () => {
    const base = harness();
    await base.lifecycle.dispose();

    await base.lifecycle.retireGeneration('shutdown');
    base.lifecycle.beginGeneration();

    expect(base.lifecycle.canOperate()).toBe(false);
    expect(base.lifecycle.allowsRecovery(9999)).toBe(false);
    expect(base.steps.disconnect).toHaveBeenCalledTimes(1);
  });
});

describe('allowsRecoveryWindow', () => {
  it('waits the server window for a plain reconnect but not for an uncertain policy', () => {
    expect(allowsRecoveryWindow('reconnect')).toBe(true);
    expect(allowsRecoveryWindow('phase-change')).toBe(true);
    expect(allowsRecoveryWindow('connection-lost')).toBe(true);
    // MEDIA_POLICY_UNCERTAIN·개인 종료·shutdown은 10초를 기다리지 않고 끝낸다.
    expect(allowsRecoveryWindow('policy-unknown')).toBe(false);
    expect(allowsRecoveryWindow('personal-ended')).toBe(false);
    expect(allowsRecoveryWindow('shutdown')).toBe(false);
  });

  it('pins the server recovery window', () => {
    expect(RECOVERY_WINDOW_MS).toBe(10_000);
  });

  it('covers every retire reason', () => {
    const reasons: RetireReason[] = [
      'phase-change',
      'personal-ended',
      'connection-lost',
      'policy-unknown',
      'round-ended',
      'reconnect',
      'shutdown',
    ];
    for (const reason of reasons) expect(typeof allowsRecoveryWindow(reason)).toBe('boolean');
  });
});
