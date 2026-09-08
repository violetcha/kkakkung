import { describe, expect, it } from 'vitest';
import { RoomAdmission, roomAdmission } from '../../src/session/RoomAdmission.js';

describe('RoomAdmission', () => {
  it('keeps the development singleton at one room', () => {
    expect(roomAdmission.maxRooms).toBe(1);
    roomAdmission.acquire('dev-a');
    expect(() => roomAdmission.acquire('dev-b')).toThrow('ROOM_CAPACITY');
    roomAdmission.acquire('dev-a');
    roomAdmission.release('dev-a');
    roomAdmission.acquire('dev-b');
    roomAdmission.release('dev-b');
  });

  it('enforces the configured product room count and releases idempotently', () => {
    const admission = new RoomAdmission(2);
    admission.acquire('a');
    admission.acquire('b');
    expect(() => admission.acquire('c')).toThrow('ROOM_CAPACITY');
    admission.release('a');
    admission.release('a');
    admission.acquire('c');
    expect(admission.size).toBe(2);
    expect(() => new RoomAdmission(0)).toThrow('INVALID_MAX_ROOMS');
  });
});
