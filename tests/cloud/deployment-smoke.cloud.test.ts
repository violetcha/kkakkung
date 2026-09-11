// F-16 / DP-06: actual six C/Colyseus clients and six isolated synthetic LiveKit browsers.
// Only the allowlisted Cloud runner with approved credentials, budget and device plan may run it.
// Synthetic publishing/receiving is deployment smoke, never representative device/G5 acceptance.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { caseTimeoutMs, requireCloudPreflight } from './CloudPreflight.ts';
import { createDeploymentBrowserPool } from './DeploymentBrowserPool.js';
import { runDeploymentSmoke, type DeploymentSmokeReport } from './DeploymentSmokeHarness.js';
import { validateDeploymentSmokePlan } from './DeploymentSmokePlan.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const preflight = requireCloudPreflight('DP-06', process.env, Date.now(), root);
const deviceManifest: unknown = JSON.parse(
  readFileSync(resolve(root, preflight.deviceManifest.path), 'utf8'),
);
validateDeploymentSmokePlan(preflight, deviceManifest, Date.now());
const baseUrl = process.env.SMOKE_BASE_URL ?? '';
const publicBaseUrl = process.env.SMOKE_PUBLIC_BASE_URL ?? '';
const internalToken = process.env.SMOKE_INTERNAL_TOKEN ?? '';
const opsToken = process.env.OPS_TOKEN ?? '';
if (!baseUrl || !publicBaseUrl || !internalToken || !opsToken)
  throw new Error('DP06_TARGET_OR_CREDENTIALS_MISSING');

it(
  'DP-06: six invited clients publish, receive permitted media, play 3600 ticks and retire',
  async () => {
    const startedAtEpochMs = Date.now();
    validateDeploymentSmokePlan(preflight, deviceManifest, startedAtEpochMs);
    let pool: Awaited<ReturnType<typeof createDeploymentBrowserPool>> | undefined;
    let result: DeploymentSmokeReport | undefined;
    try {
      pool = await createDeploymentBrowserPool();
      result = await runDeploymentSmoke({
        mode: 'cloud',
        baseUrl,
        origin: publicBaseUrl,
        publicBaseUrl,
        internalToken,
        cookie: '',
        opsToken,
        preflight,
        deviceManifest,
        startedAtEpochMs,
        createProbe: (playerId) => pool!.create(playerId),
      });
    } finally {
      let browsersClosed = true;
      try {
        await pool?.close();
      } catch {
        browsersClosed = false;
      }
      const withinApprovedDuration =
        Date.now() <=
        startedAtEpochMs +
          (preflight.maxDurationSeconds + preflight.cleanupAllowanceSeconds) * 1000;
      const evidenceDir = resolve(root, preflight.evidenceDir);
      mkdirSync(evidenceDir, { recursive: true });
      // Result is an explicit allowlist of counters/codes; tokens, cookies, IDs and console are absent.
      writeFileSync(
        resolve(evidenceDir, 'deployment-smoke.json'),
        JSON.stringify(
          {
            case: 'DP-06',
            generatedAt: new Date().toISOString(),
            status:
              result?.status === 'PASS' && browsersClosed && withinApprovedDuration
                ? 'PASS'
                : 'FAIL',
            result: result ?? { failureCode: 'DP06_BROWSER_INITIALIZATION_FAILED' },
            browsersClosed,
            withinApprovedDuration,
            deviceAcceptance: 'NOT_RUN',
            authentication: 'LOOPBACK_DEDICATED_KEY',
            ssoLoginAcceptance: 'NOT_RUN',
            note: 'Synthetic Cloud smoke; no camera, gesture, spatial playback or representative device acceptance.',
          },
          null,
          2,
        ) + '\n',
      );
      expect(browsersClosed).toBe(true);
      expect(withinApprovedDuration).toBe(true);
    }
    expect(result?.status, result?.failureCode ?? 'DP06_NO_RESULT').toBe('PASS');
  },
  caseTimeoutMs(preflight),
);
