import type { PreparationIssue } from '@kkakkung/protocol/game-schema';

/** Map internal diagnostics to an allowlist; paths, identities and exceptions stay private. */
export function preparationIssue(diagnostic: string | null): PreparationIssue | undefined {
  if (!diagnostic) return undefined;
  if (diagnostic === 'NOT_READY') return 'SERVICE_NOT_READY';
  if (diagnostic === 'LOADING_TIMEOUT') return 'DEVICE_LOADING_TIMEOUT';
  if (diagnostic === 'PRACTICE_MEDIA_NOT_READY') return 'MEDIA_NOT_READY';
  if (diagnostic.startsWith('LAYOUT:') || diagnostic.startsWith('PRACTICE_LAYOUT:'))
    return 'LAYOUT_UNAVAILABLE';
  return 'PREPARATION_UNAVAILABLE';
}
