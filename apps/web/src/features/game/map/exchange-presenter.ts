import type { PrivateView } from '@kkakkung/protocol/game-schema';
import type { CommandInput } from '../../room/command-lifecycle';

export function exchangePresenter(view: PrivateView | null, selected: string | null, tick: number) {
  const self = view?.self;
  if (!view || self?.status !== 'ACTIVE') return null;
  const candidates = view.visibleEntities
    .filter(
      (entity) =>
        entity.kind === 'player' && entity.role === self.role && entity.id !== self.playerId,
    )
    .sort((a, b) => {
      const distance = (p: typeof a) =>
        (p.cell.x - self.cell.x) ** 2 + (p.cell.y - self.cell.y) ** 2;
      return distance(a) - distance(b) || a.id.localeCompare(b.id);
    });
  return {
    candidates,
    selected: candidates.find((p) => p.id === selected)?.id ?? candidates[0]?.id ?? null,
    exchange: self.exchange,
    seconds: self.exchange
      ? Math.max(0, Math.ceil((self.exchange.expiresAtTick - tick) / 20))
      : null,
    canRequest:
      !self.exchange && !self.challenge && !self.installation && self.restraintUntilTick === null,
    canAccept:
      self.exchange?.direction === 'incoming' && self.exchange.toPlayerId === self.playerId,
  };
}

export function permitsExchange(view: PrivateView | null, command: CommandInput) {
  const model = exchangePresenter(view, null, 0);
  if (command.type === 'EXCHANGE_REQUEST')
    return (
      !!model?.canRequest && model.candidates.some((p) => p.id === command.payload.targetPlayerId)
    );
  if (command.type === 'EXCHANGE_ACCEPT')
    return !!model?.canAccept && model.exchange?.exchangeId === command.payload.exchangeId;
  if (command.type === 'EXCHANGE_CANCEL')
    return !!model?.exchange && model.exchange.exchangeId === command.payload.exchangeId;
  return true;
}
