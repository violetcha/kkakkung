// Enabled only with the existing test CPU profiler. Contains timings, never call arguments.
import { MatchDriver } from '../../src/game/MatchDriver.js';
import { EventDispatcher } from '../../src/game/EventDispatcher.js';
import { MediaPolicyBindings } from '../../src/media/MediaPolicyBindings.js';
import { AudibilityPolicy } from '../../src/media/AudibilityPolicy.js';
import { ReadinessGate } from '../../src/health/Readiness.js';
import { ReservationReadinessInspector } from '../../src/health/ReservationReadiness.js';

export function profileProductPhases(phase: () => string) {
  const totals = new Map<
    string,
    { count: number; totalMs: number; ownMs: number; maxMs: number }
  >();
  const stack: { childMs: number }[] = [];
  const restore: (() => void)[] = [];
  function wrap<T extends object>(target: T, key: keyof T, label: string) {
    const original = target[key] as (...args: unknown[]) => unknown;
    const descriptor = Object.getOwnPropertyDescriptor(target, key)!;
    Object.defineProperty(target, key, {
      ...descriptor,
      value: function (this: T, ...args: unknown[]) {
        const id = `${phase()}/${label}`;
        const started = performance.now();
        const frame = { childMs: 0 };
        stack.push(frame);
        try {
          return original.apply(this, args);
        } finally {
          const elapsed = performance.now() - started;
          stack.pop();
          const parent = stack.at(-1);
          if (parent) parent.childMs += elapsed;
          const value = totals.get(id) ?? { count: 0, totalMs: 0, ownMs: 0, maxMs: 0 };
          value.count++;
          value.totalMs += elapsed;
          value.ownMs += Math.max(0, elapsed - frame.childMs);
          value.maxMs = Math.max(value.maxMs, elapsed);
          totals.set(id, value);
        }
      },
    });
    restore.push(() => Object.defineProperty(target, key, descriptor));
  }
  wrap(MatchDriver.prototype, 'tick', 'driver');
  wrap(EventDispatcher.prototype, 'publishView', 'state-view');
  wrap(MediaPolicyBindings.prototype, 'observeFrame', 'media');
  wrap(AudibilityPolicy.prototype, 'observe', 'audibility');
  wrap(ReadinessGate.prototype, 'getReadiness', 'readiness');
  wrap(ReservationReadinessInspector.prototype, 'inspect', 'accounting');
  return {
    snapshot: () => Object.fromEntries(totals),
    close: () => restore.reverse().forEach((fn) => fn()),
  };
}
