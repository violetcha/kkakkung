// Synthetic validation fixtures only, never evidence of physical devices or Cloud success.
import { REQUIRED_COVERAGE } from '../../scripts/collect-six-device-results.mjs';

export const SHA = 'a'.repeat(40);
export const deviceIds = ['dev-1', 'dev-2', 'dev-3', 'dev-4', 'dev-5', 'dev-6'];

export function devices(
  over: (d: Record<string, unknown>, i: number) => Record<string, unknown> = (d) => d,
) {
  return {
    sourceCommit: SHA,
    network: { kind: 'campus-wifi-6e', measured: 'RTT 12ms / 210 Mbps down / 95 Mbps up' },
    devices: deviceIds.map((deviceId, i) =>
      over(
        {
          deviceId,
          realDevice: true,
          model: 'Samsung Galaxy Book 960XGL',
          os: 'Windows 11 Enterprise 26200',
          browser: 'Chrome 152.0.7977',
          camera: 'Intel AVStream',
          preset: i < 4 ? 'mid' : 'low',
          participant: `P${i + 1}`,
          verifiedAt: '2026-09-11T09:50:00+09:00',
        },
        i,
      ),
    ),
  };
}

export const perDevice = (over: Partial<Record<string, unknown>> = {}) =>
  Object.fromEntries(
    deviceIds.map((id, i) => [
      id,
      {
        fpsAvg: i < 4 ? 52 : 34,
        fpsMin: i < 4 ? 41 : 28,
        remoteFaces: 2,
        cameraReady: true,
        microphonePermission: i === 5 ? 'denied' : 'granted',
        ...(i === 5 ? { micDeniedAction: 'map-exchange' } : {}),
        nearVoice: true,
        audioDuplicate: false,
        playbackPermission: 'granted',
        afterEnd: { tracks: 0, workers: 1, textures: 12, rooms: 0 },
        ...over,
      },
    ]),
  );

/** Five matches whose coverage together spans every required behaviour. */
export function matches(
  patch: (m: Record<string, unknown>, order: number) => Record<string, unknown> = (m) => m,
) {
  const chunks = [
    REQUIRED_COVERAGE.slice(0, 5),
    REQUIRED_COVERAGE.slice(5, 10),
    REQUIRED_COVERAGE.slice(10, 15),
    REQUIRED_COVERAGE.slice(15, 20),
    REQUIRED_COVERAGE.slice(20),
  ];
  return {
    sourceCommit: SHA,
    matches: chunks.map((coverage, i) =>
      patch(
        {
          matchId: `match-${i + 1}`,
          order: i + 1,
          sourceCommit: SHA,
          startedAt: `2026-09-11T10:${10 + i * 5}:00+09:00`,
          endedAt: `2026-09-11T10:${13 + i * 5}:20+09:00`,
          result: ['two-captured', 'two-escaped', 'timeout', 'two-captured', 'two-escaped'][i],
          rematch: ['same', 'swap', 'lobby', 'same', 'none'][i],
          coverage,
          devices: perDevice(),
          mediaChecks: deviceIds.flatMap((receiverDeviceId, receiverIndex) =>
            ['video', 'audio'].map((kind) => ({
              receiverDeviceId,
              senderDeviceId: receiverIndex === 0 ? 'dev-2' : 'dev-1',
              kind,
              allowed: true,
              observed: true,
              observedAt: `2026-09-11T10:${11 + i * 5}:00+09:00`,
            })),
          ),
          failures: [],
        },
        i + 1,
      ),
    ),
  };
}
