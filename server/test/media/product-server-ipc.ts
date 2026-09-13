import { z } from 'zod';
import type { Readiness } from '../../src/game/ports.js';
import { PHASES } from '@kkakkung/protocol/game-schema';
import type { ProductServerProbe } from './product-server-probe.js';
import {
  RUNTIME_EVIDENCE_FAILURES,
  type RuntimeEvidenceDiagnostic,
} from '../../src/config/RuntimeEvidence.js';

// Test-owned IPC only. No HTTP debug route, process environment or runtime clock override.
// Publication messages intentionally omit the grant JWT and all provider credentials.
export const PRODUCT_SERVER_IPC = 'kkakkung-product-integration-v1';
const envelope = { namespace: z.literal(PRODUCT_SERVER_IPC), id: z.number().int().positive() };

/** Node loaders/dependencies may share IPC. Only our namespace enters our strict parser. */
export function isProductServerMessage(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'namespace' in value &&
    value.namespace === PRODUCT_SERVER_IPC
  );
}

export const productServerRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({
    ...envelope,
    action: z.literal('boot'),
    opsToken: z.string().uuid(),
    cpuProfile: z.literal(true).optional(),
    operatingMode: z.enum(['attested', 'continuous']).optional(),
  }),
  z.strictObject({
    ...envelope,
    action: z.literal('inspect'),
    roomCode: z
      .string()
      .regex(/^[A-HJ-NP-Z2-9]{6}$/)
      .optional(),
  }),
  z.strictObject({
    ...envelope,
    action: z.literal('publish'),
    publication: z.strictObject({
      roomName: z.string().min(1).max(256),
      mediaIdentity: z.string().min(1).max(256),
    }),
  }),
  z.strictObject({
    ...envelope,
    action: z.literal('advance'),
    roomCode: z.string().regex(/^[A-HJ-NP-Z2-9]{6}$/),
    ticks: z.number().int().min(1).max(4000),
  }),
  z.strictObject({ ...envelope, action: z.literal('close') }),
]);

export type ProductServerRequest = z.infer<typeof productServerRequestSchema>;
export type ProductServerCommand = ProductServerRequest extends infer Request
  ? Request extends { id: number }
    ? Omit<Request, 'id' | 'namespace'>
    : never
  : never;
export type ProductServerInspection = Readonly<{
  readiness: Readiness | null;
  blockedReason: string | null;
  maxTickMs: number;
  participantCount: number;
  runtimeEvidence: RuntimeEvidenceDiagnostic | null;
  removedIdentityHashes: readonly string[];
  probe: ProductServerProbe;
}>;
export type ProductServerStarted = Readonly<{ port: number; pid: number; strictProduct: boolean }>;
export type ProductServerResult =
  ProductServerInspection | ProductServerStarted | Readonly<{ done: true }>;
export type ProductServerReply =
  | Readonly<{ id: number; ok: true; result: ProductServerResult }>
  | Readonly<{
      id: number;
      ok: false;
      code: 'INVALID_REQUEST' | 'NOT_STARTED' | 'ALREADY_STARTED' | 'REQUEST_FAILED';
    }>;

export const productServerReplySchema = z.discriminatedUnion('ok', [
  z.strictObject({
    namespace: z.literal(PRODUCT_SERVER_IPC),
    id: z.number().int().nonnegative(),
    ok: z.literal(false),
    code: z.enum(['INVALID_REQUEST', 'NOT_STARTED', 'ALREADY_STARTED', 'REQUEST_FAILED']),
  }),
  z.strictObject({
    ...envelope,
    ok: z.literal(true),
    result: z.union([
      z.strictObject({
        port: z.number().int().min(1).max(65535),
        pid: z.number().int().positive(),
        strictProduct: z.boolean(),
      }),
      z.strictObject({ done: z.literal(true) }),
      z.strictObject({
        readiness: z
          .strictObject({
            state: z.enum(['READY', 'RECOVERING', 'LOCKED']),
            reasonCodes: z.array(z.string().max(128)).max(64),
            historyComplete: z.boolean(),
            unresolvedCount: z.number().int().nonnegative(),
          })
          .nullable(),
        blockedReason: z.string().max(512).nullable(),
        maxTickMs: z.number().nonnegative(),
        participantCount: z.number().int().nonnegative(),
        runtimeEvidence: z
          .strictObject({
            reason: z.enum(RUNTIME_EVIDENCE_FAILURES).nullable(),
            firstFailureReason: z.enum(RUNTIME_EVIDENCE_FAILURES).nullable(),
            refreshCount: z.number().int().nonnegative(),
            leaseRecoveryCount: z.number().int().nonnegative(),
            refreshPending: z.boolean(),
            maxRefreshDurationMs: z.number().nonnegative(),
            clockRollbackMs: z.number().int().nonnegative(),
            clockCorrectionCount: z.number().int().nonnegative(),
            maxClockCorrectionMs: z.number().int().nonnegative(),
          })
          .nullable(),
        removedIdentityHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(1000),
        probe: z.strictObject({
          intervalMs: z.literal(10),
          samples: z.number().int().nonnegative(),
          elapsedMs: z.number().nonnegative(),
          cpuUserMs: z.number().nonnegative(),
          cpuSystemMs: z.number().nonnegative(),
          gcCount: z.number().int().nonnegative(),
          gcTotalMs: z.number().nonnegative(),
          gcMaxMs: z.number().nonnegative(),
          gcEntriesDropped: z.number().int().nonnegative(),
          worst: z
            .array(
              z.strictObject({
                fromMs: z.number().nonnegative(),
                toMs: z.number().nonnegative(),
                elapsedMs: z.number().nonnegative(),
                lagMs: z.number().nonnegative(),
                cpuUserMs: z.number().nonnegative(),
                cpuSystemMs: z.number().nonnegative(),
                loopActiveMs: z.number().nonnegative(),
                loopIdleMs: z.number().nonnegative(),
                gcOverlapMs: z.number().nonnegative(),
                phaseBefore: z.enum([...PHASES, 'BOOT', 'NO_ROOM']),
                phaseAfter: z.enum([...PHASES, 'BOOT', 'NO_ROOM']),
              }),
            )
            .max(8),
        }),
      }),
    ]),
  }),
]);
