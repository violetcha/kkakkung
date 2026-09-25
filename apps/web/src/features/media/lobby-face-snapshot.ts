// S15P21C204-401. 대기실 얼굴 칸에 보일 사진 한 장. 대기실·장치 점검에는 미디어가 없어서,
// 가공 얼굴을 그리는 면(흑백·얼굴 윤곽만 남긴 160×160)을 작은 JPEG 한 장으로 줄여 게임 서버에
// 보낸다. 원본 카메라 영상이 아니라 이미 가공된 면만 읽는다. 얼굴을 찾은 상태일 때만 찍는다.
import { LOBBY_FACE_MAX_CHARS, LOBBY_FACE_SIZE_PX } from '@kkakkung/protocol/game-messages';

/** 이 모듈이 쓰는 캔버스 기능만. 시험이 가짜를 넣을 수 있다. */
export type SnapshotCanvas = {
  width: number;
  height: number;
  getContext(kind: '2d'): Pick<CanvasRenderingContext2D, 'drawImage'> | null;
  toDataURL(type: 'image/jpeg', quality: number): string;
};

/** 얼굴이 이만큼 이어서 잡힌 뒤에 찍는다. 막 잡힌 첫 장은 흔들리거나 반쯤 가려져 있기 쉽다. */
export const LOBBY_FACE_STEADY_MS = 1000;
const QUALITIES = [0.7, 0.5, 0.35] as const;

/** 가공 면을 JPEG 데이터 주소로. 한도 안에 들지 못하거나 그릴 수 없으면 null. */
export function captureLobbyFace(
  surface: CanvasImageSource | null,
  createCanvas: () => SnapshotCanvas = () => document.createElement('canvas'),
): string | null {
  if (!surface) return null;
  const canvas = createCanvas();
  canvas.width = LOBBY_FACE_SIZE_PX;
  canvas.height = LOBBY_FACE_SIZE_PX;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(surface, 0, 0, LOBBY_FACE_SIZE_PX, LOBBY_FACE_SIZE_PX);
  for (const quality of QUALITIES) {
    const image = canvas.toDataURL('image/jpeg', quality);
    if (image.startsWith('data:image/jpeg;base64,') && image.length <= LOBBY_FACE_MAX_CHARS)
      return image;
  }
  return null;
}
