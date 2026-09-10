/** Issue one scoped invitation. Tokens are returned only to the caller's private output file. */
export async function issueTeamInvitation(input, fetcher = fetch) {
  const origin = new URL(input.baseUrl);
  const publicOrigin = new URL(input.publicUrl);
  if (
    publicOrigin.protocol !== 'https:' ||
    publicOrigin.origin !== input.publicUrl ||
    origin.origin !== input.baseUrl ||
    origin.username ||
    origin.password ||
    !(
      (origin.protocol === 'https:' && origin.origin === publicOrigin.origin) ||
      (origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))
    ) ||
    !input.opsToken ||
    !Number.isSafeInteger(input.expiresAt) ||
    input.expiresAt <= Date.now() ||
    (input.roomCode && !/^[A-HJ-NP-Z2-9]{6}$/.test(input.roomCode))
  )
    throw new Error('INVITATION_INPUT_INVALID');
  const response = await fetcher(input.baseUrl + '/api/operations/invitations', {
    method: 'POST',
    redirect: 'error',
    signal: globalThis.AbortSignal.timeout(15000),
    headers: {
      authorization: `Bearer ${input.opsToken}`,
      'content-type': 'application/json',
      ...(input.cookie ? { cookie: input.cookie } : {}),
    },
    body: JSON.stringify({
      scope: { allowCreate: !input.roomCode, roomCodes: input.roomCode ? [input.roomCode] : [] },
      expiresAt: input.expiresAt,
    }),
  });
  if (response.status !== 201) throw new Error('INVITATION_REJECTED');
  const body = await response.json();
  if (
    typeof body.inviteToken !== 'string' ||
    !/^[A-Za-z0-9_-]{16,512}$/.test(body.inviteToken) ||
    !Number.isSafeInteger(body.expiresAt) ||
    body.expiresAt <= Date.now() ||
    body.expiresAt > input.expiresAt
  )
    throw new Error('INVITATION_RESPONSE_INVALID');
  const link = new URL('/play', input.publicUrl);
  const hash = new globalThis.URLSearchParams({ invite: body.inviteToken });
  if (input.roomCode) hash.set('room', input.roomCode);
  link.hash = hash.toString();
  return { url: link.href, expiresAt: body.expiresAt, mode: input.roomCode ? 'join' : 'create' };
}
