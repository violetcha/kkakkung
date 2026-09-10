// F-10 / QA-06 G1-C Cloud half. Runs only through scripts/run-cloud-check.mjs with a preflight
// that allows QA-06. Plan: a close, standing pair; microphone unpublish → publish (new SID),
// LocalTrack.replaceTrack (same SID), and one participant's full reconnect while five keep their
// receiver generation; the observed SDK event order is recorded and compared with the server's
// media-bindings. Needs the F-02 probe harness in a browser: BLOCKED until it exists.
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';
import { requireCloudPreflight } from './CloudPreflight.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const preflight = requireCloudPreflight('QA-06', process.env, Date.now(), root);

it(`QA-06 G1-C in Cloud (${preflight.namespace})`, () => {
  throw new Error(
    'BLOCKED: QA06_PROBE_HARNESS_NOT_DELIVERED (F-02 / QA-01). Local regression: tests/contracts/g1-c.test.ts; real SID/replaceTrack observation remains unverified.',
  );
});
