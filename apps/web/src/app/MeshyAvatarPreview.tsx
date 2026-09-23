import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import {
  AnimationMixer,
  Box3,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
  TextureLoader,
} from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  fitAvatarBounds,
  previewPlaybackRate,
  type PreviewSpeed,
} from '../features/game/scene/meshy-avatar-preview';

type PreviewRole = 'runner' | 'tagger';
type Facing = 'front' | 'side';

const ASSETS = {
  runner: {
    label: '도망자 · Hollow Pilgrim 1207',
    directory: '/models/avatars/meshy-preview/runner',
    stem: 'Meshy_AI_The_Hollow_Pilgrim_0922031207_texture',
    model: 'runner_standard_walk_rigged.fbx',
    height: 1.55,
    x: -1.15,
  },
  tagger: {
    label: '술래 · Ragtooth Revenant 0916',
    directory: '/models/avatars/meshy-preview/tagger',
    stem: 'Meshy_AI_Ragtooth_Revenant_0922030916_texture',
    model: 'tagger_orc_walk_rigged.fbx',
    height: 2.15,
    x: 1.15,
  },
} as const;

function MeshyModel({
  role,
  facing,
  playing,
  speed,
  onReady,
}: {
  role: PreviewRole;
  facing: Facing;
  playing: boolean;
  speed: PreviewSpeed;
  onReady(role: PreviewRole, duration: number): void;
}) {
  const asset = ASSETS[role];
  const source = useLoader(FBXLoader, `${asset.directory}/${asset.model}`);
  const textures = useLoader(TextureLoader, [
    `${asset.directory}/${asset.stem}.png`,
    `${asset.directory}/${asset.stem}_normal.png`,
    `${asset.directory}/${asset.stem}_roughness.png`,
    `${asset.directory}/${asset.stem}_metallic.png`,
  ]);
  const [baseColor, normal, roughness, metallic] = textures;
  if (!baseColor || !normal || !roughness || !metallic)
    throw new Error(`Missing ${role} preview texture`);
  const prepared = useMemo(() => {
    baseColor.colorSpace = SRGBColorSpace;
    const material = new MeshStandardMaterial({
      map: baseColor,
      normalMap: normal,
      roughnessMap: roughness,
      metalnessMap: metallic,
      roughness: 1,
      metalness: 0,
      side: DoubleSide,
    });
    const object = cloneSkeleton(source);
    object.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      child.material = material;
      child.castShadow = true;
      child.receiveShadow = true;
    });
    const bounds = new Box3().setFromObject(object);
    const fit = fitAvatarBounds(bounds, asset.height);
    object.scale.setScalar(fit.scale);
    object.position.set(...fit.offset);
    const clip = source.animations[0];
    if (!clip) throw new Error(`Missing ${role} walk animation`);
    return { clip, material, mixer: new AnimationMixer(object), object };
  }, [asset.height, baseColor, metallic, normal, roughness, source]);

  useEffect(() => {
    prepared.mixer.clipAction(prepared.clip).reset().play();
    onReady(role, prepared.clip.duration);
    return () => {
      prepared.mixer.stopAllAction();
      prepared.mixer.uncacheRoot(prepared.object);
      prepared.material.dispose();
    };
  }, [onReady, prepared, role]);

  useFrame((_state, delta) => {
    prepared.mixer.update(delta * previewPlaybackRate(speed, prepared.clip.duration, playing));
  });

  return (
    <group position={[asset.x, 0, 0]} rotation={[0, facing === 'front' ? 0 : -Math.PI / 2, 0]}>
      <primitive object={prepared.object} />
    </group>
  );
}

function LoadingStandIns() {
  return (
    <>
      {[-1.15, 1.15].map((x) => (
        <mesh key={x} position={[x, 0.8, 0]}>
          <boxGeometry args={[0.6, 1.6, 0.4]} />
          <meshStandardMaterial color="#35332f" wireframe />
        </mesh>
      ))}
    </>
  );
}

function CameraAim() {
  const camera = useThree((state) => state.camera);
  useEffect(() => {
    camera.lookAt(0, 1.05, 0);
    camera.updateProjectionMatrix();
  }, [camera]);
  return null;
}

export function MeshyAvatarPreview() {
  const [facing, setFacing] = useState<Facing>('front');
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<PreviewSpeed>('game');
  const [ready, setReady] = useState<ReadonlySet<PreviewRole>>(() => new Set());
  const [durations, setDurations] = useState<Partial<Record<PreviewRole, number>>>({});
  const markReady = useCallback((role: PreviewRole, duration: number) => {
    setReady((previous) => {
      if (previous.has(role)) return previous;
      return new Set([...previous, role]);
    });
    setDurations((previous) =>
      previous[role] === duration ? previous : { ...previous, [role]: duration },
    );
  }, []);

  return (
    <section className="render-preview meshy-avatar-preview">
      <h2>Meshy 캐릭터 실물 검수</h2>
      <p>
        Meshy 외형에 도망자 Standard Walk와 술래 Orc Walk 리깅을 연결한 로컬 비교 화면입니다. 게임
        속도는 한 칸을 0.6초에 이동하며, 그 시간에 걷기 한 사이클을 재생합니다.
      </p>
      <div className="actions">
        <button aria-pressed={facing === 'front'} onClick={() => setFacing('front')}>
          정면
        </button>
        <button aria-pressed={facing === 'side'} onClick={() => setFacing('side')}>
          측면
        </button>
        <button aria-pressed={playing} onClick={() => setPlaying((value) => !value)}>
          {playing ? '일시정지' : '재생'}
        </button>
        <button aria-pressed={speed === 'native'} onClick={() => setSpeed('native')}>
          원본 속도
        </button>
        <button aria-pressed={speed === 'game'} onClick={() => setSpeed('game')}>
          게임 속도 · 0.6초
        </button>
        <button disabled title="현재 FBX에는 걷기 동작만 있습니다.">
          술래 공격 · 클립 없음
        </button>
      </div>
      <div className="product-canvas">
        <Canvas
          shadows
          camera={{ position: [0, 1.25, 6.4], fov: 42, near: 0.1, far: 30 }}
          aria-label="Meshy 캐릭터 비교"
        >
          <CameraAim />
          <color attach="background" args={['#15140f']} />
          <fog attach="fog" args={['#15140f', 7, 14]} />
          <hemisphereLight args={['#d7cbb2', '#25231f', 1.4]} />
          <ambientLight intensity={1.25} />
          <directionalLight castShadow position={[-3, 5, 4]} intensity={4.2} />
          <directionalLight position={[4, 2, 1]} intensity={2.1} color="#9ab5d8" />
          <Suspense fallback={<LoadingStandIns />}>
            <MeshyModel
              role="runner"
              facing={facing}
              playing={playing}
              speed={speed}
              onReady={markReady}
            />
            <MeshyModel
              role="tagger"
              facing={facing}
              playing={playing}
              speed={speed}
              onReady={markReady}
            />
          </Suspense>
          <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.015, 0]}>
            <planeGeometry args={[10, 8]} />
            <meshStandardMaterial color="#2a2924" roughness={1} />
          </mesh>
          <gridHelper args={[8, 16, '#4b483d', '#292821']} position={[0, 0, 0]} />
        </Canvas>
      </div>
      <div className="meshy-avatar-labels" aria-hidden="true">
        <span>{ASSETS.runner.label}</span>
        <span>{ASSETS.tagger.label}</span>
      </div>
      <output aria-label="Meshy 아바타 로딩" data-ready={ready.size === 2}>
        {ready.size === 2 ? '도망자·술래 준비 완료' : `모델 불러오는 중 ${ready.size}/2`}
      </output>
      <dl className="meshy-avatar-diagnostics">
        <div>
          <dt>도망자 손</dt>
          <dd>Standard Walk의 팔 스윙 재생 · 원본 {durations.runner?.toFixed(2) ?? '-'}초</dd>
        </div>
        <div>
          <dt>술래 손</dt>
          <dd>Orc Walk의 팔 스윙 재생 · 원본 {durations.tagger?.toFixed(2) ?? '-'}초</dd>
        </div>
        <div>
          <dt>술래 공격</dt>
          <dd>별도 공격 클립 없음 · 현재는 걷기 중 팔 흔들림만 확인 가능</dd>
        </div>
      </dl>
    </section>
  );
}
