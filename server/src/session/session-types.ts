/** Product logical session bound to an invitation and a room. Nicknames are never identity keys. */
export type ProductSession = {
  sessionId: string;
  playerId: string;
  tokenHash: Buffer;
  inviteId: string;
  roomCode: string;
  nickname: string;
  /** Epoch ms. */
  issuedAt: number;
  /** Epoch ms; extended by real activity up to the lease limit. */
  expiresAt: number;
  /** Colyseus sessionId currently holding this logical session, or null. */
  activeConnectionId: string | null;
  invalidated: boolean;
};

export type SessionAuth = Readonly<{
  sessionId: string;
  playerId: string;
  roomCode: string;
  nickname: string;
  inviteId: string;
}>;
