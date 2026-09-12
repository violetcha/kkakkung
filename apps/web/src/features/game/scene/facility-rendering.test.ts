import { expect, it } from 'vitest';
import { Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { privateViewSchema } from '@kkakkung/protocol/game-messages';
import { createFacilityResources } from './facility-theme';
import { RENDER_SCENES, renderFixture } from './render-fixture';
import { wallModel } from './scene-model';
import { visibleExitModel } from './visible-exit-model';
import { visibilityMask } from './visibility-mask';

it('all inspection scenes obey the real recipient contract in every direction', () => {
  for (const scene of RENDER_SCENES)
    for (const facing of [0, 1, 2, 3] as const) {
      const view = renderFixture(scene, facing);
      expect(privateViewSchema.safeParse(view).success).toBe(true);
      expect(visibilityMask(view).players).toHaveLength(
        scene === '상대 5명' ? 5 : scene === '출구·장비' ? 0 : 1,
      );
      expect(visibleExitModel(view)).toHaveLength(scene === '출구·장비' ? 1 : 0);
    }
});

it('removes actors and remembered doors with recipient visibility loss', () => {
  const view = renderFixture('출구·장비');
  expect(visibleExitModel({ ...view, visibleWallFaces: [] })).toEqual([]);
  const crowded = renderFixture('상대 5명');
  expect(visibilityMask({ ...crowded, visibleEntities: [] }).players).toEqual([]);
  expect(visibilityMask({ ...crowded, self: null }).players).toEqual([]);
});

it('facility walls and their raised panels face the passage on all four exit sides', () => {
  const resources = createFacilityResources();
  const material = new MeshBasicMaterial();
  try {
    for (const facing of [0, 1, 2, 3] as const) {
      const exit = visibleExitModel(renderFixture('출구·장비', facing))[0]!;
      const model = wallModel(exit.wall);
      for (const geometry of [resources.geometry.wall, resources.geometry.panel]) {
        const mesh = new Mesh(geometry, material);
        mesh.position.fromArray(model.position);
        mesh.rotation.set(...model.rotation);
        mesh.updateMatrixWorld(true);
        const origin = new Vector3(exit.approach.x, 0.6, exit.approach.y);
        const center = new Vector3(...model.position);
        const interior = new Vector3(exit.wall.x, 0.6, exit.wall.y);
        expect(
          new Raycaster(origin, center.clone().sub(origin).normalize()).intersectObject(mesh)
            .length,
        ).toBeGreaterThan(0);
        expect(
          new Raycaster(interior, center.clone().sub(interior).normalize()).intersectObject(mesh),
        ).toHaveLength(0);
      }
    }
  } finally {
    resources.dispose();
    material.dispose();
  }
});

it('each scene releases every shared GPU resource exactly once on repeated cleanup', () => {
  const resources = createFacilityResources();
  const owned = [
    ...Object.values(resources.geometry),
    ...Object.values(resources.material),
    ...resources.textures,
  ];
  const counts = owned.map(() => 0);
  owned.forEach((resource, index) => resource.addEventListener('dispose', () => counts[index]++));
  resources.dispose();
  resources.dispose();
  expect(counts.every((count) => count === 1)).toBe(true);
});
