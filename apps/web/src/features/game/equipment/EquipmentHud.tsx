import type { EquipmentKind, PrivateView } from '@kkakkung/protocol/game-schema';
import type { CommandInput, RequestDisplay } from '../../room/command-lifecycle';
import { equipmentPresenter } from './equipment-presenter';
export function EquipmentHud({
  view,
  tick,
  selected,
  request,
  onSelect,
  send,
}: {
  view: PrivateView;
  tick: number;
  selected: EquipmentKind;
  request?: RequestDisplay;
  onSelect(kind: EquipmentKind): void;
  send(command: CommandInput): unknown;
}) {
  const model = equipmentPresenter(view, tick);
  if (!model) return null;
  const pending = request?.status === 'pending' || request?.status === 'waiting-view';
  return (
    <section className="game-panel" aria-label="술래 장비">
      <h2>장비</h2>
      <div className="actions">
        {(['sensor', 'trap'] as const).map((kind, i) => (
          <button key={kind} aria-pressed={selected === kind} onClick={() => onSelect(kind)}>
            {i + 1} · {kind === 'sensor' ? '감지기' : '덫'} {model.remaining[kind]}개
            {selected === kind ? ' · 선택됨' : ''}
          </button>
        ))}
      </div>
      {model.installation ? (
        <>
          <p>설치 중 · {Math.round(model.progress * 100)}%</p>
          <progress value={model.progress} max={1} aria-label="설치 진행" />
          <button
            onClick={() =>
              send({
                type: 'INSTALL_CANCEL',
                payload: { installationId: model.installation!.installationId },
              })
            }
          >
            설치 취소
          </button>
        </>
      ) : (
        <button
          disabled={pending || model.locked || model.remaining[selected] === 0}
          onClick={() => send({ type: 'INSTALL', payload: { kind: selected } })}
        >
          {pending ? '서버 확인 중…' : `${selected === 'sensor' ? '감지기' : '덫'} 설치`}
        </button>
      )}
      {model.owned.length > 0 && (
        <details>
          <summary>내가 설치한 장비 {model.owned.length}개</summary>
          <ul>
            {model.owned.map((item) => (
              <li key={item.equipmentId}>
                {item.kind === 'sensor' ? '감지기' : '덫'} · ({item.cell.x}, {item.cell.y}) ·{' '}
                {item.state === 'SPENT'
                  ? '소모됨'
                  : item.state === 'ARMED'
                    ? '무장됨'
                    : `무장 대기 ${item.armSeconds.toFixed(1)}초`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
