import { describe, expect, it, vi } from 'vitest';

import { createMovementController } from './movement-controller';

class FakeEventTarget {
  private listeners = new Map<string, Set<(event: Event) => void>>();

  addEventListener(type: string, listener: EventListener): void {
    const callbacks = this.listeners.get(type) ?? new Set();
    callbacks.add(listener);
    this.listeners.set(type, callbacks);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, event: Event): void {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}

function key(code: string): Event {
  return { code, preventDefault() {} } as unknown as Event;
}

describe('createMovementController', () => {
  it('sends normalized movement at 20Hz while keys are held', () => {
    vi.useFakeTimers();
    const target = new FakeEventTarget();
    const send = vi.fn();
    const controller = createMovementController({ target, send });
    controller.connect();

    target.dispatch('keydown', key('KeyW'));
    target.dispatch('keydown', key('KeyD'));
    vi.advanceTimersByTime(50);

    const command = send.mock.calls[0]?.[0];
    expect(command.seq).toBe(0);
    expect(command.x).toBeCloseTo(Math.SQRT1_2);
    expect(command.z).toBeCloseTo(-Math.SQRT1_2);
    controller.disconnect();
    vi.useRealTimers();
  });

  it('stops sending after blur and after disconnect', () => {
    vi.useFakeTimers();
    const target = new FakeEventTarget();
    const send = vi.fn();
    const controller = createMovementController({ target, send });
    controller.connect();
    target.dispatch('keydown', key('ArrowUp'));
    vi.advanceTimersByTime(50);
    target.dispatch('blur', new Event('blur'));
    vi.advanceTimersByTime(100);
    expect(send).toHaveBeenCalledTimes(1);

    target.dispatch('keydown', key('ArrowUp'));
    controller.disconnect();
    vi.advanceTimersByTime(100);
    expect(send).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
