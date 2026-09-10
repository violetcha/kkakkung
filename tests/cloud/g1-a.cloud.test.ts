// F-08 / QA-03 G1-A Cloud half. Runs only through scripts/run-cloud-check.mjs with a preflight
// that allows QA-03. Plan: two synthetic participants in one namespace room, an allow (v10) whose
// UpdateSubscriptions response is delayed by a proxy, a deny (v11) queued behind it, and a direct
// setSubscribed(true) attempt from the denied receiver. The browser side of this case is the F-02
// probe harness (QA-01), which has not been delivered yet, so the case is BLOCKED rather than
// reported as passed on the adapter alone.
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';
import { requireCloudPreflight } from './CloudPreflight.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const preflight = requireCloudPreflight('QA-03', process.env, Date.now(), root);

it(`QA-03 G1-A in Cloud (${preflight.namespace})`, () => {
  throw new Error(
    'BLOCKED: QA03_PROBE_HARNESS_NOT_DELIVERED (F-02 / QA-01). The local adapter regression is tests/contracts/g1-a.test.ts; it is not Cloud evidence.',
  );
});
