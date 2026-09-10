// F-03 / QA-02 Cloud case: the combined-load measurement on a representative device (real GPU
// browser, three models at cadence, R3F, 160×160 10 fps upload, five remote faces), judged by
// tests/cloud/PerformanceScenario.ts and written through tests/cloud/EvidenceWriter.ts. Runs only
// through scripts/run-cloud-check.mjs with a preflight that allows QA-02 and a representative
// device manifest. The D/C facades (VI-01, IN-03/04/05, ME-01) must be driven from a real device
// browser via the F-02 probe harness, which is not yet exercised against Cloud: BLOCKED.
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';
import { requireCloudPreflight } from './CloudPreflight.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const preflight = requireCloudPreflight('QA-02', process.env, Date.now(), root);
if (preflight.deviceManifest.mode !== 'representative')
  throw new Error('QA02_NEEDS_REPRESENTATIVE_DEVICE_MANIFEST');

it(`QA-02 combined-load performance on a representative device (${preflight.namespace})`, () => {
  throw new Error(
    'BLOCKED: QA02_DEVICE_RUN_NOT_PERFORMED (F-02 probe harness unexercised; needs a real-GPU browser on a representative device). Judgement: tests/cloud/PerformanceScenario.ts.',
  );
});
