import { Client, type Room } from '@colyseus/sdk';
import { ROOM_NAME, PROTOCOL_VERSION } from '@kkakkung/protocol/version';
import type { SandboxState } from '@kkakkung/protocol/schema';
import type { GameState } from '@kkakkung/protocol/game-schema';

const configuredApiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
const configuredServerUrl = (import.meta.env.VITE_COLYSEUS_URL as string | undefined)?.trim();
const apiBase = configuredApiBase?.replace(/\/$/, '') || '/api';
const serverUrl =
  configuredServerUrl?.replace(/\/$/, '') ||
  (import.meta.env.DEV ? 'ws://127.0.0.1:2567' : window.location.origin);

export async function createDevSession(
  nickname: string,
): Promise<{ token: string; expiresAt: number }> {
  const response = await fetch(`${apiBase}/dev-sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nickname }),
  });
  const body = (await response.json().catch(() => null)) as {
    token?: string;
    expiresAt?: number;
    message?: string;
  } | null;
  if (
    !response.ok ||
    !body?.token ||
    typeof body.expiresAt !== 'number' ||
    !Number.isFinite(body.expiresAt)
  ) {
    throw new Error(body?.message ?? '개발 세션을 만들 수 없습니다.');
  }
  return { token: body.token, expiresAt: body.expiresAt };
}

export function joinSandbox(token: string): Promise<Room<unknown, SandboxState>> {
  return new Client(serverUrl).joinOrCreate<SandboxState>(ROOM_NAME, {
    token,
    protocolVersion: PROTOCOL_VERSION,
  });
}

export function joinTeamRoom(token: string): Promise<Room<unknown, GameState>> {
  return new Client(serverUrl).joinOrCreate<GameState>('kkakkung', {
    token,
    protocolVersion: PROTOCOL_VERSION,
  });
}
