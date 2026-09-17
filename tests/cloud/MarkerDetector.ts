// F-02 / QA-01. Receiver side of the synthetic markers. `MediaObserver` can only tell a newly
// transmitted marker from buffered replay if the receiver recovers the publisher's own serial,
// so this module turns a received MediaStreamTrack back into `frameSerial` / `toneSequence`.
//
// Face: SyntheticMedia fills the whole frame with `hsl(faceHueFor(serial) 70% 45%)` and the hue
// walks in steps of 37, which is invertible modulo 360 (37 * 253 = 9361 = 26 * 360 + 1). One
// pixel of a received frame therefore names the serial modulo 360; the full serial comes from
// unwrapping that residue against the previous reading.
// Tone: the oscillator steps 20 Hz per sequence inside an eight-step cycle, so an FFT peak names
// the step and the cycle is counted locally.
//
// The decoding rules are pure so Node tests cover them without a browser. Only `createFaceReader`
// and `createToneReader` need video, canvas and AudioContext. Nothing here keeps pixels or audio
// samples: a reading is a number and a timestamp.
import { faceHueFor, toneFrequencyFor } from './SyntheticMedia.ts';
import type { Marker } from './MediaObserver.ts';

export const FACE_HUE_PERIOD = 360;
/** Modular inverse of the 37-step hue walk: `(hue * 253) % 360 === frameSerial % 360`. */
export const FACE_HUE_INVERSE = 253;
export const TONE_CYCLE_STEPS = 8;
/** The tone never leaves 440..580 Hz; a peak outside this band is noise, not a marker. */
export const TONE_BAND = Object.freeze({ minHz: 400, maxHz: 620 });

/** Hue in degrees from 0..255 channels, matching the CSS `hsl()` the publisher draws. */
export function hueFromRgb(r: number, g: number, b: number): number {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const span = max - min;
  if (span === 0) return 0;
  const hue =
    max === red
      ? ((green - blue) / span) % 6
      : max === green
        ? (blue - red) / span + 2
        : (red - green) / span + 4;
  return (((hue * 60) % 360) + 360) % 360;
}

/** The publisher's `frameSerial` modulo 360, recovered from one decoded hue. */
export function serialResidueFromHue(hue: number): number {
  const rounded = ((Math.round(hue) % FACE_HUE_PERIOD) + FACE_HUE_PERIOD) % FACE_HUE_PERIOD;
  return (rounded * FACE_HUE_INVERSE) % FACE_HUE_PERIOD;
}

/** Shortest distance between two hues in degrees, going the short way around the circle. */
export function hueDistance(a: number, b: number): number {
  const raw = Math.abs(a - b) % FACE_HUE_PERIOD;
  return Math.min(raw, FACE_HUE_PERIOD - raw);
}

/**
 * The serial in `[previousSerial, previousSerial + maxAdvance]` whose hue best matches `hue`.
 *
 * Inverting the hue directly would be exact but brittle: 8-bit colour rounds the hue by up to a
 * degree, and one degree of hue is 253 serials, so a rounded reading would name a frame the
 * publisher never sent. Searching the window the elapsed time allows avoids that, because
 * neighbouring candidates are 37 degrees apart and rounding can never move a reading that far.
 * A window of a full period is ambiguous by construction and is refused.
 */
export function matchSerialInWindow(
  previousSerial: number,
  hue: number,
  maxAdvance: number,
  toleranceDegrees = 3,
): number | null {
  if (maxAdvance < 0 || maxAdvance >= FACE_HUE_PERIOD) return null;
  let best: number | null = null;
  let bestDistance = toleranceDegrees;
  for (let serial = previousSerial; serial <= previousSerial + maxAdvance; serial++) {
    const distance = hueDistance(faceHueFor(serial), hue);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = serial;
    }
  }
  return best;
}

/** Smallest value that is congruent to `residue` and not below `previous`. Never goes backwards. */
export function unwrapResidue(previous: number | null, residue: number, period: number): number {
  if (previous === null) return residue;
  const base = previous - (previous % period);
  const candidate = base + residue;
  return candidate < previous ? candidate + period : candidate;
}

/** The tone step 0..7 named by an FFT peak, or null when the peak is not a marker frequency. */
export function toneStepFromFrequency(frequencyHz: number): number | null {
  if (frequencyHz < TONE_BAND.minHz || frequencyHz > TONE_BAND.maxHz) return null;
  const step = Math.round((frequencyHz - toneFrequencyFor(0)) / 20);
  if (step < 0 || step >= TONE_CYCLE_STEPS) return null;
  // Reject a peak that sits between two steps: half a step is not a reading.
  return Math.abs(frequencyHz - toneFrequencyFor(step)) <= 8 ? step : null;
}

/** Loudest bin of a dB spectrum inside the marker band, or null when nothing rises above `floorDb`. */
export function peakFrequencyHz(
  magnitudesDb: readonly number[] | Float32Array,
  sampleRate: number,
  fftSize: number,
  floorDb = -90,
): number | null {
  const binHz = sampleRate / fftSize;
  const first = Math.max(1, Math.floor(TONE_BAND.minHz / binHz));
  const last = Math.min(magnitudesDb.length - 1, Math.ceil(TONE_BAND.maxHz / binHz));
  let bestIndex = -1;
  let best = floorDb;
  for (let i = first; i <= last; i++) {
    const value = magnitudesDb[i]!;
    if (value > best) {
      best = value;
      bestIndex = i;
    }
  }
  return bestIndex < 0 ? null : bestIndex * binHz;
}

/**
 * Next marker sequence from a residue reading, or null when the implied advance is impossible.
 *
 * Used for the tone, whose eight steps are 20 Hz apart and so survive an FFT peak without the
 * ambiguity the hue has. A peak from the wrong source still lands on an arbitrary step, which
 * unwrapping would turn into a forward jump, so a reading that claims more progress than the
 * publisher could have made is dropped rather than recorded as a marker.
 */
export function nextSerial(
  previous: Readonly<{ serial: number; atMs: number }> | null,
  residue: number,
  atMs: number,
  ratePerSecond: number,
  period: number,
): number | null {
  if (previous === null) return residue;
  const candidate = unwrapResidue(previous.serial, residue, period);
  const elapsedSeconds = Math.max(0, atMs - previous.atMs) / 1000;
  const allowed = Math.max(2, elapsedSeconds * ratePerSecond * 3 + 5);
  return candidate - previous.serial > allowed ? null : candidate;
}

export type MarkerReader = Readonly<{
  /** One reading at `nowMs`, or null when the track has produced nothing decodable yet. */
  sample: (nowMs: number) => Marker | null;
  stop: () => void;
}>;

type ReaderState = { last: { serial: number; atMs: number } | null; misses: number };

/** Consecutive undecodable readings after which the reader forgets its anchor and starts over. */
export const REANCHOR_AFTER_MISSES = 5;

/**
 * Reads the face marker from a received video track. The publisher fills the entire frame with
 * one hue and writes the serial as text in the top-left corner, so the centre pixel carries the
 * colour without the glyphs. One 8x8 draw per sample; no frame is stored or forwarded.
 */
export async function createFaceReader(
  track: MediaStreamTrack,
  fps = 10,
): Promise<MarkerReader | null> {
  const video = document.createElement('video');
  video.srcObject = new MediaStream([track]);
  video.muted = true;
  video.playsInline = true;
  try {
    await video.play();
  } catch {
    video.srcObject = null;
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 8;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    video.pause();
    video.srcObject = null;
    return null;
  }
  const state: ReaderState = { last: null, misses: 0 };
  const miss = (): null => {
    state.misses++;
    // A long gap makes the window ambiguous, so drop the anchor instead of guessing across it.
    if (state.misses >= REANCHOR_AFTER_MISSES) state.last = null;
    return null;
  };
  return {
    sample(nowMs) {
      if (video.readyState < 2 || video.videoWidth === 0) return miss();
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const pixel = context.getImageData(4, 4, 1, 1).data;
      // A fully unsaturated frame is the decoder's own blank canvas, not a published hue.
      if (pixel[0] === pixel[1] && pixel[1] === pixel[2]) return miss();
      const hue = hueFromRgb(pixel[0]!, pixel[1]!, pixel[2]!);
      const previous = state.last;
      const serial =
        previous === null
          ? serialResidueFromHue(hue)
          : matchSerialInWindow(
              previous.serial,
              hue,
              Math.ceil((Math.max(0, nowMs - previous.atMs) / 1000) * fps * 3 + 5),
            );
      if (serial === null) return miss();
      state.misses = 0;
      state.last = { serial, atMs: nowMs };
      return { serial, atMs: nowMs };
    },
    stop() {
      video.pause();
      video.srcObject = null;
    },
  };
}

/**
 * Reads the tone marker from a received audio track. `fftSize` 8192 gives ~5.9 Hz bins at 48 kHz,
 * which separates the 20 Hz steps; a smaller transform cannot tell two steps apart.
 */
export async function createToneReader(
  track: MediaStreamTrack,
  context: AudioContext,
  stepsPerSecond = 4,
): Promise<MarkerReader | null> {
  let source: MediaStreamAudioSourceNode;
  try {
    source = context.createMediaStreamSource(new MediaStream([track]));
  } catch {
    return null;
  }
  const analyser = context.createAnalyser();
  analyser.fftSize = 8192;
  analyser.smoothingTimeConstant = 0;
  source.connect(analyser);
  const spectrum = new Float32Array(analyser.frequencyBinCount);
  const state: ReaderState = { last: null, misses: 0 };
  const miss = (): null => {
    state.misses++;
    if (state.misses >= REANCHOR_AFTER_MISSES) state.last = null;
    return null;
  };
  return {
    sample(nowMs) {
      analyser.getFloatFrequencyData(spectrum);
      const peak = peakFrequencyHz(spectrum, context.sampleRate, analyser.fftSize);
      if (peak === null) return miss();
      const step = toneStepFromFrequency(peak);
      if (step === null) return miss();
      const serial = nextSerial(state.last, step, nowMs, stepsPerSecond, TONE_CYCLE_STEPS);
      if (serial === null) return miss();
      state.misses = 0;
      state.last = { serial, atMs: nowMs };
      return { serial, atMs: nowMs };
    },
    stop() {
      source.disconnect();
      analyser.disconnect();
    },
  };
}
