export function isLoopback(origin: URL): boolean;

export function openDemoRoom(
  input: {
    baseUrl: string;
    publicUrl: string;
    opsToken: string;
    role: 'runner' | 'tagger';
    nickname?: string;
    cookie?: string;
    /** Refuse a server built from a different protocol version when given. */
    protocolVersion?: string;
  },
  fetcher?: typeof fetch,
): Promise<{
  url: string;
  roomCode: string;
  role: 'runner' | 'tagger';
  playerId: string;
  expiresAt: number;
  printable: boolean;
}>;
