import { useEffect, useId, useState } from 'react';
import type {
  AudioPreferences,
  LocalAudioStatus,
  TestToneResult,
} from '../../media/audio-preferences';

type Participant = Readonly<{ playerId: string; nickname: string }>;
export function AudioControls({
  readStatus,
  onPreferences,
  onTestTone,
  participants = [],
  canTestTone,
  compact = false,
}: {
  readStatus(): LocalAudioStatus | null;
  onPreferences(preferences: AudioPreferences): void;
  onTestTone(): Promise<TestToneResult>;
  participants?: readonly Participant[];
  canTestTone: boolean;
  compact?: boolean;
}) {
  const [status, setStatus] = useState<LocalAudioStatus | null>(readStatus);
  const [feedback, setFeedback] = useState('');
  const [testing, setTesting] = useState(false);
  const id = useId();
  useEffect(() => {
    const refresh = () => setStatus(readStatus());
    refresh();
    const timer = window.setInterval(refresh, 100);
    return () => window.clearInterval(timer);
  }, [readStatus]);
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
      <details open={!compact}>
        <summary>소리 점검 · 음량</summary>
        <label htmlFor={id}>
          듣는 음량 <output>{Math.round(preferences.volume * 100)}%</output>
        </label>
        <input
          id={id}
          type="range"
          min="0"
          max="100"
          step="1"
          value={Math.round(preferences.volume * 100)}
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
      </details>
    </aside>
  );
}
