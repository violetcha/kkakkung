// Type surface of scripts/summarize-integrated-load.mjs for tests/load/integrated-summary.test.ts.
import type { IntegratedInput } from '../tests/load/TenRoomSchedule.ts';
export function loadIntegratedEvidence(
  directory: string,
):
  | Readonly<{ input: IntegratedInput; error?: undefined }>
  | Readonly<{ error: string; input?: undefined }>;
