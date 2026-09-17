// F-18 / QA-12 Cloud case. Started only by scripts/run-media-load.mjs --stages 10
// --duration-seconds 900 --scenario integrated-v0.0.8 through run-cloud-check with a preflight
// that allows QA-12 and covers 900 + 300 participant-minutes. Plan: tests/load/TenRoomSchedule.ts
// segments (connect / movement / republish / rematch), windows.json per minute with tags, then
// scripts/summarize-integrated-load.mjs.
//
// The F-02 probe harness is delivered and its pool reaches the sixty contexts this case needs
// (tests/cloud/LoadProbePool.ts, MAX_LOAD_PROBES). Still missing: the stage driver QA-11 needs,
// and a QA-11 five-room pass before ten rooms may be opened. BLOCKED, never a fake pass.
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';
import { requireCloudPreflight } from './CloudPreflight.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const preflight = requireCloudPreflight('QA-12', process.env, Date.now(), root);
if (preflight.maxRooms < 10 || preflight.maxParticipants < 60)
  throw new Error('QA12_PREFLIGHT_NEEDS_TEN_ROOMS_SIXTY_PARTICIPANTS');

it(`QA-12 ten-room integrated run in Cloud (${preflight.namespace})`, () => {
  throw new Error(
    'BLOCKED: QA12_STAGE_DRIVER_NOT_DELIVERED and QA-11 not passed. Probe harness: tests/cloud/LoadProbePool.ts (F-02). Schedule and judgement: tests/load/TenRoomSchedule.ts.',
  );
});
