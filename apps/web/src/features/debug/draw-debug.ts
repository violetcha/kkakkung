// 캔버스에 추적 결과를 그린다. 얼굴 점, 상체 스켈레톤(코·어깨·팔꿈치·손목), 손 스켈레톤,
// 기울기/회전 수치와 임계 게이지. 좌표는 비미러 카메라 프레임 기준(미리보기 video 와 같다).
import { FACE_KEY_POINTS } from '../vision/face-sensor';
import { POSE_KEY_POINTS, POSE_MIN_VISIBILITY } from '../vision/pose-sensor';
import type { SensorSnapshot } from '../vision/sensor-types';
import type { DebugFeedState } from './debug-feed';

/** 시험에서 가짜로 대체할 수 있는 최소 2D 컨텍스트. */
export type Canvas2D = Pick<
  CanvasRenderingContext2D,
  | 'clearRect'
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'stroke'
  | 'arc'
  | 'fill'
  | 'fillRect'
  | 'fillText'
  | 'strokeRect'
> & {
  lineWidth: number;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
  font: string;
  textBaseline: CanvasTextBaseline;
};

type Point = Readonly<{ x: number; y: number }>;

export type DrawOptions = Readonly<{
  /** 미리보기 video 가 거울처럼 뒤집혀 있으면 x 를 1-x 로 그린다. 게이지는 뒤집지 않는다. */
  mirrored: boolean;
}>;

let mirrorX = false;
const px = (p: Point, w: number) => (mirrorX ? 1 - p.x : p.x) * w;

/** MediaPipe HandLandmarker 21점 연결. */
export const HAND_CONNECTIONS: readonly (readonly [number, number])[] = Object.freeze([
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [0, 17],
]);

const K = POSE_KEY_POINTS;
export const POSE_CONNECTIONS: readonly (readonly [number, number])[] = Object.freeze([
  [K.leftShoulder, K.rightShoulder],
  [K.leftShoulder, K.leftElbow],
  [K.leftElbow, K.leftWrist],
  [K.rightShoulder, K.rightElbow],
  [K.rightElbow, K.rightWrist],
]);

const COLORS = Object.freeze({
  face: 'rgba(90, 220, 255, 0.85)',
  faceKey: '#ffe066',
  poseOk: '#5be36b',
  poseLow: '#ff5c5c',
  hand: 'rgba(255, 160, 60, 0.9)',
  text: '#ffffff',
  panel: 'rgba(0, 0, 0, 0.55)',
  gauge: 'rgba(255,255,255,0.25)',
  gaugeOn: '#5be36b',
  gaugeIdle: '#ffe066',
});

function dot(ctx: Canvas2D, p: Point, w: number, h: number, radius: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(px(p, w), p.y * h, radius, 0, Math.PI * 2);
  ctx.fill();
}

function line(ctx: Canvas2D, a: Point, b: Point, w: number, h: number, color: string, width = 2) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(px(a, w), a.y * h);
  ctx.lineTo(px(b, w), b.y * h);
  ctx.stroke();
}

export function drawFace(ctx: Canvas2D, sensors: SensorSnapshot, w: number, h: number) {
  const face = sensors.face;
  if (!face || face.status !== 'valid') return 0;
  const points = face.data.landmarks;
  let drawn = 0;
  // 478점을 전부 찍으면 얼굴이 가려지므로 4점마다 하나만 찍는다.
  for (let i = 0; i < points.length; i += 4) {
    dot(ctx, points[i]!, w, h, 1.2, COLORS.face);
    drawn++;
  }
  for (const index of Object.values(FACE_KEY_POINTS)) {
    const p = points[index];
    if (p) {
      dot(ctx, p, w, h, 3, COLORS.faceKey);
      drawn++;
    }
  }
  return drawn;
}

export function drawPose(ctx: Canvas2D, sensors: SensorSnapshot, w: number, h: number) {
  const pose = sensors.pose;
  if (!pose || pose.status !== 'valid') return 0;
  const points = pose.data.landmarks;
  let drawn = 0;
  const visible = (i: number) => (points[i]?.visibility ?? 0) >= POSE_MIN_VISIBILITY;
  for (const [a, b] of POSE_CONNECTIONS) {
    const pa = points[a];
    const pb = points[b];
    if (!pa || !pb) continue;
    line(ctx, pa, pb, w, h, visible(a) && visible(b) ? COLORS.poseOk : COLORS.poseLow, 3);
    drawn++;
  }
  const nose = points[K.nose];
  const ls = points[K.leftShoulder];
  const rs = points[K.rightShoulder];
  if (nose && ls && rs) {
    line(ctx, nose, { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 }, w, h, COLORS.poseOk, 1.5);
    drawn++;
  }
  for (const index of Object.values(K)) {
    const p = points[index];
    if (!p) continue;
    dot(ctx, p, w, h, 4, visible(index) ? COLORS.poseOk : COLORS.poseLow);
    drawn++;
  }
  return drawn;
}

export function drawHands(ctx: Canvas2D, sensors: SensorSnapshot, w: number, h: number) {
  const gesture = sensors.gesture;
  if (!gesture || gesture.status !== 'valid' || !gesture.data.hands) return 0;
  let drawn = 0;
  for (const hand of gesture.data.hands) {
    for (const [a, b] of HAND_CONNECTIONS) {
      const pa = hand[a];
      const pb = hand[b];
      if (!pa || !pb) continue;
      line(ctx, pa, pb, w, h, COLORS.hand, 2);
      drawn++;
    }
    for (const p of hand) {
      dot(ctx, p, w, h, 2.5, COLORS.hand);
      drawn++;
    }
  }
  return drawn;
}

const fmt = (value: number | null | undefined, digits = 3) =>
  value === null || value === undefined || !Number.isFinite(value) ? '-' : value.toFixed(digits);
const deg = (rad: number | null | undefined) =>
  rad === null || rad === undefined || !Number.isFinite(rad)
    ? '-'
    : `${((rad * 180) / Math.PI).toFixed(1)}°`;

/** 상대 신호와 진입/해제 임계를 한 줄 게이지로 그린다. 중앙이 중립이다. */
function gauge(
  ctx: Canvas2D,
  x: number,
  y: number,
  width: number,
  value: number | null,
  range: number,
  marks: readonly number[],
  active: boolean,
) {
  ctx.fillStyle = COLORS.gauge;
  ctx.fillRect(x, y, width, 8);
  const toX = (v: number) =>
    x + width / 2 + (Math.max(-range, Math.min(range, v)) / range) * (width / 2);
  ctx.fillStyle = COLORS.text;
  ctx.fillRect(x + width / 2 - 0.5, y - 2, 1, 12);
  for (const mark of marks) {
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillRect(toX(mark) - 0.5, y - 2, 1, 12);
  }
  if (value !== null && Number.isFinite(value)) {
    ctx.fillStyle = active ? COLORS.gaugeOn : COLORS.gaugeIdle;
    ctx.fillRect(toX(value) - 3, y - 3, 6, 14);
  }
}

/** 미리보기 아래 HTML 로 보여 주는 수치 줄. 캔버스에는 글자를 그리지 않는다(220px 에서 안 읽힘). */
export function readoutLines(feed: DebugFeedState, nowMs: number): string[] {
  const m = feed.motion;
  const s = feed.sensors;
  const lines: string[] = [];
  const age = feed.updatedAtMs ? Math.max(0, Math.round(nowMs - feed.updatedAtMs)) : null;
  lines.push(
    `갱신 ${age === null ? '-' : `${age}ms 전`} · 모드 ${m?.mode ?? '-'} · 판정 ${m ? (m.accepting ? '적용' : '대기') : '-'}`,
  );
  lines.push(
    `보정 ${m?.calibrated ? '완료' : '없음'} · 자세 ${m?.poseUsable ? 'OK' : 'X'} · 얼굴 ${m?.faceUsable ? 'OK' : 'X'}`,
  );
  const t = m?.thresholds;
  lines.push(
    `앞뒤 lean 상대 ${fmt(m?.leanRelative)} = 평균(어깨 ${fmt(m?.shoulderRelative)} · 얼굴 ${fmt(m?.faceRelative)}) · 앞 +${fmt(t?.forwardEnter, 2)}/${fmt(t?.forwardExit, 2)} 뒤 -${fmt(t?.backEnter, 2)}/${fmt(t?.backExit, 2)}`,
  );
  lines.push(
    `원시 ln(어깨 x 거리) ${fmt(m?.components.shoulder)} · ln(뺨 거리) ${fmt(m?.components.face)}`,
  );
  lines.push(
    `좌우 yaw 상대 ${deg(m?.yawRelative)} (원시 ${deg(m?.yawRaw)}) · 회전 진입 ${deg(t?.turnEnter)} 해제 ${deg(t?.turnExit)}`,
  );
  lines.push(
    `이동 ${m?.move ?? '-'}${m?.motionActive ? ' (모션)' : ''}${m?.leanGatedByYaw ? ' · 고개 돌림: 이동 차단' : ''} · 회전 latch ${m?.turnLatched ? '잠김' : '해제'}`,
  );
  const gesture = s?.gesture && s.gesture.status === 'valid' ? s.gesture.data : null;
  const poseQ = s?.pose && s.pose.status === 'valid' ? s.pose.data.quality : 'missing';
  const faceQ = s?.face && s.face.status === 'valid' ? s.face.data.quality : 'missing';
  lines.push(
    `quality 얼굴 ${faceQ} · 자세 ${poseQ} · 손 ${gesture ? `${gesture.kind} ${fmt(gesture.score, 2)}` : '-'} (${gesture?.hands?.length ?? 0}개)`,
  );
  return lines;
}

/** 캔버스 아래쪽에 앞뒤·좌우 게이지 두 줄만 그린다. 위: lean(앞 +, 뒤 -), 아래: yaw(오른쪽 +). */
export function drawGauges(ctx: Canvas2D, feed: DebugFeedState, w: number, h: number) {
  const m = feed.motion;
  const t = m?.thresholds;
  const padding = 6;
  const stripHeight = 40;
  ctx.fillStyle = COLORS.panel;
  ctx.fillRect(0, h - stripHeight, w, stripHeight);
  const gw = Math.max(40, w - padding * 2);
  gauge(
    ctx,
    padding,
    h - stripHeight + 6,
    gw,
    m?.leanRelative ?? null,
    0.3,
    t ? [t.forwardEnter, -t.backEnter] : [],
    m?.move !== null && m?.move !== undefined,
  );
  gauge(
    ctx,
    padding,
    h - stripHeight + 24,
    gw,
    m?.yawRelative ?? null,
    Math.PI / 4,
    t ? [t.turnEnter, -t.turnEnter] : [],
    m?.turnLatched ?? false,
  );
  return 2;
}

/** 전체 오버레이. 그린 도형 수를 돌려준다(시험용). */
export function drawDebugOverlay(
  ctx: Canvas2D,
  w: number,
  h: number,
  feed: DebugFeedState,
  options: DrawOptions = { mirrored: false },
) {
  mirrorX = options.mirrored;
  ctx.clearRect(0, 0, w, h);
  let drawn = 0;
  if (feed.sensors) {
    drawn += drawFace(ctx, feed.sensors, w, h);
    drawn += drawPose(ctx, feed.sensors, w, h);
    drawn += drawHands(ctx, feed.sensors, w, h);
  }
  drawn += drawGauges(ctx, feed, w, h);
  return drawn;
}
