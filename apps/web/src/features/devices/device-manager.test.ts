import { describe, expect, it, vi } from 'vitest';

import {
  CAMERA_CONSTRAINTS,
  createDeviceManager,
  MICROPHONE_CONSTRAINTS,
  type DeviceEnvironment,
} from './device-manager';
import { INITIAL_DEVICE_STATUS, type DeviceStatus } from './device-status';

type FakeTrack = {
  kind: string;
  readyState: string;
  stop: ReturnType<typeof vi.fn>;
  listeners: Map<string, () => void>;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  end(): void;
};

function track(kind: 'video' | 'audio'): FakeTrack {
  const listeners = new Map<string, () => void>();
  return {
    kind,
    readyState: 'live',
    stop: vi.fn(function (this: FakeTrack) {
      this.readyState = 'ended';
    }),
    listeners,
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type) => listeners.delete(type),
    end() {
      this.readyState = 'ended';
      listeners.get('ended')?.();
    },
  };
}

function stream(...tracks: FakeTrack[]) {
  return {
    tracks,
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter((item) => item.kind === 'video'),
    getAudioTracks: () => tracks.filter((item) => item.kind === 'audio'),
  } as unknown as MediaStream;
}

type Harness = {
  environment: DeviceEnvironment;
  statuses: DeviceStatus[];
  previews: (HTMLVideoElement | null)[];
  cameraTracks: (MediaStreamTrack | null)[];
  getUserMedia: ReturnType<typeof vi.fn>;
  createdElements: { srcObject: unknown; muted: boolean; playsInline: boolean }[];
  fireDeviceChange(): void;
  audio: { state: string; resume: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
};

function harness(getUserMedia: ReturnType<typeof vi.fn>): Harness {
  const statuses: DeviceStatus[] = [];
  const previews: (HTMLVideoElement | null)[] = [];
  const cameraTracks: (MediaStreamTrack | null)[] = [];
  const createdElements: { srcObject: unknown; muted: boolean; playsInline: boolean }[] = [];
  let deviceChange: (() => void) | null = null;
  const audio = {
    state: 'running',
    resume: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
  const environment: DeviceEnvironment = {
    getUserMedia: getUserMedia as unknown as DeviceEnvironment['getUserMedia'],
    createPreviewElement: () => {
      const element = {
        srcObject: null as unknown,
        muted: false,
        playsInline: false,
        autoplay: false,
        play: () => Promise.resolve(),
        pause: () => undefined,
      };
      createdElements.push(element);
      return element as unknown as HTMLVideoElement;
    },
    createAudioUnlock: () => audio,
    onDeviceChange: (listener) => {
      deviceChange = listener;
      return () => {
        deviceChange = null;
      };
    },
  };
  return {
    environment,
    statuses,
    previews,
    cameraTracks,
    getUserMedia,
    createdElements,
    fireDeviceChange: () => deviceChange?.(),
    audio,
  };
}

function manager(base: Harness) {
  return createDeviceManager({
    environment: base.environment,
    onStatus: (status) => base.statuses.push(status),
    onLocalPreview: (element) => base.previews.push(element),
    onCameraTrack: (value) => base.cameraTracks.push(value),
  });
}

describe('createDeviceManager', () => {
  it.each(['unopened', 'denied', 'ended', 'ready'] as const)(
    'changes only microphone when the camera is %s',
    async (cameraState) => {
      const video = track('video');
      const audio = track('audio');
      const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
        if (constraints.audio === true) return stream(audio);
        if (cameraState === 'denied')
          throw Object.assign(new Error('no'), { name: 'NotAllowedError' });
        return stream(video);
      });
      const base = harness(getUserMedia);
      const devices = manager(base);
      try {
        if (cameraState !== 'unopened') await devices.start({ microphone: false });
        if (cameraState === 'ended') video.end();
        const before = devices.getStatus();
        const source = devices.getCameraStream();
        getUserMedia.mockClear();
        await devices.setMicrophone(true);
        await devices.setMicrophone(false);
        expect(getUserMedia).toHaveBeenCalledExactlyOnceWith(MICROPHONE_CONSTRAINTS);
        expect(devices.getStatus()).toMatchObject({
          camera: before.camera,
          calibration: before.calibration,
          microphone: 'off',
        });
        expect(devices.getCameraStream()).toBe(source);
        expect(audio.stop).toHaveBeenCalledOnce();
        if (cameraState === 'ready') expect(video.stop).not.toHaveBeenCalled();
      } finally {
        await devices.dispose();
      }
    },
  );

  it('stops a microphone arriving after disable and never acquires a camera', async () => {
    const audio = track('audio');
    let finish!: (stream: MediaStream) => void;
    const getUserMedia = vi.fn(
      () =>
        new Promise<MediaStream>((resolve) => {
          finish = resolve;
        }),
    );
    const base = harness(getUserMedia);
    const devices = manager(base);
    try {
      const pending = devices.setMicrophone(true);
      await devices.setMicrophone(false);
      finish(stream(audio));
      await pending;
      expect(audio.stop).toHaveBeenCalledOnce();
      expect(devices.getStatus().microphone).toBe('off');
      expect(getUserMedia).toHaveBeenCalledExactlyOnceWith(MICROPHONE_CONSTRAINTS);
      expect(base.createdElements).toHaveLength(0);
    } finally {
      await devices.dispose();
    }
  });
  it('acquires the camera once for two concurrent start calls', async () => {
    const video = track('video');
    const getUserMedia = vi.fn(async () => stream(video));
    const base = harness(getUserMedia);
    const devices = manager(base);

    const [first, second] = await Promise.all([
      devices.start({ microphone: false }),
      devices.start({ microphone: false }),
    ]);

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith(CAMERA_CONSTRAINTS);
    expect(first.camera).toBe('ready');
    expect(second.camera).toBe('ready');
    expect(devices.getCameraStream()).not.toBeNull();
    expect(video.stop).not.toHaveBeenCalled();
    expect(video.readyState).toBe('live');
  });

  it('requests the camera and the microphone as separate permissions', async () => {
    const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) =>
      constraints.audio === true ? stream(track('audio')) : stream(track('video')),
    );
    const base = harness(getUserMedia);

    await manager(base).start({ microphone: true });

    expect(getUserMedia.mock.calls.map(([value]) => value)).toEqual([
      CAMERA_CONSTRAINTS,
      MICROPHONE_CONSTRAINTS,
    ]);
  });

  it('keeps the camera ready when the microphone is denied', async () => {
    const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
      if (constraints.audio === true)
        throw Object.assign(new Error('no'), { name: 'NotAllowedError' });
      return stream(track('video'));
    });
    const base = harness(getUserMedia);

    const status = await manager(base).start({ microphone: true });

    expect(status.camera).toBe('ready');
    expect(status.microphone).toBe('denied');
    expect(status.errorCode).toBeNull();
  });

  it('reports a safe error code and no camera stream when the camera is refused', async () => {
    const getUserMedia = vi.fn(async () => {
      throw Object.assign(new Error('denied by user'), { name: 'NotAllowedError' });
    });
    const base = harness(getUserMedia);
    const devices = manager(base);

    const status = await devices.start({ microphone: false });

    expect(status.camera).toBe('failed');
    expect(status.errorCode).toBe('PERMISSION_DENIED');
    expect(JSON.stringify(status)).not.toContain('denied by user');
    expect(devices.getCameraStream()).toBeNull();
  });

  it('stops a late granted track after dispose and emits no ready callback', async () => {
    const video = track('video');
    let release!: (value: MediaStream) => void;
    const pending = new Promise<MediaStream>((resolve) => {
      release = resolve;
    });
    const getUserMedia = vi.fn(() => pending);
    const base = harness(getUserMedia);
    const devices = manager(base);

    const starting = devices.start({ microphone: false });
    await devices.dispose();
    release(stream(video));
    await starting;

    expect(video.stop).toHaveBeenCalledTimes(1);
    expect(devices.getCameraStream()).toBeNull();
    expect(base.statuses.some((status) => status.camera === 'ready')).toBe(false);
    expect(base.previews).not.toContain(expect.anything());
  });

  it('sends the null preview before releasing the element and the tracks', async () => {
    const video = track('video');
    const base = harness(vi.fn(async () => stream(video)));
    const devices = manager(base);
    await devices.start({ microphone: false });

    expect(base.previews).toHaveLength(1);
    expect(base.previews[0]).not.toBeNull();
    const element = base.createdElements[0]!;
    expect(element.muted).toBe(true);
    expect(element.playsInline).toBe(true);
    expect(element.srcObject).not.toBeNull();

    const order: string[] = [];
    video.stop.mockImplementation(() => order.push('stop'));
    const previewIndex = base.previews.length;
    await devices.dispose();

    expect(base.previews[previewIndex]).toBeNull();
    expect(element.srcObject).toBeNull();
    expect(order).toEqual(['stop']);
  });

  it('clears the preview and reports the loss when the camera track ends', async () => {
    const video = track('video');
    const base = harness(vi.fn(async () => stream(video)));
    const devices = manager(base);
    await devices.start({ microphone: false });

    video.end();

    expect(base.previews.at(-1)).toBeNull();
    expect(base.cameraTracks.at(-1)).toBeNull();
    expect(devices.getStatus().camera).toBe('failed');
    expect(devices.getStatus().errorCode).toBe('DEVICE_LOST');
  });

  it('closes the microphone on a later start with microphone false and keeps the camera', async () => {
    const audioTrack = track('audio');
    const videoTrack = track('video');
    const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) =>
      constraints.audio === true ? stream(audioTrack) : stream(videoTrack),
    );
    const base = harness(getUserMedia);
    const devices = manager(base);
    await devices.start({ microphone: true });
    expect(devices.getMicrophoneTrack()).not.toBeNull();

    const status = await devices.start({ microphone: false });

    expect(audioTrack.stop).toHaveBeenCalledTimes(1);
    expect(videoTrack.stop).not.toHaveBeenCalled();
    expect(status.microphone).toBe('off');
    expect(status.camera).toBe('ready');
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it('marks audio playback ready only after the unlock resolves', async () => {
    const base = harness(vi.fn(async () => stream(track('video'))));
    expect(INITIAL_DEVICE_STATUS.audioPlayback).toBe('locked');

    const devices = manager(base);
    const status = await devices.start({ microphone: false });

    expect(base.audio.resume).toHaveBeenCalledTimes(1);
    expect(status.audioPlayback).toBe('ready');
    await devices.dispose();
    expect(base.audio.close).toHaveBeenCalledTimes(1);
  });

  it('emits no status callback after dispose completes', async () => {
    const base = harness(vi.fn(async () => stream(track('video'))));
    const devices = manager(base);
    await devices.start({ microphone: false });
    await devices.dispose();
    const seen = base.statuses.length;

    devices.patchStatus({ vision: 'ready' });
    await devices.start({ microphone: true });
    await devices.dispose();

    expect(base.statuses).toHaveLength(seen);
    expect(devices.disposed).toBe(true);
  });

  it('retries the same output Context and rejects a resolved but still suspended resume', async () => {
    const base = harness(vi.fn(async () => stream(track('video'))));
    base.audio.state = 'suspended';
    base.audio.resume.mockRejectedValueOnce(new Error('locked'));
    const devices = manager(base);
    expect((await devices.start({ microphone: false })).audioPlayback).toBe('failed');
    expect((await devices.start({ microphone: false })).audioPlayback).toBe('locked');
    base.audio.state = 'running';
    expect((await devices.start({ microphone: false })).audioPlayback).toBe('ready');
    expect(base.audio.resume).toHaveBeenCalledTimes(3);
    await devices.dispose();
    await devices.dispose();
    expect(base.audio.close).toHaveBeenCalledOnce();
  });

  it('does not resurrect audio readiness after a late resume completes on a disposed owner', async () => {
    const base = harness(vi.fn(async () => stream(track('video'))));
    let resolve!: () => void;
    base.audio.resume.mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const devices = manager(base);
    const starting = devices.start({ microphone: false });
    await devices.dispose();
    const seen = base.statuses.length;
    resolve();
    await starting;
    expect(base.statuses).toHaveLength(seen);
    expect(base.audio.close).toHaveBeenCalledOnce();
  });

  it('drops an ended microphone reference and acquires a fresh optional source', async () => {
    const video = track('video');
    const first = track('audio');
    const second = track('audio');
    let requests = 0;
    const base = harness(
      vi.fn(async (constraints: MediaStreamConstraints) =>
        constraints.audio ? stream(requests++ === 0 ? first : second) : stream(video),
      ),
    );
    const devices = manager(base);
    await devices.start({ microphone: true });
    first.end();
    expect(devices.getStatus()).toMatchObject({ microphone: 'failed', camera: 'ready' });
    expect(devices.getMicrophoneTrack()).toBeNull();
    await devices.start({ microphone: true });
    expect(devices.getMicrophoneTrack()).toBe(second);
    expect(video.stop).not.toHaveBeenCalled();
    await devices.dispose();
  });

  it('does not re-enable a microphone when permission returns after the user turns it off', async () => {
    let finish!: (stream: MediaStream) => void;
    const audio = track('audio');
    const base = harness(
      vi.fn((constraints: MediaStreamConstraints) =>
        constraints.audio
          ? new Promise<MediaStream>((resolve) => {
              finish = resolve;
            })
          : Promise.resolve(stream(track('video'))),
      ),
    );
    const devices = manager(base);
    const pending = devices.start({ microphone: true });
    await devices.start({ microphone: false });
    finish(stream(audio));
    await pending;
    expect(devices.getMicrophoneTrack()).toBeNull();
    expect(devices.getStatus().microphone).toBe('off');
    expect(audio.stop).toHaveBeenCalledOnce();
    await devices.dispose();
  });

  it('settles a pending device check on dispose and closes a later permission result', async () => {
    let finish!: (stream: MediaStream) => void;
    const video = track('video');
    const base = harness(
      vi.fn(
        () =>
          new Promise<MediaStream>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const devices = manager(base);
    const pending = devices.start({ microphone: false });
    await devices.dispose();
    await pending;
    finish(stream(video));
    await vi.waitFor(() => expect(video.stop).toHaveBeenCalledOnce());
    expect(devices.getCameraStream()).toBeNull();
  });

  it('allows another click after an audio resume never settles', async () => {
    vi.useFakeTimers();
    const base = harness(vi.fn(async () => stream(track('video'))));
    base.audio.resume.mockImplementationOnce(() => new Promise<void>(() => {}));
    const devices = manager(base);
    try {
      const pending = devices.start({ microphone: false });
      await vi.advanceTimersByTimeAsync(3000);
      expect((await pending).audioPlayback).toBe('failed');
      expect((await devices.start({ microphone: false })).audioPlayback).toBe('ready');
    } finally {
      await devices.dispose();
      vi.useRealTimers();
    }
  });
});
