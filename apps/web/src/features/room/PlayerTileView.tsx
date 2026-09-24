// S15P21C204-295. 대기실 타일 한 칸의 캐릭터. 경기에서 상대가 보는 그 아바타를 정면으로 세운다.
// 준비를 누르기 전에는 기본 얼굴이고, 카메라가 켜져 얼굴이 올라오면 그 영상이 얼굴에 붙는다.
// 대기실에서는 움직이지 않으므로 프레임을 계속 돌리지 않는다(frameloop="demand").
import { useEffect, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import type { Texture } from 'three';
import type { VisibleEntity } from '@kkakkung/protocol/game-schema';
import { Avatar, createAvatarResources } from '../game/scene/FaceAvatar';
import { createDemoFaceTexture } from '../game/scene/demo-face';

type PlayerEntity = Extract<VisibleEntity, { kind: 'player' }>;
const noTick = () => null;
/** 머리·어깨가 크게 잡히는 정면 카메라. 내 캐릭터 창과 같은 눈높이다. */
const CAMERA = Object.freeze({ position: [0, 0.72, -1.05] as const, fov: 30, lookAtY: 0.72 });

function LookAtAvatar({ face }: { face: Texture | null }) {
  const invalidate = useThree((state) => state.invalidate);
  const camera = useThree((state) => state.camera);
  useEffect(() => {
    camera.lookAt(0, CAMERA.lookAtY, 0);
    invalidate();
    // 한 장만 그리는 칸(그림 얼굴)은 그 한 장이 재료가 다 갖춰지기 전에 그려질 수 있다.
    // 그러면 얼굴이 회색인 채로 굳는다. 처음 잠깐은 몇 번 더 그려서 제 모습을 잡는다.
    let left = 8;
    const timer = setInterval(() => {
      invalidate();
      if (--left <= 0) clearInterval(timer);
    }, 120);
    return () => clearInterval(timer);
  }, [camera, invalidate, face]);
  // 얼굴이 영상이면 그 영상이 흐르는 동안 다시 그려야 한다. 대기실에서는 12fps 로 충분하다.
  // VideoTexture 는 화면에 붙은 video 의 프레임 콜백에서만 새 프레임을 올리므로, 여기서
  // 직접 올려 준다. 그러지 않으면 첫 프레임이 그대로 굳는다.
  useEffect(() => {
    if (!face) return;
    const timer = setInterval(() => {
      face.needsUpdate = true;
      invalidate();
    }, 80);
    return () => clearInterval(timer);
  }, [face, invalidate]);
  return null;
}

function Standing({ face }: { face: Texture | null }) {
  const resources = useMemo(createAvatarResources, []);
  useEffect(() => () => resources.dispose(), [resources]);
  const fallback = useMemo(createDemoFaceTexture, []);
  useEffect(() => () => fallback.dispose(), [fallback]);
  // 대기실에서는 역할이 아직 없다. 역할 없는 아바타는 중립 회색으로 선다(FaceAvatar).
  // S15P21C204-371. 얼굴은 아바타 머리의 얼굴 판에 바로 붙는다. 칸은 참가자 id 로 얼굴을
  // 찾지 않고 받은 텍스처를 그대로 넘기므로 id 는 칸 안에서만 쓰는 이름이다.
  const player: PlayerEntity = {
    id: 'lobby-tile',
    kind: 'player',
    cell: { x: 0, y: 0 },
    dir: 0,
    action: null,
  };
  return (
    <>
      <LookAtAvatar face={face} />
      <ambientLight intensity={0.9} color="#dfe8f3" />
      <directionalLight position={[1.2, 2.6, -2]} intensity={1.6} color="#f4f8ff" />
      <Avatar
        player={player}
        ally
        standIn={face ?? fallback}
        resources={resources}
        renderTick={noTick}
      />
    </>
  );
}

export function PlayerTileView({ face }: { face?: Texture | null }) {
  if (!face)
    return (
      <div className="tile-view lobby-placeholder" aria-hidden="true">
        <svg viewBox="0 0 100 100" focusable="false">
          <circle cx="50" cy="50" r="29" fill="#a4a59e" />
          <ellipse cx="40" cy="44" rx="3.5" ry="4.5" fill="#252622" />
          <ellipse cx="60" cy="44" rx="3.5" ry="4.5" fill="#252622" />
          <path d="M39 62h22" stroke="#252622" strokeWidth="3.5" />
        </svg>
      </div>
    );
  return (
    <div className="tile-view" aria-hidden="true">
      {/* 얼굴이 영상인 칸만 계속 그린다. 그림 얼굴은 한 장이면 그것으로 끝이다. */}
      <Canvas
        frameloop={face ? 'always' : 'demand'}
        dpr={1}
        gl={{ antialias: true, alpha: false, powerPreference: 'low-power' }}
        camera={{ position: [...CAMERA.position], fov: CAMERA.fov, near: 0.05, far: 10 }}
      >
        <color attach="background" args={['#0b0b0a']} />
        <Standing face={face ?? null} />
      </Canvas>
    </div>
  );
}
