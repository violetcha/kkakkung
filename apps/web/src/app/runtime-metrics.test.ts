import { describe, expect, it } from 'vitest';

import type { FrameMetrics } from '../features/game/scene/FrameMetrics';
import type { MediaStatus, SensorSnapshot } from '../features/input/InteractionRuntime';
import { createRuntimeMetrics, metricsRequested, publishRuntimeMetrics } from './runtime-metrics';

function clock(start = 1000) {
  let value = start;
  return {
    now: () => value,
    advance(ms: number) {
      value += ms;
    },
  };
}

function frame(fps: number, p95Ms = 20): FrameMetrics {
  return { fps, p95Ms, draws: 12, triangles: 3400, geometries: 40, textures: 9 };
}

/** One snapshot carrying a face result of the given frame and latency. */
function sensors(frameId: number, sampledAtMs: number, receivedAtMs: number): SensorSnapshot {
  return {
    runtimeGeneration: 1,
    emittedAtMs: receivedAtMs,
    face: { frameId, sampledAtMs, receivedAtMs, status: 'valid', data: null as never },
    pose: null,
    gesture: null,
  };
}

function media(state: MediaStatus['state'], code: string | null = null): MediaStatus {
  return { matchId: 'm1', mediaInstanceId: 'mi1', receiverGeneration: 1, state, code };
}

describe('product runtime metrics', () => {
  it('records nothing before a match opens a bucket', () => {
    const time = clock();
    const metrics = createRuntimeMetrics(time);
    metrics.recordRender(frame(60));
    metrics.recordSensors(sensors(1, 100, 130));
    metrics.recordMedia(media('connected'));
    expect(metrics.report().matches).toEqual([]);
  });

  it('summarises render, inference and the WebRTC timeline per match', () => {
    const time = clock();
    const metrics = createRuntimeMetrics(time);
    metrics.startMatch('match-1');
    metrics.recordMedia(media('connecting'));
    time.advance(500);
    metrics.recordMedia(media('connected'));
    metrics.recordFaceTrack(true);
    for (const fps of [60, 50, 45, 30]) {
      metrics.recordRender(frame(fps, fps === 30 ? 90 : 18));
      time.advance(1000);
    }
    metrics.recordSensors(sensors(1, 100, 130));
    metrics.recordSensors(sensors(2, 200, 215));
    metrics.endMatch();

    const [match] = metrics.report().matches;
    expect(match?.matchId).toBe('match-1');
    expect(match?.endedAtMs).not.toBeNull();
    expect(match?.render).toMatchObject({ count: 4, p50: 50, max: 60 });
    expect(match?.longestFrameMs).toBe(90);
    expect(match?.lastResources).toEqual({
      draws: 12,
      triangles: 3400,
      geometries: 40,
      textures: 9,
    });
    expect(match?.inference.face).toMatchObject({ count: 2, max: 30, p50: 30 });
    expect(match?.media.map((event) => event.kind)).toEqual([
      'state',
      'state',
      'face-track-attached',
    ]);
    expect(match?.media[1]).toMatchObject({ state: 'connected', atMs: 1500 });
  });

  it('counts one inference per frame however often a snapshot repeats it', () => {
    const time = clock();
    const metrics = createRuntimeMetrics(time);
    metrics.startMatch('match-1');
    const repeated = sensors(7, 100, 140);
    metrics.recordSensors(repeated);
    metrics.recordSensors(repeated);
    metrics.recordSensors({ ...repeated, emittedAtMs: 200 });
    metrics.recordSensors(sensors(8, 200, 260));
    expect(metrics.report().matches[0]?.inference.face).toMatchObject({ count: 2, max: 60 });
  });

  it('keeps repeated matches apart and drops the oldest past the cap', () => {
    const time = clock();
    const metrics = createRuntimeMetrics(time);
    for (let i = 1; i <= 10; i += 1) {
      metrics.startMatch(`match-${i}`);
      metrics.recordRender(frame(50 + i));
      metrics.endMatch();
    }
    const report = metrics.report();
    expect(report.matches).toHaveLength(8);
    expect(report.matches[0]?.matchId).toBe('match-3');
    expect(report.droppedMatches).toBe(2);
    // Each bucket carries only its own samples.
    expect(report.matches.at(-1)?.render).toMatchObject({ count: 1, max: 60 });
  });

  it('closes the open match when the next one starts without an end', () => {
    const time = clock();
    const metrics = createRuntimeMetrics(time);
    metrics.startMatch('match-1');
    time.advance(1000);
    metrics.startMatch('match-2');
    const [first, second] = metrics.report().matches;
    expect(first?.endedAtMs).toBe(2000);
    expect(second?.endedAtMs).toBeNull();
    // The same id twice is the same match, not a new bucket.
    metrics.startMatch('match-2');
    expect(metrics.report().matches).toHaveLength(2);
  });

  it('collapses an unchanged media state and keeps real transitions', () => {
    const time = clock();
    const metrics = createRuntimeMetrics(time);
    metrics.startMatch('match-1');
    metrics.recordMedia(media('connected'));
    metrics.recordMedia(media('connected'));
    metrics.recordMedia(media('recovering', 'STALE_GENERATION'));
    metrics.recordMedia(media('connected'));
    expect(metrics.report().matches[0]?.media.map((event) => event.state)).toEqual([
      'connected',
      'recovering',
      'connected',
    ]);
  });

  it('stops recording and empties itself when disposed', () => {
    const time = clock();
    const metrics = createRuntimeMetrics(time);
    metrics.startMatch('match-1');
    metrics.recordRender(frame(60));
    metrics.dispose();
    metrics.startMatch('match-2');
    metrics.recordRender(frame(30));
    expect(metrics.report().matches).toEqual([]);
  });

  it('turns on only for an explicit metrics flag', () => {
    expect(metricsRequested('?metrics=1')).toBe(true);
    expect(metricsRequested('?room=abc&metrics=1')).toBe(true);
    expect(metricsRequested('')).toBe(false);
    expect(metricsRequested('?metrics=0')).toBe(false);
    expect(metricsRequested('?metrics=true')).toBe(false);
  });

  it('publishes a read-only accessor and removes it again', () => {
    const time = clock();
    const metrics = createRuntimeMetrics(time);
    const host: Record<string, unknown> = {};
    const remove = publishRuntimeMetrics(host, metrics);
    const exposed = host.__kkakkungMetrics as { read(): { matches: readonly unknown[] } };
    metrics.startMatch('match-1');
    metrics.recordRender(frame(60));
    expect(exposed.read().matches).toHaveLength(1);
    remove();
    expect(host.__kkakkungMetrics).toBeUndefined();
  });
});
