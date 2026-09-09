import { describe, expect, it } from 'vitest';
import { AdmissionLimiter } from '../../src/session/AdmissionLimiter.js';

describe('AdmissionLimiter', () => {
  it('requires positive safe integers from configuration and invents no defaults', () => {
    for (const bad of [
      { windowMs: 0, perInvite: 5, perIp: 50 },
      { windowMs: 1000, perInvite: -1, perIp: 50 },
      { windowMs: 1000, perInvite: 5, perIp: 1.5 },
      { windowMs: Number.NaN, perInvite: 5, perIp: 50 },
    ])
      expect(() => new AdmissionLimiter(bad)).toThrow('INVALID_ADMISSION_LIMITS');
  });

  it('limits per invitation first and applies the NAT-friendly IP bucket second', () => {
    const limiter = new AdmissionLimiter({ windowMs: 60_000, perInvite: 2, perIp: 3 });
    expect(limiter.attempt({ inviteId: 'i1', ip: '10.0.0.1' }, 0)).toBe('allowed');
    expect(limiter.attempt({ inviteId: 'i1', ip: '10.0.0.1' }, 10)).toBe('allowed');
    expect(limiter.attempt({ inviteId: 'i1', ip: '10.0.0.1' }, 20)).toBe('invite');
    // Different valid invitations from the same school IP are not blocked wholesale.
    expect(limiter.attempt({ inviteId: 'i2', ip: '10.0.0.1' }, 30)).toBe('allowed');
    expect(limiter.attempt({ inviteId: 'i3', ip: '10.0.0.1' }, 40)).toBe('ip');
    expect(limiter.attempt({ inviteId: 'i3', ip: null }, 41)).toBe('allowed');
    expect(limiter.attempt({ inviteId: 'i4', ip: '10.0.0.1' }, 60_030)).toBe('allowed');
  });
});
