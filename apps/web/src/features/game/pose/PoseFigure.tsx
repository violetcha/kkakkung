import type { PoseKind } from '../../input/InteractionRuntime';
import type { PoseMissReason } from './pose-evaluator';

/**
 * 탈출 자세를 글 대신 그림으로 보인다. 도전 중인 사람은 팔을 든 채 카메라 앞에 서 있어 긴 문장을
 * 읽을 수 없다. 막대 인형 하나가 할 일을, 둘레의 링이 유지 진행을 말한다.
 *
 * 인형은 거울처럼 그린다(내 왼팔이 화면 왼쪽). 사람은 화면을 거울로 보고 따라 한다.
 */
const RING_RADIUS = 54;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;
const SHOULDER = { left: [50, 54], right: [70, 54] } as const;
const HAND_UP = { left: [37, 30], right: [83, 30] } as const;
const HAND_DOWN = { left: [46, 80], right: [74, 80] } as const;

type Side = 'left' | 'right';

const raised = (kind: PoseKind, side: Side) => kind === 'y' || kind === side;

/** 원인마다 어느 팔을 짚고 어느 쪽으로 움직이라고 할지. */
function cueArrow(kind: PoseKind, hint: PoseMissReason | null, side: Side) {
  if (hint === 'other-arm') return raised(kind, side) ? null : 'down';
  if (!raised(kind, side)) return null;
  if (hint === 'arm-low') return 'up';
  if (hint === 'arm-spread') return 'out';
  return null;
}

function Arrow({ side, direction }: { side: Side; direction: 'up' | 'down' | 'out' }) {
  const [hx, hy] = direction === 'down' ? HAND_DOWN[side] : HAND_UP[side];
  const out = side === 'left' ? -1 : 1;
  const [dx, dy] = direction === 'up' ? [0, -9] : direction === 'down' ? [0, 9] : [9 * out, 0];
  const x = hx + (direction === 'out' ? 4 * out : 0);
  const y = hy + (direction === 'up' ? -4 : direction === 'down' ? 4 : 0);
  return (
    <g className="pose-figure-arrow">
      <line x1={x} y1={y} x2={x + dx} y2={y + dy} />
      <polyline
        points={
          direction === 'out'
            ? `${x + dx - 4 * out},${y - 4} ${x + dx},${y} ${x + dx - 4 * out},${y + 4}`
            : `${x - 4},${y + dy - 4 * Math.sign(dy)} ${x},${y + dy} ${x + 4},${y + dy - 4 * Math.sign(dy)}`
        }
      />
    </g>
  );
}

export function PoseFigure({
  kind,
  progress,
  hint = null,
  size = 132,
}: {
  kind: PoseKind;
  progress: number;
  hint?: PoseMissReason | null;
  size?: number;
}) {
  const done = Math.min(1, Math.max(0, progress));
  return (
    <svg
      className="pose-figure"
      data-state={done >= 1 ? 'held' : hint ? 'miss' : 'hold'}
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role="img"
      aria-hidden
    >
      <circle className="pose-figure-track" cx="60" cy="60" r={RING_RADIUS} />
      {done > 0 && (
        <circle
          className="pose-figure-ring"
          cx="60"
          cy="60"
          r={RING_RADIUS}
          strokeDasharray={`${done * RING_LENGTH} ${RING_LENGTH}`}
          transform="rotate(-90 60 60)"
        />
      )}
      <g className="pose-figure-body">
        <circle cx="60" cy="41" r="8" />
        <line x1="60" y1="49" x2="60" y2="80" />
        <line x1="50" y1="54" x2="70" y2="54" />
        <line x1="60" y1="80" x2="52" y2="99" />
        <line x1="60" y1="80" x2="68" y2="99" />
      </g>
      {(['left', 'right'] as const).map((side) => {
        const [sx, sy] = SHOULDER[side];
        const [hx, hy] = raised(kind, side) ? HAND_UP[side] : HAND_DOWN[side];
        const arrow = cueArrow(kind, hint, side);
        return (
          <g key={side}>
            <line
              className={raised(kind, side) ? 'pose-figure-arm' : 'pose-figure-rest'}
              data-cue={arrow ? 'true' : undefined}
              x1={sx}
              y1={sy}
              x2={hx}
              y2={hy}
            />
            {arrow && <Arrow side={side} direction={arrow} />}
          </g>
        );
      })}
    </svg>
  );
}
