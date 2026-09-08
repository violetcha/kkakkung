/**
 * High-entropy limited-publication invitations. Tokens are 32 random bytes (base64url) that
 * are distinct from room codes; the store keeps only a SHA-256 digest compared in constant
 * time. Revoked, expired, unknown and out-of-scope tokens all produce the same null rejection.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type {
  InvitationCheck,
  InvitationIssueResult,
  InvitationPort,
  InviteRecord,
  IssueInvitation,
} from './invite-types.js';

export type InviteStoreOptions = Readonly<{
  /** Epoch milliseconds. */
  now: () => number;
  /** F configuration `inviteMaxTtlMs`; null means the operations profile is not configured. */
  maxTtlMs: number | null;
  /** Approved public window in epoch ms; null locks issuance. */
  publicWindow: Readonly<{ opensAtEpochMs: number; closesAtEpochMs: number }> | null;
  /** Room codes the server currently knows. Invitations may only reference these. */
  knownRoomCodes: () => ReadonlySet<string>;
  /** Operations gate: issuance requires readiness READY and admission OPEN. */
  operationsReady: () => boolean;
}>;

export function hashInviteToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export class InviteStore implements InvitationPort {
  private readonly records = new Map<string, InviteRecord>();

  constructor(private readonly options: InviteStoreOptions) {}

  get size() {
    return this.records.size;
  }

  issue(input: IssueInvitation): InvitationIssueResult {
    const now = this.options.now();
    if (!this.options.operationsReady() || this.options.maxTtlMs === null)
      return { status: 'rejected', code: 'NOT_READY' };
    const window = this.options.publicWindow;
    if (!window || now < window.opensAtEpochMs || input.expiresAt > window.closesAtEpochMs)
      return { status: 'rejected', code: 'OUTSIDE_PUBLIC_WINDOW' };
    if (
      !Number.isSafeInteger(input.expiresAt) ||
      input.expiresAt <= now ||
      input.expiresAt > now + this.options.maxTtlMs
    )
      return { status: 'rejected', code: 'INVALID_INVITATION' };
    const codes = new Set(input.scope.roomCodes);
    if (codes.size !== input.scope.roomCodes.length)
      return { status: 'rejected', code: 'INVALID_INVITATION' };
    if (!input.scope.allowCreate && codes.size === 0)
      return { status: 'rejected', code: 'INVALID_INVITATION' };
    const known = this.options.knownRoomCodes();
    for (const code of codes)
      if (!known.has(code)) return { status: 'rejected', code: 'INVALID_INVITATION' };
    const inviteToken = randomBytes(32).toString('base64url');
    const record: InviteRecord = {
      inviteId: randomUUID(),
      tokenHash: hashInviteToken(inviteToken),
      allowCreate: input.scope.allowCreate,
      roomCodes: codes,
      createdRooms: new Set(),
      expiresAt: input.expiresAt,
      revoked: false,
    };
    this.records.set(record.inviteId, record);
    return {
      status: 'issued',
      invitation: {
        inviteId: record.inviteId,
        inviteToken,
        scope: { allowCreate: record.allowCreate, roomCodes: [...codes] },
        expiresAt: record.expiresAt,
      },
    };
  }

  /** Idempotent: unknown or already revoked ids are accepted silently. */
  revoke(inviteId: string): void {
    const record = this.records.get(inviteId);
    if (record) record.revoked = true;
  }

  verify(input: InvitationCheck): Readonly<{ inviteId: string }> | null {
    const record = this.findByToken(input.inviteToken);
    if (!record || record.revoked || this.options.now() >= record.expiresAt) return null;
    if (input.createRoom) return record.allowCreate ? { inviteId: record.inviteId } : null;
    const allowed = record.roomCodes.has(input.roomCode) || record.createdRooms.has(input.roomCode);
    return allowed ? { inviteId: record.inviteId } : null;
  }

  bindCreatedRoom(inviteId: string, roomCode: string): void {
    const record = this.records.get(inviteId);
    if (record) record.createdRooms.add(roomCode);
  }

  /** Room cleanup: no invitation may admit players to a closed room again. */
  forgetRoom(roomCode: string) {
    for (const record of this.records.values()) {
      record.roomCodes.delete(roomCode);
      record.createdRooms.delete(roomCode);
    }
  }

  /** Metadata without secrets, for tests and operator diagnostics. */
  describe(inviteId: string) {
    const record = this.records.get(inviteId);
    return record
      ? {
          inviteId,
          allowCreate: record.allowCreate,
          roomCodes: [...record.roomCodes],
          createdRooms: [...record.createdRooms],
          expiresAt: record.expiresAt,
          revoked: record.revoked,
        }
      : null;
  }

  private findByToken(token: string): InviteRecord | null {
    if (typeof token !== 'string' || token.length === 0 || token.length > 512) return null;
    const digest = hashInviteToken(token);
    let found: InviteRecord | null = null;
    // Compare against every record so timing does not reveal which digest matched.
    for (const record of this.records.values()) {
      if (timingSafeEqual(record.tokenHash, digest)) found = record;
    }
    return found;
  }
}
