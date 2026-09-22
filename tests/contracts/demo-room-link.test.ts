// The operator demo link (S15P21C204-258). The point of this test is the round trip: the address
// `scripts/lib/demo-room.mjs` builds is parsed back by the real web consumer, so the fragment
// format cannot drift on one side only. The route constant and the response schema come from the
// protocol package, so a server-side rename fails here rather than at the demo.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { openDemoRoom } from '../../scripts/lib/demo-room.mjs';
import {
  DEMO_ROOM_ROUTE,
  demoRoomResponseSchema,
} from '../../packages/protocol/src/game-messages/session.js';
import { PRODUCT_PROTOCOL_VERSION } from '../../packages/protocol/src/version.js';
import { consumeDemoSession } from '../../apps/web/src/features/room/product-session.js';

const input = () => ({
  baseUrl: 'http://127.0.0.1:2567',
  publicUrl: 'http://127.0.0.1:5173',
  opsToken: 'synthetic-operator',
  role: 'runner' as const,
  protocolVersion: PRODUCT_PROTOCOL_VERSION,
});

const body = (over: Record<string, unknown> = {}) => ({
  sessionToken: 'synthetic-session-token',
  playerId: 'operator-1',
  roomCode: 'ABCDEF',
  role: 'runner',
  expiresAt: Date.now() + 600_000,
  protocolVersion: PRODUCT_PROTOCOL_VERSION,
  entryFragment: '#demo=synthetic-session-token&room=ABCDEF&player=operator-1',
  ...over,
});

const ok = (over: Record<string, unknown> = {}) =>
  vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify(body(over)), { status: 201 }));

describe('operator demo room link', () => {
  it('posts the real operator route and returns an address the web entry accepts', async () => {
    const request = input();
    const fetcher = ok();
    const result = await openDemoRoom(request, fetcher);

    expect(fetcher.mock.calls[0]![0]).toBe(request.baseUrl + DEMO_ROOM_ROUTE);
    const init = fetcher.mock.calls[0]![1]!;
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ role: 'runner' });
    // The token travels in the header only; it is never a query parameter or a body field.
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer synthetic-operator');
    expect(result.url).not.toContain('synthetic-operator');

    // Round trip: the real page consumer must recognise the fragment this script produced.
    const url = new URL(result.url);
    expect(url.pathname).toBe('/play');
    const replaceState = vi.fn();
    const session = consumeDemoSession(
      { hash: url.hash, pathname: url.pathname, search: url.search },
      { replaceState },
    );
    expect(session).toMatchObject({
      sessionToken: 'synthetic-session-token',
      playerId: 'operator-1',
      roomCode: 'ABCDEF',
      protocolVersion: PRODUCT_PROTOCOL_VERSION,
    });
    // The page clears the fragment so the session does not stay in history.
    expect(replaceState).toHaveBeenCalledWith(null, '', '/play');
  });

  it('sends the nickname only when one was given, and keeps the chosen role', async () => {
    const fetcher = ok({ role: 'tagger' });
    const result = await openDemoRoom(
      { ...input(), role: 'tagger', nickname: '심사 시연' },
      fetcher,
    );
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toEqual({
      role: 'tagger',
      nickname: '심사 시연',
    });
    expect(result.role).toBe('tagger');
  });

  it('marks a loopback target printable and a remote one not', async () => {
    expect((await openDemoRoom(input(), ok())).printable).toBe(true);
    const remote = await openDemoRoom(
      { ...input(), baseUrl: 'https://team.example', publicUrl: 'https://team.example' },
      ok(),
    );
    expect(remote.printable).toBe(false);
  });

  it('refuses inputs that would leak or misdirect the session', async () => {
    const fetcher = ok();
    // Deliberately wrong shapes, so the overrides are widened before they reach the library.
    const cases: Record<string, unknown>[] = [
      { role: 'spectator' },
      { opsToken: '' },
      // Plain HTTP is only for a service the operator runs themselves.
      { baseUrl: 'http://team.example', publicUrl: 'http://team.example' },
      // A public HTTPS page must not be handed a session issued by a local server.
      { publicUrl: 'https://team.example' },
      { baseUrl: 'http://user:pass@127.0.0.1:2567' },
      { baseUrl: 'http://127.0.0.1:2567/api' },
    ];
    for (const over of cases)
      await expect(
        openDemoRoom({ ...input(), ...over } as Parameters<typeof openDemoRoom>[0], fetcher),
      ).rejects.toThrow('DEMO_INPUT_INVALID');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refuses a rejected request, a malformed answer and a mismatched protocol', async () => {
    for (const status of [401, 503, 200])
      await expect(
        openDemoRoom(
          input(),
          vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status })),
        ),
      ).rejects.toThrow(`DEMO_ROOM_REJECTED:${status}`);

    for (const over of [
      { roomCode: 'ABC' },
      { roomCode: 'ABCDEI' }, // I is not in the room-code alphabet
      { sessionToken: '' },
      { playerId: '' },
      { role: 'tagger' }, // not the role that was asked for
      { expiresAt: Date.now() - 1 },
      { entryFragment: 'demo=x&room=ABCDEF&player=y' },
    ])
      await expect(openDemoRoom(input(), ok(over))).rejects.toThrow('DEMO_RESPONSE_INVALID');

    await expect(openDemoRoom(input(), ok({ protocolVersion: '0.1.0' }))).rejects.toThrow(
      'DEMO_PROTOCOL_MISMATCH',
    );
  });

  it('accepts exactly what the server promises to send', () => {
    // If the server response schema gains a required field, this fixture stops parsing and the
    // library above has to learn about it.
    expect(demoRoomResponseSchema.safeParse(body()).success).toBe(true);
  });
});

// S15P21C204-312. 역할을 빼먹으면 서버까지 가서 일반 실패로 돌아왔다. 방을 열기 전에 막는다.
describe('open-demo command', () => {
  it('refuses a missing role before it opens a room, and says which flag to give', () => {
    const run = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('../../scripts/open-demo.mjs', import.meta.url)),
        // 닫힌 포트다. 요청을 보냈다면 연결 오류가 났을 것이다.
        '--base-url',
        'http://127.0.0.1:1',
        '--public-url',
        'http://127.0.0.1:5173',
      ],
      { encoding: 'utf8', env: { ...process.env, OPS_TOKEN: 'unused' } },
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(
      'DEMO_ROOM_FAILED (ROLE_REQUIRED): give --role runner or --role tagger.',
    );
  });
});
