import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config/env.js';

const livekit = {
  LIVEKIT_HTTP_URL: 'https://example.livekit.cloud',
  LIVEKIT_WS_URL: 'wss://example.livekit.cloud',
  LIVEKIT_API_KEY: 'key',
  LIVEKIT_API_SECRET: 'secret',
};

const admission = {
  INVITE_MAX_TTL_MS: '600000',
  SESSION_ATTEMPT_WINDOW_MS: '60000',
  SESSION_ATTEMPTS_PER_INVITE: '3',
  SESSION_ATTEMPTS_PER_IP: '20',
  ROOM_IDLE_TTL_MS: '600000',
};

const productMedia = {
  ...livekit,
  ...admission,
  SERVER_PROFILE: 'product',
  MEDIA_MODE: 'livekit',
  LIVEKIT_PROJECT_ALIAS: 'integration-test',
  OPS_TOKEN: 'test-operator-token',
  OPS_PUBLIC_WINDOW_OPENS_AT_EPOCH_MS: '1000',
  OPS_PUBLIC_WINDOW_CLOSES_AT_EPOCH_MS: '2000',
  OPS_OFFICIAL_BUDGET_MAX_AGE_MS: '60000',
  OPS_OPERATION_TIMEOUT_MS: '1000',
  MEDIA_MAX_NORMAL_API_CALLS_PER_60S: '40',
  MEDIA_MAX_TOTAL_API_CALLS_PER_60S: '60',
};

describe('explicit local product configuration', () => {
  it('derives admission from one explicit audience and keeps legacy defaults closed', () => {
    const base = { ...admission, SERVER_PROFILE: 'product', TRUST_PROXY_HOPS: '1' };
    expect(parseConfig({}).serviceAudience).toBeNull();
    expect(parseConfig({ ...base, SERVICE_AUDIENCE: 'team' })).toMatchObject({
      serviceAudience: 'team',
      sessionAdmissionMode: 'gitlab-sso',
    });
    expect(parseConfig({ ...base, SERVICE_AUDIENCE: 'public' })).toMatchObject({
      serviceAudience: 'public',
      sessionAdmissionMode: 'guest',
      mediaMode: 'disabled',
    });
    for (const [audience, mode] of [
      ['team', 'guest'],
      ['team', 'invitation'],
      ['public', 'gitlab-sso'],
      ['public', 'invitation'],
    ])
      expect(() =>
        parseConfig({ ...base, SERVICE_AUDIENCE: audience, SESSION_ADMISSION_MODE: mode }),
      ).toThrow('conflicts');
    expect(() => parseConfig({ ...base, SESSION_ADMISSION_MODE: 'guest' })).toThrow(
      'explicit SERVICE_AUDIENCE',
    );
    expect(() =>
      parseConfig({ ...base, SERVICE_AUDIENCE: 'public', TRUST_PROXY_HOPS: '0' }),
    ).toThrow('trusted proxy');
    expect(() =>
      parseConfig({ ...base, SERVICE_AUDIENCE: 'public', SERVER_PROFILE: 'development' }),
    ).toThrow('product profile');
    expect(() => parseConfig({ ...base, SERVICE_AUDIENCE: 'unknown' })).toThrow('SERVICE_AUDIENCE');
  });
  it('refuses public Cloud in both legacy media modes without weakening the team profile', () => {
    for (const mode of ['server-controlled', 'publisher-permissions']) {
      const base = { ...productMedia, TRUST_PROXY_HOPS: '1', MEDIA_SUBSCRIPTION_MODE: mode };
      expect(() => parseConfig({ ...base, SERVICE_AUDIENCE: 'public' })).toThrow(
        'PUBLIC_MEDIA_AUTHORITY_NOT_IMPLEMENTED',
      );
      expect(parseConfig({ ...base, SERVICE_AUDIENCE: 'team' }).sessionAdmissionMode).toBe(
        'gitlab-sso',
      );
    }
  });
  it('requires an explicit product ingress before accepting GitLab identity headers', () => {
    expect(parseConfig({}).sessionAdmissionMode).toBe('invitation');
    expect(() => parseConfig({ SESSION_ADMISSION_MODE: 'gitlab-sso' })).toThrow('trusted proxy');
    expect(() =>
      parseConfig({
        ...admission,
        SERVER_PROFILE: 'product',
        SESSION_ADMISSION_MODE: 'gitlab-sso',
      }),
    ).toThrow('trusted proxy');
    expect(
      parseConfig({
        ...admission,
        SERVER_PROFILE: 'product',
        TRUST_PROXY_HOPS: '1',
        SESSION_ADMISSION_MODE: 'gitlab-sso',
      }).sessionAdmissionMode,
    ).toBe('gitlab-sso');
  });
  it('preserves development defaults and requires a complete admission policy for product', () => {
    expect(parseConfig({}).serverProfile).toBe('development');
    expect(() => parseConfig({ SERVER_PROFILE: 'product' })).toThrow(/admission/);
    const config = parseConfig({ ...admission, SERVER_PROFILE: 'product' });
    expect(config.serverProfile).toBe('product');
    expect(config.mediaMode).toBe('disabled');
    expect(config.assetVersion).toBe('c-primitives-1');
    expect(config.contentDir).toBe('server/content');
    expect(config.tuningPath).toBe('server/config/tuning/mvp-v1.json');
    expect(config.trustProxyHops).toBe(0);
  });

  it('permits only the explicit zero or one trusted proxy hop', () => {
    expect(parseConfig({ TRUST_PROXY_HOPS: '1' }).trustProxyHops).toBe(1);
    expect(() => parseConfig({ TRUST_PROXY_HOPS: '2' })).toThrow(/TRUST_PROXY_HOPS/);
    expect(() => parseConfig({ TRUST_PROXY_HOPS: '-1' })).toThrow(/TRUST_PROXY_HOPS/);
  });

  it('maps a complete product media policy without treating it as readiness evidence', () => {
    const config = parseConfig(productMedia);
    expect(config.mediaMode).toBe('livekit');
    expect(config.livekit?.projectAlias).toBe('integration-test');
    expect(config.officialBudgetMaxAgeMs).toBe(60000);
    expect(config.mediaApiLimits).toEqual({
      maxNormalApiCallsPer60s: 40,
      maxTotalApiCallsPer60s: 60,
    });
    expect(config).not.toHaveProperty('ready');
    expect(() => parseConfig({ ...productMedia, NODE_ENV: 'production' })).toThrow(/NODE_ENV/);
  });

  it.each([
    'LIVEKIT_PROJECT_ALIAS',
    'OPS_TOKEN',
    'OPS_OFFICIAL_BUDGET_MAX_AGE_MS',
    'OPS_OPERATION_TIMEOUT_MS',
    'OPS_PUBLIC_WINDOW_OPENS_AT_EPOCH_MS',
    'MEDIA_MAX_TOTAL_API_CALLS_PER_60S',
  ])('refuses incomplete product media prerequisites: %s', (missing) => {
    expect(() => parseConfig({ ...productMedia, [missing]: undefined })).toThrow();
  });

  it.each([
    { LIVEKIT_HTTP_URL: 'http://example.livekit.cloud' },
    { LIVEKIT_WS_URL: 'ws://example.livekit.cloud' },
    { LIVEKIT_WS_URL: 'wss://other.livekit.cloud' },
    { LIVEKIT_HTTP_URL: 'https://embedded-secret@example.livekit.cloud' },
    { LIVEKIT_WS_URL: 'wss://example.livekit.cloud?token=embedded-secret' },
  ])('rejects unsafe or mismatched product media origins without echoing them', (override) => {
    expect(() => parseConfig({ ...productMedia, ...override })).toThrow(/HTTPS\/WSS origins/);
    try {
      parseConfig({ ...productMedia, ...override });
    } catch (error) {
      expect((error as Error).message).not.toContain('embedded-secret');
    }
  });
});

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
