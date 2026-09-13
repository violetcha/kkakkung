import { parseCapabilityReport } from '../../src/media/CloudCapabilityProbe.js';
import { SPLIT_AUTHORITY_CHECKS } from '../../src/media/SplitCapability.js';
import { localCapability, practiceFrame } from './generation-fixtures.js';

/** Synthetic local inputs only: never write them to an operating project or call them Cloud evidence. */
export function localSplitCapability(now = Date.now()) {
  return parseCapabilityReport({
    ...localCapability,
    testedAtEpochMs: now,
    subscriptionMode: 'server-forwarding',
    grantProfile: null,
    splitGrantProfile: {
      face: {
        ...localCapability.grantProfile!,
        room: 'synthetic-face',
        canSubscribe: false,
        canPublishSources: ['camera'],
      },
      receiver: {
        ...localCapability.grantProfile!,
        room: 'synthetic-receiver',
        canSubscribe: true,
        canPublishSources: ['microphone'],
      },
    },
    splitAuthorityProof: Object.fromEntries(SPLIT_AUTHORITY_CHECKS.map((key) => [key, true])),
  });
}

export const splitPracticeFrame = {
  ...practiceFrame,
  participants: Array.from({ length: 6 }, (_, index) => ({
    ...practiceFrame.participants[0]!,
    playerId: `p${index}`,
  })),
};
