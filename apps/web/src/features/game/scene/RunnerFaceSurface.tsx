import { useEffect, useMemo, useRef } from 'react';
import { createPortal, useFrame } from '@react-three/fiber';
import { CircleGeometry, Mesh, type Object3D, type Texture } from 'three';
import type { FaceTextures } from './face-textures';
import {
  createRunnerFaceMaterial,
  selectRunnerFaceTexture,
  syncRunnerFaceMaterial,
} from './runner-face-surface';

const FACE_GEOMETRY = new CircleGeometry(0.145, 16);

export function RunnerFaceSurface({
  socket,
  playerId,
  faces,
  standIn,
}: {
  socket: Object3D;
  playerId: string;
  faces?: FaceTextures;
  standIn?: Texture | null;
}) {
  const mesh = useRef<Mesh>(null);
  const material = useMemo(createRunnerFaceMaterial, []);
  useEffect(() => () => material.dispose(), [material]);
  useFrame(() => {
    const visible = syncRunnerFaceMaterial(
      material,
      selectRunnerFaceTexture(playerId, faces, standIn),
    );
    if (mesh.current) mesh.current.visible = visible;
  });
  return createPortal(
    <mesh
      ref={mesh}
      geometry={FACE_GEOMETRY}
      material={material}
      position={[0, 0, 0.003]}
      visible={false}
    />,
    socket,
  );
}
