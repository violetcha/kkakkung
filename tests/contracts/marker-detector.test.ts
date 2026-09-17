// F-02 / QA-01. The decoding rules the load probe uses to turn a received track back into the
// publisher's marker. Pure only: no browser, no track, no Cloud. The hue path is the interesting
// one, because one degree of hue is 253 serials and 8-bit colour rounds by up to a degree.
import { describe, expect, it } from 'vitest';
import {
  FACE_HUE_INVERSE,
  FACE_HUE_PERIOD,
  TONE_CYCLE_STEPS,
  hueDistance,
  hueFromRgb,
  matchSerialInWindow,
  nextSerial,
  peakFrequencyHz,
  serialResidueFromHue,
  toneStepFromFrequency,
  unwrapResidue,
} from '../cloud/MarkerDetector.ts';
import { faceHueFor, toneFrequencyFor } from '../cloud/SyntheticMedia.ts';

/** The publisher draws `hsl(h 70% 45%)`; this is what the canvas stores for that colour. */
function hslBytes(hue: number): readonly [number, number, number] {
  const saturation = 0.7;
  const lightness = 0.45;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const second = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const match = lightness - chroma / 2;
  const [r, g, b] =
    hue < 60
      ? [chroma, second, 0]
      : hue < 120
        ? [second, chroma, 0]
        : hue < 180
          ? [0, chroma, second]
          : hue < 240
            ? [0, second, chroma]
            : hue < 300
              ? [second, 0, chroma]
              : [chroma, 0, second];
  return [
    Math.round((r + match) * 255),
    Math.round((g + match) * 255),
    Math.round((b + match) * 255),
  ];
}

describe('face hue decoding', () => {
  it('37 is invertible modulo 360, so one hue names the serial inside a period', () => {
    expect((37 * FACE_HUE_INVERSE) % FACE_HUE_PERIOD).toBe(1);
    for (const serial of [0, 1, 123, 359, 360, 1007])
      expect(serialResidueFromHue(faceHueFor(serial))).toBe(serial % FACE_HUE_PERIOD);
  });

  it('reads the drawn colour back as the same hue through 8-bit channels', () => {
    for (let serial = 0; serial < 360; serial++) {
      const hue = faceHueFor(serial);
      const [r, g, b] = hslBytes(hue);
      expect(Math.round(hueFromRgb(r, g, b))).toBe(hue);
    }
    expect(hueFromRgb(255, 0, 0)).toBeCloseTo(0);
    expect(hueFromRgb(0, 255, 0)).toBeCloseTo(120);
    expect(hueFromRgb(0, 0, 255)).toBeCloseTo(240);
    // A grey pixel carries no hue; the reader treats it as "nothing published yet".
    expect(hueFromRgb(17, 17, 17)).toBe(0);
  });

  it('measures hue distance the short way around the circle', () => {
    expect(hueDistance(10, 350)).toBe(20);
    expect(hueDistance(350, 10)).toBe(20);
    expect(hueDistance(100, 103)).toBe(3);
  });

  it('picks the serial from the window the elapsed time allows, and survives a rounded hue', () => {
    // Candidates are 37 degrees apart, so ±1 degree of noise can never reach the neighbour.
    for (let serial = 1; serial < 400; serial++) {
      const noisy = faceHueFor(serial) + (serial % 3 === 0 ? 1 : serial % 3 === 1 ? -1 : 0);
      expect(matchSerialInWindow(serial - 1, (noisy + 360) % 360, 35)).toBe(serial);
    }
  });

  it('refuses a window that covers a whole period, and a hue no candidate explains', () => {
    expect(matchSerialInWindow(0, faceHueFor(5), FACE_HUE_PERIOD)).toBeNull();
    expect(matchSerialInWindow(0, faceHueFor(5), -1)).toBeNull();
    // 5 is outside a window of 3, and every candidate inside it is at least 37 degrees away.
    expect(matchSerialInWindow(0, faceHueFor(5), 3)).toBeNull();
  });
});

describe('serial unwrapping', () => {
  it('never goes backwards across a period boundary', () => {
    expect(unwrapResidue(null, 17, 360)).toBe(17);
    expect(unwrapResidue(358, 359, 360)).toBe(359);
    expect(unwrapResidue(359, 0, 360)).toBe(360);
    expect(unwrapResidue(719, 2, 360)).toBe(722);
    expect(unwrapResidue(5, 5, 8)).toBe(5);
  });

  it('drops a reading that claims more progress than the publisher could have made', () => {
    const previous = { serial: 100, atMs: 1000 };
    // 250 ms at 4 steps/s is one step; the window still allows a few for jitter.
    expect(nextSerial(previous, 101 % TONE_CYCLE_STEPS, 1250, 4, TONE_CYCLE_STEPS)).toBe(101);
    // A peak from the wrong source lands on an arbitrary step far ahead of the clock.
    expect(nextSerial({ serial: 8, atMs: 1000 }, 7, 1050, 4, TONE_CYCLE_STEPS)).toBeNull();
    expect(nextSerial(null, 3, 1000, 4, TONE_CYCLE_STEPS)).toBe(3);
  });
});

describe('tone decoding', () => {
  it('names the eight steps and refuses anything between or outside them', () => {
    for (let step = 0; step < TONE_CYCLE_STEPS; step++)
      expect(toneStepFromFrequency(toneFrequencyFor(step))).toBe(step);
    // Within the FFT bin error the step is still named; half a step is not a reading.
    expect(toneStepFromFrequency(498)).toBe(3);
    expect(toneStepFromFrequency(450)).toBeNull();
    expect(toneStepFromFrequency(1000)).toBeNull();
    expect(toneStepFromFrequency(100)).toBeNull();
  });

  it('finds the loudest bin inside the marker band only', () => {
    const fftSize = 8192;
    const sampleRate = 48_000;
    const spectrum = new Float32Array(fftSize / 2).fill(-120);
    spectrum[85] = -20; // 85 * 48000 / 8192 = 498.05 Hz
    const peak = peakFrequencyHz(spectrum, sampleRate, fftSize);
    expect(peak).toBeCloseTo(498.05, 1);
    expect(toneStepFromFrequency(peak!)).toBe(3);

    // A louder peak below the band is room noise, not a marker.
    spectrum[20] = -5;
    expect(toneStepFromFrequency(peakFrequencyHz(spectrum, sampleRate, fftSize)!)).toBe(3);

    // Nothing above the floor is silence, not a reading of step 0.
    expect(
      peakFrequencyHz(new Float32Array(fftSize / 2).fill(-120), sampleRate, fftSize),
    ).toBeNull();
  });

  it('separates two steps: 8192 bins at 48 kHz are finer than the 20 Hz spacing', () => {
    const binHz = 48_000 / 8192;
    expect(binHz).toBeLessThan(20 / 2);
  });
});
