import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAudioDiagnostics } from './audio-diagnostics';

function harness() {
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  const parameter = () => ({
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  });
  const context = {
    state: 'running',
    currentTime: 5,
    destination: node(),
    createOscillator: vi.fn(() => ({
      ...node(),
      frequency: { value: 0 },
      start: vi.fn(),
      stop: vi.fn(),
      onended: null as (() => void) | null,
    })),
    createGain: vi.fn(() => ({ ...node(), gain: parameter() })),
    createMediaStreamSource: vi.fn(() => node()),
    createAnalyser: vi.fn(() => ({
      ...node(),
      fftSize: 0,
      getByteTimeDomainData: (samples: Uint8Array) => samples.fill(160),
    })),
  };
  vi.stubGlobal(
    'MediaStream',
    class {
      constructor(readonly tracks: MediaStreamTrack[]) {}
    },
  );
  return { context, diagnostics: createAudioDiagnostics(context as unknown as AudioContext) };
}
afterEach(() => vi.unstubAllGlobals());

describe('audio diagnostics owned by the existing device context', () => {
  it('uses one bounded tone and releases replaced, ended and disposed nodes', () => {
    const { context, diagnostics } = harness();
    expect(diagnostics.playTestTone(0.5)).toBe(true);
    const first = context.createOscillator.mock.results[0]!.value;
    const gain = context.createGain.mock.results[0]!.value;
    expect(first.stop).toHaveBeenCalledWith(5.35);
    expect(first.frequency.value).toBe(660);
    expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.04, 5.01);
    diagnostics.setTestToneVolume(0);
    expect(gain.gain.setValueAtTime).toHaveBeenLastCalledWith(0, 5);
    expect(diagnostics.playTestTone(1)).toBe(true);
    expect(first.disconnect).toHaveBeenCalledOnce();
    expect(gain.disconnect).toHaveBeenCalledOnce();
    const second = context.createOscillator.mock.results[1]!.value;
    second.onended!();
    expect(diagnostics.testTonePlaying).toBe(false);
    expect(second.disconnect).toHaveBeenCalledOnce();
    diagnostics.playTestTone(0.5);
    diagnostics.dispose();
    diagnostics.dispose();
    expect(diagnostics.playTestTone(1)).toBe(false);
    expect(context.createOscillator).toHaveBeenCalledTimes(3);
    expect(context.createOscillator.mock.results[2]!.value.disconnect).toHaveBeenCalledOnce();
  });

  it('measures only the borrowed microphone and disconnects on source loss or suspension', () => {
    const { context, diagnostics } = harness();
    const first = { readyState: 'live', stop: vi.fn() } as unknown as MediaStreamTrack;
    const second = { readyState: 'live', stop: vi.fn() } as unknown as MediaStreamTrack;
    expect(diagnostics.microphoneLevel(first)).toBe(0.25);
    expect(diagnostics.microphoneLevel(first)).toBe(0.25);
    expect(context.createMediaStreamSource).toHaveBeenCalledOnce();
    const source = context.createMediaStreamSource.mock.results[0]!.value;
    const analyser = context.createAnalyser.mock.results[0]!.value;
    expect(source.connect).toHaveBeenCalledWith(analyser);
    expect(analyser.connect).not.toHaveBeenCalled();
    diagnostics.microphoneLevel(second);
    expect(source.disconnect).toHaveBeenCalledOnce();
    expect(analyser.disconnect).toHaveBeenCalledOnce();
    context.state = 'suspended';
    expect(diagnostics.microphoneLevel(second)).toBe(null);
    expect(
      context.createMediaStreamSource.mock.results[1]!.value.disconnect,
    ).toHaveBeenCalledOnce();
    context.state = 'running';
    diagnostics.microphoneLevel(second);
    diagnostics.microphoneLevel(null);
    diagnostics.dispose();
    expect(
      context.createMediaStreamSource.mock.results[2]!.value.disconnect,
    ).toHaveBeenCalledOnce();
    expect(first.stop).not.toHaveBeenCalled();
    expect(second.stop).not.toHaveBeenCalled();
    expect(diagnostics.microphoneLevel(first)).toBe(null);
  });

  it('does not generate sound for a suspended context or zero and nonfinite volume', () => {
    const { context, diagnostics } = harness();
    context.state = 'suspended';
    expect(diagnostics.playTestTone(1)).toBe(false);
    context.state = 'running';
    expect(diagnostics.playTestTone(0)).toBe(false);
    expect(diagnostics.playTestTone(NaN)).toBe(false);
    expect(context.createOscillator).not.toHaveBeenCalled();
  });
});
