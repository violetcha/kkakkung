// F-02 / QA-01 self test of the measurement instrument, with no LiveKit and no network.
//
// The publisher and the reader are put on the two ends of the same local MediaStreamTracks, so a
// run answers one question: does the marker survive canvas capture, a video element, a draw and a
// pixel read, and does the tone survive the audio graph and an FFT. Everything a Cloud stage adds
// on top — encoding, the SFU, the policy — is unverified until a Cloud run happens; this only
// proves the instrument is not reading noise.
import { createFaceReader, createToneReader } from './MarkerDetector.ts';
import { createSyntheticTracks } from './SyntheticMedia.ts';

export type MarkerSelfTestResult = Readonly<{
  face: MarkerChannelResult;
  tone: MarkerChannelResult;
  /** Frames and tone steps the publisher produced during the run. */
  published: Readonly<{ frames: number; toneSteps: number }>;
}>;

export type MarkerChannelResult = Readonly<{
  /** Readings that decoded to a marker. */
  samples: number;
  /** Readings the decoder refused (before the first frame, or an implausible advance). */
  misses: number;
  /** True when no reading ever named a serial below its predecessor. */
  monotone: boolean;
  /** Serial advance between the first and the last decoded marker. */
  advance: number | null;
  reader: 'opened' | 'unavailable';
}>;

type Channel = {
  serials: number[];
  misses: number;
  reader: 'opened' | 'unavailable';
};

const summarize = (channel: Channel): MarkerChannelResult => ({
  samples: channel.serials.length,
  misses: channel.misses,
  monotone: channel.serials.every(
    (value, index) => index === 0 || value >= channel.serials[index - 1]!,
  ),
  advance: channel.serials.length >= 2 ? channel.serials.at(-1)! - channel.serials[0]! : null,
  reader: channel.reader,
});

export async function runMarkerSelfTest(durationMs = 3000, intervalMs = 100) {
  const tracks = createSyntheticTracks(10);
  const context = new AudioContext();
  await context.resume();
  const startedAt = performance.timeOrigin + performance.now();
  const before = tracks.current();
  const faceReader = await createFaceReader(tracks.video, 10);
  const toneReader = await createToneReader(tracks.audio, context, 4);
  const face: Channel = { serials: [], misses: 0, reader: faceReader ? 'opened' : 'unavailable' };
  const tone: Channel = { serials: [], misses: 0, reader: toneReader ? 'opened' : 'unavailable' };

  try {
    while (performance.timeOrigin + performance.now() - startedAt < durationMs) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      const nowMs = performance.timeOrigin + performance.now();
      const faceMarker = faceReader?.sample(nowMs) ?? null;
      if (faceMarker) face.serials.push(faceMarker.serial);
      else face.misses++;
      const toneMarker = toneReader?.sample(nowMs) ?? null;
      if (toneMarker) tone.serials.push(toneMarker.serial);
      else tone.misses++;
    }
  } finally {
    faceReader?.stop();
    toneReader?.stop();
    tracks.stop();
    await context.close().catch(() => {});
  }

  const after = tracks.current();
  const result: MarkerSelfTestResult = {
    face: summarize(face),
    tone: summarize(tone),
    published: {
      frames: after.frameSerial - before.frameSerial,
      toneSteps: after.toneSequence - before.toneSequence,
    },
  };
  return result;
}

declare global {
  interface Window {
    runMarkerSelfTest: typeof runMarkerSelfTest;
  }
}
window.runMarkerSelfTest = runMarkerSelfTest;
