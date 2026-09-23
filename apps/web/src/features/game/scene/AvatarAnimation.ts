import type { AvatarInstance } from './avatar-instance';

export type AvatarAnimationSample = Readonly<{
  clip: 'idle' | 'walk';
  time: number;
}>;

const activeClips = new WeakMap<AvatarInstance, 'idle' | 'walk'>();

export function avatarAnimationSample(
  stride: number | null,
  walkDuration: number,
): AvatarAnimationSample {
  if (stride === null || !Number.isFinite(stride)) return { clip: 'idle', time: 0 };
  const duration = Number.isFinite(walkDuration) && walkDuration > 0 ? walkDuration : 0;
  return { clip: 'walk', time: Math.min(1, Math.max(0, stride)) * duration };
}

function activate(instance: AvatarInstance, clip: 'idle' | 'walk') {
  if (activeClips.get(instance) === clip) return instance.actions[clip];
  const previous = activeClips.get(instance);
  if (previous) {
    instance.actions[previous].stop();
    instance.actions[previous].enabled = false;
  }
  const action = instance.actions[clip];
  action.enabled = true;
  action.reset().play();
  activeClips.set(instance, clip);
  return action;
}

export function applyAvatarAnimation(
  instance: AvatarInstance,
  stride: number | null,
  idleDeltaSeconds: number,
) {
  const sample = avatarAnimationSample(stride, instance.actions.walk.getClip().duration);
  const action = activate(instance, sample.clip);
  if (sample.clip === 'walk') {
    action.paused = true;
    action.time = sample.time;
    instance.mixer.update(0);
    return;
  }
  action.paused = false;
  const delta = Number.isFinite(idleDeltaSeconds) && idleDeltaSeconds > 0 ? idleDeltaSeconds : 0;
  instance.mixer.update(delta);
}
