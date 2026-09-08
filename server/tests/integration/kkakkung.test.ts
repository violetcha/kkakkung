import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import type { GameState } from '@kkakkung/protocol/game-schema';
import { createApplication } from '../../src/bootstrap.js';
import { parseConfig } from '../../src/config/env.js';

describe('kkakkung development room', () => {
  const application = createApplication({
    ...parseConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent' }),
    port: 0,
  });
  const rooms: Room<unknown, GameState>[] = [];
  let sdk: Client;

  async function waitForPlayers(room: Room<unknown, GameState>, count: number) {
    const deadline = Date.now() + 2_000;
    while (room.state.players.size !== count && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    if (room.state.players.size !== count)
      throw new Error(`Timed out waiting for ${count} players`);
  }

  beforeAll(async () => {
    const port = await application.listen();
    sdk = new Client(`http://127.0.0.1:${port}`);
    const runner = await sdk.joinOrCreate<unknown, GameState>('kkakkung');
    const tagger = await sdk.joinById<unknown, GameState>(runner.roomId);
    rooms.push(runner, tagger);
    await waitForPlayers(runner, 2);
  });

  afterAll(async () => {
    await Promise.all(rooms.map((room) => room.leave()));
    await application.close();
  });

  it('starts after both players are ready and accepts the documented move command', async () => {
    const [runner, tagger] = rooms as [Room<unknown, GameState>, Room<unknown, GameState>];
    const beforeY = runner.state.players.get(runner.sessionId)!.y;

    runner.send('ready', { forged: true });
    tagger.send('ready', {});
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(runner.state.phase).toBe('waiting');

    runner.send('ready', {});
    await expect.poll(() => runner.state.phase).toBe('playing');

    runner.send('move', { seq: 1, dir: 'forward' });
    await expect.poll(() => runner.state.players.get(runner.sessionId)?.y).toBe(beforeY + 1);
  });

  it('keeps runner exits out of the tagger payload and does not restart a playing round', async () => {
    const [runner, tagger] = rooms as [Room<unknown, GameState>, Room<unknown, GameState>];
    const runnerPayload = runner.state.toJSON() as { exits?: Record<string, unknown> };
    const taggerPayload = tagger.state.toJSON() as { exits?: Record<string, unknown> };

    expect(Object.keys(runnerPayload.exits ?? {})).toContain(runner.sessionId);
    expect(taggerPayload).not.toHaveProperty('exits');

    const timeBeforeReady = runner.state.timeLeft;
    runner.send('ready', {});
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(runner.state.timeLeft).toBeLessThan(timeBeforeReady);
  });

  it('ignores malformed direction and sequence payloads', async () => {
    const runner = rooms[0]!;
    const before = runner.state.players.get(runner.sessionId)!;
    const position = { x: before.x, y: before.y, dir: before.dir };
    const rejections: { seq: number; reason: string }[] = [];
    runner.onMessage('rejected', (message) => rejections.push(message));

    runner.send('move', { seq: 'bad', dir: 'forward' });
    runner.send('move', { seq: 2, dir: 'sideways' });
    runner.send('move', { seq: 2, dir: 'forward', playerId: 'forged' });
    runner.send('turn', { seq: 3, dir: 'around' });
    await expect.poll(() => rejections.length).toBe(4);

    expect(runner.state.players.get(runner.sessionId)).toMatchObject(position);
    expect(rejections).toContainEqual({ seq: -1, reason: 'invalid-message' });
    expect(rejections).toContainEqual({ seq: 2, reason: 'invalid-message' });
  });
});
