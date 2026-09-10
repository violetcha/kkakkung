import { useState } from 'react';
import { viewFixture, roundFixture } from '../features/room/product-fixture';
import { EquipmentHud } from '../features/game/equipment/EquipmentHud';
import { RestraintHud } from '../features/game/equipment/RestraintHud';
import { ExchangePanel } from '../features/game/map/ExchangePanel';
import { PoseChallenge } from '../features/game/pose/PoseChallenge';
import { KeyChallenge } from '../features/game/pose/KeyChallenge';
import { advanceKey, challengeKeys } from '../features/game/pose/key-challenge';
import { PracticeScreen } from '../features/game/flow/PracticeScreen';
import { INITIAL_DEVICES } from '../features/game/flow/device-readiness';
import { WorldCanvas } from '../features/game/scene/WorldCanvas';
import { MiniMap } from '../features/game/map/MiniMap';
import type { CommandInput } from '../features/room/command-lifecycle';
const noSensors = () => null;
export function WorkflowPreview({ screen }: { screen: string }) {
  const [selected, setSelected] = useState<'sensor' | 'trap'>('sensor');
  const [index, setIndex] = useState(0);
  const [intent, setIntent] = useState('아직 요청 없음');
  const base = viewFixture();
  if (base.self?.status !== 'ACTIVE') return null;
  const challenge = {
    challengeId: 'preview',
    exitId: 'exit',
    poseKind: 'left' as const,
    startedAtTick: 0,
    minSuccessTick: 40,
    expiresAtTick: 160,
  };
  const view = {
    ...base,
    self: {
      ...base.self,
      role: screen === '장비' ? ('tagger' as const) : ('runner' as const),
      equipment: { sensor: 2, trap: 1 },
      restraintUntilTick: screen === '장비' ? 120 : null,
      exchange:
        screen === '교환'
          ? {
              exchangeId: 'preview-exchange',
              fromPlayerId: 'ally',
              toPlayerId: 'self',
              direction: 'incoming' as const,
              expiresAtTick: 140,
            }
          : null,
      challenge: screen === '포즈' ? challenge : null,
    },
  };
  const send = (command: CommandInput) =>
    setIntent(`합성 요청: ${command.type} · 서버 상태는 변경하지 않음`);
  return (
    <>
      <div className="game-workspace">
        <section className="product-stage">
          <div className="product-canvas">
            <WorldCanvas view={view} />
          </div>
          <MiniMap view={view} />
        </section>
        {screen === '장비' && (
          <>
            <EquipmentHud
              view={view}
              tick={100}
              selected={selected}
              onSelect={setSelected}
              send={send}
            />
            <RestraintHud view={view} tick={100} />
          </>
        )}
        {screen === '교환' && (
          <ExchangePanel view={view} tick={100} selected={null} onSelect={() => {}} send={send} />
        )}
        {screen === '포즈' && (
          <PoseChallenge view={view} tick={100} progress={0.5} starting={false} send={send} />
        )}
        {screen === '키 도전' && (
          <KeyChallenge
            challenge={challenge}
            tick={100}
            index={index}
            onKey={(key, repeat) =>
              setIndex((value) =>
                advanceKey(challengeKeys(challenge.challengeId), value, key, repeat),
              )
            }
            onCancel={() => {
              setIndex(0);
              setIntent('합성 취소 버튼 확인');
            }}
          />
        )}
        {screen === '연습' && (
          <PracticeScreen
            round={roundFixture({ phase: 'TEAM_PRACTICE' })}
            view={{
              ...view,
              gameScope: { kind: 'practice', gameInstanceId: 'practice', revision: 1 },
            }}
            devices={INITIAL_DEVICES}
            readyReported={false}
            readSensors={noSensors}
            onReady={() => {}}
          />
        )}
      </div>
      <p role="status">{intent}</p>
    </>
  );
}
