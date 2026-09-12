import { unitGain } from './audio-preferences';

export interface AudioDiagnostics {
  playTestTone(volume: number): boolean;
  setTestToneVolume(volume: number): void;
  stopTestTone(): void;
  microphoneLevel(track: MediaStreamTrack | null): number | null;
  readonly testTonePlaying: boolean;
  dispose(): void;
}

/** The existing device Context owns this helper. No extra capture, destination for the mic, or recording. */
export function createAudioDiagnostics(context: AudioContext): AudioDiagnostics {
  let disposed = false;
  let tone: { oscillator: OscillatorNode; gain: GainNode; until: number } | null = null;
  let microphone: MediaStreamTrack | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let analyser: AnalyserNode | null = null;
  const samples = new Uint8Array(1024);
  const releaseMicrophone = () => {
    source?.disconnect();
    analyser?.disconnect();
    source = null;
    analyser = null;
    microphone = null;
    samples.fill(128);
  };
  const stopTestTone = () => {
    const old = tone;
    tone = null;
    if (!old) return;
    old.oscillator.onended = null;
    try {
      old.oscillator.stop();
    } catch {
      /* Already ended. */
    }
    old.oscillator.disconnect();
    old.gain.disconnect();
  };
  const setTestToneVolume = (volume: number) => {
    if (!tone || disposed) return;
    const gain = tone.gain.gain;
    gain.cancelScheduledValues(context.currentTime);
    gain.setValueAtTime(unitGain(volume) * 0.08, context.currentTime);
    gain.linearRampToValueAtTime(0, Math.max(context.currentTime, tone.until));
  };
  return {
    playTestTone(volume) {
      if (disposed || context.state !== 'running' || unitGain(volume) === 0) return false;
      stopTestTone();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const until = context.currentTime + 0.35;
      oscillator.frequency.value = 660;
      gain.gain.setValueAtTime(0, context.currentTime);
      gain.gain.linearRampToValueAtTime(unitGain(volume) * 0.08, context.currentTime + 0.01);
      gain.gain.linearRampToValueAtTime(0, until);
      oscillator.connect(gain);
      gain.connect(context.destination);
      const owned = { oscillator, gain, until };
      tone = owned;
      oscillator.onended = () => {
        if (tone === owned) stopTestTone();
      };
      try {
        oscillator.start();
        oscillator.stop(until);
      } catch {
        stopTestTone();
        return false;
      }
      return true;
    },
    setTestToneVolume,
    stopTestTone,
    microphoneLevel(track) {
      if (disposed) return null;
      if (track !== microphone || track?.readyState !== 'live' || context.state !== 'running')
        releaseMicrophone();
      if (!track || track.readyState !== 'live' || context.state !== 'running') return null;
      if (!analyser) {
        try {
          source = context.createMediaStreamSource(new MediaStream([track]));
          analyser = context.createAnalyser();
          analyser.fftSize = samples.length;
          source.connect(analyser); // Intentionally no connection to an output destination.
          microphone = track;
        } catch {
          releaseMicrophone();
          return null;
        }
      }
      analyser.getByteTimeDomainData(samples);
      let square = 0;
      for (const value of samples) square += ((value - 128) / 128) ** 2;
      return unitGain(Math.sqrt(square / samples.length));
    },
    get testTonePlaying() {
      return tone !== null;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopTestTone();
      releaseMicrophone();
    },
  };
}
