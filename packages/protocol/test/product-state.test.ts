import { Decoder, Encoder } from '@colyseus/schema';
import { describe, expect, it } from 'vitest';

import {
  PUBLIC_MATCH_STATE_FIELDS,
  PublicMatchState,
  RoundResultState,
  readPublicRoundState,
} from '../src/game-schema/product.js';
import { GameState } from '../src/game-schema/index.js';
import { SandboxState } from '../src/schema/index.js';
import { PROTOCOL_VERSION, PRODUCT_PROTOCOL_VERSION, ROOM_NAME } from '../src/version.js';

function roundTrip(server: PublicMatchState) {
  const encoder = new Encoder(server);
  const client = new PublicMatchState();
  const decoder = new Decoder(client);
  decoder.decode(encoder.encodeAll());
  encoder.discardChanges();
  return { encoder, decoder, client };
}

describe('product match state (0.2.0)', () => {
  it('keeps the diagnostic sandbox contract on 0.1.0 and the product contract on 0.2.0', () => {
    expect(PROTOCOL_VERSION).toBe('0.1.0');
    expect(ROOM_NAME).toBe('sandbox');
    expect(PRODUCT_PROTOCOL_VERSION).toBe('0.2.0');
    expect(new SandboxState().protocolVersion).toBe('0.1.0');
    expect(new PublicMatchState().protocolVersion).toBe('0.2.0');
    expect(Object.keys(new GameState().toJSON())).not.toContain('stateVersion');
  });

  it('serializes only round metadata: no coordinates, maze, exits, seed or tuning', () => {
    const state = new PublicMatchState();
    state.matchId = 'match-1';
    state.phase = 'PLAYING';
    state.stateVersion = 12;
    state.serverTick = 400;
    state.startTick = 100;
    state.startAt = 5_000;
    state.deadlineTick = 3700;
    state.counts.escaped = 1;
    const { client } = roundTrip(state);
    const json = client.toJSON() as Record<string, unknown>;
    for (const key of Object.keys(json)) expect(PUBLIC_MATCH_STATE_FIELDS).toContain(key);
    for (const forbidden of ['maze', 'players', 'exits', 'seed', 'tuning', 'layout', 'x', 'y'])
      expect(json).not.toHaveProperty(forbidden);
    expect(readPublicRoundState(client)).toEqual({
      phase: 'PLAYING',
      matchId: 'match-1',
      stateVersion: 12,
      serverTick: 400,
      startTick: 100,
      startAt: 5_000,
      deadlineTick: 3700,
      counts: { escaped: 1, captured: 0 },
      result: null,
      abortReason: null,
    });
  });

  it('transmits null round fields as absent and normalizes them back to null', () => {
    const state = new PublicMatchState();
    state.matchId = 'match-1';
    state.startTick = 100;
    state.result = new RoundResultState();
    state.result.winner = 'taggers';
    state.result.reason = 'two-captured';
    expect(readPublicRoundState(new PublicMatchState()).result).toBeNull();
    const { encoder, decoder, client } = roundTrip(state);
    expect(readPublicRoundState(client).result).toEqual({
      winner: 'taggers',
      reason: 'two-captured',
    });
    state.startTick = null;
    state.result = null;
    state.abortReason = 'SERVER_TICK_OVERLOAD';
    decoder.decode(encoder.encode());
    encoder.discardChanges();
    expect(client.startTick).toBeUndefined();
    const normalized = readPublicRoundState(client);
    expect(normalized.startTick).toBeNull();
    expect(normalized.result).toBeNull();
    expect(normalized.abortReason).toBe('SERVER_TICK_OVERLOAD');
  });
});
