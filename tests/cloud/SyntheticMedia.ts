// F-02 / QA-01. Browser-only synthetic media for the probe page: a canvas face with a readable
// frameSerial and colour pattern, and an oscillator tone with a sequence marker. No camera, no
// microphone, no user voice. Tracks and contexts are closed by `stop()`. The marker encodings
// are pure so MediaObserver and tests can decode them without a browser.
export type FaceMarker = Readonly<{ frameSerial: number; hue: number }>;

/** The colour pattern of frame `n`: the hue walks 0..359 so a decoder can cross-check the serial. */
export function faceHueFor(frameSerial: number): number {
  return (frameSerial * 37) % 360;
}

/** Decodes the serial back from the hue and a coarse counter (the observer reads both). */
export function decodeFace(pixelHue: number, coarseSerial: number): FaceMarker | null {
  const expected = faceHueFor(coarseSerial);
  return Math.abs(expected - pixelHue) <= 3 ? { frameSerial: coarseSerial, hue: pixelHue } : null;
}

/** Tone frequency for sequence `n`: 440 Hz plus a 20 Hz step per 8-sequence cycle. */
export function toneFrequencyFor(sequence: number): number {
  return 440 + (sequence % 8) * 20;
}

export function decodeTone(frequencyHz: number, cycleBase: number): number | null {
  const step = Math.round((frequencyHz - 440) / 20);
  return step >= 0 && step < 8 ? cycleBase * 8 + step : null;
}

export type SyntheticTracks = Readonly<{
  video: MediaStreamTrack;
  audio: MediaStreamTrack;
  /** Current frame serial and tone sequence, read by the publisher-side evidence. */
  current: () => Readonly<{ frameSerial: number; toneSequence: number }>;
  /** Replaces the video MediaStreamTrack (same publication) and returns the new one. */
  replaceVideo: () => MediaStreamTrack;
  stop: () => void;
}>;

/** Requires a browser (canvas.captureStream, AudioContext). Never called from Node tests. */
export function createSyntheticTracks(fps = 10): SyntheticTracks {
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  let frameSerial = 0;
  let toneSequence = 0;
  const draw = () => {
    frameSerial++;
    ctx.fillStyle = `hsl(${faceHueFor(frameSerial)} 70% 45%)`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.font = '14px monospace';
    ctx.fillText(String(frameSerial), 6, 20);
  };
  const frameTimer = setInterval(draw, Math.round(1000 / fps));
  const firstVideoTrack = (): MediaStreamTrack => {
    const track = canvas.captureStream(fps).getVideoTracks()[0];
    if (!track) throw new Error('captureStream produced no video track');
    return track;
  };
  let video: MediaStreamTrack = firstVideoTrack();

  const audioCtx = new AudioContext();
  const oscillator = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  gain.gain.value = 0.02;
  oscillator.frequency.value = toneFrequencyFor(0);
  const destination = audioCtx.createMediaStreamDestination();
  oscillator.connect(gain).connect(destination);
  oscillator.start();
  const toneTimer = setInterval(() => {
    toneSequence++;
    oscillator.frequency.setValueAtTime(toneFrequencyFor(toneSequence), audioCtx.currentTime);
  }, 250);
  const audio = destination.stream.getAudioTracks()[0];
  if (!audio) throw new Error('audio destination produced no track');

  return {
    get video() {
      return video;
    },
    audio,
    current: () => ({ frameSerial, toneSequence }),
    replaceVideo: () => {
      video.stop();
      video = firstVideoTrack();
      return video;
    },
    stop: () => {
      clearInterval(frameTimer);
      clearInterval(toneTimer);
      oscillator.stop();
      void audioCtx.close();
      video.stop();
      audio.stop();
    },
  };
}
