// F-11 / QA-05 G1-B Cloud half. Runs only through scripts/run-cloud-check.mjs with a preflight
// that allows QA-05. Plan: a runner-owned test server container with a persistent operations
// volume, three token states (PREPARED never joined, Cloud-refreshed token via Room.engine
// tokenRefreshed, already left), SIGKILL of that container while browsers stay up, restart on the
// same volume, then reconnection attempts with each kept token against the real Cloud. Needs the
// F-02 probe harness in browsers and a runner-owned container: BLOCKED until both exist.
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';
import { requireCloudPreflight } from './CloudPreflight.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const preflight = requireCloudPreflight('QA-05', process.env, Date.now(), root);

it(`QA-05 G1-B in Cloud (${preflight.namespace})`, () => {
  throw new Error(
    'BLOCKED: QA05_PROBE_HARNESS_NOT_DELIVERED (F-02 / QA-01). Local regression: tests/contracts/recovery-fixtures.test.ts; token rejection by Cloud remains unverified.',
  );
});
