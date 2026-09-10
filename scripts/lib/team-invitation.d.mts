export function issueTeamInvitation(
  input: {
    baseUrl: string;
    publicUrl: string;
    opsToken: string;
    cookie?: string;
    expiresAt: number;
    roomCode?: string;
  },
  fetcher?: typeof fetch,
): Promise<{ url: string; expiresAt: number; mode: 'join' | 'create' }>;
