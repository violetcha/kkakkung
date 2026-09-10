// Type surface of scripts/run-media-load.mjs for tests/load/media-load.test.ts.
import type { MediaScenario } from '../tests/load/MediaLoadScenario.ts';
export type MediaCaseSelection =
  | Readonly<{ case: 'QA-11'; stages: [1, 3, 5]; error?: undefined }>
  | Readonly<{ case: 'QA-12'; stages: [10]; error?: undefined }>
  | Readonly<{ error: string; case?: undefined }>;
export function selectMediaCase(
  args: Readonly<{ stages?: string; durationSeconds?: string | number; scenario?: string }>,
): MediaCaseSelection;
export function planMediaLoad(
  selected: Readonly<{ case: 'QA-11' | 'QA-12' }>,
  preflight: Record<string, unknown> &
    Readonly<{
      remainingMinutes: number;
      remainingBytes: number;
      budgetReservation: { participantMinutes: number; bytes: number };
      maxRooms: number;
      maxParticipants: number;
      maxDurationSeconds: number;
      cleanupAllowanceSeconds: number;
      stageDurationSeconds?: Record<'1' | '3' | '5', number>;
    }>,
):
  | Readonly<{ ok: true; plan: MediaScenario | Record<string, unknown>; reason?: undefined }>
  | Readonly<{ ok: false; reason: string; plan?: undefined }>;
