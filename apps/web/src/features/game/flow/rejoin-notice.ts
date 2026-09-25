/**
 * S15P21C204-391. 경기 중 연결이 끊겼을 때의 안내. 서버는 끊긴 사람의 자리를 25초 비워 두고
 * (MATCH_REJOIN_GRACE_MS) 그 사람의 캐릭터는 그 자리에 멈춘다. 돌아오지 않으면 전처럼 경기가 무효다.
 */
export const REJOIN_GRACE_SECONDS = 25;

export function rejoinNotice(input: {
  reconnecting?: boolean;
  phase?: string | null;
  selfId: string;
  players?: readonly { playerId: string; nickname: string; connected: boolean }[];
}): string | null {
  if (input.reconnecting)
    return `연결이 끊겨 다시 연결하는 중입니다. ${REJOIN_GRACE_SECONDS}초 안에 돌아오면 경기를 이어 갑니다.`;
  if (input.phase !== 'PLAYING') return null;
  const away = (input.players ?? [])
    .filter((player) => player.playerId !== input.selfId && !player.connected)
    .map((player) => player.nickname);
  if (away.length === 0) return null;
  return `${away.join(', ')}님의 연결이 끊겨 돌아오기를 기다립니다. ${REJOIN_GRACE_SECONDS}초 안에 돌아오지 않으면 경기가 무효 처리됩니다.`;
}
