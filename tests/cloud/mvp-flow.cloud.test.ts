// F-15 / QA-09 browser-assisted flow (Cloud case). Started only by scripts/run-cloud-check.mjs
// with a preflight that allows QA-09. It would drive the F-02 probe harness browsers through
// invite → permissions → calibration → practice → countdown → round → result → rematch as a
// reproducible auxiliary trace. It never replaces the manual six-device record
// (tests/fixtures/manual-six-device.md) and can never make G5 PASS on its own. The harness has
// not been delivered: BLOCKED, never a fake pass.
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';
import { requireCloudPreflight } from './CloudPreflight.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const preflight = requireCloudPreflight('QA-09', process.env, Date.now(), root);
if (preflight.maxParticipants < 6) throw new Error('QA09_PREFLIGHT_NEEDS_SIX_PARTICIPANTS');

it(`QA-09 browser-assisted MVP flow (${preflight.namespace})`, () => {
  throw new Error(
    'BLOCKED: QA09_PROBE_HARNESS_NOT_DELIVERED (F-02 / QA-01). G5 is judged from the manual record via scripts/collect-six-device-results.mjs, not from this file.',
  );
});
