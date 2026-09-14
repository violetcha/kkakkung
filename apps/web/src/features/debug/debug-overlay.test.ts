// 진단 오버레이 회귀: 피드 토글·단축키, 프레임 사각형, 그리기 호출, 진단 상태 계산, 손 landmarks.
// 캔버스는 기록용 가짜 컨텍스트로 대체한다. 제품 판정 코드는 건드리지 않는다.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { debugFeed, installDebugShortcut, DEBUG_OVERLAY_STORAGE_KEY } from './debug-feed';
import { drawDebugOverlay, readoutLines, HAND_CONNECTIONS, type Canvas2D } from './draw-debug';
import { frameRect } from './DebugOverlay';
import { describeMotionDebug } from '../input/motion-debug';
import { INPUT_TUNING } from '../input/input-tuning';
import { readGestureSensor, readHandLandmarks } from '../vision/gesture-sensor';
import { POSE_KEY_POINTS } from '../vision/pose-sensor';
import type { SensorSnapshot } from '../vision/sensor-types';

// Node 환경 시험: localStorage 를 메모리로 대체한다.
const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, String(value)),
  removeItem: (key: string) => storage.delete(key),
});

function fakeContext() {
  const calls: Record<string, number> = {};
  const texts: string[] = [];
  const count = (name: string) => {
    calls[name] = (calls[name] ?? 0) + 1;
  };
  const ctx = {
    lineWidth: 1,
    strokeStyle: '',
    fillStyle: '',
    font: '',
    textBaseline: 'top' as CanvasTextBaseline,
    clearRect: () => count('clearRect'),
    beginPath: () => count('beginPath'),
    moveTo: () => count('moveTo'),
    lineTo: () => count('lineTo'),
    stroke: () => count('stroke'),
    arc: () => count('arc'),
    fill: () => count('fill'),
    fillRect: () => count('fillRect'),
    strokeRect: () => count('strokeRect'),
    fillText: (text: string) => {
      texts.push(text);
      count('fillText');
    },
  } satisfies Canvas2D;
  return { ctx, calls, texts };
}

function pose() {
  const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
  points[POSE_KEY_POINTS.nose] = { x: 0.5, y: 0.1, z: 0, visibility: 1 };
  points[POSE_KEY_POINTS.leftShoulder] = { x: 0.4, y: 0.3, z: 0, visibility: 1 };
  points[POSE_KEY_POINTS.rightShoulder] = { x: 0.6, y: 0.3, z: 0, visibility: 1 };
  points[POSE_KEY_POINTS.leftWrist] = { x: 0.4, y: 0.6, z: 0, visibility: 0.1 };
  return points;
}

function snapshot(nowMs = 1000): SensorSnapshot {
  const sample = { frameId: 1, sampledAtMs: nowMs - 50, receivedAtMs: nowMs - 40 };
  return {
    runtimeGeneration: 1,
    emittedAtMs: nowMs,
    face: {
      ...sample,
      status: 'valid',
      data: {
        landmarks: Array.from({ length: 478 }, (_, i) => ({ x: (i % 20) / 20, y: 0.2, z: 0 })),
        yawRad: 0.3,
        quality: 'valid',
      },
    },
    pose: { ...sample, status: 'valid', data: { landmarks: pose(), quality: 'valid' } },
    gesture: {
      ...sample,
      status: 'valid',
      data: {
        kind: 'palm',
        score: 0.9,
        hands: [Array.from({ length: 21 }, (_, i) => ({ x: i / 21, y: 0.8, z: 0 }))],
      },
    },
  };
}

afterEach(() => {
  debugFeed.setEnabled(false);
  debugFeed.clear();
  localStorage.removeItem(DEBUG_OVERLAY_STORAGE_KEY);
});

describe('debug feed', () => {
  it('toggles, persists the choice and notifies subscribers', () => {
    const listener = vi.fn();
    const unsubscribe = debugFeed.subscribe(listener);
    expect(debugFeed.isEnabled()).toBe(false);
    debugFeed.toggle();
    expect(debugFeed.isEnabled()).toBe(true);
    expect(localStorage.getItem(DEBUG_OVERLAY_STORAGE_KEY)).toBe('1');
    expect(listener).toHaveBeenCalledTimes(1);
    debugFeed.setEnabled(true); // no change, no notification
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('Ctrl+Shift+D toggles except inside text inputs', () => {
    const handlers = new Map<string, EventListener>();
    const target = {
      addEventListener: (type: string, handler: EventListener) => handlers.set(type, handler),
      removeEventListener: (type: string) => handlers.delete(type),
    };
    const stop = installDebugShortcut(target as unknown as Window);
    const press = (init: Partial<KeyboardEvent> & { target?: unknown }) => {
      const event = {
        ctrlKey: true,
        shiftKey: true,
        code: 'KeyD',
        preventDefault: vi.fn(),
        target: { tagName: 'DIV' },
        ...init,
      };
      handlers.get('keydown')!(event as unknown as Event);
      return event;
    };
    press({});
    expect(debugFeed.isEnabled()).toBe(true);
    press({ target: { tagName: 'INPUT' } });
    expect(debugFeed.isEnabled()).toBe(true);
    press({ code: 'KeyE' });
    expect(debugFeed.isEnabled()).toBe(true);
    press({});
    expect(debugFeed.isEnabled()).toBe(false);
    stop();
    expect(handlers.size).toBe(0);
  });
});

describe('frameRect', () => {
  it('centers a 4:3 frame inside a wider video box (object-fit: contain)', () => {
    const host = { left: 10, top: 20, width: 400, height: 300 } as DOMRect;
    const video = { left: 10, top: 20, width: 400, height: 200 } as DOMRect;
    const rect = frameRect(host, video, { width: 640, height: 480 });
    expect(rect.height).toBeCloseTo(200);
    expect(rect.width).toBeCloseTo(266.67, 1);
    expect(rect.left).toBeCloseTo((400 - 266.67) / 2, 1);
    expect(rect.top).toBe(0);
  });
  it('falls back to the video box before the frame size is known', () => {
    const host = { left: 0, top: 0, width: 100, height: 100 } as DOMRect;
    const video = { left: 5, top: 7, width: 90, height: 60 } as DOMRect;
    expect(frameRect(host, video, { width: 0, height: 0 })).toEqual({
      left: 5,
      top: 7,
      width: 90,
      height: 60,
    });
  });
});

describe('drawDebugOverlay', () => {
  it('draws face dots, the shoulder skeleton, one hand and the gauges; numbers go to the readout', () => {
    const { ctx, calls } = fakeContext();
    const s = snapshot();
    const motion = describeMotionDebug({
      snapshot: s,
      nowMs: 1000,
      neutral: {
        yawRad: 0.1,
        shoulderSpan: Math.log(0.25),
        faceSpan: null,
        tuningVersion: INPUT_TUNING.tuningVersion,
        runtimeGeneration: 1,
        sampleCount: 8,
      },
      neutralUsable: true,
      tuning: INPUT_TUNING,
      move: 'back',
      motionActive: true,
      turnLatched: false,
      mode: 'motion',
      accepting: true,
    });
    debugFeed.publishSensors(s);
    debugFeed.publishMotion(motion);
    const drawn = drawDebugOverlay(ctx, 320, 240, debugFeed.read(), { mirrored: true });
    expect(calls.clearRect).toBe(1);
    // 478/4 face dots + key points + pose dots + 21 hand dots
    expect(calls.arc).toBeGreaterThan(120 + 21);
    // shoulder line + 4 arm lines + nose axis + 21 hand connections
    expect(calls.stroke).toBe(6 + HAND_CONNECTIONS.length);
    expect(drawn).toBeGreaterThan(150);
    expect(calls.fillText ?? 0).toBe(0); // 캔버스에는 글자를 그리지 않는다
    expect(calls.fillRect).toBeGreaterThan(4); // 게이지 두 줄
    const panel = readoutLines(debugFeed.read(), 1000).join('\n');
    expect(panel).toContain('앞뒤 lean 상대 -0.223 = 평균(어깨 -0.223 · 얼굴 -)');
    expect(panel).toContain('좌우 yaw 상대 11.5°');
    expect(panel).toContain('이동 back (모션)');
    expect(panel).not.toContain('이동 차단'); // yaw 11.5° < 회전 해제 12°
    expect(panel).toContain('손 palm 0.90 (1개)');
  });

  it('renders only empty gauges when nothing has been published yet', () => {
    const { ctx, calls } = fakeContext();
    debugFeed.clear();
    drawDebugOverlay(ctx, 320, 240, debugFeed.read());
    expect(calls.arc ?? 0).toBe(0);
    expect(calls.fillRect).toBeGreaterThan(0);
    const lines = readoutLines(debugFeed.read(), 0);
    expect(lines[0]).toContain('갱신 -');
    expect(lines.some((t) => t.includes('보정 없음'))).toBe(true);
  });
});

describe('describeMotionDebug', () => {
  it('reports raw signals before calibration and relative ones after', () => {
    const s = snapshot();
    const before = describeMotionDebug({
      snapshot: s,
      nowMs: 1000,
      neutral: null,
      neutralUsable: false,
      tuning: INPUT_TUNING,
      move: null,
      motionActive: false,
      turnLatched: false,
      mode: null,
      accepting: false,
    });
    expect(before.calibrated).toBe(false);
    expect(before.components.shoulder).toBeCloseTo(Math.log(0.2), 6);
    expect(before.components.face).toBeNull(); // 합성 얼굴은 뺨 두 점이 같은 x 라 거리 0
    expect(before.yawRaw).toBeCloseTo(0.3, 6);
    expect(before.leanRelative).toBeNull();
    expect(before.yawRelative).toBeNull();
    expect(before.thresholds.forwardEnter).toBe(INPUT_TUNING.forwardEnterRad);
    expect(before.leanGatedByYaw).toBe(false);
    // Head turned well past the turn-exit threshold: movement is reported as gated.
    const turned = describeMotionDebug({
      snapshot: s,
      nowMs: 1000,
      neutral: {
        yawRad: -0.3,
        shoulderSpan: Math.log(0.2),
        faceSpan: null,
        tuningVersion: INPUT_TUNING.tuningVersion,
        runtimeGeneration: 1,
        sampleCount: 8,
      },
      neutralUsable: true,
      tuning: INPUT_TUNING,
      move: null,
      motionActive: false,
      turnLatched: false,
      mode: 'motion',
      accepting: true,
    });
    expect(turned.yawRelative).toBeCloseTo(0.6, 6);
    expect(turned.leanGatedByYaw).toBe(true);
    // Stale pose (older than 300ms) is not usable, so the raw lean disappears too.
    const stale = describeMotionDebug({
      snapshot: s,
      nowMs: 2000,
      neutral: null,
      neutralUsable: false,
      tuning: INPUT_TUNING,
      move: null,
      motionActive: false,
      turnLatched: false,
      mode: 'motion',
      accepting: true,
    });
    expect(stale.poseUsable).toBe(false);
    expect(stale.components.shoulder).toBeNull();
  });
});

describe('hand landmarks in the gesture sensor', () => {
  it('keeps finite hands for the overlay and omits the field when the SDK sends none', () => {
    const hand = Array.from({ length: 21 }, (_, i) => ({ x: i / 21, y: 0.5, z: 0 }));
    expect(readHandLandmarks(undefined)).toBeUndefined();
    expect(readHandLandmarks([])).toBeUndefined();
    expect(readHandLandmarks([hand, [{ x: Number.NaN, y: 0, z: 0 }]])).toHaveLength(1);
    const withHands = readGestureSensor({
      gestures: [[{ categoryName: 'Open_Palm', score: 0.9 }]],
      landmarks: [hand],
    });
    expect(withHands).toMatchObject({ status: 'valid', data: { kind: 'palm', score: 0.9 } });
    expect(withHands.data?.hands).toHaveLength(1);
    const without = readGestureSensor({ gestures: [[{ categoryName: 'Open_Palm', score: 0.9 }]] });
    expect(Object.keys(without.data!).sort()).toEqual(['kind', 'score']);
  });
});
