import type { CSSProperties } from 'react';
import { PanelSection } from './SettingsPanes';
import { useEffect, useId, useState } from 'react';
import type {
  AudioPreferences,
  LocalAudioStatus,
  TestToneResult,
} from '../../media/audio-preferences';
import { MAX_BGM_VOLUME } from '../../media/match-bgm';

type Participant = Readonly<{ playerId: string; nickname: string }>;
export function AudioControls({
  readStatus,
  onPreferences,
  onTestTone,
  participants = [],
  canTestTone,
  compact = false,
  bare = false,
  sections = 'all',
  bgm,
}: {
  readStatus(): LocalAudioStatus | null;
  onPreferences(preferences: AudioPreferences): void;
  onTestTone(): Promise<TestToneResult>;
  participants?: readonly Participant[];
  canTestTone: boolean;
  compact?: boolean;
  /** 설정 창 안에서는 접는 상자 없이 내용만 둔다. 갈래 이름이 이미 제목이다. */
  bare?: boolean;
  /**
   * S15P21C204-295. 'live' 는 살아 있는 장치가 있어야 하는 것(마이크 입력·확인음·참가자별 끄기)만
   * 그린다. 음량과 전체 끄기는 설정 창이 저장소와 함께 맡으므로 같은 줄이 두 번 나오지 않는다.
   */
  sections?: 'all' | 'live';
  /** 경기 배경음 음량. 방 안에서만 준다. 없으면 줄을 그리지 않는다. */
  bgm?: Readonly<{ read(): number | null; change(value: number): void }>;
}) {
  const [status, setStatus] = useState<LocalAudioStatus | null>(readStatus);
  const [bgmVolume, setBgmVolume] = useState<number | null>(() => bgm?.read() ?? null);
  const [feedback, setFeedback] = useState('');
  const [testing, setTesting] = useState(false);
  const id = useId();
  useEffect(() => {
    const refresh = () => {
      setStatus(readStatus());
      setBgmVolume(bgm?.read() ?? null);
    };
    refresh();
    const timer = window.setInterval(refresh, 100);
    return () => window.clearInterval(timer);
  }, [readStatus, bgm]);
  const preferences = status?.preferences;
  if (!preferences) return null;
  const change = (patch: Partial<AudioPreferences>) => {
    const current = readStatus()?.preferences;
    if (!current) return;
    onPreferences({ ...current, ...patch });
    setStatus(readStatus());
  };
  return (
    <aside className="audio-controls" aria-label="소리 설정">
      <PanelSection bare={bare} open={!compact} title="소리 점검 · 음량">
        {sections === 'all' && (
          <>
            <label htmlFor={id}>
              듣는 음량 <output>{Math.round(preferences.volume * 100)}%</output>
            </label>
            {/* S15P21C204-295. 채워진 구간을 CSS 가 그릴 수 있게 값 자체를 변수로 넘긴다. */}
            <input
              id={id}
              type="range"
              min="0"
              max="100"
              step="1"
              value={Math.round(preferences.volume * 100)}
              style={
                { '--range-fill': `${Math.round(preferences.volume * 100)}%` } as CSSProperties
              }
              onChange={(event) => change({ volume: Number(event.currentTarget.value) / 100 })}
            />
            <label className="audio-toggle">
              <input
                type="checkbox"
                checked={preferences.muted}
                onChange={(event) => change({ muted: event.currentTarget.checked })}
              />
              모든 소리 끄기
            </label>
            {bgm && bgmVolume !== null && (
              <>
                <label htmlFor={id + '-bgm'}>
                  배경음 음량 <output>{Math.round(bgmVolume * 100)}%</output>
                </label>
                <input
                  id={id + '-bgm'}
                  type="range"
                  min="0"
                  max={MAX_BGM_VOLUME * 100}
                  step="1"
                  value={Math.round(bgmVolume * 100)}
                  style={
                    {
                      '--range-fill': `${Math.round((bgmVolume / MAX_BGM_VOLUME) * 100)}%`,
                    } as CSSProperties
                  }
                  onChange={(event) => {
                    bgm.change(Number(event.currentTarget.value) / 100);
                    setBgmVolume(bgm.read());
                  }}
                />
                <small>경기 중에만 나옵니다. 100%가 기본이고 최대 300%입니다.</small>
              </>
            )}
          </>
        )}
        <div className="microphone-level">
          <label htmlFor={id + '-microphone'}>마이크 입력 크기</label>
          <meter
            id={id + '-microphone'}
            min={0}
            max={1}
            value={status.microphoneLevel ?? 0}
            aria-valuetext={
              status.microphoneLevel === null
                ? '마이크 점검 대기'
                : Math.round(status.microphoneLevel * 100) + '%'
            }
          />
          <small>
            {status.microphoneLevel === null
              ? '마이크를 연결하고 이 화면에서 말해 보세요.'
              : '말할 때 막대가 움직이는지 확인하세요.'}
          </small>
        </div>
        {canTestTone && (
          <button
            disabled={testing || status.testTonePlaying}
            onClick={() => {
              setTesting(true);
              void onTestTone()
                .then((result) =>
                  setFeedback(
                    result === 'played'
                      ? '짧은 확인음이 재생됐습니다. 소리가 들리는지 확인해 주세요.'
                      : result === 'muted'
                        ? '전체 음소거를 해제하고 음량을 올려 주세요.'
                        : '소리를 열지 못했습니다. 브라우저의 출력 장치를 확인하고 다시 눌러 주세요.',
                  ),
                )
                .catch(() => setFeedback('소리 점검을 마치지 못했습니다. 다시 눌러 주세요.'))
                .finally(() => setTesting(false));
            }}
          >
            확인음 듣기
          </button>
        )}
        {feedback && <p role="status">{feedback}</p>}
        {participants.length > 0 && (
          <fieldset>
            <legend>내게 들리는 친구 목소리</legend>
            {participants.map((player) => (
              <label className="audio-toggle" key={player.playerId}>
                <input
                  type="checkbox"
                  checked={preferences.mutedPlayerIds.includes(player.playerId)}
                  onChange={(event) => {
                    const current = readStatus()?.preferences;
                    if (!current) return;
                    change({
                      mutedPlayerIds: event.currentTarget.checked
                        ? [...current.mutedPlayerIds, player.playerId]
                        : current.mutedPlayerIds.filter((id) => id !== player.playerId),
                    });
                  }}
                />
                {player.nickname} 목소리 끄기
              </label>
            ))}
            <small>내가 듣는 소리에만 적용됩니다.</small>
          </fieldset>
        )}
      </PanelSection>
    </aside>
  );
}
