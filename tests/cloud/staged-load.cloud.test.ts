// F-17 / QA-11 Cloud case. Started only by scripts/run-media-load.mjs --stages 1,3,5 through
// run-cloud-check with a preflight that allows QA-11 and names stageDurationSeconds. Plan: 1→3→5
// rooms of six real WebRTC synthetic tracks plus game input (QA-10 runner), audibility walks
// 5→6→7→6→5 cells, one generation change per stage, and evaluateMediaStage on each interval.
// The browser side is the F-02 probe harness, not delivered yet: BLOCKED, never a fake pass.
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';
import { requireCloudPreflight } from './CloudPreflight.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const preflight = requireCloudPreflight('QA-11', process.env, Date.now(), root);
if (!preflight.stageDurationSeconds) throw new Error('QA11_STAGE_DURATIONS_MISSING');

it(`QA-11 staged real-media load in Cloud (${preflight.namespace})`, () => {
  throw new Error(
    'BLOCKED: QA11_PROBE_HARNESS_NOT_DELIVERED (F-02 / QA-01). Plan and judgement: tests/load/MediaLoadScenario.ts; game-only stages: QA-10.',
  );
});
