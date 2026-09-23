/** Product logical session bound to an invitation and a room. Nicknames are never identity keys. */
export type ProductSession = {
  sessionId: string;
  playerId: string;
  tokenHash: Buffer;
  inviteId: string;
  /**
   * 팀 SSO 로 받은 세션의 계정 키(해시). 한 계정이 서비스 전체에서 자리 하나만 갖게 세는 데만
   * 쓴다(S15P21C204-366). SSO 신원이 없으면 null 이다.
   */
  account: string | null;
  roomCode: string;
  nickname: string;
  /** Epoch ms. */
  issuedAt: number;
  /** Epoch ms; extended by real activity up to the lease limit. */
  expiresAt: number;
  /** First connection deadline only. Cleared after a successful claim. */
  admissionExpiresAt: number | null;
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
