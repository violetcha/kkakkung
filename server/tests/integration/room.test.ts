import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { PROTOCOL_VERSION, ROOM_NAME } from '@kkakkung/protocol/version';
import type { SandboxState } from '@kkakkung/protocol/schema';
import { createApplication } from '../../src/bootstrap.js';
import { parseConfig } from '../../src/config/env.js';

describe('HTTP session → real Colyseus room → authoritative state', () => {
  const application = createApplication({
    ...parseConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent' }),
    port: 0,
  });
  const rooms: Room<unknown, SandboxState>[] = [];
  let endpoint: string;
  let sdk: Client;
  let firstToken: string;

  async function issue(nickname: string) {
    const response = await fetch(`${endpoint}/api/dev-sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nickname }),
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as { token: string }).token;
  }
  async function join(nickname: string) {
    const token = await issue(nickname);
    const room = await sdk.joinOrCreate<unknown, SandboxState>(ROOM_NAME, {
      token,
      protocolVersion: PROTOCOL_VERSION,
    });
    room.onMessage('command-rejected', () => {});
    rooms.push(room);
    return room;
  }

  beforeAll(async () => {
    const port = await application.listen();
    endpoint = `http://127.0.0.1:${port}`;
    sdk = new Client(endpoint);
    firstToken = await issue('하나');
    rooms.push(
      await sdk.joinOrCreate<unknown, SandboxState>(ROOM_NAME, {
        token: firstToken,
        protocolVersion: PROTOCOL_VERSION,
      }),
    );
    rooms[0]!.onMessage('command-rejected', () => {});
    await join('둘');
  });
  afterAll(async () => {
    await Promise.all(rooms.map((room) => room.leave()));
    await application.close();
  });

  it('reports local readiness without claiming MVP/media readiness', async () => {
    await expect.poll(() => rooms[0]!.state.players.size).toBe(2);
    const response = await fetch(`${endpoint}/health/ready`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'ready',
      mvpReady: false,
      mediaEnabled: false,
    });
    const blocked = await fetch(`${endpoint}/api/config`, {
      headers: { origin: 'https://unexpected.example' },
    });
    expect(blocked.status).toBe(403);
    const fromPlayground = await fetch(`${endpoint}/api/dev-sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:2567' },
      body: JSON.stringify({ nickname: '개발 도구' }),
    });
    expect(fromPlayground.status).toBe(201);
    const invalid = await fetch(`${endpoint}/api/dev-sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"nickname":""}',
    });
    expect(invalid.status).toBe(400);
  });

  it('rejects replay, unissued sessions and an incompatible protocol', async () => {
    await expect(
      sdk.joinOrCreate(ROOM_NAME, { token: firstToken, protocolVersion: PROTOCOL_VERSION }),
    ).rejects.toThrow('INVALID_SESSION');
    await expect(
      sdk.joinOrCreate(ROOM_NAME, { token: 'not-issued', protocolVersion: PROTOCOL_VERSION }),
    ).rejects.toThrow();
    await expect(
      sdk.joinOrCreate(ROOM_NAME, { token: await issue('계약'), protocolVersion: 'wrong' }),
    ).rejects.toThrow('PROTOCOL_MISMATCH');
  });

  it('moves only the authenticated sender by the server step and rejects forged player IDs', async () => {
    const a = rooms[0]!;
    const b = rooms[1]!;
    a.send('move', { seq: 0, x: 1, z: 0 });
    await expect.poll(() => a.state.players.get(a.sessionId)?.x).toBeCloseTo(0.2, 5);
    expect(a.state.players.get(b.sessionId)?.x).toBe(0);
    const rejection = new Promise<{ code: string }>((resolve) =>
      a.onMessage('command-rejected', resolve),
    );
    a.send('move', { seq: 1, x: 1, z: 0, playerId: b.sessionId });
    expect(await rejection).toEqual({ code: 'INVALID_MOVE' });
    const tick = a.state.tick;
    await expect.poll(() => a.state.tick).toBeGreaterThan(tick + 2);
    expect(a.state.players.get(a.sessionId)?.x).toBeCloseTo(0.2, 5);
  });

  it('caps the server at one room with six participants', async () => {
    await Promise.all(['셋', '넷', '다섯', '여섯'].map(join));
    await expect.poll(() => rooms[0]!.state.players.size).toBe(6);
    await expect(join('일곱')).rejects.toThrow('ROOM_CAPACITY');
  });

  it('removes a leaver and keeps the other participants connected', async () => {
    const leaving = rooms.pop()!;
    await leaving.leave();
    await expect.poll(() => rooms[0]!.state.players.size).toBe(5);
    expect(rooms[0]!.state.players.has(leaving.sessionId)).toBe(false);
    expect(rooms[0]!.connection.isOpen).toBe(true);
  });
});
