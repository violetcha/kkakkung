import { describe, expect, it } from 'vitest';

import {
  causeForErrorCode,
  createReadinessRecorder,
  describeBrowser,
  describeClientEnvironment,
  READINESS_BUDGET_MS,
  READINESS_STAGES,
  type ReadinessStage,
  type ReadinessTrace,
} from './readiness-trace';

function stageOf(trace: ReadinessTrace, stage: ReadinessStage) {
  const record = trace.stages.find((value) => value.stage === stage);
  if (!record) throw new Error(`missing stage ${stage}`);
  return record;
}

describe('createReadinessRecorder', () => {
  it('starts with every stage pending and no elapsed time', () => {
    const trace = createReadinessRecorder().snapshot(1000);

    expect(trace.stages.map((record) => record.stage)).toEqual([...READINESS_STAGES]);
    expect(trace.stages.every((record) => record.state === 'pending')).toBe(true);
    expect(trace.startedAtMs).toBeNull();
    expect(trace.elapsedMs).toBe(0);
    expect(trace.blockedStage).toBeNull();
    expect(trace.cause).toBeNull();
  });

  it('measures a finished stage from its own start', () => {
    const recorder = createReadinessRecorder();
    recorder.begin('permission', 1000);
    recorder.succeed('permission', 1450);

    const record = stageOf(recorder.snapshot(2000), 'permission');

    expect(record.state).toBe('done');
    expect(record.durationMs).toBe(450);
    expect(record.errorCode).toBeNull();
  });

  it('reports a running stage as the time elapsed so far', () => {
    const recorder = createReadinessRecorder();
    recorder.begin('device-open', 1000);

    expect(stageOf(recorder.snapshot(1600), 'device-open').durationMs).toBe(600);
    expect(stageOf(recorder.snapshot(2200), 'device-open').durationMs).toBe(1200);
  });

  it('names the running stage as the blocked one', () => {
    const recorder = createReadinessRecorder();
    recorder.begin('permission', 1000);
    recorder.succeed('permission', 1100);
    recorder.begin('model-load', 1100);

    expect(recorder.snapshot(1500).blockedStage).toBe('model-load');
  });

  it('separates the failure cause from a slow but healthy stage', () => {
    const denied = createReadinessRecorder();
    denied.begin('permission', 0);
    denied.fail('permission', 100, 'PERMISSION_DENIED');

    const busy = createReadinessRecorder();
    busy.begin('permission', 0);
    busy.fail('permission', 100, 'DEVICE_IN_USE');

    const slow = createReadinessRecorder();
    slow.begin('device-open', 0);

    expect(denied.snapshot(200).cause).toBe('permission-denied');
    expect(busy.snapshot(200).cause).toBe('device-in-use');
    // 예산 안에서는 느리다고 원인을 단정하지 않는다.
    expect(slow.snapshot(READINESS_BUDGET_MS).cause).toBeNull();
    expect(slow.snapshot(READINESS_BUDGET_MS + 1).cause).toBe('client-slow');
  });

  it('blames the model when the slow stage is the model load', () => {
    const recorder = createReadinessRecorder();
    recorder.begin('model-load', 0);

    const trace = recorder.snapshot(READINESS_BUDGET_MS + 1);

    expect(trace.cause).toBe('model-load');
    expect(trace.overBudget).toBe(true);
  });

  it('measures elapsed time from the first stage that started', () => {
    const recorder = createReadinessRecorder();
    recorder.begin('permission', 5000);
    recorder.succeed('permission', 5200);
    recorder.begin('device-open', 5200);

    const trace = recorder.snapshot(5900);

    expect(trace.startedAtMs).toBe(5000);
    expect(trace.elapsedMs).toBe(900);
  });

  it('keeps a failed stage as the cause even after a later stage starts', () => {
    const recorder = createReadinessRecorder();
    recorder.begin('permission', 0);
    recorder.fail('permission', 50, 'DEVICE_IN_USE');
    recorder.begin('model-load', 60);

    const trace = recorder.snapshot(100);

    expect(trace.blockedStage).toBe('permission');
    expect(trace.cause).toBe('device-in-use');
  });

  it('clears the previous error when a stage is retried', () => {
    const recorder = createReadinessRecorder();
    recorder.begin('permission', 0);
    recorder.fail('permission', 50, 'DEVICE_IN_USE');
    recorder.begin('permission', 100);
    recorder.succeed('permission', 180);

    const record = stageOf(recorder.snapshot(200), 'permission');

    expect(record.state).toBe('done');
    expect(record.errorCode).toBeNull();
    expect(record.durationMs).toBe(80);
  });

  it('does not invent a duration for a stage it never saw start', () => {
    const recorder = createReadinessRecorder();
    recorder.succeed('first-publish', 900);

    const record = stageOf(recorder.snapshot(1000), 'first-publish');

    expect(record.state).toBe('pending');
    expect(record.durationMs).toBeNull();
  });

  it('records a failure even when the start was missed', () => {
    const recorder = createReadinessRecorder();
    recorder.fail('first-publish', 900, 'PUBLISH_FAILED');

    const record = stageOf(recorder.snapshot(1000), 'first-publish');

    expect(record.state).toBe('failed');
    expect(record.durationMs).toBe(0);
  });

  it('forgets stages and environment on reset', () => {
    const recorder = createReadinessRecorder();
    recorder.begin('permission', 0);
    recorder.fail('permission', 10, 'PERMISSION_DENIED');
    recorder.setEnvironment(describeClientEnvironment({ userAgent: '', platform: 'Win32' }, null));
    recorder.reset();

    const trace = recorder.snapshot(100);

    expect(trace.stages.every((record) => record.state === 'pending')).toBe(true);
    expect(trace.environment).toBeNull();
    expect(trace.cause).toBeNull();
  });
});

describe('causeForErrorCode', () => {
  it('maps the four documented causes', () => {
    expect(causeForErrorCode('PERMISSION_DENIED')).toBe('permission-denied');
    expect(causeForErrorCode('DEVICE_IN_USE')).toBe('device-in-use');
    expect(causeForErrorCode('MODEL_LOAD_TIMEOUT')).toBe('model-load');
    expect(causeForErrorCode('PUBLISH_FAILED')).toBe('publish-failed');
  });

  it('says nothing when there is no error', () => {
    expect(causeForErrorCode(null)).toBeNull();
  });

  it('falls back to a client cause for an unrecognised code', () => {
    expect(causeForErrorCode('SOMETHING_ELSE')).toBe('client-slow');
  });
});

describe('describeBrowser', () => {
  it('prefers the specific browser over the engine it reports', () => {
    const edge =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0';
    const chrome =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
    const safari =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

    expect(describeBrowser(edge)).toEqual({ browser: 'Edge', browserVersion: '140' });
    expect(describeBrowser(chrome)).toEqual({ browser: 'Chrome', browserVersion: '140' });
    expect(describeBrowser(safari)).toEqual({ browser: 'Safari', browserVersion: '18' });
  });

  it('is explicit about not knowing', () => {
    expect(describeBrowser('')).toEqual({ browser: 'unknown', browserVersion: 'unknown' });
  });
});

describe('describeClientEnvironment', () => {
  it('collects the camera combination needed to reproduce a slow sample', () => {
    const track = {
      label: 'Integrated Webcam',
      getSettings: () => ({ width: 1280, height: 720, frameRate: 30 }),
    } as unknown as MediaStreamTrack;

    const environment = describeClientEnvironment(
      { userAgent: 'Mozilla/5.0 Firefox/131.0', platform: 'Win32' },
      track,
    );

    expect(environment).toEqual({
      browser: 'Firefox',
      browserVersion: '131',
      platform: 'Win32',
      cameraLabel: 'Integrated Webcam',
      cameraWidth: 1280,
      cameraHeight: 720,
      cameraFrameRate: 30,
    });
  });

  it('leaves the camera unknown before permission fills the label', () => {
    const track = { label: '', getSettings: () => ({}) } as unknown as MediaStreamTrack;

    const environment = describeClientEnvironment({ userAgent: '', platform: '' }, track);

    expect(environment.cameraLabel).toBeNull();
    expect(environment.cameraWidth).toBeNull();
  });

  it('survives a missing navigator and a missing track', () => {
    expect(describeClientEnvironment(null, null)).toMatchObject({
      browser: 'unknown',
      platform: 'unknown',
      cameraLabel: null,
    });
  });
});
