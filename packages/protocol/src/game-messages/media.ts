/**
 * Media HTTP/WS wire contracts shared by the web client (D/C) and the server (B routes, E
 * producer). Scope identifiers here are media identities; they never replace gameScope.
 */
import { z } from 'zod';

const idSchema = z.string().min(1).max(128);
const generation = z.number().int().nonnegative().safe();
const revision = z.number().int().nonnegative().safe();

export const mediaScopeSchema = z.strictObject({
  matchId: idSchema,
  mediaInstanceId: idSchema,
  receiverGeneration: generation,
});
export type MediaScope = z.infer<typeof mediaScopeSchema>;

export const mediaBindingSchema = z.strictObject({
  playerId: idSchema,
  publisherGeneration: generation,
  mediaIdentity: idSchema,
  participantSid: idSchema,
  faceTrackSid: idSchema.optional(),
  audioTrackSid: idSchema.optional(),
});
export const mediaBindingsSchema = mediaScopeSchema.extend({
  bindingRevision: revision,
  participants: z.array(mediaBindingSchema).max(6),
});
export type MediaBindings = z.infer<typeof mediaBindingsSchema>;

const gainSchema = z.number().finite().min(0).max(1);
export const audioPolicySchema = mediaScopeSchema.extend({
  policyRevision: revision,
  bindingRevision: revision,
  stateVersion: revision,
  voices: z.array(
    z.strictObject({
      playerId: idSchema,
      trackSid: idSchema,
      gain: gainSchema,
      azimuthRad: z.number().finite(),
      lowpassHz: z.number().finite().positive(),
    }),
  ),
  effects: z.array(
    z.strictObject({
      eventId: idSchema,
      kind: z.enum(['footstep', 'sensor', 'trap']),
      gain: gainSchema,
      azimuthRad: z.number().finite(),
      lowpassHz: z.number().finite().positive(),
      tick: revision,
    }),
  ),
});
export type AudioPolicy = z.infer<typeof audioPolicySchema>;

export const mediaGrantRequestSchema = z.strictObject({
  matchId: idSchema,
  purpose: z.enum(['practice', 'game']),
  previousReceiverGeneration: generation.optional(),
});
export type MediaGrantRequest = z.infer<typeof mediaGrantRequestSchema>;

export const mediaGrantSchema = mediaScopeSchema.extend({
  url: z.string().min(1),
  token: z.string().min(1),
  roomName: z.string().min(1),
  mediaIdentity: idSchema,
  /** Epoch seconds. */
  expiresAt: z.number().int().positive().safe(),
});
export type MediaGrant = z.infer<typeof mediaGrantSchema>;

export const mediaStatusReportSchema = mediaScopeSchema.extend({
  status: z.enum(['ready', 'recovering', 'failed', 'closed']),
});
export type MediaStatusReport = z.infer<typeof mediaStatusReportSchema>;

export const mediaRefreshRequestSchema = mediaScopeSchema.extend({
  lastBindingRevision: revision,
});
export type MediaRefreshRequest = z.infer<typeof mediaRefreshRequestSchema>;

export const MEDIA_ROUTES = {
  grants: '/api/media/grants',
  report: '/api/media/report',
  webhook: '/api/livekit/webhook',
} as const;
