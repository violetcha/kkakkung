import type { EquipmentKind, PrivateView } from '@kkakkung/protocol/game-schema';
import type { CommandInput, RequestDisplay } from '../../room/command-lifecycle';
import { equipmentPresenter } from './equipment-presenter';

/** 감지기는 벽 상자(▣), 덫은 바닥 지지대(▲). 3D 형상과 같은 구분이다. */
const KIND_GLYPH = { sensor: '▣', trap: '▲' } as const;
const KIND_LABEL = { sensor: '감지기', trap: '덫' } as const;
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
          <button
            key={kind}
            data-kind={kind}
            aria-pressed={selected === kind}
            onClick={() => onSelect(kind)}
          >
            {i + 1} · {KIND_GLYPH[kind]} {KIND_LABEL[kind]} {model.remaining[kind]}개
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
          {pending ? '서버 확인 중…' : `${KIND_GLYPH[selected]} ${KIND_LABEL[selected]} 설치`}
        </button>
      )}
      {model.owned.length > 0 && (
        <details>
          <summary>내가 설치한 장비 {model.owned.length}개</summary>
          <ul>
            {model.owned.map((item) => {
              const [state, glyph, label] =
                item.state === 'SPENT'
                  ? (['spent', '×', '소모됨'] as const)
                  : item.state === 'ARMED'
                    ? (['armed', '●', '무장됨'] as const)
                    : (['pending', '○', `무장 대기 ${item.armSeconds.toFixed(1)}초`] as const);
              return (
                <li key={item.equipmentId} data-state={state}>
                  {glyph} {KIND_LABEL[item.kind]} · ({item.cell.x}, {item.cell.y}) · {label}
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </section>
  );
}
