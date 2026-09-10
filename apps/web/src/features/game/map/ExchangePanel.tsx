import type { PrivateView } from '@kkakkung/protocol/game-schema';
import type { CommandInput, RequestDisplay } from '../../room/command-lifecycle';
import { exchangePresenter } from './exchange-presenter';

export function ExchangePanel({
  view,
  selected,
  tick,
  request,
  onSelect,
  send,
}: {
  view: PrivateView;
  selected: string | null;
  tick: number;
  request?: RequestDisplay;
  onSelect(id: string): void;
  send(command: CommandInput): void;
}) {
  const model = exchangePresenter(view, selected, tick);
  if (!model) return null;
  const pending = request?.status === 'pending' || request?.status === 'waiting-view';
  const exchange = model.exchange;
  return (
    <section className="game-panel" aria-label="지도 교환">
      <h2>지도 교환</h2>
      {exchange ? (
        <>
          <p>
            {model.canAccept ? '아군이 지도를 나누려고 합니다.' : '아군의 수락을 기다립니다.'}{' '}
            {model.seconds ? `${model.seconds}초` : '서버 종료 확인 중'}
          </p>
          {model.canAccept && (
            <button
              disabled={pending || model.seconds === 0}
              onClick={() =>
                send({ type: 'EXCHANGE_ACCEPT', payload: { exchangeId: exchange.exchangeId } })
              }
            >
              수락 · E
            </button>
          )}
          <button
            className="quiet"
            onClick={() =>
              send({ type: 'EXCHANGE_CANCEL', payload: { exchangeId: exchange.exchangeId } })
            }
          >
            교환 취소
          </button>
        </>
      ) : (
        <>
          <label htmlFor="exchange-target">가시 아군</label>
          <select
            id="exchange-target"
            value={model.selected ?? ''}
            onChange={(e) => onSelect(e.target.value)}
            disabled={!model.candidates.length || pending}
          >
            {!model.candidates.length && <option value="">주변 아군 없음</option>}
            {model.candidates.map((p, i) => (
              <option key={p.id} value={p.id}>
                아군 {i + 1} · ({p.cell.x}, {p.cell.y})
              </option>
            ))}
          </select>
          <button
            disabled={!model.canRequest || !model.selected || pending}
            onClick={() =>
              model.selected &&
              send({ type: 'EXCHANGE_REQUEST', payload: { targetPlayerId: model.selected } })
            }
          >
            교환 요청 · E
          </button>
          {pending && <p role="status">서버의 교환 상태를 확인하고 있습니다.</p>}
        </>
      )}
      <p>교환이 완료되면 서버에서 받은 지도에 반영됩니다.</p>
    </section>
  );
}
