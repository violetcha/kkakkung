import type { CloudPreflight } from './CloudPreflight.js';

/** Synthetic encoding ceilings; receiver reservation includes all 30 directed pairs + 25%. */
export const DEPLOYMENT_VIDEO_BITRATE = 150_000;
export const DEPLOYMENT_AUDIO_BITRATE = 32_000;
export const DEPLOYMENT_MIN_RUN_SECONDS = 300;
export const DEPLOYMENT_MIN_CLEANUP_SECONDS = 30;

export function deploymentReservationBytes(durationSeconds: number): number {
  return Math.ceil(
    (6 * 5 * (DEPLOYMENT_VIDEO_BITRATE + DEPLOYMENT_AUDIO_BITRATE) * durationSeconds * 1.25) / 8,
  );
}

/** Must run before any HTTP, SDK, browser or Cloud request. No credentials are accepted here. */
export function validateDeploymentSmokePlan(
  preflight: CloudPreflight,
  deviceManifest: unknown,
  nowEpochMs: number,
): void {
  if (!preflight.allowedCases.includes('DP-06')) throw new Error('DP06_CASE_NOT_APPROVED');
  if (preflight.maxRooms !== 1 || preflight.maxParticipants !== 6)
    throw new Error('DP06_REQUIRES_EXACTLY_ONE_ROOM_SIX_PARTICIPANTS');
  if (
    !Number.isSafeInteger(preflight.maxDurationSeconds) ||
    !Number.isSafeInteger(preflight.cleanupAllowanceSeconds) ||
    preflight.maxDurationSeconds < DEPLOYMENT_MIN_RUN_SECONDS ||
    preflight.cleanupAllowanceSeconds < DEPLOYMENT_MIN_CLEANUP_SECONDS
  )
    throw new Error('DP06_PREPARATION_ROUND_OR_CLEANUP_TIME_INSUFFICIENT');
  const totalSeconds = preflight.maxDurationSeconds + preflight.cleanupAllowanceSeconds;
  if (
    !Number.isSafeInteger(nowEpochMs) ||
    !Number.isSafeInteger(preflight.expiresAtEpochMs) ||
    preflight.expiresAtEpochMs < nowEpochMs + totalSeconds * 1000
  )
    throw new Error('DP06_PREFLIGHT_EXPIRES_BEFORE_CLEANUP');
  if (
    !Number.isFinite(preflight.budgetReservation.participantMinutes) ||
    preflight.budgetReservation.participantMinutes < (6 * totalSeconds) / 60
  )
    throw new Error('DP06_PARTICIPANT_MINUTE_RESERVATION_INSUFFICIENT');
  if (
    !Number.isSafeInteger(preflight.budgetReservation.bytes) ||
    preflight.budgetReservation.bytes < deploymentReservationBytes(totalSeconds)
  )
    throw new Error('DP06_TRANSFER_RESERVATION_INSUFFICIENT');
  if (
    preflight.deviceManifest.mode !== 'synthetic' ||
    typeof deviceManifest !== 'object' ||
    deviceManifest === null ||
    !('mode' in deviceManifest) ||
    deviceManifest.mode !== 'synthetic' ||
    !('participants' in deviceManifest) ||
    !Array.isArray(deviceManifest.participants) ||
    deviceManifest.participants.length !== 6 ||
    !deviceManifest.participants.every(
      (p: unknown) =>
        typeof p === 'object' &&
        p !== null &&
        'video' in p &&
        typeof p.video === 'string' &&
        p.video.length > 0 &&
        'audio' in p &&
        typeof p.audio === 'string' &&
        p.audio.length > 0,
    )
  )
    throw new Error('DP06_SIX_SYNTHETIC_AUDIO_VIDEO_DEVICES_REQUIRED');
}
