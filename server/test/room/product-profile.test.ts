import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { PRODUCT_PROTOCOL_VERSION } from '@kkakkung/protocol/version';
import { createApplication } from '../../src/bootstrap.js';
import { parseConfig } from '../../src/config/env.js';
import { LayoutLoader } from '../../src/game/LayoutLoader.js';
import { loadProductProfile } from '../../src/game/ProductProfileLoader.js';

const config = () => ({
  ...parseConfig({
    NODE_ENV: 'test',
    SERVER_PROFILE: 'product',
    MEDIA_MODE: 'disabled',
    LOG_LEVEL: 'silent',
    INVITE_MAX_TTL_MS: '60000',
    SESSION_ATTEMPT_WINDOW_MS: '60000',
    SESSION_ATTEMPTS_PER_INVITE: '20',
    SESSION_ATTEMPTS_PER_IP: '20',
    ROOM_IDLE_TTL_MS: '60000',
  }),
  port: 0,
});

describe('real product profile assembly without Cloud', () => {
  it('loads A tuning, practice and all certified map variants into the real core', async () => {
    const profile = await loadProductProfile(config());
    expect(profile.assetVersion).toBe('c-primitives-1');
    expect(profile.strictProduct).toBe(true);
    const players = Array.from({ length: 6 }, (_, index) => ({
      playerId: `player-${index}`,
      role: index < 3 ? ('runner' as const) : ('tagger' as const),
    }));
    const maps = profile.layouts!;
    const loader = new LayoutLoader({
      readFile,
      maps: maps.maps,
      selection: maps.selection,
      now: () => performance.now(),
      maxAttempts: 0,
    });
    // Zero online attempts forces B to consume A's committed fallback wrapper for each variant.
    for (let seed = 0; seed < 8; seed++) {
      const selected = await loader.prepare({ ...maps, players, seed });
      expect(selected.status, JSON.stringify(selected)).toBe('selected');
      if (selected.status !== 'selected') throw new Error('MAP_SELECTION_FAILED');
      expect(selected.layout.source).toBe('fallback');
      const state = profile.core!.createMatch({
        matchId: 'match-1',
        gameInstanceId: `game-${seed}`,
        seed,
        players,
        layout: selected.layout.layout,
        tuning: profile.tuning!,
      });
      expect(profile.core!.getFrame(state).participants).toHaveLength(6);
    }
    for (const role of ['runner', 'tagger'] as const) {
      const members = players.filter((player) => player.role === role);
      const prepared = profile.practice!.port.preparePracticeLayout(
        profile.practice!.raw,
        members,
        role,
      );
      expect(prepared.status).toBe('ready');
      if (prepared.status !== 'ready') throw new Error('PRACTICE_LAYOUT_FAILED');
      const state = profile.core!.createPractice({
        matchId: 'practice-1',
        gameInstanceId: `practice-${role}`,
        seed: 1,
        players: members,
        role,
        layout: prepared.layout,
        tuning: profile.tuning!,
      });
      expect(profile.core!.getFrame(state).phase).toBe('TEAM_PRACTICE');
      expect(profile.core!.getPlayerSelf(state, members[0]!.playerId)?.status).toBe('ACTIVE');
    }
  });

  it('boots the product HTTP contract locked and does not expose development admission', async () => {
    const runtimeConfig = config();
    const profile = await loadProductProfile(runtimeConfig);
    const application = createApplication(runtimeConfig, {
      ...profile,
      // A development test override must never open the strict product entrypoint.
      developmentAdmission: () => 'OPEN',
    });
    const port = await application.listen();
    const endpoint = `http://127.0.0.1:${port}`;
    try {
      const response = await fetch(endpoint + '/api/config');
      expect(await response.json()).toMatchObject({
        protocolVersion: PRODUCT_PROTOCOL_VERSION,
        mediaEnabled: false,
        roomName: 'kkakkung',
      });
      const readiness = await fetch(endpoint + '/health/ready');
      expect(readiness.status).toBe(503);
      expect(await readiness.json()).toMatchObject({ readiness: 'LOCKED', admission: 'LOCKED' });
      const dev = await fetch(endpoint + '/api/dev-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nickname: 'untrusted' }),
      });
      expect(dev.status).toBe(404);
      for (const path of ['/monitor', '/playground'])
        expect((await fetch(endpoint + path)).status).toBe(404);
      const join = await fetch(endpoint + '/matchmake/joinOrCreate/kkakkung', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      expect(join.status).not.toBe(200);
      expect(await join.json()).toMatchObject({ error: 'NOT_READY' });
      expect(application.slots!.roomCodes().size).toBe(0);
    } finally {
      await application.close();
    }
  });
});
