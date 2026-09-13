/** Server-side invitation contract (EXEC-CONTRACT-3). Never exported to the browser protocol. */
export const INVITATION_ROUTES = {
  issue: '/api/operations/invitations',
  revoke: '/api/operations/invitations/:inviteId/revoke',
} as const;

export type InvitationScope = Readonly<{
  allowCreate: boolean;
  roomCodes: readonly string[];
}>;
export type IssueInvitation = Readonly<{ scope: InvitationScope; expiresAt: number }>;
export type IssuedInvitation = IssueInvitation &
  Readonly<{ inviteId: string; inviteToken: string }>;
export type InvitationDenialCode = 'INVALID_INVITATION' | 'NOT_READY' | 'OUTSIDE_PUBLIC_WINDOW';
export type InvitationIssueResult =
  | Readonly<{ status: 'issued'; invitation: IssuedInvitation }>
  | Readonly<{ status: 'rejected'; code: InvitationDenialCode }>;
export type InvitationCheck = Readonly<{ inviteToken: string }> &
  ({ createRoom: true; roomCode?: never } | { createRoom: false; roomCode: string });

export interface InvitationPort {
  issue(input: IssueInvitation): InvitationIssueResult;
  revoke(inviteId: string): void;
  verify(input: InvitationCheck): Readonly<{ inviteId: string; expiresAt?: number }> | null;
  bindCreatedRoom(inviteId: string, roomCode: string): void;
}

/** Stored metadata only: token hash, scope, expiry and revocation. The raw token is never kept. */
export type InviteRecord = {
  inviteId: string;
  tokenHash: Buffer;
  allowCreate: boolean;
  roomCodes: Set<string>;
  createdRooms: Set<string>;
  expiresAt: number;
  revoked: boolean;
};
