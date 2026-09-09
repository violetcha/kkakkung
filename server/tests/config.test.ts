import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config/env.js';

const livekit = {
  LIVEKIT_HTTP_URL: 'https://example.livekit.cloud',
  LIVEKIT_WS_URL: 'wss://example.livekit.cloud',
  LIVEKIT_API_KEY: 'key',
  LIVEKIT_API_SECRET: 'secret',
};

describe('skeleton readiness configuration', () => {
  it('permits the bounded local development profile', () => {
    const config = parseConfig({ NODE_ENV: 'test' });
    expect(config.port).toBe(2567);
    expect(config.mediaMode).toBe('disabled');
    expect(config.maxRooms).toBe(1);
    expect(config.maxSlots).toBe(6);
    expect(config.livekit).toBeNull();
    expect(config.opsToken).toBeNull();
    expect(config.admission).toBeNull();
  });
  it.each([
    { NODE_ENV: 'production' },
    { MEDIA_MODE: 'livekit' },
    { PORT: '0' },
    { MAX_ROOMS: '10' },
    { MAX_SLOTS: '60' },
    { MAX_ROOMS: '11', MAX_SLOTS: '66' },
    { ALLOWED_ORIGINS: '*' },
    { ALLOWED_ORIGINS: 'https://j15c204.p.ssafy.io/' },
  ])('rejects unsupported deployment settings %j', (env) => {
    expect(() => parseConfig(env)).toThrow();
  });
  it('opens only verified capacity as whole rooms of six', () => {
    const config = parseConfig({ MAX_ROOMS: '3', MAX_SLOTS: '18' });
    expect(config.maxRooms).toBe(3);
    expect(config.maxSlots).toBe(18);
  });
});

describe('operations and media configuration groups (F-01)', () => {
  it('maps a complete LiveKit group without echoing values in errors', () => {
    const config = parseConfig({ ...livekit, LIVEKIT_PROJECT_ALIAS: 'kkakkung-test' });
    expect(config.livekit).toEqual({
      httpUrl: livekit.LIVEKIT_HTTP_URL,
      wsUrl: livekit.LIVEKIT_WS_URL,
      apiKey: 'key',
      apiSecret: 'secret',
      projectAlias: 'kkakkung-test',
    });
  });
  it.each([
    { ...livekit, LIVEKIT_API_SECRET: undefined },
    { ...livekit, LIVEKIT_API_SECRET: '' },
    { ...livekit, LIVEKIT_HTTP_URL: 'wss://wrong-scheme' },
    { ...livekit, LIVEKIT_WS_URL: 'https://wrong-scheme' },
  ])('rejects a partial or malformed LiveKit group %j', (env) => {
    let message = '';
    try {
      parseConfig(env);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toBe('');
    expect(message).not.toContain('secret');
  });
  it('treats an empty operator token as not configured and accepts a present one', () => {
    expect(parseConfig({ OPS_TOKEN: '' }).opsToken).toBeNull();
    expect(parseConfig({ OPS_TOKEN: 'operator-token' }).opsToken).toBe('operator-token');
  });
  it('keeps working with the older env template that has empty LIVEKIT_* lines', () => {
    const config = parseConfig({
      LIVEKIT_URL: '',
      LIVEKIT_API_KEY: '',
      LIVEKIT_API_SECRET: '',
      MEDIA_MODE: 'disabled',
    });
    expect(config.livekit).toBeNull();
  });
  it('requires both public window bounds in order', () => {
    expect(() => parseConfig({ OPS_PUBLIC_WINDOW_OPENS_AT_EPOCH_MS: '1000' })).toThrow();
    expect(() =>
      parseConfig({
        OPS_PUBLIC_WINDOW_OPENS_AT_EPOCH_MS: '2000',
        OPS_PUBLIC_WINDOW_CLOSES_AT_EPOCH_MS: '1000',
      }),
    ).toThrow();
    expect(
      parseConfig({
        OPS_PUBLIC_WINDOW_OPENS_AT_EPOCH_MS: '1000',
        OPS_PUBLIC_WINDOW_CLOSES_AT_EPOCH_MS: '2000',
      }).publicWindow,
    ).toEqual({ opensAtEpochMs: 1000, closesAtEpochMs: 2000 });
  });
  it('bounds media API limits to 600 normal / 900 total and normal <= total', () => {
    expect(() =>
      parseConfig({
        MEDIA_MAX_NORMAL_API_CALLS_PER_60S: '601',
        MEDIA_MAX_TOTAL_API_CALLS_PER_60S: '900',
      }),
    ).toThrow();
    expect(() =>
      parseConfig({
        MEDIA_MAX_NORMAL_API_CALLS_PER_60S: '500',
        MEDIA_MAX_TOTAL_API_CALLS_PER_60S: '400',
      }),
    ).toThrow();
    expect(
      parseConfig({
        MEDIA_MAX_NORMAL_API_CALLS_PER_60S: '600',
        MEDIA_MAX_TOTAL_API_CALLS_PER_60S: '900',
      }).mediaApiLimits,
    ).toEqual({ maxNormalApiCallsPer60s: 600, maxTotalApiCallsPer60s: 900 });
  });
  it('treats the admission policy as all-or-nothing with no implicit defaults', () => {
    expect(() => parseConfig({ INVITE_MAX_TTL_MS: '60000' })).toThrow();
    expect(() =>
      parseConfig({
        INVITE_MAX_TTL_MS: '0',
        SESSION_ATTEMPT_WINDOW_MS: '60000',
        SESSION_ATTEMPTS_PER_INVITE: '3',
        SESSION_ATTEMPTS_PER_IP: '20',
        ROOM_IDLE_TTL_MS: '600000',
      }),
    ).toThrow();
    expect(
      parseConfig({
        INVITE_MAX_TTL_MS: '600000',
        SESSION_ATTEMPT_WINDOW_MS: '60000',
        SESSION_ATTEMPTS_PER_INVITE: '3',
        SESSION_ATTEMPTS_PER_IP: '20',
        ROOM_IDLE_TTL_MS: '600000',
      }).admission,
    ).toEqual({
      inviteMaxTtlMs: 600000,
      sessionAttemptWindowMs: 60000,
      sessionAttemptsPerInvite: 3,
      sessionAttemptsPerIp: 20,
      roomIdleTtlMs: 600000,
    });
  });
});
