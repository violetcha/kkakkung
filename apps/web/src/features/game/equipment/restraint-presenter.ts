import type { PrivateView } from '@kkakkung/protocol/game-schema';

export function restraintPresenter(view: PrivateView | null, tick: number) {
  const self = view?.self;
  if (self?.status !== 'ACTIVE') return null;
  const remaining = (until: number | null) =>
    until === null ? null : Math.max(0, Math.ceil((until - tick) / 20));
  if (self.restraintUntilTick === null && self.restraintImmuneUntilTick === null) return null;
  return {
    restraintSeconds: remaining(self.restraintUntilTick),
    immuneSeconds: remaining(self.restraintImmuneUntilTick),
  };
}
