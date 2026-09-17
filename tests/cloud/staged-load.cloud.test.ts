// F-17 / QA-11 Cloud case. Started only by scripts/run-media-load.mjs --stages 1,3,5 through
// run-cloud-check with a preflight that allows QA-11 and names stageDurationSeconds. Plan: 1→3→5
// rooms of six real WebRTC synthetic tracks plus game input (QA-10 runner), audibility walks
// 5→6→7→6→5 cells, one generation change per stage, and evaluateMediaStage on each interval.
//
// The F-02 probe harness is delivered: tests/cloud/LoadProbePool.ts opens the participants,
// load-probe.ts publishes the marked tracks and decodes the received ones, and MediaObserver
// turns that into allow/deny evidence. What is still missing is the stage driver that puts real
// product sessions in those browsers, walks the participants through 5/6/7 cells and assembles a
// MediaStageInput per interval. Without it there is nothing to judge: BLOCKED, never a fake pass.
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';
import { requireCloudPreflight } from './CloudPreflight.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const preflight = requireCloudPreflight('QA-11', process.env, Date.now(), root);
if (!preflight.stageDurationSeconds) throw new Error('QA11_STAGE_DURATIONS_MISSING');

it(`QA-11 staged real-media load in Cloud (${preflight.namespace})`, () => {
  throw new Error(
    'BLOCKED: QA11_STAGE_DRIVER_NOT_DELIVERED. Probe harness: tests/cloud/LoadProbePool.ts (F-02, local self test in tests/contracts/load-probe-local.test.ts, unverified against Cloud). Plan and judgement: tests/load/MediaLoadScenario.ts; game-only stages: QA-10.',
  );
});
