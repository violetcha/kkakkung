import { describe, expect, it } from 'vitest';
import { meshyAvatarAsset, meshyWalkSample } from './meshy-role-avatar';

describe('meshyAvatarAsset', () => {
  it('maps each game role to the approved Meshy model and Mixamo walk', () => {
    expect(meshyAvatarAsset('runner')).toMatchObject({
      model: '/models/avatars/meshy-preview/runner/runner_standard_walk_rigged.fbx',
      targetHeight: 1.55,
    });
    expect(meshyAvatarAsset('tagger')).toMatchObject({
      model: '/models/avatars/meshy-preview/tagger/tagger_orc_walk_rigged.fbx',
      targetHeight: 1.6,
    });
  });
});

describe('meshyWalkSample', () => {
  it('holds the first authored frame while the server actor is idle', () => {
    expect(meshyWalkSample(null, 1.2)).toEqual({ moving: false, time: 0 });
  });

  it('maps one server move to one complete Mixamo walk cycle', () => {
    expect(meshyWalkSample(0, 1.2)).toEqual({ moving: true, time: 0 });
    expect(meshyWalkSample(0.5, 1.2)).toEqual({ moving: true, time: 0.6 });
    expect(meshyWalkSample(1, 1.2)).toEqual({ moving: true, time: 1.2 });
  });

  it('clamps malformed progress without leaking non-finite animation time', () => {
    expect(meshyWalkSample(-1, 0.8)).toEqual({ moving: true, time: 0 });
    expect(meshyWalkSample(2, 0.8)).toEqual({ moving: true, time: 0.8 });
    expect(meshyWalkSample(Number.NaN, 0.8)).toEqual({ moving: false, time: 0 });
    expect(meshyWalkSample(0.5, Number.NaN)).toEqual({ moving: true, time: 0 });
  });
});
