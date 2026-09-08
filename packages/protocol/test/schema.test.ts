import { Decoder, Encoder, MapSchema } from '@colyseus/schema';
import { describe, expect, it } from 'vitest';

import { PlayerState, SandboxState } from '../src/schema/index.js';

describe('public sandbox state', () => {
  it('uses safe public defaults and a typed player map', () => {
    const state = new SandboxState();

    expect(state.protocolVersion).toBe('0.1.0');
    expect(state.phase).toBe('sandbox');
    expect(state.tick).toBe(0);
    expect(state.players).toBeInstanceOf(MapSchema);
    expect(state.players.size).toBe(0);
  });

  it('round-trips a full state and subsequent patch', () => {
    const server = new SandboxState();
    const player = new PlayerState();
    player.playerId = 'player-1';
    player.nickname = '까꿍';
    player.x = 3;
    player.z = -2;
    server.tick = 1;
    server.players.set(player.playerId, player);

    const encoder = new Encoder(server);
    const client = new SandboxState();
    const decoder = new Decoder(client);
    decoder.decode(encoder.encodeAll());
    encoder.discardChanges();

    expect({
      protocolVersion: client.protocolVersion,
      phase: client.phase,
      tick: client.tick,
      playerId: client.players.get('player-1')?.playerId,
      nickname: client.players.get('player-1')?.nickname,
      x: client.players.get('player-1')?.x,
      z: client.players.get('player-1')?.z,
    }).toEqual({
      protocolVersion: '0.1.0',
      phase: 'sandbox',
      tick: 1,
      playerId: 'player-1',
      nickname: '까꿍',
      x: 3,
      z: -2,
    });

    server.tick = 2;
    player.x = 4;
    decoder.decode(encoder.encode());

    expect(client.tick).toBe(2);
    expect(client.players.get('player-1')?.x).toBe(4);
  });
});
