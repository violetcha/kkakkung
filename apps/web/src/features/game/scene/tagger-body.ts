// S15P21C204-378. 술래의 괴수 체형. 머리 큐브와 얼굴 판은 모든 역할과 같은 자리(중심 0.72)에 두고,
// 그 둘레를 계단처럼 쌓은 어깨·등 혹, 굵은 팔 끝의 발톱, 짧고 굵은 다리로 키운다.
//
// 상자마다 메시를 두면 술래 한 명을 서른 번 넘게 그린다. 움직이지 않는 몸은 재질별로 한 도형으로,
// 팔·다리는 한쪽 몫을 재질별로 한 도형으로 합쳐 모든 술래가 같이 쓴다. 모양은 같고 그리기는
// 술래 한 명에 열한 번(몸 3, 팔 4, 다리 4)이다.
import { BoxGeometry, Matrix4, Quaternion, Vector3, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type Vec3 = readonly [number, number, number];
/** 크기와 중심. 앞은 -z(얼굴 판 쪽). */
export type BodyBox = Readonly<{ size: Vec3; at: Vec3 }>;

const box = (size: Vec3, at: Vec3): BodyBox => ({ size, at });
/** 좌우 한 쌍. x 는 오른쪽 값을 적고 왼쪽은 뒤집는다. */
const pair = (size: Vec3, [x, y, z]: Vec3): BodyBox[] => [
  box(size, [-x, y, z]),
  box(size, [x, y, z]),
];

export const TAGGER_BODY = Object.freeze({
  body: {
    hide: [
      box([0.42, 0.2, 0.3], [0, 0.44, 0.02]),
      box([0.62, 0.14, 0.38], [0, 0.6, 0.02]),
      box([0.74, 0.14, 0.42], [0, 0.73, 0.05]),
      // 어깨는 세 층으로 좁아지며 솟는다. 한 덩어리 네모가 아니라 둥근 어깨로 읽힌다.
      ...pair([0.3, 0.1, 0.34], [0.25, 0.84, 0.04]),
      ...pair([0.22, 0.1, 0.3], [0.3, 0.94, 0.06]),
      ...pair([0.14, 0.08, 0.26], [0.33, 1.03, 0.08]),
      box([0.46, 0.14, 0.26], [0, 1.02, 0.2]),
      box([0.32, 0.1, 0.22], [0, 1.13, 0.22]),
    ],
    dark: [box([0.44, 0.08, 0.28], [0, 0.3, 0.02]), box([0.52, 0.08, 0.16], [0, 1.0, -0.17])],
    /** 눈썹뼈 앞의 붉은 눈 두 개. 조명과 상관없이 빛난다. */
    eye: pair([0.07, 0.022, 0.01], [0.1, 1.0, -0.255]),
  },
  arm: {
    /** 오른팔 어깨 관절. 왼팔은 x 를 뒤집는다. */
    pivot: [0.44, 0.9, -0.04] as Vec3,
    hide: [box([0.17, 0.3, 0.17], [0, -0.15, 0]), box([0.13, 0.3, 0.13], [0, -0.45, -0.02])],
    dark: [
      box([0.18, 0.12, 0.18], [0, -0.66, -0.02]),
      ...[-0.055, 0, 0.055].map((x) => box([0.035, 0.08, 0.035], [x, -0.76, -0.08])),
    ],
  },
  leg: {
    pivot: [0.15, 0.3, 0] as Vec3,
    hide: [box([0.17, 0.16, 0.2], [0, -0.08, 0]), box([0.15, 0.1, 0.18], [0, -0.21, 0])],
    dark: [box([0.19, 0.05, 0.26], [0, -0.275, -0.04])],
  },
  /** 같은 편 표시 구. 등 혹 위에 뜬다. */
  badgeY: 1.24,
});

/** 단위 큐브를 상자마다 늘려 옮긴 뒤 한 도형으로 합친다. */
export function mergeBoxes(boxes: readonly BodyBox[]): BufferGeometry {
  const parts = boxes.map(({ size, at }) =>
    new BoxGeometry(1, 1, 1).applyMatrix4(
      new Matrix4().compose(new Vector3(...at), new Quaternion(), new Vector3(...size)),
    ),
  );
  const merged = mergeGeometries(parts);
  parts.forEach((part) => part.dispose());
  if (!merged) throw new Error('TAGGER_BODY_MERGE_FAILED');
  return merged;
}

export function createTaggerGeometry() {
  const T = TAGGER_BODY;
  return {
    bodyHide: mergeBoxes(T.body.hide),
    bodyDark: mergeBoxes(T.body.dark),
    bodyEye: mergeBoxes(T.body.eye),
    armHide: mergeBoxes(T.arm.hide),
    armDark: mergeBoxes(T.arm.dark),
    legHide: mergeBoxes(T.leg.hide),
    legDark: mergeBoxes(T.leg.dark),
  };
}
