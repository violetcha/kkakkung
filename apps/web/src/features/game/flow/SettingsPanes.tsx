// S15P21C204-295. 설정 창의 갈래 내용. 홈과 게임 안이 같은 줄을 본다.
// 저장소는 하나(home-settings)다. 다만 즉시 저장은 홈 옵션과 혼자 연습뿐이다. 방 안 설정(Esc)의
// 화면·소리 변경은 그 판의 runtime 값만 바꿀 뿐 home-settings 에 쓰지 않아 다음 입장에 이어지지
// 않는다.
import type { ReactNode } from 'react';
import type { Role } from '@kkakkung/protocol/game-schema';
import type { HomeSettings } from '../../room/home-settings';
import type { QualityPreset } from '../scene/quality-presets';

/**
 * 접히는 상자로 쓰이던 화면이 설정 창 안으로 들어올 때 쓴다. 창은 갈래 이름이 이미 제목이라
 * 같은 제목을 한 번 더 두지 않는다(`bare`).
 */
export function PanelSection({
  bare,
  open,
  title,
  children,
}: {
  bare: boolean;
  open: boolean;
  title: string;
  children: ReactNode;
}) {
  if (bare) return <div className="panel-section">{children}</div>;
  return (
    <details open={open}>
      <summary>{title}</summary>
      {children}
    </details>
  );
}

/** 몸 동작은 역할과 상관없다. 마지막 한 줄만 역할에 따라 바뀐다. */
const MOTION_GUIDE = [
  ['몸을 앞으로', '한 칸 전진'],
  ['몸을 뒤로', '한 칸 후진'],
  ['고개를 왼쪽·오른쪽으로 (20°)', '제자리에서 90° 회전'],
  ['중립으로 돌아오기', '다음 동작 받을 준비'],
] as const;
const KEY_GUIDE = [
  [['W', 'S'], '앞뒤 한 칸 이동'],
  [['A', 'D'], '제자리에서 90° 회전'],
  [['Esc'], '설정 열고 닫기'],
] as const;

export function ControlsPane({
  role,
  mode,
  onKeyboard,
  status,
}: {
  /** 모르면 두 역할을 다 보여 준다(홈). */
  role?: Role | null;
  mode?: 'keyboard' | 'motion';
  onKeyboard?: () => void;
  status?: ReactNode;
}) {
  const roleRows =
    role === 'tagger'
      ? [['손바닥 펴기 · 브이', '손바닥은 지도 교환, 브이는 장비 설치'] as const]
      : role === 'runner'
        ? [['손바닥 펴기', '옆의 동료에게 지도 교환 요청·수락'] as const]
        : ([
            ['손바닥 펴기', '도망자 · 지도 교환 요청·수락'],
            ['브이', '술래 · 장비 설치'],
          ] as const);
  const roleKeys =
    role === 'tagger'
      ? ([[['1', '2', 'F'], '감지기·덫 고르고 설치·취소']] as const)
      : role === 'runner'
        ? ([[['E'], '지도 교환·탈출 도전 (앞에 있을 때만)']] as const)
        : ([
            [['1', '2', 'F'], '술래 · 감지기·덫 고르고 설치·취소'],
            [['E'], '도망자 · 지도 교환·탈출 도전'],
          ] as const);
  return (
    <>
      <h3>몸으로 움직이기</h3>
      <dl className="pause-keys pause-motion">
        {[...MOTION_GUIDE, ...roleRows].map(([move, what]) => (
          <div key={move}>
            <dt>{move}</dt>
            <dd>{what}</dd>
          </div>
        ))}
      </dl>
      <p className="pause-note">
        한 번 움직인 뒤에는 중립으로 돌아와야 다음 동작을 받아요. 고개를 돌린 채 두면 계속 돌지 않고
        한 번만 90° 돕니다. 어깨와 얼굴이 카메라 안에 있어야 하고, 자세가 바뀌었으면 카메라 · 장치
        갈래에서 중립을 다시 맞춰 주세요.
      </p>
      <h3 className="pause-subhead">카메라를 못 쓸 때</h3>
      <p className="pause-note">
        키보드는 카메라가 없거나 추적이 끊겼을 때 쓰는 대체 조작이에요. 경기의 기본 조작은 위의 몸
        동작입니다.
      </p>
      <dl className="pause-keys">
        {[...KEY_GUIDE, ...roleKeys].map(([keys, what]) => (
          <div key={what}>
            <dt>
              {keys.map((cap) => (
                <kbd key={cap}>{cap}</kbd>
              ))}
            </dt>
            <dd>{what}</dd>
          </div>
        ))}
      </dl>
      {mode && (
        <p className="pause-mode">
          현재 조작 <strong>{mode === 'keyboard' ? '키보드' : '얼굴·상체 모션'}</strong>
          {mode === 'motion' && onKeyboard && (
            <button type="button" onClick={onKeyboard}>
              키보드로 바꾸기
            </button>
          )}
        </p>
      )}
      {status && (
        <p className="pause-note" role="status">
          {status}
        </p>
      )}
    </>
  );
}

/** 화면 갈래. 값은 저장소에 바로 쓰이고, 게임 안이면 런타임에도 즉시 적용된다. */
export function DisplayPane({
  settings,
  onChange,
  debugOverlay,
  onDebugOverlay,
  applied,
}: {
  settings: HomeSettings;
  onChange(patch: Partial<HomeSettings>): void;
  debugOverlay: boolean;
  onDebugOverlay(value: boolean): void;
  /** 지금 바꾼 값이 언제 적용되는지 한 줄. */
  applied: string;
}) {
  return (
    <>
      <h3>화면</h3>
      <dl className="settings-rows">
        <div>
          <dt>화면 품질</dt>
          <dd>
            <select
              aria-label="화면 품질"
              value={settings.quality}
              onChange={(event) => onChange({ quality: event.target.value as QualityPreset })}
            >
              <option value="medium">기본</option>
              <option value="low">가볍게 · 저사양 PC</option>
            </select>
          </dd>
        </div>
        <div>
          <dt>배경 움직임 · 조명 깜빡임</dt>
          <dd>
            <label className="settings-check">
              <input
                type="checkbox"
                aria-label="배경 움직임 · 조명 깜빡임"
                checked={settings.backgroundMotion}
                onChange={(event) => onChange({ backgroundMotion: event.target.checked })}
              />
            </label>
          </dd>
        </div>
        <div>
          <dt>
            추적 디버그 오버레이 <small>Ctrl+Shift+D</small>
          </dt>
          <dd>
            <label className="settings-check">
              <input
                type="checkbox"
                aria-label="추적 디버그 오버레이"
                checked={debugOverlay}
                onChange={(event) => onDebugOverlay(event.target.checked)}
              />
            </label>
          </dd>
        </div>
      </dl>
      <p className="pause-note">{applied}</p>
    </>
  );
}

/**
 * 소리 갈래. 음량·전체 끄기는 저장소의 값이고 어디서 바꾸든 같은 곳에 쓰인다.
 * 마이크 입력과 확인음은 살아 있는 장치가 있어야 하므로 게임 안에서만 live 로 덧붙인다.
 */
export function SoundPane({
  settings,
  onChange,
  live,
}: {
  settings: HomeSettings;
  onChange(patch: Partial<HomeSettings>): void;
  live?: ReactNode;
}) {
  return (
    <>
      <h3>소리</h3>
      <dl className="settings-rows">
        <div>
          <dt>
            듣는 음량 <small>{Math.round(settings.volume * 100)}%</small>
          </dt>
          <dd>
            <input
              type="range"
              aria-label="듣는 음량"
              min={0}
              max={100}
              step={1}
              value={Math.round(settings.volume * 100)}
              disabled={settings.muted}
              style={
                { '--range-fill': `${Math.round(settings.volume * 100)}%` } as React.CSSProperties
              }
              onChange={(event) => onChange({ volume: Number(event.target.value) / 100 })}
            />
          </dd>
        </div>
        <div>
          <dt>모든 소리 끄기</dt>
          <dd>
            <label className="settings-check">
              <input
                type="checkbox"
                aria-label="모든 소리 끄기"
                checked={settings.muted}
                onChange={(event) => onChange({ muted: event.target.checked })}
              />
            </label>
          </dd>
        </div>
      </dl>
      {live}
    </>
  );
}
