/**
 * Open one operator demo room (S15P21C204-258) and build the address the operator pastes.
 *
 * The room is only reachable through the operations token, so the answer carries a live session:
 * the caller decides where it may be written, and this module never logs or stores it.
 */

/** Room codes leave out I, O, 0 and 1; the server generates them from the same alphabet. */
const ROOM_CODE = /^[A-HJ-NP-Z2-9]{6}$/;
const ROLES = new Set(['runner', 'tagger']);

/** True for an origin the operator is running themselves, where plain HTTP is not a downgrade. */
export function isLoopback(origin) {
  return ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
}

export async function openDemoRoom(input, fetcher = fetch) {
  const origin = new URL(input.baseUrl);
  const publicOrigin = new URL(input.publicUrl);
  if (
    origin.origin !== input.baseUrl ||
    publicOrigin.origin !== input.publicUrl ||
    origin.username ||
    origin.password ||
    !(
      (origin.protocol === 'https:' && publicOrigin.protocol === 'https:') ||
      (isLoopback(origin) && isLoopback(publicOrigin))
    ) ||
    !input.opsToken ||
    !ROLES.has(input.role) ||
    (input.nickname !== undefined && (typeof input.nickname !== 'string' || !input.nickname))
  )
    throw new Error('DEMO_INPUT_INVALID');

  const response = await fetcher(input.baseUrl + '/api/operations/demo-rooms', {
    method: 'POST',
    redirect: 'error',
    signal: globalThis.AbortSignal.timeout(15000),
    headers: {
      authorization: `Bearer ${input.opsToken}`,
      'content-type': 'application/json',
      ...(input.cookie ? { cookie: input.cookie } : {}),
    },
    body: JSON.stringify({
      role: input.role,
      ...(input.nickname ? { nickname: input.nickname } : {}),
    }),
  });
  // 401 is a wrong or missing token. 503 is two different situations the operator fixes in two
  // different ways, so the server's own code is carried out rather than a guess: DEMO_UNAVAILABLE
  // means the deployment did not enable demo rooms, CAPACITY means the room budget is used up.
  if (response.status !== 201) {
    const code = await response
      .json()
      .then((error) => (typeof error?.error === 'string' ? error.error : null))
      .catch(() => null);
    throw new Error(`DEMO_ROOM_REJECTED:${response.status}${code ? ':' + code : ''}`);
  }
  const body = await response.json();
  if (
    typeof body.sessionToken !== 'string' ||
    !body.sessionToken ||
    typeof body.playerId !== 'string' ||
    !body.playerId ||
    typeof body.roomCode !== 'string' ||
    !ROOM_CODE.test(body.roomCode) ||
    body.role !== input.role ||
    !Number.isSafeInteger(body.expiresAt) ||
    body.expiresAt <= Date.now() ||
    typeof body.entryFragment !== 'string' ||
    !body.entryFragment.startsWith('#')
  )
    throw new Error('DEMO_RESPONSE_INVALID');
  // A server built from a different protocol would hand out a session the page refuses on open,
  // which looks like a broken demo minutes before it is shown. Fail here instead.
  if (input.protocolVersion !== undefined && body.protocolVersion !== input.protocolVersion)
    throw new Error('DEMO_PROTOCOL_MISMATCH');

  const link = new URL('/play', input.publicUrl);
  link.hash = body.entryFragment.slice(1);
  return {
    url: link.href,
    roomCode: body.roomCode,
    role: body.role,
    playerId: body.playerId,
    expiresAt: body.expiresAt,
    /** Printing the address to a terminal is only safe when the operator owns both ends. */
    printable: isLoopback(publicOrigin),
  };
}
