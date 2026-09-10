import { expect, it } from 'vitest';
import { deviceReady, INITIAL_DEVICES } from './device-readiness';
it('requires camera, processed vision, calibration and audio but permits denied microphone', () => {
  const ready = {
    ...INITIAL_DEVICES,
    camera: 'ready',
    vision: 'ready',
    calibration: 'ready',
    audioPlayback: 'ready',
    microphone: 'denied',
  } as const;
  expect(deviceReady(ready)).toBe(true);
  for (const key of ['camera', 'vision', 'calibration'] as const)
    expect(deviceReady({ ...ready, [key]: 'idle' })).toBe(false);
  expect(deviceReady({ ...ready, audioPlayback: 'locked' })).toBe(false);
});
