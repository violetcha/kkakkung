// S15P21C204-295. 무대 우상단의 "내 캐릭터" 창. 경기에서 상대가 보는 내 아바타(FaceAvatar 의 Avatar
// 그대로)를 정면 상반신으로 보여 준다. 얼굴에는 경기에 게시되는 것과 같은 가공 얼굴(얼굴만 잘라 흑백)
// 스트림이 붙고, 카메라를 켜기 전에는 데모 방과 같은 그림 얼굴이다. 걷기·회전은 경기와 같은 행동 보간.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { Group, Texture, VideoTexture } from 'three';
import type { ActiveSelf, VisibleEntity } from '@kkakkung/protocol/game-schema';
import { Avatar, createAvatarResources } from '../scene/FaceAvatar';
import { worldActor } from '../scene/action-interpolation';
import { videoFaceTexture } from '../scene/face-textures';
import { createDemoFaceTexture } from '../scene/demo-face';

type PlayerEntity = Extract<VisibleEntity, { kind: 'player' }>;
type Props = {
  self: ActiveSelf;
  renderTick(): number | null;
  /** 게시용 가공 얼굴 스트림. 아직 없으면 null(그림 얼굴 유지). */
  faceStream(): MediaStream | null;
};

/**
 * 머리·어깨가 크게 잡히는 정면 카메라(F5 두 번 느낌). 16:9 창에서 세로가 기준이다.
 * S15P21C204-378. 술래는 등 혹이 1.18까지 솟고 팔까지 폭이 넓어, 물러서고 시선을 올려 다 담는다.
 */
const CAMERA = Object.freeze({ position: [0, 0.8, -2.3] as const, fov: 30, lookAtY: 0.6 });
/** 회전할 때 카메라가 따라 도는 속도. 1이면 즉시(회전이 안 보임), 작을수록 몸이 도는 게 오래 보인다. */
const FOLLOW = 0.1;

function LookAtAvatar() {
  const camera = useThree((state) => state.camera);
  useEffect(() => {
    camera.lookAt(0, CAMERA.lookAtY, 0);
  }, [camera]);
  return null;
}

/** 가공 얼굴 스트림을 화면에 붙이지 않는 video 로 받아 텍스처로 만든다. 소리는 없다. */
function createFaceVideo(stream: MediaStream) {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.srcObject = stream;
  void video.play().catch(() => {});
  return video;
}

function SelfAvatar({ self, renderTick, faceStream }: Props) {
  const resources = useMemo(createAvatarResources, []);
  useEffect(() => () => resources.dispose(), [resources]);
  const fallback = useMemo(createDemoFaceTexture, []);
  useEffect(() => () => fallback.dispose(), [fallback]);
  const turn = useRef<Group>(null);
  const slide = useRef<Group>(null);
  const face = useRef<{
    stream: MediaStream | null;
    video: HTMLVideoElement | null;
    texture: VideoTexture | null;
  }>({ stream: null, video: null, texture: null });
  const [texture, setTexture] = useState<Texture | null>(null);
  const release = () => {
    face.current.texture?.dispose();
    if (face.current.video) face.current.video.srcObject = null;
    face.current = { stream: null, video: null, texture: null };
  };
  useEffect(() => release, []);
  useFrame(() => {
    // Avatar 는 행동대로 자기 위치·방향을 움직인다. 바깥에서 위치는 그대로 되돌려 창 가운데에 두고,
    // 방향은 조금 늦게 따라 돌아 회전하는 몸이 보이게 한다(스냅 없음).
    const now = worldActor(self, renderTick());
    slide.current?.position.set(-now.x, 0, -now.z);
    if (turn.current) {
      const current = turn.current.rotation.y;
      let delta = -now.yaw - current;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      turn.current.rotation.y = current + delta * FOLLOW;
    }
    const stream = faceStream();
    if (stream !== face.current.stream) {
      release();
      if (stream) {
        const video = createFaceVideo(stream);
        face.current = { stream, video, texture: videoFaceTexture(video) };
      }
      setTexture(face.current.texture);
    }
  });
  const player: PlayerEntity = {
    id: self.playerId,
    kind: 'player',
    cell: self.cell,
    dir: self.dir,
    action: self.action,
    role: self.role,
  };
  return (
    <group ref={turn}>
      <group ref={slide}>
        <Avatar
          player={player}
          ally
          standIn={texture ?? fallback}
          resources={resources}
          renderTick={renderTick}
        />
      </group>
    </group>
  );
}

export function SelfAvatarView(props: Props) {
  return (
    <div className="solo-self-view" aria-hidden="true">
      <Canvas
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
        camera={{ position: [...CAMERA.position], fov: CAMERA.fov, near: 0.05, far: 10 }}
      >
        <LookAtAvatar />
        <ambientLight intensity={0.9} color="#dfe8f3" />
        <directionalLight position={[1.2, 2.6, -2]} intensity={1.6} color="#f4f8ff" />
        <SelfAvatar {...props} />
      </Canvas>
    </div>
  );
}
