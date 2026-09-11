import { resolve } from 'node:path';
import { parseConfig } from './env.js';
import { loadRuntimeEvidence } from './RuntimeEvidence.js';
import { loadCapabilityReport } from '../media/CloudCapabilityProbe.js';
import { readOfficialUsageInput } from '../operations/UsageCheckpoint.js';

/** Read-only deployment preparation: never creates attestations, budget, or first-use markers. */
export async function checkProductDeployment(input: {
  env: Record<string, string | undefined>;
  baseUrl: string;
  evidenceDir: string;
  nowEpochMs: number;
}) {
  const failures: string[] = [];
  if (!/^https:\/\/[a-z0-9.-]+$/.test(input.baseUrl))
    return { status: 'BLOCKED' as const, failures: ['PUBLIC_ORIGIN_INVALID'] };
  let config;
  try {
    config = parseConfig({
      ...input.env,
      NODE_ENV: 'development',
      SERVER_PROFILE: 'product',
      MEDIA_MODE: 'livekit',
      TRUST_PROXY_HOPS: '1',
      ALLOWED_ORIGINS: input.baseUrl,
      SERVICE_NAMESPACE: input.env.SERVICE_NAMESPACE || 'kkakkung-ec2',
      MAX_ROOMS: '1',
      MAX_SLOTS: '6',
    });
  } catch {
    return { status: 'BLOCKED' as const, failures: ['PRODUCT_ENV_INVALID'] };
  }
  if (!config.livekit?.projectAlias || !config.officialBudgetMaxAgeMs || !config.publicWindow)
    return { status: 'BLOCKED' as const, failures: ['PRODUCT_POLICY_MISSING'] };
  if (
    input.nowEpochMs < config.publicWindow.opensAtEpochMs ||
    input.nowEpochMs + 330_000 >= config.publicWindow.closesAtEpochMs
  )
    failures.push('PUBLIC_WINDOW_TOO_SHORT');
  const options = {
    subscriptionMode: config.subscriptionMode,
    opsDataDir: resolve(input.evidenceDir),
    projectAlias: config.livekit.projectAlias,
    namespace: config.namespace,
    nowEpochMs: input.nowEpochMs,
    maxAgeMs: config.officialBudgetMaxAgeMs,
  };
  const capability = await loadCapabilityReport(options);
  if (capability.status !== 'supported') failures.push(...capability.reasons);
  const evidence = await loadRuntimeEvidence({
    ...options,
    nowEpochMs: () => input.nowEpochMs,
  });
  try {
    if (!evidence.namespaceOwnershipConfirmed()) failures.push('RUNTIME_EVIDENCE_INVALID');
    try {
      const official = await readOfficialUsageInput(options.opsDataDir, options);
      if (!evidence.getOfficialRevision(official)) failures.push('OFFICIAL_EVIDENCE_MISMATCH');
    } catch {
      failures.push('OFFICIAL_USAGE_INVALID');
    }
  } finally {
    await evidence.close();
  }
  return { status: failures.length ? ('BLOCKED' as const) : ('PREPARED' as const), failures };
}
