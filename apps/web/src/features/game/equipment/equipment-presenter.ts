import type { PrivateView } from '@kkakkung/protocol/game-schema';
export function equipmentPresenter(view: PrivateView | null, tick: number) {
  const self = view?.self;
  if (self?.status !== 'ACTIVE' || self.role !== 'tagger') return null;
  const installation = self.installation;
  return {
    remaining: self.equipment,
    installation,
    progress: installation
      ? Math.max(
          0,
          Math.min(
            1,
            (tick - installation.startTick) /
              Math.max(1, installation.endTick - installation.startTick),
          ),
        )
      : 0,
    owned: self.ownedEquipment.map((item) => ({
      ...item,
      armSeconds: Math.max(0, (item.armedTick - tick) / 20),
    })),
    locked:
      self.action !== null ||
      self.challenge !== null ||
      (self.restraintUntilTick !== null && tick < self.restraintUntilTick),
  };
}
export function visibleEquipment(view: PrivateView) {
  if (view.self?.status !== 'ACTIVE' && !view.spectating) return [];
  return view.visibleEntities.filter(
    (entity) => entity.kind === 'sensor' || entity.kind === 'trap',
  );
}
