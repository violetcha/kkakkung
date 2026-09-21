import { BoxGeometry, MeshBasicMaterial, MeshStandardMaterial, SphereGeometry } from 'three';

export function createNeutralAvatarResources() {
  const geometry = {
    cube: new BoxGeometry(1, 1, 1),
    badge: new SphereGeometry(0.032, 8, 6),
  };
  const material = {
    body: new MeshStandardMaterial({ color: '#5e5a52', flatShading: true, roughness: 1 }),
    head: new MeshStandardMaterial({ color: '#36312c', flatShading: true, roughness: 1 }),
    boot: new MeshStandardMaterial({ color: '#1f2223', flatShading: true, roughness: 0.94 }),
    ally: new MeshBasicMaterial({ color: '#a9e6d1', toneMapped: false }),
  };
  let disposed = false;
  return {
    geometry,
    material,
    dispose() {
      if (disposed) return;
      disposed = true;
      Object.values(geometry).forEach((resource) => resource.dispose());
      Object.values(material).forEach((resource) => resource.dispose());
    },
  };
}

export type NeutralAvatarResources = ReturnType<typeof createNeutralAvatarResources>;

export function NeutralAvatar({ resources }: { resources: NeutralAvatarResources }) {
  const { geometry, material } = resources;
  return (
    <>
      <mesh
        geometry={geometry.cube}
        material={material.head}
        position={[0, 0.72, 0]}
        scale={0.48}
      />
      <mesh
        geometry={geometry.cube}
        material={material.body}
        position={[0, 0.34, 0]}
        scale={[0.36, 0.32, 0.2]}
      />
      {([-1, 1] as const).map((side) => (
        <group key={side}>
          <mesh
            geometry={geometry.cube}
            material={material.body}
            position={[side * 0.23, 0.34, 0]}
            scale={[0.1, 0.28, 0.1]}
          />
          <mesh
            geometry={geometry.cube}
            material={material.boot}
            position={[side * 0.08, 0.1, -0.02]}
            scale={[0.11, 0.2, 0.14]}
          />
        </group>
      ))}
    </>
  );
}
