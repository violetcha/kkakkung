import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createLayoutSelector,
  createTemplateVariants,
  matchCore,
  preparePracticeLayout,
  validateTemplate,
  validateTuning,
  type MatchState,
} from '@kkakkung/game-core/match';
import type { ProductProfile } from '../bootstrap.js';
import type { AppConfig } from '../config/env.js';
import { loadRuntimeEvidence } from '../config/RuntimeEvidence.js';
import { createMediaCoordinator } from '../media/MediaCoordinator.js';
import { createOperatorAuth } from '../operations/OperatorAuth.js';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    throw new Error('PRODUCT_CONTENT_UNAVAILABLE');
  }
}

/** Real producer assembly. It never turns missing Cloud evidence into admission or readiness. */
export async function loadProductProfile(config: AppConfig): Promise<ProductProfile<MatchState>> {
  const content = resolve(repositoryRoot, config.contentDir);
  const tuning = validateTuning(await readJson(resolve(repositoryRoot, config.tuningPath)));
  if (!tuning.ok) throw new Error('INVALID_PRODUCT_TUNING');
  const masterPath = resolve(content, 'maps/master-v1.json');
  const master = await readJson(masterPath);
  if (
    typeof master !== 'object' ||
    master === null ||
    !('templateId' in master) ||
    typeof master.templateId !== 'string' ||
    !('templateVersion' in master) ||
    typeof master.templateVersion !== 'string'
  )
    throw new Error('INVALID_PRODUCT_MAP_SOURCE');
  const admission = config.admission;
  const cloud = config.livekit;
  const cloudConfigured = Boolean(
    config.mediaMode === 'livekit' &&
    cloud?.projectAlias &&
    config.officialBudgetMaxAgeMs &&
    config.operationTimeoutMs &&
    config.mediaApiLimits,
  );
  const runtimeEvidence =
    cloudConfigured && cloud?.projectAlias
      ? await loadRuntimeEvidence({
          opsDataDir: resolve(repositoryRoot, config.opsDataDir),
          projectAlias: cloud.projectAlias,
          namespace: config.namespace,
          nowEpochMs: Date.now,
          maxAgeMs: config.officialBudgetMaxAgeMs!,
        })
      : null;
  return {
    strictProduct: true,
    maxRooms: config.maxRooms,
    inviteMaxTtlMs: admission?.inviteMaxTtlMs ?? null,
    publicWindow: config.publicWindow,
    sessionAttempts: admission
      ? {
          windowMs: admission.sessionAttemptWindowMs,
          perInvite: admission.sessionAttemptsPerInvite,
          perIp: admission.sessionAttemptsPerIp,
        }
      : null,
    roomIdleTtlMs: admission?.roomIdleTtlMs ?? null,
    trustProxy: config.trustProxyHops === 1,
    opsToken: config.opsToken,
    createOperatorAuth,
    closeResources: runtimeEvidence?.close,
    createMediaCoordinator: cloudConfigured
      ? (deps) =>
          createMediaCoordinator(
            {
              ...deps,
              enqueueBindings: (playerId, message) =>
                deps.enqueueBindings(playerId, {
                  ...message,
                  participants: message.participants.map((participant) => ({ ...participant })),
                }),
              enqueueAudioPolicy: (playerId, { publisherPermissions, ...message }) =>
                deps.enqueueAudioPolicy(playerId, {
                  ...message,
                  voices: message.voices.map((voice) => ({ ...voice })),
                  effects: message.effects.map((effect) => ({ ...effect })),
                  ...(publisherPermissions
                    ? {
                        publisherPermissions: publisherPermissions.map((entry) => ({
                          participantIdentity: entry.participantIdentity,
                          allowedTrackSids: [...entry.allowedTrackSids],
                        })),
                      }
                    : {}),
                }),
            },
            {
              namespaceOwnershipConfirmed: runtimeEvidence?.namespaceOwnershipConfirmed,
              firstInstallationConfirmed: runtimeEvidence?.firstInstallationConfirmed,
              firstAuditConfirmed: runtimeEvidence?.firstAuditConfirmed,
              getOfficialRevision: runtimeEvidence?.getOfficialRevision,
              mediaMode: () => 'cloud',
              productSecurityReady: () => deps.config.productSecurityReady,
            },
          )
      : null,
    mediaConfig:
      cloudConfigured && cloud?.projectAlias
        ? {
            ...cloud,
            projectAlias: cloud.projectAlias,
            namespace: config.namespace,
            opsDataDir: resolve(repositoryRoot, config.opsDataDir),
            publicWindow: config.publicWindow,
            officialBudgetMaxAgeMs: config.officialBudgetMaxAgeMs!,
            operationTimeoutMs: config.operationTimeoutMs!,
            subscriptionMode: config.subscriptionMode,
            initialBudget: null,
            maxConcurrentParticipants: config.maxSlots,
            ...config.mediaApiLimits!,
          }
        : null,
    core: matchCore,
    tuning: tuning.template.match,
    practice: {
      port: { preparePracticeLayout },
      raw: await readJson(resolve(content, 'maps/practice-v1.json')),
    },
    layouts: {
      maps: { validateTemplate, createTemplateVariants },
      selection: createLayoutSelector({
        layout: tuning.template.layout,
        selection: tuning.template.selection,
      }),
      masterPath,
      fallbackPath: resolve(content, 'placements/master-v1-fallback.json'),
      templateId: master.templateId,
      templateVersion: master.templateVersion,
    },
    assetVersion: config.assetVersion,
  };
}
