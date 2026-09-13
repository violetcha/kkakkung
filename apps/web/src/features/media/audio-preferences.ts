export type AudioPreferences = Readonly<{
  volume: number;
  muted: boolean;
  mutedPlayerIds: readonly string[];
}>;
export const DEFAULT_AUDIO_PREFERENCES: AudioPreferences = Object.freeze({
  volume: 0.7,
  muted: false,
  mutedPlayerIds: Object.freeze([] as string[]),
});
export const unitGain = (value: number) =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
export function normalizeAudioPreferences(value: AudioPreferences): AudioPreferences {
  return Object.freeze({
    volume: unitGain(value.volume),
    muted: value.muted !== false,
    mutedPlayerIds: Object.freeze(
      [
        ...new Set(
          value.mutedPlayerIds.filter(
            (id) => typeof id === 'string' && id.length > 0 && id.length <= 128,
          ),
        ),
      ].slice(0, 6),
    ),
  });
}
export type LocalAudioStatus = Readonly<{
  preferences: AudioPreferences;
  microphoneLevel: number | null;
  testTonePlaying: boolean;
}>;
export type TestToneResult = 'played' | 'unavailable' | 'muted';
