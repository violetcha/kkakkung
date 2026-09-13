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
  publicWindow:
    | Readonly<{ opensAtEpochMs: number; closesAtEpochMs: number }>
    | Readonly<{ mode: 'continuous' }>
    | null;
  /** Room codes the server currently knows. Invitations may only reference these. */
  knownRoomCodes: () => ReadonlySet<string>;
  /** Operations gate: issuance requires readiness READY and admission OPEN. */
  operationsReady: () => boolean;
  /** Hard memory ceiling. Live invitations are never evicted to make room. */
  maxEntries?: number;
}>;

export function hashInviteToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export class InviteStore implements InvitationPort {
  private readonly records = new Map<string, InviteRecord>();

  private readonly maxEntries: number;

  constructor(private readonly options: InviteStoreOptions) {
    this.maxEntries = options.maxEntries ?? 4096;
    if (!Number.isSafeInteger(this.maxEntries) || this.maxEntries <= 0)
      throw new Error('INVALID_INVITATION_CAPACITY');
  }

  get size() {
    return this.records.size;
  }

  issue(input: IssueInvitation): InvitationIssueResult {
    const now = this.options.now();
    this.prune(now);
    if (!this.options.operationsReady() || this.options.maxTtlMs === null)
      return { status: 'rejected', code: 'NOT_READY' };
    const window = this.options.publicWindow;
    if (
      !window ||
      ('mode' in window
        ? window.mode !== 'continuous'
        : now < window.opensAtEpochMs || input.expiresAt > window.closesAtEpochMs)
    )
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
    if (this.records.size >= this.maxEntries) return { status: 'rejected', code: 'NOT_READY' };
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
    this.records.delete(inviteId);
  }

  verify(input: InvitationCheck): Readonly<{ inviteId: string; expiresAt: number }> | null {
    this.prune(this.options.now());
    const record = this.findByToken(input.inviteToken);
    if (!record || record.revoked || this.options.now() >= record.expiresAt) return null;
    const verified = { inviteId: record.inviteId, expiresAt: record.expiresAt };
    if (input.createRoom) return record.allowCreate ? verified : null;
    const allowed = record.roomCodes.has(input.roomCode) || record.createdRooms.has(input.roomCode);
    return allowed ? verified : null;
  }

  bindCreatedRoom(inviteId: string, roomCode: string): void {
    const record = this.records.get(inviteId);
    if (record) record.createdRooms.add(roomCode);
  }

  /** Room cleanup: no invitation may admit players to a closed room again. */
  forgetRoom(roomCode: string) {
    for (const [id, record] of this.records) {
      record.roomCodes.delete(roomCode);
      record.createdRooms.delete(roomCode);
      if (!record.allowCreate && record.roomCodes.size === 0 && record.createdRooms.size === 0)
        this.records.delete(id);
    }
  }

  prune(now = this.options.now()): void {
    for (const [id, record] of this.records)
      if (record.revoked || now >= record.expiresAt) this.records.delete(id);
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
