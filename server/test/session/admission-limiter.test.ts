import { describe, expect, it } from 'vitest';
import { AdmissionLimiter } from '../../src/session/AdmissionLimiter.js';

describe('AdmissionLimiter', () => {
  it('requires positive safe integers from configuration and invents no defaults', () => {
    for (const bad of [
      { windowMs: 0, perInvite: 5, perIp: 50 },
      { windowMs: 1000, perInvite: -1, perIp: 50 },
      { windowMs: 1000, perInvite: 5, perIp: 1.5 },
      { windowMs: Number.NaN, perInvite: 5, perIp: 50 },
      { windowMs: 1000, perInvite: 5, perIp: 50, maxKeys: 0 },
    ])
      expect(() => new AdmissionLimiter(bad)).toThrow('INVALID_ADMISSION_LIMITS');
  });

  it('keeps flooding attempts bounded and lets the original cooldown expire', () => {
    const limiter = new AdmissionLimiter({ windowMs: 1000, perInvite: 2, perIp: 3 });
    const input = { inviteId: 'shared', ip: '10.0.0.1' };
    expect(limiter.attempt(input, 0)).toBe('allowed');
    expect(limiter.attempt(input, 1)).toBe('allowed');
    for (let i = 0; i < 10_000; i++) expect(limiter.attempt(input, 999)).toBe('invite');
    expect(limiter.retained).toEqual({ inviteKeys: 1, ipKeys: 1, timestamps: 4 });
    expect(limiter.attempt(input, 1000)).toBe('allowed');
  });

  it('bounds rotating keys without evicting a live limit and reclaims expired keys', () => {
    const limiter = new AdmissionLimiter({
      windowMs: 1000,
      perInvite: 1,
      perIp: 2,
      maxKeys: 2,
    });
    expect(limiter.attempt({ inviteId: 'a', ip: 'one' }, 0)).toBe('allowed');
    expect(limiter.attempt({ inviteId: 'b', ip: 'two' }, 0)).toBe('allowed');
    for (let i = 0; i < 10_000; i++)
      expect(limiter.attempt({ inviteId: `rotated-${i}`, ip: `${i}` }, 999)).toBe('invite');
    expect(limiter.attempt({ inviteId: 'a', ip: 'one' }, 999)).toBe('invite');
    expect(limiter.retained).toEqual({ inviteKeys: 2, ipKeys: 2, timestamps: 4 });
    expect(limiter.attempt({ inviteId: 'new', ip: 'new' }, 1000)).toBe('allowed');
    expect(limiter.retained).toEqual({ inviteKeys: 1, ipKeys: 1, timestamps: 2 });
  });

  it('fails closed for an invalid clock without retaining a key', () => {
    const limiter = new AdmissionLimiter({ windowMs: 1000, perInvite: 1, perIp: 2 });
    expect(limiter.attempt({ inviteId: 'a', ip: 'one' }, Number.NaN)).toBe('invite');
    expect(limiter.retained).toEqual({ inviteKeys: 0, ipKeys: 0, timestamps: 0 });
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
