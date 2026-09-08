import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config/env.js';

describe('skeleton readiness configuration', () => {
  it('permits the bounded local development profile', () => {
    const config = parseConfig({ NODE_ENV: 'test' });
    expect(config.port).toBe(2567);
    expect(config.mediaMode).toBe('disabled');
  });
  it.each([
    { NODE_ENV: 'production' },
    { MEDIA_MODE: 'livekit' },
    { PORT: '0' },
    { MAX_ROOMS: '10' },
    { MAX_SLOTS: '60' },
    { ALLOWED_ORIGINS: '*' },
  ])('rejects unsupported deployment settings %j', (env) => {
    expect(() => parseConfig(env)).toThrow();
  });
});
