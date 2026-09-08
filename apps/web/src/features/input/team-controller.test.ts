import { describe, expect, it, vi } from 'vitest';
import { createTeamController } from './team-controller';

class FakeTarget {
  listeners = new Map<string, Set<(event: Event) => void>>();
  addEventListener(type: string, listener: EventListener) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: EventListener) {
    this.listeners.get(type)?.delete(listener);
  }
  key(type: string, code: string, repeat = false) {
    this.listeners
      .get(type)
      ?.forEach((listener) => listener({ code, repeat, preventDefault() {} } as unknown as Event));
  }
  blur() {
    this.listeners.get('blur')?.forEach((listener) => listener(new Event('blur')));
  }
}

describe('createTeamController', () => {
  it('throttles held forward movement and sends turns only on key edges', () => {
    vi.useFakeTimers();
    const target = new FakeTarget();
    const move = vi.fn();
    const turn = vi.fn();
    const controller = createTeamController({ target, move, turn });
    controller.connect();

    target.key('keydown', 'KeyW');
    target.key('keydown', 'KeyA');
    target.key('keydown', 'KeyA', true);
    vi.advanceTimersByTime(300);

    expect(move).toHaveBeenCalledTimes(3);
    expect(move).toHaveBeenNthCalledWith(1, { seq: 0, dir: 'forward' });
    expect(turn).toHaveBeenCalledOnce();
    expect(turn).toHaveBeenCalledWith({ seq: 1, dir: 'left' });
    controller.disconnect();
    vi.useRealTimers();
  });

  it('stops held movement on blur', () => {
    vi.useFakeTimers();
    const target = new FakeTarget();
    const move = vi.fn();
    const controller = createTeamController({ target, move, turn: vi.fn() });
    controller.connect();
    target.key('keydown', 'KeyS');
    vi.advanceTimersByTime(150);
    target.blur();
    vi.advanceTimersByTime(300);
    expect(move).toHaveBeenCalledTimes(2);
    expect(move).toHaveBeenCalledWith({ seq: 0, dir: 'back' });
    controller.disconnect();
    vi.useRealTimers();
  });
});
