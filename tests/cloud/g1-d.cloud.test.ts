// F-09 / QA-04 G1-D Cloud half. Runs only through scripts/run-cloud-check.mjs with a preflight
// that allows QA-04. Plan: an allowed request in flight, the same identity personally ended,
// RemoveParticipant and the late allow settled in both orders against the real Cloud, then a
// reconnect with the old JWT kept only in browser memory and a direct setSubscribed(true). The
// browser side is the F-02 probe harness, not delivered yet: BLOCKED, never a fake pass.
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';
import { requireCloudPreflight } from './CloudPreflight.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const preflight = requireCloudPreflight('QA-04', process.env, Date.now(), root);

it(`QA-04 G1-D in Cloud (${preflight.namespace})`, () => {
  throw new Error(
    'BLOCKED: QA04_PROBE_HARNESS_NOT_DELIVERED (F-02 / QA-01). Local regression: tests/contracts/g1-d.test.ts; Cloud token rejection and setSubscribed refusal remain unverified.',
  );
});
